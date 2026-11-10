/** One explicitly opted-in Muse diagnostic session. NEVER starts inference.
 *
 * The adapters are real, operator-owned resources in a future live invocation.
 * An adapter's status is NOT taken from an assertion about code availability:
 * every arm() must finish a run-bound, positive, source-specific handshake.
 * This module is also used with fakes by offline regression tests.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';

export const MUSE_MODEL = 'muse-glimmer:30b';
export const MUSE_DIGEST = 'de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1';
export const MUSE_ENDPOINT = 'http://127.0.0.1:11435/api/chat';
export const ONE_SESSION_GATES = Object.freeze([
  'identity', 'tunnel', 'mapping', 'clocks', 'kernel',
  'native', 'semantic', 'webview', 'journal',
]);
const ID = /^[a-z0-9][a-z0-9-]{7,79}$/;
const OWNED = new Set(ONE_SESSION_GATES);
const BOUNDED = n => Number.isSafeInteger(n) && n >= 0;
const positive = n => BOUNDED(n) && n > 0;

export function validateOneMusePayload({ url, method, body, requestClass = 'diagnostic',
  fallback = false, continuation = false, retry = false } = {}) {
  assert.equal(url, MUSE_ENDPOINT, 'diagnostic-endpoint-mismatch');
  assert.equal(method, 'POST', 'diagnostic-post-required');
  assert.equal(requestClass, 'diagnostic', 'calibration-or-qualification-prohibited');
  assert(!fallback && !continuation && !retry, 'retry-continuation-or-fallback-prohibited');
  assert(body && typeof body === 'object' && !Array.isArray(body),
    'diagnostic-body-missing');
  assert.equal(body.model, MUSE_MODEL, 'model-substitution-prohibited');
  assert.equal(body.stream, true, 'production-stream-required');
  assert(body.options && body.options.num_ctx === 32768 &&
    body.options.num_predict === 8192,
    'calibrated-diagnostic-budget-required');
  assert(Array.isArray(body.messages) && body.messages.length === 1 &&
    body.messages[0]?.role === 'user' &&
    typeof body.messages[0]?.content === 'string' &&
    body.messages[0].content.length > 0,
  'exactly-one-user-message-required');
  assert(!Object.hasOwn(body, 'tools') || Array.isArray(body.tools) && body.tools.length === 0,
    'native-tool-qualification-prohibited');
  assert(!Object.hasOwn(body, 'tool_choice'), 'tool-choice-prohibited');
  assert(!Object.hasOwn(body, 'think'), 'automatic-think-must-be-omitted');
  // There is no format/response rewriting and no model invocation in this check.
  return true;
}

/** A gate ACK names the one live run and gives an independently checked source
 * identity. It must have a durable journal record before the gate is accepted.
 * The adapter is responsible for actually checking source identity/readiness. */
function validateAck(gate, runId, ack) {
  assert(ack && ack.runId === runId && ack.source === gate &&
    ack.ready === true && typeof ack.identity === 'string' &&
    /^[A-Za-z0-9_:-]{1,96}$/.test(ack.identity),
  `gate-${gate}-unavailable-or-stale`);
  assert(ack.loss === 0 && ack.pending === 0,
    `gate-${gate}-initial-loss-or-pending`);
  if (gate === 'identity') assert(ack.model === MUSE_MODEL &&
    ack.digest === MUSE_DIGEST && ack.metadataOnly === true,
    'model-identity-mismatch');
  if (gate === 'tunnel') assert(ack.local === '127.0.0.1:11435' &&
    ack.remote === '127.0.0.1:11434' && positive(ack.ownerPid) &&
    ack.strictHostKey === true, 'tunnel-mapping-mismatch');
  if (gate === 'mapping') assert(ack.localListener === '127.0.0.1:11435' &&
    ack.remoteListener === '127.0.0.1:11434' &&
    positive(ack.tunnelOwnerPid) && positive(ack.ollamaPid) &&
    ack.requestSocketCorrelation === 'not-established',
    'connection-identities-not-verified');
  if (gate === 'clocks') assert(ack.sampleCount >= 3 &&
    positive(ack.uncertaintyUs) && positive(ack.localAnchorUnixUs) &&
    positive(ack.remoteAnchorUnixUs) &&
    positive(ack.remoteAnchorMonoUs) &&
    Math.abs(Date.now() * 1000 - ack.localAnchorUnixUs) <= 120_000_000,
    'fresh-clock-anchors-required');
  if (gate === 'kernel') assert(ack.pid > 1 && ack.port === 11434 &&
    ack.completedNativeAttach === true && ack.loadedProgram === true &&
    ack.identityVerified === true, 'kernel-attach-identity-unverified');
  if (gate === 'native' || gate === 'semantic' || gate === 'webview')
    assert(ack.activeRegistration === true && ack.receiptAck === true,
      `gate-${gate}-not-actively-registered`);
  if (gate === 'journal') assert(ack.fsyncAck === true &&
    ack.exclusive === true, 'journal-not-exclusive-durable');
}

/** Serial, fsynced session ledger has no prompt, endpoint credentials or
 * socket pointers. Every record is either a bounded gate or terminal outcome. */
async function createLedger(root) {
  const file = await open(path.join(root, 'session-lifecycle.jsonl'), 'wx', 0o600);
  let last = Promise.resolve();
  let closed = false;
  return {
    write(kind, name, result) {
      assert(/^[a-z-]{2,30}$/.test(kind) && /^[a-z-]{2,30}$/.test(name) &&
        /^[a-z0-9-]{2,70}$/.test(result), 'unsafe-session-ledger-value');
      last = last.then(async () => {
        assert(!closed, 'ledger-closed');
        await file.writeFile(JSON.stringify({kind, name, result, atUnixMs: Date.now()}) + '\n');
        await file.sync();
      });
      return last;
    },
    async close() { await last; closed = true; await file.close(); },
  };
}

/** Constructing a coordinator has no I/O; open() alone creates a fresh run root.
 * Adapters must have `arm({runId, root, receipts})`, `check({runId})`,
 * `stop({runId, reason})` and `terminal({runId})` contracts. The identity/
 * tunnel/clock/kernel integrations are never silently mocked at runtime.
 */
export class OneMuseDiagnosticSession {
  constructor({ baseRoot, sources, makeJournal, now = () => Date.now(),
    runId = null }) {
    assert(path.isAbsolute(baseRoot), 'absolute-evidence-base-required');
    assert(sources && ONE_SESSION_GATES.filter(g => g !== 'journal')
      .every(g => typeof sources[g]?.arm === 'function' &&
        typeof sources[g]?.check === 'function' &&
        typeof sources[g]?.stop === 'function'), 'all-live-source-adapters-required');
    assert(typeof makeJournal === 'function', 'durable-journal-adapter-required');
    assert(runId === null || /^muse-one-[a-f0-9]{24}$/.test(runId),
      'exclusive-random-run-id-required');
    this.baseRoot = baseRoot;
    this.sources = sources;
    this.makeJournal = makeJournal;
    this.plannedRunId = runId;
    this.now = now;
    this.runId = null;
    this.root = null;
    this.status = 'new';
    this.failedGate = null;
    this.allowance = 1;
    this.receipts = new Map();
    this.armed = [];
    this.request = null;
    this.ledger = null;
    this.journal = null;
    this.finishPromise = null;
  }

  async open() {
    assert(this.status === 'new', 'session-already-opened');
    const base = await realpath(this.baseRoot);
    assert(base === path.resolve(this.baseRoot), 'noncanonical-evidence-base');
    this.runId = this.plannedRunId ??
      `muse-one-${randomBytes(12).toString('hex')}`;
    assert(ID.test(this.runId), 'bad-run-id');
    this.root = path.join(base, this.runId);
    await mkdir(this.root, { recursive: false, mode: 0o700 });
    this.ledger = await createLedger(this.root);
    this.status = 'arming';
    await this.ledger.write('session', 'open', 'created');
    return { runId: this.runId, root: this.root };
  }

  async recordSourceOnce(kind, gate, identity) {
    assert(kind === 'readiness' || kind === 'terminal',
      'unapproved-source-receipt');
    const status = await this.journal.status(this.runId);
    const already = (kind === 'readiness' ? status.ready : status.terminal)?.[gate];
    if (already !== undefined) {
      assert(already === identity, `gate-${gate}-durable-identity-mismatch`);
      return; // The real native/WebView observer already fsynced this source.
    }
    await this.journal.observe({kind, runId:this.runId,
      gate,sourceIdentity:identity});
  }

  /** Journal is opened before source startup to avoid losing early captures;
   * its positive fsync ACK is checked again as the final readiness gate. */
  async arm() {
    assert(this.status === 'arming' && this.ledger, 'session-not-opened');
    try {
      this.journal = await this.makeJournal({runId:this.runId, root:this.root});
      assert(this.journal && typeof this.journal.observe === 'function' &&
        typeof this.journal.status === 'function' &&
        typeof this.journal.finish === 'function' &&
        typeof this.journal.abandon === 'function', 'journal-adapter-unavailable');
      this.armed.push('journal');
      for (const gate of ONE_SESSION_GATES) {
        // A source may create resources and then throw before it can ACK.
        // Record ownership *before* invoking arm so even partial startup
        // receives a bounded stop() attempt on the fail-closed path.
        if (gate !== 'journal') this.armed.push(gate);
        const ack = gate === 'journal' ? await this.journal.ack(this.runId) :
          await this.sources[gate].arm({runId:this.runId, root:this.root,
            receipts:this.receipts, journal:this.journal});
        validateAck(gate, this.runId, ack);
        await this.recordSourceOnce('readiness',gate,ack.identity);
        const receipt = await this.journal.status(this.runId);
        assert(receipt.runId === this.runId && receipt.durable === true &&
          receipt.loss === 0 && receipt.pending === 0, `gate-${gate}-journal-ack-failed`);
        this.receipts.set(gate, Object.freeze({...ack}));
        await this.ledger.write('gate', gate, 'ready');
      }
      // Run-bound active health must remain true after other sources were armed.
      await this.checkAll();
      await this.ledger.write('session', 'admission', 'ready');
      // This is ONLY a user-interface enable receipt, never a native
      // inference permit. The native sender still requires the coordinator's
      // one-use cryptographic broker permit and its durable dispatch claim.
      const marker = await open(path.join(this.root, 'one-muse-ready.claim'), 'wx', 0o600);
      try {
        await marker.writeFile(this.runId + '\n');
        await marker.sync();
      } finally {
        await marker.close();
      }
      this.status = 'ready';
      return 'READY_FOR_ONE_INFERENCE';
    } catch(error) {
      const matched = /gate-([a-z]+)-/.exec(String(error?.message ?? ''));
      this.failedGate = matched?.[1] && OWNED.has(matched[1]) ? matched[1] :
        ONE_SESSION_GATES.find(g => !this.receipts.has(g)) ?? 'journal';
      this.status = 'blocked';
      await this.ledger.write('gate', this.failedGate, 'failed').catch(() => {});
      await this.finish('readiness-failed', {allowSeal:false});
      return 'INFERENCE_BLOCKED';
    }
  }

  async checkAll() {
    assert(this.journal && this.runId, 'no-journal');
    for (const gate of ONE_SESSION_GATES) {
      const ack = gate === 'journal' ? await this.journal.ack(this.runId) :
        await this.sources[gate].check({runId:this.runId});
      validateAck(gate, this.runId, ack);
      assert(this.receipts.get(gate)?.identity === ack.identity,
        `gate-${gate}-identity-changed`);
    }
    const persisted = await this.journal.status(this.runId);
    assert(persisted.runId === this.runId && persisted.durable === true &&
      persisted.pending === 0 && persisted.loss === 0, 'gate-journal-unhealthy');
  }

  /** Control-plane admission for a separate isolated WebView: no prompt,
   * response, URL credentials or model bytes enter this authorization call.
   * The native Tauri guard separately checks the actual serialized body. */
  async claimOne({runId, intent}) {
    assert(runId === this.runId, 'stale-run-id');
    assert(this.status === 'ready', 'inference-not-ready');
    assert(this.allowance === 1, 'request-allowance-exhausted');
    this.allowance = 0; // irreversible BEFORE any async call
    this.status = 'admitting';
    try {
      assert(intent && typeof intent === 'object' &&
        Object.keys(intent).every(k => ['model','stream','context','output',
          'tools','think','requestClass','retry','continuation','fallback'].includes(k)) &&
        intent.model === MUSE_MODEL && intent.stream === true &&
        intent.context === 32768 && intent.output === 8192 &&
        intent.tools === 0 && intent.think === 'omitted' &&
        intent.requestClass === 'diagnostic' &&
        intent.retry === false && intent.continuation === false &&
        intent.fallback === false,
      'one-request-control-intent-rejected');
      await this.checkAll();
      await this.ledger.write('request', 'allowance', 'consumed');
      this.status = 'claimed';
      return Object.freeze({runId:this.runId,allowanceRemaining:0});
    } catch(error) {
      this.status = 'failed';
      await this.ledger.write('request', 'admission', 'failed').catch(()=>{});
      throw error;
    }
  }

  async settleOne({runId, outcome}) {
    assert(runId === this.runId && (this.status === 'claimed' ||
      this.status === 'in-flight'), 'not-an-owned-one-shot-request');
    assert(['completed','failed','cancelled'].includes(outcome),
      'invalid-request-terminal-reason');
    this.status = 'settled';
    await this.ledger.write('request', 'terminal', outcome);
    return {runId:this.runId,requestAllowance:this.allowance};
  }

  /** Allowance is consumed *synchronously* before any await or dispatch.
   * Native Tauri's diagnostic-only guard independently enforces one /api/chat.
   * The execute callback must be the real provider + Clack proxyFetch path. */
  async dispatchOnce({runId, request, execute}) {
    assert(runId === this.runId, 'stale-run-id');
    assert(this.status === 'ready', 'inference-not-ready');
    assert(this.allowance === 1, 'request-allowance-exhausted');
    this.allowance = 0;
    this.status = 'admitting';
    try {
      validateOneMusePayload(request);
      assert(typeof execute === 'function', 'production-executor-required');
      await this.checkAll();
      await this.ledger.write('request', 'allowance', 'consumed');
      this.status = 'in-flight';
      // Callback is injected exclusively by production one-shot WebView flow;
      // the coordinator NEVER synthesizes a model request.
      this.request = Promise.resolve().then(() => execute({runId:this.runId}));
      const response = await this.request;
      this.status = 'settled';
      return response;
    } catch(error) {
      this.status = 'failed';
      await this.ledger.write('request', 'dispatch', 'failed').catch(() => {});
      throw error;
    }
  }

  /** Terminal shutdown is one-way. Any source failure, lost/late unACKed
   * event, kernel END failure, tunnel cleanup failure, or absent request
   * settlement preserves partial evidence and prohibits a seal. */
  async finish(reason = 'requested-stop', {allowSeal = true} = {}) {
    if (this.finishPromise) return this.finishPromise;
    this.finishPromise = this._finish(reason, allowSeal);
    return this.finishPromise;
  }
  async _finish(reason, allowSeal) {
    const stateBefore = this.status;
    this.status = 'draining';
    let complete = allowSeal && stateBefore === 'settled' && this.allowance === 0;
    const terminal = new Map();
    for (const gate of [...this.armed].reverse()) {
      const source = gate === 'journal' ? this.journal : this.sources[gate];
      if (gate === 'journal') continue;
      let sourceComplete = false;
      try {
        if (typeof source.drain === 'function') await source.drain({runId:this.runId});
        const t = typeof source.terminal === 'function'
          ? await source.terminal({runId:this.runId}) : null;
        sourceComplete = !!t && t.runId === this.runId && t.source === gate &&
          t.complete === true && t.loss === 0 && t.pending === 0 &&
          t.identity === this.receipts.get(gate)?.identity;
        terminal.set(gate, t);
      } catch { sourceComplete = false; }
      try {
        const stopped = await source.stop({runId:this.runId, reason});
        sourceComplete &&= stopped?.runId === this.runId &&
          stopped?.source === gate && stopped?.clean === true;
      } catch { sourceComplete = false; }
      if (sourceComplete) {
        try {
          await this.recordSourceOnce('terminal',gate,
            this.receipts.get(gate).identity);
        } catch { sourceComplete = false; }
      }
      if (!sourceComplete) complete = false;
      await this.ledger?.write('terminal', gate,
        sourceComplete ? 'observed' : 'missing').catch(() => {});
    }
    if (this.journal) {
      try {
        if (complete) await this.recordSourceOnce('terminal','journal',
          this.receipts.get('journal').identity);
        const receipt = await this.journal.status(this.runId);
        if (receipt.runId !== this.runId || !receipt.durable ||
          receipt.loss !== 0 || receipt.pending !== 0 || this.armed.length !== ONE_SESSION_GATES.length)
          complete = false;
        if (complete) {
          const sealed = await this.journal.finish({runId:this.runId,
            terminal, expected:receipt.count, allowSeal:true});
          complete = sealed?.sealed === true && sealed.runId === this.runId;
        }
      } catch { complete = false; }
      if (!complete) await this.journal.abandon(this.runId).catch(() => {});
    }
    this.status = complete ? 'sealed' : 'partial';
    await this.ledger?.write('session', 'completion', complete ? 'sealed' : 'partial').catch(() => {});
    await this.ledger?.close().catch(() => {});
    return Object.freeze({runId:this.runId, status:this.status,
      failedGate:this.failedGate, requestAllowance:this.allowance,
      claim:complete ? 'collector-flush-only' : 'incomplete-unsealed'});
  }
}
