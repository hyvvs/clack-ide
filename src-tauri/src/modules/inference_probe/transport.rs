use super::metadata::{Endpoint, ErrorCode, ProbeError, Route};
use crate::modules::net::{ip_kind, is_blocked_host_name, IpKind};
use futures_util::StreamExt;
use reqwest::{header, Client, Url};
use serde_json::{json, Value};
use std::{
    future::Future,
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    sync::Arc,
    time::Duration,
};
use tokio::sync::Semaphore;

pub const MAX_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_REQUESTS: usize = 6;
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);

pub struct Transport {
    slots: Arc<Semaphore>,
    dns_slots: Arc<Semaphore>,
    pub probe_timeout: Duration,
}
impl Default for Transport {
    fn default() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(2)),
            dns_slots: Arc::new(Semaphore::new(2)),
            probe_timeout: PROBE_TIMEOUT,
        }
    }
}

pub async fn deadline<T>(
    duration: Duration,
    future: impl Future<Output = Result<T, ProbeError>>,
) -> Result<T, ProbeError> {
    tokio::time::timeout(duration, future)
        .await
        .map_err(|_| ProbeError::new(ErrorCode::Timeout))?
}

pub fn route_url(endpoint: &Endpoint, route: Route) -> Result<Url, ProbeError> {
    let raw = &endpoint.base_url;
    let bad = || ProbeError::new(ErrorCode::UnsafeEndpoint);
    if raw.len() > 4096 || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(bad());
    }
    let mut url = Url::parse(raw).map_err(|_| bad())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(bad());
    }
    let host = url.host_str().ok_or_else(bad)?.trim_end_matches('.');
    if is_blocked_host_name(host) || host.ends_with(".metadata.google.internal") {
        return Err(bad());
    }
    let path = url.path().trim_end_matches('/');
    let path = if route == Route::CompatibleModels {
        if path.is_empty() {
            "/v1"
        } else {
            path
        }
    } else {
        // Only remove a terminal API version marker, never the reverse-proxy prefix.
        path.strip_suffix("/v1").unwrap_or(path)
    };
    url.set_path(&format!("{path}/{}", route.suffix()));
    Ok(url)
}

pub fn approve_ips(ips: Vec<IpAddr>, allow_private: bool) -> Result<Vec<IpAddr>, ProbeError> {
    if ips.is_empty() || ips.len() > 64 {
        return Err(ProbeError::new(ErrorCode::DnsFailure));
    }
    for ip in &ips {
        let canonical = match ip {
            IpAddr::V6(v) => v.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(*ip),
            _ => *ip,
        };
        if let IpAddr::V6(v) = canonical {
            let s = v.segments();
            // Transition mechanisms can hide an otherwise forbidden IPv4 destination.
            if s[0] == 0x2002 || (s[0] == 0x2001 && s[1] == 0) || (s[0] == 0x64 && s[1] == 0xff9b) {
                return Err(ProbeError::new(ErrorCode::UnsafeEndpoint));
            }
        }
        if canonical == IpAddr::from([100, 100, 100, 200])
            || canonical.is_unspecified()
            || canonical.is_multicast()
            || matches!(ip_kind(canonical), IpKind::BlockedMetadata)
            || (!allow_private && matches!(ip_kind(canonical), IpKind::Loopback | IpKind::Private))
        {
            return Err(ProbeError::new(ErrorCode::UnsafeEndpoint));
        }
    }
    Ok(ips)
}

pub fn pinned_client(host: &str, ips: &[IpAddr]) -> Result<Client, ProbeError> {
    let addresses: Vec<_> = ips.iter().map(|ip| SocketAddr::new(*ip, 0)).collect();
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .resolve_to_addrs(host, &addresses)
        .connect_timeout(PROBE_TIMEOUT)
        .build()
        .map_err(|_| ProbeError::new(ErrorCode::InvalidConfiguration))
}

fn request_error(error: reqwest::Error) -> ProbeError {
    if error.is_timeout() {
        return ProbeError::new(ErrorCode::Timeout);
    }
    // Classify internally; never return the URL or raw TLS/backend error chain.
    let mut cause = std::error::Error::source(&error);
    while let Some(err) = cause {
        let message = err.to_string().to_ascii_lowercase();
        if message.contains("certificate")
            || message.contains("tls")
            || message.contains("corrupt message")
            || message.contains("handshake failure")
        {
            return ProbeError::new(ErrorCode::TlsFailure);
        }
        cause = err.source();
    }
    ProbeError::new(ErrorCode::Unreachable)
}

pub fn decode_json(bytes: &[u8], secret: Option<&str>) -> Result<Value, ProbeError> {
    if bytes.len() > MAX_BYTES {
        return Err(ProbeError::http(ErrorCode::ResponseTooLarge, 200));
    }
    if secret
        .filter(|s| !s.is_empty())
        .is_some_and(|s| bytes.windows(s.len()).any(|w| w == s.as_bytes()))
    {
        return Err(ProbeError::metadata());
    }
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| ProbeError::http(ErrorCode::InvalidServerResponse, 200))?;
    // Catch an escaped credential echoed inside a model ID/name as well.
    if secret
        .filter(|s| !s.is_empty())
        .is_some_and(|s| contains_secret(&value, s))
    {
        return Err(ProbeError::metadata());
    }
    if !value.is_object() {
        return Err(ProbeError::metadata());
    }
    Ok(value)
}
fn contains_secret(value: &Value, secret: &str) -> bool {
    match value {
        Value::String(s) => s.contains(secret),
        Value::Array(a) => a.iter().any(|v| contains_secret(v, secret)),
        Value::Object(m) => m
            .iter()
            .any(|(k, v)| k.contains(secret) || contains_secret(v, secret)),
        _ => false,
    }
}

impl Transport {
    async fn resolve(&self, host: &str, allow_private: bool) -> Result<Vec<IpAddr>, ProbeError> {
        if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
            return approve_ips(vec![ip], allow_private);
        }
        let permit = self
            .dns_slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| ProbeError::new(ErrorCode::Cancelled))?;
        let host = host.to_owned();
        // OS DNS cannot always be interrupted. Retain its permit until it really exits.
        let ips = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            (host.as_str(), 0)
                .to_socket_addrs()
                .map(|a| a.take(65).map(|a| a.ip()).collect())
        })
        .await
        .map_err(|_| ProbeError::new(ErrorCode::DnsFailure))?
        .map_err(|_| ProbeError::new(ErrorCode::DnsFailure))?;
        approve_ips(ips, allow_private)
    }

    pub async fn request(
        &self,
        endpoint: &Endpoint,
        route: Route,
        selected: Option<&str>,
        secret: Option<&str>,
        allow_private: bool,
        requests: &mut usize,
    ) -> Result<Value, ProbeError> {
        if *requests >= MAX_REQUESTS {
            return Err(ProbeError::new(ErrorCode::RequestLimit));
        }
        *requests += 1;
        let mut reachable = false;
        let result = deadline(self.probe_timeout, async {
            let _permit = self
                .slots
                .acquire()
                .await
                .map_err(|_| ProbeError::new(ErrorCode::Cancelled))?;
            let url = route_url(endpoint, route)?;
            let host = url
                .host_str()
                .ok_or_else(|| ProbeError::new(ErrorCode::UnsafeEndpoint))?;
            let ips = self.resolve(host, allow_private).await?;
            let client = pinned_client(host, &ips)?;
            let request = if route == Route::OllamaShow {
                let model =
                    selected.ok_or_else(|| ProbeError::new(ErrorCode::InvalidConfiguration))?;
                client
                    .post(url)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(json!({"model": model, "verbose": false}).to_string())
            } else {
                client.get(url)
            };
            let mut request = request
                .header(header::ACCEPT, "application/json")
                .header(header::ACCEPT_ENCODING, "identity");
            if let Some(secret) = secret {
                let mut header = header::HeaderValue::from_str(&format!("Bearer {secret}"))
                    .map_err(|_| ProbeError::new(ErrorCode::AuthenticationFailed))?;
                header.set_sensitive(true);
                request = request.header(header::AUTHORIZATION, header);
            }
            let response = request.send().await.map_err(request_error)?;
            reachable = true;
            let status = response.status().as_u16();
            if status != 200 {
                let code = match status {
                    401 | 403 => ErrorCode::AuthenticationFailed,
                    404 | 405 | 501 => ErrorCode::UnsupportedProbeRoute,
                    _ => ErrorCode::InvalidServerResponse,
                };
                return Err(ProbeError::http(code, status));
            }
            let content_type = response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            // Identity encoding avoids decompression amplification without altering chat transport.
            if !(content_type == "application/json"
                || (content_type.starts_with("application/") && content_type.ends_with("+json")))
                || response
                    .headers()
                    .get(header::CONTENT_ENCODING)
                    .is_some_and(|v| v != "identity")
            {
                return Err(ProbeError::http(ErrorCode::InvalidServerResponse, status));
            }
            if response
                .content_length()
                .is_some_and(|n| n > MAX_BYTES as u64)
            {
                return Err(ProbeError::http(ErrorCode::ResponseTooLarge, status));
            }
            let mut stream = response.bytes_stream();
            let mut bytes = Vec::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(request_error)?;
                if bytes.len().saturating_add(chunk.len()) > MAX_BYTES {
                    return Err(ProbeError::http(ErrorCode::ResponseTooLarge, status));
                }
                bytes.extend_from_slice(&chunk);
            }
            decode_json(&bytes, secret)
        })
        .await;
        result.map_err(|mut error| {
            error.reachable |= reachable;
            error
        })
    }
}
