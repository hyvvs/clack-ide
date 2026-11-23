//! TF4 native browser interaction identity contract. This module does NOT
//! create a browser, register a Tauri command, grant network authority or
//! expose model tools. The production bridge must independently authenticate
//! its AppContainer host and TF3 broker before using this contract.
//!
//! References are random opaque handles bound to the exact native session,
//! page, generation, snapshot and observed element. No selector/text fallback.
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

const MAX_ELEMENTS: usize = 64;
const MAX_TEXT: usize = 32 * 1024;
const MAX_SNAPSHOT: usize = 64 * 1024;
const MAX_NAME: usize = 200;
const MAX_URL: usize = 2048;
const MAX_ACTION_TEXT: usize = 1024;
const MAX_SNAPSHOT_LIFETIME: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageIdentity {
    pub browser_session_id: String,
    pub page_id: String,
    pub page_generation: u64,
    pub url: String,
    pub origin: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SemanticRole {
    Link,
    Button,
    Textbox,
    Checkbox,
    Radio,
    Combobox,
    Option,
    Heading,
    Main,
    Paragraph,
    Image,
    Label,
    Other,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SemanticState {
    pub enabled: Option<bool>,
    pub checked: Option<bool>,
    pub selected: Option<bool>,
    pub expanded: Option<bool>,
    pub visible: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ObservedElement {
    // Native DOM bridge supplies a per-document serial, not a CSS selector.
    pub serial: u64,
    pub role: SemanticRole,
    /// Depth is bounded structural context, NOT a parent/node selector.
    /// Unknown intermediary tags and omitted sensitive nodes prevent any
    /// reliable inference of the immediate parent from snapshot adjacency.
    pub depth: u8,
    pub heading_level: Option<u8>,
    pub accessible_name: String,
    pub state: SemanticState,
    pub href: Option<String>,
    pub form_target: Option<String>,
    pub form_method: Option<String>,
    pub field_type: Option<String>,
    pub required: Option<bool>,
    pub has_script_handler: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticElement {
    pub element_ref: String,
    pub role: SemanticRole,
    pub depth: u8,
    pub heading_level: Option<u8>,
    pub accessible_name: String,
    pub state: SemanticState,
    pub href: Option<String>,
    pub form_target: Option<String>,
    pub form_method: Option<String>,
    pub field_type: Option<String>,
    pub required: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageSnapshot {
    pub browser_session_id: String,
    pub page_id: String,
    pub page_generation: u64,
    pub snapshot_id: String,
    pub url: String,
    pub origin: String,
    pub title: String,
    pub observed_at_ms: u64,
    pub visible_text: String,
    pub truncated: bool,
    pub elements: Vec<SemanticElement>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum BrowserEffect {
    ReadOnly,
    PotentialExternalWrite,
    DestructiveOrIrreversible,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BrowserActionKind {
    Inspect,
    Scroll,
    Click,
    Type,
    Clear,
    Select,
    Check,
    Uncheck,
    Submit,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ActionTarget {
    pub browser_session_id: String,
    pub page_id: String,
    pub page_generation: u64,
    pub snapshot_id: String,
    pub element_ref: String,
}

#[derive(Clone, Debug)]
pub(crate) struct PreparedAction {
    pub target: ActionTarget,
    /// Native-only exact observed index from the authenticated COM snapshot.
    /// Never use as a selector and never accept a caller-provided replacement.
    pub observed_serial: u64,
    pub effect: BrowserEffect,
    pub requires_approval: bool,
    pub kind: BrowserActionKind,
}

struct HeldElement {
    source: ObservedElement,
}

/// This is a single-page state machine, owned by one native browser session.
/// It does not accept page or element identity from a model as authority.
pub(crate) struct BrowserPageContract {
    live: PageIdentity,
    snapshot: Option<PageSnapshot>,
    snapshot_created: Option<Instant>,
    element_handles: HashMap<String, HeldElement>,
    closed: bool,
}

fn handle() -> Result<String, &'static str> {
    let mut random = [0u8; 24];
    getrandom::fill(&mut random).map_err(|_| "NATIVE_RANDOM_UNAVAILABLE")?;
    Ok(random.iter().map(|b| format!("{b:02x}")).collect())
}

fn valid_handle(id: &str) -> bool {
    id.len() == 48 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn safe_url(input: &str) -> Result<(String, String), &'static str> {
    if input.len() > MAX_URL || input.chars().any(char::is_control) {
        return Err("UNSAFE_URL");
    }
    let mut url = Url::parse(input).map_err(|_| "UNSAFE_URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("UNSAFE_URL");
    }
    for (name, _) in url.query_pairs() {
        if sensitive(&name) {
            return Err("SENSITIVE_URL");
        }
    }
    url.set_fragment(None);
    let origin = url.origin().ascii_serialization();
    Ok((url.to_string(), origin))
}

fn sensitive(text: &str) -> bool {
    let normalized = text.to_ascii_lowercase().replace(['-', '_', ' '], "");
    [
        "password",
        "passwd",
        "token",
        "secret",
        "credential",
        "authorization",
        "apikey",
        "privatekey",
        "sessionkey",
        "cookie",
        "bearer",
    ]
    .iter()
    .any(|term| normalized.contains(term))
}

fn bounded_label(input: &str) -> Result<String, &'static str> {
    if input.chars().any(char::is_control) || input.chars().count() > MAX_NAME {
        return Err("UNSAFE_SEMANTIC_NAME");
    }
    Ok(if sensitive(input) {
        "[redacted]".into()
    } else {
        input.to_owned()
    })
}

fn destructive_intent(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    [
        "delete",
        "remove account",
        "purchase",
        "checkout",
        "pay now",
        "send email",
        "send message",
        "publish",
        "cancel subscription",
        "unsubscribe",
        "transfer funds",
        "permanently",
        "terminate account",
    ]
    .iter()
    .any(|term| lower.contains(term))
}

fn classify(kind: BrowserActionKind, item: Option<&ObservedElement>) -> BrowserEffect {
    use BrowserActionKind as A;
    use BrowserEffect as E;
    match kind {
        A::Inspect => E::ReadOnly,
        A::Scroll | A::Type | A::Clear | A::Select | A::Check | A::Uncheck => {
            // Scrolling can fire scroll/intersection handlers just as typing
            // fires input/change handlers. Neither operation is inherently
            // read-only once untrusted page scripts are allowed. The native
            // implementation must prove its execution mode and invoke central
            // policy rather than silently treating scroll as harmless.
            // The separate central policy and actual broker must decide.
            E::Unknown
        }
        A::Submit | A::Click => {
            let Some(i) = item else {
                return E::Unknown;
            };
            let intent = format!(
                "{} {} {}",
                i.accessible_name,
                i.href.as_deref().unwrap_or(""),
                i.form_target.as_deref().unwrap_or("")
            );
            if destructive_intent(&intent) {
                E::DestructiveOrIrreversible
            } else if kind == A::Submit
                || i.form_target.is_some()
                || i.form_method
                    .as_deref()
                    .is_some_and(|m| !m.eq_ignore_ascii_case("GET"))
            {
                E::PotentialExternalWrite
            } else {
                // Native DOM attributes cannot prove absence of JS-registered
                // event listeners or a server-side GET mutation. A link is
                // NOT automatically a harmless click; central TF policy must
                // approve or reject the unknown external effect.
                E::Unknown
            }
        }
    }
}

impl BrowserPageContract {
    pub(crate) fn new(browser_session_id: String, url: &str) -> Result<Self, &'static str> {
        if !valid_handle(&browser_session_id) {
            return Err("INVALID_BROWSER_SESSION");
        }
        let (url, origin) = safe_url(url)?;
        Ok(Self {
            live: PageIdentity {
                browser_session_id,
                page_id: handle()?,
                page_generation: 1,
                url,
                origin,
            },
            snapshot: None,
            snapshot_created: None,
            element_handles: HashMap::new(),
            closed: false,
        })
    }

    pub(crate) fn identity(&self) -> &PageIdentity {
        &self.live
    }

    /// Call at navigation/reload/major DOM replacement or popup transition,
    /// BEFORE dispatching any new page operation.
    pub(crate) fn invalidate_page(&mut self, next_url: &str) -> Result<(), &'static str> {
        if self.closed {
            return Err("STALE_SESSION");
        }
        let (url, origin) = safe_url(next_url)?;
        self.live.page_generation = self
            .live
            .page_generation
            .checked_add(1)
            .ok_or("GENERATION_EXHAUSTED")?;
        self.live.page_id = handle()?;
        self.live.url = url;
        self.live.origin = origin;
        self.snapshot = None;
        self.snapshot_created = None;
        self.element_handles.clear();
        Ok(())
    }

    pub(crate) fn close(&mut self) {
        self.closed = true;
        self.revoke_snapshot();
    }

    /// Any native observation attempt (including a failed or cancelled one)
    /// revokes all element capabilities from earlier observations. Re-issuing
    /// a snapshot never turns an old reference into a valid new one.
    pub(crate) fn revoke_snapshot(&mut self) {
        self.snapshot = None;
        self.snapshot_created = None;
        self.element_handles.clear();
    }

    /// `observed_generation` and URL must come from the authenticated native
    /// WebView2 process after an actual DOM observation; never from model input.
    pub(crate) fn observe(
        &mut self,
        observed_generation: u64,
        observed_url: &str,
        title: &str,
        visible_text: &str,
        elements: Vec<ObservedElement>,
        observed_at_ms: u64,
    ) -> Result<&PageSnapshot, &'static str> {
        if self.closed {
            return Err("STALE_SESSION");
        }
        // Any new observation attempt invalidates all older action targets,
        // including when native generation/source validation subsequently
        // fails. A denied observation must never leave prior references live.
        self.revoke_snapshot();
        let (url, origin) = safe_url(observed_url)?;
        if observed_generation != self.live.page_generation
            || url != self.live.url
            || origin != self.live.origin
        {
            return Err("STALE_PAGE");
        }
        if title.chars().any(char::is_control)
            || title.len() > 256
            || visible_text.len() > MAX_TEXT
            || visible_text
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\t')
            || elements.len() > MAX_ELEMENTS
            || observed_at_ms == 0
        {
            return Err("SNAPSHOT_BOUNDS_INVALID");
        }
        let mut seen = std::collections::HashSet::new();
        let mut handles = HashMap::new();
        let mut snapshot_elements = Vec::with_capacity(elements.len());
        for source in elements {
            if source.serial == 0 || !seen.insert(source.serial) {
                return Err("ELEMENT_IDENTITY_INVALID");
            }
            if source.depth > 16
                || (source.role == SemanticRole::Heading
                    && !matches!(source.heading_level, Some(1..=6)))
                || (source.role != SemanticRole::Heading && source.heading_level.is_some())
            {
                return Err("ELEMENT_METADATA_INVALID");
            }
            let accessible_name = bounded_label(&source.accessible_name)?;
            let href = source
                .href
                .as_deref()
                .map(safe_url)
                .transpose()?
                .map(|pair| pair.0);
            let form_target = source
                .form_target
                .as_deref()
                .map(safe_url)
                .transpose()?
                .map(|pair| pair.0);
            if source
                .form_method
                .as_deref()
                .is_some_and(|m| !matches!(m, "GET" | "POST"))
                || source.field_type.as_deref().is_some_and(|t| {
                    t.len() > 24 || !t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                })
            {
                return Err("ELEMENT_METADATA_INVALID");
            }
            let element_ref = handle()?;
            snapshot_elements.push(SemanticElement {
                element_ref: element_ref.clone(),
                role: source.role.clone(),
                depth: source.depth,
                heading_level: source.heading_level,
                accessible_name,
                state: source.state.clone(),
                href,
                form_target,
                form_method: source.form_method.clone(),
                field_type: source.field_type.clone(),
                required: source.required,
            });
            handles.insert(element_ref, HeldElement { source });
        }
        let snapshot = PageSnapshot {
            browser_session_id: self.live.browser_session_id.clone(),
            page_id: self.live.page_id.clone(),
            page_generation: self.live.page_generation,
            snapshot_id: handle()?,
            url: self.live.url.clone(),
            origin: self.live.origin.clone(),
            title: bounded_label(title)?,
            observed_at_ms,
            visible_text: if sensitive(visible_text) {
                "[redacted]".into()
            } else {
                visible_text.to_owned()
            },
            truncated: false,
            elements: snapshot_elements,
        };
        if serde_json::to_vec(&snapshot)
            .map_err(|_| "SNAPSHOT_SERIALIZATION_FAILED")?
            .len()
            > MAX_SNAPSHOT
        {
            return Err("SNAPSHOT_BOUNDS_INVALID");
        }
        self.element_handles = handles;
        self.snapshot = Some(snapshot);
        // A monotonic native-owner lifetime: never trust the page's clock or
        // its claimed observedAtMs to keep old actionable refs alive.
        self.snapshot_created = Some(Instant::now());
        Ok(self.snapshot.as_ref().expect("just stored"))
    }

    /// Record that the authenticated native walker withheld sensitive fields
    /// or reached its bounds. A partial snapshot remains partial in the
    /// authoritative held state, not merely in a returned display copy.
    pub(crate) fn mark_snapshot_truncated(
        &mut self,
        truncated: bool,
    ) -> Result<&PageSnapshot, &'static str> {
        let snapshot = self.snapshot.as_mut().ok_or("STALE_ELEMENT")?;
        snapshot.truncated = truncated;
        if serde_json::to_vec(snapshot)
            .map_err(|_| "SNAPSHOT_SERIALIZATION_FAILED")?
            .len()
            > MAX_SNAPSHOT
        {
            self.revoke_snapshot();
            return Err("SNAPSHOT_BOUNDS_INVALID");
        }
        Ok(self.snapshot.as_ref().expect("validated snapshot"))
    }

    pub(crate) fn prepare_action(
        &self,
        kind: BrowserActionKind,
        target: ActionTarget,
        text: Option<&str>,
    ) -> Result<PreparedAction, &'static str> {
        if self.closed {
            return Err("STALE_SESSION");
        }
        if self
            .snapshot_created
            .is_none_or(|when| when.elapsed() > MAX_SNAPSHOT_LIFETIME)
        {
            return Err("STALE_ELEMENT");
        }
        let snapshot = self.snapshot.as_ref().ok_or("STALE_ELEMENT")?;
        if target.browser_session_id != self.live.browser_session_id
            || target.page_id != self.live.page_id
            || target.page_generation != self.live.page_generation
            || target.snapshot_id != snapshot.snapshot_id
        {
            return Err("STALE_ELEMENT");
        }
        let item = self
            .element_handles
            .get(&target.element_ref)
            .ok_or("STALE_ELEMENT")?;
        // Inspect only checks an existing opaque identity; disabled/hidden
        // controls still have observable state. Actionable gestures must not
        // use that exception to bypass visibility or disabled gating.
        if kind != BrowserActionKind::Inspect
            && (item.source.state.visible == Some(false)
                || item.source.state.enabled == Some(false))
        {
            return Err("ELEMENT_NOT_ACTIONABLE");
        }
        if matches!(kind, BrowserActionKind::Type | BrowserActionKind::Clear) {
            if !matches!(item.source.role, SemanticRole::Textbox) {
                return Err("ELEMENT_TYPE_UNSUPPORTED");
            }
            let field_type = item.source.field_type.as_deref().unwrap_or("unknown");
            if !matches!(
                field_type,
                "text" | "search" | "email" | "number" | "tel" | "url" | "textarea"
            ) {
                return Err("SECRET_OR_UNKNOWN_FIELD_DENIED");
            }
            if kind == BrowserActionKind::Type
                && text.is_none_or(|t| {
                    t.is_empty() || t.len() > MAX_ACTION_TEXT || t.chars().any(char::is_control)
                })
            {
                return Err("INVALID_ACTION_TEXT");
            }
        }
        match kind {
            BrowserActionKind::Select if item.source.role != SemanticRole::Combobox => {
                return Err("ELEMENT_TYPE_UNSUPPORTED");
            }
            BrowserActionKind::Check
                if !matches!(
                    item.source.role,
                    SemanticRole::Checkbox | SemanticRole::Radio
                ) =>
            {
                return Err("ELEMENT_TYPE_UNSUPPORTED");
            }
            // Native radio controls have no independent uncheck gesture.
            // Unchecking a radio would require choosing a different exact
            // group member, which is a separately approved Select/Check.
            BrowserActionKind::Uncheck if item.source.role != SemanticRole::Checkbox => {
                return Err("ELEMENT_TYPE_UNSUPPORTED");
            }
            _ => {}
        }
        let effect = classify(kind, Some(&item.source));
        Ok(PreparedAction {
            target,
            observed_serial: item.source.serial,
            effect,
            requires_approval: effect != BrowserEffect::ReadOnly,
            kind,
        })
    }

    /// Called after the native callback, before claiming an observed effect.
    /// A changed page makes completion UNKNOWN, never retryable automatically.
    pub(crate) fn verify_completion(&self, action: &PreparedAction) -> Result<(), &'static str> {
        if self.closed
            || self
                .snapshot_created
                .is_none_or(|when| when.elapsed() > MAX_SNAPSHOT_LIFETIME)
        {
            return Err("UNKNOWN_COMPLETION");
        }
        let page = &self.live;
        let a = &action.target;
        if page.browser_session_id != a.browser_session_id
            || page.page_id != a.page_id
            || page.page_generation != a.page_generation
            || self
                .snapshot
                .as_ref()
                .is_none_or(|s| s.snapshot_id != a.snapshot_id)
            || !self.element_handles.contains_key(&a.element_ref)
        {
            return Err("UNKNOWN_COMPLETION");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session() -> BrowserPageContract {
        BrowserPageContract::new("a".repeat(48), "https://example.org/form").unwrap()
    }
    fn element(
        serial: u64,
        role: SemanticRole,
        name: &str,
        href: Option<&str>,
        form: Option<&str>,
        field_type: Option<&str>,
    ) -> ObservedElement {
        ObservedElement {
            serial,
            role,
            depth: 0,
            heading_level: None,
            accessible_name: name.into(),
            state: SemanticState {
                enabled: Some(true),
                visible: Some(true),
                ..Default::default()
            },
            href: href.map(str::to_owned),
            form_target: form.map(str::to_owned),
            form_method: None,
            field_type: field_type.map(str::to_owned),
            required: None,
            has_script_handler: false,
        }
    }
    fn target(page: &BrowserPageContract) -> ActionTarget {
        let s = page.snapshot.as_ref().unwrap();
        ActionTarget {
            browser_session_id: s.browser_session_id.clone(),
            page_id: s.page_id.clone(),
            page_generation: s.page_generation,
            snapshot_id: s.snapshot_id.clone(),
            element_ref: s.elements[0].element_ref.clone(),
        }
    }
    #[test]
    fn opaque_element_handles_reject_stale_snapshot_and_page_generations() {
        let mut p = session();
        p.observe(
            1,
            "https://example.org/form",
            "Safe page",
            "Welcome",
            vec![element(
                1,
                SemanticRole::Link,
                "Read",
                Some("https://example.org/next"),
                None,
                None,
            )],
            1,
        )
        .unwrap();
        let original = target(&p);
        let a = p
            .prepare_action(BrowserActionKind::Click, original.clone(), None)
            .unwrap();
        assert_eq!(a.observed_serial, 1);
        assert_eq!(a.effect, BrowserEffect::Unknown);
        assert!(a.requires_approval);
        assert!(p.verify_completion(&a).is_ok());
        p.observe(
            1,
            "https://example.org/form",
            "Safe page",
            "Next observation",
            vec![element(
                1,
                SemanticRole::Link,
                "Read",
                Some("https://example.org/next"),
                None,
                None,
            )],
            2,
        )
        .unwrap();
        assert_eq!(
            p.prepare_action(BrowserActionKind::Click, original.clone(), None)
                .unwrap_err(),
            "STALE_ELEMENT"
        );
        assert_eq!(p.verify_completion(&a).unwrap_err(), "UNKNOWN_COMPLETION");
        p.invalidate_page("https://example.org/next").unwrap();
        assert_eq!(
            p.prepare_action(BrowserActionKind::Click, original, None)
                .unwrap_err(),
            "STALE_ELEMENT"
        );
    }
    #[test]
    fn disabled_control_is_inspectable_but_never_actionable() {
        let mut p = session();
        let mut disabled = element(1, SemanticRole::Button, "", None, None, Some("button"));
        disabled.state.enabled = Some(false);
        p.observe(1, "https://example.org/form", "", "", vec![disabled], 1)
            .unwrap();
        let exact = target(&p);
        assert_eq!(
            p.prepare_action(BrowserActionKind::Inspect, exact.clone(), None)
                .unwrap()
                .effect,
            BrowserEffect::ReadOnly
        );
        assert_eq!(
            p.prepare_action(BrowserActionKind::Click, exact, None)
                .unwrap_err(),
            "ELEMENT_NOT_ACTIONABLE"
        );
    }
    #[test]
    fn check_uncheck_select_are_distinct_unknown_effects_with_exact_control_roles() {
        for (role, allowed) in [
            (SemanticRole::Checkbox, [true, true, false]),
            (SemanticRole::Radio, [true, false, false]),
            (SemanticRole::Combobox, [false, false, true]),
            (SemanticRole::Textbox, [false, false, false]),
        ] {
            let mut p = session();
            p.observe(
                1,
                "https://example.org/form",
                "",
                "",
                vec![element(1, role, "", None, None, None)],
                1,
            )
            .unwrap();
            for (action, supported) in [
                (BrowserActionKind::Check, allowed[0]),
                (BrowserActionKind::Uncheck, allowed[1]),
                (BrowserActionKind::Select, allowed[2]),
            ] {
                let found = p.prepare_action(action, target(&p), None);
                if supported {
                    let prepared = found.unwrap();
                    assert_eq!(prepared.effect, BrowserEffect::Unknown);
                    assert!(prepared.requires_approval);
                } else {
                    assert_eq!(found.unwrap_err(), "ELEMENT_TYPE_UNSUPPORTED");
                }
            }
        }
    }
    #[test]
    fn bounded_native_depth_and_heading_level_are_metadata_not_action_selectors() {
        let mut p = session();
        let mut heading = element(1, SemanticRole::Heading, "", None, None, None);
        heading.depth = 3;
        heading.heading_level = Some(2);
        p.observe(
            1,
            "https://example.org/form",
            "",
            "",
            vec![heading.clone()],
            1,
        )
        .unwrap();
        let displayed = &p.snapshot.as_ref().unwrap().elements[0];
        assert_eq!(displayed.depth, 3);
        assert_eq!(displayed.heading_level, Some(2));
        assert_eq!(displayed.role, SemanticRole::Heading);
        assert_eq!(
            p.prepare_action(BrowserActionKind::Inspect, target(&p), None)
                .unwrap()
                .effect,
            BrowserEffect::ReadOnly
        );
        heading.depth = 17;
        assert_eq!(
            p.observe(
                1,
                "https://example.org/form",
                "",
                "",
                vec![heading.clone()],
                2
            )
            .unwrap_err(),
            "ELEMENT_METADATA_INVALID"
        );
        heading.depth = 0;
        heading.heading_level = Some(7);
        assert_eq!(
            p.observe(
                1,
                "https://example.org/form",
                "",
                "",
                vec![heading.clone()],
                3
            )
            .unwrap_err(),
            "ELEMENT_METADATA_INVALID"
        );
        heading.role = SemanticRole::Paragraph;
        heading.heading_level = Some(2);
        assert_eq!(
            p.observe(1, "https://example.org/form", "", "", vec![heading], 4)
                .unwrap_err(),
            "ELEMENT_METADATA_INVALID"
        );
    }
    #[test]
    fn monotonic_snapshot_expiry_revokes_action_refs_without_late_effect_claims() {
        let mut p = session();
        p.observe(
            1,
            "https://example.org/form",
            "",
            "",
            vec![element(1, SemanticRole::Button, "", None, None, None)],
            1,
        )
        .unwrap();
        let target = target(&p);
        let prepared = p
            .prepare_action(BrowserActionKind::Click, target.clone(), None)
            .unwrap();
        p.snapshot_created =
            Some(Instant::now() - MAX_SNAPSHOT_LIFETIME - Duration::from_millis(1));
        assert_eq!(
            p.prepare_action(BrowserActionKind::Click, target, None)
                .unwrap_err(),
            "STALE_ELEMENT"
        );
        assert_eq!(
            p.verify_completion(&prepared).unwrap_err(),
            "UNKNOWN_COMPLETION"
        );
    }
    #[test]
    fn failed_new_observation_revokes_old_live_reference() {
        let mut p = session();
        p.observe(
            1,
            "https://example.org/form",
            "",
            "",
            vec![element(1, SemanticRole::Button, "", None, None, None)],
            1,
        )
        .unwrap();
        let old_target = target(&p);
        assert_eq!(
            p.observe(2, "https://example.org/form", "", "", vec![], 2)
                .unwrap_err(),
            "STALE_PAGE"
        );
        assert_eq!(
            p.prepare_action(BrowserActionKind::Click, old_target, None)
                .unwrap_err(),
            "STALE_ELEMENT"
        );
    }
    #[test]
    fn wrong_session_page_or_element_never_falls_back_to_similar_name() {
        let mut p = session();
        p.observe(
            1,
            "https://example.org/form",
            "Safe",
            "Visible",
            vec![element(1, SemanticRole::Button, "Submit", None, None, None)],
            1,
        )
        .unwrap();
        for mutation in 0..4 {
            let mut t = target(&p);
            match mutation {
                0 => t.browser_session_id = "b".repeat(48),
                1 => t.page_id = "c".repeat(48),
                2 => t.page_generation = 2,
                _ => t.element_ref = "d".repeat(48),
            }
            assert_eq!(
                p.prepare_action(BrowserActionKind::Click, t, None)
                    .unwrap_err(),
                "STALE_ELEMENT"
            );
        }
    }
    #[test]
    fn effect_classification_is_conservative_for_scripts_forms_and_destructive_intent() {
        let mut p = session();
        p.observe(
            1,
            "https://example.org/form",
            "Safe",
            "Visible",
            vec![element(
                1,
                SemanticRole::Button,
                "Publish",
                None,
                None,
                None,
            )],
            1,
        )
        .unwrap();
        let action = p
            .prepare_action(BrowserActionKind::Click, target(&p), None)
            .unwrap();
        assert_eq!(action.effect, BrowserEffect::DestructiveOrIrreversible);
        assert!(action.requires_approval);
        p.observe(
            1,
            "https://example.org/form",
            "Safe",
            "Visible",
            vec![element(
                2,
                SemanticRole::Button,
                "Next",
                None,
                Some("https://example.org/submit"),
                None,
            )],
            2,
        )
        .unwrap();
        assert_eq!(
            p.prepare_action(BrowserActionKind::Click, target(&p), None)
                .unwrap()
                .effect,
            BrowserEffect::PotentialExternalWrite
        );
        p.observe(
            1,
            "https://example.org/form",
            "Safe",
            "Visible",
            vec![element(3, SemanticRole::Button, "Okay", None, None, None)],
            3,
        )
        .unwrap();
        assert_eq!(
            p.prepare_action(BrowserActionKind::Click, target(&p), None)
                .unwrap()
                .effect,
            BrowserEffect::Unknown
        );
        let scroll = p
            .prepare_action(BrowserActionKind::Scroll, target(&p), None)
            .unwrap();
        assert_eq!(scroll.effect, BrowserEffect::Unknown);
        assert!(scroll.requires_approval);
        let inspect = p
            .prepare_action(BrowserActionKind::Inspect, target(&p), None)
            .unwrap();
        assert_eq!(inspect.effect, BrowserEffect::ReadOnly);
        assert!(!inspect.requires_approval);
    }
    #[test]
    fn typed_text_cannot_target_password_hidden_or_unknown_fields() {
        for field in ["password", "hidden", "unknown"] {
            let mut p = session();
            p.observe(
                1,
                "https://example.org/form",
                "Safe",
                "Visible",
                vec![element(
                    1,
                    SemanticRole::Textbox,
                    "User",
                    None,
                    None,
                    Some(field),
                )],
                1,
            )
            .unwrap();
            assert_eq!(
                p.prepare_action(BrowserActionKind::Type, target(&p), Some("value"))
                    .unwrap_err(),
                "SECRET_OR_UNKNOWN_FIELD_DENIED"
            );
        }
        let mut p = session();
        p.observe(
            1,
            "https://example.org/form",
            "Safe",
            "Visible",
            vec![element(
                1,
                SemanticRole::Textbox,
                "User",
                None,
                None,
                Some("text"),
            )],
            1,
        )
        .unwrap();
        assert_eq!(
            p.prepare_action(BrowserActionKind::Type, target(&p), Some("v"))
                .unwrap()
                .effect,
            BrowserEffect::Unknown
        );
        assert!(p
            .prepare_action(
                BrowserActionKind::Type,
                target(&p),
                Some(&"x".repeat(MAX_ACTION_TEXT + 1))
            )
            .is_err());
        p.observe(
            1,
            "https://example.org/form",
            "Safe",
            "Visible",
            vec![element(
                2,
                SemanticRole::Textbox,
                "",
                None,
                None,
                Some("textarea"),
            )],
            2,
        )
        .unwrap();
        let textarea = p
            .prepare_action(BrowserActionKind::Type, target(&p), Some("safe note"))
            .unwrap();
        assert_eq!(textarea.effect, BrowserEffect::Unknown);
        assert!(textarea.requires_approval);
    }
    #[test]
    fn snapshot_rejects_stale_observation_duplicate_serial_unsafe_urls_and_raw_secret_keys() {
        let mut p = session();
        assert_eq!(
            p.observe(2, "https://example.org/form", "Safe", "Visible", vec![], 1)
                .unwrap_err(),
            "STALE_PAGE"
        );
        let duplicate = element(1, SemanticRole::Button, "Save", None, None, None);
        assert_eq!(
            p.observe(
                1,
                "https://example.org/form",
                "Safe",
                "Visible",
                vec![duplicate.clone(), duplicate],
                1
            )
            .unwrap_err(),
            "ELEMENT_IDENTITY_INVALID"
        );
        assert_eq!(
            p.observe(
                1,
                "https://example.org/form",
                "Safe",
                "Visible",
                vec![element(
                    1,
                    SemanticRole::Link,
                    "Bad",
                    Some("https://example.org/?access_token=secret"),
                    None,
                    None
                )],
                1
            )
            .unwrap_err(),
            "SENSITIVE_URL"
        );
        p.observe(
            1,
            "https://example.org/form",
            "Password",
            "Password",
            vec![element(1, SemanticRole::Label, "API key", None, None, None)],
            1,
        )
        .unwrap();
        let s = p.snapshot.as_ref().unwrap();
        assert_eq!(s.title, "[redacted]");
        assert_eq!(s.visible_text, "[redacted]");
        assert_eq!(s.elements[0].accessible_name, "[redacted]");
        let dump = serde_json::to_string(s).unwrap();
        assert!(!dump.contains("Password"));
        assert!(!dump.contains("API key"));
    }
    #[test]
    fn closed_page_revokes_every_reference_and_cannot_claim_late_success() {
        let mut p = session();
        p.observe(
            1,
            "https://example.org/form",
            "Safe",
            "Visible",
            vec![element(
                1,
                SemanticRole::Link,
                "Open",
                Some("https://example.org/next"),
                None,
                None,
            )],
            1,
        )
        .unwrap();
        let t = target(&p);
        let a = p
            .prepare_action(BrowserActionKind::Click, t.clone(), None)
            .unwrap();
        p.close();
        assert_eq!(
            p.prepare_action(BrowserActionKind::Click, t, None)
                .unwrap_err(),
            "STALE_SESSION"
        );
        assert_eq!(p.verify_completion(&a).unwrap_err(), "UNKNOWN_COMPLETION");
    }
}
