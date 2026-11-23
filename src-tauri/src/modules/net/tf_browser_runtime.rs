//! Windows TF4 browser session owner. No model or Tauri IPC entry point.
//!
//! A production host is an untrusted, zero-network-capability AppContainer
//! child. The parent is the *only* network authority and forwards bounded GET
//! requests through the existing TF3 prepare/execute/receipt implementation.
//! Browser readiness requires retained kernel process identity, matching SID,
//! job membership and the WebView2 COM effective UDF *before navigation*.
//! The acceptance-only host/fixture mode is never launched by this module.

use super::tf_browser_contract::{
    BrowserPageContract, ObservedElement, PageSnapshot, SemanticRole, SemanticState,
};
use super::tf_web::{self, TfWebOperation, TfWebReceipt, TfWebRequest, TfWebState};
use crate::modules::workspace::WorkspaceRegistry;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

const FRAME_MAX: usize = 128 * 1024;
const RESOURCE_MAX: usize = 32 * 1024;
const REQUEST_MAX: usize = 20;
const SESSION_NONCE_BYTES: usize = 24;

/// Must be built by trusted TF4 native prepare/approve/execute ownership.
/// Actor, session and workspace are *not* authenticated by arbitrary IPC text.
pub(crate) struct BrowserRuntimeStart {
    pub actor: String,
    pub session_id: String,
    pub workspace_root: PathBuf,
    pub initial_url: String,
    /// Existing trusted application-owned directory; one new child per flight.
    pub private_parent: PathBuf,
    /// Installed production-capable host, never the acceptance fixture runner.
    pub host_executable: PathBuf,
    /// Digest pinned by the installed application, independent of the child.
    pub host_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerResourceReceipt {
    pub request_id: u64,
    pub page_generation: u64,
    /// True only after the native UI-apartment COM deferral was completed.
    pub native_com_completed: bool,
    pub terminal: &'static str,
    pub reason: String,
    pub bytes: usize,
    pub tf3: Option<TfWebReceipt>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildReady {
    version: u8,
    session: String,
    request_id: u64,
    kind: String,
    effective_udf: String,
    host_pid: u32,
    browser_pid: u32,
    renderer_pid: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildGet {
    version: u8,
    session: String,
    request_id: u64,
    method: String,
    url: String,
    /// Production requests must carry the actual native page epoch.
    /// The acceptance-only v1 fixture has its own unchanged wire contract.
    page_generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildComAck {
    version: u8,
    session: String,
    request_id: u64,
    kind: String,
    status: u16,
    page_generation: u64,
}

/// The child broker worker, not the parent, decides when both sealed pipes
/// are free of a v1 GET/COM completion. This offer is a scheduling lease and
/// NEVER evidence of human consent or authority to perform an action.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildControlTurnOffer {
    version: u8,
    kind: String,
    session: String,
    turn_id: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParentControlTurnChoice<'a> {
    version: u8,
    kind: &'static str,
    session: &'a str,
    turn_id: u64,
}

fn validate_control_turn_offer(
    bytes: &[u8],
    session: &str,
    previous_id: u64,
) -> Result<u64, &'static str> {
    let offer: ChildControlTurnOffer =
        serde_json::from_slice(bytes).map_err(|_| "browser-control-turn-offer-invalid")?;
    if offer.version != 2
        || offer.kind != "control-turn-offer"
        || offer.session != session
        || offer.turn_id == 0
        || Some(offer.turn_id) != previous_id.checked_add(1)
    {
        return Err("browser-control-turn-offer-stale");
    }
    Ok(offer.turn_id)
}

/// Exact scope presented to an EXISTING central native approval owner. Only
/// that owner may atomically consume a previously approved, expiring one-use
/// grant and return its real 48-hex approval ID. This type neither creates a
/// grant nor provides a model/Tauri IPC endpoint. A host control-turn offer
/// is only a scheduling lease, never a substitute for this separate consent.
pub(crate) struct NativeExactClickApprovalScope<'a> {
    pub actor: &'a str,
    pub session_id: &'a str,
    pub workspace_root: &'a Path,
    pub target: &'a super::tf_browser_contract::ActionTarget,
    pub effect: super::tf_browser_contract::BrowserEffect,
    pub source_id: String,
    pub observation_id: u64,
    pub index: u32,
    pub ordinal: u32,
    pub check_sequence: u64,
}

/// Scheduling signal only. The native owner may clone this handle into its
/// bounded command mailbox, and request a future exclusive host control turn
/// while `serve_one` is awaiting input. It creates NO consent or action grant.
/// Multiple requests coalesce; pending commands still need their own exact
/// central approval and an independently held native control turn.
#[derive(Clone)]
#[allow(dead_code)]
pub(crate) struct NativeControlTurnRequester(Arc<AtomicBool>);

impl NativeControlTurnRequester {
    #[allow(dead_code)] // owner mailbox integration is in tf_browser.rs
    pub(crate) fn request(&self) {
        self.0.store(true, Ordering::Release);
    }
}

/// Unforgeable-to-callers consumed central consent witness. Fields and
/// construction are intentionally private; this transport module cannot mint
/// approval and NO current public/native/model path creates a witness. A later
/// central TF4 approval owner must supply a genuinely consumed grant from its
/// authoritative transaction before the click sender can be wired.
/// Moving the witness into dispatch prevents reuse by the Rust type system.
#[allow(dead_code)]
pub(crate) struct NativeConsumedExactClickApproval {
    approval_id: String,
    actor: String,
    session_id: String,
    workspace_root: PathBuf,
    target: super::tf_browser_contract::ActionTarget,
    effect: super::tf_browser_contract::BrowserEffect,
    source_id: String,
    observation_id: u64,
    index: u32,
    ordinal: u32,
    check_sequence: u64,
    expires_at: std::time::Instant,
}

impl NativeConsumedExactClickApproval {
    /// Called ONLY by the trusted sibling native central-approval owner after
    /// its existing one-use approval token was atomically consumed. This is a
    /// value constructor, not a consent issuer: it cannot authenticate a UI
    /// decision, and must never be called with a synthetic/random approval ID.
    /// `pub(super)` deliberately excludes frontend, IPC and model callers.
    pub(super) fn from_consumed_central_token(
        approval_id: String,
        scope: &NativeExactClickApprovalScope<'_>,
        expires_at: std::time::Instant,
    ) -> Result<Self, String> {
        let now = std::time::Instant::now();
        if approval_id.len() != 48
            || !approval_id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || expires_at <= now
            || expires_at.duration_since(now) > std::time::Duration::from_secs(60)
        {
            return Err("native-click-central-token-invalid-or-expired".into());
        }
        Ok(Self {
            approval_id,
            actor: scope.actor.to_owned(),
            session_id: scope.session_id.to_owned(),
            workspace_root: scope.workspace_root.to_path_buf(),
            target: (*scope.target).clone(),
            effect: scope.effect,
            source_id: scope.source_id.clone(),
            observation_id: scope.observation_id,
            index: scope.index,
            ordinal: scope.ordinal,
            check_sequence: scope.check_sequence,
            expires_at,
        })
    }

    fn matches_exact(&self, scope: &NativeExactClickApprovalScope<'_>) -> bool {
        self.expires_at > std::time::Instant::now()
            && self.actor == scope.actor
            && self.session_id == scope.session_id
            && self.workspace_root.as_path() == scope.workspace_root
            && &self.target == scope.target
            && self.effect == scope.effect
            && self.source_id == scope.source_id
            && self.observation_id == scope.observation_id
            && self.index == scope.index
            && self.ordinal == scope.ordinal
            && self.check_sequence == scope.check_sequence
    }
}

/// This is deliberately only a non-sensitive DOM *structure* probe. It is not
/// a semantic or accessible-name snapshot and cannot authorize an action.
/// Arbitrary page strings are omitted because heuristic redaction cannot
/// establish that visible text/ARIA labels/URLs are secret-free.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeElementStructure {
    pub index: u32,
    pub role: String,
    pub depth: u8,
    pub heading_level: Option<u8>,
    /// Native DOM state, never a model action authority. These fields are
    /// restricted to booleans and a closed non-secret control-type vocabulary;
    /// the child never transports labels, URLs, text or input values.
    #[serde(default)]
    pub visible: bool,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub checked: Option<bool>,
    #[serde(default)]
    pub selected: Option<bool>,
    #[serde(default)]
    pub expanded: Option<bool>,
    #[serde(default)]
    pub control_type: Option<String>,
    #[serde(default)]
    pub required: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeDomStructure {
    pub version: u8,
    pub kind: String,
    pub session: String,
    pub observation_id: u64,
    pub page_generation: u64,
    pub source_id: String,
    pub terminal: String,
    pub reason: String,
    pub truncated: bool,
    pub visited: u32,
    /// Sensitive/unsupported fields withheld by the fixed native DOM walker.
    /// This is a bounded count, never a serialized list of private data.
    #[serde(default)]
    pub omitted_fields: u32,
    pub elements: Vec<NativeElementStructure>,
}

/// Transform only the exact closed native COM control observation into the
/// existing TF4 page-reference contract. Names, page text, HTML, URLs, form
/// targets, raw attributes and values are NEVER supplied by this bridge.
/// This allocates opaque snapshot/element references but does not authorize
/// execution, and is intentionally not registered as a model-facing tool.
fn structural_observed_elements(
    value: &NativeDomStructure,
) -> Result<Vec<ObservedElement>, &'static str> {
    if value.terminal != "completed" || value.reason != "ok" {
        return Err("browser-structure-no-valid-observation");
    }
    value
        .elements
        .iter()
        .map(|element| {
            let role = match element.role.as_str() {
                "link" => SemanticRole::Link,
                "button" => SemanticRole::Button,
                "checkbox" => SemanticRole::Checkbox,
                "radio" => SemanticRole::Radio,
                "select" => SemanticRole::Combobox,
                "textbox" => SemanticRole::Textbox,
                "input" => match element.control_type.as_deref() {
                    Some("button" | "submit" | "reset") => SemanticRole::Button,
                    Some(_) => SemanticRole::Textbox,
                    None => return Err("browser-structure-untyped-control-denied"),
                },
                "option" => SemanticRole::Option,
                "heading" => SemanticRole::Heading,
                "main" => SemanticRole::Main,
                "paragraph" => SemanticRole::Paragraph,
                "img" | "image" => SemanticRole::Image,
                "label" => SemanticRole::Label,
                "form" | "navigation" | "article" | "listitem" => SemanticRole::Other,
                _ => return Err("browser-structure-unrecognized-role"),
            };
            Ok(ObservedElement {
                serial: u64::from(element.index),
                role,
                depth: element.depth,
                heading_level: element.heading_level,
                accessible_name: String::new(),
                state: SemanticState {
                    enabled: Some(element.enabled),
                    checked: element.checked,
                    selected: element.selected,
                    expanded: element.expanded,
                    visible: Some(element.visible),
                },
                href: None,
                form_target: None,
                form_method: None,
                field_type: element.control_type.clone(),
                required: element.required,
                // No page metadata can prove the absence of unobservable
                // handlers or external effects. Remain maximally conservative.
                has_script_handler: true,
            })
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParentObserve<'a> {
    version: u8,
    kind: &'static str,
    session: &'a str,
    observation_id: u64,
    page_generation: u64,
    source_id: &'a str,
}

/// Production sealed-pipe action frame shape. No public sender is connected
/// yet: central TF4 approval must bind a PreparedAction before it can send.
/// Only one closed action kind exists in this first native host slice.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParentElementAction<'a> {
    version: u8,
    kind: &'static str,
    session: &'a str,
    check_sequence: u64,
    observation_id: u64,
    page_generation: u64,
    source_id: &'a str,
    index: u32,
    ordinal: u32,
    action: &'static str,
    approval_id: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildElementAction {
    version: u8,
    kind: String,
    session: String,
    check_sequence: u64,
    observation_id: u64,
    page_generation: u64,
    source_id: String,
    index: u32,
    ordinal: u32,
    action: String,
    approval_id: String,
    state: String,
}

fn validate_element_action_reply(
    frame: &[u8],
    request: &ParentElementAction<'_>,
) -> Result<crate::modules::net::tf_browser_contract::NativeEffectTerminal, &'static str> {
    use crate::modules::net::tf_browser_contract::NativeEffectTerminal as T;
    if frame.is_empty() || frame.len() > 1024 {
        return Err("browser-action-reply-bounds");
    }
    let reply: ChildElementAction =
        serde_json::from_slice(frame).map_err(|_| "browser-action-reply-schema-denied")?;
    if reply.version != 2
        || reply.kind != "element-action"
        || reply.session != request.session
        || reply.check_sequence != request.check_sequence
        || reply.observation_id != request.observation_id
        || reply.page_generation != request.page_generation
        || reply.source_id != request.source_id
        || reply.index != request.index
        || reply.ordinal != request.ordinal
        || reply.action != request.action
        || reply.approval_id != request.approval_id
    {
        return Err("browser-action-reply-identity-denied");
    }
    match reply.state.as_str() {
        "DISPATCHED" => Ok(T::Dispatched),
        "STALE" => Ok(T::Stale),
        "DENIED_TARGET" => Ok(T::Denied),
        "UNKNOWN" => Ok(T::Unknown),
        _ => Err("browser-action-reply-state-denied"),
    }
}

/// A test-only, sealed read-only identity recheck. The ordinal and index are
/// derived from the authenticated previous DOM snapshot and PreparedAction,
/// never taken from a caller/model selector or supplied ordinal.
#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParentElementRecheck<'a> {
    version: u8,
    kind: &'static str,
    session: &'a str,
    check_sequence: u64,
    observation_id: u64,
    page_generation: u64,
    source_id: &'a str,
    index: u32,
    ordinal: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    debug_replace_heading: Option<bool>,
}

#[cfg(test)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildElementRecheck {
    version: u8,
    kind: String,
    session: String,
    check_sequence: u64,
    observation_id: u64,
    page_generation: u64,
    source_id: String,
    index: u32,
    ordinal: u32,
    state: String,
}

#[cfg(test)]
fn validate_element_recheck_reply(
    frame: &[u8],
    request: &ParentElementRecheck<'_>,
) -> Result<bool, &'static str> {
    if frame.is_empty() || frame.len() > 1024 {
        return Err("browser-recheck-frame-bounds");
    }
    let reply: ChildElementRecheck =
        serde_json::from_slice(frame).map_err(|_| "browser-recheck-schema-denied")?;
    if reply.version != 2
        || reply.kind != "element-recheck"
        || reply.session != request.session
        || reply.check_sequence != request.check_sequence
        || reply.observation_id != request.observation_id
        || reply.page_generation != request.page_generation
        || reply.source_id != request.source_id
        || reply.index != request.index
        || reply.ordinal != request.ordinal
    {
        return Err("browser-recheck-native-identity-denied");
    }
    match reply.state.as_str() {
        "ACCEPTED" if request.debug_replace_heading.is_none() => Ok(true),
        "MUTATED" if request.debug_replace_heading == Some(true) => Ok(true),
        "STALE" => Ok(false),
        _ => Err("browser-recheck-state-denied"),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParentReply<'a> {
    version: u8,
    session: &'a str,
    request_id: u64,
    status: u16,
    content_type: &'a str,
    body_base64: String,
    error: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    control_turns: Option<bool>,
}

fn random_nonce() -> Result<String, String> {
    let mut bytes = [0u8; SESSION_NONCE_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| "browser-random-unavailable")?;
    Ok(bytes.iter().map(|v| format!("{v:02x}")).collect())
}

fn validate_get(frame: &ChildGet, nonce: &str, last_id: u64) -> Result<(), &'static str> {
    if frame.version != 1
        || frame.session != nonce
        || frame.request_id == 0
        || Some(frame.request_id) != last_id.checked_add(1)
        || frame.method != "GET"
        || frame.url.len() > 2048
        || frame.page_generation == 0
    {
        return Err("browser-broker-request-invalid");
    }
    let url = reqwest::Url::parse(&frame.url).map_err(|_| "browser-url-invalid")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|p| p != 443)
    {
        return Err("browser-broker-https-only");
    }
    Ok(())
}

/// A successful pipe write or WebView2 SetResponse is *not* a completed
/// browser response. This independently validates the UI-apartment native
/// deferral completion attestation, before an effect is recorded terminal.
fn validate_com_ack(
    frame: &ChildComAck,
    nonce: &str,
    id: u64,
    generation: u64,
    status: u16,
) -> Result<(), &'static str> {
    if frame.version != 1
        || frame.session != nonce
        || frame.kind != "com-completed"
        || frame.request_id != id
        || frame.page_generation != generation
        || frame.status != status
    {
        return Err("browser-com-deferral-completion-unverified");
    }
    Ok(())
}

fn validate_dom_structure(
    value: &NativeDomStructure,
    nonce: &str,
    id: u64,
    generation: u64,
    expected_source: &str,
) -> Result<(), &'static str> {
    if value.version != 2
        || value.kind != "dom-snapshot"
        || value.session != nonce
        || value.observation_id != id
        || value.page_generation != generation
        || value.source_id != expected_source
        || !matches!(value.terminal.as_str(), "completed" | "denied")
        || !matches!(
            value.reason.as_str(),
            "ok" | "source-mismatch"
                | "page-stale"
                | "bounds-exceeded"
                | "observation-failed"
                | "dom-unavailable"
                | "version-denied"
                | "unknown"
        )
        || value.visited > 512
        || value.omitted_fields > value.visited
        || (value.omitted_fields > 0 && !value.truncated)
        || value.elements.len() > 64
        || (value.terminal == "denied" && !value.elements.is_empty())
        || (value.terminal == "denied" && value.reason == "ok")
        || (value.terminal == "completed" && value.reason != "ok")
    {
        return Err("browser-structure-identity-or-bounds-invalid");
    }
    let mut previous = 0;
    for item in &value.elements {
        if item.index <= previous
            || item.index > value.visited
            || item.depth > 32
            || item
                .heading_level
                .is_some_and(|level| !(1..=6).contains(&level))
            || !matches!(
                item.role.as_str(),
                "main"
                    | "navigation"
                    | "article"
                    | "heading"
                    | "link"
                    | "button"
                    | "img"
                    | "image"
                    | "paragraph"
                    | "listitem"
                    | "label"
                    | "input"
                    | "select"
                    | "textbox"
                    | "checkbox"
                    | "radio"
                    | "option"
                    | "form"
            )
        {
            return Err("browser-structure-element-invalid");
        }
        if item.checked.is_some() && !matches!(item.role.as_str(), "checkbox" | "radio")
            || item.selected.is_some() && item.role != "option"
            || item.required.is_some()
                && !matches!(
                    item.role.as_str(),
                    "input" | "checkbox" | "radio" | "select" | "textbox"
                )
            || item.control_type.as_deref().is_some_and(|control| {
                !matches!(
                    control,
                    "text"
                        | "email"
                        | "tel"
                        | "search"
                        | "number"
                        | "checkbox"
                        | "radio"
                        | "button"
                        | "submit"
                        | "reset"
                        | "date"
                        | "time"
                        | "month"
                        | "week"
                        | "color"
                        | "range"
                        | "select"
                        | "textarea"
                )
            })
        {
            return Err("browser-structure-control-state-invalid");
        }
        if let Some(control) = item.control_type.as_deref() {
            let role_ok = match control {
                "checkbox" => item.role == "checkbox",
                "radio" => item.role == "radio",
                "select" => item.role == "select",
                "textarea" => item.role == "textbox",
                "button" | "submit" | "reset" => {
                    matches!(item.role.as_str(), "button" | "input")
                }
                _ => item.role == "input",
            };
            if !role_ok {
                return Err("browser-structure-control-role-mismatch");
            }
        }
        previous = item.index;
    }
    Ok(())
}

fn checked_mime(value: Option<&str>) -> Option<&'static str> {
    match value?
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "text/html" => Some("text/html"),
        "text/plain" => Some("text/plain"),
        "text/css" => Some("text/css"),
        "application/javascript" => Some("application/javascript"),
        "application/x-javascript" => Some("application/x-javascript"),
        "text/javascript" => Some("text/javascript"),
        "application/json" => Some("application/json"),
        "image/png" => Some("image/png"),
        "image/jpeg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        "image/avif" => Some("image/avif"),
        "image/svg+xml" => Some("image/svg+xml"),
        "font/woff" => Some("font/woff"),
        "font/woff2" => Some("font/woff2"),
        "application/font-woff" => Some("application/font-woff"),
        "application/font-woff2" => Some("application/font-woff2"),
        "application/vnd.ms-fontobject" => Some("application/vnd.ms-fontobject"),
        "font/ttf" => Some("font/ttf"),
        "font/otf" => Some("font/otf"),
        "application/octet-stream" => Some("application/octet-stream"),
        _ => None,
    }
}

fn encode_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for triple in bytes.chunks(3) {
        let a = triple[0];
        let b = triple.get(1).copied().unwrap_or(0);
        let c = triple.get(2).copied().unwrap_or(0);
        result.push(ALPHABET[(a >> 2) as usize] as char);
        result.push(ALPHABET[(((a & 3) << 4) | (b >> 4)) as usize] as char);
        result.push(if triple.len() > 1 {
            ALPHABET[(((b & 15) << 2) | (c >> 6)) as usize] as char
        } else {
            '='
        });
        result.push(if triple.len() > 2 {
            ALPHABET[(c & 63) as usize] as char
        } else {
            '='
        });
    }
    result
}

/// A reusable, non-networking frame reader used by the Windows pipe transport.
fn read_frame_from<R: std::io::Read>(reader: &mut R) -> Result<Vec<u8>, String> {
    let mut header = [0; 4];
    reader
        .read_exact(&mut header)
        .map_err(|_| "browser-pipe-header-closed")?;
    let len = u32::from_le_bytes(header) as usize;
    if len == 0 || len > FRAME_MAX {
        return Err("browser-frame-bounds-denied".into());
    }
    let mut bytes = vec![0; len];
    reader
        .read_exact(&mut bytes)
        .map_err(|_| "browser-pipe-frame-closed")?;
    Ok(bytes)
}

fn validate_host_binary(path: &Path, expected: &str) -> Result<PathBuf, String> {
    if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("browser-host-digest-required".into());
    }
    let path = std::fs::canonicalize(path).map_err(|_| "browser-host-not-installed")?;
    if !path.is_file()
        || path.file_name().and_then(|s| s.to_str()) != Some("clack-browser-host.exe")
    {
        return Err("browser-host-name-denied".into());
    }
    let bytes = std::fs::read(&path).map_err(|_| "browser-host-unreadable")?;
    let actual = format!("{:x}", Sha256::digest(bytes));
    if !actual.eq_ignore_ascii_case(expected) {
        return Err("browser-host-digest-mismatch".into());
    }
    Ok(path)
}

#[cfg(windows)]
mod windows_owner {
    use super::*;
    use std::ffi::{c_void, OsStr};
    use std::fs::{self, File};
    use std::io::{Read, Write};
    use std::mem::{size_of, size_of_val, zeroed};
    use std::os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle},
    };
    use std::ptr::{null, null_mut};
    use std::time::{Duration, Instant};
    use windows_sys::Win32::{
        Foundation::*,
        Security::{Authorization::*, Isolation::*, *},
        Storage::FileSystem::{
            GetFileAttributesW, FILE_ATTRIBUTE_REPARSE_POINT, INVALID_FILE_ATTRIBUTES,
        },
        System::{JobObjects::*, Pipes::*, Threading::*},
    };

    const PIPE_TIMEOUT: Duration = Duration::from_secs(5);
    const JOB_STOP_TIMEOUT_MS: u32 = 3000;
    const PROCESS_SYNCHRONIZE: u32 = 0x0010_0000;

    // The future that owns this fence may be dropped on native caller
    // cancellation. A still-running pipe reader, network fetch or writer can
    // then never deliver a stale successful reply to the old browser session.
    struct FlightFence {
        job: usize,
        committed: bool,
    }
    impl FlightFence {
        fn new(job: HANDLE) -> Self {
            Self {
                job: job as usize,
                committed: false,
            }
        }
    }
    impl Drop for FlightFence {
        fn drop(&mut self) {
            if !self.committed {
                unsafe {
                    TerminateJobObject(self.job as HANDLE, 1);
                }
            }
        }
    }

    fn win_err(step: &'static str) -> String {
        format!("{step}: Win32 {}", unsafe { GetLastError() })
    }
    fn wide(v: impl AsRef<OsStr>) -> Vec<u16> {
        v.as_ref().encode_wide().chain([0]).collect()
    }
    fn quote(input: &str) -> String {
        let mut result = String::from("\"");
        let mut slashes = 0;
        for ch in input.chars() {
            if ch == '\\' {
                slashes += 1;
                continue;
            }
            result.extend(std::iter::repeat_n(
                '\\',
                slashes * if ch == '"' { 2 } else { 1 },
            ));
            if ch == '"' {
                result.push('\\');
            }
            result.push(ch);
            slashes = 0;
        }
        result.extend(std::iter::repeat_n('\\', slashes * 2));
        result.push('"');
        result
    }
    struct OwnedHandle(HANDLE);
    impl OwnedHandle {
        fn checked(raw: HANDLE, step: &'static str) -> Result<Self, String> {
            if raw.is_null() || raw == INVALID_HANDLE_VALUE {
                Err(win_err(step))
            } else {
                Ok(Self(raw))
            }
        }
    }
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    struct OwnedSid(PSID);
    impl Drop for OwnedSid {
        fn drop(&mut self) {
            unsafe {
                FreeSid(self.0);
            }
        }
    }
    struct LocalMemory(*mut c_void);
    impl Drop for LocalMemory {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    LocalFree(self.0);
                }
            }
        }
    }
    struct Attributes {
        words: Vec<usize>,
        initialized: bool,
    }
    impl Attributes {
        fn new() -> Result<Self, String> {
            let mut bytes = 0;
            unsafe {
                InitializeProcThreadAttributeList(null_mut(), 3, 0, &mut bytes);
            }
            if bytes == 0 {
                return Err(win_err("browser-attributes-size"));
            }
            let mut result = Self {
                words: vec![0; bytes.div_ceil(size_of::<usize>())],
                initialized: false,
            };
            if unsafe { InitializeProcThreadAttributeList(result.ptr(), 3, 0, &mut bytes) } == 0 {
                return Err(win_err("browser-attributes-init"));
            }
            result.initialized = true;
            Ok(result)
        }
        fn ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
            self.words.as_mut_ptr().cast()
        }
        fn add<T>(&mut self, key: u32, value: &T) -> Result<(), String> {
            if unsafe {
                UpdateProcThreadAttribute(
                    self.ptr(),
                    0,
                    key as usize,
                    (value as *const T).cast(),
                    size_of::<T>(),
                    null_mut(),
                    null(),
                )
            } == 0
            {
                Err(win_err("browser-attributes-assign"))
            } else {
                Ok(())
            }
        }
    }
    impl Drop for Attributes {
        fn drop(&mut self) {
            if self.initialized {
                unsafe {
                    DeleteProcThreadAttributeList(self.ptr());
                }
            }
        }
    }
    struct AppProfile {
        name: Vec<u16>,
        sid: OwnedSid,
        deleted: bool,
    }
    impl AppProfile {
        fn create(name: &str) -> Result<Self, String> {
            let wide_name = wide(name);
            let mut sid = null_mut();
            let hr = unsafe {
                CreateAppContainerProfile(
                    wide_name.as_ptr(),
                    wide_name.as_ptr(),
                    wide_name.as_ptr(),
                    null(),
                    0,
                    &mut sid,
                )
            };
            if hr < 0 || sid.is_null() {
                return Err("browser-appcontainer-profile-denied".into());
            }
            Ok(Self {
                name: wide_name,
                sid: OwnedSid(sid),
                deleted: false,
            })
        }
        fn sid_text(&self) -> Result<String, String> {
            let mut raw = null_mut();
            if unsafe { ConvertSidToStringSidW(self.sid.0, &mut raw) } == 0 {
                return Err(win_err("browser-sid-string"));
            }
            let owned = LocalMemory(raw.cast());
            let mut end = 0;
            unsafe {
                while *raw.add(end) != 0 {
                    end += 1;
                }
            }
            let text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(raw, end) });
            drop(owned);
            Ok(text)
        }
        fn delete(&mut self) -> Result<(), String> {
            if self.deleted {
                return Ok(());
            }
            let hr = unsafe { DeleteAppContainerProfile(self.name.as_ptr()) };
            if hr < 0 {
                return Err("browser-appcontainer-cleanup-failed".into());
            }
            self.deleted = true;
            Ok(())
        }
    }

    // Failure at any launch phase must not strand a live browser or erase a
    // profile still in use. A failed proof leaves resources in place for
    // diagnosis rather than guessing that a PID has exited.
    struct LaunchRollback {
        root: PathBuf,
        profile: Option<AppProfile>,
        job: Option<OwnedHandle>,
        host: Option<OwnedHandle>,
        disarmed: bool,
    }
    impl LaunchRollback {
        fn new(root: PathBuf) -> Self {
            Self {
                root,
                profile: None,
                job: None,
                host: None,
                disarmed: false,
            }
        }
    }
    impl Drop for LaunchRollback {
        fn drop(&mut self) {
            if self.disarmed {
                return;
            }
            if let Some(job) = &self.job {
                if unsafe { TerminateJobObject(job.0, 1) } == 0 {
                    return;
                }
                if let Some(host) = &self.host {
                    if unsafe { WaitForSingleObject(host.0, JOB_STOP_TIMEOUT_MS) } != WAIT_OBJECT_0
                    {
                        return;
                    }
                }
                let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
                if unsafe {
                    QueryInformationJobObject(
                        job.0,
                        JobObjectBasicAccountingInformation,
                        (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                        size_of_val(&accounting) as u32,
                        null_mut(),
                    )
                } == 0
                    || accounting.ActiveProcesses != 0
                {
                    return;
                }
            }
            if ensure_plain_dir(&self.root).is_err() {
                return;
            }
            if self.root.join("udf").exists() && ensure_plain_dir(&self.root.join("udf")).is_err() {
                return;
            }
            if fs::remove_dir_all(&self.root).is_ok() {
                if let Some(profile) = &mut self.profile {
                    let _ = profile.delete();
                }
            }
        }
    }
    fn grant_udf(path: &Path, sid: &str) -> Result<(), String> {
        // Private owner + SYSTEM and only the session's AppContainer SID.
        let descriptor = wide(format!(
            "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;OW)(A;OICI;GRGWGXSD;;;{sid})S:(ML;OICI;NW;;;LW)"
        ));
        let mut raw = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                descriptor.as_ptr(),
                1,
                &mut raw,
                null_mut(),
            )
        } == 0
        {
            return Err(win_err("browser-udf-descriptor"));
        }
        let owned = LocalMemory(raw);
        if unsafe {
            SetFileSecurityW(
                wide(path).as_ptr(),
                DACL_SECURITY_INFORMATION
                    | PROTECTED_DACL_SECURITY_INFORMATION
                    | LABEL_SECURITY_INFORMATION,
                owned.0,
            )
        } == 0
        {
            return Err(win_err("browser-udf-acl"));
        }
        Ok(())
    }
    fn ensure_plain_dir(path: &Path) -> Result<(), String> {
        let metadata = fs::symlink_metadata(path).map_err(|_| "browser-udf-directory-missing")?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("browser-udf-path-unsafe".into());
        }
        let attrs = unsafe { GetFileAttributesW(wide(path).as_ptr()) };
        if attrs == INVALID_FILE_ATTRIBUTES || attrs & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("browser-udf-reparse-path-denied".into());
        }
        Ok(())
    }
    fn new_pipe(child_reads: bool) -> Result<(OwnedHandle, OwnedHandle), String> {
        let mut read = null_mut();
        let mut write = null_mut();
        let attr = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: 1,
        };
        if unsafe { CreatePipe(&mut read, &mut write, &attr, 4096) } == 0 {
            return Err(win_err("browser-pipe-create"));
        }
        let read = OwnedHandle::checked(read, "browser-pipe-read")?;
        let write = OwnedHandle::checked(write, "browser-pipe-write")?;
        // Parent-end must never be inherited into child/Chromium descendants.
        let parent = if child_reads { write.0 } else { read.0 };
        if unsafe { SetHandleInformation(parent, HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(win_err("browser-pipe-inheritance"));
        }
        Ok((read, write))
    }
    fn read_pipe_bounded(pipe: &mut File) -> Result<Vec<u8>, String> {
        let deadline = Instant::now() + PIPE_TIMEOUT;
        let mut header = [0u8; 4];
        read_exact_deadline(pipe, &mut header, deadline)?;
        let len = u32::from_le_bytes(header) as usize;
        if len == 0 || len > FRAME_MAX {
            return Err("browser-pipe-frame-bounds".into());
        }
        let mut body = vec![0; len];
        read_exact_deadline(pipe, &mut body, deadline)?;
        Ok(body)
    }

    // No clone/read worker and no FlightFence exists during an *empty* idle
    // wait. The caller arms the fence BEFORE consuming the first byte of a
    // begun frame. Cancellation of an idle wait is therefore harmless; a
    // cancelled partial frame or pending TF3 transaction still kills the Job.
    async fn wait_for_pipe_frame_start(pipe: &File, deadline: Instant) -> Result<bool, String> {
        loop {
            let mut available = 0u32;
            if unsafe {
                PeekNamedPipe(
                    pipe.as_raw_handle().cast(),
                    null_mut(),
                    0,
                    null_mut(),
                    &mut available,
                    null_mut(),
                )
            } == 0
            {
                return Err("browser-broker-idle-pipe-broken".into());
            }
            if available != 0 {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
    fn read_exact_deadline(
        pipe: &mut File,
        output: &mut [u8],
        deadline: Instant,
    ) -> Result<(), String> {
        let mut cursor = 0;
        while cursor < output.len() {
            if Instant::now() >= deadline {
                return Err("browser-broker-reply-timeout".into());
            }
            let mut available = 0;
            if unsafe {
                PeekNamedPipe(
                    pipe.as_raw_handle().cast(),
                    null_mut(),
                    0,
                    null_mut(),
                    &mut available,
                    null_mut(),
                )
            } == 0
            {
                return Err("browser-broker-pipe-closed".into());
            }
            if available == 0 {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
            let count = (available as usize).min(output.len() - cursor).min(4096);
            let read = pipe
                .read(&mut output[cursor..cursor + count])
                .map_err(|_| "browser-broker-pipe-read-failed")?;
            if read == 0 {
                return Err("browser-broker-pipe-eof".into());
            }
            cursor += read;
        }
        Ok(())
    }
    fn token_attest(process: HANDLE, expected_sid: PSID, job: HANDLE) -> Result<(), String> {
        let mut member = 0;
        if unsafe { IsProcessInJob(process, job, &mut member) } == 0 || member == 0 {
            return Err("browser-owned-job-mismatch".into());
        }
        if unsafe { WaitForSingleObject(process, 0) } != WAIT_TIMEOUT {
            return Err("browser-process-not-live".into());
        }
        let mut raw = null_mut();
        if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut raw) } == 0 {
            return Err(win_err("browser-process-token"));
        }
        let token = OwnedHandle::checked(raw, "browser-token-handle")?;
        let mut flag = 0u32;
        let mut returned = 0;
        if unsafe {
            GetTokenInformation(
                token.0,
                TokenIsAppContainer,
                (&mut flag as *mut u32).cast(),
                size_of::<u32>() as u32,
                &mut returned,
            )
        } == 0
            || flag != 1
        {
            return Err("browser-token-not-appcontainer".into());
        }
        let mut len = 0u32;
        unsafe {
            GetTokenInformation(token.0, TokenAppContainerSid, null_mut(), 0, &mut len);
        }
        if len < size_of::<TOKEN_APPCONTAINER_INFORMATION>() as u32 {
            return Err("browser-appcontainer-sid-absent".into());
        }
        let mut buffer = vec![0u64; (len as usize).div_ceil(8)];
        if unsafe {
            GetTokenInformation(
                token.0,
                TokenAppContainerSid,
                buffer.as_mut_ptr().cast(),
                len,
                &mut len,
            )
        } == 0
        {
            return Err("browser-appcontainer-sid-unavailable".into());
        }
        let sid = unsafe {
            (*(buffer.as_ptr().cast::<TOKEN_APPCONTAINER_INFORMATION>())).TokenAppContainer
        };
        if sid.is_null() || unsafe { EqualSid(sid, expected_sid) } == 0 {
            return Err("browser-appcontainer-sid-mismatch".into());
        }
        let mut caps_len = 0;
        unsafe {
            GetTokenInformation(token.0, TokenCapabilities, null_mut(), 0, &mut caps_len);
        }
        if caps_len != 0 {
            let mut caps = vec![0u64; (caps_len as usize).div_ceil(8)];
            if unsafe {
                GetTokenInformation(
                    token.0,
                    TokenCapabilities,
                    caps.as_mut_ptr().cast(),
                    caps_len,
                    &mut caps_len,
                )
            } == 0
                || unsafe { (*caps.as_ptr().cast::<TOKEN_GROUPS>()).GroupCount } != 0
            {
                return Err("browser-token-capability-denied".into());
            }
        }
        Ok(())
    }
    fn verify_child(pid: u32, profile: &AppProfile, job: HANDLE) -> Result<OwnedHandle, String> {
        if pid == 0 {
            return Err("browser-child-pid-invalid".into());
        }
        let raw = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                pid,
            )
        };
        let process = OwnedHandle::checked(raw, "browser-child-handle")?;
        token_attest(process.0, profile.sid.0, job)?;
        let mut image = vec![0u16; 32768];
        let mut len = image.len() as u32;
        if unsafe { QueryFullProcessImageNameW(process.0, 0, image.as_mut_ptr(), &mut len) } == 0 {
            return Err("browser-child-image-unavailable".into());
        }
        let path = String::from_utf16_lossy(&image[..len as usize]);
        if !Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("msedgewebview2.exe"))
        {
            return Err("browser-child-image-unexpected".into());
        }
        Ok(process)
    }

    pub(crate) struct BrowserRuntimeSession {
        pub nonce: String,
        pub workspace_root: PathBuf,
        pub actor: String,
        pub session_id: String,
        pub initial_url: String,
        pub private_root: PathBuf,
        pub effective_udf: PathBuf,
        pub host_pid: u32,
        host: OwnedHandle,
        job: OwnedHandle,
        profile: AppProfile,
        browser: Option<OwnedHandle>,
        renderer: Option<OwnedHandle>,
        requests: File,
        responses: File,
        last_request_id: u64,
        last_page_generation: u64,
        last_observation_id: u64,
        /// Monotonic authenticated native control sequence shared by future
        /// production actions and test-only exact-node rechecks.
        last_recheck_sequence: u64,
        /// Native index order captured from the very same successful COM
        /// structure observation that generated the held opaque handles.
        /// Bookkeeping is production-owned; it does NOT confer approval.
        last_recheck_observation: Option<(u64, u64, Vec<u32>)>,
        // Negotiated in the *attested* readiness ACK, never from a model,
        // mutable environment variable, or a later unauthenticated frame.
        control_turns_enabled: bool,
        last_control_turn_id: u64,
        pending_control_turn: Option<u64>,
        control_turn_claimed: bool,
        control_turn_requested: Arc<AtomicBool>,
        page_contract: BrowserPageContract,
        ready: bool,
        // Futures may be cancelled while a blocking pipe reader is still
        // executing. An interrupted readiness/request can never be retried on
        // this session: its frame and external-effect state is uncertain.
        poisoned: bool,
        job_drained: bool,
        stopped: bool,
    }

    // OS process/job/pipe handles and the owned AppContainer SID are valid
    // across Windows threads. Every operation needs &mut self; no WebView2
    // COM interface or UI-apartment object is stored in this owner.
    // A production registry may therefore hold it behind a native Mutex.
    unsafe impl Send for BrowserRuntimeSession {}

    impl BrowserRuntimeSession {
        pub(crate) fn launch(
            start: BrowserRuntimeStart,
            registry: &WorkspaceRegistry,
        ) -> Result<Self, String> {
            if !start.workspace_root.is_dir() || !start.private_parent.is_dir() {
                return Err("browser-owner-root-unavailable".into());
            }
            let workspace = fs::canonicalize(&start.workspace_root)
                .map_err(|_| "browser-owner-workspace-unavailable")?;
            if !registry.is_authorized(&workspace) {
                return Err("browser-owner-workspace-denied".into());
            }
            if start.actor.is_empty()
                || start.session_id.is_empty()
                || start.actor.len() > 128
                || start.session_id.len() > 128
                || !start
                    .actor
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
                || !start
                    .session_id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
            {
                return Err("browser-owner-actor-session-invalid".into());
            }
            let initial = reqwest::Url::parse(&start.initial_url)
                .map_err(|_| "browser-initial-url-invalid")?;
            if initial.scheme() != "https" || initial.host_str().is_none()
                || !initial.username().is_empty() || initial.password().is_some()
                || initial.port().is_some_and(|p| p != 443)
                // A command-line URL is visible to local process inspection.
                // Sensitive query strings must never reach the host argv.
                || initial.query().is_some() || initial.fragment().is_some()
            {
                return Err("browser-initial-url-https-required".into());
            }
            // No environment-supplied WebView2 UDF, executable or browser args.
            for override_name in [
                "WEBVIEW2_USER_DATA_FOLDER",
                "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE",
            ] {
                if std::env::var_os(override_name).is_some() {
                    return Err("browser-webview2-environment-override-denied".into());
                }
            }
            let host_exe = validate_host_binary(&start.host_executable, &start.host_sha256)?;
            let nonce = random_nonce()?;
            let private_parent = fs::canonicalize(&start.private_parent)
                .map_err(|_| "browser-owner-private-parent-unavailable")?;
            ensure_plain_dir(&private_parent)?;
            let private_root = private_parent.join(format!("tf4-{nonce}"));
            fs::create_dir(&private_root)
                .map_err(|_| "browser-owner-private-session-create-denied")?;
            ensure_plain_dir(&private_root)?;
            let mut rollback = LaunchRollback::new(private_root.clone());
            let udf = private_root.join("udf");
            let profile_name = format!("ClackTf4{nonce}");
            rollback.profile = Some(AppProfile::create(&profile_name)?);
            let profile = rollback.profile.as_ref().expect("created profile");
            let sid = profile.sid_text()?;
            grant_udf(&private_root, &sid)?;
            fs::create_dir(&udf).map_err(|_| "browser-udf-create-denied")?;
            ensure_plain_dir(&udf)?;
            grant_udf(&udf, &sid)?;

            let (child_response_read, parent_response_write) = new_pipe(true)?;
            let (parent_request_read, child_request_write) = new_pipe(false)?;
            // Explicit inherited stdio points to the same sealed child channels.
            rollback.job = Some(OwnedHandle::checked(
                unsafe { CreateJobObjectW(null(), null()) },
                "browser-job-create",
            )?);
            let job = rollback.job.as_ref().expect("created job");
            let mut limit: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
            limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&limit as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of_val(&limit) as u32,
                )
            } == 0
            {
                return Err(win_err("browser-job-kill-on-close"));
            }

            let mut attrs = Attributes::new()?;
            let jobs = [job.0];
            attrs.add(PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs)?;
            let inherited = [child_response_read.0, child_request_write.0];
            attrs.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &inherited)?;
            let security = SECURITY_CAPABILITIES {
                AppContainerSid: profile.sid.0,
                Capabilities: null_mut(),
                CapabilityCount: 0,
                Reserved: 0,
            };
            attrs.add(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, &security)?;
            let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.lpAttributeList = attrs.ptr();
            let env_root =
                std::env::var("SystemRoot").map_err(|_| "browser-system-root-missing")?;
            let folder = private_root.to_string_lossy();
            let env_block = wide(format!(
                "CLACK_TF_BROWSER_BROKER_READ_HANDLE={}\0CLACK_TF_BROWSER_BROKER_WRITE_HANDLE={}\0LOCALAPPDATA={folder}\0SystemRoot={env_root}\0TEMP={folder}\0TMP={folder}\0",
                child_response_read.0 as usize, child_request_write.0 as usize
            ));
            let exe_path = host_exe.to_string_lossy();
            let mut argv = wide(format!(
                "{} --production-broker {} --broker-session {nonce} --initial-url {}",
                quote(&exe_path),
                quote(&folder),
                quote(&start.initial_url)
            ));
            let mut info: PROCESS_INFORMATION = unsafe { zeroed() };
            if unsafe {
                CreateProcessW(
                    wide(&host_exe).as_ptr(),
                    argv.as_mut_ptr(),
                    null(),
                    null(),
                    1,
                    EXTENDED_STARTUPINFO_PRESENT
                        | CREATE_UNICODE_ENVIRONMENT
                        | CREATE_SUSPENDED
                        | CREATE_NO_WINDOW,
                    env_block.as_ptr().cast(),
                    wide(&private_root).as_ptr(),
                    &startup.StartupInfo,
                    &mut info,
                )
            } == 0
            {
                return Err(win_err("browser-restricted-host-spawn"));
            }
            rollback.host = Some(OwnedHandle::checked(info.hProcess, "browser-host-handle")?);
            let host = rollback.host.as_ref().expect("created host");
            let thread = OwnedHandle::checked(info.hThread, "browser-host-thread")?;
            // Before first instruction, verify the original retained process
            // object, the exact owned job and the zero-capability container.
            if let Err(reason) = token_attest(host.0, profile.sid.0, job.0) {
                unsafe {
                    TerminateProcess(host.0, 1);
                }
                return Err(reason);
            }
            if unsafe { ResumeThread(thread.0) } == u32::MAX {
                unsafe {
                    TerminateProcess(host.0, 1);
                }
                return Err(win_err("browser-host-resume"));
            }
            drop(thread);
            drop(child_response_read);
            drop(child_request_write);
            let requests = unsafe { File::from_raw_handle(parent_request_read.0.cast()) };
            let responses = unsafe { File::from_raw_handle(parent_response_write.0.cast()) };
            std::mem::forget(parent_request_read);
            std::mem::forget(parent_response_write);
            let host = rollback.host.take().expect("retained host");
            let job = rollback.job.take().expect("retained job");
            let profile = rollback.profile.take().expect("retained profile");
            let page_contract = BrowserPageContract::new(nonce.clone(), initial.as_str())
                .map_err(|_| "browser-initial-page-contract-invalid")?;
            rollback.disarmed = true;
            Ok(Self {
                nonce,
                workspace_root: workspace,
                actor: start.actor,
                session_id: start.session_id,
                initial_url: initial.to_string(),
                private_root,
                effective_udf: udf,
                host_pid: info.dwProcessId,
                host,
                job,
                profile,
                browser: None,
                renderer: None,
                requests,
                responses,
                last_request_id: 0,
                last_page_generation: 0,
                last_observation_id: 0,
                last_recheck_sequence: 0,
                last_recheck_observation: None,
                control_turns_enabled: false,
                last_control_turn_id: 0,
                pending_control_turn: None,
                control_turn_claimed: false,
                control_turn_requested: Arc::new(AtomicBool::new(false)),
                page_contract,
                ready: false,
                poisoned: false,
                job_drained: false,
                stopped: false,
            })
        }

        pub(crate) async fn verify_ready(&mut self) -> Result<(), String> {
            self.verify_ready_inner(false).await
        }

        /// Explicit trusted-owner opt-in for *serialized transport only*.
        /// The ordinary production caller and existing physical fixtures use
        /// `verify_ready()` and retain their current direct v2 behavior.
        /// This neither authorizes an action nor enables model capabilities.
        #[allow(dead_code)] // parked until the existing native owner opts in
        pub(crate) async fn verify_ready_for_control_turns(&mut self) -> Result<(), String> {
            self.verify_ready_inner(true).await
        }

        async fn verify_ready_inner(&mut self, control_turns: bool) -> Result<(), String> {
            if self.ready || self.stopped || self.poisoned {
                return Err("browser-readiness-replayed".into());
            }
            self.poisoned = true;
            self.control_turns_enabled = control_turns;
            let mut flight = FlightFence::new(self.job.0);
            // Keep potentially stalled anonymous pipe reads off the Tauri
            // runtime thread; timeout remains bounded even for a dead host.
            let mut reader = self
                .requests
                .try_clone()
                .map_err(|_| "browser-pipe-clone-denied")?;
            let bytes = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                .await
                .map_err(|_| "browser-pipe-worker-failed")??;
            let ready: ChildReady =
                serde_json::from_slice(&bytes).map_err(|_| "browser-readiness-invalid-frame")?;
            if ready.version != 1
                || ready.kind != "ready"
                || ready.session != self.nonce
                || self.nonce.len() != SESSION_NONCE_BYTES * 2
                || ready.request_id != 0
                || ready.host_pid != self.host_pid
                || ready.browser_pid == ready.renderer_pid
                || ready.browser_pid == self.host_pid
                || ready.renderer_pid == self.host_pid
            {
                return Err("browser-readiness-identity-mismatch".into());
            }
            let effective = fs::canonicalize(&ready.effective_udf)
                .map_err(|_| "browser-effective-udf-unavailable")?;
            let owned = fs::canonicalize(&self.effective_udf)
                .map_err(|_| "browser-owned-udf-unavailable")?;
            if effective != owned {
                return Err("browser-effective-udf-mismatch".into());
            }
            ensure_plain_dir(&self.private_root)?;
            ensure_plain_dir(&self.effective_udf)?;
            token_attest(self.host.0, self.profile.sid.0, self.job.0)?;
            let browser = verify_child(ready.browser_pid, &self.profile, self.job.0)?;
            let renderer = verify_child(ready.renderer_pid, &self.profile, self.job.0)?;
            self.browser = Some(browser);
            self.renderer = Some(renderer);
            self.send_reply(0, 204, "text/plain", &[], None).await?;
            self.ready = true;
            self.poisoned = false;
            flight.committed = true;
            Ok(())
        }

        async fn send_reply(
            &mut self,
            id: u64,
            status: u16,
            mime: &str,
            data: &[u8],
            error: Option<&str>,
        ) -> Result<(), String> {
            if data.len() > RESOURCE_MAX {
                return Err("browser-reply-size-denied".into());
            }
            let response = ParentReply {
                version: 1,
                session: &self.nonce,
                request_id: id,
                status,
                content_type: mime,
                body_base64: encode_base64(data),
                error,
                control_turns: (id == 0 && self.control_turns_enabled).then_some(true),
            };
            let frame = serde_json::to_vec(&response).map_err(|_| "browser-reply-serialization")?;
            self.write_parent_frame(frame).await
        }

        async fn write_parent_frame(&mut self, frame: Vec<u8>) -> Result<(), String> {
            if frame.is_empty() || frame.len() > FRAME_MAX {
                return Err("browser-reply-frame-bounds".into());
            }
            let mut writer = self
                .responses
                .try_clone()
                .map_err(|_| "browser-reply-pipe-clone")?;
            let sent = tokio::task::spawn_blocking(move || {
                writer
                    .write_all(&(frame.len() as u32).to_le_bytes())
                    .and_then(|_| writer.write_all(&frame))
                    .and_then(|_| writer.flush())
                    .map_err(|_| "browser-reply-pipe-broken".to_owned())
            });
            match tokio::time::timeout(PIPE_TIMEOUT, sent).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err("browser-reply-writer-failed".into()),
                Err(_) => Err("browser-reply-write-timeout".into()),
            }
        }

        async fn verify_com_completion(
            &mut self,
            request_id: u64,
            page_generation: u64,
            installed_status: u16,
        ) -> Result<(), String> {
            let mut reader = self
                .requests
                .try_clone()
                .map_err(|_| "browser-com-ack-pipe-clone-denied")?;
            let frame = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                .await
                .map_err(|_| "browser-com-ack-worker-failed")??;
            let ack: ChildComAck =
                serde_json::from_slice(&frame).map_err(|_| "browser-com-ack-invalid-frame")?;
            validate_com_ack(
                &ack,
                &self.nonce,
                request_id,
                page_generation,
                installed_status,
            )?;
            Ok(())
        }

        async fn send_and_verify(
            &mut self,
            request_id: u64,
            page_generation: u64,
            status: u16,
            mime: &str,
            data: &[u8],
            error: Option<&str>,
        ) -> Result<(), String> {
            self.send_reply(request_id, status, mime, data, error)
                .await?;
            // No success receipt until the child completes exactly this native
            // COM deferral; missing, stale, duplicate or unexpected ACK poisons
            // the session and its Job is terminated by the flight fence.
            self.verify_com_completion(request_id, page_generation, status)
                .await
        }

        /// Security-limited, *internal only* native structural observation.
        /// This cannot issue an action or produce a model-facing semantic
        /// snapshot. All page-derived names, text, destinations and values are
        /// intentionally absent until adequate production secret protection
        /// and exact live DOM element binding can be demonstrated.
        pub(crate) async fn observe_structure(&mut self) -> Result<NativeDomStructure, String> {
            if self.control_turns_enabled && !self.control_turn_claimed {
                return Err("browser-control-turn-required".into());
            }
            // A new native observation attempt invalidates every previous
            // snapshot even if COM fails, renderer crashes, or the page
            // changes midway through the request.
            self.page_contract.revoke_snapshot();
            self.last_recheck_observation = None;
            if !self.ready
                || self.stopped
                || self.poisoned
                || self.last_request_id == 0
                || self.last_page_generation == 0
            {
                return Err("browser-structure-session-not-ready".into());
            }
            self.poisoned = true;
            let mut flight = FlightFence::new(self.job.0);
            let observation_id = self
                .last_observation_id
                .checked_add(1)
                .ok_or("browser-structure-observation-exhausted")?;
            self.last_observation_id = observation_id;
            let generation = self.last_page_generation;
            let source = format!("{:x}", Sha256::digest(self.initial_url.as_bytes()));
            let observed = self
                .observe_structure_inner(observation_id, generation, &source)
                .await;
            if observed.is_ok() {
                self.poisoned = false;
                flight.committed = true;
            }
            observed
        }

        /// First production snapshot backed by real COM observation and the
        /// existing random opaque element-reference state machine. It carries
        /// only closed roles/control-state booleans, with empty names/text and
        /// no selector or href authority. Deliberately internal: live actions
        /// are NOT enabled until the separate effect/approval path is proven.
        pub(crate) async fn observe_closed_snapshot(&mut self) -> Result<PageSnapshot, String> {
            let native = self.observe_structure().await?;
            if native.terminal != "completed" || native.page_generation != self.last_page_generation
            {
                return Err("STALE".into());
            }
            // Source and page identity were already checked by the authenticated
            // native owner. New page generations must be invalidated by a
            // trusted navigation contract before any further refs are granted.
            if self.page_contract.identity().page_generation != native.page_generation {
                return Err("STALE".into());
            }
            let elements = structural_observed_elements(&native).map_err(str::to_owned)?;
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "browser-native-clock-unavailable")?
                .as_millis()
                .min(u128::from(u64::MAX)) as u64;
            self.page_contract
                .observe(
                    native.page_generation,
                    &self.initial_url,
                    "",
                    "",
                    elements,
                    timestamp,
                )
                .map_err(str::to_owned)?;
            // The omitted-field/truncation state is held authoritatively by
            // the same page contract as its opaque reference mapping.
            let snapshot = self
                .page_contract
                .mark_snapshot_truncated(native.truncated)
                .map_err(str::to_owned)?
                .clone();
            self.last_recheck_observation = Some((
                native.observation_id,
                native.page_generation,
                native
                    .elements
                    .iter()
                    .map(|element| element.index)
                    .collect(),
            ));
            Ok(snapshot)
        }

        /// Transport-only, owner-callable native snapshot. The caller must
        /// own `&mut BrowserRuntimeSession` and a host-issued control turn;
        /// one claimed turn carries exactly one v2 DOM frame. No second pipe
        /// reader, alternate permission path or model tool is introduced.
        #[allow(dead_code)] // parked; existing production/fixture callers unchanged
        pub(crate) async fn observe_closed_snapshot_in_control_turn(
            &mut self,
        ) -> Result<PageSnapshot, String> {
            if !self.has_control_turn() || !self.ready || self.poisoned || self.stopped {
                return Err("browser-exclusive-control-turn-required".into());
            }
            self.poisoned = true;
            let mut flight = FlightFence::new(self.job.0);
            self.answer_control_turn("control-turn-claim").await?;
            self.poisoned = false;
            self.control_turn_claimed = true;
            let result = self.observe_closed_snapshot().await;
            self.control_turn_claimed = false;
            if result.is_ok() {
                self.poisoned = false;
                flight.committed = true;
            } else {
                self.poisoned = true;
            }
            result
        }

        /// Read-only pre-consumption scope for the existing central native
        /// approval owner. It performs the same live opaque-node eligibility
        /// and native source/index/ordinal checks as dispatch, without using
        /// a control turn or creating consent. The caller must then atomically
        /// consume its separately approved once token, construct a witness,
        /// and hand the witness back to dispatch, which rechecks everything.
        /// No command, model capability or network effect is exposed here.
        #[allow(dead_code)] // native approval owner integration is separate
        pub(crate) fn exact_click_scope_for_central<'a>(
            &'a self,
            target: &'a crate::modules::net::tf_browser_contract::ActionTarget,
        ) -> Result<super::NativeExactClickApprovalScope<'a>, String> {
            use crate::modules::net::tf_browser_contract::BrowserActionKind;
            if !self.has_control_turn()
                || !self.ready
                || self.poisoned
                || self.stopped
                || self.last_request_id == 0
            {
                return Err("native-click-exclusive-control-turn-required".into());
            }
            let prepared = self
                .page_contract
                .prepare_action(BrowserActionKind::Click, (*target).clone(), None)
                .map_err(str::to_owned)?;
            if !prepared.requires_approval {
                return Err("native-click-central-approval-required".into());
            }
            let (observation_id, generation, indices) = self
                .last_recheck_observation
                .as_ref()
                .ok_or("native-click-observation-missing")?;
            if *observation_id != self.last_observation_id
                || *generation != self.last_page_generation
            {
                return Err("native-click-observation-stale".into());
            }
            let index = u32::try_from(prepared.observed_serial)
                .map_err(|_| "native-click-index-overflow")?;
            let ordinal = indices
                .iter()
                .position(|observed| *observed == index)
                .ok_or("native-click-element-not-found")?;
            if index == 0 || index > 256 || ordinal >= 48 {
                return Err("native-click-index-bounds".into());
            }
            let sequence = self
                .last_recheck_sequence
                .checked_add(1)
                .filter(|value| *value <= 256)
                .ok_or("native-click-sequence-exhausted")?;
            token_attest(self.host.0, self.profile.sid.0, self.job.0)?;
            if self
                .browser
                .as_ref()
                .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
                || self
                    .renderer
                    .as_ref()
                    .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
            {
                return Err("native-click-process-unattested".into());
            }
            Ok(super::NativeExactClickApprovalScope {
                actor: &self.actor,
                session_id: &self.session_id,
                workspace_root: &self.workspace_root,
                target,
                effect: prepared.effect,
                source_id: format!("{:x}", Sha256::digest(self.initial_url.as_bytes())),
                observation_id: *observation_id,
                index,
                ordinal: ordinal as u32,
                check_sequence: sequence,
            })
        }

        /// ONE actual WebView2 exact-node click using the already-existing
        /// host COM path. A consumed central consent witness MUST have been
        /// issued by the existing native authority after rechecking actor/chat,
        /// canonical workspace, effect, page/source/snapshot/opaque node and
        /// expiry. The witness cannot be constructed through this public API;
        /// there is no issuer here or production caller yet. This function
        /// NEVER mints an ID, asks for consent, or exposes an IPC/model tool.
        /// The child-issued control turn is scheduling only, not approval.
        /// On any ambiguous post-approval transport/COM outcome return UNKNOWN
        /// with NEVER_REPLAY and terminate the owned Job via FlightFence.
        #[allow(dead_code)] // no central witness issuer is connected yet
        pub(crate) async fn dispatch_exact_click_in_control_turn(
            &mut self,
            approval: super::NativeConsumedExactClickApproval,
        ) -> Result<crate::modules::net::tf_browser_contract::NativeEffectReceipt, String> {
            use crate::modules::net::tf_browser_contract::{
                NativeEffectReceipt, NativeEffectTerminal,
            };
            let target = approval.target.clone();
            let scope = self.exact_click_scope_for_central(&target)?;
            // No arbitrary 48-hex string, boolean, or model argument can
            // substitute for the consumed exact central approval witness.
            if !approval.matches_exact(&scope) {
                return Err("native-click-central-approval-scope-stale".into());
            }
            let observation_id = scope.observation_id;
            let generation = scope.target.page_generation;
            let index = scope.index;
            let ordinal = scope.ordinal;
            let sequence = scope.check_sequence;
            let source = scope.source_id.clone();
            let approval_id = approval.approval_id;
            if approval_id.len() != 48
                || !approval_id
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            {
                return Err("native-click-central-approval-id-invalid".into());
            }
            let nonce = self.nonce.clone();
            let request = ParentElementAction {
                version: 2,
                kind: "act-element",
                session: &nonce,
                check_sequence: sequence,
                observation_id,
                page_generation: generation,
                source_id: &source,
                index,
                ordinal,
                action: "click",
                approval_id: &approval_id,
            };
            let frame = serde_json::to_vec(&request).map_err(|_| "native-click-request-invalid")?;
            if frame.is_empty() || frame.len() > 1024 {
                return Err("native-click-request-bounds".into());
            }
            // Burn the native sequence AND every page reference before any
            // pipe/COM I/O. Post-dispatch errors are UNKNOWN, never replayed.
            self.last_recheck_sequence = sequence;
            self.page_contract.revoke_snapshot();
            self.last_recheck_observation = None;
            self.poisoned = true;
            let mut flight = FlightFence::new(self.job.0);
            let result = async {
                self.answer_control_turn("control-turn-claim").await?;
                self.write_parent_frame(frame).await?;
                let mut reader = self
                    .requests
                    .try_clone()
                    .map_err(|_| "native-click-pipe-clone-failed")?;
                let bytes = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                    .await
                    .map_err(|_| "native-click-read-worker-failed")??;
                validate_element_action_reply(&bytes, &request).map_err(str::to_owned)
            }
            .await;
            match result {
                Ok(terminal) if terminal != NativeEffectTerminal::Unknown => {
                    self.poisoned = false;
                    flight.committed = true;
                    Ok(NativeEffectReceipt::classify(terminal))
                }
                _ => Ok(NativeEffectReceipt::classify(NativeEffectTerminal::Unknown)),
            }
        }

        #[cfg(test)]
        pub(crate) fn verify_closed_reference_without_execution_for_test(
            &self,
            target: crate::modules::net::tf_browser_contract::ActionTarget,
        ) -> Result<(), String> {
            if self.stopped || self.poisoned || !self.ready {
                return Err("STALE".into());
            }
            self.page_contract
                .prepare_action(
                    crate::modules::net::tf_browser_contract::BrowserActionKind::Inspect,
                    target,
                    None,
                )
                .map(|_| ())
                .map_err(str::to_owned)
        }

        /// Explicit test-only *read-only* native exact-element identity check.
        /// This does not click, focus, type, execute arbitrary script, provide
        /// action approval, or enable an IPC. The only ordinal sent to the
        /// child comes from the order of our authenticated COM observation;
        /// the index is the contract's held PreparedAction.observed_serial.
        #[cfg(test)]
        pub(crate) async fn recheck_closed_reference_for_test(
            &mut self,
            target: crate::modules::net::tf_browser_contract::ActionTarget,
        ) -> Result<bool, String> {
            self.recheck_closed_reference_mode_for_test(target, false)
                .await
        }

        /// Strict debug-host, owned 127.0.0.1 fixture only. Physically mutates
        /// one retained H1 using a fixed host-authored COM function, never an
        /// arbitrary script or model action. The NEXT ordinary exact recheck
        /// must independently report STALE for the detached original node.
        #[cfg(all(test, debug_assertions))]
        pub(crate) async fn replace_owned_heading_for_test(
            &mut self,
            target: crate::modules::net::tf_browser_contract::ActionTarget,
        ) -> Result<(), String> {
            if self.initial_url != "https://127.0.0.1/" {
                return Err("debug-dom-replacement-owned-origin-required".into());
            }
            if self
                .recheck_closed_reference_mode_for_test(target, true)
                .await?
            {
                Ok(())
            } else {
                Err("debug-dom-replacement-not-observed".into())
            }
        }

        #[cfg(test)]
        async fn recheck_closed_reference_mode_for_test(
            &mut self,
            target: crate::modules::net::tf_browser_contract::ActionTarget,
            debug_replace_heading: bool,
        ) -> Result<bool, String> {
            use crate::modules::net::tf_browser_contract::BrowserActionKind;
            if !self.ready || self.stopped || self.poisoned || self.last_request_id == 0 {
                return Err("browser-recheck-session-unavailable".into());
            }
            let prepared = self
                .page_contract
                .prepare_action(BrowserActionKind::Inspect, target, None)
                .map_err(str::to_owned)?;
            let (observation_id, generation, indexes) = self
                .last_recheck_observation
                .clone()
                .ok_or("browser-recheck-native-observation-missing")?;
            if observation_id != self.last_observation_id
                || generation != self.last_page_generation
                || indexes.is_empty()
                || indexes.len() > 48
            {
                return Err("browser-recheck-native-observation-stale".into());
            }
            let index = u32::try_from(prepared.observed_serial)
                .map_err(|_| "browser-recheck-native-index-bounds")?;
            let ordinal = indexes
                .iter()
                .position(|observed| *observed == index)
                .ok_or("browser-recheck-native-element-not-found")?;
            if index == 0 || index > 256 || ordinal >= 48 {
                return Err("browser-recheck-native-index-bounds".into());
            }
            let sequence = self
                .last_recheck_sequence
                .checked_add(1)
                .filter(|value| *value <= 256)
                .ok_or("browser-recheck-budget-exhausted")?;
            // Consume sequence before dispatch. If the pipe/COM operation
            // fails, the session is poisoned and original Job terminated.
            self.last_recheck_sequence = sequence;
            self.poisoned = true;
            let mut flight = FlightFence::new(self.job.0);
            token_attest(self.host.0, self.profile.sid.0, self.job.0)?;
            if self
                .browser
                .as_ref()
                .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
                || self
                    .renderer
                    .as_ref()
                    .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
            {
                return Err("browser-recheck-process-unattested".into());
            }
            let source = format!("{:x}", Sha256::digest(self.initial_url.as_bytes()));
            let session = self.nonce.clone();
            let request = ParentElementRecheck {
                version: 2,
                kind: "recheck-element",
                session: &session,
                check_sequence: sequence,
                observation_id,
                page_generation: generation,
                source_id: &source,
                index,
                ordinal: ordinal as u32,
                debug_replace_heading: debug_replace_heading.then_some(true),
            };
            let frame =
                serde_json::to_vec(&request).map_err(|_| "browser-recheck-serialization-failed")?;
            if frame.is_empty() || frame.len() > 1024 {
                return Err("browser-recheck-frame-bounds".into());
            }
            self.write_parent_frame(frame).await?;
            let mut reader = self
                .requests
                .try_clone()
                .map_err(|_| "browser-recheck-pipe-clone-failed")?;
            let bytes = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                .await
                .map_err(|_| "browser-recheck-read-worker-failed")??;
            let accepted =
                validate_element_recheck_reply(&bytes, &request).map_err(str::to_owned)?;
            self.page_contract
                .verify_completion(&prepared)
                .map_err(str::to_owned)?;
            if !accepted {
                // Native element changed: revoke the stale snapshot/handles
                // even though the same document generation might be live.
                self.page_contract.revoke_snapshot();
                self.last_recheck_observation = None;
            }
            self.poisoned = false;
            flight.committed = true;
            Ok(accepted)
        }

        /// Deliberate owned-fixture-only physical action probe. The host
        /// implementation is compiled into release, but this parent sender
        /// is NOT a production authorization path, command or model tool.
        /// Central UI approval integration must replace this test-only grant.
        #[cfg(test)]
        pub(crate) async fn exact_click_owned_fixture_for_test(
            &mut self,
            target: crate::modules::net::tf_browser_contract::ActionTarget,
        ) -> Result<crate::modules::net::tf_browser_contract::NativeEffectReceipt, String> {
            use crate::modules::net::tf_browser_contract::{
                BrowserActionKind, NativeEffectReceipt, NativeEffectTerminal,
            };
            if std::env::var("CLACK_TF4_OWNED_NATIVE_CLICK").as_deref() != Ok("1")
                || self.initial_url != "https://127.0.0.1/"
            {
                return Err("native-click-not-an-owned-physical-test".into());
            }
            if !self.ready || self.stopped || self.poisoned || self.last_request_id == 0 {
                return Err("native-click-session-not-ready".into());
            }
            let prepared = self
                .page_contract
                .prepare_action(BrowserActionKind::Click, target, None)
                .map_err(str::to_owned)?;
            if !prepared.requires_approval {
                return Err("native-click-effect-must-require-approval".into());
            }
            let (observation_id, generation, indices) = self
                .last_recheck_observation
                .clone()
                .ok_or("native-click-observation-missing")?;
            if observation_id != self.last_observation_id || generation != self.last_page_generation
            {
                return Err("native-click-observation-stale".into());
            }
            let index = u32::try_from(prepared.observed_serial)
                .map_err(|_| "native-click-index-overflow")?;
            let ordinal = indices
                .iter()
                .position(|observed| *observed == index)
                .ok_or("native-click-element-not-found")?;
            if index == 0 || index > 256 || ordinal >= 48 {
                return Err("native-click-index-bounds".into());
            }
            let sequence = self
                .last_recheck_sequence
                .checked_add(1)
                .filter(|value| *value <= 256)
                .ok_or("native-click-sequence-exhausted")?;
            // Burn authority BEFORE touching COM. No retry of an unknown
            // action even if its reply is lost while navigating.
            self.last_recheck_sequence = sequence;
            self.poisoned = true;
            let mut flight = FlightFence::new(self.job.0);
            token_attest(self.host.0, self.profile.sid.0, self.job.0)?;
            if self
                .browser
                .as_ref()
                .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
                || self
                    .renderer
                    .as_ref()
                    .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
            {
                return Err("native-click-process-unattested".into());
            }
            let source = format!("{:x}", Sha256::digest(self.initial_url.as_bytes()));
            let nonce = self.nonce.clone();
            let approval_id = random_nonce()?;
            let request = ParentElementAction {
                version: 2,
                kind: "act-element",
                session: &nonce,
                check_sequence: sequence,
                observation_id,
                page_generation: generation,
                source_id: &source,
                index,
                ordinal: ordinal as u32,
                action: "click",
                approval_id: &approval_id,
            };
            let frame = serde_json::to_vec(&request).map_err(|_| "native-click-request-invalid")?;
            if frame.is_empty() || frame.len() > 1024 {
                return Err("native-click-request-bounds".into());
            }
            self.write_parent_frame(frame).await?;
            let mut reader = self
                .requests
                .try_clone()
                .map_err(|_| "native-click-pipe-clone-failed")?;
            let bytes = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                .await
                .map_err(|_| "native-click-read-worker-failed")??;
            let terminal =
                validate_element_action_reply(&bytes, &request).map_err(str::to_owned)?;
            self.page_contract.revoke_snapshot();
            self.last_recheck_observation = None;
            if terminal != NativeEffectTerminal::Unknown {
                self.poisoned = false;
                flight.committed = true;
            }
            Ok(NativeEffectReceipt::classify(terminal))
        }

        async fn observe_structure_inner(
            &mut self,
            observation_id: u64,
            generation: u64,
            source: &str,
        ) -> Result<NativeDomStructure, String> {
            token_attest(self.host.0, self.profile.sid.0, self.job.0)?;
            if self
                .browser
                .as_ref()
                .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
                || self
                    .renderer
                    .as_ref()
                    .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
            {
                return Err("browser-structure-child-unattested".into());
            }
            let frame = serde_json::to_vec(&ParentObserve {
                version: 2,
                kind: "observe-dom",
                session: &self.nonce,
                observation_id,
                page_generation: generation,
                source_id: source,
            })
            .map_err(|_| "browser-structure-control-serialization")?;
            self.write_parent_frame(frame).await?;
            let mut reader = self
                .requests
                .try_clone()
                .map_err(|_| "browser-structure-result-pipe-clone-denied")?;
            let bytes = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                .await
                .map_err(|_| "browser-structure-result-worker-failed")??;
            let result: NativeDomStructure =
                serde_json::from_slice(&bytes).map_err(|_| "browser-structure-invalid-result")?;
            validate_dom_structure(&result, &self.nonce, observation_id, generation, source)?;
            Ok(result)
        }

        /// One frame is one new, native TF3 policy decision; no retries,
        /// alternate HTTP stack, proxy fallback or implicit credentials.
        pub(crate) async fn serve_one(
            &mut self,
            registry: &WorkspaceRegistry,
            web_state: &TfWebState,
        ) -> Result<BrokerResourceReceipt, String> {
            self.serve_one_scoped(registry, web_state, None).await
        }

        /// True only after a strictly sequential host-issued, authenticated
        /// idle offer. A future native owner may choose an approved control
        /// before calling serve_one again; the ordinary broker loop simply
        /// resumes it. An offer is NOT an action/approval capability.
        pub(crate) fn has_control_turn(&self) -> bool {
            self.control_turns_enabled && self.pending_control_turn.is_some()
        }

        /// Obtain a queue-safe *scheduling* request handle after the attested
        /// host enabled exclusive turns. Calling `request()` does not confer
        /// consent; it only asks the sole pipe owner to retain its NEXT host
        /// idle offer for the approved command rather than auto-declining it.
        #[allow(dead_code)] // consumed by future tf_browser.rs mailbox owner
        pub(crate) fn control_turn_requester(&self) -> Option<super::NativeControlTurnRequester> {
            self.control_turns_enabled
                .then(|| super::NativeControlTurnRequester(self.control_turn_requested.clone()))
        }

        async fn answer_control_turn(&mut self, kind: &'static str) -> Result<(), String> {
            if !self.control_turns_enabled
                || !matches!(kind, "control-turn-claim" | "control-turn-continue")
            {
                return Err("browser-control-turn-answer-denied".into());
            }
            // Burn the lease before the write. Any interruption kills the Job
            // via the caller's FlightFence; the old turn is NEVER reusable.
            let id = self
                .pending_control_turn
                .take()
                .ok_or("browser-control-turn-not-held")?;
            let frame = serde_json::to_vec(&ParentControlTurnChoice {
                version: 2,
                kind,
                session: &self.nonce,
                turn_id: id,
            })
            .map_err(|_| "browser-control-turn-choice-serialization")?;
            self.write_parent_frame(frame).await
        }

        fn idle_broker_receipt(&self, reason: &'static str) -> BrokerResourceReceipt {
            BrokerResourceReceipt {
                request_id: self.last_request_id,
                page_generation: self.last_page_generation,
                native_com_completed: false,
                terminal: "idle",
                reason: reason.into(),
                bytes: 0,
                tf3: None,
            }
        }

        /// In-process physical acceptance only: the real production host,
        /// original AppContainer and COM pipe remain unchanged. The parent
        /// uses a *test-only* exact loopback HTTPS TF3 policy with ephemeral
        /// certificate trust. No production binary or IPC can invoke this.
        #[cfg(test)]
        pub(crate) async fn serve_one_owned_https_for_test(
            &mut self,
            registry: &WorkspaceRegistry,
            web_state: &TfWebState,
            public_cert: &reqwest::Certificate,
        ) -> Result<BrokerResourceReceipt, String> {
            self.serve_one_scoped(registry, web_state, Some(public_cert))
                .await
        }

        async fn serve_one_scoped(
            &mut self,
            registry: &WorkspaceRegistry,
            web_state: &TfWebState,
            test_public_cert: Option<&reqwest::Certificate>,
        ) -> Result<BrokerResourceReceipt, String> {
            if !self.ready
                || self.stopped
                || self.poisoned
                || self.last_request_id as usize >= REQUEST_MAX
            {
                return Err("browser-broker-not-ready-or-budget-exhausted".into());
            }
            if self.pending_control_turn.is_some() {
                self.poisoned = true;
                let mut flight = FlightFence::new(self.job.0);
                self.answer_control_turn("control-turn-continue").await?;
                self.poisoned = false;
                flight.committed = true;
            }
            // Unlike the former unconditional 5s read+fence, an empty idle
            // session has NO blocking read task to outlive cancellation and
            // NO FlightFence to kill the Job. A begun frame still gets an
            // immediate fence before any of its bytes are consumed.
            // Keep ONE idle budget while declining unsolicited offers; they
            // must not generate bogus TF3 receipts every 250ms or prevent the
            // outer 15s broker owner from observing an empty idle terminal.
            let idle_deadline = Instant::now() + Duration::from_secs(12);
            loop {
                match wait_for_pipe_frame_start(&self.requests, idle_deadline).await {
                    Ok(false) => return Ok(self.idle_broker_receipt("no-child-frame-yet")),
                    Ok(true) => {}
                    Err(reason) => {
                        self.poisoned = true;
                        return Err(reason);
                    }
                }
                self.poisoned = true;
                let mut flight = FlightFence::new(self.job.0);
                let mut reader = self
                    .requests
                    .try_clone()
                    .map_err(|_| "browser-pipe-clone-denied")?;
                let bytes = tokio::task::spawn_blocking(move || read_pipe_bounded(&mut reader))
                    .await
                    .map_err(|_| "browser-pipe-worker-failed")??;
                let is_offer = self.control_turns_enabled
                    && serde_json::from_slice::<serde_json::Value>(&bytes)
                        .ok()
                        .and_then(|v| {
                            v.get("kind")
                                .and_then(serde_json::Value::as_str)
                                .map(str::to_owned)
                        })
                        .as_deref()
                        == Some("control-turn-offer");
                if is_offer {
                    let id =
                        validate_control_turn_offer(&bytes, &self.nonce, self.last_control_turn_id)
                            .map_err(str::to_owned)?;
                    self.last_control_turn_id = id;
                    self.pending_control_turn = Some(id);
                    if self.control_turn_requested.swap(false, Ordering::AcqRel) {
                        self.poisoned = false;
                        flight.committed = true;
                        return Ok(self.idle_broker_receipt("host-exclusive-control-turn-offered"));
                    }
                    // No native command is waiting; decline while the SAME
                    // owner holds the exact host lease. A fresh GET is never
                    // forwarded by the child until this write completes.
                    self.answer_control_turn("control-turn-continue").await?;
                    self.poisoned = false;
                    flight.committed = true;
                    continue;
                }
                let outcome = self
                    .serve_one_inner(registry, web_state, test_public_cert, &bytes)
                    .await;
                if outcome.is_ok() {
                    self.poisoned = false;
                    flight.committed = true;
                }
                return outcome;
            }
        }

        async fn serve_one_inner(
            &mut self,
            registry: &WorkspaceRegistry,
            web_state: &TfWebState,
            test_public_cert: Option<&reqwest::Certificate>,
            bytes: &[u8],
        ) -> Result<BrokerResourceReceipt, String> {
            token_attest(self.host.0, self.profile.sid.0, self.job.0)?;
            if self
                .browser
                .as_ref()
                .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
                || self
                    .renderer
                    .as_ref()
                    .is_none_or(|p| token_attest(p.0, self.profile.sid.0, self.job.0).is_err())
            {
                return Err("browser-child-process-unattested".into());
            }
            let req: ChildGet =
                serde_json::from_slice(bytes).map_err(|_| "browser-broker-request-malformed")?;
            validate_get(&req, &self.nonce, self.last_request_id)?;
            if req.page_generation < self.last_page_generation {
                return Err("browser-broker-stale-page-generation".into());
            }
            if req.page_generation != self.last_page_generation {
                self.page_contract.revoke_snapshot();
            }
            self.last_request_id = req.request_id;
            self.last_page_generation = req.page_generation;
            if !registry.is_authorized(&self.workspace_root) {
                return Err("browser-broker-workspace-revoked".into());
            }
            // The session's approved origin is the only remote HTTPS origin
            // accessible to this child. Cross-origin URLs and redirects are
            // rejected before a new DNS resolution or network connection.
            let requested =
                reqwest::Url::parse(&req.url).map_err(|_| "browser-request-url-invalid")?;
            let approved = reqwest::Url::parse(&self.initial_url)
                .map_err(|_| "browser-approved-origin-invalid")?;
            if requested.origin() != approved.origin() {
                self.send_and_verify(
                    req.request_id,
                    req.page_generation,
                    403,
                    "text/plain",
                    &[],
                    Some("origin-denied"),
                )
                .await?;
                return Ok(BrokerResourceReceipt {
                    request_id: req.request_id,
                    page_generation: req.page_generation,
                    native_com_completed: true,
                    terminal: "denied",
                    reason: "browser-origin-denied".into(),
                    bytes: 0,
                    tf3: None,
                });
            }
            let native = TfWebRequest {
                operation: TfWebOperation::HttpGet,
                actor: self.actor.clone(),
                session_id: self.session_id.clone(),
                workspace_root: self.workspace_root.to_string_lossy().into_owned(),
                url: Some(req.url),
                query: None,
                search_result_id: None,
                timeout_ms: Some(5_000),
                max_bytes: Some(RESOURCE_MAX),
                // TF3 reclassifies DNS/IP/SSRF on every hop; the native
                // same-origin executor additionally refuses a redirected
                // origin *before* resolving or connecting to it.
                max_redirects: Some(3),
            };
            let prepared_result = {
                #[cfg(test)]
                {
                    if test_public_cert.is_some() {
                        tf_web::prepare_owned_https_for_test(native, registry, web_state)
                    } else {
                        tf_web::prepare(native, registry, web_state)
                    }
                }
                #[cfg(not(test))]
                {
                    let _ = test_public_cert;
                    tf_web::prepare(native, registry, web_state)
                }
            };
            let prepared = match prepared_result {
                Ok(prepared) => prepared,
                Err(_) => {
                    self.send_and_verify(
                        req.request_id,
                        req.page_generation,
                        403,
                        "text/plain",
                        &[],
                        Some("tf3-preflight-denied"),
                    )
                    .await?;
                    return Ok(BrokerResourceReceipt {
                        request_id: req.request_id,
                        page_generation: req.page_generation,
                        native_com_completed: true,
                        terminal: "denied",
                        reason: "tf3-preflight-denied".into(),
                        bytes: 0,
                        tf3: None,
                    });
                }
            };
            let result = {
                #[cfg(test)]
                {
                    if let Some(cert) = test_public_cert {
                        tf_web::execute_owned_https_for_test(
                            &prepared.token,
                            registry,
                            web_state,
                            &approved,
                            cert,
                        )
                        .await
                    } else {
                        tf_web::execute_browser_resource_same_origin(
                            &prepared.token,
                            registry,
                            web_state,
                            &approved,
                        )
                        .await
                    }
                }
                #[cfg(not(test))]
                {
                    tf_web::execute_browser_resource_same_origin(
                        &prepared.token,
                        registry,
                        web_state,
                        &approved,
                    )
                    .await
                }
            };
            match result {
                Ok(result) => {
                    let receipt = result.receipt;
                    let mime = checked_mime(receipt.content_type.as_deref());
                    let delivered = receipt.terminal == "completed"
                        && receipt.reason_code == "ok"
                        && receipt.status_code.is_some_and(|s| (200..300).contains(&s))
                        && !receipt.truncated
                        && result.bytes.len() <= RESOURCE_MAX
                        && mime.is_some();
                    let size = if delivered { result.bytes.len() } else { 0 };
                    self.send_and_verify(
                        req.request_id,
                        req.page_generation,
                        if delivered { 200 } else { 403 },
                        mime.unwrap_or("text/plain"),
                        if delivered { &result.bytes } else { &[] },
                        (!delivered).then_some("tf3-resource-denied"),
                    )
                    .await?;
                    Ok(BrokerResourceReceipt {
                        request_id: req.request_id,
                        page_generation: req.page_generation,
                        native_com_completed: true,
                        terminal: if delivered { "completed" } else { "denied" },
                        reason: receipt.reason_code.into(),
                        bytes: size,
                        tf3: Some(receipt),
                    })
                }
                Err(_) => {
                    self.send_and_verify(
                        req.request_id,
                        req.page_generation,
                        502,
                        "text/plain",
                        &[],
                        Some("tf3-execution-failed"),
                    )
                    .await?;
                    Ok(BrokerResourceReceipt {
                        request_id: req.request_id,
                        page_generation: req.page_generation,
                        native_com_completed: true,
                        terminal: "failed",
                        reason: "tf3-execution-failed".into(),
                        bytes: 0,
                        tf3: None,
                    })
                }
            }
        }

        pub(crate) fn shutdown(&mut self) -> Result<(), String> {
            if self.stopped {
                return Ok(());
            }
            // Revoke every snapshot/element capability before terminating the
            // owned browser processes; late callbacks cannot resurrect them.
            self.page_contract.close();
            if !self.job_drained {
                if unsafe { TerminateJobObject(self.job.0, 1) } == 0 {
                    return Err(win_err("browser-terminate-job"));
                }
                if unsafe { WaitForSingleObject(self.host.0, JOB_STOP_TIMEOUT_MS) } != WAIT_OBJECT_0
                {
                    return Err("browser-host-job-not-drained".into());
                }
                let deadline = Instant::now() + Duration::from_secs(3);
                loop {
                    let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION =
                        unsafe { zeroed() };
                    if unsafe {
                        QueryInformationJobObject(
                            self.job.0,
                            JobObjectBasicAccountingInformation,
                            (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                            size_of_val(&accounting) as u32,
                            null_mut(),
                        )
                    } == 0
                    {
                        return Err(win_err("browser-job-accounting"));
                    }
                    if accounting.ActiveProcesses == 0 {
                        break;
                    }
                    if Instant::now() >= deadline {
                        return Err("browser-job-processes-still-live".into());
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                self.job_drained = true;
            }
            // Only explicitly created per-session UDF and directory are
            // eligible; avoid following symlinks/reparse points during cleanup.
            ensure_plain_dir(&self.private_root)?;
            ensure_plain_dir(&self.effective_udf)?;
            fs::remove_dir_all(&self.private_root)
                .map_err(|_| "browser-session-udf-cleanup-failed")?;
            self.profile.delete()?;
            self.stopped = true;
            Ok(())
        }

        /// Physical-test-only independent readback of the *same* owned
        /// production Job, AppContainer profile and UDF after cancellation.
        /// Do not infer zero residue merely from a successful shutdown call.
        #[cfg(test)]
        pub(crate) fn verify_cancelled_document_shutdown_for_test(
            &self,
            original_get_id: u64,
        ) -> Result<(), String> {
            if !self.ready
                || !self.stopped
                || !self.poisoned
                || !self.job_drained
                || !self.profile.deleted
                || self.last_request_id != original_get_id
                || self.last_page_generation == 0
            {
                return Err("pending-document-shutdown-state-not-attested".into());
            }
            if unsafe { WaitForSingleObject(self.host.0, 0) } != WAIT_OBJECT_0 {
                return Err("pending-document-host-still-live".into());
            }
            let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
            if unsafe {
                QueryInformationJobObject(
                    self.job.0,
                    JobObjectBasicAccountingInformation,
                    (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    size_of_val(&accounting) as u32,
                    null_mut(),
                )
            } == 0
                || accounting.ActiveProcesses != 0
            {
                return Err("pending-document-job-active-process-residue".into());
            }
            for path in [&self.private_root, &self.effective_udf] {
                match fs::symlink_metadata(path) {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    _ => return Err("pending-document-udf-or-private-root-residue".into()),
                }
            }
            Ok(())
        }

        /// The same independent kernel/profile/UDF readback for an orderly
        /// read-only test session closed *after* native COM observations.
        #[cfg(test)]
        pub(crate) fn verify_clean_readonly_close_for_test(
            &self,
            expected_get_count: u64,
        ) -> Result<(), String> {
            if !self.ready
                || !self.stopped
                || self.poisoned
                || !self.job_drained
                || !self.profile.deleted
                || self.last_request_id != expected_get_count
                || self.last_page_generation == 0
            {
                return Err("read-only-recheck-closed-state-not-attested".into());
            }
            if unsafe { WaitForSingleObject(self.host.0, 0) } != WAIT_OBJECT_0 {
                return Err("read-only-recheck-host-not-terminated".into());
            }
            let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
            if unsafe {
                QueryInformationJobObject(
                    self.job.0,
                    JobObjectBasicAccountingInformation,
                    (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    size_of_val(&accounting) as u32,
                    null_mut(),
                )
            } == 0
                || accounting.ActiveProcesses != 0
            {
                return Err("read-only-recheck-job-process-residue".into());
            }
            for path in [&self.private_root, &self.effective_udf] {
                match fs::symlink_metadata(path) {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    _ => return Err("read-only-recheck-udf-or-private-root-residue".into()),
                }
            }
            Ok(())
        }
    }
    impl Drop for BrowserRuntimeSession {
        fn drop(&mut self) {
            // Closing the Job Object is last-resort kill-on-close. Never
            // silently erase AppContainer/UDF if orderly cleanup was unproved.
            if !self.stopped {
                let _ = self.shutdown();
            }
        }
    }
}

#[cfg(windows)]
pub(crate) use windows_owner::BrowserRuntimeSession;

#[cfg(not(windows))]
pub(crate) struct BrowserRuntimeSession;

#[cfg(not(windows))]
impl BrowserRuntimeSession {
    pub(crate) fn launch(
        _start: BrowserRuntimeStart,
        _registry: &WorkspaceRegistry,
    ) -> Result<Self, String> {
        Err("browser-appcontainer-windows-only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::net::tf_browser_contract::{ActionTarget, BrowserActionKind};

    #[test]
    fn exclusive_host_control_turns_reject_replay_forgery_and_unknown_fields() {
        let session = "a".repeat(48);
        let offer = serde_json::json!({"version":2,"kind":"control-turn-offer",
            "session":session,"turnId":1});
        assert_eq!(
            validate_control_turn_offer(offer.to_string().as_bytes(), &session, 0),
            Ok(1)
        );
        assert!(validate_control_turn_offer(offer.to_string().as_bytes(), &session, 1).is_err());
        assert!(validate_control_turn_offer(offer.to_string().as_bytes(), "wrong", 0).is_err());
        let advance = serde_json::json!({"version":2,"kind":"control-turn-offer",
            "session":session,"turnId":2});
        assert_eq!(
            validate_control_turn_offer(advance.to_string().as_bytes(), &session, 1),
            Ok(2)
        );
        for (field, value) in [
            ("version", serde_json::json!(1)),
            ("kind", serde_json::json!("com-completed")),
            ("turnId", serde_json::json!(0)),
            ("session", serde_json::json!("forged")),
        ] {
            let mut corrupt = offer.clone();
            corrupt[field] = value;
            assert!(
                validate_control_turn_offer(corrupt.to_string().as_bytes(), &session, 0).is_err()
            );
        }
        let mut injected = offer;
        injected["approvalId"] = serde_json::json!("not-a-consent");
        assert!(validate_control_turn_offer(injected.to_string().as_bytes(), &session, 0).is_err());
        let decline = serde_json::to_value(ParentControlTurnChoice {
            version: 2,
            kind: "control-turn-continue",
            session: &session,
            turn_id: 1,
        })
        .unwrap();
        assert_eq!(decline["kind"], "control-turn-continue");
        assert_eq!(decline["turnId"], 1);
        assert!(decline.get("approvalId").is_none());
    }

    #[test]
    fn native_turn_requester_coalesces_without_creating_any_consent() {
        let pending = Arc::new(AtomicBool::new(false));
        let owner_signal = NativeControlTurnRequester(pending.clone());
        let queued = owner_signal.clone();
        queued.request();
        owner_signal.request();
        assert!(pending.swap(false, Ordering::AcqRel));
        assert!(!pending.swap(false, Ordering::AcqRel));
    }

    #[test]
    fn consumed_central_click_witness_is_exact_scope_and_expires_without_reuse() {
        use crate::modules::net::tf_browser_contract::BrowserEffect;
        use std::time::{Duration, Instant};
        let target = ActionTarget {
            browser_session_id: "browser-1".into(),
            page_id: "page-1".into(),
            page_generation: 2,
            snapshot_id: "snapshot-1".into(),
            element_ref: "opaque-node-1".into(),
        };
        let workspace = PathBuf::from("C:/authorized-workspace");
        let source = "a".repeat(64);
        let proof = NativeConsumedExactClickApproval {
            approval_id: "b".repeat(48),
            actor: "human-actor".into(),
            session_id: "conversation-1".into(),
            workspace_root: workspace.clone(),
            target: target.clone(),
            effect: BrowserEffect::PotentialExternalWrite,
            source_id: source.clone(),
            observation_id: 5,
            index: 9,
            ordinal: 3,
            check_sequence: 7,
            expires_at: Instant::now() + Duration::from_secs(30),
        };
        let scoped = NativeExactClickApprovalScope {
            actor: "human-actor",
            session_id: "conversation-1",
            workspace_root: &workspace,
            target: &target,
            effect: BrowserEffect::PotentialExternalWrite,
            source_id: source.clone(),
            observation_id: 5,
            index: 9,
            ordinal: 3,
            check_sequence: 7,
        };
        assert!(proof.matches_exact(&scoped));
        assert!(
            NativeConsumedExactClickApproval::from_consumed_central_token(
                "b".repeat(48),
                &scoped,
                Instant::now() + Duration::from_secs(30),
            )
            .is_ok()
        );
        assert!(
            NativeConsumedExactClickApproval::from_consumed_central_token(
                "not-an-issued-id".into(),
                &scoped,
                Instant::now() + Duration::from_secs(30),
            )
            .is_err()
        );
        assert!(
            NativeConsumedExactClickApproval::from_consumed_central_token(
                "b".repeat(48),
                &scoped,
                Instant::now() + Duration::from_secs(61),
            )
            .is_err()
        );
        assert!(!NativeConsumedExactClickApproval {
            check_sequence: 8,
            ..proof
        }
        .matches_exact(&scoped));
        let expired = NativeConsumedExactClickApproval {
            approval_id: "b".repeat(48),
            actor: "human-actor".into(),
            session_id: "conversation-1".into(),
            workspace_root: workspace.clone(),
            target: target.clone(),
            effect: BrowserEffect::PotentialExternalWrite,
            source_id: source.clone(),
            observation_id: 5,
            index: 9,
            ordinal: 3,
            check_sequence: 7,
            expires_at: Instant::now() - Duration::from_millis(1),
        };
        assert!(!expired.matches_exact(&scoped));
    }
    #[test]
    fn broker_allows_bounded_web_fonts_and_common_script_mime_without_untrusted_headers() {
        for mime in [
            "text/javascript; charset=utf-8",
            "font/woff",
            "font/woff2",
            "application/font-woff",
            "application/font-woff2",
            "application/vnd.ms-fontobject",
            "application/x-javascript",
            "image/webp",
            "image/avif",
            "font/ttf",
            "font/otf",
        ] {
            assert!(checked_mime(Some(mime)).is_some(), "{mime}");
        }
        for mime in [
            "text/html\r\nSet-Cookie: x=y",
            "application/x-sh",
            "text/xml",
        ] {
            assert!(checked_mime(Some(mime)).is_none(), "{mime}");
        }
    }
    #[test]
    fn rejects_replay_forged_session_and_non_https_before_network() {
        let nonce = "a".repeat(48);
        let good = ChildGet {
            version: 1,
            session: nonce.clone(),
            request_id: 1,
            method: "GET".into(),
            url: "https://example.org/a".into(),
            page_generation: 1,
        };
        assert!(validate_get(&good, &nonce, 0).is_ok());
        assert!(validate_get(&good, &nonce, 1).is_err());
        assert!(validate_get(
            &ChildGet {
                session: "b".repeat(48),
                ..good.clone()
            },
            &nonce,
            0
        )
        .is_err());
        assert!(validate_get(
            &ChildGet {
                url: "http://127.0.0.1/".into(),
                ..good.clone()
            },
            &nonce,
            0
        )
        .is_err());
        assert!(validate_get(
            &ChildGet {
                method: "POST".into(),
                ..good.clone()
            },
            &nonce,
            0
        )
        .is_err());
        assert!(validate_get(
            &ChildGet {
                page_generation: 0,
                ..good
            },
            &nonce,
            0
        )
        .is_err());
    }
    #[test]
    fn com_ack_requires_exact_native_completion_identity_and_status() {
        let nonce = "b".repeat(48);
        let accepted = ChildComAck {
            version: 1,
            session: nonce.clone(),
            request_id: 2,
            kind: "com-completed".into(),
            status: 403,
            page_generation: 5,
        };
        assert!(validate_com_ack(&accepted, &nonce, 2, 5, 403).is_ok());
        assert!(validate_com_ack(&accepted, &nonce, 2, 5, 200).is_err());
        assert!(validate_com_ack(&accepted, &nonce, 2, 4, 403).is_err());
        assert!(validate_com_ack(&accepted, &nonce, 1, 5, 403).is_err());
        let wrong_session = ChildComAck {
            session: "c".repeat(48),
            ..accepted
        };
        assert!(validate_com_ack(&wrong_session, &nonce, 2, 5, 403).is_err());
    }

    #[test]
    fn native_element_recheck_accepts_only_exact_closed_readonly_identity() {
        let session = "a".repeat(48);
        let source = "c".repeat(64);
        let request = ParentElementRecheck {
            version: 2,
            kind: "recheck-element",
            session: &session,
            check_sequence: 1,
            observation_id: 2,
            page_generation: 3,
            source_id: &source,
            index: 7,
            ordinal: 4,
            debug_replace_heading: None,
        };
        let good = serde_json::json!({
            "version": 2, "kind": "element-recheck",
            "session": session, "checkSequence": 1,
            "observationId": 2, "pageGeneration": 3,
            "sourceId": source, "index": 7, "ordinal": 4,
            "state": "ACCEPTED",
        });
        assert_eq!(
            validate_element_recheck_reply(&good.to_string().into_bytes(), &request),
            Ok(true)
        );
        let mut altered = good.clone();
        altered["state"] = serde_json::json!("STALE");
        assert_eq!(
            validate_element_recheck_reply(&altered.to_string().into_bytes(), &request),
            Ok(false),
            "stale is only a negative observation, never an action grant"
        );
        for (field, forged) in [
            ("checkSequence", serde_json::json!(2)),
            ("observationId", serde_json::json!(1)),
            ("pageGeneration", serde_json::json!(4)),
            ("sourceId", serde_json::json!("d".repeat(64))),
            ("session", serde_json::json!("b".repeat(48))),
            ("index", serde_json::json!(8)),
            ("ordinal", serde_json::json!(3)),
            ("state", serde_json::json!("CLICKED")),
            ("kind", serde_json::json!("com-completed")),
            ("version", serde_json::json!(1)),
        ] {
            let mut forged_reply = good.clone();
            forged_reply[field] = forged;
            assert!(
                validate_element_recheck_reply(&forged_reply.to_string().into_bytes(), &request)
                    .is_err(),
                "field {field} is a bound native identity, not caller authority"
            );
        }
        let mut leaked = good.clone();
        leaked["value"] = serde_json::json!("synthetic-hidden-page-secret");
        assert!(
            validate_element_recheck_reply(&leaked.to_string().into_bytes(), &request).is_err(),
            "the sealed native reply cannot contain page text or values"
        );
        assert!(
            validate_element_recheck_reply(&vec![b'a'; 1025], &request).is_err(),
            "bounded recheck reply"
        );
        let debug_request = ParentElementRecheck {
            debug_replace_heading: Some(true),
            ..request
        };
        let mut mutated = good;
        mutated["state"] = serde_json::json!("MUTATED");
        assert_eq!(
            validate_element_recheck_reply(&mutated.to_string().into_bytes(), &debug_request),
            Ok(true),
            "only explicit test-owned replacement may acknowledge MUTATED"
        );
        mutated["state"] = serde_json::json!("ACCEPTED");
        assert!(
            validate_element_recheck_reply(&mutated.to_string().into_bytes(), &debug_request)
                .is_err(),
            "a replacement request cannot be disguised as a read-only recheck"
        );
    }

    #[test]
    fn native_exact_click_reply_never_promotes_dispatch_to_effect_confirmation() {
        use crate::modules::net::tf_browser_contract::{
            NativeEffectReceipt, NativeEffectTerminal as T,
        };
        let request = ParentElementAction {
            version: 2,
            kind: "act-element",
            session: "a",
            check_sequence: 3,
            observation_id: 2,
            page_generation: 1,
            source_id: "b",
            index: 4,
            ordinal: 2,
            action: "click",
            approval_id: "c",
        };
        let raw = serde_json::json!({
            "version":2, "kind":"element-action", "session":"a",
            "checkSequence":3,"observationId":2,"pageGeneration":1,
            "sourceId":"b","index":4,"ordinal":2,"action":"click",
            "approvalId":"c","state":"DISPATCHED",
        });
        assert_eq!(
            validate_element_action_reply(raw.to_string().as_bytes(), &request),
            Ok(T::Dispatched)
        );
        let receipt = NativeEffectReceipt::classify(T::Dispatched);
        assert_eq!(receipt.effect_state, "Unknown");
        assert_eq!(receipt.retry, "NEVER_REPLAY");
        for (field, bad) in [
            ("session", serde_json::json!("d")),
            ("checkSequence", serde_json::json!(4)),
            ("observationId", serde_json::json!(3)),
            ("sourceId", serde_json::json!("d")),
            ("pageGeneration", serde_json::json!(2)),
            ("index", serde_json::json!(5)),
            ("ordinal", serde_json::json!(3)),
            ("action", serde_json::json!("submit")),
            ("approvalId", serde_json::json!("d")),
            ("state", serde_json::json!("CONFIRMED")),
        ] {
            let mut forged = raw.clone();
            forged[field] = bad;
            assert!(
                validate_element_action_reply(forged.to_string().as_bytes(), &request).is_err(),
                "forged {field}"
            );
        }
        let mut injected = raw.clone();
        injected["body"] = serde_json::json!("leaked-secret");
        assert!(validate_element_action_reply(injected.to_string().as_bytes(), &request).is_err());
        for (wire, terminal) in [
            ("STALE", T::Stale),
            ("DENIED_TARGET", T::Denied),
            ("UNKNOWN", T::Unknown),
        ] {
            let mut reply = raw.clone();
            reply["state"] = serde_json::json!(wire);
            assert_eq!(
                validate_element_action_reply(reply.to_string().as_bytes(), &request),
                Ok(terminal)
            );
        }
    }
    #[test]
    fn native_structure_never_accepts_page_derived_text_or_stale_identity() {
        let session = "d".repeat(48);
        let source = "e".repeat(64);
        let raw = serde_json::json!({
            "version":2, "kind":"dom-snapshot", "session":session,
            "observationId":4,"pageGeneration":7, "sourceId":source,
            "terminal":"completed","reason":"ok","truncated":false,
            "visited":2, "elements":[
                {"index":1,"role":"heading","depth":1,"headingLevel":2},
                {"index":2,"role":"link","depth":2,"headingLevel":null}
            ]
        });
        let expected: NativeDomStructure = serde_json::from_value(raw.clone()).unwrap();
        assert!(validate_dom_structure(&expected, &session, 4, 7, &source).is_ok());
        assert!(validate_dom_structure(&expected, &session, 3, 7, &source).is_err());
        assert!(validate_dom_structure(&expected, &session, 4, 8, &source).is_err());
        assert!(validate_dom_structure(&expected, &session, 4, 7, &"f".repeat(64)).is_err());
        let mut leaked = raw.clone();
        leaked["elements"][0]["name"] =
            serde_json::json!("opaque-secret-without-any-sensitive-keyword");
        assert!(serde_json::from_value::<NativeDomStructure>(leaked).is_err());
        let mut leaked = raw.clone();
        leaked["url"] = serde_json::json!("https://example.org/?x=secret");
        assert!(serde_json::from_value::<NativeDomStructure>(leaked).is_err());
        let mut impossible = expected.clone();
        impossible.elements[1].index = 1;
        assert!(validate_dom_structure(&impossible, &session, 4, 7, &source).is_err());
        impossible.elements[1].index = 2;
        impossible.elements[1].role = "unsafe-untrusted-role".into();
        assert!(validate_dom_structure(&impossible, &session, 4, 7, &source).is_err());
    }
    #[test]
    fn native_control_states_are_closed_non_secret_and_never_an_action_grant() {
        let session = "a".repeat(48);
        let source = "b".repeat(64);
        let raw = serde_json::json!({
            "version":2,"kind":"dom-snapshot","session":session,
            "observationId":5,"pageGeneration":3,"sourceId":source,
            "terminal":"completed","reason":"ok","truncated":false,
            "visited":3,"elements":[
                {"index":1,"role":"form","depth":0,"headingLevel":null,
                 "visible":true,"enabled":true,"checked":null,"selected":null,
                 "expanded":null,"controlType":null},
                {"index":2,"role":"checkbox","depth":1,"headingLevel":null,
                 "visible":true,"enabled":true,"checked":false,"selected":null,
                 "expanded":null,"controlType":"checkbox","required":true},
                {"index":3,"role":"select","depth":1,"headingLevel":null,
                 "visible":true,"enabled":false,"checked":null,"selected":null,
                 "expanded":null,"controlType":"select"}
            ]
        });
        let parsed: NativeDomStructure = serde_json::from_value(raw.clone()).unwrap();
        assert!(validate_dom_structure(&parsed, &session, 5, 3, &source).is_ok());
        assert_eq!(
            structural_observed_elements(&parsed).unwrap()[1].required,
            Some(true)
        );
        let mut invalid = parsed.clone();
        invalid.elements[0].required = Some(true);
        assert!(validate_dom_structure(&invalid, &session, 5, 3, &source).is_err());
        invalid.elements[0].required = None;
        invalid.elements[1].control_type = Some("password".into());
        assert!(validate_dom_structure(&invalid, &session, 5, 3, &source).is_err());
        invalid.elements[1].control_type = Some("checkbox".into());
        invalid.elements[1].role = "input".into();
        assert!(validate_dom_structure(&invalid, &session, 5, 3, &source).is_err());
        invalid.elements[1].role = "checkbox".into();
        invalid.elements[2].checked = Some(true);
        assert!(validate_dom_structure(&invalid, &session, 5, 3, &source).is_err());
        for key in [
            "name",
            "visibleText",
            "value",
            "href",
            "secret",
            "ariaLabel",
        ] {
            let mut leaked = raw.clone();
            leaked["elements"][1][key] = serde_json::json!("unrecognized-opaque-secret");
            assert!(
                serde_json::from_value::<NativeDomStructure>(leaked).is_err(),
                "{key} should not be representable in the production wire"
            );
        }
    }
    #[test]
    fn native_closed_controls_map_into_existing_random_stale_bound_page_contract() {
        let nonce = "c".repeat(48);
        let dom: NativeDomStructure = serde_json::from_value(serde_json::json!({
            "version":2,"kind":"dom-snapshot","session":nonce,
            "observationId":1,"pageGeneration":1,"sourceId":"d".repeat(64),
            "terminal":"completed","reason":"ok","truncated":true,
            "visited":5,"omittedFields":2,
            "elements":[
                {"index":1,"role":"input","depth":1,"headingLevel":null,
                 "visible":true,"enabled":true,"checked":null,"selected":null,
                 "expanded":null,"controlType":"text"},
                {"index":3,"role":"checkbox","depth":1,"headingLevel":null,
                 "visible":true,"enabled":true,"checked":true,"selected":null,
                 "expanded":null,"controlType":"checkbox"},
                {"index":5,"role":"option","depth":2,"headingLevel":null,
                 "visible":true,"enabled":true,"checked":null,"selected":true,
                 "expanded":null,"controlType":null}
            ]
        }))
        .unwrap();
        assert!(validate_dom_structure(&dom, &nonce, 1, 1, &"d".repeat(64)).is_ok());
        let elements = structural_observed_elements(&dom).unwrap();
        assert_eq!(elements.len(), 3);
        assert_eq!(elements[0].role, SemanticRole::Textbox);
        assert_eq!(elements[0].field_type.as_deref(), Some("text"));
        assert_eq!(elements[1].role, SemanticRole::Checkbox);
        assert_eq!(elements[1].state.checked, Some(true));
        assert_eq!(elements[2].role, SemanticRole::Option);
        assert_eq!(elements[2].state.selected, Some(true));
        assert!(elements.iter().all(|e| e.accessible_name.is_empty()
            && e.href.is_none()
            && e.form_target.is_none()
            && e.has_script_handler));
        let mut page = BrowserPageContract::new(nonce.clone(), "https://example.org/").unwrap();
        page.observe(1, "https://example.org/", "", "", elements, 1)
            .unwrap();
        let first = page.mark_snapshot_truncated(dom.truncated).unwrap().clone();
        assert!(first.truncated);
        assert_eq!(first.elements.len(), 3);
        assert!(first.elements.iter().all(|e| e.element_ref.len() == 48));
        let target = ActionTarget {
            browser_session_id: first.browser_session_id.clone(),
            page_id: first.page_id.clone(),
            page_generation: first.page_generation,
            snapshot_id: first.snapshot_id.clone(),
            element_ref: first.elements[0].element_ref.clone(),
        };
        page.observe(1, "https://example.org/", "", "", vec![], 2)
            .unwrap();
        assert_eq!(
            page.prepare_action(BrowserActionKind::Type, target, Some("x"))
                .unwrap_err(),
            "STALE_ELEMENT"
        );
    }
    #[test]
    fn bounded_frames_reject_zero_oversize_and_incomplete_input() {
        use std::io::Cursor;
        assert!(read_frame_from(&mut Cursor::new(0u32.to_le_bytes())).is_err());
        assert!(read_frame_from(&mut Cursor::new(((FRAME_MAX + 1) as u32).to_le_bytes())).is_err());
        assert!(read_frame_from(&mut Cursor::new(
            [4u32.to_le_bytes().as_slice(), b"no"].concat()
        ))
        .is_err());
        assert_eq!(
            read_frame_from(&mut Cursor::new(
                [2u32.to_le_bytes().as_slice(), b"ok"].concat()
            ))
            .unwrap(),
            b"ok"
        );
    }

    /// This is an explicitly invoked physical Windows probe of the real
    /// production launcher and child COM readiness channel. The reserved
    /// loopback URL is never broker-served, and the caller shuts down directly
    /// after attesting the actual renderer/browser and COM effective UDF. It
    /// cannot be mistaken for the full HTTPS or interactive native E2E gate.
    /// No default cargo test launches a browser or touches a real website.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit Windows original-HANDLE AppContainer/COM pre-navigation probe only"]
    async fn physical_production_child_readiness_no_network_fixture() {
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("a specifically built native production host executable is required");
        let expected = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact built host for digest"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest.parent().expect("manifest under project root");
        let private = manifest
            .join("target")
            .join("tf4-production-readiness-acceptance");
        std::fs::create_dir_all(&private).expect("create dedicated owned physical test root");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("authorize exact /clack workspace for test");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-probe".into(),
                session_id: "tf4-physical-probe-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/".into(),
                private_parent: private,
                host_executable: host,
                host_sha256: expected,
            },
            &registry,
        )
        .expect(
            "actual AppContainer child launched under original Job with 0 network capabilities",
        );
        let ready = browser.verify_ready().await;
        let closed = browser.shutdown();
        assert!(
            closed.is_ok(),
            "original owned Job and UDF cleanup: {closed:?}"
        );
        assert!(
            ready.is_ok(),
            "actual native WebView2 COM readiness and process proof: {ready:?}"
        );
    }

    /// Explicitly opted-in production-mode HTTPS interception negative. The
    /// private loopback destination must be rejected by TF3 Public policy,
    /// and the parent must not count success until the child reports native
    /// COM deferral completion. No uncontrolled destination is contacted.
    /// This is not remote HTTPS success, public egress certification or E2E.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit real Windows production TF3 private-target denial and COM terminal probe"]
    async fn physical_production_browser_https_private_denial_com_terminal() {
        // Only an owned loopback target is inspected. If port 443 is already
        // occupied, preserve the COM/TF3 denial result but explicitly report
        // native listener isolation UNAVAILABLE rather than inventing PASS.
        let owned_tcp = std::net::TcpListener::bind("127.0.0.1:443").ok();
        if let Some(listener) = owned_tcp.as_ref() {
            let positive = std::net::TcpStream::connect("127.0.0.1:443")
                .expect("ordinary parent positive control must reach owned TCP listener");
            let (accepted, _peer) = listener
                .accept()
                .expect("ordinary parent TCP positive control must be observed");
            drop(accepted);
            drop(positive);
            listener
                .set_nonblocking(true)
                .expect("bounded owned listener polling");
        } else {
            eprintln!("PRODUCTION_DIRECT_TCPV4_ISOLATION=UNAVAILABLE owned 127.0.0.1:443 busy");
        }
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("explicitly built trusted host required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact test host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest.parent().expect("approved project root");
        let private_parent = manifest
            .join("target")
            .join("tf4-production-private-denial-acceptance");
        std::fs::create_dir_all(&private_parent).expect("dedicated owned case root");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("authorize exact workspace");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-denial".into(),
                session_id: "tf4-physical-denial-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/".into(),
                private_parent,
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("confined production host launch");
        let result = async {
            browser.verify_ready().await?;
            let bounded = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                browser.serve_one(&registry, &TfWebState::default()),
            )
            .await
            .map_err(|_| "production-private-denial-com-timeout".to_owned())??;
            Ok::<_, String>(bounded)
        }
        .await;
        let closed = browser.shutdown();
        assert!(closed.is_ok(), "job/UDF/profile cleanup: {closed:?}");
        let receipt = result.expect("actual WebView2 native resource must reach TF3");
        assert_eq!(receipt.request_id, 1);
        assert!(receipt.page_generation > 0);
        assert!(
            receipt.native_com_completed,
            "COM terminal must be attested"
        );
        assert_eq!(receipt.terminal, "denied");
        assert_eq!(receipt.bytes, 0);
        assert!(receipt
            .tf3
            .as_ref()
            .is_none_or(|r| r.terminal != "completed"));
        if let Some(listener) = owned_tcp {
            let result = listener.accept();
            assert!(
                matches!(&result, Err(e) if e.kind() == std::io::ErrorKind::WouldBlock),
                "unauthorized renderer TCP connected to owned localhost:443: {result:?}"
            );
            eprintln!("PRODUCTION_DIRECT_TCPV4_ISOLATION=PASS owned positive=1 restricted=0");
        }
    }

    /// Dedicated, explicit real WebView2 sealed-pipe observation control
    /// probe. A private HTTPS document is denied by TF3, so the result may
    /// legitimately be a DOM-unavailable denial; even then the native child
    /// must return the correctly scoped, secret-free v2 terminal. This does
    /// NOT satisfy a real accessible-name/element semantic E2E acceptance.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit production WebView2 structural observation protocol probe"]
    async fn physical_production_dom_structure_control_after_tf3_denial() {
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("explicit native production host required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact production host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest.parent().expect("approved root");
        let private_parent = manifest
            .join("target")
            .join("tf4-production-structure-acceptance");
        std::fs::create_dir_all(&private_parent).expect("dedicated owned case root");
        let registry = WorkspaceRegistry::default();
        registry.authorize(workspace).expect("authorize workspace");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-structure".into(),
                session_id: "tf4-physical-structure-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/structure".into(),
                private_parent,
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("launch exact owned zero-cap host");
        let observed = async {
            browser.verify_ready().await?;
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                browser.serve_one(&registry, &TfWebState::default()),
            )
            .await
            .map_err(|_| "production-structure-resource-deadline".to_owned())??;
            if result.terminal != "denied" || !result.native_com_completed {
                return Err("production-structure-resource-not-closed".into());
            }
            tokio::time::timeout(
                std::time::Duration::from_secs(10),
                browser.observe_structure(),
            )
            .await
            .map_err(|_| "production-structure-observation-deadline".to_owned())?
        }
        .await;
        let closed = browser.shutdown();
        assert!(
            closed.is_ok(),
            "owned process/profile/UDF cleanup: {closed:?}"
        );
        let value = observed.expect("native source/epoch-bound bounded DOM control must reply");
        assert_eq!(value.observation_id, 1);
        assert!(matches!(value.terminal.as_str(), "completed" | "denied"));
        assert!(value.visited <= 256);
        assert!(value.elements.len() <= 48);
        let serialized = serde_json::to_string(&value).unwrap();
        for forbidden in [
            "title",
            "href",
            "password",
            "accessibleName",
            "rawHtml",
            "fieldValue",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "forbidden model-facing DOM value/attribute field reached parent: {forbidden}"
            );
        }
        eprintln!(
            "PRODUCTION_DOM_CONTROL={} visited={} elements={}",
            value.terminal,
            value.visited,
            value.elements.len()
        );
    }

    /// Separate real production browser negative against an owned local
    /// RFC1918 interface address, never an arbitrary LAN target. The test
    /// requires the operator to select an address physically assigned to
    /// this machine. The listener's successful bind AND positive connection
    /// establish ownership before the confined child is ever launched.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit owned-interface RFC1918 TCPv4 production direct-network negative"]
    async fn physical_production_owned_rfc1918_denial_no_tcp_fallback() {
        let ip: std::net::Ipv4Addr = std::env::var("CLACK_TF4_OWNED_RFC1918_ADDRESS")
            .expect("UNAVAILABLE: select an address assigned to this Windows machine")
            .parse()
            .expect("explicit owned test address must be IPv4");
        let octets = ip.octets();
        assert!(
            octets[0] == 10
                || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 168),
            "explicit test address must be RFC1918, never an arbitrary public/LAN target"
        );
        let listener = std::net::TcpListener::bind((ip, 443))
            .expect("UNAVAILABLE: cannot bind port 443 on the exact owned local interface");
        let positive = std::net::TcpStream::connect((ip, 443))
            .expect("owned parent positive control must reach exact listener");
        let (accepted, _peer) = listener.accept().expect("owned positive control observed");
        drop(accepted);
        drop(positive);
        listener
            .set_nonblocking(true)
            .expect("bounded owned listener read");

        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("explicit exact native host build required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("exact built host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest.parent().expect("approved root");
        let private_parent = manifest
            .join("target")
            .join("tf4-production-owned-rfc1918-acceptance");
        std::fs::create_dir_all(&private_parent).expect("scoped evidence root");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("authorize exact workspace");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-owned-rfc1918".into(),
                session_id: "tf4-physical-owned-rfc1918-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: format!("https://{ip}/"),
                private_parent,
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("owned zero-network-capability production host launch");
        let outcome = async {
            browser.verify_ready().await?;
            tokio::time::timeout(
                std::time::Duration::from_secs(15),
                browser.serve_one(&registry, &TfWebState::default()),
            )
            .await
            .map_err(|_| "production-owned-rfc1918-com-timeout".to_owned())?
        }
        .await;
        let cleanup = browser.shutdown();
        assert!(
            cleanup.is_ok(),
            "original owned Job/UDF/profile cleanup: {cleanup:?}"
        );
        let receipt = outcome.expect("TF3 must deny actual native HTTPS request");
        assert_eq!(receipt.terminal, "denied");
        assert!(receipt.native_com_completed);
        assert!(receipt.page_generation > 0);
        assert_eq!(receipt.bytes, 0);
        assert!(receipt
            .tf3
            .as_ref()
            .is_none_or(|r| r.terminal != "completed"));
        let unauthorized = listener.accept();
        assert!(
            matches!(&unauthorized, Err(err) if err.kind() == std::io::ErrorKind::WouldBlock),
            "restricted browser reached independently owned RFC1918 TCP listener: {unauthorized:?}"
        );
        eprintln!("PRODUCTION_OWNED_RFC1918_TCPV4_DENIAL=PASS ordinary_positive=1 restricted=0");
    }

    /// Independent production IPv6 loopback egress negative. No public or
    /// third-party IPv6 address is contacted: the listener is owned by this
    /// test, and a successful ordinary parent TCP connect is the positive
    /// control. TF3 must reject the restricted WebView2 HTTPS request before
    /// any direct IPv6 socket reaches the listener, then the native COM
    /// denial terminal and owned Job/profile cleanup must be observed.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit real production AppContainer/WebView2 owned IPv6 loopback isolation negative"]
    async fn physical_production_owned_ipv6_loopback_denial_no_tcp_fallback() {
        use std::net::Ipv6Addr;
        let listener = std::net::TcpListener::bind((Ipv6Addr::LOCALHOST, 443))
            .expect("UNAVAILABLE: owned IPv6 ::1 port 443 bind failed");
        let positive = std::net::TcpStream::connect((Ipv6Addr::LOCALHOST, 443))
            .expect("owned ordinary parent IPv6 positive control must connect");
        let (accepted, _) = listener
            .accept()
            .expect("owned IPv6 positive control observed");
        drop(accepted);
        drop(positive);
        listener
            .set_nonblocking(true)
            .expect("bounded IPv6 owned accept");

        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("exact feature-enabled production host required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest.parent().expect("project workspace");
        let parent = tempfile::Builder::new()
            .prefix("tf4-production-owned-ipv6-")
            .tempdir_in(manifest.join("target"))
            .expect("unique owned IPv6 test root");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("authorize exact workspace");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-owned-ipv6".into(),
                session_id: "tf4-physical-ipv6-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://[::1]/".into(),
                private_parent: parent.path().to_path_buf(),
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("owned zero-network-capability production AppContainer launched");
        let outcome = async {
            browser.verify_ready().await?;
            tokio::time::timeout(
                std::time::Duration::from_secs(15),
                browser.serve_one(&registry, &TfWebState::default()),
            )
            .await
            .map_err(|_| "production-owned-ipv6-com-timeout".to_owned())?
        }
        .await;
        let cleanup = browser.shutdown();
        assert!(
            cleanup.is_ok(),
            "original owned Job/UDF/profile cleanup: {cleanup:?}"
        );
        let receipt = outcome.expect("TF3 must deny actual WebView2 IPv6 HTTPS request");
        assert_eq!(receipt.request_id, 1);
        assert!(receipt.page_generation > 0);
        assert!(
            receipt.native_com_completed,
            "native COM deferral must terminate"
        );
        assert_eq!(receipt.terminal, "denied");
        assert_eq!(receipt.bytes, 0);
        assert!(receipt
            .tf3
            .as_ref()
            .is_none_or(|r| r.terminal != "completed"));
        let unauthorized = listener.accept();
        assert!(
            matches!(&unauthorized, Err(e) if e.kind() == std::io::ErrorKind::WouldBlock),
            "restricted renderer reached owned IPv6 listener: {unauthorized:?}"
        );
        assert!(parent
            .path()
            .read_dir()
            .expect("inspect owned root")
            .next()
            .is_none());
        eprintln!("PRODUCTION_OWNED_IPV6_LOOPBACK_DENIAL=PASS ordinary_positive=1 restricted=0 native_com=true owned_job_udf_clean=true");
    }

    /// Explicit positive public-HTTPS qualification of the *production* owner,
    /// not the fixture network policy. Uses only IANA documentation domains,
    /// no credentials, no form writes and no alternate HTTP client. A TF3
    /// denial/network failure is a real failure, not a fixture-equivalent PASS.
    /// The active AppContainer has zero generic network capabilities and the
    /// first WebView2 document must finish its actual COM deferral before any
    /// DOM result can be accepted. This alone is not the full interactive E2E.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "opt-in physical production positive public HTTPS/COM/document DOM probe"]
    async fn physical_production_allowed_https_document_and_dom() {
        let target = std::env::var("CLACK_TF4_POSITIVE_HTTPS_URL")
            .expect("explicit HTTPS documentation target opt-in required");
        assert!(
            matches!(
                target.as_str(),
                "https://example.com/" | "https://example.org/"
            ),
            "only static IANA documentation origins may be contacted by this physical probe"
        );
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("exact production host executable required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact production host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace = manifest
            .parent()
            .expect("workspace parent of native manifest");
        let private_parent = manifest
            .join("target")
            .join("tf4-production-positive-https-acceptance");
        std::fs::create_dir_all(&private_parent).expect("dedicated positive test private parent");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("authorize exact workspace");
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-physical-positive".into(),
                session_id: "tf4-physical-positive-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: target.clone(),
                private_parent,
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("physical production AppContainer launch");
        let outcome = async {
            browser.verify_ready().await?;
            let resource = tokio::time::timeout(
                std::time::Duration::from_secs(17),
                browser.serve_one(&registry, &TfWebState::default()),
            )
            .await
            .map_err(|_| "positive-https-com-deadline".to_owned())??;
            eprintln!(
                "PRODUCTION_POSITIVE_HTTPS_RESOURCE terminal={} reason={} bytes={} native_com={} tf3_terminal={} tf3_reason={} tls={} dns_hops={}",
                resource.terminal,
                resource.reason,
                resource.bytes,
                resource.native_com_completed,
                resource.tf3.as_ref().map_or("none", |r| r.terminal),
                resource.tf3.as_ref().map_or("none", |r| r.reason_code),
                resource.tf3.as_ref().map_or("none", |r| r.tls_state),
                resource.tf3.as_ref().map_or(0, |r| r.dns_evidence.len()),
            );
            if resource.terminal != "completed"
                || !resource.native_com_completed
                || resource.bytes == 0
                || resource.tf3.as_ref().is_none_or(|r| {
                    r.terminal != "completed"
                        || r.reason_code != "ok"
                        || r.tls_state != "https_transport_observed"
                        || r.content_type.as_deref().is_none_or(|mime| {
                            !mime.starts_with("text/html")
                        })
                        || r.dns_evidence.is_empty()
                        || r.dns_evidence.iter().any(|d| d.classification != "all-allowed")
                })
            {
                return Err("positive-production-tf3-https-document-not-completed".into());
            }
            let dom = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                browser.observe_structure(),
            )
            .await
            .map_err(|_| "positive-https-structural-observation-deadline".to_owned())??;
            eprintln!(
                "PRODUCTION_POSITIVE_HTTPS_DOM terminal={} reason={} visited={} elements={} generation={}",
                dom.terminal,
                dom.reason,
                dom.visited,
                dom.elements.len(),
                dom.page_generation
            );
            if dom.terminal != "completed" || dom.visited == 0 || dom.elements.is_empty() {
                return Err("positive-production-webview2-document-not-observed".into());
            }
            Ok::<_, String>((resource, dom))
        }
        .await;
        let cleanup = browser.shutdown();
        assert!(
            cleanup.is_ok(),
            "owned process/Job/UDF/profile cleanup: {cleanup:?}"
        );
        let (resource, dom) = outcome.expect("real production HTTPS document must render");
        assert_eq!(resource.page_generation, dom.page_generation);
        eprintln!("PRODUCTION_POSITIVE_HTTPS_DOCUMENT=PASS TF3 HTTPS COM DOM Job UDF");
    }

    /// Controlled HTTPS alternative when public egress is unavailable. This
    /// uses the *production* AppContainer, WebView2 and native COM broker; only
    /// the Rust test binary receives a scoped TF3 owned-127.0.0.1 exception and
    /// an ephemeral public trust anchor. No release code, host, or general
    /// network policy can use that exception. A separate strictly-owned TLS
    /// fixture must be listening at 127.0.0.1:443 with a matching certificate.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit owned HTTPS fixture only: read-only control turn, real WebView2 COM and TF3; no action consent or model tool"]
    async fn physical_production_opt_in_exclusive_control_turn_snapshot() {
        use std::time::Duration;
        assert_eq!(
            std::env::var("CLACK_TF4_NATIVE_CONTROL_TURN").as_deref(),
            Ok("1"),
            "this real COM/TF3 probe is never automatic"
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let evidence = manifest.join("target").join("tf4-owned-https");
        let certificate = std::fs::canonicalize(evidence.join("server.cer"))
            .expect("active owned HTTPS fixture public certificate");
        assert_eq!(
            std::fs::canonicalize(
                std::env::var("CLACK_TF4_OWNED_HTTPS_CERT").expect("fixture certificate path")
            )
            .unwrap(),
            certificate
        );
        let cert = reqwest::Certificate::from_der(&std::fs::read(&certificate).unwrap()).unwrap();
        let host = PathBuf::from(
            std::env::var("CLACK_TF4_NATIVE_PROBE_HOST").expect("feature-enabled owned host"),
        );
        let digest = format!("{:x}", Sha256::digest(std::fs::read(&host).unwrap()));
        let private = tempfile::Builder::new()
            .prefix("tf4-control-turn-")
            .tempdir_in(manifest.join("target"))
            .unwrap();
        let workspace = manifest.parent().unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(workspace).unwrap();
        let web = TfWebState::default();
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-control-turn-readonly".into(),
                session_id: "tf4-control-turn-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/".into(),
                private_parent: private.path().to_path_buf(),
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .unwrap();
        let observed = async {
            tokio::time::timeout(
                Duration::from_secs(18),
                browser.verify_ready_for_control_turns(),
            )
            .await
            .map_err(|_| "control-turn-ready-timeout")??;
            let requester = browser
                .control_turn_requester()
                .ok_or("turns-not-negotiated")?;
            // First prove actual parent-only TF3 GET and UI-apartment native
            // COM completion. Unsolicited host turns are transparently
            // declined and NEVER compete with these four resource receipts.
            for expected in 1..=4u64 {
                let resource = tokio::time::timeout(
                    Duration::from_secs(17),
                    browser.serve_one_owned_https_for_test(&registry, &web, &cert),
                )
                .await
                .map_err(|_| "control-turn-tf3-com-timeout")??;
                if resource.request_id != expected
                    || resource.terminal != "completed"
                    || !resource.native_com_completed
                    || resource.tf3.is_none()
                {
                    return Err("control-turn-real-com-not-proven".into());
                }
            }
            requester.request(); // scheduling request, NOT central consent
            let offered = tokio::time::timeout(
                Duration::from_secs(14),
                browser.serve_one_owned_https_for_test(&registry, &web, &cert),
            )
            .await
            .map_err(|_| "control-turn-exclusive-offer-timeout")??;
            if offered.terminal != "idle"
                || offered.reason != "host-exclusive-control-turn-offered"
                || !browser.has_control_turn()
            {
                return Err("control-turn-host-idle-offer-not-proven".into());
            }
            let snapshot = tokio::time::timeout(
                Duration::from_secs(10),
                browser.observe_closed_snapshot_in_control_turn(),
            )
            .await
            .map_err(|_| "control-turn-physical-dom-timeout")??;
            if snapshot.elements.is_empty()
                || snapshot.page_generation == 0
                || !snapshot.title.is_empty()
                || !snapshot.visible_text.is_empty()
                || browser.has_control_turn()
                || browser
                    .observe_closed_snapshot_in_control_turn()
                    .await
                    .is_ok()
            {
                return Err("control-turn-one-use-closed-dom-invalid".into());
            }
            Ok::<_, String>(())
        }
        .await;
        let cleanup = browser.shutdown();
        assert!(
            cleanup.is_ok(),
            "owned Job/UDF/AppContainer cleanup required: {cleanup:?}"
        );
        assert!(
            observed.is_ok(),
            "real read-only control turn: {observed:?}"
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit scoped HTTPS fixture with real production WebView2/TF3 COM path"]
    async fn physical_production_owned_https_document_resources_and_dom() {
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("exact feature-enabled production host required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact production host"))
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let evidence_dir = manifest.join("target").join("tf4-owned-https");
        let expected_cert = evidence_dir.join("server.cer");
        let supplied_cert = std::env::var_os("CLACK_TF4_OWNED_HTTPS_CERT")
            .map(PathBuf::from)
            .expect("explicit owned HTTPS public certificate is required");
        assert_eq!(
            std::fs::canonicalize(&supplied_cert).expect("owned public cert available"),
            std::fs::canonicalize(&expected_cert).expect("expected exact cert file"),
            "only the owned acceptance public certificate is permitted"
        );
        let cert = reqwest::Certificate::from_der(
            &std::fs::read(&expected_cert).expect("read the temporary public TLS cert"),
        )
        .expect("valid DER public certificate");
        let private_parent = manifest
            .join("target")
            .join("tf4-production-owned-https-acceptance");
        std::fs::create_dir_all(&private_parent).expect("create exact owned browser parent");
        let workspace = manifest.parent().expect("approved project root");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("approve only workspace");
        let web = TfWebState::default();
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-owned-https".into(),
                session_id: "tf4-owned-https-once".into(),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/".into(),
                private_parent,
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("real zero-network-capability production AppContainer launch");
        let outcome = async {
            browser.verify_ready().await?;
            let mut paths = std::collections::HashSet::<String>::new();
            let mut generation = None;
            // The real production host intentionally disables untrusted
            // remote JavaScript until effect classification/approval exists.
            // Read-only acceptance proves HTML, CSS, PNG and font, each via
            // a new TF3 token and a completed native COM deferral.
            for expected_id in 1..=4u64 {
                let resource = tokio::time::timeout(
                    std::time::Duration::from_secs(17),
                    browser.serve_one_owned_https_for_test(&registry, &web, &cert),
                )
                .await
                .map_err(|_| "owned-https-native-resource-deadline".to_owned())??;
                let tf3 = resource.tf3.as_ref().ok_or("owned-https-tf3-receipt-missing")?;
                eprintln!(
                    "PRODUCTION_OWNED_HTTPS_RESOURCE id={} terminal={} tf3={} reason={} tls={} bytes={} com={} dns_hops={}",
                    resource.request_id,
                    resource.terminal,
                    tf3.terminal,
                    tf3.reason_code,
                    tf3.tls_state,
                    resource.bytes,
                    resource.native_com_completed,
                    tf3.dns_evidence.len(),
                );
                if resource.request_id != expected_id
                    || resource.terminal != "completed"
                    || !resource.native_com_completed
                    || resource.bytes == 0
                    || tf3.terminal != "completed"
                    || tf3.reason_code != "ok"
                    || tf3.tls_state != "https_transport_observed"
                    || tf3.truncated
                    || tf3.content_sha256.as_deref().is_none_or(|s| s.len() != 64)
                    || tf3.dns_evidence.is_empty()
                    || tf3.dns_evidence.iter().any(|d| {
                        d.host != "127.0.0.1" || d.classification != "all-allowed"
                    })
                {
                    return Err("owned-https-tf3-com-or-ssl-delivery-failed".into());
                }
                if generation.is_some_and(|g| g != resource.page_generation) {
                    return Err("owned-https-generation-changed".into());
                }
                generation = Some(resource.page_generation);
                let requested = tf3
                    .requested_url
                    .as_deref()
                    .ok_or("owned-https-request-url-missing")?;
                let uri = reqwest::Url::parse(requested)
                    .map_err(|_| "owned-https-request-url-invalid")?;
                let owned_origin = reqwest::Url::parse("https://127.0.0.1/").unwrap().origin();
                if uri.origin() != owned_origin
                    || tf3
                        .final_url
                        .as_deref()
                        .and_then(|url| reqwest::Url::parse(url).ok())
                        .is_none_or(|final_url| final_url.origin() != owned_origin)
                {
                    return Err("owned-https-origin-escaped".into());
                }
                let expected_mime = match uri.path() {
                    "/" => "text/html",
                    "/page.css" => "text/css",
                    "/page.js" => return Err("owned-https-untrusted-script-not-disabled".into()),
                    "/pixel.png" => "image/png",
                    "/font.woff2" => "font/woff2",
                    _ => return Err("owned-https-unexpected-browser-resource".into()),
                };
                if checked_mime(tf3.content_type.as_deref()) != Some(expected_mime) {
                    return Err("owned-https-resource-content-type-mismatch".into());
                }
                if uri.path() == "/page.css" {
                    if tf3.redirect_chain.len() != 1
                        || tf3.redirect_chain[0] != "https://127.0.0.1/page.css"
                        || tf3.final_url.as_deref() != Some("https://127.0.0.1/style.css")
                        || tf3.dns_evidence.len() != 2
                    {
                        return Err("owned-https-same-origin-css-redirect-not-revalidated".into());
                    }
                } else if !tf3.redirect_chain.is_empty() {
                    return Err("owned-https-unexpected-redirect".into());
                }
                paths.insert(uri.path().to_owned());
            }
            for expected in ["/", "/page.css", "/pixel.png", "/font.woff2"] {
                if !paths.contains(expected) {
                    return Err("owned-https-required-dependent-resource-not-delivered".into());
                }
            }
            let dom = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                browser.observe_structure(),
            )
            .await
            .map_err(|_| "owned-https-dom-observation-timeout".to_owned())??;
            if dom.terminal != "completed"
                || dom.elements.is_empty()
                || dom.visited == 0
                || Some(dom.page_generation) != generation
            {
                return Err("owned-https-rendered-dom-not-verified".into());
            }
            let has = |role: &str, control: &str| {
                dom.elements.iter().any(|item| {
                    item.role == role && item.control_type.as_deref() == Some(control)
                })
            };
            if dom.omitted_fields < 2
                || !dom.truncated
                || !has("input", "text")
                || !dom.elements.iter().any(|item| {
                    item.role == "input"
                        && item.control_type.as_deref() == Some("text")
                        && item.required == Some(true)
                })
                || !has("textbox", "textarea")
                || !has("select", "select")
                || !dom.elements.iter().any(|item| {
                    item.role == "checkbox"
                        && item.control_type.as_deref() == Some("checkbox")
                        && item.checked == Some(true)
                })
                || !dom.elements.iter().any(|item| {
                    item.role == "option" && item.selected == Some(true)
                })
                || !dom.elements.iter().any(|item| {
                    item.role == "button"
                        && item.control_type.as_deref() == Some("button")
                        && !item.enabled
                })
                || dom.elements.iter().any(|item| {
                    matches!(item.control_type.as_deref(), Some("password" | "hidden" | "file"))
                })
            {
                return Err("owned-https-closed-control-state-or-secret-omission-not-verified".into());
            }
            eprintln!(
                "PRODUCTION_OWNED_HTTPS_DOM=PASS visited={} elements={} generation={} omitted_sensitive_fields={} controls=closed-states-only",
                dom.visited,
                dom.elements.len(),
                dom.page_generation,
                dom.omitted_fields,
            );
            let first = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                browser.observe_closed_snapshot(),
            )
            .await
            .map_err(|_| "owned-https-first-reference-snapshot-deadline".to_owned())??;
            if first.page_generation != dom.page_generation
                || first.browser_session_id != browser.nonce
                || first.url != "https://127.0.0.1/"
                || first.origin != "https://127.0.0.1"
                || !first.truncated
                || first.elements.len() != dom.elements.len()
                || !first.elements.iter().zip(&dom.elements).all(|(snapshot, native)| {
                    snapshot.depth == native.depth
                        && snapshot.heading_level == native.heading_level
                })
                || !first.elements.iter().any(|item| {
                    item.role == SemanticRole::Heading && item.heading_level == Some(1)
                })
                || !first.title.is_empty()
                || !first.visible_text.is_empty()
                || first.elements.iter().any(|item| {
                    item.element_ref.len() != 48
                        || !item.element_ref.bytes().all(|b| b.is_ascii_hexdigit())
                        || !item.accessible_name.is_empty()
                        || item.href.is_some()
                        || item.form_target.is_some()
                        || item.form_method.is_some()
                })
            {
                return Err("owned-https-opaque-reference-snapshot-bounds-or-privacy-invalid".into());
            }
            let first_ref = ActionTarget {
                browser_session_id: first.browser_session_id.clone(),
                page_id: first.page_id.clone(),
                page_generation: first.page_generation,
                snapshot_id: first.snapshot_id.clone(),
                element_ref: first.elements[0].element_ref.clone(),
            };
            let second = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                browser.observe_closed_snapshot(),
            )
            .await
            .map_err(|_| "owned-https-second-reference-snapshot-deadline".to_owned())??;
            if first.snapshot_id == second.snapshot_id
                || first.elements[0].element_ref == second.elements[0].element_ref
                || browser
                    .verify_closed_reference_without_execution_for_test(first_ref)
                    .unwrap_err()
                    != "STALE_ELEMENT"
            {
                return Err("owned-https-reobserved-old-reference-not-stale".into());
            }
            let fresh = second
                .elements
                .iter()
                .find(|item| {
                    item.state.visible == Some(true) && item.state.enabled == Some(true)
                })
                .ok_or("owned-https-current-visible-element-not-observed")?;
            let fresh_ref = ActionTarget {
                browser_session_id: second.browser_session_id.clone(),
                page_id: second.page_id.clone(),
                page_generation: second.page_generation,
                snapshot_id: second.snapshot_id.clone(),
                element_ref: fresh.element_ref.clone(),
            };
            browser
                .verify_closed_reference_without_execution_for_test(fresh_ref.clone())
                .map_err(|_| "owned-https-current-reference-not-recognized")?;
            // Optional next-stage physical assertion: only the native-held
            // PreparedAction.observed_serial and authenticated COM order may
            // select a read-only exact element recheck. No live action is
            // dispatched and no model ordinal/selector is accepted.
            let rechecked = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                browser.recheck_closed_reference_for_test(fresh_ref.clone()),
            )
            .await
            .map_err(|_| "owned-https-exact-recheck-deadline".to_owned())??;
            if !rechecked {
                return Err("owned-https-native-exact-element-recheck-stale".into());
            }
            eprintln!(
                "PRODUCTION_OWNED_HTTPS_SNAPSHOT_REF=PASS page_generation={} elements={} stale_previous=STALE_ELEMENT fresh_reference=accepted_without_execution native_exact_recheck=ACCEPTED private_values=withheld",
                second.page_generation,
                second.elements.len()
            );
            Ok::<_, String>(fresh_ref)
        }
        .await;
        let cleanup = browser.shutdown();
        assert!(cleanup.is_ok(), "real Job/UDF/profile cleanup: {cleanup:?}");
        let previously_live =
            outcome.expect("real production COM must receive all owned HTTPS resources and DOM");
        assert_eq!(
            browser
                .verify_closed_reference_without_execution_for_test(previously_live)
                .unwrap_err(),
            "STALE",
            "closed owned session must reject every formerly live reference"
        );
        eprintln!(
            "PRODUCTION_OWNED_HTTPS_READ_ONLY=PASS four native COM resources, TF3 TLS, structural DOM, owned Job/UDF; UNTRUSTED_JAVASCRIPT=DISABLED"
        );
    }

    /// ONE independent physical cancellation/close probe: the *production*
    /// zero-network AppContainer/WebView2 COM host must originate a real
    /// deferred document GET, the existing parent must reach native TF3 HTTPS
    /// transport, and the separately owned TLS server must accept that exact
    /// request but deliberately withhold the response. Dropping the still-
    /// pending parent flight invokes its existing Job-killing cancellation
    /// fence; shutdown then independently proves process count zero, removed
    /// UDF and successful native AppContainer profile deletion. No synthetic
    /// COM ACK, fixture-only child, second executor, or production exception.
    ///
    /// Explicitly run only this new ignored test while a distinct terminal
    /// serves Run-Tf4OwnedHttpsFixture.ps1 -Action Serve
    /// -PendingDocumentDelayMilliseconds 2500. Stop that fixture with its
    /// printed -RunId even if the test fails; the server's finally cleans
    /// CurrentUser certificate, CNG key, DER and run-scoped signal.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit production AppContainer/WebView2 pending COM document cancellation: requires unique delayed owned HTTPS fixture and RunId Stop"]
    async fn physical_production_owned_https_pending_document_cancel_close_no_replay() {
        use std::time::Duration;

        assert_eq!(
            std::env::var("CLACK_TF4_PENDING_DOCUMENT_CANCEL").as_deref(),
            Ok("1"),
            "explicit CLACK_TF4_PENDING_DOCUMENT_CANCEL=1 required"
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let evidence = manifest.join("target").join("tf4-owned-https");
        let expected_cert = evidence.join("server.cer");
        let supplied_cert = std::env::var_os("CLACK_TF4_OWNED_HTTPS_CERT")
            .map(PathBuf::from)
            .expect("exact live owned fixture DER path required");
        assert_eq!(
            std::fs::canonicalize(&supplied_cert).expect("live fixture public cert"),
            std::fs::canonicalize(&expected_cert).expect("owned server.cer present"),
            "never accept an arbitrary certificate or unrelated TLS fixture"
        );
        let run_id = std::fs::read_to_string(evidence.join("active.run"))
            .expect("active owned fixture RunId")
            .trim()
            .to_owned();
        assert!(
            run_id.len() == 32
                && run_id.bytes().all(|c| c.is_ascii_hexdigit())
                && run_id == run_id.to_ascii_lowercase(),
            "invalid scoped active RunId"
        );
        let signal = evidence.join(format!("pending-document-{run_id}.signal"));
        assert!(
            !signal.exists(),
            "pending signal pre-existed; use a fresh RunId and dedicated fixture"
        );
        let certificate = reqwest::Certificate::from_der(
            &std::fs::read(&expected_cert).expect("owned public DER readable"),
        )
        .expect("owned public DER decodes");

        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("exact feature-enabled production host required");
        let host_sha256 = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read production host"))
        );
        // Dedicated self-cleaning parent; no reuse of the accepted 8+9
        // multi-resource test's browser profile or temporary directory.
        let parent = tempfile::Builder::new()
            .prefix("tf4-owned-pending-close-")
            .tempdir_in(manifest.join("target"))
            .expect("unique owned temporary browser parent");
        let workspace = manifest.parent().expect("project workspace");
        let registry = WorkspaceRegistry::default();
        registry.authorize(workspace).expect("approve workspace");
        let web = TfWebState::default();
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-owned-pending-cancel".into(),
                session_id: format!("tf4-pending-close-{}", &run_id[..12]),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/".into(),
                private_parent: parent.path().to_path_buf(),
                host_executable: host,
                host_sha256,
            },
            &registry,
        )
        .expect("real production zero-network-capability AppContainer launched");
        let ready = tokio::time::timeout(Duration::from_secs(18), browser.verify_ready())
            .await
            .expect("real COM / process readiness deadline");
        if let Err(reason) = ready {
            let cleanup = browser.shutdown();
            panic!("real production host readiness: {reason}; cleanup: {cleanup:?}");
        }

        // Poll the *actual* production COM -> ChildGet -> TF3 HTTPS future.
        // A fixture marker can only be written after an authenticated TLS
        // request for / reaches the server, before the delayed HTTP body.
        // The pending future MUST NOT finish while this marker first appears.
        let mut flight =
            Box::pin(browser.serve_one_owned_https_for_test(&registry, &web, &certificate));
        let deadline = tokio::time::Instant::now() + Duration::from_secs(12);
        loop {
            assert!(
                tokio::time::Instant::now() < deadline,
                "real COM pending-document/TF3 fixture signal not observed"
            );
            tokio::select! {
                finished = &mut flight => {
                    panic!("document COM/TF3 completed before the required delayed pending signal: {finished:?}");
                }
                _ = tokio::time::sleep(Duration::from_millis(25)) => {}
            }
            match std::fs::read(&signal) {
                Ok(bytes) => {
                    assert_eq!(
                        bytes.as_slice(),
                        b"D",
                        "exactly one physically accepted real pending document GET"
                    );
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => panic!("pending document TLS signal unreadable: {e}"),
            }
        }
        // Cancelling the still-pending parent future drops FlightFence:
        // terminate the original constrained Job. Do NOT claim COM Complete;
        // instead prove no success ACK, unsafe fallback or later reuse occurs.
        drop(flight);
        let closed = browser.shutdown();
        assert!(
            closed.is_ok(),
            "owned Job/UDF/profile cancellation cleanup: {closed:?}"
        );
        browser
            .verify_cancelled_document_shutdown_for_test(1)
            .expect("same original Job active count zero, profile deleted, UDF gone");
        assert!(
            parent
                .path()
                .read_dir()
                .expect("inspect test-only parent")
                .next()
                .is_none(),
            "no child UDF/browser working-directory residue"
        );
        // The server's maximum authorized delay is 3.5 seconds. Observing
        // after that bound proves the only accepted document GET was not
        // replayed by stale callbacks, pipe workers or parent retries.
        tokio::time::sleep(Duration::from_millis(4_100)).await;
        assert_eq!(
            std::fs::read(&signal).expect("live RunId signal before explicit Stop"),
            b"D",
            "late or duplicate document GET after native cancel/shutdown"
        );
        assert!(
            browser
                .serve_one_owned_https_for_test(&registry, &web, &certificate)
                .await
                .is_err(),
            "closed browser session must reject late/replayed resource work"
        );
        browser
            .verify_cancelled_document_shutdown_for_test(1)
            .expect("zero process/profile/UDF residue still holds after late window");
        eprintln!(
            "PRODUCTION_OWNED_PENDING_HTTPS_CANCEL=PASS original AppContainer/WebView2 COM deferral pending, one delayed TF3 TLS GET, cancelled FlightFence, JobActive=0, UDF=absent, AppContainerProfile=deleted, late/duplicate GET=0, no COM Complete claim; FIXTURE_RUN_ID={run_id} stop via Run-Tf4OwnedHttpsFixture.ps1 -Action Stop -RunId {run_id}"
        );
    }

    /// Separate opt-in physical read-only identity recheck: a deliberately
    /// minimal one-document HTTPS fixture, NOT the previously accepted 8+9
    /// multi-resource fixture. The original *production* zero-network host
    /// issues exactly one WebView2 GetDeferral -> TF3 HTTPS GET -> COM ACK.
    /// A held native COM snapshot is rechecked via authenticated v2 sealed
    /// pipe without JS action, selectors, model ordinal or mutation.
    ///
    /// Start -MinimalRecheckDocument in a separate terminal, set the same
    /// explicit host and public DER env vars, run only this ignored test,
    /// and STOP the displayed fixture RunId, including on failure.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "explicit separate single-document production WebView2 native exact-element recheck; RunId-scoped owned HTTPS minimal fixture required"]
    async fn physical_production_owned_https_one_document_exact_element_recheck() {
        use std::time::Duration;

        // A separate, deliberate debug-host acceptance variant of this
        // one-document test. Absent by default; the fixed H1 replacement
        // hook is excluded from optimized production host builds.
        let physical_replacement =
            std::env::var("CLACK_TF4_EXACT_DOM_MUTATION").as_deref() == Ok("1");

        assert_eq!(
            std::env::var("CLACK_TF4_EXACT_ELEMENT_RECHECK").as_deref(),
            Ok("1"),
            "explicit CLACK_TF4_EXACT_ELEMENT_RECHECK=1 required"
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let evidence = manifest.join("target").join("tf4-owned-https");
        let expected_cert = evidence.join("server.cer");
        let supplied_cert = std::env::var_os("CLACK_TF4_OWNED_HTTPS_CERT")
            .map(PathBuf::from)
            .expect("exact live owned fixture DER required");
        assert_eq!(
            std::fs::canonicalize(&supplied_cert).expect("live fixture public cert"),
            std::fs::canonicalize(&expected_cert).expect("expected owned server.cer"),
            "no arbitrary trust anchor"
        );
        let cert = reqwest::Certificate::from_der(
            &std::fs::read(&expected_cert).expect("owned public DER bytes"),
        )
        .expect("valid native public DER");
        let run_id = std::fs::read_to_string(evidence.join("active.run"))
            .expect("active owned fixture RunId")
            .trim()
            .to_owned();
        assert!(
            run_id.len() == 32
                && run_id == run_id.to_ascii_lowercase()
                && run_id.bytes().all(|c| c.is_ascii_hexdigit()),
            "invalid active fixture RunId"
        );
        let host = std::env::var_os("CLACK_TF4_NATIVE_PROBE_HOST")
            .map(PathBuf::from)
            .expect("feature-enabled production WebView2 host path required");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&host).expect("read exact production host"))
        );
        let parent = tempfile::Builder::new()
            .prefix("tf4-owned-exact-recheck-")
            .tempdir_in(manifest.join("target"))
            .expect("new dedicated owned browser parent");
        let workspace = manifest.parent().expect("project root");
        let registry = WorkspaceRegistry::default();
        registry
            .authorize(workspace)
            .expect("authorize only test workspace");
        let web = TfWebState::default();
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-owned-exact-readonly".into(),
                session_id: format!("tf4-exact-recheck-{}", &run_id[..12]),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/".into(),
                private_parent: parent.path().to_path_buf(),
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("real production zero-network AppContainer/Job launch");
        let outcome = async {
            tokio::time::timeout(Duration::from_secs(18), browser.verify_ready())
                .await
                .map_err(|_| "exact-recheck-native-readiness-timeout".to_owned())??;
            let resource = tokio::time::timeout(
                Duration::from_secs(17),
                browser.serve_one_owned_https_for_test(&registry, &web, &cert),
            )
            .await
            .map_err(|_| "exact-recheck-single-document-timeout".to_owned())??;
            let tf3 = resource
                .tf3
                .as_ref()
                .ok_or("exact-recheck-missing-real-tf3-receipt")?;
            if resource.request_id != 1
                || resource.terminal != "completed"
                || !resource.native_com_completed
                || resource.bytes == 0
                || tf3.terminal != "completed"
                || tf3.reason_code != "ok"
                || tf3.status_code != Some(200)
                || tf3.tls_state != "https_transport_observed"
                || tf3.requested_url.as_deref() != Some("https://127.0.0.1/")
                || tf3.content_type.as_deref() != Some("text/html")
                || tf3.dns_evidence.len() != 1
                || tf3.dns_evidence[0].host != "127.0.0.1"
                || tf3.dns_evidence[0].classification != "all-allowed"
            {
                return Err("exact-recheck-real-com-tf3-document-not-attested".into());
            }
            // Minimal HTML has NO CSS/JS/images/fonts/iframe; only the
            // original single network document is needed for native DOM.
            tokio::time::sleep(Duration::from_millis(350)).await;
            let first =
                tokio::time::timeout(Duration::from_secs(10), browser.observe_closed_snapshot())
                    .await
                    .map_err(|_| "exact-recheck-first-com-snapshot-timeout".to_owned())??;
            let heading = first
                .elements
                .iter()
                .find(|e| e.role == SemanticRole::Heading && e.heading_level == Some(1))
                .ok_or("exact-recheck-real-heading-not-observed")?;
            let first_ref = ActionTarget {
                browser_session_id: first.browser_session_id.clone(),
                page_id: first.page_id.clone(),
                page_generation: first.page_generation,
                snapshot_id: first.snapshot_id.clone(),
                element_ref: heading.element_ref.clone(),
            };
            let accepted = tokio::time::timeout(
                Duration::from_secs(10),
                browser.recheck_closed_reference_for_test(first_ref.clone()),
            )
            .await
            .map_err(|_| "exact-recheck-native-com-deadline".to_owned())??;
            if !accepted {
                return Err("exact-recheck-current-real-com-element-was-stale".into());
            }
            if physical_replacement {
                #[cfg(not(debug_assertions))]
                return Err("exact-recheck-debug-replacement-unavailable-in-release".into());
                #[cfg(debug_assertions)]
                {
                // This dispatches ONLY the debug-host's fixed, one-shot,
                // exact-loopback retained-H1 replacement. No arbitrary page
                // script, selector, tag, value or model command is accepted.
                tokio::time::timeout(
                    Duration::from_secs(10),
                    browser.replace_owned_heading_for_test(first_ref.clone()),
                )
                .await
                .map_err(|_| "exact-recheck-debug-replacement-deadline".to_owned())??;
                let still_original = tokio::time::timeout(
                    Duration::from_secs(10),
                    browser.recheck_closed_reference_for_test(first_ref.clone()),
                )
                .await
                .map_err(|_| "exact-recheck-post-mutation-com-deadline".to_owned())??;
                if still_original {
                    return Err("exact-recheck-replaced-node-resolved-successor".into());
                }
                eprintln!(
                    "PRODUCTION_NATIVE_SAME_INDEX_REPLACEMENT=PASS original heading native COM retained node replaced by same H1 tag at same parent position, original exact node STALE, no selector fallback or untrusted page JS"
                );
                }
            }
            // A SECOND authenticated native observation invalidates the
            // previous opaque snapshot. No model action or page mutation.
            let second =
                tokio::time::timeout(Duration::from_secs(10), browser.observe_closed_snapshot())
                    .await
                    .map_err(|_| "exact-recheck-reobservation-timeout".to_owned())??;
            if first.snapshot_id == second.snapshot_id
                || browser
                    .recheck_closed_reference_for_test(first_ref.clone())
                    .await
                    .unwrap_err()
                    != "STALE_ELEMENT"
            {
                return Err("exact-recheck-old-reference-not-stale-after-reobservation".into());
            }
            let current = second
                .elements
                .iter()
                .find(|e| e.role == SemanticRole::Heading && e.heading_level == Some(1))
                .ok_or("exact-recheck-second-real-heading-unavailable")?;
            let current_ref = ActionTarget {
                browser_session_id: second.browser_session_id.clone(),
                page_id: second.page_id.clone(),
                page_generation: second.page_generation,
                snapshot_id: second.snapshot_id.clone(),
                element_ref: current.element_ref.clone(),
            };
            if !tokio::time::timeout(
                Duration::from_secs(10),
                browser.recheck_closed_reference_for_test(current_ref.clone()),
            )
            .await
            .map_err(|_| "exact-recheck-fresh-com-deadline".to_owned())??
            {
                return Err("exact-recheck-reobserved-current-element-stale".into());
            }
            Ok::<_, String>((first_ref, current_ref))
        }
        .await;
        let closed = browser.shutdown();
        assert!(
            closed.is_ok(),
            "production one-document recheck Job/UDF/profile cleanup: {closed:?}"
        );
        let (old_ref, current_ref) =
            outcome.expect("real production read-only exact COM element recheck must pass");
        browser
            .verify_clean_readonly_close_for_test(1)
            .expect("one GET; native Job0, host exit, removed UDF/profile");
        assert!(
            parent
                .path()
                .read_dir()
                .expect("inspect owned parent residue")
                .next()
                .is_none(),
            "no owned browser profile/UDF working directories"
        );
        for target in [old_ref, current_ref] {
            assert_eq!(
                browser
                    .verify_closed_reference_without_execution_for_test(target.clone())
                    .unwrap_err(),
                "STALE",
                "closed session has no future native element authority"
            );
            assert!(
                browser
                    .recheck_closed_reference_for_test(target)
                    .await
                    .is_err(),
                "closed session cannot issue new COM observation/recheck"
            );
        }
        eprintln!(
            "PRODUCTION_OWNED_EXACT_ELEMENT_RECHECK=PASS original production AppContainer/WebView2 COM+TF3 TLS one document, exact PreparedAction serial/ordinal read-only native recheck ACCEPTED twice, stale prior snapshot after reobservation, close stale, JobActive=0, UDF=absent, profile=deleted, no click/selector/JS action; FIXTURE_RUN_ID={run_id} stop via Run-Tf4OwnedHttpsFixture.ps1 -Action Stop -RunId {run_id}"
        );
        if physical_replacement {
            eprintln!("PRODUCTION_OWNED_EXACT_DOM_MUTATION=PASS native one-shot debug-controlled same-index replacement, old exact recheck STALE, fresh authenticated snapshot ACCEPTED, clean Job/UDF/profile; RELEASE_HOOK=ABSENT");
        }
    }

    /// Distinct physical WebView2/AppContainer/COM/TF3 native activation probe.
    /// The parent grant is explicitly TEST-ONLY, not central Tool Fabric
    /// approval. An actual GET /clicked (separate from its dispatch ACK) is
    /// needed to prove page navigation. Never call this production acceptance.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "opt-in separate owned HTTPS two-page real WebView2 exact-node programmatic click; NOT central-policy approval or 17-step E2E"]
    async fn physical_production_owned_https_exact_click_navigation_probe() {
        use crate::modules::net::tf_browser_contract::NativeEffectTerminal;
        use std::time::Duration;
        assert_eq!(
            std::env::var("CLACK_TF4_OWNED_NATIVE_CLICK").as_deref(),
            Ok("1")
        );
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let evidence = manifest.join("target").join("tf4-owned-https");
        let canonical =
            std::fs::canonicalize(evidence.join("server.cer")).expect("live fixture public DER");
        assert_eq!(
            std::fs::canonicalize(
                std::env::var("CLACK_TF4_OWNED_HTTPS_CERT").expect("run-scoped public DER path")
            )
            .unwrap(),
            canonical
        );
        let cert = reqwest::Certificate::from_der(&std::fs::read(&canonical).unwrap())
            .expect("owned DER certificate");
        let run_id = std::fs::read_to_string(evidence.join("active.run"))
            .expect("run-scoped active fixture")
            .trim()
            .to_owned();
        assert!(run_id.len() == 32 && run_id.bytes().all(|b| b.is_ascii_hexdigit()));
        let host = PathBuf::from(
            std::env::var("CLACK_TF4_NATIVE_PROBE_HOST").expect("actual feature-enabled host path"),
        );
        let digest = format!("{:x}", Sha256::digest(std::fs::read(&host).unwrap()));
        let parent = tempfile::Builder::new()
            .prefix("tf4-native-click-")
            .tempdir_in(manifest.join("target"))
            .unwrap();
        let workspace = manifest.parent().unwrap();
        let registry = WorkspaceRegistry::default();
        registry.authorize(workspace).expect("owned workspace only");
        let web = TfWebState::default();
        let mut browser = BrowserRuntimeSession::launch(
            BrowserRuntimeStart {
                actor: "tf4-owned-click-test-only".into(),
                session_id: format!("tf4-click-{}", &run_id[..12]),
                workspace_root: workspace.to_path_buf(),
                initial_url: "https://127.0.0.1/".into(),
                private_parent: parent.path().to_path_buf(),
                host_executable: host,
                host_sha256: digest,
            },
            &registry,
        )
        .expect("real isolated AppContainer WebView2 host");
        let result = async {
            tokio::time::timeout(Duration::from_secs(18), browser.verify_ready())
                .await
                .map_err(|_| "click-native-ready-deadline")??;
            let first = tokio::time::timeout(
                Duration::from_secs(17),
                browser.serve_one_owned_https_for_test(&registry, &web, &cert),
            )
            .await
            .map_err(|_| "click-initial-document-deadline")??;
            if first.request_id != 1
                || first.terminal != "completed"
                || !first.native_com_completed
                || first.tf3.as_ref().is_none_or(|tf3| {
                    tf3.status_code != Some(200)
                        || tf3.requested_url.as_deref() != Some("https://127.0.0.1/")
                })
            {
                return Err("click-initial-native-document-not-attested".into());
            }
            tokio::time::sleep(Duration::from_millis(350)).await;
            let snapshot =
                tokio::time::timeout(Duration::from_secs(10), browser.observe_closed_snapshot())
                    .await
                    .map_err(|_| "click-closed-native-snapshot-deadline")??;
            let link = snapshot
                .elements
                .iter()
                .find(|element| {
                    element.role == SemanticRole::Link
                        && element.state.enabled == Some(true)
                        && element.state.visible == Some(true)
                })
                .ok_or("click-live-link-not-observed")?;
            let target = ActionTarget {
                browser_session_id: snapshot.browser_session_id.clone(),
                page_id: snapshot.page_id.clone(),
                page_generation: snapshot.page_generation,
                snapshot_id: snapshot.snapshot_id.clone(),
                element_ref: link.element_ref.clone(),
            };
            let native = tokio::time::timeout(
                Duration::from_secs(10),
                browser.exact_click_owned_fixture_for_test(target.clone()),
            )
            .await
            .map_err(|_| "click-actual-com-deadline")??;
            if native.terminal != NativeEffectTerminal::Dispatched
                || native.auto_retry
                || native.effect_state != "Unknown"
                || native.retry != "NEVER_REPLAY"
            {
                return Err(format!("click-dispatch-not-closed-ack: {:?}", native));
            }
            if browser
                .verify_closed_reference_without_execution_for_test(target)
                .is_ok()
            {
                return Err("click-consumed-native-reference-reusable".into());
            }
            let destination = tokio::time::timeout(
                Duration::from_secs(17),
                browser.serve_one_owned_https_for_test(&registry, &web, &cert),
            )
            .await
            .map_err(|_| "click-navigation-TF3-deadline")??;
            if destination.request_id != 2
                || destination.terminal != "completed"
                || !destination.native_com_completed
                || destination.tf3.as_ref().is_none_or(|tf3| {
                    tf3.requested_url.as_deref() != Some("https://127.0.0.1/clicked")
                        || tf3.status_code != Some(200)
                        || tf3.terminal != "completed"
                })
            {
                return Err("click-actual-navigation-TF3-not-observed".into());
            }
            Ok::<_, String>(())
        }
        .await;
        let close = browser.shutdown();
        assert!(
            close.is_ok(),
            "owned native click cleanup failed: {close:?}"
        );
        result
            .expect("actual WebView2 native programmatic click then independent TF3 /clicked GET");
        browser
            .verify_clean_readonly_close_for_test(2)
            .expect("two native GETs, Job0, host terminated, UDF/profile removed");
        assert!(parent.path().read_dir().unwrap().next().is_none());
        eprintln!("PRODUCTION_OWNED_EXACT_CLICK_NAVIGATION_PROBE=PASS real AppContainer/WebView2 COM retained exact link node programmatic DOM click, independent TF3 HTTPS GET /clicked, native Job0/UDF/profile clean; TEST-ONLY parent grant; NOT trusted pointer or central approval or full E2E; FIXTURE_RUN_ID={run_id}");
    }
}
