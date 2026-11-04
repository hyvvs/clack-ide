import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, appendFile, readdir, cp, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer as createViteServer } from "vite";
import { evaluateAcceptanceApproval } from "./acceptance-approval.mjs";
import { createCorrectionObserver } from "./acceptance-correction.mjs";
import { persistR5hReport } from "./r5da-safe-report.mjs";
import { productionBuiltinToolNames } from "./r5u-acceptance-wire-source.mjs";

const phase = process.argv[2];
assert(phase === "mission-a", "This one-shot replacement host authorizes only the unchanged notes mission");
const repository = fileURLToPath(new URL("../", import.meta.url));
const runId = process.env.CLACK_PRODUCT_RUN_ID;
assert.equal(runId, phase === "qualification" ? "muserenewalnotes-20261104-01" : "muserenewalnotes-20261104-01", "Exclusive candidate/phase ID required; prior GLM-4.7-Flash qualification or mission cannot be replayed");
assert(!runId || /^[a-z0-9][a-z0-9-]{0,63}$/.test(runId), "Use a bounded run ID, not a path");
const owned = path.join(repository, "src-tauri/target/real-qwen-product", runId ?? "");
const root = process.env.CLACK_PRODUCT_WORKSPACE;
assert(path.isAbsolute(root), "Acceptance workspace must be absolute");
const maxOutput = process.env.CLACK_PRODUCT_MAX_OUTPUT ? Number(process.env.CLACK_PRODUCT_MAX_OUTPUT) : undefined;
assert(maxOutput === undefined, "Original Agent output limits cannot be overridden");
assert(maxOutput === undefined || (Number.isSafeInteger(maxOutput) && maxOutput >= 256 && maxOutput <= 16384), "Output allowance must be 256-16384 whole tokens");
const singleSpec = process.env.CLACK_PRODUCT_SINGLE_SPEC === "1";
const traceStreams = process.env.CLACK_PRODUCT_TRACE === "1";
const modelId = process.env.CLACK_PRODUCT_MODEL;
assert.equal(modelId, "muse-glimmer:30b", "Only the selected installed GLM-4.7-Flash candidate is authorized");
assert(phase === "mission-a", "No standalone qualification, replay or secondary mission");
assert.equal(modelId, "muse-glimmer:30b", "Only GLM-4.7-Flash is authorized");
const toolProtocol = process.env.CLACK_PRODUCT_TOOL_PROTOCOL === "1";
assert(!toolProtocol || phase === "system-preflight", "Tool protocol diagnostics require the non-executing preflight phase");
const prepareOnly = process.env.CLACK_PRODUCT_PREPARE_ONLY === "1";
assert(!prepareOnly || phase === "preflight", "Metadata-only preparation must use preflight");
assert(!singleSpec || !["resume-a", "mission-b"].includes(phase), "Single-spec runs forbid manual continuation and peer missions");
const reasoningChoice = process.env.CLACK_PRODUCT_REASONING || undefined;
assert(reasoningChoice === undefined || ["automatic", "none", "low"].includes(reasoningChoice), "Reasoning choice must be automatic, none or metadata-supported low");
assert(reasoningChoice === undefined || ["mission-a", "qualification"].includes(phase), "Automatic choice only in authorized qualification or mission");
const endpoint = "http://127.0.0.1:11436";
let streamDiagnostic, replaySource;
if (phase === "stream-diagnostic") {
  const source = process.env.CLACK_STREAM_REQUESTS;
  assert(runId && source && path.isAbsolute(source), "Diagnostic requires fresh run ID and an explicit preserved request audit");
  assert((await stat(source)).size < 4 * 1024 * 1024, "Diagnostic request audit exceeded bound");
  const text = await readFile(source, "utf8");
  assert(Buffer.byteLength(text) < 4 * 1024 * 1024, "Diagnostic request audit exceeded bound");
  const requestId = process.env.CLACK_STREAM_REQUEST_ID ?? "inference-13";
  assert(/^inference-[1-9][0-9]{0,5}$/.test(requestId), "Explicit bounded native request ID required");
  const matches = text.trim().split("\n").map(line => JSON.parse(line)).filter(item => item.requestId === requestId);
  assert.equal(matches.length, 1, "Expected exactly one preserved native request");
  const request = matches[0];
  assert(request.url === `${endpoint}/api/chat`, "Unexpected preserved request destination");
  assert.equal(request.body.model, "qwen38-uncensored:latest");
  assert.deepEqual(request.body.options, { num_ctx: 32768, num_predict: 2048 });
  assert.equal(request.body.think, false);
  assert.equal(request.body.stream, true);
  streamDiagnostic = { body: request.body, sourceRequestId: request.requestId };
  replaySource = { file: source, sha256: createHash("sha256").update(text).digest("hex"), requestId: request.requestId };
}
// The exclusive root is created with its empty Git workspace during guarded
// setup. Refuse any root that already contains evidence or prior app data.
await mkdir(owned, { recursive: true });
assert.deepEqual(await readdir(owned), ["workspace"], "Fresh owned root must contain only the prepared empty workspace");
assert((await readdir(root)).includes(".git"), "Prepare the fresh external Git workspace first");
const attempt = process.argv[3] ?? "1";
assert(/^\d{1,2}$/.test(attempt));
const output = path.join(owned, `${phase}-${attempt}`);
for (const suffix of [".json", ".jsonl", ".requests.jsonl", ".receive.jsonl", ".failure.json"]) {
  try { await readFile(`${output}${suffix}`); throw new Error(`Phase ${phase} attempt ${attempt} already has evidence; choose an explicit new attempt`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
let local, vite, child, nativeLog = "", childExit, trustTimer, trustWriting = false;
let lastTrustSignature = "";
// Acceptance-only passive inspection of the isolated native settings copy.
// No returned value is altered; no calibration/proof/inference is invoked here.
const captureTrust = async () => {
  if (trustWriting) return;
  trustWriting = true;
  try {
    const saved = JSON.parse(await readFile(path.join(owned, "data", "terax-settings.json"), "utf8"));
    const s = saved.selfHostedInference;
    const p = s?.profiles?.find(p => p.transportModelId === "muse-glimmer:30b");
    if (!p) return;
    const c = p.contextCalibration;
    const proofs = [p.toolVerification, ...(p.agentToolTierProofs ?? []),
      ...(p.agentToolConfigurations ?? [])].filter(Boolean).map(t => ({
        id: t.id, context: t.context, status: t.status, expiry: t.proof?.expiresAt ?? null,
        runtimeEpoch: t.scope?.runtimeEpoch ?? null, digest: t.scope?.digest ?? null,
        providerVersion: t.scope?.providerVersion ?? null, configuration: t.configuration ?? null,
      }));
    const metrics = ["probe.requestedContext", "probe.loadedContext", "probe.runtimeAllocation",
      "probe.loaded"];
    const values = Object.fromEntries(metrics.map(name => {
      const entries = (p.evidence ?? []).filter(e => e.metric === name);
      const e = entries.sort((a,b) => (b.observedAt ?? 0) - (a.observedAt ?? 0))[0];
      return [name, e ? { value: e.value, observedAt: e.observedAt } : null];
    }));
    const trust = {
      revision: s.revision, profileId: p.id, digest: p.modelRevision,
      calibration: c ? { id: c.id, status: c.status, highest: c.highest,
        updatedAt: c.updatedAt, expiresAt: c.expiresAt,
        runtimeEpoch: c.scope?.runtimeEpoch, providerVersion: c.scope?.providerVersion,
        attempts: c.attempts?.map(a => ({
          context: a.context, requested: a.requested, loaded: a.loaded,
          outcome: a.outcome, at: a.at,
        })) } : null, proofs, values,
    };
    const signature = JSON.stringify(trust);
    if (signature !== lastTrustSignature) {
      await appendFile(`${output}.trust-timeline.jsonl`, JSON.stringify({ at:Date.now(), ...trust }) + "\n");
      lastTrustSignature = signature;
    }
  } catch { /* Diagnostics cannot alter the one authorized Agent run. */ }
  finally { trustWriting = false; }
};
let complete;
const report = new Promise(resolve => { complete = resolve; });
let events = 0;
let approvalOwner;
const pendingApprovals = new Map();
const evaluatedApprovals = new Set();
let evidenceWrites = Promise.resolve();
const observeCorrection = createCorrectionObserver(root, path.join(owned, "correction-state.json"));
const server = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  const json = value => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); };
  try {
    if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
    if (request.url === "/configuration") return json({ root, server: endpoint, report: `${local}/report`, phase: "exercise", realProduct: { phase, modelId, toolProtocol, maxOutput, singleSpec, reasoningChoice, traceStreams, prepareOnly }, streamDiagnostic });
    if (!["/report", "/evidence", "/approval", "/correction"].includes(request.url) || request.method !== "POST") { response.statusCode = 404; return json({ error: "Unknown acceptance route" }); }
    let body = "";
    for await (const chunk of request) { body += chunk; assert(body.length < 64 * 1024 * 1024, "Acceptance payload exceeded bound"); }
    const value = JSON.parse(body);
    if (request.url === "/correction") {
      assert(["mission-a", "resume-a"].includes(phase) && child?.exitCode === null, "Correction observation requires the live Mission A host");
      return json(await observeCorrection(value));
    }
    if (request.url === "/approval") {
      assert(phase === "mission-a" && child?.exitCode === null, "Approval requires the live Mission A host");
      assert(!evaluatedApprovals.has(value.id), "Acceptance approval was already evaluated");
      assert(evaluatedApprovals.size < 64, "Acceptance approval count exceeded bound");
      evaluatedApprovals.add(value.id);
      const decision = await evaluateAcceptanceApproval(value, approvalOwner ? { ...approvalOwner, approvals: [...pendingApprovals.values()] } : undefined);
      evidenceWrites = evidenceWrites.then(() => appendFile(`${output}.jsonl`, `${JSON.stringify({ kind: "evaluator-approval", at: Date.now(), permitted: decision?.approved === true })}\n`));
      await evidenceWrites;
      return json(decision);
    }
    if (request.url === "/evidence") {
      if (value.kind === "r5di-parser-failure" || value.kind === "r5di-parser-final") {
        assert.equal(phase,"mission-a","Parser evidence must be from the unique final mission");
        const d=value.details;
        if (value.kind === "r5di-parser-failure") {
          const record=d?.record;
          assert(record && ["completion-scanner","native-adapter"].includes(record.stage),"Unrecognized parser stage");
          assert(record.requestId === null || /^inference-[1-9]\d{0,6}$/.test(record.requestId),"Unrecognized native request ID");
          assert(record.exception && typeof record.exception.name === "string" && record.exception.name.length <= 128 &&
            typeof record.exception.message === "string" && record.exception.message.length <= 512 &&
            (record.exception.stack === null || (typeof record.exception.stack === "string" && record.exception.stack.length <= 2048)),"Unbounded exception");
          assert(Number.isSafeInteger(record.chunkSequence) && record.chunkSequence >= 0 &&
            Number.isSafeInteger(record.bytesRead) && record.bytesRead >= 0 &&
            Number.isSafeInteger(record.parsedFrames) && record.parsedFrames >= 0 &&
            Number.isSafeInteger(record.pendingChars) && record.pendingChars >= 0,"Malformed parser state");
          assert(typeof record.pendingTail === "string" && record.pendingTail.length <= 384 &&
            (record.activeFrameTail === null || (typeof record.activeFrameTail === "string" && record.activeFrameTail.length <= 384)) &&
            typeof record.recentRawByteHex === "string" && /^[0-9a-f]{0,256}$/.test(record.recentRawByteHex),"Unbounded byte window");
          assert(record.decoder?.encoding === "utf-8" && record.decoder.incremental === true &&
            typeof record.decoder.fatal === "boolean" && typeof record.decoder.flushed === "boolean","Unknown decoder flags");
          assert(JSON.stringify(record).length <= 12000,"Parser error record too large");
          await appendFile(`${output}.parser-failures.jsonl`,JSON.stringify(record)+"\n");
        } else {
          assert(d?.installed === true && Number.isSafeInteger(d.failureCount) && d.failureCount >= 0 && d.failureCount <= 12 &&
            Array.isArray(d.stages) && d.stages.length === d.failureCount &&
            d.stages.every(s=>["completion-scanner","native-adapter"].includes(s)),"Parser final receipt invalid");
          await writeFile(`${output}.parser-final.json`,JSON.stringify({at:value.at,...d},null,2),{flag:"wx"});
        }
        return json({ok:true});
      }
      if (value.kind === "r5di-client-stream") {
        const d = value.details;
        assert(typeof d?.requestId === "string" && /^inference-[1-9]\d{0,6}$/.test(d.requestId), "Unexpected stream ID");
        assert(["completed","failed","cancelled"].includes(d.phase), "Unexpected native settlement");
        assert([d.firstAt,d.lastAt,d.chunks,d.maxGapMs].every(x => Number.isSafeInteger(x) && x>=0), "Invalid stream metric");
        assert(d.lastAt>=d.firstAt && d.maxGapMs<=d.lastAt-d.firstAt && d.chunks<=200000, "Stream metric inconsistent");
        assert(d.firstChunkAt===null || (Number.isSafeInteger(d.firstChunkAt) && d.firstChunkAt>=d.firstAt && d.firstChunkAt<=d.lastAt), "Invalid first chunk");
        await appendFile(`${output}.client-stream.jsonl`,`${JSON.stringify({requestId:d.requestId,phase:d.phase,
          firstAt:d.firstAt,lastAt:d.lastAt,firstChunkAt:d.firstChunkAt,
          chunks:d.chunks,maxGapMs:d.maxGapMs})}\n`);
        return json({ok:true});
      }
      if (value.kind === "r5de-cancellation") {
        const p = value.details?.provenance;
        const safeId = s => typeof s === "string" && /^inference-[1-9]\d{0,6}$/.test(s) ? s : null;
        const safeCode = s => typeof s === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(s) ? s : null;
        const record = {
          requestId: safeId(value.details?.requestId),
          at: Number.isSafeInteger(p?.at) && p.at > 0 ? p.at : null,
          source: safeCode(p?.source), reason: safeCode(p?.reason),
          initiatingLayer: safeCode(p?.initiatingLayer), category: safeCode(p?.category),
          providerRequestInFlight: p?.providerRequestInFlight === true,
          hasStructuredFirstCause: !!p,
        };
        assert(record.requestId, "Cancel provenance must correlate a native request");
        await appendFile(`${output}.cancellation-provenance.jsonl`, `${JSON.stringify(record)}\n`);
        return json({ok:true});
      }
      if (value.kind === "r5l-ipc-contract") {
        assert.equal(phase, "ipc-contract", "IPC evidence only on no-inference gate");
        const flags = value.details;
        assert(flags && Object.keys(flags).sort().join(",") ===
          "leaseAndRuntimeEpochMatch,leaseReleased,revisionMatches,runtimeVersionMatches", "Unexpected IPC evidence keys");
        assert(Object.values(flags).every(x => x === true), "Native IPC return contract failed");
        const safe = { kind: "r5l-ipc-contract", leaseAndRuntimeEpochMatch: true,
          leaseReleased: true, revisionMatches: true, runtimeVersionMatches: true };
        await appendFile(`${output}.jsonl`, `${JSON.stringify(safe)}\n`);
        complete({ ok: true, kind: "r5l-ipc-contract", missionStarted: false });
        return json({ ok: true });
      }
      if (value.kind === "state" && phase === "mission-a") {
        const session = value.sessions?.find(s => s.id === "real-mission-a");
        const previousOwner = approvalOwner;
        approvalOwner = undefined;
        if (session?.run?.state === "running") {
          assert.equal(path.resolve(session.run.workspaceRoot), path.resolve(root));
          approvalOwner = { sessionId: session.id, runId: `${session.id}:${session.run.startedAt}`, workspaceRoot: session.run.workspaceRoot };
        }
        if (JSON.stringify(previousOwner) !== JSON.stringify(approvalOwner)) { pendingApprovals.clear(); evaluatedApprovals.clear(); }
      }
      if (value.kind === "approval-pending" && phase === "mission-a") {
        assert(approvalOwner && value.sessionId === approvalOwner.sessionId && value.runId === approvalOwner.runId && value.workspaceRoot === approvalOwner.workspaceRoot, "Pending approval owner mismatch");
        assert(pendingApprovals.size < 64 && value.approval?.id && !pendingApprovals.has(value.approval.id), "Duplicate or excessive pending approval");
        pendingApprovals.set(value.approval.id, structuredClone(value.approval));
      }
      assert(++events < 100000, "Acceptance event limit");
      const safeBoundary = value.kind === "r5p-boundary" && typeof value.details?.stage === "string"
        && ["collector-synthetic-ack","channel-registered","channel-headers","channel-first-chunk",
          "channel-settled-completed","channel-settled-failed","channel-settled-cancelled","native-command-ack",
          "response-body-closed","response-cancelled","response-body-eof","response-body-error",
          "response-body-cancelled","sdk-parser-terminal","sdk-consume-start","sdk-consume-end",
          "sdk-finish-end","metadata-refresh-start","metadata-refresh-end","metadata-refresh-failed",
          "runtime-inspection-start","runtime-inspection-end","runtime-inspection-failed",
          "webview-heartbeat","calibration-returned","calibration-failed","final-report-attempt"].includes(value.details.stage)
        ? value.details.stage : undefined;
      if (value.kind === "r5p-boundary" && !safeBoundary) throw new Error("R5p observer stage not allowlisted");
      const redacted = {
        kind: value.kind, at: value.at, requestId: typeof value.requestId === "string" && /^inference-\d+$/.test(value.requestId) ? value.requestId : undefined,
        boundaryStage: safeBoundary,
        phase: value.phase, elapsedMs: value.elapsedMs,
        state: value.kind === "state" ? value.sessions?.map(s => ({ id: s.id, run: { state: s.run?.state, budget: s.run?.budget?.phase } })) : undefined,
        nativeStatus: value.kind === "settled" ? value.status : undefined,
        taskStatus: value.task?.status,
        toolSummary: value.kind === "agent-native-tool-summary" ? {
          calls: Number.isSafeInteger(value.details?.calls) && value.details.calls >= 0 ? value.details.calls : null,
          byName: Array.isArray(value.details?.byName) ? value.details.byName.slice(0, 64).map(entry => ({
            name: typeof entry.name === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(entry.name) ? entry.name : "invalid",
            count: Number.isSafeInteger(entry.count) && entry.count >= 0 ? entry.count : null,
            states: Array.isArray(entry.states) ? entry.states.slice(0, 256).map(s =>
              typeof s === "string" && /^[a-z-]{1,30}$/.test(s) ? s : "unknown") : [],
          })) : [],
        } : undefined,
      };
      evidenceWrites = evidenceWrites.then(() => appendFile(`${output}.jsonl`, `${JSON.stringify(redacted)}\n`));
      await evidenceWrites;
      if (["request", "engine-finish", "correction-boundary", "peer-result", "harness-heartbeat"].includes(value.kind) || value.kind.startsWith("approval-") || value.kind === "harness-blocked") {
        const body = value.body;
        console.log(JSON.stringify({ event: value.kind, at: new Date().toISOString(), requestId: redacted.requestId, context: body?.options?.num_ctx, toolCount: body?.tools?.length, taskStatus: value.task?.status, elapsedMs: value.elapsedMs }));
      }
    } else {
      // The exact same persistence contract is also WebView smoke tested.
      // Acknowledge ONLY AFTER the allowlisted report is durable on disk.
      const safe = await persistR5hReport(value, `${output}.native-report.json`);
      complete(safe);
    }
    json({ ok: true });
  } catch (error) { response.statusCode = 400; json({ error: String(error) }); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
local = `http://127.0.0.1:${server.address().port}`;
const startedAt = Date.now();
async function metadataHealth(route) {
  const at = Date.now();
  try {
    const response = await fetch(`${endpoint}${route}`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    return { at, elapsedMs: Date.now() - at, status: response.status, body };
  } catch (error) {
    return { at, elapsedMs: Date.now() - at, status: null, error: error.name };
  }
}
let initialModels, initialHealth;
try {
  if (phase !== "restart") {
    const response = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(5000) });
    assert(response.ok, "Ollama metadata unavailable"); initialModels = await response.json();
  }
  if (streamDiagnostic || traceStreams) initialHealth = await metadataHealth("/api/version");
  const build = spawnSync("cargo", ["build", "--example", "r5di_acceptance", "--locked", "--target-dir", "target/codex-test"], { cwd: path.join(repository, "src-tauri"), windowsHide: true, encoding: "utf8", timeout: 300000 });
  assert.equal(build.status, 0, build.stderr || String(build.error));
  vite = await createViteServer({ root: repository, plugins: [{ name: "r5h-normal-calibration-then-original-agent", configureServer(s) {
    s.middlewares.use("/coworking-acceptance.html", async (_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(await s.transformIndexHtml("/coworking-acceptance.html",
        phase === "ipc-contract"
          ? '<html><body><script type="module" src="/src/test/r5lIpcContractWebview.ts"></script></body></html>'
          : '<html><body><div id="root"></div><script type="module" src="/src/test/r5diMuseCalibrationAgent.tsx"></script></body></html>'));
    });
  }}], server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null, forwardConsole: false } });
  await vite.listen();
  const { productionAcceptanceWireContract } = await vite.ssrLoadModule("/src/test/r5uAcceptanceWireContract.ts");
  const sourceToolNames = await productionBuiltinToolNames(repository);
  // Explicit original Agent allowance/context; calibration and verification
  // classes come from current production TypeScript, never a Rust copy.
  // The native host guard follows the actual generic production Agent budget,
  // not the historical hard-coded 2048 test expectation. It cannot change the
  // runtime profile, model reasoning selection, or dispatched output allowance.
  const { r5deAcceptanceOutputContract } = await vite.ssrLoadModule("/src/test/r5deAcceptanceOutputContract.ts");
  const { CONTEXT_CALIBRATION } = await vite.ssrLoadModule("/src/modules/ai/lib/contextCalibrationSchema.ts");
  const outputPolicy = r5deAcceptanceOutputContract(CONTEXT_CALIBRATION.candidates, 73728);
  const agentOutput = outputPolicy.originalOutput;
  assert.equal(agentOutput, 8192, "Production bounded thinking-Agent output policy changed");
  const wireContract = productionAcceptanceWireContract(agentOutput, 73728, sourceToolNames);
  wireContract.agent.continuationOutputs = outputPolicy.continuationOutputs;
  wireContract.agent.continuationMarker = outputPolicy.continuationMarker;
  assert(wireContract.verification.outputs.includes(1024) &&
    wireContract.verification.outputs.includes(2048), "Full native verification ladder required");
  const data = path.join(owned, "data"); await mkdir(data);
  const sourceSettings = await readFile(path.join(repository,
    "src-tauri/target/real-qwen-product/qwen-smoke-r5af-20261024-01/data/terax-settings.json"));
  assert.equal(createHash("sha256").update(sourceSettings).digest("hex"),
    "2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb");
  // Acceptance-owned settings copy: ONLY endpoint URL differs from protected fixture.
  const isolated = JSON.parse(sourceSettings.toString("utf8"));
  assert.equal(isolated.selfHostedInference.endpoints.length, 1);
  assert.equal(isolated.selfHostedInference.endpoints[0].id, "real-qwen");
  assert.equal(isolated.selfHostedInference.endpoints[0].baseURL, "http://127.0.0.1:11435/");
  isolated.selfHostedInference.endpoints[0].baseURL = "http://127.0.0.1:11436/";
  const onlyChangedEndpoint = JSON.parse(sourceSettings.toString("utf8"));
  onlyChangedEndpoint.selfHostedInference.endpoints[0].baseURL = "http://127.0.0.1:11436/";
  assert.deepEqual(isolated, onlyChangedEndpoint, "Only endpoint may differ");
  await writeFile(path.join(data, "terax-settings.json"), JSON.stringify(isolated, null, 2), { flag: "wx" });
  await cp(data, `${output}.data-before`, { recursive: true, errorOnExist: true, force: false });
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { APPDATA: data, LOCALAPPDATA: data, TEMP: owned, TMP: owned, CLACK_ACCEPTANCE_ROOT: owned, CLACK_REAL_PRODUCT_PHASE: `${phase}-${attempt}`, CLACK_ACCEPTANCE_MODEL: modelId, CLACK_ACCEPTANCE_OLLAMA_URL: `${endpoint}/api/chat`, CLACK_ACCEPTANCE_URL: `${vite.resolvedUrls.local[0]}coworking-acceptance.html?configuration=${encodeURIComponent(`${local}/configuration`)}` });
  // Acceptance-host isolation only: the *previous* acceptance run established
  // a WebView2 crash (0xC0000005) in injected RTSSHooks64.dll. Prevent the
  // same graphics-overlay crash from contaminating this GLM-4.7-Flash acceptance,
  // without touching system RTSS settings or production Clack / Ollama.
  // Microsoft WebView2 reads this process-local environment variable when its
  // child browser process starts; only this fresh acceptance child inherits it.
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--disable-gpu --disable-gpu-compositing";
  if (reasoningChoice === "low") env.CLACK_ACCEPTANCE_EXPECTED_THINK = "low";
  if (process.env.CLACK_PRODUCT_EXPECT_NO_THINK === "1") {
    assert.equal(reasoningChoice, "none", "Disabled-thinking guard requires explicit None");
    env.CLACK_ACCEPTANCE_EXPECTED_THINK = "false";
  }
  if (process.env.CLACK_PRODUCT_EXPECT_AUTOMATIC === "1") {
    assert.equal(reasoningChoice, "automatic", "Provider-default guard requires Automatic");
    env.CLACK_ACCEPTANCE_EXPECTED_THINK = "omitted";
  }
  if (env.CLACK_ACCEPTANCE_EXPECTED_THINK)
    env.CLACK_ACCEPTANCE_WIRE_CONTRACT = JSON.stringify(wireContract);
  if (streamDiagnostic || (traceStreams && ["mission-a", "qualification"].includes(phase))) env.CLACK_ACCEPTANCE_RECEIVE_TRACE = "1";
  child = spawn(path.join(repository, "src-tauri/target/codex-test/debug/examples", `r5di_acceptance${process.platform === "win32" ? ".exe" : ""}`), [], { cwd: root, env, windowsHide: true });
  trustTimer = setInterval(() => { void captureTrust(); }, 650);
  child.once("exit", (code, signal) => { childExit = { pid: child.pid, code, signal, at: Date.now() }; });
  console.log(JSON.stringify({ event: "native-host-start", pid: child.pid, runnerPid: process.pid, at: Date.now(), boundMs: 90 * 60 * 1000 }));
  child.stdout.on("data", b => { nativeLog = (nativeLog + b).slice(-256 * 1024); });
  child.stderr.on("data", b => { nativeLog = (nativeLog + b).slice(-256 * 1024); });
  let timer;
  const result = await Promise.race([report, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Real product acceptance reached 90-minute bound")), 90 * 60 * 1000); }), new Promise((_, reject) => child.once("exit", code => reject(new Error(`Native host exited before report: ${code}`))))]).finally(() => clearTimeout(timer));
  await evidenceWrites;
  // Native report was persisted and ACKed on the actual /report HTTP path.
  const destinations = [...nativeLog.matchAll(/CLACK_ACCEPTANCE_INFERENCE ("[^"\r\n]+")/g)].map(m => JSON.parse(m[1]));
  const finalHealth = streamDiagnostic || traceStreams ? { ps: await metadataHealth("/api/ps"), version: await metadataHealth("/api/version") } : undefined;
  const finalModels = finalHealth ? finalHealth.ps.body : await (await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(5000) })).json();
  let requests = [];
  try { requests = (await readFile(`${output}.requests.jsonl`, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (toolProtocol) {
    assert.equal(requests.length, 1, "Tool protocol probe must send exactly one inference");
    const body = requests[0].body;
    assert.equal(body.model, modelId);
    assert.deepEqual(body.options, { num_ctx: 32768, num_predict: 2048 });
    if (result.reasoningControl?.effective === "unsupported-no-control")
      assert(!Object.hasOwn(body, "think"), "Unsupported reasoning control must be omitted");
    else if (reasoningChoice === "automatic")
      assert(!Object.hasOwn(body, "think"), "Automatic must preserve the provider default");
    else assert.equal(body.think, reasoningChoice === "low" ? "low" : false);
    assert.equal(body.stream, true);
    assert.deepEqual(body.tools.map(t => t.function.name), ["get_test_value"]);
  }
  if (streamDiagnostic) {
    assert.equal(requests.length, 1, "Diagnostic must send exactly one inference and never execute a tool loop");
    assert.deepEqual(requests[0].body, streamDiagnostic.body, "Diagnostic changed captured wire content");
  }
  const { assertRequestBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
  // Only bounded metadata goes on disk; NEVER persist model or tool text.
  const wireBudgets = requests.map(request => ({ at: request.at, requestId: request.requestId, modelMatches: request.modelMatches,
    numCtx: request.numCtx, numPredict: request.numPredict, toolSchemas: request.toolSchemas, stream: request.stream, thinkKind: request.thinkKind }));
  const sanitized = { phase, runId, startedAt, endedAt: Date.now(), rootOwned: true,
    calibrationGate: result.calibrationGate, missionStarted: result.missionStarted, correctionSent: result.correctionSent,
    sessions: result.sessions?.map(s => ({ id: s.id, runState: s.run?.state, budgetPhase: s.run?.budget?.phase })),
    conversations: result.conversations?.map(c => ({ id: c.id, messages: c.messages?.length, todos: c.todos?.map(t => ({ id: t.id, status: t.status })) })),
    cloudInference: result.cloudInference, resultOk: result.ok,
    failureStage: result.failureStage, failureCode: result.failureCode,
    failureOwner: result.failureOwner, failureClass: result.failureClass,
    lastDurableStage: result.lastDurableStage, nativeDispatchAttempted: result.nativeDispatchAttempted,
    wireBudgets, totalNativeDispatches: wireBudgets.length, nativeExit: childExit };
  await writeFile(`${output}.json`, JSON.stringify(sanitized, null, 2), { flag: "wx" });
  assert(result.ok, "Native IPC contract or Agent context gate did not complete successfully");
  if (phase === "ipc-contract") assert.equal(result.kind, "r5l-ipc-contract", "Expected exact IPC contract receipt");
  console.log(`PRESERVED ${phase}: ${destinations.length} native inference attempts; result ${output}.json`);
} catch (error) {
  await evidenceWrites.catch(() => {});
  await writeFile(`${output}.failure.json`, JSON.stringify({ errorKind: error?.name || "error", startedAt, endedAt: Date.now(), rootOwned: true, childExit }, null, 2), { flag: "wx" });
  throw error;
} finally {
  if (trustTimer) clearInterval(trustTimer);
  await captureTrust();
  if (child?.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill();
    if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
  }
  await vite?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  // Preserve this test's isolated app data and external project for restart and audit.
}
