/**
 * LM11 B03 FULL SYNTHETIC PERSISTENCE/RESTART MATRIX — CONTRACT ONLY.
 *
 * This is an auditable inventory, not an executable qualification harness.
 * Importing it, running --validate or --list never starts Wry, a process,
 * inference, a model, or writes case/production state. None of these 25 rows
 * is marked accepted by the separately authorized new full matrix.
 *
 * Numbering B03-01..20 and E-01..05 is local to THIS proposed matrix. The
 * older checkpoint sources do not assign canonical numbered B03 case IDs.
 *
 * Source of existing physical evidence:
 *  - scripts/lm11-authenticated-webview-acceptance.mjs, original renderer
 *    runManagedChatQualification + Tauri IPC + synthetic HTTP/SSE;
 *  - src-tauri/examples/lm11_authenticated_webview_acceptance.rs;
 *  - src-tauri/examples/lm11_b03_native_restart_acceptance.rs, a separate
 *    AppHandle/native command host, with NO original JS renderer;
 *  - docs/LM11_LM15_LOCAL_MODEL_QUALIFICATION.md:319-370;
 *  - docs/AGENT_ENGINEERING_STATE.md:3-15,31-59.
 *
 * Physical observations listed below are PREVIOUS infrastructure evidence,
 * never proof that this proposed complete 20+5 matrix has been executed.
 */

export const B03_EVIDENCE_LEVELS = Object.freeze({
  renderer: "original-renderer-through-native-effect-and-terminal",
  rendererRejected: "original-renderer-physical-120s-rejection-before-native-commit",
  rendererThenInspector: "original-renderer-then-separate-native-only-restart-inspector",
  rendererCrash: "original-renderer-reached-native-ack-then-host-exited-no-renderer-terminal",
  rendererStage: "original-renderer-stage-reachable-but-exact-fault-not-executed",
  native: "previous-native-only-AppHandle-physical-prerequisite",
  offline: "offline-test-only-no-physical-original-renderer-fault",
  none: "not-physically-executed",
});

const shared = Object.freeze({
  entry: "original runManagedChatQualification(selectionId) and its unchanged QualificationOperationDeadline(120000)",
  authority: "existing selfHostedInference/terax-settings.json native BEGIN -> PREPARE -> ACK -> snapshot and read-only reconcile",
  environment: "unique canonical Wry cases/<id>/data, authenticated synthetic child real PID/epoch/key, no model/GGUF/GPU/ForgeBoard/Lab Run",
  invariant: "one original session and native ticket; no second qualification dispatch or retry-to-PASS; no other production writes",
});

function row(id, name, evidenceLevel, observed, trigger, expectedCaller, expectedDisk, missingHostProof) {
  return Object.freeze({
    id, name, evidenceLevel, observed, trigger, expectedCaller, expectedDisk,
    missingHostProof,
    fullMatrixPhysicallyExecuted: false,
    required: shared,
  });
}

export const B03_PERSISTENCE_20 = Object.freeze([
  row("B03-01", "Normal one-shot commit and exact renderer readback",
    B03_EVIDENCE_LEVELS.renderer,
    "Wry normal executed original Chat/evaluator; one native BEGIN/PREPARE/ACK, snapshot and four v2 acknowledged receipts",
    "qualify one authenticated synthetic Ready deployment",
    "verified only after original native ACK and exact readback",
    "four unique capabilities, one ticket, v2 acknowledged, single revision transition",
    "Fresh full-matrix case/evidence still required; old Wry normal proves only its isolated infrastructure mode"),
  row("B03-02", "PREPARE produces inert pending evidence before ACK",
    B03_EVIDENCE_LEVELS.renderer,
    "Wry b03-before-acknowledge reachability resumed original success; native-only prepare-only and restart-pending inspected v0",
    "hold original production B03 before ACK; inspect native pending then release",
    "no verified receipt until actual ACK and readback",
    "four v0 pending rows before ACK; one v2 acknowledged set after release",
    "Capture immutable intermediate disk hash/phase while original renderer is held, then original result"),
  row("B03-03", "ACK is an independent original renderer boundary",
    B03_EVIDENCE_LEVELS.renderer,
    "Wry b03-before-acknowledge one-shot reachability then original successful qualification",
    "arm/release stage b03-before-acknowledge on the original qualification session",
    "verified only after ACK and readback",
    "one ticket, exactly one native ACK and active v2 receipt set",
    "Record exact ACK IPC/ticket/renderer session and phase before/after; no duplicate activation"),
  row("B03-04", "Post-ACK snapshot readback is an independent renderer boundary",
    B03_EVIDENCE_LEVELS.renderer,
    "Wry b03-before-readback one-shot reachability resumed original success after real ACK",
    "hold original operation after native ACK, before snapshot and exact marker comparison",
    "verified only on unrevoked operation and exact native readback",
    "ACK may already be durable; four v2 acknowledged rows remain",
    "Capture actual post-ACK revision/bytes and assert original exact readback, no proposal-only success"),
  row("B03-05", "Missing or stale acknowledged snapshot cannot certify PASS",
    B03_EVIDENCE_LEVELS.offline,
    "selfHostedQualificationCas.test.ts rejects acknowledged IPC with unmarked/stale native snapshot",
    "make original renderer readback return stale/unmarked/corrupt evidence AFTER real native ACK",
    "rejected/Unknown, never new verified outcome",
    "independent authoritative disk remains whatever native actually committed; reconcile read-only",
    "Feature-only response fault on original snapshot IPC; independently inspect authoritative file and do not falsify stored bytes"),
  row("B03-06", "Full aggregate deadline before PREPARE",
    B03_EVIDENCE_LEVELS.rendererRejected,
    "Physical Wry b03-before-prepare 120090ms original deadline rejection; zero activated receipts",
    "hold original b03-before-prepare barrier beyond original 120000ms then release",
    "original qualification rejects within its existing 120s budget",
    "no v2 activated receipt; no late native PREPARE after release",
    "New full-matrix case preserves original timer and validates exact native PREPARE count/absence"),
  row("B03-07", "No ACK or precommit loss leaves pending inert",
    B03_EVIDENCE_LEVELS.rendererCrash,
    "Wry restart-pending intercept exits host 173 at original ACK IPC; fresh native inspector returns not-committed; no renderer report",
    "lose ACK before calling production native acknowledge / crash before real replacement",
    "original renderer terminal absent or Unknown, never retrospectively PASS",
    "version 0 pending only; fresh restart not-committed; staging never replayed",
    "Keep original IPC receipt absent and independent native restart; distinct pre-replace physical crash from ACK-entry short circuit"),
  row("B03-08", "User Stop after true native ACK but before readback",
    B03_EVIDENCE_LEVELS.rendererStage,
    "Wry b03-before-readback reachable, native-only post-replacement cancellation retains committed; ORIGINAL Stop at B03 is unexecuted",
    "at held original b03-before-readback invoke genuine cancelSessionInference(originalSessionId), then release",
    "original rejected/cancelled and never retroactively PASS",
    "already acknowledged v2 remains committed; reconcile committed and never replay",
    "Potential production defect: snapshotConsumed flight cancellation currently returns before stopping active operation; fix narrowly if confirmed"),
  row("B03-09", "Full 120s expiry after true ACK before readback",
    B03_EVIDENCE_LEVELS.rendererStage,
    "Wry b03-before-readback stage reachable; native-only post-replace deadline retains committed; full 120s Wry expiry here not executed",
    "hold original b03-before-readback until original QualificationOperationDeadline(120000) rejects, then release",
    "original rejected at cas-commit with elapsed physical >=119s, no retroactive PASS",
    "v2 acknowledged effect remains committed, restart reconcile committed",
    "Run real original stage-expiry and separately assert the already-committed rows; zero-receipt expectation would be false"),
  row("B03-10", "Crash after real replacement before native ACK IPC reply",
    B03_EVIDENCE_LEVELS.rendererCrash,
    "Wry lost-native-ack intercepted original IPC, called native ACK then exited 174; fresh native inspector committed; earlier native host actual post-ReplaceFileW crash",
    "physically kill exact owned host after native ReplaceFileW succeeded but before renderer can receive ACK",
    "no original renderer PASS because its process died",
    "four v2 acknowledged rows, fresh process committed, no replay",
    "Attach exact physical replacement marker to original renderer-issued ticket; independent real restart and original report absence"),
  row("B03-11", "Late ACK or delayed readback after postcommit cancellation",
    B03_EVIDENCE_LEVELS.rendererStage,
    "Wry b03-before-readback reachable; offline late native ACK cancellation checks; no original renderer late-postcommit result case",
    "hold/readback native IPC, cancel original operation, then return delayed real ACK/readback response",
    "original never upgrades Unknown/cancelled to PASS",
    "if ACK crossed, durable v2 committed; otherwise v0 pending/not-committed",
    "Observe original callback/result and exact native replace boundary; reject false acceptance even if readback later proves committed"),
  row("B03-12", "Restart preserves acknowledged authority and unrelated keys",
    B03_EVIDENCE_LEVELS.rendererThenInspector,
    "Wry restart-acknowledged runs original renderer success then separately launches native-only about:blank restart inspector: committed",
    "successful original qualification; terminate host and open fresh Tauri native reader of same case bytes",
    "original already verified in preceding process; no new renderer promotion on restart",
    "same acknowledged ticket/revision/hash and unrelated preferences after native restart",
    "Full case link both process IDs, original renderer terminal and isolated restart, with no second qualification invocation"),
  row("B03-13", "Corrupt/missing settings and fallback are fail closed",
    B03_EVIDENCE_LEVELS.rendererThenInspector,
    "Wry corrupt-settings original renderer success + native-only inspector pending-reconciliation; native-only backup/corruption recovery variants",
    "mutate only owned case authority after baseline; restart into malformed main, missing main, valid or invalid backup",
    "no fresh verified qualification from corrupt/unknown bytes",
    "pending-reconciliation on corrupt uncertainty; valid prior backup restored without adopting uncommitted temp",
    "Separate malformed/missing/backup subcases and verify source bytes, no plugin Store empty-fallback overwrite"),
  row("B03-14", "Exact old ticket ACK replay after original success",
    B03_EVIDENCE_LEVELS.renderer,
    "Wry duplicate-ticket first executes original runner, then explicit renderer IPC old-ticket ACK rejected and reconcile committed",
    "repeat native ACK with exact old operationId/nativeEpoch and compare before/after",
    "prior original qualification stays verified; replay itself cannot create a second success",
    "one unchanged v2 receipt set; old ticket reconciles committed",
    "Keep replay differentiated from a second complete original Chat qualification; require exact immutable disk bytes after replay"),
  row("B03-15", "Same-epoch new ticket and cross-restart replay are denied",
    B03_EVIDENCE_LEVELS.native,
    "Native-only Tauri host replay/restart-replay rejects old ACK and new same-epoch BEGIN; Wry has no full original second-operation case",
    "start a new original renderer qualification in same deployment/runtime epoch after first acknowledged or ambiguous ticket",
    "second operation rejected/Unknown, no new PASS",
    "one prior acknowledged set only; old read-only reconcile committed",
    "Wire original second Chat and genuine fresh app restart; assert zero second native PREPARE/ACK or receipt set"),
  row("B03-16", "New runtime epoch may recover from old inert pending",
    B03_EVIDENCE_LEVELS.native,
    "Native-only new-epoch-after-pending commits one new scoped ticket while old remains pending; Wry child A→B stale ticket checks are direct native IPC",
    "after old pending unresolved ticket, genuine authenticated different PID/epoch B launches original B qualification",
    "old original never becomes PASS; new B may verify only on its own evidence",
    "old four v0 pending rows unchanged, new scoped v2 acknowledged set; no old-ticket replay",
    "Original renderer A and B runs with exact different process/epoch/key plus independent restart reconcile"),
  row("B03-17", "CAS conflict during original PREPARE is single-attempt rejection",
    B03_EVIDENCE_LEVELS.offline,
    "Production native compares current snapshot at prepare; TS offline mock conflict rejects and never retries; no Wry competing writer physical case",
    "after original snapshot before native PREPARE, competing ordinary settings CAS changes the same authority revision",
    "original B03 rejects definite conflict, no 8-attempt qualifying retry",
    "competing legitimate settings preserved, zero new v2 qualifying rows from stale proposal",
    "Two real actors with deterministic stage barrier around original snapshot/prepare, explicit changed bytes/revisions and IPC counts"),
  row("B03-18", "Ordinary settings and qualification share one physical authority",
    B03_EVIDENCE_LEVELS.native,
    "Native-only real ordinary-write-after-recovery preserved qualified marker and unrelated keys; Wry read-only inspector rejects ordinary write",
    "ordinary writer before/after qualifying CAS on same canonical terax-settings.json",
    "normal qualifying result only when same revision/ticket remains current",
    "no lost unrelated key, no marker deletion, all writers serialized by native/OS file lock",
    "Original renderer qualification with real concurrent ordinary write and verified read views, not a separate native AppHandle only"),
  row("B03-19", "Two same-deployment original qualifications race",
    B03_EVIDENCE_LEVELS.none,
    "Existing Wry concurrent-owner-cancel tests two ai_http_open inference IDs, NOT two B03 CAS owners; JS active and native QUAL_GATE only offline verified",
    "launch two independently owned original renderer operations (two same-app WebViews) against one deployment/native authority",
    "at most one original operation verified; the other denied/Unknown",
    "one qualifying set for current epoch; one native gate and serialized same key with no duplicate",
    "Add second original renderer in same Wry app, independent sessions, competing BEGIN/PREPARE/ACK, deterministic scheduling and exact outcomes"),
  row("B03-20", "Unknown commit reconciliation never promotes or retries",
    B03_EVIDENCE_LEVELS.native,
    "Native-only interrupted/invalid backup and staged-temp cases report pending-reconciliation or committed/not-committed from authoritative bytes; TS offline no retry",
    "lose native response/restart with missing/corrupt authority and ambiguous commit evidence",
    "original Unknown remains Unknown forever; fresh reader does not grant retroactive PASS",
    "read-only committed/not-committed/pending-reconciliation as dictated by bytes; no new CAS, no replay",
    "Original renderer ambiguous result + independent restart and dual original/session reconciliation evidence; no retries under missing file"),
]);

export const E_CONCURRENT_5 = Object.freeze([
  row("E-01", "Two original calls inside one renderer module",
    B03_EVIDENCE_LEVELS.offline,
    "Production JS active guard prevents overlapping executeManagedChatQualification; no physical two-original-call Wry case",
    "call the same original runner concurrently in one renderer module",
    "exactly one admitted; second immediately rejected",
    "one ticket/qualified set at most",
    "Expose two genuine original caller promises, inspect one native BEGIN and preserve exact independent terminal states"),
  row("E-02", "Two WebViews competing for same deployment in one Tauri app",
    B03_EVIDENCE_LEVELS.none,
    "Not physically executed; separate WebViews have independent module-level active flags but share native QUAL_GATE",
    "simultaneously invoke original qualification from two real same-app renderer windows",
    "one admitted; other denied/Unknown without retries",
    "one qualifying effect and one native epoch owner; no duplicated capability keys",
    "Feature-only second WebView, exact same native AppData/owner, synchronized original BEGIN/PREPARE stages and separate sessions"),
  row("E-03", "Competing first and second operation across restart",
    B03_EVIDENCE_LEVELS.native,
    "Native-only old-operation replay and new-epoch-after-pending passed; no full renderer A/B qualification sequence",
    "kill original A with pending/acknowledged ticket; authenticate real new B PID/epoch and run original B",
    "dead A cannot PASS; B uses only its own new evidence and independent ticket",
    "old markers never reactivated, new epoch distinct, read-only reconciliation exact",
    "Do not treat two independent native AppHandles or old direct IPC as original A/B renderer competition"),
  row("E-04", "Ordinary settings writer competes with qualifying CAS",
    B03_EVIDENCE_LEVELS.native,
    "Native-only ordinary persistence/lock tests; Wry original qualification lacks an interleaved competing writer",
    "hold original native PREPARE, commit competing ordinary preference revision, release",
    "qualifying CAS conflict rejected, never retried into success",
    "ordinary preference persists; no stale qualifying activation",
    "Deterministic same-key atomic interleaving, two actual renderer IPC actors and native snapshot/phase counters"),
  row("E-05", "Cancellation of one competing owner does not promote its sibling",
    B03_EVIDENCE_LEVELS.none,
    "Wry concurrent-owner-cancel only isolates inference IDs, not two same-deployment qualification tickets",
    "two original WebView qualification owners; cancel A before/after native fence while B contends",
    "cancelled A never PASS; B independently succeeds only if fresh epoch/gate admits it",
    "at most one committed ticket for same epoch and no replay of A",
    "Real operation-level cancellation in original renderer and exact native current gate; observe both original terminal results"),
]);

export const B03_FAILURE_SEMANTICS_13 = Object.freeze([
  { id: "F-01", fault: "pre-B03 deadline", caller: "rejected", disk: "no acknowledged rows" },
  { id: "F-02", fault: "PREPARE CAS conflict", caller: "rejected", disk: "competing revision unchanged by stale operation" },
  { id: "F-03", fault: "native pre-fence cancellation", caller: "rejected", disk: "pending v0 or absent; not-committed" },
  { id: "F-04", fault: "native pre-fence deadline", caller: "rejected", disk: "pending v0 or absent; not-committed" },
  { id: "F-05", fault: "native stale runtime PID/epoch", caller: "rejected", disk: "old ticket cannot activate" },
  { id: "F-06", fault: "real process crash before ReplaceFileW", caller: "absent/Unknown", disk: "pending v0; not-committed" },
  { id: "F-07", fault: "real process crash after ReplaceFileW", caller: "absent/Unknown", disk: "v2 acknowledged; committed" },
  { id: "F-08", fault: "lost native ACK after commit", caller: "Unknown, no retroactive PASS", disk: "v2 acknowledged; committed" },
  { id: "F-09", fault: "real user Stop after commit", caller: "cancelled/rejected", disk: "v2 acknowledged; committed" },
  { id: "F-10", fault: "real 120s deadline after commit", caller: "rejected", disk: "v2 acknowledged; committed" },
  { id: "F-11", fault: "corrupt/missing authoritative backup", caller: "Unknown", disk: "pending-reconciliation, bytes preserved" },
  { id: "F-12", fault: "read-only or simulated disk-full before replacement", caller: "rejected/Unknown", disk: "no newly acknowledged receipt" },
  { id: "F-13", fault: "same-epoch replay or concurrent duplicate", caller: "second denied/Unknown", disk: "at most one acknowledged group" },
].map(Object.freeze));

/** Stage seams already available, but observed one-shot REACHABILITY is not
 * a separately executed fault, 120s expiry, native crash or CAS race. */
export const REQUIRED_HOST_ADAPTATIONS = Object.freeze([
  "Keep the original production QualificationOperationDeadline(120000) as the sole operation timer; no shortened fake deadline, arbitrary clock adjustment or acceptance-only second commit.",
  "Extend only the feature-gated Wry host scenario selector/one-use IPC barriers, key by original qualification session, ticket operationId/nativeEpoch, canonical case path and actual child PID/epoch; never intercept ordinary production builds.",
  "At b03-before-prepare, b03-before-acknowledge and b03-before-readback, capture separately actual original IPC hit, durable pending/acknowledged phase, exact ACK result and snapshot state; a stage armed but unhit is a failed case.",
  "For physical pre/post ReplaceFileW faults, existing lm11-b03-acceptance-harness Rust cfg hooks must be adapted to the *Wry* fixed case root as well; their current helper accepts only the different old native-only root. Do not enable either fault against production AppData.",
  "Hold the true original B03 after-ACK/readback boundary to induce genuine Stop or 120s expiry; observe original caller rejected and read-only committed-on-restart without rollback, second ACK or retrospective PASS.",
  "Real Stop must flow through cancelSessionInference(originalSessionId). The current snapshotConsumed early-return can leave an active operation running after quiescence; narrowly stop only its still-open existing operation without removing dispatch tombstone, preserving cancelChallenge behavior.",
  "For lost ACK/crash replay, independently restart a new Tauri process, reconcile the same exact native ticket read-only and compare authoritative bytes/backup/temp hashes; an inspector is a native-only prerequisite, not a new original renderer result.",
  "For CAS conflict and same-deployment concurrency, use two independent original renderer calls/WebViews sharing the same one Wry native gate and canonical store; one-window two inference IDs do not establish B03 competition.",
  "Record before/after: original terminal or demonstrably absent terminal, original session/native request/ticket IDs, one authenticated synthetic POST, exact BEGIN/PREPARE/ACK/snapshot counts, persisted revision/phase/capabilities, plugin read view and unrelated settings, fresh restart reconciliation, zero unauthorized writes/process residue.",
]);

export function validateB03PersistenceContract() {
  const check = (rows, prefix, count) => {
    if (rows.length !== count) throw new Error(`Expected ${count} ${prefix} rows; got ${rows.length}`);
    for (const [i, value] of rows.entries()) {
      const id = `${prefix}-${String(i + 1).padStart(2, "0")}`;
      if (value.id !== id || !Object.values(B03_EVIDENCE_LEVELS).includes(value.evidenceLevel) ||
          !value.observed || !value.trigger || !value.expectedCaller || !value.expectedDisk ||
          !value.missingHostProof || value.fullMatrixPhysicallyExecuted !== false)
        throw new Error(`Incomplete or inflated ${id} B03 evidence contract`);
    }
  };
  check(B03_PERSISTENCE_20, "B03", 20);
  check(E_CONCURRENT_5, "E", 5);
  if (B03_FAILURE_SEMANTICS_13.length !== 13 ||
      new Set(B03_FAILURE_SEMANTICS_13.map(v => v.id)).size !== 13 ||
      REQUIRED_HOST_ADAPTATIONS.length < 9)
    throw new Error("Failure semantics or host adaptation contract incomplete");
  return {
    b03Cases: B03_PERSISTENCE_20.length,
    concurrentCases: E_CONCURRENT_5.length,
    failureSemantics: B03_FAILURE_SEMANTICS_13.length,
    fullMatrixPhysicallyExecuted: 0,
    fullMatrixAccepted: false,
    qualificationLabRunEnabled: false,
    requiresOriginalRendererAndNativeAuthority: true,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/").replace(/^\/+/, "")}`).href) {
  const option = process.argv[2] ?? "--validate";
  if (!["--validate", "--list", "--json"].includes(option) || process.argv.length > 3) {
    throw new Error("Read-only contract flags: --validate, --list, --json; no physical run mode");
  }
  const validation = validateB03PersistenceContract();
  if (option === "--validate") console.log(JSON.stringify(validation, null, 2));
  else if (option === "--list") {
    for (const item of [...B03_PERSISTENCE_20, ...E_CONCURRENT_5])
      console.log(`${item.id}\t${item.evidenceLevel}\t${item.name}\tfull-matrix=NOT-RUN`);
  } else console.log(JSON.stringify({ validation, b03: B03_PERSISTENCE_20,
    concurrent: E_CONCURRENT_5, failures: B03_FAILURE_SEMANTICS_13,
    hostAdaptations: REQUIRED_HOST_ADAPTATIONS }, null, 2));
}
