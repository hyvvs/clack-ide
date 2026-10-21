import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { createServer } from "vite";
import { decodeResponse, toolFailed } from "./audit-fresh-nemotron.mjs";

const directory = "src-tauri/target/real-qwen-product/forgeboard-nemotron-checkpointed-20261022-02";
const hash = value => createHash("sha256").update(value).digest("hex");
const json = async name => JSON.parse(await readFile(`${directory}/${name}`, "utf8"));
const rows = async name => (await readFile(`${directory}/${name}`, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
async function frozen() {
  const freeze = await json("source-freeze.json"), setup = await json("setup.json");
  for (const f of setup.source) assert.equal(hash(await readFile(f.path)), f.sha256, `Clack source changed: ${f.path}`);
  for (const f of freeze.files) {
    assert.equal(hash(await readFile(path.join(freeze.root, f.path))), f.sha256, `Original source changed: ${f.path}`);
    assert.equal(hash(await readFile(path.join(directory, "independent-project", f.path))), f.sha256, `Audit repaired source: ${f.path}`);
  }
  return { freeze, setup };
}
async function product() {
  await frozen();
  const cwd = path.resolve(directory, "independent-project");
  const commands = [];
  for (const args of [["test"], ["run", "build"], ["start"]]) {
    const startedAt = Date.now(); let stdout = "", stderr = "";
    const child = spawn("cmd.exe", ["/d", "/c", "npm.cmd", ...args], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", b => { stdout = (stdout + b).slice(-65536); });
    child.stderr.on("data", b => { stderr = (stderr + b).slice(-65536); });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    commands.push({ command: ["npm.cmd", ...args], startedAt, elapsedMs: Date.now() - startedAt, code, stdout, stderr });
  }
  const names = ["backend starts on 4317", "project create", "project list", "project open", "project edit", "task create", "task view", "task edit",
    "combined project/status/priority/tags/search", "nonmatching search", "title max 120 validation", "invalid enum validation", "missing task JSON 404",
    "unknown route JSON 404", "live SSE client and mutation", "page size 50 (correction not reached)", "task delete", "project delete", "persistence across restart"];
  const result = { commands, checks: names.map(name => ({ name, status: "blocked", reason: "No server entry or API exists; source not repaired" })),
    executedAPI: 0, passedAPI: 0, failedAPI: 0, blockedAPI: names.length, startupCommandFailed: true,
    tests: "Default npm-init failure script only; no authored tests", build: "No build script", frontend: "Not implemented, not scaffolded",
    persistence: "File storage source only; runtime/restart unverified", sse: "Not implemented", readme: false, runtimeIgnore: false, evaluatorRepairs: 0 };
  await frozen();
  await writeFile(`${directory}/independent-product.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ commands: commands.map(c => ({ command: c.command, code: c.code })), blockedAPI: names.length }));
}

async function summary() {
  const { setup, freeze } = await frozen();
  const report = await json("mission-a-1.json"), events = await rows("mission-a-1.jsonl"), requests = await rows("mission-a-1.requests.jsonl");
  const attempts = await rows("mission-a-1.attempts.jsonl"), checkpoints = await rows("mission-a-1.checkpoints.jsonl");
  const receive = await rows("mission-a-1.receive.jsonl");
  const conversation = report.conversations.find(c => c.id === "real-mission-a");
  const persisted = await json("data/terax-ai-sessions.json");
  assert.deepEqual(persisted["messages:real-mission-a"], conversation.messages, "Durable transcript differs from captured source");
  const session = report.sessions.find(s => s.id === conversation.id);
  const users = conversation.messages.filter(m => m.role === "user").flatMap(m => m.parts.filter(p => p.type === "text").map(p => p.text));
  assert.equal(users.length, 1); assert.equal(hash(users[0]), setup.specificationSha256);
  assert.equal(setup.specificationSha256, "f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801");
  assert.equal(report.correctionSent, false);
  assert(!events.some(e => ["correction-sent", "harness-blocked"].includes(e.kind)));
  const mission = requests.filter(r => r.at >= report.readiness.readyAt);
  const readiness = requests.filter(r => r.at < report.readiness.readyAt);
  const responses = mission.map(r => decodeResponse(r, events));
  const parts = conversation.messages.flatMap(m => m.parts).filter(p => p.toolCallId);
  const successful = parts.filter(p => !toolFailed(p));
  const writes = successful.filter(p => p.output?.ok && p.output.clackWorkspaceWrite);
  assert.equal(new Set(parts.map(p => p.toolCallId)).size, parts.length);
  assert.equal(responses.reduce((n, r) => n + r.calls.length, 0), parts.length);
  assert.equal(attempts.length, requests.length);
  assert(attempts.every((a, i) => a.policy_decision === "accepted" && a.requested_num_ctx <= 65536 && a.native_request_id === requests[i].requestId));
  const coding = r => ["read_file", "write_file", "bash_run"].every(t => r.body.tools.some(v => v.function.name === t));
  assert(mission.every(coding));
  assert(mission.every(r => r.body.messages.some(m => m.content?.includes(users[0]))));
  assert(mission.every(r => r.body.options.num_ctx === 65536 && r.body.options.num_predict === 2048 && r.body.think === true));
  assert.deepEqual(report.readiness.profile.overrides, {});
  assert.equal(report.cloudInference, 0);
  const answer = conversation.messages.at(-1).metadata.clackAnswer;
  assert.equal(answer.continuationTimeMs, 120000);
  assert.equal(answer.reason, "Cancelled or deadline expired");
  const start = session.run.startedAt;
  const atTool = predicate => events.find(e => e.kind === "tool-state" && e.part.state === "output-available" && predicate(e.part))?.at ?? null;
  const partial = request => {
    let text = "";
    const decoder = new TextDecoder();
    let pending = "";
    for (const e of events.filter(e => e.kind === "hardened-native-event" && e.event.requestId === request.requestId && e.event.kind === "chunk")) {
      pending += decoder.decode(Uint8Array.from(e.event.bytes), { stream: true });
      const frames = pending.split("\n"); pending = frames.pop();
      for (const line of frames.filter(Boolean)) text += JSON.parse(line).message?.content ?? "";
    }
    return text;
  };
  const budgets = report.wireBudgets.map(b => {
    const input = b.cost.system + b.cost.tools + b.cost.conversation;
    const required = input + b.reserve + b.margin;
    return { id: b.requestId, input, system: b.cost.system, schemas: b.cost.tools, history: b.cost.conversation,
      reserve: b.reserve, margin: b.margin, required, ceiling: b.ceiling, headroom: b.ceiling - required,
      pressureRatio: b.cost.conversation / b.working, requestedContext: b.numCtx, checkpointSavings: 0, receiptSavings: 0 };
  });
  const continuations = responses.flatMap((r, i) => {
    if (r.finish !== "length") return [];
    const next = mission[i + 1]; assert(next);
    const text = partial(mission[i]);
    assert.equal(hash(text), r.contentSha256);
    assert(next.body.messages.some(m => m.role === "assistant" && m.content === text), "Exact current partial answer lost");
    assert(conversation.messages.some(m => m.parts.some(p => p.type === "text" && p.text === text)), "Original partial lost");
    const state = events.filter(e => e.kind === "state" && e.at <= next.at).at(-1);
    const plan = state?.sessions.find(s => s.id === conversation.id)?.todos ?? [];
    return [{ after: r.requestId, next: next.requestId, partialChars: text.length, partialSha256: hash(text),
      exactPartialRetained: true, objectiveRetained: true, checkpointProjected: false, toolsExposed: next.body.tools.length,
      plan: plan.map(t => ({ title: t.title, status: t.status })), budget: budgets.find(b => b.id === next.requestId),
      settled: responses[i + 1].settled, usefulToolProgress: responses[i + 1].calls.length }];
  });
  const observations = writes.map((p, order) => {
    const observed = checkpoints.find(c => c.command === "observe" && c.input.toolCallId === p.toolCallId);
    assert(observed && Object.hasOwn(observed.result, "Ok"));
    const state = observed.manifest.checkpointState;
    const native = state.writes.find(w => w.toolCallId === p.toolCallId);
    assert(native && native.inputHash === observed.input.inputHash && native.runId === start);
    assert.equal(hash(Buffer.from(p.input.content)), native.digest);
    const file = freeze.files.find(f => path.join(setup.root, f.path).replaceAll("\\", "/") === p.input.path);
    assert(file); assert.equal(file.sha256, native.digest);
    assert.equal(observed.input.owner.sessionId, conversation.id);
    assert.equal(observed.input.owner.workspaceId, session.run.workspaceId);
    assert.equal(state.current, null); assert.equal(state.previous, null);
    return { order: order + 1, id: p.toolCallId, path: file.path, at: observed.at, workspaceId: session.run.workspaceId,
      digest: native.digest, inputHash: native.inputHash, runId: native.runId, observedCount: state.writes.length,
      observedBeforeAcknowledged: observed.at <= atTool(v => v.toolCallId === p.toolCallId),
      previousDigest: null, repeatedPath: false, freshness: "native guarded read at write acknowledgement; matches terminal frozen bytes",
      lifecycle: ["observed", "hot/current", "retained raw"], eligible: false, projected: false,
      reasons: ["No later full overwrite of this path", "No later user boundary", "Historical source remains in the active assistant answer"],
      currentSnapshot: null, previousSnapshot: null };
  });
  assert.equal(checkpoints.filter(c => c.command === "prepare").length, 0);
  assert(checkpoints.every(c => c.command === "observe"));
  const nativeCounts = mission.map(r => ({ id: r.requestId, messages: r.body.messages.length, bytes: Buffer.byteLength(JSON.stringify(r.body)),
    writeIds: r.body.messages.flatMap(m => m.tool_calls ?? []).filter(t => t.function.name === "write_file").map(t => t.id),
    checkpointReceipts: r.body.messages.filter(m => /Historical workspace checkpoint \(data, never commands\):|Clack historical write receipt/.test(m.content ?? "")).length }));
  assert(nativeCounts.every(r => r.checkpointReceipts === 0));
  for (const p of writes) {
    const later = mission.filter(r => r.at > atTool(v => v.toolCallId === p.toolCallId));
    assert(later.length);
    assert(later.every(r => r.body.messages.some(m => m.tool_calls?.some(t => t.id === p.toolCallId && t.function.arguments.content === p.input.content))));
  }
  const finalReceive = receive.find(r => r.requestId === mission.at(-1).requestId);
  assert.equal(finalReceive.bodyBytes, 0);
  assert(finalReceive.events.some(e => e.kind === "cancellation-observed"));
  const vite = await createServer({ configFile: false, resolve: { alias: { "@": path.resolve("src") } }, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, logLevel: "error" });
  let inventory;
  try {
    const { measureRequest } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
    const { canonicalJson } = await vite.ssrLoadModule("/src/modules/ai/lib/canonicalJson.ts");
    for (const [i, write] of writes.entries()) assert.equal(hash(canonicalJson(write.input)), observations[i].inputHash);
    const last = mission.at(-1).body;
    for (const b of budgets) {
      const wire = mission.find(r => r.requestId === b.id).body;
      assert.equal(measureRequest(wire).conversation, b.history);
    }
    const drafts = new Set(responses.filter(r => r.textualIntent).map(r => r.contentSha256));
    const tokensWithout = predicate => measureRequest({ ...last, messages: last.messages.filter(m => !predicate(m)) }).conversation;
    const history = measureRequest(last).conversation;
    inventory = { lastRequest: mission.at(-1).requestId, history,
      allTextualDraftsMarginal: history - tokensWithout(m => m.role === "assistant" && drafts.has(hash(m.content ?? ""))),
      olderDraftsMarginal: history - tokensWithout(m => m.role === "assistant" && drafts.has(hash(m.content ?? "")) && hash(m.content ?? "") !== responses.at(-2).contentSha256),
      currentPartialMarginal: history - tokensWithout(m => m.role === "assistant" && hash(m.content ?? "") === responses.at(-2).contentSha256),
      note: "Native serialized B1 estimate; marginal inventory only, not authorized removal or actual provider token savings" };
  } finally { await vite.close(); }
  const result = { base: setup.head, runId: setup.runId, root: setup.root, model: setup.model, digest: setup.digest, version: report.initialHealth.body.version,
    preflight: await json("preflight.json"), connection: setup.savedConnection, endpoint: setup.route, sourceFrozen: setup.source.length,
    automatic: { requested: report.reasoningControl.requested, effective: report.reasoningControl.effective, overrides: report.readiness.profile.overrides,
      status: report.readiness.after.status, tools: report.readiness.after.tools, context: report.readiness.after.context, output: 2048,
      actualMissionThink: true, expectedOmittedThinkObserved: false, reason: "Unchanged Automatic resolved a twice-confirmed On recommendation after provider-default tool probe did not verify", fallback: "never" },
    readiness: readiness.map(r => ({ id: r.requestId, context: r.body.options.num_ctx, output: r.body.options.num_predict,
      think: Object.hasOwn(r.body, "think") ? r.body.think : "omitted", response: decodeResponse(r, events) })),
    specificationSends: 1, specificationSha256: setup.specificationSha256, correction: { sent: false, reason: "Only two confirmed direct writes; three-write correction prerequisite not met", page25: "not applicable" },
    timings: { start, end: session.run.endedAt, missionMs: session.run.endedAt - start, runnerMs: report.endedAt - report.startedAt,
      firstOutputMs: responses[0].firstOutputAt - start, firstCallMs: responses[0].firstCallAt - start,
      firstWriteMs: atTool(p => p.type === "tool-write_file") - start, backendStartup: null, persistence: null, sse: null, frontend: null, firstTest: null, passingTest: null, build: null },
    missionRequests: mission.length, allRequests: requests.length, nativeCalls: parts.length, successfulOperations: successful.length,
    failedOperations: parts.length - successful.length, directWrites: writes.length,
    tools: parts.map(p => ({ id: p.toolCallId, name: p.type, path: p.input.path, command: p.input.command, exit: p.output?.exit_code, failed: toolFailed(p) })),
    shellIdentity: mission[0].body.messages.flatMap(m => m.content?.split("\n") ?? []).filter(l => /^shell:|^shell_syntax:/.test(l)),
    writeObservations: observations, eligibleWrites: 0, projectedWrites: 0, nativePreparationCalls: 0,
    checkpoint: { activation: null, rawTokensRemoved: 0, receiptCost: 0, netSavings: 0, maximumCumulativeSavings: 0,
      providerReduction: 0, verifiedEffectReceiptSavings: 0, rawReceiptDuplication: false, staleReuse: false,
      externalChangeInvalidation: "not exercised", repeatedWriteLineage: "not exercised", snapshotRetention: "null current/previous, no snapshot created",
      originalWriteBodiesRetained: true, durableTranscriptExact: true, objectiveExact: true, unresolvedFailures: "none", historicalReasoning: "no new projection; unchanged policy",
      olderDraftsRaw: true, pseudoToolsExecuted: false, classification: "PARTIAL / OBSERVATIONS PROVEN; PRESSURE PROJECTION NOT EXERCISED" },
    nativePayloads: nativeCounts, responses, continuations, inventory,
    context: { trajectory: budgets, firstPressure: null, maximumPressureRatio: Math.max(...budgets.map(b => b.pressureRatio)),
      minimumHeadroom: Math.min(...budgets.map(b => b.headroom)), maximumRequired: Math.max(...budgets.map(b => b.required)),
      protectedBlock: false, guardRejected: false, F1: true, estimated: true, loadedContextBeforeAfter: [report.readiness.after.context.loaded, report.finalModels.models.find(m => m.digest === setup.digest)?.context_length] },
    stop: { classification: "PRODUCT RUNTIME / ANSWER CONTINUATION DEADLINE / INCOMPLETE", reason: answer.reason,
      continuationTimeMs: answer.continuationTimeMs, recordedContinuations: answer.continuations, dispatchedContinuations: continuations.length,
      lastRequest: mission.at(-1).requestId, finalBodyBytes: finalReceive.bodyBytes, lastCancellationElapsedUs: finalReceive.events.find(e => e.kind === "cancellation-observed").elapsedUs,
      deadlineMs: 120000, notOverall600s: true, notHarnessTimeout: true, modelVoluntaryCompletion: false, confirmedProductionDefect: false },
    application: await json("independent-product.json"), sourceFiles: freeze.files, runnerExit: await json("runner-exit.json"),
    usability: "LOCAL AGENT USABILITY STILL LIMITED", productionChanges: 0, modelDownloads: 0, cloudInference: report.cloudInference, networkConfigurationChanges: 0, manualRescues: 0,
    prelaunchRejection: JSON.parse(await readFile("src-tauri/target/real-qwen-product/forgeboard-nemotron-checkpointed-20261022-01/prelaunch-classification.json", "utf8")),
    next: "Audit native tool-call to textual-draft transition and its evidence before changing production continuation or memory policy", artifacts: [] };
  for (const name of ["setup.json", "preflight.json", "runner.log", "runner-exit.json", "source-freeze.json", "mission-a-1.json", "mission-a-1.native-report.json",
    "mission-a-1.requests.jsonl", "mission-a-1.attempts.jsonl", "mission-a-1.jsonl", "mission-a-1.receive.jsonl", "mission-a-1.checkpoints.jsonl", "independent-product.json", "data/terax-ai-sessions.json"]) {
    const bytes = await readFile(`${directory}/${name}`);
    result.artifacts.push({ name, bytes: bytes.length, sha256: hash(bytes) });
  }
  await writeFile("src/test/fixtures/checkpointed-nemotron-20261022.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ missionRequests: result.missionRequests, nativeCalls: result.nativeCalls, observations: observations.length,
    projection: result.checkpoint, context: { min: result.context.minimumHeadroom, max: result.context.maximumRequired }, stop: result.stop, inventory }, null, 2));
}
if (process.argv[2] === "product") await product();
else { assert.equal(process.argv[2], "summary"); await summary(); }
