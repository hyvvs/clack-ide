//! TF Slice 3: bounded native reads and optional Brave Web Search.
//! No generic request headers, methods, bodies, proxies, retries or auto redirects.
//! Per-hop DNS is checked and pinned, but peer socket IP and network sandbox
//! cannot be attested. Actor/session are token-bound labels, not OS principals.
use super::{ip_kind, is_blocked_host_name, resolve_and_classify, IpKind};
use crate::modules::secrets::{read_secret, SecretsState};
use crate::modules::workspace::WorkspaceRegistry;
use reqwest::header::{ACCEPT, ACCEPT_ENCODING, CONTENT_TYPE, LOCATION, USER_AGENT};
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tokio::sync::watch;

const MAX_URL: usize = 2048;
const MAX_QUERY: usize = 512;
const MAX_BODY: usize = 64 * 1024;
const MAX_HEADERS: usize = 16 * 1024;
const MAX_TIMEOUT: u64 = 15_000;
const MAX_REDIRECTS: u8 = 5;
const MAX_SESSION_REQUESTS: usize = 20;
const SESSION_REQUEST_WINDOW: Duration = Duration::from_secs(300);
const TOKEN_TTL: Duration = Duration::from_secs(60);
const RESULT_TTL: Duration = Duration::from_secs(600);
const SEARCH_URL: &str = "https://api.search.brave.com/res/v1/web/search";
const SEARCH_SERVICE: &str = "clack.tf.search";
const SEARCH_ACCOUNT: &str = "brave";
const CREDENTIAL_REF: &str = "credential:brave-web-search";
const ISOLATION: &str =
    "dns_pinned_public_network_no_socket_peer_attestation_no_os_network_sandbox";
const TOOL_ID: &str = "tf.web_operation.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TfWebOperation {
    HttpGet,
    HttpHead,
    WebSearch,
    /// Internal write class, never deserializable from renderer/model JSON.
    #[serde(skip_deserializing)]
    BrowserBoundPost,
    /// Only a consumed origin-scoped TF4 native application credential grant
    /// can construct this method. No arbitrary authentication headers, raw
    /// secrets or user-supplied origin are accepted by the public TF3 API.
    #[serde(skip_deserializing)]
    BrowserOriginCredentialGet,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TfWebRequest {
    pub operation: TfWebOperation,
    pub actor: String,
    pub session_id: String,
    pub workspace_root: String,
    pub url: Option<String>,
    pub query: Option<String>,
    pub search_result_id: Option<String>,
    pub timeout_ms: Option<u64>,
    pub max_bytes: Option<usize>,
    pub max_redirects: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfWebPrepared {
    pub token: String,
    pub request_id: String,
    pub operation: TfWebOperation,
    pub requires_approval: bool,
    pub workspace_root: String,
    pub isolation: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfWebDnsEvidence {
    pub host: String,
    pub resolved_at: u64,
    pub addresses: Vec<String>,
    pub classification: &'static str,
    pub pinning: &'static str,
    pub socket_ip_observed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfWebSearchResult {
    pub id: String,
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub provider: &'static str,
    pub rank: usize,
    pub observed_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfWebReceipt {
    pub tool_id: &'static str,
    pub request_id: String,
    pub actor: String,
    pub operation: TfWebOperation,
    /// Wire method, distinct from the public read-only TF3 operation enum.
    /// Only a private native bound FORM envelope may set this to POST.
    pub actual_method: &'static str,
    pub terminal: &'static str,
    pub effect_state: &'static str,
    pub requested_url: Option<String>,
    pub final_url: Option<String>,
    pub redirect_chain: Vec<String>,
    pub normalized_target: Option<String>,
    pub status_code: Option<u16>,
    pub content_type: Option<String>,
    /// Native transport state for the last observed HTTP response. HTTPS
    /// response evidence is not independent socket peer-IP attestation.
    pub tls_state: &'static str,
    pub bytes_received: Option<u64>,
    pub bytes_retained: usize,
    pub truncated: bool,
    pub content_sha256: Option<String>,
    pub body: Option<String>,
    pub started_at: u64,
    pub ended_at: u64,
    pub credential_reference: Option<&'static str>,
    /// True: key attached to an attempted request, NOT proof of receipt by peer.
    pub credential_used: bool,
    pub retry: &'static str,
    pub auto_retry: bool,
    pub policy_decision: &'static str,
    pub reason_code: &'static str,
    pub search_results: Option<Vec<TfWebSearchResult>>,
    pub search_source: Option<&'static str>,
    pub uncertainty: &'static str,
    pub isolation: &'static str,
    pub dns_evidence: Vec<TfWebDnsEvidence>,
}

/// Opaque binary bytes for a browser resource. This deliberately reuses the
/// same TF3 prepared-token, DNS/IP/redirect, timeout and receipt executor as
/// text GET; it is not a second HTTP or network policy implementation.
/// Not exported as a Tauri command or model-facing tool.
#[derive(Debug)]
pub struct TfBrowserResource {
    pub receipt: TfWebReceipt,
    pub bytes: Vec<u8>,
}

/// Private TF3 write envelope. It is intentionally absent from TfWebRequest,
/// TfWebOperation, Tauri commands and model schemas. A native caller must
/// supply an already-consumed TF4 exact FORM/submitter witness before using
/// this engine; merely knowing a URL is not write authorization.
#[derive(Clone)]
pub(super) struct TfBrowserBoundPost {
    pub(super) destination: Url,
    pub(super) approved_origin: Url,
    pub(super) body: Vec<u8>,
    pub(super) body_sha256: String,
    pub(super) content_type: &'static str,
    pub(super) source_page_generation: u64,
    pub(super) original_form_index: u32,
    pub(super) original_submitter_index: u32,
    pub(super) consumed_approval_id: String,
}

#[derive(Clone)]
pub(super) struct TfBrowserOriginCredentialGet {
    pub(super) destination: Url,
    pub(super) approved_origin: Url,
    pub(super) reference: String,
    pub(super) source_page_generation: u64,
    pub(super) consumed_approval_id: String,
}

#[derive(Debug)]
pub(super) struct TfBrowserWriteTransport {
    pub(super) receipt: TfWebReceipt,
    pub(super) request_body_sha256: String,
    pub(super) request_body_bytes: usize,
    pub(super) destination_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfWebProviderStatus {
    pub provider: &'static str,
    pub configured: bool,
    pub available: bool,
    pub reason_code: &'static str,
    pub credential_reference: &'static str,
    pub isolation: &'static str,
}

#[derive(Clone)]
struct Pending {
    request_id: String,
    request: TfWebRequest,
    policy: NetworkPolicy,
    root: PathBuf,
    target: Option<Url>,
    expires: Instant,
    approved: bool,
    browser_post: Option<TfBrowserBoundPost>,
    browser_credential: Option<TfBrowserOriginCredentialGet>,
}
#[derive(Clone)]
struct IndexedResult {
    actor: String,
    session_id: String,
    root: PathBuf,
    url: Url,
    expires: Instant,
}
#[derive(Default)]
struct Entries {
    pending: HashMap<String, Pending>,
    active: HashMap<String, watch::Sender<bool>>,
    results: HashMap<String, IndexedResult>,
    /// Conservative per-actor/session/root prepare budget. Pending requests
    /// consume quota even when cancelled; no global proxy or free replay.
    request_budget: HashMap<(String, String, String), Vec<Instant>>,
}
#[derive(Default)]
pub struct TfWebState {
    entries: Mutex<Entries>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn nonce() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|_| "native-random-unavailable".to_owned())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn valid_label(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 128
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
}
fn scope(req: &TfWebRequest, registry: &WorkspaceRegistry) -> Result<PathBuf, String> {
    if !valid_label(&req.actor) || !valid_label(&req.session_id) {
        return Err("invalid-actor-or-session".into());
    }
    if req.workspace_root.is_empty()
        || req.workspace_root.trim() != req.workspace_root
        || req.workspace_root.chars().any(char::is_control)
    {
        return Err("invalid-workspace-root".into());
    }
    let root = std::fs::canonicalize(&req.workspace_root)
        .map_err(|_| "workspace-root-unavailable".to_owned())?;
    if !root.is_dir() || !registry.is_authorized(&root) {
        return Err("workspace-root-not-authorized".into());
    }
    Ok(root)
}
fn sensitive_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    const KEYS: &[&str] = &[
        "key",
        "token",
        "secret",
        "password",
        "passwd",
        "pwd",
        "auth",
        "authorization",
        "credential",
        "credentials",
        "signature",
        "sig",
        "session",
        "sid",
        "cookie",
        "code",
        "jwt",
        "access_token",
        "refresh_token",
        "api_key",
        "apikey",
        "client_secret",
        "private_key",
    ];
    let compact = k.replace(['_', '-', '.'], "");
    if [
        "token",
        "secret",
        "password",
        "passwd",
        "credential",
        "apikey",
        "authorization",
        "signature",
        "session",
        "cookie",
        "clientsecret",
        "privatekey",
    ]
    .iter()
    .any(|s| compact.contains(s))
    {
        return true;
    }
    KEYS.iter().any(|s| {
        k == *s
            || k.ends_with(&format!("_{s}"))
            || k.ends_with(&format!("-{s}"))
            || k.starts_with(&format!("{s}_"))
            || k.starts_with(&format!("{s}-"))
    })
}
fn normalize_url_policy(raw: &str, policy: NetworkPolicy) -> Result<Url, String> {
    #[cfg(not(any(test, feature = "tf-browser-isolation-acceptance")))]
    let _ = policy;
    if raw.len() > MAX_URL
        || raw.trim() != raw
        || raw.bytes().any(|b| b.is_ascii_control() || b == b'\\')
    {
        return Err("invalid-url".into());
    }
    let mut url = Url::parse(raw).map_err(|_| "invalid-url".to_owned())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("scheme-or-userinfo-denied".into());
    }
    let host = url.host_str().ok_or("missing-host")?;
    let raw_ip = host.trim_matches(&['[', ']'][..]);
    if host.ends_with('.')
        || raw_ip.is_empty()
        || is_blocked_host_name(raw_ip)
        || (!raw_ip.contains('.') && raw_ip.parse::<IpAddr>().is_err())
        || [
            ".localhost",
            ".local",
            ".internal",
            ".lan",
            ".home.arpa",
            ".invalid",
            ".test",
        ]
        .iter()
        .any(|s| raw_ip.ends_with(s))
    {
        return Err("hostname-denied".into());
    }
    if url.query_pairs().any(|(k, _)| sensitive_key(k.as_ref())) {
        return Err("credential-query-denied".into());
    }
    let default_port = if url.scheme() == "https" { 443 } else { 80 };
    // The only nonstandard-port exception in an acceptance binary is the
    // compile-time test fixture's loopback listener. It does not broaden the
    // normal TF3 public network policy or any production model-facing tool.
    #[cfg(any(test, feature = "tf-browser-isolation-acceptance"))]
    let fixture_port = matches!(policy, NetworkPolicy::FixtureLoopback)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1");
    #[cfg(not(any(test, feature = "tf-browser-isolation-acceptance")))]
    let fixture_port = false;
    if !cfg!(test) && !fixture_port && url.port().is_some_and(|p| p != default_port) {
        return Err("nonstandard-port-denied".into());
    }
    if url.port() == Some(default_port) {
        url.set_port(None).map_err(|_| "invalid-port".to_owned())?;
    }
    url.set_fragment(None);
    Ok(url)
}
fn normalize_url(raw: &str) -> Result<Url, String> {
    normalize_url_policy(raw, NetworkPolicy::Public)
}
fn validate_policy(req: &TfWebRequest, policy: NetworkPolicy) -> Result<(), String> {
    if req.timeout_ms == Some(0)
        || req.timeout_ms.unwrap_or(MAX_TIMEOUT) > MAX_TIMEOUT
        || req.max_bytes == Some(0)
        || req.max_bytes.unwrap_or(MAX_BODY) > MAX_BODY
        || req.max_redirects.unwrap_or(MAX_REDIRECTS) > MAX_REDIRECTS
    {
        return Err("network-bounds-denied".into());
    }
    match req.operation {
        TfWebOperation::WebSearch => {
            // Redirects are *always* refused for credentialed search. Accept
            // a bounded caller maxRedirects as a no-op for SDK parity.
            if req.url.is_some() || req.search_result_id.is_some() {
                return Err("search-parameters-denied".into());
            }
            let q = req.query.as_deref().ok_or("search-query-required")?;
            if q.trim() != q
                || q.is_empty()
                || q.len() > MAX_QUERY
                || q.chars().any(char::is_control)
            {
                return Err("invalid-search-query".into());
            }
        }
        TfWebOperation::HttpGet
        | TfWebOperation::HttpHead
        | TfWebOperation::BrowserBoundPost
        | TfWebOperation::BrowserOriginCredentialGet => {
            if req.query.is_some() || (req.url.is_some() == req.search_result_id.is_some()) {
                return Err("exactly-one-url-or-search-result-required".into());
            }
            if let Some(url) = &req.url {
                normalize_url_policy(url, policy)?;
            }
            if let Some(id) = &req.search_result_id {
                if id.len() != 48 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("invalid-search-result-id".into());
                }
            }
        }
    }
    Ok(())
}
fn reap(entries: &mut Entries) {
    entries.pending.retain(|_, p| p.expires > Instant::now());
    entries.results.retain(|_, r| r.expires > Instant::now());
    entries.request_budget.retain(|_, times| {
        times.retain(|at| at.elapsed() < SESSION_REQUEST_WINDOW);
        !times.is_empty()
    });
}
fn prepare_policy(
    req: TfWebRequest,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    policy: NetworkPolicy,
) -> Result<TfWebPrepared, String> {
    validate_policy(&req, policy)?;
    let root = scope(&req, registry)?;
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "network-state-unavailable")?;
    reap(&mut entries);
    if entries.pending.len() >= 64 || entries.active.len() >= 32 {
        return Err("network-capacity-exceeded".into());
    }
    let quota = entries
        .request_budget
        .entry((
            req.actor.clone(),
            req.session_id.clone(),
            root.to_string_lossy().into_owned(),
        ))
        .or_default();
    if quota.len() >= MAX_SESSION_REQUESTS {
        return Err("network-session-request-budget-exceeded".into());
    }
    quota.push(Instant::now());
    let target = match req.operation {
        TfWebOperation::WebSearch => None,
        _ => {
            if let Some(raw) = &req.url {
                Some(normalize_url_policy(raw, policy)?)
            } else {
                let id = req.search_result_id.as_deref().ok_or("missing-result-id")?;
                let result = entries.results.get(id).ok_or("search-result-expired")?;
                if result.actor != req.actor
                    || result.session_id != req.session_id
                    || result.root != root
                {
                    return Err("search-result-scope-denied".into());
                }
                Some(result.url.clone())
            }
        }
    };
    let token = nonce()?;
    let request_id = nonce()?;
    let prepared = TfWebPrepared {
        token: token.clone(),
        request_id: request_id.clone(),
        operation: req.operation,
        requires_approval: req.operation == TfWebOperation::WebSearch,
        workspace_root: root.to_string_lossy().into_owned(),
        isolation: ISOLATION,
    };
    entries.pending.insert(
        token,
        Pending {
            request_id,
            request: req,
            policy,
            root,
            target,
            expires: Instant::now() + TOKEN_TTL,
            approved: !prepared.requires_approval,
            browser_post: None,
            browser_credential: None,
        },
    );
    Ok(prepared)
}
pub fn prepare(
    req: TfWebRequest,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
) -> Result<TfWebPrepared, String> {
    if matches!(
        req.operation,
        TfWebOperation::BrowserBoundPost | TfWebOperation::BrowserOriginCredentialGet
    ) {
        return Err("native-browser-private-witness-required".into());
    }
    prepare_policy(req, registry, state, NetworkPolicy::Public)
}

/// TF3's existing one-use token owner, not a parallel HTTP client. This
/// preparer is private to the network modules and accepts only the native
/// envelope bound to an already-consumed TF4 FORM approval. It does not
/// approve, serialize, or discover form controls; the native caller must
/// capture and verify the ORIGINAL nodes/body before producing that envelope.
/// Until that native handoff is implemented, no production path invokes it.
#[allow(dead_code)]
pub(super) fn prepare_browser_bound_post(
    consumed_grant: super::tf_browser_runtime::NativeConsumedExactClickApproval,
    actor: &str,
    session_id: &str,
    workspace_root: &str,
    post: TfBrowserBoundPost,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
) -> Result<TfWebPrepared, String> {
    if !consumed_grant.matches_bound_form_post(actor, session_id, workspace_root, &post) {
        return Err("browser-bound-post-original-consumed-form-witness-required".into());
    }
    prepare_browser_bound_post_policy(
        actor,
        session_id,
        workspace_root,
        post,
        registry,
        state,
        NetworkPolicy::Public,
    )
}

fn prepare_browser_bound_post_policy(
    actor: &str,
    session_id: &str,
    workspace_root: &str,
    post: TfBrowserBoundPost,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    policy: NetworkPolicy,
) -> Result<TfWebPrepared, String> {
    let target = normalize_url_policy(post.destination.as_str(), policy)?;
    let valid_origin = if policy == NetworkPolicy::Public {
        browser_origin_allowed(&target, &post.approved_origin)
            && post.approved_origin.scheme() == "https"
            && post.approved_origin.port_or_known_default() == Some(443)
    } else {
        // Only code compiled for test/isolated acceptance can reach the
        // FixtureLoopback variant. No production Public request can use this.
        #[cfg(any(test, feature = "tf-browser-isolation-acceptance"))]
        {
            target.scheme() == "http"
                && target.host_str() == Some("127.0.0.1")
                && target.port().is_some()
                && target.origin() == post.approved_origin.origin()
        }
        #[cfg(not(any(test, feature = "tf-browser-isolation-acceptance")))]
        {
            false
        }
    };
    if target != post.destination
        || !valid_origin
        || post.destination.query().is_some()
        || post.destination.fragment().is_some()
        || post.body.is_empty()
        || post.body.len() > MAX_BODY
        || post.source_page_generation == 0
        || post.original_form_index == post.original_submitter_index
        || post.consumed_approval_id.len() != 48
        || !post
            .consumed_approval_id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        || post.body_sha256 != format!("{:x}", Sha256::digest(&post.body))
        || !matches!(
            post.content_type,
            "application/x-www-form-urlencoded" | "application/octet-stream"
        )
    {
        return Err("browser-bound-post-scope-denied".into());
    }
    let req = TfWebRequest {
        operation: TfWebOperation::BrowserBoundPost,
        actor: actor.to_owned(),
        session_id: session_id.to_owned(),
        workspace_root: workspace_root.to_owned(),
        url: Some(target.to_string()),
        query: None,
        search_result_id: None,
        timeout_ms: Some(5_000),
        max_bytes: Some(MAX_BODY),
        max_redirects: Some(0),
    };
    let prepared = prepare_policy(req, registry, state, policy)?;
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "network-state-unavailable")?;
    let pending = entries
        .pending
        .get_mut(&prepared.token)
        .ok_or("browser-post-preparation-lost")?;
    pending.browser_post = Some(post);
    Ok(prepared)
}

/// Only the native owner may execute its one prepared bound write, after the
/// original-node and body scope has been rechecked. HTTP 2xx remains Unknown,
/// NEVER_REPLAY, until an independent owned-server receipt proves the effect.
#[allow(dead_code)]
pub(super) async fn execute_browser_bound_post(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    approved_origin: &Url,
) -> Result<TfBrowserWriteTransport, String> {
    execute_browser_bound_post_policy(
        token,
        registry,
        state,
        approved_origin,
        NetworkPolicy::Public,
    )
    .await
}

/// Prepare one credentialed GET in the EXISTING TF3 Public-policy token/quota
/// owner. A moved original TF4 application-consent witness binds this
/// origin, source page generation, exact destination and opaque reference.
/// Neither a model nor the renderer can reach this private constructor.
#[allow(dead_code)]
pub(super) fn prepare_browser_origin_credential_get(
    consumed_grant: super::tf_browser::NativeCredentialConsent,
    req: TfBrowserOriginCredentialGet,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
) -> Result<TfWebPrepared, String> {
    let (actor, session, root) = consumed_grant.tf3_identity();
    let actor = actor.to_owned();
    let session = session.to_owned();
    let root = root.to_string_lossy().into_owned();
    if !consumed_grant.matches_credential(&req)
        || req.destination.scheme() != "https"
        || req.destination.origin() != req.approved_origin.origin()
        || req.destination.port().is_some()
        || req.destination.query().is_some()
        || req.destination.fragment().is_some()
        || !req.destination.username().is_empty()
        || req.destination.password().is_some()
        || req.source_page_generation == 0
        || req.consumed_approval_id.len() != 48
        || req.reference.len() != 48
        || ![&req.reference, &req.consumed_approval_id]
            .iter()
            .all(|value| {
                value
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
    {
        return Err("origin-credential-exact-consumed-scope-required".into());
    }
    let target = normalize_url_policy(req.destination.as_str(), NetworkPolicy::Public)?;
    if target != req.destination {
        return Err("origin-credential-destination-normalization-changed".into());
    }
    let prepared = prepare_policy(
        TfWebRequest {
            operation: TfWebOperation::BrowserOriginCredentialGet,
            actor,
            session_id: session,
            workspace_root: root,
            url: Some(target.to_string()),
            query: None,
            search_result_id: None,
            timeout_ms: Some(5_000),
            max_bytes: Some(4 * 1024),
            max_redirects: Some(0),
        },
        registry,
        state,
        NetworkPolicy::Public,
    )?;
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "network-state-unavailable")?;
    entries
        .pending
        .get_mut(&prepared.token)
        .ok_or("origin-credential-token-vanished")?
        .browser_credential = Some(req);
    Ok(prepared)
}

/// Credential material is obtained by the TRUSTED native parent from the
/// existing secret owner immediately before this single request. Only the
/// approved destination origin receives Authorization: Bearer. Never hand the
/// token to the browser renderer, model, screenshot or persisted receipt.
#[allow(dead_code)]
pub(super) async fn execute_browser_origin_credential_get(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    approved_origin: &Url,
    secret: String,
) -> Result<TfWebReceipt, String> {
    if secret.len() < 24
        || secret.len() > 2048
        || !secret
            .bytes()
            .all(|b| b.is_ascii_graphic() && b != b'"' && b != b'\\')
    {
        // Cancel the token on invalid/revoked key material; no retry.
        let _ = cancel(token, state);
        return Err("origin-credential-material-invalid-or-revoked".into());
    }
    let valid = {
        let entries = state
            .entries
            .lock()
            .map_err(|_| "network-state-unavailable")?;
        let p = entries
            .pending
            .get(token)
            .ok_or("unknown-or-consumed-token")?;
        p.browser_credential.as_ref().is_some_and(|c| {
            c.approved_origin == *approved_origin && p.target.as_ref() == Some(&c.destination)
        })
    };
    if !valid {
        let _ = cancel(token, state);
        return Err("origin-credential-execution-scope-changed".into());
    }
    execute_policy_with_output_scoped(
        token,
        registry,
        state,
        Some(secret),
        NetworkPolicy::Public,
        None,
        Some(approved_origin),
        None,
        false,
        true,
    )
    .await
}

async fn execute_browser_bound_post_policy(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    approved_origin: &Url,
    policy: NetworkPolicy,
) -> Result<TfBrowserWriteTransport, String> {
    let (body_sha256, body_len, destination_sha256) = {
        let entries = state
            .entries
            .lock()
            .map_err(|_| "network-state-unavailable")?;
        let pending = entries
            .pending
            .get(token)
            .ok_or("unknown-or-consumed-token")?;
        let post = pending
            .browser_post
            .as_ref()
            .ok_or("not-a-browser-bound-post")?;
        if &post.approved_origin != approved_origin {
            return Err("browser-bound-post-origin-changed".into());
        }
        (
            post.body_sha256.clone(),
            post.body.len(),
            format!("{:x}", Sha256::digest(post.destination.as_str().as_bytes())),
        )
    };
    // This consumes the same TF3 pending token even on a DNS/TLS/network
    // denial. Never allow the generic GET executor to reinterpret a POST.
    let receipt = execute_policy_with_output_scoped(
        token,
        registry,
        state,
        None,
        policy,
        None,
        Some(approved_origin),
        None,
        true,
        false,
    )
    .await?;
    Ok(TfBrowserWriteTransport {
        receipt,
        request_body_sha256: body_sha256,
        request_body_bytes: body_len,
        destination_sha256,
    })
}

/// Native acceptance fixture only: the caller must own the exact loopback
/// destination, session and workspace. This is neither a Tauri command nor a
/// permission to fetch arbitrary private destinations.
#[cfg(feature = "tf-browser-isolation-acceptance")]
pub fn prepare_browser_fixture(
    req: TfWebRequest,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    exact_listener_port: u16,
) -> Result<TfWebPrepared, String> {
    let raw = req.url.as_deref().ok_or("fixture-url-required")?;
    let url = Url::parse(raw).map_err(|_| "fixture-url-invalid")?;
    if req.operation != TfWebOperation::HttpGet
        || req.search_result_id.is_some()
        || req.query.is_some()
        || url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(exact_listener_port)
        || exact_listener_port == 0
    {
        return Err("fixture-exact-origin-denied".into());
    }
    prepare_policy(req, registry, state, NetworkPolicy::FixtureLoopback)
}
/// Headless acceptance helper only; never exported as a Tauri IPC.
pub fn approve_headless(token: &str, state: &TfWebState) -> Result<(), String> {
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "network-state-unavailable")?;
    reap(&mut entries);
    let p = entries
        .pending
        .get_mut(token)
        .ok_or("unknown-or-consumed-token")?;
    if p.request.operation != TfWebOperation::WebSearch || p.approved {
        return Err("approval-not-required-or-already-used".into());
    }
    p.approved = true;
    Ok(())
}
pub fn cancel(token: &str, state: &TfWebState) -> Result<bool, String> {
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "network-state-unavailable")?;
    if entries.pending.remove(token).is_some() {
        return Ok(true);
    }
    if let Some(sender) = entries.active.get(token) {
        sender.send_replace(true);
        return Ok(true);
    }
    Ok(false)
}
fn receipt_for(p: &Pending) -> TfWebReceipt {
    TfWebReceipt {
        tool_id: TOOL_ID,
        request_id: p.request_id.clone(),
        actor: p.request.actor.clone(),
        operation: p.request.operation,
        actual_method: if p.browser_post.is_some() {
            "POST"
        } else if p.request.operation == TfWebOperation::HttpHead {
            "HEAD"
        } else {
            "GET"
        },
        terminal: "denied",
        effect_state: "NoEffect",
        // Never echo raw URL fragments (which can contain bearer tokens).
        requested_url: p.target.as_ref().map(Url::to_string).or_else(|| {
            (p.request.operation == TfWebOperation::WebSearch).then(|| SEARCH_URL.to_owned())
        }),
        final_url: None,
        redirect_chain: Vec::new(),
        normalized_target: p.target.as_ref().map(Url::to_string),
        status_code: None,
        content_type: None,
        tls_state: "unknown",
        bytes_received: None,
        bytes_retained: 0,
        truncated: false,
        content_sha256: None,
        body: None,
        started_at: now_ms(),
        ended_at: now_ms(),
        credential_reference: if p.browser_credential.is_some() {
            Some("tf4_origin_opaque_keyring_reference")
        } else {
            (p.request.operation == TfWebOperation::WebSearch).then_some(CREDENTIAL_REF)
        },
        credential_used: false,
        retry: "not_attempted",
        auto_retry: false,
        policy_decision: "denied",
        reason_code: "not-executed",
        search_results: None,
        search_source: if p.request.operation == TfWebOperation::WebSearch {
            Some("brave_web_api_unverified_metadata")
        } else if p.request.search_result_id.is_some() {
            Some("brave_web_search_result_id_actor_session_scoped")
        } else {
            None
        },
        uncertainty: "no-network-effect-observed",
        isolation: ISOLATION,
        dns_evidence: Vec::new(),
    }
}
fn consume(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
) -> Result<(Pending, watch::Receiver<bool>), String> {
    consume_policy(token, registry, state, NetworkPolicy::Public)
}
fn consume_policy(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    expected_policy: NetworkPolicy,
) -> Result<(Pending, watch::Receiver<bool>), String> {
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "network-state-unavailable")?;
    reap(&mut entries);
    let p = entries
        .pending
        .remove(token)
        .ok_or("unknown-or-consumed-token")?;
    if p.policy != expected_policy {
        // A public-only token must never be reinterpreted as fixture-loopback
        // authorization (or the reverse), even by a native caller.
        return Err("network-policy-mismatch".into());
    }
    if p.expires <= Instant::now() {
        return Err("expired-token".into());
    }
    if !p.approved {
        return Err("native-approval-required".into());
    }
    let root = scope(&p.request, registry)?;
    if root != p.root {
        return Err("workspace-root-changed".into());
    }
    validate_policy(&p.request, p.policy)?;
    if let Some(ref raw) = p.request.url {
        if Some(normalize_url_policy(raw, p.policy)?) != p.target {
            return Err("network-target-changed".into());
        }
    }
    let (sender, rx) = watch::channel(false);
    entries.active.insert(token.to_owned(), sender);
    Ok((p, rx))
}
fn complete(token: &str, state: &TfWebState) {
    if let Ok(mut entries) = state.entries.lock() {
        entries.active.remove(token);
    }
}
pub fn provider_status_for_secret(secret: Result<Option<String>, String>) -> TfWebProviderStatus {
    let (configured, reason) = match secret {
        Ok(Some(s)) if !s.trim().is_empty() => (true, "ready"),
        Ok(_) => (false, "provider-unconfigured"),
        Err(_) => (false, "credential-store-unavailable"),
    };
    TfWebProviderStatus {
        provider: "brave_web",
        configured,
        available: configured,
        reason_code: reason,
        credential_reference: CREDENTIAL_REF,
        isolation: ISOLATION,
    }
}
fn native_secret(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<SecretsState>();
    read_secret(app, &state, SEARCH_SERVICE, SEARCH_ACCOUNT)
}
#[tauri::command]
pub async fn tf_web_provider_status(app: tauri::AppHandle) -> Result<TfWebProviderStatus, String> {
    tauri::async_runtime::spawn_blocking(move || provider_status_for_secret(native_secret(&app)))
        .await
        .map_err(|_| "provider-status-unavailable".to_owned())
}
#[tauri::command]
pub async fn tf_web_prepare(
    request: TfWebRequest,
    app: tauri::AppHandle,
) -> Result<TfWebPrepared, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if request.operation == TfWebOperation::WebSearch {
            let status = provider_status_for_secret(native_secret(&app));
            if !status.available {
                return Err(status.reason_code.to_owned());
            }
        }
        let registry = app.state::<WorkspaceRegistry>();
        let state = app.state::<TfWebState>();
        prepare(request, &registry, &state)
    })
    .await
    .map_err(|_| "network-prepare-unavailable".to_owned())?
}
#[tauri::command]
pub async fn tf_web_approve(token: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let snapshot = {
        let state = app.state::<TfWebState>();
        let mut entries = state
            .entries
            .lock()
            .map_err(|_| "network-state-unavailable")?;
        reap(&mut entries);
        let p = entries
            .pending
            .get(&token)
            .ok_or("unknown-or-consumed-token")?;
        if p.request.operation != TfWebOperation::WebSearch || p.approved {
            return Err("approval-not-required-or-already-used".into());
        }
        p.clone()
    };
    let summary = format!(
        "Native Brave Web Search approval (one use)\n\nRequest: {}\nActor: {}\nSession: {}\nWorkspace: {}\nSearch query: {}\n\nThe native Brave API credential is sent only to api.search.brave.com over HTTPS, never in redirects. This sends your query to Brave. No OS network sandbox or peer-IP attestation is available. Allow once?",
        snapshot.request_id, snapshot.request.actor, snapshot.request.session_id,
        snapshot.root.display(), snapshot.request.query.as_deref().unwrap_or(""));
    let dialog_app = app.clone();
    let consent = tokio::time::timeout(
        TOKEN_TTL,
        tauri::async_runtime::spawn_blocking(move || {
            dialog_app
                .dialog()
                .message(summary)
                .title("Clack Tool Fabric Web Search approval")
                .buttons(MessageDialogButtons::OkCancel)
                .blocking_show()
        }),
    )
    .await
    .map_err(|_| "approval-expired".to_owned())?
    .map_err(|_| "approval-dialog-unavailable".to_owned())?;
    if !consent {
        let state = app.state::<TfWebState>();
        let _ = cancel(&token, &state);
        return Err("native-approval-denied".into());
    }
    let registry = app.state::<WorkspaceRegistry>();
    let root = scope(&snapshot.request, &registry)?;
    let state = app.state::<TfWebState>();
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "network-state-unavailable")?;
    reap(&mut entries);
    let p = entries
        .pending
        .get_mut(&token)
        .ok_or("unknown-or-consumed-token")?;
    if root != snapshot.root
        || p.request_id != snapshot.request_id
        || p.request.actor != snapshot.request.actor
        || p.request.session_id != snapshot.request.session_id
        || p.root != snapshot.root
        || p.request.query != snapshot.request.query
        || p.request.operation != TfWebOperation::WebSearch
        || p.approved
    {
        return Err("native-approval-scope-changed".into());
    }
    p.approved = true;
    Ok(())
}
#[tauri::command]
pub fn tf_web_cancel(token: String, state: tauri::State<'_, TfWebState>) -> Result<bool, String> {
    cancel(&token, &state)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum NetworkPolicy {
    Public,
    /// Compiled only for local ephemeral fixture tests; never an IPC parameter.
    #[cfg(any(test, feature = "tf-browser-isolation-acceptance"))]
    FixtureLoopback,
}
fn allowed_ip(ip: IpAddr, policy: NetworkPolicy) -> bool {
    #[cfg(any(test, feature = "tf-browser-isolation-acceptance"))]
    if matches!(policy, NetworkPolicy::FixtureLoopback) {
        // The special acceptance path must never follow a fixture-controlled
        // redirect to a real public service, a different loopback spelling,
        // or any private/metadata address. It is not a generic public fetch.
        return ip == IpAddr::V4(std::net::Ipv4Addr::LOCALHOST);
    }
    let _ = policy;
    if ip_kind(ip) != IpKind::Public {
        return false;
    }
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            // Also block non-global, documentation, reserved, IETF and
            // IPv4-translator ranges not caught by legacy net::ip_kind.
            o[0] != 0
                && o[0] < 224
                && o[0] != 127
                && !(o[0] == 192 && o[1] == 0 && o[2] == 0)
                && !(o[0] == 192 && o[1] == 0 && o[2] == 2)
                && !(o[0] == 192 && o[1] == 88 && o[2] == 99)
                && !(o[0] == 198 && o[1] == 51 && o[2] == 100)
                && !(o[0] == 203 && o[1] == 0 && o[2] == 113)
                && !(o[0] == 192 && o[1] == 31 && o[2] == 196)
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            // Public IPv6 unicast 2000::/3 except transition, tunneling,
            // benchmarking and documentation allocations (defense in depth).
            (s[0] & 0xe000) == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && s[1] == 0)
                && !(s[0] == 0x2001 && s[1] == 0xdb8)
                && !(s[0] == 0x2001 && s[1] == 0x2)
        }
    }
}
#[derive(Clone, Copy, Debug)]
struct Failure(&'static str);
async fn bounded<T, F: Future<Output = T>>(
    future: F,
    deadline: tokio::time::Instant,
    cancel: &mut watch::Receiver<bool>,
) -> Result<T, Failure> {
    if *cancel.borrow() {
        return Err(Failure("cancelled"));
    }
    tokio::select! {
        biased;
        changed = cancel.changed() => {
            let _ = changed;
            Err(Failure("cancelled"))
        }
        output = tokio::time::timeout_at(deadline, future) => {
            output.map_err(|_| Failure("timeout"))
        }
    }
}
fn text_type(value: &str) -> bool {
    let kind = value.split(';').next().unwrap_or("").trim();
    kind.starts_with("text/")
        || matches!(
            kind,
            "application/json"
                | "application/xml"
                | "application/xhtml+xml"
                | "application/ld+json"
                | "application/rss+xml"
                | "application/atom+xml"
        )
        || kind.ends_with("+json")
        || kind.ends_with("+xml")
}
fn browser_resource_content_type(value: &str) -> bool {
    let kind = value.split(';').next().unwrap_or("").trim();
    text_type(value)
        || matches!(
            kind,
            "application/javascript"
                | "application/x-javascript"
                | "image/png"
                | "image/jpeg"
                | "image/gif"
                | "image/webp"
                | "image/avif"
                | "font/woff"
                | "font/woff2"
                | "application/font-woff"
                | "application/font-woff2"
                | "application/vnd.ms-fontobject"
                | "font/ttf"
                | "font/otf"
        )
}
fn browser_origin_allowed(request: &Url, approved: &Url) -> bool {
    request.scheme() == "https" && request.origin() == approved.origin()
}
fn safe_text(value: &str, cap: usize) -> String {
    value
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
        .take(cap)
        .collect()
}
fn parse_search(
    body: &str,
    p: &Pending,
    state: &TfWebState,
) -> Result<Vec<TfWebSearchResult>, Failure> {
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|_| Failure("search-invalid-json"))?;
    let values = parsed
        .get("web")
        .and_then(|w| w.get("results"))
        .and_then(serde_json::Value::as_array)
        .ok_or(Failure("search-invalid-schema"))?;
    let mut results = Vec::new();
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| Failure("network-state-unavailable"))?;
    reap(&mut entries);
    if entries.results.len() > 256 {
        entries.results.clear();
    }
    for value in values.iter().take(20) {
        if results.len() >= 10 {
            break;
        }
        let (Some(raw_url), Some(title)) = (
            value.get("url").and_then(serde_json::Value::as_str),
            value.get("title").and_then(serde_json::Value::as_str),
        ) else {
            continue;
        };
        let Ok(url) = normalize_url(raw_url) else {
            continue;
        };
        // URLs in search metadata are never DNS-trusted; literals receive
        // the cheap immediate classification, DNS is repeated at fetch time.
        if let Ok(ip) = url
            .host_str()
            .unwrap_or("")
            .trim_matches(&['[', ']'][..])
            .parse::<IpAddr>()
        {
            if !allowed_ip(ip, NetworkPolicy::Public) {
                continue;
            }
        }
        let id = nonce().map_err(|_| Failure("native-random-unavailable"))?;
        let snippet = value
            .get("description")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let rank = results.len() + 1;
        results.push(TfWebSearchResult {
            id: id.clone(),
            title: safe_text(title, 256),
            url: url.to_string(),
            snippet: safe_text(snippet, 1024),
            provider: "brave_web",
            rank,
            observed_at: now_ms(),
        });
        entries.results.insert(
            id,
            IndexedResult {
                actor: p.request.actor.clone(),
                session_id: p.request.session_id.clone(),
                root: p.root.clone(),
                url,
                expires: Instant::now() + RESULT_TTL,
            },
        );
    }
    Ok(results)
}
async fn network_fetch(
    p: &Pending,
    receipt: &mut TfWebReceipt,
    cancel: &mut watch::Receiver<bool>,
    credential: Option<&str>,
    state: &TfWebState,
    policy: NetworkPolicy,
    attempted: &mut bool,
    mut browser_bytes: Option<&mut Vec<u8>>,
    browser_approved_origin: Option<&Url>,
    tls_test_root: Option<&reqwest::Certificate>,
) -> Result<(), Failure> {
    let search = p.request.operation == TfWebOperation::WebSearch;
    // Only an exact consumed native origin-credential scope or the fixed
    // Brave provider can receive authentication. Ordinary public/browser
    // requests cannot smuggle raw Authorization headers or secret material.
    let browser_credential = p.browser_credential.as_ref();
    if !search && browser_credential.is_none() && credential.is_some() {
        return Err(Failure("credential-operation-denied"));
    }
    if let Some(c) = browser_credential {
        // The source-only isolated loopback fixture necessarily has a random
        // ephemeral HTTP port. Production Public always rejects explicit
        // origin ports and cleartext credential transmission.
        #[cfg(any(test, feature = "tf-browser-isolation-acceptance"))]
        let owned_test_port = policy == NetworkPolicy::FixtureLoopback
            && c.destination.scheme() == "http"
            && c.destination.host_str() == Some("127.0.0.1")
            && c.destination.origin() == c.approved_origin.origin();
        #[cfg(not(any(test, feature = "tf-browser-isolation-acceptance")))]
        let owned_test_port = false;
        if credential.is_none_or(str::is_empty)
            || p.request.operation != TfWebOperation::BrowserOriginCredentialGet
            || browser_approved_origin != Some(&c.approved_origin)
            || p.target.as_ref() != Some(&c.destination)
            || c.destination.origin() != c.approved_origin.origin()
            || !c.destination.username().is_empty()
            || c.destination.password().is_some()
            || c.destination.query().is_some()
            || c.destination.fragment().is_some()
            || (c.destination.port().is_some() && !owned_test_port)
        {
            return Err(Failure("origin-credential-execution-scope-denied"));
        }
    }
    let mut url = if search {
        if credential.is_none_or(str::is_empty) {
            return Err(Failure("provider-unconfigured"));
        }
        let mut u = Url::parse(SEARCH_URL).map_err(|_| Failure("provider-url-invalid"))?;
        u.query_pairs_mut()
            .append_pair("q", p.request.query.as_deref().unwrap_or(""))
            .append_pair("count", "10");
        u
    } else {
        p.target.clone().ok_or(Failure("missing-target"))?
    };
    if receipt.requested_url.is_none() {
        receipt.requested_url = Some(url.to_string());
    }
    receipt.normalized_target = Some(url.to_string());
    // A browser-controlled GET is NOT proof of a side-effect-free remote
    // operation: a guest may request a GET endpoint that changes server state.
    // Never offer the browser owner a "SAFE_RETRY" receipt after that attempt,
    // even when HTTP returned 2xx or the native COM deferral completed.
    // Ordinary TF3 standalone GET/HEAD retain their existing contract.
    let browser_resource =
        browser_bytes.is_some() || p.browser_post.is_some() || browser_credential.is_some();
    if let Some(post) = &p.browser_post {
        if credential.is_some()
            || browser_approved_origin != Some(&post.approved_origin)
            || p.target.as_ref() != Some(&post.destination)
            || post.body_sha256 != format!("{:x}", Sha256::digest(&post.body))
        {
            return Err(Failure("browser-bound-post-execution-scope-denied"));
        }
    }
    receipt.retry = if browser_resource {
        "NEVER_REPLAY"
    } else if search {
        "CONDITIONAL_RETRY"
    } else {
        "SAFE_RETRY"
    };
    let deadline = tokio::time::Instant::now()
        + Duration::from_millis(p.request.timeout_ms.unwrap_or(MAX_TIMEOUT));
    let max_hops = if search || browser_credential.is_some() {
        0
    } else {
        p.request.max_redirects.unwrap_or(MAX_REDIRECTS)
    };
    let max_bytes = p.request.max_bytes.unwrap_or(MAX_BODY);
    let mut hops = 0u8;
    loop {
        let url_checked =
            normalize_url_policy(url.as_str(), policy).map_err(|_| Failure("url-policy-denied"))?;
        // Native TF4 may approve exactly one HTTPS origin. Check *every* hop
        // before resolving DNS or creating a socket, including a redirect's
        // next destination. TF3 remains the sole DNS/IP/SSRF/TLS authority.
        let origin_allowed = browser_approved_origin.is_none_or(|approved| {
            browser_origin_allowed(&url_checked, approved) || {
                #[cfg(any(test, feature = "tf-browser-isolation-acceptance"))]
                {
                    policy == NetworkPolicy::FixtureLoopback
                        && url_checked.scheme() == "http"
                        && url_checked.host_str() == Some("127.0.0.1")
                        && url_checked.origin() == approved.origin()
                }
                #[cfg(not(any(test, feature = "tf-browser-isolation-acceptance")))]
                {
                    false
                }
            }
        });
        if !origin_allowed {
            return Err(Failure("browser-redirect-origin-denied"));
        }
        #[cfg(any(test, feature = "tf-browser-isolation-acceptance"))]
        if matches!(policy, NetworkPolicy::FixtureLoopback) {
            // The acceptance-only policy is a single *exact* origin, not a
            // general permission to access every process on 127.0.0.1. A
            // redirect may change the path, but never scheme, host or port.
            let original = p.target.as_ref().ok_or(Failure("missing-target"))?;
            if url_checked.scheme() != original.scheme()
                || url_checked.host_str() != original.host_str()
                || url_checked.port_or_known_default() != original.port_or_known_default()
            {
                return Err(Failure("fixture-redirect-origin-denied"));
            }
        }
        let host = url_checked
            .host_str()
            .ok_or(Failure("missing-host"))?
            .to_owned();
        let lookup_host = host.trim_matches(&['[', ']'][..]);
        // The only credentialed request is the fixed HTTPS Brave endpoint.
        // Any redirect response is refused without sending a second request.
        if search
            && (url_checked.scheme() != "https"
                || url_checked.host_str() != Some("api.search.brave.com")
                || url_checked.path() != "/res/v1/web/search"
                || url_checked.port().is_some())
        {
            return Err(Failure("provider-origin-denied"));
        }
        let (_, ips) = bounded(resolve_and_classify(lookup_host), deadline, cancel)
            .await?
            .map_err(|_| Failure("dns-lookup-failed"))?;
        let observed = now_ms();
        let all_safe = !ips.is_empty() && ips.iter().all(|ip| allowed_ip(*ip, policy));
        receipt.dns_evidence.push(TfWebDnsEvidence {
            host: host.clone(),
            resolved_at: observed,
            addresses: ips.iter().map(ToString::to_string).collect(),
            classification: if all_safe {
                "all-allowed"
            } else {
                "contains-denied-address"
            },
            pinning: if all_safe {
                "reqwest-resolve-to-addrs"
            } else {
                "not-connected"
            },
            socket_ip_observed: false,
        });
        if !all_safe {
            return Err(Failure("dns-private-or-reserved-denied"));
        }
        let addresses: Vec<SocketAddr> = ips.into_iter().map(|ip| SocketAddr::new(ip, 0)).collect();
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(Failure("timeout"));
        }
        let builder = super::custom_tool_transport()
            .connect_timeout(remaining.min(Duration::from_secs(5)))
            .timeout(remaining)
            .resolve_to_addrs(&host, &addresses)
            .user_agent("Clack-TF-Web/1.0");
        // Only the explicit in-process owned-loopback HTTPS test helper can
        // pass a temporary trust anchor. Ordinary production HTTP/TLS never
        // inherits this certificate and TLS verification remains enabled.
        #[cfg(not(test))]
        if tls_test_root.is_some() {
            return Err(Failure("test-certificate-not-available-in-production"));
        }
        #[cfg(test)]
        let builder = if let Some(root) = tls_test_root {
            builder.add_root_certificate(root.clone())
        } else {
            builder
        };
        let client = builder.build().map_err(|_| Failure("client-unavailable"))?;
        let method = if p.browser_post.is_some() {
            Method::POST
        } else if p.request.operation == TfWebOperation::HttpHead {
            Method::HEAD
        } else {
            Method::GET
        };
        let mut request = client
            .request(method, url_checked.clone())
            .header(USER_AGENT, "Clack-TF-Web/1.0")
            .header(ACCEPT_ENCODING, "identity")
            .header(
                ACCEPT,
                if browser_bytes.is_some() {
                    "text/html,text/css,application/javascript,image/png,image/jpeg,image/webp,font/woff2,*/*"
                } else {
                    "text/html,text/plain,application/json,application/xhtml+xml,application/xml"
                },
            );
        if let Some(post) = &p.browser_post {
            request = request
                .header(CONTENT_TYPE, post.content_type)
                .body(post.body.clone());
        }
        if search {
            let key = credential.ok_or(Failure("provider-unconfigured"))?;
            let value = reqwest::header::HeaderValue::from_str(key)
                .map_err(|_| Failure("invalid-native-credential"))?;
            request = request.header("x-subscription-token", value);
            receipt.credential_used = true;
        }
        if browser_credential.is_some() {
            let secret = credential.ok_or(Failure("origin-credential-revoked"))?;
            let header = reqwest::header::HeaderValue::from_str(&format!("Bearer {secret}"))
                .map_err(|_| Failure("origin-credential-header-denied"))?;
            request = request.header(reqwest::header::AUTHORIZATION, header);
            receipt.credential_used = true;
        }
        // Distinguish a network attempt from proof of remote delivery.
        receipt.uncertainty = "socket-peer-ip-not-observed";
        *attempted = true;
        if browser_resource {
            // A transport acknowledgment is never an independently observed
            // application effect; only a separate owned-server oracle can
            // reconcile effectful browser requests.
            receipt.effect_state = "Unknown";
        }
        if search {
            // Provider quota/billing effects are not observable from a
            // successful HTTP response or successful result JSON parsing.
            receipt.effect_state = "Unknown";
        }
        let mut response = bounded(request.send(), deadline, cancel)
            .await?
            .map_err(|e| {
                #[cfg(feature = "tf-browser-isolation-acceptance")]
                if policy == NetworkPolicy::FixtureLoopback {
                    // This diagnostic applies only to the fixed, controlled
                    // loopback fixture. No general URLs or credentials logged.
                    // Preserve a bounded underlying transport cause so that
                    // an accepted TCP connection without completed HTTP can
                    // be distinguished from a harness parser failure in a
                    // *new immutable case*, rather than guessed from XDArr0.
                    use std::error::Error as _;
                    let mut causes = Vec::new();
                    let mut nested = e.source();
                    for _ in 0..3 {
                        let Some(cause) = nested else { break };
                        causes.push(cause.to_string());
                        nested = cause.source();
                    }
                    eprintln!(
                        "tf3-browser-fixture-transport: connect={} request={} body={} timeout={} cause={}",
                        e.is_connect(),
                        e.is_request(),
                        e.is_body(),
                        e.is_timeout(),
                        safe_text(&causes.join(" | "), 256)
                    );
                }
                if e.is_timeout() {
                    Failure("timeout")
                } else {
                    #[cfg(feature = "tf-browser-isolation-acceptance")]
                    if matches!(policy, NetworkPolicy::FixtureLoopback) {
                        // Preserve a bounded, credential-free failure class
                        // in the *native* receipt for reproducible controlled
                        // acceptance diagnostics. Public TF3 reason codes
                        // remain unchanged.
                        return if e.is_connect() {
                            Failure("fixture-network-connect-failed")
                        } else if e.is_request() {
                            Failure("fixture-network-request-failed")
                        } else if e.is_body() {
                            Failure("fixture-network-body-failed")
                        } else {
                            Failure("fixture-network-other-failed")
                        };
                    }
                    Failure("network-failed")
                }
            })?;
        receipt.status_code = Some(response.status().as_u16());
        receipt.final_url = Some(url_checked.to_string());
        receipt.tls_state = if url_checked.scheme() == "https" {
            "https_transport_observed"
        } else {
            "cleartext_http"
        };
        let headers = response.headers();
        let header_size: usize = headers
            .iter()
            .map(|(k, v)| k.as_str().len().saturating_add(v.as_bytes().len()) + 4)
            .sum();
        if headers.len() > 64 || header_size > MAX_HEADERS {
            return Err(Failure("response-headers-exceeded"));
        }
        if headers
            .get(reqwest::header::CONTENT_ENCODING)
            .is_some_and(|v| v.as_bytes() != b"identity")
        {
            return Err(Failure("compressed-response-denied"));
        }
        let kind = headers
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        receipt.content_type = (!kind.is_empty()).then_some(kind.clone());
        if response.status().is_redirection() && response.status().as_u16() != 304 {
            // WebView2 is awaiting the response for its ORIGINAL intercepted
            // URI. No redirect, even to the same approved HTTPS origin, grants
            // a second browser GET: that URL could mutate server state or
            // substitute bytes under the first resource's identity.
            if browser_resource {
                return Err(Failure("browser-resource-redirect-denied"));
            }
            if search {
                return Err(Failure("provider-redirect-denied"));
            }
            if hops >= max_hops {
                return Err(Failure("redirect-limit-denied"));
            }
            let raw_location = headers
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or(Failure("redirect-location-missing"))?;
            let next = url_checked
                .join(raw_location)
                .map_err(|_| Failure("redirect-target-invalid"))?;
            let next = normalize_url_policy(next.as_str(), policy)
                .map_err(|_| Failure("redirect-target-denied"))?;
            if url_checked.scheme() == "https" && next.scheme() != "https" {
                return Err(Failure("redirect-https-downgrade-denied"));
            }
            receipt.redirect_chain.push(url_checked.to_string());
            url = next;
            hops += 1;
            // Connection is released before each redirect DNS revalidation.
            continue;
        }
        if search && !response.status().is_success() {
            return Err(Failure("provider-http-non-success"));
        }
        receipt.policy_decision = "allowed";
        if p.request.operation == TfWebOperation::HttpHead
            || response.status() == 204
            || response.status() == 304
        {
            receipt.bytes_received = Some(0);
            receipt.content_sha256 = Some(format!("{:x}", Sha256::digest(b"")));
            receipt.body = Some(String::new());
            receipt.reason_code = "ok";
            receipt.terminal = "completed";
            receipt.uncertainty = "http-status-observed-peer-ip-not-attested";
            return Ok(());
        }
        if browser_bytes.is_some() && !browser_resource_content_type(&kind) {
            return Err(Failure("browser-content-type-denied"));
        }
        if browser_bytes.is_none()
            && p.browser_post.is_none()
            && browser_credential.is_none()
            && !text_type(&kind)
        {
            return Err(Failure("nontext-content-type-denied"));
        }
        let mut bytes = Vec::new();
        receipt.bytes_received = Some(0);
        loop {
            let chunk = bounded(response.chunk(), deadline, cancel)
                .await?
                .map_err(|e| {
                    if e.is_timeout() {
                        Failure("timeout")
                    } else {
                        Failure("network-body-failed")
                    }
                })?;
            let Some(chunk) = chunk else { break };
            receipt.bytes_received = Some(
                receipt
                    .bytes_received
                    .unwrap_or(0)
                    .saturating_add(chunk.len() as u64),
            );
            let remaining = max_bytes.saturating_sub(bytes.len());
            bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            if chunk.len() > remaining {
                receipt.truncated = true;
                break;
            }
            // Probe for a next byte when exactly at cap. EOF means not truncated.
        }
        if let Some(output) = browser_bytes.as_deref_mut() {
            // A truncated JS/image/font/document is unsafe to represent as a
            // successful resource. The response fails rather than returning
            // a misleading partial body or allowing a WebView2 fallback.
            if receipt.truncated {
                return Err(Failure("browser-response-limit-exceeded"));
            }
            output.extend_from_slice(&bytes);
            receipt.bytes_retained = bytes.len();
            receipt.content_sha256 = Some(format!("{:x}", Sha256::digest(&bytes)));
            receipt.body = None;
            receipt.reason_code = if (200..300).contains(&response.status().as_u16()) {
                "ok"
            } else {
                "http-status-non-success"
            };
            receipt.terminal = "completed";
            receipt.uncertainty = "http-response-observed-peer-ip-not-attested";
            return Ok(());
        }
        let valid = match std::str::from_utf8(&bytes) {
            Ok(_) => bytes.len(),
            Err(e) if receipt.truncated && e.error_len().is_none() => {
                receipt.truncated = true;
                e.valid_up_to()
            }
            Err(_) => return Err(Failure("nonutf8-body-denied")),
        };
        bytes.truncate(valid);
        let original = std::str::from_utf8(&bytes).map_err(|_| Failure("nonutf8-body-denied"))?;
        let filtered = safe_text(original, MAX_BODY);
        let saved = filtered.into_bytes();
        receipt.bytes_retained = saved.len();
        receipt.content_sha256 = Some(format!("{:x}", Sha256::digest(&saved)));
        if search {
            if receipt.truncated {
                return Err(Failure("search-response-truncated"));
            }
            let body = std::str::from_utf8(&saved).map_err(|_| Failure("search-invalid-json"))?;
            receipt.search_results = Some(parse_search(body, p, state)?);
            receipt.body = None;
        } else if p.browser_post.is_some() || browser_credential.is_some() {
            // Never persist a remote response body into the browser action
            // receipt. Server HTTP success is NOT a business effect proof.
            receipt.body = None;
        } else {
            receipt.body =
                Some(String::from_utf8(saved).map_err(|_| Failure("nonutf8-body-denied"))?);
        }
        receipt.reason_code = if (200..300).contains(&response.status().as_u16()) {
            "ok"
        } else {
            "http-status-non-success"
        };
        receipt.terminal = "completed";
        receipt.uncertainty = "http-response-observed-peer-ip-not-attested";
        return Ok(());
    }
}
async fn execute_policy_with_output_scoped(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    credential: Option<String>,
    policy: NetworkPolicy,
    browser_bytes: Option<&mut Vec<u8>>,
    browser_approved_origin: Option<&Url>,
    tls_test_root: Option<&reqwest::Certificate>,
    expected_browser_post: bool,
    expected_browser_credential: bool,
) -> Result<TfWebReceipt, String> {
    let (p, mut rx) = consume_policy(token, registry, state, policy)?;
    if p.browser_post.is_some() != expected_browser_post
        || p.browser_credential.is_some() != expected_browser_credential
    {
        complete(token, state);
        return Err("tf3-bound-post-executor-mismatch".into());
    }
    let mut receipt = receipt_for(&p);
    let mut attempted = false;
    let browser_resource =
        browser_bytes.is_some() || p.browser_post.is_some() || p.browser_credential.is_some();
    let result = network_fetch(
        &p,
        &mut receipt,
        &mut rx,
        credential.as_deref(),
        state,
        policy,
        &mut attempted,
        browser_bytes,
        browser_approved_origin,
        tls_test_root,
    )
    .await;
    if let Err(Failure(reason)) = result {
        receipt.reason_code = reason;
        receipt.terminal = if reason == "cancelled" {
            "cancelled"
        } else if reason == "timeout" {
            "timed_out"
        } else {
            "denied"
        };
        if attempted {
            receipt.retry = if browser_resource {
                "NEVER_REPLAY"
            } else {
                "UNKNOWN"
            };
            receipt.uncertainty = "request-may-have-reached-remote-peer";
        } else if browser_resource {
            receipt.retry = "NEVER_REPLAY";
        } else {
            receipt.retry = if p.request.operation == TfWebOperation::WebSearch {
                "CONDITIONAL_RETRY"
            } else {
                "SAFE_RETRY"
            };
        }
    }
    receipt.ended_at = now_ms();
    complete(token, state);
    Ok(receipt)
}
async fn execute_policy_with_output(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    credential: Option<String>,
    policy: NetworkPolicy,
    browser_bytes: Option<&mut Vec<u8>>,
) -> Result<TfWebReceipt, String> {
    execute_policy_with_output_scoped(
        token,
        registry,
        state,
        credential,
        policy,
        browser_bytes,
        None,
        None,
        false,
        false,
    )
    .await
}
async fn execute_policy(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    credential: Option<String>,
    policy: NetworkPolicy,
) -> Result<TfWebReceipt, String> {
    execute_policy_with_output(token, registry, state, credential, policy, None).await
}

/// Bounded binary GET through the existing public-only TF3 policy. Request
/// preparation and authorization are owned by the same TF3 state as text GET.
pub async fn execute_browser_resource(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
) -> Result<TfBrowserResource, String> {
    let mut bytes = Vec::new();
    let receipt = execute_policy_with_output(
        token,
        registry,
        state,
        None,
        NetworkPolicy::Public,
        Some(&mut bytes),
    )
    .await?;
    Ok(TfBrowserResource { receipt, bytes })
}

/// Real confined browser resource, bound to the trusted parent-approved HTTPS
/// origin at *each redirect hop*. No child-provided approval is accepted.
/// Other TF3 callers retain their pre-existing policy and redirect behavior.
pub async fn execute_browser_resource_same_origin(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    approved_origin: &Url,
) -> Result<TfBrowserResource, String> {
    if approved_origin.scheme() != "https"
        || approved_origin.host_str().is_none()
        || !approved_origin.username().is_empty()
        || approved_origin.password().is_some()
        || approved_origin.port_or_known_default() != Some(443)
    {
        return Err("browser-approved-https-origin-invalid".into());
    }
    let mut bytes = Vec::new();
    let receipt = execute_policy_with_output_scoped(
        token,
        registry,
        state,
        None,
        NetworkPolicy::Public,
        Some(&mut bytes),
        Some(approved_origin),
        None,
        false,
        false,
    )
    .await?;
    Ok(TfBrowserResource { receipt, bytes })
}

/// Local owned HTTPS acceptance only. Not compiled into a production binary,
/// and not callable through IPC, model tools, or the public TF3 prepare path.
/// Exact 127.0.0.1:443, strict TLS using a caller-created ephemeral *public*
/// certificate, the same TF3 fetch/redirect/COM transport, and same-origin
/// restrictions on every hop. No insecure TLS switch or global trust change.
#[cfg(test)]
pub(crate) fn prepare_owned_https_for_test(
    req: TfWebRequest,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
) -> Result<TfWebPrepared, String> {
    let url = req.url.as_deref().ok_or("owned-https-url-required")?;
    let parsed = Url::parse(url).map_err(|_| "owned-https-url-invalid")?;
    if req.operation != TfWebOperation::HttpGet
        || req.search_result_id.is_some()
        || req.query.is_some()
        || parsed.scheme() != "https"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.port_or_known_default() != Some(443)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err("owned-https-exact-loopback-only".into());
    }
    prepare_policy(req, registry, state, NetworkPolicy::FixtureLoopback)
}

#[cfg(test)]
pub(crate) async fn execute_owned_https_for_test(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    approved_origin: &Url,
    ephemeral_public_certificate: &reqwest::Certificate,
) -> Result<TfBrowserResource, String> {
    if approved_origin.scheme() != "https"
        || approved_origin.host_str() != Some("127.0.0.1")
        || approved_origin.port_or_known_default() != Some(443)
    {
        return Err("owned-https-approved-origin-denied".into());
    }
    let mut bytes = Vec::new();
    let receipt = execute_policy_with_output_scoped(
        token,
        registry,
        state,
        None,
        NetworkPolicy::FixtureLoopback,
        Some(&mut bytes),
        Some(approved_origin),
        Some(ephemeral_public_certificate),
        false,
        false,
    )
    .await?;
    Ok(TfBrowserResource { receipt, bytes })
}

/// Acceptance-only private loopback fixture mode. This stays behind the
/// non-default native browser isolation feature and retains TF3 executor,
/// credentials-none, redirects, policy, quota, deadline and receipt behavior.
#[cfg(feature = "tf-browser-isolation-acceptance")]
pub async fn execute_browser_fixture(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
) -> Result<TfBrowserResource, String> {
    let mut bytes = Vec::new();
    let receipt = execute_policy_with_output(
        token,
        registry,
        state,
        None,
        NetworkPolicy::FixtureLoopback,
        Some(&mut bytes),
    )
    .await?;
    Ok(TfBrowserResource { receipt, bytes })
}
/// Public headless native acceptance entry; fixture-network opt-in never exposed.
pub async fn execute(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfWebState,
    credential: Option<String>,
) -> Result<TfWebReceipt, String> {
    execute_policy(token, registry, state, credential, NetworkPolicy::Public).await
}
#[tauri::command]
pub async fn tf_web_execute(token: String, app: tauri::AppHandle) -> Result<TfWebReceipt, String> {
    // Keyring may block; fetch only the fixed scoped provider key, never expose it
    // in request or receipt and never let the model select the credential.
    let needs_credential = {
        let state = app.state::<TfWebState>();
        let entries = state
            .entries
            .lock()
            .map_err(|_| "network-state-unavailable")?;
        entries
            .pending
            .get(&token)
            .is_some_and(|p| p.request.operation == TfWebOperation::WebSearch)
    };
    let credential = if needs_credential {
        let clone = app.clone();
        tauri::async_runtime::spawn_blocking(move || native_secret(&clone))
            .await
            .map_err(|_| "credential-store-unavailable".to_owned())?
            .map_err(|_| "credential-store-unavailable".to_owned())?
    } else {
        None
    };
    let registry = app.state::<WorkspaceRegistry>();
    let state = app.state::<TfWebState>();
    execute(&token, &registry, &state, credential).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn confined_browser_redirects_are_limited_to_exact_https_origin() {
        let approved = Url::parse("https://example.com/task").unwrap();
        for target in [
            "https://example.com/",
            "https://example.com/next?nonsecret=1",
            "https://example.com:443/a",
        ] {
            assert!(browser_origin_allowed(
                &Url::parse(target).unwrap(),
                &approved
            ));
        }
        for target in [
            "http://example.com/",
            "https://www.example.com/",
            "https://example.org/",
            "https://example.com:444/",
            "https://127.0.0.1/",
            "https://169.254.169.254/",
        ] {
            assert!(!browser_origin_allowed(
                &Url::parse(target).unwrap(),
                &approved
            ));
        }
    }

    #[tokio::test]
    async fn confined_browser_origin_denial_happens_before_dns_or_socket() {
        let (dir, registry, state) = setup();
        let prepared = prepare(
            fixture(dir.path(), "https://example.org/outside".into()),
            &registry,
            &state,
        )
        .unwrap();
        let approved = Url::parse("https://example.com/").unwrap();
        let result =
            execute_browser_resource_same_origin(&prepared.token, &registry, &state, &approved)
                .await
                .unwrap();
        assert_eq!(result.receipt.terminal, "denied");
        assert_eq!(result.receipt.reason_code, "browser-redirect-origin-denied");
        assert!(result.receipt.dns_evidence.is_empty());
        assert!(result.receipt.final_url.is_none());
        assert!(result.bytes.is_empty());
    }

    #[test]
    fn owned_https_test_preflight_does_not_grant_other_private_or_public_hosts() {
        let (dir, registry, state) = setup();
        for target in [
            "http://127.0.0.1/",
            "https://[::1]/",
            "https://192.168.1.1/",
            "https://169.254.169.254/",
            "https://example.com/",
            "https://127.0.0.1:444/",
            "https://127.0.0.1/?token=test",
        ] {
            assert!(
                prepare_owned_https_for_test(
                    fixture(dir.path(), target.into()),
                    &registry,
                    &state,
                )
                .is_err(),
                "non-owned test origin was accepted: {target}"
            );
        }
        let accepted = prepare_owned_https_for_test(
            fixture(dir.path(), "https://127.0.0.1/page.css".into()),
            &registry,
            &state,
        )
        .expect("only exact owned HTTPS origin allowed");
        assert!(
            consume_policy(&accepted.token, &registry, &state, NetworkPolicy::Public).is_err(),
            "test-only token must not be accepted under public TF3 policy"
        );
    }

    fn setup() -> (tempfile::TempDir, WorkspaceRegistry, TfWebState) {
        let dir = tempfile::tempdir().unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(dir.path()).unwrap();
        (dir, registry, TfWebState::default())
    }
    fn request(root: &std::path::Path, op: TfWebOperation) -> TfWebRequest {
        TfWebRequest {
            operation: op,
            actor: "native-test".into(),
            session_id: "session-1".into(),
            workspace_root: root.to_string_lossy().into_owned(),
            url: None,
            query: None,
            search_result_id: None,
            timeout_ms: None,
            max_bytes: None,
            max_redirects: None,
        }
    }
    fn fixture(root: &std::path::Path, url: String) -> TfWebRequest {
        let mut req = request(root, TfWebOperation::HttpGet);
        req.url = Some(url);
        req
    }
    fn serve(response: &'static [u8], delay: Duration) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://127.0.0.1:{}/fixture",
            listener.local_addr().unwrap().port()
        );
        listener.set_nonblocking(true).unwrap();
        let handle = thread::spawn(move || {
            let start = Instant::now();
            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
                        let mut buf = [0u8; 2048];
                        let _ = stream.read(&mut buf);
                        thread::sleep(delay);
                        let _ = stream.write_all(response);
                        let _ = stream.flush();
                        return;
                    }
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            && start.elapsed() < Duration::from_secs(2) =>
                    {
                        thread::sleep(Duration::from_millis(5))
                    }
                    _ => return,
                }
            }
        });
        (url, handle)
    }
    #[test]
    fn normalization_rejects_userinfo_schemes_secret_queries_and_local_names() {
        for raw in [
            "file:///etc/passwd",
            "ftp://example.com/a",
            "https://x:y@example.org/",
            "https://metadata.google.internal/path",
            "http://localhost/",
            "https://router.local",
            "https://example.org/?access_token=secret",
            "https://example.org/?X-Api-Key=secret",
            "https://example.org/?auth=secret",
            "https://example.org/?session_id=secret",
            " https://example.org/ ",
        ] {
            assert!(
                normalize_url(raw).is_err(),
                "unexpected accepted URL: {raw:?}"
            );
        }
        let norm = normalize_url("HTTPS://EXAMPLE.ORG:443/path?q=ok#ignore").unwrap();
        assert_eq!(norm.as_str(), "https://example.org/path?q=ok");
        assert_eq!(
            normalize_url("https://bücher.example/").unwrap().host_str(),
            Some("xn--bcher-kva.example")
        );
    }
    #[test]
    fn public_policy_blocks_private_mapped_transition_and_reserved_ips() {
        for raw in [
            "127.0.0.1",
            "10.1.2.3",
            "192.168.10.3",
            "169.254.169.254",
            "0.1.2.3",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "255.255.255.255",
            "::1",
            "fe80::1",
            "fd00:ec2::254",
            "::ffff:127.0.0.1",
            "::ffff:8.8.8.8",
            "2002:0808:0808::1",
            "2001:db8::1",
            "2001:0000::1",
        ] {
            assert!(
                !allowed_ip(raw.parse().unwrap(), NetworkPolicy::Public),
                "{raw}"
            );
        }
        for raw in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(
                allowed_ip(raw.parse().unwrap(), NetworkPolicy::Public),
                "{raw}"
            );
        }
        for alternate in [
            "http://2130706433/",
            "http://0x7f000001/",
            "http://0177.0.0.1/",
        ] {
            let u = normalize_url(alternate).unwrap();
            let ip: IpAddr = u.host_str().unwrap().parse().unwrap();
            assert!(!allowed_ip(ip, NetworkPolicy::Public), "{alternate}");
        }
    }
    #[test]
    fn browser_policy_denies_hidden_network_aliases_and_foreign_fixture_redirect_targets() {
        let blocked = [
            "127.0.0.1",
            "127.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "::1",
            "::ffff:127.0.0.1",
            "fe80::1",
            "fd00::1",
        ];
        for ip in blocked {
            if let Ok(parsed) = ip.parse::<IpAddr>() {
                assert!(!allowed_ip(parsed, NetworkPolicy::Public), "{ip}");
            }
        }
        for raw in [
            "http://localhost/",
            "http://localhost.localdomain/",
            "http://127.0.0.1.evil.local/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
            "ftp://example.org/",
            "ws://example.org/",
            "wss://example.org/",
            "file:///C:/secrets",
            "http://127.0.0.1/?access_token=sentinel",
        ] {
            let result = normalize_url(raw);
            if let Ok(url) = result {
                let host = url.host_str().unwrap();
                if let Ok(ip) = host.trim_matches(&['[', ']'][..]).parse::<IpAddr>() {
                    assert!(!allowed_ip(ip, NetworkPolicy::Public), "{raw}");
                } else {
                    // DNS names not categorically blocked by syntax are still
                    // resolved and classified at *every* native TF3 hop.
                    assert!(!url.scheme().starts_with("ws"), "{raw}");
                }
            }
        }
        for ip in [
            "::1",
            "::ffff:127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "8.8.8.8",
        ] {
            assert!(
                !allowed_ip(ip.parse().unwrap(), NetworkPolicy::FixtureLoopback),
                "acceptance fixture must never broaden to {ip}"
            );
        }
    }
    #[tokio::test]
    async fn browser_get_never_accepts_a_native_supplied_secret_or_exposes_it_in_receipts() {
        const SENTINEL: &str = "tf4-secret-sentinel-never-log-or-dom-3943";
        let (dir, registry, state) = setup();
        let prepared = prepare(
            fixture(dir.path(), "https://example.org/".into()),
            &registry,
            &state,
        )
        .unwrap();
        let receipt = execute(&prepared.token, &registry, &state, Some(SENTINEL.into()))
            .await
            .unwrap();
        assert_eq!(receipt.terminal, "denied");
        assert_eq!(receipt.reason_code, "credential-operation-denied");
        assert_eq!(receipt.bytes_received, None);
        assert!(!receipt.credential_used);
        assert!(receipt.body.is_none());
        let serialized = serde_json::to_string(&receipt).unwrap();
        assert!(!serialized.contains(SENTINEL));
        assert!(!serialized.contains("x-subscription-token"));
        assert!(execute(&prepared.token, &registry, &state, None)
            .await
            .is_err());
    }
    #[tokio::test]
    async fn revoked_native_provider_credential_fails_before_network_and_cannot_replay() {
        const TEST_ONLY_SENTINEL: &str = "tf4-revoked-test-credential-never-in-receipt";
        let (dir, registry, state) = setup();
        let mut search = request(dir.path(), TfWebOperation::WebSearch);
        search.query = Some("controlled test-only provider revocation".into());
        let prepared = prepare(search, &registry, &state).unwrap();
        // Test-only simulation of an earlier one-use approval. The native
        // command always re-reads the existing keyring reference at execute
        // time; after revocation it passes None, never a stale secret.
        {
            let mut entries = state.entries.lock().unwrap();
            entries.pending.get_mut(&prepared.token).unwrap().approved = true;
        }
        let receipt = execute(&prepared.token, &registry, &state, None)
            .await
            .unwrap();
        assert_eq!(receipt.terminal, "denied");
        assert_eq!(receipt.reason_code, "provider-unconfigured");
        assert_eq!(receipt.credential_reference, Some(CREDENTIAL_REF));
        assert!(!receipt.credential_used);
        assert_eq!(receipt.bytes_received, None);
        assert!(receipt.body.is_none());
        assert!(receipt.dns_evidence.is_empty());
        assert!(receipt.redirect_chain.is_empty());
        assert!(!serde_json::to_string(&receipt)
            .unwrap()
            .contains(TEST_ONLY_SENTINEL));
        assert!(execute(
            &prepared.token,
            &registry,
            &state,
            Some(TEST_ONLY_SENTINEL.into())
        )
        .await
        .is_err());
    }
    #[test]
    fn tf3_browser_request_schema_rejects_raw_credentials_headers_and_request_bodies() {
        let base = serde_json::json!({
            "operation": "http_get",
            "actor": "test-actor",
            "sessionId": "test-session",
            "workspaceRoot": "C:\\test-workspace",
            "url": "https://example.org/test",
            "query": null,
            "searchResultId": null,
            "timeoutMs": 1000,
            "maxBytes": 512,
            "maxRedirects": 0
        });
        for (name, supplied) in [
            ("credentialReference", serde_json::json!("credential:fake")),
            ("credential", serde_json::json!("test-only-secret")),
            (
                "authorization",
                serde_json::json!("Bearer test-only-secret"),
            ),
            (
                "headers",
                serde_json::json!({"Authorization": "Bearer test-only-secret"}),
            ),
            ("body", serde_json::json!("test-only-secret")),
            ("method", serde_json::json!("POST")),
            ("cookie", serde_json::json!("session=test-only-secret")),
        ] {
            let mut malformed = base.clone();
            malformed
                .as_object_mut()
                .unwrap()
                .insert(name.to_owned(), supplied);
            assert!(
                serde_json::from_value::<TfWebRequest>(malformed).is_err(),
                "TF3 browser-facing request must reject unsupported field {name}"
            );
        }
        let mut forged_write = base.clone();
        forged_write["operation"] = serde_json::json!("browser_bound_post");
        assert!(
            serde_json::from_value::<TfWebRequest>(forged_write.clone()).is_err(),
            "private write operation must not be deserializable from public IPC"
        );
        forged_write["operation"] = serde_json::json!("browser_origin_credential_get");
        assert!(
            serde_json::from_value::<TfWebRequest>(forged_write).is_err(),
            "private origin credential cannot be deserializable from public IPC"
        );
        let (_, registry, state) = setup();
        let synthetic = TfWebRequest {
            operation: TfWebOperation::BrowserBoundPost,
            actor: "native-test".into(),
            session_id: "session-1".into(),
            workspace_root: "not-an-authority".into(),
            url: Some("https://example.org/write".into()),
            query: None,
            search_result_id: None,
            timeout_ms: None,
            max_bytes: None,
            max_redirects: None,
        };
        assert_eq!(
            prepare(synthetic, &registry, &state).unwrap_err(),
            "native-browser-private-witness-required"
        );
        let second = TfWebRequest {
            operation: TfWebOperation::BrowserOriginCredentialGet,
            ..request(
                std::path::Path::new("C:/no-authority"),
                TfWebOperation::HttpGet,
            )
        };
        assert_eq!(
            prepare(second, &registry, &state).unwrap_err(),
            "native-browser-private-witness-required"
        );
    }

    #[tokio::test]
    async fn isolated_origin_credential_get_is_exact_header_one_use_without_secret_receipt() {
        const SYNTHETIC: &str = "tf4-synthetic-owned-secret-never-report";
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!(
            "http://127.0.0.1:{}/case/synthetic/credential",
            listener.local_addr().unwrap().port(),
        );
        let origin = Url::parse(&endpoint).unwrap();
        let target = origin.clone();
        let received = Arc::new(Mutex::new(Vec::<u8>::new()));
        let observed = received.clone();
        listener.set_nonblocking(true).unwrap();
        let worker = thread::spawn(move || {
            // Isolated test server must never strand the suite if TF3 correctly
            // denies a credential before opening its one expected socket.
            let started = Instant::now();
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break Some(socket),
                    Err(err)
                        if err.kind() == std::io::ErrorKind::WouldBlock
                            && started.elapsed() < Duration::from_secs(2) =>
                    {
                        thread::sleep(Duration::from_millis(5));
                    }
                    _ => break None,
                }
            };
            let Some(mut socket) = socket.take() else {
                return false;
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut raw = Vec::new();
            while !raw.ends_with(b"\r\n\r\n") {
                let mut chunk = [0u8; 1024];
                let n = socket.read(&mut chunk).unwrap();
                assert!(n > 0 && raw.len() + n <= 4096);
                raw.extend_from_slice(&chunk[..n]);
                if raw.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            *observed.lock().unwrap() = raw;
            socket.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nOK"
            ).unwrap();
            true
        });
        let (dir, registry, state) = setup();
        let mut req = fixture(dir.path(), endpoint.clone());
        req.operation = TfWebOperation::BrowserOriginCredentialGet;
        req.max_redirects = Some(0);
        req.max_bytes = Some(4096);
        let token = prepare_policy(req, &registry, &state, NetworkPolicy::FixtureLoopback)
            .unwrap()
            .token;
        state
            .entries
            .lock()
            .unwrap()
            .pending
            .get_mut(&token)
            .unwrap()
            .browser_credential = Some(TfBrowserOriginCredentialGet {
            destination: target.clone(),
            approved_origin: origin.clone(),
            reference: "a".repeat(48),
            source_page_generation: 2,
            consumed_approval_id: "b".repeat(48),
        });
        let receipt = execute_policy_with_output_scoped(
            &token,
            &registry,
            &state,
            Some(SYNTHETIC.into()),
            NetworkPolicy::FixtureLoopback,
            None,
            Some(&origin),
            None,
            false,
            true,
        )
        .await
        .unwrap();
        let accepted = worker.join().unwrap();
        assert!(accepted, "credential GET never reached controlled loopback server: terminal={}, reason={}, dns={:?}",
            receipt.terminal, receipt.reason_code, receipt.dns_evidence);
        let wire = String::from_utf8_lossy(&received.lock().unwrap()).to_ascii_lowercase();
        assert!(wire.starts_with("get /case/synthetic/credential http/1.1\r\n"));
        assert!(wire.contains(&format!(
            "authorization: bearer {}",
            SYNTHETIC.to_ascii_lowercase()
        )));
        assert!(!wire.contains("cookie:"));
        assert_eq!(
            receipt.operation,
            TfWebOperation::BrowserOriginCredentialGet
        );
        assert_eq!(receipt.actual_method, "GET");
        assert_eq!(
            receipt.credential_reference,
            Some("tf4_origin_opaque_keyring_reference")
        );
        assert!(receipt.credential_used);
        assert_eq!(receipt.status_code, Some(200));
        assert_eq!(receipt.effect_state, "Unknown");
        assert_eq!(receipt.retry, "NEVER_REPLAY");
        assert!(!receipt.auto_retry && receipt.body.is_none());
        assert!(!serde_json::to_string(&receipt).unwrap().contains(SYNTHETIC));
        assert!(
            execute_policy_with_output_scoped(
                &token,
                &registry,
                &state,
                Some(SYNTHETIC.into()),
                NetworkPolicy::FixtureLoopback,
                None,
                Some(&origin),
                None,
                false,
                true,
            )
            .await
            .is_err(),
            "consumed credential token cannot replay"
        );
        let mut wrong_req = fixture(dir.path(), target.to_string());
        wrong_req.operation = TfWebOperation::BrowserOriginCredentialGet;
        wrong_req.max_redirects = Some(0);
        let wrong_token =
            prepare_policy(wrong_req, &registry, &state, NetworkPolicy::FixtureLoopback)
                .unwrap()
                .token;
        state
            .entries
            .lock()
            .unwrap()
            .pending
            .get_mut(&wrong_token)
            .unwrap()
            .browser_credential = Some(TfBrowserOriginCredentialGet {
            destination: target,
            approved_origin: origin.clone(),
            reference: "a".repeat(48),
            source_page_generation: 2,
            consumed_approval_id: "b".repeat(48),
        });
        let wrong = Url::parse("http://127.0.0.1:2444/").unwrap();
        let denied = execute_policy_with_output_scoped(
            &wrong_token,
            &registry,
            &state,
            Some(SYNTHETIC.into()),
            NetworkPolicy::FixtureLoopback,
            None,
            Some(&wrong),
            None,
            false,
            true,
        )
        .await
        .unwrap();
        assert_eq!(denied.terminal, "denied");
        assert_eq!(
            denied.reason_code,
            "origin-credential-execution-scope-denied"
        );
        assert!(!denied.credential_used && denied.dns_evidence.is_empty());
        assert!(denied.body.is_none());
    }

    #[tokio::test]
    async fn private_bound_form_post_requires_exact_body_origin_and_one_tf3_execution_owner() {
        let (dir, registry, state) = setup();
        let source = Url::parse("https://example.org/").unwrap();
        let body = b"nonce=owned-test&commit=once".to_vec();
        let make = || TfBrowserBoundPost {
            destination: Url::parse("https://example.org/case/owned-test/form").unwrap(),
            approved_origin: source.clone(),
            body: body.clone(),
            body_sha256: format!("{:x}", Sha256::digest(&body)),
            content_type: "application/x-www-form-urlencoded",
            source_page_generation: 2,
            original_form_index: 12,
            original_submitter_index: 13,
            consumed_approval_id: "a".repeat(48),
        };
        let prepare_post = |post| {
            prepare_browser_bound_post_policy(
                "native-test",
                "session-1",
                &dir.path().to_string_lossy(),
                post,
                &registry,
                &state,
                NetworkPolicy::Public,
            )
        };
        let mut corrupt = make();
        corrupt.body[0] ^= 1;
        assert!(prepare_post(corrupt).is_err());
        let mut other_origin = make();
        other_origin.destination = Url::parse("https://example.com/form").unwrap();
        assert!(prepare_post(other_origin).is_err());
        let mut query = make();
        query.destination = Url::parse("https://example.org/form?tracking=1").unwrap();
        assert!(prepare_post(query).is_err());
        let mut oversized = make();
        oversized.body = vec![b'x'; MAX_BODY + 1];
        assert!(prepare_post(oversized).is_err());
        let mut wrong_approval = make();
        wrong_approval.consumed_approval_id = "model-supplied".into();
        assert!(prepare_post(wrong_approval).is_err());
        let mut wrong_nodes = make();
        wrong_nodes.original_submitter_index = wrong_nodes.original_form_index;
        assert!(prepare_post(wrong_nodes).is_err());

        let prepared = prepare_post(make()).unwrap();
        // The public read executor MUST consume/deny a bound write, NEVER
        // silently reinterpret its POST token as an ordinary GET.
        assert_eq!(
            execute(&prepared.token, &registry, &state, None)
                .await
                .unwrap_err(),
            "tf3-bound-post-executor-mismatch"
        );
        assert!(
            execute_browser_bound_post(&prepared.token, &registry, &state, &source)
                .await
                .is_err()
        );
        // A changed origin does not consume the token; the native owner must
        // still cancel it or use the correct exact-origin executor.
        let prepared = prepare_post(make()).unwrap();
        assert!(execute_browser_bound_post(
            &prepared.token,
            &registry,
            &state,
            &Url::parse("https://example.com/").unwrap()
        )
        .await
        .is_err());
        assert!(cancel(&prepared.token, &state).unwrap());
        assert!(!cancel(&prepared.token, &state).unwrap());
    }

    #[tokio::test]
    async fn isolated_tf3_bound_post_sends_exact_bytes_once_and_never_calls_http_success_effect() {
        // This listener is an isolated HTTP loopback *source integration*
        // test. It cannot run under Public policy and cannot prove installed
        // WebView2, native consent, or production HTTPS.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let dest = Url::parse(&format!("{base}/one-write")).unwrap();
        let origin = Url::parse(&base).unwrap();
        let payload = b"nonce=source-test&commit=once".to_vec();
        let received = Arc::new(Mutex::new(Vec::<u8>::new()));
        let observed = received.clone();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut raw = Vec::new();
            let total = loop {
                let mut part = [0u8; 1024];
                let n = stream.read(&mut part).unwrap();
                assert!(n > 0 && raw.len() + n <= 8192);
                raw.extend_from_slice(&part[..n]);
                if let Some(end) = raw.windows(4).position(|v| v == b"\r\n\r\n") {
                    let headers = std::str::from_utf8(&raw[..end]).unwrap();
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|v| v.parse::<usize>().ok())
                        })
                        .unwrap();
                    if raw.len() >= end + 4 + length {
                        break end + 4 + length;
                    }
                }
            };
            raw.truncate(total);
            *observed.lock().unwrap() = raw;
            stream.write_all(
                b"HTTP/1.1 201 Created\r\nContent-Length: 2\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nok"
            ).unwrap();
        });
        let (dir, registry, state) = setup();
        let post = TfBrowserBoundPost {
            destination: dest.clone(),
            approved_origin: origin.clone(),
            body: payload.clone(),
            body_sha256: format!("{:x}", Sha256::digest(&payload)),
            content_type: "application/x-www-form-urlencoded",
            source_page_generation: 11,
            original_form_index: 2,
            original_submitter_index: 3,
            consumed_approval_id: "a".repeat(48),
        };
        assert!(
            prepare_browser_bound_post_policy(
                "native-test",
                "session-1",
                &dir.path().to_string_lossy(),
                post.clone(),
                &registry,
                &state,
                NetworkPolicy::Public,
            )
            .is_err(),
            "real Public policy must deny HTTP loopback"
        );
        let prepared = prepare_browser_bound_post_policy(
            "native-test",
            "session-1",
            &dir.path().to_string_lossy(),
            post,
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap();
        let result = execute_browser_bound_post_policy(
            &prepared.token,
            &registry,
            &state,
            &origin,
            NetworkPolicy::FixtureLoopback,
        )
        .await
        .unwrap();
        server.join().unwrap();
        let observed = received.lock().unwrap();
        assert!(observed.starts_with(b"POST /one-write HTTP/1.1\r\n"));
        assert!(observed.ends_with(&payload));
        assert!(String::from_utf8_lossy(&observed)
            .to_ascii_lowercase()
            .contains("content-type: application/x-www-form-urlencoded"));
        assert_eq!(
            result.request_body_sha256,
            format!("{:x}", Sha256::digest(&payload))
        );
        assert_eq!(result.request_body_bytes, payload.len());
        assert_eq!(
            result.destination_sha256,
            format!("{:x}", Sha256::digest(dest.as_str().as_bytes()))
        );
        assert_eq!(result.receipt.actual_method, "POST");
        assert_eq!(result.receipt.operation, TfWebOperation::BrowserBoundPost);
        assert_eq!(result.receipt.terminal, "completed");
        assert_eq!(result.receipt.status_code, Some(201));
        assert_eq!(result.receipt.effect_state, "Unknown");
        assert_eq!(result.receipt.retry, "NEVER_REPLAY");
        assert!(result.receipt.body.is_none());
        assert!(
            execute_browser_bound_post_policy(
                &prepared.token,
                &registry,
                &state,
                &origin,
                NetworkPolicy::FixtureLoopback
            )
            .await
            .is_err(),
            "no second HTTP effect may be dispatched with this token"
        );
    }
    #[test]
    fn scope_token_one_use_approval_cancel_and_provider_status() {
        let (dir, registry, state) = setup();
        let req = fixture(dir.path(), "https://example.org/".into());
        assert!(prepare(req.clone(), &WorkspaceRegistry::default(), &state).is_err());
        let prepared = prepare(req, &registry, &state).unwrap();
        assert!(!prepared.requires_approval);
        assert!(approve_headless(&prepared.token, &state).is_err());
        assert!(cancel(&prepared.token, &state).unwrap());
        assert!(!cancel(&prepared.token, &state).unwrap());
        assert!(consume(&prepared.token, &registry, &state).is_err());
        let mut search = request(dir.path(), TfWebOperation::WebSearch);
        search.query = Some("rust tauri".into());
        let token = prepare(search, &registry, &state).unwrap().token;
        assert!(consume(&token, &registry, &state).is_err());
        assert!(approve_headless(&token, &state).is_err()); // consumed
        assert!(!provider_status_for_secret(Ok(None)).available);
        assert_eq!(
            provider_status_for_secret(Err("locked".into())).reason_code,
            "credential-store-unavailable"
        );
        assert!(provider_status_for_secret(Ok(Some("mock-key".into()))).configured);
    }
    #[test]
    fn prepared_network_policy_is_bound_to_one_use_token_and_rechecked_at_consumption() {
        let (dir, registry, state) = setup();
        let public = prepare(
            fixture(dir.path(), "https://example.org/".into()),
            &registry,
            &state,
        )
        .unwrap();
        assert_eq!(
            consume_policy(
                &public.token,
                &registry,
                &state,
                NetworkPolicy::FixtureLoopback
            )
            .err()
            .as_deref(),
            Some("network-policy-mismatch")
        );
        assert!(consume(&public.token, &registry, &state).is_err());

        let fixture_prepared = prepare_policy(
            fixture(dir.path(), "http://127.0.0.1:35043/resource".into()),
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap();
        assert_eq!(
            consume(&fixture_prepared.token, &registry, &state)
                .err()
                .as_deref(),
            Some("network-policy-mismatch")
        );
        assert!(consume_policy(
            &fixture_prepared.token,
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback
        )
        .is_err());

        // A genuine fixture token retains the fixture normalization at the
        // authoritative execution-time recheck; it is not reinterpreted as a
        // public-origin request by the generic TF3 consume operation.
        let fixture = prepare_policy(
            fixture(dir.path(), "http://127.0.0.1:35043/resource".into()),
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap();
        assert!(consume_policy(
            &fixture.token,
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback
        )
        .is_ok());
        complete(&fixture.token, &state);
    }
    #[test]
    fn actor_session_root_request_budget_is_bounded_before_network_dispatch() {
        let (dir, registry, state) = setup();
        let req = fixture(dir.path(), "https://example.org/".into());
        for _ in 0..MAX_SESSION_REQUESTS {
            let token = prepare(req.clone(), &registry, &state).unwrap().token;
            assert!(cancel(&token, &state).unwrap());
        }
        assert_eq!(
            prepare(req.clone(), &registry, &state).unwrap_err(),
            "network-session-request-budget-exceeded"
        );
        // Quota is scoped to the actor and session, not a global grant.
        let mut separate = req;
        separate.session_id = "another-authorized-session".into();
        assert!(prepare(separate, &registry, &state).is_ok());
    }
    #[tokio::test]
    async fn loopback_public_denial_and_explicit_test_fixture_truncation() {
        let (dir, registry, state) = setup();
        let p = prepare(
            fixture(dir.path(), "http://127.0.0.1:12345/".into()),
            &registry,
            &state,
        )
        .unwrap();
        let denied = execute(&p.token, &registry, &state, None).await.unwrap();
        assert_eq!(denied.reason_code, "dns-private-or-reserved-denied");
        assert!(denied.dns_evidence.iter().all(|x| !x.socket_ip_observed));
        assert!(execute(&p.token, &registry, &state, None).await.is_err());
        let (url, server) = serve(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 9\r\nConnection: close\r\n\r\nhello-web",
            Duration::ZERO);
        let mut req = fixture(dir.path(), url);
        req.max_bytes = Some(5);
        let token = prepare_policy(req, &registry, &state, NetworkPolicy::FixtureLoopback)
            .unwrap()
            .token;
        let receipt = execute_policy(
            &token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.terminal, "completed");
        assert_eq!(receipt.body.as_deref(), Some("hello"));
        assert_eq!(receipt.bytes_retained, 5);
        assert!(receipt.truncated);
        assert_eq!(
            receipt.content_sha256,
            Some(format!("{:x}", Sha256::digest(b"hello")))
        );
        assert_eq!(receipt.dns_evidence.len(), 1);
        assert!(!receipt.dns_evidence[0].socket_ip_observed);
    }
    #[tokio::test]
    async fn browser_binary_get_reuses_tf3_token_scope_and_never_promotes_truncation() {
        let (dir, registry, state) = setup();
        // Binary resources must not relax the public-only URL/DNS/IP policy.
        let denied_token = prepare(
            fixture(dir.path(), "http://127.0.0.1:12345/image.png".into()),
            &registry,
            &state,
        )
        .unwrap()
        .token;
        let denied = execute_browser_resource(&denied_token, &registry, &state)
            .await
            .unwrap();
        assert_eq!(denied.receipt.terminal, "denied");
        assert_eq!(denied.receipt.reason_code, "dns-private-or-reserved-denied");
        assert!(denied.bytes.is_empty());
        assert!(execute_browser_resource(&denied_token, &registry, &state)
            .await
            .is_err()); // one-use TF3 token

        let image = b"\x89PNG\r\n\x1a\n\x00\x01";
        let mut reply = b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 10\r\nConnection: close\r\n\r\n".to_vec();
        reply.extend_from_slice(image);
        let (url, server) = serve(Box::leak(reply.into_boxed_slice()), Duration::ZERO);
        let token = prepare_policy(
            fixture(dir.path(), url),
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap()
        .token;
        let mut bytes = Vec::new();
        let receipt = execute_policy_with_output(
            &token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
            Some(&mut bytes),
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.terminal, "completed");
        assert_eq!(receipt.bytes_retained, image.len());
        assert_eq!(receipt.content_type.as_deref(), Some("image/png"));
        assert_eq!(bytes, image);
        assert_eq!(receipt.retry, "NEVER_REPLAY");
        assert_eq!(receipt.effect_state, "Unknown");
        assert!(!receipt.auto_retry);
        assert_eq!(
            receipt.content_sha256,
            Some(format!("{:x}", Sha256::digest(image)))
        );
        assert!(receipt.body.is_none()); // never stringify arbitrary binary

        let (url, server) = serve(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/javascript\r\nContent-Length: 10\r\nConnection: close\r\n\r\n0123456789",
            Duration::ZERO,
        );
        let mut req = fixture(dir.path(), url);
        req.max_bytes = Some(4);
        let token = prepare_policy(req, &registry, &state, NetworkPolicy::FixtureLoopback)
            .unwrap()
            .token;
        let mut partial = Vec::new();
        let receipt = execute_policy_with_output(
            &token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
            Some(&mut partial),
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.terminal, "denied");
        assert_eq!(receipt.reason_code, "browser-response-limit-exceeded");
        assert!(receipt.truncated);
        assert_eq!(receipt.retry, "NEVER_REPLAY");
        assert_eq!(receipt.effect_state, "Unknown");
        assert!(!receipt.auto_retry);
        assert!(
            partial.is_empty(),
            "never return a successful truncated script"
        );
    }

    #[tokio::test]
    async fn browser_binary_get_blocks_opaque_types_and_private_redirects() {
        let (dir, registry, state) = setup();
        let (url, server) = serve(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 1\r\nConnection: close\r\n\r\nX",
            Duration::ZERO,
        );
        let token = prepare_policy(
            fixture(dir.path(), url),
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap()
        .token;
        let mut bytes = Vec::new();
        let receipt = execute_policy_with_output(
            &token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
            Some(&mut bytes),
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.reason_code, "browser-content-type-denied");
        assert_eq!(receipt.terminal, "denied");
        assert!(bytes.is_empty());

        let (url, server) = serve(
            b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            Duration::ZERO,
        );
        let token = prepare_policy(
            fixture(dir.path(), url),
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap()
        .token;
        let mut body = Vec::new();
        let receipt = execute_policy_with_output(
            &token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
            Some(&mut body),
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.reason_code, "browser-resource-redirect-denied");
        assert!(receipt.redirect_chain.is_empty());
        assert_eq!(receipt.retry, "NEVER_REPLAY");
        assert_eq!(receipt.effect_state, "Unknown");
        assert!(body.is_empty());
    }

    #[tokio::test]
    async fn browser_resource_redirect_is_denied_even_with_requested_same_origin_hop() {
        let (dir, registry, state) = setup();
        let (url, server) = serve(
            b"HTTP/1.1 302 Found\r\nLocation: /potential-write\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            Duration::ZERO,
        );
        let mut req = fixture(dir.path(), url);
        req.max_redirects = Some(1);
        let token = prepare_policy(req, &registry, &state, NetworkPolicy::FixtureLoopback)
            .unwrap()
            .token;
        let mut bytes = Vec::new();
        let receipt = execute_policy_with_output(
            &token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
            Some(&mut bytes),
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.reason_code, "browser-resource-redirect-denied");
        assert_eq!(receipt.terminal, "denied");
        assert_eq!(receipt.retry, "NEVER_REPLAY");
        assert_eq!(receipt.effect_state, "Unknown");
        assert_eq!(receipt.dns_evidence.len(), 1);
        assert!(receipt.redirect_chain.is_empty());
        assert!(bytes.is_empty());
        assert!(!receipt.auto_retry);
        assert!(execute_policy(
            &token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback
        )
        .await
        .is_err());
    }
    #[tokio::test]
    async fn redirect_to_metadata_is_denied_without_second_connection() {
        let (dir, registry, state) = setup();
        let (url, server) = serve(
            b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            Duration::ZERO);
        let p = prepare_policy(
            fixture(dir.path(), url),
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap();
        let receipt = execute_policy(
            &p.token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.reason_code, "fixture-redirect-origin-denied");
        assert_eq!(receipt.redirect_chain.len(), 1);
        // The redirect never reaches the second DNS resolution or socket:
        // exact fixture origin authority is checked first.
        assert_eq!(receipt.dns_evidence.len(), 1);
    }
    #[tokio::test]
    async fn fixture_redirect_cannot_switch_to_another_loopback_service_port() {
        let (dir, registry, state) = setup();
        let first = TcpListener::bind("127.0.0.1:0").unwrap();
        let second = TcpListener::bind("127.0.0.1:0").unwrap();
        let next_port = second.local_addr().unwrap().port();
        let first_port = first.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut socket, _) = first.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            let mut request = [0u8; 1024];
            let _ = socket.read(&mut request).unwrap();
            write!(
                socket,
                "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{next_port}/unsafe\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            ).unwrap();
            socket.flush().unwrap();
        });
        let prepared = prepare_policy(
            fixture(dir.path(), format!("http://127.0.0.1:{first_port}/first")),
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap();
        let receipt = execute_policy(
            &prepared.token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.terminal, "denied");
        assert_eq!(receipt.reason_code, "fixture-redirect-origin-denied");
        assert_eq!(receipt.redirect_chain.len(), 1);
        assert_eq!(receipt.dns_evidence.len(), 1);
        second.set_nonblocking(true).unwrap();
        assert!(
            second.accept().is_err(),
            "redirect must not connect to a different local service"
        );
    }
    #[tokio::test]
    async fn abrupt_fixture_peer_close_is_denied_with_a_nonsecret_transport_receipt() {
        // This is a new deterministic transport-failure fixture, NOT a
        // retroactive explanation for immutable historical XDArr0.
        let (dir, registry, state) = setup();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            // Abort without any HTTP status/header/body. No synthetic OK.
            drop(socket);
        });
        let prepared = prepare_policy(
            fixture(dir.path(), format!("http://127.0.0.1:{port}/no-http-reply")),
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap();
        let receipt = execute_policy(
            &prepared.token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_ne!(receipt.terminal, "completed");
        assert_eq!(receipt.status_code, None);
        assert_eq!(receipt.bytes_retained, 0);
        assert!(!receipt.auto_retry);
        assert!(
            receipt.reason_code.starts_with("fixture-network-")
                || receipt.reason_code == "network-failed"
        );
        let evidence = serde_json::to_string(&receipt).unwrap();
        assert!(!evidence.contains("x-subscription-token"));
    }
    #[tokio::test]
    async fn test_only_allowed_redirect_revalidates_dns_on_each_hop() {
        let (dir, registry, state) = setup();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://127.0.0.1:{}/first",
            listener.local_addr().unwrap().port()
        );
        listener.set_nonblocking(true).unwrap();
        let server = thread::spawn(move || {
            for round in 0..2 {
                let started = Instant::now();
                loop {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
                            let mut buf = [0u8; 2048];
                            let _ = stream.read(&mut buf);
                            let response: &[u8] = if round == 0 {
                                b"HTTP/1.1 302 Found\r\nLocation: /second\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                            } else {
                                b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
                            };
                            stream.write_all(response).unwrap();
                            break;
                        }
                        Err(e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                && started.elapsed() < Duration::from_secs(2) =>
                        {
                            thread::sleep(Duration::from_millis(5))
                        }
                        other => panic!("fixture redirect accept failed: {other:?}"),
                    }
                }
            }
        });
        let mut req = fixture(dir.path(), url);
        req.max_redirects = Some(1);
        let p = prepare_policy(req, &registry, &state, NetworkPolicy::FixtureLoopback).unwrap();
        let receipt = execute_policy(
            &p.token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.terminal, "completed", "{:?}", receipt.reason_code);
        assert_eq!(receipt.body.as_deref(), Some("ok"));
        assert_eq!(receipt.redirect_chain.len(), 1);
        assert_eq!(receipt.dns_evidence.len(), 2);
        assert!(receipt
            .dns_evidence
            .iter()
            .all(|d| d.classification == "all-allowed"
                && d.pinning == "reqwest-resolve-to-addrs"
                && !d.socket_ip_observed));
        assert_eq!(receipt.retry, "SAFE_RETRY");
        assert!(!receipt.auto_retry);
    }

    #[tokio::test]
    async fn head_is_bodyless_and_nontext_is_rejected_for_get() {
        let (dir, registry, state) = setup();
        let (url, server) = serve(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            Duration::ZERO);
        let mut req = request(dir.path(), TfWebOperation::HttpHead);
        req.url = Some(url);
        let p = prepare_policy(req, &registry, &state, NetworkPolicy::FixtureLoopback).unwrap();
        let receipt = execute_policy(
            &p.token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.terminal, "completed");
        assert_eq!(receipt.bytes_received, Some(0));
        assert_eq!(receipt.body.as_deref(), Some(""));
        let (url, server) = serve(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
            Duration::ZERO);
        let p = prepare_policy(
            fixture(dir.path(), url),
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap();
        let receipt = execute_policy(
            &p.token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.reason_code, "nontext-content-type-denied");
        assert!(receipt.body.is_none());
    }

    #[tokio::test]
    async fn timeout_and_active_cancellation_are_terminal() {
        let (dir, registry, state) = setup();
        let (url, server) = serve(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok",
            Duration::from_millis(150),
        );
        let mut req = fixture(dir.path(), url);
        req.timeout_ms = Some(30);
        let token = prepare_policy(req, &registry, &state, NetworkPolicy::FixtureLoopback)
            .unwrap()
            .token;
        let receipt = execute_policy(
            &token,
            &registry,
            &state,
            None,
            NetworkPolicy::FixtureLoopback,
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(receipt.terminal, "timed_out");
        let (url, server) = serve(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok",
            Duration::from_millis(150),
        );
        let token = prepare_policy(
            fixture(dir.path(), url),
            &registry,
            &state,
            NetworkPolicy::FixtureLoopback,
        )
        .unwrap()
        .token;
        let registry = Arc::new(registry);
        let state = Arc::new(state);
        let cloned_registry = registry.clone();
        let cloned_state = state.clone();
        let tok = token.clone();
        let task = tokio::spawn(async move {
            execute_policy(
                &tok,
                &cloned_registry,
                &cloned_state,
                None,
                NetworkPolicy::FixtureLoopback,
            )
            .await
            .unwrap()
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(cancel(&token, &state).unwrap());
        let receipt = task.await.unwrap();
        server.join().unwrap();
        assert_eq!(receipt.terminal, "cancelled");
        assert!(!cancel(&token, &state).unwrap());
    }
    #[test]
    fn search_results_are_unverified_metadata_and_actor_session_scoped() {
        let (dir, registry, state) = setup();
        let p = Pending {
            request_id: nonce().unwrap(),
            request: request(dir.path(), TfWebOperation::WebSearch),
            policy: NetworkPolicy::Public,
            root: std::fs::canonicalize(dir.path()).unwrap(),
            target: None,
            expires: Instant::now() + TOKEN_TTL,
            approved: true,
            browser_post: None,
            browser_credential: None,
        };
        let results = parse_search(
            r#"{"web":{"results":[
            {"title":"Safe","url":"https://example.org/a","description":"Example"},
            {"title":"Metadata","url":"http://127.0.0.1/","description":"denied"},
            {"title":"Credential","url":"https://example.org/?auth=secret"}]}}"#,
            &p,
            &state,
        )
        .unwrap();
        assert_eq!(results.len(), 1);
        let mut fetch = request(dir.path(), TfWebOperation::HttpGet);
        fetch.search_result_id = Some(results[0].id.clone());
        assert!(prepare(fetch.clone(), &registry, &state).is_ok());
        fetch.session_id = "other-session".into();
        assert!(prepare(fetch, &registry, &state).is_err());
    }
}
