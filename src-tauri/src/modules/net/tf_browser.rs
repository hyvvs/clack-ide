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
    BrokerResourceReceipt, BrowserRuntimeSession, BrowserRuntimeStart, NativeFormIntent,
    NativePopupIntent, NativeScreenshotCapture,
};
use super::tf_browser_runtime::BrowserResourceCapability;
use super::tf_web::{self, TfWebDnsEvidence, TfWebOperation, TfWebRequest, TfWebState};
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
use crate::modules::secrets::{self, SecretsState};
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
use crate::modules::tf_operations::{self, Tf4ScreenshotEvidence};
use crate::modules::workspace::WorkspaceRegistry;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
use std::sync::atomic::AtomicU8;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
use tauri::async_runtime::JoinHandle;
use tauri::Manager;
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
use tokio::sync::{mpsc, oneshot};
use tokio::sync::{watch, Semaphore};

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
use super::tf_browser_contract::{
    ActionTarget, BrowserEffect, NativeEffectOutcome, NativeEffectReceipt, NativeEffectTerminal,
    PageSnapshot, SemanticRole,
};
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
use super::tf_browser_runtime::NativeConsumedExactClickApproval;
use super::tf_browser_runtime::NativeRetainedAction;
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
use super::tf_browser_runtime::{
    NativeActionReservation, NativeControlTurnRequester, NativeExactClickApprovalScope,
};

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
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
const NATIVE_CLICK_QUEUED: u8 = 0;
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
const NATIVE_CLICK_DISPATCH_COMMITTED: u8 = 1;
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
const NATIVE_CLICK_CANCELLED: u8 = 2;
static APPROVAL_SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(1)));

fn confined_runtime_packaged() -> bool {
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    {
        PINNED_NATIVE_HOST_SHA256.is_some_and(|digest| {
            digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit())
        })
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
    /// Explicit app-owned isolated tab, never a WebView2 popup or model tool.
    OpenConfinedTab,
    /// A WebView2 popup *already vetoed* by the original confined host.
    /// Requires the one-use native popup intent and fresh visible consent;
    /// reuses OpenConfinedTab's independent AppContainer/UDF child launcher.
    OpenRequestedPopup,
    /// Internal application-owned native observation, deliberately absent
    /// from current model tool registration until full TF4 acceptance.
    ObserveConfined,
    Navigate,
    Snapshot,
    ClickLink,
    Back,
    Close,
    /// Emergency stop/cleanup of an isolated native session through its
    /// trusted application owner; deliberately NOT registered as a model tool.
    CloseConfined,
    Click,
    /// Explicitly consented original retained <a target="_blank"> gesture.
    /// It may only create a vetoed native popup intent; launching the child
    /// independently requires OpenRequestedPopup and fresh central consent.
    TriggerPagePopup,
    Type,
    Clear,
    Select,
    Check,
    Uncheck,
    Scroll,
    Submit,
    Screenshot,
    /// Native-only trusted-broker GET with one origin-scoped opaque keyring
    /// reference. Never registered as a model browser tool before acceptance.
    CredentialGet,
    /// A genuine TF4-consented, same-native-page TF3 GET committed through
    /// TF2 to one no-clobber workspace file. Deliberately not model-exposed.
    Download,
    /// A genuine TF4-consented TF2 original workspace file read sent as one
    /// exact-body TF3 POST, never a renderer file picker or arbitrary upload.
    Upload,
}
impl TfBrowserOperation {
    fn network(self) -> bool {
        matches!(
            self,
            Self::Open
                | Self::OpenConfined
                | Self::OpenConfinedTab
                | Self::OpenRequestedPopup
                | Self::Navigate
                | Self::ClickLink
                | Self::Back
        )
    }
    fn opens_session(self) -> bool {
        matches!(
            self,
            Self::Open | Self::OpenConfined | Self::OpenConfinedTab | Self::OpenRequestedPopup
        )
    }
    fn opens_child(self) -> bool {
        matches!(self, Self::OpenConfinedTab | Self::OpenRequestedPopup)
    }
    fn unsupported(self) -> bool {
        matches!(
            self,
            Self::Click
                | Self::TriggerPagePopup
                | Self::Type
                | Self::Clear
                | Self::Select
                | Self::Check
                | Self::Uncheck
                | Self::Scroll
                | Self::Submit
                | Self::Screenshot
                | Self::CredentialGet
                | Self::Download
                | Self::Upload
        )
    }
    fn native_action(self) -> bool {
        matches!(
            self,
            Self::Click
                | Self::TriggerPagePopup
                | Self::Type
                | Self::Clear
                | Self::Select
                | Self::Check
                | Self::Uncheck
                | Self::Scroll
                | Self::Submit
        )
    }
    fn approval_required(self) -> bool {
        // DOM effects require actual application consent even when the
        // destination is the currently approved origin. A test/headless
        // allowance must never be sufficient for a native gesture.
        self.network() || self == Self::ObserveConfined || self.native_action()
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
        .trim_start_matches(['/', '!']);
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
    if p.request.operation.opens_session() {
        if !session_capacity_available(&entries) {
            return Err("browser-session-capacity-exceeded".into());
        }
        if p.request.operation.opens_child() {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if p.request.operation == TfBrowserOperation::OpenRequestedPopup
                && p.popup_intent.as_ref().is_none_or(|popup| {
                    popup.destination != p.url.clone().unwrap_or_default()
                        || popup.page_generation != 1
                        || popup.expires_at <= Instant::now()
                })
            {
                return Err("popup-original-intent-not-consumed-before-approval".into());
            }
            let opener = validate_tab_opener(&entries, &p.request, &p.root, p.revision, false)?;
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if p.request.operation == TfBrowserOperation::OpenRequestedPopup {
                let intent = p.popup_intent.as_ref()
                    .ok_or("popup-original-native-intent-missing")?;
                let original = entries.sessions.get(&opener)
                    .ok_or("popup-original-native-opener-expired")?;
                if intent.id.len() != 64
                    || !intent.id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                    || intent.source_sha256 != format!(
                        "{:x}", Sha256::digest(original.snapshot.url.as_bytes())
                    )
                {
                    return Err("popup-original-source-or-intent-identity-changed".into());
                }
            }
            entries
                .sessions
                .get_mut(&opener)
                .ok_or("tab-opener-expired")?
                .busy = true;
        }
    } else {
        let id = p
            .browser_id
            .as_deref()
            .ok_or("browser-session-id-required")?;
        if entries.active.contains_key(token) {
            return Err("native-click-active-token-conflict".into());
        }
        let session = entries
            .sessions
            .get_mut(id)
            .ok_or("browser-session-expired")?;
        if !matches_scope(session, &p.request, &p.root) || p.revision != Some(session.revision) {
            return Err("browser-session-revision-or-scope-changed".into());
        }
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        if session.native.is_some()
            && !matches!(
                p.request.operation,
                TfBrowserOperation::CloseConfined
                    | TfBrowserOperation::ObserveConfined
                    | TfBrowserOperation::CredentialGet
                    | TfBrowserOperation::Download
                    | TfBrowserOperation::Upload
            )
        {
            return Err("confined-native-action-observation-not-accepted".into());
        }
        if session.busy {
            // Close may compete with a queued native action through the same
            // atomic dispatch boundary. A committed action keeps its lease;
            // close cannot claim to have cancelled an irreversible effect.
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if p.request.operation == TfBrowserOperation::CloseConfined {
                let reservation = session
                    .native_reserved_action
                    .clone()
                    .ok_or("browser-session-busy")?;
                let active = entries
                    .active
                    .get(&reservation)
                    .ok_or("browser-session-busy")?;
                if !cancel_queued_native_action(active) {
                    return Err("browser-session-busy".into());
                }
                entries.pending.remove(&reservation);
                let session = entries
                    .sessions
                    .get_mut(id)
                    .ok_or("browser-session-expired")?;
                session.native_reserved_action = None;
                session.busy = true;
                let active = Arc::new(Active::default());
                entries.active.insert(token.to_owned(), active.clone());
                let guard = ActiveGuard {
                    state,
                    token: token.to_owned(),
                    browser_id: Some(id.to_owned()),
                };
                return Ok((p, active, guard));
            }
            return Err("browser-session-busy".into());
        }
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        if p.request.operation == TfBrowserOperation::CredentialGet {
            let c = p
                .credential_scope
                .as_ref()
                .ok_or("native-origin-credential-consent-scope-missing")?;
            let owner = session
                .native
                .as_ref()
                .ok_or("native-origin-credential-isolated-owner-required")?;
            if !owner.owner_alive.load(Ordering::Acquire) {
                return Err("native-origin-credential-owner-closed".into());
            }
            let page = owner
                .snapshot
                .lock()
                .map_err(|_| "native-origin-credential-observation-unavailable")?
                .clone()
                .ok_or("native-origin-credential-live-page-required")?;
            if page.truncated
                || c.page.browser_session_id != page.browser_session_id
                || c.page.page_id != page.page_id
                || c.page.page_generation != page.page_generation
                || c.page.snapshot_id != page.snapshot_id
                || c.page.url != page.url
                || c.page.url != session.snapshot.url
                || c.origin.origin() != c.destination.origin()
                || p.url.as_deref() != Some(c.page.url.as_str())
            {
                return Err("native-origin-credential-current-original-page-stale".into());
            }
        }
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        if matches!(
            p.request.operation,
            TfBrowserOperation::Download | TfBrowserOperation::Upload
        ) {
            let transfer = p
                .transfer_scope
                .as_ref()
                .ok_or("native-transfer-consumed-TF4-approved-scope-required")?;
            let native = session
                .native
                .as_ref()
                .ok_or("native-transfer-genuine-WebView2-owner-required")?;
            if !native.owner_alive.load(Ordering::Acquire) {
                return Err("native-transfer-owner-closed".into());
            }
            let page = native
                .snapshot
                .lock()
                .map_err(|_| "native-transfer-snapshot-unavailable")?
                .clone()
                .ok_or("native-transfer-original-snapshot-lost")?;
            if page.truncated
                || transfer.page.browser_session_id != page.browser_session_id
                || transfer.page.page_id != page.page_id
                || transfer.page.page_generation != page.page_generation
                || transfer.page.snapshot_id != page.snapshot_id
                || transfer.page.url != page.url
                || transfer.page.url != session.snapshot.url
                || transfer.approved_origin.origin() != transfer.destination.origin()
                || p.url.as_deref() != Some(transfer.page.url.as_str())
                || p.request.url.as_deref() != Some(transfer.destination.as_str())
                || (p.request.operation == TfBrowserOperation::Upload)
                    != transfer.upload_file.is_some()
            {
                return Err("native-transfer-original-consent-page-file-or-origin-stale".into());
            }
        }
        if p.request.operation == TfBrowserOperation::ClickLink
            && (p.request.snapshot_id.as_deref() != Some(&session.snapshot.id)
                || !session.snapshot.elements.iter().any(|e| {
                    p.request.element_id.as_deref() == Some(e.id.as_str())
                        && Some(e.url.as_str()) == p.url.as_deref()
                }))
        {
            return Err("browser-link-evidence-stale".into());
        }
        if p.request.operation == TfBrowserOperation::Back
            && p.url.as_deref() != session.history.last().map(String::as_str)
        {
            return Err("browser-history-stale".into());
        }
        session.busy = true;
    }
    let active = Arc::new(Active {
        opens_session: p.request.operation.opens_session(),
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        popup_commit_phase: (p.request.operation == TfBrowserOperation::OpenRequestedPopup)
            .then(|| AtomicU8::new(NATIVE_CLICK_QUEUED)),
        ..Active::default()
    });
    entries.active.insert(token.to_owned(), active.clone());
    let guard = ActiveGuard {
        state,
        token: token.to_owned(),
        browser_id: if p.request.operation.opens_child() {
            p.request.browser_session_id.clone()
        } else if p.request.operation.opens_session() {
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
        browser_session_id: item.and(browser_session_id.map(str::to_owned)),
        current_url: item.filter(|s| {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            {
                s.native.is_none()
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            {
                let _ = s;
                true
            }
        }).map(|s| s.snapshot.url.clone()),
        snapshot_id: item.filter(|s| {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            {
                s.native.is_none()
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            {
                let _ = s;
                true
            }
        }).map(|s| s.snapshot.id.clone()),
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TfBrowserRequest {
    pub operation: TfBrowserOperation,
    pub actor: String,
    pub session_id: String,
    pub workspace_root: String,
    pub browser_session_id: Option<String>,
    pub url: Option<String>,
    /// Native-only, centrally consented exact passive resource manifest. This
    /// is NEVER inferred from HTML or allowed on model-facing inert operations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_manifest: Option<Vec<BrowserResourceCapability>>,
    /// Native-only exact page owner. Never interpreted as a selector.
    pub page_id: Option<String>,
    pub page_generation: Option<u64>,
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
    /// Native exact-node terminal, only when the action actor returned a
    /// verified closed action result. This distinguishes DISPATCHED from
    /// UNKNOWN transport failure; neither means successful external effect.
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_terminal: Option<NativeEffectTerminal>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_terminal: Option<NativeEffectOutcome>,
    /// Separately observed TF3 document/COM evidence, present only when an
    /// approved native link action reaches canonical SUCCESS. URLs are hashed
    /// rather than projected with potentially secret path/query fragments.
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_effect_evidence: Option<NativeEffectEvidence>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_form_transport: Option<NativeFormTransportProof>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_screenshot_evidence: Option<Tf4ScreenshotEvidence>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_credential_transport: Option<NativeOriginCredentialTransport>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_download_evidence: Option<tf_operations::Tf4DownloadEvidence>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_upload_transport: Option<NativeUploadTransport>,
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
    /// Closed, bounded native semantic DOM projection only for internal
    /// confined observation. No arbitrary JS, selectors or CDP handles.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_page: Option<serde_json::Value>,
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
    // App-owned tab linkage; never a renderer WindowProxy or popup grant.
    opener_id: Option<String>,
    actor: String,
    session_id: String,
    root: PathBuf,
    snapshot: Snapshot,
    history: Vec<String>,
    revision: u64,
    busy: bool,
    /// Reserve one exact action token before queued native dispatch, rather
    /// than leaving multiple callers eligible while waiting for a host turn.
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    native_reserved_action: Option<String>,
    expires: Instant,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    native: Option<NativeBackground>,
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
struct NativeBackground {
    stop: watch::Sender<bool>,
    task: Option<JoinHandle<Result<(), String>>>,
    owner_alive: Arc<AtomicBool>,
    command_tx: mpsc::Sender<NativeCommand>,
    turn_requester: NativeControlTurnRequester,
    /// Latest authenticated COM snapshot; invalidated by any brokered
    /// navigation/new-document GET or effectful action attempt.
    snapshot: Arc<Mutex<Option<PageSnapshot>>>,
    /// In-memory per-session projection of the canonical TF3 broker receipts.
    /// Not a parallel receipt database or an authoritative effect grant.
    receipts: Arc<Mutex<Vec<BrokerResourceReceipt>>>,
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
struct NativeOwnerLivenessGuard(Arc<AtomicBool>);
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl Drop for NativeOwnerLivenessGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
enum NativeCommand {
    Observe {
        reply: oneshot::Sender<Result<PageSnapshot, String>>,
    },
    CaptureForm {
        target: ActionTarget,
        action: NativeRetainedAction,
        reply: oneshot::Sender<Result<NativeFormIntent, String>>,
    },
    CaptureLink {
        target: ActionTarget,
        reply: oneshot::Sender<Result<super::tf_browser_runtime::NativeLinkIntent, String>>,
    },
    ReserveAction {
        token: String,
        target: ActionTarget,
        action: NativeRetainedAction,
        deadline: Instant,
        reply: oneshot::Sender<Result<NativeActionReservation, String>>,
    },
    Screenshot {
        token: String,
        browser_id: String,
        active: Arc<Active>,
        reply: oneshot::Sender<Result<Tf4ScreenshotEvidence, String>>,
    },
    CapturePopup {
        expected_url: String,
        reply: oneshot::Sender<Result<Option<NativePopupIntent>, String>>,
        // The original opener remains reserved until BOTH the approval
        // future and the serial native actor release this exact capture.
        _capture_lease: Arc<PopupCaptureReservation>,
    },
    Click {
        token: String,
        browser_id: String,
        target: ActionTarget,
        action: NativeRetainedAction,
        reservation: Box<NativeActionReservation>,
        active: Arc<Active>,
        reply: oneshot::Sender<Result<NativeClickCompletion, String>>,
    },
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
struct NativeClickCompletion {
    effect: NativeEffectReceipt,
    evidence: Option<NativeEffectEvidence>,
    form_transport: Option<NativeFormTransportProof>,
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl NativeClickCompletion {
    fn without_evidence(effect: NativeEffectReceipt) -> Self {
        Self {
            effect,
            evidence: None,
            form_transport: None,
        }
    }
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEffectEvidence {
    pub broker_request_id: u64,
    pub source_page_generation: u64,
    pub observed_page_generation: u64,
    pub origin: String,
    pub source_url_sha256: String,
    pub resulting_url_sha256: String,
    pub response_sha256: String,
    pub status_code: u16,
    pub observed_at_ms: u64,
    pub native_com_completed: bool,
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFormTransportProof {
    pub method: &'static str,
    pub destination_sha256: String,
    pub body_sha256: String,
    pub body_bytes: usize,
    pub tf3_request_id: String,
    pub status_code: Option<u16>,
    pub effect_state: &'static str,
    pub retry: &'static str,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOriginCredentialTransport {
    pub request_method: &'static str,
    pub origin: String,
    pub destination_sha256: String,
    pub reference_sha256: String,
    pub tf3_request_id: String,
    pub credential_sent_to_approved_origin: bool,
    pub status_code: Option<u16>,
    pub effect_state: &'static str,
    pub retry: &'static str,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeUploadTransport {
    pub method: &'static str,
    pub destination_sha256: String,
    pub original_file_sha256: String,
    pub body_bytes: usize,
    pub tf3_request_id: String,
    pub status_code: Option<u16>,
    pub remote_effect_state: &'static str,
    pub retry: &'static str,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Clone, Debug, PartialEq, Eq)]
struct NativeScreenshotScope {
    browser_session_id: String,
    page_id: String,
    page_generation: u64,
    snapshot_id: String,
    url: String,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
const TF4_BROWSER_SECRET_SERVICE: &str = "clack-tf4-origin-browser";

/// A credential is a reference in the EXISTING OS secret authority, scoped
/// to exactly one already observed native page's HTTPS origin, one GET
/// destination and the page generation. No secret value crosses this scope.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Clone, Debug, PartialEq, Eq)]
struct NativeCredentialScope {
    page: NativeScreenshotScope,
    origin: Url,
    destination: Url,
    reference: String,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Clone, Debug, PartialEq, Eq)]
struct NativeUploadFileScope {
    relative_path: String,
    bytes: usize,
    sha256: String,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Clone, Debug, PartialEq, Eq)]
struct NativeTransferScope {
    page: NativeScreenshotScope,
    approved_origin: Url,
    destination: Url,
    upload_file: Option<NativeUploadFileScope>,
}

/// An immutable, moved original TF4 one-use consent witness. The TF3 network
/// and TF2 filesystem helpers require this type, not a model-controlled URL,
/// file path, string approval ID, or an alternate permission system.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
pub(crate) struct NativeTransferConsent {
    actor: String,
    session_id: String,
    workspace_root: PathBuf,
    scope: NativeTransferScope,
    approval_id: String,
    expires: Instant,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl NativeTransferConsent {
    fn from_consumed(p: &Pending, approval_id: &str) -> Result<Self, String> {
        let scope = p
            .transfer_scope
            .clone()
            .ok_or("native-transfer-consumed-scope-missing")?;
        if !p.approved
            || p.approving
            || p.expires <= Instant::now()
            || !matches!(
                p.request.operation,
                TfBrowserOperation::Download | TfBrowserOperation::Upload
            )
            || (p.request.operation == TfBrowserOperation::Upload) != scope.upload_file.is_some()
            || p.request.page_id.as_deref() != Some(scope.page.page_id.as_str())
            || p.request.page_generation != Some(scope.page.page_generation)
            || p.request.snapshot_id.as_deref() != Some(scope.page.snapshot_id.as_str())
            || p.url.as_deref() != Some(scope.page.url.as_str())
            || p.request.url.as_deref() != Some(scope.destination.as_str())
            || approval_id.len() != 48
            || !approval_id
                .bytes()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        {
            return Err("native-transfer-original-consent-changed".into());
        }
        Ok(Self {
            actor: p.request.actor.clone(),
            session_id: p.request.session_id.clone(),
            workspace_root: p.root.clone(),
            scope,
            approval_id: approval_id.to_owned(),
            expires: p.expires,
        })
    }
    pub(crate) fn tf3_identity(&self) -> (&str, &str, &Path) {
        (&self.actor, &self.session_id, &self.workspace_root)
    }
    pub(crate) fn approved_workspace(&self) -> &Path {
        &self.workspace_root
    }
    pub(crate) fn approved_url(&self) -> &Url {
        &self.scope.destination
    }
    pub(crate) fn approved_origin(&self) -> &Url {
        &self.scope.approved_origin
    }
    pub(crate) fn source_page_generation(&self) -> u64 {
        self.scope.page.page_generation
    }
    pub(crate) fn page_id(&self) -> &str {
        &self.scope.page.page_id
    }
    pub(crate) fn snapshot_id(&self) -> &str {
        &self.scope.page.snapshot_id
    }
    pub(crate) fn original_source(&self) -> Option<(&str, usize, &str)> {
        self.scope
            .upload_file
            .as_ref()
            .map(|s| (s.relative_path.as_str(), s.bytes, s.sha256.as_str()))
    }
    pub(crate) fn output_filename(&self) -> String {
        let hash = format!("{:x}", Sha256::digest(self.approval_id.as_bytes()));
        format!("tf4-browser-download-{}.bin", &hash[..24])
    }
    pub(crate) fn matches_network(
        &self,
        destination: &Url,
        origin: &Url,
        approval_id: &str,
        page_generation: u64,
        uploading: bool,
    ) -> bool {
        self.expires > Instant::now()
            && !self.actor.is_empty()
            && !self.session_id.is_empty()
            && self.scope.destination == *destination
            && self.scope.approved_origin == *origin
            && self.approval_id == approval_id
            && self.scope.page.page_generation == page_generation
            && self.scope.upload_file.is_some() == uploading
    }
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Debug)]
pub(crate) struct NativeCredentialConsent {
    actor: String,
    session_id: String,
    workspace_root: PathBuf,
    scope: NativeCredentialScope,
    approval_id: String,
    expires: Instant,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl NativeCredentialConsent {
    fn from_consumed(p: &Pending, approval_id: &str) -> Result<Self, String> {
        let scope = p
            .credential_scope
            .as_ref()
            .ok_or("native-credential-original-scope-missing")?
            .clone();
        if p.request.operation != TfBrowserOperation::CredentialGet
            || !p.approved
            || p.approving
            || p.expires <= Instant::now()
            || p.request.page_id.as_deref() != Some(scope.page.page_id.as_str())
            || p.request.page_generation != Some(scope.page.page_generation)
            || p.request.snapshot_id.as_deref() != Some(scope.page.snapshot_id.as_str())
            || p.url.as_deref() != Some(scope.page.url.as_str())
            || p.request.url.as_deref() != Some(scope.destination.as_str())
            || p.request.text.as_deref() != Some(scope.reference.as_str())
            || approval_id.len() != 48
            || !approval_id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("native-credential-expired-or-original-consent-changed".into());
        }
        Ok(Self {
            actor: p.request.actor.clone(),
            session_id: p.request.session_id.clone(),
            workspace_root: p.root.clone(),
            scope,
            approval_id: approval_id.to_owned(),
            expires: p.expires,
        })
    }
    pub(crate) fn tf3_identity(&self) -> (&str, &str, &Path) {
        (&self.actor, &self.session_id, &self.workspace_root)
    }
    pub(super) fn matches_credential(&self, query: &tf_web::TfBrowserOriginCredentialGet) -> bool {
        self.expires > Instant::now()
            && !self.actor.is_empty()
            && !self.session_id.is_empty()
            && self.scope.destination == query.destination
            && self.scope.origin == query.approved_origin
            && self.scope.reference == query.reference
            && self.scope.page.page_generation == query.source_page_generation
            && self.approval_id == query.consumed_approval_id
    }
    fn credential_account(&self) -> String {
        // Do not persist hostname, path or credential reference in a model
        // transcript or network receipt. The existing keyring owner receives
        // only this stable per-origin synthetic account identity.
        let digest = format!(
            "{:x}",
            Sha256::digest(self.scope.origin.origin().ascii_serialization().as_bytes())
        );
        format!("v1-{}-{}", &digest[..32], self.scope.reference)
    }
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeKeyringCredential {
    token: String,
    expires_at_ms: u64,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn parse_native_keyring_credential(raw: &str, at_ms: u64) -> Result<String, String> {
    if raw.len() > 4096 || raw.len() < 36 {
        return Err("origin-credential-keyring-envelope-invalid".into());
    }
    let credential: NativeKeyringCredential =
        serde_json::from_str(raw).map_err(|_| "origin-credential-keyring-envelope-invalid")?;
    if credential.expires_at_ms <= at_ms
        || credential.expires_at_ms.saturating_sub(at_ms) > 90 * 24 * 3600 * 1000
        || credential.token.len() < 24
        || credential.token.len() > 2048
        || !credential
            .token
            .bytes()
            .all(|v| v.is_ascii_graphic() && v != b'"' && v != b'\\')
    {
        return Err("origin-credential-keyring-expired-or-unsafe".into());
    }
    Ok(credential.token)
}

/// Non-forgeable native-only evidence authorization: constructed solely by
/// consuming the original TF4 pending operation after genuine app consent.
/// TF2 accepts this moved type, not a caller-supplied filename or token text.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
pub(crate) struct NativeScreenshotConsent {
    token: String,
    actor: String,
    session_id: String,
    workspace_root: PathBuf,
    page: NativeScreenshotScope,
    expires: Instant,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl NativeScreenshotConsent {
    fn from_consumed(p: Pending, token: &str) -> Result<Self, String> {
        let page = p
            .screenshot_scope
            .ok_or("screenshot-original-page-not-approved")?;
        if p.request.operation != TfBrowserOperation::Screenshot
            || !p.approved
            || p.approving
            || p.expires <= Instant::now()
            || p.url.as_deref() != Some(page.url.as_str())
            || p.request.page_id.as_deref() != Some(page.page_id.as_str())
            || p.request.page_generation != Some(page.page_generation)
            || p.request.snapshot_id.as_deref() != Some(page.snapshot_id.as_str())
            || token.len() != 48
            || !token
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("screenshot-consumed-central-consent-scope-denied".into());
        }
        Ok(Self {
            token: token.to_owned(),
            actor: p.request.actor,
            session_id: p.request.session_id,
            workspace_root: p.root,
            page,
            expires: p.expires,
        })
    }

    pub(crate) fn evidence_file_name(&self) -> String {
        let hash = format!("{:x}", Sha256::digest(self.token.as_bytes()));
        format!("tf4-browser-screenshot-{}.png", &hash[..24])
    }

    pub(crate) fn approved_workspace(&self) -> &Path {
        &self.workspace_root
    }

    pub(crate) fn matches_capture(&self, capture: &NativeScreenshotCapture) -> bool {
        self.expires > Instant::now()
            && !self.actor.is_empty()
            && !self.session_id.is_empty()
            && self.page.browser_session_id == capture.browser_session_id
            && self.page.page_id == capture.page_id
            && self.page.page_generation == capture.page_generation
            && self.page.snapshot_id == capture.snapshot_id
            && self.page.url == capture.url
            && capture.sha256 == format!("{:x}", Sha256::digest(&capture.png))
    }
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn consume_native_screenshot_approval(
    token: &str,
    browser_id: &str,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
) -> Result<NativeScreenshotConsent, String> {
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "browser-state-unavailable")?;
    let p = entries
        .pending
        .remove(token)
        .ok_or("unknown-or-consumed-browser-token")?;
    if p.expires <= Instant::now()
        || !p.approved
        || p.approving
        || p.browser_id.as_deref() != Some(browser_id)
        || p.request.operation != TfBrowserOperation::Screenshot
        || scope(
            &p.request.actor,
            &p.request.session_id,
            &p.request.workspace_root,
            registry,
        )? != p.root
    {
        return Err("native-screenshot-consent-expired-or-scope-denied".into());
    }
    let session = entries
        .sessions
        .get_mut(browser_id)
        .ok_or("native-screenshot-session-expired")?;
    let original = p
        .screenshot_scope
        .as_ref()
        .ok_or("native-screenshot-original-observation-missing")?;
    let page = session
        .native
        .as_ref()
        .ok_or("native-screenshot-real-WebView2-session-required")?
        .snapshot
        .lock()
        .map_err(|_| "native-screenshot-snapshot-unavailable")?
        .clone()
        .ok_or("native-screenshot-snapshot-lost")?;
    if !session.busy
        || session.native_reserved_action.as_deref() != Some(token)
        || !matches_scope(session, &p.request, &p.root)
        || p.revision != Some(session.revision)
        || original.browser_session_id != page.browser_session_id
        || original.page_id != page.page_id
        || original.page_generation != page.page_generation
        || original.snapshot_id != page.snapshot_id
        || original.url != page.url
        || page.truncated
    {
        return Err("native-screenshot-consumed-original-page-changed".into());
    }
    session.revision = session
        .revision
        .checked_add(1)
        .ok_or("native-screenshot-revision-exhausted")?;
    NativeScreenshotConsent::from_consumed(p, token)
}
/// One consumed central click remains owned by the SAME browser/TF3 actor
/// until a separately completed native document request establishes an effect
/// or the bounded observation window expires. This is not a second approval
/// authority: the original grant was already burned before dispatch.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
struct PendingNativeClickEffect {
    source_url: String,
    target_url_sha256: String,
    source_generation: u64,
    resource_request_floor: u64,
    consumed_action_id: String,
    approved_role: SemanticRole,
    deadline: Instant,
    reply: oneshot::Sender<Result<NativeClickCompletion, String>>,
    _lease: NativeActionBusyGuard,
    durable_effect: Option<NativeDurableEffect>,
}

/// A committed native action cannot leave the existing effect ledger behind
/// merely because its reply future or browser owner disappears.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
struct NativeDurableEffect {
    app: tauri::AppHandle,
    id: String,
    settled: bool,
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl NativeDurableEffect {
    fn begin(
        app: &tauri::AppHandle,
        grant: &NativeConsumedExactClickApproval,
    ) -> Result<Self, String> {
        let (actor, session, root) = grant.tf3_identity();
        let id = crate::modules::conversation_memory::custom_tools::execution::begin_native_browser_effect(
            app, actor, session, root, grant.action_id(),
        )?;
        Ok(Self {
            app: app.clone(),
            id,
            settled: false,
        })
    }

    fn settle(&mut self, effect: &NativeEffectReceipt) -> Result<(), String> {
        crate::modules::conversation_memory::custom_tools::execution::finish_native_browser_effect(
            &self.app,
            &self.id,
            effect.canonical_terminal == NativeEffectOutcome::Success,
            effect.effect_state == "NotAttempted",
        )?;
        self.settled = true;
        Ok(())
    }
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl Drop for NativeDurableEffect {
    fn drop(&mut self) {
        if !self.settled {
            // If this write also fails, the pre-dispatch durable "possible"
            // record remains and the existing epoch recovery marks it unknown.
            let _ = self.settle(&NativeEffectReceipt::classify(
                NativeEffectTerminal::Unknown,
            ));
        }
    }
}

/// Native DISPATCHED is never SUCCESS. An independently completed TF3 HTTPS
/// HTML document with a *new* native page generation, a different URL and the
/// original approved origin can confirm the navigation effect of an approved
/// exact retained link click. Buttons, same-generation resources, redirects to
/// other origins, failed/partial network receipts and ambiguous actions stay
/// UNKNOWN. No target is re-selected and no action is retried here.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn native_link_navigation_observed(
    receipt: &BrokerResourceReceipt,
    source_url: &str,
    target_url_sha256: &str,
    source_generation: u64,
    resource_request_floor: u64,
    approved_role: &SemanticRole,
    consumed_action_id: &str,
) -> bool {
    if target_url_sha256.len() != 64
        || consumed_action_id.len() != 48
        || !consumed_action_id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        || receipt.causal_native_action_id.as_deref() != Some(consumed_action_id)
        || !target_url_sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || *approved_role != SemanticRole::Link
        || !receipt.native_com_completed
        || receipt.terminal != "completed"
        || receipt.request_id <= resource_request_floor
        || receipt.page_generation <= source_generation
        || receipt.bytes == 0
    {
        return false;
    }
    let Some(tf3) = receipt.tf3.as_ref() else {
        return false;
    };
    if tf3.terminal != "completed"
        || tf3.reason_code != "ok"
        || tf3.policy_decision != "allowed"
        || tf3.tls_state != "verified"
        // A redirect or credential-bearing response cannot establish the
        // postcondition of this exact approved link without a separately
        // bound destination/credential authority. Stay UNKNOWN instead.
        || !tf3.redirect_chain.is_empty()
        || tf3.credential_used
        || tf3.credential_reference.is_some()
        || !tf3
            .status_code
            .is_some_and(|status| (200..300).contains(&status))
        || tf3.truncated
        || tf3.bytes_retained == 0
        || tf3.content_sha256.is_none()
        || !tf3.content_type.as_deref().is_some_and(|mime| {
            mime.eq_ignore_ascii_case("text/html")
                || mime.to_ascii_lowercase().starts_with("text/html;")
        })
    {
        return false;
    }
    let (Some(destination), Some(requested)) =
        (tf3.final_url.as_deref(), tf3.requested_url.as_deref())
    else {
        return false;
    };
    let (Ok(initial), Ok(final_url), Ok(requested_url)) = (
        Url::parse(source_url),
        Url::parse(destination),
        Url::parse(requested),
    ) else {
        return false;
    };
    initial.scheme() == "https"
        && final_url.scheme() == "https"
        && final_url.origin() == initial.origin()
        && requested_url.origin() == initial.origin()
        && final_url != initial
        && requested_url != initial
        && requested_url == final_url
        && format!("{:x}", Sha256::digest(final_url.as_str().as_bytes())) == target_url_sha256
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn native_link_navigation_evidence(
    receipt: &BrokerResourceReceipt,
    source_url: &str,
    target_url_sha256: &str,
    source_generation: u64,
    resource_request_floor: u64,
    approved_role: &SemanticRole,
    consumed_action_id: &str,
) -> Option<NativeEffectEvidence> {
    if !native_link_navigation_observed(
        receipt,
        source_url,
        target_url_sha256,
        source_generation,
        resource_request_floor,
        approved_role,
        consumed_action_id,
    ) {
        return None;
    }
    let tf3 = receipt.tf3.as_ref()?;
    let destination = tf3.final_url.as_deref()?;
    let origin = Url::parse(destination).ok()?.origin().ascii_serialization();
    Some(NativeEffectEvidence {
        broker_request_id: receipt.request_id,
        source_page_generation: source_generation,
        observed_page_generation: receipt.page_generation,
        origin,
        source_url_sha256: format!("{:x}", Sha256::digest(source_url.as_bytes())),
        resulting_url_sha256: format!("{:x}", Sha256::digest(destination.as_bytes())),
        response_sha256: tf3.content_sha256.clone()?,
        status_code: tf3.status_code?,
        observed_at_ms: millis(),
        native_com_completed: receipt.native_com_completed,
    })
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
struct NativeActionBusyGuard {
    app: tauri::AppHandle,
    browser_id: String,
    token: String,
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl Drop for NativeActionBusyGuard {
    fn drop(&mut self) {
        let state = self.app.state::<TfBrowserState>();
        if let Ok(mut entries) = state.entries.lock() {
            // Terminal actor handling burns even an expired or pre-consumption
            // command; no orphaned busy lease or approval may be replayed.
            entries.pending.remove(&self.token);
            entries.active.remove(&self.token);
            if let Some(session) = entries.sessions.get_mut(&self.browser_id) {
                if session.native_reserved_action.as_deref() == Some(self.token.as_str()) {
                    session.native_reserved_action = None;
                    session.busy = false;
                }
            }
        };
    }
}
/// A cancelled Tauri future cannot leave a queued, unused central approval
/// behind. If the actor already consumed the token, only its own lease may
/// unlock the session; ambiguous native dispatch must never be replayed.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
struct NativeActionQueueGuard<'a> {
    state: &'a TfBrowserState,
    browser_id: String,
    token: String,
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl Drop for NativeActionQueueGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.state.entries.lock() {
            // The UI future may disappear after actor consumption but before
            // irreversible dispatch. Try to win the same atomic cancel/commit
            // race used by explicit tf_browser_cancel.
            if let Some(active) = entries.active.get(&self.token) {
                if let Some(phase) = active.native_click_phase.as_ref() {
                    if phase
                        .compare_exchange(
                            NATIVE_CLICK_QUEUED,
                            NATIVE_CLICK_CANCELLED,
                            Ordering::AcqRel,
                            Ordering::Acquire,
                        )
                        .is_ok()
                    {
                        active.cancelled.store(true, Ordering::Release);
                    }
                }
            }
            if entries.pending.remove(&self.token).is_some() {
                entries.active.remove(&self.token);
                if let Some(session) = entries.sessions.get_mut(&self.browser_id) {
                    if session.native_reserved_action.as_deref() == Some(self.token.as_str()) {
                        session.native_reserved_action = None;
                        session.busy = false;
                    }
                }
            }
        }
    }
}
/// Only the actor's pre-dispatch approval/scope phase may call this mapper.
/// Once dispatch has been entered, any transport or COM error is UNKNOWN.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn native_pre_dispatch_terminal(reason: &str) -> NativeEffectTerminal {
    if reason == "native-click-cancelled-before-consumption" {
        NativeEffectTerminal::CancelledBeforeDispatch
    } else if matches!(
        reason,
        "STALE_ELEMENT"
            | "STALE_SESSION"
            | "native-click-observation-stale"
            | "native-action-reservation-expired-or-changed"
            | "native-click-central-page-or-element-changed"
            | "confined-native-central-page-or-element-changed"
            | "confined-native-snapshot-stale"
    ) {
        NativeEffectTerminal::Stale
    } else if matches!(
        reason,
        "unknown-or-consumed-browser-token"
            | "confined-native-central-approval-expired-or-scope-changed"
            | "confined-native-central-session-or-source-changed"
            | "native-click-central-approval-required"
    ) {
        NativeEffectTerminal::Denied
    } else {
        NativeEffectTerminal::FailedBeforeDispatch
    }
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl Drop for NativeBackground {
    fn drop(&mut self) {
        // Session expiry/removal cannot leave a detached native browser
        // running unattended; the background loop selects on this exact
        // sender and its owned Job Object is kill-on-close.
        self.stop.send_replace(true);
        self.owner_alive.store(false, Ordering::Release);
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
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    native_target: Option<ActionTarget>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    native_effect: Option<BrowserEffect>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    native_role: Option<SemanticRole>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    native_action: Option<NativeRetainedAction>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    native_reservation: Option<NativeActionReservation>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    popup_intent: Option<NativePopupIntent>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    /// Exact *browser-captured* form body, action URL and original Node pair.
    /// Populated before the genuine consent UI; never serialized/model-visible.
    form_intent: Option<NativeFormIntent>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    link_intent: Option<super::tf_browser_runtime::NativeLinkIntent>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    screenshot_scope: Option<NativeScreenshotScope>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    credential_scope: Option<NativeCredentialScope>,
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    transfer_scope: Option<NativeTransferScope>,
}
struct Active {
    opens_session: bool,
    cancelled: AtomicBool,
    // Popup launch and cancellation race at the central commit, not at
    // native process creation. This phase is separate from DOM actions.
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    popup_commit_phase: Option<AtomicU8>,
    /// Linearizes native cancel vs irreversible dispatch. This is a phase
    /// marker on the existing active call, NOT a separate approval token.
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    native_click_phase: Option<AtomicU8>,
    tf_web_token: Mutex<Option<String>>,
    cancel_watch: watch::Sender<bool>,
}
impl Default for Active {
    fn default() -> Self {
        let (cancel_watch, _) = watch::channel(false);
        Self {
            opens_session: false,
            cancelled: AtomicBool::new(false),
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            popup_commit_phase: None,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            native_click_phase: None,
            tf_web_token: Mutex::new(None),
            cancel_watch,
        }
    }
}
#[derive(Default)]
struct Entries {
    approvals_shutdown: bool,
    sessions: HashMap<String, BrowserSession>,
    pending: HashMap<String, Pending>,
    active: HashMap<String, Arc<Active>>,
}
#[derive(Default)]
pub struct TfBrowserState {
    entries: Arc<Mutex<Entries>>,
}

impl TfBrowserState {
    pub fn shutdown_approvals(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.approvals_shutdown = true;
            entries.pending.clear();
        }
    }
}

impl Drop for TfBrowserState {
    fn drop(&mut self) {
        self.shutdown_approvals();
    }
}

// Every exit from the approval command, including abandonment during native
// capture, revokes the pending token unless central approval already committed.
struct ApprovalAbandonGuard {
    entries: Arc<Mutex<Entries>>,
    token: String,
}

impl Drop for ApprovalAbandonGuard {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.entries.lock() {
            if entries.pending.get(&self.token).is_some_and(|p| p.approving && !p.approved) {
                entries.pending.remove(&self.token);
            }
        }
    }
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ApprovalPresentationState {
    Live,
    Expired,
    Revoked,
}

#[cfg(any(windows, test))]
struct ApprovalPresentation {
    entries: Arc<Mutex<Entries>>,
    token: String,
    deadline: Instant,
    workspace_root: PathBuf,
}

#[cfg(any(windows, test))]
impl ApprovalPresentation {
    fn state_at(&self, now: Instant) -> ApprovalPresentationState {
        if now >= self.deadline {
            return ApprovalPresentationState::Expired;
        }
        if !self.workspace_root.is_dir() {
            return ApprovalPresentationState::Revoked;
        }
        match self.entries.lock() {
            Ok(entries)
                if !entries.approvals_shutdown
                    && entries.pending.get(&self.token).is_some_and(|p| {
                        p.approving && !p.approved && p.expires > now && {
                            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
                            {
                                native_pending_authority_live(&entries, &self.token, p, now)
                            }
                            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
                            {
                                true
                            }
                        }
                    }) =>
            {
                ApprovalPresentationState::Live
            }
            _ => ApprovalPresentationState::Revoked,
        }
    }

    fn decision_at(&self, now: Instant, accepted: bool) -> Result<(), String> {
        match self.state_at(now) {
            ApprovalPresentationState::Expired => Err("browser-native-approval-expired".into()),
            ApprovalPresentationState::Revoked => Err("browser-native-approval-revoked".into()),
            ApprovalPresentationState::Live if accepted => Ok(()),
            ApprovalPresentationState::Live => Err("browser-native-approval-denied".into()),
        }
    }
}

/// Read-only dialog-liveness fence. Actor/central session changes during
/// human review revoke this one pending action; no new snapshot or authority
/// is obtained. The full physical original-node recheck remains at dispatch.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn native_pending_authority_live(
    entries: &Entries,
    token: &str,
    pending: &Pending,
    now: Instant,
) -> bool {
    if !pending.request.operation.native_action() {
        return true;
    }
    let Some(session) = pending
        .browser_id
        .as_deref()
        .and_then(|id| entries.sessions.get(id))
    else {
        return false;
    };
    let Some(target) = pending.native_target.as_ref() else {
        return false;
    };
    let Some(action) = pending.native_action.as_ref() else {
        return false;
    };
    !entries.approvals_shutdown
        && pending.expires > now
        && matches_scope(session, &pending.request, &pending.root)
        && pending.revision == Some(session.revision)
        && !session.busy
        && session.snapshot.url == pending.url.as_deref().unwrap_or_default()
        && session
            .native
            .as_ref()
            .is_some_and(|native| native.owner_alive.load(Ordering::Acquire))
        && pending.native_reservation.as_ref().is_some_and(|reserved| {
            reserved.expires_at == pending.expires && reserved.matches(token, target, action)
        })
}

#[cfg(windows)]
fn show_owned_native_approval(
    presentation: ApprovalPresentation,
    title: String,
    summary: String,
) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows_sys::Win32::UI::Controls::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageW, IDCANCEL, IDOK};

    // TaskDialogIndirect owns the HWND and this callback's context for its
    // entire synchronous lifetime. Only the native user can choose OK; the
    // application can exclusively dismiss its own dialog via Cancel.
    unsafe extern "system" fn callback(
        hwnd: HWND, notification: u32, wparam: WPARAM, _: LPARAM, data: isize,
    ) -> i32 {
        let presentation = unsafe { &*(data as *const ApprovalPresentation) };
        if notification == TDN_CREATED as u32 || notification == TDN_TIMER as u32 {
            if presentation.state_at(Instant::now()) != ApprovalPresentationState::Live {
                unsafe { SendMessageW(hwnd, TDM_CLICK_BUTTON as u32, IDCANCEL as usize, 0) };
            }
        } else if notification == TDN_BUTTON_CLICKED as u32 && wparam == IDOK as usize
            && presentation.state_at(Instant::now()) != ApprovalPresentationState::Live
        {
            // Reject stale OK even in the interval between timer callbacks.
            return 1;
        }
        0
    }

    presentation.decision_at(Instant::now(), true)?;
    let title: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    let summary: Vec<u16> = summary.encode_utf16().chain(std::iter::once(0)).collect();
    let config = TASKDIALOGCONFIG {
        cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
        dwFlags: TDF_CALLBACK_TIMER | TDF_ALLOW_DIALOG_CANCELLATION,
        dwCommonButtons: TDCBF_OK_BUTTON | TDCBF_CANCEL_BUTTON,
        nDefaultButton: IDCANCEL,
        pszWindowTitle: title.as_ptr(),
        pszContent: summary.as_ptr(),
        pfCallback: Some(callback),
        lpCallbackData: &presentation as *const ApprovalPresentation as isize,
        ..Default::default()
    };
    let mut button = 0;
    let hr = unsafe { TaskDialogIndirect(&config, &mut button, std::ptr::null_mut(), std::ptr::null_mut()) };
    if hr < 0 {
        return Err("browser-native-dialog-unavailable".into());
    }
    presentation.decision_at(Instant::now(), button == IDOK)
}

/// Reuses the existing opener busy/native-reserved-action owner. A cancelled
/// approval future may abandon its reply while the host is still capturing;
/// the actor's clone retains the lease until that command has terminated.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
struct PopupCaptureReservation {
    entries: Arc<Mutex<Entries>>,
    opener_id: String,
    token: String,
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl PopupCaptureReservation {
    // This lock linearizes capture admission against pending-token removal
    // by cancel/reap. Once admitted, the actor retains the busy lease until
    // the native command terminates, even if the caller abandons its reply.
    fn admit(&self, expected_url: &str) -> Result<(), String> {
        let entries = self.entries.lock().map_err(|_| "browser-state-unavailable")?;
        let pending = entries.pending.get(&self.token).ok_or("popup-capture-pending-revoked")?;
        if pending.request.operation != TfBrowserOperation::OpenRequestedPopup
            || !pending.approving || pending.approved || pending.popup_intent.is_some()
            || pending.expires <= Instant::now() || pending.revision.is_none()
            || pending.url.as_deref() != Some(expected_url)
            || pending.request.browser_session_id.as_deref() != Some(self.opener_id.as_str())
        {
            return Err("popup-capture-pending-stale".into());
        }
        validate_tab_opener(&entries, &pending.request, &pending.root, pending.revision, true)?;
        if entries.sessions.get(&self.opener_id).and_then(|s| s.native_reserved_action.as_deref())
            != Some(self.token.as_str()) {
            return Err("popup-capture-reservation-revoked".into());
        }
        Ok(())
    }
}
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
impl Drop for PopupCaptureReservation {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(opener) = entries.sessions.get_mut(&self.opener_id) {
                if opener.native_reserved_action.as_deref() == Some(self.token.as_str()) {
                    opener.native_reserved_action = None;
                    opener.busy = false;
                }
            }
        }
    }
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
    // Expiry of a root revokes its children as well. NativeBackground::drop
    // signals the owned task to shut down; expiry is not a cleanup receipt.
    let orphaned: Vec<_> = entries
        .sessions
        .iter()
        .filter_map(|(id, s)| {
            s.opener_id
                .as_ref()
                .filter(|opener| !entries.sessions.contains_key(*opener))
                .map(|_| id.clone())
        })
        .collect();
    for id in orphaned {
        entries.sessions.remove(&id);
    }
}
fn matches_scope(session: &BrowserSession, req: &TfBrowserRequest, root: &Path) -> bool {
    session.actor == req.actor && session.session_id == req.session_id && session.root == root
}
fn session_capacity_available(entries: &Entries) -> bool {
    entries.sessions.len()
        + entries
            .active
            .values()
            .filter(|active| active.opens_session)
            .count()
        < MAX_SESSIONS
}

fn validate_tab_opener(
    entries: &Entries,
    req: &TfBrowserRequest,
    root: &Path,
    revision: Option<u64>,
    reserved: bool,
) -> Result<String, String> {
    let id = req
        .browser_session_id
        .as_deref()
        .ok_or("tab-opener-required")?;
    let session = entries.sessions.get(id).ok_or("tab-opener-expired")?;
    if !matches_scope(session, req, root)
        || revision.is_some_and(|r| r != session.revision)
        || session.expires <= Instant::now()
    {
        return Err("tab-opener-stale-or-scope-denied".into());
    }
    if session.busy != reserved {
        return Err("tab-opener-busy-or-reservation-lost".into());
    }
    if session.opener_id.is_some() {
        return Err("nested-confined-tab-denied".into());
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if session
        .native
        .as_ref()
        .is_some_and(|n| n.owner_alive.load(Ordering::Acquire))
    {
        return Ok(id.to_owned());
    }
    Err("tab-opener-confined-owner-required".into())
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn validate_popup_child_scope(
    entries: &Entries,
    p: &Pending,
    active: &Arc<Active>,
    token: &str,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let intent = p
        .popup_intent
        .as_ref()
        .ok_or("popup-original-native-intent-missing")?;
    if p.request.operation != TfBrowserOperation::OpenRequestedPopup
        || !p.approved
        || p.approving
        || p.revision.is_none()
        || p.expires <= Instant::now()
        || intent.expires_at <= Instant::now()
        || intent.page_generation != 1
        || Some(intent.destination.as_str()) != p.url.as_deref()
        || intent.id.len() != 64
        || !intent.id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err("popup-original-intent-expired-or-scope-changed".into());
    }
    if !active.opens_session
        || active.cancelled.load(Ordering::Acquire)
        || active.popup_commit_phase.as_ref().is_none_or(|phase| {
            phase.load(Ordering::Acquire) != NATIVE_CLICK_QUEUED
        })
        || entries.active.get(token).is_none_or(|stored| !Arc::ptr_eq(stored, active))
        || entries.sessions.len() >= MAX_SESSIONS
        || p.browser_id.as_ref().is_none_or(|id| entries.sessions.contains_key(id))
        || scope(
            &p.request.actor,
            &p.request.session_id,
            &p.request.workspace_root,
            registry,
        )? != p.root
    {
        return Err("popup-child-central-reservation-revoked".into());
    }
    let opener = validate_tab_opener(entries, &p.request, &p.root, p.revision, true)?;
    let source = &entries
        .sessions
        .get(&opener)
        .ok_or("popup-original-opener-expired")?
        .snapshot
        .url;
    if intent.source_sha256 != format!("{:x}", Sha256::digest(source.as_bytes())) {
        return Err("popup-original-source-or-intent-identity-changed".into());
    }
    // Scope checks include filesystem canonicalization. Do not let time
    // spent validating the workspace extend either approval deadline.
    if intent.expires_at <= Instant::now() || p.expires <= Instant::now() {
        return Err("popup-original-intent-expired-or-scope-changed".into());
    }
    Ok(())
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn commit_popup_child(active: &Active) -> bool {
    active.popup_commit_phase.as_ref().is_some_and(|phase| {
        phase.compare_exchange(
            NATIVE_CLICK_QUEUED,
            NATIVE_CLICK_DISPATCH_COMMITTED,
            Ordering::AcqRel,
            Ordering::Acquire,
        ).is_ok()
    })
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn popup_child_cancelled(active: &Active) -> bool {
    active.popup_commit_phase.as_ref().is_some_and(|phase| {
        phase.load(Ordering::Acquire) == NATIVE_CLICK_CANCELLED
    })
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
async fn await_popup_child_commit(
    gate: Option<oneshot::Receiver<()>>,
    stopped: &mut watch::Receiver<bool>,
) -> bool {
    let Some(gate) = gate else {
        return true;
    };
    if *stopped.borrow() {
        return false;
    }
    tokio::select! {
        biased;
        _ = stopped.changed() => false,
        result = gate => result.is_ok() && !*stopped.borrow(),
    }
}

// Called under the session lock. A child cannot be opened concurrently with
// root close: the root is reserved by consume for the entire tab launch.
fn remove_owned_session_tree(
    entries: &mut Entries,
    id: &str,
    cascade: bool,
) -> Result<Vec<BrowserSession>, String> {
    let parent = entries.sessions.get(id).ok_or("browser-session-expired")?;
    let mut children: Vec<_> = entries
        .sessions
        .iter()
        .filter(|(_, s)| s.opener_id.as_deref() == Some(id))
        .map(|(id, _)| id.clone())
        .collect();
    children.sort();
    if !children.is_empty() && !cascade {
        return Err("confined-tab-root-requires-confined-close".into());
    }
    for child in &children {
        let s = &entries.sessions[child];
        if s.actor != parent.actor || s.session_id != parent.session_id || s.root != parent.root {
            return Err("confined-tab-linkage-scope-invalid".into());
        }
    }
    let mut removed = Vec::with_capacity(children.len() + 1);
    for child in children {
        removed.push(entries.sessions.remove(&child).ok_or("tab-child-expired")?);
    }
    removed.push(
        entries
            .sessions
            .remove(id)
            .ok_or("browser-session-expired")?,
    );
    Ok(removed)
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

/// Presentation-time *negative* gate only. Reuse TF3's canonical literal-IP
/// classification and forbidden metadata host names, without doing DNS here.
/// A successfully shaped public hostname is NOT considered safe by this
/// check: the original TF3 policy still resolves, pins and rechecks each hop
/// at execution. No pre-consent socket, DNS authority or new allowlist.
fn reject_obvious_forbidden_native_destination(url: &Url) -> Result<(), String> {
    let host = url.host_str().ok_or("confined-destination-host-required")?;
    if super::is_blocked_host_name(host) {
        return Err("confined-destination-forbidden-before-consent".into());
    }
    // URL serialization brackets IPv6 literals; the canonical network
    // classifier accepts IpAddr without brackets. No textual allowlist.
    if let Ok(ip) = host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>() {
        if super::ip_kind(ip) != super::IpKind::Public {
            return Err("confined-destination-forbidden-before-consent".into());
        }
    }
    Ok(())
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
/// Existing immutable request.text is interpreted by the exact operation:
/// TYPE user text, SELECT second original opaque option handle, SCROLL one
/// fixed signed step encoded as 'up'/'down'. Never a CSS selector or value.
fn native_retained_action_from_request(
    req: &TfBrowserRequest,
) -> Result<NativeRetainedAction, String> {
    match req.operation {
        TfBrowserOperation::Click if req.text.is_none() => Ok(NativeRetainedAction::Click),
        TfBrowserOperation::TriggerPagePopup if req.text.is_none() =>
            Ok(NativeRetainedAction::PopupClick),
        TfBrowserOperation::Type => {
            let value = req.text.as_deref().ok_or("native-type-text-required")?;
            if !super::tf_browser_runtime::valid_native_type_text(value) {
                return Err("native-type-text-unsafe-or-bidi".into());
            }
            Ok(NativeRetainedAction::Type(value.to_owned()))
        }
        TfBrowserOperation::Clear if req.text.is_none() => Ok(NativeRetainedAction::Clear),
        TfBrowserOperation::Select => {
            let option = req
                .text
                .as_deref()
                .ok_or("native-select-option-ref-required")?;
            if !valid_id(option) || option == req.element_id.as_deref().unwrap_or("") {
                return Err("native-select-original-option-invalid".into());
            }
            Ok(NativeRetainedAction::Select(option.to_owned()))
        }
        TfBrowserOperation::Submit => {
            let form = req
                .text
                .as_deref()
                .ok_or("native-submit-form-ref-required")?;
            if !valid_id(form) || form == req.element_id.as_deref().unwrap_or("") {
                return Err("native-submit-original-form-invalid".into());
            }
            Ok(NativeRetainedAction::Submit(form.to_owned()))
        }
        TfBrowserOperation::Check if req.text.is_none() => Ok(NativeRetainedAction::Check),
        TfBrowserOperation::Uncheck if req.text.is_none() => Ok(NativeRetainedAction::Uncheck),
        TfBrowserOperation::Scroll => match req.text.as_deref() {
            Some("up") => Ok(NativeRetainedAction::Scroll(-120)),
            Some("down") => Ok(NativeRetainedAction::Scroll(120)),
            _ => Err("native-scroll-only-fixed-up-or-down".into()),
        },
        _ => Err("native-action-exact-parameter-shape-denied".into()),
    }
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
    if req.resource_manifest.is_some()
        && !matches!(
            req.operation,
            TfBrowserOperation::OpenConfined | TfBrowserOperation::OpenConfinedTab
                | TfBrowserOperation::OpenRequestedPopup
        )
    {
        return Err("browser-resource-manifest-native-open-only".into());
    }
    match req.operation {
        TfBrowserOperation::Open
        | TfBrowserOperation::OpenConfined
        | TfBrowserOperation::OpenConfinedTab
        | TfBrowserOperation::OpenRequestedPopup => {
            if req.operation.opens_child()
                != req.browser_session_id.is_some()
                || req.url.is_none()
                || req.page_id.is_some()
                || req.page_generation.is_some()
                || req.snapshot_id.is_some()
                || req.element_id.is_some()
                || req.selector.is_some()
                || req.text.is_some()
            {
                return Err("open-parameters-denied".into());
            }
            valid_nav_url(req.url.as_deref().unwrap())?;
            if matches!(
                req.operation,
                TfBrowserOperation::OpenConfined
                    | TfBrowserOperation::OpenConfinedTab
                    | TfBrowserOperation::OpenRequestedPopup
            ) {
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
                reject_obvious_forbidden_native_destination(&target)?;
                if let Some(resources) = req.resource_manifest.as_deref() {
                    super::tf_browser_runtime::validate_resource_manifest(
                        target.as_str(), resources
                    ).map_err(str::to_owned)?;
                }
            }
        }
        TfBrowserOperation::Navigate => {
            if req.url.is_none()
                || req.page_id.is_some()
                || req.page_generation.is_some()
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
                || req.page_id.is_some()
                || req.page_generation.is_some()
                || req.selector.is_some()
                || req.text.is_some()
                || req.snapshot_id.as_deref().is_none_or(|s| !valid_id(s))
                || req.element_id.as_deref().is_none_or(|s| !valid_id(s))
            {
                return Err("click-link-parameters-denied".into());
            }
        }
        TfBrowserOperation::Back
        | TfBrowserOperation::Snapshot
        | TfBrowserOperation::ObserveConfined
        | TfBrowserOperation::Close
        | TfBrowserOperation::CloseConfined => {
            if req.url.is_some()
                || req.page_id.is_some()
                || req.page_generation.is_some()
                || req.element_id.is_some()
                || req.selector.is_some()
                || req.text.is_some()
                || (req.operation != TfBrowserOperation::Snapshot && req.snapshot_id.is_some())
                || req.snapshot_id.as_deref().is_some_and(|s| !valid_id(s))
            {
                return Err("browser-operation-parameters-denied".into());
            }
        }
        TfBrowserOperation::Screenshot => {
            if req.url.is_some()
                || req.element_id.is_some()
                || req.selector.is_some()
                || req.text.is_some()
                || (req.page_id.is_some() != req.page_generation.is_some())
                || (req.page_id.is_some() != req.snapshot_id.is_some())
                || req.page_id.as_deref().is_some_and(|v| !valid_id(v))
                || req.page_generation == Some(0)
                || req.snapshot_id.as_deref().is_some_and(|v| !valid_id(v))
            {
                return Err("native-screenshot-exact-page-scope-required".into());
            }
        }
        TfBrowserOperation::CredentialGet => {
            let url = req
                .url
                .as_deref()
                .ok_or("native-origin-credential-exact-destination-required")?;
            let destination =
                Url::parse(url).map_err(|_| "native-origin-credential-destination-invalid")?;
            let reference = req
                .text
                .as_deref()
                .ok_or("native-origin-credential-opaque-reference-required")?;
            if req.selector.is_some()
                || req.element_id.is_some()
                || req.page_id.as_deref().is_none_or(|v| !valid_id(v))
                || req.page_generation.is_none_or(|g| g == 0)
                || req.snapshot_id.as_deref().is_none_or(|v| !valid_id(v))
                || destination.scheme() != "https"
                || destination.port().is_some()
                || destination.query().is_some()
                || destination.fragment().is_some()
                || !destination.username().is_empty()
                || destination.password().is_some()
                || destination.as_str() != url
                || reference.len() != 48
                || !reference
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            {
                return Err("native-origin-credential-exact-scope-denied".into());
            }
            reject_obvious_forbidden_native_destination(&destination)?;
        }
        TfBrowserOperation::Download | TfBrowserOperation::Upload => {
            let url = req
                .url
                .as_deref()
                .ok_or("native-transfer-exact-source-or-destination-required")?;
            let destination = Url::parse(url).map_err(|_| "native-transfer-exact-url-invalid")?;
            if req.selector.is_some()
                || req.element_id.is_some()
                || req.page_id.as_deref().is_none_or(|v| !valid_id(v))
                || req.page_generation.is_none_or(|g| g == 0)
                || req.snapshot_id.as_deref().is_none_or(|v| !valid_id(v))
                || destination.scheme() != "https"
                || destination.port().is_some()
                || destination.query().is_some()
                || destination.fragment().is_some()
                || !destination.username().is_empty()
                || destination.password().is_some()
                || destination.as_str() != url
                || (req.operation == TfBrowserOperation::Download && req.text.is_some())
                || (req.operation == TfBrowserOperation::Upload
                    && req.text.as_deref().is_none_or(|v| {
                        v.is_empty() || v.len() > 256 || v.chars().any(char::is_control)
                    }))
            {
                return Err("native-transfer-exact-original-scope-required".into());
            }
            reject_obvious_forbidden_native_destination(&destination)?;
        }
        operation if operation.native_action() => {
            if req.url.is_some()
                || req.selector.is_some()
                || (matches!(operation, TfBrowserOperation::Click | TfBrowserOperation::TriggerPagePopup)
                    && req.text.is_some())
                || req.page_id.as_deref().is_none_or(|s| !valid_id(s))
                || req.page_generation.is_none_or(|g| g == 0)
                || req.snapshot_id.as_deref().is_none_or(|s| !valid_id(s))
                || req.element_id.as_deref().is_none_or(|s| !valid_id(s))
            {
                return Err(if matches!(operation, TfBrowserOperation::Click | TfBrowserOperation::TriggerPagePopup) {
                    "native-click-exact-target-required"
                } else {
                    "native-action-exact-target-required"
                }
                .into());
            }
            native_retained_action_from_request(req)?;
        }
        // Unsupported operations cannot acquire arbitrary selectors or scripts.
        _ => {
            if req.url.is_some()
                || req.page_id.is_some()
                || req.page_generation.is_some()
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
    if matches!(
        req.operation,
        TfBrowserOperation::OpenConfined
            | TfBrowserOperation::OpenConfinedTab
            | TfBrowserOperation::OpenRequestedPopup
    ) && !confined_runtime_packaged()
    {
        return Err("confined-browser-not-packaged-or-security-unaccepted".into());
    }
    let root = scope(&req.actor, &req.session_id, &req.workspace_root, registry)?;
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "browser-state-unavailable")?;
    reap(&mut entries);
    if entries.approvals_shutdown {
        return Err("browser-native-approval-revoked".into());
    }
    if entries.pending.len() >= MAX_PENDING || entries.active.len() >= MAX_ACTIVE {
        return Err("browser-capacity-exceeded".into());
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let mut native_target: Option<ActionTarget> = None;
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let mut native_effect: Option<BrowserEffect> = None;
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let mut native_role: Option<SemanticRole> = None;
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let mut native_action: Option<NativeRetainedAction> = None;
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let mut screenshot_scope: Option<NativeScreenshotScope> = None;
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let mut credential_scope: Option<NativeCredentialScope> = None;
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let mut transfer_scope: Option<NativeTransferScope> = None;
    let (browser_id, revision, url) = if req.operation.opens_session() {
        if !session_capacity_available(&entries) {
            return Err("browser-session-capacity-exceeded".into());
        }
        let revision = if req.operation.opens_child() {
            let opener = validate_tab_opener(&entries, &req, &root, None, false)?;
            Some(
                entries
                    .sessions
                    .get(&opener)
                    .ok_or("tab-opener-expired")?
                    .revision,
            )
        } else {
            None
        };
        (
            Some(nonce()?),
            revision,
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
        if let Some(native) = session.native.as_ref() {
            if !native.owner_alive.load(Ordering::Acquire)
                && req.operation != TfBrowserOperation::CloseConfined
            {
                return Err("confined-native-owner-not-live".into());
            }
            if !matches!(
                req.operation,
                TfBrowserOperation::CloseConfined
                    | TfBrowserOperation::ObserveConfined
                    | TfBrowserOperation::Screenshot
                    | TfBrowserOperation::CredentialGet
                    | TfBrowserOperation::Download
                    | TfBrowserOperation::Upload
            ) && !req.operation.native_action()
            {
                return Err("confined-native-operation-not-yet-accepted".into());
            }
            if req.operation.native_action() {
                let action = native_retained_action_from_request(&req)?;
                let page = native
                    .snapshot
                    .lock()
                    .map_err(|_| "confined-native-snapshot-unavailable")?
                    .clone()
                    .ok_or("confined-native-snapshot-required")?;
                if req.page_id.as_deref() != Some(page.page_id.as_str())
                    || req.page_generation != Some(page.page_generation)
                    || req.snapshot_id.as_deref() != Some(page.snapshot_id.as_str())
                    || !page.elements.iter().any(|element| {
                        req.element_id.as_deref() == Some(element.element_ref.as_str())
                    })
                    || page.origin
                        != Url::parse(&session.snapshot.url)
                            .map_err(|_| "confined-native-origin-invalid")?
                            .origin()
                            .ascii_serialization()
                {
                    return Err("confined-native-action-exact-target-stale".into());
                }
                native_role = page
                    .elements
                    .iter()
                    .find(|element| req.element_id.as_deref() == Some(element.element_ref.as_str()))
                    .map(|element| element.role.clone());
                if let NativeRetainedAction::Select(option_ref) = &action {
                    if !page.elements.iter().any(|element| {
                        element.element_ref == *option_ref && element.role == SemanticRole::Option
                    }) {
                        return Err("native-select-option-must-be-retained-original-option".into());
                    }
                }
                if let NativeRetainedAction::Submit(form_ref) = &action {
                    if !page.elements.iter().any(|element| {
                        element.element_ref == *form_ref && element.role == SemanticRole::Form
                    }) {
                        return Err("native-submit-form-must-be-retained-original-form".into());
                    }
                }
                native_target = Some(ActionTarget {
                    browser_session_id: page.browser_session_id.clone(),
                    page_id: page.page_id,
                    page_generation: page.page_generation,
                    snapshot_id: page.snapshot_id,
                    element_ref: req.element_id.clone().ok_or("element-id-required")?,
                });
                // All exact-node effects are conservatively UNKNOWN. The
                // native contract and host reclassify/recheck the actual role
                // before one single-use dispatch, never a model CSS selector.
                native_effect = Some(BrowserEffect::Unknown);
                native_action = Some(action);
            } else if req.operation == TfBrowserOperation::Screenshot {
                let page = native
                    .snapshot
                    .lock()
                    .map_err(|_| "native-screenshot-snapshot-lock-unavailable")?
                    .clone()
                    .ok_or("native-screenshot-original-snapshot-required")?;
                if page.truncated
                    || req.page_id.as_deref() != Some(page.page_id.as_str())
                    || req.page_generation != Some(page.page_generation)
                    || req.snapshot_id.as_deref() != Some(page.snapshot_id.as_str())
                    || page.url != session.snapshot.url
                {
                    return Err("native-screenshot-page-not-retained-or-sensitive".into());
                }
                screenshot_scope = Some(NativeScreenshotScope {
                    browser_session_id: page.browser_session_id,
                    page_id: page.page_id,
                    page_generation: page.page_generation,
                    snapshot_id: page.snapshot_id,
                    url: page.url,
                });
            } else if req.operation == TfBrowserOperation::CredentialGet {
                let page = native
                    .snapshot
                    .lock()
                    .map_err(|_| "native-credential-original-snapshot-unavailable")?
                    .clone()
                    .ok_or("native-credential-original-page-required")?;
                let destination = Url::parse(
                    req.url
                        .as_deref()
                        .ok_or("native-credential-destination-missing")?,
                )
                .map_err(|_| "native-credential-destination-invalid")?;
                let source = Url::parse(&page.url)
                    .map_err(|_| "native-credential-original-origin-invalid")?;
                if page.truncated
                    || destination.origin() != source.origin()
                    || source.scheme() != "https"
                    || source.port().is_some()
                    || page.url != session.snapshot.url
                    || req.page_id.as_deref() != Some(page.page_id.as_str())
                    || req.page_generation != Some(page.page_generation)
                    || req.snapshot_id.as_deref() != Some(page.snapshot_id.as_str())
                {
                    return Err("native-credential-page-or-origin-not-original".into());
                }
                credential_scope = Some(NativeCredentialScope {
                    page: NativeScreenshotScope {
                        browser_session_id: page.browser_session_id,
                        page_id: page.page_id,
                        page_generation: page.page_generation,
                        snapshot_id: page.snapshot_id,
                        url: page.url,
                    },
                    origin: Url::parse(session.snapshot.url.as_str())
                        .map_err(|_| "native-credential-source-invalid")?,
                    destination,
                    reference: req
                        .text
                        .clone()
                        .ok_or("native-credential-reference-required")?,
                });
            } else if matches!(
                req.operation,
                TfBrowserOperation::Download | TfBrowserOperation::Upload
            ) {
                let page = native
                    .snapshot
                    .lock()
                    .map_err(|_| "native-transfer-original-snapshot-unavailable")?
                    .clone()
                    .ok_or("native-transfer-original-page-required")?;
                let destination = Url::parse(
                    req.url
                        .as_deref()
                        .ok_or("native-transfer-destination-missing")?,
                )
                .map_err(|_| "native-transfer-destination-invalid")?;
                let source =
                    Url::parse(&page.url).map_err(|_| "native-transfer-original-origin-invalid")?;
                if page.truncated
                    || destination.origin() != source.origin()
                    || source.scheme() != "https"
                    || source.port().is_some()
                    || page.url != session.snapshot.url
                    || req.page_id.as_deref() != Some(page.page_id.as_str())
                    || req.page_generation != Some(page.page_generation)
                    || req.snapshot_id.as_deref() != Some(page.snapshot_id.as_str())
                {
                    return Err("native-transfer-original-page-or-TF3-origin-changed".into());
                }
                let upload_file = if req.operation == TfBrowserOperation::Upload {
                    let relative = req
                        .text
                        .as_deref()
                        .ok_or("native-transfer-upload-original-file-required")?;
                    let checked =
                        tf_operations::read_native_browser_upload_file(registry, &root, relative)?;
                    Some(NativeUploadFileScope {
                        relative_path: checked.relative_path,
                        bytes: checked.bytes.len(),
                        sha256: checked.sha256,
                    })
                } else {
                    None
                };
                transfer_scope = Some(NativeTransferScope {
                    page: NativeScreenshotScope {
                        browser_session_id: page.browser_session_id,
                        page_id: page.page_id,
                        page_generation: page.page_generation,
                        snapshot_id: page.snapshot_id,
                        url: page.url,
                    },
                    approved_origin: source,
                    destination,
                    upload_file,
                });
            }
        } else if matches!(
            req.operation,
            TfBrowserOperation::ObserveConfined | TfBrowserOperation::CloseConfined
        ) {
            return Err("confined-native-session-required".into());
        }
        // The inert text-page engine has no DOM Node identity and must not
        // manufacture a production action token for this operation.
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        if session.native.is_none()
            && matches!(
                req.operation,
                TfBrowserOperation::Click
                    | TfBrowserOperation::TriggerPagePopup
                    | TfBrowserOperation::Type
                    | TfBrowserOperation::Clear
                    | TfBrowserOperation::Select
                    | TfBrowserOperation::Check
                    | TfBrowserOperation::Uncheck
                    | TfBrowserOperation::Scroll
                    | TfBrowserOperation::Submit
                    | TfBrowserOperation::Download
                    | TfBrowserOperation::Upload
            )
        {
            return Err("native-action-requires-confined-approved-runtime".into());
        }
        #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
        if matches!(
            req.operation,
            TfBrowserOperation::Click
                | TfBrowserOperation::TriggerPagePopup
                | TfBrowserOperation::Type
                | TfBrowserOperation::Clear
                | TfBrowserOperation::Select
                | TfBrowserOperation::Check
                | TfBrowserOperation::Uncheck
                | TfBrowserOperation::Scroll
                | TfBrowserOperation::Submit
        ) {
            return Err("native-action-requires-confined-approved-runtime".into());
        }
        if session.busy {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            let may_close = req.operation == TfBrowserOperation::CloseConfined
                && session.native_reserved_action.is_some();
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            let may_close = false;
            if !may_close {
                return Err("browser-session-busy".into());
            }
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
            operation
                if operation == TfBrowserOperation::ObserveConfined
                    || operation.native_action()
                    || matches!(
                        operation,
                        TfBrowserOperation::Screenshot
                            | TfBrowserOperation::CredentialGet
                            | TfBrowserOperation::Download
                            | TfBrowserOperation::Upload
                    ) =>
            {
                // Bind the original approved origin in the existing immutable
                // pending transaction. Do not show untrusted URL path/query in
                // the approval UI or treat it as an independent TF3 grant.
                Some(valid_nav_url(&session.snapshot.url)?)
            }
            _ => None,
        };
        (Some(id.to_owned()), Some(session.revision), url)
    };
    let request_id = nonce()?;
    let token = nonce()?;
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let screenshot_requires_approval = screenshot_scope.is_some();
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let credential_requires_approval = credential_scope.is_some();
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let transfer_requires_approval = transfer_scope.is_some();
    #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
    let transfer_requires_approval = false;
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if matches!(
        req.operation,
        TfBrowserOperation::Download | TfBrowserOperation::Upload
    ) && transfer_scope.is_none()
    {
        return Err("native-TF2-transfer-WebView2-owner-required".into());
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if req.operation == TfBrowserOperation::CredentialGet && credential_scope.is_none() {
        return Err("native-origin-credential-WebView2-owner-required".into());
    }
    #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
    let credential_requires_approval = false;
    #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
    let screenshot_requires_approval = false;
    let prepared = TfBrowserPrepared {
        token: token.clone(),
        request_id: request_id.clone(),
        operation: req.operation,
        requires_approval: req.operation.approval_required()
            || screenshot_requires_approval
            || credential_requires_approval
            || transfer_requires_approval,
        workspace_root: root.to_string_lossy().into_owned(),
        browser_session_id: browser_id.clone(),
        engine: if matches!(
            req.operation,
            TfBrowserOperation::OpenConfined
                | TfBrowserOperation::OpenConfinedTab
                | TfBrowserOperation::OpenRequestedPopup
                | TfBrowserOperation::ObserveConfined
                | TfBrowserOperation::Click
                | TfBrowserOperation::TriggerPagePopup
                | TfBrowserOperation::Type
                | TfBrowserOperation::Clear
                | TfBrowserOperation::Select
                | TfBrowserOperation::Check
                | TfBrowserOperation::Uncheck
                | TfBrowserOperation::Scroll
                | TfBrowserOperation::Submit
                | TfBrowserOperation::Screenshot
                | TfBrowserOperation::CredentialGet
                | TfBrowserOperation::Download
                | TfBrowserOperation::Upload
                | TfBrowserOperation::CloseConfined
        ) {
            CONFINED_ENGINE
        } else {
            ENGINE
        },
        isolation: if matches!(
            req.operation,
            TfBrowserOperation::OpenConfined
                | TfBrowserOperation::OpenConfinedTab
                | TfBrowserOperation::OpenRequestedPopup
                | TfBrowserOperation::ObserveConfined
                | TfBrowserOperation::Click
                | TfBrowserOperation::TriggerPagePopup
                | TfBrowserOperation::Type
                | TfBrowserOperation::Clear
                | TfBrowserOperation::Select
                | TfBrowserOperation::Check
                | TfBrowserOperation::Uncheck
                | TfBrowserOperation::Scroll
                | TfBrowserOperation::Submit
                | TfBrowserOperation::Screenshot
                | TfBrowserOperation::CredentialGet
                | TfBrowserOperation::Download
                | TfBrowserOperation::Upload
                | TfBrowserOperation::CloseConfined
        ) {
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
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            native_target,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            native_effect,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            native_role,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            native_action,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            native_reservation: None,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            popup_intent: None,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            form_intent: None,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            link_intent: None,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            screenshot_scope,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            credential_scope,
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            transfer_scope,
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
    if !p.request.operation.approval_required() || p.approved || p.approving {
        return Err("browser-approval-not-applicable".into());
    }
    if matches!(
        p.request.operation,
        TfBrowserOperation::OpenConfined
            | TfBrowserOperation::OpenConfinedTab
            | TfBrowserOperation::OpenRequestedPopup
            | TfBrowserOperation::ObserveConfined
    ) || p.request.operation.native_action()
    {
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
        if let Some(pending) = entries.pending.remove(token) {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if pending.request.operation.native_action() {
                if let Some(active) = entries.active.remove(token) {
                    if let Some(phase) = active.native_click_phase.as_ref() {
                        let _ = phase.compare_exchange(
                            NATIVE_CLICK_QUEUED,
                            NATIVE_CLICK_CANCELLED,
                            Ordering::AcqRel,
                            Ordering::Acquire,
                        );
                    }
                    active.cancelled.store(true, Ordering::SeqCst);
                    active.cancel_watch.send_replace(true);
                }
            }
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if pending.request.operation.native_action() {
                if let Some(session) = pending
                    .browser_id
                    .as_deref()
                    .and_then(|id| entries.sessions.get_mut(id))
                {
                    if session.native_reserved_action.as_deref() == Some(token) {
                        session.native_reserved_action = None;
                        session.busy = false;
                    }
                }
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            let _ = pending;
            return Ok(true);
        }
        entries.active.get(token).cloned()
    };
    let Some(active) = active else {
        return Ok(false);
    };
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if let Some(phase) = active.popup_commit_phase.as_ref() {
        if phase.compare_exchange(
            NATIVE_CLICK_QUEUED,
            NATIVE_CLICK_CANCELLED,
            Ordering::AcqRel,
            Ordering::Acquire,
        ).is_err() {
            return Ok(false);
        }
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if active.native_click_phase.is_some() {
        // Once the actor commits irreversible dispatch, cancellation cannot
        // honestly promise to stop the native COM gesture.
        if !cancel_queued_native_action(&active) {
            return Ok(false);
        }
    }
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

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn cancel_queued_native_action(active: &Active) -> bool {
    if !active.native_click_phase.as_ref().is_some_and(|phase| {
        phase
            .compare_exchange(
                NATIVE_CLICK_QUEUED,
                NATIVE_CLICK_CANCELLED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }) {
        return false;
    }
    active.cancelled.store(true, Ordering::Release);
    active.cancel_watch.send_replace(true);
    true
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
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        native_terminal: None,
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        canonical_terminal: None,
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        native_effect_evidence: None,
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        native_form_transport: None,
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        native_screenshot_evidence: None,
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        native_credential_transport: None,
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        native_download_evidence: None,
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        native_upload_transport: None,
        effect_state: "NoEffect",
        reason_code: "not-executed".into(),
        policy_decision: "denied",
        retry: "not_attempted",
        auto_retry: false,
        engine: if matches!(
            p.request.operation,
            TfBrowserOperation::OpenConfined
                | TfBrowserOperation::OpenConfinedTab
                | TfBrowserOperation::OpenRequestedPopup
                | TfBrowserOperation::ObserveConfined
                | TfBrowserOperation::Click
                | TfBrowserOperation::TriggerPagePopup
                | TfBrowserOperation::Type
                | TfBrowserOperation::Clear
                | TfBrowserOperation::Select
                | TfBrowserOperation::Check
                | TfBrowserOperation::Uncheck
                | TfBrowserOperation::Scroll
                | TfBrowserOperation::Submit
                | TfBrowserOperation::Screenshot
                | TfBrowserOperation::CredentialGet
                | TfBrowserOperation::Download
                | TfBrowserOperation::Upload
                | TfBrowserOperation::CloseConfined
        ) {
            CONFINED_ENGINE
        } else {
            ENGINE
        },
        isolation: if matches!(
            p.request.operation,
            TfBrowserOperation::OpenConfined
                | TfBrowserOperation::OpenConfinedTab
                | TfBrowserOperation::OpenRequestedPopup
                | TfBrowserOperation::ObserveConfined
                | TfBrowserOperation::Click
                | TfBrowserOperation::TriggerPagePopup
                | TfBrowserOperation::Type
                | TfBrowserOperation::Clear
                | TfBrowserOperation::Select
                | TfBrowserOperation::Check
                | TfBrowserOperation::Uncheck
                | TfBrowserOperation::Scroll
                | TfBrowserOperation::Submit
                | TfBrowserOperation::Screenshot
                | TfBrowserOperation::CredentialGet
                | TfBrowserOperation::Download
                | TfBrowserOperation::Upload
                | TfBrowserOperation::CloseConfined
        ) {
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
        native_page: None,
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

/// The ONLY production native click grant consumption. A child control-turn
/// offer is transport scheduling, NEVER consent. This atomically burns the
/// existing TF4 pending token, issued in prepare() and approved by the genuine
/// application dialog. A mismatch also burns it. No model-provided approval
/// ID, second store or test fixture flag participates in this transaction.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
type NativeConsumedActionContext = (
    NativeConsumedExactClickApproval,
    String,
    SemanticRole,
    String,
    Option<NativeFormIntent>,
    Option<super::tf_browser_runtime::NativeLinkIntent>,
);

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn consume_native_action_approval(
    token: &str,
    native: &NativeExactClickApprovalScope<'_>,
    reservation: &NativeActionReservation,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
) -> Result<NativeConsumedActionContext, String> {
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "browser-state-unavailable")?;
    // Remove BEFORE any checks or native call; rejected/mismatched approvals
    // cannot be retargeted and ambiguous dispatch can never be replayed.
    let p = entries
        .pending
        .remove(token)
        .ok_or("unknown-or-consumed-browser-token")?;
    if p.expires <= Instant::now()
        || !p.approved
        || p.approving
        || !p.request.operation.native_action()
        || p.native_effect != Some(native.effect)
        || p.native_action.as_ref() != Some(&native.action)
        || p.native_reservation.as_ref().is_none_or(|held| {
            held.expires_at != p.expires
                || held.expires_at != reservation.expires_at
                || !held.matches(token, native.target, &native.action)
        })
        || !reservation.matches(token, native.target, &native.action)
        || p.native_target.as_ref() != Some(native.target)
        || p.request.actor != native.actor
        || p.request.session_id != native.session_id
        || p.root != native.workspace_root
        || p.request.page_id.as_deref() != Some(native.target.page_id.as_str())
        || p.request.page_generation != Some(native.target.page_generation)
        || p.request.snapshot_id.as_deref() != Some(native.target.snapshot_id.as_str())
        || p.request.element_id.as_deref() != Some(native.target.element_ref.as_str())
        || scope(
            &p.request.actor,
            &p.request.session_id,
            &p.request.workspace_root,
            registry,
        )? != p.root
    {
        return Err("confined-native-central-approval-expired-or-scope-changed".into());
    }
    let id = p.browser_id.as_ref().ok_or("browser-session-id-required")?;
    let session = entries
        .sessions
        .get_mut(id)
        .ok_or("browser-session-expired")?;
    if !matches_scope(session, &p.request, &p.root)
        || p.revision != Some(session.revision)
        || !session.busy
        || session.native_reserved_action.as_deref() != Some(token)
        || session
            .native
            .as_ref()
            .is_none_or(|native| !native.owner_alive.load(Ordering::Acquire))
        || format!("{:x}", Sha256::digest(session.snapshot.url.as_bytes())) != native.source_id
    {
        return Err("confined-native-central-session-or-source-changed".into());
    }
    let snapshot = session
        .native
        .as_ref()
        .ok_or("confined-native-owner-missing")?
        .snapshot
        .lock()
        .map_err(|_| "confined-native-snapshot-unavailable")?
        .clone()
        .ok_or("confined-native-snapshot-stale")?;
    if snapshot.browser_session_id != native.target.browser_session_id
        || snapshot.page_id != native.target.page_id
        || snapshot.page_generation != native.target.page_generation
        || snapshot.snapshot_id != native.target.snapshot_id
        || !snapshot.elements.iter().any(|e| {
            e.element_ref == native.target.element_ref && p.native_role.as_ref() == Some(&e.role)
        })
        || snapshot.origin
            != Url::parse(&session.snapshot.url)
                .map_err(|_| "confined-native-origin-invalid")?
                .origin()
                .ascii_serialization()
    {
        return Err("confined-native-central-page-or-element-changed".into());
    }
    if matches!(native.action, NativeRetainedAction::Submit(_)) {
        let intent = p
            .form_intent
            .as_ref()
            .ok_or("native-form-preconsent-capture-required")?;
        if intent.target != *native.target
            || intent.observation_id != native.observation_id
            || intent.original_submitter_index != native.index
            || native.selected_native_form.map(|(index, _)| index)
                != Some(intent.original_form_index)
            || intent.destination.query().is_some()
            || intent.destination.fragment().is_some()
            || intent.body_sha256 != format!("{:x}", Sha256::digest(&intent.body))
        {
            return Err("native-form-approved-body-or-original-node-changed".into());
        }
    } else if p.form_intent.is_some() {
        return Err("native-form-grant-reused-for-another-action".into());
    }
    if native.action == NativeRetainedAction::Click {
        let intent = p.link_intent.as_ref()
            .ok_or("native-link-preconsent-capture-required")?;
        if intent.target != *native.target
            || intent.observation_id != native.observation_id
            || intent.original_link_index != native.index
            || intent.destination.query().is_some()
            || intent.destination.fragment().is_some()
            || intent.destination_sha256 != format!(
                "{:x}", Sha256::digest(intent.destination.as_str().as_bytes()))
        {
            return Err("native-link-approved-destination-or-node-changed".into());
        }
    } else if p.link_intent.is_some() {
        return Err("native-link-grant-reused-for-another-action".into());
    }
    let witness = NativeConsumedExactClickApproval::from_consumed_central_token(
        token.to_owned(),
        native,
        p.expires,
    )?;
    // Lease the one native actor until its dispatch/UNKNOWN terminal. The
    // separate RAII guard clears this even if the Tauri future is cancelled.
    let next_revision = session
        .revision
        .checked_add(1)
        .ok_or("browser-revision-exhausted")?;
    session.busy = true;
    session.revision = next_revision;
    Ok((
        witness,
        id.clone(),
        p.native_role.ok_or("native-click-approved-role-missing")?,
        p.url.ok_or("native-click-approved-source-missing")?,
        p.form_intent,
        p.link_intent,
    ))
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
    if !matches!(
        p.request.operation,
        TfBrowserOperation::OpenConfined
            | TfBrowserOperation::OpenConfinedTab
            | TfBrowserOperation::OpenRequestedPopup
    ) {
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
    // The native-host resource is deliberately namespaced instead of placed
    // beside the app binary: Tauri's automatic binary staging can otherwise
    // collide with the pinned resource under the same basename. The exact
    // bundled path remains internal, not chosen by the model or renderer.
    let host_executable = resource_root
        .join("tf4-native-host")
        .join("clack-browser-host.exe");
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
        // A same-origin passive GET is not an implicit effect grant. Until
        // the central TF4 UI binds an exact manifest, only the original
        // approved document can leave the broker.
        resource_manifest: p.request.resource_manifest.clone().unwrap_or_default(),
        private_parent,
        host_executable,
        host_sha256: pinned.to_owned(),
    };
    let popup = p.request.operation == TfBrowserOperation::OpenRequestedPopup;
    if active.cancelled.load(Ordering::Acquire) {
        receipt.terminal = "cancelled";
        receipt.reason_code = "confined-cancelled-before-launch".into();
        receipt.uncertainty = "no-browser-created";
        if popup {
            receipt.browser_session_id = None;
        }
        receipt.ended_at = millis();
        return Ok(receipt);
    }
    // Recheck the consumed central reservation on the actual blocking launch
    // worker, not merely before scheduling it. No registry/state lock is
    // held while creating the isolated native process.
    let launch_popup = popup.then(|| (p.clone(), active.clone(), token.to_owned()));
    let launch_app = app.clone();
    let launch = tauri::async_runtime::spawn_blocking(move || {
        let registry = launch_app.state::<WorkspaceRegistry>();
        if let Some((pending, active, token)) = launch_popup {
            let state = launch_app.state::<TfBrowserState>();
            let entries = state.entries.lock().map_err(|_| "browser-state-unavailable")?;
            validate_popup_child_scope(&entries, &pending, &active, &token, &registry)?;
        }
        BrowserRuntimeSession::launch(start, &registry)
    })
    .await
    .map_err(|_| "confined-native-launch-task-unavailable")?;
    let mut browser = match launch {
        Ok(browser) => browser,
        Err(reason) => {
            receipt.terminal = if popup && popup_child_cancelled(&active) { "cancelled" } else { "failed" };
            if popup {
                receipt.browser_session_id = None;
            }
            receipt.reason_code = reason;
            receipt.uncertainty = "native-launch-rejected-before-resource-service";
            receipt.ended_at = millis();
            return Ok(receipt);
        }
    };
    let mut cancelled = active.cancel_watch.subscribe();
    let popup_ready_scope = if popup {
        state.entries.lock().map_err(|_| "browser-state-unavailable".to_owned())
            .and_then(|entries| validate_popup_child_scope(&entries, &p, &active, token, registry))
    } else {
        Ok(())
    };
    let popup_deadline = p.popup_intent.as_ref().filter(|_| popup)
        .map(|intent| p.expires.min(intent.expires_at));
    let readiness = if let Err(reason) = popup_ready_scope {
        Err(reason)
    } else if *cancelled.borrow() {
        Err("confined-native-cancelled-during-launch".to_owned())
    } else {
        tokio::select! {
            ready = browser.verify_ready_for_control_turns() => ready,
            changed = cancelled.changed() => {
                let _ = changed;
                Err("confined-native-cancelled-during-readiness".to_owned())
            }
            _ = async {
                match popup_deadline {
                    Some(deadline) => tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)).await,
                    None => std::future::pending::<()>().await,
                }
            } => Err("popup-original-intent-expired-during-readiness".to_owned()),
        }
    };
    if let Err(reason) = readiness {
        let teardown = browser.shutdown();
        receipt.terminal = if active.cancelled.load(Ordering::Acquire) || (popup && popup_child_cancelled(&active)) {
            "cancelled"
        } else {
            "failed"
        };
        receipt.reason_code = reason;
        if popup {
            receipt.browser_session_id = None;
        }
        receipt.uncertainty = if teardown.is_ok() {
            "native-readiness-failed-owned-job-drained"
        } else {
            "UNKNOWN-native-process-cleanup-unverified"
        };
        receipt.ended_at = millis();
        return Ok(receipt);
    }

    // The same single background task owns both native COM control turns and
    // TF3 GET service. No second reader/writer is allowed on either sealed pipe.
    // Host-issued idle turns are scheduling leases only; they do NOT authorize
    // an effectful gesture or replace the central approval transaction.
    let (stop, mut stopped) = watch::channel(false);
    let turn_requester = browser
        .control_turn_requester()
        .ok_or("confined-native-control-turn-attestation-missing")?;
    let queued_turn_requester = turn_requester.clone();
    let (command_tx, mut command_rx) = mpsc::channel::<NativeCommand>(8);
    let receipts = Arc::new(Mutex::new(Vec::<BrokerResourceReceipt>::new()));
    let history = receipts.clone();
    let snapshot = Arc::new(Mutex::new(None::<PageSnapshot>));
    let published_snapshot = snapshot.clone();
    let service_app = app.clone();
    let owner_alive = Arc::new(AtomicBool::new(true));
    let running = owner_alive.clone();
    let (mut popup_commit_tx, popup_commit_rx) = if popup {
        let (tx, rx) = oneshot::channel();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };
    let task = tauri::async_runtime::spawn(async move {
        // Runs on every normal exit and on panic/unwind; a dead actor must
        // never keep granting fresh actions from an old semantic snapshot.
        let _liveness = NativeOwnerLivenessGuard(running);
        // Readiness attests the zero-network AppContainer and may enqueue a
        // native document request. Until the exact central commit signals
        // this gate, no TF3 dispatch or native control command is serviced.
        if !await_popup_child_commit(popup_commit_rx, &mut stopped).await {
            return browser.shutdown()
                .map_err(|_| "confined-native-job-udf-cleanup-unverified".into());
        }
        let deadline = tokio::time::Instant::now() + SESSION_TTL;
        let mut terminal = Ok(());
        // A dispatch acknowledgment is not the final click terminal. The
        // single pipe owner must continue TF3/COM service, without processing
        // another action, until independent navigation or an UNKNOWN deadline.
        let mut pending_click: Option<PendingNativeClickEffect> = None;
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
                    if let Some(waiting) = pending_click.as_ref() {
                        let expired = Instant::now() >= waiting.deadline;
                        let abandoned = waiting.reply.is_closed();
                        let evidence = (!expired && !abandoned)
                            .then(|| {
                                native_link_navigation_evidence(
                                    &result,
                                    &waiting.source_url,
                                    &waiting.target_url_sha256,
                                    waiting.source_generation,
                                    waiting.resource_request_floor,
                                    &waiting.approved_role,
                                    &waiting.consumed_action_id,
                                )
                            })
                            .flatten();
                        let confirmed = evidence.is_some();
                        if confirmed || expired || abandoned {
                            if let Some(mut waiting) = pending_click.take() {
                                let terminal = if confirmed {
                                    NativeEffectTerminal::Confirmed
                                } else {
                                    // An unconfirmed dispatch stays UNKNOWN,
                                    // even if the reply receiver has vanished.
                                    NativeEffectTerminal::Dispatched
                                };
                                let mut effect = NativeEffectReceipt::classify(terminal);
                                let mut evidence = evidence;
                                if waiting
                                    .durable_effect
                                    .as_mut()
                                    .is_some_and(|guard| guard.settle(&effect).is_err())
                                {
                                    effect = NativeEffectReceipt::classify(
                                        NativeEffectTerminal::Unknown,
                                    );
                                    evidence = None;
                                }
                                let _ = waiting.reply.send(Ok(NativeClickCompletion {
                                    effect,
                                    evidence,
                                    form_transport: None,
                                }));
                                // The original busy lease is released once.
                            }
                        }
                    }
                    if result.terminal != "idle" {
                        // Every new GET can mutate DOM/state. Never retain an
                        // exact element across a new native resource flight.
                        if let Ok(mut latest) = published_snapshot.lock() {
                            *latest = None;
                        }
                        if let Ok(mut rows) = history.lock() {
                            if rows.len() >= 32 {
                                rows.remove(0);
                            }
                            rows.push(result);
                        }
                    }
                    if browser.has_control_turn() && pending_click.is_none() {
                        // At this point the child worker explicitly froze new
                        // v1 resource tickets and both pipes are idle. Do NOT
                        // poll/cancel serve_one() against command_rx: dropping
                        // an active GET future kills its owned FlightFence.
                        if let Ok(command) = command_rx.try_recv() {
                            match command {
                                NativeCommand::Observe { reply } => {
                                    if !reply.is_closed() {
                                        let observed =
                                            browser.observe_closed_snapshot_in_control_turn().await;
                                        if let Ok(mut current) = published_snapshot.lock() {
                                            *current = observed.as_ref().ok().cloned();
                                        }
                                        let failed = observed.is_err();
                                        let _ = reply.send(observed);
                                        if failed {
                                            terminal =
                                                Err("confined-native-observation-uncertain".into());
                                            break;
                                        }
                                    }
                                }
                                NativeCommand::CaptureForm {
                                    target,
                                    action,
                                    reply,
                                } => {
                                    if !reply.is_closed() {
                                        let captured = browser
                                            .capture_form_in_control_turn(&target, action)
                                            .await;
                                        let failed = captured.is_err();
                                        let _ = reply.send(captured);
                                        if failed {
                                            terminal = Err(
                                                "confined-native-form-capture-uncertain".into(),
                                            );
                                            break;
                                        }
                                    }
                                }
                                NativeCommand::CaptureLink { target, reply } => {
                                    if !reply.is_closed() {
                                        let captured = browser
                                            .capture_link_in_control_turn(&target)
                                            .await;
                                        let failed = captured.is_err();
                                        let _ = reply.send(captured);
                                        if failed {
                                            terminal = Err(
                                                "confined-native-link-capture-uncertain".into(),
                                            );
                                            break;
                                        }
                                    }
                                }
                                NativeCommand::ReserveAction {
                                    token,
                                    target,
                                    action,
                                    deadline,
                                    reply,
                                } => {
                                    if !reply.is_closed() {
                                        // Pure owner-local validation. No COM activation,
                                        // page refresh, permission grant or network I/O.
                                        let reserved = browser.reserve_action_for_consent(
                                            &token, &target, action, deadline,
                                        );
                                        let _ = reply.send(reserved);
                                    }
                                }
                                NativeCommand::CapturePopup {
                                    expected_url,
                                    reply,
                                    _capture_lease,
                                } => {
                                    if !reply.is_closed() {
                                        if let Err(reason) = _capture_lease.admit(&expected_url) {
                                            let _ = reply.send(Err(reason));
                                            continue;
                                        }
                                        let captured = browser
                                            .capture_popup_in_control_turn(&expected_url)
                                            .await;
                                        let failed = captured.is_err();
                                        let _ = reply.send(captured);
                                        if failed {
                                            terminal = Err("confined-native-popup-capture-uncertain".into());
                                            break;
                                        }
                                    }
                                }
                                NativeCommand::Screenshot {
                                    token,
                                    browser_id,
                                    active,
                                    reply,
                                } => {
                                    let _lease = NativeActionBusyGuard {
                                        app: service_app.clone(),
                                        browser_id: browser_id.clone(),
                                        token: token.clone(),
                                    };
                                    if reply.is_closed() {
                                        continue;
                                    }
                                    let consent = consume_native_screenshot_approval(
                                        &token,
                                        &browser_id,
                                        &registry,
                                        &service_app.state::<TfBrowserState>(),
                                    );
                                    let result = match consent {
                                        Ok(grant)
                                            if !active.cancelled.load(Ordering::Acquire)
                                                && active
                                                    .native_click_phase
                                                    .as_ref()
                                                    .is_some_and(|phase| {
                                                        phase
                                                            .compare_exchange(
                                                                NATIVE_CLICK_QUEUED,
                                                                NATIVE_CLICK_DISPATCH_COMMITTED,
                                                                Ordering::AcqRel,
                                                                Ordering::Acquire,
                                                            )
                                                            .is_ok()
                                                    }) =>
                                        {
                                            match browser.capture_screenshot_in_control_turn().await
                                            {
                                                Ok(captured) => {
                                                    tf_operations::commit_native_screenshot_evidence(
                                                        grant, captured, &registry,
                                                    )
                                                }
                                                Err(reason) => Err(reason),
                                            }
                                        }
                                        Ok(_) => {
                                            Err("native-screenshot-cancelled-before-capture".into())
                                        }
                                        Err(reason) => Err(reason),
                                    };
                                    let failed = result.is_err();
                                    let _ = reply.send(result);
                                    if failed {
                                        // Never retry an uncertain native capture or partial
                                        // TF2 write. Shut down the owned WebView2 Job.
                                        terminal = Err(
                                            "native-screenshot-evidence-outcome-unknown".into(),
                                        );
                                        break;
                                    }
                                }
                                NativeCommand::Click {
                                    token,
                                    browser_id,
                                    target,
                                    action,
                                    reservation,
                                    active,
                                    reply,
                                } => {
                                    // The owner of this mailbox command must
                                    // release its reservation even on denied,
                                    // stale, cancelled, expired or closed reply.
                                    let mut lease = Some(NativeActionBusyGuard {
                                        app: service_app.clone(),
                                        browser_id: browser_id.clone(),
                                        token: token.clone(),
                                    });
                                    if !reply.is_closed() {
                                        let approved = (|| {
                                            if active.cancelled.load(Ordering::Acquire) {
                                                return Err(
                                                    "native-click-cancelled-before-consumption"
                                                        .to_owned(),
                                                );
                                            }
                                            let scope = browser
                                                .exact_retained_scope_with_reservation(
                                                    &target,
                                                    action.clone(),
                                                    &reservation,
                                                    &token,
                                                )?;
                                            let authority = service_app.state::<TfBrowserState>();
                                            let registry = service_app.state::<WorkspaceRegistry>();
                                            consume_native_action_approval(
                                                &token,
                                                &scope,
                                                &reservation,
                                                &registry,
                                                &authority,
                                            )
                                        })();
                                        let mut clicked_source = None;
                                        let mut form_transport: Option<NativeFormTransportProof> =
                                            None;
                                        let mut durable_effect = None;
                                        let attempted = match approved {
                                            Ok((
                                                grant,
                                                approved_browser_id,
                                                approved_role,
                                                source_url,
                                                approved_form,
                                                approved_link,
                                            )) => {
                                                if approved_browser_id != browser_id {
                                                    Ok((NativeEffectReceipt::classify(
                                                        NativeEffectTerminal::FailedBeforeDispatch,
                                                    ), None))
                                                } else if matches!(
                                                    action,
                                                    NativeRetainedAction::Submit(_)
                                                ) {
                                                    // Original FORM+submitter capture was sealed
                                                    // BEFORE consent. Re-read those SAME retained
                                                    // nodes on a new exclusive COM turn. No
                                                    // selector lookup, body substitution or page
                                                    // requestSubmit()/fetch() is ever allowed.
                                                    let recaptured = browser
                                                        .capture_form_with_reservation_in_control_turn(
                                                            &target, action.clone(), &reservation, &token,
                                                        )
                                                        .await;
                                                    if !matches!(
                                                        (approved_form.as_ref(), recaptured.as_ref()),
                                                        (Some(approved), Ok(current)) if
                                                            super::tf_browser_runtime::original_form_intent_unchanged(approved, current)
                                                    ) {
                                                        Ok((
                                                            NativeEffectReceipt::classify(
                                                                NativeEffectTerminal::Stale,
                                                            ),
                                                            None,
                                                        ))
                                                    } else if !reservation
                                                        .matches(&token, &target, &action)
                                                    {
                                                        // No late TF3 write after either the
                                                        // approval or ORIGINAL resource deadline.
                                                        Ok((
                                                            NativeEffectReceipt::classify(
                                                                NativeEffectTerminal::Stale,
                                                            ),
                                                            None,
                                                        ))
                                                    } else if active
                                                        .native_click_phase
                                                        .as_ref()
                                                        .is_none_or(|phase| {
                                                            phase
                                                                .compare_exchange(
                                                                    NATIVE_CLICK_QUEUED,
                                                                    NATIVE_CLICK_DISPATCH_COMMITTED,
                                                                    Ordering::AcqRel,
                                                                    Ordering::Acquire,
                                                                )
                                                                .is_err()
                                                        })
                                                    {
                                                        Ok((NativeEffectReceipt::classify(
                                                            NativeEffectTerminal::CancelledBeforeDispatch,
                                                        ), None))
                                                    } else if let Ok(guard) =
                                                        NativeDurableEffect::begin(
                                                            &service_app,
                                                            &grant,
                                                        )
                                                    {
                                                        durable_effect = Some(guard);
                                                        let form = recaptured.expect(
                                                            "matched preconsent captured form",
                                                        );
                                                        let origin = Url::parse(&source_url)
                                                            .map_err(|_| {
                                                                "native-form-source-origin-invalid"
                                                                    .to_owned()
                                                            })?;
                                                        let post = tf_web::TfBrowserBoundPost {
                                                            destination: form.destination,
                                                            approved_origin: origin.clone(),
                                                            body: form.body,
                                                            body_sha256: form.body_sha256,
                                                            content_type:
                                                                "application/x-www-form-urlencoded",
                                                            source_page_generation: target
                                                                .page_generation,
                                                            original_form_index: form
                                                                .original_form_index,
                                                            original_submitter_index: form
                                                                .original_submitter_index,
                                                            consumed_approval_id: grant
                                                                .action_id()
                                                                .to_owned(),
                                                        };
                                                        let (
                                                            approved_actor,
                                                            approved_session,
                                                            approved_root,
                                                        ) = grant.tf3_identity();
                                                        let approved_actor =
                                                            approved_actor.to_owned();
                                                        let approved_session =
                                                            approved_session.to_owned();
                                                        let approved_root = approved_root
                                                            .to_string_lossy()
                                                            .into_owned();
                                                        let prepared =
                                                            tf_web::prepare_browser_bound_post(
                                                                grant,
                                                                &approved_actor,
                                                                &approved_session,
                                                                &approved_root,
                                                                post,
                                                                &registry,
                                                                &web,
                                                            );
                                                        match prepared {
                                                            Ok(prepared) => {
                                                                if let Ok(mut inner) = active.tf_web_token.lock() {
                                                                    *inner = Some(prepared.token.clone());
                                                                }
                                                                // A durable-ledger write or TF3 preparation may
                                                                // exhaust the ORIGINAL reservation. Cancel its
                                                                // unused TF3 token without a network attempt.
                                                                if !reservation.matches(&token, &target, &action) {
                                                                    let _ = tf_web::cancel(&prepared.token, &web);
                                                                    Ok((NativeEffectReceipt::classify(
                                                                        NativeEffectTerminal::Stale,
                                                                    ), None))
                                                                } else {
                                                                let mut transport_terminal = NativeEffectTerminal::Dispatched;
                                                                match tf_web::execute_browser_bound_post_before(
                                                                    &prepared.token, &registry, &web, &origin,
                                                                    tokio::time::Instant::from_std(reservation.expires_at),
                                                                ).await {
                                                                    Ok(transport) => {
                                                                        // TF3 distinguishes an actually submitted
                                                                        // or ambiguous POST from a proven no-send.
                                                                        // Neither is entitled to another attempt.
                                                                        if transport.receipt.effect_state == "NoEffect" {
                                                                            transport_terminal = if transport.receipt.terminal == "timed_out" {
                                                                                NativeEffectTerminal::Stale
                                                                            } else {
                                                                                NativeEffectTerminal::FailedBeforeDispatch
                                                                            };
                                                                        }
                                                                        form_transport = Some(NativeFormTransportProof {
                                                                            method: "POST",
                                                                            destination_sha256: transport.destination_sha256,
                                                                            body_sha256: transport.request_body_sha256,
                                                                            body_bytes: transport.request_body_bytes,
                                                                            tf3_request_id: transport.receipt.request_id,
                                                                            status_code: transport.receipt.status_code,
                                                                            effect_state: transport.receipt.effect_state,
                                                                            retry: transport.receipt.retry,
                                                                        });
                                                                    }
                                                                    Err(_) => {
                                                                        // Network attempt may have escaped; never
                                                                        // convert missing receipt to no effect.
                                                                    }
                                                                }
                                                                Ok((NativeEffectReceipt::classify(
                                                                    transport_terminal,
                                                                ), None))
                                                                }
                                                            }
                                                            Err(_) => Ok((NativeEffectReceipt::classify(
                                                                NativeEffectTerminal::FailedBeforeDispatch,
                                                            ), None)),
                                                        }
                                                    } else {
                                                        Ok((NativeEffectReceipt::classify(NativeEffectTerminal::FailedBeforeDispatch), None))
                                                    }
                                                } else if active
                                                    .native_click_phase
                                                    .as_ref()
                                                    .is_none_or(|phase| {
                                                        phase
                                                            .compare_exchange(
                                                                NATIVE_CLICK_QUEUED,
                                                                NATIVE_CLICK_DISPATCH_COMMITTED,
                                                                Ordering::AcqRel,
                                                                Ordering::Acquire,
                                                            )
                                                            .is_err()
                                                    })
                                                {
                                                    Ok((NativeEffectReceipt::classify(
                                                        NativeEffectTerminal::CancelledBeforeDispatch,
                                                    ), None))
                                                } else if let Ok(guard) =
                                                    NativeDurableEffect::begin(&service_app, &grant)
                                                {
                                                    durable_effect = Some(guard);
                                                    // Capture the request floor BEFORE native
                                                    // dispatch: requests begun during the COM
                                                    // call but before its ACK must not be lost.
                                                    // The floor is an anti-replay bound, NOT
                                                    // sufficient causal attribution.
                                                    clicked_source = Some((
                                                        approved_role,
                                                        source_url,
                                                        grant.action_id().to_owned(),
                                                        browser.last_resource_request_id(),
                                                    ));
                                                    if action == NativeRetainedAction::Click {
                                                        let link = approved_link.as_ref()
                                                            .ok_or("native-click-consented-link-intent-missing")?;
                                                        browser
                                                            .dispatch_exact_click_in_control_turn(
                                                                grant,
                                                                link,
                                                                &reservation,
                                                            )
                                                            .await
                                                    } else {
                                                        browser.dispatch_retained_action_in_control_turn(grant, &reservation).await
                                                    }
                                                } else {
                                                    Ok((NativeEffectReceipt::classify(NativeEffectTerminal::FailedBeforeDispatch), None))
                                                }
                                            }
                                            Err(reason) => Ok((
                                                NativeEffectReceipt::classify(
                                                    native_pre_dispatch_terminal(&reason),
                                                ),
                                                None,
                                            )),
                                        };
                                        if let Ok(mut latest) = published_snapshot.lock() {
                                            *latest = None;
                                        }
                                        if matches!(
                                            &attempted,
                                            Ok((effect, _)) if effect.terminal == NativeEffectTerminal::Dispatched
                                        ) {
                                            if let (
                                                Some((approved_role, source_url, action_id, floor)),
                                                Some(target_url_sha256),
                                            ) = (
                                                clicked_source.filter(|(role, _, _, _)| {
                                                    action == NativeRetainedAction::Click
                                                        && *role == SemanticRole::Link
                                                }),
                                                attempted
                                                    .as_ref()
                                                    .ok()
                                                    .and_then(|(_, digest)| digest.clone()),
                                            ) {
                                                pending_click = Some(PendingNativeClickEffect {
                                                    source_url,
                                                    target_url_sha256,
                                                    source_generation: target.page_generation,
                                                    resource_request_floor: floor,
                                                    consumed_action_id: action_id,
                                                    approved_role,
                                                    // One further bounded TF3 idle interval may
                                                    // complete after the initial click dispatch.
                                                    deadline: Instant::now()
                                                        + Duration::from_secs(18),
                                                    reply,
                                                    _lease: lease
                                                        .take()
                                                        .expect("native click owns lease"),
                                                    durable_effect: durable_effect.take(),
                                                });
                                            } else {
                                                let _ = reply.send(attempted.map(|(effect, _)| {
                                                    let effect =
                                                        if durable_effect.as_mut().is_some_and(
                                                            |guard| guard.settle(&effect).is_err(),
                                                        ) {
                                                            NativeEffectReceipt::classify(
                                                                NativeEffectTerminal::Unknown,
                                                            )
                                                        } else {
                                                            effect
                                                        };
                                                    NativeClickCompletion {
                                                        effect,
                                                        evidence: None,
                                                        form_transport: form_transport.clone(),
                                                    }
                                                }));
                                            }
                                        } else {
                                            let _ = reply.send(attempted.map(|(effect, _)| {
                                                let effect = if durable_effect.as_mut().is_some_and(
                                                    |guard| guard.settle(&effect).is_err(),
                                                ) {
                                                    NativeEffectReceipt::classify(
                                                        NativeEffectTerminal::Unknown,
                                                    )
                                                } else {
                                                    effect
                                                };
                                                NativeClickCompletion {
                                                    effect,
                                                    evidence: None,
                                                    form_transport: form_transport.clone(),
                                                }
                                            }));
                                        }
                                    }
                                }
                            }
                            // Signals are coalesced scheduling requests. A
                            // second already-queued command must explicitly
                            // request the NEXT host turn; one claim cannot
                            // be reused or carry two v2 control frames.
                            if !command_rx.is_empty() {
                                queued_turn_requester.request();
                            }
                        }
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
        if let Some(waiting) = pending_click.take() {
            // Native shutdown/crash after a possible gesture cannot imply
            // cancellation or failure. Burn the original action and report
            // UNKNOWN without retrying or claiming COM deferrals completed.
            let _ = waiting
                .reply
                .send(Ok(NativeClickCompletion::without_evidence(
                    NativeEffectReceipt::classify(NativeEffectTerminal::Unknown),
                )));
        }
        let cleanup = browser.shutdown();
        if cleanup.is_err() {
            Err("confined-native-job-udf-cleanup-unverified".into())
        } else {
            terminal
        }
    });
    let mut native = Some(NativeBackground {
        stop,
        task: Some(task),
        owner_alive,
        command_tx,
        turn_requester,
        snapshot,
        receipts,
    });
    let id = p
        .browser_id
        .clone()
        .ok_or("confined-native-id-unavailable")?;
    let original_url = p.url.clone().ok_or("confined-native-url-unavailable")?;
    let snapshot_id = nonce()?;
    let committed = {
        let mut entries = state.entries.lock().map_err(|_| "browser-state-unavailable")?;
        let eligible = if popup {
            validate_popup_child_scope(&entries, &p, &active, token, registry).and_then(|()| {
                if p.expires <= Instant::now()
                    || p.popup_intent.as_ref().is_none_or(|intent| intent.expires_at <= Instant::now()) {
                    return Err("popup-original-intent-expired-before-commit".into());
                }
                if !commit_popup_child(&active) {
                    return Err("popup-child-central-commit-revoked".into());
                }
                Ok(())
            })
        } else if entries.sessions.len() < MAX_SESSIONS
                && !active.cancelled.load(Ordering::Acquire)
                && registry.is_authorized(&p.root)
                && (!p.request.operation.opens_child()
                    || validate_tab_opener(&entries, &p.request, &p.root, p.revision, true).is_ok())
        {
            Ok(())
        } else {
            Err("confined-native-session-revoked-before-commit".into())
        };
        if let Err(reason) = eligible {
            Err(reason)
        } else {
            entries.sessions.insert(
                id.clone(),
                BrowserSession {
                    opener_id: if p.request.operation.opens_child() {
                        p.request.browser_session_id.clone()
                    } else {
                        None
                    },
                    actor: p.request.actor.clone(),
                    session_id: p.request.session_id.clone(),
                    root: p.root.clone(),
                    snapshot: Snapshot {
                        id: snapshot_id,
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
                    native_reserved_action: None,
                    expires: Instant::now() + SESSION_TTL,
                    native: native.take(),
                },
            );
            // The insertion and signal share this lock: no observer, close
            // or other operation can interleave before the gate is released.
            if let Some(gate) = popup_commit_tx.take() {
                if gate.send(()).is_err() {
                    native = entries.sessions.remove(&id)
                        .and_then(|mut session| session.native.take());
                    Err("popup-child-service-owner-lost-before-commit".into())
                } else {
                    Ok(())
                }
            } else {
                Ok(())
            }
        }
    };
    if let Err(reason) = committed {
        drop(popup_commit_tx.take());
        receipt.terminal = if popup && popup_child_cancelled(&active) { "cancelled" } else { "failed" };
        receipt.reason_code = reason;
        receipt.uncertainty = "UNKNOWN-native-session-commit-race";
        if popup {
            receipt.browser_session_id = None;
            // Join the denied actor outside the authority mutex. Dropping
            // the gate cannot authorize service, even if cleanup times out.
            if let Some(mut rejected) = native.take() {
                rejected.stop.send_replace(true);
                if let Some(join) = rejected.task.take() {
                    if matches!(tokio::time::timeout(Duration::from_secs(7), join).await, Ok(Ok(Ok(())))) {
                        receipt.uncertainty = "popup-child-not-serviced-owned-job-drained";
                    }
                }
            }
        }
        receipt.ended_at = millis();
        return Ok(receipt);
    }
    receipt.terminal = "pending";
    receipt.reason_code = "confined-native-appcontainer-ready-broker-serving".into();
    receipt.policy_decision = "allowed";
    receipt.effect_state = "Unknown";
    receipt.uncertainty = "initial-document-completion-and-DOM-not-yet-observed";
    receipt.browser_session_id = Some(id);
    receipt.ended_at = millis();
    Ok(receipt)
}

/// Internal UI-only, one-use centrally approved semantic observation. The
/// existing actor owns the same sealed native session and host-issued turn;
/// no competing pipe reader, script/selector API, or model tool is created.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn closed_native_observation_failure_reason(untrusted: &str) -> &'static str {
    // The native owner can return an opaque transport/COM failure string.
    // Export ONLY a fixed allowlist of host-authored categories. Paths,
    // page content, Windows error text and private broker details stay hidden.
    match untrusted {
        "STALE" | "observation-page-stale" | "browser-native-page-stale" => {
            "native-semantic-observation-page-stale"
        }
        "observation-timeout" | "browser-structure-observation-timeout" => {
            "native-semantic-observation-com-timeout"
        }
        "browser-structure-session-not-ready" | "browser-exclusive-control-turn-required" |
        "browser-control-turn-required" => {
            "native-semantic-observation-owner-not-ready"
        }
        "observation-session-broken" | "browser-control-turn-broker-lost" => {
            "native-semantic-observation-owner-broken"
        }
        "observation-result-invalid" | "observation-identity-invalid" |
        "observation-identity-unavailable" | "observation-identity-probe-invalid" => {
            "native-semantic-observation-identity-unverified"
        }
        _ => "native-semantic-observation-outcome-uncertain",
    }
}

#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
async fn execute_confined_observation(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
) -> Result<TfBrowserReceipt, String> {
    let (p, _active, _guard) = consume(token, registry, state)?;
    if p.request.operation != TfBrowserOperation::ObserveConfined {
        return Err("confined-native-observation-operation-changed".into());
    }
    let mut receipt = initial_receipt(&p);
    receipt.policy_decision = "allowed";
    receipt.retry = "NEVER_REPLAY";
    receipt.uncertainty = "native-observation-pending";
    let id = p
        .browser_id
        .as_deref()
        .ok_or("browser-session-id-required")?;
    let (sender, turn_requester) = {
        let entries = state
            .entries
            .lock()
            .map_err(|_| "browser-state-unavailable")?;
        let session = entries.sessions.get(id).ok_or("browser-session-expired")?;
        if !matches_scope(session, &p.request, &p.root)
            || p.revision != Some(session.revision)
            || session
                .native
                .as_ref()
                .is_none_or(|native| !native.owner_alive.load(Ordering::Acquire))
            || p.url.as_deref() != Some(session.snapshot.url.as_str())
        {
            return Err("confined-native-observation-scope-changed".into());
        }
        let owner = session
            .native
            .as_ref()
            .ok_or("confined-native-owner-missing")?;
        (owner.command_tx.clone(), owner.turn_requester.clone())
    };
    let (reply, result) = oneshot::channel();
    let request = NativeCommand::Observe { reply };
    let observed = match tokio::time::timeout(Duration::from_secs(2), sender.send(request)).await {
        Ok(Ok(())) => {
            // Scheduling only: cannot mint/extend approval or authorize COM.
            turn_requester.request();
            tokio::time::timeout(Duration::from_secs(25), result).await
        }
        _ => {
            receipt.terminal = "unknown";
            receipt.reason_code = "native-observation-command-transfer-uncertain".into();
            receipt.effect_state = "Unknown";
            receipt.uncertainty = "native-observation-session-may-be-closing";
            receipt.ended_at = millis();
            return Ok(receipt);
        }
    };
    match observed {
        Ok(Ok(Ok(page))) => {
            // BrowserPageContract independently bounded and secret-filtered
            // this projection; cap the serialized projection again at IPC.
            let bytes = serde_json::to_vec(&page)
                .map_err(|_| "native-semantic-snapshot-serialization-failed")?;
            if bytes.len() > 64 * 1024 {
                receipt.terminal = "failed";
                receipt.reason_code = "native-semantic-snapshot-bounds-denied".into();
                receipt.uncertainty = "native-observation-data-withheld";
            } else {
                let mut projected: serde_json::Value = serde_json::from_slice(&bytes)
                    .map_err(|_| "native-semantic-snapshot-invalid")?;
                // The authenticated host nonce is an INTERNAL pipe/session
                // identity. UI callers use the existing TF4 outer session ID;
                // prepare() independently maps it back to the retained native
                // nonce and never trusts the caller to supply either mapping.
                let object = projected
                    .as_object_mut()
                    .ok_or("native-semantic-snapshot-shape-denied")?;
                object.insert("browserSessionId".into(), id.to_owned().into());
                receipt.native_page = Some(projected);
                receipt.snapshot_id = Some(page.snapshot_id);
                receipt.terminal = "completed";
                receipt.effect_state = "Observed";
                receipt.reason_code = "native-exact-semantic-snapshot-observed".into();
                receipt.uncertainty = "authenticated-bounded-WebView2-COM-snapshot";
                // Each successful new observation invalidates older held
                // references and approvals, including those not yet used.
                let mut entries = state
                    .entries
                    .lock()
                    .map_err(|_| "browser-state-unavailable")?;
                if let Some(session) = entries.sessions.get_mut(id) {
                    if !matches_scope(session, &p.request, &p.root) {
                        return Err("confined-native-observation-owner-changed".into());
                    }
                    session.revision = session.revision.saturating_add(1);
                }
            }
        }
        Ok(Ok(Err(reason))) => {
            // Preserve RFC Editor-style UNKNOWN/NEVER_REPLAY while exposing
            // only an allowlisted, non-secret failure category. The native
            // owner still poisons and reaps its job on failed observation.
            receipt.terminal = "unknown";
            receipt.effect_state = "Unknown";
            receipt.reason_code = closed_native_observation_failure_reason(&reason).into();
            receipt.uncertainty = "native-observation-IPC-or-COM-unverified";
        }
        _ => {
            receipt.terminal = "unknown";
            receipt.effect_state = "Unknown";
            receipt.reason_code = "native-semantic-observation-outcome-uncertain".into();
            receipt.uncertainty = "native-observation-IPC-or-COM-unverified";
        }
    }
    receipt.ended_at = millis();
    Ok(receipt)
}

/// Screenshot is a distinct, genuine one-use native application consent.
/// The existing sealed actor owns WebView2 and the existing TF2 authority
/// atomically commits only the approved bounded PNG. No screenshot bytes,
/// base64, cookies, page text, or unapproved destination reach this receipt.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
async fn execute_confined_screenshot(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
) -> Result<TfBrowserReceipt, String> {
    let (p, sender, requester, active) = {
        let mut entries = state
            .entries
            .lock()
            .map_err(|_| "browser-state-unavailable")?;
        reap(&mut entries);
        let p = entries
            .pending
            .get(token)
            .ok_or("unknown-or-consumed-browser-token")?
            .clone();
        if p.request.operation != TfBrowserOperation::Screenshot
            || !p.approved
            || p.approving
            || p.expires <= Instant::now()
            || p.screenshot_scope.is_none()
            || scope(
                &p.request.actor,
                &p.request.session_id,
                &p.request.workspace_root,
                registry,
            )? != p.root
        {
            return Err("native-screenshot-original-approval-required".into());
        }
        let id = p
            .browser_id
            .as_deref()
            .ok_or("browser-session-id-required")?;
        let session = entries
            .sessions
            .get_mut(id)
            .ok_or("browser-session-expired")?;
        if !matches_scope(session, &p.request, &p.root)
            || p.revision != Some(session.revision)
            || session.busy
            || p.url.as_deref() != Some(session.snapshot.url.as_str())
        {
            return Err("native-screenshot-approval-session-revision-changed".into());
        }
        let owner = session
            .native
            .as_ref()
            .ok_or("native-screenshot-WebView2-only")?;
        if !owner.owner_alive.load(Ordering::Acquire) {
            return Err("native-screenshot-owner-not-live".into());
        }
        let sender = owner.command_tx.clone();
        let requester = owner.turn_requester.clone();
        let active = Arc::new(Active {
            native_click_phase: Some(AtomicU8::new(NATIVE_CLICK_QUEUED)),
            ..Active::default()
        });
        session.busy = true;
        session.native_reserved_action = Some(token.to_owned());
        entries.active.insert(token.to_owned(), active.clone());
        (p, sender, requester, active)
    };
    let id = p
        .browser_id
        .as_deref()
        .ok_or("native-screenshot-browser-id-missing")?;
    let _queue = NativeActionQueueGuard {
        state,
        browser_id: id.to_owned(),
        token: token.to_owned(),
    };
    let mut receipt = initial_receipt(&p);
    receipt.policy_decision = "allowed";
    receipt.retry = "NEVER_REPLAY";
    receipt.uncertainty = "native-screenshot-TF2-evidence-unverified";
    let (reply, received) = oneshot::channel();
    let send = tokio::time::timeout(
        Duration::from_secs(3),
        sender.send(NativeCommand::Screenshot {
            token: token.to_owned(),
            browser_id: id.to_owned(),
            active,
            reply,
        }),
    )
    .await;
    let result = match send {
        Ok(Ok(())) => {
            requester.request();
            tokio::time::timeout(Duration::from_secs(25), received).await
        }
        _ => {
            receipt.terminal = "unknown";
            receipt.reason_code = "native-screenshot-command-delivery-uncertain".into();
            receipt.effect_state = "Unknown";
            receipt.ended_at = millis();
            return Ok(receipt);
        }
    };
    match result {
        Ok(Ok(Ok(evidence))) => {
            receipt.terminal = "completed";
            receipt.reason_code = "native-screenshot-TF2-file-readback-verified".into();
            receipt.effect_state = "Observed";
            receipt.uncertainty =
                "native-TF2-workspace-file-effect-verified-not-production-accepted";
            receipt.snapshot_id = Some(evidence.snapshot_id.clone());
            receipt.content_sha256 = Some(evidence.content_sha256.clone());
            receipt.bytes_received = Some(evidence.bytes_verified as u64);
            receipt.native_screenshot_evidence = Some(evidence);
            receipt.unsupported.retain(|v| *v != "screenshots");
        }
        _ => {
            receipt.terminal = "unknown";
            receipt.reason_code = "native-screenshot-or-TF2-commit-outcome-uncertain".into();
            receipt.effect_state = "Unknown";
            receipt.retry = "NEVER_REPLAY";
        }
    }
    receipt.ended_at = millis();
    Ok(receipt)
}

/// The sole native origin-scoped credential use path. The existing TF4
/// application approval token is atomically consumed, the existing OS
/// keyring re-read (revocation/expiry at dispatch), and the existing TF3
/// public DNS/IP/TLS/one-use network owner sends one GET. No raw secret or
/// response body may enter WebView2, Tauri/model receipts or screenshots.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
async fn execute_confined_credential_get(
    token: &str,
    app: &tauri::AppHandle,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
    web: &TfWebState,
) -> Result<TfBrowserReceipt, String> {
    let (p, active, _central_lease) = consume(token, registry, state)?;
    let mut receipt = initial_receipt(&p);
    receipt.retry = "NEVER_REPLAY";
    receipt.policy_decision = "allowed";
    receipt.uncertainty = "credential-not-yet-delivered-to-approved-origin";
    let grant = NativeCredentialConsent::from_consumed(&p, token)?;
    let origin = grant.scope.origin.clone();
    let request = tf_web::TfBrowserOriginCredentialGet {
        destination: grant.scope.destination.clone(),
        approved_origin: origin.clone(),
        reference: grant.scope.reference.clone(),
        source_page_generation: grant.scope.page.page_generation,
        consumed_approval_id: token.to_owned(),
    };
    // The credential's account is a hash of the APPROVED origin plus an
    // opaque ref, not a page/model-selected keyring service or arbitrary name.
    let account = grant.credential_account();
    let secret = match secrets::read_secret(
        app,
        &app.state::<SecretsState>(),
        TF4_BROWSER_SECRET_SERVICE,
        &account,
    ) {
        Ok(Some(envelope)) => parse_native_keyring_credential(&envelope, millis()).ok(),
        _ => None,
    };
    let Some(secret) = secret else {
        receipt.terminal = "denied";
        receipt.reason_code = "native-credential-revoked-expired-or-invalid".into();
        receipt.effect_state = "NoEffect";
        receipt.policy_decision = "denied";
        receipt.ended_at = millis();
        return Ok(receipt);
    };
    if active.cancelled.load(Ordering::Acquire) {
        receipt.terminal = "cancelled";
        receipt.reason_code = "native-credential-cancelled-before-network".into();
        receipt.effect_state = "NoEffect";
        receipt.ended_at = millis();
        return Ok(receipt);
    }
    let prepared =
        match tf_web::prepare_browser_origin_credential_get(grant, request, registry, web) {
            Ok(prepared) => prepared,
            Err(_) => {
                receipt.terminal = "denied";
                receipt.reason_code = "native-credential-tf3-origin-or-grant-denied".into();
                receipt.effect_state = "NoEffect";
                receipt.policy_decision = "denied";
                receipt.ended_at = millis();
                return Ok(receipt);
            }
        };
    {
        let mut inner = active
            .tf_web_token
            .lock()
            .map_err(|_| "native-credential-active-tf3-token-lock-unavailable")?;
        *inner = Some(prepared.token.clone());
    }
    // If cancelled after prepare but before send, the exact TF3 token is
    // burned and no request is made. After send an uncertain result is NEVER
    // replayed by this or any alternate network path.
    if active.cancelled.load(Ordering::Acquire) {
        let _ = tf_web::cancel(&prepared.token, web);
        receipt.terminal = "cancelled";
        receipt.reason_code = "native-credential-cancelled-before-tf3-dispatch".into();
        receipt.effect_state = "NoEffect";
        receipt.ended_at = millis();
        return Ok(receipt);
    }
    match tf_web::execute_browser_origin_credential_get(
        &prepared.token,
        registry,
        web,
        &origin,
        secret,
    )
    .await
    {
        Ok(result) => {
            receipt.terminal = if result.terminal == "completed" {
                "completed"
            } else {
                "unknown"
            };
            receipt.effect_state = if result.credential_used {
                "Unknown"
            } else {
                result.effect_state
            };
            receipt.reason_code = if result.credential_used {
                "credential-delivered-to-exact-approved-origin-transport-only".into()
            } else {
                "native-credential-tf3-denied-or-not-attempted".into()
            };
            receipt.retry = "NEVER_REPLAY";
            receipt.status_code = result.status_code;
            receipt.dns_evidence = result.dns_evidence;
            receipt.native_credential_transport = Some(NativeOriginCredentialTransport {
                request_method: "GET",
                origin: origin.origin().ascii_serialization(),
                destination_sha256: format!(
                    "{:x}",
                    Sha256::digest(p.request.url.as_deref().unwrap_or("").as_bytes())
                ),
                reference_sha256: format!(
                    "{:x}",
                    Sha256::digest(p.request.text.as_deref().unwrap_or("").as_bytes())
                ),
                tf3_request_id: result.request_id,
                credential_sent_to_approved_origin: result.credential_used,
                status_code: result.status_code,
                effect_state: receipt.effect_state,
                retry: "NEVER_REPLAY",
            });
            receipt.uncertainty = "credential-transport-only-not-browser-business-effect-proof";
        }
        Err(_) => {
            receipt.terminal = "unknown";
            receipt.effect_state = "Unknown";
            receipt.reason_code = "native-credential-tf3-transport-outcome-unknown".into();
            receipt.retry = "NEVER_REPLAY";
        }
    }
    receipt.ended_at = millis();
    Ok(receipt)
}

/// The existing TF4 application's single-use approval, TF3 network authority
/// and TF2 workspace authority jointly own each native browser file effect.
/// No renderer file picker, server-controlled filename or generic model POST
/// can reach either private path. A remote request that may have begun always
/// yields UNKNOWN/NEVER_REPLAY until separately observed server-side evidence.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
async fn execute_confined_file_transfer(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
    web: &TfWebState,
) -> Result<TfBrowserReceipt, String> {
    let (pending, active, _lease) = consume(token, registry, state)?;
    let mut receipt = initial_receipt(&pending);
    receipt.retry = "NEVER_REPLAY";
    receipt.auto_retry = false;
    receipt.policy_decision = "allowed";
    receipt.uncertainty = "native-transfer-not-yet-dispatched";
    let grant = NativeTransferConsent::from_consumed(&pending, token)?;
    let origin = grant.approved_origin().clone();
    let destination = grant.approved_url().clone();
    let generation = grant.source_page_generation();
    let approval_id = token.to_owned();

    // TF2 independently reopens/attests the ORIGINAL local file immediately
    // before the network grant. A mutated file is a pre-dispatch denial, not
    // authorization to substitute new bytes or a new self-consistent SHA.
    let original_upload = if pending.request.operation == TfBrowserOperation::Upload {
        let (relative, bytes, digest) = grant
            .original_source()
            .ok_or("native-upload-original-preconsent-file-missing")?;
        let fresh = match tf_operations::read_native_browser_upload_file(
            registry,
            grant.approved_workspace(),
            relative,
        ) {
            Ok(file)
                if file.bytes.len() == bytes
                    && file.sha256 == digest
                    && file.relative_path == relative =>
            {
                file
            }
            _ => {
                receipt.terminal = "denied";
                receipt.reason_code = "native-upload-original-TF2-file-mutated-or-revoked".into();
                receipt.effect_state = "NoEffect";
                receipt.policy_decision = "denied";
                receipt.ended_at = millis();
                return Ok(receipt);
            }
        };
        Some(fresh)
    } else {
        None
    };
    if active.cancelled.load(Ordering::Acquire) {
        receipt.terminal = "cancelled";
        receipt.effect_state = "NoEffect";
        receipt.reason_code = "native-transfer-cancelled-before-network-grant".into();
        receipt.ended_at = millis();
        return Ok(receipt);
    }

    let prepared = match original_upload {
        Some(file) => tf_web::prepare_browser_bound_upload(
            &grant,
            tf_web::TfBrowserBoundUpload {
                destination: destination.clone(),
                approved_origin: origin.clone(),
                source_page_generation: generation,
                original_file_sha256: file.sha256,
                body: file.bytes,
                consumed_approval_id: approval_id.clone(),
            },
            registry,
            web,
        ),
        None => tf_web::prepare_browser_bound_download(
            &grant,
            tf_web::TfBrowserBoundDownload {
                destination: destination.clone(),
                approved_origin: origin.clone(),
                source_page_generation: generation,
                consumed_approval_id: approval_id.clone(),
            },
            registry,
            web,
        ),
    };
    let prepared = match prepared {
        Ok(value) => value,
        Err(_) => {
            receipt.terminal = "denied";
            receipt.effect_state = "NoEffect";
            receipt.policy_decision = "denied";
            receipt.reason_code = "native-transfer-TF3-public-policy-or-witness-denied".into();
            receipt.ended_at = millis();
            return Ok(receipt);
        }
    };
    {
        let mut inner = active
            .tf_web_token
            .lock()
            .map_err(|_| "native-transfer-inner-TF3-token-unavailable")?;
        *inner = Some(prepared.token.clone());
    }
    if active.cancelled.load(Ordering::Acquire) {
        let _ = tf_web::cancel(&prepared.token, web);
        receipt.terminal = "cancelled";
        receipt.effect_state = "NoEffect";
        receipt.reason_code = "native-transfer-TF3-token-cancelled-before-send".into();
        receipt.ended_at = millis();
        return Ok(receipt);
    }
    if pending.request.operation == TfBrowserOperation::Upload {
        match tf_web::execute_browser_bound_upload(&prepared.token, registry, web, &origin).await {
            Ok(transport) => {
                receipt.status_code = transport.receipt.status_code;
                receipt.terminal = if transport.receipt.terminal == "completed" {
                    "completed"
                } else {
                    "unknown"
                };
                receipt.effect_state = if transport.receipt.terminal == "completed" {
                    "Unknown"
                } else {
                    transport.receipt.effect_state
                };
                receipt.reason_code = "native-upload-TF3-exact-body-transport-only".into();
                receipt.uncertainty = "server-side-upload-business-effect-unverified";
                receipt.dns_evidence = transport.receipt.dns_evidence;
                receipt.native_upload_transport = Some(NativeUploadTransport {
                    method: "POST",
                    destination_sha256: transport.destination_sha256,
                    original_file_sha256: transport.request_body_sha256,
                    body_bytes: transport.request_body_bytes,
                    tf3_request_id: transport.receipt.request_id,
                    status_code: transport.receipt.status_code,
                    remote_effect_state: "Unknown",
                    retry: "NEVER_REPLAY",
                });
            }
            Err(_) => {
                receipt.terminal = "unknown";
                receipt.effect_state = "Unknown";
                receipt.reason_code = "native-upload-remote-effect-uncertain".into();
                receipt.uncertainty = "possible-remote-upload-effect-never-replay";
            }
        }
    } else {
        match tf_web::execute_browser_bound_download(&prepared.token, registry, web, &origin).await
        {
            Ok(resource) => {
                receipt.status_code = resource.receipt.status_code;
                receipt.dns_evidence = resource.receipt.dns_evidence.clone();
                if resource.receipt.terminal != "completed" {
                    receipt.terminal = "unknown";
                    receipt.effect_state = "Unknown";
                    receipt.reason_code = "native-download-TF3-response-unverified".into();
                } else {
                    match tf_operations::commit_native_browser_download(grant, resource, registry) {
                        Ok(evidence) => {
                            receipt.terminal = "completed";
                            receipt.effect_state = "Observed";
                            receipt.reason_code =
                                "native-download-TF2-atomic-file-readback-verified".into();
                            receipt.uncertainty =
                                "local-workspace-file-only-remote-server-effect-unverified";
                            receipt.bytes_received = Some(evidence.bytes_verified as u64);
                            receipt.content_sha256 = Some(evidence.response_sha256.clone());
                            receipt.native_download_evidence = Some(evidence);
                        }
                        Err(_) => {
                            // The atomic file move may have happened before
                            // a later reparse/readback failure. Never retry.
                            receipt.terminal = "unknown";
                            receipt.effect_state = "Unknown";
                            receipt.reason_code =
                                "native-download-TF2-file-commit-outcome-uncertain".into();
                            receipt.uncertainty = "possible-local-file-effect-never-replay";
                        }
                    }
                }
            }
            Err(_) => {
                receipt.terminal = "unknown";
                receipt.effect_state = "Unknown";
                receipt.reason_code = "native-download-TF3-network-outcome-uncertain".into();
            }
        }
    }
    receipt.retry = "NEVER_REPLAY";
    receipt.auto_retry = false;
    receipt.ended_at = millis();
    Ok(receipt)
}

/// The original TF4 pending entry, UI approval and approved exact snapshot
/// remain authoritative until the native actor reaches an exclusive host turn.
/// This function cannot fabricate a grant or dispatch directly through IPC.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
async fn execute_confined_retained_action(
    token: &str,
    registry: &WorkspaceRegistry,
    state: &TfBrowserState,
    web_state: &TfWebState,
) -> Result<TfBrowserReceipt, String> {
    let (p, sender, turn_requester, target, action, active) = {
        let mut entries = state
            .entries
            .lock()
            .map_err(|_| "browser-state-unavailable")?;
        reap(&mut entries);
        let p = entries
            .pending
            .get(token)
            .ok_or("unknown-or-consumed-browser-token")?
            .clone();
        if !p.request.operation.native_action()
            || !p.approved
            || p.approving
            || p.expires <= Instant::now()
            || p.native_effect != Some(BrowserEffect::Unknown)
            || scope(
                &p.request.actor,
                &p.request.session_id,
                &p.request.workspace_root,
                registry,
            )? != p.root
        {
            return Err("native-click-central-approval-required-or-expired".into());
        }
        let id = p
            .browser_id
            .as_deref()
            .ok_or("browser-session-id-required")?;
        let session = entries
            .sessions
            .get_mut(id)
            .ok_or("browser-session-expired")?;
        if !matches_scope(session, &p.request, &p.root)
            || p.revision != Some(session.revision)
            || session.busy
            || p.url.as_deref() != Some(session.snapshot.url.as_str())
        {
            return Err("native-click-session-scope-or-revision-changed".into());
        }
        let owner = session
            .native
            .as_ref()
            .ok_or("native-click-confined-session-required")?;
        if !owner.owner_alive.load(Ordering::Acquire) {
            return Err("native-click-owner-not-live".into());
        }
        let sender = owner.command_tx.clone();
        let turn_requester = owner.turn_requester.clone();
        let target = p
            .native_target
            .clone()
            .ok_or("native-click-exact-target-required")?;
        let action = p
            .native_action
            .clone()
            .ok_or("native-action-original-parameters-missing")?;
        let active = Arc::new(Active {
            native_click_phase: Some(AtomicU8::new(NATIVE_CLICK_QUEUED)),
            ..Active::default()
        });
        session.busy = true;
        session.native_reserved_action = Some(token.to_owned());
        entries.active.insert(token.to_owned(), active.clone());
        (p, sender, turn_requester, target, action, active)
    };
    let _queued = NativeActionQueueGuard {
        state,
        browser_id: p.browser_id.clone().ok_or("browser-session-id-required")?,
        token: token.to_owned(),
    };
    let mut receipt = initial_receipt(&p);
    receipt.policy_decision = "allowed";
    receipt.retry = "NEVER_REPLAY";
    receipt.uncertainty = "native-exact-click-outcome-unverified";
    let reservation = p
        .native_reservation
        .clone()
        .ok_or("native-action-preconsent-reservation-required")?;
    if !reservation.matches(token, &target, &action) || reservation.expires_at != p.expires {
        return Err("native-action-preconsent-reservation-expired-or-changed".into());
    }
    let (reply, result) = oneshot::channel();
    let command = NativeCommand::Click {
        token: token.to_owned(),
        browser_id: p.browser_id.clone().ok_or("browser-session-id-required")?,
        target,
        action,
        reservation: Box::new(reservation),
        active,
        reply,
    };
    let terminal = match tokio::time::timeout(Duration::from_secs(2), sender.send(command)).await {
        Ok(Ok(())) => {
            turn_requester.request();
            // Includes the bounded independent TF3 post-dispatch window;
            // an early outer timeout must not erase an observed native effect.
            tokio::time::timeout(Duration::from_secs(45), result).await
        }
        _ => {
            // This command may have entered the native owner; even loss of
            // the send ACK cannot establish that no click was attempted.
            receipt.native_terminal = Some(NativeEffectTerminal::Unknown);
            receipt.canonical_terminal = Some(NativeEffectOutcome::Unknown);
            receipt.terminal = "unknown";
            receipt.effect_state = "Unknown";
            receipt.reason_code = "native-click-command-delivery-uncertain".into();
            receipt.ended_at = millis();
            let _ = cancel(token, state, web_state);
            return Ok(receipt);
        }
    };
    let completion = match terminal {
        Ok(Ok(Ok(result))) => result,
        _ => NativeClickCompletion::without_evidence(NativeEffectReceipt::classify(
            NativeEffectTerminal::Unknown,
        )),
    };
    let effect = completion.effect;
    receipt.native_effect_evidence = completion.evidence;
    receipt.native_form_transport = completion.form_transport;
    receipt.native_terminal = Some(effect.terminal);
    receipt.canonical_terminal = Some(effect.canonical_terminal);
    receipt.terminal = match effect.canonical_terminal {
        NativeEffectOutcome::Success => "success",
        NativeEffectOutcome::Failed => "failed",
        NativeEffectOutcome::Cancelled => "cancelled",
        NativeEffectOutcome::Unknown => "unknown",
    };
    receipt.effect_state = effect.effect_state;
    receipt.policy_decision = effect.policy_decision;
    receipt.retry = effect.retry;
    receipt.auto_retry = false;
    receipt.reason_code = effect.reason_code.into();
    receipt.uncertainty = if effect.canonical_terminal == NativeEffectOutcome::Success {
        "separately-bound-native-effect-confirmed"
    } else {
        "native-dispatch-is-not-independent-effect-evidence"
    };
    receipt.ended_at = millis();
    // Revoke an unused/expired token if execution never reached consumption;
    // a consumed token cannot be recreated or replayed by this call.
    let _ = cancel(token, state, web_state);
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
        TfBrowserOperation::OpenConfined
        | TfBrowserOperation::OpenConfinedTab
        | TfBrowserOperation::OpenRequestedPopup
        | TfBrowserOperation::ObserveConfined => {
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
        TfBrowserOperation::Close | TfBrowserOperation::CloseConfined => {
            let removed = {
                let mut entries = state
                    .entries
                    .lock()
                    .map_err(|_| "browser-state-unavailable")?;
                let id = p
                    .browser_id
                    .as_deref()
                    .ok_or("browser-session-id-required")?;
                remove_owned_session_tree(
                    &mut entries,
                    id,
                    p.request.operation == TfBrowserOperation::CloseConfined,
                )?
            };
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            let mut removed = removed;
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            if removed.iter().any(|session| session.native.is_some()) {
                // Stop every owner before awaiting any one child. Never let a
                // failed child short-circuit the remaining Job/UDF cleanup.
                for session in &removed {
                    if let Some(native) = &session.native {
                        native.stop.send_replace(true);
                    }
                }
                let mut all_clean = true;
                for session in &mut removed {
                    let Some(mut native) = session.native.take() else {
                        all_clean = false;
                        continue;
                    };
                    // A native close is complete ONLY after the owned Job, UDF
                    // and AppContainer profile cleanup task confirms success.
                    // Unknown cleanup may not be optimistically reported as a
                    // completed external effect or automatically replayed.
                    let termination = if let Some(join) = native.task.take() {
                        matches!(
                            tokio::time::timeout(Duration::from_secs(7), join).await,
                            Ok(Ok(Ok(())))
                        )
                    } else {
                        false
                    };
                    all_clean &= termination;
                    if let Ok(rows) = native.receipts.lock() {
                        receipt.bytes_retained = receipt
                            .bytes_retained
                            .saturating_add(rows.iter().map(|r| r.bytes).sum::<usize>());
                        // Only proven TF3 receipts are projected, never the
                        // untrusted page content, credential values or arbitrary
                        // document JSON. Existing TF3 authority owns the records.
                        let remaining = 32usize.saturating_sub(receipt.dns_evidence.len());
                        receipt.dns_evidence.extend(
                            rows.iter()
                                .flat_map(|r| {
                                    r.tf3.as_ref().map_or_else(Vec::new, |receipt| {
                                        receipt.dns_evidence.clone()
                                    })
                                })
                                .take(remaining),
                        );
                    };
                }
                match all_clean {
                    true => {
                        receipt.terminal = "completed";
                        receipt.effect_state = "Observed";
                        receipt.reason_code = "confined-owned-job-udf-profile-cleaned".into();
                        receipt.policy_decision = "allowed";
                        receipt.retry = "not_attempted";
                        receipt.uncertainty = "owned-native-session-terminated-observed";
                    }
                    false => {
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
            let _ = removed;
            if p.request.operation == TfBrowserOperation::CloseConfined {
                receipt.terminal = "failed";
                receipt.effect_state = "Unknown";
                receipt.reason_code = "confined-native-close-owner-missing".into();
                receipt.retry = "UNKNOWN";
                receipt.ended_at = millis();
                return Ok(receipt);
            }
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
                            opener_id: None,
                            actor: p.request.actor.clone(),
                            session_id: p.request.session_id.clone(),
                            root: p.root.clone(),
                            snapshot: snapshot.clone(),
                            history: Vec::new(),
                            revision: 1,
                            busy: false,
                            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
                            native_reserved_action: None,
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

/// Native approval UI only: never echo an untrusted URL path, query string,
/// fragment, credential or raw page text into the OS consent dialog.
#[cfg(all(windows, feature = "tf-browser-native-runtime"))]
fn target_origin_for_approval(raw: Option<&str>) -> Result<String, String> {
    let url = Url::parse(raw.ok_or("native-approval-origin-missing")?)
        .map_err(|_| "native-approval-origin-invalid")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("native-approval-origin-denied".into());
    }
    Ok(url.origin().ascii_serialization())
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
        if entries.approvals_shutdown {
            return Err("browser-native-approval-revoked".into());
        }
        let p = entries
            .pending
            .get_mut(&token)
            .ok_or("unknown-or-consumed-browser-token")?;
        if !(p.request.operation.approval_required() || {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            {
                p.screenshot_scope.is_some()
                    || p.credential_scope.is_some()
                    || p.transfer_scope.is_some()
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            {
                false
            }
        }) || p.approved
            || p.approving
        {
            return Err("browser-approval-not-applicable".into());
        }
        p.approving = true;
        p.clone()
    };
    let _approval_abandon = ApprovalAbandonGuard {
        entries: app.state::<TfBrowserState>().entries.clone(),
        token: token.clone(),
    };
    // SUBMIT is the only native effect requiring sensitive successful-control
    // bytes. Fetch the ORIGINAL retained FORM+submitter over the existing
    // serialized host pipe *before* showing the genuine consent dialog.
    // Nothing comes from request.text, a selector, or model-supplied bytes.
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let mut pending = pending;
    // A page-requested popup is not an application-created tab. Inspect the
    // already-vetoed one-use native intent BEFORE asking for consent, under
    // the original opener's exclusive host turn. The captured destination is
    // then part of this exact central pending token, never a launch grant.
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if pending.request.operation == TfBrowserOperation::OpenRequestedPopup {
        let (sender, requester, source_sha256, capture_lease) = {
            let authority = app.state::<TfBrowserState>();
            let mut entries = authority.entries.lock().map_err(|_| "browser-state-unavailable")?;
            let current = entries.pending.get(&token).ok_or("popup-pending-consent-lost")?;
            let opener_id = validate_tab_opener(
                &entries, &current.request, &current.root, current.revision, false
            )?;
            let opener = entries.sessions.get(&opener_id)
                .ok_or("popup-original-opener-expired")?;
            let source_sha256 = format!("{:x}", Sha256::digest(opener.snapshot.url.as_bytes()));
            let owner = opener.native.as_ref()
                .ok_or("popup-original-native-opener-unavailable")?;
            if !current.approving || current.approved || current.popup_intent.is_some()
                || !owner.owner_alive.load(Ordering::Acquire)
            {
                return Err("popup-capture-owner-or-token-stale".into());
            }
            let sender = owner.command_tx.clone();
            let requester = owner.turn_requester.clone();
            let opener = entries.sessions.get_mut(&opener_id)
                .ok_or("popup-original-opener-expired")?;
            opener.busy = true;
            opener.native_reserved_action = Some(token.clone());
            let capture_lease = Arc::new(PopupCaptureReservation {
                entries: authority.entries.clone(),
                opener_id,
                token: token.clone(),
            });
            (sender, requester, source_sha256, capture_lease)
        };
        let expected_url = pending.url.clone().ok_or("popup-destination-required")?;
        let (reply, received) = oneshot::channel();
        tokio::time::timeout(Duration::from_secs(3), sender.send(
            NativeCommand::CapturePopup {
                expected_url: expected_url.clone(), reply,
                _capture_lease: capture_lease.clone(),
            }
        )).await.map_err(|_| "popup-capture-queue-timeout")?
            .map_err(|_| "popup-capture-queue-closed")?;
        requester.request();
        let captured = tokio::time::timeout(Duration::from_secs(18), received)
            .await.map_err(|_| "popup-capture-timeout")?
            .map_err(|_| "popup-original-owner-stopped")??
            .ok_or("popup-no-matching-native-page-request")?;
        if captured.destination != expected_url || captured.page_generation != 1
            || captured.source_sha256 != source_sha256 {
            return Err("popup-captured-destination-or-generation-changed".into());
        }
        let authority = app.state::<TfBrowserState>();
        let mut entries = authority.entries.lock().map_err(|_| "browser-state-unavailable")?;
        let opener_id = validate_tab_opener(
            &entries, &pending.request, &pending.root, pending.revision, true
        )?;
        if entries.sessions.get(&opener_id)
            .and_then(|session| session.native_reserved_action.as_deref())
            != Some(token.as_str())
        {
            return Err("popup-capture-original-opener-reservation-changed".into());
        }
        let current = entries.pending.get_mut(&token).ok_or("popup-pending-consent-lost")?;
        if !current.approving || current.approved || current.request_id != pending.request_id
            || current.request != pending.request || current.revision != pending.revision
            || current.popup_intent.is_some()
        {
            return Err("popup-capture-central-scope-changed".into());
        }
        current.popup_intent = Some(captured.clone());
        pending.popup_intent = Some(captured);
        drop(entries);
        drop(capture_lease);
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if pending.request.operation == TfBrowserOperation::Click {
        let (sender, requester, target) = {
            let authority = app.state::<TfBrowserState>();
            let entries = authority.entries.lock().map_err(|_| "browser-state-unavailable")?;
            let current = entries.pending.get(&token)
                .ok_or("browser-link-pending-consent-lost")?;
            let id = current.browser_id.as_deref()
                .ok_or("browser-link-session-missing")?;
            let owner = entries.sessions.get(id)
                .and_then(|session| session.native.as_ref())
                .ok_or("browser-link-native-owner-unavailable")?;
            if !current.approving || current.approved
                || !owner.owner_alive.load(Ordering::Acquire)
            {
                return Err("browser-link-consent-state-stale".into());
            }
            (
                owner.command_tx.clone(),
                owner.turn_requester.clone(),
                current.native_target.clone()
                    .ok_or("browser-link-original-node-missing")?,
            )
        };
        let (reply, received) = oneshot::channel();
        tokio::time::timeout(Duration::from_secs(3), sender.send(
            NativeCommand::CaptureLink { target: target.clone(), reply },
        ))
        .await
        .map_err(|_| "browser-link-capture-queue-timeout")?
        .map_err(|_| "browser-link-capture-queue-closed")?;
        requester.request();
        let intent = tokio::time::timeout(Duration::from_secs(18), received)
            .await
            .map_err(|_| "browser-link-capture-timeout")?
            .map_err(|_| "browser-link-capture-owner-stopped")??;
        if intent.target != target || intent.destination_sha256
            != format!("{:x}", Sha256::digest(intent.destination.as_str().as_bytes()))
        {
            return Err("browser-link-capture-target-changed".into());
        }
        let authority = app.state::<TfBrowserState>();
        let mut entries = authority.entries.lock()
            .map_err(|_| "browser-state-unavailable")?;
        let current = entries.pending.get_mut(&token)
            .ok_or("browser-link-pending-consent-lost")?;
        if !current.approving || current.approved
            || current.request_id != pending.request_id
            || current.revision != pending.revision
            || current.native_target != pending.native_target
            || current.link_intent.is_some()
        {
            return Err("browser-link-capture-consent-scope-changed".into());
        }
        current.link_intent = Some(intent.clone());
        pending.link_intent = Some(intent);
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if pending.request.operation == TfBrowserOperation::Submit {
        let (sender, requester, target, action) = {
            let authority = app.state::<TfBrowserState>();
            let entries = authority
                .entries
                .lock()
                .map_err(|_| "browser-state-unavailable")?;
            let current = entries
                .pending
                .get(&token)
                .ok_or("browser-form-pending-consent-lost")?;
            let id = current
                .browser_id
                .as_deref()
                .ok_or("browser-form-session-missing")?;
            let owner = entries
                .sessions
                .get(id)
                .and_then(|session| session.native.as_ref())
                .ok_or("browser-form-native-owner-unavailable")?;
            if !current.approving || current.approved || !owner.owner_alive.load(Ordering::Acquire)
            {
                return Err("browser-form-consent-state-stale".into());
            }
            (
                owner.command_tx.clone(),
                owner.turn_requester.clone(),
                current
                    .native_target
                    .clone()
                    .ok_or("browser-form-original-submitter-missing")?,
                current
                    .native_action
                    .clone()
                    .ok_or("browser-form-original-form-missing")?,
            )
        };
        let (reply, received) = oneshot::channel();
        tokio::time::timeout(
            Duration::from_secs(3),
            sender.send(NativeCommand::CaptureForm {
                target: target.clone(),
                action,
                reply,
            }),
        )
        .await
        .map_err(|_| "browser-form-capture-queue-timeout")?
        .map_err(|_| "browser-form-capture-queue-closed")?;
        requester.request();
        let intent = tokio::time::timeout(Duration::from_secs(18), received)
            .await
            .map_err(|_| "browser-form-capture-timeout")?
            .map_err(|_| "browser-form-capture-owner-stopped")??;
        if intent.target != target || intent.original_form_index == intent.original_submitter_index
        {
            return Err("browser-form-capture-target-changed".into());
        }
        let authority = app.state::<TfBrowserState>();
        let mut entries = authority
            .entries
            .lock()
            .map_err(|_| "browser-state-unavailable")?;
        let current = entries
            .pending
            .get_mut(&token)
            .ok_or("browser-form-pending-consent-lost")?;
        if !current.approving
            || current.approved
            || current.request_id != pending.request_id
            || current.revision != pending.revision
            || current.native_target != pending.native_target
            || current.form_intent.is_some()
        {
            return Err("browser-form-capture-consent-scope-changed".into());
        }
        current.form_intent = Some(intent.clone());
        pending.form_intent = Some(intent);
    }
    // The original retained action must pass ALL normal snapshot checks
    // before displaying consent. The native owner returns a private witness
    // bound to this exact central token/action, capped by the ORIGINAL 90s
    // resource window and the ORIGINAL 60s pending expiry. This does not
    // refresh a snapshot or grant a page gesture. Cancellation simply removes
    // the only central copy; ordinary other references still expire at 30s.
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if pending.request.operation.native_action() {
        let (sender, requester, target, action, original_deadline) = {
            let authority = app.state::<TfBrowserState>();
            let entries = authority
                .entries
                .lock()
                .map_err(|_| "browser-state-unavailable")?;
            let current = entries
                .pending
                .get(&token)
                .ok_or("native-action-preconsent-token-missing")?;
            let id = current
                .browser_id
                .as_deref()
                .ok_or("native-action-session-missing")?;
            let session = entries
                .sessions
                .get(id)
                .ok_or("native-action-session-expired")?;
            if !current.approving
                || current.approved
                || current.expires <= Instant::now()
                || current.request_id != pending.request_id
                || current.request != pending.request
                || current.native_target != pending.native_target
                || current.revision != Some(session.revision)
                || session.busy
                || !matches_scope(session, &current.request, &current.root)
                || current.native_reservation.is_some()
            {
                return Err("native-action-preconsent-scope-or-revision-changed".into());
            }
            let owner = session
                .native
                .as_ref()
                .ok_or("native-action-original-owner-missing")?;
            if !owner.owner_alive.load(Ordering::Acquire) {
                return Err("native-action-original-owner-stopped".into());
            }
            (
                owner.command_tx.clone(),
                owner.turn_requester.clone(),
                current
                    .native_target
                    .clone()
                    .ok_or("native-action-original-node-missing")?,
                current
                    .native_action
                    .clone()
                    .ok_or("native-action-original-operation-missing")?,
                current.expires,
            )
        };
        let (reply, received) = oneshot::channel();
        tokio::time::timeout(
            Duration::from_secs(3),
            sender.send(NativeCommand::ReserveAction {
                token: token.clone(),
                target: target.clone(),
                action: action.clone(),
                deadline: original_deadline,
                reply,
            }),
        )
        .await
        .map_err(|_| "native-action-reservation-queue-timeout")?
        .map_err(|_| "native-action-reservation-queue-closed")?;
        requester.request();
        let reserved = tokio::time::timeout(Duration::from_secs(18), received)
            .await
            .map_err(|_| "native-action-reservation-timeout")?
            .map_err(|_| "native-action-reservation-owner-stopped")??;
        if !reserved.matches(&token, &target, &action) || reserved.expires_at > original_deadline {
            return Err("native-action-reservation-expired-or-extended".into());
        }
        let authority = app.state::<TfBrowserState>();
        let mut entries = authority
            .entries
            .lock()
            .map_err(|_| "browser-state-unavailable")?;
        let id = pending
            .browser_id
            .as_deref()
            .ok_or("native-action-session-missing")?;
        let session = entries
            .sessions
            .get(id)
            .ok_or("native-action-session-expired")?;
        if session.busy
            || session.revision != pending.revision.unwrap_or(u64::MAX)
            || !matches_scope(session, &pending.request, &pending.root)
        {
            return Err("native-action-reservation-session-changed".into());
        }
        let current = entries
            .pending
            .get_mut(&token)
            .ok_or("native-action-reservation-token-cancelled")?;
        if !current.approving
            || current.approved
            || current.request_id != pending.request_id
            || current.request != pending.request
            || current.native_target != Some(target)
            || current.native_action.as_ref() != Some(&action)
            || current.revision != pending.revision
            || current.expires <= Instant::now()
            || current.native_reservation.is_some()
        {
            return Err("native-action-reservation-central-identity-changed".into());
        }
        current.expires = current.expires.min(reserved.expires_at);
        current.native_reservation = Some(reserved.clone());
        pending.expires = current.expires;
        pending.native_reservation = Some(reserved);
    }
    // Explicitly do NOT display an arbitrary query string: it might contain
    // untrusted credentials, even though TF3 later rejects sensitive keys.
    let target = pending.url.as_deref().and_then(|v| Url::parse(v).ok());
    let host = target
        .as_ref()
        .and_then(|u| u.host_str())
        .unwrap_or("(unknown)");
    let native_confined = matches!(
        pending.request.operation,
        TfBrowserOperation::OpenConfined
            | TfBrowserOperation::OpenConfinedTab
            | TfBrowserOperation::OpenRequestedPopup
            | TfBrowserOperation::ObserveConfined
    ) || pending.request.operation.native_action()
        || {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            {
                pending.screenshot_scope.is_some()
                    || pending.credential_scope.is_some()
                    || pending.transfer_scope.is_some()
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            {
                false
            }
        };
    let native_purpose = match pending.request.operation {
        TfBrowserOperation::OpenConfined =>
            "Start one isolated AppContainer/WebView2 HTTPS session. No native page gesture is authorized by this approval.",
        TfBrowserOperation::OpenConfinedTab =>
            "Open one separate Clack-owned isolated browser session from the exact existing opener. Fresh AppContainer and UDF; no shared cookies, popup, external browser or page gesture. Destination GET may have remote effects.",
        TfBrowserOperation::OpenRequestedPopup =>
            "Authorize ONE page-requested popup that the original WebView2 host already vetoed. The exact original host's one-use intent, session, source page epoch, opener revision and destination are bound; launch a NEW independent Clack-owned zero-capability AppContainer and isolated storage. No window/content/permission inheritance. Destination GET can have remote effects; outcome is not assumed read-only.",
        TfBrowserOperation::ObserveConfined =>
            "Read one bounded redacted semantic DOM snapshot from this existing isolated session. No page action is authorized.",
        TfBrowserOperation::Click =>
            "Execute exactly ONE exact retained DOM Node click after the page, snapshot, element, actor, workspace, origin and UNKNOWN effect classification are rechecked. The click can trigger an external effect; dispatch alone is not proof of completion. It cannot be replayed.",
        TfBrowserOperation::TriggerPagePopup =>
            "Authorize ONE exact retained original <a target=_blank> activation under the original confined page. The native host must veto NewWindowRequested before capturing its exact one-use destination. This gesture may have external effects, and does NOT authorize opening a new tab. A separate OpenRequestedPopup central approval and destination TF3 re-policy are mandatory. Never replay.",
        TfBrowserOperation::Type =>
            "Insert EXACT approved short printable text into ONE retained non-password text control. Input handlers may have external effects; no automatic replay.",
        TfBrowserOperation::Clear =>
            "Clear ONE exact retained non-password text control. Input/change handlers may have external effects; no automatic replay.",
        TfBrowserOperation::Select =>
            "Choose ONE separately retained opaque option belonging to ONE exact retained SELECT control. The host must prove same original snapshot and original DOM parent, no selector/value fallback; no automatic replay.",
        TfBrowserOperation::Check =>
            "Set ONE exact retained checkbox/radio checked, with native same-node revalidation. Change handlers may have external effects; no automatic replay.",
        TfBrowserOperation::Uncheck =>
            "Set ONE exact retained checkbox unchecked (NEVER radio). Change handlers may have external effects; no automatic replay.",
        TfBrowserOperation::Scroll =>
            "Scroll ONE exact retained node by 120 pixels in the approved direction. Scroll handlers may have external effects; no automatic replay.",
        TfBrowserOperation::Submit =>
            "Approve exactly ONE native original-FORM/submitter POST with its private pre-captured method, destination, encoding, successful controls and body digest. The parent TF3 broker sends one write without activating page JavaScript; HTTP success alone is UNKNOWN and NEVER_REPLAY.",
        TfBrowserOperation::Screenshot =>
            "Approve ONE bounded 1024x768 native PNG viewport screenshot of this exact retained WebView2 page, saved once through TF2 in the selected authorized workspace. Screenshots can expose private on-screen content to anyone authorized to read that workspace. No pixels may enter model context, semantic snapshots or receipts; a source-matched installed native effect remains independently unaccepted.",
        TfBrowserOperation::CredentialGet =>
            "Approve ONE trusted parent TF3 HTTPS GET to exactly the displayed same-origin destination using ONE opaque reference from the EXISTING OS secret store. Authentication is sent only in the network Authorization header to that approved origin, NEVER to the browser DOM, model, screenshot, logs or receipts. The origin, credential expiration and revocation are rechecked immediately before dispatch. No redirects, cookies, implicit propagation or replay.",
        TfBrowserOperation::Download =>
            "Approve ONE bounded same-origin HTTPS TF3 binary GET, then ONE TF2 atomic no-clobber workspace file commit of exactly verified bytes and digest. The remote server cannot choose the filename or workspace. Network transport does not prove remote business effects, file readback proves only the TF2 local commit. Never replay.",
        TfBrowserOperation::Upload =>
            "Approve ONE original TF2 workspace file identity and bounded 1..64KiB SHA-256 body sent to ONE exact original-page same-origin TF3 HTTPS POST. Original file content will be independently re-read and digest-checked immediately before one use. No renderer file picker, unapproved file access, redirect or automatic retry. HTTP 2xx does not prove server-side acceptance.",
        _ => "Only TF3 pinned HTTP(S) text retrieval is supported; redirects and targets require per-hop policy.",
    };
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    let native_target_details = if pending.request.operation == TfBrowserOperation::Screenshot
        && pending.screenshot_scope.is_some()
    {
        let scope = pending.screenshot_scope.as_ref().ok_or("browser-screenshot-scope-missing")?;
        let file_key = format!("{:x}", Sha256::digest(token.as_bytes()));
        format!(
            "\nExact authenticated page: {} / generation {}\nSnapshot identity: {}\nSource HTTPS origin: {}\nSelected TF2 workspace evidence destination: tf4-browser-screenshot-{}.png\nImage evidence may contain sensitive on-screen content. Authorize only if this workspace is trusted. The model/browser is not granted read access by this approval.\n",
            scope.page_id, scope.page_generation, scope.snapshot_id,
            target_origin_for_approval(Some(&scope.url))?, &file_key[..24],
        )
    } else if pending.request.operation == TfBrowserOperation::CredentialGet
        && pending.credential_scope.is_some()
    {
        let scope = pending.credential_scope.as_ref().unwrap();
        let opaque_sha = format!("{:x}", Sha256::digest(scope.reference.as_bytes()));
        format!(
            "\nOriginal retained page: {} / generation {}\nSnapshot identity: {}\nTrust origin: {}\nExactly ONE GET destination: {}\nOpaque keyring reference SHA-256: {}\nKeyring service: {}\nNative approval expires within 60s; the separately stored credential envelope must expire within 90 days. No renderer/model secret access, cookie or redirect is authorized.\n",
            scope.page.page_id, scope.page.page_generation, scope.page.snapshot_id,
            scope.origin.origin().ascii_serialization(),
            scope.destination, opaque_sha, TF4_BROWSER_SECRET_SERVICE,
        )
    } else if matches!(
        pending.request.operation,
        TfBrowserOperation::Download | TfBrowserOperation::Upload
    ) && pending.transfer_scope.is_some()
    {
        let scope = pending.transfer_scope.as_ref().ok_or("browser-transfer-scope-missing")?;
        let output_key = format!("{:x}", Sha256::digest(token.as_bytes()));
        let file_info = if let Some(file) = scope.upload_file.as_ref() {
            format!(
                "ORIGINAL TF2 upload workspace-relative file: {}\nOriginal pre-consent bytes: {}\nOriginal pre-consent SHA-256: {}\nNetwork content type: application/octet-stream (exact body)\n",
                file.relative_path, file.bytes, file.sha256,
            )
        } else {
            format!(
                "Exact TF2 output: tf4-browser-download-{}.bin\nResponse MIME: application/octet-stream (maximum 65536 bytes)\n",
                &output_key[..24],
            )
        };
        format!(
            "\nOriginal retained native page: {} / generation {}\nOriginal snapshot identity: {}\nExact allowed public HTTPS origin: {}\nExact remote destination: {}\nNetwork operation: {}\n{}No redirected request, alternate destination, auto-replay, or public/model file authority. Workspace changes and file mutation deny the attempt.\n",
            scope.page.page_id, scope.page.page_generation,
            scope.page.snapshot_id, scope.approved_origin.origin().ascii_serialization(),
            scope.destination,
            if scope.upload_file.is_some() { "POST (upload)" } else { "GET (download)" },
            file_info,
        )
    } else if pending.request.operation.native_action() {
        let target = pending
            .native_target
            .as_ref()
            .ok_or("native-click-approved-target-missing")?;
        let effect = pending
            .native_effect
            .ok_or("native-click-approved-effect-missing")?;
        let role = pending
            .native_role
            .as_ref()
            .ok_or("native-click-approved-role-missing")?;
        let approved_origin = target_origin_for_approval(pending.url.as_deref())?;
        let parameters = match pending
            .native_action
            .as_ref()
            .ok_or("native-action-approved-parameters-missing")?
        {
            NativeRetainedAction::Click => {
                let intent = pending.link_intent.as_ref()
                    .ok_or("native-link-original-node-preconsent-capture-required")?;
                format!(
                    "Original retained LINK visit index: {}\nExact captured intended destination: {}\nExact destination SHA-256: {}\nThis pre-consent capture is NOT successor-document authority; the original Node and href must be revalidated at execution.",
                    intent.original_link_index, intent.destination, intent.destination_sha256,
                )
            }
            NativeRetainedAction::PopupClick =>
                "Exact retained <a target=_blank> only; host vets HTTPS root destination, vetoes NewWindowRequested, and NEVER launches a child without separate authorization".to_owned(),
            NativeRetainedAction::Type(text) => format!(
                "EXACT text bytes withheld for privacy ({} UTF-8 bytes, SHA-256 {:x})",
                text.len(),
                Sha256::digest(text.as_bytes())
            ),
            NativeRetainedAction::Clear => "Clear value; no text payload".to_owned(),
            NativeRetainedAction::Select(option) => {
                format!("EXACT original retained OPTION reference: {option}")
            }
            NativeRetainedAction::Check => "Set checked=true; no payload".to_owned(),
            NativeRetainedAction::Uncheck => "Set checked=false; no payload".to_owned(),
            NativeRetainedAction::Scroll(delta) => {
                format!("EXACT vertical scroll delta: {delta} native CSS pixels")
            }
            NativeRetainedAction::Submit(form_ref) => {
                let intent = pending
                    .form_intent
                    .as_ref()
                    .ok_or("native-submit-original-form-capture-required")?;
                format!(
                    "EXACT original retained FORM: {form_ref}\nMETHOD: POST\nENCODING: application/x-www-form-urlencoded\nExact destination: {}\nOriginal successful-control body: {} UTF-8 bytes, SHA-256 {}\nOriginal submitter visit index: {}, FORM visit index: {}\nNo additional page writes authorized.",
                    intent.destination, intent.body.len(), intent.body_sha256,
                    intent.original_submitter_index, intent.original_form_index,
                )
            }
        };
        format!(
            "\nExact approved browser origin: {approved_origin}\nObserved DOM role: {role:?}\nPage generation: {}\nPage identity: {}\nSnapshot identity: {}\nOriginal opaque element reference: {}\nConservative effect: {effect:?}\nAction parameters: {parameters}\nNo CSS selector, element reassociation, hidden alternative or grant persistence. Native rechecks every identity before ONE action.\n",
            target.page_generation, target.page_id, target.snapshot_id, target.element_ref
        )
    } else {
        String::new()
    };
    #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
    let native_target_details = String::new();
    let resource_details = pending.request.resource_manifest.as_deref().map_or_else(
        String::new,
        |resources| {
            let mut details = String::from(
                "\nEach exact passive GET below may cause server effects; authorize only once per destination:\n"
            );
            for resource in resources {
                details.push_str(&format!(
                    "  {:?}, at most {} bytes: {}\n",
                    resource.class, resource.max_bytes, resource.url
                ));
            }
            details
        },
    );
    let popup_details = if pending.request.operation == TfBrowserOperation::OpenRequestedPopup {
        #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
        {
            let captured = pending.popup_intent.as_ref()
                .ok_or("popup-original-intent-required-before-consent")?;
            format!("\nVetoed original native popup intent: {}\nOriginal page generation: {}\nOriginal page URL SHA-256: {}\nExact native requested destination: {}\nThis captured intent is one-use and is not itself permission.\n",
                captured.id, captured.page_generation, captured.source_sha256,
                captured.destination)
        }
        #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
        { String::new() }
    } else { String::new() };
    let tab_details = if pending.request.operation.opens_child() {
        format!(
            "\nExact opener: {} / revision {}\nNew isolated session: {}\nDestination: {}\n",
            pending
                .request
                .browser_session_id
                .as_deref()
                .unwrap_or("missing"),
            pending.revision.unwrap_or(0),
            pending.browser_id.as_deref().unwrap_or("missing"),
            pending.url.as_deref().unwrap_or("missing")
        )
    } else {
        String::new()
    };
    let summary = format!(
        "Clack {} — allow once?\n\nRequest: {}\nActor: {}\nSession: {}\nWorkspace: {}\nOperation: {:?}\nTarget host: {}\nRemaining approval lifetime: at most {} seconds (no renewal)\n{}{}{}{}\n{}",
        if native_confined { "confined native browser scoped operation" } else { "inert-document network navigation" },
        pending.request_id, pending.request.actor, pending.request.session_id,
        pending.root.display(), pending.request.operation, host,
        pending.expires.saturating_duration_since(Instant::now()).as_secs(),
        native_target_details, tab_details, popup_details, resource_details,
        native_purpose,
    );
    #[cfg(windows)]
    let presentation = ApprovalPresentation {
        entries: app.state::<TfBrowserState>().entries.clone(),
        token: token.clone(),
        deadline: pending.expires,
        workspace_root: pending.root.clone(),
    };
    let title = if native_confined {
        "Clack Tool Fabric confined browser approval"
    } else {
        "Clack Tool Fabric inert browser approval"
    }.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        #[cfg(windows)]
        { show_owned_native_approval(presentation, title, summary) }
        #[cfg(not(windows))]
        {
            let _ = (title, summary);
            Err::<(), String>("browser-native-dismissable-approval-unavailable-on-platform".into())
        }
    }).await.map_err(|_| "browser-native-dialog-unavailable".to_owned())??;
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if pending.request.operation == TfBrowserOperation::OpenRequestedPopup
        && pending.popup_intent.as_ref().is_none_or(|intent| intent.expires_at <= Instant::now())
    {
        return Err("popup-one-use-original-intent-expired-during-consent".into());
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
    if entries.approvals_shutdown || pending.expires <= Instant::now() {
        return Err("browser-native-approval-expired-or-revoked".into());
    }
    if pending.request.operation.opens_child() {
        validate_tab_opener(&entries, &pending.request, &root, pending.revision, false)?;
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    if pending.request.operation.native_action() {
        let live_authority = entries.pending.get(&token).is_some_and(|current| {
            native_pending_authority_live(&entries, &token, current, Instant::now())
        });
        if !live_authority
            || pending.native_reservation.as_ref().is_none_or(|reserved| {
                pending
                    .native_target
                    .as_ref()
                    .zip(pending.native_action.as_ref())
                    .is_none_or(|(target, action)| {
                        reserved.expires_at != pending.expires
                            || !reserved.matches(&token, target, action)
                    })
            })
        {
            return Err("browser-native-approval-original-authority-revoked".into());
        }
    }
    let live = entries
        .pending
        .get_mut(&token)
        .ok_or("unknown-or-consumed-browser-token")?;
    if root != pending.root
        || live.request_id != pending.request_id
        || live.request != pending.request
        || live.request.actor != pending.request.actor
        || live.request.session_id != pending.request.session_id
        || live.root != pending.root
        || live.url != pending.url
        || live.browser_id != pending.browser_id
        || live.revision != pending.revision
        || live.expires != pending.expires
        || {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            {
                live.popup_intent != pending.popup_intent
                    || live.form_intent != pending.form_intent
                    || live.link_intent != pending.link_intent
                    || live.screenshot_scope != pending.screenshot_scope
                    || live.credential_scope != pending.credential_scope
                    || live.transfer_scope != pending.transfer_scope
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            {
                false
            }
        }
        || live.approved
        || !live.approving
        || !(live.request.operation.approval_required() || {
            #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
            {
                live.screenshot_scope.is_some()
                    || live.credential_scope.is_some()
                    || live.transfer_scope.is_some()
            }
            #[cfg(not(all(windows, feature = "tf-browser-native-runtime")))]
            {
                false
            }
        })
    {
        return Err("browser-native-approval-scope-changed".into());
    }
    commit_live_approval(live, Instant::now())?;
    Ok(())
}

fn commit_live_approval(live: &mut Pending, now: Instant) -> Result<(), String> {
    if live.expires <= now {
        return Err("browser-native-approval-expired".into());
    }
    if !live.approving || live.approved {
        return Err("browser-native-approval-not-live".into());
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
        let confined_operation = state
            .entries
            .lock()
            .map_err(|_| "browser-state-unavailable")?
            .pending
            .get(&token)
            .map(|p| p.request.operation);
        match confined_operation {
            Some(
                TfBrowserOperation::OpenConfined
                | TfBrowserOperation::OpenConfinedTab
                | TfBrowserOperation::OpenRequestedPopup
            ) => {
                return execute_confined_native(&token, &app, &registry, &state).await;
            }
            Some(TfBrowserOperation::ObserveConfined) => {
                return execute_confined_observation(&token, &registry, &state).await;
            }
            Some(TfBrowserOperation::Screenshot) => {
                let native = state
                    .entries
                    .lock()
                    .map_err(|_| "browser-state-unavailable")?
                    .pending
                    .get(&token)
                    .is_some_and(|p| p.screenshot_scope.is_some());
                if native {
                    return execute_confined_screenshot(&token, &registry, &state).await;
                }
            }
            Some(TfBrowserOperation::CredentialGet) => {
                return execute_confined_credential_get(
                    &token, &app, &registry, &state, &web_state,
                )
                .await;
            }
            Some(TfBrowserOperation::Download | TfBrowserOperation::Upload) => {
                return execute_confined_file_transfer(&token, &registry, &state, &web_state).await;
            }
            Some(operation) if operation.native_action() => {
                return execute_confined_retained_action(&token, &registry, &state, &web_state)
                    .await;
            }
            _ => {}
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

    fn approval_fixture(state: &TfBrowserState, registry: &WorkspaceRegistry, root: &Path) -> ApprovalPresentation {
        let mut request = req(root, TfBrowserOperation::Open);
        request.url = Some("https://example.org/".into());
        let prepared = prepare(request, registry, state).unwrap();
        let mut entries = state.entries.lock().unwrap();
        let pending = entries.pending.get_mut(&prepared.token).unwrap();
        pending.approving = true;
        ApprovalPresentation { entries: state.entries.clone(), token: prepared.token, deadline: pending.expires, workspace_root: pending.root.clone() }
    }

    #[test]
    fn approval_lifecycle_expiry_and_double_decision() {
        let (dir, registry, state, _) = setup();
        let p = approval_fixture(&state, &registry, dir.path());
        let before = p.deadline - Duration::from_millis(1);
        assert!(p.decision_at(before, true).is_ok());
        assert_eq!(p.decision_at(p.deadline, true).unwrap_err(), "browser-native-approval-expired");
        let mut entries = state.entries.lock().unwrap();
        let live = entries.pending.get_mut(&p.token).unwrap();
        assert!(commit_live_approval(live, p.deadline).is_err());
        assert!(!live.approved);
        assert!(commit_live_approval(live, before).is_ok());
        assert!(commit_live_approval(live, before).is_err());
        drop(entries);
        assert_eq!(p.state_at(before), ApprovalPresentationState::Revoked);
        drop(ApprovalAbandonGuard {
            entries: state.entries.clone(),
            token: p.token.clone(),
        });
        assert!(state.entries.lock().unwrap().pending[&p.token].approved);
    }

    #[test]
    fn approval_presentation_honors_shortened_effective_deadline_and_late_rejection() {
        let (dir, registry, state, web) = setup();
        let mut presentation = approval_fixture(&state, &registry, dir.path());
        let reduced = Instant::now() + Duration::from_millis(80);
        {
            let mut entries = state.entries.lock().unwrap();
            let live = entries.pending.get_mut(&presentation.token).unwrap();
            live.expires = live.expires.min(reduced);
            presentation.deadline = live.expires;
        }
        assert_eq!(
            presentation.state_at(presentation.deadline - Duration::from_millis(1)),
            ApprovalPresentationState::Live
        );
        assert_eq!(
            presentation
                .decision_at(presentation.deadline, true)
                .unwrap_err(),
            "browser-native-approval-expired"
        );
        let mut entries = state.entries.lock().unwrap();
        let live = entries.pending.get_mut(&presentation.token).unwrap();
        assert_eq!(
            commit_live_approval(live, presentation.deadline).unwrap_err(),
            "browser-native-approval-expired"
        );
        assert!(!live.approved);
        drop(entries);
        assert!(cancel(&presentation.token, &state, &web).unwrap());
        assert_eq!(
            presentation.state_at(presentation.deadline - Duration::from_millis(1)),
            ApprovalPresentationState::Revoked
        );
        assert!(!cancel(&presentation.token, &state, &web).unwrap());
    }

    #[test]
    fn approval_lifecycle_denial_cancel_abandon_and_shutdown() {
        let (dir, registry, state, web) = setup();
        let p = approval_fixture(&state, &registry, dir.path());
        assert_eq!(p.decision_at(Instant::now(), false).unwrap_err(), "browser-native-approval-denied");
        drop(ApprovalAbandonGuard { entries: state.entries.clone(), token: p.token.clone() });
        assert!(p.decision_at(Instant::now(), true).is_err());
        let p = approval_fixture(&state, &registry, dir.path());
        assert!(cancel(&p.token, &state, &web).unwrap());
        assert!(!cancel(&p.token, &state, &web).unwrap());
        assert!(p.decision_at(Instant::now(), true).is_err());
        let p = approval_fixture(&state, &registry, dir.path());
        state.shutdown_approvals();
        assert!(p.decision_at(Instant::now(), true).is_err());
        assert!(state.entries.lock().unwrap().pending.is_empty());
        let mut request = req(dir.path(), TfBrowserOperation::Open);
        request.url = Some("https://example.org/".into());
        assert!(prepare(request, &registry, &state).is_err());
    }

    #[test]
    fn approval_lifecycle_cancel_racing_commit_never_resurrects() {
        for _ in 0..32 {
            let (dir, registry, state, web) = setup();
            let p = approval_fixture(&state, &registry, dir.path());
            let barrier = std::sync::Barrier::new(2);
            std::thread::scope(|scope| {
                let attempt = scope.spawn(|| {
                    barrier.wait();
                    let mut entries = state.entries.lock().unwrap();
                    entries.pending.get_mut(&p.token).is_some_and(|live| commit_live_approval(live, Instant::now()).is_ok())
                });
                barrier.wait();
                assert!(cancel(&p.token, &state, &web).unwrap());
                let _ = attempt.join().unwrap();
            });
            assert!(p.decision_at(Instant::now(), true).is_err());
            assert!(state.entries.lock().unwrap().pending.is_empty());
        }
    }

    #[test]
    fn approval_lifecycle_native_dialog_capacity_is_one_and_reusable() {
        let first = APPROVAL_SLOTS.clone().try_acquire_owned()
            .expect("one native approval presentation");
        assert!(APPROVAL_SLOTS.clone().try_acquire_owned().is_err(),
            "second native approval cannot overlap the first HWND");
        drop(first);
        let next = APPROVAL_SLOTS.clone().try_acquire_owned()
            .expect("native reservation released on dialog completion");
        drop(next);
    }

    #[test]
    fn approval_lifecycle_closed_workspace_revokes_pending_without_positive_decision() {
        let (dir, registry, state, _) = setup();
        let presentation = approval_fixture(&state, &registry, dir.path());
        std::fs::remove_dir(dir.path()).unwrap();
        assert_eq!(presentation.state_at(Instant::now()), ApprovalPresentationState::Revoked);
        assert_eq!(presentation.decision_at(Instant::now(), true).unwrap_err(),
            "browser-native-approval-revoked");
        drop(ApprovalAbandonGuard {
            entries: state.entries.clone(), token: presentation.token.clone(),
        });
        assert!(!state.entries.lock().unwrap().pending.contains_key(&presentation.token));
    }

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

    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn screenshot_uses_original_consumed_consent_and_actual_tf2_atomic_workspace_commit() {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
        const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
        let (dir, registry, _, _) = setup();
        let raw = BASE64.decode(PNG).unwrap();
        let source = NativeScreenshotScope {
            browser_session_id: "a".repeat(48),
            page_id: "b".repeat(48),
            page_generation: 3,
            snapshot_id: "c".repeat(48),
            url: "https://example.org/".into(),
        };
        let grant = || NativeScreenshotConsent {
            token: "d".repeat(48),
            actor: "fixture-actor".into(),
            session_id: "session-1".into(),
            workspace_root: std::fs::canonicalize(dir.path()).unwrap(),
            page: source.clone(),
            expires: Instant::now() + Duration::from_secs(30),
        };
        let capture = || NativeScreenshotCapture {
            browser_session_id: source.browser_session_id.clone(),
            page_id: source.page_id.clone(),
            page_generation: source.page_generation,
            snapshot_id: source.snapshot_id.clone(),
            url: source.url.clone(),
            width: 1,
            height: 1,
            captured_at_ms: 123456789,
            sha256: format!("{:x}", Sha256::digest(&raw)),
            png: raw.clone(),
        };
        let mut wrong_page = capture();
        wrong_page.page_id = "e".repeat(48);
        assert!(!grant().matches_capture(&wrong_page));
        assert!(
            tf_operations::commit_native_screenshot_evidence(grant(), wrong_page, &registry,)
                .is_err(),
            "a changed page cannot commit any screenshot evidence"
        );
        let mut wrong_digest = capture();
        wrong_digest.sha256 = "0".repeat(64);
        assert!(
            tf_operations::commit_native_screenshot_evidence(grant(), wrong_digest, &registry,)
                .is_err(),
            "a replaced image with a new hash cannot be consent"
        );
        let result =
            tf_operations::commit_native_screenshot_evidence(grant(), capture(), &registry)
                .unwrap();
        let committed = dir.path().join(&result.workspace_relative_file);
        assert_eq!(std::fs::read(&committed).unwrap(), raw);
        assert_eq!(result.effect_state, "Observed");
        assert_eq!(result.retry, "NEVER_REPLAY");
        assert_eq!(result.content_sha256, format!("{:x}", Sha256::digest(&raw)));
        assert_eq!(result.bytes_verified, raw.len());
        assert!(result
            .workspace_relative_file
            .starts_with("tf4-browser-screenshot-"));
        assert!(result.workspace_relative_file.ends_with(".png"));
        let output = serde_json::to_string(&result).unwrap();
        assert!(!output.contains(PNG) && !output.contains("example.org"));
        assert!(
            tf_operations::commit_native_screenshot_evidence(grant(), capture(), &registry,)
                .is_err(),
            "same exact approved file must never be overwritten/replayed"
        );
        assert_eq!(std::fs::read(&committed).unwrap(), raw);
    }

    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn tf2_native_browser_transfer_original_file_mutation_and_download_commit_are_scoped() {
        let (dir, registry, _, _) = setup();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let original = dir.path().join("original.bin");
        let payload = b"TF4\x00bounded-file\x01".to_vec();
        std::fs::write(&original, &payload).unwrap();
        let captured =
            tf_operations::read_native_browser_upload_file(&registry, &root, "original.bin")
                .unwrap();
        let sha = format!("{:x}", Sha256::digest(&payload));
        assert_eq!(captured.bytes, payload);
        assert_eq!(captured.sha256, sha);
        assert_eq!(captured.relative_path, "original.bin");
        for forbidden in [
            "../outside.bin",
            "C:\\other.bin",
            "sub/../../outside",
            "\\\\?\\C:\\bad.bin",
            "other::stream",
        ] {
            assert!(
                tf_operations::read_native_browser_upload_file(&registry, &root, forbidden,)
                    .is_err(),
                "TF2 rejects traversal/absolute/stream path {forbidden}"
            );
        }
        let page = NativeScreenshotScope {
            browser_session_id: "a".repeat(48),
            page_id: "b".repeat(48),
            page_generation: 7,
            snapshot_id: "c".repeat(48),
            url: "https://fixture.example/".into(),
        };
        let scope_upload = NativeTransferScope {
            page: page.clone(),
            approved_origin: Url::parse("https://fixture.example/").unwrap(),
            destination: Url::parse("https://fixture.example/upload").unwrap(),
            upload_file: Some(NativeUploadFileScope {
                relative_path: "original.bin".into(),
                bytes: payload.len(),
                sha256: sha.clone(),
            }),
        };
        let upload_grant = NativeTransferConsent {
            actor: "native-owner".into(),
            session_id: "chat-1".into(),
            workspace_root: root.clone(),
            scope: scope_upload,
            approval_id: "d".repeat(48),
            expires: Instant::now() + Duration::from_secs(30),
        };
        assert!(upload_grant.matches_network(
            upload_grant.approved_url(),
            upload_grant.approved_origin(),
            &"d".repeat(48),
            7,
            true,
        ));
        assert!(!upload_grant.matches_network(
            &Url::parse("https://fixture.example/other").unwrap(),
            upload_grant.approved_origin(),
            &"d".repeat(48),
            7,
            true,
        ));
        assert!(!upload_grant.matches_network(
            upload_grant.approved_url(),
            upload_grant.approved_origin(),
            &"e".repeat(48),
            7,
            true,
        ));
        assert!(!upload_grant.matches_network(
            upload_grant.approved_url(),
            upload_grant.approved_origin(),
            &"d".repeat(48),
            8,
            true,
        ));
        // A file that changes after initial human approval must not send its
        // newly computed self-consistent digest in place of approved bytes.
        std::fs::write(&original, b"changed-after-consent").unwrap();
        let after =
            tf_operations::read_native_browser_upload_file(&registry, &root, "original.bin")
                .unwrap();
        assert_ne!(after.sha256, sha);
        assert_ne!(after.bytes.len(), payload.len());

        let download_bytes = b"TF4\xffexact-download\x00".to_vec();
        let dest = "https://fixture.example/owned.bin";
        let download_scope = NativeTransferScope {
            page: page.clone(),
            approved_origin: Url::parse("https://fixture.example/").unwrap(),
            destination: Url::parse(dest).unwrap(),
            upload_file: None,
        };
        let make_grant = || NativeTransferConsent {
            actor: "native-owner".into(),
            session_id: "chat-1".into(),
            workspace_root: root.clone(),
            scope: download_scope.clone(),
            approval_id: "f".repeat(48),
            expires: Instant::now() + Duration::from_secs(30),
        };
        let make_resource = || tf_web::TfBrowserResource {
            receipt: tf_web::TfWebReceipt {
                tool_id: "tf.web.v1",
                request_id: "one-source-verified-network".into(),
                actor: "native-owner".into(),
                operation: TfWebOperation::BrowserBoundDownload,
                actual_method: "GET",
                terminal: "completed",
                effect_state: "Unknown",
                requested_url: Some(dest.into()),
                final_url: Some(dest.into()),
                redirect_chain: Vec::new(),
                normalized_target: Some(dest.into()),
                status_code: Some(200),
                content_type: Some("application/octet-stream".into()),
                tls_state: "https_transport_observed",
                bytes_received: Some(download_bytes.len() as u64),
                bytes_retained: download_bytes.len(),
                truncated: false,
                content_sha256: Some(format!("{:x}", Sha256::digest(&download_bytes))),
                body: None,
                started_at: 100,
                ended_at: 200,
                credential_reference: None,
                credential_used: false,
                retry: "NEVER_REPLAY",
                auto_retry: false,
                policy_decision: "allowed",
                reason_code: "ok",
                search_results: None,
                search_source: None,
                uncertainty: "http-response-observed-peer-ip-not-attested",
                isolation: "tf3",
                dns_evidence: Vec::new(),
            },
            bytes: download_bytes.clone(),
        };
        let mut foreign = make_resource();
        foreign.receipt.final_url = Some("https://other.example/file.bin".into());
        assert!(
            tf_operations::commit_native_browser_download(make_grant(), foreign, &registry,)
                .is_err(),
            "TF2 cannot commit a followed foreign URL's bytes"
        );
        let mut corrupt = make_resource();
        corrupt.bytes[0] ^= 1;
        assert!(
            tf_operations::commit_native_browser_download(make_grant(), corrupt, &registry,)
                .is_err(),
            "TF2 validates original response SHA before file effect"
        );
        let committed =
            tf_operations::commit_native_browser_download(make_grant(), make_resource(), &registry)
                .unwrap();
        assert_eq!(committed.method, "GET");
        assert_eq!(committed.file_effect_state, "Observed");
        assert_eq!(committed.retry, "NEVER_REPLAY");
        assert_eq!(committed.page_id, page.page_id);
        assert_eq!(committed.page_generation, page.page_generation);
        assert_eq!(
            committed.response_sha256,
            format!("{:x}", Sha256::digest(&download_bytes))
        );
        assert_eq!(
            std::fs::read(dir.path().join(&committed.workspace_relative_file)).unwrap(),
            download_bytes
        );
        assert!(tf_operations::commit_native_browser_download(
            make_grant(), make_resource(), &registry,
        ).is_err(), "same original TF4 grant never overwrites an existing download file");
        let serialized = serde_json::to_string(&committed).unwrap();
        assert!(!serialized.contains("TF4") && !serialized.contains(dest));
    }

    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn native_origin_credential_reference_binds_exact_grant_revocation_and_expiration() {
        const SYNTHETIC: &str = "synthetic-fixture-credential-not-real";
        let origin = Url::parse("https://fixture.example/").unwrap();
        let ref_id = "a".repeat(48);
        let page = NativeScreenshotScope {
            browser_session_id: "b".repeat(48),
            page_id: "c".repeat(48),
            page_generation: 7,
            snapshot_id: "d".repeat(48),
            url: origin.to_string(),
        };
        let scope = NativeCredentialScope {
            page: page.clone(),
            origin: origin.clone(),
            destination: Url::parse("https://fixture.example/case/nonce/credential").unwrap(),
            reference: ref_id.clone(),
        };
        let grant = NativeCredentialConsent {
            actor: "test-actor".into(),
            session_id: "test-session".into(),
            workspace_root: PathBuf::from("C:/test-scope"),
            scope: scope.clone(),
            approval_id: "f".repeat(48),
            expires: Instant::now() + Duration::from_secs(30),
        };
        let make_query = || tf_web::TfBrowserOriginCredentialGet {
            destination: scope.destination.clone(),
            approved_origin: scope.origin.clone(),
            reference: scope.reference.clone(),
            source_page_generation: scope.page.page_generation,
            consumed_approval_id: "f".repeat(48),
        };
        assert!(grant.matches_credential(&make_query()));
        assert_eq!(grant.tf3_identity().0, "test-actor");
        let other_origin = NativeCredentialConsent {
            scope: NativeCredentialScope {
                origin: Url::parse("https://other.example/").unwrap(),
                ..scope.clone()
            },
            ..NativeCredentialConsent {
                actor: grant.actor.clone(),
                session_id: grant.session_id.clone(),
                workspace_root: grant.workspace_root.clone(),
                scope: scope.clone(),
                approval_id: grant.approval_id.clone(),
                expires: grant.expires,
            }
        };
        assert_ne!(
            grant.credential_account(),
            other_origin.credential_account()
        );
        let mut forged = make_query();
        forged.destination = Url::parse("https://fixture.example/other").unwrap();
        assert!(!grant.matches_credential(&forged));
        forged = make_query();
        forged.approved_origin = Url::parse("https://other.example/").unwrap();
        assert!(!grant.matches_credential(&forged));
        forged = make_query();
        forged.reference = "0".repeat(48);
        assert!(!grant.matches_credential(&forged));
        forged = make_query();
        forged.source_page_generation += 1;
        assert!(!grant.matches_credential(&forged));
        forged = make_query();
        forged.consumed_approval_id = "0".repeat(48);
        assert!(!grant.matches_credential(&forged));
        let now = millis();
        let envelope = serde_json::json!({
            "token":SYNTHETIC,
            "expiresAtMs":now+20_000
        })
        .to_string();
        assert_eq!(
            parse_native_keyring_credential(&envelope, now).unwrap(),
            SYNTHETIC
        );
        assert!(
            parse_native_keyring_credential(&envelope, now + 25_000).is_err(),
            "keyring entry expiry must be checked immediately before dispatch"
        );
        let injected = serde_json::json!({"token":SYNTHETIC,
            "expiresAtMs":now+20_000,"redirectOrigin":"other"})
        .to_string();
        assert!(parse_native_keyring_credential(&injected, now).is_err());
        let stale = serde_json::json!({"token":SYNTHETIC,
            "expiresAtMs":now+100*24*3600*1000})
        .to_string();
        assert!(parse_native_keyring_credential(&stale, now).is_err());
        assert!(parse_native_keyring_credential("", now).is_err());
        let output = format!("{grant:?}");
        // Scope never contains raw credential bytes; keyring values are
        // fetched only by the existing SecretsState at execution.
        assert!(!output.contains(SYNTHETIC));
    }
    fn req(root: &Path, operation: TfBrowserOperation) -> TfBrowserRequest {
        TfBrowserRequest {
            operation,
            actor: "fixture-actor".into(),
            session_id: "session-1".into(),
            workspace_root: root.to_string_lossy().into_owned(),
            browser_session_id: None,
            url: None,
            resource_manifest: None,
            page_id: None,
            page_generation: None,
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
                opener_id: None,
                actor: "fixture-actor".into(),
                session_id: "session-1".into(),
                root: std::fs::canonicalize(root).unwrap(),
                snapshot,
                history: vec!["http://127.0.0.1/previous".into()],
                revision: 1,
                busy: false,
                #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
                native_reserved_action: None,
                expires: Instant::now() + SESSION_TTL,
                #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
                native: None,
            },
        );
        (id, sid, link)
    }
    #[test]
    fn requested_popup_and_trigger_are_separate_exact_scoped_native_consents() {
        let (dir, _, state, _) = setup();
        let (opener, _, _) = fake_session(dir.path(), &state);
        let mut popup = req(dir.path(), TfBrowserOperation::OpenRequestedPopup);
        popup.browser_session_id = Some(opener.clone());
        popup.url = Some("https://popup.example.org/".into());
        assert!(ensure_request_shape(&popup).is_ok());
        assert!(popup.operation.opens_child());
        assert!(popup.operation.approval_required());
        assert!(!popup.operation.native_action());
        assert!(popup.operation.network());
        popup.url = Some("https://popup.example.org/unauthorized".into());
        assert!(ensure_request_shape(&popup).is_err());
        popup.url = Some("https://popup.example.org/".into());
        popup.browser_session_id = None;
        assert!(ensure_request_shape(&popup).is_err());

        let mut gesture = req(dir.path(), TfBrowserOperation::TriggerPagePopup);
        gesture.browser_session_id = Some(opener);
        gesture.page_id = Some(nonce().unwrap());
        gesture.page_generation = Some(1);
        gesture.snapshot_id = Some(nonce().unwrap());
        gesture.element_id = Some(nonce().unwrap());
        assert!(ensure_request_shape(&gesture).is_ok());
        assert!(gesture.operation.native_action());
        assert!(gesture.operation.approval_required());
        assert!(!gesture.operation.network());
        assert_eq!(native_retained_action_from_request(&gesture).unwrap(),
            NativeRetainedAction::PopupClick);
        gesture.url = Some("https://popup.example.org/".into());
        assert!(ensure_request_shape(&gesture).is_err());
        gesture.url = None;
        gesture.text = Some("window.open".into());
        assert!(ensure_request_shape(&gesture).is_err());
        gesture.text = None;
        gesture.selector = Some("a[target=_blank]".into());
        assert!(ensure_request_shape(&gesture).is_err());
    }

    #[test]
    fn confined_native_obvious_private_literals_are_rejected_before_os_consent() {
        let (dir, registry, state, _) = setup();
        for operation in [
            TfBrowserOperation::OpenConfined,
            TfBrowserOperation::OpenConfinedTab,
            TfBrowserOperation::OpenRequestedPopup,
        ] {
            for target in [
                "https://10.255.255.1/",
                "https://127.0.0.1/",
                "https://169.254.169.254/",
                "https://192.168.1.1/",
                "https://100.64.0.1/",
                "https://198.18.0.1/",
                "https://[::1]/",
                "https://[::ffff:127.0.0.1]/",
                "https://[fe80::1]/",
                "https://[fd00:ec2::254]/",
                "https://metadata.google.internal/",
                "https://metadata.azure.com/",
            ] {
                let mut request = req(dir.path(), operation);
                if operation.opens_child() {
                    request.browser_session_id = Some("e".repeat(48));
                }
                request.url = Some(target.into());
                assert_eq!(
                    ensure_request_shape(&request).unwrap_err(),
                    "confined-destination-forbidden-before-consent",
                    "{operation:?}: {target}"
                );
                // No approval token, owner, DNS or host is allocated.
                assert_eq!(
                    prepare(request, &registry, &state).unwrap_err(),
                    "confined-destination-forbidden-before-consent",
                    "{operation:?}: {target}"
                );
            }
        }
        for public in [
            "https://example.org/",
            "https://www.iana.org/",
            "https://1.1.1.1/",
            "https://[2606:4700:4700::1111]/",
        ] {
            let mut request = req(dir.path(), TfBrowserOperation::OpenConfined);
            request.url = Some(public.into());
            assert!(ensure_request_shape(&request).is_ok(), "{public}");
        }
        // Shape admission never replaces TF3's authoritative DNS/IP/TLS
        // execution policy, including DNS rebinding and redirect checks.
        let entries = state.entries.lock().unwrap();
        assert!(entries.pending.is_empty());
        assert!(entries.sessions.is_empty());
    }

    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn failed_native_observation_exposes_only_closed_cause_and_stays_unknown() {
        assert_eq!(
            closed_native_observation_failure_reason("observation-page-stale"),
            "native-semantic-observation-page-stale"
        );
        assert_eq!(
            closed_native_observation_failure_reason("observation-timeout"),
            "native-semantic-observation-com-timeout"
        );
        assert_eq!(
            closed_native_observation_failure_reason("browser-structure-session-not-ready"),
            "native-semantic-observation-owner-not-ready"
        );
        assert_eq!(
            closed_native_observation_failure_reason("observation-identity-unavailable"),
            "native-semantic-observation-identity-unverified"
        );
        let secret = "C:\\Users\\private\\session-token=SUPER-SECRET";
        let result = closed_native_observation_failure_reason(secret);
        assert_eq!(result, "native-semantic-observation-outcome-uncertain");
        assert!(!result.contains(secret));
    }

    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn popup_child_commit_scope_denies_expired_intent_and_stale_reservation() {
        let (dir, registry, state, _) = setup();
        let (opener, _, _) = fake_session(dir.path(), &state);
        // Build a pending transaction through the ordinary inert prepare path,
        // then exercise the private revalidation helper. This test never
        // grants consent to or fabricates a live native process owner.
        let mut request = req(dir.path(), TfBrowserOperation::Open);
        request.url = Some("https://popup.example.org/".into());
        let prepared = prepare(request, &registry, &state).unwrap();
        let mut entries = state.entries.lock().unwrap();
        let mut p = entries.pending.remove(&prepared.token).unwrap();
        p.approved = true;
        p.request.operation = TfBrowserOperation::OpenRequestedPopup;
        p.request.browser_session_id = Some(opener.clone());
        p.revision = Some(1);
        entries.sessions.get_mut(&opener).unwrap().busy = true;
        p.popup_intent = Some(NativePopupIntent {
            id: "a".repeat(64),
            destination: p.url.clone().unwrap(),
            page_generation: 1,
            source_sha256: format!("{:x}", Sha256::digest(entries.sessions[&opener].snapshot.url.as_bytes())),
            expires_at: Instant::now(),
        });
        let active = Arc::new(Active {
            opens_session: true,
            popup_commit_phase: Some(AtomicU8::new(NATIVE_CLICK_QUEUED)),
            ..Active::default()
        });
        entries.active.insert(prepared.token.clone(), active.clone());
        let check = |entries: &Entries, pending: &Pending| {
            validate_popup_child_scope(entries, pending, &active, &prepared.token, &registry)
        };
        assert_eq!(check(&entries, &p).unwrap_err(), "popup-original-intent-expired-or-scope-changed");
        p.popup_intent.as_mut().unwrap().expires_at = Instant::now() + Duration::from_secs(25);
        p.expires = Instant::now();
        assert_eq!(check(&entries, &p).unwrap_err(), "popup-original-intent-expired-or-scope-changed");
        p.expires = Instant::now() + Duration::from_secs(25);
        p.revision = Some(2);
        assert_eq!(check(&entries, &p).unwrap_err(), "tab-opener-stale-or-scope-denied");
        p.revision = Some(1);
        assert_eq!(check(&entries, &p).unwrap_err(), "tab-opener-confined-owner-required");
        entries.sessions.get_mut(&opener).unwrap().busy = false;
        assert_eq!(check(&entries, &p).unwrap_err(), "tab-opener-busy-or-reservation-lost");
        entries.sessions.get_mut(&opener).unwrap().busy = true;
        entries.active.remove(&prepared.token);
        assert_eq!(check(&entries, &p).unwrap_err(), "popup-child-central-reservation-revoked");
    }

    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[tokio::test]
    async fn popup_child_commit_gate_never_serves_before_signal_or_after_revocation() {
        let (stop, mut stopped) = watch::channel(false);
        let (tx, rx) = oneshot::channel();
        let mut waiter = tokio::spawn(async move {
            await_popup_child_commit(Some(rx), &mut stopped).await
        });
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut waiter).await.is_err());
        tx.send(()).unwrap();
        assert!(waiter.await.unwrap());
        let (tx, rx) = oneshot::channel();
        drop(tx);
        assert!(!await_popup_child_commit(Some(rx), &mut stop.subscribe()).await);
        let (tx, rx) = oneshot::channel();
        stop.send_replace(true);
        tx.send(()).unwrap();
        assert!(!await_popup_child_commit(Some(rx), &mut stop.subscribe()).await);
        // The ordinary OpenConfined / OpenConfinedTab owner has no gate.
        assert!(await_popup_child_commit(None, &mut stop.subscribe()).await);
    }

    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn popup_child_commit_and_cancel_are_mutually_exclusive() {
        let (_, _, state, web) = setup();
        for commit_first in [false, true] {
            let active = Arc::new(Active {
                opens_session: true,
                popup_commit_phase: Some(AtomicU8::new(NATIVE_CLICK_QUEUED)),
                ..Active::default()
            });
            state.entries.lock().unwrap().active.insert("popup".into(), active.clone());
            if commit_first {
                assert!(commit_popup_child(&active));
                assert!(!cancel("popup", &state, &web).unwrap());
                assert!(!active.cancelled.load(Ordering::Acquire));
            } else {
                assert!(cancel("popup", &state, &web).unwrap());
                assert!(!commit_popup_child(&active));
                assert!(active.cancelled.load(Ordering::Acquire));
            }
        }
    }

    #[test]
    fn confined_tab_requires_exact_opener_and_root_https_destination() {
        let (dir, _, state, _) = setup();
        let (id, _, _) = fake_session(dir.path(), &state);
        let mut request = req(dir.path(), TfBrowserOperation::OpenConfinedTab);
        request.url = Some("https://example.org/".into());
        assert!(ensure_request_shape(&request).is_err());
        request.browser_session_id = Some(id.clone());
        assert!(ensure_request_shape(&request).is_ok());
        assert!(request.operation.approval_required());
        assert!(request.operation.opens_session());
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let entries = state.entries.lock().unwrap();
        assert_eq!(
            validate_tab_opener(&entries, &request, &root, Some(1), false).unwrap_err(),
            "tab-opener-confined-owner-required"
        );
        assert_eq!(
            validate_tab_opener(&entries, &request, &root, Some(2), false).unwrap_err(),
            "tab-opener-stale-or-scope-denied"
        );
        request.actor = "foreign-actor".into();
        assert_eq!(
            validate_tab_opener(&entries, &request, &root, Some(1), false).unwrap_err(),
            "tab-opener-stale-or-scope-denied"
        );
        request.actor = "fixture-actor".into();
        request.session_id = "foreign-session".into();
        assert!(validate_tab_opener(&entries, &request, &root, Some(1), false).is_err());
        request.session_id = "session-1".into();
        request.browser_session_id = Some("f".repeat(48));
        assert_eq!(
            validate_tab_opener(&entries, &request, &root, Some(1), false).unwrap_err(),
            "tab-opener-expired"
        );
        request.browser_session_id = Some(id);
        for denied in [
            "http://example.org/",
            "https://example.org/path",
            "https://example.org/?q=x",
            "https://example.org/#x",
            "https://user@example.org/",
            "https://example.org:444/",
        ] {
            request.url = Some(denied.into());
            assert!(
                ensure_request_shape(&request).is_err(),
                "unexpected destination: {denied}"
            );
        }
    }

    #[test]
    fn confined_tab_capacity_counts_inflight_open_reservations() {
        let (dir, _, state, _) = setup();
        for _ in 0..MAX_SESSIONS - 1 {
            fake_session(dir.path(), &state);
        }
        let mut entries = state.entries.lock().unwrap();
        assert!(session_capacity_available(&entries));
        entries.active.insert(
            "reserved".into(),
            Arc::new(Active {
                opens_session: true,
                ..Active::default()
            }),
        );
        assert!(!session_capacity_available(&entries));
        entries.active.remove("reserved");
        assert!(session_capacity_available(&entries));
    }

    #[test]
    fn exact_passive_manifest_requires_native_visible_open_consent_scope() {
        use super::super::tf_browser_runtime::{
            BrowserPassiveClass, BrowserResourceCapability,
        };
        let (dir, _, _, _) = setup();
        let mut req = req(dir.path(), TfBrowserOperation::OpenConfined);
        req.url = Some("https://example.org/".into());
        req.resource_manifest = Some(vec![
            BrowserResourceCapability {
                url: "https://example.org/site.css".into(),
                class: BrowserPassiveClass::Stylesheet,
                max_bytes: 1024,
            },
        ]);
        assert!(ensure_request_shape(&req).is_ok());
        req.resource_manifest.as_mut().unwrap()[0].url =
            "https://example.org/account/transfer.css".into();
        // The exact URL *can* be approved if visibly disclosed; its .css
        // suffix and GET method alone never confer authority.
        assert!(ensure_request_shape(&req).is_ok());
        req.resource_manifest.as_mut().unwrap()[0].url =
            "https://another.example/site.css".into();
        assert_eq!(
            ensure_request_shape(&req).unwrap_err(),
            "browser-resource-manifest-scope-denied"
        );
        req.resource_manifest.as_mut().unwrap()[0].url =
            "https://example.org/site.css".into();
        req.resource_manifest.as_mut().unwrap()[0].max_bytes = 0;
        assert_eq!(
            ensure_request_shape(&req).unwrap_err(),
            "browser-resource-manifest-scope-denied"
        );
        req.resource_manifest.as_mut().unwrap()[0].max_bytes = 1024;
        req.operation = TfBrowserOperation::Open;
        assert_eq!(
            ensure_request_shape(&req).unwrap_err(),
            "browser-resource-manifest-native-open-only"
        );
        req.operation = TfBrowserOperation::Navigate;
        assert_eq!(
            ensure_request_shape(&req).unwrap_err(),
            "browser-resource-manifest-native-open-only"
        );
        req.operation = TfBrowserOperation::OpenConfined;
        assert!(ensure_request_shape(&req).is_ok());
        let mut wire = serde_json::to_value(&req).unwrap();
        wire["resourceManifest"][0]["class"] = serde_json::json!("fetch");
        assert!(serde_json::from_value::<TfBrowserRequest>(wire).is_err());
    }

    #[test]
    fn confined_tab_owner_linkage_cascades_only_exact_scoped_children() {
        let (dir, _, state, _) = setup();
        let (root_id, _, _) = fake_session(dir.path(), &state);
        let (child_id, _, _) = fake_session(dir.path(), &state);
        let (other_id, _, _) = fake_session(dir.path(), &state);
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let mut entries = state.entries.lock().unwrap();
        entries.sessions.get_mut(&child_id).unwrap().opener_id = Some(root_id.clone());
        let mut request = req(dir.path(), TfBrowserOperation::OpenConfinedTab);
        request.browser_session_id = Some(child_id.clone());
        assert_eq!(
            validate_tab_opener(&entries, &request, &root, Some(1), false).unwrap_err(),
            "nested-confined-tab-denied"
        );
        assert!(remove_owned_session_tree(&mut entries, &root_id, false).is_err());
        entries.sessions.get_mut(&child_id).unwrap().actor = "foreign-actor".into();
        assert!(remove_owned_session_tree(&mut entries, &root_id, true).is_err());
        assert_eq!(entries.sessions.len(), 3);
        entries.sessions.get_mut(&child_id).unwrap().actor = "fixture-actor".into();
        let removed = remove_owned_session_tree(&mut entries, &root_id, true).unwrap();
        assert_eq!(removed.len(), 2);
        assert_eq!(removed[0].opener_id.as_deref(), Some(root_id.as_str()));
        assert!(removed[1].opener_id.is_none());
        assert!(entries.sessions.contains_key(&other_id));
        assert!(!entries.sessions.contains_key(&child_id));
    }

    #[test]
    fn confined_tab_expiry_removes_orphaned_children() {
        let (dir, _, state, _) = setup();
        let (root_id, _, _) = fake_session(dir.path(), &state);
        let (child_id, _, _) = fake_session(dir.path(), &state);
        let mut entries = state.entries.lock().unwrap();
        entries.sessions.get_mut(&child_id).unwrap().opener_id = Some(root_id.clone());
        entries.sessions.get_mut(&root_id).unwrap().expires = Instant::now();
        reap(&mut entries);
        assert!(entries.sessions.is_empty());
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
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn popup_abandoned_approval_burns_pending_without_releasing_actor_capture() {
        let (dir, registry, state, _) = setup();
        let (opener_id, _, _) = fake_session(dir.path(), &state);
        let mut request = req(dir.path(), TfBrowserOperation::Open);
        request.url = Some("https://example.org/popup".into());
        let prepared = prepare(request, &registry, &state).unwrap();
        {
            let mut entries = state.entries.lock().unwrap();
            let pending = entries.pending.get_mut(&prepared.token).unwrap();
            pending.request.operation = TfBrowserOperation::OpenRequestedPopup;
            pending.approving = true;
            let opener = entries.sessions.get_mut(&opener_id).unwrap();
            opener.busy = true;
            opener.native_reserved_action = Some(prepared.token.clone());
        }
        let native_actor = PopupCaptureReservation {
            entries: state.entries.clone(),
            opener_id: opener_id.clone(),
            token: prepared.token.clone(),
        };
        drop(ApprovalAbandonGuard {
            entries: state.entries.clone(),
            token: prepared.token.clone(),
        });
        {
            let entries = state.entries.lock().unwrap();
            assert!(!entries.pending.contains_key(&prepared.token));
            assert!(entries.sessions.get(&opener_id).unwrap().busy);
            assert_eq!(entries.sessions.get(&opener_id).unwrap().native_reserved_action.as_deref(),
                Some(prepared.token.as_str()));
        }
        assert_eq!(native_actor.admit("https://example.org/popup").unwrap_err(),
            "popup-capture-pending-revoked");
        drop(native_actor);
        let entries = state.entries.lock().unwrap();
        assert!(!entries.sessions.get(&opener_id).unwrap().busy);
        assert!(entries.sessions.get(&opener_id).unwrap().native_reserved_action.is_none());
    }

    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn popup_capture_reservation_survives_cancelled_ui_until_actor_finishes() {
        let (dir, registry, state, web) = setup();
        let (opener_id, _, _) = fake_session(dir.path(), &state);
        let mut request = req(dir.path(), TfBrowserOperation::Open);
        request.url = Some("https://example.org/popup".into());
        let prepared = prepare(request, &registry, &state).unwrap();
        {
            let mut entries = state.entries.lock().unwrap();
            let opener = entries.sessions.get_mut(&opener_id).unwrap();
            opener.busy = true;
            opener.native_reserved_action = Some(prepared.token.clone());
            entries.pending.get_mut(&prepared.token).unwrap().request.operation =
                TfBrowserOperation::OpenRequestedPopup;
        }
        let ui = Arc::new(PopupCaptureReservation {
            entries: state.entries.clone(),
            opener_id: opener_id.clone(),
            token: prepared.token.clone(),
        });
        let native_actor = ui.clone();
        drop(ui);
        assert!(state.entries.lock().unwrap().sessions.get(&opener_id).unwrap().busy);
        // Cancellation consumes the pending approval, but must not grant a
        // second opener command while native capture is still in flight.
        assert!(cancel(&prepared.token, &state, &web).unwrap());
        assert_eq!(native_actor.admit("https://example.org/popup").unwrap_err(), "popup-capture-pending-revoked");
        assert!(!state.entries.lock().unwrap().pending.contains_key(&prepared.token));
        assert!(state.entries.lock().unwrap().sessions.get(&opener_id).unwrap().busy);
        drop(native_actor);
        let entries = state.entries.lock().unwrap();
        let opener = entries.sessions.get(&opener_id).unwrap();
        assert!(!opener.busy);
        assert!(opener.native_reserved_action.is_none());
    }

    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn popup_capture_actor_denies_expired_rebound_and_replayed_pending() {
        let (dir, registry, state, _) = setup();
        let (opener_id, _, _) = fake_session(dir.path(), &state);
        let mut request = req(dir.path(), TfBrowserOperation::Open);
        request.url = Some("https://example.org/".into());
        let prepared = prepare(request, &registry, &state).unwrap();
        {
            let mut entries = state.entries.lock().unwrap();
            let opener = entries.sessions.get_mut(&opener_id).unwrap();
            opener.busy = true;
            opener.native_reserved_action = Some(prepared.token.clone());
            let pending = entries.pending.get_mut(&prepared.token).unwrap();
            pending.request.operation = TfBrowserOperation::OpenRequestedPopup;
            pending.request.browser_session_id = Some(opener_id.clone());
            pending.revision = Some(1);
            pending.approving = true;
        }
        let lease = PopupCaptureReservation {
            entries: state.entries.clone(), opener_id: opener_id.clone(), token: prepared.token.clone(),
        };
        assert_eq!(lease.admit("https://different.example.org/").unwrap_err(), "popup-capture-pending-stale");
        {
            let mut entries = state.entries.lock().unwrap();
            entries.sessions.get_mut(&opener_id).unwrap().revision = 2;
        }
        assert_eq!(lease.admit("https://example.org/").unwrap_err(), "tab-opener-stale-or-scope-denied");
        {
            let mut entries = state.entries.lock().unwrap();
            entries.sessions.get_mut(&opener_id).unwrap().revision = 1;
            entries.pending.get_mut(&prepared.token).unwrap().expires = Instant::now();
        }
        assert_eq!(lease.admit("https://example.org/").unwrap_err(), "popup-capture-pending-stale");
        state.entries.lock().unwrap().pending.remove(&prepared.token);
        assert_eq!(lease.admit("https://example.org/").unwrap_err(), "popup-capture-pending-revoked");
    }

    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn native_cancel_tracks_consumed_active_token_without_reissuing_approval() {
        let (_dir, _registry, state, web) = setup();
        let token = nonce().unwrap();
        let active = Arc::new(Active {
            native_click_phase: Some(AtomicU8::new(NATIVE_CLICK_QUEUED)),
            ..Active::default()
        });
        state
            .entries
            .lock()
            .unwrap()
            .active
            .insert(token.clone(), active.clone());
        // A consumed native approval has no Pending entry. Cancellation must
        // still reach its existing active token without minting a new grant.
        assert!(cancel(&token, &state, &web).unwrap());
        assert!(active.cancelled.load(Ordering::Acquire));
        assert!(*active.cancel_watch.borrow());
        assert_eq!(
            active
                .native_click_phase
                .as_ref()
                .unwrap()
                .load(Ordering::Acquire),
            NATIVE_CLICK_CANCELLED
        );
        assert!(!state.entries.lock().unwrap().pending.contains_key(&token));
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn native_cancel_cannot_claim_to_stop_committed_dispatch() {
        let (_dir, _registry, state, web) = setup();
        let token = nonce().unwrap();
        let active = Arc::new(Active {
            native_click_phase: Some(AtomicU8::new(NATIVE_CLICK_DISPATCH_COMMITTED)),
            ..Active::default()
        });
        state
            .entries
            .lock()
            .unwrap()
            .active
            .insert(token.clone(), active.clone());
        assert!(!cancel(&token, &state, &web).unwrap());
        assert!(!active.cancelled.load(Ordering::Acquire));
        assert_eq!(
            active
                .native_click_phase
                .as_ref()
                .unwrap()
                .load(Ordering::Acquire),
            NATIVE_CLICK_DISPATCH_COMMITTED
        );
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn grouped_case10_native_dispatch_and_cancel_have_one_winner() {
        use std::sync::Barrier;
        for _ in 0..32 {
            let (_dir, _registry, state, web) = setup();
            let token = nonce().unwrap();
            let active = Arc::new(Active {
                native_click_phase: Some(AtomicU8::new(NATIVE_CLICK_QUEUED)),
                ..Active::default()
            });
            state
                .entries
                .lock()
                .unwrap()
                .active
                .insert(token.clone(), active.clone());
            let barrier = Barrier::new(2);
            std::thread::scope(|s| {
                let dispatch = s.spawn(|| {
                    barrier.wait();
                    active
                        .native_click_phase
                        .as_ref()
                        .unwrap()
                        .compare_exchange(
                            NATIVE_CLICK_QUEUED,
                            NATIVE_CLICK_DISPATCH_COMMITTED,
                            Ordering::AcqRel,
                            Ordering::Acquire,
                        )
                        .is_ok()
                });
                barrier.wait();
                let cancelled = cancel(&token, &state, &web).unwrap();
                assert_ne!(cancelled, dispatch.join().unwrap());
                assert_eq!(active.cancelled.load(Ordering::Acquire), cancelled);
                assert_eq!(*active.cancel_watch.borrow(), cancelled);
                assert!(!state.entries.lock().unwrap().pending.contains_key(&token));
            });
        }
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn grouped_case11_restarted_owner_rejects_old_token_and_unknown_is_never_replay() {
        let (_dir, registry, _state, web) = setup();
        let token = nonce().unwrap();
        let restarted = TfBrowserState::default();
        assert!(consume(&token, &registry, &restarted).is_err());
        assert!(!cancel(&token, &restarted, &web).unwrap());
        let effect = NativeEffectReceipt::classify(NativeEffectTerminal::Unknown);
        assert_eq!(effect.canonical_terminal, NativeEffectOutcome::Unknown);
        assert_eq!(effect.effect_state, "Unknown");
        assert_eq!(effect.retry, "NEVER_REPLAY");
        assert!(!effect.auto_retry);
        // Source contract only: this does not simulate an approved dispatch,
        // persist a receipt, or prove a remote effect after process death.
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn native_pre_dispatch_denial_is_not_misreported_as_possible_dispatch() {
        for (reason, terminal) in [
            (
                "native-click-cancelled-before-consumption",
                NativeEffectTerminal::CancelledBeforeDispatch,
            ),
            ("STALE_ELEMENT", NativeEffectTerminal::Stale),
            (
                "confined-native-central-page-or-element-changed",
                NativeEffectTerminal::Stale,
            ),
            (
                "unknown-or-consumed-browser-token",
                NativeEffectTerminal::Denied,
            ),
            (
                "native-click-process-unattested",
                NativeEffectTerminal::FailedBeforeDispatch,
            ),
        ] {
            let classified = native_pre_dispatch_terminal(reason);
            assert_eq!(classified, terminal, "{reason}");
            let receipt = NativeEffectReceipt::classify(classified);
            assert_ne!(receipt.canonical_terminal, NativeEffectOutcome::Unknown);
            assert_eq!(receipt.effect_state, "NotAttempted");
            assert!(!receipt.auto_retry);
        }
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn native_original_link_approval_boundary_distinguishes_snapshot_from_reservation() {
        // A successfully displayed original-link consent dialog means
        // pre-consent CaptureLink returned and the original destination was
        // sealed. After the dialog the parent can still fail without ever
        // entering the fixed original-node host dispatch.
        //
        // Distinguish the actual generic installed STALE category from the
        // nearby revision/reservation mismatch: the latter MUST remain a
        // DENIED, not be misleadingly attributed to renderer DOM mutation.
        for reason in [
            "STALE_ELEMENT",
            "STALE_SESSION",
            "native-click-observation-stale",
            "native-action-reservation-expired-or-changed",
            "confined-native-snapshot-stale",
            "confined-native-central-page-or-element-changed",
        ] {
            let effect = NativeEffectReceipt::classify(native_pre_dispatch_terminal(reason));
            assert_eq!(effect.terminal, NativeEffectTerminal::Stale, "{reason}");
            assert_eq!(effect.reason_code, "native-effect-exact-node-stale", "{reason}");
            assert_eq!(effect.effect_state, "NotAttempted", "{reason}");
            assert_eq!(effect.retry, "SAFE_REPREPARE", "{reason}");
            assert!(!effect.auto_retry, "{reason}");
        }
        for reason in [
            "confined-native-central-approval-expired-or-scope-changed",
            "confined-native-central-session-or-source-changed",
            "unknown-or-consumed-browser-token",
        ] {
            let effect = NativeEffectReceipt::classify(native_pre_dispatch_terminal(reason));
            assert_eq!(effect.terminal, NativeEffectTerminal::Denied, "{reason}");
            assert_ne!(effect.reason_code, "native-effect-exact-node-stale", "{reason}");
            assert_eq!(effect.effect_state, "NotAttempted", "{reason}");
        }
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn native_click_confirmation_requires_independent_next_document_receipt() {
        const ACTION_ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let source = "https://example.org/";
        let target = "https://example.org/clicked";
        // The closed original retained link binds this exact destination
        // digest. A same-origin document elsewhere is NOT click evidence.
        let target_digest = format!("{:x}", Sha256::digest(target.as_bytes()));
        fn native_link_navigation_observed(
            receipt: &BrokerResourceReceipt,
            source: &str,
            generation: u64,
            role: &SemanticRole,
        ) -> bool {
            let approved_link = "https://example.org/clicked";
            let digest = format!("{:x}", Sha256::digest(approved_link.as_bytes()));
            super::native_link_navigation_observed(
                receipt, source, &digest, generation, 1, role, ACTION_ID,
            )
        }
        fn native_link_navigation_evidence(
            receipt: &BrokerResourceReceipt,
            source: &str,
            generation: u64,
            role: &SemanticRole,
        ) -> Option<NativeEffectEvidence> {
            let approved_link = "https://example.org/clicked";
            let digest = format!("{:x}", Sha256::digest(approved_link.as_bytes()));
            super::native_link_navigation_evidence(
                receipt, source, &digest, generation, 1, role, ACTION_ID,
            )
        }
        let make_receipt = || BrokerResourceReceipt {
            request_id: 2,
            page_generation: 2,
            native_com_completed: true,
            terminal: "completed",
            reason: "ok".into(),
            bytes: 40,
            causal_native_action_id: Some(ACTION_ID.into()),
            tf3: Some(tf_web::TfWebReceipt {
                tool_id: "tf.web.v1",
                request_id: "one-broker-flight".into(),
                actor: "fixture-actor".into(),
                operation: TfWebOperation::HttpGet,
                actual_method: "GET",
                terminal: "completed",
                effect_state: "Observed",
                requested_url: Some(target.into()),
                final_url: Some(target.into()),
                redirect_chain: Vec::new(),
                normalized_target: Some(target.into()),
                status_code: Some(200),
                content_type: Some("text/html".into()),
                tls_state: "verified",
                bytes_received: Some(40),
                bytes_retained: 40,
                truncated: false,
                content_sha256: Some("b".repeat(64)),
                body: None,
                started_at: 100,
                ended_at: 200,
                credential_reference: None,
                credential_used: false,
                retry: "NEVER_REPLAY",
                auto_retry: false,
                policy_decision: "allowed",
                reason_code: "ok",
                search_results: None,
                search_source: None,
                uncertainty: "transport-only",
                isolation: "tf3",
                dns_evidence: Vec::new(),
            }),
        };
        let good = make_receipt();
        assert!(native_link_navigation_observed(
            &good,
            source,
            1,
            &SemanticRole::Link
        ));
        assert!(!super::native_link_navigation_observed(
            &good,
            source,
            &"0".repeat(64),
            1,
            1,
            &SemanticRole::Link,
            ACTION_ID
        ));
        assert!(super::native_link_navigation_observed(
            &good,
            source,
            &target_digest,
            1,
            1,
            &SemanticRole::Link,
            ACTION_ID
        ));
        assert!(
            !super::native_link_navigation_observed(
                &good,
                source,
                &target_digest,
                1,
                2,
                &SemanticRole::Link,
                ACTION_ID
            ),
            "a pre-dispatch or replayed broker receipt cannot confirm a new click"
        );
        assert!(!super::native_link_navigation_observed(
            &good,
            source,
            &target_digest,
            1,
            u64::MAX,
            &SemanticRole::Link,
            ACTION_ID
        ));
        let evidence = native_link_navigation_evidence(&good, source, 1, &SemanticRole::Link)
            .expect("independent completed HTTPS document carries bounded receipt evidence");
        assert_eq!(evidence.broker_request_id, 2);
        assert_eq!(evidence.source_page_generation, 1);
        assert_eq!(evidence.observed_page_generation, 2);
        assert_eq!(evidence.origin, "https://example.org");
        assert_eq!(evidence.response_sha256, "b".repeat(64));
        assert_eq!(evidence.status_code, 200);
        assert!(evidence.native_com_completed);
        let mut uncorrelated = make_receipt();
        uncorrelated.causal_native_action_id = None;
        assert!(
            !native_link_navigation_observed(&uncorrelated, source, 1, &SemanticRole::Link),
            "newer same-URL GET without authenticated action edge is NOT click proof"
        );
        let mut unrelated = make_receipt();
        unrelated.causal_native_action_id = Some("b".repeat(48));
        assert!(!native_link_navigation_observed(
            &unrelated,
            source,
            1,
            &SemanticRole::Link
        ));
        let output = serde_json::to_string(&evidence).unwrap();
        assert!(!output.contains("/clicked"));
        assert!(!output.contains("one-broker-flight"));
        assert!(!native_link_navigation_observed(
            &good,
            source,
            1,
            &SemanticRole::Button
        ));
        let mut altered = make_receipt();
        altered.page_generation = 1;
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.native_com_completed = false;
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.terminal = "denied";
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.tf3.as_mut().unwrap().final_url = Some("https://foreign.example/clicked".into());
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.tf3.as_mut().unwrap().requested_url = Some("https://example.org/".into());
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.tf3.as_mut().unwrap().status_code = Some(403);
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.tf3.as_mut().unwrap().content_type = Some("text/css".into());
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.tf3.as_mut().unwrap().truncated = true;
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.tf3.as_mut().unwrap().content_sha256 = None;
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.tf3.as_mut().unwrap().tls_state = "unknown";
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.tf3.as_mut().unwrap().credential_used = true;
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
        let mut altered = make_receipt();
        altered.tf3 = None;
        assert!(!native_link_navigation_observed(
            &altered,
            source,
            1,
            &SemanticRole::Link
        ));
    }
    #[cfg(all(windows, feature = "tf-browser-native-runtime"))]
    #[test]
    fn native_preconsumption_cancel_burns_token_and_releases_reserved_lease() {
        let (dir, registry, state, web) = setup();
        let (browser_id, _, _) = fake_session(dir.path(), &state);
        let mut request = req(dir.path(), TfBrowserOperation::Snapshot);
        request.browser_session_id = Some(browser_id.clone());
        let prepared = prepare(request, &registry, &state).unwrap();
        let active = Arc::new(Active {
            native_click_phase: Some(AtomicU8::new(NATIVE_CLICK_QUEUED)),
            ..Active::default()
        });
        {
            let mut entries = state.entries.lock().unwrap();
            entries
                .pending
                .get_mut(&prepared.token)
                .unwrap()
                .request
                .operation = TfBrowserOperation::Click;
            entries
                .active
                .insert(prepared.token.clone(), active.clone());
            let session = entries.sessions.get_mut(&browser_id).unwrap();
            session.busy = true;
            session.native_reserved_action = Some(prepared.token.clone());
        }
        assert!(cancel(&prepared.token, &state, &web).unwrap());
        assert!(active.cancelled.load(Ordering::Acquire));
        assert_eq!(
            active
                .native_click_phase
                .as_ref()
                .unwrap()
                .load(Ordering::Acquire),
            NATIVE_CLICK_CANCELLED
        );
        let entries = state.entries.lock().unwrap();
        assert!(!entries.pending.contains_key(&prepared.token));
        assert!(!entries.active.contains_key(&prepared.token));
        let session = entries.sessions.get(&browser_id).unwrap();
        assert!(!session.busy);
        assert!(session.native_reserved_action.is_none());
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
        // Effectful DOM gestures cannot even mint a pending grant against
        // the inert text browser or bypass the native approval gate.
        for op in [
            TfBrowserOperation::Click,
            TfBrowserOperation::TriggerPagePopup,
            TfBrowserOperation::Type,
            TfBrowserOperation::Clear,
            TfBrowserOperation::Select,
            TfBrowserOperation::Check,
            TfBrowserOperation::Uncheck,
            TfBrowserOperation::Scroll,
            TfBrowserOperation::Submit,
        ] {
            let mut r = req(dir.path(), op);
            r.browser_session_id = Some(id.clone());
            r.page_id = Some(nonce().unwrap());
            r.page_generation = Some(1);
            r.snapshot_id = Some(nonce().unwrap());
            r.element_id = Some(nonce().unwrap());
            r.text = match op {
                TfBrowserOperation::Type => Some("safe input".into()),
                TfBrowserOperation::Select => Some(nonce().unwrap()),
                TfBrowserOperation::Submit => Some(nonce().unwrap()),
                TfBrowserOperation::Scroll => Some("down".into()),
                _ => None,
            };
            assert_eq!(
                prepare(r, &registry, &state).err().as_deref(),
                Some("native-action-requires-confined-approved-runtime")
            );
        }
        for op in [TfBrowserOperation::Screenshot] {
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
    fn native_retained_operations_are_exact_scope_only_with_closed_parameters() {
        let (dir, _, _, _) = setup();
        for (operation, text, expected) in [
            (TfBrowserOperation::TriggerPagePopup, None, NativeRetainedAction::PopupClick),
            (
                TfBrowserOperation::Type,
                Some("hello"),
                NativeRetainedAction::Type("hello".into()),
            ),
            (TfBrowserOperation::Clear, None, NativeRetainedAction::Clear),
            (
                TfBrowserOperation::Select,
                Some("a"),
                NativeRetainedAction::Select("a".into()),
            ),
            (
                TfBrowserOperation::Submit,
                Some("a"),
                NativeRetainedAction::Submit("a".into()),
            ),
            (TfBrowserOperation::Check, None, NativeRetainedAction::Check),
            (
                TfBrowserOperation::Uncheck,
                None,
                NativeRetainedAction::Uncheck,
            ),
            (
                TfBrowserOperation::Scroll,
                Some("up"),
                NativeRetainedAction::Scroll(-120),
            ),
        ] {
            let mut request = req(dir.path(), operation);
            request.browser_session_id = Some(nonce().unwrap());
            request.page_id = Some(nonce().unwrap());
            request.page_generation = Some(2);
            request.snapshot_id = Some(nonce().unwrap());
            request.element_id = Some(nonce().unwrap());
            request.text = match operation {
                TfBrowserOperation::Select | TfBrowserOperation::Submit => Some(nonce().unwrap()),
                _ => text.map(str::to_owned),
            };
            assert!(ensure_request_shape(&request).is_ok(), "{operation:?}");
            let derived = native_retained_action_from_request(&request).unwrap();
            if !matches!(
                operation,
                TfBrowserOperation::Select | TfBrowserOperation::Submit
            ) {
                assert_eq!(derived, expected);
            } else {
                assert!(matches!(
                    derived,
                    NativeRetainedAction::Select(_) | NativeRetainedAction::Submit(_)
                ));
            }
            assert!(operation.approval_required());
            request.selector = Some("body input".into());
            assert!(
                ensure_request_shape(&request).is_err(),
                "selector fallback must fail"
            );
        }
        for (operation, malicious) in [
            (TfBrowserOperation::Type, "secret\n"),
            (TfBrowserOperation::Type, "\u{202e}spoof"),
            (TfBrowserOperation::Type, "\u{200b}hidden"),
            (TfBrowserOperation::Type, ""),
            (TfBrowserOperation::Scroll, "360"),
            (TfBrowserOperation::Scroll, "downwards"),
            (TfBrowserOperation::Check, "true"),
            (TfBrowserOperation::Uncheck, "false"),
            (TfBrowserOperation::Clear, "value"),
            (TfBrowserOperation::Select, "option-label"),
        ] {
            let mut request = req(dir.path(), operation);
            request.browser_session_id = Some(nonce().unwrap());
            request.page_id = Some(nonce().unwrap());
            request.page_generation = Some(1);
            request.snapshot_id = Some(nonce().unwrap());
            request.element_id = Some(nonce().unwrap());
            request.text = Some(malicious.into());
            assert!(
                ensure_request_shape(&request).is_err(),
                "operation={operation:?}"
            );
        }
    }
    #[test]
    fn native_click_shape_rejects_any_missing_or_extraneous_identity_before_authorization() {
        let (dir, registry, state, _) = setup();
        let (id, _, _) = fake_session(dir.path(), &state);
        let mut r = req(dir.path(), TfBrowserOperation::Click);
        r.browser_session_id = Some(id);
        assert_eq!(
            prepare(r.clone(), &registry, &state).err().as_deref(),
            Some("native-click-exact-target-required")
        );
        r.page_id = Some(nonce().unwrap());
        r.page_generation = Some(1);
        r.snapshot_id = Some(nonce().unwrap());
        r.element_id = Some(nonce().unwrap());
        r.selector = Some("button".into());
        assert_eq!(
            prepare(r.clone(), &registry, &state).err().as_deref(),
            Some("native-click-exact-target-required")
        );
        r.selector = None;
        r.text = Some("arbitrary script or text".into());
        assert_eq!(
            prepare(r.clone(), &registry, &state).err().as_deref(),
            Some("native-click-exact-target-required")
        );
        r.text = None;
        r.page_generation = Some(0);
        assert_eq!(
            prepare(r.clone(), &registry, &state).err().as_deref(),
            Some("native-click-exact-target-required")
        );
        r.page_generation = Some(1);
        assert_eq!(
            prepare(r, &registry, &state).err().as_deref(),
            Some("native-action-requires-confined-approved-runtime")
        );
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
        assert!(!tf_web::cancel(&prepared.token, &web).unwrap());
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
