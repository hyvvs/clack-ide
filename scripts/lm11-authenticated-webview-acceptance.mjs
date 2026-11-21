/**
 * LM11 B01-B03: an isolated, synthetic-only Windows WebView2 / Tauri IPC run.
 * The Vite entry is virtual: no production renderer or static source is edited.
 * This runner never starts an inference executable or invokes Qualification Lab.
 *
 * Run with node scripts/lm11-authenticated-webview-acceptance.mjs [--scenario normal]
 * Original production failure coverage (one mode per fresh host):
 *   --scenario original-runtime-fault --runtime-scenario transport-failure
 * Optional: --no-build (only after this exact example/feature has been built).
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = path.join(project, 'src-tauri', 'target', 'lm11-b01-b03-authenticated-webview-20261119');
const cases = path.join(owner, 'cases');
const cargoTarget = path.join(project, 'src-tauri', 'target', 'codex-checkpoint6');
const example = 'lm11_authenticated_webview_acceptance';
const feature = 'lm11-authenticated-webview-acceptance';
const scenarios = [
  'normal', 'cancel-exact-id', 'preflight-deny', 'wrong-secret',
  'wrong-deployment', 'wrong-epoch', 'wrong-pid', 'service-death',
  'timeout-before-admission', 'timeout-during-preparation',
  'stop-before-open', 'stop-after-open', 'stop-during-stream',
  'stop-after-terminal', 'window-close-preflight', 'window-close-stream',
  'restart-pending', 'restart-acknowledged', 'lost-native-ack',
  'duplicate-ticket', 'stale-runtime-epoch', 'wrong-model-alias',
  'wrong-provider-auth', 'corrupt-settings', 'read-only-settings',
  'concurrent-owner-cancel', 'genuine-child-restart', 'stale-cross-child-restart',
  'stale-original-qualification-child-restart',
  'stage-reachability', 'stage-expiry', 'stage-cancel', 'stage-close',
  'stage-conflict','stage-concurrent','stage-stale-epoch','stage-corrupt',
  'post-terminal-channel-callback',
  'post-cancel-channel-callback',
  'post-cancel-original-lm2f-channel',
  'original-late-cancel-ack',
  'original-duplicate-terminal',
  'original-postdeadline-provider-events',
  'original-abc-native-isolation',
  'original-managed-abc-deployments',
  'original-native-quiescence-failure',
];
// These are the 26 runtime behaviors from the B01-B03 execution-safety
// contract. They are independent of the historical native/security smoke
// cases above; each gets a unique fresh Tauri/WebView2 process and report.
const runtimeScenarios = [
  'authenticated-readiness-success',
  'deterministic-streaming-response',
  'terminal-completion',
  'delayed-readiness',
  'delayed-request-acceptance',
  'delayed-first-stream-event',
  'delayed-terminal-event',
  'never-terminal-until-cancellation',
  'cancel-before-registration',
  'cancel-immediately-after-registration',
  'cancel-during-streaming',
  'delayed-cancellation-ack',
  'cancellation-ack-failure',
  'late-stream-event-after-cancellation',
  'authenticated-health-failure',
  'request-admission-failure',
  'transport-failure',
  'malformed-stream-frame',
  'terminal-error',
  'connection-close-without-terminal',
  'registration-after-renderer-cancellation',
  'first-output-after-aggregate-deadline',
  'terminal-callback-after-deadline',
  'cancellation-terminal-race',
  'runtime-epoch-change-mid-request',
  'runtime-process-exits-mid-request',
];
// This separate feature-only path exercises the ORIGINAL Chat qualification
// caller. Keep the historical 26 direct-transport cases/index unchanged.
const originalRuntimeFaultModes = [
  'authenticated-health-failure', 'transport-failure',
  'authenticated-model-identity-failure',
  'request-admission-failure',
  'malformed-stream-frame', 'connection-close-without-terminal',
  'terminal-error', 'evidence-rejection',
];
// These are ten source-phase selectors of the unchanged production
// runManagedChatQualification, NOT the ten distinct higher-level execution
// safety acceptance boundaries. The index maps the two lists separately.
// Two in-process JS boundaries cannot be externally stalled, and an actual
// synchronous native-registration stall produced no renderer terminal report.
// Reject all three BEFORE launching another acceptance host.
const qualificationDeadlineStages = [
  'native-status', 'native-admission', 'session-writes', 'session-prepare',
  'bounded-request', 'native-quiescence', 'persisted-chat-evidence',
  'native-revalidation', 'receipt-scoring', 'cas-commit',
];
const injectableDeadlineStages = new Set(qualificationDeadlineStages.filter(stage =>
  !['native-quiescence','receipt-scoring','bounded-request'].includes(stage)));
const implemented = new Set([
  'normal', 'cancel-exact-id', 'preflight-deny', 'wrong-secret', 'wrong-deployment',
  'wrong-epoch', 'wrong-pid', 'service-death', 'timeout-before-admission',
  'timeout-during-preparation', 'stop-before-open', 'stop-after-open',
  'stop-during-stream', 'stop-after-terminal', 'stale-runtime-epoch',
  'wrong-model-alias', 'wrong-provider-auth', 'duplicate-ticket',
  'concurrent-owner-cancel', 'restart-pending', 'restart-acknowledged',
  'lost-native-ack', 'corrupt-settings', 'read-only-settings',
  'window-close-preflight', 'window-close-stream',
  'genuine-child-restart', 'stale-cross-child-restart',
  'stale-original-qualification-child-restart',
  'stage-reachability', 'stage-expiry', 'stage-cancel', 'stage-close',
  'stage-conflict','stage-concurrent','stage-stale-epoch','stage-corrupt',
  'post-terminal-channel-callback',
  'post-cancel-channel-callback',
  'post-cancel-original-lm2f-channel',
  'original-late-cancel-ack',
  'original-duplicate-terminal',
  'original-postdeadline-provider-events',
  'original-abc-native-isolation',
  'original-managed-abc-deployments',
  'original-native-quiescence-failure',
]);
const args = process.argv.slice(2);
const barrierStages = new Set([
  'before-native-admission','native-admission-response',
  'prepare-chat-promise-settlement','native-open-response',
  'before-preparation','during-preparation','before-ai-http-open',
  'during-streaming','during-quiescence',
  'preparation-complete', 'predispatch', 'after-ai-http-open',
  'first-output', 'terminal-delivery', 'quiescence-complete',
  'before-evidence-acceptance', 'b03-before-prepare',
  'b03-before-acknowledge', 'b03-before-readback',
  'b03-native-prepare','b03-native-ack-response',
]);
let scenario = 'normal';
let noBuild = false;
let runtimeScenario = null;
let deadlineStage = null;
let indexOnly = false;
let barrierStage = null;
let requestedBarrierMode = null;
let cancelSettleBeforeRelease = false;
let corruptionMode = null;
let abnormalCorruptExit = false;
let terminalWinsRace = false;
let staleIdCancel = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scenario' && args[i + 1]) scenario = args[++i];
  else if (args[i] === '--runtime-scenario' && args[i + 1]) runtimeScenario = args[++i];
  else if (args[i] === '--deadline-stage' && args[i + 1]) deadlineStage = args[++i];
  else if (args[i] === '--no-build') noBuild = true;
  else if (args[i] === '--barrier-stage' && args[i + 1]) barrierStage = args[++i];
  else if (args[i] === '--stage-barrier' && args[i + 1]) barrierStage = args[++i];
  else if (args[i] === '--barrier-mode' && args[i + 1]) requestedBarrierMode = args[++i];
  else if (args[i] === '--cancel-settle-before-release') cancelSettleBeforeRelease = true;
  else if (args[i] === '--corruption-mode' && args[i + 1]) corruptionMode = args[++i];
  else if (args[i] === '--abnormal-corrupt-exit') abnormalCorruptExit = true;
  else if (args[i] === '--terminal-wins-race') terminalWinsRace = true;
  else if (args[i] === '--stale-id-cancel') staleIdCancel = true;
  else if (args[i] === '--evidence-index') indexOnly = true;
  else if (args[i] === '--list') {
    for (const name of scenarios) console.log(`${name}\t${implemented.has(name) ? 'implemented' : 'staged / not executed'}`);
    for (const [index, name] of runtimeScenarios.entries())
      console.log(`runtime-${String(index + 1).padStart(2, '0')}\t${name}\tavailable / verify before acceptance`);
    for (const name of qualificationDeadlineStages)
      console.log(`aggregate-deadline\t${name}\t${injectableDeadlineStages.has(name) ? 'selectable / not automatically verified' : 'blocked (no independent native IPC boundary)'}`);
    process.exit(0);
  } else throw new Error(`Unrecognized argument: ${args[i]}`);
}
if (indexOnly && (runtimeScenario || deadlineStage || barrierStage || requestedBarrierMode || scenario !== 'normal'))
  throw new Error('Evidence indexing is read-only toward prior cases; do not combine with scenario execution');
if (runtimeScenario !== null) {
  if (!runtimeScenarios.includes(runtimeScenario) &&
      !(scenario === 'original-runtime-fault' &&
        originalRuntimeFaultModes.includes(runtimeScenario)))
    throw new Error(`Unrecognized B01-B03 runtime behavior: ${runtimeScenario}`);
  if (scenario === 'normal') scenario = 'runtime-transport';
  else if (scenario === 'original-runtime-fault' &&
      originalRuntimeFaultModes.includes(runtimeScenario)) {
    // Explicit original qualification path: never use the nativeHttp shortcut.
  } else
    throw new Error('Runtime behavior cannot share a scenario with native smoke acceptance');
}
if (scenario === 'original-runtime-fault' && runtimeScenario === null)
  throw new Error('Original qualification runtime fault requires one explicit --runtime-scenario');
if (deadlineStage !== null) {
  if (runtimeScenario || scenario !== 'normal' || !qualificationDeadlineStages.includes(deadlineStage))
    throw new Error('Select exactly one recognized aggregate deadline stage');
  if (!injectableDeadlineStages.has(deadlineStage)) {
    console.error(`BLOCKED: production ${deadlineStage} has no independent injectable native IPC boundary; unchanged production runner and scoring will not be mocked.`);
    process.exit(3);
  }
  scenario = 'deadline-bounded';
}
if (requestedBarrierMode) {
  if (scenario !== 'normal' ||
      !['reachability','expiry','cancel','close','conflict','concurrent','stale-epoch','corrupt'].includes(requestedBarrierMode))
    throw new Error('A barrier mode cannot overlap another scenario');
  scenario = 'stage-' + requestedBarrierMode;
}
if (['stage-reachability','stage-expiry','stage-cancel','stage-close',
    'stage-conflict','stage-concurrent','stage-stale-epoch','stage-corrupt'].includes(scenario) !== (barrierStage !== null) ||
    (barrierStage !== null && (!barrierStages.has(barrierStage) ||
      runtimeScenario || deadlineStage)))
  throw new Error('Original stage gate requires exactly one opt-in scenario and one recognized stage');
if ((scenario === 'stage-corrupt') !== (corruptionMode !== null) ||
    (corruptionMode !== null &&
      (!['malformed-main','inconsistent-marker','missing-insufficient',
        'corrupt-recovery','restart-ambiguity'].includes(corruptionMode) ||
        barrierStage !== 'b03-before-acknowledge')))
  throw new Error('Recovery fault must select only the real prepared original B03 stage and one isolated corruption mode');
if (abnormalCorruptExit && scenario !== 'stage-corrupt')
  throw new Error('Abnormal corrupt exit is available only for the original B03 isolated authority case');
if (terminalWinsRace && !(scenario==='stage-reachability' && barrierStage==='terminal-delivery'))
  throw new Error('Terminal-wins race requires only original positive terminal-delivery stage');
if (staleIdCancel && !(scenario==='stage-stale-epoch' && barrierStage==='b03-before-readback'))
  throw new Error('Old native ID/cancel isolation requires original A readback after B restart');
if (cancelSettleBeforeRelease &&
    (scenario !== 'stage-cancel' ||
      !['during-preparation','before-preparation','preparation-complete',
        'before-ai-http-open','after-ai-http-open',
        'native-admission-response','prepare-chat-promise-settlement',
        'native-open-response'].includes(barrierStage)))
  throw new Error('Post-terminal release is permitted only at an original cancellable pre-dispatch stage');
if (!scenarios.includes(scenario) && scenario !== 'runtime-transport' &&
    scenario !== 'original-runtime-fault' && scenario !== 'deadline-bounded')
  throw new Error(`Unsupported scenario: ${scenario}`);
if (!implemented.has(scenario) && !runtimeScenario && !deadlineStage) {
  console.error(`BLOCKED: '${scenario}' has a declared negative-case contract but no implementation; no PASS produced.`);
  process.exit(3);
}
if (process.platform !== 'win32') throw new Error('This real WebView2 acceptance host is Windows-only');

const digest = `sha256:${createHash('sha256').update('CLACK-LM11-SYNTHETIC-NO-MODEL-20261119-v1').digest('hex')}`;
// Distinct canonical GGUF digest identities, never filenames or real weights.
const abcDigests = ['B', 'C'].map(label =>
  `sha256:${createHash('sha256').update('CLACK-LM11-ABC-SYNTHETIC-NO-MODEL-' + label).digest('hex')}`);
const id = `${indexOnly ? 'index' : 'wry'}-${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomBytes(6).toString('hex')}`;
const fixture = Object.freeze({ digest, scenario, runtimeScenario, deadlineStage,
  barrierStage, barrierMode: barrierStage ? scenario.slice(6) : null,
  corruptionMode, cancelSettleBeforeRelease, abnormalCorruptExit,terminalWinsRace,staleIdCancel,
  ...(scenario === 'original-managed-abc-deployments' ? { abcDigests } : {}),
  syntheticOnly: true });

/** Native imports execute inside WebView2. Every qualifying action is the real production action. */
const renderer = String.raw`
import { invoke, Channel } from '@tauri-apps/api/core';
import { attachManagedLocalGguf, resolveManagedLocalSelection } from '/src/modules/ai/lib/managedLocalModels.ts';
import { updateSelfHostedProfiles } from '/src/modules/settings/store.ts';
import { usePreferencesStore } from '/src/modules/settings/preferences.ts';
import { useChatStore } from '/src/modules/ai/store/chatStore.ts';
import { useAgentsStore } from '/src/modules/ai/store/agentsStore.ts';
import { runManagedChatQualification } from '/src/modules/ai/lib/deploymentQualificationRuntime.ts';
import { createProxyFetch } from '/src/modules/ai/lib/proxyFetch.ts';
import { cancelSessionInference, sessionInference } from '/src/modules/ai/lib/inferenceLifecycle.ts';
import { peekDeploymentQualificationFlight } from '/src/modules/ai/lib/deploymentQualificationFlight.ts';
import { chats } from '/src/modules/ai/store/chatStore.ts';
import { usePeerTaskStore } from '/src/modules/ai/store/peerTaskStore.ts';

const state = { phases: [], negative: [], native: {}, outcome: 'unverified', syntheticOnly: true };
function step(s) { state.phases.push(s); document.getElementById('phase').textContent = s; }
async function mustReject(label, task) {
  try { await task(); throw new Error('unexpected acceptance: ' + label); }
  catch (e) {
    if (String(e).includes('unexpected acceptance:')) throw e;
    state.negative.push({ name: label, rejected: true });
  }
}
async function openCancel() {
  const id = await invoke('ai_http_open');
  if (!/^inference-\d+$/.test(id)) throw new Error('Native request ID malformed');
  await invoke('ai_http_cancel', { requestId: id, cancellationOrigin: 'parent-signal' });
  state.negative.push({ name: 'exact-id-cancel', requestId: id, settled: true });
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** T13-only passive Channel observer: the ORIGINAL getter/setter remain
 * authoritative, with every event forwarded to the actual registered
 * callback. In particular the proxyFetch post-terminal noop replacement is
 * still installed, invoked and recorded; no event is swallowed by this probe.
 * The cleanup delegate independently records the SDK Channel unregister. */
function observeOriginalLm2fChannel() {
  const property = Object.getOwnPropertyDescriptor(Channel.prototype, 'onmessage');
  const cleanup = Channel.prototype.cleanupCallback;
  if (!property?.get || !property.set || !property.configurable || typeof cleanup !== 'function')
    throw new Error('Tauri original Channel callback accessors unavailable');
  const captured = [];
  const cleaned = [];
  const perChannel = new WeakMap();
  let errors = 0;
  Object.defineProperty(Channel.prototype, 'onmessage', {
    enumerable: property.enumerable, configurable: property.configurable,
    get() {
      const current = property.get.call(this);
      const previous = perChannel.get(this);
      return previous?.wrapper === current ? previous.original : current;
    },
    set(handler) {
      const previous = perChannel.get(this);
      const generation = (previous?.generation ?? 0) + 1;
      if (typeof handler !== 'function') return property.set.call(this, handler);
      const wrapper = function (...args) {
        try {
          const event = args[0];
          if (captured.length < 80 && /^inference-\d+$/.test(event?.requestId ?? '')) {
            captured.push({
              requestId: event.requestId, kind: event.kind,
              phase: event.phase ?? null, at: performance.now(),
              channelId: this.id, generation,
              lateMarker: event.kind === 'chunk' &&
                new TextDecoder().decode(Uint8Array.from(event.bytes ?? [])) ===
                  'LM11-POST-TERMINAL-NATIVE-CHANNEL-ONLY-NO-MODEL',
            });
          }
        } catch { errors++; } // observation may never alter the original result
        return handler.apply(this, args);
      };
      perChannel.set(this, { original: handler, wrapper, generation });
      return property.set.call(this, wrapper);
    },
  });
  Channel.prototype.cleanupCallback = function (...args) {
    try {
      const current = perChannel.get(this);
      if (current) cleaned.push({
        at: performance.now(), channelId: this.id,
        generation: current.generation,
      });
    } catch { errors++; }
    return cleanup.apply(this, args);
  };
  return {
    captured, cleaned, errors: () => errors,
    restore() {
      Object.defineProperty(Channel.prototype, 'onmessage', property);
      Channel.prototype.cleanupCallback = cleanup;
    },
  };
}
/** T10: withhold one *received* original inference-N Channel event without
 * rewriting it, changing production epoch gates or fabricating a callback.
 * The original handler is released only while it remains registered; the
 * alternative is the actual SDK/Tauri Channel cleanup/replacement boundary.
 * This hook exists only in the dedicated synthetic acceptance WebView. */
function holdOriginalQualificationChannelA() {
  const descriptor = Object.getOwnPropertyDescriptor(Channel.prototype, 'onmessage');
  const originalCleanup = Channel.prototype.cleanupCallback;
  if (!descriptor?.get || !descriptor.set || !descriptor.configurable ||
      typeof originalCleanup !== 'function')
    throw new Error('T10 cannot observe the original Tauri Channel registration');
  const active = new WeakMap();
  const cleanups = [];
  const replacements = [];
  let held = null;
  let targetRequestId = null;
  let releaseCount = 0;
  let observationErrors = 0;
  Object.defineProperty(Channel.prototype, 'onmessage', {
    enumerable: descriptor.enumerable, configurable: descriptor.configurable,
    get() {
      const current = descriptor.get.call(this);
      const registered = active.get(this);
      return registered?.wrapper === current ? registered.original : current;
    },
    set(handler) {
      const previous = active.get(this);
      if (previous) replacements.push({ channelId: this.id,
        generation: previous.generation });
      if (typeof handler !== 'function') return descriptor.set.call(this, handler);
      const generation = (previous?.generation ?? 0) + 1;
      const channel = this;
      const wrapper = function (event) {
        try {
          if (!held && event?.kind === 'chunk' &&
              /^inference-\d+$/.test(event.requestId ?? '') &&
              (!targetRequestId || event.requestId === targetRequestId)) {
            held = { event, original: handler, wrapper, channel,
              channelId: channel.id, requestId: event.requestId,
              generation, receivedAt: performance.now() };
            return; // one actual event deliberately held until new B Ready
          }
        } catch { observationErrors++; }
        return handler.call(this, event);
      };
      active.set(this, { original: handler, wrapper, generation });
      return descriptor.set.call(this, wrapper);
    },
  });
  Channel.prototype.cleanupCallback = function (...args) {
    try {
      const current = active.get(this);
      if (current) cleanups.push({ channelId: this.id,
        generation: current.generation, at: performance.now() });
    } catch { observationErrors++; }
    return originalCleanup.apply(this, args);
  };
  return {
    bind(id) {
      if (!/^inference-\d+$/.test(id) || (held && held.requestId !== id))
        throw new Error('T10 original held event has a different native request ID');
      targetRequestId = id;
    },
    held: () => held && ({ requestId: held.requestId,
      channelId: held.channelId, generation: held.generation,
      receivedAt: held.receivedAt }),
    releaseAfterBReady(readyAt) {
      if (!held || !targetRequestId || held.requestId !== targetRequestId ||
          releaseCount++ !== 0 || !Number.isFinite(readyAt) ||
          performance.now() < readyAt || observationErrors)
        throw new Error('T10 release has no unique original A event after authenticated B Ready');
      const prior = active.get(held.channel);
      const actualRegistered = descriptor.get.call(held.channel);
      const cleaned = cleanups.some(row => row.channelId === held.channelId &&
        row.generation === held.generation);
      const replaced = !prior || prior.wrapper !== held.wrapper ||
        actualRegistered !== held.wrapper ||
        replacements.some(row => row.channelId === held.channelId &&
          row.generation === held.generation);
      if (cleaned || replaced) {
        return { boundary: 'original-tauri-channel-structurally-disposed',
          cleaned, replaced, originalCallbackInvoked: false, releaseAfterBReady: true };
      }
      // This is the same event OBJECT delivered by WebView's actual Tauri IPC,
      // the same original handler, and the same instance of Channel. Neither
      // requestId, bytes nor production handler is substituted.
      held.original.call(held.channel, held.event);
      return { boundary: 'original-inference-channel-consumer-after-b-ready',
        cleaned: false, replaced: false, originalCallbackInvoked: true,
        releaseAfterBReady: true };
    },
    errors: () => observationErrors,
    restore() {
      Object.defineProperty(Channel.prototype, 'onmessage', descriptor);
      Channel.prototype.cleanupCallback = originalCleanup;
    },
  };
}
function captureOriginalLm2fTaskState(sessionId) {
  const current = useChatStore.getState();
  return JSON.stringify({
    session: current.sessions.find(item => item.id === sessionId) ?? null,
    messages: chats.get(sessionId)?.messages ?? null,
    pendingApprovals: current.pendingApprovalsBySession[sessionId] ?? null,
    peerTasks: usePeerTaskStore.getState().tasks,
  });
}
async function originalQualificationRuntimeFault(attached, cfg) {
  const mode = cfg.runtimeScenario;
  // Activation is a real Tauri command, constrained by the host's env,
  // process identity and unique AppData root. The synthetic child reads this
  // case-local mode on each request. Activate BEFORE the production status
  // call so even authenticated-health-failure exercises the original caller.
  if (await invoke('lm11_acceptance_runtime_activate') !== mode)
    throw new Error('Original qualification runtime mode was not physically activated');
  const before = await invoke('lm11_acceptance_counts');
  if ((before.ai_http_open ?? 0) !== 1 || (before.ai_http_cancel ?? 0) !== 1 ||
      (before.ai_http_stream ?? 0) !== 0)
    throw new Error('Original runtime fault did not start after only the exact-ID control');

  const previousSession = useChatStore.getState().activeSessionId;
  const observer = observeOriginalLm2fChannel();
  let settled = false;
  let observedRequestId = null;
  let maximumNativeOpens = 0;
  let observedViolations = false;
  let monitor = Promise.resolve();
  let original = null;
  try {
    step('unchanged original bounded qualification under synthetic ' + mode);
    // This is the actual LM2F Chat/SDK/evidence entry point. No direct
    // ai_http_stream, proxyFetch shortcut, artificial timeout or evaluator.
    original = runManagedChatQualification(attached.selectionId).then(
      value => ({ succeeded: true, value }), error => ({ succeeded: false, error }),
    );
    const sessionId = useChatStore.getState().activeSessionId;
    if (!sessionId || sessionId === previousSession ||
        !useChatStore.getState().sessions.some(s => s.id === sessionId))
      throw new Error('Original qualification did not create its own real Chat session');
    monitor = (async () => {
      while (!settled) {
        const flight = peekDeploymentQualificationFlight(sessionId);
        if (flight) {
          maximumNativeOpens = Math.max(maximumNativeOpens, flight.native?.opens ?? 0);
          if (flight.violations?.length) observedViolations = true;
          if (/^inference-\d+$/.test(flight.native?.requestId ?? ''))
            observedRequestId = flight.native.requestId;
        }
        await sleep(10); // passive observation, never a qualification deadline
      }
    })();
    const outcome = await original;
    settled = true;
    await monitor;
    const negativeVerdictMode = mode === 'malformed-stream-frame';
    const nonadherentEvidenceMode = mode === 'evidence-rejection';
    const resolvedNegativeMode = negativeVerdictMode || nonadherentEvidenceMode;
    if (outcome.succeeded !== resolvedNegativeMode)
      throw new Error(resolvedNegativeMode
        ? 'Original evaluator/transport did not resolve with a genuine nonqualifying verdict'
        : 'Original qualification unexpectedly resolved under runtime failure');
    const match = outcome.succeeded ? null :
      /^Bounded qualification unverified at ([a-z-]+)$/.exec(
        String(outcome.error?.message ?? ''));
    const phase = match?.[1] ?? null;
    const allowed = ['authenticated-health-failure','authenticated-model-identity-failure'].includes(mode)
      ? ['native-status'] : mode === 'evidence-rejection'
      ? ['persisted-chat-evidence'] : mode === 'malformed-stream-frame' ||
          mode === 'connection-close-without-terminal'
      ? ['bounded-request', 'native-quiescence', 'persisted-chat-evidence']
      : ['bounded-request', 'native-quiescence'];
    if (!resolvedNegativeMode && !allowed.includes(phase))
      throw new Error('Original qualification rejected outside the expected transport/evidence phase (observed=' + (phase ?? 'non-bounded') + '; expected=' + allowed.join(',') + ')');

    const postregistration = !['authenticated-health-failure',
      'authenticated-model-identity-failure'].includes(mode);
    const channelIds = [...new Set(observer.captured.map(e => e.requestId)
      .filter(id => /^inference-\d+$/.test(id ?? '')))];
    if (channelIds.length > 1 || observer.errors() !== 0 ||
        (observedRequestId && channelIds.length &&
          channelIds[0] !== observedRequestId))
      throw new Error('Original native Channel request identity changed during fault');
    const requestId = observedRequestId ?? channelIds[0] ?? null;
    const exactOriginalOpens = Math.max(maximumNativeOpens, requestId ? 1 : 0);
    if (postregistration && (!requestId || exactOriginalOpens !== 1))
      throw new Error('Original runtime fault did not prove exactly one native opened ID');
    if (!postregistration && (requestId || exactOriginalOpens !== 0 || channelIds.length))
      throw new Error('Authenticated readiness/model-identity failure reached forbidden native stream registration');

    // Rejection must leave the original native lifecycle drained. This short
    // post-rejection observation is not an alternate 120s operation deadline.
    const drainUntil = performance.now() + 5_000;
    while (sessionInference(sessionId) && performance.now() < drainUntil)
      await sleep(20);
    if (sessionInference(sessionId))
      throw new Error('Original runtime-fault native inference remained registered');
    const counts = await invoke('lm11_acceptance_counts');
    const rows = (await invoke('self_hosted_profiles_snapshot'))
      .find(([key]) => key === 'selfHostedInference')?.[1]?.fabric?.qualificationReceipts ?? [];
    const casCommands = [
      'self_hosted_profiles_qualification_begin',
      'self_hosted_profiles_qualification_prepare',
      'self_hosted_profiles_qualification_acknowledge',
      'self_hosted_profiles_qualification_cancel',
      'self_hosted_profiles_qualification_reconcile',
    ];
    if ((counts.ai_http_open ?? 0) !== (postregistration ? 2 : 1) ||
        (counts.ai_http_stream ?? 0) !== (postregistration ? 1 : 0) ||
        observedViolations)
      throw new Error('Original runtime fault retried or violated its original native flight');
    const resolved = resolvedNegativeMode ? outcome.value : null;
    const negativeStatuses = {
      chat: 'failed', streaming: 'failed',
      'terminal-completion': 'failed', 'instruction-adherence': 'incomplete',
    };
    const receiptOwners = new Set(rows.map(row =>
      row.qualificationCas?.operationId + ':' + row.qualificationCas?.nativeEpoch));
    const receiptScopes = new Set(rows.map(row => JSON.stringify(row.scope)));
    const negativeReceipts = negativeVerdictMode &&
      resolved?.chat === 'failed' && resolved?.streaming === 'failed' &&
      resolved?.terminalCompletion === 'failed' &&
      resolved?.instructionAdherence === 'incomplete' &&
      resolved?.receiptCount === 4 && resolved?.sessionId === sessionId &&
      /^[0-9a-f-]{36}$/i.test(resolved?.requestId ?? '') &&
      rows.length === 4 && receiptOwners.size === 1 && receiptScopes.size === 1 &&
      Object.keys(negativeStatuses).every(cap =>
        rows.filter(row => row.capability === cap).length === 1) &&
      rows.every(row => row.version === 2 &&
        row.status === negativeStatuses[row.capability] &&
        row.qualificationCas?.phase === 'acknowledged' &&
        /^[a-f0-9]{32}$/i.test(row.qualificationCas?.operationId ?? '') &&
        /^[a-f0-9]{32}$/i.test(row.qualificationCas?.nativeEpoch ?? '') &&
        row.evidence?.reference === resolved.requestId &&
        row.evidence?.source === (row.capability === 'instruction-adherence'
          ? 'deterministic-evaluator' : 'clack-transport') &&
        row.evidence?.checks?.length === 1 &&
        row.evidence.checks[0].result === (row.status === 'incomplete' ? 'incomplete' : 'fail') &&
        row.scope?.runtimeEpoch === state.native.bind.epoch &&
        row.scope?.runtimeProcessIdentity === 'pid:' + state.native.bind.pid);
    const nonadherentReceipts = nonadherentEvidenceMode &&
      resolved?.chat === 'verified' && resolved?.streaming === 'verified' &&
      resolved?.terminalCompletion === 'verified' &&
      resolved?.instructionAdherence === 'failed' &&
      resolved?.receiptCount === 4 && resolved?.sessionId === sessionId &&
      /^[0-9a-f-]{36}$/i.test(resolved?.requestId ?? '') &&
      rows.length === 4 && receiptOwners.size === 1 && receiptScopes.size === 1 &&
      Object.keys(negativeStatuses).every(cap =>
        rows.filter(row => row.capability === cap).length === 1) &&
      rows.every(row => row.version === 2 &&
        row.status === (row.capability === 'instruction-adherence' ? 'failed' : 'verified') &&
        row.qualificationCas?.phase === 'acknowledged' &&
        /^[a-f0-9]{32}$/i.test(row.qualificationCas?.operationId ?? '') &&
        /^[a-f0-9]{32}$/i.test(row.qualificationCas?.nativeEpoch ?? '') &&
        row.evidence?.reference === resolved.requestId &&
        row.evidence?.source === (row.capability === 'instruction-adherence'
          ? 'deterministic-evaluator' : 'clack-transport') &&
        row.evidence?.checks?.length === 1 &&
        row.evidence.checks[0].result === (row.status === 'verified' ? 'pass' : 'fail') &&
        row.scope?.runtimeEpoch === state.native.bind.epoch &&
        row.scope?.runtimeProcessIdentity === 'pid:' + state.native.bind.pid);
    if (resolvedNegativeMode) {
      // A real SDK parse error may be delivered as an error stream part
      // instead of a rejected Promise. The unchanged original evaluator
      // records an explicitly FAILED result through a genuine acknowledged
      // native B03 CAS. This is NEVER a qualification PASS or no-B03 claim.
      if (!(negativeVerdictMode ? negativeReceipts : nonadherentReceipts) ||
          (counts.self_hosted_profiles_qualification_begin ?? 0) !== 1 ||
          (counts.self_hosted_profiles_qualification_prepare ?? 0) !== 1 ||
          (counts.self_hosted_profiles_qualification_acknowledge ?? 0) !== 1 ||
          (counts.self_hosted_profiles_qualification_cancel ?? 0) !== 0 ||
          (counts.self_hosted_profiles_qualification_reconcile ?? 0) !== 0)
        throw new Error('Original nonqualifying evidence did not persist exactly one truthful B03 ticket');
    } else if (rows.length ||
        casCommands.some(command => (counts[command] ?? 0) !== 0)) {
      throw new Error('Original rejected runtime failure unexpectedly entered B03 or persisted evidence');
    }
    state.native.originalRuntimeFault = {
      mode, originalProductionRunner: true,
      originalCallerRejected: !outcome.succeeded,
      originalCallerResolved: outcome.succeeded,
      originalCallerSucceeded: outcome.succeeded,
      originalSessionId: sessionId,
      exactOriginalRequestId: requestId, originalRejectionPhase: phase,
      originalNativeOpenCount: exactOriginalOpens,
      actualOriginalChannelEvents: observer.captured.filter(e =>
        e.requestId === requestId).map(e => ({ kind: e.kind, phase: e.phase })),
      nativeSessionDrained: true, noAdditionalNativeRequest: true,
      noB03CallsOrReceipts: !resolvedNegativeMode, noFlightViolations: true,
      ...(resolvedNegativeMode ? {
        originalReturnedNegativeVerdict: true, noQualificationGranted: true,
        negativeReceiptsAcknowledged: true, negativeReceiptCount: 4,
        originalResultRequestId: resolved.requestId,
        originalCapabilityStatuses: {
          chat: resolved.chat, streaming: resolved.streaming,
          'terminal-completion': resolved.terminalCompletion,
          'instruction-adherence': resolved.instructionAdherence,
        },
      } : {}),
      noModel: true,
    };
    state.outcome = resolvedNegativeMode ? 'original-qualification-negative-receipts'
      : 'original-qualification-runtime-fault-rejected';
  } finally {
    settled = true;
    // Even an invalid host observation cannot abandon the live ORIGINAL
    // operation. Its one production 120s deadline governs completion.
    if (original) await original;
    await monitor;
    observer.restore();
  }
}
async function originalManagedQualificationStageBarrier(attached, witness, cfg) {
  // The fixture selects ONE conceptual boundary, not a matrix. Only the
  // unchanged production runManagedChatQualification can reach this command.
  // A host-side async watch gate holds that actual IPC without blocking Wry.
  const stage = cfg.barrierStage;
  const mode = cfg.barrierMode;
  const originalStages = new Set([
    'before-native-admission','native-admission-response',
    'prepare-chat-promise-settlement','native-open-response',
    'before-preparation','during-preparation','before-ai-http-open',
    'during-streaming','during-quiescence',
    'preparation-complete', 'predispatch', 'after-ai-http-open',
    'first-output', 'terminal-delivery', 'quiescence-complete',
    'before-evidence-acceptance', 'b03-before-prepare',
    'b03-before-acknowledge', 'b03-before-readback',
    'b03-native-prepare','b03-native-ack-response',
  ]);
  if (!originalStages.has(stage) ||
      !['reachability','expiry','cancel','conflict','concurrent','stale-epoch','corrupt'].includes(mode) ||
      cfg.scenario !== 'stage-' + mode)
    throw new Error('No isolated original qualification stage selected');
  const token = await invoke('lm11_acceptance_barrier_arm', {
    stage, expectedPid: witness.processId, expectedEpoch: witness.epoch,
  });
  if (!/^[a-f0-9]{48}$/.test(token))
    throw new Error('Native acceptance stage did not issue one-use arm token');
  let actual = null;
  let rejected = null;
  let settled = false;
  let cancelObserved = false;
  let cancelRequestAtMs = null;
  let realCasConflictInjected = false;
  let concurrentQualificationRejected = false;
  let competingOriginalAttemptMessage = null;
  let staleB03Proof = null;
  let staleNativeIdProof = null;
  let corruptB03Proof = null;
  let terminalWinsProof = null;
  const started = performance.now();
  const runner = runManagedChatQualification(attached.selectionId).then(
    result => { actual = result; settled = true; },
    error => { rejected = error; settled = true; },
  );
  const untilReach = performance.now() + 25_000;
  let arrived = null;
  while (performance.now() < untilReach && !settled) {
    const status = await invoke('lm11_acceptance_barrier_status', { stage });
    if (status?.reached) { arrived = status; break; }
    await sleep(30);
  }
  if (!arrived || !arrived.armed || arrived.released ||
      !/^[a-z0-9_-]{2,96}$/i.test(arrived.sessionId ?? '') ||
      arrived.nativePid !== witness.processId || arrived.nativeEpoch !== witness.epoch ||
      arrived.originalAggregateBudgetMs !== 120_000)
    throw new Error('Actual original qualification never reached the exact native stage');

  let released = null;
  if (mode === 'reachability' || mode === 'concurrent') {
    const terminalRaceId = cfg.terminalWinsRace ?
      peekDeploymentQualificationFlight(arrived.sessionId)?.native?.requestId : null;
    if(cfg.terminalWinsRace && !/^inference-\d+$/.test(terminalRaceId??''))
      throw Error('Actual terminal-wins race had no production-owned native ID');
    if(mode === 'concurrent') {
      if(stage !== 'preparation-complete')
        throw new Error('Concurrent original operation challenge must begin at preparation completion');
      try {
        await runManagedChatQualification(attached.selectionId);
        throw new Error('Second same-deployment original qualification was incorrectly admitted');
      } catch(error) {
        competingOriginalAttemptMessage = String(error?.message??error).slice(0,240);
        if(!/already|active|progress|qualif/i.test(competingOriginalAttemptMessage))
          throw new Error('Second original qualification was not denied by the actual single-flight authority');
        concurrentQualificationRejected = true;
      }
    }
    released = await invoke('lm11_acceptance_barrier_release', {
      stage, token, sessionId: arrived.sessionId,
    });
    const untilCompleted = performance.now() + 25_000;
    while (!settled && performance.now() < untilCompleted) await sleep(20);
    if (!settled || rejected || !actual || actual.chat !== 'verified' ||
        actual.streaming !== 'verified' || actual.terminalCompletion !== 'verified' ||
        actual.instructionAdherence !== 'verified' || actual.receiptCount !== 4)
      throw new Error('Original qualification did not complete after exact native stage resume');
    if(cfg.terminalWinsRace){
      const before=(await invoke('self_hosted_profiles_snapshot'))
        .find(([key])=>key==='selfHostedInference')?.[1]?.fabric?.qualificationReceipts??[];
      const countsBefore=await invoke('lm11_acceptance_counts');
      const settledState=captureOriginalLm2fTaskState(arrived.sessionId);
      await invoke('ai_http_cancel',{
        requestId:terminalRaceId,cancellationOrigin:'settled-cleanup',
      });
      await cancelSessionInference(arrived.sessionId,{
        source:'explicit-user',reason:'cancel-requested',
      });
      const after=(await invoke('self_hosted_profiles_snapshot'))
        .find(([key])=>key==='selfHostedInference')?.[1]?.fabric?.qualificationReceipts??[];
      const countsAfter=await invoke('lm11_acceptance_counts');
      if(JSON.stringify(before)!==JSON.stringify(after) || before.length!==4 ||
          settledState!==captureOriginalLm2fTaskState(arrived.sessionId) ||
          countsAfter.ai_http_cancel!==(countsBefore.ai_http_cancel??0)+1 ||
          countsAfter.ai_http_stream!==countsBefore.ai_http_stream ||
          (countsAfter.self_hosted_profiles_qualification_acknowledge??0)!==1)
        throw Error('Late exact-ID loser cancellation changed legitimate terminal/B03 winner');
      terminalWinsProof={originalProductionRunner:true,terminalWonBeforeStop:true,
        exactRealNativeRequestId:terminalRaceId,oneTerminalCallerSettlement:true,
        retainedFourAcknowledgedReceipts:true,noDuplicateAckOrStream:true,
        lateExactNativeCancelHarmless:true};
    }
  } else if(mode === 'conflict') {
    if(stage !== 'b03-before-prepare')
      throw new Error('Original B03 CAS conflict must occur after native BEGIN and before actual prepare');
    const current = (await invoke('self_hosted_profiles_snapshot'))
      .find(([key]) => key === 'selfHostedInference')?.[1];
    if(!current || !Number.isSafeInteger(current.revision))
      throw new Error('Original ordinary self-hosted CAS state missing its revision');
    const value = structuredClone(current);
    value.revision = current.revision + 1;
    const changed = await invoke('self_hosted_profiles_compare_and_swap', {
      expected:current,value,
    });
    if(changed !== true)
      throw new Error('Real ordinary settings CAS did not create an isolated intervening revision');
    realCasConflictInjected = true;
    released = await invoke('lm11_acceptance_barrier_release', {
      stage,token,sessionId:arrived.sessionId,
    });
    const untilConflict = performance.now()+25_000;
    while(!settled && performance.now()<untilConflict) await sleep(20);
    if(!settled || actual || !rejected)
      throw new Error('Original qualification did not reject after genuine intervening ordinary CAS');
    const after=(await invoke('self_hosted_profiles_snapshot'))
      .find(([key]) => key === 'selfHostedInference')?.[1];
    if(after?.revision !== value.revision ||
        (after?.fabric?.qualificationReceipts??[]).some(row=>
          row.status==='verified'&&row.qualificationCas?.phase==='acknowledged'))
      throw new Error('Genuine CAS conflict lost an unrelated ordinary edit or promoted a receipt');
  } else if (mode === 'stale-epoch') {
    const historicalReadback = stage === 'b03-before-readback';
    if (!['b03-native-prepare','b03-before-acknowledge','b03-before-readback'].includes(stage))
      throw new Error('Old-epoch full-path test needs actual native B03 prepare, ACK or historical readback fence');
    const originalSelection = resolveManagedLocalSelection(
      usePreferencesStore.getState().selfHostedInference, attached.selectionId,
    );
    if (originalSelection.status === 'missing' || originalSelection.status === 'not-managed')
      throw new Error('Original deployment owner was lost before stale ticket restart');
    const nativeBefore = await invoke('lm11_acceptance_counts');
    if ((nativeBefore.self_hosted_profiles_qualification_begin ?? 0) !== 1 ||
        (stage === 'b03-before-acknowledge' &&
          (nativeBefore.self_hosted_profiles_qualification_prepare ?? 0) !== 1) ||
        (historicalReadback && ((nativeBefore.self_hosted_profiles_qualification_prepare ?? 0) !== 1 ||
          (nativeBefore.self_hosted_profiles_qualification_acknowledge ?? 0) !== 1)))
      throw new Error('Stale A did not reach a real original qualification B03 ticket');
    const prior = (await invoke('self_hosted_profiles_snapshot'))
      .find(([key]) => key === 'selfHostedInference')?.[1];
    if (stage === 'b03-before-acknowledge' &&
        (prior?.fabric?.qualificationReceipts ?? []).some(row =>
          row.qualificationCas?.phase !== 'pending' || row.version !== 0))
      throw new Error('Prepared original A B03 state was already qualifying');
    const immutableA = structuredClone(prior?.fabric?.qualificationReceipts ?? []);
    if (historicalReadback && (immutableA.length !== 4 ||
        !immutableA.every(row=>row.version===2 &&
          row.qualificationCas?.phase==='acknowledged')))
      throw new Error('A did not ACK its real four durable historical receipts BEFORE epoch B');
    const oldNativeRequestId=cfg.staleIdCancel ?
      peekDeploymentQualificationFlight(arrived.sessionId)?.native?.requestId : null;
    if(cfg.staleIdCancel && !/^inference-\d+$/.test(oldNativeRequestId??''))
      throw Error('Old A had no actual production-owned native inference request ID');
    await invoke('lm11_acceptance_stop_service');
    const inactive = await invoke('managed_local_runtime_status');
    if (inactive.state === 'Ready')
      throw new Error('Old A remained Ready after actual child shutdown');
    const restart = await invoke('lm11_acceptance_restart_child', {
      deploymentId: originalSelection.deployment.id,
      deploymentIdentity: originalSelection.identity,
    });
    if (restart.oldPid !== witness.processId || restart.oldEpoch !== witness.epoch ||
        restart.newPid === witness.processId || restart.newEpoch === witness.epoch ||
        !restart.freshNativeSecret || !restart.oldBearerRejected)
      throw new Error('Real B did not replace A with different PID/epoch/bearer');
    const currentB = await invoke('managed_local_runtime_status');
    if (currentB.state !== 'Ready' || currentB.processId !== restart.newPid ||
        currentB.epoch !== restart.newEpoch)
      throw new Error('Child B did not authenticate Ready after A was replaced');
    const routeB = await invoke('managed_local_runtime_route', {
      deploymentId: originalSelection.deployment.id,
      deploymentIdentity: originalSelection.identity, epoch: restart.newEpoch,
    });
    if (routeB.epoch !== restart.newEpoch || routeB.processId !== restart.newPid)
      throw new Error('Authentic B routing could not admit its current epoch');
    if(cfg.staleIdCancel){
      let oldEffects=null;
      let invokedInB=false;
      const activeB=await nativeHttp(routeB,{
        onFirstChunk:()=>{
          invokedInB=true;
          const oldNative=new Channel();
          oldNative.onmessage=()=>{throw Error('Old A native request unexpectedly delivered under B');};
          return Promise.all([
            mustReject('old-A-native-request-id-under-B',()=>invoke('ai_http_stream',{
              requestId:oldNativeRequestId,url:routeB.baseUrl+'/chat/completions',
              method:'POST',headers:{authorization:'Bearer '+routeB.apiKey,
                'content-type':'application/json'},
              body:[...new TextEncoder().encode(requestBody(routeB.modelAlias))],
              allowPrivateNetwork:true,timeoutPolicy:'self-hosted',admission,
              requirePreflight:false,onEvent:oldNative,
            })),
            invoke('ai_http_cancel',{requestId:oldNativeRequestId,
              cancellationOrigin:'scope-superseded'}),
          ]).then(()=>{oldEffects='rejected-and-cancelled';});
        },
      });
      if(!invokedInB || oldEffects!=='rejected-and-cancelled' ||
          activeB.requestId===oldNativeRequestId || activeB.terminal?.phase!=='completed' ||
          activeB.events.filter(row=>row.kind==='chunk').length<1 ||
          activeB.streamRejected)
        throw Error('Stale A native ID/cancel affected a genuine active B request');
      staleNativeIdProof={genuineOldOriginalRequestId:oldNativeRequestId,
        realBNewRequestId:activeB.requestId,
        staleARejectedByNativeRequestFence:true,
        staleACancellationIsolatedFromLiveB:true,
        BNativeStreamTerminalCompleted:true,
        oldARequestDidNotDispatchToSyntheticProvider:true};
    }
    if (settled)
      throw new Error('Original A B03 promise unexpectedly settled before its stage release');
    released = await invoke('lm11_acceptance_barrier_release', {
      stage,token,sessionId:arrived.sessionId,
    });
    const untilOldRejected=performance.now()+25_000;
    while(!settled && performance.now()<untilOldRejected) await sleep(20);
    if (!settled || actual || !rejected ||
        !/^Bounded qualification unverified at cas-commit/.test(String(rejected.message)))
      throw new Error('Original A did not reject at stale native B03 persistence');
    await sleep(200);
    const persisted = (await invoke('self_hosted_profiles_snapshot'))
      .find(([key]) => key === 'selfHostedInference')?.[1];
    const staleRows = persisted?.fabric?.qualificationReceipts ?? [];
    if (!historicalReadback && staleRows.some(row => row.version >= 2 ||
        row.qualificationCas?.phase === 'acknowledged'))
      throw new Error('Old epoch A activated durable qualifying receipts');
    let reconciliation = 'not-committed';
    if (historicalReadback) {
      if (JSON.stringify(staleRows)!==JSON.stringify(immutableA))
        throw new Error('Stale A readback altered or duplicated its prior durable historical receipts');
      const {operationId,nativeEpoch}=staleRows[0].qualificationCas;
      reconciliation=await invoke('self_hosted_profiles_qualification_reconcile',{
        ticket:{operationId,nativeEpoch},
      });
    } else if (stage === 'b03-before-acknowledge') {
      if (staleRows.length !== 4 || !staleRows.every(row =>
        row.version === 0 && row.qualificationCas?.phase === 'pending'))
        throw new Error('Original prepared A is not four inert pending receipts');
      const {operationId,nativeEpoch} = staleRows[0].qualificationCas;
      if (!staleRows.every(row => row.qualificationCas.operationId === operationId &&
          row.qualificationCas.nativeEpoch === nativeEpoch))
        throw new Error('Prepared A receipts carry different actual native ticket');
      reconciliation = await invoke('self_hosted_profiles_qualification_reconcile', {
        ticket: {operationId,nativeEpoch},
      });
    } else if (staleRows.length !== 0) {
      throw new Error('Stale native prepare wrote receipts despite epoch fence');
    }
    if (reconciliation !== (historicalReadback ? 'committed' : 'not-committed'))
      throw new Error('Old A physical reconciliation misrepresented historical committed/noncommitted truth');
    const afterB = await invoke('managed_local_runtime_status');
    if (afterB.state !== 'Ready' || afterB.epoch !== restart.newEpoch ||
        afterB.processId !== restart.newPid)
      throw new Error('Old A persistence contaminated current B authority');
    staleB03Proof = {
      genuineB03TicketUnderEpochA:true, realDifferentPidEpochBReady:true,
      oldEpochNativeProgressionRejected:!historicalReadback,
      zeroAcknowledgedQualifyingReceipts:!historicalReadback,
      historicalAReadbackOnly:historicalReadback,
      staleACallerDidNotPass:!!rejected&&!actual,
      immutableHistoricalAReceipts:historicalReadback && staleRows.length===4 &&
        JSON.stringify(staleRows)===JSON.stringify(immutableA),
      newBRouteStillUsable:true,reconcileNonqualifying:!historicalReadback,
      reconciliationDoesNotGrantCurrentEpoch:historicalReadback,
      physicalReconciliation:reconciliation,
      oldPid:restart.oldPid,oldEpoch:restart.oldEpoch,
      newPid:restart.newPid,newEpoch:restart.newEpoch,
      nativePreparedBeforeRestart:stage==='b03-before-acknowledge',
      durablePendingReceiptCount:staleRows.length,
    };
  } else if (mode === 'corrupt') {
    if (stage !== 'b03-before-acknowledge' || cfg.corruptionMode == null)
      throw new Error('Original corruption fault must hold one real prepared B03 ACK boundary');
    const before=await invoke('lm11_acceptance_counts');
    if ((before.self_hosted_profiles_qualification_begin ?? 0) !== 1 ||
        (before.self_hosted_profiles_qualification_prepare ?? 0) !== 1 ||
        (before.self_hosted_profiles_qualification_acknowledge ?? 0) !== 0)
      throw new Error('Corruption did not reach genuine original B03 prepared-but-unacknowledged authority');
    const physicalBefore=(await invoke('self_hosted_profiles_snapshot'))
      .find(([key])=>key==='selfHostedInference')?.[1];
    if ((physicalBefore?.fabric?.qualificationReceipts ?? []).length !== 4 ||
        !physicalBefore.fabric.qualificationReceipts.every(row=>
          row.version===0 && row.qualificationCas?.phase==='pending'))
      throw new Error('Genuine original B03 ticket was not four v0 pending receipts');
    const fault=await invoke('lm11_acceptance_corrupt_qualification_authority',{
      stage,token,sessionId:arrived.sessionId,mode:cfg.corruptionMode,
    });
    if (!fault?.actualNativePreparedTicket || fault.originalPreparedRows !== 4 ||
        !fault.forensicOriginalPreserved || fault.sessionId !== arrived.sessionId ||
        fault.nativePid !== witness.processId || fault.nativeEpoch !== witness.epoch ||
        fault.mode !== cfg.corruptionMode)
      throw new Error('Corruption fault is not attributable to original native B03 prepare');
    released=await invoke('lm11_acceptance_barrier_release',{
      stage,token,sessionId:arrived.sessionId,
    });
    const untilRecovery=performance.now()+25_000;
    while(!settled && performance.now()<untilRecovery)await sleep(20);
    if(!settled || actual || !rejected ||
        !/^Bounded qualification unverified at cas-commit/.test(String(rejected.message)))
      throw new Error('Original qualification did not fail closed at corrupt persistence authority');
    await sleep(200);
    const after=await invoke('lm11_acceptance_counts');
    if ((after.self_hosted_profiles_qualification_begin ?? 0)!==1 ||
        (after.self_hosted_profiles_qualification_prepare ?? 0)!==1 ||
        (after.self_hosted_profiles_qualification_acknowledge ?? 0)!==1)
      throw new Error('Corrupt qualification silently retried or skipped genuine native ACK failure');
    const physicalReconciliation=await invoke('self_hosted_profiles_qualification_reconcile',{
      ticket:fault.ticket,
    });
    if (physicalReconciliation!=='pending-reconciliation')
      throw new Error('Ambiguous native B03 state was not classified pending-reconciliation');
    let readable=true;
    let rows=[];
    try {
      const physical=(await invoke('self_hosted_profiles_snapshot'))
        .find(([key])=>key==='selfHostedInference')?.[1];
      rows=physical?.fabric?.qualificationReceipts ?? [];
    } catch { readable=false; }
    if(rows.some(row=>row.version===2 && row.qualificationCas?.phase==='acknowledged'))
      throw new Error('Corrupt authoritative state activated a qualifying receipt');
    corruptB03Proof={
      actualOriginalNativePrepare:true,originalRecoveryRequired:true,
      noAutoRetry:true,noQualifyingReceipt:true,
      forensicEvidencePreserved:true,corruptionMode:cfg.corruptionMode,
      physicalReconciliation,authoritativeSnapshotReadable:readable,
      explicitOriginalCallerRejected:true,realNativeTicket:fault.ticket,
    };
  } else if (mode === 'cancel') {
    // A real user/session Stop is issued at the actual original-runner
    // boundary. Never fabricate a rejection or use a competing timer.
    // Do not await native drain before releasing the held IPC: the native
    // request and any pending original Channel delivery may need to settle
    // in order for cancelSessionInference() to finish.
    const before = await invoke('lm11_acceptance_counts');
    const stop = cancelSessionInference(arrived.sessionId, {
      source: 'explicit-user', reason: 'cancel-requested',
    }).then(() => { cancelObserved = true; });
    cancelRequestAtMs = Math.round(performance.now() - started);
    let terminalBeforeRelease = false;
    let beforeReleaseCounts = null;
    if (cfg.cancelSettleBeforeRelease) {
      // The existing operation's Stop must terminate the ORIGINAL caller
      // while the one-shot native/renderer acceptance boundary is still held.
      // Neither this poll nor the barrier is another qualification deadline.
      const untilTerminal = performance.now() + 8_000;
      while (!settled && performance.now() < untilTerminal) await sleep(20);
      if (!settled || actual || !rejected ||
          !/^Bounded qualification unverified at /.test(String(rejected?.message ?? '')))
        throw new Error('Original Stop did not settle BEFORE held asynchronous work resumed');
      const held = await invoke('lm11_acceptance_barrier_status', { stage });
      if (!held.reached || held.released || held.sessionId !== arrived.sessionId)
        throw new Error('Admission/preparation acceptance hold was no longer unresolved at cancellation terminal');
      beforeReleaseCounts = await invoke('lm11_acceptance_counts');
      if ((beforeReleaseCounts.ai_http_stream ?? 0) !== 0 ||
          (beforeReleaseCounts.self_hosted_profiles_qualification_begin ?? 0) !== 0)
        throw new Error('Cancellation had already dispatched or persisted before late completion');
      terminalBeforeRelease = true;
    }
    released = await invoke('lm11_acceptance_barrier_release', {
      stage, token, sessionId: arrived.sessionId,
    });
    const untilCancelled = performance.now() + 25_000;
    while (!settled && performance.now() < untilCancelled) await sleep(20);
    if (!settled || actual || !rejected ||
        !/^Bounded qualification unverified at /.test(String(rejected?.message ?? '')))
      throw new Error('Original qualification did not reject after the REAL owned session Stop');
    await Promise.race([
      stop,
      sleep(25_000).then(() => { throw new Error('Original cancellation did not drain native ownership'); }),
    ]);
    if (!cancelObserved) throw new Error('Original cancellation owner never settled');
    const after = await invoke('lm11_acceptance_counts');
    if ((after.ai_http_stream ?? 0) - (before.ai_http_stream ?? 0) !== 0)
      throw new Error('Stopped qualification dispatched another native stream after release');
    if (cfg.cancelSettleBeforeRelease) {
      if (!terminalBeforeRelease || !beforeReleaseCounts ||
          (after.ai_http_open ?? 0) !== (beforeReleaseCounts.ai_http_open ?? 0) ||
          (after.ai_http_stream ?? 0) !== 0 ||
          (after.self_hosted_profiles_qualification_begin ?? 0) !== 0 ||
          (after.self_hosted_profiles_qualification_prepare ?? 0) !== 0 ||
          (after.self_hosted_profiles_qualification_acknowledge ?? 0) !== 0)
        throw new Error('Late asynchronous completion dispatched or reached native B03 after terminal cancellation');
    }
  } else {
    // NO second or shortened operation deadline. The original unmodified
    // QualificationOperationDeadline(120000) must reject first. The outer
    // 200s isolated-host watchdog is only a last-resort cleanup boundary.
    while (!settled && performance.now() - started < 165_000) await sleep(100);
    if (!settled || !rejected || actual || performance.now() - started < 119_000 ||
        !/^Bounded qualification unverified at /.test(String(rejected?.message ?? ''))) {
      // A real renderer-native transport fault may make the original caller
      // reject before the aggregate budget. This is a FAILED matrix case,
      // never a timeout PASS. Still release the exact one-shot held IPC so
      // the isolated Wry child and native registry can be reaped normally,
      // instead of waiting for the outer host watchdog.
      await invoke('lm11_acceptance_barrier_release', {
        stage, token, sessionId: arrived.sessionId,
      });
      await runner;
      throw new Error('Native stage did not observe the ORIGINAL 120s aggregate expiry');
    }
    released = await invoke('lm11_acceptance_barrier_release', {
      stage, token, sessionId: arrived.sessionId,
    });
  }
  await runner;
  if (!released?.released || released.stage !== stage ||
      released.sessionId !== arrived.sessionId ||
      released.nativePid !== witness.processId ||
      released.nativeEpoch !== witness.epoch ||
      released.originalAggregateBudgetMs !== 120_000)
    throw new Error('Native stage release did not preserve original PID/epoch/session ownership');
  const elapsedMs = Math.round(performance.now() - started);
  const terminal = ['reachability','concurrent'].includes(mode) ? 'completed' : 'rejected';
  await invoke('lm11_acceptance_barrier_terminal', {
    stage, token, sessionId: arrived.sessionId,
    originalTerminal: terminal, elapsedMs,
  });
  const status = await invoke('lm11_acceptance_barrier_status', { stage });
  if (!status.reached || !status.released || status.sessionId !== arrived.sessionId)
    throw new Error('Original native stage did not close after its one-shot release');
  await sleep(250);
  const counts = await invoke('lm11_acceptance_counts');
  const snapshot = await invoke('self_hosted_profiles_snapshot').then(
    entries=>entries.find(([key]) => key === 'selfHostedInference')?.[1],
    error=>{if(mode==='corrupt')return null;throw error;},
  );
  const receipts = snapshot?.fabric?.qualificationReceipts ?? [];
  // Expiry immediately after native ai_http_open is before ai_http_stream:
  // zero downstream stream/HTTP effects is REQUIRED, not a failed assertion.
  const preStreamExpiry = ['expiry','cancel'].includes(mode) &&
    ['before-native-admission','native-admission-response',
      'prepare-chat-promise-settlement','native-open-response',
      'before-preparation','during-preparation','preparation-complete',
      'before-ai-http-open','predispatch','after-ai-http-open'].includes(stage);
  const expectedStreams = cfg.staleIdCancel ? 3 : preStreamExpiry ? 0 : 1;
  if ((counts.ai_http_stream ?? 0) !== expectedStreams ||
      (counts.lm11_acceptance_barrier ?? 0) < 1 ||
      (counts.lm11_acceptance_barrier_release ?? 0) !== 1 ||
      (counts.lm11_acceptance_barrier_terminal ?? 0) !== 1 ||
      (['reachability','concurrent'].includes(mode) && receipts.length !== 4) ||
      (mode === 'conflict' && (!realCasConflictInjected || receipts.length !== 0)))
    throw new Error('Original stage generated missing or duplicate native request/effects');
  // Late B03 stages may already contain an inert pending marker or a genuine
  // ACK when original timeout wins. Record actual state; never call it zero.
  state.native.stageBarrier = {
    stage, mode, originalProductionRunner: true,
    originalAggregateBudgetMs: 120_000,
    nativePid: witness.processId, nativeEpoch: witness.epoch,
    originalSessionId: arrived.sessionId,
    stageReachedFromOriginalIpc: true, releasedExactlyOnce: true,
    originalRunnerTerminal: terminal, originalElapsedMs: elapsedMs,
    nativeStreams: counts.ai_http_stream ?? 0, expectedNativeStreams: expectedStreams,
    persistedReceiptCount: receipts.length,
    originalCallerDidNotRetroactivelyPass: !['reachability','concurrent'].includes(mode) ?
      !!rejected && !actual : true,
    ...(mode === 'conflict' ? {
      originalCasConflictInjected:realCasConflictInjected,
      unrelatedOrdinarySettingsRevisionPreserved:true,
    } : {}),
    ...(mode === 'concurrent' ? {
      secondOriginalSameDeploymentQualificationRejected:concurrentQualificationRejected,
      secondOriginalDenialMessage:competingOriginalAttemptMessage,
      originalFirstQualificationCompleted:true,
    } : {}),
    ...(mode === 'stale-epoch' ? staleB03Proof : {}),
    ...(staleNativeIdProof ? {staleNativeId:staleNativeIdProof} : {}),
    ...(mode === 'corrupt' ? corruptB03Proof : {}),
    ...(terminalWinsProof ? {terminalWinsRace:terminalWinsProof} : {}),
    ...(mode === 'cancel' ? {
      actualSessionStop: cancelObserved,
      cancelledAtOperationElapsedMs: cancelRequestAtMs,
      originalCancellationReason: 'explicit-user:cancel-requested',
      terminalCancellationPrecededHeldStageRelease: cfg.cancelSettleBeforeRelease === true,
    } : {}),
  };
  state.outcome = mode === 'reachability' ?
    'original-qualification-stage-reached-and-resumed' :
    mode === 'concurrent' ? 'original-first-qualification-preserved-second-denied' :
    mode === 'stale-epoch' ? 'original-old-epoch-b03-denied' :
    mode === 'corrupt' ? 'original-b03-recovery-required' :
    mode === 'conflict' ? 'original-qualification-real-cas-conflict-no-effect' :
    mode === 'cancel' ? 'original-qualification-stage-cancelled-no-retroactive-pass' :
    'original-qualification-stage-expired-no-retroactive-pass';
}
async function originalManagedQualificationRendererClosure(attached, witness, cfg) {
  const stage=cfg.barrierStage;
  if (cfg.scenario !== 'stage-close' ||
      !['before-ai-http-open','during-streaming','terminal-delivery'].includes(stage))
    throw new Error('Original renderer close requires an exact preflight or streaming boundary');
  const token=await invoke('lm11_acceptance_barrier_arm', {
    stage,expectedPid:witness.processId,expectedEpoch:witness.epoch,
  });
  if (!/^[a-f0-9]{48}$/.test(token))
    throw new Error('Original renderer close did not arm a native one-shot barrier');
  let failedOrSettled=false;
  const runner=runManagedChatQualification(attached.selectionId).then(
    () => { failedOrSettled=true; },
    () => { failedOrSettled=true; },
  );
  const until=performance.now()+25_000;
  let hit=null;
  while(performance.now()<until && !failedOrSettled){
    const status=await invoke('lm11_acceptance_barrier_status',{stage});
    if(status?.reached){hit=status;break;}
    await sleep(25);
  }
  if (!hit?.reached || hit.released || hit.originalAggregateBudgetMs!==120_000 ||
      hit.nativePid!==witness.processId || hit.nativeEpoch!==witness.epoch ||
      !/^[a-z0-9_-]{2,96}$/i.test(hit.sessionId??''))
    throw new Error('Original renderer window-close stage did not physically reach native one-shot hold');
  const nativeId=stage!=='before-ai-http-open'
    ? sessionInference(hit.sessionId)?.nativeId
    : 'no-native-request';
  if(stage!=='before-ai-http-open' && !/^inference-\d+$/.test(nativeId??''))
    throw new Error('Original streaming close lacks an exact registered native request ID');
  // The real Wry window is destroyed by a feature-only native command while
  // the ORIGINAL qualification still owns its held operation. No renderer
  // terminal is fabricated. The native sentinel independently checks
  // Destroyed, exact child/ID authority and native registry drainage.
  void runner;
  await invoke('lm11_acceptance_close_window',{requestId:nativeId});
  await new Promise(()=>{});
}

async function originalQualificationAcrossRealChildRestart(attached, selection, witness, route) {
  // T10 is independent of the older direct ai_http_stream A/B smoke test.
  // The ORIGINAL production Chat entry point creates its own inference-N,
  // session and qualification operation. The only test fault is holding one
  // actual event already delivered to the original Tauri Channel wrapper.
  const probe = holdOriginalQualificationChannelA();
  let rejected = null;
  let unexpectedlyCompleted = false;
  let sessionId = null;
  let requestId = null;
  const original = runManagedChatQualification(attached.selectionId).then(
    () => { unexpectedlyCompleted = true; },
    error => { rejected = error; },
  );
  try {
    const untilOpen = performance.now() + 12_000;
    while (performance.now() < untilOpen && !rejected && !unexpectedlyCompleted) {
      const active = useChatStore.getState().activeSessionId;
      const flight = active ? peekDeploymentQualificationFlight(active) : null;
      if (flight?.native.opens === 1 && /^inference-\d+$/.test(flight.native.requestId ?? '') &&
          !flight.native.terminal) {
        sessionId = active;
        requestId = flight.native.requestId;
        probe.bind(requestId);
        break;
      }
      await sleep(10);
    }
    if (!sessionId || !requestId)
      throw new Error('T10 actual production operation A did not register its own inference-N');
    const untilEvent = performance.now() + 5_000;
    while (performance.now() < untilEvent && !probe.held() &&
           !rejected && !unexpectedlyCompleted) await sleep(10);
    const held = probe.held();
    if (!held || held.requestId !== requestId ||
        rejected || unexpectedlyCompleted || probe.errors())
      throw new Error('T10 did not hold an actual original production A Channel event');
    const live = peekDeploymentQualificationFlight(sessionId);
    if (live?.native.requestId !== requestId || live.native.terminal)
      throw new Error('T10 held event was not owned by the still-live original qualification');
    const beforeStop = await invoke('lm11_acceptance_counts');
    if ((beforeStop.ai_http_stream ?? 0) !== 1 ||
        (beforeStop.self_hosted_profiles_qualification_begin ?? 0) !== 0)
      throw new Error('T10 original Chat did not reach exactly its own native stream before restart');

    step('T10 terminate real child A while original Chat callback remains held');
    await invoke('lm11_acceptance_stop_service');
    const dead = await invoke('managed_local_runtime_status');
    if (dead.state === 'Ready')
      throw new Error('T10 child A death retained authenticated Ready');
    await mustReject('T10-old-A-route-after-child-death', () =>
      invoke('managed_local_runtime_route', {
        deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
        epoch: witness.epoch,
      }));

    step('T10 bind separate actual child B and authenticate PID, epoch and new bearer');
    const restart = await invoke('lm11_acceptance_restart_child', {
      deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
    });
    if (restart.oldPid !== witness.processId || restart.oldEpoch !== witness.epoch ||
        restart.newPid === restart.oldPid || restart.newEpoch === restart.oldEpoch ||
        restart.oldBearerRejected !== true || restart.freshNativeSecret !== true ||
        restart.freshOsProcess !== true)
      throw new Error('T10 did not restart under a genuinely different native owner');
    const b = await invoke('managed_local_runtime_status');
    if (b.state !== 'Ready' || !b.installed || b.epoch !== restart.newEpoch ||
        b.processId !== restart.newPid || b.deploymentId !== selection.deployment.id)
      throw new Error('T10 child B did not independently authenticate as Ready');
    const bRoute = await invoke('managed_local_runtime_route', {
      deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
      epoch: b.epoch,
    });
    if (bRoute.epoch !== b.epoch || bRoute.processId !== b.processId ||
        bRoute.apiKey === route.apiKey || bRoute.baseUrl === route.baseUrl ||
        bRoute.modelAlias !== route.modelAlias)
      throw new Error('T10 child B reused old A native route identity');
    await mustReject('T10-stale-A-epoch-after-B-ready', () =>
      invoke('managed_local_runtime_route', {
        deploymentId: selection.deployment.id,
        deploymentIdentity: selection.identity, epoch: witness.epoch,
      }));
    const bReadyAt = performance.now();

    // Release the ONE actual retained A event only after native B Ready. If
    // production has already disposed the callback, do NOT resurrect it: the
    // delegated original Tauri cleanup/replacement is a stronger boundary.
    const release = probe.releaseAfterBReady(bReadyAt);
    const untilTerminal = performance.now() + 12_000;
    while (performance.now() < untilTerminal && !rejected && !unexpectedlyCompleted)
      await sleep(15);
    if (!rejected || unexpectedlyCompleted ||
        !/^Bounded qualification unverified at (bounded-request|native-quiescence)$/.test(
          String(rejected?.message ?? '')))
      throw new Error('T10 old A original Chat did not reject under genuine child B epoch');
    await original;
    const untilQuiescent = performance.now() + 5_000;
    while (sessionInference(sessionId) && performance.now() < untilQuiescent)
      await sleep(15);
    if (sessionInference(sessionId))
      throw new Error('T10 original A native session remained active after operation rejection');
    const beforeEffects = captureOriginalLm2fTaskState(sessionId);
    const countsBeforeEffects = await invoke('lm11_acceptance_counts');
    const receiptsBefore = (await invoke('self_hosted_profiles_snapshot'))
      .find(([key]) => key === 'selfHostedInference')?.[1]?.fabric?.qualificationReceipts ?? [];
    await sleep(300);
    const afterEffects = captureOriginalLm2fTaskState(sessionId);
    const counts = await invoke('lm11_acceptance_counts');
    const receiptsAfter = (await invoke('self_hosted_profiles_snapshot'))
      .find(([key]) => key === 'selfHostedInference')?.[1]?.fabric?.qualificationReceipts ?? [];
    const b03Keys = [
      'self_hosted_profiles_qualification_begin',
      'self_hosted_profiles_qualification_prepare',
      'self_hosted_profiles_qualification_acknowledge',
      'self_hosted_profiles_qualification_cancel',
    ];
    if (beforeEffects !== afterEffects || receiptsBefore.length || receiptsAfter.length ||
        b03Keys.some(key => (counts[key] ?? 0) !== 0 ||
          (countsBeforeEffects[key] ?? 0) !== 0) ||
        (counts.ai_http_stream ?? 0) !== 1 || probe.errors())
      throw new Error('T10 held original A callback changed Chat/task/B03 authority under B Ready');

    state.native.restart = {
      oldPid: witness.processId, oldEpoch: witness.epoch,
      newPid: b.processId, newEpoch: b.epoch,
      oldBearerRejected: true, oldRouteRejected: true,
      newReadyAuthenticated: true,
    };
    state.native.originalCrossChild = {
      originalProductionRunner: true,
      originalOperationRejected: true,
      exactOriginalRequestId: requestId,
      originalSessionId: sessionId,
      heldActualOriginalEvent: true,
      heldNativeRequestId: held.requestId,
      heldChannelRegistrationId: String(held.channelId),
      releaseAfterBReady: release.releaseAfterBReady,
      observedBoundary: release.boundary,
      originalCallbackInvoked: release.originalCallbackInvoked,
      originalChannelDisposed: release.cleaned || release.replaced,
      oldNativeSessionQuiescent: true,
      originalChatAndTaskUnchanged: true,
      noB03CallsOrReceipts: true,
      noNewBStreamDispatch: true,
      nativeStreams: counts.ai_http_stream ?? 0,
    };
    state.outcome = 'original-qualification-cross-child-callback-fenced';
  } finally {
    probe.restore();
  }
}
async function originalLm2fCancelledLateChannel(attached) {
  const probe = observeOriginalLm2fChannel();
  let rejected = null;
  let unexpectedPass = false;
  let observedSession = null;
  let nativeRequest = null;
  let safetyCancelled = false;
  let safetyTimer = null;
  // This is the EXACT unchanged production LM2F runner; no direct
  // ai_http_stream, fake Chat or synthetic replacement executor is used.
  const runner = runManagedChatQualification(attached.selectionId).then(
    () => { unexpectedPass = true; }, error => { rejected = error; },
  );
  try {
    let sessionId = null;
    let requestId = null;
    let channelId = null;
    const untilNativeOpen = performance.now() + 12_000;
    while (performance.now() < untilNativeOpen) {
      if (unexpectedPass || rejected) break;
      const active = useChatStore.getState().activeSessionId;
      // The production LM2F native flight observes its exact request ID
      // synchronously immediately after native ai_http_open and before
      // ai_http_stream IPC. Do not race the transient inferenceLifecycle map
      // against a WebView-delivered Channel callback.
      const flight = active ? peekDeploymentQualificationFlight(active) : null;
      if (flight?.native.opens === 1 && /^inference-\d+$/.test(flight.native.requestId ?? '') &&
          !flight.native.terminal) {
        sessionId = active;
        requestId = flight.native.requestId;
        break;
      }
      await sleep(10);
    }
    if (!sessionId || !requestId)
      throw new Error('Original LM2F native flight did not prove one exact open request before bounded admission');
    observedSession = sessionId;
    nativeRequest = requestId;
    if (await invoke('lm11_acceptance_arm_late_channel', { requestId }) !== true)
      throw new Error('Original production inference-N Channel could not be armed after real native open');
    // Safety-only fallback: if renderer callback instrumentation fails again,
    // revoke the original inference before the deliberately delayed synthetic
    // second SSE part. This path is always FAILED, never T13 PASS.
    safetyTimer = setTimeout(() => {
      if (safetyCancelled || rejected || unexpectedPass) return;
      if (probe.captured.some(row => row.requestId === requestId &&
          row.kind === 'chunk')) return;
      safetyCancelled = true;
      void cancelSessionInference(sessionId, {
        source: 'explicit-user', reason: 'cancel-requested',
      }).catch(() => undefined);
    // This is an acceptance cleanup watchdog, never the production deadline.
    // The old 950ms timer could cancel a real request still in native
    // preflight/connection setup before its first HTTP response (the retained
    // failed 20261120 T13 run had no POST/headers and no stream chunk).
    // Permit genuine native response delivery, but still fail closed and
    // revoke the same exact request if no chunk arrives within this bound.
    }, 8_000);
    const untilChunk = performance.now() + 9_000;
    while (performance.now() < untilChunk &&
        !probe.captured.some(row => row.requestId === requestId &&
          row.kind === 'chunk') &&
        !rejected && !unexpectedPass && !safetyCancelled)
      await sleep(10);
    const firstChunk = probe.captured.find(row => row.requestId === requestId &&
      row.kind === 'chunk');
    if (!firstChunk || rejected || unexpectedPass || safetyCancelled)
      throw new Error('No actual original SSE/native stream chunk arrived before cancellation');
    channelId = firstChunk.channelId;
    clearTimeout(safetyTimer);
    safetyTimer = null;
    // Invoke the ORIGINAL session inference lifecycle after production
    // delivered its first genuine native SSE chunk. Do not call ai_http_cancel
    // here, synthesize a request, or replace the original Chat runner.
    const stop = cancelSessionInference(sessionId, {
      source: 'explicit-user', reason: 'cancel-requested',
    });
    const untilStop = performance.now() + 10_000;
    let stopSettled = false;
    void stop.then(() => { stopSettled = true; }, () => { stopSettled = false; });
    while (!stopSettled && performance.now() < untilStop) await sleep(15);
    if (!stopSettled) throw new Error('Original cancellation did not settle natively within T13 bound');
    const untilReject = performance.now() + 10_000;
    while (!rejected && !unexpectedPass && performance.now() < untilReject)
      await sleep(15);
    if (!rejected && !unexpectedPass)
      throw new Error('Original LM2F did not settle after native cancellation within T13 bound');
    await runner;
    if (!rejected || unexpectedPass ||
        !/^Bounded qualification unverified at (bounded-request|native-quiescence)$/.test(
          String(rejected?.message ?? '')))
      throw new Error('Original LM2F did not reject at its actual cancelled Chat request');
    const terminal = probe.captured.find(row => row.requestId === requestId &&
      row.channelId === channelId && row.kind === 'settled' && row.phase === 'cancelled');
    if (!terminal || terminal.at < firstChunk.at || sessionInference(sessionId))
      throw new Error('Original native cancelled terminal or registry drain not independently observed');
    const initialChatAndTask = captureOriginalLm2fTaskState(sessionId);
    const initialCounts = await invoke('lm11_acceptance_counts');
    const initialEvidence = (await invoke('self_hosted_profiles_snapshot'))
      .find(([name]) => name === 'selfHostedInference')?.[1]?.fabric?.qualificationReceipts ?? [];
    if (initialEvidence.length || initialCounts.self_hosted_profiles_qualification_acknowledge ||
        initialCounts.self_hosted_profiles_qualification_begin ||
        initialCounts.self_hosted_profiles_qualification_prepare)
      throw new Error('B03 or qualification receipts were created before T13 release');
    // This new canonical one-shot marker is sent only AFTER the production
    // LM2F rejection, real Cancelled callback and session inference drain.
    if (await invoke('lm11_acceptance_release_original_lm2f_late_channel', {
      requestId, sessionId, nativeTerminal: 'cancelled',
      rejectionPhase: String(rejected.message),
    }) !== true)
      throw new Error('Native T13 release marker was not acknowledged');
    const releasedAt = performance.now();
    await sleep(1_200); // finite late-delivery observation; absence is not a callback
    const late = probe.captured.filter(row => row.requestId === requestId &&
      row.channelId === channelId && row.at > releasedAt);
    const lateChunk = late.find(row => row.kind === 'chunk' && row.lateMarker === true);
    const lateDuplicate = late.find(row => row.kind === 'settled' &&
      row.phase === 'cancelled' && row.at >= (lateChunk?.at ?? Infinity));
    const originalCleanup = probe.cleaned.find(row =>
      row.channelId === channelId && row.at <= releasedAt);
    // Only a truly invoked renderer Channel callback *or* an observed earlier
    // Tauri Channel unregister is an admissible T13 boundary. A native send
    // alone is never evidence of renderer callback delivery.
    const observedBoundary = lateChunk && lateDuplicate && late.length === 2 &&
      lateChunk.generation >= 2 && lateDuplicate.generation >= 2
        ? 'renderer-original-channel-callback-after-proxyfetch-noop'
        : !late.length && originalCleanup
          ? 'tauri-original-channel-cleanup-before-late-injection'
          : null;
    const afterCounts = await invoke('lm11_acceptance_counts');
    const afterEvidence = (await invoke('self_hosted_profiles_snapshot'))
      .find(([name]) => name === 'selfHostedInference')?.[1]?.fabric?.qualificationReceipts ?? [];
    const stateStable = initialChatAndTask === captureOriginalLm2fTaskState(sessionId);
    const noB03 = !initialEvidence.length && !afterEvidence.length &&
      !afterCounts.self_hosted_profiles_qualification_acknowledge &&
      !afterCounts.self_hosted_profiles_qualification_begin &&
      !afterCounts.self_hosted_profiles_qualification_prepare;
    const noRetroactiveSuccess = !unexpectedPass && !!rejected;
    if (!observedBoundary || probe.errors() || !stateStable || !noB03 ||
        !noRetroactiveSuccess || afterCounts.ai_http_stream !== initialCounts.ai_http_stream)
      throw new Error('T13 observed no grounded late boundary or after-terminal state/evidence changed');
    state.native.originalLm2fLate = {
      requestId, sessionId, observedBoundary, originalProductionRunner: true,
      originalLm2fRejected: true, originalNativeCancelled: true,
      originalCancelSessionInference: true, chatAndTaskUnchangedAfterLate: stateStable,
      zeroB03AckOrReceipts: noB03, noRetroactiveSuccess,
      actualChannelCallbackCount: late.length,
      originalNativeCancelledAt: Math.round(terminal.at),
      originalFirstSseChunkAt: Math.round(firstChunk.at),
      releaseAfterRejectionAt: Math.round(releasedAt),
      observedCleanupBeforeRelease: !!originalCleanup,
    };
    state.outcome = 'original-lm2f-cancel-late-boundary-observed';
  } finally {
    if (safetyTimer) clearTimeout(safetyTimer);
    // Persist only safe native callback metadata even on a FAILED T13 run.
    // Do not discard a failed attempt's missing-callback/early-unregister
    // boundary just because the intended late release was never reached.
    state.native.t13ObserverDiagnostics = {
      observedSession, nativeRequest, safetyCancelled,
      originalRunnerRejected: !!rejected, originalRunnerPassed: unexpectedPass,
      callbackEvents: probe.captured.slice(0, 24).map(row => ({
        kind: row.kind, phase: row.phase,
        generation: row.generation, channelId: row.channelId,
      })),
      cleanupEvents: probe.cleaned.slice(0, 8),
      observerErrors: probe.errors(),
      finalFlight: observedSession ? {
        opens: peekDeploymentQualificationFlight(observedSession)?.native?.opens ?? null,
        requestId: peekDeploymentQualificationFlight(observedSession)?.native?.requestId ?? null,
        terminal: peekDeploymentQualificationFlight(observedSession)?.native?.terminal ?? null,
      } : null,
    };
    probe.restore();
  }
}
async function originalLateNativeCancelAck(attached) {
  // Original LM2F Chat/SDK caller, real native inference-N and session Stop.
  // The feature-only Rust handler has ALREADY drained native cancellation
  // when its response is held. No standalone ai_http_cancel is substituted.
  const probe=observeOriginalLm2fChannel();
  let rejected=null,unexpectedPass=false,originalSession=null,originalId=null;
  const runner=runManagedChatQualification(attached.selectionId).then(
    ()=>{unexpectedPass=true;},error=>{rejected=error;});
  try {
    const until=performance.now()+12_000;
    while(performance.now()<until && !rejected && !unexpectedPass){
      const sid=useChatStore.getState().activeSessionId;
      const flight=sid?peekDeploymentQualificationFlight(sid):null;
      if(flight?.native?.opens===1 && /^inference-\d+$/.test(flight.native.requestId??'')){
        originalSession=sid;originalId=flight.native.requestId;break;
      }
      await sleep(10);
    }
    if(!originalId || !originalSession)throw Error('Original ACK race never registered one native ID');
    const untilChunk=performance.now()+12_000;
    while(performance.now()<untilChunk &&
      !probe.captured.some(row=>row.requestId===originalId && row.kind==='chunk')&&
      !rejected&&!unexpectedPass)await sleep(10);
    if(!probe.captured.some(row=>row.requestId===originalId && row.kind==='chunk'))
      throw Error('Original native SSE chunk was not delivered before cancellation');
    if(await invoke('lm11_acceptance_arm_cancel_ack',{requestId:originalId})!==true)
      throw Error('Original native exact-ID delayed ACK could not be armed');
    const stop=cancelSessionInference(originalSession,{
      source:'explicit-user',reason:'cancel-requested',
    });
    let stopDone=false;
    void stop.then(()=>{stopDone=true;},()=>{stopDone=true;});
    const untilTerminal=performance.now()+10_000;
    while(!rejected&&!unexpectedPass&&performance.now()<untilTerminal)
      await sleep(15);
    if(!rejected||unexpectedPass || !/^Bounded qualification unverified at /.test(String(rejected.message)))
      throw Error('Original caller DID NOT settle before exact native ACK release; structural ordering unproved');
    const beforeState=captureOriginalLm2fTaskState(originalSession);
    const beforeCounts=await invoke('lm11_acceptance_counts');
    const beforeReceipts=(await invoke('self_hosted_profiles_snapshot'))
      .find(([key])=>key==='selfHostedInference')?.[1]?.fabric?.qualificationReceipts??[];
    if(beforeReceipts.length || (beforeCounts.self_hosted_profiles_qualification_begin??0)!==0)
      throw Error('Native late ACK case created pre-release B03 effects');
    if(await invoke('lm11_acceptance_release_cancel_ack',{
      requestId:originalId,sessionId:originalSession,
    })!==true)throw Error('Actual native post-cancel held ACK not released after caller settlement');
    const drainUntil=performance.now()+7_000;
    while(!stopDone&&performance.now()<drainUntil)await sleep(15);
    if(!stopDone)throw Error('Original Stop failed to settle after exact native ACK release');
    await runner;
    await sleep(200);
    const afterCounts=await invoke('lm11_acceptance_counts');
    const afterReceipts=(await invoke('self_hosted_profiles_snapshot'))
      .find(([key])=>key==='selfHostedInference')?.[1]?.fabric?.qualificationReceipts??[];
    if(!rejected||unexpectedPass||beforeState!==captureOriginalLm2fTaskState(originalSession)||
      afterReceipts.length||afterCounts.ai_http_stream!==beforeCounts.ai_http_stream||
      sessionInference(originalSession)||probe.errors())
      throw Error('Late native ACK changed original caller, native registry or B03 authority');
    state.native.originalLateCancelAck={
      originalProductionRunner:true,originalSessionId:originalSession,requestId:originalId,
      actualNativeRequestBeforeStop:true,originalCallerTerminalBeforeNativeAck:true,
      oneOriginalStream:true,callerResultUnchanged:true,exactNativeRegistryDrained:true,
      zeroQualifyingReceipts:true,noCrossRequestEffect:true,
    };
    state.outcome='original-native-cancel-ack-post-terminal-fenced';
  }finally{probe.restore();}
}
async function originalDuplicateNativeTerminal(attached) {
  const probe=observeOriginalLm2fChannel();
  let completed=null,rejected=null;
  const original=runManagedChatQualification(attached.selectionId).then(
    value=>{completed=value;},error=>{rejected=error;});
  try {
    const until=performance.now()+12_000;
    let sessionId=null,requestId=null;
    while(performance.now()<until && !completed&&!rejected){
      const sid=useChatStore.getState().activeSessionId;
      const flight=sid?peekDeploymentQualificationFlight(sid):null;
      if(flight?.native?.opens===1 && /^inference-\d+$/.test(flight.native.requestId??'')){
        sessionId=sid;requestId=flight.native.requestId;break;
      }
      await sleep(8);
    }
    if(!requestId||!sessionId)throw Error('Duplicate terminal lacked registered original native request');
    if(await invoke('lm11_acceptance_arm_late_channel',{requestId})!==true)
      throw Error('Exact original native Channel could not arm duplicate completion');
    await original;
    if(rejected||completed?.receiptCount!==4||completed.chat!=='verified')
      throw Error('Original Chat did not complete before duplicate attempted terminal');
    const beforeState=captureOriginalLm2fTaskState(sessionId);
    const before=(await invoke('self_hosted_profiles_snapshot'))
      .find(([key])=>key==='selfHostedInference')?.[1]?.fabric?.qualificationReceipts??[];
    const countsBefore=await invoke('lm11_acceptance_counts');
    await sleep(1200);
    const after=(await invoke('self_hosted_profiles_snapshot'))
      .find(([key])=>key==='selfHostedInference')?.[1]?.fabric?.qualificationReceipts??[];
    const countsAfter=await invoke('lm11_acceptance_counts');
    const terminal=probe.captured.find(row=>row.requestId===requestId &&
      row.kind==='settled'&&row.phase==='completed');
    const duplicate=probe.captured.find(row=>row.requestId===requestId &&
      row.kind==='settled' && row.phase==='completed' && row.at>(terminal?.at??Infinity));
    const disposal=probe.cleaned.some(row=>row.channelId===terminal?.channelId);
    if(!terminal || (duplicate?.at??0) <= terminal.at && !disposal ||
        JSON.stringify(before)!==JSON.stringify(after) || before.length!==4 ||
        beforeState!==captureOriginalLm2fTaskState(sessionId) || rejected ||
        (countsAfter.self_hosted_profiles_qualification_acknowledge??0)!==1 ||
        countsAfter.ai_http_stream!==countsBefore.ai_http_stream || probe.errors())
      throw Error('Actual original duplicate terminal changed caller, native owner or receipts');
    state.native.originalDuplicateTerminal={
      originalProductionRunner:true,requestId,sessionId,
      originalCompletedAndAcknowledgedFour:true,
      nativeDuplicateAttemptAfterFirstTerminal:true,
      observedBoundary:duplicate?'DELIVERED AND SAFELY IGNORED':
        disposal?'STRUCTURALLY DISPOSED':'UNOBSERVABLE',
      originalChannelDisposed:disposal,deliveredOriginalDuplicate:!!duplicate,
      callerAndChatUnchanged:true,noDuplicateReceipts:true,
      persistedReceiptCount:after.length,
    };
    if(!duplicate&&!disposal)throw Error('No actual duplicate Channel callback or structural disposal');
    state.outcome='original-duplicate-terminal-fenced';
  }finally{probe.restore();}
}
async function originalPostDeadlineProviderEvents(attached) {
  // ONE unchanged 120s original LM2F operation. The real synthetic provider
  // writes a first SSE frame BEFORE expiry. Existing feature-only one-shot
  // native first-output barrier withholds actual original Channel delivery
  // until the unchanged aggregate deadline, independently of any SDK/native
  // quiescence timer. The provider then attempts real TCP content AND terminal.
  const witness=await invoke('managed_local_runtime_status');
  if(witness.state!=='Ready'||!witness.processId||!witness.epoch)
    throw Error('Original postdeadline native runtime must be authenticated Ready');
  const barrierToken=await invoke('lm11_acceptance_barrier_arm',{
    stage:'first-output',expectedPid:witness.processId,expectedEpoch:witness.epoch,
  });
  if(!/^[a-f0-9]{48}$/.test(barrierToken))
    throw Error('Original first-output barrier did not arm with one-shot token');
  const probe=observeOriginalLm2fChannel();
  let rejected=null,passed=false,settlements=0;
  const start=performance.now();
  const runner=runManagedChatQualification(attached.selectionId).then(
    ()=>{passed=true;settlements++;},error=>{rejected=error;settlements++;});
  try {
    let sessionId=null,requestId=null;
    const registeredUntil=start+15_000;
    while(performance.now()<registeredUntil&&!requestId&&!rejected&&!passed){
      const sid=useChatStore.getState().activeSessionId;
      const flight=sid?peekDeploymentQualificationFlight(sid):null;
      if(flight?.native?.opens===1 && /^inference-\d+$/.test(flight.native.requestId??'')){
        sessionId=sid;requestId=flight.native.requestId;
      } else await sleep(15);
    }
    if(!sessionId||!requestId)throw Error('Original postdeadline qualification had no registered native ID');
    const until=start+165_000;
    while(!rejected&&!passed&&performance.now()<until)await sleep(75);
    if(!rejected||passed||settlements!==1||performance.now()-start<119_000 ||
        rejected.message!=='Bounded qualification unverified at bounded-request')
      throw Error('Original 120s deadline did not cancel before late TCP emission: elapsed=' +
        Math.round(performance.now()-start) + ' error=' + String(rejected?.message??'none'));
    const terminalAt=performance.now();
    const callerTerminalAtUnixMs=Date.now();
    const held=await invoke('lm11_acceptance_barrier_status',{stage:'first-output'});
    if(!held?.reached||held.released||held.nativePid!==witness.processId||
        held.nativeEpoch!==witness.epoch||held.originalAggregateBudgetMs!==120_000||
        held.sessionId!==sessionId)
      throw Error('Original real first-output Channel was not held through aggregate deadline');
    const beforeState=captureOriginalLm2fTaskState(sessionId);
    if(!/^inference-\d+$/.test(requestId??'') ||
        !probe.captured.some(row=>row.requestId===requestId&&row.kind==='chunk'))
      throw Error('No original native SSE frame before real aggregate expiry');
    const untilLate=performance.now()+25_000;
    let upstream=null;
    while(performance.now()<untilLate){
      upstream=await invoke('lm11_acceptance_postdeadline_emission');
      if(upstream?.lateContentFrameAttempted && upstream?.lateTerminalFrameAttempted)break;
      await sleep(50);
    }
    if(!upstream?.sameAuthenticatedOriginalHttpSocket ||
        !upstream.firstSseFrameBeforeDeadline ||
        !upstream.lateContentFrameAttempted ||
        !upstream.lateTerminalFrameAttempted ||
        upstream.elapsedSinceFirstSseFrameMs<123_000 ||
        !(upstream.lateContentAttemptAtUnixMs>callerTerminalAtUnixMs) ||
        !(upstream.lateTerminalAttemptAtUnixMs>=upstream.lateContentAttemptAtUnixMs) ||
        upstream.notProofOfDeliveredRendererCallback!==true)
      throw Error('No physical upstream stream AND terminal attempt after original 120s expiry');
    await runner;
    const afterState=captureOriginalLm2fTaskState(sessionId);
    const counts=await invoke('lm11_acceptance_counts');
    const rows=(await invoke('self_hosted_profiles_snapshot'))
      .find(([key])=>key==='selfHostedInference')?.[1]?.fabric?.qualificationReceipts??[];
    const nativeDrained=await invoke('ai_http_request_quiescent',{requestId});
    const lateEvents=probe.captured.filter(row=>row.requestId===requestId&&
      row.at>terminalAt && (row.kind==='chunk'||row.kind==='settled'));
    const actualCleanup=probe.cleaned.some(row=>
      probe.captured.some(event=>event.requestId===requestId&&
        row.channelId===event.channelId));
    if(beforeState!==afterState || !rejected||passed || rows.length ||
        (counts.self_hosted_profiles_qualification_acknowledge??0)!==0 ||
        counts.ai_http_stream!==1 || counts.ai_http_open!==2 ||
        sessionInference(sessionId) || nativeDrained!==true || settlements!==1 || probe.errors())
      throw Error('Genuine late upstream TCP event restored original caller or B03 effect');
    state.native.originalPostDeadline={
      originalProductionRunner:true,originalAggregateBudgetMs:120_000,
      originalSessionId:sessionId,requestId,
      terminalBeforeLateUpstreamTcpEmission:true,
      actualCallerTerminalAtUnixMs:callerTerminalAtUnixMs,
      firstOriginalNativeFrameHeldInActualOwner:true,
      originalCallerDeadlinePhase:'bounded-request',
      firstOriginalNativeFrameBeforeDeadline:true,
      lateNativeProviderContentAttempted:true,lateNativeProviderTerminalAttempted:true,
      lateNativeProviderAttemptElapsedMs:upstream.elapsedSinceFirstSseFrameMs,
      nativeTcpContentWriteSucceeded:upstream.lateContentTcpWriteSucceeded,
      nativeTcpTerminalWriteSucceeded:upstream.lateTerminalTcpWriteSucceeded,
      nativeChannelStructurallyDisposed:actualCleanup,
      lateOriginalChannelCallbacksAfterDeadline:lateEvents.length,
      observedBoundary:actualCleanup?'STRUCTURALLY DISPOSED':
        lateEvents.length?'DELIVERED AND SAFELY IGNORED':'REJECTED BY REQUEST/EPOCH FENCE',
      originalCallerTerminalUnchanged:true,noB03ReceiptsOrAck:true,
      exactNativeRegistryDrained:nativeDrained===true,
      originalOperationElapsedMs:Math.round(terminalAt-start),
    };
    state.outcome='original-postdeadline-upstream-events-fenced';
  }finally{probe.restore();}
}
async function originalManagedAbcDeployments(attached, originalSelection, siblings, routeA, cfg) {
  // Real production original Chat A plus genuine distinct B and C canonical
  // native-managed deployments. No fabricated SDK completions, CAS receipts,
  // model weights, URLs or process IDs. B/C native inference overlaps A; after
  // A's real Stop/restart each B/C uses the unchanged ORIGINAL qualification
  // caller sequentially (the production Chat owner remains single-flight).
  const allSelections=[originalSelection,...siblings];
  if (allSelections.length!==3 ||
      new Set(allSelections.map(s=>s.deployment.id)).size!==3)
    throw Error('ABC must have three original canonical deployments');
  const identities=allSelections.map(s=>({
    deploymentId:s.deployment.id, deploymentIdentity:s.identity,
  }));
  const checkpoint=(stage,sessionId='abc-preflight') =>
    invoke('lm11_acceptance_abc_checkpoint',{stage,sessionId});
  const credentialHash=async key=>{
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(key)));
    return [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  };
  const bindings=[];
  for (const i of [1,2]) {
    const bound=await invoke('lm11_acceptance_abc_bind_child',{
      slot:i===1?'b':'c',...identities[i],digest:cfg.abcDigests[i-1],
    });
    if(bound.deploymentId!==identities[i].deploymentId||
      !Number.isSafeInteger(bound.pid)||bound.pid<1||
      !/^[0-9a-f]{64}$/.test(bound.epoch??'')||!Number.isSafeInteger(bound.port))
      throw Error('ABC child did not bind exact physical native owner');
    bindings.push(bound);
  }
  const nativeStatuses=[];
  const routes=[];
  const initialEpoch=state.native.bind.epoch;
  const initialPid=state.native.bind.pid;
  for (const [i,identity] of identities.entries()) {
    const status=await invoke('managed_local_runtime_status',identity);
    const expected=i===0?{epoch:initialEpoch,pid:initialPid}:bindings[i-1];
    if(status.state!=='Ready'||!status.installed||
      status.deploymentId!==identity.deploymentId||
      status.epoch!==expected.epoch||status.processId!==expected.pid||
      status.modelDigest!==(i===0?cfg.digest:cfg.abcDigests[i-1]))
      throw Error('ABC physical child is not exact native authenticated Ready');
    const route=await invoke('managed_local_runtime_route',{
      ...identity,epoch:status.epoch,
    });
    if(route.epoch!==status.epoch||route.processId!==status.processId||
      !/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(route.baseUrl)||
      !/^[0-9a-f]{64}$/.test(route.apiKey)||
      !/^clack-[0-9a-f]{16}$/.test(route.modelAlias))
      throw Error('ABC exact native route has no authenticated own loopback');
    nativeStatuses.push(status);
    routes.push(route);
  }
  if(new Set(nativeStatuses.map(s=>s.processId)).size!==3||
    new Set(nativeStatuses.map(s=>s.epoch)).size!==3||
    new Set(routes.map(r=>r.baseUrl)).size!==3||
    new Set(routes.map(r=>r.apiKey)).size!==3||
    new Set(routes.map(r=>r.modelAlias)).size!==3)
    throw Error('ABC independent actual PID/epoch/port/bearer/model alias collapsed');
  // The exact two cross-route bearer probes must be rejected by the genuine
  // synthetic HTTP service; no credential bytes are emitted in the report.
  const denied=await Promise.all([
    nativeHttp(routes[1],{token:routes[2].apiKey}),
    nativeHttp(routes[2],{token:routes[1].apiKey}),
  ]);
  if(denied.some(item=>!item.events.some(ev=>ev.status===401)))
    throw Error('ABC cross-deployment native HTTP bearer was accepted');
  await checkpoint('abc-ready');

  let aSuccess=null,aError=null;
  const originalA=runManagedChatQualification(attached.selectionId).then(
    result=>{aSuccess=result;},error=>{aError=error;});
  let originalSession=null,originalRequest=null;
  const untilA=performance.now()+12_000;
  while(performance.now()<untilA&&!aSuccess&&!aError) {
    const sid=useChatStore.getState().activeSessionId;
    const flight=sid?peekDeploymentQualificationFlight(sid):null;
    if(flight?.native?.opens===1&&/^inference-\d+$/.test(flight.native.requestId??'')) {
      originalSession=sid;originalRequest=flight.native.requestId;break;
    }
    await sleep(10);
  }
  if(!originalSession||!originalRequest)
    throw Error('ABC original A did not register its real native Chat stream');
  await checkpoint('abc-a-request',originalSession);
  const staleTicket=await invoke('self_hosted_profiles_qualification_begin',{
    kind:'lm2f',deploymentId:identities[0].deploymentId,
    runtimeEpoch:initialEpoch,processId:initialPid,
    remainingMs:90_000,deadlineUnixMs:Date.now()+90_000,
  });
  if(!/^[0-9a-f]{32}$/.test(staleTicket.operationId??'')||
     !/^[0-9a-f]{32}$/.test(staleTicket.nativeEpoch??''))
    throw Error('ABC A had no real native scoped qualification ticket');
  const liveIds={b:null,c:null};
  const nativeB=nativeHttp(routes[1],{onRegistered:id=>{liveIds.b=id;},admissionSpec:{
    endpointId:'lm11-abc-b',profileId:'lm11-abc-b',capacity:1,
  }});
  const nativeC=nativeHttp(routes[2],{onRegistered:id=>{liveIds.c=id;},admissionSpec:{
    endpointId:'lm11-abc-c',profileId:'lm11-abc-c',capacity:1,
  }});
  const reach=performance.now()+8_000;
  let reached=false;
  while(performance.now()<reach&&!aSuccess&&!aError) {
    const counts=await invoke('lm11_acceptance_counts');
    // One preflight-denied native stream may exist before this phase. The
    // original A and both sibling operations must independently register.
    if(liveIds.b&&liveIds.c&&(counts.ai_http_stream??0)>=5) {
      const live=await Promise.all([liveIds.b,liveIds.c].map(requestId=>
        invoke('ai_http_request_quiescent',{requestId})));
      if(live.every(quiescent=>quiescent===false)) {reached=true;break;}
    }
    await sleep(10);
  }
  if(!reached||aSuccess||aError)
    throw Error('ABC A/B/C did not overlap actual native inference streams');
  await checkpoint('abc-native-live',originalSession);
  const overlapAt=Date.now();
  const liveAtCancel=await Promise.all([liveIds.b,liveIds.c].map(requestId=>
    invoke('ai_http_request_quiescent',{requestId})));
  if(liveAtCancel.some(quiescent=>quiescent!==false))
    throw Error('ABC B/C native leases were not both live before original A Stop');
  await cancelSessionInference(originalSession,{
    source:'explicit-user',reason:'cancel-requested',
  });
  const aStoppedAt=Date.now();
  await originalA;
  if(aSuccess||!aError||
      !/^Bounded qualification unverified at /.test(String(aError.message??'')))
    throw Error('ABC original A Stop did not reject its real qualification');
  await checkpoint('abc-a-cancel',originalSession);
  const liveBeforeRestart=await Promise.all([liveIds.b,liveIds.c].map(requestId=>
    invoke('ai_http_request_quiescent',{requestId})));
  if(liveBeforeRestart.some(quiescent=>quiescent!==false))
    throw Error('ABC original A Stop prematurely released B/C native leases');
  const restarted=await invoke('lm11_acceptance_abc_restart_a',{
    ...identities[0],digest:cfg.digest,
  });
  const aRestartedAt=Date.now();
  const liveAfterRestart=await Promise.all([liveIds.b,liveIds.c].map(requestId=>
    invoke('ai_http_request_quiescent',{requestId})));
  if(liveAfterRestart.some(quiescent=>quiescent!==false))
    throw Error('ABC A2 restart terminated one of the live B/C native leases');
  if(restarted.oldPid!==initialPid||restarted.oldEpoch!==initialEpoch||
    restarted.newPid===restarted.oldPid||
    restarted.newEpoch===restarted.oldEpoch)
    throw Error('ABC A2 was not an actual separate child PID/epoch');
  const routeA2=await invoke('managed_local_runtime_route',{
    ...identities[0],epoch:restarted.newEpoch,
  });
  if(routeA2.processId!==restarted.newPid||
    routeA2.baseUrl===routes[0].baseUrl||
    routeA2.apiKey===routes[0].apiKey||
    routeA2.epoch===routes[0].epoch)
    throw Error('ABC A2 reused stale original route credential or process');
  const credentialSha256=await Promise.all([...routes.map(r=>r.apiKey),routeA2.apiKey]
    .map(credentialHash));
  if(new Set(credentialSha256).size!==4||
    credentialSha256.some(hash=>!/^[a-f0-9]{64}$/.test(hash)))
    throw Error('ABC native route bearer fingerprints were not distinct');
  await mustReject('abc-stale-a-route-after-a2',()=>invoke('managed_local_runtime_route',{
    ...identities[0],epoch:initialEpoch,
  }));
  // The original A request ID is retired. An A2 credential cannot revive it,
  // and cancelling that retired ID cannot revoke either live sibling lease.
  await mustReject('abc-stale-a-native-request-after-a2',()=>invoke('ai_http_stream',{
    requestId:originalRequest,url:routeA2.baseUrl+'/chat/completions',method:'POST',
    headers:{authorization:'Bearer '+routeA2.apiKey,'content-type':'application/json'},
    body:[...new TextEncoder().encode(requestBody(routeA2.modelAlias))],
    allowPrivateNetwork:true,timeoutPolicy:'self-hosted',
    admission:{endpointId:'lm11-abc-stale-a',profileId:'lm11-abc-stale-a',capacity:1},
    requirePreflight:false,onEvent:new Channel(),
  }));
  await invoke('ai_http_cancel',{
    requestId:originalRequest,cancellationOrigin:'parent-signal',
  });
  const siblingsAfterStaleACancel=await Promise.all([liveIds.b,liveIds.c].map(requestId=>
    invoke('ai_http_request_quiescent',{requestId})));
  if(siblingsAfterStaleACancel.some(quiescent=>quiescent!==false))
    throw Error('ABC stale A native cancellation revoked live B/C ownership');
  await checkpoint('abc-a2-restart',originalSession);
  await checkpoint('abc-await-bc',originalSession);
  const [resultB,resultC]=await Promise.all([nativeB,nativeC]);
  await checkpoint('abc-bc-terminal',originalSession);
  const siblingTerminalAt=Date.now();
  if(new Set([originalRequest,resultB.requestId,resultC.requestId]).size!==3||
    resultB.streamRejected||resultC.streamRejected||
    resultB.terminal?.phase!=='completed'||resultC.terminal?.phase!=='completed'||
    !resultB.events.some(ev=>ev.kind==='chunk')||
    !resultC.events.some(ev=>ev.kind==='chunk'))
    throw Error('ABC A cancellation or restart altered B/C native stream results');
  const siblingDrained=await Promise.all([liveIds.b,liveIds.c].map(requestId=>
    invoke('ai_http_request_quiescent',{requestId})));
  if(siblingDrained.some(quiescent=>quiescent!==true))
    throw Error('ABC B/C actual native leases did not drain after completion');
  let oldPrepare='ipc-rejected',oldAck='ipc-rejected';
  await checkpoint('abc-stale-begin',originalSession);
  const before=(await invoke('self_hosted_profiles_snapshot'))
    .find(([key])=>key==='selfHostedInference')?.[1];
  try {
    oldPrepare=await invoke('self_hosted_profiles_qualification_prepare',{
      ticket:staleTicket,expected:before,value:before,
    });
  }catch{}
  try {
    oldAck=await invoke('self_hosted_profiles_qualification_acknowledge',{
      ticket:staleTicket,
    });
  }catch{}
  if(!['rejected','ipc-rejected'].includes(oldPrepare)||
     !['rejected','ipc-rejected'].includes(oldAck))
    throw Error('ABC stale original A ticket crossed real native B03 after A2');
  const staleReconcile=await invoke('self_hosted_profiles_qualification_reconcile',{
    ticket:staleTicket,
  });
  if(staleReconcile!=='not-committed')
    throw Error('ABC stale original A ticket was not genuinely uncommitted');
  await checkpoint('abc-stale-rejected',originalSession);
  // The two sibling original qualification callers are SERIAL, not invented
  // parallel Chat/SDK operations. Their routes/pids remained live throughout
  // A cancellation and A2 restart and must persist their own native B03 ACK.
  const originalResults=[];
  const originalNativeIds=[];
  for (const [i,selection] of siblings.entries()) {
    await checkpoint(i===0?'abc-start-b-qualification':'abc-start-c-qualification',originalSession);
    const previous=new Set([originalRequest,resultB.requestId,resultC.requestId,...originalNativeIds]);
    let settled=false,originalError=null,originalValue=null;
    const originalOperation=runManagedChatQualification(selection.selectionId).then(
      value=>{originalValue=value;settled=true;},
      error=>{originalError=error;settled=true;});
    let originalNativeId=null;
    const nativeDeadline=performance.now()+12_000;
    while(!settled&&performance.now()<nativeDeadline) {
      const session=useChatStore.getState().activeSessionId;
      const flight=session?peekDeploymentQualificationFlight(session):null;
      const id=flight?.native?.requestId;
      if(flight?.native?.opens===1&&/^inference-\d+$/.test(id??'')&&!previous.has(id)) {
        originalNativeId=id;
        break;
      }
      await sleep(10);
    }
    await originalOperation;
    if(originalError)throw originalError;
    const result=originalValue;
    if(!originalNativeId)
      throw Error('ABC original B/C Chat did not expose its exact native request ID');
    if(result.deploymentId!==selection.deployment.id||result.receiptCount!==4||
      result.chat!=='verified'||result.streaming!=='verified'||
      result.terminalCompletion!=='verified'||
      result.instructionAdherence!=='verified')
      throw Error('ABC sibling original Chat did not genuinely qualify its own deployment');
    originalResults.push(result);
    originalNativeIds.push(originalNativeId);
    await checkpoint(i===0?'abc-qualified-b':'abc-qualified-c',originalSession);
  }
  const current=(await invoke('self_hosted_profiles_snapshot'))
    .find(([key])=>key==='selfHostedInference')?.[1];
  const receipts=current?.fabric?.qualificationReceipts??[];
  const caps=['chat','streaming','terminal-completion','instruction-adherence'];
  const scopedTickets=[];
  if(receipts.length!==8||
    receipts.some(row=>row.scope?.deploymentId===identities[0].deploymentId))
    throw Error('ABC original A was retroactively promoted or sibling B03 missing');
  for(const identity of identities.slice(1)) {
    const own=receipts.filter(row=>row.scope?.deploymentId===identity.deploymentId);
    const tickets=new Set(own.map(row=>
      row.qualificationCas?.operationId+':'+row.qualificationCas?.nativeEpoch));
    if(own.length!==4||tickets.size!==1||
      caps.some(cap=>own.filter(row=>row.capability===cap).length!==1)||
      own.some(row=>row.version!==2||row.status!=='verified'||
        row.qualificationCas?.phase!=='acknowledged'))
      throw Error('ABC B/C genuine native B03 receipt ownership not isolated');
    const marker=own[0].qualificationCas;
    const reconcile=await invoke('self_hosted_profiles_qualification_reconcile',{
      ticket:{operationId:marker.operationId,nativeEpoch:marker.nativeEpoch},
    });
    if(reconcile!=='committed')
      throw Error('ABC B/C committed actual native ticket not read-only reconciled');
    scopedTickets.push(tickets.values().next().value);
  }
  if(new Set(scopedTickets).size!==2)throw Error('ABC B/C B03 ticket identity was reused');
  for(let i=1;i<3;i++){
    const after=await invoke('managed_local_runtime_status',identities[i]);
    const route=await invoke('managed_local_runtime_route',{
      ...identities[i],epoch:nativeStatuses[i].epoch,
    });
    if(after.state!=='Ready'||after.processId!==nativeStatuses[i].processId||
      after.epoch!==nativeStatuses[i].epoch||route.baseUrl!==routes[i].baseUrl||
      route.apiKey!==routes[i].apiKey||route.modelAlias!==routes[i].modelAlias)
      throw Error('ABC selective A2 restart disturbed authenticated B/C native Ready');
  }
  const counts=await invoke('lm11_acceptance_counts');
  await checkpoint('abc-persisted-verified',originalSession);
  state.native.managedABC={
    threeCanonicalDeploymentsRegistered:true,
    threeSimultaneousRealNativeChildren:true,
    distinctNativePidEpochPortCredential:true,
    originalOwnerWitnesses:nativeStatuses.map((s,i)=>({
      slot:['a','b','c'][i],deploymentId:s.deploymentId,
      pid:s.processId,epoch:s.epoch,port:Number(new URL(routes[i].baseUrl).port),
      modelAlias:routes[i].modelAlias,runtimeId:s.runtimeId,
      deploymentIdentityHash:s.deploymentIdentityHash,
    })),
    a2OwnerWitness:{deploymentId:identities[0].deploymentId,pid:restarted.newPid,
      epoch:restarted.newEpoch,port:Number(new URL(routeA2.baseUrl).port),
      modelAlias:routeA2.modelAlias},
    credentialSha256,
    originalAQualification:true,originalASessionId:originalSession,
    originalARequestId:originalRequest,
    independentBRequestId:resultB.requestId,
    independentCRequestId:resultC.requestId,
    BAndCStreamsOverlappedOriginalA:true,
    liveBAndCNativeLeasesAtACancel:true,
    liveBAndCNativeLeasesDuringA2Restart:true,
    BAndCNativeLeasesDrainedOnlyAfterOwnTerminals:true,
    overlapAtUnixMs:overlapAt,originalAStopAtUnixMs:aStoppedAt,
    A2RestartAtUnixMs:aRestartedAt,siblingTerminalsAtUnixMs:siblingTerminalAt,
    originalAStoppedAndRejected:true,staleAReconcile:staleReconcile,
    staleARouteRejectedAfterA2:true,staleANativeRequestRejectedAfterA2:true,
    staleACancellationDidNotCancelLiveBC:true,
    staleANativePrepareRejected:true,staleANativeAckRejected:true,
    exactA2Restart:true,oldAPid:initialPid,newA2Pid:restarted.newPid,
    oldAEpoch:initialEpoch,newA2Epoch:restarted.newEpoch,
    originalBSucceeded:true,originalCSucceeded:true,
    originalBRequestId:originalResults[0].requestId,
    originalCRequestId:originalResults[1].requestId,
    originalBNativeRequestId:originalNativeIds[0],
    originalCNativeRequestId:originalNativeIds[1],
    originalADeploymentId:identities[0].deploymentId,
    originalBDeploymentId:identities[1].deploymentId,
    originalCDeploymentId:identities[2].deploymentId,
    BAndCRemainedReadyAndAuthenticated:true,
    exactTwoSeparateAcknowledgedTicketGroups:true,
    exactlyEightOriginalQualificationReceipts:true,
    zeroOriginalAQualificationReceipts:true,
    actualOriginalB03AckCount:counts.self_hosted_profiles_qualification_acknowledge??0,
    actualNativeStreams:counts.ai_http_stream??0,
    noRealModel:true,
  };
  state.outcome='original-three-deployment-native-isolation';
}
async function originalAbcNativeIsolation(attached,route) {
  // Actual qualification A owns the original Chat/SDK flight. The global
  // managed RuntimeOwner forbids distinct concurrent managed deployments;
  // two further real native requests B/C may nevertheless be concurrently
  // registered, and their exact IDs MUST survive cancellation of only A.
  let originalSucceeded=false,originalError=null;
  const original=runManagedChatQualification(attached.selectionId).then(
    ()=>{originalSucceeded=true;},error=>{originalError=error;});
  const start=performance.now();
  let sessionId=null,requestId=null;
  const until=start+12_000;
  while(performance.now()<until && !originalSucceeded&&!originalError){
    const sid=useChatStore.getState().activeSessionId;
    const flight=sid?peekDeploymentQualificationFlight(sid):null;
    if(flight?.native?.opens===1 && /^inference-\d+$/.test(flight.native.requestId??'')){
      sessionId=sid;requestId=flight.native.requestId;break;
    }
    await sleep(10);
  }
  if(!requestId||!sessionId)throw Error('Original A did not register exactly one native request');
  let denied=false;
  try {await runManagedChatQualification(attached.selectionId);}
  catch(error){denied=/already|active|progress|qualif/i.test(String(error.message??error));}
  if(!denied)throw Error('Concurrent competing same-deployment original qualification bypassed single-flight');
  const baseline=(await invoke('self_hosted_profiles_snapshot'))
    .find(([key])=>key==='selfHostedInference')?.[1];
  const unrelated=JSON.stringify(baseline?.revision??null);
  const counts0=await invoke('lm11_acceptance_counts');
  const B=nativeHttp(route);
  const C=nativeHttp(route);
  const registeredUntil=performance.now()+8_000;
  let counts=null;
  while(performance.now()<registeredUntil){
    counts=await invoke('lm11_acceptance_counts');
    if((counts.ai_http_open??0)>=4 && (counts.ai_http_stream??0)>=3)break;
    await sleep(10);
  }
  if(!counts || (counts.ai_http_open??0)!==4 || (counts.ai_http_stream??0)!==3)
    throw Error('Independent B and C native requests were not registered while original A was live');
  if(originalSucceeded||originalError)throw Error('Original A settled before independent B/C registration');
  await cancelSessionInference(sessionId,{source:'explicit-user',reason:'cancel-requested'});
  await original;
  if(!originalError||originalSucceeded||
      !/^Bounded qualification unverified at /.test(String(originalError.message??'')))
    throw Error('Cancelling A unexpectedly passed the original qualification');
  const [b,c]=await Promise.all([B,C]);
  if(!/^inference-\d+$/.test(b.requestId)||!/^inference-\d+$/.test(c.requestId)||
      new Set([requestId,b.requestId,c.requestId]).size!==3 ||
      b.terminal?.phase!=='completed'||c.terminal?.phase!=='completed'||
      b.streamRejected||c.streamRejected||
      b.events.filter(x=>x.kind==='chunk').length<1 ||
      c.events.filter(x=>x.kind==='chunk').length<1)
    throw Error('Original A cancellation contaminated B/C genuine native request stream or completion');
  const countsAfter=await invoke('lm11_acceptance_counts');
  const rows=(await invoke('self_hosted_profiles_snapshot'))
    .find(([key])=>key==='selfHostedInference')?.[1];
  if(JSON.stringify(rows?.revision??null)!==unrelated ||
      (rows?.fabric?.qualificationReceipts??[]).length ||
      (countsAfter.self_hosted_profiles_qualification_acknowledge??0)!==0 ||
      countsAfter.ai_http_stream!==3 || sessionInference(sessionId))
    throw Error('A cancellation mutated isolated C settings or B03 authority');
  state.native.originalABC={
    originalAQualification:true,originalASessionId:sessionId,
    originalARequestId:requestId,liveBRequestId:b.requestId,liveCRequestId:c.requestId,
    BAndCNativeRegisteredBeforeACancellation:true,
    sameDeploymentCompetitorDeniedAtOriginalSingleFlight:true,
    ACallerCancelledOnly:true,BTerminalCompleted:true,CTerminalCompleted:true,
    threeUniqueNativeRequestIds:true,zeroB03Effects:true,
    unrelatedSettingsRevisionPreserved:true,
    runtimeDeploymentConcurrencyStructurallyUnavailable:true,
    exactNativeStreamCount:countsAfter.ai_http_stream,
    nativeOpenBeforeAdditional:counts0.ai_http_open,
  };
  state.outcome='original-a-b-c-native-cancel-isolated';
}
async function originalNativeQuiescenceFailure(attached) {
  // Real SDK/Chat qualification and exactly one registered native stream.
  // Only the feature host holds the ORIGINAL native terminal/lease after the
  // HTTP transport returned, longer than the native quiescence grace.
  const probe=observeOriginalLm2fChannel();
  let settled=null,failed=null;
  const runner=runManagedChatQualification(attached.selectionId).then(
    value=>{settled=value;},error=>{failed=error;});
  try {
    const until=performance.now()+15_000;
    let sessionId=null,requestId=null;
    while(performance.now()<until&&!settled&&!failed){
      const sid=useChatStore.getState().activeSessionId;
      const flight=sid?peekDeploymentQualificationFlight(sid):null;
      if(flight?.native?.opens===1 && /^inference-\d+$/.test(flight.native.requestId??'')){
        sessionId=sid;requestId=flight.native.requestId;break;
      }
      await sleep(10);
    }
    if(!requestId)throw Error('Native quiescence fault lacked a genuinely registered exact native ID');
    await runner;
    const stillOwnedAtFailure = await invoke('ai_http_request_quiescent',{
      requestId,
    }) === false;
    let finallyDrained = false;
    const untilDrained = performance.now() + 7000;
    while (performance.now() < untilDrained) {
      finallyDrained = await invoke('ai_http_request_quiescent',{requestId}) === true;
      if (finallyDrained) break;
      await sleep(25);
    }
    const rows=(await invoke('self_hosted_profiles_snapshot'))
      .find(([key])=>key==='selfHostedInference')?.[1]?.fabric?.qualificationReceipts??[];
    const counts=await invoke('lm11_acceptance_counts');
    const callback=probe.captured.filter(row=>row.requestId===requestId&&row.kind==='settled');
    const validFailure=!!failed && !settled &&
      /^Bounded qualification unverified at native-quiescence/.test(failed.message);
    if(!validFailure || !stillOwnedAtFailure || !finallyDrained ||
        rows.length || (counts.self_hosted_profiles_qualification_acknowledge??0)>0 ||
        counts.ai_http_stream!==1 || callback.length!==1 ||
        sessionInference(sessionId) || probe.errors())
      throw Error('Real native quiescence did not fail closed: result=' +
        (settled?'success':failed?.message??'none') + ' nativeSettled=' + callback.length +
        ' receiptCount=' + rows.length);
    state.native.originalQuiescence={
      originalProductionRunner:true,requestId,sessionId,
      nativeLeaseHeldAfterHttpFinished:true,originalQuiescenceGraceExceeded:true,
      terminalFailClosed:true,noB03AckOrReceipts:true,
      callerFailedWhileActualNativeLeaseRegistered:stillOwnedAtFailure,
      eventuallyDrainedActualNativeRegistry:finallyDrained,
    };
    state.outcome='original-native-quiescence-failed';
  }finally{probe.restore();}
}
const admission = { endpointId: 'lm11-isolated-transport', profileId: 'lm11-synthetic', capacity: 1 };
function requestBody(alias) {
  return JSON.stringify({
    model: alias, stream: true, messages: [
      { role: 'system', content: 'ACTIVE AGENT: Coder. Synthetic transport test, no model.' },
      { role: 'user', content: 'Reply with exactly LM2F-CHAT-QUALIFIED and nothing else.' },
    ],
  });
}
async function nativeHttp(route, {
  token = route.apiKey, model = route.modelAlias, cancelAt = null,
  cancelAfterMs = null, admissionSpec = admission,
  headerTimeoutMs = 5000,
  armCancelAck = false,
  onFirstChunk = null,
  onRegistered = null,
} = {}) {
  const requestId = await invoke('ai_http_open');
  if(onRegistered)onRegistered(requestId);
  if (armCancelAck && await invoke('lm11_acceptance_arm_cancel_ack', { requestId }) !== true)
    throw new Error('Exact native post-handler cancellation ACK fault did not arm');
  const events = [];
  let cancelPromise;
  let cancelMs = null;
  let cancelAckFailed = false;
  let streamRejected = false;
  let terminalAt = null;
  let onFirstChunkPromise = null;
  const doCancel = () => {
    if (cancelPromise) return;
    const start = performance.now();
    cancelPromise = invoke('ai_http_cancel', {
      requestId, cancellationOrigin: 'parent-signal',
    }).then(() => { cancelMs = performance.now() - start; }, () => {
      cancelAckFailed = true;
      cancelMs = performance.now() - start;
    });
  };
  const channel = new Channel();
  channel.onmessage = (event) => {
    if (event.requestId !== requestId) throw new Error('Misowned native stream channel event');
    events.push({ kind: event.kind, phase: event.phase, status: event.status,
      code: event.error?.code, text: event.kind === 'chunk' ?
        new TextDecoder().decode(Uint8Array.from(event.bytes)).slice(0, 512) : null,
      at: performance.now(),
    });
    if (event.kind === 'settled') terminalAt = performance.now();
    if (event.kind === 'chunk' && onFirstChunk && !onFirstChunkPromise)
      onFirstChunkPromise=Promise.resolve().then(onFirstChunk);
    if (!cancelPromise && cancelAt === event.kind) {
      doCancel();
    }
  };
  const started = performance.now();
  const cancelTimer = cancelAfterMs == null ? null : setTimeout(doCancel, cancelAfterMs);
  await invoke('ai_http_stream', {
    requestId, url: route.baseUrl + '/chat/completions', method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: [...new TextEncoder().encode(requestBody(model))],
    allowPrivateNetwork: true, timeoutPolicy: 'self-hosted', admission: admissionSpec,
    requirePreflight: false, onEvent: channel,
  }).catch(() => { streamRejected = true; });
  if (cancelTimer !== null) clearTimeout(cancelTimer);
  await cancelPromise;
  if(onFirstChunkPromise)await onFirstChunkPromise;
  const limit = performance.now() + headerTimeoutMs;
  while (!events.some(event => event.kind === 'settled') && performance.now() < limit) await sleep(10);
  const terminal = events.find(event => event.kind === 'settled');
  if (!terminal && !streamRejected) throw new Error('Native HTTP stream returned without terminal channel event');
  return { requestId, terminal, events, streamRejected, cancelAckFailed,
    cancelMs, started, terminalAt, durationMs: performance.now() - started };
}
async function wrongPid(deploymentId, witness) {
  await mustReject('wrong-pid', () => invoke('self_hosted_profiles_qualification_begin', {
    kind: 'lm2f', deploymentId, runtimeEpoch: witness.epoch,
    processId: witness.processId + 1, remainingMs: 1000,
    deadlineUnixMs: Date.now() + 1000,
  }));
}
async function nativeDeadline(deploymentId, witness, duringPreparation) {
  if (!duringPreparation) {
    await mustReject('expired-before-admission', () => invoke('self_hosted_profiles_qualification_begin', {
      kind: 'lm2f', deploymentId, runtimeEpoch: witness.epoch,
      processId: witness.processId, remainingMs: 1000,
      deadlineUnixMs: Date.now() - 10,
    }));
    return;
  }
  const ticket = await invoke('self_hosted_profiles_qualification_begin', {
    kind: 'lm2f', deploymentId, runtimeEpoch: witness.epoch,
    processId: witness.processId, remainingMs: 90,
    deadlineUnixMs: Date.now() + 90,
  });
  try {
    await sleep(250);
    const old = (await invoke('self_hosted_profiles_snapshot'))
      .find(([key]) => key === 'selfHostedInference')?.[1] ?? null;
    const result = await invoke('self_hosted_profiles_qualification_prepare', {
      ticket, expected: old, value: old,
    });
    if (result !== 'rejected') throw new Error('Expired native prepare unexpectedly returned ' + result);
    state.negative.push({ name: 'expired-before-prepare', rejected: true });
  } finally { await invoke('self_hosted_profiles_qualification_cancel', { ticket }); }
}
async function preflightDenied(reservedId = null) {
  const id = reservedId ?? await invoke('ai_http_open');
  let terminal;
  const channel = new Channel();
  channel.onmessage = (ev) => {
    if (ev.requestId !== id) throw new Error('Unexpected native channel request ID');
    if (ev.kind === 'preflight') void invoke('ai_http_preflight', { requestId: id, approved: false });
    if (ev.kind === 'settled') terminal = ev;
  };
  await invoke('ai_http_stream', {
    requestId: id, url: 'http://127.0.0.1:9/v1/chat/completions', method: 'POST',
    body: [123,125], allowPrivateNetwork: true,
    timeoutPolicy: 'self-hosted',
    admission: { endpointId: 'test-preflight', profileId: 'fixture', capacity: 1 },
    requirePreflight: true, onEvent: channel,
  });
  const deadline = performance.now() + 3000;
  while (!terminal && performance.now() < deadline) await new Promise(r => setTimeout(r, 10));
  if (!terminal || terminal.phase !== 'failed' || terminal.error?.code !== 'context-preflight-rejected')
    throw new Error('Negative preflight terminal event absent');
  state.negative.push({ name: 'preflight-denied-no-http', requestId: id, terminal: terminal.phase });
}
async function exerciseRuntimeScenario(mode, selection, witness, route) {
  if (await invoke('lm11_acceptance_runtime_activate') !== mode)
    throw new Error('Native did not arm this exact acceptance runtime fault');
  step('real IPC runtime behavior: ' + mode);
  const seen = { mode, exactService: true, noModel: true };
  const complete = (result) => {
    if (result.streamRejected || result.terminal?.phase !== 'completed' ||
        !result.events.some(row => row.kind === 'chunk' && row.text?.includes('LM2F-CHAT-QUALIFIED')))
      throw new Error('Deterministic native stream was not completed with expected bytes');
    seen.requestId = result.requestId;
    seen.terminal = result.terminal.phase;
  };
  const cancelled = (result) => {
    if (result.streamRejected || result.terminal?.phase !== 'cancelled' ||
        !result.events.some(row => row.kind === 'settled'))
      throw new Error('Native request did not settle as cancelled');
    seen.requestId = result.requestId;
    seen.terminal = result.terminal.phase;
  };
  switch (mode) {
    case 'authenticated-readiness-success': {
      const next = await invoke('managed_local_runtime_status');
      if (!next.installed || next.state !== 'Ready' || next.epoch !== witness.epoch ||
          next.processId !== witness.processId)
        throw new Error('Production authenticated Ready witness rejected after runtime arming');
      seen.ready = true;
      break;
    }
    case 'delayed-readiness': {
      const start = performance.now();
      const status = await invoke('managed_local_runtime_status');
      const elapsed = performance.now() - start;
      if (status.state !== 'Ready' || status.epoch !== witness.epoch || elapsed < 260 || elapsed > 1500)
        throw new Error('Native authenticated health did not observe controlled readiness delay');
      seen.delayObservedMs = Math.round(elapsed);
      break;
    }
    case 'authenticated-health-failure': {
      const health = await invoke('managed_local_runtime_status');
      if (health.state === 'Ready') throw new Error('503 authenticated health did not withdraw Ready');
      await mustReject('route-after-503', () => invoke('managed_local_runtime_route', {
        deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
      }));
      seen.healthFailed = true;
      break;
    }
    case 'cancel-before-registration': {
      const before = await invoke('lm11_acceptance_counts');
      const controller = new AbortController(); controller.abort();
      await mustReject('pre-registration-cancel', () => createProxyFetch({ selfHosted: true, allowPrivateNetwork: true })
        (route.baseUrl + '/chat/completions', { method: 'POST', body: requestBody(route.modelAlias), signal: controller.signal }));
      const after = await invoke('lm11_acceptance_counts');
      if (before.ai_http_open !== after.ai_http_open || before.ai_http_stream !== after.ai_http_stream)
        throw new Error('Pre-registration renderer Stop caused late native dispatch');
      seen.zeroLateDispatch = true;
      break;
    }
    case 'cancel-immediately-after-registration': {
      const id = await invoke('ai_http_open');
      await invoke('ai_http_cancel', { requestId: id, cancellationOrigin: 'parent-signal' });
      seen.requestId = id;
      seen.cancelAcknowledged = true;
      break;
    }
    case 'registration-after-renderer-cancellation': {
      const controller = new AbortController();
      const fetcher = createProxyFetch({ selfHosted: true, allowPrivateNetwork: true, admission });
      const promise = fetcher(route.baseUrl + '/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + route.apiKey },
        body: requestBody(route.modelAlias), signal: controller.signal,
      });
      const timer = setTimeout(() => controller.abort(), 65);
      await mustReject('late-native-registration-cancel', () => promise);
      clearTimeout(timer);
      const after = await invoke('lm11_acceptance_counts');
      if ((after.ai_http_open ?? 0) < 2 || (after.ai_http_cancel ?? 0) < 2 || (after.ai_http_stream ?? 0) !== 0)
        throw new Error('Late native registration did not cancel its own ID or dispatched HTTP');
      seen.lateIdCancelled = true;
      break;
    }
    case 'request-admission-failure': {
      const result = await nativeHttp(route, { admissionSpec: { ...admission, capacity: 0 } });
      if (result.terminal?.phase !== 'failed' || result.terminal.code !== 'invalid-capacity')
        throw new Error('Native admission rejected through wrong boundary');
      seen.requestId = result.requestId;
      seen.error = result.terminal.code;
      break;
    }
    case 'deterministic-streaming-response':
    case 'terminal-completion':
    case 'delayed-request-acceptance':
    case 'delayed-first-stream-event':
    case 'delayed-terminal-event': {
      const result = await nativeHttp(route);
      complete(result);
      if (mode === 'delayed-request-acceptance' && result.durationMs < 310)
        throw new Error('Synthetic request-acceptance delay was bypassed');
      if (mode === 'delayed-first-stream-event') {
        const headers = result.events.find(row => row.kind === 'headers')?.at;
        const first = result.events.find(row => row.kind === 'chunk')?.at;
        if (!headers || !first || first - headers < 290)
          throw new Error('First native SSE frame arrived before controlled delay');
      }
      if (mode === 'delayed-terminal-event') {
        const firstText = result.events.find(row => row.kind === 'chunk' && row.text?.includes('LM2F-CHAT-QUALIFIED'))?.at;
        if (!firstText || !result.terminalAt || result.terminalAt - firstText < 330)
          throw new Error('Native terminal settled before delayed completion');
      }
      seen.durationMs = Math.round(result.durationMs);
      break;
    }
    case 'never-terminal-until-cancellation':
    case 'cancel-during-streaming':
    case 'late-stream-event-after-cancellation':
    case 'delayed-cancellation-ack':
    case 'cancellation-ack-failure': {
      const result = await nativeHttp(route, { cancelAt: 'chunk',
        armCancelAck: mode === 'delayed-cancellation-ack' || mode === 'cancellation-ack-failure',
      });
      cancelled(result);
      if (mode === 'delayed-cancellation-ack' && (result.cancelMs ?? 0) < 230)
        throw new Error('Delayed native cancellation acknowledgment did not delay');
      if (mode === 'cancellation-ack-failure' && !result.cancelAckFailed)
        throw new Error('Native cancellation ACK failure was not observed by renderer');
      if (mode === 'late-stream-event-after-cancellation') {
        const count = result.events.length;
        await sleep(700);
        if (result.events.length !== count)
          throw new Error('Native delivered a frame after cancellation terminal');
        seen.lateFrameRejected = true;
      }
      seen.cancelAckFailed = result.cancelAckFailed;
      seen.cancelAckMs = Math.round(result.cancelMs ?? 0);
      break;
    }
    case 'transport-failure':
    case 'connection-close-without-terminal': {
      const result = await nativeHttp(route);
      if (!['disconnected','failed'].includes(result.terminal?.phase))
        throw new Error('Native transport failure was promoted to a completed terminal');
      seen.requestId = result.requestId;
      seen.terminal = result.terminal.phase;
      break;
    }
    case 'malformed-stream-frame': {
      const result = await nativeHttp(route);
      if (!result.events.some(row => row.kind === 'chunk' && row.text?.includes('deliberately not JSON')))
        throw new Error('Malformed SSE payload never crossed native renderer IPC');
      // This is a transport-fidelity observation; malformed SDK parser behavior
      // requires its own SDK consumer and is never promoted to model success.
      seen.requestId = result.requestId;
      seen.malformedBytesDelivered = true;
      break;
    }
    case 'terminal-error': {
      const result = await nativeHttp(route);
      if (result.events.find(row => row.kind === 'headers')?.status !== 500)
        throw new Error('Synthetic HTTP terminal error was not preserved by native IPC');
      seen.requestId = result.requestId;
      seen.httpStatus = 500;
      break;
    }
    case 'first-output-after-aggregate-deadline': {
      const result = await nativeHttp(route, { cancelAfterMs: 125 });
      cancelled(result);
      if (result.events.some(row => row.kind === 'chunk'))
        throw new Error('Expired bounded renderer operation received late first output');
      seen.noOutputAfterDeadline = true;
      break;
    }
    case 'terminal-callback-after-deadline': {
      const result = await nativeHttp(route, { cancelAfterMs: 185 });
      cancelled(result);
      seen.noCompletedTerminalAfterDeadline = true;
      break;
    }
    case 'cancellation-terminal-race': {
      const result = await nativeHttp(route, { cancelAfterMs: 150 });
      if (!['completed','cancelled'].includes(result.terminal?.phase) ||
          result.events.filter(row => row.kind === 'settled').length !== 1)
        throw new Error('Native cancellation/terminal race did not settle exactly once');
      seen.requestId = result.requestId;
      seen.terminal = result.terminal.phase;
      break;
    }
    case 'runtime-epoch-change-mid-request': {
      let nextEpoch;
      const rotate = sleep(130).then(() => invoke('lm11_acceptance_rotate_epoch'))
        .then(value => { nextEpoch = value; });
      const result = await nativeHttp(route, { cancelAfterMs: 230 });
      await rotate;
      cancelled(result);
      if (!nextEpoch || nextEpoch === witness.epoch) throw new Error('Native runtime epoch failed to rotate');
      await mustReject('stale-midstream-route', () => invoke('managed_local_runtime_route', {
        deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
        epoch: witness.epoch,
      }));
      seen.requestId = result.requestId;
      seen.staleNativeEpochRejected = true;
      break;
    }
    case 'runtime-process-exits-mid-request': {
      const terminate = sleep(135).then(() => invoke('lm11_acceptance_stop_service'));
      const result = await nativeHttp(route);
      await terminate;
      if (!['disconnected','failed'].includes(result.terminal?.phase))
        throw new Error('Synthetic service death did not interrupt native in-flight stream');
      const after = await invoke('managed_local_runtime_status');
      if (after.state === 'Ready') throw new Error('Dead synthetic service retained native Ready');
      seen.requestId = result.requestId;
      seen.terminal = result.terminal.phase;
      seen.processReaped = true;
      break;
    }
    default: throw new Error('Runtime behavior has no executable native renderer acceptance: ' + mode);
  }
  state.runtimeChecks = seen;
  state.outcome = 'runtime-fault-observed';
}
async function main() {
  const cfg = await (await fetch('/lm11-acceptance-fixture.json', { cache: 'no-store' })).json();
  state.scenario = cfg.scenario;
  if (!cfg.syntheticOnly || !/^sha256:[0-9a-f]{64}$/.test(cfg.digest)) throw new Error('Unsafe fixture configuration');
  if (!('__TAURI_INTERNALS__' in window)) throw new Error('Not a real Tauri WebView2 renderer');
  step('isolated native preferences hydrate');
  await usePreferencesStore.getState().init();
  useAgentsStore.setState({ activeId: 'builtin:coder', hydrated: true });
  const baseline = usePreferencesStore.getState().selfHostedInference;
  // A fresh preferences migration may synthesize an ordinary localhost Ollama
  // endpoint. This is not an imported managed model or a qualification grant.
  // The native host separately proves the physical AppData file is under the
  // unique case root, so no preexisting user registry can enter this fixture.
  if (baseline.fabric?.deployments?.length || baseline.fabric?.qualificationReceipts?.length ||
      baseline.fabric?.measurementRuns?.length)
    throw new Error('Fixture already contains a managed deployment or evidence');
  const initial = attachManagedLocalGguf(baseline, {
    digest: cfg.digest, displayName: 'SYNTHETIC NO MODEL',
    material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
  });
  const abc = cfg.scenario === 'original-managed-abc-deployments';
  const abcAttachments = [];
  let projected = initial.state;
  if (abc) {
    if (!Array.isArray(cfg.abcDigests) || cfg.abcDigests.length !== 2 ||
        !cfg.abcDigests.every(d => /^sha256:[a-f0-9]{64}$/.test(d)) ||
        new Set([cfg.digest,...cfg.abcDigests]).size !== 3)
      throw Error('ABC synthetic deployment identities are not exact and distinct');
    for (const [index,digest] of cfg.abcDigests.entries()) {
      const item = attachManagedLocalGguf(projected, {
        digest, displayName: 'SYNTHETIC ' + (index ? 'C' : 'B') + ' NO MODEL',
        material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
      });
      abcAttachments.push(item);
      projected = item.state;
    }
  }
  const attached = initial;
  const persisted = await updateSelfHostedProfiles(() => projected);
  usePreferencesStore.setState({
    selfHostedInference: persisted, hydrated: true,
    agentPermissionProfiles: {
      ...usePreferencesStore.getState().agentPermissionProfiles,
      'builtin:coder': { mode: 'chat-only', categories: {} },
    },
  });
  const selection = resolveManagedLocalSelection(persisted, attached.selectionId);
  if (selection.status === 'missing' || selection.status === 'not-managed')
    throw new Error('Canonical persisted managed selection unavailable');
  const abcSelections = abcAttachments.map(item => ({
    ...resolveManagedLocalSelection(persisted, item.selectionId),
    selectionId: item.selectionId,
  }));
  if (abc && (abcSelections.some(item =>
      item.status === 'missing' || item.status === 'not-managed') ||
    new Set([selection.deployment.id,...abcSelections.map(item => item.deployment.id)]).size !== 3 ||
    persisted.fabric?.deployments?.length !== 3))
    throw Error('ABC deployments were not genuinely registered in canonical Compute Fabric');
  step('synthetic service bind with production native identity checks');
  state.native.bind = await invoke('lm11_acceptance_bind', {
    deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
  });
  const witness = await invoke('managed_local_runtime_status', abc ? {
    deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
  } : {});
  if (witness.state !== 'Ready' || !witness.installed || witness.epoch !== state.native.bind.epoch ||
      witness.processId !== state.native.bind.pid || witness.deploymentId !== selection.deployment.id ||
      witness.modelDigest !== cfg.digest)
    throw new Error('Authenticated native Ready witness does not match the owned deployment');
  const route = await invoke('managed_local_runtime_route', {
    deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
    epoch: witness.epoch,
  });
  if (!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(route.baseUrl) ||
      !/^[0-9a-f]{64}$/.test(route.apiKey) || route.epoch !== witness.epoch ||
      route.processId !== witness.processId || !/^clack-[0-9a-f]{16}$/.test(route.modelAlias))
    throw new Error('Production native authenticated route did not validate');
  // Never include the runtime secret in any report, error or console output.
  state.native.routeAuthenticated = true;
  await mustReject('wrong-deployment', () => invoke('managed_local_runtime_route', {
    deploymentId: selection.deployment.id, deploymentIdentity: 'stale-or-forged', epoch: witness.epoch,
  }));
  await mustReject('wrong-epoch', () => invoke('managed_local_runtime_route', {
    deploymentId: selection.deployment.id, deploymentIdentity: selection.identity, epoch: '0'.repeat(64),
  }));
  step('real renderer IPC negative cancellation');
  await openCancel();
  if (cfg.scenario === 'post-terminal-channel-callback' ||
      cfg.scenario === 'post-cancel-channel-callback') {
    const cancelling = cfg.scenario === 'post-cancel-channel-callback';
    const requestId = await invoke('ai_http_open');
    if (await invoke('lm11_acceptance_arm_late_channel', { requestId }) !== true)
      throw new Error('Native post-terminal Channel fault did not arm for exact request');
    const observed = [];
    let cancelAck = null;
    const channel = new Channel();
    channel.onmessage = event => {
      if (event.requestId !== requestId) throw new Error('Late Channel callback had another native owner');
      observed.push({
        kind: event.kind, phase: event.phase, at: performance.now(),
        text: event.kind === 'chunk' ?
          new TextDecoder().decode(Uint8Array.from(event.bytes)).slice(0, 128) : null,
      });
      if (cancelling && !cancelAck && event.kind === 'chunk') {
        cancelAck = invoke('ai_http_cancel', {
          requestId, cancellationOrigin: 'parent-signal',
        });
      }
    };
    await invoke('ai_http_stream', {
      requestId, url: route.baseUrl + '/chat/completions', method: 'POST',
      headers: { authorization: 'Bearer ' + route.apiKey, 'content-type': 'application/json' },
      body: [...new TextEncoder().encode(requestBody(route.modelAlias))],
      allowPrivateNetwork: true, timeoutPolicy: 'self-hosted', admission,
      requirePreflight: false, onEvent: channel,
    });
    if (cancelling) {
      if (!cancelAck) throw new Error('No real native chunk arrived to trigger cancellation');
      await cancelAck;
    }
    // The actual renderer-native stream IPC and (when applicable) its
    // cancellation ACK have now completed. Late events must arrive strictly
    // AFTER this renderer-side terminal boundary, not while invoke is pending.
    const rendererTerminalAt = performance.now();
    const until = rendererTerminalAt + 3000;
    while (observed.filter(ev => ev.kind === 'settled').length < 2 && performance.now() < until)
      await sleep(20);
    const terminal = observed.findIndex(ev => ev.kind === 'settled');
    const lateChunk = observed.findIndex((ev,i) => i > terminal && ev.kind === 'chunk' &&
      ev.text === 'LM11-POST-TERMINAL-NATIVE-CHANNEL-ONLY-NO-MODEL');
    const duplicate = observed.findIndex((ev,i) => i > lateChunk && ev.kind === 'settled');
    const phase = cancelling ? 'cancelled' : 'completed';
    if (terminal < 0 || lateChunk <= terminal || duplicate <= lateChunk ||
        observed[terminal].phase !== phase || observed[duplicate].phase !== phase ||
        observed[lateChunk].at <= observed[terminal].at ||
        observed[duplicate].at < observed[lateChunk].at ||
        observed[lateChunk].at <= rendererTerminalAt ||
        observed[duplicate].at <= rendererTerminalAt)
      throw new Error('Actual registered renderer Channel did not receive original terminal then injected late events');
    const before = await invoke('self_hosted_profiles_snapshot');
    const fabric = before.find(([key]) => key === 'selfHostedInference')?.[1]?.fabric;
    if ((fabric?.qualificationReceipts ?? []).length)
      throw new Error('Post-terminal native callback incorrectly promoted a qualification receipt');
    state.native.lateChannel = {
      requestId, originalNativeTerminal: phase,
      nativeChannelOriginalSettledFirst: true,
      testInjectedLateChunkDelivered: true,
      testInjectedLateTerminalDelivered: true,
      testInjectedNotExternalSseParser: true,
      actualRendererNativeOperationTerminatedBeforeLateCallbacks: true,
      nativeRequestIdIsExact: true, noQualificationPromotion: true,
      eventCount: observed.length, originalSettledAt: Math.round(observed[terminal].at),
      rendererTerminalAt: Math.round(rendererTerminalAt),
      injectedChunkAt: Math.round(observed[lateChunk].at),
      injectedTerminalAt: Math.round(observed[duplicate].at),
    };
    state.outcome = cancelling ? 'post-cancel-real-channel-observed' :
      'post-terminal-real-channel-observed';
    return;
  }
  if (cfg.scenario === 'original-late-cancel-ack') {
    await originalLateNativeCancelAck(attached);
    return;
  }
  if (cfg.scenario === 'original-duplicate-terminal') {
    await originalDuplicateNativeTerminal(attached);
    return;
  }
  if (cfg.scenario === 'original-postdeadline-provider-events') {
    await originalPostDeadlineProviderEvents(attached);
    return;
  }
  if (cfg.scenario === 'original-abc-native-isolation') {
    await originalAbcNativeIsolation(attached,route);
    return;
  }
  if (cfg.scenario === 'original-managed-abc-deployments') {
    await originalManagedAbcDeployments(attached,selection,abcSelections,route,cfg);
    return;
  }
  if (cfg.scenario === 'original-native-quiescence-failure') {
    await originalNativeQuiescenceFailure(attached);
    return;
  }
  if (cfg.deadlineStage) {
    if (await invoke('lm11_acceptance_arm_deadline_stage') !== cfg.deadlineStage)
      throw new Error('Original runner aggregate-deadline fault did not arm exact native boundary');
    const start = performance.now();
    let originalRejection = null;
    try {
      // This is the unchanged production entry point: it constructs its own
      // real 120000ms QualificationOperationDeadline. Never shorten its timer.
      await runManagedChatQualification(attached.selectionId);
    } catch (error) { originalRejection = error; }
    const elapsedMs = performance.now() - start;
    if (!originalRejection || elapsedMs < 119_000 || elapsedMs > 175_000)
      throw new Error('Production LM2F did not reject within the real 120s aggregate wall budget');
    const failurePhase = String(originalRejection?.message ?? '');
    const failureCause = String(originalRejection?.cause ?? '');
    if (failurePhase !== 'Bounded qualification unverified at ' + cfg.deadlineStage ||
        !/deadline|qualification operation cancelled/i.test(failureCause))
      throw new Error('Original qualification did not reject at intended native deadline boundary: ' +
        cfg.deadlineStage + '/' + failurePhase + '/' + failureCause);
    // Observe after delayed native IPC returns. A timed-out JS Promise is not
    // proof it cancelled the native effect; check actual native dispatch/CAS.
    await sleep(400);
    const counts = await invoke('lm11_acceptance_counts');
    const stored = (await invoke('self_hosted_profiles_snapshot'))
      .find(([key]) => key === 'selfHostedInference')?.[1];
    if ((stored?.fabric?.qualificationReceipts ?? []).length ||
        (counts.self_hosted_profiles_qualification_acknowledge ?? 0) > 0)
      throw new Error('An actual native qualification receipt was acknowledged after aggregate deadline');
    state.native.deadline = {
      selectedStage: cfg.deadlineStage, originalFailurePhase: failurePhase,
      originalFailureCause: failureCause.slice(0, 120),
      realElapsedMs: Math.round(elapsedMs),
      nativeDispatchCount: counts.ai_http_stream ?? 0,
      nativeCasAcknowledgeCount: counts.self_hosted_profiles_qualification_acknowledge ?? 0,
      zeroDurableQualificationReceipts: true,
      originalProductionRunner: true, originalAggregateBudgetMs: 120_000,
    };
    state.outcome = 'real-aggregate-deadline-rejected';
    return;
  }
  if (cfg.barrierStage) {
    step('original production LM2F feature-only ' + cfg.barrierMode + ' at ' + cfg.barrierStage);
    if (cfg.scenario === 'stage-close') {
      await originalManagedQualificationRendererClosure(attached,witness,cfg);
      return;
    }
    await originalManagedQualificationStageBarrier(attached, witness, cfg);
    return;
  }
  if (cfg.scenario === 'stale-original-qualification-child-restart') {
    step('T10 original production qualification A across an authenticated child restart');
    await originalQualificationAcrossRealChildRestart(attached, selection, witness, route);
    return;
  }
  if (cfg.scenario === 'genuine-child-restart' || cfg.scenario === 'stale-cross-child-restart') {
    const cross = cfg.scenario === 'stale-cross-child-restart';
    let oldId = null;
    let oldTicket = null;
    let oldStream;
    const oldCallbacks = [];
    if (cross) {
      oldTicket = await invoke('self_hosted_profiles_qualification_begin', {
        kind: 'lm2f', deploymentId: selection.deployment.id,
        runtimeEpoch: witness.epoch, processId: witness.processId,
        remainingMs: 10_000, deadlineUnixMs: Date.now() + 10_000,
      });
      oldId = await invoke('ai_http_open');
      let receivedFirstFrame;
      const firstFrame = new Promise(resolve => { receivedFirstFrame = resolve; });
      const channelA = new Channel();
      channelA.onmessage = ev => {
        if (ev.requestId !== oldId) throw new Error('Old native callback crossed exact request ID');
        oldCallbacks.push({ kind: ev.kind, phase: ev.phase, at: performance.now() });
        if (ev.kind === 'chunk') receivedFirstFrame();
      };
      oldStream = invoke('ai_http_stream', {
        requestId: oldId, url: route.baseUrl + '/chat/completions', method: 'POST',
        headers: { authorization: 'Bearer ' + route.apiKey, 'content-type': 'application/json' },
        body: [...new TextEncoder().encode(requestBody(route.modelAlias))],
        allowPrivateNetwork: true, timeoutPolicy: 'self-hosted', admission,
        requirePreflight: false, onEvent: channelA,
      }).then(() => 'resolved', () => 'rejected');
      if (await Promise.race([firstFrame.then(() => 'real-frame'), sleep(3000).then(() => 'timeout')]) !== 'real-frame')
        throw new Error('Original child A never delivered its actual first SSE callback');
    }
    step('actually stop and reap owned synthetic OS child A');
    await invoke('lm11_acceptance_stop_service');
    const dead = await invoke('managed_local_runtime_status');
    if (dead.state === 'Ready') throw new Error('Child A death retained authenticated Ready witness');
    await mustReject('old-route-after-os-child-death', () =>
      invoke('managed_local_runtime_route', {
        deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
        epoch: witness.epoch,
      }));
    step('native secret rotation and actual owned synthetic OS child B');
    const restart = await invoke('lm11_acceptance_restart_child', {
      deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
    });
    if (restart.oldPid !== witness.processId || restart.oldEpoch !== witness.epoch ||
        restart.newPid === restart.oldPid || restart.newEpoch === restart.oldEpoch ||
        !restart.freshNativeSecret || !restart.oldBearerRejected)
      throw new Error('Native did not prove new child PID, runtime epoch and bearer secret');
    const b = await invoke('managed_local_runtime_status');
    if (b.state !== 'Ready' || !b.installed || b.processId !== restart.newPid ||
        b.epoch !== restart.newEpoch || b.deploymentId !== selection.deployment.id)
      throw new Error('B did not authenticate as Ready through production status');
    const routeB = await invoke('managed_local_runtime_route', {
      deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
      epoch: b.epoch,
    });
    if (routeB.epoch !== restart.newEpoch || routeB.processId !== restart.newPid ||
        routeB.apiKey === route.apiKey || routeB.modelAlias !== route.modelAlias ||
        routeB.baseUrl === route.baseUrl)
      throw new Error('Child B authenticated route reused original transport identity');
    await mustReject('stale-A-epoch-after-B-auth', () =>
      invoke('managed_local_runtime_route', {
        deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
        epoch: witness.epoch,
      }));
    state.negative.push({ name: 'old-native-route-fenced-across-new-process', rejected: true,
      oldEpoch: witness.epoch, newEpoch: b.epoch });
    const proof = {
      oldPid: witness.processId, oldEpoch: witness.epoch,
      newPid: b.processId, newEpoch: b.epoch,
      oldBearerRejected: true, oldRouteRejected: true,
      newReadyAuthenticated: true, realOldCallbackCount: oldCallbacks.length,
    };
    if (cross) {
      const restartMoment = performance.now();
      const oldResult = await Promise.race([oldStream, sleep(2000).then(() => 'still-pending')]);
      const lateCallbacks = oldCallbacks.filter(ev => ev.at >= restartMoment);
      proof.oldNativeStreamOutcome = oldResult;
      proof.realOldCallbackKinds = oldCallbacks.map(event => event.kind);
      proof.realLateCallbackKinds = lateCallbacks.map(event => event.kind);
      proof.realLateCallbackObserved = lateCallbacks.length > 0;
      const authority = (await invoke('self_hosted_profiles_snapshot'))
        .find(([key]) => key === 'selfHostedInference')?.[1];
      let stalePrepare = 'unverified';
      try {
        stalePrepare = await invoke('self_hosted_profiles_qualification_prepare', {
          ticket: oldTicket, expected: authority, value: authority,
        });
      } catch { stalePrepare = 'rejected'; }
      if (stalePrepare !== 'rejected') throw new Error('Old A CAS ticket admitted on child B epoch');
      let staleAck = 'unverified';
      try {
        staleAck = await invoke('self_hosted_profiles_qualification_acknowledge', {
          ticket: oldTicket,
        });
      } catch { staleAck = 'rejected'; }
      if (staleAck === 'acknowledged' || staleAck === 'unverified')
        throw new Error('Stale A qualification ACK was accepted under fresh native B epoch');
      proof.oldCasTicketRejected = true;
      proof.oldCasAckRejected = true;
      state.negative.push({ name: 'stale-A-native-CAS-ticket-rejected', rejected: true });
      const bRequest = await invoke('ai_http_open');
      if (bRequest === oldId) throw new Error('Native inference request identity reused after restart');
      await invoke('ai_http_cancel', { requestId: oldId, cancellationOrigin: 'parent-signal' });
      await mustReject('old-A-stream-id-after-B-rebind', () => invoke('ai_http_stream', {
        requestId: oldId, url: routeB.baseUrl + '/chat/completions', method: 'POST',
        headers: { authorization: 'Bearer ' + routeB.apiKey, 'content-type': 'application/json' },
        body: [...new TextEncoder().encode(requestBody(routeB.modelAlias))],
        allowPrivateNetwork: true, timeoutPolicy: 'self-hosted', admission,
        requirePreflight: false, onEvent: new Channel(),
      }));
      proof.oldStreamIdRejectedAfterRestart = true;
      const bEvents = [];
      const channelB = new Channel();
      channelB.onmessage = ev => {
        if (ev.requestId !== bRequest) throw new Error('Child B callback crossed exact native request ID');
        bEvents.push({ kind: ev.kind, phase: ev.phase,
          text: ev.kind === 'chunk' ? new TextDecoder().decode(Uint8Array.from(ev.bytes)).slice(0,256) : null });
      };
      await invoke('ai_http_stream', {
        requestId: bRequest, url: routeB.baseUrl + '/chat/completions', method: 'POST',
        headers: { authorization: 'Bearer ' + routeB.apiKey, 'content-type': 'application/json' },
        body: [...new TextEncoder().encode(requestBody(routeB.modelAlias))],
        allowPrivateNetwork: true, timeoutPolicy: 'self-hosted', admission,
        requirePreflight: false, onEvent: channelB,
      });
      const settledB = bEvents.filter(ev => ev.kind === 'settled');
      if (settledB.length !== 1 || settledB[0].phase !== 'completed' ||
          !bEvents.some(ev => ev.kind === 'chunk' && ev.text?.includes('LM2F-CHAT-QUALIFIED')))
        throw new Error('Stale native A cancellation disrupted newly owned B request');
      proof.staleCancelIsolated = true;
      proof.newStreamCompleted = true;
      proof.oldRequestId = oldId;
      proof.newRequestId = bRequest;
      proof.realOldCallbackCount = oldCallbacks.length;
      proof.realOldLateCallbackCount = lateCallbacks.length;
      const snapshot = (await invoke('self_hosted_profiles_snapshot'))
        .find(([key]) => key === 'selfHostedInference')?.[1];
      if ((snapshot?.fabric?.qualificationReceipts ?? []).length !== 0)
        throw new Error('Stale pre-restart request promoted a synthetic qualification receipt');
    }
    state.native.restart = proof;
    state.outcome = cross ? 'stale-cross-restart-fenced' : 'owned-pid-epoch-restarted';
    return;
  }
  if (cfg.scenario === 'window-close-preflight' || cfg.scenario === 'window-close-stream') {
    const requestId = await invoke('ai_http_open');
    const closeOn = cfg.scenario === 'window-close-preflight' ? 'preflight' : 'chunk';
    const channel = new Channel();
    let initiated = false;
    channel.onmessage = (event) => {
      if (event.requestId !== requestId || initiated || event.kind !== closeOn) return;
      initiated = true;
      // This is an actual native Tauri/Wry window destruction while the
      // ORIGINAL native stream owns its lease. The renderer cannot claim a
      // terminal/receipt once it has been destroyed; a host-side watcher
      // records only physical window destruction and registry drain.
      void invoke('lm11_acceptance_close_window', { requestId });
    };
    step('native window destroyed during ' + closeOn);
    try {
      // Keep the actual Channel and the native command's Promise alive until
      // the real Wry window is destroyed. Dropping the JS Promise can let the
      // event transport be collected before its HTTP stream is dispatched.
      await invoke('ai_http_stream', {
        requestId, url: route.baseUrl + '/chat/completions', method: 'POST',
        headers: { authorization: 'Bearer ' + route.apiKey, 'content-type': 'application/json' },
        body: [...new TextEncoder().encode(requestBody(route.modelAlias))],
        allowPrivateNetwork: true, timeoutPolicy: 'self-hosted', admission,
        requirePreflight: closeOn === 'preflight', onEvent: channel,
      });
      throw new Error('Native stream settled before physical renderer window destruction');
    } catch (error) {
      // A renderer still alive means the close trigger did not actually
      // complete; write an explicit failed boundary, never a window PASS.
      await invoke('lm11_acceptance_report', { report: {
        scenario: cfg.scenario, syntheticOnly: true, outcome: 'blocked',
        negative: [], error: String(error).slice(0, 512),
      }}).catch(() => undefined);
      return;
    }
  }
  if (cfg.scenario === 'original-runtime-fault') {
    await originalQualificationRuntimeFault(attached, cfg);
    return;
  }
  if (cfg.runtimeScenario) {
    await exerciseRuntimeScenario(cfg.runtimeScenario, selection, witness, route);
    return;
  }
  if (cfg.scenario === 'cancel-exact-id' || cfg.scenario === 'stop-after-open') {
    state.outcome = 'ipc-cancel-verified'; return;
  }
  if (cfg.scenario === 'wrong-deployment' || cfg.scenario === 'wrong-epoch') {
    state.outcome = 'native-route-rejected'; return;
  }
  if (cfg.scenario === 'wrong-secret') {
    // Host-owned raw TCP probes separately verify 401 and no proxy fallback.
    state.outcome = 'authenticated-negative-verified'; return;
  }
  if (cfg.scenario === 'wrong-pid') {
    await wrongPid(selection.deployment.id, witness);
    state.outcome = 'native-route-rejected'; return;
  }
  if (cfg.scenario === 'timeout-before-admission') {
    await nativeDeadline(selection.deployment.id, witness, false);
    state.outcome = 'deadline-admission-rejected'; return;
  }
  if (cfg.scenario === 'timeout-during-preparation') {
    await nativeDeadline(selection.deployment.id, witness, true);
    state.outcome = 'deadline-prepare-rejected'; return;
  }
  if (cfg.scenario === 'stop-before-open') {
    const before = await invoke('lm11_acceptance_counts');
    const aborted = new AbortController();
    aborted.abort();
    await mustReject('pre-aborted-fetch', () => createProxyFetch({ selfHosted: true, allowPrivateNetwork: true })
      (route.baseUrl + '/chat/completions', { method: 'POST', signal: aborted.signal }));
    const after = await invoke('lm11_acceptance_counts');
    if (before.ai_http_open !== after.ai_http_open || before.ai_http_stream !== after.ai_http_stream)
      throw new Error('Pre-aborted fetch dispatched forbidden new native request');
    state.outcome = 'pre-registration-stop-denied'; return;
  }
  if (cfg.scenario === 'service-death') {
    await invoke('lm11_acceptance_stop_service');
    await mustReject('route-after-service-death', () => invoke('managed_local_runtime_route', {
      deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
    }));
    const stopped = await invoke('managed_local_runtime_status');
    if (stopped.state === 'Ready') throw new Error('Dead child retains native Ready');
    state.outcome = 'owned-service-stopped'; return;
  }
  if (cfg.scenario === 'stale-runtime-epoch') {
    const nextEpoch = await invoke('lm11_acceptance_rotate_epoch');
    if (nextEpoch === witness.epoch) throw new Error('Synthetic epoch rotation was ineffective');
    await mustReject('stale-epoch-route', () => invoke('managed_local_runtime_route', {
      deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
      epoch: witness.epoch,
    }));
    const current = await invoke('managed_local_runtime_route', {
      deploymentId: selection.deployment.id, deploymentIdentity: selection.identity,
      epoch: nextEpoch,
    });
    if (current.epoch !== nextEpoch) throw new Error('Rotated authenticated route unavailable');
    state.outcome = 'stale-epoch-rejected'; return;
  }
  if (cfg.scenario === 'wrong-model-alias' || cfg.scenario === 'wrong-provider-auth') {
    const observed = await nativeHttp(route,
      cfg.scenario === 'wrong-model-alias' ? { model: 'clack-badbadbadbadbadb' } :
        { token: '0'.repeat(64) });
    const expectedStatus = cfg.scenario === 'wrong-model-alias' ? 422 : 401;
    if (observed.events.find(event => event.kind === 'headers')?.status !== expectedStatus)
      throw new Error('Unauthorized/mismatched synthetic request did not receive required refusal');
    state.negative.push({ name: cfg.scenario, denied: expectedStatus, requestId: observed.requestId });
    state.outcome = cfg.scenario === 'wrong-model-alias' ? 'synthetic-model-denied' : 'synthetic-auth-denied';
    return;
  }
  if (cfg.scenario === 'stop-during-stream') {
    const result = await nativeHttp(route, { cancelAt: 'chunk' });
    if (result.terminal.phase !== 'cancelled' || !result.events.some(event => event.kind === 'chunk'))
      throw new Error('Native HTTP response failed to cancel during a delivered frame');
    state.negative.push({ name: 'stop-during-stream', requestId: result.requestId,
      cancelled: true, source: 'parent-signal' });
    state.outcome = 'active-native-cancelled'; return;
  }
  if (cfg.scenario === 'concurrent-owner-cancel') {
    const a = await invoke('ai_http_open');
    const b = await invoke('ai_http_open');
    if (a === b) throw new Error('Concurrent native reservations share an ID');
    await invoke('ai_http_cancel', { requestId: a, cancellationOrigin: 'parent-signal' });
    state.negative.push({ name: 'concurrent-first-owner-cancelled', requestId: a });
    // Reuse the second reservation for a preflight-denied native transport,
    // proving the first owner cancel did not revoke its sibling's channel.
    await preflightDenied(b);
    state.outcome = 'independent-native-owners'; return;
  }
  await preflightDenied();
  if (cfg.scenario === 'preflight-deny') { state.outcome = 'preflight-denied'; return; }
  if (cfg.scenario === 'post-cancel-original-lm2f-channel') {
    step('T13 unchanged production LM2F Chat: real SSE cancellation and post-rejection Channel fault');
    await originalLm2fCancelledLateChannel(attached);
    return;
  }
  step('production bounded Chat qualification (synthetic model text only)');
  const result = await runManagedChatQualification(attached.selectionId);
  if (result.chat !== 'verified' || result.streaming !== 'verified' ||
      result.terminalCompletion !== 'verified' || result.instructionAdherence !== 'verified')
    throw new Error('Production bounded Chat evaluation did not verify its synthetic response');
  state.native.requestId = result.requestId;
  state.native.sessionId = result.sessionId;
  state.native.receiptCount = result.receiptCount;
  if (cfg.scenario === 'duplicate-ticket') {
    const current = (await invoke('self_hosted_profiles_snapshot'))
      .find(([key]) => key === 'selfHostedInference')?.[1];
    const marker = current?.fabric?.qualificationReceipts?.[0]?.qualificationCas;
    if (marker?.phase !== 'acknowledged' || !marker.operationId || !marker.nativeEpoch)
      throw new Error('No real acknowledged native receipt to check duplicate replay');
    const ticket = { operationId: marker.operationId, nativeEpoch: marker.nativeEpoch };
    await mustReject('duplicate-native-ticket', () => invoke('self_hosted_profiles_qualification_acknowledge', { ticket }));
    const reconciled = await invoke('self_hosted_profiles_qualification_reconcile', { ticket });
    if (reconciled !== 'committed') throw new Error('Persisted native receipt replay did not reconcile committed');
  }
  if (cfg.scenario === 'stop-after-terminal') {
    const counts = await invoke('lm11_acceptance_counts');
    const lastNativeId = 'inference-' + counts.ai_http_open;
    await invoke('ai_http_cancel', { requestId: lastNativeId, cancellationOrigin: 'settled-cleanup' });
    state.negative.push({ name: 'stop-after-terminal', requestId: lastNativeId,
      sentOnlyAfterRealNativeQuiescence: true });
  }
  state.outcome = 'synthetic-chat-transport-only';
}
try { await main(); }
catch (error) {
  state.outcome = 'blocked';
  state.error = String(error instanceof Error ? error.message : error).slice(0, 512);
  if (error instanceof Error && error.cause)
    state.errorCause = String(error.cause).slice(0, 512);
} finally {
  step('native report and bounded exit');
  await invoke('lm11_acceptance_report', { report: state }).catch(err => {
    document.getElementById('phase').textContent = 'report unavailable: ' + String(err).slice(0,120);
  });
}
`;

// Check every existing ancestor before creating anything. Recursive mkdir and
// a post-hoc check on `cases` can follow a junction outside the approved root.
const physicalProject = await fs.realpath(project);
const expectedTarget = path.join(physicalProject, 'src-tauri', 'target');
if (await fs.realpath(expectedTarget) !== expectedTarget)
  throw new Error('ABORT: Cargo target is redirected through a reparse point');
async function ownedDirectory(dir) {
  const metadata = await fs.lstat(dir).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!metadata) await fs.mkdir(dir, { recursive: false });
  else if (metadata.isSymbolicLink() || !metadata.isDirectory())
    throw new Error('ABORT: acceptance owner is a symlink, junction or non-directory');
  if (await fs.realpath(dir) !== dir)
    throw new Error('ABORT: acceptance owner redirected through a junction/reparse point');
}
await ownedDirectory(path.join(expectedTarget, 'lm11-b01-b03-authenticated-webview-20261119'));
await ownedDirectory(path.join(expectedTarget, 'lm11-b01-b03-authenticated-webview-20261119', 'cases'));
const expectedCases = path.join(expectedTarget, 'lm11-b01-b03-authenticated-webview-20261119', 'cases');
const caseDir = path.join(expectedCases, id);
await fs.mkdir(caseDir, { recursive: false });
if (path.dirname(await fs.realpath(caseDir)) !== expectedCases ||
    (await fs.lstat(caseDir)).isSymbolicLink())
  throw new Error('ABORT: newly created case escaped its canonical owner');
const metadata = {
  caseId: id, scenario, syntheticOnly: true, modelsLaunched: 0,
  runtimeScenario, deadlineStage,
  barrierStage, barrierMode: barrierStage ? scenario.slice(6) : null,
  abnormalCorruptExit,terminalWinsRace,staleIdCancel,
  inferenceEvaluated: false, providerNetwork: false, digest,
  fixedOwner: expectedCases, createdAt: new Date().toISOString(),
};
await fs.writeFile(path.join(caseDir, 'run-metadata.json'), JSON.stringify(metadata, null, 2));

if (indexOnly) {
  const acceptedCaseFiles = [
    'run-metadata.json', 'acceptance-invariants.json', 'acceptance-restart-invariants.json',
    'renderer-report.json', 'native-window-close-report.json',
    'native-restart-report.json', 'native-qualification-ticket.json',
    'service-ready.json', 'service-ready-b.json',
    'cancel-ack-fault.json', 'deadline-stage-armed.json',
    'deadline-stage-hit.json', 'post-terminal-channel-fault.json',
    'post-terminal-channel-send.json',
    'post-cancel-lm2f-release.json',
    'service-events.jsonl', 'native-host.stderr.log', 'native-host.stdout.log',
    'native-restart.stderr.log', 'native-restart.stdout.log',
    'data/terax-settings.json',
  ];
  const caseList = [];
  for (const entry of (await fs.readdir(expectedCases, { withFileTypes: true }))
    .filter(entry => entry.name.startsWith('wry-')).sort((a,b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error(`Refusing redirected evidence case: ${entry.name}`);
    const dir = path.join(expectedCases, entry.name);
    if (await fs.realpath(dir) !== dir) throw new Error(`Evidence case escaped owner: ${entry.name}`);
    const artifacts = [];
    for (const relative of acceptedCaseFiles) {
      const filename = path.join(dir, ...relative.split('/'));
      const metadata = await fs.lstat(filename).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!metadata) continue;
      if (!metadata.isFile() || metadata.isSymbolicLink() || await fs.realpath(filename) !== filename)
        throw new Error(`Refusing redirected evidence file: ${entry.name}/${relative}`);
      const bytes = await fs.readFile(filename);
      artifacts.push({ file: relative, size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const getJson = async relative => fs.readFile(path.join(dir,relative),'utf8')
      .then(JSON.parse, error => { if (error.code === 'ENOENT') return null; throw error; });
    const provenance = await getJson('run-metadata.json');
    const invariants = await getJson('acceptance-invariants.json');
    const restart = await getJson('acceptance-restart-invariants.json');
    if (!provenance?.scenario || provenance.caseId !== entry.name) continue;
    const requiresRestart = ['restart-acknowledged','corrupt-settings','read-only-settings'].includes(provenance.scenario);
    const passed = invariants?.allPassed === true &&
      (!requiresRestart || restart?.accepted === true);
    caseList.push({ id: entry.name,
      group: provenance.deadlineStage ? 'deadline' : provenance.runtimeScenario ? 'runtime' : 'smoke',
      key: provenance.deadlineStage ?? provenance.runtimeScenario ?? provenance.scenario, passed,
      createdAt: provenance.createdAt, artifacts,
      incident: passed ? null : 'retained-unverified-or-failed-attempt',
      syntheticOnly: true, modelQualification: false });
  }
  const latest = new Map();
  for (const item of caseList) latest.set(`${item.group}:${item.key}`, item);
  const collect = (group, keys) => keys.map(key => {
    const item = latest.get(`${group}:${key}`);
    return { name:key, available:!!item, latestCase:item?.id ?? null, passed:item?.passed ?? false };
  });
  const runtimeCoverage = collect('runtime', runtimeScenarios);
  const smokeCoverage = collect('smoke', scenarios);
  const deadlineCoverage = qualificationDeadlineStages.map(stage => ({
    ...collect('deadline',[stage])[0],
    independentlyInjectable: injectableDeadlineStages.has(stage),
    originalProductionBudgetMs: 120_000,
    noFakeBudget: true,
  }));
  const deadlinePass = name => deadlineCoverage.find(item => item.name === name)?.passed === true;
  const canonicalAggregateBoundaries = [
    { ordinal:1, boundary:'readiness', source:['native-status'], status:deadlinePass('native-status')?'real-120000ms-original-runner-observed':'unverified', limitation:null },
    { ordinal:2, boundary:'preparation', source:['session-writes','session-prepare'], status:
      deadlinePass('session-writes') || deadlinePass('session-prepare')?'source-phase-observed':'selectable-not-verified',
      limitation:'Async session writes/preparation can overlap capture; no independent terminal proof without a stage-specific native trace' },
    { ordinal:3, boundary:'pre-dispatch-admission', source:['native-admission'], status:
      deadlinePass('native-admission')?'real-120000ms-original-runner-observed':'unverified', limitation:null },
    { ordinal:4, boundary:'native-request-registration', source:['bounded-request'], status:
      deadlinePass('bounded-request')?'real-120000ms-original-runner-observed':'unverified', limitation:null },
    { ordinal:5, boundary:'first-provider-output', source:['delayed-first-stream-event'], status:
      collect('runtime',['delayed-first-stream-event'])[0]?.passed?'partial-short-synthetic-fault':'unverified',
      limitation:'Observed 360ms real provider-to-native delayed first SSE; not a separate immutable 120000ms qualification-operation timeout' },
    { ordinal:6, boundary:'native-stream-terminal', source:['delayed-terminal-event'], status:
      collect('runtime',['delayed-terminal-event'])[0]?.passed?'partial-short-synthetic-fault':'unverified',
      limitation:'Observed 370ms real SSE terminal delay and native terminal; not a separate 120000ms original Chat qualification deadline' },
    { ordinal:7, boundary:'native-quiescence', source:['native-quiescence'], status:'blocked-uninjectable',
      limitation:'Quiescence grace is an in-process JS observation and cannot be independently native IPC-stalled without modifying the unchanged production flight runner' },
    { ordinal:8, boundary:'evidence-evaluation', source:['receipt-scoring'], status:'blocked-uninjectable',
      limitation:'Deterministic evidence scoring is in-process JS; no independent test-only native IPC barrier exists' },
    { ordinal:9, boundary:'B03-native-prepare', source:['cas-commit'], status:
      deadlinePass('cas-commit')?'partial-B03-begin-observed':'unverified',
      limitation:'Native BEGIN IPC exceeded real 120000ms aggregate; the later native PREPARE replace syscall was not independently stalled' },
    { ordinal:10, boundary:'B03-native-ack-and-readback', source:['restart-acknowledged','lost-native-ack'], status:
      collect('smoke',['restart-acknowledged'])[0]?.passed &&
      collect('smoke',['lost-native-ack'])[0]?.passed?'partial-independent-restart-B03':'unverified',
      limitation:'Genuine production B03 native ACK/reconcile completed across app restart, but aggregate 120000ms deadline at activation/readback was not separately injected' },
  ];
  const modeCase = (kind, name) => {
    const item = latest.get(`${kind}:${name}`);
    const flag = kind === 'runtime' ? 'runtime-scenario' : kind === 'deadline' ?
      'deadline-stage' : 'scenario';
    return { kind, name, caseId:item?.id ?? null, pass:item?.passed ?? false,
      command:`node scripts/lm11-authenticated-webview-acceptance.mjs --no-build --${flag} ${name}` };
  };
  const selfTestDefinitions = [
    ['T01','Synthetic absent from production selection', [['smoke','normal'],['smoke','restart-acknowledged']]],
    ['T02','Credentials acceptance scoped', [['runtime','authenticated-readiness-success'],['smoke','normal']]],
    ['T03','Wrong credential denied', [['smoke','wrong-secret'],['smoke','wrong-provider-auth']]],
    ['T04','Wrong deployment denied', [['smoke','wrong-deployment']]],
    ['T05','Wrong epoch denied', [['smoke','wrong-epoch'],['smoke','stale-runtime-epoch']]],
    ['T06','Wrong PID denied', [['smoke','wrong-pid']]],
    ['T07','Unavailable is not Ready', [['runtime','authenticated-health-failure'],['smoke','service-death']]],
    ['T08','Process death invalidates route', [['smoke','service-death'],['runtime','runtime-process-exits-mid-request']]],
    ['T09','Restart generates NEW native/runtime epoch', [['smoke','genuine-child-restart']]],
    ['T10','Stale request cannot use newer epoch', [['smoke','stale-cross-child-restart']]],
    ['T11','Exact native IDs observable', [['smoke','normal'],['smoke','cancel-exact-id']]],
    ['T12','Exact-ID cancel', [['smoke','cancel-exact-id'],['runtime','cancel-during-streaming']]],
    ['T13','Late callbacks OBSERVABLE', [['smoke','post-cancel-original-lm2f-channel'],['smoke','post-cancel-channel-callback'],['smoke','post-terminal-channel-callback'],['runtime','late-stream-event-after-cancellation']]],
    ['T14','Canonical AppData containment', [['smoke','normal'],['smoke','corrupt-settings']]],
    ['T15','No production AppData/settings/registrations touched', [['smoke','normal'],['smoke','restart-pending'],['smoke','read-only-settings']]],
  ];
  const selfTests = selfTestDefinitions.map(([id, objective, sources]) => {
    const evidence = sources.map(([kind,name]) => modeCase(kind,name));
    const allExecuted = evidence.every(item => item.pass);
    const limitations = {
      T01:'The synthetic attachment and selection were created only in this isolated feature-gated test host. No independent normal-production model selector enumeration was executed.',
      T13:'Native post-terminal fault is injected only after original LM2F Chat rejection and original native Cancelled; a delegated renderer Channel callback (including proxyFetch noop replacement) or actual observed earlier Channel unregister must identify the boundary. Test-injected native events bypass the external provider SSE parser; this is not a model-quality or eternal-quiescence proof.',
      T15:'Per-test host asserts exact isolated AppData/Store paths. Independent prime T15 before/after file/registry plus WinCred secret-blob hash comparison is a separate audit; do not assume unchanged hidden secrets from fixture isolation alone.',
    };
    const limited = Object.hasOwn(limitations,id);
    return { id, objective, canonicalRequiredSelfTest:true,
      status:!allExecuted?'unverified':limited?'partial':'executed-and-observed',
      requirementFullyAccepted:allExecuted&&!limited,
      limitation:limitations[id] ?? null, evidence };
  });
  const previous = [];
  for (const entry of (await fs.readdir(expectedCases, { withFileTypes:true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith('index-') && entry.name !== id)) {
    const oldCase = path.join(expectedCases, entry.name);
    if (await fs.realpath(oldCase) !== oldCase) throw new Error('Refusing redirected earlier index');
    const filename = path.join(oldCase, 'authenticated-webview-evidence-index.json');
    const old = await fs.readFile(filename).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (old) previous.push({caseId:entry.name,
      sha256:createHash('sha256').update(old).digest('hex')});
  }
  previous.sort((a,b)=>a.caseId.localeCompare(b.caseId));
  const supersedes = previous.at(-1) ?? null;
  const output = { version:1, generatedAt:new Date().toISOString(),
    fixedCanonicalOwner:expectedCases, syntheticOnly:true, realModelInferenceCount:0,
    canonicalSelfTestNamesReconciled:true, supersedes,
    qualificationLabRunEnabled:false,
    runtimeCoverage, smokeCoverage, deadlineCoverage, canonicalAggregateBoundaries, selfTests,
    acceptedRuntimeCount:runtimeCoverage.filter(item=>item.passed).length,
    acceptedSmokeCount:smokeCoverage.filter(item=>item.passed).length,
    observedTrueDeadlineStageCount: deadlineCoverage.filter(item=>item.passed).length,
    retainedFailureCases:caseList.filter(item=>!item.passed).map(item=>item.id),
    limitations:[
      'All synthetic SSE text is deterministically authored by the test-only TCP service; no model was loaded or evaluated.',
      'Production health GET is public; authenticated identity is independently verified by bearer /v1/models, as existing native production code requires.',
      'Cancellation ACK failure and delay are generated only AFTER the ORIGINAL production ai_http_cancel calls state.cancel_with_origin and drains the exact native request; acceptance-only feature guard applies.',
      'Malformed SSE and late TCP sends establish renderer/native transport observation, not a full production SDK parser or provider-quiescence certificate.',
      'Previous short synthetic 125/185ms runtime faults do not certify LM2F aggregate budgets; only individually observed --deadline-stage cases using unchanged production runManagedChatQualification may support a real 120000ms claim.',
      'native-quiescence and receipt-scoring are not separately injectable from acceptance-only Tauri IPC; these two original production phases are explicitly blocked, not counted as proven.',
      'Native bounded-request registration is fail-closed: a retained real 123500ms original ai_http_open IPC stall reached its marker but the renderer produced NO terminal report; neither aggregate-deadline PASS nor no-late-registration was established. Runner refuses repeat.',
      'B03 native restart reconciles actual existing acknowledged/pending disk bytes; a killed renderer is never retroactively classified PASS.',
      'Genuine child A→B restart uses a different actual owned OS PID, new native runtime epoch and fresh native bearer key; stale A request, cancel and CAS effects are tested against authenticated B.',
      'T13 original LM2F rejection is independently observed after a real authenticated synthetic SSE/native cancellation. Feature-only cloned original Channel sends late events after a one-shot canonical release; the exact observed callback or prior Channel cleanup boundary is reported without attributing any model output.',
      'Fifteen canonical self-tests use user-provided exact names; T01, T13 and T15 retain limitations. No full LM11/LM16 model eligibility, qualification or Lab authorization is inferred.',
    ],
    cases:caseList,
  };
  const file = path.join(caseDir, 'authenticated-webview-evidence-index.json');
  await fs.writeFile(file, JSON.stringify(output,null,2), {flag:'wx'});
  const sha256 = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  console.log(JSON.stringify({indexFile:file, sha256, acceptedRuntimeCount:output.acceptedRuntimeCount,
    acceptedSmokeCount:output.acceptedSmokeCount, selfTests: selfTests.map(t=>({id:t.id,status:t.status})),
    retainedFailureCases:output.retainedFailureCases.length },null,2));
  if (output.acceptedRuntimeCount !== runtimeScenarios.length ||
      output.acceptedSmokeCount !== scenarios.length) process.exitCode = 1;
  process.exit();
}

let vite;
try {
  vite = await createServer({
    root: project,
    // Keep native stage barriers exclusive to one expressly armed stage.
    // The original invalid-admission case instead enables ONLY its private
    // predispatch one-shot test command; the stage barrier is not armed and
    // must remain inert. Neither define exists in ordinary builds.
    define: (barrierStage || scenario === 'original-postdeadline-provider-events') ? {
      'import.meta.env.VITE_CLACK_LM11_ACCEPTANCE': JSON.stringify('1'),
    } : scenario === 'original-runtime-fault' &&
      runtimeScenario === 'request-admission-failure' ? {
      'import.meta.env.VITE_CLACK_LM11_ADMISSION_FAULT': JSON.stringify('1'),
    } : {},
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
    plugins: [{
      name: 'lm11-acceptance-memory-only',
      enforce: 'pre',
      resolveId(id) { if (id === '/lm11-authenticated-entry.js') return '\0lm11-authenticated-entry'; },
      load(id) { if (id === '\0lm11-authenticated-entry') return renderer; },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
          if (pathname === '/lm11-authenticated-webview.html') {
            try {
              const html = await server.transformIndexHtml(req.url ?? pathname,
                '<!doctype html><html><head><meta charset="utf-8"><title>LM11 Synthetic Tauri Acceptance</title></head><body><div id="phase">launch</div><script type="module" src="/lm11-authenticated-entry.js"></script></body></html>');
              res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
              res.end(html);
            } catch (error) { next(error); }
          } else if (pathname === '/lm11-acceptance-fixture.json') {
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            res.end(JSON.stringify(fixture));
          } else next();
        });
      },
    }],
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1')
    throw new Error('Vite did not bind exclusive IPv4 loopback');
  const url = `http://127.0.0.1:${address.port}/lm11-authenticated-webview.html`;
  await fs.writeFile(path.join(caseDir, 'renderer-origin.json'), JSON.stringify({ url, syntheticOnly: true }, null, 2));

  const run = (command, params, opts = {}) => new Promise((resolve, reject) => {
    const { timeoutMs = 180_000, tag = 'command', ...spawnOptions } = opts;
    const child = spawn(command, params, { cwd: project, windowsHide: true, ...spawnOptions });
    child.stdout?.pipe(createWriteStream(path.join(caseDir, `${opts.tag ?? 'command'}.stdout.log`)));
    child.stderr?.pipe(createWriteStream(path.join(caseDir, `${opts.tag ?? 'command'}.stderr.log`)));
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, timedOut });
    });
  });
  if (!noBuild) {
    const built = await run('cargo', [
      'build', '--offline', '--manifest-path', 'src-tauri/Cargo.toml',
      '--example', example, '--features', feature, '--target-dir', cargoTarget,
    ], { tag: 'build', timeoutMs: 600_000 });
    if (built.code !== 0) throw new Error(`Cargo host build failed (exit ${built.code}); inspect case/build.stderr.log`);
  }
  const binary = path.join(cargoTarget, 'debug', 'examples', `${example}.exe`);
  await fs.access(binary);
  const native = await run(binary, [], {
    tag: 'native-host', timeoutMs: (deadlineStage || scenario === 'stage-expiry' ||
      scenario === 'original-postdeadline-provider-events' ||
      scenario === 'original-managed-abc-deployments') ? 215_000 : 140_000,
    env: {
      ...process.env, CLACK_LM11_AUTHENTICATED_ACCEPTANCE_ROOT: caseDir,
      CLACK_LM11_AUTHENTICATED_ACCEPTANCE_URL: url,
      CLACK_LM11_AUTHENTICATED_ACCEPTANCE_DIGEST: digest,
      CLACK_LM11_AUTHENTICATED_ACCEPTANCE_SCENARIO: scenario,
      ...(runtimeScenario ? { CLACK_LM11_RUNTIME_SCENARIO: runtimeScenario } : {}),
      ...(deadlineStage ? { CLACK_LM11_DEADLINE_STAGE: deadlineStage } : {}),
      ...(barrierStage ? { CLACK_LM11_STAGE_BARRIER: barrierStage } :
        scenario === 'original-postdeadline-provider-events' ?
          { CLACK_LM11_STAGE_BARRIER: 'first-output' } : {}),
      ...(corruptionMode ? { CLACK_LM11_B03_CORRUPT_MODE: corruptionMode } : {}),
      ...(abnormalCorruptExit ? { CLACK_LM11_CORRUPT_ABNORMAL_EXIT: '1' } : {}),
      ...(terminalWinsRace ? { CLACK_LM11_TERMINAL_WINS_RACE: '1' } : {}),
      ...(staleIdCancel ? { CLACK_LM11_STALE_ID_CANCEL: '1' } : {}),
    },
  });
  if (native.timedOut) throw new Error('Isolated native acceptance host exceeded 140s and was terminated');
  const settingsFile = path.join(caseDir, 'data', 'terax-settings.json');
  let corruptionAfterHost=null;
  if(scenario==='stage-corrupt'){
    const physical=JSON.parse(await fs.readFile(path.join(caseDir,'corrupt-authority-fault.json'),'utf8'));
    const bytes=await fs.readFile(settingsFile).catch(error=>{
      if(error.code==='ENOENT')return null;
      throw error;
    });
    const hash=bytes?createHash('sha256').update(bytes).digest('hex'):null;
    corruptionAfterHost={
      mode:corruptionMode,originalNativeFaultMode:physical.mode,
      originalFaultSha256:physical.authoritativeSha256After,
      actualAuthoritySha256:hash,
      originalFaultExisted:physical.authoritativeExistsAfter,
      actualAuthorityExists:bytes!==null,
      survivingCorruptArtifact:physical.authoritativeExistsAfter===(bytes!==null) &&
        physical.authoritativeSha256After===hash,
      acceptanceOnly:true,readOnlyPostHostAudit:true,
    };
    await fs.writeFile(path.join(caseDir,'corruption-after-host.json'),
      JSON.stringify(corruptionAfterHost,null,2),{flag:'wx'});
    if(abnormalCorruptExit){
      const proof=JSON.parse(await fs.readFile(path.join(caseDir,'corrupt-abnormal-exit.json'),'utf8'));
      if(native.code!==188 || proof.exitCode!==188 ||
        proof.skippedTauriExitHook!==true || proof.actualCorruptionDetectedBeforeExit!==true ||
        proof.syntheticServiceReaped!==true || proof.syntheticOnly!==true)
        throw new Error('Native abnormal host termination did not occur AFTER original corruption');
    }
  }
  const assertSettingsLeaf = async () => {
    if (await fs.realpath(path.dirname(settingsFile)) !== path.join(caseDir, 'data'))
      throw new Error('ABORT: settings parent escaped unique isolated AppData');
    const info = await fs.lstat(settingsFile);
    if (!info.isFile() || info.isSymbolicLink() || await fs.realpath(settingsFile) !== settingsFile)
      throw new Error('ABORT: authoritative settings leaf is redirected');
  };
  const inspectRestart = async () => {
    const inspected = await run(binary, ['--restart-inspect'], {
      tag: 'native-restart', timeoutMs: 30_000,
      env: {
        ...process.env, CLACK_LM11_AUTHENTICATED_ACCEPTANCE_ROOT: caseDir,
        CLACK_LM11_AUTHENTICATED_ACCEPTANCE_SCENARIO: scenario,
      },
    });
    if (inspected.timedOut) throw new Error('Isolated native restart inspection timed out');
    const report = JSON.parse(await fs.readFile(path.join(caseDir, 'native-restart-report.json'), 'utf8'));
    return { inspected, report, passed: inspected.code === 0 &&
      report.scenario === scenario && report.result?.Ok?.pass === true };
  };
  if (scenario === 'window-close-preflight' || scenario === 'window-close-stream' ||
      scenario === 'stage-close') {
    const report = JSON.parse(await fs.readFile(path.join(caseDir, 'native-window-close-report.json'), 'utf8'));
    const serviceEvents = (await fs.readFile(path.join(caseDir, 'service-events.jsonl'), 'utf8'))
      .trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const acceptedPosts = serviceEvents.filter(row =>
      row.route === '/v1/chat/completions' && row.status === 200).length;
    const rows = JSON.parse(await fs.readFile(settingsFile, 'utf8'))
      .selfHostedInference?.fabric?.qualificationReceipts ?? [];
    const checks = [
      ['real-webview-window-destroyed', report.actualRendererWindowDestroyed === true],
      ['real-production-native-request-registry-drained', report.nativeRegistryDrainedAfterWindowDestroyed === true],
      ['original-renderer-caller-not-upgraded', report.originalWebviewCallerSucceeded === false],
      ['actual-renderer-ipc-open-stream-close',
        report.nativeOpenIpcCount >= (scenario === 'stage-close' &&
          barrierStage === 'before-ai-http-open' ? 1 : 2) &&
        report.exactNativeStreamIpcCount === (scenario === 'stage-close' &&
          barrierStage === 'before-ai-http-open' ? 0 : 1) &&
        report.realWindowCloseIpcCount === 1],
      ['exact-request-id', scenario === 'stage-close' &&
        barrierStage === 'before-ai-http-open' ?
        report.exactNativeRequestId === 'no-native-request' :
        /^inference-\d+$/.test(report.exactNativeRequestId ?? '')],
      ['real-service-dispatch-matches-window-close-phase', acceptedPosts ===
        ((scenario === 'stage-close' && barrierStage === 'before-ai-http-open') ||
          scenario === 'window-close-preflight' ? 0 : 1)],
      ['zero-native-qualification-persistence', rows.length === 0 && report.persistedQualificationReceiptCount === 0],
      ['synthetic-no-model-and-no-provider-eternal-proof', report.modelRuntimeStarted === false &&
        report.providerEternalInactivityProven === false && report.syntheticOnly === true],
      ['real-native-taui-host-with-isolated-appdata', native.code === 0 && report.nativeTauriIpc === true &&
        path.dirname(await fs.realpath(caseDir)) === expectedCases],
      ['original-production-qualification-owned-before-physical-window-destroy',
        scenario !== 'stage-close' ||
        (report.originalProductionRunnerAtClose === true &&
          report.originalQualificationStage === barrierStage &&
          report.originalSessionIdPresent === true &&
          report.originalAggregateBudgetMs === 120_000)],
      ['exact-case-identity', report.scenario === scenario && report.passed === true],
    ].map(([name, pass]) => ({ name, pass }));
    const accepted = checks.every(row => row.pass);
    await fs.writeFile(path.join(caseDir, 'acceptance-invariants.json'), JSON.stringify({
      scenario, syntheticOnly: true, checks, allPassed: accepted,
      originalRendererExitUnacknowledged: true,
    }, null, 2));
    console.log(JSON.stringify({ caseDir, scenario, nativeExitCode: native.code,
      accepted, outcome: 'real-window-destroyed-native-registry-drained',
      detail: 'original-renderer-terminal-unknown-no-model',
      failedInvariants: checks.filter(row => !row.pass).map(row => row.name),
    }, null, 2));
    if (!accepted) process.exitCode = 1;
  } else if (scenario === 'restart-pending' || scenario === 'lost-native-ack') {
    const expectedExit = scenario === 'restart-pending' ? 173 : 174;
    await assertSettingsLeaf();
    const real = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    const rows = real.selfHostedInference?.fabric?.qualificationReceipts ?? [];
    const ticket = JSON.parse(await fs.readFile(path.join(caseDir, 'native-qualification-ticket.json'), 'utf8'));
    const marker = rows[0]?.qualificationCas;
    const phase = scenario === 'restart-pending' ? 'pending' : 'acknowledged';
    const ver = scenario === 'restart-pending' ? 0 : 2;
    const before = native.code === expectedExit && rows.length === 4 &&
      rows.every(row => row.version === ver && row.qualificationCas?.phase === phase &&
        row.qualificationCas.operationId === marker.operationId &&
        row.qualificationCas.nativeEpoch === marker.nativeEpoch) &&
      marker.operationId === ticket.operationId && marker.nativeEpoch === ticket.nativeEpoch;
    const restart = await inspectRestart();
    const rendererReceiptMissing = await fs.stat(path.join(caseDir, 'renderer-report.json'))
      .then(() => false, error => {
        if (error.code === 'ENOENT') return true;
        throw error;
      });
    const checks = [
      ['real-renderer-native-ack-boundary-intercept', native.code === expectedExit],
      ['exact-native-ticket-persisted-before-process-exit', !!marker &&
        marker.operationId === ticket.operationId && marker.nativeEpoch === ticket.nativeEpoch],
      ['physical-pending-or-acknowledged-receipt', before],
      ['separate-real-tauri-wry-process-restart', restart.passed],
      ['read-only-native-reconciliation-no-replay', restart.report.result?.Ok?.rendererIpcNotReplayed === true],
      ['correct-native-effect-state', restart.report.result?.Ok?.reconcile ===
        (scenario === 'restart-pending' ? 'not-committed' : 'committed')],
      ['no-original-caller-retroactive-pass', native.code === expectedExit &&
        rendererReceiptMissing && restart.report.result?.Ok?.rendererIpcNotReplayed === true],
    ].map(([name, pass]) => ({ name, pass }));
    const accepted = checks.every(check => check.pass);
    await fs.writeFile(path.join(caseDir, 'acceptance-invariants.json'), JSON.stringify({
      scenario, syntheticOnly: true, checks, allPassed: accepted,
      originalRendererReceipt: false, modelQualification: false,
    }, null, 2));
    console.log(JSON.stringify({ caseDir, scenario, nativeExitCode: native.code,
      accepted, outcome: restart.report.result?.Ok?.reconcile,
      detail: 'original-renderer-outcome-unknown-no-PASS',
      failedInvariants: checks.filter(check => !check.pass).map(check => check.name),
    }, null, 2));
    if (!accepted) process.exitCode = 1;
  } else {
  const receiptPath = path.join(caseDir, 'renderer-report.json');
  const result = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  const serviceEvents = (await fs.readFile(path.join(caseDir, 'service-events.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  let persistedWhole=null;
  try { persistedWhole=JSON.parse(await fs.readFile(path.join(caseDir,'data','terax-settings.json'),'utf8')); }
  catch(error) {if(scenario!=='stage-corrupt')throw error;}
  const rows = persistedWhole?.selfHostedInference?.fabric?.qualificationReceipts ?? [];
  const qualifying = ['normal', 'stop-after-terminal', 'duplicate-ticket',
    'restart-acknowledged', 'corrupt-settings', 'read-only-settings',
    'stage-reachability','stage-concurrent','original-duplicate-terminal'].includes(scenario);
  const capIds = ['chat', 'streaming', 'terminal-completion', 'instruction-adherence'];
  const receiptOwner = new Set(rows.map(row => `${row.qualificationCas?.operationId}:${row.qualificationCas?.nativeEpoch}`));
  const exactReceipts = rows.length === 4 && receiptOwner.size === 1 &&
    capIds.every(name => rows.some(row => row.capability === name)) &&
    rows.every(row => row.version === 2 && row.status === 'verified' &&
      row.qualificationCas?.phase === 'acknowledged' &&
      row.evidence?.source === (row.capability === 'instruction-adherence'
        ? 'deterministic-evaluator' : 'clack-transport'));
  const abcReceipts = scenario === 'original-managed-abc-deployments' &&
    rows.length === 8 && receiptOwner.size === 2 &&
    [result.renderer?.native?.managedABC?.originalBDeploymentId,
      result.renderer?.native?.managedABC?.originalCDeploymentId].every(deploymentId =>
      typeof deploymentId === 'string' && rows.filter(row =>
        row.scope?.deploymentId === deploymentId).length === 4) &&
    rows.every(row => row.version === 2 && row.status === 'verified' &&
      row.qualificationCas?.phase === 'acknowledged');
  const noPositiveHttpModes = new Set([
    'authenticated-readiness-success', 'delayed-readiness', 'authenticated-health-failure',
    'authenticated-model-identity-failure',
    'cancel-before-registration', 'cancel-immediately-after-registration',
    'registration-after-renderer-cancellation', 'request-admission-failure',
    'transport-failure', 'terminal-error',
  ]);
  const runtimeExpectedSuccess = runtimeScenario && !noPositiveHttpModes.has(runtimeScenario) ? 1 : 0;
  const count = (route, status) => serviceEvents.filter(row => row.route === route && row.status === status).length;
  const canceled = result.nativeRequestChecks?.cancelledIds ?? [];
  const exactCancel = result.renderer?.negative?.find(row => row.name === 'exact-id-cancel');
  const originalFault = scenario === 'original-runtime-fault';
  const originalProof = result.renderer?.native?.originalRuntimeFault;
  const originalPostregistration = !['authenticated-health-failure',
    'authenticated-model-identity-failure'].includes(runtimeScenario);
  const originalNativeCounts = result.nativeRequestChecks?.counts ?? {};
  const originalNoB03 = [
    'self_hosted_profiles_qualification_begin',
    'self_hosted_profiles_qualification_prepare',
    'self_hosted_profiles_qualification_acknowledge',
    'self_hosted_profiles_qualification_cancel',
    'self_hosted_profiles_qualification_reconcile',
  ].every(command => (originalNativeCounts[command] ?? 0) === 0);
  const originalServicePosts = serviceEvents.filter(row =>
    row.route === '/v1/chat/completions' && Number.isInteger(row.status)).length;
  const originalServiceWitness = runtimeScenario === 'authenticated-health-failure'
    ? count('/health', 503) >= 1 && originalServicePosts === 0
    : runtimeScenario === 'authenticated-model-identity-failure'
    ? count('/health', 200) >= 1 && count('/v1/models', 200) >= 1 &&
      serviceEvents.some(row => row.phase === 'authenticated-wrong-model-identity') &&
      originalServicePosts === 0
    : runtimeScenario === 'request-admission-failure'
    ? originalServicePosts === 0
    : runtimeScenario === 'transport-failure'
    ? serviceEvents.some(row => row.phase === 'disconnect-before-http-headers') &&
      originalServicePosts === 0
    : runtimeScenario === 'terminal-error'
    ? count('/v1/chat/completions', 500) === 1 && originalServicePosts === 1
    : runtimeScenario === 'malformed-stream-frame'
    ? serviceEvents.some(row => row.phase === 'malformed-sse-emitted') &&
      count('/v1/chat/completions', 200) === 1 && originalServicePosts === 1
    : runtimeScenario === 'connection-close-without-terminal'
    ? serviceEvents.some(row => row.phase === 'stream-closed-without-terminal') &&
      count('/v1/chat/completions', 200) === 1 && originalServicePosts === 1
    : runtimeScenario === 'evidence-rejection'
    ? serviceEvents.some(row => row.phase === 'protocol-valid-nonadherent-evidence-emitted') &&
      count('/v1/chat/completions', 200) === 1 && originalServicePosts === 1
    : false;
  const originalEvidenceVerified = originalFault &&
    result.scenarioObservedByHost === true &&
    result.renderer?.outcome === 'original-qualification-runtime-fault-rejected' &&
    originalProof?.mode === runtimeScenario &&
    originalProof?.originalProductionRunner === true &&
    originalProof?.originalCallerRejected === true &&
    originalProof?.originalCallerSucceeded === false &&
    originalProof?.nativeSessionDrained === true &&
    originalProof?.noAdditionalNativeRequest === true &&
    originalProof?.noFlightViolations === true &&
    typeof originalProof?.originalSessionId === 'string' &&
    originalProof.originalSessionId.length > 0 &&
    originalNoB03 && rows.length === 0 &&
    originalNativeCounts.lm11_acceptance_runtime_activate === 1 &&
    result.nativeRequestChecks?.opens === (originalPostregistration ? 2 : 1) &&
    result.nativeRequestChecks?.streams === (originalPostregistration ? 1 : 0) &&
    (originalPostregistration
      ? /^inference-\d+$/.test(originalProof?.exactOriginalRequestId ?? '') &&
        result.nativeRequestChecks?.streamIds?.length === 1 &&
        result.nativeRequestChecks.streamIds[0] === originalProof.exactOriginalRequestId &&
        originalProof?.originalNativeOpenCount === 1 &&
        originalProof?.actualOriginalChannelEvents?.length > 0
      : originalProof?.exactOriginalRequestId === null &&
        originalProof?.originalNativeOpenCount === 0) &&
    originalServiceWitness;
  const originalNegativeMode = originalFault && runtimeScenario === 'malformed-stream-frame';
  const originalEvidenceMode = originalFault && runtimeScenario === 'evidence-rejection';
  const originalNegativeStatuses = {
    chat: 'failed', streaming: 'failed',
    'terminal-completion': 'failed', 'instruction-adherence': 'incomplete',
  };
  const originalNegativeReceiptOwners = new Set(rows.map(row =>
    row.qualificationCas?.operationId + ':' + row.qualificationCas?.nativeEpoch));
  const originalNegativeScopes = new Set(rows.map(row => JSON.stringify(row.scope)));
  const originalNegativeRows = originalNegativeMode && rows.length === 4 &&
    originalNegativeReceiptOwners.size === 1 && originalNegativeScopes.size === 1 &&
    capIds.every(cap => rows.filter(row => row.capability === cap).length === 1) &&
    rows.every(row => row.version === 2 &&
      row.status === originalNegativeStatuses[row.capability] &&
      row.qualificationCas?.phase === 'acknowledged' &&
      /^[a-f0-9]{32}$/i.test(row.qualificationCas?.operationId ?? '') &&
      /^[a-f0-9]{32}$/i.test(row.qualificationCas?.nativeEpoch ?? '') &&
      row.evidence?.reference === originalProof?.originalResultRequestId &&
      row.evidence?.source === (row.capability === 'instruction-adherence'
        ? 'deterministic-evaluator' : 'clack-transport') &&
      row.evidence?.checks?.length === 1 &&
      row.evidence.checks[0].result === (row.status === 'incomplete' ? 'incomplete' : 'fail') &&
      row.scope?.artifactDigest === digest &&
      row.scope?.runtimeEpoch === result.renderer?.native?.bind?.epoch &&
      row.scope?.runtimeProcessIdentity === 'pid:' + result.renderer?.native?.bind?.pid);
  const originalNegativeEvidence = originalNegativeRows &&
    result.scenarioObservedByHost === true &&
    result.renderer?.outcome === 'original-qualification-negative-receipts' &&
    result.nativeDurableReceiptCheck?.passed === true &&
    result.nativeDurableReceiptCheck?.count === 4 &&
    originalProof?.mode === 'malformed-stream-frame' &&
    originalProof?.originalProductionRunner === true &&
    originalProof?.originalCallerRejected === false &&
    originalProof?.originalCallerResolved === true &&
    originalProof?.originalCallerSucceeded === true &&
    originalProof?.originalReturnedNegativeVerdict === true &&
    originalProof?.noQualificationGranted === true &&
    originalProof?.negativeReceiptsAcknowledged === true &&
    originalProof?.negativeReceiptCount === 4 &&
    originalProof?.originalRejectionPhase === null &&
    originalProof?.noB03CallsOrReceipts === false &&
    originalProof?.nativeSessionDrained === true &&
    originalProof?.noAdditionalNativeRequest === true &&
    originalProof?.noFlightViolations === true &&
    originalProof?.noModel === true &&
    originalProof?.originalNativeOpenCount === 1 &&
    /^inference-\d+$/.test(originalProof?.exactOriginalRequestId ?? '') &&
    /^[0-9a-f-]{36}$/i.test(originalProof?.originalResultRequestId ?? '') &&
    typeof originalProof?.originalSessionId === 'string' &&
    originalProof.originalSessionId.length > 0 &&
    originalProof?.originalCapabilityStatuses?.chat === 'failed' &&
    originalProof?.originalCapabilityStatuses?.streaming === 'failed' &&
    originalProof?.originalCapabilityStatuses?.['terminal-completion'] === 'failed' &&
    originalProof?.originalCapabilityStatuses?.['instruction-adherence'] === 'incomplete' &&
    originalProof?.actualOriginalChannelEvents?.length > 0 &&
    originalServiceWitness && originalServicePosts === 1 &&
    result.nativeRequestChecks?.opens === 2 &&
    result.nativeRequestChecks?.streams === 1 &&
    result.nativeRequestChecks?.cancels === 2 &&
    result.nativeRequestChecks?.streamIds?.length === 1 &&
    result.nativeRequestChecks.streamIds[0] === originalProof.exactOriginalRequestId &&
    canceled.some(row => row.requestId === originalProof.exactOriginalRequestId &&
      row.origin === 'provider-retry-error') &&
    originalNativeCounts.lm11_acceptance_runtime_activate === 1 &&
    originalNativeCounts.self_hosted_profiles_qualification_begin === 1 &&
    originalNativeCounts.self_hosted_profiles_qualification_prepare === 1 &&
    originalNativeCounts.self_hosted_profiles_qualification_acknowledge === 1 &&
    (originalNativeCounts.self_hosted_profiles_qualification_cancel ?? 0) === 0 &&
    (originalNativeCounts.self_hosted_profiles_qualification_reconcile ?? 0) === 0;
  const originalNonadherentRows = originalEvidenceMode && rows.length === 4 &&
    originalNegativeReceiptOwners.size === 1 && originalNegativeScopes.size === 1 &&
    capIds.every(cap => rows.filter(row => row.capability === cap).length === 1) &&
    rows.every(row => row.version === 2 &&
      row.status === (row.capability === 'instruction-adherence' ? 'failed' : 'verified') &&
      row.qualificationCas?.phase === 'acknowledged' &&
      /^[a-f0-9]{32}$/i.test(row.qualificationCas?.operationId ?? '') &&
      /^[a-f0-9]{32}$/i.test(row.qualificationCas?.nativeEpoch ?? '') &&
      row.evidence?.reference === originalProof?.originalResultRequestId &&
      row.evidence?.source === (row.capability === 'instruction-adherence'
        ? 'deterministic-evaluator' : 'clack-transport') &&
      row.evidence?.checks?.length === 1 &&
      row.evidence.checks[0].result === (row.status === 'verified' ? 'pass' : 'fail') &&
      row.scope?.artifactDigest === digest &&
      row.scope?.runtimeEpoch === result.renderer?.native?.bind?.epoch &&
      row.scope?.runtimeProcessIdentity === 'pid:' + result.renderer?.native?.bind?.pid);
  const originalEvidenceRejection = originalNonadherentRows &&
    result.scenarioObservedByHost === true &&
    result.renderer?.outcome === 'original-qualification-negative-receipts' &&
    result.nativeDurableReceiptCheck?.passed === true &&
    result.nativeDurableReceiptCheck?.count === 4 &&
    originalProof?.mode === 'evidence-rejection' &&
    originalProof?.originalProductionRunner === true &&
    originalProof?.originalCallerRejected === false &&
    originalProof?.originalCallerResolved === true &&
    originalProof?.originalCallerSucceeded === true &&
    originalProof?.originalReturnedNegativeVerdict === true &&
    originalProof?.noQualificationGranted === true &&
    originalProof?.negativeReceiptsAcknowledged === true &&
    originalProof?.negativeReceiptCount === 4 &&
    originalProof?.originalRejectionPhase === null &&
    originalProof?.noB03CallsOrReceipts === false &&
    originalProof?.nativeSessionDrained === true &&
    originalProof?.noAdditionalNativeRequest === true &&
    originalProof?.noFlightViolations === true &&
    originalProof?.noModel === true &&
    originalProof?.originalNativeOpenCount === 1 &&
    /^inference-\d+$/.test(originalProof?.exactOriginalRequestId ?? '') &&
    /^[0-9a-f-]{36}$/i.test(originalProof?.originalResultRequestId ?? '') &&
    originalProof?.originalCapabilityStatuses?.chat === 'verified' &&
    originalProof?.originalCapabilityStatuses?.streaming === 'verified' &&
    originalProof?.originalCapabilityStatuses?.['terminal-completion'] === 'verified' &&
    originalProof?.originalCapabilityStatuses?.['instruction-adherence'] === 'failed' &&
    originalProof?.actualOriginalChannelEvents?.length > 0 &&
    originalServiceWitness && originalServicePosts === 1 &&
    result.nativeRequestChecks?.opens === 2 &&
    result.nativeRequestChecks?.streams === 1 &&
    originalNativeCounts.lm11_acceptance_runtime_activate === 1 &&
    originalNativeCounts.self_hosted_profiles_qualification_begin === 1 &&
    originalNativeCounts.self_hosted_profiles_qualification_prepare === 1 &&
    originalNativeCounts.self_hosted_profiles_qualification_acknowledge === 1 &&
    (originalNativeCounts.self_hosted_profiles_qualification_cancel ?? 0) === 0 &&
    (originalNativeCounts.self_hosted_profiles_qualification_reconcile ?? 0) === 0;
  const invariants = [
    ['canonical-direct-child', path.dirname(await fs.realpath(caseDir)) === expectedCases],
    ['isolated-native-app-data', result.appDataContained === true],
    ['real-renderer-tauri-ipc', result.nativeTauriIpc === true],
    ['test-only-no-model', result.syntheticOnly === true && result.realModelInference === false && result.modelRuntimeStarted === false],
    ['qualification-lab-disabled', result.qualificationLabRan === false],
    ['canonical-managed-identity', result.managedFixture?.digest === digest && result.managedFixture?.alias === `clack-${digest.slice(7, 23)}`],
    ['native-bearer-secret-generated-and-accepted', result.renderer?.native?.routeAuthenticated === true],
    ['native-bearer-denies-missing-and-wrong-key', count('/v1/models', 401) ===
      (scenario === 'original-managed-abc-deployments' ? 8 :
        ['genuine-child-restart','stale-cross-child-restart',
          'stale-original-qualification-child-restart','stage-stale-epoch'].includes(scenario) ? 4 : 2)],
    ['native-authenticated-health', count('/health', 200) >= 1],
    ['native-authenticated-model-list', count('/v1/models', 200) >= 1],
    ['stale-deployment-denied', result.renderer?.negative?.some(row => row.name === 'wrong-deployment' && row.rejected === true)],
    ['stale-epoch-denied', result.renderer?.negative?.some(row => row.name === 'wrong-epoch' && row.rejected === true)],
    ['native-exact-id-cancellation', !!exactCancel && canceled.some(row => row.requestId === exactCancel.requestId && row.origin === 'parent-signal')],
    ['corrupt-original-authority-survives-process-exit',scenario!=='stage-corrupt' ||
      (corruptionAfterHost?.survivingCorruptArtifact===true &&
        result.corruptAuthorityAtNativeReport===true)],
    ['no-out-of-scope-http-service-request', serviceEvents.every(row => ['/health', '/v1/models', '/v1/chat/completions'].includes(row.route))],
    ['no-receipt-promotion-from-negative-case', abcReceipts || (qualifying ? exactReceipts :
      originalNegativeMode ? originalNegativeEvidence :
      originalEvidenceMode ? originalEvidenceRejection :
      ['stage-expiry','stage-cancel','stage-conflict','stage-stale-epoch','stage-corrupt'].includes(scenario) ?
        result.nativeDurableReceiptCheck?.passed === true : rows.length === 0)],
    ['T13-original-Chat-cancellation-and-no-B03', scenario !== 'post-cancel-original-lm2f-channel' || (
      result.renderer?.native?.originalLm2fLate?.originalProductionRunner === true &&
      result.renderer?.native?.originalLm2fLate?.originalLm2fRejected === true &&
      result.renderer?.native?.originalLm2fLate?.originalNativeCancelled === true &&
      result.renderer?.native?.originalLm2fLate?.originalCancelSessionInference === true &&
      result.renderer?.native?.originalLm2fLate?.chatAndTaskUnchangedAfterLate === true &&
      result.renderer?.native?.originalLm2fLate?.zeroB03AckOrReceipts === true &&
      result.renderer?.native?.originalLm2fLate?.noRetroactiveSuccess === true &&
      result.nativeRequestChecks?.counts?.self_hosted_profiles_qualification_acknowledge == null &&
      rows.length === 0)],
    ['T13-exact-native-late-or-earlier-proved-drop', scenario !== 'post-cancel-original-lm2f-channel' || (
      ['renderer-original-channel-callback-after-proxyfetch-noop',
        'tauri-original-channel-cleanup-before-late-injection'].includes(
        result.renderer?.native?.originalLm2fLate?.observedBoundary) &&
      /^inference-\d+$/.test(result.renderer?.native?.originalLm2fLate?.requestId ?? '') &&
      // One deliberately denied preflight ai_http_stream plus one original
      // production LM2F ai_http_stream, both traced by native IPC.
      result.nativeRequestChecks?.streams === 2 &&
      count('/v1/chat/completions', 200) === 1)],
    ['T10-held-original-qualification-Channel-after-real-B-Ready',
      scenario !== 'stale-original-qualification-child-restart' || (
        result.nativeRealRestartVerified === true &&
        result.renderer?.native?.originalCrossChild?.originalProductionRunner === true &&
        result.renderer?.native?.originalCrossChild?.originalOperationRejected === true &&
        result.renderer?.native?.originalCrossChild?.heldActualOriginalEvent === true &&
        result.renderer?.native?.originalCrossChild?.releaseAfterBReady === true &&
        ['original-inference-channel-consumer-after-b-ready',
          'original-tauri-channel-structurally-disposed'].includes(
            result.renderer?.native?.originalCrossChild?.observedBoundary) &&
        result.renderer?.native?.originalCrossChild?.originalChatAndTaskUnchanged === true &&
        result.renderer?.native?.originalCrossChild?.noB03CallsOrReceipts === true &&
        result.renderer?.native?.originalCrossChild?.noNewBStreamDispatch === true &&
        /^inference-\d+$/.test(
          result.renderer?.native?.originalCrossChild?.exactOriginalRequestId ?? '') &&
        result.renderer?.native?.originalCrossChild?.heldNativeRequestId ===
          result.renderer?.native?.originalCrossChild?.exactOriginalRequestId &&
        (result.nativeRequestChecks?.streams ?? 0) === 1 &&
        ['self_hosted_profiles_qualification_begin',
          'self_hosted_profiles_qualification_prepare',
          'self_hosted_profiles_qualification_acknowledge',
          'self_hosted_profiles_qualification_cancel'].every(command =>
            (result.nativeRequestChecks?.counts?.[command] ?? 0) === 0) &&
        rows.length === 0)],
    ['feature-only-original-stage-arrival-and-terminal',
      !barrierStage || (
        result.renderer?.native?.stageBarrier?.stage === barrierStage &&
        result.renderer?.native?.stageBarrier?.mode === scenario.slice(6) &&
        result.renderer?.native?.stageBarrier?.originalProductionRunner === true &&
        result.renderer?.native?.stageBarrier?.stageReachedFromOriginalIpc === true &&
        result.renderer?.native?.stageBarrier?.releasedExactlyOnce === true &&
        result.renderer?.native?.stageBarrier?.originalAggregateBudgetMs === 120000 &&
        result.renderer?.native?.stageBarrier?.nativeStreams === (staleIdCancel ? 3 :
          ['stage-expiry','stage-cancel'].includes(scenario) &&
          ['before-native-admission','native-admission-response',
            'prepare-chat-promise-settlement','native-open-response',
            'before-preparation','during-preparation','preparation-complete',
            'before-ai-http-open','predispatch','after-ai-http-open'].includes(barrierStage)
            ? 0 : 1) &&
        result.renderer?.native?.stageBarrier?.originalCallerDidNotRetroactivelyPass === true &&
        result.nativeRequestChecks?.streams === (staleIdCancel ? 3 :
          ['stage-expiry','stage-cancel'].includes(scenario) &&
          ['before-native-admission','native-admission-response',
            'prepare-chat-promise-settlement','native-open-response',
            'before-preparation','during-preparation','preparation-complete',
            'before-ai-http-open','predispatch','after-ai-http-open'].includes(barrierStage)
            ? 0 : 1) &&
        (result.nativeRequestChecks?.counts?.lm11_acceptance_barrier ?? 0) >= 1 &&
        result.nativeRequestChecks?.counts?.lm11_acceptance_barrier_release === 1 &&
        result.nativeRequestChecks?.counts?.lm11_acceptance_barrier_terminal === 1 &&
        (scenario !== 'stage-cancel' ||
          (result.renderer?.native?.stageBarrier?.actualSessionStop === true &&
            result.renderer?.native?.stageBarrier?.originalCancellationReason ===
              'explicit-user:cancel-requested')) &&
        (scenario !== 'stage-conflict' ||
          (result.renderer?.native?.stageBarrier?.originalCasConflictInjected === true &&
            result.renderer?.native?.stageBarrier?.unrelatedOrdinarySettingsRevisionPreserved === true)) &&
        (scenario !== 'stage-concurrent' ||
          (result.renderer?.native?.stageBarrier?.secondOriginalSameDeploymentQualificationRejected === true &&
            result.renderer?.native?.stageBarrier?.originalFirstQualificationCompleted === true)) &&
        (scenario !== 'stage-stale-epoch' || (
          result.renderer?.native?.stageBarrier?.genuineB03TicketUnderEpochA === true &&
          result.renderer?.native?.stageBarrier?.realDifferentPidEpochBReady === true &&
          result.renderer?.native?.stageBarrier?.newBRouteStillUsable === true &&
          (barrierStage === 'b03-before-readback' ? (
            result.renderer?.native?.stageBarrier?.historicalAReadbackOnly === true &&
            result.renderer?.native?.stageBarrier?.staleACallerDidNotPass === true &&
            result.renderer?.native?.stageBarrier?.immutableHistoricalAReceipts === true &&
            result.renderer?.native?.stageBarrier?.reconciliationDoesNotGrantCurrentEpoch === true &&
            result.renderer?.native?.stageBarrier?.physicalReconciliation === 'committed' &&
            rows.length === 4 && rows.every(row=>row.version === 2 &&
              row.qualificationCas?.phase === 'acknowledged')) : (
            result.renderer?.native?.stageBarrier?.oldEpochNativeProgressionRejected === true &&
            result.renderer?.native?.stageBarrier?.zeroAcknowledgedQualifyingReceipts === true &&
            result.renderer?.native?.stageBarrier?.reconcileNonqualifying === true &&
            rows.every(row => row.qualificationCas?.phase !== 'acknowledged'))))) &&
        (!staleIdCancel || (
          result.renderer?.native?.stageBarrier?.staleNativeId?.staleARejectedByNativeRequestFence===true &&
          result.renderer?.native?.stageBarrier?.staleNativeId?.staleACancellationIsolatedFromLiveB===true &&
          result.renderer?.native?.stageBarrier?.staleNativeId?.BNativeStreamTerminalCompleted===true)) &&
        (scenario !== 'stage-corrupt' || (
          result.renderer?.native?.stageBarrier?.actualOriginalNativePrepare === true &&
          result.renderer?.native?.stageBarrier?.originalRecoveryRequired === true &&
          result.renderer?.native?.stageBarrier?.noAutoRetry === true &&
          result.renderer?.native?.stageBarrier?.noQualifyingReceipt === true &&
          result.renderer?.native?.stageBarrier?.forensicEvidencePreserved === true &&
          result.renderer?.native?.stageBarrier?.corruptionMode === corruptionMode &&
          result.renderer?.native?.stageBarrier?.physicalReconciliation === 'pending-reconciliation' &&
          rows.every(row => row.version !== 2 || row.qualificationCas?.phase !== 'acknowledged'))) &&
        result.scenarioObservedByHost === true)],
    ['production-CAS-ack-or-honest-negative', result.nativeDurableReceiptCheck?.passed === true && result.scenarioObservedByHost === true],
    ['strict-synthetic-positive-single-http', count('/v1/chat/completions', 200) ===
      (runtimeScenario ? runtimeExpectedSuccess : deadlineStage ?
        (['persisted-chat-evidence','native-revalidation','cas-commit'].includes(deadlineStage) ? 1 : 0) :
        scenario === 'stale-cross-child-restart' ? 2 :
        scenario === 'stale-original-qualification-child-restart' ? 1 :
        barrierStage ? (staleIdCancel ? 2 : ['stage-expiry','stage-cancel'].includes(scenario) &&
          ['before-native-admission','native-admission-response',
            'prepare-chat-promise-settlement','native-open-response',
            'before-preparation','during-preparation','preparation-complete',
            'before-ai-http-open','predispatch','after-ai-http-open'].includes(barrierStage)
            ? 0 : 1) :
        qualifying || scenario === 'stop-during-stream' ||
          ['post-terminal-channel-callback','post-cancel-channel-callback',
            'post-cancel-original-lm2f-channel',
            'original-late-cancel-ack','original-duplicate-terminal',
            'original-postdeadline-provider-events',
            'original-native-quiescence-failure'].includes(scenario) ? 1 :
          scenario==='original-abc-native-isolation'?3:
          scenario==='original-managed-abc-deployments'?5:0)],
    ['original-production-aggregate-wall-budget', !deadlineStage || (
      result.renderer?.outcome === 'real-aggregate-deadline-rejected' &&
      result.scenarioObservedByHost === true &&
      result.renderer?.native?.deadline?.originalAggregateBudgetMs === 120_000 &&
      result.renderer?.native?.deadline?.realElapsedMs >= 119_000 &&
      result.renderer?.native?.deadline?.selectedStage === deadlineStage)],
    ['native-genuine-two-child-restart', ![
      'genuine-child-restart','stale-cross-child-restart',
      'stale-original-qualification-child-restart'].includes(scenario) ||
      result.nativeRealRestartVerified === true &&
      result.renderer?.native?.restart?.newPid !== result.renderer?.native?.restart?.oldPid &&
      result.renderer?.native?.restart?.newEpoch !== result.renderer?.native?.restart?.oldEpoch &&
      result.renderer?.native?.restart?.newReadyAuthenticated === true],
    ['runtime-scenario-separate-from-smoke', runtimeScenario ?
      (originalFault ? result.scenario === 'original-runtime-fault' &&
        result.renderer?.runtimeChecks == null &&
        (originalNegativeMode ? originalNegativeEvidence :
          originalEvidenceMode ? originalEvidenceRejection : originalEvidenceVerified) :
        result.scenario === 'runtime-transport' &&
        result.renderer?.runtimeChecks?.mode === runtimeScenario &&
        result.renderer?.outcome === 'runtime-fault-observed') :
      result.renderer?.runtimeChecks == null],
    ...(originalFault && runtimeScenario === 'transport-failure' ?
      [['full-matrix-failures-04-original-runner', originalEvidenceVerified]] : []),
    ...(originalFault && runtimeScenario === 'malformed-stream-frame' ?
      [['full-matrix-failures-05-original-runner-negative', originalNegativeEvidence]] : []),
    ...(originalFault && runtimeScenario === 'connection-close-without-terminal' ?
      [['full-matrix-failures-06-original-runner', originalEvidenceVerified]] : []),
    ...(originalFault && runtimeScenario === 'terminal-error' ?
      [['full-matrix-failures-07-original-runner', originalEvidenceVerified]] : []),
    ...(originalFault && runtimeScenario === 'evidence-rejection' ?
      [['full-matrix-failures-10-original-runner', originalEvidenceRejection]] : []),
  ].map(([name, pass]) => ({ name, pass }));
  await fs.writeFile(path.join(caseDir, 'acceptance-invariants.json'), JSON.stringify({
    scenario, syntheticOnly: true, checks: invariants,
    allPassed: invariants.every(row => row.pass),
  }, null, 2));
  let accepted = result.syntheticOnly === true && result.nativeTauriIpc === true &&
    result.appDataContained === true && result.renderer?.outcome !== 'blocked' &&
    result.nativeRequestChecks?.pass === true && invariants.every(row => row.pass) &&
    native.code === (abnormalCorruptExit ? 188 : 0);
  let restartResult = null;
  if (scenario === 'stage-corrupt') {
    // A second REAL Tauri process must read/reconcile the exact unresolved
    // original ticket and leave the physical authoritative bytes (including
    // legitimate ABSENCE) unchanged. Neither this inspector nor Store Exit
    // may manufacture '{}' or normalize an inconsistent qualification marker.
    const before = await fs.readFile(settingsFile).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    restartResult = await inspectRestart();
    const after = await fs.readFile(settingsFile).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const physicalUnchanged = (before === null) === (after === null) &&
      (before === null || before.equals(after));
    const reconciledUnknown = restartResult.passed &&
      restartResult.report.result?.Ok?.reconcile === 'pending-reconciliation';
    accepted = accepted && physicalUnchanged && reconciledUnknown;
    await fs.writeFile(path.join(caseDir,'acceptance-restart-invariants.json'), JSON.stringify({
      scenario, accepted, separateTauriProcess: true,
      originalHostExitKind: abnormalCorruptExit ? 'abnormal-process-exit' : 'normal-tauri-store-exit',
      recoveryRequiredAfterRestart: reconciledUnknown,
      unchangedAfterStoreExit: physicalUnchanged,
      originalAuthorityStillAbsent: after === null,
      noFabricatedEmptyStore: after === null || after.length !== 2 || after.toString() !== '{}',
    }, null, 2), { flag: 'wx' });
  }
  if (['restart-acknowledged','corrupt-settings','read-only-settings'].includes(scenario)) {
    await assertSettingsLeaf();
    const marker = rows[0]?.qualificationCas;
    if (!exactReceipts || !marker?.operationId || !marker.nativeEpoch)
      throw new Error('No real acknowledged native ticket to reconcile after restart');
    await fs.writeFile(path.join(caseDir, 'native-qualification-ticket.json'), JSON.stringify({
      operationId: marker.operationId, nativeEpoch: marker.nativeEpoch,
    }), { flag: 'wx' });
    if (scenario === 'corrupt-settings') {
      await fs.copyFile(settingsFile, path.join(caseDir, 'authoritative-main-before-deliberate-corruption.json'));
      await fs.writeFile(settingsFile, '{malformed-acceptance-only');
    }
    if (scenario === 'read-only-settings') await fs.chmod(settingsFile, 0o444);
    try { restartResult = await inspectRestart(); }
    finally {
      if (scenario === 'read-only-settings') await fs.chmod(settingsFile, 0o666);
    }
    accepted = accepted && restartResult.passed &&
      restartResult.report.result?.Ok?.reconcile ===
      (scenario === 'corrupt-settings' ? 'pending-reconciliation' : 'committed');
    await fs.writeFile(path.join(caseDir, 'acceptance-restart-invariants.json'), JSON.stringify({
      scenario, accepted, readOnlyOrCorruptionConfined: true,
      freshTauriRestart: restartResult.passed,
      reconciliation: restartResult.report.result?.Ok?.reconcile,
      originalSyntheticTransportOnly: true,
    }, null, 2));
  }
  console.log(JSON.stringify({
    caseDir, scenario, nativeExitCode: native.code, accepted,
    outcome: result.renderer?.outcome,
    detail: accepted ? (restartResult ? 'synthetic-transport-and-native-restart-only' : 'synthetic-transport-only') : result.renderer?.error,
    failedInvariants: invariants.filter(row => !row.pass).map(row => row.name),
  }, null, 2));
  if (!accepted) process.exitCode = 1;
  }
} finally {
  await vite?.close();
}
