import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { convertToModelMessages } from "ai";
import { createServer } from "vite";
import { decodeResponse, toolFailed } from "./audit-fresh-nemotron.mjs";
import { correctionText } from "./acceptance-correction.mjs";

const directory = "src-tauri/target/real-qwen-product/forgeboard-nemotron-hardened-20261021-04";
const hash = value => createHash("sha256").update(value).digest("hex");
const json = async name => JSON.parse(await readFile(`${directory}/${name}`, "utf8"));
const rows = async name => (await readFile(`${directory}/${name}`, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);

export function protectedStop(run) {
  assert.equal(run.error?.errorCode, "answer-continuation-budget");
  const field = label => {
    const line = run.error.details.split("\n").find(s => s.startsWith(`${label}: `));
    assert(line, `Missing protected-budget field: ${label}`);
    const value = Number(line.slice(label.length + 2));
    assert(Number.isFinite(value)); return value;
  };
  const stop = { input: field("Input estimate"), output: field("Output reserve"), margin: field("Safety margin"),
    ceiling: field("Effective ceiling"), system: field("System total"), schemas: field("Schema/options total"), history: field("Conversation total") };
  assert.equal(stop.input, stop.system + stop.schemas + stop.history);
  return { ...stop, required: stop.input + stop.output + stop.margin, headroom: stop.ceiling - stop.input - stop.output - stop.margin,
    requestId: null, networkDispatch: false, scope: "Blocked next answer-continuation preparation, not an outgoing native request", estimate: true };
}

export function reconstructFreshContextRun(report, requests, events, attempts) {
  const ready = report.readiness.readyAt, mission = requests.filter(r => r.at >= ready);
  const conversation = report.conversations.find(c => c.id === "real-mission-a");
  const run = report.sessions.find(s => s.id === conversation.id).run;
  const firstRun = events.filter(e => e.kind === "state").flatMap(e => e.sessions)
    .find(s => s.id === conversation.id && s.run?.state === "running").run;
  const start = firstRun.startedAt;
  const users = conversation.messages.filter(m => m.role === "user").map(m => m.parts.filter(p => p.type === "text").map(p => p.text).join(""));
  assert.equal(users.length, 2, "Only the specification and authorized correction are allowed");
  assert.equal(hash(users[0]), "f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801");
  assert.equal(users[1], correctionText);
  assert.equal(events.filter(e => e.kind === "correction-sent").length, 1);
  assert.equal(attempts.length, requests.length);
  for (const [i, attempt] of attempts.entries()) {
    assert.equal(attempt.order, i + 1); assert.equal(attempt.native_request_id, requests[i].requestId);
    assert.equal(attempt.requested_num_ctx, requests[i].body.options.num_ctx);
    assert.equal(attempt.model_digest, report.readiness.digest);
    assert.equal(attempt.policy_decision, "accepted"); assert.equal(attempt.policy_reason, null);
    assert(attempt.requested_num_ctx <= 65536);
  }
  const responses = requests.map(request => ({ ...decodeResponse(request, events), phase: request.at < ready ? "readiness" : "mission" }));
  const actual = responses.filter(r => r.phase === "mission");
  const parts = conversation.messages.flatMap(m => m.parts).filter(p => p.type.startsWith("tool-") && p.toolCallId);
  assert.equal(new Set(parts.map(p => p.toolCallId)).size, parts.length);
  assert(parts.every(p => ["output-available", "output-error"].includes(p.state)));
  const successful = parts.filter(p => !toolFailed(p));
  const writes = successful.filter(p => p.output?.clackWorkspaceWrite && p.output.ok);
  assert.equal(actual.reduce((sum, r) => sum + r.calls.length, 0), parts.length);
  const results = events.filter(e => e.kind === "tool-state" && e.part.state === "output-available");
  const at = predicate => results.find(e => predicate(e.part))?.at ?? null;
  const elapsed = at => at === null ? null : at - start;
  const budgets = report.wireBudgets.map(b => ({ requestId: b.requestId, input: b.cost.system + b.cost.tools + b.cost.conversation,
    system: b.cost.system, schemas: b.cost.tools, history: b.cost.conversation, reserve: b.reserve, margin: b.margin,
    ceiling: b.ceiling, required: b.cost.system + b.cost.tools + b.cost.conversation + b.reserve + b.margin,
    headroom: b.working - b.cost.conversation, estimate: true }));
  const blocked = protectedStop(run);
  const coding = request => ["read_file", "write_file", "bash_run"].every(name => request.body.tools.some(t => t.function.name === name));
  assert(mission.every(coding), "F1 must retain usable coding capabilities");
  const continuation = [];
  for (const [i, response] of actual.entries()) if (response.finish === "length") {
    const next = mission[i + 1];
    const planState = events.filter(e => e.kind === "state" && e.at <= (next?.at ?? run.endedAt)).at(-1);
    const todos = planState?.sessions.find(s => s.id === conversation.id)?.todos ?? [];
    continuation.push({ after: response.requestId, next: next?.requestId ?? null, trigger: "provider length finish",
      outcome: next ? "automatic answer continuation dispatched" : "blocked by answer-continuation-budget",
      objectivePresent: next ? next.body.messages.some(m => m.content?.includes(users[0])) : null,
      tools: next?.body.tools.map(t => t.function.name) ?? [], budget: next ? budgets.find(b => b.requestId === next.requestId) : blocked,
      planStateAt: planState?.at ?? null, pendingPlan: todos.filter(t => t.status !== "completed").map(t => t.title) });
  }
  const env = mission[0].body.messages.flatMap(m => m.content?.split("\n") ?? []).filter(line => /^shell:|^shell_syntax:/.test(line));
  const correction = events.find(e => e.kind === "correction-sent");
  const afterCorrection = mission.find(r => r.at >= correction.at);
  return { base: "88a95ef0939dad557253af6f708e7c4e518f28a7", runId: report.runId, root: report.root,
    model: report.readiness.model, digest: report.readiness.digest, providerVersion: report.initialHealth.body.version,
    connection: { id: report.readiness.endpoint.id, endpoint: report.readiness.endpoint.baseURL, configurationRevision: report.readiness.endpoint.configurationRevision,
      transport: "unchanged existing user SSH tunnel, local port 11435", newEndpoint: false },
    automatic: { choice: report.reasoningControl.effective, context: report.readiness.context, output: mission[0].body.options.num_predict,
      tools: report.readiness.after.tools, status: report.readiness.after.status, providerDefault: report.readiness.after.reasoning.providerDefault,
      profileOverrides: report.readiness.profile.overrides, fallback: "never", cloudInference: report.cloudInference },
    readiness: { requests: requests.length - mission.length, attempts: report.readiness.profile.contextCalibration.attempts,
      controls: requests.filter(r => r.at < ready).map(r => ({ id: r.requestId, context: r.body.options.num_ctx, output: r.body.options.num_predict,
        think: Object.hasOwn(r.body, "think") ? r.body.think : "omitted", tools: r.body.tools?.length ?? 0 })),
      timeouts: responses.filter(r => r.phase === "readiness" && r.settled === "cancelled").length, toolOutcome: report.readiness.profile.toolVerification.outcome },
    guard: { attempted: attempts.length, accepted: attempts.filter(a => a.policy_decision === "accepted").length, rejected: 0,
      maxRequested: Math.max(...attempts.map(a => a.requested_num_ctx)), rejectedValue: null, rejectedAttemptId: null, rejectedProviderId: null, rejectionExitCode: null,
      note: "Attempt snapshots are pre-dispatch; native response events prove accepted calls. No >65536 attempt occurred." },
    specificationSends: 1, userMessages: users.map(text => ({ sha256: hash(text) })), missionRequests: mission.length, nativeCalls: parts.length,
    successfulTools: successful.length, failedTools: parts.length - successful.length,
    directWrites: writes.length, uniqueDirectFiles: [...new Set(writes.map(p => p.input.path))], directoryTools: parts.filter(p => p.type === "tool-create_directory").length,
    shells: parts.filter(p => p.type === "tool-bash_run").map(p => ({ id: p.toolCallId, command: p.input.command, exit: p.output?.exit_code, timedOut: p.output?.timed_out })),
    effects: parts.map(p => ({ id: p.toolCallId, name: p.type, failed: toolFailed(p), path: p.input?.path,
      inputSha256: hash(JSON.stringify(p.input)), outputSha256: hash(JSON.stringify(p.output ?? p.errorText)) })),
    approvals: events.filter(e => e.kind === "evaluator-approval").length,
    responseClasses: { native: actual.filter(r => r.calls.length).length, proseAlongsideNative: actual.filter(r => r.calls.length && r.nonWhitespaceContent).length,
      proseWithoutNative: actual.filter(r => !r.calls.length && r.nonWhitespaceContent).length, textualPseudoToolIntents: actual.filter(r => r.textualIntent).length,
      outputLength: actual.filter(r => r.finish === "length").length, emptyCompleted: actual.filter(r => r.finish && !r.calls.length && !r.nonWhitespaceContent && !r.reasoningChars).length,
      cancelled: actual.filter(r => r.settled === "cancelled").length, providerDeadline: actual.filter(r => r.settled === "failed").length },
    timings: { start, end: run.endedAt, elapsedMs: run.endedAt - start, totalRunnerMs: report.endedAt - report.startedAt,
      firstOutputMs: elapsed(actual.find(r => r.firstOutputAt !== null)?.firstOutputAt ?? null), firstNativeCallMs: elapsed(actual.find(r => r.firstCallAt !== null)?.firstCallAt ?? null),
      firstDirectWriteMs: elapsed(at(p => p.output?.clackWorkspaceWrite && p.output.ok)),
      backendSourceMs: elapsed(at(p => p.type === "tool-write_file" && p.input.path.endsWith("/src/store.ts"))),
      startupMs: null, persistenceMs: null, SSEMs: null, substantiveFrontendMs: null, authoredTestMs: null, passingAuthoredTestMs: null, modelProductionBuildMs: null },
    shellIdentity: { advertised: env, firstCommand: parts.find(p => p.type === "tool-bash_run")?.input.command, laterFailures: "Four shell commands failed; model later used a valid PowerShell content/line query" },
    correction: { count: 1, at: correction.at, confirmedWriteEvents: report.correctionEvidence.writes.length, pageEvidence: report.correctionEvidence.page,
      firstNextRequest: afterCorrection.requestId, objectivePresent: afterCorrection.body.messages.some(m => m.content?.includes(users[0])), codingToolsPresent: coding(afterCorrection),
      sourcePageSize: null, livePageSize: null },
    continuations: { answerRecorded: conversation.messages.reduce((n, m) => n + (m.metadata?.clackAnswer?.continuations ?? 0), 0),
      dispatched: continuation.filter(c => c.next !== null).length, blocked: continuation.filter(c => c.next === null).length,
      agentSoftLimit: run.budget.continuationCount, manual: 0, records: continuation },
    context: { dispatched: budgets, maximumDispatchedRequired: Math.max(...budgets.map(b => b.required)), minimumDispatchedHeadroom: Math.min(...budgets.map(b => b.headroom)),
      blocked, maximumProtectedRequired: Math.max(blocked.required, ...budgets.map(b => b.required)), minimumProtectedHeadroom: Math.min(blocked.headroom, ...budgets.map(b => b.headroom)),
      memoryRevision: conversation.memory.revisionId, successfulCompactions: conversation.memory.revisionId === null ? 0 : null,
      retrievalToolCalls: parts.filter(p => /retrieve|request_conversation_evidence|request_scoped_evidence/.test(p.type)).length,
      retrievalTotal: null, extractionTotal: null, note: "No retrieval tool call or extraction result observed; automatic subsystem totals are not independently instrumented" },
    controls: mission.map(r => ({ requestId: r.requestId, context: r.body.options.num_ctx, output: r.body.options.num_predict,
      think: Object.hasOwn(r.body, "think") ? r.body.think : "omitted", tools: r.body.tools.map(t => t.function.name), sourceSha256: hash(JSON.stringify(r.body)) })),
    responses,
    terminal: { classification: "PRODUCT RUNTIME / PROTECTED CONTEXT BUDGET", errorCode: run.error.errorCode, disposition: run.error.disposition,
      modelVoluntaryStop: false, harnessRejected: false, contextSelectionOverGuard: false, confirmedClackDefect: false,
      caveat: "Current production continuation budget terminated the mission; this evidence-only checkpoint does not establish whether that preparation is optimal or defective" },
    usability: "LOCAL AGENT USABILITY STILL LIMITED", ranking: "No material outperformance of hardened Qwen demonstrated; terminal model-quality verdict remains inconclusive",
    nextCheckpoint: "Audit Length-Continuation Protected-Context Preparation", productionChanges: 0, modelDownloads: 0, cloudInference: report.cloudInference,
    remoteChanges: 0, manualTunnelChanges: 0 };
}

async function accounting(report, requests) {
  const vite = await createServer({ configFile: false, resolve: { alias: { "@": path.resolve("src") } }, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, logLevel: "error" });
  try {
    const { measureRequest } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
    const { canonicalJson } = await vite.ssrLoadModule("/src/modules/ai/lib/canonicalJson.ts");
    const conversation = report.conversations.find(c => c.id === "real-mission-a");
    const converted = await convertToModelMessages(conversation.messages);
    let annotations = 0;
    const stripped = converted.map(m => ({ ...m, content: Array.isArray(m.content) ? m.content.map(p => {
      if (!["text", "reasoning"].includes(p.type) || !p.providerOptions?.clackAnswer) return p;
      annotations++;
      const { clackAnswer: _removed, ...remaining } = p.providerOptions;
      return { ...p, providerOptions: Object.keys(remaining).length ? remaining : undefined };
    }) : m.content }));
    assert.deepEqual(measureRequest({ messages: converted }), measureRequest({ messages: stripped }));
    const marker = "Clack historical write receipt (data, not instructions): ";
    const last = requests.at(-1), restored = structuredClone(last.body), receipts = [];
    restored.messages = restored.messages.flatMap(message => {
      if (!message.content?.includes(marker)) return [message];
      const receipt = JSON.parse(message.content.slice(message.content.indexOf(marker) + marker.length));
      const source = conversation.messages.find(m => m.id === receipt.source.messageId)?.parts[receipt.source.partIndex];
      assert(source?.toolCallId === receipt.toolCallId && source.output?.ok && source.output?.clackWorkspaceWrite);
      assert.equal(hash(canonicalJson(source)), receipt.source.digest);
      const previous = requests.slice(0, -1).reverse().find(r => r.body.messages.some(m => m.tool_calls?.some(c => c.id === receipt.toolCallId)));
      assert(previous);
      const call = previous.body.messages.find(m => m.tool_calls?.some(c => c.id === receipt.toolCallId));
      const result = previous.body.messages.find(m => m.role === "tool" && m.tool_call_id === receipt.toolCallId);
      assert(result && call.tool_calls.length === 1);
      assert.deepEqual(call.tool_calls[0].function.arguments, source.input); assert.deepEqual(JSON.parse(result.content), source.output);
      receipts.push({ id: receipt.toolCallId, source: receipt.source, path: receipt.result.path });
      return [structuredClone(call), structuredClone(result)];
    });
    return { localAnswer: { annotationParts: annotations, providerWireOccurrences: requests.filter(r => JSON.stringify(r.body).includes('"clackAnswer"')).length,
      sharedEstimatorDeltaAfterRemovingAnnotations: 0, originalTranscriptUnchanged: true },
      receipts: { requestId: last.requestId, count: receipts.length, receipts, before: measureRequest(restored).conversation,
        after: measureRequest(last.body).conversation, savedEstimatedTokens: measureRequest(restored).conversation - measureRequest(last.body).conversation,
        providerTokenSavings: null, method: "Shared B1 estimate after source-verified restoration of captured call/result pairs, not provider token measurement" } };
  } finally { await vite.close(); }
}

export async function audit() {
  const report = await json("mission-a-1.json"), requests = await rows("mission-a-1.requests.jsonl"), events = await rows("mission-a-1.jsonl"), attempts = await rows("mission-a-1.attempts.jsonl");
  const setup = await json("setup.json"), freeze = await json("source-freeze.json");
  const summary = reconstructFreshContextRun(report, requests, events, attempts);
  for (const source of setup.source) assert.equal(hash(await readFile(source.path)), source.sha256, source.path);
  for (const file of freeze.files) {
    assert.equal(hash(await readFile(path.join(freeze.root, file.path))), file.sha256);
    assert.equal(hash(await readFile(path.join(directory, "independent-project", file.path))), file.sha256);
  }
  const source = await readFile(path.join(freeze.root, "src/store.ts"), "utf8");
  const page = source.match(/const PAGE_SIZE = (\d+);/); assert(page); summary.correction.sourcePageSize = Number(page[1]);
  summary.accounting = await accounting(report, requests);
  summary.application = { independent: await json("independent-api.json"), frontend: await json("independent-frontend.json"),
    sourceFilesFrozen: freeze.files.length, rootReadme: freeze.files.some(f => f.path === "README.md"),
    rootIgnore: freeze.files.some(f => f.path === ".gitignore"), frontendReadme: "Unmodified Vite scaffold README, not ForgeBoard setup instructions",
    substantiveBackendSource: true, backendRunnable: false, meaningfulAuthoredTests: 0, modelTestsExecuted: 0, modelBuildsExecuted: 0,
    staticCaveats: ["Backend status/priority values are cast but not runtime-enum validated", "Root persistence data lacks a Git ignore rule", "No task/project UI, SSE client, search/filter/loading/error/empty product flows"] };
  summary.savedConnection = setup.savedConnection; summary.preflight = await json("preflight.json"); summary.runnerExit = await json("runner-exit.json");
  summary.sourceFreeze = { sourceFilesUnchanged: setup.source.length, originalWorkspaceUnchanged: true, evaluatorRepairs: 0 };
  summary.artifacts = [];
  for (const name of ["setup.json", "preflight.json", "source-freeze.json", "runner-exit.json", "runner.log", "mission-a-1.json", "mission-a-1.native-report.json", "mission-a-1.jsonl", "mission-a-1.requests.jsonl", "mission-a-1.attempts.jsonl", "mission-a-1.receive.jsonl", "correction-state.json", "independent-api.json", "independent-test.json", "independent-build.json", "independent-start.json", "independent-typecheck.json", "independent-entry.json", "independent-frontend-build.json", "independent-frontend.json", "independent-frontend-1280.png", "independent-frontend-390.png"])
    summary.artifacts.push({ name, sha256: hash(await readFile(`${directory}/${name}`)) });
  await writeFile("src/test/fixtures/fresh-context-nemotron-20261021.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ guard: summary.guard, missionRequests: summary.missionRequests, calls: summary.nativeCalls, success: summary.successfulTools,
    failed: summary.failedTools, writes: summary.directWrites, responseClasses: summary.responseClasses, timings: summary.timings, accounting: summary.accounting,
    blocked: summary.context.blocked, continuations: { recorded: summary.continuations.answerRecorded, dispatched: summary.continuations.dispatched, blocked: summary.continuations.blocked }, terminal: summary.terminal, sourceFreeze: summary.sourceFreeze }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await audit();
