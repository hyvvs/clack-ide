/**
 * LM11 model-free acceptance planning contract for B02 and C.
 *
 * Declarative only: importing this module starts no process, opens no port,
 * changes no production source, and does not upgrade historical Wry evidence.
 * An actual original-runner observation is necessary to turn a case into PASS.
 * The existing harness opens and cancels inference-1 before qualification;
 * all request/stream counts here are DELTAS after that fixed control.
 */

export const ORIGINAL_BARRIER_STAGES = Object.freeze([
  'preparation-complete', 'predispatch', 'after-ai-http-open',
  'first-output', 'terminal-delivery', 'quiescence-complete',
  'before-evidence-acceptance', 'b03-before-prepare',
  'b03-before-acknowledge', 'b03-before-readback',
]);

const zeroCas = Object.freeze({ begin: 0, prepare: 0, acknowledge: 0, receipts: 'zero' });

function b02(id, label, trigger, options) {
  return Object.freeze({
    id, label,
    trigger: Object.freeze(trigger),
    authority: options.authority,
    harnessCoverage: options.harnessCoverage,
    expectedAtHold: Object.freeze({
      nativeCas: Object.freeze(options.nativeCas ?? zeroCas),
    }),
    expectedAfterRelease: Object.freeze({
      // Native registration held mid-IPC can finish only AFTER cancellation.
      // These are final deltas, never a claim that ai_http_open had returned
      // while the registration-pending boundary was held.
      nativeOpenDelta: options.open,
      nativeStreamDelta: options.stream,
      successfulChatPostDelta: options.post,
      originalRunner: options.authority === 'active-flight' ? 'rejected' : 'unknown-until-proven',
      extraNativeStreamDelta: 0,
      originalCancel: options.cancel,
      qualificationReceipt: options.authority === 'active-flight'
        ? 'zero-acknowledged'
        : 'must-reconcile-actual-existing-effect',
      noRetroactivePassAfterTerminal: true,
    }),
    limitation: options.limitation,
  });
}

/**
 * B02-01..15 each needs its own fresh original runManagedChatQualification
 * WebView case. `stage-hook-ready` means the original native one-shot hold
 * exists, NOT that the stage-cancel scenario or physical cancellation passed.
 * `blocked-flight-disarmed` means cancelSessionInference alone no longer
 * revokes the original 120s operation at this point in current source.
 */
export const B02_CANCELLATION_CASES = Object.freeze([
  b02('B02-01', 'Cancel during native Ready status',
    { kind: 'native-command-hold-needed', phase: 'native-status' },
    { authority: 'active-flight', harnessCoverage: 'blocked-no-original-hold', open: 0, stream: 0, post: 0,
      cancel: 'no-original-native-id', limitation: 'Status IPC needs a bounded original-session hold and an independently observed cancellation before it returns' }),
  b02('B02-02', 'Cancel during native route admission',
    { kind: 'native-command-hold-needed', phase: 'native-admission' },
    { authority: 'active-flight', harnessCoverage: 'blocked-no-original-hold', open: 0, stream: 0, post: 0,
      cancel: 'no-original-native-id', limitation: 'Existing 123.5s deadline interception is not a short cancellable one-shot stage' }),
  b02('B02-03', 'Cancel while session writes are pending',
    { kind: 'native-command-hold-needed', phase: 'session-writes' },
    { authority: 'active-flight', harnessCoverage: 'blocked-no-original-hold', open: 0, stream: 0, post: 0,
      cancel: 'no-original-native-id', limitation: 'Requires distinct held original conversation write and release after Stop' }),
  b02('B02-04', 'Cancel while session preparation is pending',
    { kind: 'native-command-hold-needed', phase: 'session-prepare' },
    { authority: 'active-flight', harnessCoverage: 'blocked-no-original-hold', open: 0, stream: 0, post: 0,
      cancel: 'no-original-native-id', limitation: 'Requires exact original prepare IPC held before transport registration' }),
  b02('B02-05', 'Cancel after real Chat request preparation',
    { kind: 'original-stage-barrier', stage: 'preparation-complete' },
    { authority: 'active-flight', harnessCoverage: 'stage-hook-ready-host-cancel-missing', open: 0, stream: 0, post: 0,
      cancel: 'no-original-native-id', limitation: 'First original native HTTP ID must never be opened after barrier release' }),
  b02('B02-06', 'Cancel while ai_http_open has not returned',
    { kind: 'native-command-hold-needed', phase: 'registration-pending' },
    { authority: 'active-flight', harnessCoverage: 'direct-proxy-only-original-hold-blocked', open: 1, stream: 0, post: 0,
      cancel: 'exact-original-id-required', limitation: 'Direct proxy registration-after-renderer-cancellation exists, but original runManagedChatQualification pending-open hold does not' }),
  b02('B02-07', 'Cancel at last predispatch authority check',
    { kind: 'original-stage-barrier', stage: 'predispatch' },
    { authority: 'active-flight', harnessCoverage: 'stage-hook-ready-host-cancel-missing', open: 1, stream: 0, post: 0,
      cancel: 'exact-original-id-required', limitation: 'Release only after original Stop; exactly owned ID cancelled; zero ai_http_stream' }),
  b02('B02-08', 'Cancel immediately after native request registration',
    { kind: 'original-stage-barrier', stage: 'after-ai-http-open' },
    { authority: 'active-flight', harnessCoverage: 'stage-hook-ready-host-cancel-missing', open: 1, stream: 0, post: 0,
      cancel: 'exact-original-id-required', limitation: 'Registration is complete but final native stream has not been sent' }),
  b02('B02-09', 'Cancel as first original Channel output is held',
    { kind: 'original-stage-barrier', stage: 'first-output' },
    { authority: 'active-flight', harnessCoverage: 'stage-hook-ready-host-cancel-missing', open: 1, stream: 1, post: 1,
      cancel: 'exact-original-id-if-active', limitation: 'Native response/terminal may race ahead of held original Channel delivery' }),
  b02('B02-10', 'Cancel while original terminal callback is held',
    { kind: 'original-stage-barrier', stage: 'terminal-delivery' },
    { authority: 'active-flight', harnessCoverage: 'stage-hook-ready-host-cancel-missing', open: 1, stream: 1, post: 1,
      cancel: 'exact-original-id-if-active', limitation: 'Actual settled Channel event is held; do not infer native request still live' }),
  b02('B02-11', 'Cancel after SDK/native quiescence before disarm',
    { kind: 'original-stage-barrier', stage: 'quiescence-complete' },
    { authority: 'active-flight', harnessCoverage: 'stage-hook-ready-host-cancel-missing', open: 1, stream: 1, post: 1,
      cancel: 'already-native-terminal', limitation: 'Native stream has already settled; cancellation must still deny later evidence/CAS' }),
  b02('B02-12', 'Late Stop at evidence acceptance',
    { kind: 'original-stage-barrier', stage: 'before-evidence-acceptance' },
    { authority: 'flight-already-disarmed', harnessCoverage: 'blocked-flight-disarmed', open: 1, stream: 1, post: 1,
      cancel: 'already-native-terminal', limitation: 'Original flight is snapshotConsumed after bounded-request; cancelSessionInference does not revoke the 120s operation here' }),
  b02('B02-13', 'Late Stop before native B03 prepare',
    { kind: 'original-stage-barrier', stage: 'b03-before-prepare' },
    { authority: 'flight-already-disarmed', harnessCoverage: 'blocked-flight-disarmed', open: 1, stream: 1, post: 1,
      nativeCas: { begin: 1, prepare: 0, acknowledge: 0, receipts: 'zero' },
      cancel: 'already-native-terminal', limitation: 'Original CAS ticket exists; flight Stop cannot revoke it after disarm' }),
  b02('B02-14', 'Late Stop after inert native B03 prepare',
    { kind: 'original-stage-barrier', stage: 'b03-before-acknowledge' },
    { authority: 'flight-already-disarmed', harnessCoverage: 'blocked-flight-disarmed', open: 1, stream: 1, post: 1,
      nativeCas: { begin: 1, prepare: 1, acknowledge: 0, receipts: 'pending-v0-only' },
      cancel: 'already-native-terminal', limitation: 'Four inert pending version-0 rows may exist; do not claim zero stored records or a completed qualifying commit' }),
  b02('B02-15', 'Late Stop after B03 activation before readback',
    { kind: 'original-stage-barrier', stage: 'b03-before-readback' },
    { authority: 'flight-already-disarmed', harnessCoverage: 'blocked-already-committed', open: 1, stream: 1, post: 1,
      nativeCas: { begin: 1, prepare: 1, acknowledge: 1, receipts: 'acknowledged-v2' },
      cancel: 'already-native-terminal', limitation: 'Native ACK already crossed qualifying replacement; reconcile exact old ticket and never demand rollback or retroactive caller PASS' }),
]);

const c12Invariants = Object.freeze({
  C01: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'cancelled',
    exactNativeCancel: 'original-active-id', lateBoundary: 'original-callback-or-cleanup', b03: 'zero', chatTask: 'unchanged-after-late' },
  C02: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'cancelled',
    exactNativeCancel: 'original-active-id', lateBoundary: 'duplicate-settled-or-cleanup', b03: 'zero', chatTask: 'unchanged-after-late' },
  C03: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'interrupted-by-real-child-restart',
    exactNativeCancel: 'original-owner-only', lateBoundary: 'original-event-or-structural-disposal', b03: 'zero', chatTask: 'unchanged-after-B-ready' },
  C04: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'cancelled',
    exactNativeCancel: 'target-id', lateBoundary: 'injected-native-channel-chunk-delivered', b03: 'zero', chatTask: 'not-applicable-direct-native' },
  C05: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'cancelled',
    exactNativeCancel: 'target-id', lateBoundary: 'injected-native-channel-duplicate-delivered', b03: 'zero', chatTask: 'not-applicable-direct-native' },
  C06: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'completed',
    exactNativeCancel: 'not-required', lateBoundary: 'injected-native-channel-chunk-delivered', b03: 'zero', chatTask: 'not-applicable-direct-native' },
  C07: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'completed',
    exactNativeCancel: 'not-required', lateBoundary: 'injected-native-channel-duplicate-delivered', b03: 'zero', chatTask: 'not-applicable-direct-native' },
  C08: { nativeOpenDelta: 1, nativeStreamDelta: 0, nativeTerminal: 'cancelled-before-dispatch',
    exactNativeCancel: 'late-own-id', lateBoundary: 'native-registration-after-renderer-abort', b03: 'zero', chatTask: 'not-applicable-direct-proxy' },
  C09: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'completed-or-cancelled-once',
    exactNativeCancel: 'target-id-if-cancel-wins', lateBoundary: 'one-terminal-only', b03: 'zero', chatTask: 'not-applicable-direct-native' },
  C10: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'cancelled',
    exactNativeCancel: 'target-id', lateBoundary: 'ack-after-native-drain-delayed', b03: 'zero', chatTask: 'not-applicable-direct-native' },
  C11: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'cancelled',
    exactNativeCancel: 'target-id', lateBoundary: 'ack-after-native-drain-failed', b03: 'zero', chatTask: 'not-applicable-direct-native' },
  C12: { nativeOpenDelta: 1, nativeStreamDelta: 1, nativeTerminal: 'cancelled',
    exactNativeCancel: 'target-id', lateBoundary: 'native-late-frame-rejected', b03: 'zero', chatTask: 'not-applicable-direct-native' },
});

function c12(id, label, scenario, observation, coverage, limitation) {
  return Object.freeze({
    id, label, scenario: Object.freeze(scenario), observation,
    expected: Object.freeze(c12Invariants[id]),
    coverage, matrixVerdict: 'not-executed-as-independent-original-runner-case',
    limitation,
  });
}

/**
 * Twelve distinct late/race observations to seek. Several share a previous
 * Wry invocation. Direct native/transport probes never satisfy a production
 * runManagedChatQualification + SDK + B03 matrix case on their own.
 */
export const C12_LATE_RACE_CASES = Object.freeze([
  c12('C01', 'Post-cancel chunk at original LM2F Channel',
    { kind: 'smoke', name: 'post-cancel-original-lm2f-channel' },
    'original callback invoked after terminal OR original Tauri callback structurally disposed',
    'original-runner-narrow', 'A native send alone is insufficient; actual callback/cleanup boundary must be recorded'),
  c12('C02', 'Post-cancel duplicate settled at original LM2F Channel',
    { kind: 'smoke', name: 'post-cancel-original-lm2f-channel' },
    'original settled callback after late chunk OR original callback disposal',
    'original-runner-narrow', 'Shares C01 case; separately late cancellation ACK and external SSE parser unproven'),
  c12('C03', 'Held original LM2F event crossing real child restart',
    { kind: 'smoke', name: 'stale-original-qualification-child-restart' },
    'original A callback delivered only if still registered; else structural disposal after B Ready',
    'original-runner-narrow', 'Never represent structural callback disposal as a delivered stale callback'),
  c12('C04', 'Late chunk after cancelled native settled',
    { kind: 'smoke', name: 'post-cancel-channel-callback' },
    'direct original Tauri Channel receives injected late chunk',
    'direct-native-only', 'Native ai_http_stream, not original Chat SDK consumer'),
  c12('C05', 'Duplicate settled after cancelled native settled',
    { kind: 'smoke', name: 'post-cancel-channel-callback' },
    'direct Tauri Channel receives injected second cancelled settled',
    'direct-native-only', 'Shares C04 invocation and does not exercise Chat evidence evaluation'),
  c12('C06', 'Late chunk after successful native settled',
    { kind: 'smoke', name: 'post-terminal-channel-callback' },
    'direct native Channel receives injected chunk after completed terminal',
    'direct-native-only', 'Provider SSE parser and original qualification operation absent'),
  c12('C07', 'Duplicate completed settled after successful terminal',
    { kind: 'smoke', name: 'post-terminal-channel-callback' },
    'direct native Channel receives injected duplicate settled',
    'direct-native-only', 'Shares C06 invocation'),
  c12('C08', 'Native registration arrives after renderer abort',
    { kind: 'runtime', name: 'registration-after-renderer-cancellation' },
    'late native inference-N ID cancelled and ai_http_stream forbidden',
    'direct-proxy-only', 'Uses createProxyFetch and a host delayed ai_http_open; original LM2F pending-open path untested'),
  c12('C09', 'Cancellation races native terminal delivery',
    { kind: 'runtime', name: 'cancellation-terminal-race' },
    'completed or cancelled native terminal exactly once',
    'direct-native-only', 'Uses nativeHttp; not an independently observed original SDK terminal race'),
  c12('C10', 'Native cancellation ACK delayed after handler drain',
    { kind: 'runtime', name: 'delayed-cancellation-ack' },
    'exact native cancellation ACK delayed with already-cancelled registry',
    'direct-native-only', 'Original LM2F caller and after-terminal ACK timing not exercised'),
  c12('C11', 'Native cancellation ACK fails after handler drain',
    { kind: 'runtime', name: 'cancellation-ack-failure' },
    'original handler registry cancel completed; renderer ACK rejects',
    'direct-native-only', 'ACK fault is feature-gated native transport, original LM2F not exercised'),
  c12('C12', 'Native late frame after cancelled transport',
    { kind: 'runtime', name: 'late-stream-event-after-cancellation' },
    'native transport rejects/ignores frame after cancelled terminal',
    'direct-native-only', 'No proof of original SDK parser or Chat/task effect immunity'),
]);

/** Ten conceptual B01 deadline boundaries. The final boundary has TWO real
 * one-shot B03 stages, so complete physical stage coverage is eleven holds. */
export const B01_DEADLINE_BOUNDARIES = Object.freeze([
  Object.freeze({ id: 'B01-01', boundary: 'readiness', stages: Object.freeze(['native-status']) }),
  Object.freeze({ id: 'B01-02', boundary: 'preparation', stages: Object.freeze(['preparation-complete']) }),
  Object.freeze({ id: 'B01-03', boundary: 'predispatch', stages: Object.freeze(['predispatch']) }),
  Object.freeze({ id: 'B01-04', boundary: 'native-registration', stages: Object.freeze(['after-ai-http-open']) }),
  Object.freeze({ id: 'B01-05', boundary: 'first-output', stages: Object.freeze(['first-output']) }),
  Object.freeze({ id: 'B01-06', boundary: 'terminal-delivery', stages: Object.freeze(['terminal-delivery']) }),
  Object.freeze({ id: 'B01-07', boundary: 'native-quiescence', stages: Object.freeze(['quiescence-complete']) }),
  Object.freeze({ id: 'B01-08', boundary: 'evidence-evaluation', stages: Object.freeze(['before-evidence-acceptance']) }),
  Object.freeze({ id: 'B01-09', boundary: 'B03-prepare', stages: Object.freeze(['b03-before-prepare']) }),
  Object.freeze({ id: 'B01-10', boundary: 'B03-acknowledge-and-readback', stages: Object.freeze([
    'b03-before-acknowledge', 'b03-before-readback',
  ]) }),
]);

/**
 * Check a proposed B02 evidence record without manufacturing an acceptance.
 * Missing physical evidence => UNVERIFIED. An existing host capability gap
 * does not become PASS merely because a source hook is present. A PASS needs
 * an actual original scenario with an attributable cancelled operation.
 * `nativeOpenDelta` etc are measured after the harness control inference-1.
 * A physical native stage arrival must be backed by the original native hit
 * marker and exact session/PID/epoch, rather than a renderer-only assertion.
 */
export function assessB02Cancellation(caseId, evidence) {
  const definition = B02_CANCELLATION_CASES.find(item => item.id === caseId);
  if (!definition) throw new Error(`Unknown B02 cancellation case: ${caseId}`);
  const impossibleInCurrentSource = definition.authority === 'flight-already-disarmed';
  if (!evidence) return {
    verdict: impossibleInCurrentSource ? 'BLOCKED' : 'UNVERIFIED',
    checks: [], limitation: definition.limitation,
  };
  if (impossibleInCurrentSource) return {
    verdict: 'BLOCKED', checks: [], limitation: definition.limitation,
  };
  const after = definition.expectedAfterRelease;
  const checks = [
    ['real-original-runner', evidence.originalProductionRunner === true],
    ['original-deadline-120000', evidence.originalAggregateBudgetMs === 120_000],
    ['native-pid-and-epoch-authenticated', evidence.ownerAuthenticated === true],
    ['original-session-held', evidence.originalSessionBound === true],
    ['original-native-stage-reached', evidence.originalIpcHeld === true],
    ['cancel-occurred-before-release', evidence.cancelBeforeRelease === true],
    ['single-barrier-release', evidence.releasedExactlyOnce === true],
    ['original-terminal-rejected', evidence.originalRunnerTerminal === after.originalRunner],
    ['zero-retroactive-success', evidence.noRetroactivePassAfterTerminal === true],
    ['no-new-Chat-task-effects', evidence.noNewChatOrTaskEffects === true],
    ['native-attempts-drained', evidence.nativeAttemptsDrained === true],
    ['native-open-after-baseline', evidence.nativeOpenDelta === after.nativeOpenDelta],
    ['native-stream-after-baseline', evidence.nativeStreamDelta === after.nativeStreamDelta],
    ['synthetic-HTTP-POST-after-baseline', evidence.successfulChatPostDelta === after.successfulChatPostDelta],
    ['no-subsequent-native-stream', evidence.extraNativeStreamDelta === 0],
    ['no-B03-begin', evidence.nativeCas?.begin === 0],
    ['no-B03-prepare', evidence.nativeCas?.prepare === 0],
    ['no-B03-acknowledge', evidence.nativeCas?.acknowledge === 0],
    ['zero-acknowledged-qualification-receipts', evidence.acknowledgedQualificationReceipts === 0],
    ['original-cancel-ownership', after.originalCancel === 'exact-original-id-required'
      ? evidence.cancelledExactOriginalRequestId === true
      : after.originalCancel === 'no-original-native-id'
        ? evidence.noOriginalNativeCancellation === true
        : evidence.cancelDidNotTargetOtherOwner === true],
  ].map(([name, pass]) => Object.freeze({ name, pass }));
  return {
    verdict: checks.every(check => check.pass) ? 'PASS' : 'FAIL',
    checks, limitation: definition.limitation,
  };
}
