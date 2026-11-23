//! TF4 browser/computer-use, with a safe inert-document default and a
//! feature-gated, independently attested confined native read-only startup.
//!
//! The default engine never instantiates remote Wry/WebView2. Those engines can load subresources,
//! redirects, service workers and scripts outside the TF3 public-IP/DNS pinning
//! path, and this repository does not provide authoritative request interception.
//! Every supported navigation uses tf_web's exact native SSRF, DNS pinning,
//! redirect, header, text-only, timeout, and size policy. HTML is NEVER rendered
//! or executed: inert text and conservative anchor metadata are extracted only.
//! No JS, DOM automation, cookies, localStorage, popups, downloads, file uploads,
//! browser screenshots, clipboard, authentication, form submits or browser OS
//! sandbox. Browser sessions, snapshots, approvals and credentials are in-memory
//! only; actor/session labels are scoped, not OS-authenticated principals.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
use super::tf_browser_runtime::{
    BrokerResourceReceipt, BrowserRuntimeSession, BrowserRuntimeStart,
};
use super::tf_web::{self, TfWebDnsEvidence, TfWebOperation, TfWebRequest, TfWebState};
use crate::modules::workspace::WorkspaceRegistry;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
use tauri::async_runtime::JoinHandle;
use tauri::Manager;
use tokio::sync::{watch, Semaphore};

const TOOL_ID: &str = "tf.browser_operation.v1";
const ENGINE: &str = "inert_native_text";
const ISOLATION: &str =
    "tf3_dns_pinned_inert_text_no_wry_no_js_no_browser_os_sandbox_no_peer_ip_attestation";
const CONFINED_ENGINE: &str = "confined_webview2_read_only_unaccepted";
const CONFINED_ISOLATION: &str =
    "appcontainer_zero_network_owned_job_tf3_https_get_broker_no_model_interaction";
// This SHA must be embedded by the trusted release build, never supplied by a
// renderer/model or mutable user setting. If absent, no native browser launch
// can happen through the normal Tool Fabric prepare/approve/execute route.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
const PINNED_NATIVE_HOST_SHA256: Option<&str> = option_env!("CLACK_TF4_NATIVE_HOST_SHA256");
const PENDING_TTL: Duration = Duration::from_secs(60);
const SESSION_TTL: Duration = Duration::from_secs(600);
const MAX_SESSIONS: usize = 8;
const MAX_PENDING: usize = 64;
const MAX_ACTIVE: usize = 16;
const MAX_HISTORY: usize = 8;
const MAX_ELEMENTS: usize = 64;
const MAX_TEXT: usize = 32 * 1024;
const MAX_NETWORK_BYTES: usize = 64 * 1024;
const MAX_TIMEOUT: u64 = 15_000;
const MAX_URL: usize = 2048;
static APPROVAL_SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(4)));

fn confined_runtime_packaged() -> bool {
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    {
        return PINNED_NATIVE_HOST_SHA256.is_some_and(|digest| {
            digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit())
        });
    }
    #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
    {
        false
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TfBrowserOperation {
    Open,
    /// Internal UI-only, opt-in native read-only startup. Not in model tool
    /// schemas, not a substitute for semantic observation/action acceptance.
    OpenConfined,
    Navigate,
    Snapshot,
    ClickLink,
    Back,
    Close,
    Click,
    Type,
    Scroll,
    Screenshot,
}
impl TfBrowserOperation {
    fn network(self) -> bool {
        matches!(
            self,
            Self::Open | Self::OpenConfined | Self::Navigate | Self::ClickLink | Self::Back
        )
    }
    fn unsupported(self) -> bool {
        matches!(
            self,
            Self::Click | Self::Type | Self::Scroll | Self::Screenshot
        )
    }
}

fn decode_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len().min(MAX_TEXT));
    let mut remainder = input;
    while !remainder.is_empty() && out.len() < MAX_TEXT {
        if let Some(index) = remainder.find('&') {
            out.push_str(&remainder[..index]);
            remainder = &remainder[index..];
            if out.len() >= MAX_TEXT {
                break;
            }
        } else {
            out.push_str(remainder);
            break;
        }
        let Some(end) = remainder.find(';').filter(|n| *n <= 12) else {
            out.push('&');
            remainder = &remainder[1..];
            continue;
        };
        let code = &remainder[1..end];
        let decoded = match code {
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "nbsp" => Some(' '),
            _ if code.starts_with("#x") || code.starts_with("#X") => {
                u32::from_str_radix(&code[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if code.starts_with('#') => code[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        if let Some(ch) = decoded {
            if !ch.is_control() || ch == '\n' || ch == '\t' {
                out.push(ch);
            }
        } else {
            out.push_str(&remainder[..=end]);
        }
        remainder = &remainder[end + 1..];
    }
    if out.len() > MAX_TEXT {
        let last = out.floor_char_boundary(MAX_TEXT);
        out.truncate(last);
    }
    out
}
fn cleaned_text(value: &str, max: usize) -> String {
    let mut result = String::new();
    for ch in decode_entities(value).chars() {
        if result.len() + ch.len_utf8() > max {
            break;
        }
        if ch.is_control() && !matches!(ch, '\n' | '\t' | '\r') {
            continue;
        }
        result.push(if ch == '\r' { '\n' } else { ch });
    }
    result
}
fn append_text(body: &mut String, piece: &str, cap: usize) {
    for ch in piece.chars() {
        if body.len() + ch.len_utf8() > cap {
            break;
        }
        if ch.is_control() && !matches!(ch, '\n' | '\t' | '\r') {
            continue;
        }
        body.push(if ch == '\r' { '\n' } else { ch });
    }
}
fn read_tag_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut quote = 0u8;
    for (offset, &b) in bytes[start..].iter().enumerate().take(4096) {
        if quote != 0 {
            if b == quote {
                quote = 0;
            }
        } else if b == b'\'' || b == b'"' {
            quote = b;
        } else if b == b'>' {
            return Some(start + offset);
        }
    }
    None
}
fn tag_name(tag: &str) -> (String, bool) {
    let raw = tag
        .trim_start()
        .trim_start_matches(|c: char| c == '/' || c == '!');
    let closing = tag.trim_start().starts_with('/');
    (
        raw.chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
            .take(32)
            .collect::<String>()
            .to_ascii_lowercase(),
        closing,
    )
}
fn attr_href(tag: &str) -> Option<String> {
    // Only literal href attributes on an anchor are considered; malformed,
    // overlong, duplicate, or JS-computed attributes do not create actions.
    let bytes = tag.as_bytes();
    let mut i = tag.find(char::is_whitespace).unwrap_or(tag.len());
    let mut href = None;
    while i < bytes.len() {
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') {
            i += 1;
        }
        let start = i;
        while i < bytes.len()
            && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'-' | b'_' | b':'))
        {
            i += 1;
        }
        if i == start {
            break;
        }
        let key = tag[start..i].to_ascii_lowercase();
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'=' {
            continue;
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let quote = if bytes[i] == b'\'' || bytes[i] == b'"' {
            let q = bytes[i];
            i += 1;
            Some(q)
        } else {
            None
        };
        let from = i;
        while i < bytes.len()
            && match quote {
                Some(q) => bytes[i] != q,
                None => !bytes[i].is_ascii_whitespace() && bytes[i] != b'>',
            }
        {
            i += 1;
        }
        let value = &tag[from..i];
        if quote.is_some() && i == bytes.len() {
            break;
        }
        if quote.is_some() {
            i += 1;
        }
        if key == "href" {
            if href.is_some() {
                return None;
            } // ambiguous duplicate denied
            href = (value.len() <= MAX_URL).then(|| cleaned_text(value, MAX_URL));
        }
    }
    href
}
fn inert_document(
    raw: &str,
    content_type: &str,
    final_url: &str,
) -> Result<(String, Vec<TfBrowserElement>, bool), String> {
    if !content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("text/html")
        && !content_type
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .eq_ignore_ascii_case("application/xhtml+xml")
    {
        let body = cleaned_text(raw, MAX_TEXT);
        return Ok((body.clone(), vec![], body.len() < raw.len()));
    }
    let base = Url::parse(final_url).map_err(|_| "snapshot-base-url-invalid".to_owned())?;
    let mut text = String::new();
    let mut elements = Vec::new();
    let mut idx = 0usize;
    let b = raw.as_bytes();
    let mut skip: Option<String> = None;
    let mut anchor: Option<(String, usize)> = None;
    let mut truncated = false;
    while idx < b.len() {
        if text.len() >= MAX_TEXT {
            truncated = true;
            break;
        }
        let Some(offset) = raw[idx..].find('<') else {
            if skip.is_none() {
                append_text(&mut text, &cleaned_text(&raw[idx..], MAX_TEXT), MAX_TEXT);
            }
            break;
        };
        if skip.is_none() {
            append_text(
                &mut text,
                &cleaned_text(&raw[idx..idx + offset], MAX_TEXT),
                MAX_TEXT,
            );
        }
        idx += offset;
        let Some(end) = read_tag_end(b, idx + 1) else {
            truncated = true;
            break;
        };
        let tag = &raw[idx + 1..end];
        let (name, closing) = tag_name(tag);
        idx = end + 1;
        if let Some(ref skipped) = skip {
            if closing && name == *skipped {
                skip = None;
            }
            continue;
        }
        if !closing
            && matches!(
                name.as_str(),
                "script"
                    | "style"
                    | "template"
                    | "iframe"
                    | "svg"
                    | "math"
                    | "noscript"
                    | "object"
                    | "form"
            )
        {
            skip = Some(name);
            continue;
        }
        if name == "a" {
            if closing {
                if let Some((url, start)) = anchor.take() {
                    if elements.len() < MAX_ELEMENTS {
                        let label = text.get(start..).unwrap_or("").trim();
                        if !label.is_empty() {
                            elements.push(TfBrowserElement {
                                id: nonce()?,
                                text: cleaned_text(label, 256),
                                url,
                                unverified: true,
                            });
                        }
                    }
                }
            } else if anchor.is_none() {
                if let Some(href) = attr_href(tag) {
                    if !href.trim().is_empty() && !href.starts_with('#') {
                        if let Ok(next) = base.join(&href) {
                            let mut next = next;
                            next.set_fragment(None);
                            if inert_link_metadata_allowed(&next) {
                                if let Ok(url) = valid_nav_url(next.as_str()) {
                                    anchor = Some((url, text.len()));
                                }
                            }
                        }
                    }
                }
            }
        }
        if matches!(
            name.as_str(),
            "p" | "div"
                | "li"
                | "ul"
                | "ol"
                | "section"
                | "article"
                | "header"
                | "footer"
                | "br"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "blockquote"
                | "tr"
                | "hr"
        ) {
            append_text(&mut text, "\n", MAX_TEXT);
        }
    }
    let trimmed = text.trim().to_owned();
    Ok((trimmed, elements, truncated))
}
fn clone_snapshot(p: &Pending, snapshot: &Snapshot, receipt: &mut TfBrowserReceipt) {
    receipt.browser_session_id = p.browser_id.clone();
    receipt.final_url = Some(snapshot.url.clone());
    receipt.snapshot_id = Some(snapshot.id.clone());
    receipt.status_code = snapshot.status_code;
    receipt.content_type = snapshot.content_type.clone();
    receipt.bytes_received = snapshot.bytes_received;
    receipt.bytes_retained = snapshot.bytes_retained;
    receipt.truncated = snapshot.truncated;
    receipt.content_sha256 = Some(snapshot.content_sha256.clone());
    receipt.body = Some(snapshot.body.clone());
    receipt.elements = snapshot.elements.clone();
    receipt.terminal = "completed";
    receipt.policy_decision = "allowed";
    receipt.reason_code = "inert-snapshot-observed".into();
    receipt.retry = "SAFE_RETRY";
    receipt.uncertainty = "snapshot-derived-from-native-tf3-transport-no-browser-dom";
}
struct ActiveGuard<'a> {
    state: &'a TfBrowserState,
    token: String,
    browser_id: Option<String>,
}
impl Drop for ActiveGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.state.entries.lock() {
            entries.active.remove(&self.token);
            if let Some(id) = &self.browser_id {
                if let Some(session) = entries.sessions.get_mut(id) {
                    session.busy = false;
                }
            }
        }
    }
}
fn consume<'a>(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &'a TfBrowserState,
) -> Result<(Pending, Arc<Active>, ActiveGuard<'a>), String> {
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "browser-state-unavailable")?;
    reap(&mut entries);
    let p = entries
        .pending
        .remove(token)
        .ok_or("unknown-or-consumed-browser-token")?;
    if p.expires <= Instant::now() {
        return Err("browser-token-expired".into());
    }
    if !p.approved {
        return Err("native-browser-approval-required".into());
    }
    ensure_request_shape(&p.request)?;
    let root = scope(
        &p.request.actor,
        &p.request.session_id,
        &p.request.workspace_root,
        registry,
    )?;
    if p.root != root {
        return Err("browser-scope-changed".into());
    }
    if matches!(
        p.request.operation,
        TfBrowserOperation::Open | TfBrowserOperation::OpenConfined
    ) {
        if entries.sessions.len() >= MAX_SESSIONS {
            return Err("browser-session-capacity-exceeded".into());
        }
    } else {
        let id = p
            .browser_id
            .as_deref()
            .ok_or("browser-session-id-required")?;
        let session = entries
            .sessions
            .get_mut(id)
            .ok_or("browser-session-expired")?;
        if !matches_scope(session, &p.request, &p.root) || p.revision != Some(session.revision) {
            return Err("browser-session-revision-or-scope-changed".into());
        }
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        if session.native.is_some() && p.request.operation != TfBrowserOperation::Close {
            return Err("confined-native-action-observation-not-accepted".into());
        }
        if session.busy {
            return Err("browser-session-busy".into());
        }
        if p.request.operation == TfBrowserOperation::ClickLink {
            if p.request.snapshot_id.as_deref() != Some(&session.snapshot.id)
                || !session.snapshot.elements.iter().any(|e| {
                    p.request.element_id.as_deref() == Some(e.id.as_str())
                        && Some(e.url.as_str()) == p.url.as_deref()
                })
            {
                return Err("browser-link-evidence-stale".into());
            }
        }
        if p.request.operation == TfBrowserOperation::Back
            && p.url.as_deref() != session.history.last().map(String::as_str)
        {
            return Err("browser-history-stale".into());
        }
        session.busy = true;
    }
    let active = Arc::new(Active::default());
    entries.active.insert(token.to_owned(), active.clone());
    let guard = ActiveGuard {
        state,
        token: token.to_owned(),
        browser_id: if matches!(
            p.request.operation,
            TfBrowserOperation::Open | TfBrowserOperation::OpenConfined
        ) {
            None
        } else {
            p.browser_id.clone()
        },
    };
    Ok((p, active, guard))
}
pub fn status(
    actor: &str,
    session_id: &str,
    workspace_root: &str,
    browser_session_id: Option<&str>,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
) -> Result<TfBrowserStatus, String> {
    if browser_session_id.is_some_and(|s| !valid_id(s)) {
        return Err("invalid-browser-session-id".into());
    }
    let root = scope(actor, session_id, workspace_root, registry)?;
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "browser-state-unavailable")?;
    reap(&mut entries);
    let item = browser_session_id.and_then(|id| entries.sessions.get(id));
    let item = item.filter(|s| s.actor == actor && s.session_id == session_id && s.root == root);
    let mut sessions: Vec<_> = entries
        .sessions
        .iter()
        .filter(|(_, s)| s.actor == actor && s.session_id == session_id && s.root == root)
        .map(|(id, s)| TfBrowserSessionSummary {
            browser_session_id: id.clone(),
            current_url: {
                #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
                if s.native.is_some() {
                    String::new()
                } else {
                    s.snapshot.url.clone()
                }
                #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
                {
                    s.snapshot.url.clone()
                }
            },
            snapshot_id: {
                #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
                if s.native.is_some() {
                    String::new()
                } else {
                    s.snapshot.id.clone()
                }
                #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
                {
                    s.snapshot.id.clone()
                }
            },
            history_length: s.history.len(),
            expires_in_secs: s
                .expires
                .saturating_duration_since(Instant::now())
                .as_secs(),
            engine: {
                #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
                if s.native.is_some() {
                    CONFINED_ENGINE
                } else {
                    ENGINE
                }
                #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
                {
                    ENGINE
                }
            },
            isolation: {
                #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
                if s.native.is_some() {
                    CONFINED_ISOLATION
                } else {
                    ISOLATION
                }
                #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
                {
                    ISOLATION
                }
            },
        })
        .collect();
    sessions.sort_by(|a, b| a.browser_session_id.cmp(&b.browser_session_id));
    Ok(TfBrowserStatus {
        available: true,
        exists: item.is_some(),
        browser_session_id: item.and_then(|_| browser_session_id.map(str::to_owned)),
        current_url: item.and_then(|s| {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if s.native.is_some() {
                None
            } else {
                Some(s.snapshot.url.clone())
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            {
                Some(s.snapshot.url.clone())
            }
        }),
        snapshot_id: item.and_then(|s| {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if s.native.is_some() {
                None
            } else {
                Some(s.snapshot.id.clone())
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            {
                Some(s.snapshot.id.clone())
            }
        }),
        history_length: item.map_or(0, |s| s.history.len()),
        expires_in_secs: item.map_or(0, |s| {
            s.expires
                .saturating_duration_since(Instant::now())
                .as_secs()
        }),
        busy: item.is_some_and(|s| s.busy),
        engine: {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if item.is_some_and(|s| s.native.is_some()) {
                CONFINED_ENGINE
            } else {
                ENGINE
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            {
                ENGINE
            }
        },
        isolation: {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if item.is_some_and(|s| s.native.is_some()) {
                CONFINED_ISOLATION
            } else {
                ISOLATION
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            {
                ISOLATION
            }
        },
        sessions,
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TfBrowserRequest {
    pub operation: TfBrowserOperation,
    pub actor: String,
    pub session_id: String,
    pub workspace_root: String,
    pub browser_session_id: Option<String>,
    pub url: Option<String>,
    pub snapshot_id: Option<String>,
    pub element_id: Option<String>,
    pub selector: Option<String>,
    pub text: Option<String>,
    pub timeout_ms: Option<u64>,
    pub max_bytes: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfBrowserPrepared {
    pub token: String,
    pub request_id: String,
    pub operation: TfBrowserOperation,
    pub requires_approval: bool,
    pub workspace_root: String,
    pub browser_session_id: Option<String>,
    pub engine: &'static str,
    pub isolation: &'static str,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfBrowserElement {
    pub id: String,
    pub text: String,
    pub url: String,
    /// The anchor is untrusted document metadata, not a vetted reachable URL.
    pub unverified: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfBrowserReceipt {
    pub tool_id: &'static str,
    pub request_id: String,
    pub actor: String,
    pub session_id: String,
    pub operation: TfBrowserOperation,
    pub browser_session_id: Option<String>,
    pub terminal: &'static str,
    pub effect_state: &'static str,
    pub reason_code: String,
    pub policy_decision: &'static str,
    pub retry: &'static str,
    pub auto_retry: bool,
    pub engine: &'static str,
    pub isolation: &'static str,
    pub requested_url: Option<String>,
    pub final_url: Option<String>,
    pub redirect_chain: Vec<String>,
    pub status_code: Option<u16>,
    pub content_type: Option<String>,
    pub bytes_received: Option<u64>,
    pub bytes_retained: usize,
    pub truncated: bool,
    /// SHA-256 of the retained inert extracted UTF-8 text, not the original
    /// remote HTML body bytes (TF3 separately attests its retained bytes).
    pub content_sha256: Option<String>,
    /// Inert extracted plain text. Never rendered HTML/DOM.
    pub body: Option<String>,
    pub snapshot_id: Option<String>,
    pub elements: Vec<TfBrowserElement>,
    pub started_at: u64,
    pub ended_at: u64,
    pub uncertainty: &'static str,
    pub dns_evidence: Vec<TfWebDnsEvidence>,
    pub unsupported: Vec<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfBrowserStatus {
    pub available: bool,
    pub exists: bool,
    pub browser_session_id: Option<String>,
    pub current_url: Option<String>,
    pub snapshot_id: Option<String>,
    pub history_length: usize,
    pub expires_in_secs: u64,
    pub busy: bool,
    pub engine: &'static str,
    pub isolation: &'static str,
    pub sessions: Vec<TfBrowserSessionSummary>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfBrowserSessionSummary {
    pub browser_session_id: String,
    pub current_url: String,
    pub snapshot_id: String,
    pub history_length: usize,
    pub expires_in_secs: u64,
    pub engine: &'static str,
    pub isolation: &'static str,
}

#[derive(Clone)]
struct Snapshot {
    id: String,
    url: String,
    body: String,
    content_sha256: String,
    elements: Vec<TfBrowserElement>,
    content_type: Option<String>,
    status_code: Option<u16>,
    bytes_received: Option<u64>,
    bytes_retained: usize,
    truncated: bool,
}
struct BrowserSession {
    actor: String,
    session_id: String,
    root: PathBuf,
    snapshot: Snapshot,
    history: Vec<String>,
    revision: u64,
    busy: bool,
    expires: Instant,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    native: Option<NativeBackground>,
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
struct NativeBackground {
    stop: watch::Sender<bool>,
    task: Option<JoinHandle<Result<(), String>>>,
    /// In-memory per-session projection of the canonical TF3 broker receipts.
    /// Not a parallel receipt database or an authoritative effect grant.
    receipts: Arc<Mutex<Vec<BrokerResourceReceipt>>>,
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl Drop for NativeBackground {
    fn drop(&mut self) {
        // Session expiry/removal cannot leave a detached native browser
        // running unattended; the background loop selects on this exact
        // sender and its owned Job Object is kill-on-close.
        self.stop.send_replace(true);
    }
}
#[derive(Clone)]
struct Pending {
    request: TfBrowserRequest,
    request_id: String,
    root: PathBuf,
    browser_id: Option<String>,
    url: Option<String>,
    revision: Option<u64>,
    expires: Instant,
    approved: bool,
    approving: bool,
}
struct Active {
    cancelled: AtomicBool,
    tf_web_token: Mutex<Option<String>>,
    cancel_watch: watch::Sender<bool>,
}
impl Default for Active {
    fn default() -> Self {
        let (cancel_watch, _) = watch::channel(false);
        Self {
            cancelled: AtomicBool::new(false),
            tf_web_token: Mutex::new(None),
            cancel_watch,
        }
    }
}
#[derive(Default)]
struct Entries {
    sessions: HashMap<String, BrowserSession>,
    pending: HashMap<String, Pending>,
    active: HashMap<String, Arc<Active>>,
}
#[derive(Default)]
pub struct TfBrowserState {
    entries: Mutex<Entries>,
}

fn millis() -> u64 {
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
fn valid_label(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
}
fn valid_id(value: &str) -> bool {
    value.len() == 48 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn scope(
    actor: &str,
    session_id: &str,
    workspace_root: &str,
    registry: &WorkspaceRegistry,
) -> Result<PathBuf, String> {
    if !valid_label(actor) || !valid_label(session_id) {
        return Err("invalid-actor-or-session".into());
    }
    if workspace_root.is_empty()
        || workspace_root.trim() != workspace_root
        || workspace_root.chars().any(char::is_control)
    {
        return Err("invalid-workspace-root".into());
    }
    let canonical = std::fs::canonicalize(workspace_root)
        .map_err(|_| "workspace-root-unavailable".to_owned())?;
    if !canonical.is_dir() || !registry.is_authorized(&canonical) {
        return Err("workspace-root-not-authorized".into());
    }
    Ok(canonical)
}
fn reap(entries: &mut Entries) {
    entries.pending.retain(|_, p| p.expires > Instant::now());
    entries
        .sessions
        .retain(|_, s| s.busy || s.expires > Instant::now());
}
fn matches_scope(session: &BrowserSession, req: &TfBrowserRequest, root: &Path) -> bool {
    session.actor == req.actor && session.session_id == req.session_id && session.root == root
}
fn valid_nav_url(raw: &str) -> Result<String, String> {
    // This is ONLY a cheap shape check, NOT a network authorization.
    // TF3 prepare + execute enforce authoritative URL policy and DNS on use.
    if raw.len() > MAX_URL
        || raw.trim() != raw
        || raw.bytes().any(|b| b.is_ascii_control() || b == b'\\')
    {
        return Err("invalid-navigation-url".into());
    }
    let parsed = Url::parse(raw).map_err(|_| "invalid-navigation-url".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str().is_none()
    {
        return Err("unsupported-navigation-scheme-or-userinfo".into());
    }
    // Don't trust local parser as an SSRF decision. TF3 checks again after
    // user consent and on every redirect, before any socket connection.
    Ok(parsed.to_string())
}
fn inert_link_metadata_allowed(url: &Url) -> bool {
    // Suppress links that visibly carry credential-like query names. This is
    // defense-in-depth for receipt metadata, NOT an alternative to TF3's
    // authoritative URL and per-hop IP/DNS policy at navigation time.
    !url.query_pairs().any(|(key, _)| {
        let name = key.to_ascii_lowercase().replace(['_', '-', '.'], "");
        [
            "apikey",
            "token",
            "secret",
            "password",
            "passwd",
            "credential",
            "authorization",
            "signature",
            "session",
            "cookie",
            "privatekey",
            "clientsecret",
            "jwt",
            "accesstoken",
            "refreshtoken",
        ]
        .iter()
        .any(|needle| name.contains(needle))
            || matches!(name.as_str(), "auth" | "code" | "sid" | "key" | "sig")
    })
}
fn ensure_request_shape(req: &TfBrowserRequest) -> Result<(), String> {
    if req.timeout_ms == Some(0)
        || req.timeout_ms.unwrap_or(MAX_TIMEOUT) > MAX_TIMEOUT
        || req.max_bytes == Some(0)
        || req.max_bytes.unwrap_or(MAX_NETWORK_BYTES) > MAX_NETWORK_BYTES
        || req.selector.as_ref().is_some_and(|s| s.len() > 256)
        || req.text.as_ref().is_some_and(|s| s.len() > 1024)
    {
        return Err("browser-bounds-denied".into());
    }
    match req.operation {
        TfBrowserOperation::Open | TfBrowserOperation::OpenConfined => {
            if req.browser_session_id.is_some()
                || req.url.is_none()
                || req.snapshot_id.is_some()
                || req.element_id.is_some()
                || req.selector.is_some()
                || req.text.is_some()
            {
                return Err("open-parameters-denied".into());
            }
            valid_nav_url(req.url.as_deref().unwrap())?;
            if req.operation == TfBrowserOperation::OpenConfined {
                let target =
                    Url::parse(req.url.as_deref().unwrap()).map_err(|_| "confined-url-invalid")?;
                // No raw credentials, paths, query, fragments, non-443
                // listener or private-address policy relaxation in the
                // process command line. TF3 independently rechecks every
                // remote resource and the model still cannot select this mode.
                if target.scheme() != "https"
                    || target.host_str().is_none()
                    || !target.username().is_empty()
                    || target.password().is_some()
                    || target.port().is_some_and(|port| port != 443)
                    || target.query().is_some()
                    || target.fragment().is_some()
                    || target.path() != "/"
                {
                    return Err("confined-initial-https-root-only".into());
                }
            }
        }
        TfBrowserOperation::Navigate => {
            if req.url.is_none()
                || req.snapshot_id.is_some()
                || req.element_id.is_some()
                || req.selector.is_some()
                || req.text.is_some()
            {
                return Err("navigate-parameters-denied".into());
            }
            valid_nav_url(req.url.as_deref().unwrap())?;
        }
        TfBrowserOperation::ClickLink => {
            if req.url.is_some()
                || req.selector.is_some()
                || req.text.is_some()
                || req.snapshot_id.as_deref().is_none_or(|s| !valid_id(s))
                || req.element_id.as_deref().is_none_or(|s| !valid_id(s))
            {
                return Err("click-link-parameters-denied".into());
            }
        }
        TfBrowserOperation::Back | TfBrowserOperation::Snapshot | TfBrowserOperation::Close => {
            if req.url.is_some()
                || req.element_id.is_some()
                || req.selector.is_some()
                || req.text.is_some()
                || (req.operation != TfBrowserOperation::Snapshot && req.snapshot_id.is_some())
                || req.snapshot_id.as_deref().is_some_and(|s| !valid_id(s))
            {
                return Err("browser-operation-parameters-denied".into());
            }
        }
        // Unsupported operations cannot acquire arbitrary selectors or scripts.
        _ => {
            if req.url.is_some()
                || req.element_id.is_some()
                || req.text.is_some()
                || req.selector.is_some()
                || req.snapshot_id.is_some()
            {
                return Err("unsupported-operation-parameters-denied".into());
            }
        }
    }
    if !matches!(
        req.operation,
        TfBrowserOperation::Open | TfBrowserOperation::OpenConfined
    ) && req
        .browser_session_id
        .as_deref()
        .is_none_or(|s| !valid_id(s))
    {
        return Err("browser-session-id-required".into());
    }
    Ok(())
}
pub fn prepare(
    req: TfBrowserRequest,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
) -> Result<TfBrowserPrepared, String> {
    ensure_request_shape(&req)?;
    if req.operation == TfBrowserOperation::OpenConfined && !confined_runtime_packaged() {
        return Err("confined-browser-not-packaged-or-security-unaccepted".into());
    }
    let root = scope(&req.actor, &req.session_id, &req.workspace_root, registry)?;
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "browser-state-unavailable")?;
    reap(&mut entries);
    if entries.pending.len() >= MAX_PENDING || entries.active.len() >= MAX_ACTIVE {
        return Err("browser-capacity-exceeded".into());
    }
    let (browser_id, revision, url) = if matches!(
        req.operation,
        TfBrowserOperation::Open | TfBrowserOperation::OpenConfined
    ) {
        if entries.sessions.len() >= MAX_SESSIONS {
            return Err("browser-session-capacity-exceeded".into());
        }
        (
            Some(nonce()?),
            None,
            req.url.as_deref().map(valid_nav_url).transpose()?,
        )
    } else {
        let id = req
            .browser_session_id
            .as_deref()
            .ok_or("browser-session-id-required")?;
        let session = entries.sessions.get(id).ok_or("browser-session-expired")?;
        if !matches_scope(session, &req, &root) {
            return Err("browser-session-scope-denied".into());
        }
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        if session.native.is_some() && req.operation != TfBrowserOperation::Close {
            return Err("confined-native-operation-not-yet-accepted".into());
        }
        if session.busy {
            return Err("browser-session-busy".into());
        }
        let url = match req.operation {
            TfBrowserOperation::Navigate => req.url.as_deref().map(valid_nav_url).transpose()?,
            TfBrowserOperation::ClickLink => {
                if req.snapshot_id.as_deref() != Some(session.snapshot.id.as_str()) {
                    return Err("browser-snapshot-stale".into());
                }
                let id = req.element_id.as_deref().ok_or("element-id-required")?;
                let element = session
                    .snapshot
                    .elements
                    .iter()
                    .find(|e| e.id == id)
                    .ok_or("element-not-in-snapshot")?;
                Some(valid_nav_url(&element.url)?)
            }
            TfBrowserOperation::Back => Some(
                session
                    .history
                    .last()
                    .ok_or("browser-history-empty")?
                    .clone(),
            ),
            TfBrowserOperation::Snapshot => {
                if req
                    .snapshot_id
                    .as_deref()
                    .is_some_and(|id| id != session.snapshot.id)
                {
                    return Err("browser-snapshot-stale".into());
                }
                None
            }
            _ => None,
        };
        (Some(id.to_owned()), Some(session.revision), url)
    };
    let request_id = nonce()?;
    let token = nonce()?;
    let prepared = TfBrowserPrepared {
        token: token.clone(),
        request_id: request_id.clone(),
        operation: req.operation,
        requires_approval: req.operation.network(),
        workspace_root: root.to_string_lossy().into_owned(),
        browser_session_id: browser_id.clone(),
        engine: if req.operation == TfBrowserOperation::OpenConfined {
            CONFINED_ENGINE
        } else {
            ENGINE
        },
        isolation: if req.operation == TfBrowserOperation::OpenConfined {
            CONFINED_ISOLATION
        } else {
            ISOLATION
        },
    };
    entries.pending.insert(
        token,
        Pending {
            request: req,
            request_id,
            root,
            browser_id,
            url,
            revision,
            expires: Instant::now() + PENDING_TTL,
            approved: !prepared.requires_approval,
            approving: false,
        },
    );
    Ok(prepared)
}

/// Native headless acceptance helper; never registered with Tauri invoke.
pub fn approve_headless(token: &str, state: &TfBrowserState) -> Result<(), String> {
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "browser-state-unavailable")?;
    reap(&mut entries);
    let p = entries
        .pending
        .get_mut(token)
        .ok_or("unknown-or-consumed-browser-token")?;
    if !p.request.operation.network() || p.approved || p.approving {
        return Err("browser-approval-not-applicable".into());
    }
    if p.request.operation == TfBrowserOperation::OpenConfined {
        return Err("confined-native-requires-visible-application-approval".into());
    }
    p.approved = true;
    Ok(())
}
pub fn cancel(token: &str, state: &TfBrowserState, web_state: &TfWebState) -> Result<bool, String> {
    let active = {
        let mut entries = state
            .entries
            .lock()
            .map_err(|_| "browser-state-unavailable")?;
        if entries.pending.remove(token).is_some() {
            return Ok(true);
        }
        entries.active.get(token).cloned()
    };
    let Some(active) = active else {
        return Ok(false);
    };
    active.cancelled.store(true, Ordering::SeqCst);
    active.cancel_watch.send_replace(true);
    let inner = active
        .tf_web_token
        .lock()
        .map_err(|_| "browser-active-state-unavailable")?;
    if let Some(token) = inner.as_deref() {
        let _ = tf_web::cancel(token, web_state);
    }
    Ok(true)
}
fn initial_receipt(p: &Pending) -> TfBrowserReceipt {
    TfBrowserReceipt {
        tool_id: TOOL_ID,
        request_id: p.request_id.clone(),
        actor: p.request.actor.clone(),
        session_id: p.request.session_id.clone(),
        operation: p.request.operation,
        browser_session_id: p.browser_id.clone(),
        terminal: "denied",
        effect_state: "NoEffect",
        reason_code: "not-executed".into(),
        policy_decision: "denied",
        retry: "not_attempted",
        auto_retry: false,
        engine: if p.request.operation == TfBrowserOperation::OpenConfined {
            CONFINED_ENGINE
        } else {
            ENGINE
        },
        isolation: if p.request.operation == TfBrowserOperation::OpenConfined {
            CONFINED_ISOLATION
        } else {
            ISOLATION
        },
        // TF3 is the URL authority. Do not echo raw credential-bearing
        // requests before TF3 has approved the normalized URL.
        requested_url: None,
        final_url: None,
        redirect_chain: Vec::new(),
        status_code: None,
        content_type: None,
        bytes_received: None,
        bytes_retained: 0,
        truncated: false,
        content_sha256: None,
        body: None,
        snapshot_id: None,
        elements: Vec::new(),
        started_at: millis(),
        ended_at: millis(),
        uncertainty: "no-network-effect-observed",
        dns_evidence: Vec::new(),
        unsupported: vec![
            "remote_wry_webview_navigation",
            "script_and_dom_execution",
            "form_submissions",
            "browser_storage_and_cookies",
            "popups_downloads_uploads",
            "screenshots",
            "os_browser_network_sandbox_and_peer_ip_attestation",
        ],
    }
}

/// Production-only read-only confined browser startup through the existing
/// TF4 one-use native authorization token. The feature and an app-build-pinned
/// host digest are BOTH required; neither a model request nor a mutable env
/// runtime setting can name an arbitrary executable or grant this capability.
/// The browser remains unexposed to models until all semantic/effectful gates
/// pass. The receipt explicitly does not claim DOM or external effect success.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
async fn execute_confined_native(
    token: &str,
    app: &tauri::AppHandle,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
) -> Result<TfBrowserReceipt, String> {
    let (p, active, _guard) = consume(token, registry, state)?;
    if p.request.operation != TfBrowserOperation::OpenConfined {
        return Err("confined-native-request-type-changed".into());
    }
    let mut receipt = initial_receipt(&p);
    receipt.unsupported = vec![
        "native_model_interaction_not_accepted",
        "native_semantic_snapshot_not_accepted",
        "form_submission_and_credentials",
        "screenshots_and_file_transfers",
        "popups_and_shared_storage",
    ];
    receipt.retry = "UNKNOWN";
    receipt.uncertainty = "native-session-start-unverified";
    let pinned = PINNED_NATIVE_HOST_SHA256
        .filter(|sha| sha.len() == 64 && sha.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or("confined-native-host-build-digest-not-pinned")?;
    let resource_root = app
        .path()
        .resource_dir()
        .map_err(|_| "confined-native-bundle-resources-unavailable")?;
    let host_executable = resource_root.join("clack-browser-host.exe");
    let private_parent = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "confined-native-appdata-unavailable")?
        .join("tf4-browser");
    std::fs::create_dir_all(&private_parent)
        .map_err(|_| "confined-native-private-parent-create-denied")?;
    // The launcher independently validates no reparse points, app-owned
    // executable digest and the canonical authorized workspace. This
    // request originated in an already approved TF4 token; the renderer can
    // neither choose the binary/path nor the credential/network policy.
    let start = BrowserRuntimeStart {
        actor: p.request.actor.clone(),
        session_id: p.request.session_id.clone(),
        workspace_root: p.root.clone(),
        initial_url: p.url.clone().ok_or("confined-initial-url-missing")?,
        private_parent,
        host_executable,
        host_sha256: pinned.to_owned(),
    };
    if active.cancelled.load(Ordering::Acquire) {
        receipt.terminal = "cancelled";
        receipt.reason_code = "confined-cancelled-before-launch".into();
        receipt.uncertainty = "no-browser-created";
        receipt.ended_at = millis();
        return Ok(receipt);
    }
    let launch_app = app.clone();
    let launch = tauri::async_runtime::spawn_blocking(move || {
        let registry = launch_app.state::<WorkspaceRegistry>();
        BrowserRuntimeSession::launch(start, &registry)
    })
    .await
    .map_err(|_| "confined-native-launch-task-unavailable")?;
    let mut browser = match launch {
        Ok(browser) => browser,
        Err(reason) => {
            receipt.terminal = "failed";
            receipt.reason_code = reason;
            receipt.uncertainty = "native-launch-rejected-before-resource-service";
            receipt.ended_at = millis();
            return Ok(receipt);
        }
    };
    let mut cancelled = active.cancel_watch.subscribe();
    let readiness = if *cancelled.borrow() {
        Err("confined-native-cancelled-during-launch".to_owned())
    } else {
        tokio::select! {
            ready = browser.verify_ready() => ready,
            changed = cancelled.changed() => {
                let _ = changed;
                Err("confined-native-cancelled-during-readiness".to_owned())
            }
        }
    };
    if let Err(reason) = readiness {
        let teardown = browser.shutdown();
        receipt.terminal = if active.cancelled.load(Ordering::Acquire) {
            "cancelled"
        } else {
            "failed"
        };
        receipt.reason_code = reason;
        receipt.uncertainty = if teardown.is_ok() {
            "native-readiness-failed-owned-job-drained"
        } else {
            "UNKNOWN-native-process-cleanup-unverified"
        };
        receipt.ended_at = millis();
        return Ok(receipt);
    }

    // One exact session is owned by the pre-existing TfBrowserState map.
    // This task only brokers bounded TF3 GET requests on a single serialized
    // pipe. No secondary registry, HTTP client, credential store or receipts
    // database is introduced. Dropping the one owner signals immediate stop.
    let (stop, mut stopped) = watch::channel(false);
    let receipts = Arc::new(Mutex::new(Vec::<BrokerResourceReceipt>::new()));
    let history = receipts.clone();
    let service_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let deadline = tokio::time::Instant::now() + SESSION_TTL;
        let mut terminal = Ok(());
        loop {
            if *stopped.borrow() || tokio::time::Instant::now() >= deadline {
                break;
            }
            let registry = service_app.state::<WorkspaceRegistry>();
            let web = service_app.state::<TfWebState>();
            let outcome = tokio::select! {
                changed = stopped.changed() => { let _ = changed; break; }
                result = tokio::time::timeout(
                    // TF3's bounded 5s fetch, sealed pipe delivery, and the
                    // independent UI-apartment COM-completion ACK must all
                    // finish. The old 6s wrapper could kill a valid pending
                    // request before the host's 9s native reply deadline.
                    // A deadline failure still revokes the owned Job and is
                    // reported UNKNOWN, never replayed.
                    Duration::from_secs(15), browser.serve_one(&registry, &web)
                ) => result,
            };
            match outcome {
                Ok(Ok(result)) => {
                    if let Ok(mut rows) = history.lock() {
                        if rows.len() >= 32 {
                            rows.remove(0);
                        }
                        rows.push(result);
                    }
                }
                Ok(Err(reason)) => {
                    terminal = Err(reason);
                    break;
                }
                Err(_) => {
                    terminal = Err("confined-broker-request-timeout-uncertain".into());
                    break;
                }
            }
        }
        let cleanup = browser.shutdown();
        if cleanup.is_err() {
            Err("confined-native-job-udf-cleanup-unverified".into())
        } else {
            terminal
        }
    });
    let native = NativeBackground {
        stop,
        task: Some(task),
        receipts,
    };
    let id = p
        .browser_id
        .clone()
        .ok_or("confined-native-id-unavailable")?;
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "browser-state-unavailable")?;
    if entries.sessions.len() >= MAX_SESSIONS || active.cancelled.load(Ordering::Acquire) {
        // The background task is dropped here; its stop signal revokes the
        // owner and kill-on-close Job, never admitting a stale session.
        receipt.terminal = "failed";
        receipt.reason_code = "confined-native-session-revoked-before-commit".into();
        receipt.uncertainty = "UNKNOWN-native-session-commit-race";
        receipt.ended_at = millis();
        return Ok(receipt);
    }
    let original_url = p.url.clone().ok_or("confined-native-url-unavailable")?;
    entries.sessions.insert(
        id.clone(),
        BrowserSession {
            actor: p.request.actor.clone(),
            session_id: p.request.session_id.clone(),
            root: p.root.clone(),
            snapshot: Snapshot {
                id: nonce()?,
                url: original_url,
                body: String::new(),
                content_sha256: String::new(),
                elements: Vec::new(),
                content_type: None,
                status_code: None,
                bytes_received: None,
                bytes_retained: 0,
                truncated: false,
            },
            history: Vec::new(),
            revision: 1,
            busy: false,
            expires: Instant::now() + SESSION_TTL,
            native: Some(native),
        },
    );
    receipt.terminal = "pending";
    receipt.reason_code = "confined-native-appcontainer-ready-broker-serving".into();
    receipt.policy_decision = "allowed";
    receipt.effect_state = "Unknown";
    receipt.uncertainty = "initial-document-completion-and-DOM-not-yet-observed";
    receipt.browser_session_id = Some(id);
    receipt.ended_at = millis();
    Ok(receipt)
}

/// Execute once: pending -> active is atomic. A session holds a single busy
/// lease while TF3 fetch runs; cancel forwards to the inner TF3 token.
pub async fn execute(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
    web_state: &TfWebState,
) -> Result<TfBrowserReceipt, String> {
    let (p, active, _guard) = consume(token, registry, state)?;
    let mut receipt = initial_receipt(&p);
    match p.request.operation {
        TfBrowserOperation::OpenConfined => {
            // Direct/headless callers have no authenticated installed-app
            // digest, approval context or verified lifecycle owner. No
            // implicit downgrade to the inert executor or unconfined WebView.
            receipt.terminal = "unsupported";
            receipt.reason_code = "confined-native-execution-requires-trusted-app-owner".into();
            receipt.retry = "not_attempted";
            receipt.uncertainty = "no-remote-browser-launched";
        }
        op if op.unsupported() => {
            receipt.terminal = "unsupported";
            receipt.reason_code = "unsupported-no-dom-or-script-execution".into();
            receipt.retry = "SAFE_RETRY";
        }
        TfBrowserOperation::Snapshot => {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if p.browser_id.as_deref().is_some_and(|id| {
                state.entries.lock().is_ok_and(|entries| {
                    entries.sessions.get(id).is_some_and(|s| s.native.is_some())
                })
            }) {
                receipt.terminal = "unsupported";
                receipt.reason_code = "confined-native-semantic-observation-not-accepted".into();
                receipt.retry = "SAFE_RETRY";
                receipt.uncertainty = "native-DOM-not-observed-or-verified";
                receipt.ended_at = millis();
                return Ok(receipt);
            }
            let snapshot = {
                let mut entries = state
                    .entries
                    .lock()
                    .map_err(|_| "browser-state-unavailable")?;
                let session = entries
                    .sessions
                    .get_mut(
                        p.browser_id
                            .as_deref()
                            .ok_or("browser-session-id-required")?,
                    )
                    .ok_or("browser-session-expired")?;
                session.expires = Instant::now() + SESSION_TTL;
                session.snapshot.clone()
            };
            clone_snapshot(&p, &snapshot, &mut receipt);
        }
        TfBrowserOperation::Close => {
            let mut removed = {
                let mut entries = state
                    .entries
                    .lock()
                    .map_err(|_| "browser-state-unavailable")?;
                let id = p
                    .browser_id
                    .as_deref()
                    .ok_or("browser-session-id-required")?;
                entries
                    .sessions
                    .remove(id)
                    .ok_or("browser-session-expired")?
            };
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if let Some(mut native) = removed.native.take() {
                native.stop.send_replace(true);
                // A native close is complete ONLY after the owned Job, UDF
                // and AppContainer profile cleanup task confirms success.
                // Unknown cleanup may not be optimistically reported as a
                // completed external effect or automatically replayed.
                let termination = if let Some(join) = native.task.take() {
                    tokio::time::timeout(Duration::from_secs(7), join).await
                } else {
                    receipt.terminal = "failed";
                    receipt.reason_code = "confined-native-task-owner-missing".into();
                    receipt.uncertainty = "UNKNOWN-native-close-no-task";
                    receipt.retry = "UNKNOWN";
                    receipt.ended_at = millis();
                    return Ok(receipt);
                };
                if let Ok(rows) = native.receipts.lock() {
                    receipt.bytes_retained = rows.iter().map(|r| r.bytes).sum::<usize>();
                    // Only proven TF3 receipts are projected, never the
                    // untrusted page content, credential values or arbitrary
                    // document JSON. Existing TF3 authority owns the records.
                    receipt.dns_evidence = rows
                        .iter()
                        .flat_map(|r| {
                            r.tf3
                                .as_ref()
                                .map_or_else(Vec::new, |receipt| receipt.dns_evidence.clone())
                        })
                        .take(32)
                        .collect();
                }
                match termination {
                    Ok(Ok(Ok(()))) => {
                        receipt.terminal = "completed";
                        receipt.effect_state = "Observed";
                        receipt.reason_code = "confined-owned-job-udf-profile-cleaned".into();
                        receipt.policy_decision = "allowed";
                        receipt.retry = "not_attempted";
                        receipt.uncertainty = "owned-native-session-terminated-observed";
                    }
                    _ => {
                        receipt.terminal = "failed";
                        receipt.effect_state = "Unknown";
                        receipt.reason_code = "confined-native-close-or-broker-failed".into();
                        receipt.policy_decision = "allowed";
                        receipt.retry = "UNKNOWN";
                        receipt.uncertainty = "UNKNOWN-native-process-or-effect-terminal";
                    }
                }
                receipt.ended_at = millis();
                return Ok(receipt);
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            let _ = removed;
            receipt.terminal = "completed";
            receipt.effect_state = "Observed";
            receipt.reason_code = "ephemeral-browser-session-closed".into();
            receipt.policy_decision = "allowed";
            receipt.retry = "SAFE_RETRY";
            receipt.uncertainty = "in-memory-session-removal-observed";
        }
        _ => {
            if active.cancelled.load(Ordering::SeqCst) {
                receipt.terminal = "cancelled";
                receipt.reason_code = "cancelled-before-network".into();
                receipt.retry = "SAFE_RETRY";
                receipt.ended_at = millis();
                return Ok(receipt);
            }
            let target = p
                .url
                .as_deref()
                .ok_or("browser-navigation-target-missing")?;
            let request = TfWebRequest {
                operation: TfWebOperation::HttpGet,
                actor: p.request.actor.clone(),
                session_id: p.request.session_id.clone(),
                workspace_root: p.root.to_string_lossy().into_owned(),
                url: Some(target.to_owned()),
                query: None,
                search_result_id: None,
                timeout_ms: p.request.timeout_ms,
                max_bytes: p.request.max_bytes,
                max_redirects: Some(5),
            };
            let prepared = match tf_web::prepare(request, registry, web_state) {
                Ok(result) => result,
                Err(reason) => {
                    receipt.reason_code = format!("tf3-preflight-{reason}");
                    receipt.retry = "SAFE_RETRY";
                    receipt.ended_at = millis();
                    return Ok(receipt);
                }
            };
            {
                let mut inner = active
                    .tf_web_token
                    .lock()
                    .map_err(|_| "browser-active-state-unavailable")?;
                *inner = Some(prepared.token.clone());
                if active.cancelled.load(Ordering::SeqCst) {
                    let _ = tf_web::cancel(&prepared.token, web_state);
                }
            }
            let web_result = tf_web::execute(&prepared.token, registry, web_state, None).await;
            if let Ok(mut inner) = active.tf_web_token.lock() {
                *inner = None;
            }
            let web = match web_result {
                Ok(receipt) => receipt,
                Err(_) => {
                    receipt.terminal = "failed";
                    receipt.reason_code = "tf3-execution-unavailable".into();
                    receipt.retry = "UNKNOWN";
                    receipt.uncertainty = "native-tf3-result-not-observed";
                    receipt.ended_at = millis();
                    return Ok(receipt);
                }
            };
            receipt.requested_url = web.requested_url.clone();
            receipt.final_url = web.final_url.clone();
            receipt.redirect_chain = web.redirect_chain.clone();
            receipt.status_code = web.status_code;
            receipt.content_type = web.content_type.clone();
            receipt.bytes_received = web.bytes_received;
            receipt.truncated = web.truncated;
            receipt.dns_evidence = web.dns_evidence;
            receipt.policy_decision = web.policy_decision;
            receipt.retry = web.retry;
            receipt.uncertainty = web.uncertainty;
            receipt.reason_code = web.reason_code.into();
            receipt.terminal = web.terminal;
            if active.cancelled.load(Ordering::SeqCst) {
                receipt.terminal = "cancelled";
                receipt.reason_code = "browser-navigation-cancelled".into();
                receipt.retry = "UNKNOWN";
                receipt.uncertainty = "network-may-have-completed-before-session-cancel";
                receipt.ended_at = millis();
                return Ok(receipt);
            }
            if web.terminal != "completed" {
                receipt.ended_at = millis();
                return Ok(receipt);
            }
            if !web.status_code.is_some_and(|s| (200..300).contains(&s)) {
                receipt.terminal = "failed";
                receipt.reason_code = "http-status-non-success".into();
                receipt.ended_at = millis();
                return Ok(receipt);
            }
            let Some(raw) = web.body else {
                receipt.terminal = "failed";
                receipt.reason_code = "tf3-document-body-unavailable".into();
                receipt.ended_at = millis();
                return Ok(receipt);
            };
            let final_url = web.final_url.ok_or("tf3-final-url-unavailable")?;
            let (text, elements, limited) = inert_document(
                &raw,
                web.content_type.as_deref().unwrap_or("text/plain"),
                &final_url,
            )?;
            let sha = format!("{:x}", Sha256::digest(text.as_bytes()));
            let snapshot = Snapshot {
                id: nonce()?,
                url: final_url,
                content_sha256: sha,
                body: text,
                elements,
                content_type: web.content_type,
                status_code: web.status_code,
                bytes_received: web.bytes_received,
                bytes_retained: 0,
                truncated: web.truncated || limited,
            };
            let mut snapshot = snapshot;
            snapshot.bytes_retained = snapshot.body.len();
            // Cancellation races are settled under the browser session lock:
            // if cancel wins before commit, no new session snapshot is stored.
            {
                let mut entries = state
                    .entries
                    .lock()
                    .map_err(|_| "browser-state-unavailable")?;
                if active.cancelled.load(Ordering::SeqCst) {
                    receipt.terminal = "cancelled";
                    receipt.reason_code = "browser-navigation-cancelled".into();
                    receipt.retry = "UNKNOWN";
                    receipt.uncertainty = "network-may-have-completed-before-session-cancel";
                    receipt.ended_at = millis();
                    return Ok(receipt);
                }
                if p.request.operation == TfBrowserOperation::Open {
                    if entries.sessions.len() >= MAX_SESSIONS {
                        receipt.terminal = "failed";
                        receipt.reason_code =
                            "browser-session-capacity-exceeded-after-fetch".into();
                        receipt.retry = "UNKNOWN";
                        receipt.uncertainty = "remote-request-completed-but-session-not-recorded";
                        receipt.ended_at = millis();
                        return Ok(receipt);
                    }
                    let id = p
                        .browser_id
                        .as_ref()
                        .ok_or("browser-id-unavailable")?
                        .clone();
                    entries.sessions.insert(
                        id,
                        BrowserSession {
                            actor: p.request.actor.clone(),
                            session_id: p.request.session_id.clone(),
                            root: p.root.clone(),
                            snapshot: snapshot.clone(),
                            history: Vec::new(),
                            revision: 1,
                            busy: false,
                            expires: Instant::now() + SESSION_TTL,
                            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
                            native: None,
                        },
                    );
                } else {
                    let session = entries
                        .sessions
                        .get_mut(
                            p.browser_id
                                .as_deref()
                                .ok_or("browser-session-id-required")?,
                        )
                        .ok_or("browser-session-expired")?;
                    if !matches_scope(session, &p.request, &p.root)
                        || Some(session.revision) != p.revision
                        || !session.busy
                    {
                        receipt.terminal = "failed";
                        receipt.reason_code = "browser-session-revision-changed-after-fetch".into();
                        receipt.retry = "UNKNOWN";
                        receipt.uncertainty = "remote-request-completed-but-session-not-recorded";
                        receipt.ended_at = millis();
                        return Ok(receipt);
                    }
                    if p.request.operation == TfBrowserOperation::Back {
                        session.history.pop();
                    } else {
                        session.history.push(session.snapshot.url.clone());
                        if session.history.len() > MAX_HISTORY {
                            session.history.remove(0);
                        }
                    }
                    session.snapshot = snapshot.clone();
                    session.revision = session.revision.saturating_add(1);
                    session.expires = Instant::now() + SESSION_TTL;
                }
            }
            clone_snapshot(&p, &snapshot, &mut receipt);
            receipt.reason_code = "inert-navigation-committed".into();
            receipt.effect_state = "Observed";
            receipt.uncertainty = "in-memory-session-observed-remote-peer-ip-not-attested";
        }
    }
    receipt.ended_at = millis();
    Ok(receipt)
}

#[tauri::command]
pub fn tf_browser_prepare(
    request: TfBrowserRequest,
    registry: tauri::State<'_, WorkspaceRegistry>,
    state: tauri::State<'_, TfBrowserState>,
) -> Result<TfBrowserPrepared, String> {
    prepare(request, &registry, &state)
}
#[tauri::command]
pub async fn tf_browser_approve(token: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let permit = APPROVAL_SLOTS
        .clone()
        .try_acquire_owned()
        .map_err(|_| "browser-native-dialog-capacity-exceeded".to_owned())?;
    let pending = {
        let state = app.state::<TfBrowserState>();
        let mut entries = state
            .entries
            .lock()
            .map_err(|_| "browser-state-unavailable")?;
        reap(&mut entries);
        let p = entries
            .pending
            .get_mut(&token)
            .ok_or("unknown-or-consumed-browser-token")?;
        if !p.request.operation.network() || p.approved || p.approving {
            return Err("browser-approval-not-applicable".into());
        }
        p.approving = true;
        p.clone()
    };
    // Explicitly do NOT display an arbitrary query string: it might contain
    // untrusted credentials, even though TF3 later rejects sensitive keys.
    let target = pending.url.as_deref().and_then(|v| Url::parse(v).ok());
    let host = target
        .as_ref()
        .and_then(|u| u.host_str())
        .unwrap_or("(unknown)");
    let native_confined = pending.request.operation == TfBrowserOperation::OpenConfined;
    let summary = format!(
        "Clack {} — allow once?\n\nRequest: {}\nActor: {}\nSession: {}\nWorkspace: {}\nOperation: {:?}\nTarget host: {}\n\n{}",
        if native_confined { "confined native browser HTTPS read-only session" } else { "inert-document network navigation" },
        pending.request_id, pending.request.actor, pending.request.session_id,
        pending.root.display(), pending.request.operation, host,
        if native_confined {
            "WebView2 must run in a zero-network-capability AppContainer with native process/Job and effective-UDF attestation before any navigation. TF3 policy is re-evaluated for each bounded HTTPS GET. Scripts, forms, popups, credentials, files and model interaction are DISABLED. Startup does not confirm DOM observation or any external effect."
        } else {
            "Only TF3 pinned HTTP(S) text retrieval is supported. No browser JS/DOM, popups, cookies, file upload/download or OS browser network sandbox is provided. Every redirect rechecks DNS/IP policy."
        },
    );
    let dialog_app = app.clone();
    let consent = tokio::time::timeout(
        PENDING_TTL,
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            dialog_app
                .dialog()
                .message(summary)
                .title(if native_confined {
                    "Clack Tool Fabric confined browser approval"
                } else {
                    "Clack Tool Fabric inert browser approval"
                })
                .buttons(MessageDialogButtons::OkCancel)
                .blocking_show()
        }),
    )
    .await
    .map_err(|_| "browser-native-approval-expired".to_owned())?
    .map_err(|_| "browser-native-dialog-unavailable".to_owned())?;
    if !consent {
        let web_state = app.state::<TfWebState>();
        let state = app.state::<TfBrowserState>();
        let _ = cancel(&token, &state, &web_state);
        return Err("browser-native-approval-denied".into());
    }
    let registry = app.state::<WorkspaceRegistry>();
    let root = scope(
        &pending.request.actor,
        &pending.request.session_id,
        &pending.request.workspace_root,
        &registry,
    )?;
    let state = app.state::<TfBrowserState>();
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "browser-state-unavailable")?;
    reap(&mut entries);
    let live = entries
        .pending
        .get_mut(&token)
        .ok_or("unknown-or-consumed-browser-token")?;
    if root != pending.root
        || live.request_id != pending.request_id
        || live.request.actor != pending.request.actor
        || live.request.session_id != pending.request.session_id
        || live.root != pending.root
        || live.url != pending.url
        || live.browser_id != pending.browser_id
        || live.revision != pending.revision
        || live.approved
        || !live.approving
        || !live.request.operation.network()
    {
        return Err("browser-native-approval-scope-changed".into());
    }
    live.approved = true;
    live.approving = false;
    Ok(())
}
#[tauri::command]
pub async fn tf_browser_execute(
    token: String,
    app: tauri::AppHandle,
) -> Result<TfBrowserReceipt, String> {
    let registry = app.state::<WorkspaceRegistry>();
    let state = app.state::<TfBrowserState>();
    let web_state = app.state::<TfWebState>();
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    {
        let is_confined = state
            .entries
            .lock()
            .map_err(|_| "browser-state-unavailable")?
            .pending
            .get(&token)
            .is_some_and(|p| p.request.operation == TfBrowserOperation::OpenConfined);
        if is_confined {
            return execute_confined_native(&token, &app, &registry, &state).await;
        }
    }
    execute(&token, &registry, &state, &web_state).await
}
#[tauri::command]
pub fn tf_browser_cancel(
    token: String,
    state: tauri::State<'_, TfBrowserState>,
    web_state: tauri::State<'_, TfWebState>,
) -> Result<bool, String> {
    cancel(&token, &state, &web_state)
}
#[tauri::command]
pub fn tf_browser_status(
    actor: String,
    session_id: String,
    workspace_root: String,
    browser_session_id: Option<String>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    state: tauri::State<'_, TfBrowserState>,
) -> Result<TfBrowserStatus, String> {
    status(
        &actor,
        &session_id,
        &workspace_root,
        browser_session_id.as_deref(),
        &registry,
        &state,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn setup() -> (
        tempfile::TempDir,
        WorkspaceRegistry,
        TfBrowserState,
        TfWebState,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(dir.path()).unwrap();
        (
            dir,
            registry,
            TfBrowserState::default(),
            TfWebState::default(),
        )
    }
    fn req(root: &Path, operation: TfBrowserOperation) -> TfBrowserRequest {
        TfBrowserRequest {
            operation,
            actor: "fixture-actor".into(),
            session_id: "session-1".into(),
            workspace_root: root.to_string_lossy().into_owned(),
            browser_session_id: None,
            url: None,
            snapshot_id: None,
            element_id: None,
            selector: None,
            text: None,
            timeout_ms: None,
            max_bytes: None,
        }
    }
    fn fake_session(root: &Path, state: &TfBrowserState) -> (String, String, String) {
        let id = nonce().unwrap();
        let sid = nonce().unwrap();
        let link = nonce().unwrap();
        let snapshot = Snapshot {
            id: sid.clone(),
            url: "https://example.org/original".into(),
            body: "Inert fixture".into(),
            content_sha256: format!("{:x}", Sha256::digest(b"Inert fixture")),
            elements: vec![TfBrowserElement {
                id: link.clone(),
                text: "Private".into(),
                url: "http://169.254.169.254/latest/meta-data".into(),
                unverified: true,
            }],
            content_type: Some("text/html".into()),
            status_code: Some(200),
            bytes_received: Some(14),
            bytes_retained: 13,
            truncated: false,
        };
        let mut entries = state.entries.lock().unwrap();
        entries.sessions.insert(
            id.clone(),
            BrowserSession {
                actor: "fixture-actor".into(),
                session_id: "session-1".into(),
                root: std::fs::canonicalize(root).unwrap(),
                snapshot,
                history: vec!["http://127.0.0.1/previous".into()],
                revision: 1,
                busy: false,
                expires: Instant::now() + SESSION_TTL,
                #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
                native: None,
            },
        );
        (id, sid, link)
    }
    #[test]
    fn html_is_inert_no_script_form_style_and_only_explicit_unverified_links() {
        let html = r#"<html><head><script>fetch('/private')</script>
            <style>.s{color:red}</style></head><body>
            <h1>Hello &amp; friends</h1>
            <a href='/docs?q=safe'>Documentation</a>
            <a href='javascript:alert(1)'>Unsafe JavaScript</a>
            <form action='/upload'><input type='file'>private form body</form>
            <iframe src='http://127.0.0.1'>iframe contents</iframe>
            <a href='http://127.0.0.1/local#fragment'>Untrusted local</a>
            </body></html>"#;
        let (body, links, truncated) =
            inert_document(html, "text/html;charset=utf-8", "https://example.org/start").unwrap();
        assert!(!truncated);
        assert!(body.contains("Hello & friends"));
        assert!(body.contains("Documentation"));
        for blocked in [
            "fetch(",
            "color:red",
            "private form body",
            "iframe contents",
        ] {
            assert!(!body.contains(blocked), "{blocked}");
        }
        assert_eq!(links.len(), 2); // javascript is never actionable
        assert_eq!(links[0].url, "https://example.org/docs?q=safe");
        assert_eq!(links[1].url, "http://127.0.0.1/local");
        assert!(links.iter().all(|l| valid_id(&l.id) && l.unverified));
        assert_eq!(links[0].text, "Documentation");
    }
    #[test]
    fn inert_snapshot_is_bounded_and_does_not_fetch_subresources() {
        let html = "<a href='/x'>x</a>".repeat(200);
        let (body, links, truncated) =
            inert_document(&html, "text/html", "https://example.org/").unwrap();
        assert_eq!(links.len(), MAX_ELEMENTS);
        assert!(!truncated);
        assert!(body.len() <= MAX_TEXT);
        let (body, elements, cut) =
            inert_document(&"xyz".repeat(30000), "text/plain", "https://example.org/").unwrap();
        assert!(cut);
        assert_eq!(body.len(), MAX_TEXT);
        assert!(elements.is_empty());
        let (_, elements, _) = inert_document(
            r#"{"body":"<script>hi</script>"}"#,
            "application/json",
            "https://example.org/",
        )
        .unwrap();
        assert!(elements.is_empty());
    }
    #[test]
    fn url_and_request_schema_reject_unsafe_shapes() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://u:p@example.org/a",
            " http://example.org/ ",
            "http://exa\\mple.org/",
        ] {
            assert!(valid_nav_url(url).is_err(), "accepted: {url}");
        }
        assert!(valid_nav_url("https://example.org/path").is_ok());
        let (dir, registry, state, _) = setup();
        let mut request = req(dir.path(), TfBrowserOperation::Open);
        request.url = Some("https://example.org".into());
        request.selector = Some("*".into());
        assert!(prepare(request, &registry, &state).is_err());
        let value = json!({
            "operation":"open","actor":"fixture-actor","sessionId":"session-1",
            "workspaceRoot":dir.path().to_string_lossy(),"url":"https://example.org",
            "untrustedOverride":"yes"
        });
        assert!(serde_json::from_value::<TfBrowserRequest>(value).is_err());
    }
    #[test]
    fn workspace_approval_cancel_and_token_replay_are_scoped() {
        let (dir, registry, state, web) = setup();
        let mut r = req(dir.path(), TfBrowserOperation::Open);
        r.url = Some("https://example.org".into());
        assert!(prepare(r.clone(), &WorkspaceRegistry::default(), &state).is_err());
        let p = prepare(r.clone(), &registry, &state).unwrap();
        assert_eq!(p.engine, ENGINE);
        assert!(p.requires_approval && p.browser_session_id.is_some());
        assert!(cancel(&p.token, &state, &web).unwrap());
        assert!(!cancel(&p.token, &state, &web).unwrap());
        assert!(consume(&p.token, &registry, &state).is_err());
        let p = prepare(r, &registry, &state).unwrap();
        assert!(consume(&p.token, &registry, &state).is_err());
        assert!(approve_headless(&p.token, &state).is_err());
    }
    #[tokio::test]
    async fn every_native_navigation_reuses_tf3_and_denies_private_metadata() {
        let (dir, registry, state, web) = setup();
        for target in [
            "http://127.0.0.1/",
            "http://2130706433/",
            "http://169.254.169.254/latest/meta-data",
        ] {
            let mut r = req(dir.path(), TfBrowserOperation::Open);
            r.url = Some(target.into());
            let p = prepare(r, &registry, &state).unwrap();
            assert!(approve_headless(&p.token, &state).is_ok());
            let receipt = execute(&p.token, &registry, &state, &web).await.unwrap();
            assert_eq!(receipt.tool_id, TOOL_ID);
            assert_eq!(
                receipt.reason_code, "dns-private-or-reserved-denied",
                "{target}"
            );
            assert!(receipt.body.is_none());
            assert!(receipt.snapshot_id.is_none());
            assert!(receipt.dns_evidence.iter().all(|d| !d.socket_ip_observed));
            assert!(execute(&p.token, &registry, &state, &web).await.is_err());
        }
        let status = status(
            "fixture-actor",
            "session-1",
            dir.path().to_str().unwrap(),
            None,
            &registry,
            &state,
        )
        .unwrap();
        assert!(status.available && status.sessions.is_empty());
    }
    #[tokio::test]
    async fn cached_snapshot_exact_refs_and_close_never_spawn_network() {
        let (dir, registry, state, web) = setup();
        let (id, sid, _) = fake_session(dir.path(), &state);
        let mut r = req(dir.path(), TfBrowserOperation::Snapshot);
        r.browser_session_id = Some(id.clone());
        r.snapshot_id = Some(sid.clone());
        let p = prepare(r.clone(), &registry, &state).unwrap();
        assert!(!p.requires_approval);
        let receipt = execute(&p.token, &registry, &state, &web).await.unwrap();
        assert_eq!(receipt.terminal, "completed");
        assert_eq!(receipt.body.as_deref(), Some("Inert fixture"));
        assert_eq!(receipt.snapshot_id.as_deref(), Some(sid.as_str()));
        assert!(receipt.dns_evidence.is_empty());
        assert!(execute(&p.token, &registry, &state, &web).await.is_err());
        r.snapshot_id = Some(nonce().unwrap());
        assert!(prepare(r.clone(), &registry, &state).is_err());
        let mut close = req(dir.path(), TfBrowserOperation::Close);
        close.browser_session_id = Some(id.clone());
        let p = prepare(close, &registry, &state).unwrap();
        let receipt = execute(&p.token, &registry, &state, &web).await.unwrap();
        assert_eq!(receipt.reason_code, "ephemeral-browser-session-closed");
        assert_eq!(receipt.effect_state, "Observed");
        assert!(
            !status(
                "fixture-actor",
                "session-1",
                dir.path().to_str().unwrap(),
                Some(&id),
                &registry,
                &state
            )
            .unwrap()
            .exists
        );
    }
    #[tokio::test]
    async fn link_handle_is_snapshot_bound_and_target_rechecked_by_tf3() {
        let (dir, registry, state, web) = setup();
        let (id, sid, link) = fake_session(dir.path(), &state);
        let mut r = req(dir.path(), TfBrowserOperation::ClickLink);
        r.browser_session_id = Some(id.clone());
        r.snapshot_id = Some(nonce().unwrap());
        r.element_id = Some(link.clone());
        assert!(prepare(r.clone(), &registry, &state).is_err());
        r.snapshot_id = Some(sid.clone());
        r.element_id = Some(nonce().unwrap());
        assert!(prepare(r.clone(), &registry, &state).is_err());
        r.element_id = Some(link);
        let p = prepare(r.clone(), &registry, &state).unwrap();
        assert!(p.requires_approval);
        approve_headless(&p.token, &state).unwrap();
        let receipt = execute(&p.token, &registry, &state, &web).await.unwrap();
        assert_eq!(receipt.reason_code, "dns-private-or-reserved-denied");
        assert!(receipt.snapshot_id.is_none());
        let s = status(
            "fixture-actor",
            "session-1",
            dir.path().to_str().unwrap(),
            Some(&id),
            &registry,
            &state,
        )
        .unwrap();
        assert_eq!(s.snapshot_id, Some(sid)); // denial never changed session
        assert!(!s.busy);
    }
    #[tokio::test]
    async fn unsafe_dom_actions_are_truthful_unsupported_receipts() {
        let (dir, registry, state, web) = setup();
        let (id, _, _) = fake_session(dir.path(), &state);
        for op in [
            TfBrowserOperation::Click,
            TfBrowserOperation::Type,
            TfBrowserOperation::Scroll,
            TfBrowserOperation::Screenshot,
        ] {
            let mut r = req(dir.path(), op);
            r.browser_session_id = Some(id.clone());
            let p = prepare(r, &registry, &state).unwrap();
            assert!(!p.requires_approval);
            let observed = execute(&p.token, &registry, &state, &web).await.unwrap();
            assert_eq!(observed.terminal, "unsupported");
            assert_eq!(observed.effect_state, "NoEffect");
            assert!(observed.unsupported.contains(&"script_and_dom_execution"));
            assert!(observed.dns_evidence.is_empty());
        }
    }
    #[test]
    fn status_enumeration_is_actor_session_root_bound() {
        let (dir, registry, state, _) = setup();
        let (id, sid, _) = fake_session(dir.path(), &state);
        let root = dir.path().to_str().unwrap();
        let own = status("fixture-actor", "session-1", root, None, &registry, &state).unwrap();
        assert_eq!(own.sessions.len(), 1);
        assert_eq!(own.sessions[0].snapshot_id, sid);
        assert_eq!(own.sessions[0].browser_session_id, id);
        let outsider = status(
            "different-actor",
            "session-1",
            root,
            None,
            &registry,
            &state,
        )
        .unwrap();
        assert!(outsider.sessions.is_empty());
        assert!(
            !status(
                "different-actor",
                "session-1",
                root,
                Some(&id),
                &registry,
                &state
            )
            .unwrap()
            .exists
        );
        assert!(status(
            "fixture-actor",
            "session-2",
            root,
            Some(&id),
            &registry,
            &state
        )
        .unwrap()
        .sessions
        .is_empty());
        assert!(status(
            "fixture-actor",
            "session-1",
            root,
            None,
            &WorkspaceRegistry::default(),
            &state
        )
        .is_err());
    }
    #[test]
    fn stale_revision_busy_session_and_ttl_are_authoritative() {
        let (dir, registry, state, _) = setup();
        let (id, sid, _) = fake_session(dir.path(), &state);
        let mut r = req(dir.path(), TfBrowserOperation::Snapshot);
        r.browser_session_id = Some(id.clone());
        r.snapshot_id = Some(sid);
        let p = prepare(r.clone(), &registry, &state).unwrap();
        {
            let mut entries = state.entries.lock().unwrap();
            let s = entries.sessions.get_mut(&id).unwrap();
            s.revision += 1;
        }
        assert!(consume(&p.token, &registry, &state).is_err());
        {
            let mut entries = state.entries.lock().unwrap();
            entries.sessions.get_mut(&id).unwrap().busy = true;
        }
        assert!(prepare(r.clone(), &registry, &state).is_err());
        {
            let mut entries = state.entries.lock().unwrap();
            let s = entries.sessions.get_mut(&id).unwrap();
            s.busy = false;
            s.expires = Instant::now() - Duration::from_secs(1);
        }
        assert!(prepare(r, &registry, &state).is_err());
    }
    #[test]
    fn active_cancel_forwards_to_exact_tf3_token() {
        let (dir, registry, state, web) = setup();
        let prepared = tf_web::prepare(
            TfWebRequest {
                operation: TfWebOperation::HttpGet,
                actor: "fixture-actor".into(),
                session_id: "session-1".into(),
                workspace_root: dir.path().to_string_lossy().into_owned(),
                url: Some("https://example.org".into()),
                query: None,
                search_result_id: None,
                timeout_ms: None,
                max_bytes: None,
                max_redirects: None,
            },
            &registry,
            &web,
        )
        .unwrap();
        let active = Arc::new(Active::default());
        *active.tf_web_token.lock().unwrap() = Some(prepared.token.clone());
        let outer = nonce().unwrap();
        state
            .entries
            .lock()
            .unwrap()
            .active
            .insert(outer.clone(), active.clone());
        assert!(cancel(&outer, &state, &web).unwrap());
        assert!(active.cancelled.load(Ordering::SeqCst));
        assert!(tf_web::cancel(&prepared.token, &web).unwrap() == false);
    }

    #[test]
    fn anchor_receipts_suppress_credential_query_names() {
        let html = "<a href='/safe?search=rust'>Safe</a>\n<a href='/danger?api_token=secret'>Never</a>\n<a href='/bad?x-authorization=y'>Never</a>";
        let (text, links, _) =
            inert_document(html, "text/html", "https://example.org/index").unwrap();
        assert!(text.contains("Never")); // untrusted page text remains inert
        assert_eq!(
            links.len(),
            1,
            "never turn tokenized links into actionable refs"
        );
        assert_eq!(links[0].url, "https://example.org/safe?search=rust");
    }
    #[test]
    fn native_approval_claim_is_single_dialog_and_single_use() {
        let (dir, registry, state, _) = setup();
        let mut request = req(dir.path(), TfBrowserOperation::Open);
        request.url = Some("https://example.org/".into());
        let p = prepare(request, &registry, &state).unwrap();
        {
            let mut entries = state.entries.lock().unwrap();
            entries.pending.get_mut(&p.token).unwrap().approving = true;
        }
        assert!(approve_headless(&p.token, &state).is_err());
        {
            let mut entries = state.entries.lock().unwrap();
            entries.pending.get_mut(&p.token).unwrap().approving = false;
        }
        assert!(approve_headless(&p.token, &state).is_ok());
        assert!(approve_headless(&p.token, &state).is_err());
    }
    #[test]
    fn bounded_pending_capacity_and_no_unapproved_side_effect() {
        let (dir, registry, state, web) = setup();
        let mut request = req(dir.path(), TfBrowserOperation::Open);
        request.url = Some("https://example.org/".into());
        let mut tokens = Vec::new();
        for _ in 0..MAX_PENDING {
            tokens.push(prepare(request.clone(), &registry, &state).unwrap().token);
        }
        assert!(prepare(request.clone(), &registry, &state).is_err());
        assert!(status(
            "fixture-actor",
            "session-1",
            dir.path().to_str().unwrap(),
            None,
            &registry,
            &state
        )
        .unwrap()
        .sessions
        .is_empty());
        for token in tokens {
            assert!(cancel(&token, &state, &web).unwrap());
        }
        assert!(prepare(request, &registry, &state).is_ok());
    }
}
