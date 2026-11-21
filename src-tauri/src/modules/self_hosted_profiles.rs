use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use getrandom::fill;
use tauri::AppHandle;
use tauri_plugin_store::resolve_store_path;
use super::self_hosted_atomic_file::{self, PhysicalOutcome};

pub(super) const KEY: &str = "selfHostedInference";
pub(super) static WRITE_LOCK: Mutex<()> = Mutex::new(());

// There is ONE authoritative settings pathname, shared with ordinary
// preferences and native probes. Do not use plugin Store::save() for this
// pathname: its fs::write truncation could undo a successful qualification
// replacement. Every app writer to this file uses these same physical helpers.
const SETTINGS_PATH: &str = "terax-settings.json";
fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    resolve_store_path(app, SETTINGS_PATH)
        .map_err(|_| "Native settings path unavailable".into())
}
// A zero-content OS lock file is only process coordination, not a settings
// store, receipt ledger or commit marker. OS file locks are released on crash.
// All Clack writers to this existing JSON pathname hold it from snapshot/CAS
// comparison THROUGH the single replacement syscall.
fn lock_settings_file(
    app: &AppHandle, live: impl Fn() -> bool,
) -> Result<File, String> {
    let path = settings_path(app)?;
    lock_settings_path(&path, live)
}
fn lock_settings_path(
    path: &Path, live: impl Fn() -> bool,
) -> Result<File, String> {
    let parent = path.parent().ok_or("Invalid settings parent directory")?;
    fs::create_dir_all(parent).map_err(|_| "Settings lock directory unavailable")?;
    let file = OpenOptions::new().read(true).write(true).create(true)
        .open(parent.join(".terax-settings.json.lock"))
        .map_err(|_| "Native settings interprocess lock unavailable")?;
    loop {
        if !live() { return Err("Native settings lock admission expired".into()); }
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::WouldBlock) =>
                std::thread::sleep(Duration::from_millis(2)),
            Err(_) => return Err("Native settings interprocess lock failed".into()),
        }
    }
}
fn read_settings_file(path: &Path) -> Result<Map<String, Value>, String> {
    self_hosted_atomic_file::recover_missing_replaced_file(path)
        .map_err(|_| "Native settings replacement recovery requires attention")?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound =>
            return Err("Missing authoritative settings; recovery required".into()),
        Err(_) => return Err("Authoritative settings file is unreadable".into()),
    };
    let map: Map<String, Value> = serde_json::from_slice(&bytes)
        .map_err(|_| "Corrupted authoritative settings; refusing any write")?;
    validate_on_disk_qualifying_markers(&map)?;
    // The authoritative file has been parsed first. A remaining .pending
    // pathname was NOT adopted by the single atomic replacement, so it may
    // be discarded without replaying or deleting committed evidence.
    self_hosted_atomic_file::discard_abandoned_temps(path)
        .map_err(|_| "Native settings recovery cleanup requires attention")?;
    Ok(map)
}
/// Read-only validation of the existing receipt envelope. A syntactically
/// valid JSON document can still contain an unresolved or contradictory
/// qualification marker. Never serialize it through ordinary preferences.
fn validate_on_disk_qualifying_markers(map: &Map<String, Value>) -> Result<(), String> {
    let Some(self_hosted) = map.get(KEY) else {return Ok(());};
    let mut groups = std::collections::HashMap::<(String, String, String), String>::new();
    for (field, committed_version) in [("qualificationReceipts", 2), ("measurementRuns", 1)] {
        let Some(rows) = self_hosted["fabric"][field].as_array() else {continue};
        for row in rows {
            let Some(marker) = row.get(QUAL_MARKER) else {continue};
            let operation_id = marker["operationId"].as_str().filter(|s| !s.is_empty());
            let native_epoch = marker["nativeEpoch"].as_str().filter(|s| !s.is_empty());
            let phase = marker["phase"].as_str();
            let version_valid = match phase {
                Some("pending") => row["version"].as_u64() == Some(0),
                Some("acknowledged") => row["version"].as_u64() == Some(committed_version),
                _ => false,
            };
            if !version_valid || operation_id.is_none() || native_epoch.is_none() {
                return Err("Inconsistent authoritative qualification marker; recovery required".into());
            }
            let key=(field.to_string(),operation_id.unwrap().to_string(),native_epoch.unwrap().to_string());
            if let Some(previous) = groups.insert(key,phase.unwrap().to_string()) {
                if previous != phase.unwrap() {
                    return Err("Mixed authoritative qualification phases; recovery required".into());
                }
            }
        }
    }
    Ok(())
}
fn settings_from_disk(app: &AppHandle) -> Result<Map<String, Value>, String> {
    let path = settings_path(app)?;
    read_settings_file(&path)
}

/// Validate/recover the one native authority before the renderer loads prefs.
/// A malformed file must never become an empty plugin Store at shutdown.
pub fn self_hosted_profiles_startup_storage_check(app: &AppHandle) -> Result<(), String> {
    let _lock = WRITE_LOCK.lock().map_err(|_| "Settings startup lock unavailable")?;
    let path = settings_path(app)?;
    let parent=path.parent().ok_or("Invalid settings startup directory")?;
    // An absent main in an existing directory with ANY previous artifact is
    // ambiguous even if its old lock/backup have disappeared. Initialize a
    // genuinely EMPTY first-install directory only; never silently convert
    // lost persisted state into '{}'.
    let first_install = !path.exists() && if parent.is_dir() {
        fs::read_dir(parent)
            .map_err(|_| "Settings startup directory unreadable")?
            .next().is_none()
    } else {true};
    let _file_lock = lock_settings_file(app, || true)?;
    if first_install && !path.exists() {
        if self_hosted_atomic_file::replace_settings_file(&path,b"{}",||true)
            != PhysicalOutcome::Crossed {
            return Err("Fresh authoritative settings initialization failed".into());
        }
    }
    settings_from_disk(app).map(|_| ())
}
/// Every native reader of the shared authoritative settings pathname must
/// observe its REAL on-disk state through the same interprocess lock as CAS.
/// Creating a tauri-plugin-store cache for this pathname is unsafe: plugin
/// Store saves every cached store at app Exit, including when auto-save was
/// disabled, and could replace an intervening corrupt/unknown B03 authority.
/// This is a read from the existing settings authority, not another store.
pub(crate) fn authoritative_settings_snapshot(app: &AppHandle) -> Result<Map<String, Value>, String> {
    let _file_lock = lock_settings_file(app, || true)?;
    settings_from_disk(app)
}
pub(crate) fn authoritative_settings_value(
    app: &AppHandle, key: &str,
) -> Result<Option<Value>, String> {
    Ok(authoritative_settings_snapshot(app)?.remove(key))
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PersistResolution {
    Committed,
    ReconciledCommitted,
    NotCommitted,
    RecoveryRequired,
    Fenced,
    FailedBeforeCommit,
}
fn persist_complete_settings(
    app: &AppHandle,
    previous: &Map<String, Value>,
    next: &Map<String, Value>,
    commit: impl FnOnce(&Path, &Path) -> PhysicalOutcome,
) -> Result<PersistResolution, String> {
    let target = settings_path(app)?;
    let bytes = serde_json::to_vec(next)
        .map_err(|_| "Could not serialize authoritative settings")?;
    let physical = self_hosted_atomic_file::replace_settings_file_with_guard(&target, &bytes, commit);
    match physical {
        PhysicalOutcome::Fenced => return Ok(PersistResolution::Fenced),
        PhysicalOutcome::FailedBeforeCommit =>
            return Ok(PersistResolution::FailedBeforeCommit),
        PhysicalOutcome::Crossed | PhysicalOutcome::RecoveryRequired => {}
    }
    // A failed OS API may have already crossed the replacement boundary.
    // Only the actual authoritative pathname, NOT an IPC result or temp file,
    // decides whether the exact candidate became visible.
    let actual = match read_settings_file(&target) {
        Ok(actual) => actual,
        Err(_) => return Ok(PersistResolution::RecoveryRequired),
    };
    if actual == *next {
        return Ok(if physical == PhysicalOutcome::Crossed {
            PersistResolution::Committed
        } else {
            PersistResolution::ReconciledCommitted
        });
    }
    if actual == *previous {
        return Ok(PersistResolution::NotCommitted);
    }
    Ok(PersistResolution::RecoveryRequired)
}
fn physical_replace(staged: &Path, target: &Path) -> PhysicalOutcome {
    #[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
    acceptance_crash_at_real_boundary("before-replace", target);
    let actual_replace = self_hosted_atomic_file::replace_file(staged, target);
    #[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
    acceptance_record_win32_denial(target, &actual_replace);
    if actual_replace.is_ok() {
        #[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
        acceptance_crash_at_real_boundary("after-replace", target);
        #[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
        acceptance_pause_after_real_replace(target);
        PhysicalOutcome::Crossed
    } else {
        PhysicalOutcome::RecoveryRequired
    }
}

#[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
fn acceptance_record_win32_denial(target: &Path, result: &std::io::Result<()>) {
    if std::env::var("CLACK_LM11_B03_ACCEPTANCE_DENIAL").as_deref() != Ok("read-only") {
        return;
    }
    let root = PathBuf::from(
        std::env::var("CLACK_LM11_B03_ACCEPTANCE_ROOT").expect("owned root"))
        .canonicalize().expect("canonical root");
    assert!(super::managed_local_runtime::acceptance_is_owned_scenario_root(&root));
    assert_eq!(target.parent().unwrap().canonicalize().unwrap(),
        root.join("data").canonicalize().unwrap());
    assert_eq!(target.file_name().unwrap(), "terax-settings.json");
    let marker = File::create(root.join("real-permission-denial.json"))
        .expect("permission-denial marker");
    serde_json::to_writer(&marker, &json!({
        "stage":"real-ReplaceFileW-after-readonly-authoritative",
        "pid":std::process::id(),
        "replacementSucceeded":result.is_ok(),
        "win32Error":result.as_ref().err().and_then(|e|e.raw_os_error()),
        "errorText":result.as_ref().err().map(|e|e.to_string()),
        "target":target
    })).expect("permission marker serialization");
    marker.sync_all().expect("permission marker sync");
}

#[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
fn acceptance_pause_after_real_replace(target: &Path) {
    if std::env::var("CLACK_LM11_B03_ACCEPTANCE_POST_FENCE").as_deref() != Ok("1") {
        return;
    }
    let root = PathBuf::from(
        std::env::var("CLACK_LM11_B03_ACCEPTANCE_ROOT").expect("owned root"))
        .canonicalize().expect("canonical root");
    assert!(super::managed_local_runtime::acceptance_is_owned_scenario_root(&root));
    assert_eq!(target.parent().unwrap().canonicalize().unwrap(),
        root.join("data").canonicalize().unwrap());
    assert_eq!(target.file_name().unwrap(), "terax-settings.json");
    let marker = File::create(root.join("real-post-fence.json")).expect("post-fence marker");
    serde_json::to_writer(&marker, &json!({
        "stage":"ReplaceFileW-returned-success-before-native-response",
        "pid":std::process::id(), "target":target
    })).expect("post-fence marker serialization");
    marker.sync_all().expect("post-fence marker sync");
    std::thread::sleep(Duration::from_millis(1800));
}

/// Acceptance hook is only built by the special example feature. The hook
/// sits INSIDE the real ticket/RuntimeOwner-locked native physical replacement,
/// not in a mock save. It exits the actual Tauri process without unwinding.
#[cfg(all(windows, feature = "lm11-b03-acceptance-harness"))]
fn acceptance_crash_at_real_boundary(point: &str, target: &Path) {
    if std::env::var("CLACK_LM11_B03_ACCEPTANCE_CRASH").as_deref() != Ok(point) {
        return;
    }
    let root = std::path::PathBuf::from(
        std::env::var("CLACK_LM11_B03_ACCEPTANCE_ROOT").expect("owned acceptance root"));
    let root = root.canonicalize().expect("existing isolated acceptance root");
    assert!(super::managed_local_runtime::acceptance_is_owned_scenario_root(&root),
        "Reject crash injection outside the one approved native acceptance owner");
    assert_eq!(target.parent().unwrap().canonicalize().unwrap(),
        root.join("data").canonicalize().unwrap(),
        "Never crash/trace a production or unrelated settings pathname");
    assert_eq!(target.file_name().unwrap(), "terax-settings.json");
    let marker = root.join(format!("real-{point}.json"));
    let file = File::create(&marker).expect("isolated boundary marker");
    serde_json::to_writer(&file, &serde_json::json!({
        "stage":point,"pid":std::process::id(),"target":target
    })).expect("boundary marker serialization");
    file.sync_all().expect("boundary marker synchronization");
    std::process::exit(if point == "before-replace" { 173 } else { 174 });
}
fn save_ordinary_settings(
    app: &AppHandle, previous: &Map<String, Value>, next: &Map<String, Value>,
) -> Result<(), String> {
    match persist_complete_settings(app, previous, next, physical_replace)? {
        PersistResolution::Committed | PersistResolution::ReconciledCommitted => Ok(()),
        PersistResolution::NotCommitted | PersistResolution::FailedBeforeCommit =>
            Err("Settings replacement failed before commit".into()),
        _ => Err("Settings replacement recovery required".into()),
    }
}

/// Ordinary preferences retain their existing JSON keys and events, but the
/// same native owner now serializes their physical file writes. The qualifying
/// key remains writable ONLY through its existing dedicated CAS commands.
#[tauri::command]
pub fn self_hosted_settings_entries(app: AppHandle) -> Result<Vec<(String, Value)>, String> {
    let _lock = WRITE_LOCK.lock().map_err(|_| "Native settings lock unavailable")?;
    let _process_lock = lock_settings_file(&app, || true)?;
    Ok(settings_from_disk(&app)?.into_iter().collect())
}
#[tauri::command]
pub fn self_hosted_settings_set(
    app: AppHandle, key: String, value: Value,
) -> Result<(), String> {
    save_other_settings_batch(&app, vec![(key, value)])
}
#[tauri::command]
pub fn self_hosted_settings_set_many(
    app: AppHandle, changes: Vec<(String, Value)>,
) -> Result<(), String> {
    save_other_settings_batch(&app, changes)
}
fn save_other_settings_batch(
    app: &AppHandle, changes: Vec<(String, Value)>,
) -> Result<(), String> {
    if changes.len() > 64 || changes.iter().any(|(key, _)|
        key == KEY || key.is_empty() || key.len() > 2048) {
        return Err("Ordinary settings writer cannot mutate native qualification authority".into());
    }
    if changes.is_empty() { return Ok(()); }
    let _lock = WRITE_LOCK.lock().map_err(|_| "Native settings lock unavailable")?;
    let _process_lock = lock_settings_file(app, || true)?;
    let old = settings_from_disk(app)?;
    let mut next = old.clone();
    for (key, value) in changes { next.insert(key, value); }
    if next != old { save_ordinary_settings(app, &old, &next)?; }
    Ok(())
}
/// Native probe and other selfHostedInference writers already own WRITE_LOCK.
/// This does NOT retry or synthesize qualification receipts.
pub(super) fn save_other_self_hosted_under_lock(
    app: &AppHandle, expected: &Value, next: Value,
) -> Result<(), String> {
    let _process_lock = lock_settings_file(app, || true)?;
    validate(&next)?;
    let old = settings_from_disk(app)?;
    if old.get(KEY).unwrap_or(&Value::Null) != expected {
        return Err("Self-hosted settings changed during native probe".into());
    }
    if !existing_qualifying_rows_preserved(expected, &next) {
        return Err("Native probe cannot replace a qualifying ticket".into());
    }
    let mut updated = old.clone();
    updated.insert(KEY.into(), next);
    save_ordinary_settings(app, &old, &updated)
}

// One in-process admission gate on the EXISTING native selfHostedInference
// store/CAS authority. No new persistence file, effect ledger or registry.
// Every qualifying receipt is durably bound to this ticket IN ITS OWN row.
const QUAL_MARKER: &str = "qualificationCas";
const MAX_QUALIFICATION_NATIVE_MS: u64 = 300_000;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualificationCasTicket {
    operation_id: String,
    native_epoch: String,
}
#[derive(Clone)]
struct QualificationCasGate {
    ticket: QualificationCasTicket,
    expiry: Instant,
    deployment_id: String,
    runtime_epoch: String,
    process_id: Option<u32>,
    kind: String,
    revoked: Arc<AtomicBool>,
    prepared: bool,
    prepared_revision: Option<u64>,
}
// This is still the ONE native qualification gate for the existing atomic
// settings/CAS authority. Each canonical deployment occupies its own slot:
// A's pending or stale operation cannot evict, cancel or deny B/C. The single
// global WRITE_LOCK and OS settings-file lock still serialize physical saves.
static QUAL_GATE: OnceLock<Mutex<std::collections::BTreeMap<String, QualificationCasGate>>> =
    OnceLock::new();
fn qualifier_gate() -> &'static Mutex<std::collections::BTreeMap<String, QualificationCasGate>> {
    QUAL_GATE.get_or_init(|| Mutex::new(std::collections::BTreeMap::new()))
}
fn qualifier_epoch() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    fill(&mut bytes).map_err(|_| "Native qualification entropy unavailable")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn eligible(gate: &QualificationCasGate, ticket: &QualificationCasTicket,
            now: Instant, runtime_current: impl FnOnce(&QualificationCasGate) -> bool) -> bool {
    gate.ticket.operation_id == ticket.operation_id
        && gate.ticket.native_epoch == ticket.native_epoch
        && !gate.revoked.load(Ordering::Acquire)
        && now < gate.expiry
        && runtime_current(gate)
}
fn native_eligible(gate: &QualificationCasGate, ticket: &QualificationCasTicket) -> bool {
    eligible(gate, ticket, Instant::now(), |g| match g.process_id {
        Some(pid) => super::managed_local_runtime::qualification_runtime_is_current(
            &g.deployment_id, &g.runtime_epoch, pid),
        // A renderer-supplied remote epoch has no native process owner to
        // fence. Do not issue an authoritative CAS ticket for it.
        None => false,
    })
}
/// The native code checks the same monotonic operation gate immediately
/// before and after the synchronous OS store.save boundary. A save may have
/// reached the filesystem even if the subsequent acknowledgement is lost.
fn guarded_native_save_checked(
    live: impl Fn() -> bool, save: impl FnOnce() -> Result<(), String>,
) -> &'static str {
    if !live() { return "rejected"; }
    if save().is_err() { return "ambiguous"; }
    if !live() { return "ambiguous"; }
    "acknowledged"
}
fn receipt_rows<'a>(value: &'a Value, kind: &str) -> Option<&'a Vec<Value>> {
    let field = if kind == "lm2f" { "qualificationReceipts" } else { "measurementRuns" };
    value["fabric"][field].as_array()
}
fn receipt_rows_mut<'a>(value: &'a mut Value, kind: &str) -> Option<&'a mut Vec<Value>> {
    let field = if kind == "lm2f" { "qualificationReceipts" } else { "measurementRuns" };
    value["fabric"][field].as_array_mut()
}
fn matching_qualifier(row: &Value, ticket: &QualificationCasTicket) -> bool {
    row[QUAL_MARKER]["operationId"] == ticket.operation_id
        && row[QUAL_MARKER]["nativeEpoch"] == ticket.native_epoch
}
fn examine_qualifying_rows(current: &Value, ticket: &QualificationCasTicket)
    -> &'static str
{
    let rows = ["qualificationReceipts", "measurementRuns"].iter().flat_map(|field|
        current["fabric"][*field].as_array().into_iter().flatten());
    let matched: Vec<&Value> = rows.filter(|row| matching_qualifier(row, ticket)).collect();
    if matched.is_empty() {
        // A clean authoritative absence proves this ticket did not cross the
        // activation commit. A malformed marker does NOT prove absence.
        for (field, version) in [("qualificationReceipts", 2), ("measurementRuns", 1)] {
            for row in current["fabric"][field].as_array().into_iter().flatten() {
                let Some(marker) = row.get(QUAL_MARKER) else { continue };
                if !marker["operationId"].as_str().is_some_and(|s| !s.is_empty()) ||
                    !marker["nativeEpoch"].as_str().is_some_and(|s| !s.is_empty()) ||
                    !((marker["phase"] == "pending" && row["version"] == 0) ||
                       (marker["phase"] == "acknowledged" && row["version"] == version)) {
                    return "unknown";
                }
            }
        }
        return "absent";
    }
    if matched.iter().all(|row| row[QUAL_MARKER]["phase"] == "acknowledged"
        && matches!(row["version"].as_u64(), Some(1 | 2))) {
        return "committed";
    }
    if matched.iter().all(|row| row[QUAL_MARKER]["phase"] == "pending" &&
        row["version"] == 0) {
        return "pending";
    }
    "unknown"
}

// One native qualifying effect per exact deployment/runtime epoch and kind.
// This scans the EXISTING CAS envelope (not a second registry): a renderer
// restart cannot mint a fresh ticket and replay a previously ambiguous CAS.
fn prior_qualifier_for_scope(current: &Value, gate: &QualificationCasGate) -> bool {
    receipt_rows(current, &gate.kind).into_iter().flatten().any(|row| {
        row.get(QUAL_MARKER).is_some() &&
        row["scope"]["deploymentId"] == gate.deployment_id &&
        row["scope"]["runtimeEpoch"] == gate.runtime_epoch
    })
}
fn replace_stale_qualifier_slot(
    slot: &mut Option<QualificationCasGate>, new_gate: QualificationCasGate,
    old_is_still_authorized: impl FnOnce(&QualificationCasGate) -> bool,
) -> Result<(), String> {
    if slot.as_ref().is_some_and(old_is_still_authorized) {
        return Err("Prior native qualification has unresolved live effects".into());
    }
    // Invalidate the previous admission before releasing ownership. It may
    // have prepared inert evidence; the existing CAS receipt markers remain
    // on disk and block same-epoch duplicates independently of this slot.
    if let Some(stale) = slot.as_ref() {
        stale.revoked.store(true, Ordering::Release);
    }
    *slot = Some(new_gate);
    Ok(())
}

fn insert_deployment_qualifier_gate(
    slots: &mut std::collections::BTreeMap<String, QualificationCasGate>,
    gate: QualificationCasGate,
    old_is_still_authorized: impl FnOnce(&QualificationCasGate) -> bool,
) -> Result<(), String> {
    if let Some(previous) = slots.get_mut(&gate.deployment_id) {
        // Preserve the exact existing same-deployment epoch/single-flight
        // exclusion while allowing genuinely unrelated deployments to exist.
        let mut prior = Some(previous.clone());
        replace_stale_qualifier_slot(&mut prior, gate, old_is_still_authorized)?;
        *previous = prior.expect("Native qualifier slot must remain installed");
    } else {
        slots.insert(gate.deployment_id.clone(), gate);
    }
    Ok(())
}

#[tauri::command]
pub fn self_hosted_profiles_qualification_begin(
    app: AppHandle,
    kind: String, deployment_id: String, runtime_epoch: String,
    process_id: Option<u32>, remaining_ms: u64, deadline_unix_ms: u64,
) -> Result<QualificationCasTicket, String> {
    // IPC admission latency must not silently extend the renderer's aggregate
    // deadline. The wall-clock absolute cap complements the native monotonic
    // interval: clock anomalies shorten or reject admission where detectable.
    let now_unix_ms = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_| "Native qualification clock unavailable")?.as_millis() as u64;
    let bounded_ms = remaining_ms.min(deadline_unix_ms.saturating_sub(now_unix_ms));
    if !matches!(kind.as_str(), "lm2f" | "lm6")
        || !(1..=MAX_QUALIFICATION_NATIVE_MS).contains(&bounded_ms)
        || deployment_id.is_empty() || deployment_id.len() > 40 * 1024
        || runtime_epoch.is_empty() || runtime_epoch.len() > 2048
        || process_id.is_none()
    {
        return Err("Invalid native qualification admission".into());
    }
    let ticket = QualificationCasTicket {
        operation_id: qualifier_epoch()?, native_epoch: qualifier_epoch()?,
    };
    let gate = QualificationCasGate {
        ticket: ticket.clone(), expiry: Instant::now() + Duration::from_millis(bounded_ms),
        deployment_id, runtime_epoch, process_id, kind,
        revoked: Arc::new(AtomicBool::new(false)), prepared: false,
        prepared_revision: None,
    };
    if !native_eligible(&gate, &ticket) {
        return Err("Qualification runtime epoch/process is stale or unavailable".into());
    }
    let _lock = lock_with_qualifier_deadline(&gate)
        .map_err(|_| "Native qualification expired before admission")?;
    let _file_lock = lock_settings_file(&app, || native_eligible(&gate, &ticket))?;
    let current_settings = settings_from_disk(&app)?;
    if prior_qualifier_for_scope(current_settings.get(KEY).unwrap_or(&Value::Null), &gate) {
        return Err("Prior qualifying effect or unknown commit exists for this runtime epoch".into());
    }
    let mut slots = qualifier_gate().lock().map_err(|_| "Native qualification admission lock unavailable")?;
    insert_deployment_qualifier_gate(&mut slots, gate,
        |old| native_eligible(old, &old.ticket))?;
    Ok(ticket)
}

#[tauri::command]
pub fn self_hosted_profiles_qualification_cancel(ticket: QualificationCasTicket) {
    if let Ok(slots) = qualifier_gate().lock() {
        if let Some(owner) = slots.values().find(|g|
            g.ticket.operation_id == ticket.operation_id &&
            g.ticket.native_epoch == ticket.native_epoch) {
            owner.revoked.store(true, Ordering::Release);
        }
    }
}

// Native input must append exactly one LM6 measurement or 1..8 LM2F
// receipts to the existing CAS payload. New rows are durable but *INERT*
// version-zero until a separate live-epoch acknowledgement commits them.
fn prepare_qualifying_value(
    expected: &Value, mut value: Value, gate: &QualificationCasGate,
) -> Result<Value, String> {
    validate(&value)?;
    if value["revision"].as_u64() != expected["revision"].as_u64().and_then(|n| n.checked_add(1)) {
        return Err("Qualification CAS revision mismatch".into());
    }
    let original = receipt_rows(expected, &gate.kind).cloned().unwrap_or_default();
    let next = receipt_rows_mut(&mut value, &gate.kind)
        .ok_or("Qualifying effect collection absent")?;
    let max_added = if gate.kind == "lm2f" { 8 } else { 1 };
    let history_limit = if gate.kind == "lm2f" { 128 } else { 48 };
    // Permit the existing bounded history's oldest unmarked rows to roll off.
    // Never allow a pending/acknowledged operation marker to be evicted: it is
    // the only durable restart reconciliation proof, not a separate ledger.
    let old_retained = (0..=original.len()).find(|&dropped| {
        let old_len = original.len() - dropped;
        let added = next.len().saturating_sub(old_len);
        added > 0 && added <= max_added && next.len() <= history_limit &&
            next.len() >= old_len && next[..old_len] == original[dropped..] &&
            original[..dropped].iter().all(|row| row.get(QUAL_MARKER).is_none())
    }).map(|dropped| original.len() - dropped)
      .ok_or("Qualifying CAS may only append bounded, unique effects")?;
    let mut new_capabilities = std::collections::HashSet::new();
    for row in next.iter_mut().skip(old_retained) {
        if row["scope"]["deploymentId"] != gate.deployment_id
            || row["scope"]["runtimeEpoch"] != gate.runtime_epoch
            || row["version"].as_u64() != Some(if gate.kind == "lm2f" { 2 } else { 1 })
            || !row.is_object() || row.get(QUAL_MARKER).is_some()
        {
            return Err("Qualifying effect is not bound to the native runtime epoch".into());
        }
        if gate.kind == "lm2f" {
            let capability = row["capability"].as_str().filter(|s| !s.is_empty());
            if !capability.is_some_and(|s| new_capabilities.insert(s.to_string())) {
                return Err("Duplicate LM2F capability effect in the same operation".into());
            }
        } else {
            let id = row["runId"].as_str().filter(|s| !s.is_empty());
            if id.is_none() || original.iter().any(|prior| prior["runId"] == row["runId"]) {
                return Err("Duplicate or missing LM6 run identity".into());
            }
        }
        row["version"] = json!(0);
        row[QUAL_MARKER] = json!({
            "operationId": gate.ticket.operation_id,
            "nativeEpoch": gate.ticket.native_epoch,
            "phase": "pending",
        });
    }
    validate(&value)?;
    Ok(value)
}

fn acknowledge_qualifying_value(
    mut current: Value, gate: &QualificationCasGate,
) -> Result<Value, String> {
    let next = receipt_rows_mut(&mut current, &gate.kind)
        .ok_or("Pending qualification evidence absent")?;
    let owned: Vec<usize> = next.iter().enumerate().filter_map(|(i, row)|
        matching_qualifier(row, &gate.ticket).then_some(i)).collect();
    if owned.is_empty() || owned.len() > if gate.kind == "lm2f" { 8 } else { 1 }
        || owned.iter().any(|&i| next[i]["version"] != 0 ||
            next[i][QUAL_MARKER]["phase"] != "pending")
    {
        return Err("No uniquely prepared native qualification CAS".into());
    }
    for index in owned {
        next[index]["version"] = json!(if gate.kind == "lm2f" { 2 } else { 1 });
        next[index][QUAL_MARKER]["phase"] = json!("acknowledged");
    }
    validate(&current)?;
    Ok(current)
}

fn existing_qualifying_rows_preserved(current: &Value, proposed: &Value) -> bool {
    ["qualificationReceipts", "measurementRuns"].iter().all(|field| {
        // Ordinary CAS can retain history or trim an oldest unmarked legacy
        // prefix, but cannot add an unmarked success, replace any evidence,
        // or evict an acknowledged/pending native operation marker.
        let old = current["fabric"][*field].as_array().cloned().unwrap_or_default();
        let next = proposed["fabric"][*field].as_array().cloned().unwrap_or_default();
        next.len() <= old.len() && old[old.len() - next.len()..] == next &&
            old[..old.len() - next.len()].iter().all(|row| row.get(QUAL_MARKER).is_none())
    })
}

fn lock_with_qualifier_deadline_checked(
    live: impl Fn() -> bool,
) -> Result<std::sync::MutexGuard<'static, ()>, String> {
    loop {
        if !live() {
            return Err("Native qualification expired or cancelled before storage lock".into());
        }
        match WRITE_LOCK.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(std::sync::TryLockError::Poisoned(_)) =>
                return Err("Native qualification storage lock unavailable".into()),
            Err(std::sync::TryLockError::WouldBlock) =>
                std::thread::sleep(Duration::from_millis(2)),
        }
    }
}
fn lock_with_qualifier_deadline(
    gate: &QualificationCasGate,
) -> Result<std::sync::MutexGuard<'static, ()>, String> {
    lock_with_qualifier_deadline_checked(|| native_eligible(gate, &gate.ticket))
}

fn qualification_owner(ticket: &QualificationCasTicket) -> Result<QualificationCasGate, String> {
    let slots = qualifier_gate().lock().map_err(|_| "Qualification gate unavailable")?;
    slots.values().find(|g| g.ticket.operation_id == ticket.operation_id &&
        g.ticket.native_epoch == ticket.native_epoch)
        .cloned().ok_or_else(|| "Qualification native epoch/owner unavailable".into())
}

fn persist_qualified_settings(
    app: &AppHandle, gate: &QualificationCasGate,
    previous: &Map<String, Value>, next: &Map<String, Value>,
) -> Result<PersistResolution, String> {
    persist_complete_settings(app, previous, next, |staged, target| {
        // Hold the exact cancellation gate THROUGH replacement. The existing
        // managed RuntimeOwner lock prevents process/epoch rollover between
        // the final check and the irreversible filesystem operation.
        let Ok(slots) = qualifier_gate().lock() else {
            return PhysicalOutcome::Fenced;
        };
        let Some(current) = slots.get(&gate.deployment_id).filter(|g|
            g.ticket.operation_id == gate.ticket.operation_id &&
            g.ticket.native_epoch == gate.ticket.native_epoch &&
            g.kind == gate.kind &&
            g.deployment_id == gate.deployment_id &&
            g.runtime_epoch == gate.runtime_epoch &&
            g.process_id == gate.process_id &&
            g.prepared &&
            g.prepared_revision == next.get(KEY).and_then(|v| v["revision"].as_u64())) else {
            return PhysicalOutcome::Fenced;
        };
        if !eligible(current, &gate.ticket, Instant::now(), |_| true) {
            return PhysicalOutcome::Fenced;
        }
        let Some(pid) = current.process_id else {
            return PhysicalOutcome::Fenced;
        };
        super::managed_local_runtime::with_current_qualification_runtime(
            &current.deployment_id, &current.runtime_epoch, pid,
            || if eligible(current, &gate.ticket, Instant::now(), |_| true) {
                physical_replace(staged, target)
            } else {
                PhysicalOutcome::Fenced
            }
        ).unwrap_or(PhysicalOutcome::Fenced)
    })
}

#[tauri::command]
pub fn self_hosted_profiles_qualification_prepare(
    app: AppHandle, ticket: QualificationCasTicket, expected: Value, value: Value,
) -> Result<&'static str, String> {
    let gate = qualification_owner(&ticket)?;
    if !native_eligible(&gate, &ticket) { return Ok("rejected"); }
    let _lock = match lock_with_qualifier_deadline(&gate) {
        Ok(lock) => lock,
        Err(_) => return Ok("rejected"),
    };
    let _file_lock = match lock_settings_file(&app, || native_eligible(&gate, &ticket)) {
        Ok(lock) => lock,
        Err(_) => return Ok("rejected"),
    };
    let previous = settings_from_disk(&app)?;
    let old = previous.get(KEY).cloned().unwrap_or(Value::Null);
    if old != expected { return Ok("conflict"); }
    let prepared = match prepare_qualifying_value(&old, value, &gate) {
        Ok(prepared) => prepared,
        Err(_) => return Ok("failed-before-commit"),
    };
    if !native_eligible(&gate, &ticket) { return Ok("rejected"); }
    {
        let mut slots = qualifier_gate().lock().map_err(|_| "Qualification gate unavailable")?;
        let current = slots.get_mut(&gate.deployment_id).filter(|g| g.ticket.operation_id == ticket.operation_id &&
            g.ticket.native_epoch == ticket.native_epoch)
            .ok_or("Native qualification ownership changed")?;
        if current.prepared { return Ok("rejected"); }
        current.prepared = true;
        current.prepared_revision = prepared["revision"].as_u64();
    }
    let mut candidate = previous.clone();
    candidate.insert(KEY.into(), prepared);
    Ok(match persist_qualified_settings(&app, &gate, &previous, &candidate)? {
        PersistResolution::Committed => "prepared",
        PersistResolution::Fenced => "rejected",
        PersistResolution::FailedBeforeCommit | PersistResolution::NotCommitted =>
            "failed-before-commit",
        PersistResolution::ReconciledCommitted | PersistResolution::RecoveryRequired =>
            "recovery-required",
    })
}

#[tauri::command]
pub fn self_hosted_profiles_qualification_acknowledge(
    app: AppHandle, ticket: QualificationCasTicket,
) -> Result<&'static str, String> {
    let gate = qualification_owner(&ticket)?;
    if !gate.prepared || !native_eligible(&gate, &ticket) {
        return Ok("rejected");
    }
    let _lock = match lock_with_qualifier_deadline(&gate) {
        Ok(lock) => lock,
        Err(_) => return Ok("rejected"),
    };
    let _file_lock = match lock_settings_file(&app, || native_eligible(&gate, &ticket)) {
        Ok(lock) => lock,
        Err(_) => return Ok("rejected"),
    };
    let previous = settings_from_disk(&app)?;
    let old = previous.get(KEY).cloned()
        .ok_or("Stored qualification receipt unavailable")?;
    if old["revision"].as_u64() != gate.prepared_revision {
        return Ok("conflict");
    }
    if examine_qualifying_rows(&old, &ticket) != "pending" {
        return Ok("rejected");
    }
    let next = match acknowledge_qualifying_value(old.clone(), &gate) {
        Ok(next) => next,
        Err(_) => return Ok("failed-before-commit"),
    };
    if !native_eligible(&gate, &ticket) { return Ok("rejected"); }
    let mut candidate = previous.clone();
    candidate.insert(KEY.into(), next.clone());
    let result = persist_qualified_settings(&app, &gate, &previous, &candidate)?;
    if matches!(result, PersistResolution::Committed |
        PersistResolution::ReconciledCommitted) {
        if let Ok(mut slots) = qualifier_gate().lock() {
            if slots.get(&gate.deployment_id).is_some_and(|g| g.ticket.operation_id == ticket.operation_id &&
                g.ticket.native_epoch == ticket.native_epoch) {
                gate.revoked.store(true, Ordering::Release);
                slots.remove(&gate.deployment_id);
            }
        }
        super::inference_probe::settings_changed(&app, &next);
        super::remote_ssh::reconcile(&next);
    }
    // Once replacement crossed, never roll back the durable active effect.
    // An expired original caller fails closed in TS even if readback discovers
    // a physically committed receipt after the acknowledgement was lost.
    Ok(match result {
        PersistResolution::Committed => "acknowledged",
        PersistResolution::ReconciledCommitted => "committed-unacknowledged",
        PersistResolution::Fenced => "rejected",
        PersistResolution::FailedBeforeCommit | PersistResolution::NotCommitted =>
            "failed-before-commit",
        PersistResolution::RecoveryRequired => "recovery-required",
    })
}

/// Reconciliation is read-only and safe after restart (where native in-memory
/// gates no longer exist). It reports the existing durable receipt marker,
/// never grants a new qualifying capability or retries a failed commit.
#[tauri::command]
pub fn self_hosted_profiles_qualification_reconcile(
    app: AppHandle, ticket: QualificationCasTicket,
) -> Result<&'static str, String> {
    let _lock = WRITE_LOCK.lock().map_err(|_| "Qualification storage lock unavailable")?;
    let _file_lock = lock_settings_file(&app, || true)?;
    let value = match settings_from_disk(&app) {
        Ok(settings) => settings.get(KEY).cloned().unwrap_or(Value::Null),
        Err(_) => return Ok("pending-reconciliation"),
    };
    // An entirely absent authority with no valid Windows recovery backup
    // cannot prove a prior qualifying effect did NOT commit.
    if !settings_path(&app)?.is_file() {
        return Ok("pending-reconciliation");
    }
    Ok(match examine_qualifying_rows(&value, &ticket) {
        "committed" => "committed",
        "pending" => "not-committed",
        "absent" => "not-committed",
        _ => "pending-reconciliation",
    })
}
// Keep in sync with the bounded TypeScript CONTEXT_CALIBRATION ceiling and
// request limit. This validates persisted native evidence; it never grants
// context allocation or substitutes for an actual successful Ollama probe.
const MAX_CONTEXT_CALIBRATION_TOKENS: u64 = 73_728;
const MAX_CONTEXT_CALIBRATION_ATTEMPTS: usize = 8;
const SNAPSHOT_KEYS: &[&str] = &[
    KEY,
    "ollamaBaseURL",
    "ollamaModelId",
    "lmstudioBaseURL",
    "lmstudioModelId",
    "mlxBaseURL",
    "mlxModelId",
    "customEndpoints",
    "openaiCompatibleBaseURL",
    "openaiCompatibleModelId",
    "openaiCompatibleContextLimit",
];

#[tauri::command]
pub fn self_hosted_profiles_snapshot(app: AppHandle) -> Result<Vec<(String, Value)>, String> {
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| "Self-hosted settings lock unavailable")?;
    let _file_lock = lock_settings_file(&app, || true)?;
    let store = settings_from_disk(&app)?;
    Ok(SNAPSHOT_KEYS
        .iter()
        .filter_map(|key| store.get(*key).cloned().map(|value| ((*key).into(), value)))
        .collect())
}

// Persist historical proof after a host is re-enabled or reconfigured.
// Historical evidence is NOT usable at the new revision: the TypeScript
// context/tool admission paths require an exact CURRENT revision and fresh
// runtime identity. Native persistence must still reject future, missing,
// cross-host, or malformed revision claims rather than deleting old records.
fn evidence_revision_is_not_future(state: &Value, scope: &Value) -> bool {
    let Some(record_revision) = scope["configurationRevision"]
        .as_u64()
        .filter(|revision| *revision > 0)
    else {
        return false;
    };
    state["endpoints"].as_array().is_some_and(|endpoints| {
        endpoints.iter().any(|endpoint| {
            endpoint["id"] == scope["endpointId"]
                && endpoint["configurationRevision"]
                    .as_u64()
                    .is_some_and(|current| current > 0 && record_revision <= current)
        })
    })
}

pub(super) fn validate(value: &Value) -> Result<(), String> {
    if value.get("version").and_then(Value::as_u64) != Some(1)
        || value.get("revision").and_then(Value::as_u64).is_none()
        || value
            .get("endpoints")
            .and_then(Value::as_array)
            .is_none_or(|a| a.len() > 256)
        || value
            .get("profiles")
            .and_then(Value::as_array)
            .is_none_or(|a| a.len() > 2048)
        || value.to_string().len() > 2 * 1024 * 1024
    {
        return Err("Invalid or oversized self-hosted settings".into());
    }
    for endpoint in value["endpoints"].as_array().into_iter().flatten() {
        super::remote_ssh::validate_endpoint(endpoint)?;
    }
    for profile in value["profiles"].as_array().into_iter().flatten() {
        if let Some(record) = profile.get("toolVerification") {
            if !record["configuration"].is_null() {
                return Err("Provider-default tool evidence cannot be explicit".into());
            }
            validate_tool_verification(value, profile, record)?;
        }
        if let Some(records) = profile.get("agentToolConfigurations") {
            let records = records
                .as_array()
                .filter(|r| r.len() <= 2)
                .ok_or("Invalid Agent tool configurations")?;
            let mut wires = std::collections::HashSet::new();
            for record in records {
                if record["configuration"].is_null()
                    || !wires.insert(record["configuration"]["wire"].to_string())
                {
                    return Err("Duplicate or missing Agent tool configuration".into());
                }
                validate_tool_verification(value, profile, record)?;
            }
        }
        let Some(record) = profile.get("contextCalibration") else {
            continue;
        };
        let scope = &record["scope"];
        let tokens = |v: &Value| {
            v.as_u64()
                .is_some_and(|n| n > 0 && n <= MAX_CONTEXT_CALIBRATION_TOKENS)
        };
        let string = |v: &Value, max: usize| {
            v.as_str().is_some_and(|s| {
                !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control)
            })
        };
        let outcome = |v: &Value| {
            matches!(
                v.as_str(),
                Some(
                    "success"
                        | "capacity"
                        | "allocation-mismatch"
                        | "transient"
                        | "timeout"
                        | "offline"
                        | "revision-changed"
                        | "cancelled"
                        | "unsupported"
                        | "interrupted"
                )
            )
        };
        let valid = record["version"] == 1
            && record.to_string().len() <= 16 * 1024
            && string(&record["id"], 128)
            && scope["endpointId"] == profile["endpointId"]
            && scope["model"] == profile["transportModelId"]
            && scope["digest"] == profile["modelRevision"]
            && scope["deployment"] == profile["deploymentId"]
            && scope["backend"] == "ollama"
            && string(&scope["digest"], 1024)
            && string(&scope["runtimeEpoch"], 128)
            && string(&scope["providerVersion"], 64)
            && string(&scope["reasoning"], 2048)
            && evidence_revision_is_not_future(value, scope)
            && matches!(
                record["status"].as_str(),
                Some(
                    "verifying"
                        | "verified"
                        | "incomplete"
                        | "capacity"
                        | "cancelled"
                        | "unsupported"
                )
            )
            && ["startedAt", "updatedAt", "expiresAt", "retryAfter"]
                .iter()
                .all(|k| record[*k].as_u64().is_some())
            && (record["highest"].is_null() || tokens(&record["highest"]))
            && (record["failedNext"].is_null() || tokens(&record["failedNext"]))
            && (record["allocation"].is_null() || string(&record["allocation"], 1024))
            && (record["failure"].is_null() || outcome(&record["failure"]))
            && record["attempts"].as_array().is_some_and(|a| {
                a.len() <= MAX_CONTEXT_CALIBRATION_ATTEMPTS
                    && a.iter().all(|entry| {
                        tokens(&entry["context"])
                            && entry["requested"] == entry["context"]
                            && entry["think"] == "omitted"
                            && matches!(
                                entry["thermal"].as_str(),
                                Some("cold" | "warm" | "unknown")
                            )
                            && (entry["finish"].is_null() || string(&entry["finish"], 64))
                            && entry["at"].as_u64().is_some()
                            && entry["latencyMs"]
                                .as_f64()
                                .is_some_and(|n| n.is_finite() && (0.0..=600_000.0).contains(&n))
                            && (entry["loaded"].is_null()
                                || entry["loaded"]
                                    .as_u64()
                                    .is_some_and(|n| n > 0 && n <= 2_000_000))
                            && (entry["outcome"] != "success"
                                || entry["loaded"] == entry["context"])
                            && outcome(&entry["outcome"])
                    })
                    && (record["highest"].is_null()
                        || a.iter().any(|e| {
                            e["context"] == record["highest"] && e["outcome"] == "success"
                        }))
            });
        if !valid {
            return Err("Invalid context calibration ownership or record".into());
        }
    }
    if let Some(inventories) = value.get("inventories") {
        let rows = inventories
            .as_array()
            .filter(|a| a.len() <= 256)
            .ok_or("Invalid self-hosted inventory")?;
        let mut endpoints = std::collections::HashSet::new();
        for row in rows {
            let endpoint = row["endpointId"]
                .as_str()
                .filter(|v| !v.is_empty() && v.len() <= 2048)
                .ok_or("Invalid inventory ownership")?;
            if !endpoints.insert(endpoint)
                || row["observedAt"].as_u64().is_none()
                || row["connected"].as_bool().is_none()
                || !value["endpoints"].as_array().is_some_and(|items| {
                    items.iter().any(|e| {
                        e["id"] == endpoint
                            && e["configurationRevision"] == row["configurationRevision"]
                    })
                })
            {
                return Err("Invalid inventory ownership".into());
            }
            let models = row["models"]
                .as_array()
                .filter(|a| a.len() <= 5000)
                .ok_or("Invalid inventory models")?;
            let mut ids = std::collections::HashSet::new();
            for model in models {
                let name = model["id"]
                    .as_str()
                    .filter(|v| {
                        !v.is_empty() && v.len() <= 1024 && !v.chars().any(char::is_control)
                    })
                    .ok_or("Invalid inventory identity")?;
                if !ids.insert(name)
                    || !matches!(
                        model["chat"].as_str(),
                        Some("supported" | "unsupported" | "unknown")
                    )
                {
                    return Err("Invalid inventory identity".into());
                }
                for field in ["name", "digest", "modifiedAt"] {
                    if !model[field].is_null()
                        && model[field]
                            .as_str()
                            .is_none_or(|s| s.len() > 1024 || s.chars().any(char::is_control))
                    {
                        return Err("Invalid inventory metadata".into());
                    }
                }
                if !model["size"].is_null()
                    && model["size"]
                        .as_u64()
                        .is_none_or(|s| s > 9_007_199_254_740_991)
                {
                    return Err("Invalid inventory size".into());
                }
            }
        }
    }
    Ok(())
}

fn validate_tool_verification(
    state: &Value,
    profile: &Value,
    record: &Value,
) -> Result<(), String> {
    let scope = &record["scope"];
    let bounded = |value: &Value, max: usize| {
        value
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control))
    };
    let time = |v: &Value| v.as_u64().is_some_and(|n| n <= 9_007_199_254_740_991);
    let proof = &record["proof"];
    let failure = &record["failure"];
    let configuration = &record["configuration"];
    let confirmation = &record["confirmation"];
    if record.to_string().len() > 16 * 1024
        || record["version"] != 1
        || !bounded(&record["id"], 128)
        || scope["endpointId"] != profile["endpointId"]
        || scope["model"] != profile["transportModelId"]
        || scope["digest"] != profile["modelRevision"]
        || scope["deployment"] != profile["deploymentId"]
        || scope["backend"] != "ollama"
        || scope["protocol"] != "native-tools-v1"
        || !bounded(&scope["digest"], 1024)
        || !bounded(&scope["runtimeEpoch"], 128)
        || !bounded(&scope["providerVersion"], 64)
        || !bounded(&scope["reasoning"], 2048)
        || !evidence_revision_is_not_future(state, scope)
        || !matches!(
            record["status"].as_str(),
            Some(
                "verifying"
                    | "verified"
                    | "incompatible"
                    | "needs-attention"
                    | "incomplete"
                    | "unsupported"
            )
        )
        || !matches!(
            record["outcome"].as_str(),
            Some(
                "native-call"
                    | "wrong-tool"
                    | "invalid-arguments"
                    | "multiple-calls"
                    | "text-only"
                    | "empty"
                    | "output-length"
                    | "timeout"
                    | "transport"
                    | "offline"
                    | "revision-changed"
                    | "cancelled"
                    | "unsupported"
                    | "interrupted"
                    | "request-limit"
            )
        )
        || !matches!(record["output"].as_u64(), Some(512 | 1024 | 2048))
        || record.get("attempts").is_some_and(|attempts| {
            attempts.as_array().is_none_or(|attempts| {
                attempts.len() > 3
                    || attempts.iter().any(|attempt| {
                        attempt.as_object().is_none_or(|object| object.len() != 5)
                            || !matches!(attempt["output"].as_u64(), Some(512 | 1024 | 2048))
                            || !matches!(
                                attempt["outcome"].as_str(),
                                Some(
                                    "native-call"
                                        | "wrong-tool"
                                        | "invalid-arguments"
                                        | "multiple-calls"
                                        | "text-only"
                                        | "empty"
                                        | "output-length"
                                        | "transport"
                                )
                            )
                            || !bounded(&attempt["finish"], 64)
                            || !time(&attempt["startedAt"])
                            || !time(&attempt["completedAt"])
                    })
            })
        })
        || !record["context"]
            .as_u64()
            .is_some_and(|n| n > 0 && n <= 2_000_000)
        || !time(&record["startedAt"])
        || !time(&record["retryAfter"])
        || !["completedAt", "firstBodyAt", "callAt"]
            .iter()
            .all(|k| record[*k].is_null() || time(&record[*k]))
        || record["calls"].as_u64().is_none_or(|n| n > 2)
        || record["textChars"].as_u64().is_none_or(|n| n > 65536)
        || record["validArguments"].as_bool().is_none()
        || record["textualIntent"].as_bool().is_none()
        || !(record["finish"].is_null() || bounded(&record["finish"], 64))
        || !(proof.is_null() || (time(&proof["at"]) && time(&proof["expiresAt"])))
        || !(failure.is_null()
            || (time(&failure["at"])
                && time(&failure["expiresAt"])
                && matches!(
                    failure["outcome"].as_str(),
                    Some("text-only" | "wrong-tool" | "invalid-arguments" | "multiple-calls")
                )))
        || (record["status"] == "needs-attention" && failure.is_null())
        || !(configuration.is_null()
            || (bounded(&configuration["choice"], 32)
                && (configuration["wire"].is_boolean() || bounded(&configuration["wire"], 32))))
        || !(confirmation.is_null()
            || (!configuration.is_null()
                && !proof.is_null()
                && bounded(&confirmation["id"], 128)
                && confirmation["id"] != record["id"]
                && time(&confirmation["at"])
                && time(&confirmation["expiresAt"])
                && confirmation["at"].as_u64() <= proof["at"].as_u64()
                && confirmation["expiresAt"].as_u64() > confirmation["at"].as_u64()))
        || (record["status"] == "verified"
            && (record["outcome"] != "native-call"
                || record["calls"] != 1
                || record["validArguments"] != true
                || record["callAt"].is_null()
                || record["completedAt"].is_null()
                || proof.is_null()))
    {
        return Err("Invalid tool verification ownership or record".into());
    }
    Ok(())
}

fn compare_and_save(
    current: Value,
    expected: Value,
    value: Value,
    save: impl FnOnce(Value) -> Result<(), String>,
) -> Result<bool, String> {
    validate(&value)?;
    if current != expected {
        return Ok(false);
    }
    save(value)?;
    Ok(true)
}

#[tauri::command]
pub fn self_hosted_profiles_compare_and_swap(
    app: AppHandle,
    expected: Value,
    value: Value,
) -> Result<bool, String> {
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| "Self-hosted settings lock unavailable")?;
    let _file_lock = lock_settings_file(&app, || true)?;
    let current_settings = settings_from_disk(&app)?;
    let previous = current_settings.get(KEY).cloned();
    if !existing_qualifying_rows_preserved(
        &previous.clone().unwrap_or(Value::Null), &value,
    ) {
        return Err("Qualified native CAS effects cannot be overwritten by ordinary settings".into());
    }
    compare_and_save(
        previous.clone().unwrap_or(Value::Null),
        expected,
        value,
        |next| {
            let mut saved = current_settings.clone();
            saved.insert(KEY.into(), next.clone());
            save_ordinary_settings(&app, &current_settings, &saved)?;
            super::inference_probe::settings_changed(&app, &next);
            super::remote_ssh::reconcile(&next);
            Ok(())
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn state() -> Value {
        json!({"version": 1, "revision": 1, "endpoints": [], "profiles": []})
    }

    #[test]
    fn matching_snapshot_saves() {
        assert_eq!(
            compare_and_save(Value::Null, Value::Null, state(), |_| Ok(())),
            Ok(true)
        );
    }

    #[test]
    fn stale_window_cannot_overwrite() {
        assert_eq!(
            compare_and_save(state(), Value::Null, state(), |_| panic!("must not write")),
            Ok(false)
        );
    }

    #[test]
    fn persistence_failure_is_not_success() {
        assert!(
            compare_and_save(Value::Null, Value::Null, state(), |_| Err("disk".into())).is_err()
        );
    }

    #[test]
    fn malformed_and_oversized_envelopes_rejected() {
        assert!(validate(&json!({"version": 2})).is_err());
        let mut oversized = state();
        oversized["endpoints"] = json!(vec![Value::Null; 257]);
        assert!(validate(&oversized).is_err());
        oversized = state();
        oversized["unexpected"] = json!("x".repeat(2 * 1024 * 1024));
        assert!(validate(&oversized).is_err());
    }

    fn calibrated() -> Value {
        json!({"version":1,"revision":1,"endpoints":[{"id":"a","configurationRevision":1}],"profiles":[{
            "endpointId":"a","transportModelId":"model","modelRevision":"digest","deploymentId":null,
            "contextCalibration":{"version":1,"id":"calibration","scope":{"endpointId":"a","configurationRevision":1,
                "model":"model","digest":"digest","deployment":null,"backend":"ollama","runtimeEpoch":"native-epoch",
                "providerVersion":"1.2.3","reasoning":"[false]"},"status":"verified","highest":8192,"failedNext":null,
                "failure":null,"allocation":"receipt","startedAt":1,"updatedAt":2,"expiresAt":3,"retryAfter":3,
                "attempts":[{"context":8192,"requested":8192,"loaded":8192,"outcome":"success","at":2,"latencyMs":10,
                    "thermal":"cold","finish":"stop","think":"omitted"}]}
        }]})
    }

    #[test]
    fn context_calibration_is_restart_safe_and_compare_and_swap_owned() {
        let value = calibrated();
        let restored: Value = serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&restored).unwrap();
        assert_eq!(
            compare_and_save(
                restored.clone(),
                restored.clone(),
                value.clone(),
                |_| Ok(())
            ),
            Ok(true)
        );
        assert_eq!(
            compare_and_save(restored, Value::Null, value, |_| panic!(
                "stale owner must not write"
            )),
            Ok(false)
        );
    }

    #[test]
    fn seven_exact_loaded_context_tiers_through_73728_are_persistable_but_larger_or_unproved_are_not(
    ) {
        let mut value = calibrated();
        let original = value["profiles"][0]["contextCalibration"]["attempts"][0].clone();
        let ladder = [4096_u64, 8192, 16384, 32768, 49152, 65536, 73728];
        let attempts: Vec<Value> = ladder
            .iter()
            .enumerate()
            .map(|(i, context)| {
                let mut attempt = original.clone();
                attempt["context"] = json!(context);
                attempt["requested"] = json!(context);
                attempt["loaded"] = json!(context);
                attempt["at"] = json!(i + 1);
                attempt
            })
            .collect();
        let record = &mut value["profiles"][0]["contextCalibration"];
        record["attempts"] = json!(attempts);
        record["highest"] = json!(73728);
        record["updatedAt"] = json!(7);
        record["expiresAt"] = json!(15);
        record["retryAfter"] = json!(15);
        validate(&value).unwrap();
        let roundtrip: Value =
            serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&roundtrip).unwrap();
        assert_eq!(roundtrip, value);
        assert_eq!(
            compare_and_save(value.clone(), value.clone(), roundtrip, |_| Ok(())),
            Ok(true)
        );

        let mut invalid = value.clone();
        invalid["profiles"][0]["contextCalibration"]["highest"] = json!(81920);
        assert!(validate(&invalid).is_err());
        invalid = value.clone();
        invalid["profiles"][0]["contextCalibration"]["attempts"][6]["loaded"] = json!(65536);
        assert!(validate(&invalid).is_err());
        invalid = value.clone();
        invalid["profiles"][0]["contextCalibration"]["attempts"][6]["context"] = json!(81920);
        invalid["profiles"][0]["contextCalibration"]["attempts"][6]["requested"] = json!(81920);
        invalid["profiles"][0]["contextCalibration"]["attempts"][6]["loaded"] = json!(81920);
        invalid["profiles"][0]["contextCalibration"]["highest"] = json!(81920);
        assert!(validate(&invalid).is_err());

        let mut bounded_restore = value.clone();
        let retained = bounded_restore["profiles"][0]["contextCalibration"]["attempts"][5].clone();
        bounded_restore["profiles"][0]["contextCalibration"]["attempts"]
            .as_array_mut()
            .unwrap()
            .push(retained);
        validate(&bounded_restore).unwrap(); // seventh probe plus a bounded restore
        let overflow = bounded_restore["profiles"][0]["contextCalibration"]["attempts"][0].clone();
        bounded_restore["profiles"][0]["contextCalibration"]["attempts"]
            .as_array_mut()
            .unwrap()
            .push(overflow);
        assert!(validate(&bounded_restore).is_err());
        let mut legacy = value;
        legacy["profiles"][0]["contextCalibration"]["highest"] = json!(65536);
        legacy["profiles"][0]["contextCalibration"]["attempts"]
            .as_array_mut()
            .unwrap()
            .pop();
        validate(&legacy).unwrap();
    }

    #[test]
    fn context_calibration_rejects_cross_owner_false_allocation_and_unbounded_metadata() {
        for (path, invalid) in [
            ("/scope/endpointId", json!("other")),
            ("/scope/configurationRevision", json!(2)),
            ("/scope/digest", json!("changed")),
            ("/highest", json!(131072)),
            ("/attempts/0/loaded", json!(4096)),
            ("/failure", json!("fabricated")),
            ("/attempts/0/thermal", json!("fabricated")),
            ("/allocation", json!("x".repeat(1025))),
        ] {
            let mut value = calibrated();
            *value["profiles"][0]["contextCalibration"]
                .pointer_mut(path)
                .unwrap() = invalid;
            assert!(validate(&value).is_err(), "accepted {path}");
        }
        let mut value = calibrated();
        value["profiles"][0]["contextCalibration"]["attempts"] = json!([]);
        assert!(validate(&value).is_err());
        let mut value = calibrated();
        let record = &mut value["profiles"][0]["contextCalibration"];
        record["highest"] = Value::Null;
        record["failure"] = json!("transient");
        record["status"] = json!("incomplete");
        record["attempts"][0]["loaded"] = json!(131072);
        record["attempts"][0]["outcome"] = json!("transient");
        validate(&value).unwrap();
    }

    fn tool_verified() -> Value {
        let mut value = calibrated();
        value["profiles"][0]["toolVerification"] = json!({"version":1,"id":"tools","scope":{"endpointId":"a","configurationRevision":1,
            "model":"model","digest":"digest","deployment":null,"backend":"ollama","runtimeEpoch":"native","providerVersion":"1.2.3",
            "reasoning":"[false]","protocol":"native-tools-v1"},"status":"verified","outcome":"native-call","context":8192,"output":512,
            "startedAt":1,"completedAt":2,"firstBodyAt":2,"callAt":2,"calls":1,"validArguments":true,"textualIntent":false,"textChars":0,
            "finish":"tool-calls","proof":{"at":2,"expiresAt":3},"retryAfter":3});
        value
    }

    #[test]
    fn tool_verification_roundtrip_and_cas_preserve_context_and_ownership() {
        let value = tool_verified();
        let restored: Value = serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&restored).unwrap();
        assert_eq!(
            restored["profiles"][0]["contextCalibration"],
            calibrated()["profiles"][0]["contextCalibration"]
        );
        assert_eq!(
            compare_and_save(value.clone(), value.clone(), restored, |_| Ok(())),
            Ok(true)
        );
        assert_eq!(
            compare_and_save(value.clone(), Value::Null, value, |_| panic!("stale write")),
            Ok(false)
        );
    }

    #[test]
    fn reenable_preserves_old_proof_but_rejects_future_revision_and_cross_identity() {
        let original = tool_verified();
        validate(&original).unwrap();
        let mut reenabled = original.clone();
        reenabled["endpoints"][0]["configurationRevision"] = json!(2);
        reenabled["endpoints"][0]["enabled"] = json!(true);
        // A native CAS must preserve, not erase, the previous revision's
        // context and tool receipts. Admission requires an exact live scope.
        validate(&reenabled).unwrap();
        assert_eq!(
            compare_and_save(original.clone(), original, reenabled.clone(), |_| Ok(())),
            Ok(true)
        );
        assert_eq!(
            reenabled["profiles"][0]["toolVerification"]["scope"]["configurationRevision"],
            json!(1)
        );
        assert_eq!(
            reenabled["profiles"][0]["contextCalibration"]["scope"]["configurationRevision"],
            json!(1)
        );
        for scope in ["contextCalibration", "toolVerification"] {
            let mut future = reenabled.clone();
            future["profiles"][0][scope]["scope"]["configurationRevision"] = json!(3);
            assert!(validate(&future).is_err(), "{scope} future proof admitted");
            let mut missing = reenabled.clone();
            missing["profiles"][0][scope]["scope"]["configurationRevision"] = json!(0);
            assert!(validate(&missing).is_err(), "{scope} zero revision admitted");
            let mut foreign = reenabled.clone();
            foreign["profiles"][0][scope]["scope"]["endpointId"] = json!("foreign");
            assert!(validate(&foreign).is_err(), "{scope} foreign endpoint admitted");
            let mut digest = reenabled.clone();
            digest["profiles"][0][scope]["scope"]["digest"] = json!("wrong");
            assert!(validate(&digest).is_err(), "{scope} foreign digest admitted");
            let mut model = reenabled.clone();
            model["profiles"][0][scope]["scope"]["model"] = json!("wrong");
            assert!(validate(&model).is_err(), "{scope} foreign model admitted");
        }
        let mut missing_host = reenabled;
        missing_host["endpoints"] = json!([]);
        assert!(validate(&missing_host).is_err());
    }

    #[test]
    fn tool_verification_rejects_wrong_owner_version_and_fabricated_success() {
        for (path, invalid) in [
            ("/scope/digest", json!("other")),
            ("/scope/endpointId", json!("other")),
            ("/scope/protocol", json!("future")),
            ("/version", json!(2)),
            ("/validArguments", json!(false)),
            ("/calls", json!(2)),
            ("/proof", Value::Null),
            ("/output", json!(4096)),
        ] {
            let mut value = tool_verified();
            *value["profiles"][0]["toolVerification"]
                .pointer_mut(path)
                .unwrap() = invalid;
            assert!(validate(&value).is_err(), "accepted {path}");
        }
    }

    #[test]
    fn tool_verification_preserves_bounded_conflicting_evidence() {
        let mut value = tool_verified();
        let record = &mut value["profiles"][0]["toolVerification"];
        record["failure"] = json!({"at":2,"expiresAt":3,"outcome":"text-only"});
        validate(&value).unwrap();
        let record = &mut value["profiles"][0]["toolVerification"];
        record["status"] = json!("needs-attention");
        record["outcome"] = json!("text-only");
        record["calls"] = json!(0);
        record["validArguments"] = json!(false);
        let restored: Value = serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&restored).unwrap();
        assert_eq!(
            restored["profiles"][0]["toolVerification"]["proof"],
            json!({"at":2,"expiresAt":3})
        );
        for invalid in [
            Value::Null,
            json!({"at":2,"expiresAt":3,"outcome":"native-call"}),
            json!({"at":-1,"expiresAt":3,"outcome":"text-only"}),
        ] {
            let mut invalid_record = value.clone();
            invalid_record["profiles"][0]["toolVerification"]["failure"] = invalid;
            assert!(validate(&invalid_record).is_err());
        }
    }

    #[test]
    fn escalated_tool_evidence_is_bounded_and_survives_native_cas() {
        for output in [512, 1024, 2048] {
            let mut value = tool_verified();
            value["profiles"][0]["toolVerification"]["output"] = json!(output);
            value["profiles"][0]["toolVerification"]["attempts"] = json!([
                {"output":output,"outcome":"native-call","finish":"tool-calls","startedAt":1,"completedAt":2}
            ]);
            let restored: Value =
                serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
            assert_eq!(
                compare_and_save(value.clone(), value, restored, |_| Ok(())),
                Ok(true)
            );
        }
        let mut incomplete = tool_verified();
        let record = &mut incomplete["profiles"][0]["toolVerification"];
        record["status"] = json!("incomplete");
        record["outcome"] = json!("request-limit");
        record["proof"] = Value::Null;
        record["calls"] = json!(0);
        record["validArguments"] = json!(false);
        validate(&incomplete).unwrap();
    }

    #[test]
    fn native_tool_attempt_metadata_rejects_unbounded_or_malformed_records() {
        let attempt = json!({"output":512,"outcome":"output-length","finish":"length","startedAt":1,"completedAt":2});
        for invalid in [
            json!([
                attempt.clone(),
                attempt.clone(),
                attempt.clone(),
                attempt.clone()
            ]),
            Value::Null,
            json!({}),
        ] {
            let mut value = tool_verified();
            value["profiles"][0]["toolVerification"]["attempts"] = invalid;
            assert!(validate(&value).is_err());
        }
        for (field, invalid) in [
            ("output", json!(4096)),
            ("outcome", json!("invented")),
            ("finish", json!("x".repeat(65))),
            ("startedAt", json!(-1)),
            ("extra", json!(true)),
        ] {
            let mut value = tool_verified();
            let mut changed = attempt.clone();
            changed[field] = invalid;
            value["profiles"][0]["toolVerification"]["attempts"] = json!([changed]);
            assert!(validate(&value).is_err(), "accepted {field}");
        }
    }

    #[test]
    fn agent_configuration_confirmation_is_bounded_owned_and_restart_safe() {
        let mut value = tool_verified();
        let mut record = value["profiles"][0]["toolVerification"].clone();
        record["configuration"] = json!({"choice":"none","wire":false});
        record["confirmation"] = json!({"id":"earlier-native-pass","at":1,"expiresAt":3});
        value["profiles"][0]["agentToolConfigurations"] = json!([record.clone()]);
        let restored: Value = serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&restored).unwrap();
        for records in [
            json!([record.clone(), record.clone()]),
            json!([record.clone(), record.clone(), record.clone()]),
        ] {
            let mut invalid = value.clone();
            invalid["profiles"][0]["agentToolConfigurations"] = records;
            assert!(validate(&invalid).is_err());
        }
        for (path, invalid) in [
            ("/scope/digest", json!("other")),
            ("/configuration/wire", json!({})),
            ("/confirmation/id", json!("tools")),
            ("/confirmation/at", json!(4)),
        ] {
            let mut changed = value.clone();
            *changed["profiles"][0]["agentToolConfigurations"][0]
                .pointer_mut(path)
                .unwrap() = invalid;
            assert!(validate(&changed).is_err(), "accepted {path}");
        }
    }

    // LM11 B03 fault injection exercises the same native admission, inert
    // preparation, monotonic gate, save boundary and reconciliation helpers
    // used by the Tauri commands. These fixtures NEVER execute inference.
    fn b03_gate(kind: &str, ms: u64) -> QualificationCasGate {
        QualificationCasGate {
            ticket: QualificationCasTicket {
                operation_id: "offline-b03-operation".into(),
                native_epoch: "offline-native-process-epoch".into(),
            },
            expiry: Instant::now() + Duration::from_millis(ms),
            deployment_id: "deployment-a".into(),
            runtime_epoch: "runtime-a".into(),
            process_id: None,
            kind: kind.into(),
            revoked: Arc::new(AtomicBool::new(false)),
            prepared: false,
            prepared_revision: None,
        }
    }
    fn b03_state(kind: &str) -> (Value, Value) {
        let old = json!({"version":1,"revision":7,"endpoints":[],"profiles":[],
            "fabric":{"version":1,"hosts":[],"runtimes":[],"artifacts":[],"deployments":[],
                "qualificationReceipts":[],"measurementRuns":[]}});
        let mut next = old.clone();
        next["revision"] = json!(8);
        let field = if kind == "lm2f" { "qualificationReceipts" } else { "measurementRuns" };
        next["fabric"][field] = json!([{
            "version": if kind == "lm2f" {2} else {1},
            "scope":{"deploymentId":"deployment-a","runtimeEpoch":"runtime-a"},
            "capability": if kind == "lm2f" {"chat"} else {"measurement"},
            "runId": if kind == "lm6" {"offline-run-1"} else {""},
            "status":"verified",
            "evidence":"offline-only",
        }]);
        (old, next)
    }

    #[test]
    fn b03_deployment_scoped_gates_do_not_cross_cancel_evict_or_replace() {
        let mut slots = std::collections::BTreeMap::new();
        let mut a = b03_gate("lm2f", 10_000);
        a.ticket.operation_id = "native-a-operation".into();
        a.ticket.native_epoch = "native-a-epoch".into();
        let mut b = b03_gate("lm2f", 10_000);
        b.deployment_id = "deployment-b".into();
        b.runtime_epoch = "runtime-b".into();
        b.ticket.operation_id = "native-b-operation".into();
        b.ticket.native_epoch = "native-b-epoch".into();
        let mut c = b03_gate("lm2f", 10_000);
        c.deployment_id = "deployment-c".into();
        c.runtime_epoch = "runtime-c".into();
        c.ticket.operation_id = "native-c-operation".into();
        c.ticket.native_epoch = "native-c-epoch".into();
        for gate in [&a, &b, &c] {
            insert_deployment_qualifier_gate(&mut slots, gate.clone(), |_| true).unwrap();
        }
        assert_eq!(slots.len(), 3);
        assert!(slots.values().any(|g| eligible(g, &b.ticket, Instant::now(), |_| true)));
        assert!(slots.values().any(|g| eligible(g, &c.ticket, Instant::now(), |_| true)));
        // Re-admission of A is denied while its original operation is live;
        // a denied second A cannot alter the existing A or B/C gate.
        let mut second_a = a.clone();
        second_a.ticket.operation_id = "second-a-operation".into();
        second_a.revoked = Arc::new(AtomicBool::new(false));
        assert!(insert_deployment_qualifier_gate(&mut slots, second_a.clone(), |_| true).is_err());
        assert_eq!(slots["deployment-a"].ticket.operation_id, a.ticket.operation_id);
        assert_eq!(slots["deployment-b"].ticket.operation_id, b.ticket.operation_id);
        assert_eq!(slots["deployment-c"].ticket.operation_id, c.ticket.operation_id);
        // A's retirement frees only A. Its stale ticket can never match A2
        // or cancel B/C even if callers retain the old ticket bytes.
        slots["deployment-a"].revoked.store(true, Ordering::Release);
        assert!(insert_deployment_qualifier_gate(&mut slots, second_a.clone(),
            |g| !g.revoked.load(Ordering::Acquire)).is_ok());
        assert!(!eligible(&slots["deployment-a"], &a.ticket, Instant::now(), |_| true));
        assert!(eligible(&slots["deployment-a"], &second_a.ticket, Instant::now(), |_| true));
        assert!(eligible(&slots["deployment-b"], &b.ticket, Instant::now(), |_| true));
        assert!(eligible(&slots["deployment-c"], &c.ticket, Instant::now(), |_| true));
        assert!(!eligible(&slots["deployment-b"], &a.ticket, Instant::now(), |_| true));
        assert!(!eligible(&slots["deployment-c"], &a.ticket, Instant::now(), |_| true));
    }

    #[test]
    fn b03_distinct_deployment_receipts_serialize_without_cross_scope_cas_conflict() {
        let (original, mut b_proposal) = b03_state("lm2f");
        let mut b = b03_gate("lm2f", 10_000);
        b.deployment_id = "deployment-b".into();
        b.runtime_epoch = "runtime-b".into();
        b.ticket.operation_id = "operation-b".into();
        b.ticket.native_epoch = "native-b".into();
        b_proposal["fabric"]["qualificationReceipts"][0]["scope"]["deploymentId"] =
            json!(&b.deployment_id);
        b_proposal["fabric"]["qualificationReceipts"][0]["scope"]["runtimeEpoch"] =
            json!(&b.runtime_epoch);
        let pending_b = prepare_qualifying_value(&original, b_proposal, &b).unwrap();
        let ack_b = acknowledge_qualifying_value(pending_b, &b).unwrap();
        assert_eq!(examine_qualifying_rows(&ack_b, &b.ticket), "committed");

        let mut c = b03_gate("lm2f", 10_000);
        c.deployment_id = "deployment-c".into();
        c.runtime_epoch = "runtime-c".into();
        c.ticket.operation_id = "operation-c".into();
        c.ticket.native_epoch = "native-c".into();
        let mut c_proposal = ack_b.clone();
        c_proposal["revision"] = json!(9);
        c_proposal["fabric"]["qualificationReceipts"].as_array_mut().unwrap().push(json!({
            "version":2,
            "scope":{"deploymentId":c.deployment_id,"runtimeEpoch":c.runtime_epoch},
            "capability":"streaming","status":"verified","evidence":"offline-only",
        }));
        let pending_c = prepare_qualifying_value(&ack_b, c_proposal, &c).unwrap();
        // The one settings-file revision is globally serialized, but B's
        // acknowledged physical markers cannot become a false conflict for C.
        assert_eq!(examine_qualifying_rows(&pending_c, &b.ticket), "committed");
        assert_eq!(examine_qualifying_rows(&pending_c, &c.ticket), "pending");
        let ack_c = acknowledge_qualifying_value(pending_c, &c).unwrap();
        assert_eq!(examine_qualifying_rows(&ack_c, &b.ticket), "committed");
        assert_eq!(examine_qualifying_rows(&ack_c, &c.ticket), "committed");
        assert_eq!(receipt_rows(&ack_c, "lm2f").unwrap().len(), 2);
        assert_eq!(ack_c["revision"], 9);
    }

    #[test]
    fn b03_pending_effects_are_inert_until_native_ack_and_survive_restart() {
        for kind in ["lm2f", "lm6"] {
            let gate = b03_gate(kind, 10_000);
            let (old, next) = b03_state(kind);
            let pending = prepare_qualifying_value(&old, next, &gate).unwrap();
            assert_eq!(examine_qualifying_rows(&pending, &gate.ticket), "pending");
            assert_eq!(receipt_rows(&pending, kind).unwrap()[0]["version"], 0);
            assert!(!existing_qualifying_rows_preserved(&old, &pending));
            let recovered: Value =
                serde_json::from_slice(&serde_json::to_vec(&pending).unwrap()).unwrap();
            assert_eq!(examine_qualifying_rows(&recovered, &gate.ticket), "pending");
            let ack = acknowledge_qualifying_value(recovered.clone(), &gate).unwrap();
            assert_eq!(examine_qualifying_rows(&ack, &gate.ticket), "committed");
            assert!(acknowledge_qualifying_value(ack.clone(), &gate).is_err());
            assert!(!existing_qualifying_rows_preserved(&recovered, &ack));
            let restored: Value =
                serde_json::from_slice(&serde_json::to_vec(&ack).unwrap()).unwrap();
            assert_eq!(examine_qualifying_rows(&restored, &gate.ticket), "committed");
            assert_eq!(receipt_rows(&restored, kind).unwrap().len(), 1);
            let unknown = QualificationCasTicket {
                operation_id: "unknown".into(), native_epoch: gate.ticket.native_epoch.clone(),
            };
            assert_eq!(examine_qualifying_rows(&restored, &unknown), "absent");
        }
    }

    #[test]
    fn b03_rejects_stale_identity_duplicate_effect_and_forged_plain_cas() {
        let gate = b03_gate("lm2f", 10_000);
        let (old, mut next) = b03_state("lm2f");
        next["fabric"]["qualificationReceipts"][0]["scope"]["runtimeEpoch"] = json!("stale");
        assert!(prepare_qualifying_value(&old, next, &gate).is_err());
        let (_, mut next) = b03_state("lm2f");
        next["fabric"]["qualificationReceipts"][0]["scope"]["deploymentId"] = json!("wrong");
        assert!(prepare_qualifying_value(&old, next, &gate).is_err());
        let (_, mut next) = b03_state("lm6");
        next["fabric"]["measurementRuns"][0]["scope"]["deploymentId"] = json!("wrong");
        assert!(prepare_qualifying_value(&old, next, &b03_gate("lm6", 10_000)).is_err());
        let (_, mut next) = b03_state("lm2f");
        next["revision"] = json!(7);
        assert!(prepare_qualifying_value(&old, next, &gate).is_err());
        let (_, mut next) = b03_state("lm2f");
        let original = next["fabric"]["qualificationReceipts"][0].clone();
        next["fabric"]["qualificationReceipts"] = json!([original.clone(), original]);
        assert!(prepare_qualifying_value(&old, next, &gate).is_err());
        assert!(existing_qualifying_rows_preserved(&old, &old));
        let (_, next) = b03_state("lm2f");
        assert!(!existing_qualifying_rows_preserved(&old, &next));
        let mut ordinary = old.clone();
        ordinary["revision"] = json!(8);
        ordinary["additionalSetting"] = json!("ordinary consumer remains writable");
        assert!(existing_qualifying_rows_preserved(&old, &ordinary));
    }

    #[test]
    fn b03_pre_admission_expiry_cancellation_and_runtime_epoch_are_fail_closed() {
        let gate = b03_gate("lm6", 10_000);
        let ticket = gate.ticket.clone();
        assert!(eligible(&gate, &ticket, Instant::now(), |_| true));
        let wrong = QualificationCasTicket {
            operation_id: ticket.operation_id.clone(), native_epoch: "previous-boot".into(),
        };
        assert!(!eligible(&gate, &wrong, Instant::now(), |_| true));
        assert!(!eligible(&gate, &ticket, Instant::now(), |_| false));
        assert!(!eligible(&gate, &ticket, gate.expiry, |_| true));
        gate.revoked.store(true, Ordering::Release);
        assert!(!eligible(&gate, &ticket, Instant::now(), |_| true));
        assert_eq!(guarded_native_save_checked(|| eligible(&gate, &ticket, Instant::now(), |_| true),
            || panic!("must not write")), "rejected");
    }

    #[test]
    fn b03_disk_stall_failure_and_late_ack_never_return_acknowledged() {
        let gate = b03_gate("lm6", 10_000);
        let live = || eligible(&gate, &gate.ticket, Instant::now(), |_| true);
        assert_eq!(guarded_native_save_checked(live, || Ok(())), "acknowledged");
        assert_eq!(guarded_native_save_checked(live, || Err("disk-full".into())), "ambiguous");
        assert_eq!(guarded_native_save_checked(live, || {
            gate.revoked.store(true, Ordering::Release);
            Ok(())
        }), "ambiguous");
        assert_eq!(guarded_native_save_checked(live, || panic!("late retry")), "rejected");
        let short = b03_gate("lm6", 10);
        let short_live = || eligible(&short, &short.ticket, Instant::now(), |_| true);
        assert_eq!(guarded_native_save_checked(short_live, || {
            std::thread::sleep(Duration::from_millis(25));
            Ok(())
        }), "ambiguous");
        assert_eq!(guarded_native_save_checked(short_live, || panic!("expired start")), "rejected");
    }

    #[test]
    fn b03_storage_mutex_delay_is_bounded_and_no_effect_is_written() {
        let locked = WRITE_LOCK.lock().unwrap();
        let gate = b03_gate("lm6", 10);
        let rejected = std::thread::spawn(move ||
            lock_with_qualifier_deadline_checked(||
                eligible(&gate, &gate.ticket, Instant::now(), |_| true)).map(|_| "acquired"));
        assert!(rejected.join().unwrap().is_err());
        drop(locked);
        let ready = b03_gate("lm6", 500);
        assert!(lock_with_qualifier_deadline_checked(||
            eligible(&ready, &ready.ticket, Instant::now(), |_| true)).is_ok());
    }

    #[test]
    fn b03_cas_conflict_and_pre_save_failure_never_replay_effect() {
        let (old, next) = b03_state("lm2f");
        let mut writes = 0;
        let conflict = compare_and_save(old.clone(), Value::Null, next.clone(),
            |_| { writes += 1; Ok(()) });
        assert_eq!(conflict, Ok(false));
        assert_eq!(writes, 0);
        let disk_failure = compare_and_save(old.clone(), old, next,
            |_| { writes += 1; Err("disk failed".into()) });
        assert!(disk_failure.is_err());
        assert_eq!(writes, 1); // never retried into success
    }

    #[test]
    fn b03_bounded_histories_keep_native_reconciliation_markers() {
        for (kind, limit) in [("lm2f", 128), ("lm6", 48)] {
            let gate = b03_gate(kind, 10_000);
            let (mut old, _) = b03_state(kind);
            let field = if kind == "lm2f" { "qualificationReceipts" } else { "measurementRuns" };
            old["fabric"][field] = json!((0..limit).map(|i| json!({
                "version": 99, "legacyEvidenceIndex": i,
            })).collect::<Vec<_>>());
            let mut proposal = old.clone();
            proposal["revision"] = json!(8);
            let (_, fresh) = b03_state(kind);
            let appended = fresh["fabric"][field][0].clone();
            let mut rows = old["fabric"][field].as_array().unwrap()[1..].to_vec();
            rows.push(appended.clone());
            proposal["fabric"][field] = json!(rows);
            let pending = prepare_qualifying_value(&old, proposal.clone(), &gate).unwrap();
            assert_eq!(pending["fabric"][field].as_array().unwrap().len(), limit);
            assert_eq!(examine_qualifying_rows(&pending, &gate.ticket), "pending");

            // A prior unknown-commit marker may never be trimmed to make room.
            old["fabric"][field][0][QUAL_MARKER] = json!({
                "operationId":"earlier", "nativeEpoch":"boot", "phase":"pending"
            });
            assert!(prepare_qualifying_value(&old, proposal, &gate).is_err());
            // Ordinary CAS can trim only oldest unmarked legacy records.
            let mut shorter = old.clone();
            shorter["fabric"][field] = json!(old["fabric"][field]
                .as_array().unwrap()[1..].to_vec());
            assert!(!existing_qualifying_rows_preserved(&old, &shorter));
        }
    }

    #[test]
    fn b03_ordinary_cas_can_trim_unmarked_legacy_history_but_not_add_success() {
        let (mut old, _) = b03_state("lm2f");
        old["fabric"]["qualificationReceipts"] = json!([
            {"version":1,"legacy":1}, {"version":1,"legacy":2}
        ]);
        let mut trimmed = old.clone();
        trimmed["fabric"]["qualificationReceipts"] = json!([
            {"version":1,"legacy":2}
        ]);
        assert!(existing_qualifying_rows_preserved(&old, &trimmed));
        trimmed["fabric"]["qualificationReceipts"]
            .as_array_mut().unwrap().push(json!({"version":2}));
        assert!(!existing_qualifying_rows_preserved(&old, &trimmed));
        assert!(!native_eligible(&b03_gate("lm6", 10_000),
            &b03_gate("lm6", 10_000).ticket)); // remote has no native epoch authority
    }

    #[test]
    fn b03_restart_new_ticket_cannot_replay_same_scope_unknown_commit() {
        for kind in ["lm2f", "lm6"] {
            let gate = b03_gate(kind, 10_000);
            let (old, next) = b03_state(kind);
            assert!(!prior_qualifier_for_scope(&old, &gate));
            let pending = prepare_qualifying_value(&old, next, &gate).unwrap();
            assert!(prior_qualifier_for_scope(&pending, &gate));
            let acknowledged = acknowledge_qualifying_value(pending, &gate).unwrap();
            assert!(prior_qualifier_for_scope(&acknowledged, &gate));
            let restarted = QualificationCasGate {
                ticket: QualificationCasTicket {
                    operation_id: "new-ticket-after-restart".into(),
                    native_epoch: "new-native-boot".into(),
                }, ..gate.clone()
            };
            assert!(prior_qualifier_for_scope(&acknowledged, &restarted));
            let rolled_epoch = QualificationCasGate {
                runtime_epoch: "legitimate-new-runtime-process".into(), ..restarted
            };
            assert!(!prior_qualifier_for_scope(&acknowledged, &rolled_epoch));
        }
    }

    #[test]
    fn b03_superseded_prepared_gate_revokes_old_epoch_without_replaying_effect() {
        let mut old = b03_gate("lm2f", 10_000);
        old.prepared = true;
        old.prepared_revision = Some(8);
        let old_ticket = old.ticket.clone();
        let revocation = old.revoked.clone();
        let mut slot = Some(old);
        let mut next = b03_gate("lm2f", 10_000);
        next.ticket.operation_id = "new-explicit-attempt".into();
        next.ticket.native_epoch = "new-native-ticket".into();
        next.runtime_epoch = "new-managed-runtime-epoch".into();
        assert!(replace_stale_qualifier_slot(&mut slot, next.clone(), |g|
            eligible(g, &g.ticket, Instant::now(), |_| true)).is_err());
        assert!(!revocation.load(Ordering::Acquire));
        replace_stale_qualifier_slot(&mut slot, next, |_| false).unwrap();
        assert!(revocation.load(Ordering::Acquire));
        assert_eq!(slot.as_ref().unwrap().ticket.operation_id, "new-explicit-attempt");
        assert!(!eligible(slot.as_ref().unwrap(), &old_ticket,
            Instant::now(), |_| true));
    }

    #[test]
    fn b03_actual_fs_write_exposes_unfenced_post_deadline_disk_boundary() {
        // tauri-plugin-store 2.4.3::Store::save ultimately calls fs::write.
        // This deterministic *counterexample* is intentionally not a B03
        // acceptance assertion: after a pre-save guard, disk I/O may cross the
        // deadline and leave an acknowledged row despite Unknown to caller.
        // A completed native ticket is not equivalent to OS-atomic commit.
        let gate = b03_gate("lm6", 10);
        let (old, new) = b03_state("lm6");
        let prepared = prepare_qualifying_value(&old, new, &gate).unwrap();
        let active = acknowledge_qualifying_value(prepared, &gate).unwrap();
        let path = std::env::temp_dir().join(format!("clack-b03-{}-{}.json",
            std::process::id(), qualifier_epoch().unwrap()));
        let live = || eligible(&gate, &gate.ticket, Instant::now(), |_| true);
        let result = guarded_native_save_checked(live, || {
            std::thread::sleep(Duration::from_millis(25));
            std::fs::write(&path, serde_json::to_vec(&active).unwrap())
                .map_err(|e| e.to_string())
        });
        assert_eq!(result, "ambiguous");
        let on_disk: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(examine_qualifying_rows(&on_disk, &gate.ticket), "committed");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn b03_crash_reconciliation_never_calls_corruption_a_definite_noncommit() {
        let gate = b03_gate("lm2f", 10_000);
        let (old, candidate) = b03_state("lm2f");
        assert_eq!(examine_qualifying_rows(&old, &gate.ticket), "absent");
        let prepared = prepare_qualifying_value(&old, candidate, &gate).unwrap();
        assert_eq!(examine_qualifying_rows(&prepared, &gate.ticket), "pending");
        let acknowledged = acknowledge_qualifying_value(prepared, &gate).unwrap();
        assert_eq!(examine_qualifying_rows(&acknowledged, &gate.ticket), "committed");
        let mut corrupted = acknowledged.clone();
        corrupted["fabric"]["qualificationReceipts"][0]["qualificationCas"]["phase"] =
            json!("corrupt");
        assert_eq!(examine_qualifying_rows(&corrupted, &gate.ticket), "unknown");
        let mut corrupted_identity = acknowledged;
        corrupted_identity["fabric"]["qualificationReceipts"][0]["qualificationCas"]["operationId"] =
            json!(false);
        assert_eq!(examine_qualifying_rows(&corrupted_identity, &gate.ticket), "unknown");
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("terax-settings.json");
        std::fs::write(&path, b"{corrupt authoritative json").unwrap();
        assert!(read_settings_file(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{corrupt authoritative json");
    }

    #[test]
    fn b03_existing_authority_never_normalizes_corrupt_or_inconsistent_receipts() {
        let dir=tempfile::tempdir().unwrap();
        let main=dir.path().join("terax-settings.json");
        let malformed=b"{unresolved native B03 authority";
        std::fs::write(&main,malformed).unwrap();
        assert!(read_settings_file(&main).is_err());
        assert_eq!(std::fs::read(&main).unwrap(),malformed);

        let gate=b03_gate("lm2f",10_000);
        let (old,next)=b03_state("lm2f");
        let mut prepared=prepare_qualifying_value(&old,next,&gate).unwrap();
        prepared["fabric"]["qualificationReceipts"][0][QUAL_MARKER]["phase"]=
            json!("acknowledged");
        let inconsistent=serde_json::to_vec(&json!({KEY:prepared})).unwrap();
        std::fs::write(&main,&inconsistent).unwrap();
        assert!(read_settings_file(&main).is_err());
        assert_eq!(std::fs::read(&main).unwrap(),inconsistent);

        // A valid main ALWAYS wins over the obsolete/corrupt recovery file.
        let valid=serde_json::to_vec(&json!({"ordinary":"preserved"})).unwrap();
        std::fs::write(&main,&valid).unwrap();
        std::fs::write(dir.path().join(".terax-settings.json.replaced-backup"),malformed).unwrap();
        assert_eq!(read_settings_file(&main).unwrap()["ordinary"],"preserved");
        assert_eq!(std::fs::read(&main).unwrap(),valid);
    }

    #[test]
    fn b03_missing_authority_never_fabricates_empty_settings_or_uses_corrupt_backup() {
        let dir=tempfile::tempdir().unwrap();
        let main=dir.path().join("terax-settings.json");
        let backup=dir.path().join(".terax-settings.json.replaced-backup");
        // This may be an interrupted real replacement, NOT a new install.
        assert!(read_settings_file(&main).is_err());
        assert!(!main.exists());
        let forensic=b"{corrupt previous recovery";
        std::fs::write(&backup,forensic).unwrap();
        assert!(read_settings_file(&main).is_err());
        assert!(!main.exists());
        assert_eq!(std::fs::read(&backup).unwrap(),forensic);
    }

    #[test]
    fn b03_atomic_existing_settings_map_retains_unrelated_consumers() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("terax-settings.json");
        let old = json!({"theme":"dark","shortcuts":{"x":"y"},
            "selfHostedInference":{"version":1,"revision":1,"endpoints":[],"profiles":[]}});
        std::fs::write(&path, serde_json::to_vec(&old).unwrap()).unwrap();
        let mut next = read_settings_file(&path).unwrap();
        let prior = next["selfHostedInference"].clone();
        let mut updated = prior.clone();
        updated["revision"] = json!(2);
        next.insert(KEY.into(), updated);
        let outcome = self_hosted_atomic_file::replace_settings_file(
            &path, &serde_json::to_vec(&next).unwrap(), || true,
        );
        assert_eq!(outcome, PhysicalOutcome::Crossed);
        let restored = read_settings_file(&path).unwrap();
        assert_eq!(restored["theme"], "dark");
        assert_eq!(restored["shortcuts"], json!({"x":"y"}));
        assert_eq!(restored[KEY]["revision"], 2);
        assert_eq!(restored.len(), 3);
    }

    #[test]
    fn b03_interprocess_settings_lock_fails_closed_and_releases_after_crash() {
        const CHILD: &str = "CLACK_B03_FILE_LOCK_CHILD_PATH";
        const READY: &str = "CLACK_B03_FILE_LOCK_READY_PATH";
        if let (Some(target), Some(ready)) = (
            std::env::var_os(CHILD), std::env::var_os(READY),
        ) {
            let _lock = lock_settings_path(&PathBuf::from(target), || true).unwrap();
            std::fs::write(ready, b"locked").unwrap();
            std::thread::sleep(Duration::from_millis(120));
            std::process::exit(74);
        }
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("terax-settings.json");
        let marker = dir.path().join("child-ready");
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("modules::self_hosted_profiles::tests::b03_interprocess_settings_lock_fails_closed_and_releases_after_crash")
            .env(CHILD, &target).env(READY, &marker)
            .spawn().unwrap();
        let started = Instant::now();
        while !marker.exists() && started.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(marker.exists(), "offline native child did not acquire the lock");
        let deadline = Instant::now() + Duration::from_millis(30);
        assert!(lock_settings_path(&target, || Instant::now() < deadline).is_err());
        assert_eq!(child.wait().unwrap().code(), Some(74));
        let _lock = lock_settings_path(&target, || true).unwrap();
        assert!(dir.path().join(".terax-settings.json.lock").exists());
    }

    #[cfg(windows)]
    #[test]
    fn b03_windows_authoritative_reader_reconciles_missing_name_and_preserves_new_commit() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("terax-settings.json");
        let backup = directory.path().join(".terax-settings.json.replaced-backup");
        let old = json!({"revision":1, "selfHostedInference":{"version":1, "revision":1,
            "endpoints":[], "profiles":[]}});
        let next = json!({"revision":2, "selfHostedInference":{"version":1, "revision":2,
            "endpoints":[], "profiles":[]}});
        std::fs::write(&backup, serde_json::to_vec(&old).unwrap()).unwrap();
        // First access after a failed ReplaceFileW may find the old content
        // only in the backup; restore it before admitting any new native CAS.
        let recovered = read_settings_file(&target).unwrap();
        assert_eq!(recovered["revision"], 1);
        assert_eq!(std::fs::read(&target).unwrap(), serde_json::to_vec(&old).unwrap());
        assert!(!backup.exists());

        assert_eq!(self_hosted_atomic_file::replace_settings_file(&target,
            &serde_json::to_vec(&next).unwrap(), || true), PhysicalOutcome::Crossed);
        assert_eq!(read_settings_file(&target).unwrap()["revision"], 2);
        // The old revision remains PASSIVE recovery evidence; a valid main
        // pathname always wins and is not rolled back on renderer timeout.
        assert_eq!(std::fs::read(&backup).unwrap(), serde_json::to_vec(&old).unwrap());
        assert_eq!(read_settings_file(&target).unwrap()["revision"], 2);
    }
}
