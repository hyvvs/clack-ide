//! LM11 real renderer -> Tauri 2/Wry IPC acceptance with a deterministic
//! authentication-aware loopback HTTP child. No model executable or inference.
//! This example is available only with `lm11-authenticated-webview-acceptance`.
//! Every writable path is under a fresh direct child of the fixed cases root.
// Cargo's generic `--all-targets` check also compiles examples without their
// explicit opt-in features. Do not compile or expose the physical acceptance
// harness unless the native owner has its matching feature-gated APIs.
#[cfg(not(all(windows, feature = "lm11-authenticated-webview-acceptance")))]
fn main() {
    panic!("Authenticated WebView acceptance requires Windows and the explicit lm11-authenticated-webview-acceptance feature");
}

#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
fn main() {
    authenticated_host::run();
}

#[cfg(all(windows, feature = "lm11-authenticated-webview-acceptance"))]
mod authenticated_host {

    use serde_json::{json, Value};
    use sha2::Digest;
    use std::{
        collections::BTreeMap,
        fs::{self, OpenOptions},
        io::{BufRead, BufReader, Read, Write},
        net::{TcpListener, TcpStream},
        path::{Path, PathBuf},
        process::{Child, Command, Stdio},
        sync::atomic::{AtomicBool, Ordering},
        sync::{Arc, Mutex, OnceLock},
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    use terax_lib::modules::{
        conversation_memory as memory, managed_local_runtime as runtime, net,
        self_hosted_profiles as settings, shell, workspace,
    };
    use tokio::sync::watch;

    const SETTING: &str = "terax-settings.json";
    const ROOT_ENV: &str = "CLACK_LM11_AUTHENTICATED_ACCEPTANCE_ROOT";
    const URL_ENV: &str = "CLACK_LM11_AUTHENTICATED_ACCEPTANCE_URL";
    const DIGEST_ENV: &str = "CLACK_LM11_AUTHENTICATED_ACCEPTANCE_DIGEST";
    const SCENARIO_ENV: &str = "CLACK_LM11_AUTHENTICATED_ACCEPTANCE_SCENARIO";
    const RUNTIME_ENV: &str = "CLACK_LM11_RUNTIME_SCENARIO";
    const DEADLINE_ENV: &str = "CLACK_LM11_DEADLINE_STAGE";
    const STAGE_BARRIER_ENV: &str = "CLACK_LM11_STAGE_BARRIER";
    const CORRUPTION_ENV: &str = "CLACK_LM11_B03_CORRUPT_MODE";
    const CORRUPTION_MODES: &[&str] = &[
        "malformed-main",
        "inconsistent-marker",
        "missing-insufficient",
        "corrupt-recovery",
        "restart-ambiguity",
    ];
    const ORIGINAL_BARRIER_STAGES: &[&str] = &[
        "before-native-admission",
        "native-admission-response",
        "prepare-chat-promise-settlement",
        "native-open-response",
        "before-preparation",
        "during-preparation",
        "before-ai-http-open",
        "during-streaming",
        "during-quiescence",
        "preparation-complete",
        "predispatch",
        "after-ai-http-open",
        "first-output",
        "terminal-delivery",
        "quiescence-complete",
        "before-evidence-acceptance",
        "b03-before-prepare",
        "b03-before-acknowledge",
        "b03-before-readback",
        "b03-native-prepare",
        "b03-native-ack-response",
    ];
    const INJECTABLE_DEADLINE_STAGES: &[&str] = &[
        "native-status",
        "native-admission",
        "session-writes",
        "session-prepare",
        "persisted-chat-evidence",
        "native-revalidation",
        "cas-commit",
    ];
    const RUNTIME_MODES: &[&str] = &[
        "authenticated-readiness-success",
        "deterministic-streaming-response",
        "terminal-completion",
        "delayed-readiness",
        "delayed-request-acceptance",
        "delayed-first-stream-event",
        "delayed-terminal-event",
        "never-terminal-until-cancellation",
        "cancel-before-registration",
        "cancel-immediately-after-registration",
        "cancel-during-streaming",
        "delayed-cancellation-ack",
        "cancellation-ack-failure",
        "late-stream-event-after-cancellation",
        "authenticated-health-failure",
        "authenticated-model-identity-failure",
        "request-admission-failure",
        "request-admission-failure",
        "transport-failure",
        "malformed-stream-frame",
        "terminal-error",
        "connection-close-without-terminal",
        "registration-after-renderer-cancellation",
        "first-output-after-aggregate-deadline",
        "terminal-callback-after-deadline",
        "cancellation-terminal-race",
        "runtime-epoch-change-mid-request",
        "runtime-process-exits-mid-request",
        // Explicit original production Chat/evidence rejection, never included
        // in the historical 26 direct-native runtime transport contract.
        "evidence-rejection",
    ];
    const ORIGINAL_RUNTIME_FAULT_MODES: &[&str] = &[
        "authenticated-health-failure",
        "authenticated-model-identity-failure",
        "request-admission-failure",
        "transport-failure",
        "malformed-stream-frame",
        "connection-close-without-terminal",
        "terminal-error",
        "evidence-rejection",
    ];

    struct Acceptance {
        root: PathBuf,
        scenario: String,
        runtime_scenario: Option<String>,
        deadline_stage: Option<String>,
        deadline_armed: AtomicBool,
        deadline_triggered: AtomicBool,
        digest: String,
        alias: String,
        key: String,
        port: u16,
        child: Mutex<Option<Child>>,
        initial_binding: Mutex<Option<(String, u32)>>,
        restarted_binding: Mutex<Option<(String, u32, u16)>>,
        // Feature-only extra physical child identities. Credential bytes remain
        // exclusively in the native RuntimeOwner, never in these reports.
        abc_bindings: Mutex<BTreeMap<String, Value>>,
        observed: Mutex<Vec<(String, Option<String>, Option<String>)>>,
        report_written: Mutex<bool>,
        window_destroyed: AtomicBool,
        stage_barrier: Mutex<Option<OriginalStageBarrier>>,
    }

    /// Acceptance-only hold of the original LM2F async IPC, not a substituted
    /// request, clock, callback, B03 commit or second production deadline.
    struct OriginalStageBarrier {
        stage: String,
        token: String,
        epoch: String,
        pid: u32,
        reached: bool,
        session_id: Option<String>,
        released: bool,
        terminal_reported: bool,
        armed_at: Instant,
        entered_at: Option<Instant>,
        resume: watch::Sender<bool>,
    }

    fn stage_barrier_scenario(mode: &str) -> bool {
        matches!(
            mode,
            "stage-reachability"
                | "stage-expiry"
                | "stage-cancel"
                | "stage-close"
                | "stage-conflict"
                | "stage-concurrent"
                | "stage-stale-epoch"
                | "stage-corrupt"
                | "original-postdeadline-provider-events"
        )
    }

    fn stage_barrier_identity(
        app: &tauri::AppHandle,
        state: &Acceptance,
    ) -> Result<(String, u32), String> {
        if !stage_barrier_scenario(&state.scenario)
            || !runtime::acceptance_is_owned_webview_root(&state.root)
            || app
                .path()
                .app_data_dir()
                .map_err(|_| "Stage AppData unavailable")?
                .canonicalize()
                .map_err(|_| "Stage AppData not canonical")?
                != state.root.join("data")
        {
            return Err("Stage gate escaped its isolated original AppData".into());
        }
        state
            .initial_binding
            .lock()
            .map_err(|_| "Stage PID lock unavailable")?
            .clone()
            .ok_or_else(|| "Stage native child not initially bound".into())
    }

    fn stage_barrier_session_valid(session_id: &str) -> bool {
        !session_id.is_empty()
            && session_id.len() <= 96
            && session_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    }

    fn stage_token() -> Result<String, String> {
        let mut bytes = [0_u8; 24];
        getrandom::fill(&mut bytes).map_err(|_| "Stage one-shot token unavailable")?;
        Ok(bytes.iter().map(|b| format!("{b:02x}")).collect::<String>())
    }

    #[tauri::command]
    fn lm11_acceptance_arm_deadline_stage(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
    ) -> Result<String, String> {
        let stage = state
            .deadline_stage
            .as_deref()
            .filter(|stage| INJECTABLE_DEADLINE_STAGES.contains(stage))
            .ok_or("No independently injectable original runner deadline phase")?;
        if state.scenario != "deadline-bounded"
            || app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .canonicalize()
                .map_err(|e| e.to_string())?
                != state.root.join("data")
        {
            return Err("Aggregate native deadline fault is not isolated".into());
        }
        let prior = state.observed.lock().map_err(|_| "IPC trace unavailable")?;
        if prior.iter().filter(|row| row.0 == "ai_http_cancel").count() != 1
            || prior.iter().any(|row| row.0 == "ai_http_stream")
        {
            return Err("Original positive/negative baseline not yet safe to arm".into());
        }
        drop(prior);
        if state.deadline_armed.swap(true, Ordering::SeqCst) {
            return Err("Native deadline stage was already armed".into());
        }
        let path = state.root.join("deadline-stage-armed.json");
        ensure_safe_leaf(&state.root, &path)?;
        write_json(
            &path,
            &json!({
                "stage":stage,"realOriginalBudgetMs":120000,
                "nativeDelayMs":123500,"syntheticOnly":true,
            }),
        )?;
        Ok(stage.to_owned())
    }

    /// Feature-only arm after the EXACT initial child has been bound and the
    /// previous negative cancellation has completed. The returned random token is
    /// held only in this isolated renderer; evidence stores its digest, not token.
    #[tauri::command]
    async fn lm11_acceptance_barrier_arm(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        stage: String,
        expected_pid: u32,
        expected_epoch: String,
    ) -> Result<String, String> {
        let (epoch, pid) = stage_barrier_identity(&app, &state)?;
        if std::env::var(STAGE_BARRIER_ENV).as_deref() != Ok(stage.as_str())
            || !ORIGINAL_BARRIER_STAGES.contains(&stage.as_str())
            || expected_pid != pid
            || expected_epoch != epoch
        {
            return Err("Stage arm does not own the exact initial PID/epoch".into());
        }
        let native = serde_json::to_value(
            runtime::managed_local_runtime_status(app.clone(), None, None).await?,
        )
        .map_err(|_| "Stage native status unavailable")?;
        if native["state"] != "Ready" || native["epoch"] != epoch || native["processId"] != pid {
            return Err("Stage arm native child is not authenticated Ready".into());
        }
        let observed = state
            .observed
            .lock()
            .map_err(|_| "Stage IPC trace unavailable")?;
        if observed
            .iter()
            .filter(|row| row.0 == "ai_http_cancel")
            .count()
            != 1
            || observed.iter().any(|row| {
                row.0 == "ai_http_stream"
                    || row.0.starts_with("self_hosted_profiles_qualification_")
            })
        {
            return Err("Stage arm is not before the original qualification request".into());
        }
        drop(observed);
        let token = stage_token()?;
        let path = state.root.join("barrier-stage-armed.json");
        ensure_safe_leaf(&state.root, &path)?;
        let (resume, _) = watch::channel(false);
        let mut gate = state
            .stage_barrier
            .lock()
            .map_err(|_| "Stage arm lock unavailable")?;
        if gate.is_some() {
            return Err("Stage arm is one-shot".into());
        }
        write_json(
            &path,
            &json!({
                "stage": stage, "mode": state.scenario,
                "pid": pid, "epoch": epoch, "hostPid": std::process::id(),
                "tokenDigest": format!("{:x}", sha2::Sha256::digest(token.as_bytes())),
                "syntheticOnly": true, "originalAggregateBudgetMs": 120000,
            }),
        )?;
        *gate = Some(OriginalStageBarrier {
            stage,
            token: token.clone(),
            epoch,
            pid,
            reached: false,
            session_id: None,
            released: false,
            terminal_reported: false,
            armed_at: Instant::now(),
            entered_at: None,
            resume,
        });
        Ok(token)
    }

    #[tauri::command]
    async fn lm11_acceptance_barrier(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        stage: String,
        session_id: Option<String>,
    ) -> Result<(), String> {
        let (epoch, pid) = stage_barrier_identity(&app, &state)?;
        if !session_id
            .as_deref()
            .is_some_and(stage_barrier_session_valid)
            || !ORIGINAL_BARRIER_STAGES.contains(&stage.as_str())
        {
            return Err("Original qualification stage lacks bounded session identity".into());
        }
        let native = serde_json::to_value(
            runtime::managed_local_runtime_status(app.clone(), None, None).await?,
        )
        .map_err(|_| "Stage native status unavailable")?;
        if native["state"] != "Ready" || native["epoch"] != epoch || native["processId"] != pid {
            return Err("Original stage native owner is not authenticated Ready".into());
        }
        let mut resume = {
            let mut guard = state
                .stage_barrier
                .lock()
                .map_err(|_| "Stage gate unavailable")?;
            let gate = guard.as_mut().ok_or("Stage was never armed")?;
            if gate.pid != pid
                || gate.epoch != epoch
                || gate
                    .session_id
                    .as_deref()
                    .is_some_and(|bound| Some(bound) != session_id.as_deref())
            {
                return Err("Stale, duplicate or different original stage denied".into());
            }
            // The original production run visits several independent named
            // hooks. Arm ONE selected stage only: other recognized stages are
            // validated then passed through without interception or privilege.
            // Rejecting those earlier hooks would falsely fail the selected gate
            // before it could be reached (and mask a genuine product boundary).
            if gate.session_id.is_none() {
                gate.session_id = session_id.clone();
            }
            if gate.stage != stage {
                return Ok(());
            }
            if gate.reached || gate.released {
                return Err("Duplicate original stage reached the one-shot native gate".into());
            }
            let arrived = state.root.join("barrier-stage-hit.json");
            ensure_safe_leaf(&state.root, &arrived)?;
            write_json(
                &arrived,
                &json!({
                    "stage": stage, "sessionId": session_id, "pid": pid,
                    "epoch": epoch, "hostPid": std::process::id(),
                    "originalAggregateBudgetMs": 120000,
                    "actualOriginalStageIpc": true, "syntheticOnly": true,
                }),
            )?;
            gate.reached = true;
            gate.session_id = session_id;
            gate.entered_at = Some(Instant::now());
            gate.resume.subscribe()
        };
        // Native IPC stays pending without blocking Wry's event thread. The only
        // release path is the separately authorized one-shot command; the actual
        // JS QualificationOperationDeadline still owns the 120s cancellation.
        loop {
            if *resume.borrow() {
                return Ok(());
            }
            resume
                .changed()
                .await
                .map_err(|_| "Stage owner was disposed")?;
        }
    }

    /// Feature-host-only trampoline for the ACTUAL native B03 production command
    /// call. This does not replace native persistence, CAS, fencing or deadline
    /// logic: it delegates to the original settings:: qualification handler.
    ///
    /// The original qualification session has already been bound by an earlier
    /// acceptance-only JS lifecycle hook; the native qualification ticket is
    /// checked as a separate well-formed original CAS handle. No ticket bytes or
    /// native credentials are written to an evidence file.
    fn original_cas_barrier_session(
        state: &Arc<Acceptance>,
        stage: &str,
        ticket: &settings::QualificationCasTicket,
    ) -> Result<Option<String>, String> {
        if std::env::var(STAGE_BARRIER_ENV).as_deref() != Ok(stage) {
            return Ok(None);
        }
        if !matches!(
            state.scenario.as_str(),
            "stage-expiry" | "stage-reachability" | "stage-stale-epoch"
        ) {
            return Err(
                "Original native CAS hold requires original qualification stage scenario".into(),
            );
        }
        let gate = state
            .stage_barrier
            .lock()
            .map_err(|_| "Original native CAS acceptance stage lock unavailable")?;
        let current = gate.as_ref().ok_or("Original B03 stage was not armed")?;
        let ticket_value =
            serde_json::to_value(ticket).map_err(|_| "Original B03 ticket unavailable")?;
        if current.stage != stage
            || current.reached
            || current.released
            || !current
                .session_id
                .as_deref()
                .is_some_and(stage_barrier_session_valid)
            || !ticket_value["operationId"]
                .as_str()
                .is_some_and(|id| id.len() == 32)
            || !ticket_value["nativeEpoch"]
                .as_str()
                .is_some_and(|id| id.len() == 32)
        {
            return Err(
                "Native B03 call is not bound to the one-shot original qualification session"
                    .into(),
            );
        }
        Ok(current.session_id.clone())
    }

    /// Acceptance-only IPC response hold at the REAL production command's
    /// completion. The native command ran first and owns its original result.
    /// No admission, request, cancellation, runtime, or persistence registry is
    /// replaced. The same prearmed one-shot native stage gate verifies the exact
    /// real qualification session and its authenticated child PID/epoch.
    fn original_async_response_session(
        state: &Arc<Acceptance>,
        stage: &str,
    ) -> Result<Option<String>, String> {
        if state.scenario != "stage-cancel"
            || std::env::var(STAGE_BARRIER_ENV).as_deref() != Ok(stage)
        {
            return Ok(None);
        }
        let gate = state
            .stage_barrier
            .lock()
            .map_err(|_| "Async completion acceptance gate unavailable")?;
        // Initial real readiness/route and negative exact-ID probe are run
        // BEFORE the original qualification arms its one-shot stage. They must
        // remain ordinary production handler calls, not a synthetic rejection.
        let Some(bound) = gate.as_ref() else {
            return Ok(None);
        };
        if bound.stage != stage
            || bound.reached
            || bound.released
            || !bound
                .session_id
                .as_deref()
                .is_some_and(stage_barrier_session_valid)
        {
            return Err("Original async completion lacks one-shot session owner".into());
        }
        Ok(bound.session_id.clone())
    }

    /// Exact production managed route returned only AFTER the original native
    /// authenticated admission completed, held before its original IPC response
    /// settles the admittedManagedLocalRoute Promise. This acceptance host
    /// trampoline does not alter the underlying real managed runtime owner.
    #[tauri::command]
    async fn managed_local_runtime_route(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        deployment_id: String,
        deployment_identity: String,
        epoch: Option<String>,
    ) -> Result<runtime::ManagedRuntimeRoute, String> {
        let result = runtime::managed_local_runtime_route(
            app.clone(),
            deployment_id,
            deployment_identity,
            epoch,
        )
        .await?;
        if let Some(session) =
            original_async_response_session(state.inner(), "native-admission-response")?
        {
            lm11_acceptance_barrier(
                app,
                state,
                "native-admission-response".into(),
                Some(session),
            )
            .await?;
        }
        Ok(result)
    }

    /// A real InferenceState::open registers an actual inference-N before this
    /// original IPC response is withheld. JS has no native ID while Stop wins;
    /// when the genuine ID is later returned, original proxyFetch must cancel
    /// that exact ID without dispatch. All evidence stays inside owned case root.
    #[tauri::command]
    async fn ai_http_open(
        window: tauri::WebviewWindow,
        native: tauri::State<'_, net::inference::InferenceState>,
        state: tauri::State<'_, Arc<Acceptance>>,
    ) -> Result<String, net::inference::Failure> {
        let id = net::inference::ai_http_open(window.clone(), native)?;
        if state.scenario == "original-postdeadline-provider-events"
            && state.observed.lock().ok().is_some_and(|rows| {
                rows.iter()
                    .filter(|(name, _, _)| name == "ai_http_open")
                    .count()
                    == 2
            })
        {
            // The first native open belongs to the unchanged mandatory negative
            // control. This SECOND open is the real original production Chat ID.
            // Its lease reservation exists now, but a feature-only 6000ms IPC
            // response delay makes the unchanged original 120s aggregate budget
            // strictly earlier than the separately bounded native read timeout.
            // No native transport timeout or production aggregate value changes.
            let marker = state
                .root
                .join("postdeadline-original-registration-delay.json");
            ensure_safe_leaf(&state.root, &marker).map_err(|_| net::inference::Failure {
                code: "cancelled".into(),
            })?;
            write_json(
                &marker,
                &json!({
                    "requestId":id,"realNativeReservationBeforeResponse":true,
                    "exactOriginalSecondOpen":true,"nativeResponseDelayMs":6000,
                    "unchangedAggregateDeadlineMs":120000,"syntheticOnly":true,
                }),
            )
            .map_err(|_| net::inference::Failure {
                code: "cancelled".into(),
            })?;
            tokio::time::sleep(Duration::from_millis(6_000)).await;
        }
        let session = original_async_response_session(state.inner(), "native-open-response")
            .map_err(|_| net::inference::Failure {
                code: "cancelled".into(),
            })?;
        if let Some(session) = session {
            let marker = state.root.join("barrier-native-registration.json");
            ensure_safe_leaf(&state.root, &marker).map_err(|_| net::inference::Failure {
                code: "cancelled".into(),
            })?;
            write_json(
                &marker,
                &json!({
                    "requestId":id, "sessionId":session,
                    "hostPid":std::process::id(), "syntheticOnly":true,
                    "registeredBeforeRendererResponse":true,
                }),
            )
            .map_err(|_| net::inference::Failure {
                code: "cancelled".into(),
            })?;
            lm11_acceptance_barrier(
                window.app_handle().clone(),
                state,
                "native-open-response".into(),
                Some(session),
            )
            .await
            .map_err(|_| net::inference::Failure {
                code: "cancelled".into(),
            })?;
        }
        Ok(id)
    }

    /// Deliberate corruption of ONLY this exact acceptance case's existing
    /// physical settings file. Called after the original qualification's real
    /// native BEGIN and PREPARE created four pending v0 rows. Never edits any
    /// production AppData, fabric authority, or a fabricated receipt. Preserve
    /// every original physical byte before faulting the existing storage owner.
    #[tauri::command]
    fn lm11_acceptance_corrupt_qualification_authority(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        stage: String,
        token: String,
        session_id: String,
        mode: String,
    ) -> Result<Value, String> {
        let (epoch, pid) = stage_barrier_identity(&app, &state)?;
        if state.scenario != "stage-corrupt"
            || stage != "b03-before-acknowledge"
            || std::env::var(STAGE_BARRIER_ENV).as_deref() != Ok(stage.as_str())
            || std::env::var(CORRUPTION_ENV).as_deref() != Ok(mode.as_str())
            || !CORRUPTION_MODES.contains(&mode.as_str())
            || app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .canonicalize()
                .map_err(|e| e.to_string())?
                != state.root.join("data")
        {
            return Err(
                "Corrupt qualification exercise is not an isolated case-owned boundary".into(),
            );
        }
        {
            let guard = state
                .stage_barrier
                .lock()
                .map_err(|_| "Corruption stage ownership lock unavailable")?;
            let gate = guard.as_ref().ok_or("Corruption stage not armed")?;
            if gate.stage != stage
                || gate.token != token
                || gate.epoch != epoch
                || gate.pid != pid
                || !gate.reached
                || gate.released
                || gate.session_id.as_deref() != Some(&session_id)
            {
                return Err(
                    "Corrupt authority command does not own held original qualification".into(),
                );
            }
        }
        let main = state.root.join("data").join(SETTING);
        let backup = state
            .root
            .join("data")
            .join(".terax-settings.json.replaced-backup");
        let before = state.root.join("forensic-original-authority-before.json");
        let backup_before = state.root.join("forensic-original-backup-before.bin");
        let missing = state.root.join("forensic-missing-original-authority.bin");
        let ticket_leaf = state.root.join("native-qualification-ticket.json");
        let marker = state.root.join("corrupt-authority-fault.json");
        for leaf in [
            &main,
            &backup,
            &before,
            &backup_before,
            &missing,
            &ticket_leaf,
            &marker,
        ] {
            ensure_safe_leaf(&state.root, leaf)?;
        }
        let original = fs::read(&main)
            .map_err(|_| "Original authoritative settings unreadable before fault")?;
        let mut parsed: Value = serde_json::from_slice(&original)
            .map_err(|_| "Original settings already corrupt before qualification fault")?;
        let rows = parsed["selfHostedInference"]["fabric"]["qualificationReceipts"]
            .as_array()
            .ok_or("Real native prepared receipts not found")?;
        if rows.len() != 4
            || rows
                .iter()
                .any(|row| row["version"] != 0 || row["qualificationCas"]["phase"] != "pending")
        {
            return Err("Original qualification was not in actual native v0 prepared state".into());
        }
        let ticket_value = json!({
            "operationId":rows[0]["qualificationCas"]["operationId"],
            "nativeEpoch":rows[0]["qualificationCas"]["nativeEpoch"],
        });
        let ticket: settings::QualificationCasTicket = serde_json::from_value(ticket_value.clone())
            .map_err(|_| "Real prepared native ticket was malformed before fault")?;
        if rows.iter().any(|row| {
            row["qualificationCas"]["operationId"] != ticket_value["operationId"]
                || row["qualificationCas"]["nativeEpoch"] != ticket_value["nativeEpoch"]
        }) {
            return Err("Real native B03 rows have inconsistent ticket before fault".into());
        }
        fn forensic_once(path: &Path, contents: &[u8]) -> Result<(), String> {
            let mut out = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|e| e.to_string())?;
            out.write_all(contents)
                .and_then(|_| out.sync_all())
                .map_err(|e| e.to_string())
        }
        forensic_once(&before, &original)?;
        if backup.is_file() {
            forensic_once(
                &backup_before,
                &fs::read(&backup).map_err(|e| e.to_string())?,
            )?;
        }
        write_json(
            &ticket_leaf,
            &serde_json::to_value(&ticket).map_err(|e| e.to_string())?,
        )?;
        match mode.as_str() {
            "malformed-main" | "restart-ambiguity" => {
                fs::write(&main, b"{malformed-original-qualification-authority")
                    .map_err(|e| e.to_string())?;
            }
            "inconsistent-marker" => {
                parsed["selfHostedInference"]["fabric"]["qualificationReceipts"][0]
                    ["qualificationCas"]["phase"] = json!("acknowledged");
                // A deliberately mismatched v0/acknowledged marker must classify
                // UNKNOWN. This is a corrupt artifact, not a fabricated PASS.
                fs::write(
                    &main,
                    serde_json::to_vec(&parsed).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
            }
            "missing-insufficient" | "corrupt-recovery" => {
                fs::rename(&main, &missing).map_err(|e| e.to_string())?;
                if mode == "missing-insufficient" {
                    if backup.is_file() {
                        fs::remove_file(&backup).map_err(|e| e.to_string())?;
                    }
                } else {
                    fs::write(&backup, b"{unusable-windows-recovery-backup")
                        .map_err(|e| e.to_string())?;
                }
            }
            _ => return Err("Unrecognized corruption mode".into()),
        }
        // The before copy is immutable forensic evidence. We do not regenerate
        // missing authority or replace corrupt bytes with an invented {} store.
        let after = fs::read(&main).ok();
        let after_hash = after
            .as_ref()
            .map(|bytes| format!("{:x}", sha2::Sha256::digest(bytes)));
        let evidence = json!({
            "mode":mode,"stage":stage,"sessionId":session_id,
            "hostPid":std::process::id(),"nativePid":pid,"nativeEpoch":epoch,
            "actualNativePreparedTicket":true,"originalPreparedRows":4,
            "ticket":ticket_value,
            "forensicOriginalSha256":format!("{:x}",sha2::Sha256::digest(&original)),
            "forensicOriginalPreserved":before.is_file(),
            "forensicBackupPreserved":!backup_before.exists() || backup_before.is_file(),
            "authoritativeExistsAfter":after.is_some(),
            "authoritativeSha256After":after_hash,
            "syntheticOnly":true,
        });
        write_json(&marker, &evidence)?;
        Ok(evidence)
    }

    /// Same original native function, with an acceptance-only barrier ON ENTRY.
    /// Holding inside the original IPC proves the 120s JS operation can expire
    /// while native qualification prepare has not yet decided an effect.
    #[tauri::command]
    async fn self_hosted_profiles_qualification_prepare(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        ticket: settings::QualificationCasTicket,
        expected: Value,
        value: Value,
    ) -> Result<&'static str, String> {
        if let Some(session_id) =
            original_cas_barrier_session(state.inner(), "b03-native-prepare", &ticket)?
        {
            lm11_acceptance_barrier(
                app.clone(),
                state,
                "b03-native-prepare".to_string(),
                Some(session_id),
            )
            .await?;
        }
        settings::self_hosted_profiles_qualification_prepare(app, ticket, expected, value)
    }

    /// Same original native function, with an acceptance-only barrier AFTER THE
    /// REAL durable ACK commit but BEFORE its original renderer IPC ACK is sent.
    /// The 120s original JS caller may expire at this point; committed v2 receipt
    /// state is *never* rolled back or falsely classified as absent.
    #[tauri::command]
    async fn self_hosted_profiles_qualification_acknowledge(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        ticket: settings::QualificationCasTicket,
    ) -> Result<&'static str, String> {
        let session =
            original_cas_barrier_session(state.inner(), "b03-native-ack-response", &ticket)?;
        let committed =
            settings::self_hosted_profiles_qualification_acknowledge(app.clone(), ticket)?;
        if let Some(session_id) = session {
            if committed != "acknowledged" {
                return Err("Original native B03 ACK did not commit before response hold".into());
            }
            lm11_acceptance_barrier(
                app,
                state,
                "b03-native-ack-response".to_string(),
                Some(session_id),
            )
            .await?;
        }
        Ok(committed)
    }

    #[tauri::command]
    fn lm11_acceptance_barrier_status(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        stage: String,
    ) -> Result<Value, String> {
        let (epoch, pid) = stage_barrier_identity(&app, &state)?;
        let guard = state
            .stage_barrier
            .lock()
            .map_err(|_| "Stage status lock unavailable")?;
        let gate = guard.as_ref().ok_or("Stage never armed")?;
        if gate.stage != stage || gate.epoch != epoch || gate.pid != pid {
            return Err("Stage status belongs to another runtime owner".into());
        }
        Ok(json!({"stage": stage, "armed":true, "reached":gate.reached,
        "released":gate.released, "sessionId":gate.session_id,
        "nativePid":pid,"nativeEpoch":epoch,
        "heldMs":gate.entered_at.map(|entered| entered.elapsed().as_millis()).unwrap_or(0),
        "originalAggregateBudgetMs":120000,"syntheticOnly":true}))
    }

    #[tauri::command]
    async fn lm11_acceptance_barrier_release(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        stage: String,
        token: String,
        session_id: String,
    ) -> Result<Value, String> {
        let (epoch, pid) = stage_barrier_identity(&app, &state)?;
        let native = serde_json::to_value(
            runtime::managed_local_runtime_status(app.clone(), None, None).await?,
        )
        .map_err(|_| "Stage release status unavailable")?;
        let owner_still_ready =
            native["state"] == "Ready" && native["epoch"] == epoch && native["processId"] == pid;
        if !owner_still_ready && state.scenario == "stage-reachability" {
            return Err("Stage reached an unauthorized replacement runtime before release".into());
        }
        let mut guard = state
            .stage_barrier
            .lock()
            .map_err(|_| "Stage release lock unavailable")?;
        let gate = guard.as_mut().ok_or("Stage never armed")?;
        if gate.stage != stage
            || gate.epoch != epoch
            || gate.pid != pid
            || gate.token != token
            || !gate.reached
            || gate.released
            || gate.session_id.as_deref() != Some(&session_id)
        {
            return Err("Stage release denied: mismatched token, owner or session".into());
        }
        let held_ms = gate
            .entered_at
            .ok_or("Stage was not reached")?
            .elapsed()
            .as_millis();
        let budget_elapsed_ms = gate.armed_at.elapsed().as_millis();
        // Record wall time, but NEVER infer original runner expiry here. A late
        // B03 gate may be held only briefly when the real 120s caller expires.
        // The JS original runner proves its rejection before cleanup release.
        let leaf = state.root.join("barrier-stage-release.json");
        ensure_safe_leaf(&state.root, &leaf)?;
        write_json(
            &leaf,
            &json!({
                "stage": stage, "sessionId": session_id, "pid": pid, "epoch": epoch,
                "mode": state.scenario, "hostPid": std::process::id(),
                "heldMs": held_ms, "budgetElapsedMs":budget_elapsed_ms,
                "ownerStillReadyAtRelease":owner_still_ready,
                "originalAggregateBudgetMs": 120000,
                "oneShotOriginalAsyncIpcResumed": true, "syntheticOnly": true,
            }),
        )?;
        gate.released = true;
        gate.resume.send_replace(true);
        Ok(
            json!({"stage": stage, "released":true, "sessionId":session_id,
        "nativePid":pid,"nativeEpoch":epoch,"heldMs":held_ms,
        "budgetElapsedMs":budget_elapsed_ms,"ownerStillReady":owner_still_ready,
        "originalAggregateBudgetMs":120000,"syntheticOnly":true}),
        )
    }

    /// Original runner terminal is a separate, one-shot observed assertion after
    /// the native IPC was released. This does not set or simulate production CAS.
    #[tauri::command]
    fn lm11_acceptance_barrier_terminal(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        stage: String,
        token: String,
        session_id: String,
        original_terminal: String,
        elapsed_ms: u64,
    ) -> Result<(), String> {
        let (epoch, pid) = stage_barrier_identity(&app, &state)?;
        let mut guard = state
            .stage_barrier
            .lock()
            .map_err(|_| "Stage terminal lock unavailable")?;
        let gate = guard.as_mut().ok_or("Stage was not armed")?;
        if gate.stage != stage
            || gate.token != token
            || gate.epoch != epoch
            || gate.pid != pid
            || gate.session_id.as_deref() != Some(&session_id)
            || !gate.reached
            || !gate.released
            || gate.terminal_reported
            || !(1..=180_000).contains(&elapsed_ms)
            || (matches!(
                state.scenario.as_str(),
                "stage-reachability" | "stage-concurrent"
            ) && original_terminal != "completed")
            || (state.scenario == "stage-expiry"
                && (original_terminal != "rejected" || elapsed_ms < 119_000))
            || (state.scenario == "stage-cancel"
                && (original_terminal != "rejected" || elapsed_ms >= 119_000))
            || (state.scenario == "stage-conflict"
                && (original_terminal != "rejected" || elapsed_ms >= 119_000))
        {
            return Err("Stage terminal does not match the original one-shot operation".into());
        }
        let leaf = state.root.join("barrier-stage-observation.json");
        ensure_safe_leaf(&state.root, &leaf)?;
        write_json(
            &leaf,
            &json!({
                "stage": stage, "mode":state.scenario, "sessionId":session_id,
                "nativePid":pid, "nativeEpoch":epoch, "hostPid":std::process::id(),
                "originalRunnerTerminal":original_terminal,
                "originalElapsedMs":elapsed_ms,"originalAggregateBudgetMs":120000,
                "oneShotReachedAndReleased":true,"syntheticOnly":true,
            }),
        )?;
        gate.terminal_reported = true;
        Ok(())
    }

    fn deadline_stage_matches(stage: &str, command: &str, after_dispatch: bool) -> bool {
        match stage {
            "native-status" => command == "managed_local_runtime_status",
            "native-admission" => command == "managed_local_runtime_route",
            "session-writes" => command == "conversation_source_set",
            "session-prepare" => command == "conversation_session_get",
            "persisted-chat-evidence" => after_dispatch && command == "conversation_source_set",
            "native-revalidation" => after_dispatch && command == "managed_local_runtime_route",
            "cas-commit" => after_dispatch && command == "self_hosted_profiles_qualification_begin",
            _ => false,
        }
    }

    /// Only the exact test-owned process can be restarted. This uses the existing
    /// production native binding authority, whose current_binding() checks the
    /// canonical deployment in the isolated disk-backed Store. The fresh secret
    /// originates from the native RuntimeOwner, never the renderer.
    #[tauri::command]
    fn lm11_acceptance_restart_child(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        deployment_id: String,
        deployment_identity: String,
    ) -> Result<Value, String> {
        if !matches!(
            state.scenario.as_str(),
            "stage-stale-epoch"
                | "genuine-child-restart"
                | "stale-cross-child-restart"
                | "stale-original-qualification-child-restart"
        ) {
            return Err("No acceptance-only real child restart is armed".into());
        }
        if !runtime::acceptance_is_owned_webview_root(&state.root) {
            return Err("Synthetic restart case escaped fixed owner".into());
        }
        let actual_data = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if actual_data != state.root.join("data") {
            return Err("ABORT: restarted child AppData is not the case-owned authority".into());
        }
        let (old_epoch, old_pid) = state
            .initial_binding
            .lock()
            .map_err(|_| "Initial binding lock unavailable")?
            .clone()
            .ok_or("Missing real initial child binding")?;
        let mut restarted = state
            .restarted_binding
            .lock()
            .map_err(|_| "Restart lock unavailable")?;
        if restarted.is_some() {
            return Err("Synthetic child restart cannot run twice".into());
        }
        let key = runtime::acceptance_new_synthetic_key()?;
        if key == state.key {
            return Err("Native key rotation unexpectedly reused the original secret".into());
        }
        let marker = state.root.join("service-ready-b.json");
        ensure_safe_leaf(&state.root, &marker)?;
        if marker.exists() {
            return Err("Second child ready marker already exists".into());
        }
        let mut child = StartupChild(Some(
            Command::new(std::env::current_exe().map_err(|e| e.to_string())?)
                .arg("--synthetic-service")
                .env(ROOT_ENV, &state.root)
                .env("CLACK_LM11_SYNTHETIC_KEY", &key)
                .env("CLACK_LM11_SYNTHETIC_ALIAS", &state.alias)
                .env("CLACK_LM11_SYNTHETIC_READY_SLOT", "b")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?,
        ));
        let pid = child.0.as_ref().ok_or("Fresh child missing")?.id();
        if pid == old_pid {
            return Err("Fresh child unexpectedly shares the dead original OS PID".into());
        }
        let limit = Instant::now() + Duration::from_secs(7);
        let port = loop {
            if Instant::now() >= limit {
                return Err("Second actual loopback child did not report a bounded port".into());
            }
            if let Ok(bytes) = fs::read(&marker) {
                let v: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                if v["pid"].as_u64() != Some(u64::from(pid)) || v["syntheticOnly"] != true {
                    return Err("Second ready marker does not identify the owned child PID".into());
                }
                if let Some(port) = v["port"].as_u64().filter(|p| (1..=65_535).contains(p)) {
                    break port as u16;
                }
            }
            thread::sleep(Duration::from_millis(20));
        };
        if !probe_wrong_bearer(port, None)? || !probe_wrong_bearer(port, Some(&state.key))? {
            return Err("Second child did not reject missing or ORIGINAL bearer secret".into());
        }
        let (epoch, bound_pid) = runtime::acceptance_bind_synthetic_child(
            &app,
            &state.root,
            child.0.take().ok_or("Second child was not owned")?,
            port,
            key,
            state.alias.clone(),
            &deployment_id,
            &deployment_identity,
        )?;
        if bound_pid != pid || epoch == old_epoch {
            runtime::shutdown();
            return Err("New native owner reused the old PID or runtime epoch".into());
        }
        *restarted = Some((epoch.clone(), bound_pid, port));
        Ok(json!({
            "oldPid": old_pid, "oldEpoch": old_epoch,
            "newPid": bound_pid, "newEpoch": epoch, "newPort": port,
            "freshNativeSecret":true, "oldBearerRejected":true,
            "freshOsProcess":true,"syntheticOnly":true,
        }))
    }

    /// If startup or marker verification panics, reap the already-spawned same-EXE
    /// child before the acceptance host unwinds. Binding transfers ownership to
    /// the production RuntimeOwner, whose Windows Job Object then owns cleanup.
    struct StartupChild(Option<Child>);
    impl Drop for StartupChild {
        fn drop(&mut self) {
            if let Some(mut child) = self.0.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    #[tauri::command]
    fn lm11_acceptance_rotate_epoch(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
    ) -> Result<String, String> {
        runtime::acceptance_rotate_synthetic_epoch(&app, &state.root)
    }

    #[tauri::command]
    fn lm11_acceptance_stop_service(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
    ) -> Result<(), String> {
        let expected = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if expected != state.root.join("data") {
            return Err("Owned data path changed".into());
        }
        // This acceptance IPC models a deployment Stop followed by a possible
        // restart. The production application-exit shutdown closes the entire
        // keyed registry and must NOT be used for a scoped lifecycle action.
        // The host has 0/1 registered owner here; ambiguous multi-owner callers
        // fail closed through the existing native selector.
        runtime::managed_local_runtime_stop(app, None, None).map(|_| ())
    }

    #[tauri::command]
    fn lm11_acceptance_counts(
        state: tauri::State<'_, Arc<Acceptance>>,
    ) -> Result<BTreeMap<String, usize>, String> {
        let entries = state
            .observed
            .lock()
            .map_err(|_| "IPC trace lock unavailable")?;
        let mut out = BTreeMap::new();
        for (name, _, _) in entries.iter() {
            *out.entry(name.clone()).or_default() += 1;
        }
        Ok(out)
    }

    #[tauri::command]
    fn lm11_acceptance_runtime_activate(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
    ) -> Result<String, String> {
        let mode = state
            .runtime_scenario
            .as_deref()
            .filter(|mode| RUNTIME_MODES.contains(mode))
            .ok_or("No authorized acceptance runtime behavior")?;
        if app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?
            != state.root.join("data")
        {
            return Err("Runtime behavior is outside isolated AppData".into());
        }
        let marker = state.root.join("runtime-active.json");
        ensure_safe_leaf(&state.root, &marker)?;
        write_json(
            &marker,
            &json!({"runtimeScenario":mode,"syntheticOnly":true}),
        )?;
        Ok(mode.to_owned())
    }

    /// Feature-only one-shot permission to submit a deliberately INVALID
    /// admission envelope to the unchanged production ai_http_stream handler.
    /// The genuine inference-N ID already exists in the real InferenceState.
    /// This is not an alternate admission authority: the native handler alone
    /// decides admission failure and drains its actual request. The marker file
    /// is exclusive and no production build can invoke this test command.
    #[tauri::command]
    fn lm11_acceptance_original_request_admission_fault(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        session_id: String,
        request_id: String,
    ) -> Result<bool, String> {
        if state.scenario != "original-runtime-fault"
            || state.runtime_scenario.as_deref() != Some("request-admission-failure")
        {
            return Ok(false);
        }
        if active_runtime_mode(&state.root).as_deref() != Some("request-admission-failure")
            || !runtime::acceptance_is_owned_webview_root(&state.root)
            || app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .canonicalize()
                .map_err(|e| e.to_string())?
                != state.root.join("data")
            || !stage_barrier_session_valid(&session_id)
            || !request_id.starts_with("inference-")
            || !request_id[10..].bytes().all(|b| b.is_ascii_digit())
            || app
                .state::<net::inference::InferenceState>()
                .completion(&request_id)
                .is_none()
            || state
                .initial_binding
                .lock()
                .map_err(|_| "Original binding lock unavailable")?
                .is_none()
        {
            return Err(
                "Original admission fault lacks a registered case-owned native request".into(),
            );
        }
        let observed = state
            .observed
            .lock()
            .map_err(|_| "Native request audit lock unavailable")?;
        if observed
            .iter()
            .filter(|row| row.0 == "ai_http_open")
            .count()
            != 2
            || observed.iter().any(|row| row.0 == "ai_http_stream")
        {
            return Err(
                "Original native admission fault was not at the first real stream boundary".into(),
            );
        }
        drop(observed);
        let leaf = state.root.join("original-request-admission-fault.json");
        ensure_safe_leaf(&state.root, &leaf)?;
        write_json(
            &leaf,
            &json!({
                "sessionId":session_id,"requestId":request_id,
                "hostPid":std::process::id(),"syntheticOnly":true,
                "nativeRegisteredBeforeInvalidAdmission":true,
                "actualProductionHandlerUnchanged":true,
                "fault":"invalid-capacity",
            }),
        )?;
        Ok(true)
    }

    /// Arm a single exact request after the initial native cancel control. The
    /// original ai_http_cancel handler sees this only after cancelling/draining.
    #[tauri::command]
    fn lm11_acceptance_arm_cancel_ack(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        request_id: String,
    ) -> Result<bool, String> {
        let mode = if state.scenario == "original-late-cancel-ack" {
            "original-late-cancel-ack"
        } else {
            state
                .runtime_scenario
                .as_deref()
                .ok_or("No runtime ACK scenario")?
        };
        if !matches!(
            mode,
            "delayed-cancellation-ack" | "cancellation-ack-failure" | "original-late-cancel-ack"
        ) || (mode != "original-late-cancel-ack"
            && active_runtime_mode(&state.root).as_deref() != Some(mode))
            || !request_id.starts_with("inference-")
            || !request_id[10..].bytes().all(|b| b.is_ascii_digit())
        {
            return Err("ACK fault requires an activated exact native request".into());
        }
        let data = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if data != state.root.join("data")
            || app
                .state::<net::inference::InferenceState>()
                .completion(&request_id)
                .is_none()
        {
            return Err("ACK marker request is not present in owned native registry".into());
        }
        let marker = state.root.join("cancel-ack-fault.json");
        ensure_safe_leaf(&state.root, &marker)?;
        write_json(
            &marker,
            &json!({
                "runtimeScenario":mode, "requestId":request_id,
                "hostPid":std::process::id(), "syntheticOnly":true,
            }),
        )?;
        Ok(true)
    }

    /// Release the original native cancellation ACK ONLY after the renderer
    /// observes the unchanged original qualification caller terminal. This is
    /// a one-shot owned IPC witness, not a replacement cancellation authority.
    #[tauri::command]
    fn lm11_acceptance_release_cancel_ack(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        session_id: String,
        request_id: String,
    ) -> Result<bool, String> {
        if state.scenario != "original-late-cancel-ack"
            || !stage_barrier_session_valid(&session_id)
            || !request_id.starts_with("inference-")
            || !request_id[10..].bytes().all(|b| b.is_ascii_digit())
            || !runtime::acceptance_is_owned_webview_root(&state.root)
            || app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .canonicalize()
                .map_err(|e| e.to_string())?
                != state.root.join("data")
            || app
                .state::<net::inference::InferenceState>()
                .completion(&request_id)
                .is_some()
        {
            return Err("Late original ACK release does not own a terminal drained request".into());
        }
        let held = state.root.join("cancel-ack-held.json");
        let marker: Value = serde_json::from_slice(&fs::read(&held).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if marker["requestId"] != request_id
            || marker["hostPid"] != std::process::id()
            || marker["actualProductionCancelAndNativeDrainBeforeAck"] != true
            || marker["syntheticOnly"] != true
        {
            return Err("Native cancellation ACK was not physically held after real drain".into());
        }
        let fault: Value = serde_json::from_slice(
            &fs::read(state.root.join("cancel-ack-fault.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if fault["requestId"] != request_id
            || fault["runtimeScenario"] != "original-late-cancel-ack"
            || fault["hostPid"] != std::process::id()
            || fault["syntheticOnly"] != true
        {
            return Err("Original late ACK arming does not match real native request".into());
        }
        let leaf = state.root.join("cancel-ack-release.json");
        ensure_safe_leaf(&state.root, &leaf)?;
        write_json(
            &leaf,
            &json!({
                "requestId":request_id,"sessionId":session_id,
                "hostPid":std::process::id(),"originalCallerAlreadyTerminal":true,
                "syntheticOnly":true,
            }),
        )?;
        Ok(true)
    }
    /// Read-only observation of genuine synthetic TCP writes attempted AFTER the
    /// original 120s budget. Their destination is the SAME production-owned HTTP
    /// connection and its real native Channel, never a fabricated renderer event.
    #[tauri::command]
    fn lm11_acceptance_postdeadline_emission(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
    ) -> Result<Value, String> {
        if state.scenario != "original-postdeadline-provider-events"
            || !runtime::acceptance_is_owned_webview_root(&state.root)
            || app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .canonicalize()
                .map_err(|e| e.to_string())?
                != state.root.join("data")
        {
            return Err("Postdeadline actual provider event is outside owned original case".into());
        }
        let leaf = state.root.join("postdeadline-upstream-emission.json");
        ensure_safe_leaf(&state.root, &leaf)?;
        if !leaf.is_file() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&fs::read(leaf).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    fn lm11_acceptance_arm_late_channel(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        request_id: String,
    ) -> Result<bool, String> {
        if !matches!(
            state.scenario.as_str(),
            "post-terminal-channel-callback"
                | "post-cancel-channel-callback"
                | "post-cancel-original-lm2f-channel"
                | "original-duplicate-terminal"
        ) || !request_id.starts_with("inference-")
            || !request_id[10..].bytes().all(|b| b.is_ascii_digit())
        {
            return Err("Post-terminal Channel fault not explicitly selected".into());
        }
        let data = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if data != state.root.join("data")
            || app
                .state::<net::inference::InferenceState>()
                .completion(&request_id)
                .is_none()
        {
            return Err("Post-terminal native request has no original owned lease".into());
        }
        let fault = state.root.join("post-terminal-channel-fault.json");
        let output = state.root.join("post-terminal-channel-send.json");
        ensure_safe_leaf(&state.root, &fault)?;
        ensure_safe_leaf(&state.root, &output)?;
        if output.exists() {
            return Err("Post-terminal native Channel already delivered".into());
        }
        write_json(
            &fault,
            &json!({
                "scenario":state.scenario, "requestId":request_id,
                "hostPid":std::process::id(), "syntheticOnly":true,
            }),
        )?;
        Ok(true)
    }

    /// Feature-only T13 release of the ORIGINAL native request's cloned Channel.
    /// This does not create, cancel or modify any production inference request.
    /// The renderer must first observe real native Cancelled and the unchanged
    /// LM2F runner's rejection; native independently verifies the exact original
    /// stream/cancel IPC, registry drain and absence of B03 promotion.
    #[tauri::command]
    fn lm11_acceptance_release_original_lm2f_late_channel(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        request_id: String,
        session_id: String,
        native_terminal: String,
        rejection_phase: String,
    ) -> Result<bool, String> {
        if state.scenario != "post-cancel-original-lm2f-channel"
            || native_terminal != "cancelled"
            || !matches!(
                rejection_phase.as_str(),
                "Bounded qualification unverified at bounded-request"
                    | "Bounded qualification unverified at native-quiescence"
            )
            || session_id.is_empty()
            || session_id.len() > 128
            || !request_id.starts_with("inference-")
            || !request_id[10..].bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(
                "T13 release requires original LM2F rejection and exact native Cancelled".into(),
            );
        }
        let data = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if data != state.root.join("data")
            || !runtime::acceptance_is_owned_webview_root(&state.root)
            || app
                .state::<net::inference::InferenceState>()
                .completion(&request_id)
                .is_some()
        {
            return Err("Original native request is not drained in this isolated owner".into());
        }
        let original = state.root.join("post-terminal-channel-fault.json");
        ensure_safe_leaf(&state.root, &original)?;
        let armed: Value =
            serde_json::from_slice(&fs::read(original).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        if armed["syntheticOnly"] != true
            || armed["scenario"] != state.scenario
            || armed["hostPid"] != std::process::id()
            || armed["requestId"] != request_id
        {
            return Err("Original native Channel was not armed for this request".into());
        }
        let ipc = state
            .observed
            .lock()
            .map_err(|_| "Native IPC trace lock unavailable")?;
        let exact_streams = ipc
            .iter()
            .filter(|row| {
                row.0 == "ai_http_stream" && row.1.as_deref() == Some(request_id.as_str())
            })
            .count();
        let exact_cancels = ipc
            .iter()
            .filter(|row| {
                row.0 == "ai_http_cancel" && row.1.as_deref() == Some(request_id.as_str())
            })
            .count();
        let no_b03 = !ipc.iter().any(|row| {
            matches!(
                row.0.as_str(),
                "self_hosted_profiles_qualification_begin"
                    | "self_hosted_profiles_qualification_prepare"
                    | "self_hosted_profiles_qualification_acknowledge"
            )
        });
        drop(ipc);
        let no_receipts = settings::self_hosted_profiles_snapshot(app.clone())?
            .into_iter()
            .find(|(name, _)| name == "selfHostedInference")
            .is_some_and(|(_, value)| {
                value["fabric"]["qualificationReceipts"]
                    // Before a first qualification the canonical Fabric schema has
                    // NO qualificationReceipts field. Absence is zero receipts, not
                    // a failed safety condition. A nonempty array remains forbidden.
                    .as_array()
                    .map_or(true, Vec::is_empty)
            });
        if exact_streams != 1 || exact_cancels < 1 || !no_b03 || !no_receipts {
            return Err(
                "No unique completed native cancellation or unexpected B03 side effect".into(),
            );
        }
        let release = state.root.join("post-cancel-lm2f-release.json");
        ensure_safe_leaf(&state.root, &release)?;
        write_json(
            &release,
            &json!({
                "scenario":state.scenario,"requestId":request_id,
                "sessionId":session_id,"nativeTerminal":native_terminal,
                "originalLm2fRejected":true,"rejectionPhase":rejection_phase,
                "hostPid":std::process::id(),"syntheticOnly":true,
                "noNativeRegistry":true,"noB03AckOrReceipts":true,
            }),
        )?;
        Ok(true)
    }

    #[tauri::command]
    fn lm11_acceptance_close_window(
        window: tauri::WebviewWindow,
        state: tauri::State<'_, Arc<Acceptance>>,
        request_id: String,
    ) -> Result<(), String> {
        let original_qualifier_close = state.scenario == "stage-close";
        let stage = std::env::var(STAGE_BARRIER_ENV).ok();
        if !matches!(
            state.scenario.as_str(),
            "window-close-preflight" | "window-close-stream" | "stage-close"
        ) || window.label() != "main"
            || (!original_qualifier_close && !request_id.starts_with("inference-"))
        {
            return Err("Only the owned renderer may close its own active native request".into());
        }
        let app = window.app_handle().clone();
        let original_session = if original_qualifier_close {
            let chosen = stage.as_deref().ok_or("Original close stage missing")?;
            if !matches!(
                chosen,
                "before-ai-http-open" | "during-streaming" | "terminal-delivery"
            ) || !runtime::acceptance_is_owned_webview_root(&state.root)
                || app
                    .path()
                    .app_data_dir()
                    .map_err(|e| e.to_string())?
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    != state.root.join("data")
            {
                return Err(
                    "Original qualification close is outside isolated stage authority".into(),
                );
            }
            let marker = state.root.join("barrier-stage-hit.json");
            ensure_safe_leaf(&state.root, &marker)?;
            let hit: Value = serde_json::from_slice(&fs::read(marker).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            let initial = state
                .initial_binding
                .lock()
                .map_err(|_| "Initial runtime binding unavailable")?;
            let (epoch, pid) = initial.as_ref().ok_or("Initial runtime missing")?;
            if hit["stage"] != chosen
                || hit["actualOriginalStageIpc"] != true
                || hit["hostPid"] != std::process::id()
                || hit["epoch"] != *epoch
                || hit["pid"] != *pid
                || hit["originalAggregateBudgetMs"] != 120_000
                || !hit["sessionId"]
                    .as_str()
                    .is_some_and(stage_barrier_session_valid)
                || (chosen == "before-ai-http-open" && request_id != "no-native-request")
                || (matches!(chosen, "during-streaming" | "terminal-delivery")
                    && (!request_id.starts_with("inference-")
                        || !request_id[10..].bytes().all(|b| b.is_ascii_digit())))
            {
                return Err(
                    "Original renderer close lacks exact held production operation authority"
                        .into(),
                );
            }
            hit["sessionId"].as_str().map(ToString::to_string)
        } else {
            None
        };
        let mut done = if request_id == "no-native-request" && original_qualifier_close {
            None
        } else {
            // At the genuine terminal-delivery boundary the production native
            // owner may already have reaped its request before renderer Channel
            // delivery. Absence is authoritative only for this exact held stage;
            // never fabricate a late callback or resurrect the native ID.
            let completion = app
                .state::<net::inference::InferenceState>()
                .completion(&request_id);
            if completion.is_none() && stage.as_deref() != Some("terminal-delivery") {
                return Err("Owned native request already unavailable".into());
            }
            completion
        };
        let observed = state.inner().clone();
        let scenario = observed.scenario.clone();
        tauri::async_runtime::spawn(async move {
            let drained = if let Some(ref mut completed) = done {
                tokio::time::timeout(Duration::from_secs(6), async {
                    while !*completed.borrow_and_update() {
                        if completed.changed().await.is_err() {
                            return false;
                        }
                    }
                    true
                })
                .await
                .unwrap_or(false)
            } else {
                original_qualifier_close
                    && matches!(
                        stage.as_deref(),
                        Some("before-ai-http-open" | "terminal-delivery")
                    )
            };
            for _ in 0..100 {
                if observed.window_destroyed.load(Ordering::SeqCst) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            let destroyed = observed.window_destroyed.load(Ordering::SeqCst);
            let (opens, streams, closes) = observed
                .observed
                .lock()
                .ok()
                .map(|v| {
                    (
                        v.iter().filter(|r| r.0 == "ai_http_open").count(),
                        v.iter()
                            .filter(|r| {
                                r.0 == "ai_http_stream"
                                    && r.1.as_deref() == Some(request_id.as_str())
                            })
                            .count(),
                        v.iter()
                            .filter(|r| r.0 == "lm11_acceptance_close_window")
                            .count(),
                    )
                })
                .unwrap_or((0, 0, 0));
            let service_events =
                fs::read_to_string(observed.root.join("service-events.jsonl")).unwrap_or_default();
            let post_count = service_events
                .lines()
                .filter(|line| {
                    serde_json::from_str::<Value>(line)
                        .is_ok_and(|v| v["route"] == "/v1/chat/completions" && v["status"] == 200)
                })
                .count();
            let rows = settings::self_hosted_profiles_snapshot(app.clone())
                .ok()
                .and_then(|entries| {
                    entries
                        .into_iter()
                        .find(|(key, _)| key == "selfHostedInference")
                })
                .and_then(|(_, v)| v["fabric"]["qualificationReceipts"].as_array().cloned())
                .unwrap_or_default();
            let expected_post = if scenario == "window-close-stream"
                || (scenario == "stage-close"
                    && matches!(
                        stage.as_deref(),
                        Some("during-streaming" | "terminal-delivery")
                    )) {
                1
            } else {
                0
            };
            let expected_original_streams =
                if original_qualifier_close && stage.as_deref() == Some("before-ai-http-open") {
                    0
                } else {
                    1
                };
            let pass = drained
                && destroyed
                && opens >= if expected_original_streams == 0 { 1 } else { 2 }
                && streams == expected_original_streams
                && closes == 1
                && post_count == expected_post
                && rows.is_empty()
                && (!original_qualifier_close || original_session.is_some());
            let report = json!({
                "scenario":scenario, "nativeTauriIpc":true, "syntheticOnly":true,
                "actualRendererWindowDestroyed":destroyed,
                "exactNativeRequestId":request_id,
                "nativeRegistryDrainedAfterWindowDestroyed":drained,
                "nativeOpenIpcCount":opens,"exactNativeStreamIpcCount":streams,
                "realWindowCloseIpcCount":closes,
                "syntheticHttpPostCount":post_count,
                "persistedQualificationReceiptCount":rows.len(),
                "originalProductionRunnerAtClose":original_qualifier_close &&
                    original_session.is_some(),
                "originalQualificationStage":stage,
                "originalSessionIdPresent":original_session.is_some(),
                "originalAggregateBudgetMs":if original_qualifier_close {120_000} else {0},
                "originalWebviewCallerSucceeded":false,
                "modelRuntimeStarted":false,
                "providerEternalInactivityProven":false,
                "passed":pass,
            });
            let output = observed.root.join("native-window-close-report.json");
            let saved = ensure_safe_leaf(&observed.root, &output).is_ok()
                && write_json(&output, &report).is_ok();
            if let Ok(mut flag) = observed.report_written.lock() {
                *flag = saved;
            }
            runtime::shutdown();
            app.exit(if pass && saved { 0 } else { 1 });
        });
        window.close().map_err(|e| e.to_string())
    }

    fn active_runtime_mode(root: &Path) -> Option<String> {
        let marker = root.join("runtime-active.json");
        ensure_safe_leaf(root, &marker).ok()?;
        let mode: Value = serde_json::from_slice(&fs::read(marker).ok()?).ok()?;
        let configured = std::env::var(RUNTIME_ENV).ok()?;
        (mode["runtimeScenario"] == configured && RUNTIME_MODES.contains(&configured.as_str()))
            .then_some(configured)
    }

    fn ensure_root(root: &Path) -> Result<PathBuf, String> {
        let root = root
            .canonicalize()
            .map_err(|_| "Acceptance root not found")?;
        if !runtime::acceptance_is_owned_webview_root(&root)
            || root
                .file_name()
                .is_none_or(|name| !name.to_string_lossy().starts_with("wry-"))
            || root.parent().and_then(Path::file_name) != Some(std::ffi::OsStr::new("cases"))
        {
            return Err("ABORT: acceptance root is not a unique direct cases child".into());
        }
        for part in ["data", "local-data", "webview", "inspect-webview"] {
            let path = root.join(part);
            fs::create_dir(&path)
                .or_else(|e| {
                    if e.kind() == std::io::ErrorKind::AlreadyExists {
                        Ok(())
                    } else {
                        Err(e)
                    }
                })
                .map_err(|e| e.to_string())?;
            if path.canonicalize().map_err(|e| e.to_string())? != path {
                return Err(format!(
                    "ABORT: unexpected reparse/redirect in owned {part} directory"
                ));
            }
        }
        // Never traverse test-controlled reparse leaves, including the production
        // Store's interprocess lock and our service audit. In these isolated cases
        // there is no valid reason for any such leaf to be a symlink/junction.
        for leaf in [
            "data/terax-settings.json",
            "data/.terax-settings.json.lock",
            "data/.terax-settings.json.replaced-backup",
            "service-events.jsonl",
            "service-ready.json",
            "service-ready-b.json",
            "service-ready-abc-b.json",
            "service-ready-abc-c.json",
            "service-ready-abc-a2.json",
            "renderer-report.json",
            "native-qualification-ticket.json",
            "native-restart-report.json",
            "runtime-active.json",
            "cancel-ack-fault.json",
            "deadline-stage-armed.json",
            "deadline-stage-hit.json",
            "post-terminal-channel-fault.json",
            "post-terminal-channel-send.json",
            "post-cancel-lm2f-release.json",
            "barrier-stage-armed.json",
            "barrier-stage-hit.json",
            "barrier-stage-release.json",
            "barrier-stage-observation.json",
            "native-window-close-report.json",
        ] {
            ensure_safe_leaf(&root, &root.join(leaf))?;
        }
        Ok(root)
    }

    fn ensure_safe_leaf(root: &Path, leaf: &Path) -> Result<(), String> {
        if !leaf.starts_with(root) || leaf == root {
            return Err("ABORT: acceptance file escaped owned case".into());
        }
        let parent = leaf
            .parent()
            .ok_or("ABORT: invalid acceptance leaf parent")?;
        let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
        if canonical_parent != parent || (parent != root && parent != root.join("data")) {
            return Err("ABORT: acceptance file parent redirected".into());
        }
        let meta = match fs::symlink_metadata(leaf) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.to_string()),
        };
        use std::os::windows::fs::MetadataExt;
        const WINDOWS_REPARSE: u32 = 0x00000400;
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.file_attributes() & WINDOWS_REPARSE != 0
            || leaf.canonicalize().map_err(|e| e.to_string())? != leaf
        {
            return Err(
                "ABORT: acceptance settings/lock/audit leaf is redirected or unsafe".into(),
            );
        }
        Ok(())
    }

    fn write_json(path: &Path, value: &Value) -> Result<(), String> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        serde_json::to_writer_pretty(&mut f, value).map_err(|e| e.to_string())?;
        f.flush()
            .and_then(|()| f.sync_all())
            .map_err(|e| e.to_string())
    }

    /// Feature-only evidence serialization: concurrent HTTP readiness probes may
    /// otherwise interleave separate writeln! chunks in one JSONL file. This lock
    /// governs LOG BYTES ONLY, never HTTP, inference, native request, or CAS state.
    fn record_synthetic_event(root: &Path, value: Value) {
        static SERVICE_EVIDENCE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let Ok(_guard) = SERVICE_EVIDENCE_LOCK.get_or_init(|| Mutex::new(())).lock() else {
            return;
        };
        let path = root.join("service-events.jsonl");
        if ensure_safe_leaf(root, &path).is_err() {
            return;
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{value}");
        }
    }

    fn record_service(root: &Path, route: &str, result: u16, authenticated: bool) {
        let mut event = json!({
            "route": route, "status": result, "authenticated": authenticated,
            "syntheticOnly": true, "runtimeScenario": active_runtime_mode(root),
        });
        if std::env::var(SCENARIO_ENV).as_deref() == Ok("original-managed-abc-deployments") {
            event["childSlot"] =
                json!(std::env::var("CLACK_LM11_SYNTHETIC_READY_SLOT")
                    .unwrap_or_else(|_| "abc-a".into()));
            event["servicePid"] = json!(std::process::id());
        }
        record_synthetic_event(root, event);
    }

    fn record_runtime_step(root: &Path, phase: &str) {
        record_synthetic_event(
            root,
            json!({
                "route":"/v1/chat/completions", "phase":phase,
                "runtimeScenario":active_runtime_mode(root), "syntheticOnly":true,
            }),
        );
    }

    fn respond(
        stream: &mut TcpStream,
        status: u16,
        kind: &str,
        body: &[u8],
    ) -> std::io::Result<()> {
        let reason = match status {
            200 => "OK",
            401 => "Unauthorized",
            405 => "Method Not Allowed",
            422 => "Unprocessable Entity",
            _ => "Not Found",
        };
        write!(stream, "HTTP/1.1 {status} {reason}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n", body.len())?;
        stream.write_all(body)?;
        stream.flush()
    }

    fn handle_synthetic(mut socket: TcpStream, root: &Path, key: &str, alias: &str) {
        let mode = active_runtime_mode(root);
        let _ = socket.set_read_timeout(Some(Duration::from_secs(5)));
        let _ = socket.set_write_timeout(Some(Duration::from_secs(5)));
        let mut bytes = Vec::with_capacity(4096);
        let mut chunk = [0u8; 2048];
        let mut header_end = None;
        while bytes.len() < 262_144 {
            let size = match socket.read(&mut chunk) {
                Ok(0) | Err(_) => return,
                Ok(n) => n,
            };
            bytes.extend_from_slice(&chunk[..size]);
            if header_end.is_none() {
                header_end = bytes
                    .windows(4)
                    .position(|seq| seq == b"\r\n\r\n")
                    .map(|offset| offset + 4);
            }
            let Some(offset) = header_end else { continue };
            let Ok(header) = std::str::from_utf8(&bytes[..offset]) else {
                return;
            };
            let length = header
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            if length > 128 * 1024 {
                return;
            }
            if bytes.len() < offset + length {
                continue;
            }
            break;
        }
        let Some(offset) = header_end else { return };
        let Ok(header) = std::str::from_utf8(&bytes[..offset]) else {
            return;
        };
        let first = header.lines().next().unwrap_or("");
        let mut parts = first.split_ascii_whitespace();
        let (method, route) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        let auth = header.lines().any(|line| {
            line.split_once(':').is_some_and(|(name, value)| {
                name.eq_ignore_ascii_case("authorization")
                    && value.trim() == format!("Bearer {key}")
            })
        });
        if method == "GET" && route == "/health" {
            if mode.as_deref() == Some("delayed-readiness") {
                record_runtime_step(root, "health-delay-start");
                thread::sleep(Duration::from_millis(310));
                record_runtime_step(root, "health-delay-finished");
            }
            if mode.as_deref() == Some("authenticated-health-failure") {
                record_service(root, route, 503, false);
                let _ = respond(
                    &mut socket,
                    503,
                    "application/json",
                    br#"{"status":"unavailable"}"#,
                );
                return;
            }
            record_service(root, route, 200, false);
            let _ = respond(
                &mut socket,
                200,
                "application/json",
                br#"{"status":"ok","syntheticOnly":true}"#,
            );
            return;
        }
        if !auth {
            record_service(root, route, 401, false);
            let _ = respond(
                &mut socket,
                401,
                "application/json",
                br#"{"error":"unauthorized"}"#,
            );
            return;
        }
        if method == "GET" && route == "/v1/models" {
            record_service(root, route, 200, true);
            let native_identity = if mode.as_deref() == Some("authenticated-model-identity-failure")
            {
                record_runtime_step(root, "authenticated-wrong-model-identity");
                "clack-0000000000000000"
            } else {
                alias
            };
            let models = json!({"object":"list", "data":[{"id":native_identity,"object":"model"}]})
                .to_string();
            let _ = respond(&mut socket, 200, "application/json", models.as_bytes());
            return;
        }
        if method != "POST" || route != "/v1/chat/completions" {
            record_service(root, route, 405, true);
            let _ = respond(
                &mut socket,
                405,
                "application/json",
                br#"{"error":"unsupported"}"#,
            );
            return;
        }
        let body: Value = match serde_json::from_slice(&bytes[offset..]) {
            Ok(v) => v,
            Err(_) => {
                record_service(root, route, 422, true);
                return;
            }
        };
        const EXPECTED: &str = "Reply with exactly LM2F-CHAT-QUALIFIED and nothing else.";
        let prompt_ok = body["messages"].as_array().is_some_and(|messages| {
            messages.len() == 2
                && messages[0]["role"] == "system"
                && messages[0]["content"]
                    .as_str()
                    .is_some_and(|text| text.contains("ACTIVE AGENT: Coder"))
                && messages[1]["role"] == "user"
                && (messages[1]["content"]
                    .as_str()
                    .is_some_and(|text| text.ends_with(EXPECTED))
                    || messages[1]["content"].as_array().is_some_and(|parts| {
                        parts.iter().any(|part| {
                            part["type"] == "text"
                                && part["text"]
                                    .as_str()
                                    .is_some_and(|text| text.ends_with(EXPECTED))
                        })
                    }))
        });
        if body["model"] != alias
            || body["stream"] != true
            || !prompt_ok
            || body["tools"]
                .as_array()
                .is_some_and(|tools| !tools.is_empty())
        {
            record_service(root, route, 422, true);
            let _ = respond(
                &mut socket,
                422,
                "application/json",
                br#"{"error":"synthetic-request-shape-denied"}"#,
            );
            return;
        }
        if mode.as_deref() == Some("transport-failure") {
            record_runtime_step(root, "disconnect-before-http-headers");
            return;
        }
        if mode.as_deref() == Some("delayed-request-acceptance") {
            record_runtime_step(root, "request-acceptance-delay-start");
            thread::sleep(Duration::from_millis(360));
            record_runtime_step(root, "request-acceptance-delay-finished");
        }
        if mode.as_deref() == Some("terminal-error") {
            record_service(root, route, 500, true);
            let _ = respond(
                &mut socket,
                500,
                "application/json",
                br#"{"error":{"message":"synthetic terminal failure","type":"server_error"}}"#,
            );
            return;
        }
        record_service(root, route, 200, true);
        let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n");
        if matches!(
            mode.as_deref(),
            Some(
                "delayed-first-stream-event"
                    | "first-output-after-aggregate-deadline"
                    | "runtime-process-exits-mid-request"
                    | "runtime-epoch-change-mid-request"
            )
        ) {
            record_runtime_step(root, "first-frame-delay-start");
            thread::sleep(Duration::from_millis(match mode.as_deref() {
                Some("first-output-after-aggregate-deadline") => 700,
                Some("runtime-process-exits-mid-request") => 650,
                _ => 360,
            }));
            record_runtime_step(root, "first-frame-delay-finished");
        }
        if mode.as_deref() == Some("malformed-stream-frame") {
            record_runtime_step(root, "malformed-sse-emitted");
            let _ = socket.write_all(b"data: {{{ this is deliberately not JSON }}}\n\n");
            let _ = socket.write_all(b"data: [DONE]\n\n");
            let _ = socket.flush();
            return;
        }
        // Evidence rejection must complete a fully valid, bounded SSE stream.
        // Only instruction adherence is deliberately wrong; oversize output
        // would test an earlier transport/quiescence fence, not the evaluator.
        let nonadherent_evidence = mode.as_deref() == Some("evidence-rejection");
        let answer = if nonadherent_evidence {
            "LM2F-CHAT-NOT-QUALIFIED".to_owned()
        } else {
            "LM2F-CHAT-QUALIFIED".to_owned()
        };
        for (index, (delta, finish)) in [
            (json!({"role":"assistant"}), Value::Null),
            (json!({"content":answer}), Value::Null),
            (json!({}), json!("stop")),
        ]
        .into_iter()
        .enumerate()
        {
            let row = json!({"id":"chatcmpl-lm11-synthetic-only", "object":"chat.completion.chunk",
                "created":1, "model":alias, "choices":[{"index":0,"delta":delta,"finish_reason":finish}],
                "usage": if index == 2 {json!({"prompt_tokens":24,"completion_tokens":8,"total_tokens":32})} else {Value::Null},
            });
            if write!(socket, "data: {row}\n\n")
                .and_then(|()| socket.flush())
                .is_err()
            {
                return;
            }
            if index == 1
                && std::env::var(SCENARIO_ENV).as_deref()
                    == Ok("original-postdeadline-provider-events")
            {
                // First genuine role AND content SSE were flushed above and reached
                // the ORIGINAL native request. Hold one actual provider socket
                // beyond the unchanged JS QualificationOperationDeadline(120000).
                // The original Stop should close this socket and drain the exact
                // native request before this thread tries subsequent real TCP
                // writes. Record attempted bytes and OS write outcomes, never
                // claim a canceled socket delivered a renderer callback.
                let held = Instant::now();
                thread::sleep(Duration::from_millis(123_500));
                let content = json!({"id":"chatcmpl-lm11-synthetic-only",
                "object":"chat.completion.chunk","created":1,"model":alias,
                "choices":[{"index":0,"delta":{"content":"LATE-ONLY-AFTER-120S"},"finish_reason":Value::Null}]});
                let terminal = json!({"id":"chatcmpl-lm11-synthetic-only",
                "object":"chat.completion.chunk","created":1,"model":alias,
                "choices":[{"index":0,"delta":{},"finish_reason":"stop"}]});
                // These timestamps belong to the actual isolated provider process,
                // not to the acceptance renderer. A failed TCP write is still an
                // observed attempted upstream event after the real caller deadline.
                let content_at = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                let chunk_write = write!(socket, "data: {content}\n\n")
                    .and_then(|_| socket.flush())
                    .is_ok();
                let terminal_at = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                let terminal_write = write!(socket, "data: {terminal}\n\n")
                    .and_then(|_| socket.flush())
                    .is_ok();
                let done_write = socket
                    .write_all(b"data: [DONE]\n\n")
                    .and_then(|_| socket.flush())
                    .is_ok();
                let leaf = root.join("postdeadline-upstream-emission.json");
                if ensure_safe_leaf(root, &leaf).is_err() {
                    return;
                }
                let _ = write_json(
                    &leaf,
                    &json!({
                        "syntheticOnly":true,"providerProcessId":std::process::id(),
                        "sameAuthenticatedOriginalHttpSocket":true,
                        "firstSseFrameBeforeDeadline":true,
                        "elapsedSinceFirstSseFrameMs":held.elapsed().as_millis() as u64,
                        "lateContentFrameAttempted":true,"lateTerminalFrameAttempted":true,
                        "lateContentAttemptAtUnixMs":content_at,
                        "lateTerminalAttemptAtUnixMs":terminal_at,
                        // Separate actual sequential TCP writes can share one OS
                        // millisecond tick; the attempt ordinals preserve ordering.
                        "lateContentAttemptOrdinal":1,"lateTerminalAttemptOrdinal":2,
                        "lateDoneMarkerAttempted":true,
                        "lateContentTcpWriteSucceeded":chunk_write,
                        "lateTerminalTcpWriteSucceeded":terminal_write,
                        "lateDoneTcpWriteSucceeded":done_write,
                        "notProofOfDeliveredRendererCallback":true,
                    }),
                );
                return;
            }
            if index == 0
                && matches!(
                    mode.as_deref(),
                    Some(
                        "never-terminal-until-cancellation"
                            | "late-stream-event-after-cancellation"
                            | "connection-close-without-terminal"
                    )
                )
            {
                if mode.as_deref() == Some("connection-close-without-terminal") {
                    record_runtime_step(root, "stream-closed-without-terminal");
                    return;
                }
                if mode.as_deref() == Some("never-terminal-until-cancellation") {
                    record_runtime_step(root, "terminal-deliberately-withheld");
                    thread::sleep(Duration::from_secs(3));
                    return;
                }
                thread::sleep(Duration::from_millis(420));
                record_runtime_step(root, "late-frame-attempt-after-cancel");
            }
            if index == 1
                && matches!(
                    mode.as_deref(),
                    Some(
                        "delayed-terminal-event"
                            | "terminal-callback-after-deadline"
                            | "cancellation-terminal-race"
                    )
                )
            {
                record_runtime_step(root, "terminal-delay-start");
                thread::sleep(Duration::from_millis(match mode.as_deref() {
                    Some("terminal-callback-after-deadline") => 720,
                    Some("cancellation-terminal-race") => 115,
                    _ => 370,
                }));
                record_runtime_step(root, "terminal-delay-finished");
            } else if matches!(
                std::env::var(SCENARIO_ENV).as_deref(),
                Ok("stale-cross-child-restart" | "stale-original-qualification-child-restart")
            ) && index == 0
            {
                // Actual A starts SSE, then native owner kills its process while
                // an in-flight request remains pending. B independently serves a
                // new request under a new credential and OS process identity.
                thread::sleep(Duration::from_millis(950));
            } else if std::env::var(SCENARIO_ENV).as_deref()
                == Ok("post-cancel-original-lm2f-channel")
                && index == 0
            {
                // T13-only genuine provider->native SSE timing window. The first
                // real assistant-role frame has already been sent/flushed. Hold
                // the next response segment so the unchanged production LM2F
                // caller can observe that native chunk and invoke its original
                // cancelSessionInference while the same request is still live.
                // No model/process simulation, no extra request, no renderer
                // callback substitution and no change to any other scenario.
                thread::sleep(Duration::from_millis(1_500));
            } else if matches!(
                std::env::var(SCENARIO_ENV).as_deref(),
                Ok("original-abc-native-isolation" | "original-managed-abc-deployments")
            ) && index == 0
            {
                // Historical original-abc-native-isolation keeps three request IDs
                // on ONE managed owner; it is NOT a three-deployment test.
                // In original-managed-abc-deployments, the native keyed owners
                // have THREE separate authenticated OS children. Hold B/C provider
                // SSE frames/terminals while the real original A is stopped and
                // selectively restarted as A2. Do not forge native registry holds.
                let abc_slot = std::env::var("CLACK_LM11_SYNTHETIC_READY_SLOT").ok();
                thread::sleep(Duration::from_millis(
                    if std::env::var(SCENARIO_ENV).as_deref()
                        == Ok("original-managed-abc-deployments")
                    {
                        if matches!(abc_slot.as_deref(), Some("abc-b" | "abc-c")) {
                            // Actual native B/C leases remain in flight while the
                            // original A Stop and A->A2 selective restart occur.
                            // The provider holds real SSE bytes, not a fake
                            // completion or modified production lease.
                            18_000
                        } else {
                            5_000
                        }
                    } else {
                        2_500
                    },
                ));
            } else if matches!(
                std::env::var(SCENARIO_ENV).as_deref(),
                Ok("stop-during-stream"
                    | "window-close-stream"
                    | "post-cancel-channel-callback"
                    | "post-cancel-original-lm2f-channel")
            ) || matches!(
                mode.as_deref(),
                Some(
                    "cancel-during-streaming"
                        | "delayed-cancellation-ack"
                        | "cancellation-ack-failure"
                )
            ) {
                thread::sleep(Duration::from_millis(300));
            } else {
                thread::sleep(Duration::from_millis(30));
            }
        }
        let _ = socket.write_all(b"data: [DONE]\n\n");
        let _ = socket.flush();
        if nonadherent_evidence {
            record_runtime_step(root, "protocol-valid-nonadherent-evidence-emitted");
        }
        record_runtime_step(root, "synthetic-sse-done");
    }

    fn synthetic_service() -> Result<(), String> {
        let root = ensure_root(&PathBuf::from(
            std::env::var(ROOT_ENV).map_err(|_| "Root missing")?,
        ))?;
        let key = std::env::var("CLACK_LM11_SYNTHETIC_KEY").map_err(|_| "Key missing")?;
        let alias = std::env::var("CLACK_LM11_SYNTHETIC_ALIAS").map_err(|_| "Alias missing")?;
        if key.len() != 64
            || !key.bytes().all(|b| b.is_ascii_hexdigit())
            || !alias.starts_with("clack-")
            || alias.len() != 22
            || !alias[6..].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid child service identity".into());
        }
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let actual = listener.local_addr().map_err(|e| e.to_string())?;
        if !actual.ip().is_loopback() {
            return Err("Non-loopback bind denied".into());
        }
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let marker = match std::env::var("CLACK_LM11_SYNTHETIC_READY_SLOT").as_deref() {
            Ok("b") => "service-ready-b.json",
            Ok("abc-b")
                if std::env::var(SCENARIO_ENV).as_deref()
                    == Ok("original-managed-abc-deployments") =>
            {
                "service-ready-abc-b.json"
            }
            Ok("abc-c")
                if std::env::var(SCENARIO_ENV).as_deref()
                    == Ok("original-managed-abc-deployments") =>
            {
                "service-ready-abc-c.json"
            }
            Ok("abc-a2")
                if std::env::var(SCENARIO_ENV).as_deref()
                    == Ok("original-managed-abc-deployments") =>
            {
                "service-ready-abc-a2.json"
            }
            Err(std::env::VarError::NotPresent) => "service-ready.json",
            _ => return Err("Unsupported synthetic child marker slot".into()),
        };
        ensure_safe_leaf(&root, &root.join(marker))?;
        write_json(
            &root.join(marker),
            &json!({
                "port":actual.port(), "pid":std::process::id(), "syntheticOnly":true,
            }),
        )?;
        let until = Instant::now()
            + Duration::from_secs(
                if matches!(
                    std::env::var(SCENARIO_ENV).as_deref(),
                    Ok("deadline-bounded"
                        | "original-postdeadline-provider-events"
                        | "original-managed-abc-deployments")
                ) {
                    // Keep the ISOLATED synthetic provider process alive long
                    // enough to attempt its late TCP writes even after Clack's
                    // original 120s deadline closes the production request.
                    // This does not retain a native inference lease or socket.
                    210
                } else {
                    120
                },
            );
        while Instant::now() < until {
            match listener.accept() {
                Ok((stream, remote)) => {
                    if !remote.ip().is_loopback() {
                        continue;
                    }
                    let (r, k, a) = (root.clone(), key.clone(), alias.clone());
                    thread::spawn(move || handle_synthetic(stream, &r, &k, &a));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(15));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(())
    }

    fn probe_wrong_bearer(port: u16, bearer: Option<&str>) -> Result<bool, String> {
        let mut stream = TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}")
                .parse()
                .map_err(|_| "Bad loopback port")?,
            Duration::from_secs(2),
        )
        .map_err(|e| e.to_string())?;
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .map_err(|e| e.to_string())?;
        let authorization = bearer
            .map(|v| format!("Authorization: Bearer {v}\r\n"))
            .unwrap_or_default();
        write!(
        stream,
        "GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1\r\n{authorization}Connection: close\r\n\r\n"
    )
        .map_err(|e| e.to_string())?;
        let mut response = BufReader::new(stream);
        let mut status = String::new();
        response.read_line(&mut status).map_err(|e| e.to_string())?;
        Ok(status.starts_with("HTTP/1.1 401 "))
    }

    #[tauri::command]
    fn lm11_acceptance_bind(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        deployment_id: String,
        deployment_identity: String,
    ) -> Result<Value, String> {
        if !probe_wrong_bearer(state.port, None)?
            || !probe_wrong_bearer(state.port, Some(&"0".repeat(64)))?
        {
            return Err("Synthetic service accepted a missing or incorrect bearer token".into());
        }
        let mut child = state.child.lock().map_err(|_| "Child lock unavailable")?;
        let child = child
            .take()
            .ok_or("Synthetic child was already bound or terminated")?;
        let (epoch, pid) = runtime::acceptance_bind_synthetic_child(
            &app,
            &state.root,
            child,
            state.port,
            state.key.clone(),
            state.alias.clone(),
            &deployment_id,
            &deployment_identity,
        )?;
        let mut initial = state
            .initial_binding
            .lock()
            .map_err(|_| "Initial binding lock unavailable")?;
        if initial.is_some() {
            runtime::shutdown();
            return Err("Duplicate initial native acceptance child".into());
        }
        *initial = Some((epoch.clone(), pid));
        Ok(json!({"epoch": epoch, "pid": pid, "syntheticOnly": true,
        "negativeAuthDenied": true}))
    }

    /// Spawn one additional REAL OS child, but only under the exact feature-only
    /// ABC fixture and canonical persisted deployment. Native RuntimeOwner owns
    /// the joined child and bearer key after admission; renderer never supplies
    /// a key, port or endpoint. No real GGUF/model process is reachable here.
    fn abc_bind_owned_child(
        app: &tauri::AppHandle,
        state: &Acceptance,
        slot: &str,
        deployment_id: &str,
        deployment_identity: &str,
        digest: &str,
    ) -> Result<Value, String> {
        if state.scenario != "original-managed-abc-deployments"
            || !matches!(slot, "b" | "c" | "a2")
            || !runtime::acceptance_is_owned_webview_root(&state.root)
            || app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .canonicalize()
                .map_err(|e| e.to_string())?
                != state.root.join("data")
            || digest.len() != 71
            || !digest.starts_with("sha256:")
            || !digest[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("ABC native child escaped its exact feature-only identity".into());
        }
        let mut bindings = state
            .abc_bindings
            .lock()
            .map_err(|_| "ABC synthetic binding lock unavailable")?;
        if bindings.contains_key(slot)
            || (slot == "c" && !bindings.contains_key("b"))
            || (slot == "a2" && (!bindings.contains_key("b") || !bindings.contains_key("c")))
        {
            return Err("ABC native child slot is duplicated or out of order".into());
        }
        let marker = state.root.join(format!("service-ready-abc-{slot}.json"));
        ensure_safe_leaf(&state.root, &marker)?;
        if marker.exists() {
            return Err("ABC synthetic child ready marker was already used".into());
        }
        let key = runtime::acceptance_new_synthetic_key()?;
        let alias = format!("clack-{}", &digest[7..23]);
        let mut child = StartupChild(Some(
            Command::new(std::env::current_exe().map_err(|e| e.to_string())?)
                .arg("--synthetic-service")
                .env(ROOT_ENV, &state.root)
                .env("CLACK_LM11_SYNTHETIC_KEY", &key)
                .env("CLACK_LM11_SYNTHETIC_ALIAS", &alias)
                .env("CLACK_LM11_SYNTHETIC_READY_SLOT", format!("abc-{slot}"))
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?,
        ));
        let pid = child.0.as_ref().ok_or("ABC child missing")?.id();
        let until = Instant::now() + Duration::from_secs(7);
        let port = loop {
            if Instant::now() >= until {
                return Err("ABC child never authenticated its PID/loopback port".into());
            }
            if let Ok(bytes) = fs::read(&marker) {
                let ready: Value =
                    serde_json::from_slice(&bytes).map_err(|_| "ABC child ready marker invalid")?;
                if ready["syntheticOnly"] != true || ready["pid"].as_u64() != Some(u64::from(pid)) {
                    return Err("ABC child ready marker did not match actual child PID".into());
                }
                if let Some(port) = ready["port"].as_u64().filter(|p| (1..=65535).contains(p)) {
                    break port as u16;
                }
            }
            thread::sleep(Duration::from_millis(20));
        };
        if !probe_wrong_bearer(port, None)? || !probe_wrong_bearer(port, Some(&state.key))? {
            return Err("ABC child accepted missing or old owner bearer".into());
        }
        let (epoch, bound_pid) = runtime::acceptance_bind_synthetic_child(
            app,
            &state.root,
            child.0.take().ok_or("ABC child no longer owned")?,
            port,
            key,
            alias,
            deployment_id,
            deployment_identity,
        )?;
        if bound_pid != pid
            || bindings.values().any(|previous| {
                previous["pid"].as_u64() == Some(u64::from(pid))
                    || previous["epoch"].as_str() == Some(epoch.as_str())
                    || previous["port"].as_u64() == Some(u64::from(port))
            })
        {
            return Err("ABC child duplicated a native PID/epoch/port".into());
        }
        let binding = json!({
            "slot":slot, "deploymentId":deployment_id,
            "pid":pid, "epoch":epoch, "port":port, "syntheticOnly":true,
        });
        bindings.insert(slot.to_owned(), binding.clone());
        Ok(binding)
    }

    #[tauri::command]
    fn lm11_acceptance_abc_bind_child(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        slot: String,
        deployment_id: String,
        deployment_identity: String,
        digest: String,
    ) -> Result<Value, String> {
        if !matches!(slot.as_str(), "b" | "c")
            || state
                .initial_binding
                .lock()
                .map_err(|_| "ABC original binding unavailable")?
                .is_none()
        {
            return Err("ABC additional child requires its original owner A".into());
        }
        abc_bind_owned_child(
            &app,
            &state,
            &slot,
            &deployment_id,
            &deployment_identity,
            &digest,
        )
    }

    #[tauri::command]
    fn lm11_acceptance_abc_restart_a(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        deployment_id: String,
        deployment_identity: String,
        digest: String,
    ) -> Result<Value, String> {
        if state.scenario != "original-managed-abc-deployments" {
            return Err("ABC selective restart is not armed".into());
        }
        let (old_epoch, old_pid) = state
            .initial_binding
            .lock()
            .map_err(|_| "Original A binding unavailable")?
            .clone()
            .ok_or("Original ABC deployment A never bound")?;
        {
            let siblings = state
                .abc_bindings
                .lock()
                .map_err(|_| "ABC sibling binding unavailable")?;
            if !siblings.contains_key("b")
                || !siblings.contains_key("c")
                || siblings.contains_key("a2")
            {
                return Err("ABC restart must preserve two already bound siblings".into());
            }
        }
        // ONLY the exact managed owner A is stopped. Native B and C OS children,
        // Ready snapshots, bearer identities and in-flight requests stay live.
        runtime::acceptance_stop_synthetic_child(
            &app,
            &state.root,
            &deployment_id,
            &deployment_identity,
        )?;
        let replacement = abc_bind_owned_child(
            &app,
            &state,
            "a2",
            &deployment_id,
            &deployment_identity,
            &digest,
        )?;
        if replacement["pid"].as_u64() == Some(u64::from(old_pid))
            || replacement["epoch"].as_str() == Some(old_epoch.as_str())
        {
            return Err("ABC native restart reused A's physical PID or epoch".into());
        }
        Ok(json!({
            "oldPid":old_pid, "oldEpoch":old_epoch,
            "newPid":replacement["pid"], "newEpoch":replacement["epoch"],
            "newPort":replacement["port"], "syntheticOnly":true,
        }))
    }

    /// Content-free, write-once acceptance-only progress trace. A genuine native
    /// stream may remain outstanding after the Wry host exits, so a marker is NOT
    /// a renderer PASS or an alternate request/persistence authority. Its sole
    /// purpose is to establish the exact last reached original IPC boundary.
    #[tauri::command]
    fn lm11_acceptance_abc_checkpoint(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        stage: String,
        session_id: String,
    ) -> Result<(), String> {
        const STAGES: &[&str] = &[
            "abc-ready",
            "abc-a-request",
            "abc-native-live",
            "abc-a-cancel",
            "abc-a2-restart",
            "abc-await-bc",
            "abc-bc-terminal",
            "abc-stale-begin",
            "abc-stale-rejected",
            "abc-start-b-qualification",
            "abc-qualified-b",
            "abc-start-c-qualification",
            "abc-qualified-c",
            "abc-persisted-verified",
        ];
        if state.scenario != "original-managed-abc-deployments"
            || !STAGES.contains(&stage.as_str())
            || !stage_barrier_session_valid(&session_id)
            || !runtime::acceptance_is_owned_webview_root(&state.root)
            || app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .canonicalize()
                .map_err(|e| e.to_string())?
                != state.root.join("data")
        {
            return Err("ABC checkpoint lacks exact canonical feature-host authority".into());
        }
        let (epoch, pid) = state
            .initial_binding
            .lock()
            .map_err(|_| "Initial ABC binding unavailable")?
            .clone()
            .ok_or("ABC original physical child never bound")?;
        let marker = state.root.join(format!("abc-checkpoint-{stage}.json"));
        ensure_safe_leaf(&state.root, &marker)?;
        write_json(
            &marker,
            &json!({
                "stage":stage,"actualRendererIpc":true,"syntheticOnly":true,
                "initialChildPid":pid,"hostPid":std::process::id(),
                "initialEpochSha256":format!("{:x}",sha2::Sha256::digest(epoch.as_bytes())),
                "sessionSha256":format!("{:x}",sha2::Sha256::digest(session_id.as_bytes())),
                "atUnixMs":SystemTime::now().duration_since(UNIX_EPOCH)
                    .unwrap_or_default().as_millis() as u64,
            }),
        )
    }

    #[tauri::command]
    fn lm11_acceptance_report(
        app: tauri::AppHandle,
        state: tauri::State<'_, Arc<Acceptance>>,
        report: Value,
    ) -> Result<(), String> {
        let mut recorded = state
            .report_written
            .lock()
            .map_err(|_| "Report lock unavailable")?;
        if *recorded {
            return Err("Duplicate acceptance report".into());
        }
        let data = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let local = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let app_data_contained = data == state.root.join("data")
            && local.starts_with(&state.root)
            && local != state.root;
        let observed = state
            .observed
            .lock()
            .map_err(|_| "IPC trace lock unavailable")?;
        let mut counts = BTreeMap::<String, usize>::new();
        for (name, _, _) in observed.iter() {
            *counts.entry(name.clone()).or_default() += 1;
        }
        let cancel_ids: Vec<_> = observed
            .iter()
            .filter(|row| row.0 == "ai_http_cancel")
            .map(|row| json!({"requestId":row.1,"origin":row.2}))
            .collect();
        let streamed_ids: Vec<_> = observed
            .iter()
            .filter(|row| row.0 == "ai_http_stream")
            .map(|row| row.1.clone())
            .collect();
        let opened = *counts.get("ai_http_open").unwrap_or(&0);
        let canceled = *counts.get("ai_http_cancel").unwrap_or(&0);
        let streamed = *counts.get("ai_http_stream").unwrap_or(&0);
        let explicit = report["negative"].as_array().is_some_and(|rows| {
            rows.iter().any(|row| {
                row["name"] == "exact-id-cancel"
                    && row["settled"] == true
                    && cancel_ids.iter().any(|event| {
                        event["requestId"] == row["requestId"] && event["origin"] == "parent-signal"
                    })
            })
        });
        let expected_outcome = match state.scenario.as_str() {
            "normal"
            | "stop-after-terminal"
            | "duplicate-ticket"
            | "restart-acknowledged"
            | "corrupt-settings"
            | "read-only-settings" => "synthetic-chat-transport-only",
            "cancel-exact-id" | "stop-after-open" => "ipc-cancel-verified",
            "preflight-deny" => "preflight-denied",
            "wrong-secret" => "authenticated-negative-verified",
            "wrong-deployment" | "wrong-epoch" | "wrong-pid" => "native-route-rejected",
            "service-death" => "owned-service-stopped",
            "stale-runtime-epoch" => "stale-epoch-rejected",
            "timeout-before-admission" => "deadline-admission-rejected",
            "timeout-during-preparation" => "deadline-prepare-rejected",
            "stop-before-open" => "pre-registration-stop-denied",
            "stop-during-stream" => "active-native-cancelled",
            "wrong-model-alias" => "synthetic-model-denied",
            "wrong-provider-auth" => "synthetic-auth-denied",
            "concurrent-owner-cancel" => "independent-native-owners",
            "deadline-bounded" => "real-aggregate-deadline-rejected",
            "post-terminal-channel-callback" => "post-terminal-real-channel-observed",
            "post-cancel-channel-callback" => "post-cancel-real-channel-observed",
            "post-cancel-original-lm2f-channel" => "original-lm2f-cancel-late-boundary-observed",
            "original-duplicate-terminal" => "original-duplicate-terminal-fenced",
            "original-postdeadline-provider-events" => {
                "original-postdeadline-upstream-events-fenced"
            }
            "original-abc-native-isolation" => "original-a-b-c-native-cancel-isolated",
            "original-managed-abc-deployments" => "original-three-deployment-native-isolation",
            "original-native-quiescence-failure" => "original-native-quiescence-failed",
            "original-late-cancel-ack" => "original-native-cancel-ack-post-terminal-fenced",
            "genuine-child-restart" => "owned-pid-epoch-restarted",
            "stale-cross-child-restart" => "stale-cross-restart-fenced",
            "stale-original-qualification-child-restart" => {
                "original-qualification-cross-child-callback-fenced"
            }
            "stage-reachability" => "original-qualification-stage-reached-and-resumed",
            "stage-expiry" => "original-qualification-stage-expired-no-retroactive-pass",
            "stage-cancel" => "original-qualification-stage-cancelled-no-retroactive-pass",
            "stage-stale-epoch" => "original-old-epoch-b03-denied",
            "stage-corrupt" => "original-b03-recovery-required",
            "stage-conflict" => "original-qualification-real-cas-conflict-no-effect",
            "stage-concurrent" => "original-first-qualification-preserved-second-denied",
            "runtime-transport" => "runtime-fault-observed",
            "original-runtime-fault"
                if state.runtime_scenario.as_deref() == Some("malformed-stream-frame")
                    || state.runtime_scenario.as_deref() == Some("evidence-rejection") =>
            {
                "original-qualification-negative-receipts"
            }
            "original-runtime-fault" => "original-qualification-runtime-fault-rejected",
            _ => "unknown-not-implemented",
        };
        let qualifying = matches!(
            state.scenario.as_str(),
            "normal"
                | "stop-after-terminal"
                | "duplicate-ticket"
                | "restart-acknowledged"
                | "corrupt-settings"
                | "read-only-settings"
                | "stage-reachability"
                | "stage-concurrent"
                | "original-duplicate-terminal"
        );
        let snapshot = settings::self_hosted_profiles_snapshot(app.clone());
        let corrupted_snapshot_unreadable = state.scenario == "stage-corrupt" && snapshot.is_err();
        let corruption_at_report = if state.scenario == "stage-corrupt" {
            let marker = state.root.join("corrupt-authority-fault.json");
            let v: Option<Value> = fs::read(marker)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok());
            let current = fs::read(state.root.join("data").join(SETTING)).ok();
            v.as_ref().is_some_and(|fault| {
                fault["authoritativeExistsAfter"] == current.is_some()
                    && fault["authoritativeSha256After"].as_str()
                        == current
                            .as_ref()
                            .map(|bytes| format!("{:x}", sha2::Sha256::digest(bytes)))
                            .as_deref()
            })
        } else {
            false
        };
        let receipts = (if state.scenario == "stage-corrupt" {
            snapshot.unwrap_or_default()
        } else {
            snapshot?
        })
        .into_iter()
        .find(|(name, _)| name == "selfHostedInference")
        .and_then(|(_, v)| v["fabric"]["qualificationReceipts"].as_array().cloned())
        .unwrap_or_default();
        // An SDK malformed-frame error is a real error stream part, not
        // necessarily a rejected Chat Promise. Production LM2F may commit four
        // explicitly NEGATIVE version-2 receipts. This is distinct from a B03
        // qualification PASS, and allowed ONLY for the original malformed case.
        let original_negative_mode = state.scenario == "original-runtime-fault"
            && state.runtime_scenario.as_deref() == Some("malformed-stream-frame");
        let original_evidence_mode = state.scenario == "original-runtime-fault"
            && state.runtime_scenario.as_deref() == Some("evidence-rejection");
        let negative_receipts_exact = original_negative_mode && {
            let proof = &report["native"]["originalRuntimeFault"];
            let reference = proof["originalResultRequestId"].as_str();
            let current_native = state.initial_binding.lock().ok().and_then(|v| v.clone());
            let owners: std::collections::BTreeSet<_> = receipts
                .iter()
                .map(|row| {
                    (
                        row["qualificationCas"]["operationId"]
                            .as_str()
                            .unwrap_or(""),
                        row["qualificationCas"]["nativeEpoch"]
                            .as_str()
                            .unwrap_or(""),
                    )
                })
                .collect();
            let capabilities: std::collections::BTreeSet<_> = receipts
                .iter()
                .filter_map(|row| row["capability"].as_str())
                .collect();
            receipts.len() == 4
                && owners.len() == 1
                && owners.iter().all(|(id, epoch)| {
                    id.len() == 32
                        && epoch.len() == 32
                        && id.bytes().all(|b| b.is_ascii_hexdigit())
                        && epoch.bytes().all(|b| b.is_ascii_hexdigit())
                })
                && capabilities
                    == [
                        "chat",
                        "streaming",
                        "terminal-completion",
                        "instruction-adherence",
                    ]
                    .into_iter()
                    .collect()
                && reference.is_some_and(|id| {
                    id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
                })
                && current_native.as_ref().is_some_and(|(epoch, pid)| {
                    receipts.iter().all(|row| {
                        row["scope"]["runtimeEpoch"] == *epoch
                            && row["scope"]["runtimeProcessIdentity"] == format!("pid:{pid}")
                    })
                })
                && receipts.iter().all(|row| {
                    let (status, check, source, procedure) = match row["capability"].as_str() {
                        Some("chat") => (
                            "failed",
                            "complete-chat-text",
                            "clack-transport",
                            "clack-managed-chat-bounded",
                        ),
                        Some("streaming") => (
                            "failed",
                            "stream-deltas",
                            "clack-transport",
                            "clack-managed-chat-bounded",
                        ),
                        Some("terminal-completion") => (
                            "failed",
                            "terminal-stop",
                            "clack-transport",
                            "clack-managed-chat-bounded",
                        ),
                        Some("instruction-adherence") => (
                            "incomplete",
                            "terminal-stop",
                            "deterministic-evaluator",
                            "clack-instruction-adherence",
                        ),
                        _ => return false,
                    };
                    row["version"] == 2
                        && row["status"] == status
                        && row["qualificationCas"]["phase"] == "acknowledged"
                        && row["scope"]["artifactDigest"] == state.digest
                        && row["scope"]["artifactFormat"] == "gguf"
                        && row["scope"]["runtimeId"] == "clack-managed-llama.cpp"
                        && row["scope"]["runtimeType"] == "clack-managed-llama.cpp"
                        && row["scope"]["deploymentId"]
                            .as_str()
                            .is_some_and(|id| !id.is_empty())
                        && row["scope"] == receipts[0]["scope"]
                        && row["procedure"]["id"] == procedure
                        && row["procedure"]["version"] == 1
                        && row["evidence"]["source"] == source
                        && row["evidence"]["reference"].as_str() == reference
                        && row["evidence"]["checks"].as_array().is_some_and(|checks| {
                            checks.len() == 1
                                && checks[0]["id"] == check
                                && checks[0]["result"]
                                    == if status == "incomplete" {
                                        "incomplete"
                                    } else {
                                        "fail"
                                    }
                        })
                        && row["verifiedAt"]
                            .as_u64()
                            .zip(row["expiresAt"].as_u64())
                            .is_some_and(|(start, end)| end > start && end - start <= 86_400_000)
                })
        };
        let nonadherent_receipts_exact = original_evidence_mode && {
            let proof = &report["native"]["originalRuntimeFault"];
            let reference = proof["originalResultRequestId"].as_str();
            let owners: std::collections::BTreeSet<_> = receipts
                .iter()
                .map(|row| {
                    (
                        row["qualificationCas"]["operationId"]
                            .as_str()
                            .unwrap_or(""),
                        row["qualificationCas"]["nativeEpoch"]
                            .as_str()
                            .unwrap_or(""),
                    )
                })
                .collect();
            let capabilities: std::collections::BTreeSet<_> = receipts
                .iter()
                .filter_map(|row| row["capability"].as_str())
                .collect();
            receipts.len() == 4
                && owners.len() == 1
                && owners.iter().all(|(id, epoch)| {
                    id.len() == 32
                        && epoch.len() == 32
                        && id.bytes().all(|b| b.is_ascii_hexdigit())
                        && epoch.bytes().all(|b| b.is_ascii_hexdigit())
                })
                && capabilities
                    == [
                        "chat",
                        "streaming",
                        "terminal-completion",
                        "instruction-adherence",
                    ]
                    .into_iter()
                    .collect()
                && reference.is_some_and(|id| {
                    id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
                })
                && receipts.iter().all(|row| {
                    let adherence = row["capability"] == "instruction-adherence";
                    row["version"] == 2
                        && row["status"] == if adherence { "failed" } else { "verified" }
                        && row["qualificationCas"]["phase"] == "acknowledged"
                        && row["scope"] == receipts[0]["scope"]
                        && row["scope"]["artifactDigest"] == state.digest
                        && row["evidence"]["reference"].as_str() == reference
                        && row["evidence"]["source"]
                            == if adherence {
                                "deterministic-evaluator"
                            } else {
                                "clack-transport"
                            }
                        && row["evidence"]["checks"].as_array().is_some_and(|checks| {
                            checks.len() == 1
                                && checks[0]["result"] == if adherence { "fail" } else { "pass" }
                        })
                })
        };
        let durable_exact = if qualifying {
            let ids: std::collections::BTreeSet<_> = receipts
                .iter()
                .map(|r| {
                    (
                        r["qualificationCas"]["operationId"].as_str().unwrap_or(""),
                        r["qualificationCas"]["nativeEpoch"].as_str().unwrap_or(""),
                    )
                })
                .collect();
            let caps: std::collections::BTreeSet<_> = receipts
                .iter()
                .filter_map(|r| r["capability"].as_str())
                .collect();
            receipts.len() == 4
                && ids.len() == 1
                && ids
                    .iter()
                    .all(|(op, epoch)| op.len() == 32 && epoch.len() == 32)
                && caps
                    == [
                        "chat",
                        "streaming",
                        "terminal-completion",
                        "instruction-adherence",
                    ]
                    .into_iter()
                    .collect()
                && receipts.iter().all(|r| {
                    r["version"] == 2
                        && r["status"] == "verified"
                        && r["qualificationCas"]["phase"] == "acknowledged"
                        && r["evidence"]["source"]
                            == if r["capability"] == "instruction-adherence" {
                                "deterministic-evaluator"
                            } else {
                                "clack-transport"
                            }
                })
        } else if state.scenario == "original-managed-abc-deployments" {
            // The only qualifying effects come from TWO genuine original Chat
            // operations on independent B/C native deployments, not direct HTTP
            // or the cancelled original A. Native ACK markers stay distinct.
            let proof = &report["native"]["managedABC"];
            let bindings = state.abc_bindings.lock().ok();
            let ids = [
                proof["originalBDeploymentId"].as_str().unwrap_or(""),
                proof["originalCDeploymentId"].as_str().unwrap_or(""),
            ];
            let sibling_slots = ["b", "c"];
            let scopes = ids
                .iter()
                .zip(sibling_slots.iter())
                .all(|(deployment, slot)| {
                    if deployment.is_empty() {
                        return false;
                    }
                    let binding = bindings.as_ref().and_then(|b| b.get(*slot));
                    let epoch = binding.and_then(|b| b["epoch"].as_str());
                    let pid = binding.and_then(|b| b["pid"].as_u64());
                    let owned: Vec<_> = receipts
                        .iter()
                        .filter(|row| row["scope"]["deploymentId"].as_str() == Some(*deployment))
                        .collect();
                    let tickets: std::collections::BTreeSet<_> = owned
                        .iter()
                        .map(|row| {
                            (
                                row["qualificationCas"]["operationId"]
                                    .as_str()
                                    .unwrap_or(""),
                                row["qualificationCas"]["nativeEpoch"]
                                    .as_str()
                                    .unwrap_or(""),
                            )
                        })
                        .collect();
                    let caps: std::collections::BTreeSet<_> = owned
                        .iter()
                        .filter_map(|row| row["capability"].as_str())
                        .collect();
                    owned.len() == 4
                        && tickets.len() == 1
                        && tickets
                            .iter()
                            .all(|(op, epoch)| op.len() == 32 && epoch.len() == 32)
                        && caps
                            == [
                                "chat",
                                "streaming",
                                "terminal-completion",
                                "instruction-adherence",
                            ]
                            .into_iter()
                            .collect()
                        && owned.iter().all(|row| {
                            row["version"] == 2
                                && row["status"] == "verified"
                                && row["qualificationCas"]["phase"] == "acknowledged"
                                && row["scope"]["runtimeEpoch"].as_str() == epoch
                                && row["scope"]["runtimeProcessIdentity"].as_str()
                                    == pid.map(|p| format!("pid:{p}")).as_deref()
                                && row["evidence"]["source"]
                                    == if row["capability"] == "instruction-adherence" {
                                        "deterministic-evaluator"
                                    } else {
                                        "clack-transport"
                                    }
                        })
                });
            let a_deployment = bindings.as_ref().and_then(|b| b.get("a2"));
            receipts.len() == 8
                && scopes
                && ids[0] != ids[1]
                && a_deployment.as_ref().is_some_and(|a2| {
                    a2["pid"] == proof["newA2Pid"] && a2["epoch"] == proof["newA2Epoch"]
                })
                && !receipts
                    .iter()
                    .any(|r| r["scope"]["deploymentId"] == proof["originalADeploymentId"])
                && proof["exactlyEightOriginalQualificationReceipts"] == true
                && proof["exactTwoSeparateAcknowledgedTicketGroups"] == true
        } else if original_negative_mode {
            negative_receipts_exact
        } else if original_evidence_mode {
            nonadherent_receipts_exact
        } else if state.scenario == "stage-corrupt" {
            let proof = &report["native"]["stageBarrier"];
            let main = state.root.join("data").join(SETTING);
            let original = state.root.join("forensic-original-authority-before.json");
            let fault = state.root.join("corrupt-authority-fault.json");
            let observed: Option<Value> = fs::read(&fault)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok());
            // A corrupt authoritative state may be unreadable to the real native
            // snapshot. Never replace the failure with an invented empty map as a
            // qualifying fact: require physical before bytes, after SHA and
            // original negative result at the exact held original CAS ticket.
            corruption_at_report
                && proof["originalRecoveryRequired"] == true
                && proof["noQualifyingReceipt"] == true
                && proof["forensicEvidencePreserved"] == true
                && original.is_file()
                && observed.as_ref().is_some_and(|v| {
                    v["actualNativePreparedTicket"] == true
                        && v["originalPreparedRows"] == 4
                        && v["forensicOriginalPreserved"] == true
                })
                && (corrupted_snapshot_unreadable
                    || receipts.iter().all(|row| {
                        row["version"] != 2 || row["qualificationCas"]["phase"] != "acknowledged"
                    }))
                && observed
                    .as_ref()
                    .is_some_and(|v| v["authoritativeExistsAfter"] == main.is_file())
        } else if matches!(
            state.scenario.as_str(),
            "stage-expiry" | "stage-cancel" | "stage-stale-epoch"
        ) {
            // A genuine B03 ACK can precede the readback barrier. A 120s expired
            // caller is NOT a durable rollback guarantee, and a pending v0 CAS
            // row is not an acknowledged qualification. Both remain distinguishable.
            let stage = std::env::var(STAGE_BARRIER_ENV).ok();
            if receipts.is_empty() {
                true
            } else if receipts.len() == 4
                && matches!(
                    stage.as_deref(),
                    Some(
                        "b03-before-prepare"
                            | "b03-before-acknowledge"
                            | "b03-before-readback"
                            | "b03-native-ack-response"
                    )
                )
            {
                let owners: std::collections::BTreeSet<_> = receipts
                    .iter()
                    .map(|row| {
                        (
                            row["qualificationCas"]["operationId"]
                                .as_str()
                                .unwrap_or(""),
                            row["qualificationCas"]["nativeEpoch"]
                                .as_str()
                                .unwrap_or(""),
                        )
                    })
                    .collect();
                let phases: std::collections::BTreeSet<_> = receipts
                    .iter()
                    .map(|row| row["qualificationCas"]["phase"].as_str().unwrap_or(""))
                    .collect();
                let acknowledged = phases == ["acknowledged"].into_iter().collect();
                let pending = phases == ["pending"].into_iter().collect();
                owners.len() == 1
                    && owners
                        .iter()
                        .all(|(op, ep)| op.len() == 32 && ep.len() == 32)
                    && receipts
                        .iter()
                        .all(|row| row["version"] == if acknowledged { 2 } else { 0 })
                    && (pending
                        || (matches!(
                            stage.as_deref(),
                            Some("b03-before-readback" | "b03-native-ack-response")
                        ) && acknowledged))
            } else {
                false
            }
        } else {
            receipts.is_empty()
        };
        ensure_safe_leaf(&state.root, &state.root.join("service-events.jsonl"))?;
        let service_events: Vec<Value> =
            fs::read_to_string(state.root.join("service-events.jsonl"))
                .unwrap_or_default()
                .lines()
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .collect();
        let http_count = |route: &str, status: u16| {
            service_events
                .iter()
                .filter(|v| v["route"] == route && v["status"] == status)
                .count()
        };
        let successful_synthetic_post = http_count("/v1/chat/completions", 200);
        let has_negative = |name: &str| {
            report["negative"]
                .as_array()
                .is_some_and(|rows| rows.iter().any(|row| row["name"] == name))
        };
        let runtime_mode = state.runtime_scenario.as_deref();
        let real_restart = state.restarted_binding.lock().ok().and_then(|v| v.clone());
        let real_initial = state.initial_binding.lock().ok().and_then(|v| v.clone());
        let actual_restart = real_restart
            .as_ref()
            .zip(real_initial.as_ref())
            .is_some_and(|((new_epoch, new_pid, new_port), (old_epoch, old_pid))| {
                new_epoch.len() == 64
                    && old_epoch.len() == 64
                    && new_epoch != old_epoch
                    && new_pid != old_pid
                    && *new_port != 0
                    && report["native"]["restart"]["newEpoch"] == *new_epoch
                    && report["native"]["restart"]["newPid"] == *new_pid
                    && report["native"]["restart"]["oldEpoch"] == *old_epoch
                    && report["native"]["restart"]["oldPid"] == *old_pid
                    && report["native"]["restart"]["oldBearerRejected"] == true
            });
        let runtime_marker_matches = runtime_mode.is_some_and(|mode| {
            fs::read(state.root.join("runtime-active.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .is_some_and(|v| v["runtimeScenario"] == mode && v["syntheticOnly"] == true)
        });
        let runtime_report_matches = runtime_mode.is_some_and(|mode| {
            report["runtimeChecks"]["mode"] == mode
                && report["runtimeChecks"]["noModel"] == true
                && report["runtimeChecks"]["exactService"] == true
                && runtime_marker_matches
        });
        let has_runtime_step = |step: &str| {
            service_events.iter().any(|v| {
                v["phase"] == step && runtime_mode.is_some_and(|mode| v["runtimeScenario"] == mode)
            })
        };
        let runtime_observed = runtime_report_matches
            && match runtime_mode {
                Some("authenticated-readiness-success") => {
                    report["runtimeChecks"]["ready"] == true && streamed == 0
                }
                Some("delayed-readiness") => {
                    has_runtime_step("health-delay-start")
                        && has_runtime_step("health-delay-finished")
                        && streamed == 0
                }
                Some("authenticated-health-failure") => {
                    http_count("/health", 503) >= 1
                        && has_negative("route-after-503")
                        && streamed == 0
                }
                Some("cancel-before-registration") => {
                    has_negative("pre-registration-cancel")
                        && report["runtimeChecks"]["zeroLateDispatch"] == true
                        && streamed == 0
                }
                Some("cancel-immediately-after-registration") => {
                    report["runtimeChecks"]["cancelAcknowledged"] == true
                        && canceled >= 2
                        && streamed == 0
                }
                Some("registration-after-renderer-cancellation") => {
                    report["runtimeChecks"]["lateIdCancelled"] == true
                        && canceled >= 2
                        && opened >= 2
                        && streamed == 0
                }
                Some("request-admission-failure") => {
                    report["runtimeChecks"]["error"] == "invalid-capacity"
                        && streamed == 1
                        && successful_synthetic_post == 0
                }
                Some("deterministic-streaming-response" | "terminal-completion") => {
                    report["runtimeChecks"]["terminal"] == "completed"
                        && successful_synthetic_post == 1
                }
                Some("delayed-request-acceptance") => {
                    has_runtime_step("request-acceptance-delay-finished")
                        && successful_synthetic_post == 1
                }
                Some("delayed-first-stream-event") => {
                    has_runtime_step("first-frame-delay-finished") && successful_synthetic_post == 1
                }
                Some("delayed-terminal-event") => {
                    has_runtime_step("terminal-delay-finished") && successful_synthetic_post == 1
                }
                Some("never-terminal-until-cancellation") => {
                    has_runtime_step("terminal-deliberately-withheld")
                        && report["runtimeChecks"]["terminal"] == "cancelled"
                }
                Some("cancel-during-streaming") => {
                    report["runtimeChecks"]["terminal"] == "cancelled" && canceled >= 2
                }
                Some("delayed-cancellation-ack" | "cancellation-ack-failure") => {
                    let marker = state.root.join("cancel-ack-fault.json");
                    let armed = ensure_safe_leaf(&state.root, &marker).is_ok()
                        && fs::read(&marker)
                            .ok()
                            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                            .is_some_and(|fault| {
                                fault["syntheticOnly"] == true
                                    && fault["runtimeScenario"] == runtime_mode.unwrap_or("")
                                    && fault["hostPid"] == std::process::id()
                                    && fault["requestId"] == report["runtimeChecks"]["requestId"]
                                    && report["negative"].as_array().is_some_and(|entries| {
                                        entries.iter().any(|entry| {
                                            entry["name"] == "exact-id-cancel"
                                                && entry["requestId"] != fault["requestId"]
                                        })
                                    })
                            });
                    armed
                        && report["runtimeChecks"]["terminal"] == "cancelled"
                        && canceled >= 2
                        && match runtime_mode {
                            Some("delayed-cancellation-ack") => {
                                report["runtimeChecks"]["cancelAckMs"]
                                    .as_u64()
                                    .is_some_and(|ms| ms >= 240)
                                    && report["runtimeChecks"]["cancelAckFailed"] == false
                            }
                            Some("cancellation-ack-failure") => {
                                report["runtimeChecks"]["cancelAckFailed"] == true
                            }
                            _ => false,
                        }
                }
                Some("late-stream-event-after-cancellation") => {
                    has_runtime_step("late-frame-attempt-after-cancel")
                        && report["runtimeChecks"]["lateFrameRejected"] == true
                }
                Some("transport-failure") => {
                    has_runtime_step("disconnect-before-http-headers")
                        && report["runtimeChecks"]["terminal"]
                            .as_str()
                            .is_some_and(|p| matches!(p, "failed" | "disconnected"))
                }
                Some("malformed-stream-frame") => {
                    has_runtime_step("malformed-sse-emitted")
                        && report["runtimeChecks"]["malformedBytesDelivered"] == true
                }
                Some("terminal-error") => {
                    http_count("/v1/chat/completions", 500) == 1
                        && report["runtimeChecks"]["httpStatus"] == 500
                }
                Some("connection-close-without-terminal") => {
                    has_runtime_step("stream-closed-without-terminal")
                        && report["runtimeChecks"]["terminal"]
                            .as_str()
                            .is_some_and(|p| matches!(p, "failed" | "disconnected"))
                }
                Some("first-output-after-aggregate-deadline") => {
                    report["runtimeChecks"]["noOutputAfterDeadline"] == true
                        && report["runtimeChecks"]["terminal"] == "cancelled"
                }
                Some("terminal-callback-after-deadline") => {
                    has_runtime_step("terminal-delay-start")
                        && report["runtimeChecks"]["noCompletedTerminalAfterDeadline"] == true
                }
                Some("cancellation-terminal-race") => {
                    has_runtime_step("terminal-delay-start")
                        && report["runtimeChecks"]["terminal"]
                            .as_str()
                            .is_some_and(|p| matches!(p, "completed" | "cancelled"))
                }
                Some("runtime-epoch-change-mid-request") => {
                    counts.get("lm11_acceptance_rotate_epoch").copied() == Some(1)
                        && report["runtimeChecks"]["staleNativeEpochRejected"] == true
                }
                Some("runtime-process-exits-mid-request") => {
                    counts.get("lm11_acceptance_stop_service").copied() == Some(1)
                        && report["runtimeChecks"]["processReaped"] == true
                }
                _ => false,
            };
        let original_runtime_observed = runtime_mode.is_some_and(|mode| {
            let proof = &report["native"]["originalRuntimeFault"];
            let health_failure = matches!(
                mode,
                "authenticated-health-failure" | "authenticated-model-identity-failure"
            );
            let original_id = proof["exactOriginalRequestId"].as_str();
            let original_session = proof["originalSessionId"].as_str();
            let native_identity = if health_failure {
                original_id.is_none()
                    && proof["originalNativeOpenCount"] == 0
                    && opened == 1
                    && streamed == 0
            } else {
                original_id.is_some_and(|id| {
                    id.starts_with("inference-")
                        && id[10..].bytes().all(|byte| byte.is_ascii_digit())
                        && streamed_ids.len() == 1
                        && streamed_ids[0].as_deref() == Some(id)
                }) && proof["originalNativeOpenCount"] == 1
                    && opened == 2
                    && streamed == 1
                    && proof["actualOriginalChannelEvents"]
                        .as_array()
                        .is_some_and(|events| !events.is_empty())
            };
            let expected_phase = match mode {
                "authenticated-health-failure" | "authenticated-model-identity-failure" => {
                    proof["originalRejectionPhase"] == "native-status"
                }
                "evidence-rejection" => {
                    proof["originalRejectionPhase"] == "persisted-chat-evidence"
                }
                "malformed-stream-frame" | "connection-close-without-terminal" => {
                    matches!(
                        proof["originalRejectionPhase"].as_str(),
                        Some("bounded-request" | "native-quiescence" | "persisted-chat-evidence")
                    )
                }
                "transport-failure" | "terminal-error" => {
                    matches!(
                        proof["originalRejectionPhase"].as_str(),
                        Some("bounded-request" | "native-quiescence")
                    )
                }
                "request-admission-failure" => {
                    matches!(
                        proof["originalRejectionPhase"].as_str(),
                        Some("bounded-request" | "native-quiescence")
                    )
                }
                _ => false,
            };
            let requested_fault = match mode {
                "authenticated-health-failure" => http_count("/health", 503) >= 1,
                "authenticated-model-identity-failure" => {
                    http_count("/health", 200) >= 1
                        && http_count("/v1/models", 200) >= 1
                        && has_runtime_step("authenticated-wrong-model-identity")
                }
                "transport-failure" => has_runtime_step("disconnect-before-http-headers"),
                "request-admission-failure" => {
                    let fault = state.root.join("original-request-admission-fault.json");
                    ensure_safe_leaf(&state.root, &fault).is_ok()
                        && fs::read(fault)
                            .ok()
                            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                            .is_some_and(|v| {
                                v["syntheticOnly"] == true
                                    && v["nativeRegisteredBeforeInvalidAdmission"] == true
                                    && v["actualProductionHandlerUnchanged"] == true
                                    && v["fault"] == "invalid-capacity"
                                    && v["requestId"] == proof["exactOriginalRequestId"]
                                    && v["sessionId"] == proof["originalSessionId"]
                                    && v["hostPid"] == std::process::id()
                            })
                }
                "terminal-error" => {
                    http_count("/v1/chat/completions", 500) == 1
                        && http_count("/v1/chat/completions", 200) == 0
                }
                "malformed-stream-frame" => {
                    has_runtime_step("malformed-sse-emitted")
                        && http_count("/v1/chat/completions", 200) == 1
                }
                "connection-close-without-terminal" => {
                    has_runtime_step("stream-closed-without-terminal")
                        && http_count("/v1/chat/completions", 200) == 1
                }
                "evidence-rejection" => {
                    has_runtime_step("oversized-evidence-emitted")
                        && http_count("/v1/chat/completions", 200) == 1
                }
                _ => false,
            };
            let chat_posts = service_events
                .iter()
                .filter(|row| {
                    row["route"] == "/v1/chat/completions" && row["status"].as_u64().is_some()
                })
                .count();
            runtime_marker_matches
                && counts.get("lm11_acceptance_runtime_activate").copied() == Some(1)
                && proof["mode"] == mode
                && proof["originalProductionRunner"] == true
                && proof["originalCallerRejected"] == true
                && proof["originalCallerSucceeded"] == false
                && proof["noModel"] == true
                && proof["nativeSessionDrained"] == true
                && proof["noAdditionalNativeRequest"] == true
                && proof["noB03CallsOrReceipts"] == true
                && proof["noFlightViolations"] == true
                && original_session
                    .is_some_and(|id| !id.is_empty() && id.len() <= 96 && id.is_ascii())
                && native_identity
                && expected_phase
                && requested_fault
                && chat_posts
                    == if matches!(
                        mode,
                        "authenticated-health-failure"
                            | "authenticated-model-identity-failure"
                            | "transport-failure"
                            | "request-admission-failure"
                    ) {
                        0
                    } else {
                        1
                    }
                && [
                    "self_hosted_profiles_qualification_begin",
                    "self_hosted_profiles_qualification_prepare",
                    "self_hosted_profiles_qualification_acknowledge",
                    "self_hosted_profiles_qualification_cancel",
                    "self_hosted_profiles_qualification_reconcile",
                ]
                .iter()
                .all(|command| counts.get(*command).copied().unwrap_or(0) == 0)
                && receipts.is_empty()
        });
        let original_runtime_negative_observed = original_negative_mode && {
            let proof = &report["native"]["originalRuntimeFault"];
            let original_id = proof["exactOriginalRequestId"].as_str();
            runtime_marker_matches
                && negative_receipts_exact
                && proof["mode"] == "malformed-stream-frame"
                && proof["originalProductionRunner"] == true
                && proof["originalCallerRejected"] == false
                && proof["originalCallerResolved"] == true
                && proof["originalCallerSucceeded"] == true
                && proof["originalReturnedNegativeVerdict"] == true
                && proof["noQualificationGranted"] == true
                && proof["negativeReceiptsAcknowledged"] == true
                && proof["negativeReceiptCount"] == 4
                && proof["originalRejectionPhase"].is_null()
                && proof["noB03CallsOrReceipts"] == false
                && proof["nativeSessionDrained"] == true
                && proof["noAdditionalNativeRequest"] == true
                && proof["noFlightViolations"] == true
                && proof["noModel"] == true
                && proof["originalNativeOpenCount"] == 1
                && proof["originalSessionId"]
                    .as_str()
                    .is_some_and(|id| !id.is_empty() && id.len() <= 96 && id.is_ascii())
                && proof["originalCapabilityStatuses"]
                    == json!({
                        "chat":"failed", "streaming":"failed",
                        "terminal-completion":"failed", "instruction-adherence":"incomplete",
                    })
                && original_id.is_some_and(|id| {
                    id.starts_with("inference-")
                        && id.len() > 10
                        && id[10..].bytes().all(|b| b.is_ascii_digit())
                        && streamed_ids.len() == 1
                        && streamed_ids[0].as_deref() == Some(id)
                        && cancel_ids.iter().any(|row| {
                            row["requestId"] == id && row["origin"] == "provider-retry-error"
                        })
                })
                && proof["actualOriginalChannelEvents"]
                    .as_array()
                    .is_some_and(|events| {
                        !events.is_empty() && events.iter().all(|event| event["kind"].is_string())
                    })
                && has_runtime_step("malformed-sse-emitted")
                && http_count("/v1/chat/completions", 200) == 1
                && successful_synthetic_post == 1
                && opened == 2
                && streamed == 1
                && canceled == 2
                && counts.get("lm11_acceptance_runtime_activate").copied() == Some(1)
                && counts
                    .get("self_hosted_profiles_qualification_begin")
                    .copied()
                    == Some(1)
                && counts
                    .get("self_hosted_profiles_qualification_prepare")
                    .copied()
                    == Some(1)
                && counts
                    .get("self_hosted_profiles_qualification_acknowledge")
                    .copied()
                    == Some(1)
                && counts
                    .get("self_hosted_profiles_qualification_cancel")
                    .copied()
                    .unwrap_or(0)
                    == 0
                && counts
                    .get("self_hosted_profiles_qualification_reconcile")
                    .copied()
                    .unwrap_or(0)
                    == 0
        };
        let original_evidence_observed = original_evidence_mode && {
            let proof = &report["native"]["originalRuntimeFault"];
            let original_id = proof["exactOriginalRequestId"].as_str();
            runtime_marker_matches
                && nonadherent_receipts_exact
                && proof["mode"] == "evidence-rejection"
                && proof["originalProductionRunner"] == true
                && proof["originalCallerRejected"] == false
                && proof["originalCallerResolved"] == true
                && proof["originalCallerSucceeded"] == true
                && proof["originalReturnedNegativeVerdict"] == true
                && proof["noQualificationGranted"] == true
                && proof["negativeReceiptsAcknowledged"] == true
                && proof["negativeReceiptCount"] == 4
                && proof["originalRejectionPhase"].is_null()
                && proof["noB03CallsOrReceipts"] == false
                && proof["nativeSessionDrained"] == true
                && proof["noAdditionalNativeRequest"] == true
                && proof["noFlightViolations"] == true
                && proof["noModel"] == true
                && proof["originalNativeOpenCount"] == 1
                && proof["originalSessionId"]
                    .as_str()
                    .is_some_and(|id| !id.is_empty() && id.len() <= 96 && id.is_ascii())
                && proof["originalCapabilityStatuses"]
                    == json!({
                        "chat":"verified", "streaming":"verified",
                        "terminal-completion":"verified", "instruction-adherence":"failed",
                    })
                && original_id.is_some_and(|id| {
                    id.starts_with("inference-")
                        && id.len() > 10
                        && id[10..].bytes().all(|b| b.is_ascii_digit())
                        && streamed_ids.len() == 1
                        && streamed_ids[0].as_deref() == Some(id)
                })
                && proof["actualOriginalChannelEvents"]
                    .as_array()
                    .is_some_and(|events| !events.is_empty())
                && has_runtime_step("protocol-valid-nonadherent-evidence-emitted")
                && has_runtime_step("synthetic-sse-done")
                && http_count("/v1/chat/completions", 200) == 1
                && successful_synthetic_post == 1
                && opened == 2
                && streamed == 1
                && counts.get("lm11_acceptance_runtime_activate").copied() == Some(1)
                && counts
                    .get("self_hosted_profiles_qualification_begin")
                    .copied()
                    == Some(1)
                && counts
                    .get("self_hosted_profiles_qualification_prepare")
                    .copied()
                    == Some(1)
                && counts
                    .get("self_hosted_profiles_qualification_acknowledge")
                    .copied()
                    == Some(1)
                && counts
                    .get("self_hosted_profiles_qualification_cancel")
                    .copied()
                    .unwrap_or(0)
                    == 0
                && counts
                    .get("self_hosted_profiles_qualification_reconcile")
                    .copied()
                    .unwrap_or(0)
                    == 0
        };
        let scenario_observed = match state.scenario.as_str() {
            "normal" | "restart-acknowledged" | "corrupt-settings" | "read-only-settings" => true,
            "duplicate-ticket" => {
                has_negative("duplicate-native-ticket")
                    && counts
                        .get("self_hosted_profiles_qualification_acknowledge")
                        .copied()
                        == Some(2)
                    && counts
                        .get("self_hosted_profiles_qualification_reconcile")
                        .copied()
                        == Some(1)
            }
            "stop-after-terminal" => {
                has_negative("stop-after-terminal")
                    && cancel_ids.iter().any(|v| v["origin"] == "settled-cleanup")
            }
            "cancel-exact-id" | "stop-after-open" => streamed == 0,
            "preflight-deny" => {
                has_negative("preflight-denied-no-http")
                    && streamed == 1
                    && successful_synthetic_post == 0
            }
            "wrong-secret" => http_count("/v1/models", 401) >= 2 && streamed == 0,
            "wrong-deployment" => has_negative("wrong-deployment") && streamed == 0,
            "wrong-epoch" => has_negative("wrong-epoch") && streamed == 0,
            "wrong-pid" => {
                has_negative("wrong-pid")
                    && counts
                        .get("self_hosted_profiles_qualification_begin")
                        .copied()
                        == Some(1)
            }
            "service-death" => {
                has_negative("route-after-service-death")
                    && counts.get("lm11_acceptance_stop_service").copied() == Some(1)
            }
            "stale-runtime-epoch" => {
                has_negative("stale-epoch-route")
                    && counts.get("lm11_acceptance_rotate_epoch").copied() == Some(1)
            }
            "timeout-before-admission" => {
                has_negative("expired-before-admission")
                    && counts
                        .get("self_hosted_profiles_qualification_begin")
                        .copied()
                        == Some(1)
            }
            "timeout-during-preparation" => {
                has_negative("expired-before-prepare")
                    && counts
                        .get("self_hosted_profiles_qualification_prepare")
                        .copied()
                        == Some(1)
            }
            "stop-before-open" => has_negative("pre-aborted-fetch") && opened == 1 && streamed == 0,
            "stop-during-stream" => {
                has_negative("stop-during-stream")
                    && successful_synthetic_post == 1
                    && streamed == 1
                    && cancel_ids.iter().any(|v| v["origin"] == "parent-signal")
            }
            "wrong-model-alias" => {
                has_negative("wrong-model-alias")
                    && http_count("/v1/chat/completions", 422) == 1
                    && streamed == 1
            }
            "wrong-provider-auth" => {
                has_negative("wrong-provider-auth")
                    && http_count("/v1/chat/completions", 401) == 1
                    && streamed == 1
            }
            "concurrent-owner-cancel" => {
                has_negative("concurrent-first-owner-cancelled")
                    && has_negative("preflight-denied-no-http")
                    && canceled >= 2
                    && streamed == 1
            }
            "genuine-child-restart" => {
                actual_restart
                    && report["native"]["restart"]["oldRouteRejected"] == true
                    && report["native"]["restart"]["newReadyAuthenticated"] == true
                    && counts.get("lm11_acceptance_restart_child").copied() == Some(1)
                    && counts.get("lm11_acceptance_stop_service").copied() == Some(1)
                    && successful_synthetic_post == 0
            }
            "deadline-bounded" => {
                let stage = state.deadline_stage.as_deref().unwrap_or("");
                let hit = state.root.join("deadline-stage-hit.json");
                let hit_matches = ensure_safe_leaf(&state.root, &hit).is_ok()
                    && fs::read(&hit)
                        .ok()
                        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                        .is_some_and(|value| {
                            value["stage"] == stage
                                && value["nativeBarrierEntered"] == true
                                && value["nativeDelayMs"] == 123500
                                && value["originalProductionCommand"].as_str().is_some_and(
                                    |command| {
                                        deadline_stage_matches(
                                            stage,
                                            command,
                                            matches!(
                                                stage,
                                                "persisted-chat-evidence"
                                                    | "native-revalidation"
                                                    | "cas-commit"
                                            ),
                                        )
                                    },
                                )
                        });
                hit_matches
                    && state.deadline_triggered.load(Ordering::SeqCst)
                    && report["native"]["deadline"]["selectedStage"] == stage
                    && report["native"]["deadline"]["originalFailurePhase"]
                        == format!("Bounded qualification unverified at {stage}")
                    && report["native"]["deadline"]["originalProductionRunner"] == true
                    && report["native"]["deadline"]["originalAggregateBudgetMs"] == 120000
                    && report["native"]["deadline"]["zeroDurableQualificationReceipts"] == true
                    && report["native"]["deadline"]["realElapsedMs"]
                        .as_u64()
                        .is_some_and(|elapsed| (119000..=175000).contains(&elapsed))
                    && counts
                        .get("self_hosted_profiles_qualification_acknowledge")
                        .copied()
                        .unwrap_or_default()
                        == 0
                    && successful_synthetic_post
                        == if matches!(
                            stage,
                            "persisted-chat-evidence" | "native-revalidation" | "cas-commit"
                        ) {
                            1
                        } else {
                            0
                        }
            }
            "post-terminal-channel-callback" | "post-cancel-channel-callback" => {
                let expected_phase = if state.scenario == "post-cancel-channel-callback" {
                    "cancelled"
                } else {
                    "completed"
                };
                let path = state.root.join("post-terminal-channel-send.json");
                let native_sent = ensure_safe_leaf(&state.root, &path).is_ok()
                    && fs::read(&path)
                        .ok()
                        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                        .is_some_and(|observed| {
                            observed["syntheticOnly"] == true
                                && observed["afterOriginalNativeSettled"] == true
                                && observed["afterOriginalLeaseDrop"] == true
                                && observed["scheduledAfterOriginalIpcHandler"] == true
                                && observed["testInjectedNotExternalSseParser"] == true
                                && observed["originalTerminalPhase"] == expected_phase
                                && observed["lateChunkNativeSendSucceeded"] == true
                                && observed["lateTerminalNativeSendSucceeded"] == true
                                && observed["requestId"]
                                    == report["native"]["lateChannel"]["requestId"]
                        });
                native_sent
                    && report["native"]["lateChannel"]["originalNativeTerminal"] == expected_phase
                    && report["native"]["lateChannel"]["nativeChannelOriginalSettledFirst"] == true
                    && report["native"]["lateChannel"]
                        ["actualRendererNativeOperationTerminatedBeforeLateCallbacks"]
                        == true
                    && report["native"]["lateChannel"]["testInjectedLateChunkDelivered"] == true
                    && report["native"]["lateChannel"]["testInjectedLateTerminalDelivered"] == true
                    && report["native"]["lateChannel"]["noQualificationPromotion"] == true
                    && report["native"]["lateChannel"]["nativeRequestIdIsExact"] == true
                    && counts.get("lm11_acceptance_arm_late_channel").copied() == Some(1)
                    && streamed == 1
                    && successful_synthetic_post == 1
            }
            "post-cancel-original-lm2f-channel" => {
                // This is the unchanged production Chat LM2F path, NOT the older
                // direct ai_http_stream late-Channel smoke case. The release must
                // be one-shot after that original runner rejected. No feature
                // command may acknowledge B03 or create a second native request.
                let release = state.root.join("post-cancel-lm2f-release.json");
                let release_owned = ensure_safe_leaf(&state.root, &release).is_ok()
                    && fs::read(&release)
                        .ok()
                        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                        .is_some_and(|v| {
                            v["scenario"] == state.scenario
                                && v["syntheticOnly"] == true
                                && v["originalLm2fRejected"] == true
                                && v["nativeTerminal"] == "cancelled"
                                && v["hostPid"] == std::process::id()
                                && v["noNativeRegistry"] == true
                                && v["noB03AckOrReceipts"] == true
                                && v["requestId"]
                                    == report["native"]["originalLm2fLate"]["requestId"]
                                && v["sessionId"]
                                    == report["native"]["originalLm2fLate"]["sessionId"]
                        });
                let sent = state.root.join("post-terminal-channel-send.json");
                let same_channel = ensure_safe_leaf(&state.root, &sent).is_ok()
                    && fs::read(&sent)
                        .ok()
                        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                        .is_some_and(|v| {
                            v["syntheticOnly"] == true
                                && v["testInjectedNotExternalSseParser"] == true
                                && v["afterOriginalNativeSettled"] == true
                                && v["afterOriginalLeaseDrop"] == true
                                && v["originalTerminalPhase"] == "cancelled"
                                && v["originalLm2fReleaseConfirmed"] == true
                                && v["oldNativeRegistryAbsentAtInjection"] == true
                                && v["releaseWaitBoundMs"] == 10000
                                && v["requestId"]
                                    == report["native"]["originalLm2fLate"]["requestId"]
                        });
                let boundary = report["native"]["originalLm2fLate"]["observedBoundary"].as_str();
                let grounded_boundary = matches!(
                    boundary,
                    Some("renderer-original-channel-callback-after-proxyfetch-noop")
                        | Some("tauri-original-channel-cleanup-before-late-injection")
                );
                release_owned
                && same_channel
                && grounded_boundary
                && report["native"]["originalLm2fLate"]["originalProductionRunner"] == true
                && report["native"]["originalLm2fLate"]["originalLm2fRejected"] == true
                && report["native"]["originalLm2fLate"]["originalNativeCancelled"] == true
                && report["native"]["originalLm2fLate"]["originalCancelSessionInference"] == true
                && report["native"]["originalLm2fLate"]["chatAndTaskUnchangedAfterLate"] == true
                && report["native"]["originalLm2fLate"]["zeroB03AckOrReceipts"] == true
                && report["native"]["originalLm2fLate"]["noRetroactiveSuccess"] == true
                && counts.get("lm11_acceptance_arm_late_channel").copied() == Some(1)
                && counts.get("lm11_acceptance_release_original_lm2f_late_channel")
                    .copied() == Some(1)
                && counts.get("self_hosted_profiles_qualification_acknowledge")
                    .copied().unwrap_or(0) == 0
                // The harness intentionally performs one denied native
                // preflight stream BEFORE the genuine production Chat stream.
                // Both are counted in the original native IPC tracer.
                && streamed == 2
                && successful_synthetic_post == 1
            }
            "original-late-cancel-ack" => {
                let proof = &report["native"]["originalLateCancelAck"];
                let marker = |name: &str| -> Option<Value> {
                    let leaf = state.root.join(name);
                    ensure_safe_leaf(&state.root, &leaf).ok()?;
                    serde_json::from_slice::<Value>(&fs::read(leaf).ok()?).ok()
                };
                let held = marker("cancel-ack-held.json");
                let released = marker("cancel-ack-release.json");
                let returned = marker("cancel-ack-native-return.json");
                proof["originalProductionRunner"] == true
                    && proof["originalCallerTerminalBeforeNativeAck"] == true
                    && proof["callerResultUnchanged"] == true
                    && proof["exactNativeRegistryDrained"] == true
                    && proof["zeroQualifyingReceipts"] == true
                    && proof["noCrossRequestEffect"] == true
                    && receipts.is_empty()
                    && streamed == 1
                    && successful_synthetic_post == 1
                    && held.as_ref().is_some_and(|v| {
                        v["requestId"] == proof["requestId"]
                            && v["actualProductionCancelAndNativeDrainBeforeAck"] == true
                            && v["hostPid"] == std::process::id()
                            && v["syntheticOnly"] == true
                    })
                    && released.as_ref().is_some_and(|v| {
                        v["requestId"] == proof["requestId"]
                            && v["sessionId"] == proof["originalSessionId"]
                            && v["originalCallerAlreadyTerminal"] == true
                            && v["syntheticOnly"] == true
                    })
                    && returned.as_ref().is_some_and(|v| {
                        v["requestId"] == proof["requestId"]
                            && v["returnedOnlyAfterOriginalCallerTerminal"] == true
                            && v["nativeRegistryStillDrained"] == true
                            && v["syntheticOnly"] == true
                    })
                    && counts.get("lm11_acceptance_arm_cancel_ack").copied() == Some(1)
                    && counts.get("lm11_acceptance_release_cancel_ack").copied() == Some(1)
                    && cancel_ids.iter().any(|v| {
                        v["requestId"] == proof["requestId"] && v["origin"] == "session-stop"
                    })
            }
            "original-duplicate-terminal" => {
                let proof = &report["native"]["originalDuplicateTerminal"];
                let marker = state.root.join("post-terminal-channel-send.json");
                let sent = ensure_safe_leaf(&state.root, &marker).is_ok()
                    && fs::read(&marker)
                        .ok()
                        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                        .is_some_and(|v| {
                            v["requestId"] == proof["requestId"]
                                && v["originalTerminalPhase"] == "completed"
                                && v["afterOriginalLeaseDrop"] == true
                                && v["lateTerminalNativeSendSucceeded"] == true
                                && v["oldNativeRegistryAbsentAtInjection"] == true
                                && v["testInjectedNotExternalSseParser"] == true
                                && v["syntheticOnly"] == true
                        });
                let boundary = proof["observedBoundary"].as_str();
                sent && proof["originalProductionRunner"] == true
                    && proof["originalCompletedAndAcknowledgedFour"] == true
                    && proof["nativeDuplicateAttemptAfterFirstTerminal"] == true
                    && matches!(
                        boundary,
                        Some("DELIVERED AND SAFELY IGNORED" | "STRUCTURALLY DISPOSED")
                    )
                    && proof["callerAndChatUnchanged"] == true
                    && proof["noDuplicateReceipts"] == true
                    && proof["persistedReceiptCount"] == 4
                    && receipts.len() == 4
                    && successful_synthetic_post == 1
                    && streamed == 1
                    && counts
                        .get("self_hosted_profiles_qualification_acknowledge")
                        .copied()
                        == Some(1)
                    && counts.get("lm11_acceptance_arm_late_channel").copied() == Some(1)
            }
            "original-postdeadline-provider-events" => {
                let proof = &report["native"]["originalPostDeadline"];
                let admission = state
                    .root
                    .join("postdeadline-original-registration-delay.json");
                let native_delay = ensure_safe_leaf(&state.root, &admission)
                    .ok()
                    .and_then(|_| fs::read(admission).ok())
                    .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
                let file = state.root.join("postdeadline-upstream-emission.json");
                let upstream = ensure_safe_leaf(&state.root, &file)
                    .ok()
                    .and_then(|_| fs::read(file).ok())
                    .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
                let disposition = proof["observedBoundary"].as_str();
                native_delay.as_ref().is_some_and(|v| {
                    v["requestId"] == proof["requestId"]
                        && v["realNativeReservationBeforeResponse"] == true
                        && v["exactOriginalSecondOpen"] == true
                        && v["nativeResponseDelayMs"] == 6000
                        && v["unchangedAggregateDeadlineMs"] == 120000
                        && v["syntheticOnly"] == true
                }) && proof["originalProductionRunner"] == true
                    && proof["originalAggregateBudgetMs"] == 120000
                    && proof["originalOperationElapsedMs"]
                        .as_u64()
                        .is_some_and(|ms| (119000..=135000).contains(&ms))
                    && proof["terminalBeforeLateUpstreamTcpEmission"] == true
                    && proof["firstOriginalNativeFrameBeforeDeadline"] == true
                    && proof["lateNativeProviderContentAttempted"] == true
                    && proof["lateNativeProviderTerminalAttempted"] == true
                    && proof["lateNativeProviderAttemptElapsedMs"]
                        .as_u64()
                        .is_some_and(|ms| ms >= 123000)
                    && proof["actualCallerTerminalAtUnixMs"]
                        .as_u64()
                        .is_some_and(|caller| {
                            caller > 0
                                && upstream.as_ref().is_some_and(|v| {
                                    v["lateContentAttemptAtUnixMs"]
                                        .as_u64()
                                        .is_some_and(|stream| {
                                            stream > caller
                                                && v["lateTerminalAttemptAtUnixMs"]
                                                    .as_u64()
                                                    .is_some_and(|terminal| terminal >= stream)
                                        })
                                })
                        })
                    && upstream.as_ref().is_some_and(|v| {
                        v["lateContentAttemptOrdinal"] == 1 && v["lateTerminalAttemptOrdinal"] == 2
                    })
                    && proof["firstOriginalNativeFrameHeldInActualOwner"] == true
                    && proof["originalCallerDeadlinePhase"] == "bounded-request"
                    && matches!(
                        disposition,
                        Some(
                            "STRUCTURALLY DISPOSED"
                                | "REJECTED BY REQUEST/EPOCH FENCE"
                                | "DELIVERED AND SAFELY IGNORED"
                        )
                    )
                    && proof["originalCallerTerminalUnchanged"] == true
                    && proof["noB03ReceiptsOrAck"] == true
                    && proof["exactNativeRegistryDrained"] == true
                    && receipts.is_empty()
                    && opened == 2
                    && streamed == 1
                    && successful_synthetic_post == 1
                    && counts
                        .get("self_hosted_profiles_qualification_acknowledge")
                        .copied()
                        .unwrap_or(0)
                        == 0
                    && upstream.as_ref().is_some_and(|v| {
                        v["syntheticOnly"] == true
                            && v["sameAuthenticatedOriginalHttpSocket"] == true
                            && v["firstSseFrameBeforeDeadline"] == true
                            && v["elapsedSinceFirstSseFrameMs"]
                                .as_u64()
                                .is_some_and(|ms| ms >= 123000)
                            && v["lateContentFrameAttempted"] == true
                            && v["lateTerminalFrameAttempted"] == true
                            && v["notProofOfDeliveredRendererCallback"] == true
                    })
            }
            "original-abc-native-isolation" => {
                let proof = &report["native"]["originalABC"];
                let ids = [
                    proof["originalARequestId"].as_str().unwrap_or(""),
                    proof["liveBRequestId"].as_str().unwrap_or(""),
                    proof["liveCRequestId"].as_str().unwrap_or(""),
                ];
                proof["originalAQualification"] == true
                    && proof["BAndCNativeRegisteredBeforeACancellation"] == true
                    && proof["sameDeploymentCompetitorDeniedAtOriginalSingleFlight"] == true
                    && proof["ACallerCancelledOnly"] == true
                    && proof["BTerminalCompleted"] == true
                    && proof["CTerminalCompleted"] == true
                    && proof["threeUniqueNativeRequestIds"] == true
                    && proof["zeroB03Effects"] == true
                    && proof["unrelatedSettingsRevisionPreserved"] == true
                    && proof["runtimeDeploymentConcurrencyStructurallyUnavailable"] == true
                    && ids.iter().all(|id| {
                        id.starts_with("inference-") && id[10..].bytes().all(|b| b.is_ascii_digit())
                    })
                    && ids[0] != ids[1]
                    && ids[0] != ids[2]
                    && ids[1] != ids[2]
                    && cancel_ids
                        .iter()
                        .any(|row| row["requestId"] == ids[0] && row["origin"] == "session-stop")
                    && cancel_ids
                        .iter()
                        .all(|row| row["requestId"] != ids[1] && row["requestId"] != ids[2])
                    && streamed == 3
                    && opened == 4
                    && successful_synthetic_post == 3
                    && receipts.is_empty()
                    && counts
                        .get("self_hosted_profiles_qualification_begin")
                        .copied()
                        .unwrap_or(0)
                        == 0
            }
            "original-managed-abc-deployments" => {
                let proof = &report["native"]["managedABC"];
                let hashes = proof["credentialSha256"].as_array();
                let valid_hashes = hashes.is_some_and(|hashes| {
                    let unique: std::collections::BTreeSet<_> =
                        hashes.iter().filter_map(|value| value.as_str()).collect();
                    hashes.len() == 4
                        && unique.len() == 4
                        && unique.iter().all(|hash| {
                            hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())
                        })
                });
                // Original Chat result.requestId is a logical SDK UUID, NOT an
                // ai_http_open "inference-N" lease. Verify the two different
                // namespaces independently and bind UUIDs to actual B/C receipts.
                let native_ids = [
                    proof["originalARequestId"].as_str().unwrap_or(""),
                    proof["independentBRequestId"].as_str().unwrap_or(""),
                    proof["independentCRequestId"].as_str().unwrap_or(""),
                    proof["originalBNativeRequestId"].as_str().unwrap_or(""),
                    proof["originalCNativeRequestId"].as_str().unwrap_or(""),
                ];
                let logical_ids = [
                    proof["originalBRequestId"].as_str().unwrap_or(""),
                    proof["originalCRequestId"].as_str().unwrap_or(""),
                ];
                let unique_ids: std::collections::BTreeSet<_> =
                    native_ids.iter().copied().collect();
                let logical_unique: std::collections::BTreeSet<_> =
                    logical_ids.iter().copied().collect();
                let logical_receipts = logical_ids
                    .iter()
                    .zip([
                        proof["originalBDeploymentId"].as_str().unwrap_or(""),
                        proof["originalCDeploymentId"].as_str().unwrap_or(""),
                    ])
                    .all(|(logical, deployment)| {
                        logical.len() == 36
                            && logical
                                .bytes()
                                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
                            && receipts
                                .iter()
                                .filter(|row| {
                                    row["scope"]["deploymentId"].as_str() == Some(deployment)
                                        && row["evidence"]["reference"].as_str() == Some(*logical)
                                })
                                .count()
                                == 4
                    });
                let native_registry = app.state::<net::inference::InferenceState>();
                let timings = [
                    proof["overlapAtUnixMs"].as_u64().unwrap_or(0),
                    proof["originalAStopAtUnixMs"].as_u64().unwrap_or(0),
                    proof["A2RestartAtUnixMs"].as_u64().unwrap_or(0),
                    proof["siblingTerminalsAtUnixMs"].as_u64().unwrap_or(0),
                ];
                let bound = state.abc_bindings.lock().ok();
                let all_children = bound.as_ref().is_some_and(|siblings| {
                    let owners: Vec<_> = ["b", "c", "a2"]
                        .iter()
                        .filter_map(|slot| siblings.get(*slot))
                        .collect();
                    let pids: std::collections::BTreeSet<_> =
                        owners.iter().filter_map(|v| v["pid"].as_u64()).collect();
                    let epochs: std::collections::BTreeSet<_> =
                        owners.iter().filter_map(|v| v["epoch"].as_str()).collect();
                    let ports: std::collections::BTreeSet<_> =
                        owners.iter().filter_map(|v| v["port"].as_u64()).collect();
                    owners.len() == 3
                        && pids.len() == 3
                        && epochs.len() == 3
                        && ports.len() == 3
                        && owners.iter().all(|v| v["syntheticOnly"] == true)
                });
                let real_routes = ["abc-a", "abc-b", "abc-c"]
                    .iter()
                    .map(|slot| {
                        service_events
                            .iter()
                            .filter(|row| {
                                row["childSlot"] == *slot
                                    && row["route"] == "/v1/chat/completions"
                                    && row["status"] == 200
                            })
                            .count()
                    })
                    .collect::<Vec<_>>();
                let denied_cross_routes = ["abc-b", "abc-c"]
                    .iter()
                    .map(|slot| {
                        service_events
                            .iter()
                            .filter(|row| {
                                row["childSlot"] == *slot
                                    && row["route"] == "/v1/chat/completions"
                                    && row["status"] == 401
                            })
                            .count()
                    })
                    .collect::<Vec<_>>();
                let original_a = state.initial_binding.lock().ok().and_then(|v| v.clone());
                let first_owner = original_a.as_ref().is_some_and(|(epoch, pid)| {
                    proof["oldAEpoch"] == *epoch
                        && proof["oldAPid"] == *pid
                        && *pid > 1
                        && epoch.len() == 64
                });
                let no_sibling_cancel = cancel_ids.iter().all(|cancel| {
                    (!native_ids[1..].iter().any(|id| cancel["requestId"] == *id))
                        || cancel["origin"] == "settled-cleanup"
                });
                let stale_a_cancel = cancel_ids.iter().any(|entry| {
                    entry["requestId"] == native_ids[0] && entry["origin"] == "parent-signal"
                });
                let a2_rejected_old_bearer = service_events
                    .iter()
                    .filter(|row| {
                        row["childSlot"] == "abc-a2"
                            && row["route"] == "/v1/models"
                            && row["status"] == 401
                    })
                    .count()
                    == 2;
                let replayed_old_native_id = streamed_ids
                    .iter()
                    .filter(|id| id.as_deref() == Some(native_ids[0]))
                    .count()
                    == 2;
                let owners = proof["originalOwnerWitnesses"].as_array();
                let owner_witnesses = owners.is_some_and(|owners| {
                    if owners.len() != 3 {
                        return false;
                    }
                    owners.iter().enumerate().all(|(i, owner)| {
                        let slot = ["a", "b", "c"][i];
                        let (expected_pid, expected_epoch, expected_port) = if i == 0 {
                            (
                                original_a.as_ref().map(|(_, pid)| u64::from(*pid)),
                                original_a.as_ref().map(|(epoch, _)| epoch.as_str()),
                                Some(u64::from(state.port)),
                            )
                        } else {
                            let binding = bound.as_ref().and_then(|v| v.get(slot));
                            (
                                binding.and_then(|v| v["pid"].as_u64()),
                                binding.and_then(|v| v["epoch"].as_str()),
                                binding.and_then(|v| v["port"].as_u64()),
                            )
                        };
                        owner["slot"] == slot
                            && owner["pid"].as_u64() == expected_pid
                            && owner["epoch"].as_str() == expected_epoch
                            && owner["port"].as_u64() == expected_port
                            && owner["modelAlias"]
                                .as_str()
                                .is_some_and(|s| s.starts_with("clack-"))
                    })
                });
                proof["threeCanonicalDeploymentsRegistered"] == true
                    && proof["threeSimultaneousRealNativeChildren"] == true
                    && proof["distinctNativePidEpochPortCredential"] == true
                    && owner_witnesses
                    && proof["originalAQualification"] == true
                    && proof["BAndCStreamsOverlappedOriginalA"] == true
                    && proof["liveBAndCNativeLeasesAtACancel"] == true
                    && proof["liveBAndCNativeLeasesDuringA2Restart"] == true
                    && proof["BAndCNativeLeasesDrainedOnlyAfterOwnTerminals"] == true
                    && proof["originalAStoppedAndRejected"] == true
                    && proof["staleAReconcile"] == "not-committed"
                    && proof["staleANativePrepareRejected"] == true
                    && proof["staleANativeAckRejected"] == true
                    && proof["staleARouteRejectedAfterA2"] == true
                    && proof["staleANativeRequestRejectedAfterA2"] == true
                    && proof["staleACancellationDidNotCancelLiveBC"] == true
                    && proof["exactA2Restart"] == true
                    && proof["originalBSucceeded"] == true
                    && proof["originalCSucceeded"] == true
                    && proof["BAndCRemainedReadyAndAuthenticated"] == true
                    && proof["zeroOriginalAQualificationReceipts"] == true
                    && proof["exactTwoSeparateAcknowledgedTicketGroups"] == true
                    && proof["exactlyEightOriginalQualificationReceipts"] == true
                    && proof["noRealModel"] == true
                    && native_ids.iter().all(|id| {
                        id.starts_with("inference-")
                            && id.len() > 10
                            && id[10..].bytes().all(|v| v.is_ascii_digit())
                    })
                    && unique_ids.len() == 5
                    && logical_unique.len() == 2
                    && logical_receipts
                    && replayed_old_native_id
                    && stale_a_cancel
                    && a2_rejected_old_bearer
                    && native_ids
                        .iter()
                        .all(|id| streamed_ids.iter().any(|seen| seen.as_deref() == Some(*id)))
                    && native_ids
                        .iter()
                        .all(|id| native_registry.completion(id).is_none())
                    && cancel_ids.iter().any(|entry| {
                        entry["requestId"] == native_ids[0] && entry["origin"] == "session-stop"
                    })
                    && no_sibling_cancel
                    && all_children
                    && first_owner
                    && valid_hashes
                    && timings[0] > 0
                    && timings.windows(2).all(|pair| pair[0] <= pair[1])
                    && real_routes == vec![1, 2, 2]
                    && denied_cross_routes == vec![1, 1]
                    && opened == 8
                    && streamed == 8
                    && successful_synthetic_post == 5
                    && receipts.len() == 8
                    && counts
                        .get("self_hosted_profiles_qualification_begin")
                        .copied()
                        == Some(3)
                    && counts
                        .get("self_hosted_profiles_qualification_prepare")
                        .copied()
                        == Some(3)
                    && counts
                        .get("self_hosted_profiles_qualification_acknowledge")
                        .copied()
                        == Some(3)
                    && counts.get("lm11_acceptance_abc_bind_child").copied() == Some(2)
                    && counts.get("lm11_acceptance_abc_restart_a").copied() == Some(1)
                    && proof["actualNativeStreams"] == streamed
                    && proof["actualOriginalB03AckCount"] == 3
            }
            "original-native-quiescence-failure" => {
                let proof = &report["native"]["originalQuiescence"];
                let marker = state.root.join("native-quiescence-original-held.json");
                let held = ensure_safe_leaf(&state.root, &marker)
                    .ok()
                    .and_then(|_| fs::read(marker).ok())
                    .and_then(|raw| serde_json::from_slice::<Value>(&raw).ok());
                proof["originalProductionRunner"] == true
                    && proof["nativeLeaseHeldAfterHttpFinished"] == true
                    && proof["originalQuiescenceGraceExceeded"] == true
                    && proof["terminalFailClosed"] == true
                    && proof["noB03AckOrReceipts"] == true
                    && proof["callerFailedWhileActualNativeLeaseRegistered"] == true
                    && proof["eventuallyDrainedActualNativeRegistry"] == true
                    && held.as_ref().is_some_and(|v| {
                        v["requestId"] == proof["requestId"]
                            && v["nativeLeaseStillRegistered"] == true
                            && v["actualHttpResponseAlreadyCompleted"] == true
                            && v["originalNativeTerminalSentBeforeNativeDrain"] == true
                            && v["nativeRegistryDrainHeld"] == true
                            && v["delayMs"] == 3500
                            && v["syntheticOnly"] == true
                    })
                    && counts
                        .get("self_hosted_profiles_qualification_acknowledge")
                        .copied()
                        .unwrap_or(0)
                        == 0
                    && app
                        .state::<net::inference::InferenceState>()
                        .completion(proof["requestId"].as_str().unwrap_or(""))
                        .is_none()
                    && receipts.is_empty()
                    && streamed == 1
                    && successful_synthetic_post == 1
            }
            "stale-cross-child-restart" => {
                actual_restart
                    && report["native"]["restart"]["oldRouteRejected"] == true
                    && report["native"]["restart"]["newReadyAuthenticated"] == true
                    && report["native"]["restart"]["oldCasTicketRejected"] == true
                    && report["native"]["restart"]["oldCasAckRejected"] == true
                    && report["native"]["restart"]["oldStreamIdRejectedAfterRestart"] == true
                    && report["native"]["restart"]["staleCancelIsolated"] == true
                    && report["native"]["restart"]["newStreamCompleted"] == true
                    && report["native"]["restart"]["realOldCallbackCount"]
                        .as_u64()
                        .is_some_and(|count| count >= 1)
                    && report["native"]["restart"]["oldNativeStreamOutcome"] != "still-pending"
                    && counts
                        .get("self_hosted_profiles_qualification_begin")
                        .copied()
                        == Some(1)
                    && counts
                        .get("self_hosted_profiles_qualification_prepare")
                        .copied()
                        == Some(1)
                    && counts.get("lm11_acceptance_restart_child").copied() == Some(1)
                    && counts
                        .get("self_hosted_profiles_qualification_acknowledge")
                        .copied()
                        == Some(1)
                    && streamed == 3
                    && successful_synthetic_post == 2
            }
            "stale-original-qualification-child-restart" => {
                // Unlike the existing direct ai_http_stream restart test, this
                // evidence must come from the ORIGINAL production Chat operation
                // and a real native Channel event held across a different PID,
                // epoch, key and authenticated B Ready. A disposed original
                // consumer is a valid structural fence; a synthetic callback is not.
                let proof = &report["native"]["originalCrossChild"];
                let boundary = proof["observedBoundary"].as_str();
                let original_id = proof["exactOriginalRequestId"].as_str();
                let exact_id = original_id.is_some_and(|id| {
                    id.starts_with("inference-")
                        && id.len() <= 80
                        && id[10..].bytes().all(|byte| byte.is_ascii_digit())
                });
                let real_consumer_boundary = match boundary {
                    Some("original-inference-channel-consumer-after-b-ready") => {
                        proof["originalCallbackInvoked"] == true
                            && proof["originalChannelDisposed"] == false
                    }
                    Some("original-tauri-channel-structurally-disposed") => {
                        proof["originalCallbackInvoked"] == false
                            && proof["originalChannelDisposed"] == true
                    }
                    _ => false,
                };
                actual_restart
                    && report["native"]["restart"]["oldRouteRejected"] == true
                    && report["native"]["restart"]["newReadyAuthenticated"] == true
                    && proof["originalProductionRunner"] == true
                    && proof["originalOperationRejected"] == true
                    && proof["heldActualOriginalEvent"] == true
                    && exact_id
                    && proof["heldNativeRequestId"] == proof["exactOriginalRequestId"]
                    && proof["originalSessionId"]
                        .as_str()
                        .is_some_and(|id| !id.is_empty())
                    && proof["heldChannelRegistrationId"]
                        .as_str()
                        .is_some_and(|id| {
                            !id.is_empty() && id.len() < 80 && id != "undefined" && id != "null"
                        })
                    && proof["releaseAfterBReady"] == true
                    && real_consumer_boundary
                    && proof["oldNativeSessionQuiescent"] == true
                    && proof["originalChatAndTaskUnchanged"] == true
                    && proof["noB03CallsOrReceipts"] == true
                    && proof["noNewBStreamDispatch"] == true
                    && proof["nativeStreams"] == 1
                    && streamed == 1
                    && opened >= 2
                    && successful_synthetic_post == 1
                    && [
                        "self_hosted_profiles_qualification_begin",
                        "self_hosted_profiles_qualification_prepare",
                        "self_hosted_profiles_qualification_acknowledge",
                        "self_hosted_profiles_qualification_cancel",
                    ]
                    .iter()
                    .all(|name| counts.get(*name).copied().unwrap_or(0) == 0)
            }
            "stage-reachability" | "stage-expiry" | "stage-cancel" | "stage-conflict"
            | "stage-concurrent" | "stage-stale-epoch" | "stage-corrupt" => {
                let stage = std::env::var(STAGE_BARRIER_ENV).ok();
                let proof = &report["native"]["stageBarrier"];
                let file = |leaf: &str| -> Option<Value> {
                    let path = state.root.join(leaf);
                    ensure_safe_leaf(&state.root, &path).ok()?;
                    let bytes = fs::read(path).ok()?;
                    (bytes.len() < 4096)
                        .then_some(bytes)
                        .and_then(|data| serde_json::from_slice::<Value>(&data).ok())
                };
                let (Some(armed), Some(hit), Some(release), Some(observation)) = (
                    file("barrier-stage-armed.json"),
                    file("barrier-stage-hit.json"),
                    file("barrier-stage-release.json"),
                    file("barrier-stage-observation.json"),
                ) else {
                    return Err("Original stage barrier evidence is missing".into());
                };
                let initial = state
                    .initial_binding
                    .lock()
                    .ok()
                    .and_then(|owner| owner.clone());
                let (epoch, pid) = initial.unwrap_or_default();
                let expected_terminal = if matches!(
                    state.scenario.as_str(),
                    "stage-reachability" | "stage-concurrent"
                ) {
                    "completed"
                } else {
                    "rejected"
                };
                let session = proof["originalSessionId"].as_str();
                stage.as_deref().is_some_and(|name| ORIGINAL_BARRIER_STAGES.contains(&name))
                && !epoch.is_empty() && pid > 1
                && session.is_some_and(stage_barrier_session_valid)
                && [
                    (&armed, "stage"), (&hit, "stage"),
                    (&release, "stage"), (&observation, "stage"),
                ].iter().all(|(file, key)| file[*key].as_str() == stage.as_deref())
                && [&armed, &hit, &release].iter().all(|file| {
                    file["pid"] == pid && file["epoch"] == epoch
                        && file["hostPid"] == std::process::id()
                        && file["syntheticOnly"] == true
                        && file["originalAggregateBudgetMs"] == 120000
                })
                && observation["nativePid"] == pid && observation["nativeEpoch"] == epoch
                && observation["hostPid"] == std::process::id()
                && observation["originalAggregateBudgetMs"] == 120000
                && observation["originalRunnerTerminal"] == expected_terminal
                && observation["oneShotReachedAndReleased"] == true
                && observation["syntheticOnly"] == true
                && [(&hit, "sessionId"), (&release, "sessionId"),
                    (&observation, "sessionId")].iter()
                    .all(|(file, key)| file[*key].as_str() == session)
                && armed["tokenDigest"].as_str().is_some_and(|hash| hash.len() == 64
                    && hash.bytes().all(|b| b.is_ascii_hexdigit()))
                && hit["actualOriginalStageIpc"] == true
                && release["oneShotOriginalAsyncIpcResumed"] == true
                && armed["mode"] == state.scenario
                && release["mode"] == state.scenario
                && observation["mode"] == state.scenario
                && proof["stage"].as_str() == stage.as_deref()
                && proof["mode"] == &state.scenario[6..]
                && proof["originalProductionRunner"] == true
                && proof["originalAggregateBudgetMs"] == 120000
                && proof["nativePid"] == pid && proof["nativeEpoch"] == epoch
                && proof["originalSessionId"].as_str() == session
                && proof["stageReachedFromOriginalIpc"] == true
                && proof["releasedExactlyOnce"] == true
                && proof["originalRunnerTerminal"] == expected_terminal
                && proof["originalCallerDidNotRetroactivelyPass"] == true
                && (stage.as_deref() != Some("native-open-response") || (
                    file("barrier-native-registration.json").is_some_and(|registered| {
                        let id=registered["requestId"].as_str().unwrap_or("");
                        id.starts_with("inference-") && id.len()>10
                            && id[10..].bytes().all(|b| b.is_ascii_digit())
                            && registered["sessionId"].as_str() == session
                            && registered["hostPid"] == std::process::id()
                            && registered["syntheticOnly"] == true
                            && registered["registeredBeforeRendererResponse"] == true
                            && cancel_ids.iter().any(|entry| {
                                entry["requestId"] == id &&
                                    entry["origin"] == "scope-superseded"
                            })
                            && app.state::<net::inference::InferenceState>()
                                .completion(id).is_none()
                    })
                    && opened == 2 && canceled == 2 && streamed == 0
                    && receipts.is_empty()
                ))
                && (state.scenario != "stage-conflict" || (
                    stage.as_deref() == Some("b03-before-prepare")
                    && proof["originalCasConflictInjected"] == true
                    && proof["unrelatedOrdinarySettingsRevisionPreserved"] == true
                    && receipts.is_empty()
                    && counts.get("self_hosted_profiles_compare_and_swap")
                        .copied().unwrap_or(0) >= 2))
                && (state.scenario != "stage-concurrent" || (
                    stage.as_deref() == Some("preparation-complete")
                    && proof["secondOriginalSameDeploymentQualificationRejected"] == true
                    && proof["originalFirstQualificationCompleted"] == true
                    && receipts.len() == 4))
                && (std::env::var("CLACK_LM11_TERMINAL_WINS_RACE").as_deref()!=Ok("1") || (
                    state.scenario=="stage-reachability" &&
                    stage.as_deref()==Some("terminal-delivery") &&
                    proof["terminalWinsRace"]["originalProductionRunner"]==true &&
                    proof["terminalWinsRace"]["terminalWonBeforeStop"]==true &&
                    proof["terminalWinsRace"]["retainedFourAcknowledgedReceipts"]==true &&
                    proof["terminalWinsRace"]["oneTerminalCallerSettlement"]==true &&
                    proof["terminalWinsRace"]["noDuplicateAckOrStream"]==true &&
                    proof["terminalWinsRace"]["lateExactNativeCancelHarmless"]==true &&
                    receipts.len()==4 &&
                    cancel_ids.iter().any(|row|
                        row["requestId"]==proof["terminalWinsRace"]["exactRealNativeRequestId"] &&
                        row["origin"]=="settled-cleanup") &&
                    app.state::<net::inference::InferenceState>().completion(
                        proof["terminalWinsRace"]["exactRealNativeRequestId"]
                            .as_str().unwrap_or("")).is_none()
                ))
                && (state.scenario != "stage-corrupt" || (
                    stage.as_deref()==Some("b03-before-acknowledge")
                    && proof["actualOriginalNativePrepare"] == true
                    && proof["originalRecoveryRequired"] == true
                    && proof["noAutoRetry"] == true
                    && proof["noQualifyingReceipt"] == true
                    && proof["forensicEvidencePreserved"] == true
                    && proof["physicalReconciliation"] == "pending-reconciliation"
                    && state.root.join("forensic-original-authority-before.json").is_file()
                    && state.root.join("native-qualification-ticket.json").is_file()
                    && state.root.join("corrupt-authority-fault.json").is_file()
                ))
                && (state.scenario != "stage-stale-epoch" || (
                    matches!(stage.as_deref(),
                        Some("b03-native-prepare" | "b03-before-acknowledge" | "b03-before-readback"))
                    && proof["genuineB03TicketUnderEpochA"] == true
                    && proof["realDifferentPidEpochBReady"] == true
                    && proof["newBRouteStillUsable"] == true
                    && state.restarted_binding.lock().ok()
                        .and_then(|v| v.clone()).is_some_and(|(next_epoch,next_pid,_)|
                            next_epoch != epoch && next_pid != pid)
                    && if stage.as_deref() == Some("b03-before-readback") {
                        proof["historicalAReadbackOnly"] == true
                            && proof["staleACallerDidNotPass"] == true
                            && proof["immutableHistoricalAReceipts"] == true
                            && proof["reconciliationDoesNotGrantCurrentEpoch"] == true
                            && proof["physicalReconciliation"] == "committed"
                            && receipts.len() == 4
                            && receipts.iter().all(|row|
                                row["qualificationCas"]["phase"] == "acknowledged"
                                    && row["version"] == 2)
                    } else {
                        proof["oldEpochNativeProgressionRejected"] == true
                            && proof["zeroAcknowledgedQualifyingReceipts"] == true
                            && proof["reconcileNonqualifying"] == true
                            && receipts.iter().all(|row|
                                row["qualificationCas"]["phase"] != "acknowledged")
                    }
                ))
                && (std::env::var("CLACK_LM11_STALE_ID_CANCEL").as_deref()!=Ok("1") || (
                    state.scenario=="stage-stale-epoch" &&
                    stage.as_deref()==Some("b03-before-readback") &&
                    proof["staleNativeId"]["staleARejectedByNativeRequestFence"]==true &&
                    proof["staleNativeId"]["staleACancellationIsolatedFromLiveB"]==true &&
                    proof["staleNativeId"]["BNativeStreamTerminalCompleted"]==true &&
                    proof["staleNativeId"]["oldARequestDidNotDispatchToSyntheticProvider"]==true &&
                    proof["staleNativeId"]["genuineOldOriginalRequestId"]!=
                        proof["staleNativeId"]["realBNewRequestId"] &&
                    cancel_ids.iter().any(|row|
                        row["requestId"]==proof["staleNativeId"]["genuineOldOriginalRequestId"] &&
                        row["origin"]=="scope-superseded") &&
                    streamed==3 && successful_synthetic_post==2
                ))
                && (state.scenario != "stage-cancel" || (
                    proof["actualSessionStop"] == true
                    && proof["originalCancellationReason"] == "explicit-user:cancel-requested"
                    && proof["cancelledAtOperationElapsedMs"]
                        .as_u64().is_some_and(|ms| ms < 119_000)))
                && proof["nativeStreams"] == if std::env::var("CLACK_LM11_STALE_ID_CANCEL").as_deref()==Ok("1")
                {3} else if matches!(state.scenario.as_str(),
                    "stage-expiry" | "stage-cancel")
                    && matches!(stage.as_deref(),
                        Some("before-native-admission" | "native-admission-response"
                          | "prepare-chat-promise-settlement" | "native-open-response"
                          | "before-preparation" | "during-preparation"
                          | "preparation-complete" | "before-ai-http-open"
                          | "predispatch" | "after-ai-http-open"))
                { 0 } else { 1 }
                && proof["persistedReceiptCount"] == receipts.len()
                && proof["originalElapsedMs"] == observation["originalElapsedMs"]
                && (matches!(state.scenario.as_str(),
                      "stage-reachability" | "stage-concurrent")
                    || proof["originalElapsedMs"].as_u64().is_some_and(|ms|
                      if matches!(state.scenario.as_str(), "stage-cancel" | "stage-conflict" | "stage-stale-epoch" | "stage-corrupt")
                      { ms < 119_000 } else { ms >= 119_000 }))
                && streamed == if std::env::var("CLACK_LM11_STALE_ID_CANCEL").as_deref()==Ok("1")
                {3} else if matches!(state.scenario.as_str(),
                    "stage-expiry" | "stage-cancel")
                    && matches!(stage.as_deref(),
                        Some("before-native-admission" | "native-admission-response"
                          | "prepare-chat-promise-settlement" | "native-open-response"
                          | "before-preparation" | "during-preparation"
                          | "preparation-complete" | "before-ai-http-open"
                          | "predispatch" | "after-ai-http-open"))
                { 0 } else { 1 }
                && successful_synthetic_post == if std::env::var("CLACK_LM11_STALE_ID_CANCEL").as_deref()==Ok("1")
                {2} else if matches!(state.scenario.as_str(),
                    "stage-expiry" | "stage-cancel")
                    && matches!(stage.as_deref(),
                        Some("before-native-admission" | "native-admission-response"
                          | "prepare-chat-promise-settlement" | "native-open-response"
                          | "before-preparation" | "during-preparation"
                          | "preparation-complete" | "before-ai-http-open"
                          | "predispatch" | "after-ai-http-open"))
                { 0 } else { 1 }
                // Every non-selected acceptance-only stage still traverses
                // the exact native one-shot command and returns inertly.
                // The expanded five B02 boundaries raise the honest visit
                // count above the older 12-stage host ceiling; the selected
                // stage is still proven separately by exact arm/hit/release.
                && counts.get("lm11_acceptance_barrier").copied().is_some_and(|n| n >= 1 && n <= 28)
                && counts.get("lm11_acceptance_barrier_release").copied() == Some(1)
                && counts.get("lm11_acceptance_barrier_terminal").copied() == Some(1)
            }
            "runtime-transport" => runtime_observed,
            "original-runtime-fault" => {
                if original_evidence_mode {
                    original_evidence_observed
                } else if original_negative_mode {
                    original_runtime_negative_observed
                } else {
                    original_runtime_observed
                }
            }
            _ => false,
        };
        let pass = app_data_contained
            && report["syntheticOnly"] == true
            && report["scenario"] == state.scenario
            && report["outcome"] == expected_outcome
            && durable_exact
            && scenario_observed
            && (!qualifying
                || (streamed
                    >= if matches!(
                        state.scenario.as_str(),
                        "stage-reachability" | "stage-concurrent" | "original-duplicate-terminal"
                    ) {
                        1
                    } else {
                        2
                    }
                    && successful_synthetic_post == 1
                    && (if matches!(
                        state.scenario.as_str(),
                        "stage-reachability" | "stage-concurrent" | "original-duplicate-terminal"
                    ) {
                        if state.scenario == "original-duplicate-terminal" {
                            report["native"]["originalDuplicateTerminal"]["persistedReceiptCount"]
                                == 4
                        } else {
                            report["native"]["stageBarrier"]["persistedReceiptCount"] == 4
                        }
                    } else {
                        report["native"]["receiptCount"] == 4
                    })
                    && counts
                        .get("self_hosted_profiles_qualification_begin")
                        .copied()
                        == Some(1)
                    && counts
                        .get("self_hosted_profiles_qualification_prepare")
                        .copied()
                        == Some(1)
                    && counts
                        .get("self_hosted_profiles_qualification_acknowledge")
                        .copied()
                        == Some(if state.scenario == "duplicate-ticket" {
                            2
                        } else {
                            1
                        })))
            && opened >= 1
            && canceled >= 1
            && opened >= streamed
            && explicit
            && counts
                .get("managed_local_runtime_status")
                .copied()
                .unwrap_or(0)
                >= 1
            && counts
                .get("managed_local_runtime_route")
                .copied()
                .unwrap_or(0)
                >= 2
            && counts
                .get("self_hosted_profiles_compare_and_swap")
                .copied()
                .unwrap_or(0)
                >= 1;
        drop(observed);
        ensure_safe_leaf(&state.root, &state.root.join("renderer-report.json"))?;
        write_json(
            &state.root.join("renderer-report.json"),
            &json!({
                "nativeTauriIpc": true, "syntheticOnly": true,
                "scenario": state.scenario,
                "realModelInference": false, "modelRuntimeStarted": false,
                "qualificationLabRan": false, "appDataContained": app_data_contained,
                "renderer": report, "nativeRequestChecks": {
                    "pass": pass, "opens": opened, "cancels": canceled,
                    "streams": streamed, "cancelledIds": cancel_ids, "streamIds": streamed_ids,
                    "counts": counts,
                },
                "managedFixture": {"alias": state.alias, "digest": state.digest,
                    "port": state.port, "testOnly": true },
            "nativeRealRestartVerified": actual_restart,
                "nativeDurableReceiptCheck": {"passed": durable_exact,
                    "count": receipts.len(), "syntheticHttpSuccessCount": successful_synthetic_post,
                    "modelQualityQualification": false},
                "scenarioObservedByHost": scenario_observed,
                "corruptAuthorityAtNativeReport": corruption_at_report,
            }),
        )?;
        *recorded = true;
        runtime::shutdown();
        // `AppHandle::exit` is not itself a child-process reaper. If native
        // admission failed, the unbound synthetic service still belongs to this
        // acceptance host and must be killed before the host exit is requested.
        if let Ok(mut remaining) = state.child.lock() {
            if let Some(mut child) = remaining.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        // A separate, exact case-owned ABNORMAL host exit after original B03
        // corruption was physically observed. The renderer has already reported
        // recovery-required, the synthetic service was reaped and all evidence
        // has been synced; process::exit skips Tauri Store's normal Exit hook.
        // No ordinary host can opt into this synthetic-only fault.
        if state.scenario == "stage-corrupt"
            && std::env::var("CLACK_LM11_CORRUPT_ABNORMAL_EXIT").as_deref() == Ok("1")
            && corruption_at_report
            && pass
        {
            let marker = state.root.join("corrupt-abnormal-exit.json");
            ensure_safe_leaf(&state.root, &marker)?;
            write_json(
                &marker,
                &json!({
                    "nativeHostPid":std::process::id(),
                    "actualCorruptionDetectedBeforeExit":true,
                    "syntheticServiceReaped":true,
                    "skippedTauriExitHook":true,
                    "exitCode":188,
                    "syntheticOnly":true,
                }),
            )?;
            std::process::exit(188);
        }
        app.exit(if pass { 0 } else { 1 });
        Ok(())
    }

    /// A separate Wry/Tauri process reconciles the exact receipt left by a
    /// previous renderer process. No service, model or inference starts here.
    /// Corrupt settings cannot be loaded into the legacy Store cache, because
    /// Store initialization could overwrite the retained corrupt input on exit.
    fn restart_inspect() -> Result<(), String> {
        let root = ensure_root(&PathBuf::from(
            std::env::var(ROOT_ENV).map_err(|_| "Owned root missing")?,
        ))?;
        let mode = std::env::var(SCENARIO_ENV).map_err(|_| "Scenario missing")?;
        if !matches!(
            mode.as_str(),
            "restart-pending"
                | "restart-acknowledged"
                | "lost-native-ack"
                | "corrupt-settings"
                | "stage-corrupt"
                | "read-only-settings"
        ) {
            return Err("Unsupported restart inspection case".into());
        }
        let data = root.join("data");
        let path = data.join(SETTING);
        ensure_safe_leaf(&root, &path)?;
        ensure_safe_leaf(&root, &data.join(".terax-settings.json.lock"))?;
        ensure_safe_leaf(&root, &root.join("native-qualification-ticket.json"))?;
        ensure_safe_leaf(&root, &root.join("native-restart-report.json"))?;
        let ticket: settings::QualificationCasTicket = serde_json::from_slice(
            &fs::read(root.join("native-qualification-ticket.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let expected_before = if mode == "stage-corrupt" {
            fs::read(&path).ok()
        } else {
            Some(fs::read(&path).map_err(|e| e.to_string())?)
        };
        let bytes_before_sha = expected_before
            .as_ref()
            .map(|bytes| format!("{:x}", sha2::Sha256::digest(bytes)));
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        context.config_mut().identifier = data.to_string_lossy().replace('\\', "/");
        tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(move |app| {
            let actual = app.path().app_data_dir()?.canonicalize()?;
            assert_eq!(actual, data, "ABORT: restart inspector AppData escaped case");
            let store_path = tauri_plugin_store::resolve_store_path(app.handle(), SETTING)?;
            assert_eq!(store_path.parent().unwrap().canonicalize()?, data,
                "ABORT: restart Store parent escaped case");
            assert_eq!(store_path.file_name(), Some(std::ffi::OsStr::new(SETTING)),
                "ABORT: restart Store leaf changed");
            // Read-only native reconcile is authoritative for corrupt input.
            if !matches!(mode.as_str(), "corrupt-settings" | "stage-corrupt") {
                settings::self_hosted_profiles_startup_storage_check(app.handle())
                    .map_err(std::io::Error::other)?;
            }
            WebviewWindowBuilder::new(app, "restart-inspector", WebviewUrl::External("about:blank".parse().unwrap()))
                .visible(false).data_directory(root.join("inspect-webview"))
                .build()?;
            let app = app.handle().clone();
            thread::spawn(move || {
                let result = (|| -> Result<Value, String> {
                    ensure_safe_leaf(&root, &root.join("data").join(SETTING))?;
                    let reconciled = settings::self_hosted_profiles_qualification_reconcile(app.clone(), ticket)?;
                    let after = fs::read(root.join("data").join(SETTING)).ok();
                    let after_sha = after.as_ref().map(|bytes|
                        format!("{:x}",sha2::Sha256::digest(bytes)));
                    let unchanged = after_sha == bytes_before_sha;
                    let ordinary_write = if mode == "read-only-settings" {
                        Some(settings::self_hosted_settings_set(app.clone(),
                            "lm11SyntheticOnlyPreference".into(), json!(true)).map(|_|"accepted".to_string())
                            .unwrap_or_else(|e|format!("rejected:{e}")))
                    } else { None };
                    let final_bytes = fs::read(root.join("data").join(SETTING)).ok();
                    let finally_unchanged = final_bytes.as_ref().map(|bytes|
                        format!("{:x}",sha2::Sha256::digest(bytes))) == bytes_before_sha;
                    let expected_reconcile = match mode.as_str() {
                        "restart-pending" => "not-committed",
                        "restart-acknowledged" | "lost-native-ack" | "read-only-settings" => "committed",
                        "corrupt-settings" => "pending-reconciliation",
                        "stage-corrupt" => "pending-reconciliation",
                        _ => "invalid",
                    };
                    let pass = reconciled == expected_reconcile && unchanged && finally_unchanged &&
                        (mode != "read-only-settings" || ordinary_write.as_ref().is_some_and(|s| s.starts_with("rejected:"))) &&
                        (mode != "stage-corrupt" || (
                            root.join("forensic-original-authority-before.json").is_file() &&
                            root.join("corrupt-authority-fault.json").is_file() &&
                            root.join("native-qualification-ticket.json").is_file()));
                    Ok(json!({"pass":pass,"reconcile":reconciled,"expectedReconcile":expected_reconcile,
                        "sameAuthoritativeBytes": unchanged,"unchangedAfterAttempt":finally_unchanged,
                        "ordinaryWrite":ordinary_write,"syntheticOnly":true,"realTauriRestart":true,
                        "modelRuntimeStarted":false,"rendererIpcNotReplayed":true}))
                })();
                let pass = result.as_ref().is_ok_and(|v| v["pass"] == true);
                let _ = write_json(&root.join("native-restart-report.json"), &json!({
                    "scenario":mode,"result":result,"freshProcessId":std::process::id(),
                }));
                app.exit(if pass { 0 } else { 1 });
            });
            Ok(())
        })
        .build(context).map_err(|e| e.to_string())?
        .run(|_, _| {});
        Ok(())
    }

    pub(super) fn run() {
        if std::env::args().nth(1).as_deref() == Some("--synthetic-service") {
            if let Err(error) = synthetic_service() {
                eprintln!("Synthetic service failed: {error}");
                std::process::exit(1);
            }
            return;
        }
        if std::env::args().nth(1).as_deref() == Some("--restart-inspect") {
            if let Err(error) = restart_inspect() {
                eprintln!("Native restart inspection denied: {error}");
                std::process::exit(1);
            }
            return;
        }
        assert!(
            cfg!(feature = "lm11-authenticated-webview-acceptance"),
            "This host must use the explicit non-default acceptance feature"
        );
        let root = ensure_root(&PathBuf::from(
            std::env::var(ROOT_ENV).expect("Owned root required"),
        ))
        .expect("Root containment refused");
        let digest = std::env::var(DIGEST_ENV).expect("Owned fixture digest required");
        assert!(
            digest.starts_with("sha256:")
                && digest.len() == 71
                && digest[7..].bytes().all(|b| b.is_ascii_hexdigit()),
            "Invalid fixture digest"
        );
        let alias = format!("clack-{}", &digest[7..23]);
        let key = runtime::acceptance_new_synthetic_key().expect("Native key generation");
        let scenario = std::env::var(SCENARIO_ENV).expect("Scenario required");
        assert!(
            matches!(
                scenario.as_str(),
                "normal"
                    | "cancel-exact-id"
                    | "preflight-deny"
                    | "wrong-secret"
                    | "wrong-deployment"
                    | "wrong-epoch"
                    | "wrong-pid"
                    | "service-death"
                    | "timeout-before-admission"
                    | "timeout-during-preparation"
                    | "stop-before-open"
                    | "stop-after-open"
                    | "stop-during-stream"
                    | "stop-after-terminal"
                    | "stale-runtime-epoch"
                    | "wrong-model-alias"
                    | "wrong-provider-auth"
                    | "duplicate-ticket"
                    | "concurrent-owner-cancel"
                    | "window-close-preflight"
                    | "window-close-stream"
                    | "restart-pending"
                    | "restart-acknowledged"
                    | "lost-native-ack"
                    | "corrupt-settings"
                    | "read-only-settings"
                    | "runtime-transport"
                    | "original-runtime-fault"
                    | "genuine-child-restart"
                    | "stale-cross-child-restart"
                    | "stale-original-qualification-child-restart"
                    | "stage-reachability"
                    | "stage-expiry"
                    | "stage-cancel"
                    | "stage-conflict"
                    | "stage-concurrent"
                    | "stage-stale-epoch"
                    | "stage-corrupt"
                    | "stage-close"
                    | "deadline-bounded"
                    | "post-terminal-channel-callback"
                    | "post-cancel-channel-callback"
                    | "post-cancel-original-lm2f-channel"
                    | "original-late-cancel-ack"
                    | "original-duplicate-terminal"
                    | "original-postdeadline-provider-events"
                    | "original-abc-native-isolation"
                    | "original-managed-abc-deployments"
                    | "original-native-quiescence-failure"
            ),
            "Scenario is not implemented"
        );
        let url: tauri::Url = std::env::var(URL_ENV)
            .expect("Vite entry URL required")
            .parse()
            .expect("Valid fixture URL");
        assert!(
            url.scheme() == "http"
                && url.host_str() == Some("127.0.0.1")
                && url.path() == "/lm11-authenticated-webview.html"
                && url.port().is_some()
                && url.query().is_none(),
            "Renderer must load only the isolated loopback Vite entry"
        );

        let exe = std::env::current_exe().expect("Same EXE synthetic child");
        let child = Command::new(exe)
            .arg("--synthetic-service")
            .env(ROOT_ENV, &root)
            .env("CLACK_LM11_SYNTHETIC_KEY", &key)
            .env("CLACK_LM11_SYNTHETIC_ALIAS", &alias)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Launch synthetic-only loopback child");
        let mut pending_child = StartupChild(Some(child));
        let until = Instant::now() + Duration::from_secs(7);
        let port = loop {
            if Instant::now() > until {
                panic!("Synthetic child did not declare a bounded loopback port");
            }
            if let Ok(bytes) = fs::read(root.join("service-ready.json")) {
                let value: Value = serde_json::from_slice(&bytes).expect("Valid service marker");
                let port = value["port"].as_u64().filter(|p| (1..=65_535).contains(p));
                assert_eq!(
                    value["pid"].as_u64(),
                    Some(pending_child.0.as_ref().unwrap().id() as u64)
                );
                assert_eq!(value["syntheticOnly"], true);
                if let Some(port) = port {
                    break port as u16;
                }
            }
            thread::sleep(Duration::from_millis(25));
        };
        let runtime_scenario = std::env::var(RUNTIME_ENV).ok();
        assert!(
            runtime_scenario
                .as_deref()
                .is_none_or(|mode| RUNTIME_MODES.contains(&mode)),
            "Unknown runtime fault configuration"
        );
        assert_eq!(
            matches!(
                scenario.as_str(),
                "runtime-transport" | "original-runtime-fault"
            ),
            runtime_scenario.is_some(),
            "Runtime transport and original faults must be isolated from smoke cases"
        );
        assert!(
            scenario != "original-runtime-fault"
                || runtime_scenario
                    .as_deref()
                    .is_some_and(|mode| ORIGINAL_RUNTIME_FAULT_MODES.contains(&mode)),
            "Original runtime fault requires one allowlisted synthetic engine mode"
        );
        let deadline_stage = std::env::var(DEADLINE_ENV).ok();
        assert!(
            deadline_stage
                .as_deref()
                .is_none_or(|stage| INJECTABLE_DEADLINE_STAGES.contains(&stage)),
            "Unrecognized or non-injectable production qualification boundary"
        );
        assert_eq!(
            scenario == "deadline-bounded",
            deadline_stage.is_some(),
            "Aggregate deadline scenario must select one recognized real native boundary"
        );
        let stage_barrier = std::env::var(STAGE_BARRIER_ENV).ok();
        assert_eq!(
            stage_barrier_scenario(&scenario),
            stage_barrier
                .as_deref()
                .is_some_and(|stage| ORIGINAL_BARRIER_STAGES.contains(&stage)),
            "Only a separately selected original qualification stage may activate native barrier"
        );
        let state = Arc::new(Acceptance {
            root: root.clone(),
            scenario,
            runtime_scenario,
            deadline_stage,
            deadline_armed: AtomicBool::new(false),
            deadline_triggered: AtomicBool::new(false),
            digest,
            alias,
            key,
            port,
            child: Mutex::new(pending_child.0.take()),
            initial_binding: Mutex::new(None),
            restarted_binding: Mutex::new(None),
            abc_bindings: Mutex::new(BTreeMap::new()),
            observed: Mutex::new(Vec::new()),
            report_written: Mutex::new(false),
            window_destroyed: AtomicBool::new(false),
            stage_barrier: Mutex::new(None),
        });
        let data = root.join("data");
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        context.config_mut().identifier = data.to_string_lossy().replace('\\', "/");
        context.config_mut().build.dev_url = Some(url.clone());
        let setup_root = root.clone();
        let setup_state = state.clone();
        tauri::Builder::default()
            .plugin(tauri_plugin_store::Builder::new().build())
            .manage(net::inference::InferenceState::default())
            .manage(memory::MemoryState::default())
            .manage(memory::project::freshness::FreshnessState::default())
            .manage(shell::ShellState::default())
            .manage(workspace::WorkspaceRegistry::default())
            .manage(state.clone())
            .on_window_event(|window, event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    window
                        .state::<net::inference::InferenceState>()
                        .close_owner(window.label());
                    if window.label() == "main" {
                        window
                            .state::<Arc<Acceptance>>()
                            .window_destroyed
                            .store(true, Ordering::SeqCst);
                    }
                }
            })
            .setup(move |app| {
                let app_data = app.path().app_data_dir()?;
                let app_local = app.path().app_local_data_dir()?;
                fs::create_dir_all(&app_data)?;
                fs::create_dir_all(&app_local)?;
                assert_eq!(
                    app_data.canonicalize()?,
                    setup_root.join("data"),
                    "ABORT: Tauri AppData is not the owned case/data directory"
                );
                assert!(
                    app_local.canonicalize()?.starts_with(&setup_root),
                    "ABORT: Tauri local AppData escaped case root"
                );
                let store = tauri_plugin_store::resolve_store_path(app.handle(), SETTING)?;
                assert_eq!(
                    store.parent().unwrap().canonicalize()?,
                    setup_root.join("data"),
                    "ABORT: authority file escaped case/data directory"
                );
                assert_eq!(store.file_name().unwrap(), SETTING);
                for leaf in [
                    "data/terax-settings.json",
                    "data/.terax-settings.json.lock",
                    "data/.terax-settings.json.replaced-backup",
                    "service-events.jsonl",
                ] {
                    ensure_safe_leaf(&setup_root, &setup_root.join(leaf))
                        .map_err(std::io::Error::other)?;
                }
                settings::self_hosted_profiles_startup_storage_check(app.handle())
                    .map_err(std::io::Error::other)?;
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                    .visible(false)
                    .data_directory(setup_root.join("webview"))
                    .build()?;
                if matches!(
                    setup_state.scenario.as_str(),
                    "window-close-preflight" | "window-close-stream" | "stage-close"
                ) {
                    WebviewWindowBuilder::new(
                        app,
                        "window-close-sentinel",
                        WebviewUrl::External("about:blank".parse().unwrap()),
                    )
                    .visible(false)
                    .data_directory(setup_root.join("inspect-webview"))
                    .build()?;
                }
                let watchdog = app.handle().clone();
                let timeout_state = setup_state.clone();
                thread::spawn(move || {
                    let window_close = matches!(
                        timeout_state.scenario.as_str(),
                        "window-close-preflight" | "window-close-stream" | "stage-close"
                    );
                    let bounded_deadline = timeout_state.scenario == "deadline-bounded"
                        || timeout_state.scenario == "stage-expiry"
                        || timeout_state.scenario == "original-postdeadline-provider-events"
                        || timeout_state.scenario == "original-managed-abc-deployments";
                    thread::sleep(Duration::from_secs(if window_close {
                        12
                    } else if bounded_deadline {
                        200
                    } else {
                        115
                    }));
                    if !*timeout_state
                        .report_written
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                    {
                        if window_close {
                            let leaf = timeout_state.root.join("native-window-close-report.json");
                            if ensure_safe_leaf(&timeout_state.root, &leaf).is_ok() {
                                let _ = write_json(
                                    &leaf,
                                    &json!({
                                        "scenario":timeout_state.scenario,
                                        "passed":false,"timedOut":true,"nativeTauriIpc":true,
                                        "originalWebviewCallerSucceeded":false,
                                        "modelRuntimeStarted":false,
                                    }),
                                );
                            }
                        }
                        watchdog.exit(124);
                    }
                });
                Ok(())
            })
            .invoke_handler({
                let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
                    Box::new(tauri::generate_handler![
                        lm11_acceptance_bind,
                        lm11_acceptance_abc_bind_child,
                        lm11_acceptance_abc_restart_a,
                        lm11_acceptance_abc_checkpoint,
                        lm11_acceptance_report,
                        lm11_acceptance_rotate_epoch,
                        lm11_acceptance_restart_child,
                        lm11_acceptance_stop_service,
                        lm11_acceptance_counts,
                        lm11_acceptance_runtime_activate,
                        lm11_acceptance_original_request_admission_fault,
                        lm11_acceptance_arm_cancel_ack,
                        lm11_acceptance_release_cancel_ack,
                        lm11_acceptance_postdeadline_emission,
                        lm11_acceptance_arm_deadline_stage,
                        lm11_acceptance_barrier_arm,
                        lm11_acceptance_barrier,
                        lm11_acceptance_barrier_status,
                        lm11_acceptance_barrier_release,
                        lm11_acceptance_barrier_terminal,
                        lm11_acceptance_corrupt_qualification_authority,
                        lm11_acceptance_arm_late_channel,
                        lm11_acceptance_release_original_lm2f_late_channel,
                        lm11_acceptance_close_window,
                        runtime::managed_local_runtime_status,
                        managed_local_runtime_route,
                        settings::self_hosted_profiles_snapshot,
                        settings::self_hosted_profiles_compare_and_swap,
                        settings::self_hosted_settings_entries,
                        settings::self_hosted_settings_set,
                        settings::self_hosted_settings_set_many,
                        settings::self_hosted_profiles_qualification_begin,
                        self_hosted_profiles_qualification_prepare,
                        self_hosted_profiles_qualification_acknowledge,
                        settings::self_hosted_profiles_qualification_cancel,
                        settings::self_hosted_profiles_qualification_reconcile,
                        ai_http_open,
                        net::inference::ai_http_request_quiescent,
                        net::inference::ai_http_cancel,
                        net::inference::ai_http_stream,
                        net::inference::ai_http_preflight,
                        memory::conversation_source_set,
                        memory::conversation_source_delete,
                        memory::conversation_session_get,
                        memory::conversation_session_entries,
                        memory::conversation_session_active,
                        memory::conversation_memory_load,
                        memory::conversation_memory_rebase,
                        memory::conversation_memory_sources,
                        memory::conversation_memory_extract_sources,
                        memory::conversation_memory_evidence,
                        memory::conversation_memory_commit,
                        memory::conversation_memory_cancel,
                        memory::fallback::conversation_fallback_describe,
                        memory::fallback::conversation_fallback_set,
                        memory::fallback::conversation_fallback_begin,
                        memory::fallback::conversation_fallback_boundary,
                        memory::target_context::target_context_begin,
                        memory::target_context::target_context_cancel,
                        memory::target_context::target_context_preview,
                        memory::target_context::target_context_load,
                        memory::project::project_memory_load,
                        memory::project::project_memory_inspect,
                        memory::project::freshness::project_memory_verify,
                        memory::project::freshness::project_memory_revalidate,
                        memory::retrieval::conversation_memory_retrieve,
                        memory::custom_tools::custom_tools_load,
                        memory::custom_tools::custom_tools_validate,
                        memory::custom_tools::execution::custom_tool_prepare,
                        memory::custom_tools::mcp::mcp_connections_load,
                        shell::shell_identity,
                    ]);
                move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                    let command = invoke.message.command().to_string();
                    let (id, origin) =
                        if matches!(command.as_str(), "ai_http_cancel" | "ai_http_stream") {
                            if let tauri::ipc::InvokeBody::Json(value) = invoke.message.payload() {
                                (
                                    value["requestId"].as_str().map(str::to_owned),
                                    value["cancellationOrigin"].as_str().map(str::to_owned),
                                )
                            } else {
                                (None, None)
                            }
                        } else {
                            (None, None)
                        };
                    if let Ok(mut observed) = state.observed.lock() {
                        observed.push((command.clone(), id.clone(), origin));
                    }
                    if command == "self_hosted_profiles_qualification_acknowledge"
                        && matches!(
                            state.scenario.as_str(),
                            "restart-pending" | "lost-native-ack"
                        )
                    {
                        let tauri::ipc::InvokeBody::Json(value) = invoke.message.payload() else {
                            std::process::exit(125);
                        };
                        let value = value["ticket"].clone();
                        let Ok(ticket) = serde_json::from_value::<settings::QualificationCasTicket>(
                            value.clone(),
                        ) else {
                            std::process::exit(125)
                        };
                        // The PREPARE IPC already returned to the renderer, so
                        // only real durable pending rows can precede this point.
                        if ensure_safe_leaf(
                            &state.root,
                            &state.root.join("native-qualification-ticket.json"),
                        )
                        .is_err()
                            || write_json(
                                &state.root.join("native-qualification-ticket.json"),
                                &value,
                            )
                            .is_err()
                        {
                            std::process::exit(125);
                        }
                        if state.scenario == "restart-pending" {
                            std::process::exit(173); // no ack and no renderer PASS
                        }
                        // Invoke the SAME production native acknowledgment, then
                        // lose its IPC response through an immediate real process
                        // exit. Nothing synthesizes its durable effect.
                        let app = invoke.message.webview().app_handle().clone();
                        if settings::self_hosted_profiles_qualification_acknowledge(app, ticket)
                            .as_deref()
                            == Ok("acknowledged")
                        {
                            std::process::exit(174);
                        }
                        std::process::exit(125);
                    }
                    let active_fault = active_runtime_mode(&state.root);
                    if active_fault.as_deref() == Some("registration-after-renderer-cancellation")
                        && command == "ai_http_open"
                    {
                        // Delay the ORIGINAL production handler (including native
                        // reservation creation), so renderer Stop wins registration.
                        thread::sleep(Duration::from_millis(290));
                    }
                    if state.scenario == "deadline-bounded"
                        && state.deadline_armed.load(Ordering::SeqCst)
                    {
                        let stage = state.deadline_stage.as_deref().unwrap_or("");
                        let after_dispatch = state.observed.lock().ok().is_some_and(|observed| {
                            observed.iter().any(|row| row.0 == "ai_http_stream")
                        });
                        let native_admission_observed =
                            state.observed.lock().ok().is_some_and(|observed| {
                                observed
                                    .iter()
                                    .filter(|row| row.0 == "managed_local_runtime_status")
                                    .count()
                                    >= 2
                                    && observed
                                        .iter()
                                        .filter(|row| row.0 == "managed_local_runtime_route")
                                        .count()
                                        >= 4
                            });
                        let provider_terminal_sent =
                            fs::read_to_string(state.root.join("service-events.jsonl"))
                                .ok()
                                .is_some_and(|events| {
                                    events.contains("\"phase\":\"synthetic-sse-done\"")
                                });
                        let phase_specific_boundary = match stage {
                            "session-writes" | "session-prepare" => native_admission_observed,
                            "persisted-chat-evidence" | "native-revalidation" | "cas-commit" => {
                                provider_terminal_sent
                            }
                            _ => true,
                        };
                        if deadline_stage_matches(stage, &command, after_dispatch)
                            && phase_specific_boundary
                            && state
                                .deadline_triggered
                                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                                .is_ok()
                        {
                            let proof = state.root.join("deadline-stage-hit.json");
                            let armed = state.root.join("deadline-stage-armed.json");
                            let valid = ensure_safe_leaf(&state.root, &proof).is_ok()
                                && ensure_safe_leaf(&state.root, &armed).is_ok()
                                && fs::read(&armed)
                                    .ok()
                                    .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                                    .is_some_and(|v| {
                                        v["stage"] == stage
                                            && v["nativeDelayMs"] == 123500
                                            && v["realOriginalBudgetMs"] == 120000
                                            && v["syntheticOnly"] == true
                                    });
                            if !valid
                                || write_json(
                                    &proof,
                                    &json!({
                                        "stage":stage,"originalProductionCommand":command,
                                        "nativeDelayMs":123500,"realOriginalBudgetMs":120000,
                                        "syntheticOnly":true,"nativeBarrierEntered":true,
                                    }),
                                )
                                .is_err()
                            {
                                invoke
                                    .resolver
                                    .reject("Owned aggregate deadline barrier refused");
                                return true;
                            }
                            // Do not manipulate the JS clock or original 120s
                            // QualificationOperationDeadline. This is an actual
                            // native IPC completion withheld past its wall budget.
                            thread::sleep(Duration::from_millis(123_500));
                        }
                    }
                    handler(invoke)
                }
            })
            .build(context)
            .expect("Isolated Tauri/Wry acceptance host")
            .run(|app, event| {
                if matches!(event, tauri::RunEvent::Exit) {
                    app.state::<net::inference::InferenceState>().shutdown();
                    runtime::shutdown();
                    if let Ok(mut remaining) = app.state::<Arc<Acceptance>>().child.lock() {
                        if let Some(mut child) = remaining.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            });
    }
}
