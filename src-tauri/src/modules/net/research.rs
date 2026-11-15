//! TF3/TF4: public HTTPS *read only* document retrieval.
//!
//! This is deliberately NOT a general-purpose HTTP tool. No arbitrary
//! headers/methods/body, no cookies or credentials, no redirects, no private
//! or metadata IPs, DNS pinned once, no proxy, strict size/time/content caps.
//! The model never receives raw filesystem or network transport authority.
use super::*;
use serde::Serialize;
use sha2::{Digest, Sha256};

const MAX_URL: usize = 2048;
const MAX_PAGE_BYTES: usize = 65536;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPage {
    url: String,
    status: u16,
    content_type: String,
    retrieved_at: u128,
    body: String,
    excerpt_sha256: String,
    truncated: bool,
}

fn validate_research_url(raw: &str) -> Result<reqwest::Url, String> {
    if raw.len() > MAX_URL || raw.trim() != raw || raw.chars().any(char::is_control) {
        return Err("research-invalid-url".into());
    }
    let parsed = validate_url(raw, false).map_err(|_| "research-invalid-url")?;
    if parsed.scheme() != "https"
        || parsed.fragment().is_some()
        || !matches!(parsed.port(), None | Some(443))
    {
        return Err("research-public-https-only".into());
    }
    // Never put credentials, auth-code exchange parameters or session tokens
    // into a retrieved URL, even when provided by untrusted model text.
    if parsed.query_pairs().any(|(k, _)| {
        let key = k.to_ascii_lowercase();
        [
            "key",
            "token",
            "secret",
            "password",
            "auth",
            "authorization",
            "session",
            "sid",
            "credential",
            "signature",
            "code",
            "jwt",
            "access_token",
            "apikey",
        ]
        .iter()
        .any(|s| key == *s || key.ends_with(&format!("_{s}")) || key.ends_with(&format!("-{s}")))
    }) {
        return Err("research-credential-url-denied".into());
    }
    Ok(parsed)
}

#[tauri::command]
pub async fn research_fetch_page(url: String) -> Result<ResearchPage, String> {
    let parsed = validate_research_url(&url)?;
    let host = parsed.host_str().ok_or("research-invalid-url")?.to_string();
    // Refuse if ANY DNS answer is private, loopback, or metadata. Reuse the
    // exact checked addresses in reqwest so DNS rebinding cannot cross scope.
    let ips = classify_and_collect_safe_ips(&host, false)
        .await
        .map_err(|_| "research-private-host-denied")?;
    let addrs: Vec<SocketAddr> = ips.into_iter().map(|ip| SocketAddr::new(ip, 0)).collect();
    let client = custom_tool_transport()
        .timeout(Duration::from_secs(15))
        .resolve_to_addrs(&host, &addrs)
        .user_agent("Clack-Research/1.0")
        .build()
        .map_err(|_| "research-client-unavailable")?;
    let mut response = client
        .get(parsed.clone())
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,text/plain,application/json",
        )
        .send()
        .await
        .map_err(|_| "research-network-failed")?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(format!("research-http-status-{status}"));
    }
    let kind = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ![
        "text/html",
        "application/xhtml+xml",
        "text/plain",
        "application/json",
    ]
    .iter()
    .any(|prefix| kind.starts_with(prefix))
    {
        return Err("research-unsupported-content-type".into());
    }
    let mut bytes = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "research-network-failed")?
    {
        let space = MAX_PAGE_BYTES.saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..chunk.len().min(space)]);
        if chunk.len() > space || bytes.len() == MAX_PAGE_BYTES {
            truncated = true;
            break;
        }
    }
    let body = String::from_utf8(bytes.clone()).map_err(|_| "research-non-utf8")?;
    let retrieved_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "research-clock-unavailable")?
        .as_millis();
    Ok(ResearchPage {
        url: parsed.to_string(),
        status,
        content_type: kind,
        retrieved_at,
        body,
        excerpt_sha256: format!("{:x}", Sha256::digest(&bytes)),
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_private_userinfo_insecure_redirect_hint_and_auth_parameters() {
        for url in [
            "http://example.com/",
            "https://user:password@example.com/",
            "https://example.com/#fragment",
            "https://example.com:8443/",
            "file:///etc/passwd",
            "https://metadata.google.internal/",
            "https://example.com/?access_token=secret",
            "https://example.com/?api_key=secret",
            "https://example.com/?x-api-key=secret",
            "https://example.com/?session=secret",
            "https://example.com/?code=secret",
            "https://example.com/\nHost: x",
        ] {
            assert!(validate_research_url(url).is_err(), "accepted {url:?}");
        }
    }

    #[tokio::test]
    async fn private_literal_is_denied_before_sending_request() {
        for url in [
            "https://127.0.0.1/",
            "https://192.168.1.44/",
            "https://169.254.169.254/",
            "https://[::1]/",
        ] {
            assert!(research_fetch_page(url.into()).await.is_err());
        }
    }

    #[test]
    fn allows_public_document_query_without_secret_parameters() {
        assert!(validate_research_url("https://docs.rs/serde/latest/?search=Deserialize").is_ok());
    }
}
