//! LM11 B03 isolated REAL Tauri/Wry native persistence acceptance host.
//! Build with --features lm11-b03-acceptance-harness, never in production.
//! Does NOT run a model, inference, Lab, Agent, GPU or network request.
//! A benign sleeping instance of THIS binary supplies a real managed PID.
//! All files and window data live under CLACK_LM11_B03_ACCEPTANCE_ROOT.
#![cfg(windows)]

use serde_json::{json, Value};
use std::{fs::{self, File}, path::{Path, PathBuf}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;
use terax_lib::modules::{inference_probe, managed_local_runtime as runtime, self_hosted_profiles as settings};

const DEPLOYMENT: &str = "b03-acceptance-deployment";
const SETTING: &str = "terax-settings.json";

fn ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}
fn base() -> Value {
    json!({"version":1,"revision":7,"endpoints":[],"profiles":[],
        "fabric":{"version":1,"hosts":[],"runtimes":[],"artifacts":[],"deployments":[],
            "qualificationReceipts":[],"measurementRuns":[]}})
}
fn proposal(old: &Value, epoch: &str) -> Value {
    let mut candidate = old.clone();
    candidate["revision"] = json!(old["revision"].as_u64().unwrap() + 1);
    let run_id = format!("b03-acceptance-{}", candidate["revision"]);
    candidate["fabric"]["measurementRuns"].as_array_mut().unwrap().push(json!({
        "version":1,
        "scope":{"deploymentId":DEPLOYMENT,"runtimeEpoch":epoch},
        "capability":"test-only",
        "runId":run_id,
        "status":"persistence-fixture-no-model",
        "evidence":"synthetic-acceptance-no-model-inference"
    }));
    candidate
}
fn state(app: &tauri::AppHandle) -> Result<Value, String> {
    let entries = settings::self_hosted_profiles_snapshot(app.clone())?;
    Ok(entries.into_iter().find(|(key,_)| key == "selfHostedInference")
        .map(|(_, v)| v).unwrap_or(Value::Null))
}
fn ensure_seed(app: &tauri::AppHandle) -> Result<(), String> {
    if !state(app)?.is_null() { return Ok(()); }
    if !settings::self_hosted_profiles_compare_and_swap(app.clone(), Value::Null, base())? {
        return Err("Fresh isolated settings baseline CAS failed".into());
    }
    settings::self_hosted_settings_set_many(app.clone(), vec![
        ("editorTheme".into(), json!("auto")),
        ("acceptanceIndependentSetting".into(), json!("unrelated-kept")),
    ])?;
    Ok(())
}
fn create_owner(root: &Path) -> Result<(String, u32), String> {
    runtime::acceptance_bind_benign_child(root, DEPLOYMENT)
}
fn begin(app: &tauri::AppHandle, epoch: &str, pid: u32, timeout_ms: u64)
    -> Result<settings::QualificationCasTicket, String>
{
    settings::self_hosted_profiles_qualification_begin(app.clone(),
        "lm6".into(), DEPLOYMENT.into(), epoch.into(), Some(pid),
        timeout_ms, ms()+timeout_ms)
}
fn record_ticket(root: &Path, ticket: &settings::QualificationCasTicket) -> Result<(), String> {
    let file = File::create(root.join("ticket.json")).map_err(|e| e.to_string())?;
    serde_json::to_writer(&file, ticket).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}
fn ticket(root: &Path) -> Result<settings::QualificationCasTicket, String> {
    serde_json::from_slice(&fs::read(root.join("ticket.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
fn disk_summary(root: &Path) -> Value {
    let path = root.join("data").join(SETTING);
    let bytes = fs::read(&path);
    let parsed = bytes.as_ref().ok().and_then(|b| serde_json::from_slice::<Value>(b).ok());
    let state = parsed.as_ref().map(|v| &v["selfHostedInference"]);
    json!({
        "exists":path.is_file(),
        "len":bytes.as_ref().map(|v|v.len()).ok(),
        "jsonValid":parsed.is_some(),
        "revision":state.map(|s|s["revision"].clone()),
        "rows":state.map(|s|s["fabric"]["measurementRuns"].clone()),
        "theme":parsed.as_ref().map(|s|s["editorTheme"].clone()),
        "independent":parsed.as_ref().map(|s|s["acceptanceIndependentSetting"].clone()),
        "backup":root.join("data").join(".terax-settings.json.replaced-backup").is_file(),
        "staleTemps":fs::read_dir(root.join("data")).ok().into_iter().flatten()
            .filter_map(Result::ok).filter(|f|f.file_name().to_string_lossy()
            .starts_with(".terax-settings.json.txn-")).count(),
    })
}
fn run_case(app: &tauri::AppHandle, root: &Path, mode: &str) -> Result<Value, String> {
    if mode == "restart-replay" {
        let old = ticket(root)?;
        let replay = settings::self_hosted_profiles_qualification_acknowledge(
            app.clone(), old.clone());
        return Ok(json!({"replay":replay, "reconcile":
            settings::self_hosted_profiles_qualification_reconcile(app.clone(),old)?,
            "disk":disk_summary(root)}));
    }
    if mode == "inspect-old" {
        let previous: settings::QualificationCasTicket =
            serde_json::from_slice(&fs::read(root.join("prior-ticket.json"))
                .map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        return Ok(json!({"oldReconcile":
            settings::self_hosted_profiles_qualification_reconcile(app.clone(),previous)?,
            "disk":disk_summary(root)}));
    }
    if mode == "inspect" {
        let recovered = settings::self_hosted_profiles_qualification_reconcile(
            app.clone(), ticket(root)?)?;
        let authoritative = settings::self_hosted_settings_entries(app.clone());
        let legacy = app.get_store(SETTING);
        return Ok(json!({"reconcile":recovered, "nativeEntriesOk":authoritative.is_ok(),
            "legacyStoreAvailable":legacy.is_some(),
            "legacyIndependent":legacy.as_ref()
                .and_then(|store|store.get("acceptanceIndependentSetting")),
            "legacyTheme":legacy.as_ref().and_then(|store|store.get("editorTheme")),
            "legacyReceiptRevision":legacy.as_ref().and_then(|store|
                store.get("selfHostedInference")).map(|v|v["revision"].clone()),
            "disk":disk_summary(root)}));
    }
    if mode == "ordinary" || mode == "ordinary-again" {
        let before = disk_summary(root);
        settings::self_hosted_settings_set_many(app.clone(), vec![
            ("editorTheme".into(), json!("tokyo-night")),
            ("unrelatedAfterRestart".into(), json!(true)),
        ])?;
        return Ok(json!({"before":before,"after":disk_summary(root),
            "entries":settings::self_hosted_settings_entries(app.clone()).is_ok()}));
    }
    ensure_seed(app)?;
    let (epoch, pid) = create_owner(root)?;
    if mode == "new-epoch-after-pending" {
        let previous = ticket(root)?;
        let first = settings::self_hosted_profiles_qualification_reconcile(
            app.clone(), previous.clone())?;
        let new_ticket = begin(app, &epoch, pid, 30_000)?;
        let old = state(app)?;
        let prepared = settings::self_hosted_profiles_qualification_prepare(
            app.clone(),new_ticket.clone(),old.clone(),proposal(&old,&epoch))?;
        let acknowledged = settings::self_hosted_profiles_qualification_acknowledge(
            app.clone(),new_ticket.clone())?;
        fs::write(root.join("prior-ticket.json"),
            serde_json::to_vec(&previous).unwrap()).map_err(|e|e.to_string())?;
        record_ticket(root,&new_ticket)?;
        return Ok(json!({"oldReconcile":first,"prepare":prepared,"ack":acknowledged,
            "newReconcile":settings::self_hosted_profiles_qualification_reconcile(
                app.clone(),new_ticket)?,"disk":disk_summary(root)}));
    }
    let budget = if mode == "expire-before" || mode == "expire-ack" {
        150
    } else if mode == "expire-at-fence" || mode == "post-fence-timeout" {
        1200
    } else { 30_000 };
    if mode == "deadline-denied-before-begin" {
        return Ok(json!({"admission":settings::self_hosted_profiles_qualification_begin(
            app.clone(),"lm6".into(), DEPLOYMENT.into(), epoch, Some(pid),
            100, ms().saturating_sub(1)).err(), "disk":disk_summary(root)}));
    }
    let first = begin(app, &epoch, pid, budget)?;
    record_ticket(root, &first)?;
    if mode == "cancel-before" {
        settings::self_hosted_profiles_qualification_cancel(first.clone());
        let prepared = settings::self_hosted_profiles_qualification_prepare(
            app.clone(),first.clone(),state(app)?,proposal(&state(app)?,&epoch))?;
        return Ok(json!({"prepare":prepared,"reconcile":
            settings::self_hosted_profiles_qualification_reconcile(app.clone(),first)?,
            "disk":disk_summary(root)}));
    }
    if mode == "expire-before" {
        std::thread::sleep(Duration::from_millis(350));
        let prepared = settings::self_hosted_profiles_qualification_prepare(
            app.clone(),first.clone(),state(app)?,proposal(&state(app)?,&epoch))?;
        return Ok(json!({"prepare":prepared,"reconcile":
            settings::self_hosted_profiles_qualification_reconcile(app.clone(),first)?,
            "disk":disk_summary(root)}));
    }
    if mode == "epoch-rotate" {
        let new_epoch = runtime::acceptance_rotate_benign_epoch()?;
        let rejected = settings::self_hosted_profiles_qualification_prepare(
            app.clone(),first.clone(),state(app)?,proposal(&state(app)?,&epoch))?;
        let new_ticket = begin(app, &new_epoch, pid, 30_000)?;
        record_ticket(root,&new_ticket)?;
        let before = state(app)?;
        let prep = settings::self_hosted_profiles_qualification_prepare(
            app.clone(),new_ticket.clone(),before.clone(),proposal(&before,&new_epoch))?;
        let ack = settings::self_hosted_profiles_qualification_acknowledge(
            app.clone(),new_ticket.clone())?;
        return Ok(json!({"stalePrepare":rejected,"freshPrepare":prep,"freshAck":ack,
            "reconcile":settings::self_hosted_profiles_qualification_reconcile(app.clone(),new_ticket)?,
            "disk":disk_summary(root)}));
    }
    let old = state(app)?;
    let prepared = settings::self_hosted_profiles_qualification_prepare(
        app.clone(), first.clone(), old.clone(), proposal(&old, &epoch))?;
    if prepared != "prepared" { return Err(format!("Unexpected native preparation: {prepared}")); }
    if mode == "prepare-only" {
        return Ok(json!({"prepare":prepared,"reconcile":
            settings::self_hosted_profiles_qualification_reconcile(app.clone(),first)?,
            "disk":disk_summary(root)}));
    }
    if mode == "cancel-ack" {
        settings::self_hosted_profiles_qualification_cancel(first.clone());
        let ack = settings::self_hosted_profiles_qualification_acknowledge(
            app.clone(),first.clone())?;
        return Ok(json!({"ack":ack,"reconcile":
            settings::self_hosted_profiles_qualification_reconcile(app.clone(),first)?,
            "disk":disk_summary(root)}));
    }
    if mode == "expire-ack" {
        std::thread::sleep(Duration::from_millis(350));
        let ack = settings::self_hosted_profiles_qualification_acknowledge(
            app.clone(),first.clone())?;
        return Ok(json!({"ack":ack,"reconcile":
            settings::self_hosted_profiles_qualification_reconcile(app.clone(),first)?,
            "disk":disk_summary(root)}));
    }
    if mode == "inject-disk-full" {
        std::env::set_var("CLACK_LM11_B03_ACCEPTANCE_DISK_FULL", "1");
    }
    let immutable_before = if mode == "deny-readonly-at-replace" {
        // The already-verified case root is the only place where this
        // reversible filesystem attribute change is permitted.
        let target = root.join("data").join(SETTING);
        assert_eq!(target.parent().unwrap().canonicalize().unwrap(),
            root.join("data").canonicalize().unwrap());
        let old = fs::metadata(&target).map_err(|e|e.to_string())?.permissions();
        let mut deny = old.clone();
        deny.set_readonly(true);
        fs::set_permissions(&target,deny).map_err(|e|e.to_string())?;
        std::env::set_var("CLACK_LM11_B03_ACCEPTANCE_DENIAL","read-only");
        Some(old)
    } else {None};
    if matches!(mode, "cancel-at-fence"|"expire-at-fence"|"epoch-at-fence"|
        "pre-fence-external-kill") {
        std::env::set_var("CLACK_LM11_B03_ACCEPTANCE_PRE_FENCE", "1");
    }
    if matches!(mode, "post-fence-timeout"|"post-fence-cancel"|
        "post-fence-external-kill") {
        std::env::set_var("CLACK_LM11_B03_ACCEPTANCE_POST_FENCE", "1");
    }
    let concurrent = if matches!(mode, "cancel-at-fence"|"epoch-at-fence"|"post-fence-cancel") {
        let marker = root.join(if mode == "post-fence-cancel" {
            "real-post-fence.json"
        } else { "real-pre-fence.json" });
        let action = mode.to_owned();
        let ticket = first.clone();
        Some(std::thread::spawn(move || -> String {
            for _ in 0..500 {
                if marker.is_file() { break; }
                std::thread::sleep(Duration::from_millis(5));
            }
            if !marker.is_file() { return "marker-not-reached".into(); }
            if action == "epoch-at-fence" {
                return runtime::acceptance_rotate_benign_epoch()
                    .map(|_| "epoch-rotated".to_string())
                    .unwrap_or_else(|err| format!("epoch-error:{err}"));
            }
            settings::self_hosted_profiles_qualification_cancel(ticket);
            "cancel-invoked".into()
        }))
    } else { None };
    if mode == "crash-before" || mode == "crash-after" {
        // Gated in the production physical_replace with exact verified isolated
        // root and feature. The process exits before native command response.
        std::env::set_var("CLACK_LM11_B03_ACCEPTANCE_CRASH",
            if mode == "crash-before" {"before-replace"} else {"after-replace"});
    }
    let ack_result = settings::self_hosted_profiles_qualification_acknowledge(
        app.clone(),first.clone());
    if let Some(original_permissions) = immutable_before {
        fs::set_permissions(root.join("data").join(SETTING),original_permissions)
            .map_err(|e|format!("Cannot safely restore acceptance-only permissions: {e}"))?;
        std::env::remove_var("CLACK_LM11_B03_ACCEPTANCE_DENIAL");
    }
    let ack = ack_result?;
    let interleaving = concurrent.map(|handle|handle.join().unwrap_or_else(|_| "thread-panicked".into()));
    if mode == "inject-disk-full" {
        std::env::remove_var("CLACK_LM11_B03_ACCEPTANCE_DISK_FULL");
    }
    if mode.starts_with("crash-") {
        return Err("Fault injection failed to terminate the Tauri process".into());
    }
    let after = settings::self_hosted_profiles_qualification_reconcile(app.clone(),first.clone())?;
    if mode == "normal" || mode == "post-boundary-cancel" {
        settings::self_hosted_profiles_qualification_cancel(first.clone());
    }
    if mode == "post-boundary-timeout" {
        // Simulated original caller expiry occurs AFTER native commit.
        // This is never a new PASS: its old UI result remains timeout/Unknown.
        std::thread::sleep(Duration::from_millis(40));
    }
    if mode == "replay" {
        let exact = settings::self_hosted_profiles_qualification_acknowledge(
            app.clone(),first.clone());
        let new_same_epoch = begin(app,&epoch,pid,30_000);
        return Ok(json!({"ack":ack,"exactReplay":exact,"sameEpochNewTicket":new_same_epoch,
            "reconcile":after,"disk":disk_summary(root)}));
    }
    Ok(json!({"prepare":prepared,"ack":ack,"reconcile":after,
        "interleaving":interleaving,
        "disk":disk_summary(root)}))
}

fn main() {
    if std::env::args().any(|s| s == "--b03-benign-child") {
        // An abrupt Tauri crash does not run managed-owner shutdown; this
        // fixture child self-exits promptly without touching any model.
        std::thread::sleep(Duration::from_secs(8));
        return;
    }
    assert!(cfg!(feature = "lm11-b03-acceptance-harness"),
        "B03 real acceptance must be compiled with its non-default feature");
    let root = PathBuf::from(std::env::var("CLACK_LM11_B03_ACCEPTANCE_ROOT")
        .expect("Owned root required")).canonicalize().expect("Existing isolated root");
    assert!(runtime::acceptance_is_owned_scenario_root(&root),
        "Native acceptance root is not the authorized real-host or direct cases/ child");
    let mode = std::env::var("CLACK_LM11_B03_ACCEPTANCE_MODE").expect("mode");
    assert!(matches!(mode.as_str(),
        "normal"|"ordinary"|"ordinary-again"|"crash-before"|"crash-after"|"inspect"|"inspect-old"|
        "restart-replay"|"new-epoch-after-pending"|"inject-disk-full"|
        "deny-readonly-at-replace"|"prepare-only"|
        "cancel-before"|"expire-before"|"cancel-ack"|"expire-ack"|
        "epoch-rotate"|"deadline-denied-before-begin"|
        "post-boundary-cancel"|"post-boundary-timeout"|"replay"|
        "cancel-at-fence"|"expire-at-fence"|"epoch-at-fence"|
        "pre-fence-external-kill"|"post-fence-timeout"|"post-fence-cancel"|
        "post-fence-external-kill"));
    let data = root.join("data");
    fs::create_dir_all(&data).expect("Owned data path");
    let expected_data = data.canonicalize().unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    // Windows Known Folder ignores APPDATA. The *absolute* app identifier
    // is the already used Clack native acceptance isolation pattern.
    context.config_mut().identifier = data.to_string_lossy().replace('\\', "/");
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(inference_probe::ProbeState::default())
        .setup(move |app| {
            let actual_data = app.path().app_data_dir()?;
            fs::create_dir_all(&actual_data)?;
            assert_eq!(actual_data.canonicalize()?, expected_data,
                "ABORT: Tauri app data is NOT the isolated acceptance directory");
            let actual_store = tauri_plugin_store::resolve_store_path(
                app.handle(), SETTING)?;
            assert_eq!(actual_store.parent().unwrap().canonicalize()?, expected_data,
                "ABORT: Native qualifying file would escape isolated AppData");
            assert_eq!(actual_store.file_name().unwrap(), SETTING);
            // Invalid evidence must never pass through StoreBuilder, which
            // can construct an empty fallback and persist it on shutdown.
            // Inspect can reconcile read-only without the legacy view.
            let main = expected_data.join(SETTING);
            let backup = expected_data.join(".terax-settings.json.replaced-backup");
            let invalid_main = main.is_file() &&
                fs::read(&main).ok().and_then(|b|
                    serde_json::from_slice::<serde_json::Map<String,Value>>(&b).ok()).is_none();
            let invalid_missing_backup = !main.is_file() && backup.is_file() &&
                fs::read(&backup).ok().and_then(|b|
                    serde_json::from_slice::<serde_json::Map<String,Value>>(&b).ok()).is_none();
            if mode != "inspect" || !(invalid_main || invalid_missing_backup) {
                settings::self_hosted_profiles_startup_storage_check(app.handle())
                    .map_err(std::io::Error::other)?;
                app.store_builder(SETTING).disable_auto_save().build()?;
            }
            let webview_data = root.join("webview");
            fs::create_dir_all(&webview_data)?;
            WebviewWindowBuilder::new(
                app, "b03-real-native", WebviewUrl::External("about:blank".parse().unwrap())
            ).visible(false).data_directory(webview_data).build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = run_case(&handle, &root, &mode);
                let out = json!({"mode":mode,"appData":actual_data,"result":result,
                    "realTauriHost":true,"pid":std::process::id()});
                let file = File::create(root.join(format!("result-{mode}.json")))
                    .expect("Owned scenario result file");
                serde_json::to_writer_pretty(&file,&out).expect("Result serialization");
                file.sync_all().expect("Result sync");
                runtime::shutdown(); // kills benign child, never a model
                handle.exit(if out["result"].get("Ok").is_some() {0} else {1});
            });
            Ok(())
        })
        .build(context).expect("Real isolated Tauri application")
        .run(|_,_|{});
}
