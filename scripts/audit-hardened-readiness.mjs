import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const hash = value => createHash("sha256").update(value).digest("hex");
const lines = text => text.trim().split("\n").filter(Boolean).map(JSON.parse);

export function reconstructReadiness(report, requests, evidence) {
  assert.equal(report.stage, "readiness");
  assert.equal(report.ok, false);
  assert.equal(report.sessions.length, 0, "A mission session would invalidate a readiness-only result");
  assert.equal(report.conversations.length, 0, "Do not hide a submitted specification");
  assert(!report.readiness && !report.missionStartedAt);
  assert(!evidence.some(e => e.kind === "mission-readiness"));
  const initial = evidence.find(e => e.kind === "readiness-start");
  assert(initial && requests.length);
  const profile = report.settings.profiles.find(p => p.transportModelId === initial.model);
  assert(profile && profile.modelRevision === initial.digest);
  const responses = requests.map(request => {
    assert.equal(request.body.model, initial.model, "No other model inference is authorized");
    assert.equal(request.url, "http://127.0.0.1:11435/api/chat");
    const observed = evidence.filter(e => e.kind === "hardened-native-event" && e.event.requestId === request.requestId);
    let pending = "", text = "", thinking = "", firstOutputAt = null, final;
    const calls = [], decoder = new TextDecoder();
    for (const event of observed) {
      if (event.event.kind !== "chunk") continue;
      pending += decoder.decode(Uint8Array.from(event.event.bytes), { stream: true });
      const frames = pending.split("\n"); pending = frames.pop();
      for (const raw of frames.filter(Boolean)) {
        const frame = JSON.parse(raw);
        text += frame.message?.content ?? "";
        thinking += frame.message?.thinking ?? "";
        if (frame.message?.content || frame.message?.thinking || frame.message?.tool_calls?.length) firstOutputAt ??= event.at;
        calls.push(...(frame.message?.tool_calls ?? []));
        if (frame.done) final = frame;
      }
    }
    assert(!pending.trim(), "Incomplete NDJSON is not a complete provider response");
    assert(!JSON.stringify(request.body.messages).includes("Build ForgeBoard from scratch"));
    return {
      requestId: request.requestId, at: request.at, kind: request.body.tools?.length ? "tool-verification" : "context-calibration",
      model: request.body.model, context: request.body.options.num_ctx, output: request.body.options.num_predict,
      think: Object.hasOwn(request.body, "think") ? request.body.think : "omitted",
      toolNames: request.body.tools?.map(t => t.function.name) ?? [],
      bodySha256: hash(JSON.stringify(request.body)), firstOutputAt,
      textChars: text.length, thinkingChars: thinking.length,
      textSha256: hash(text), thinkingSha256: hash(thinking),
      partialDsmlIntent: text.includes("<\uff5cDSML\uff5cfunction_calls>"),
      nativeCalls: calls.length, finish: final?.done_reason ?? null,
      inputTokens: final?.prompt_eval_count ?? null, outputTokens: final?.eval_count ?? null,
      settled: observed.findLast(e => e.event.kind === "settled")?.event.phase ?? null,
    };
  });
  assert.equal(report.destinations.length, requests.length);
  assert(report.destinations.every(url => url === "http://127.0.0.1:11435/api/chat"));
  const incomplete = profile.toolVerification?.status === "incomplete" && profile.toolVerification?.outcome === "output-length";
  return {
    runId: report.runId, root: report.root,
    model: initial.model, digest: initial.digest, version: report.initialHealth.body.version,
    connection: { endpoint: "http://127.0.0.1:11435", type: "existing user SSH tunnel / production direct self-hosted route", logicalEndpoint: "real-qwen", managedReconnect: false },
    automatic: { providerDefault: initial.before.reasoning.providerDefault, supported: initial.before.reasoning.capability.ollamaControls,
      recommendationBefore: initial.before.reasoning.recommended, verifiedAgentRecommendation: null,
      wireReasoning: [...new Set(responses.map(r => r.think))], overrides: profile.overrides,
      advertisedContext: initial.before.context.advertised, calibration: profile.contextCalibration,
      tools: profile.toolVerification, missionContext: null, missionOutput: null,
      finalLoaded: report.finalModels.models.filter(m => m.digest === initial.digest).map(m => ({ model: m.name, digest: m.digest, context: m.context_length })) },
    chronology: { startedAt: report.startedAt, readinessStartedAt: initial.at, endedAt: report.endedAt, elapsedMs: report.endedAt - report.startedAt },
    readinessRequests: responses.length,
    calibrationRequests: responses.filter(r => r.kind === "context-calibration").length,
    toolVerificationRequests: responses.filter(r => r.kind === "tool-verification").length,
    missionRequests: 0, specificationSubmissions: 0, corrections: 0, continuations: 0,
    nativeCalls: responses.reduce((n, r) => n + r.nativeCalls, 0), successfulTools: 0, failedTools: 0,
    partialTextualIntents: responses.filter(r => r.partialDsmlIntent).length,
    writes: 0, directories: 0, shells: 0, approvals: 0,
    application: { authoredFiles: 0, backendAudit: "NOT RUN - no implementation", persistence: "NOT IMPLEMENTED", sse: "NOT IMPLEMENTED",
      frontend: "NOT IMPLEMENTED", tests: "NOT IMPLEMENTED", build: "NOT IMPLEMENTED", readme: false, runtimeIgnore: false },
    context: { verified: profile.contextCalibration.highest, missionBudgets: [], minimumHeadroom: null,
      protectedBlock: false, deficit: null, receipts: 0, savings: 0, compactions: 0, retrievals: 0, extractions: 0 },
    f1: "NOT EXERCISED - no mission request or correction", recovery: "NOT EXERCISED - no tool execution",
    terminal: { classification: incomplete ? "PRODUCT READINESS / TOOL VERIFICATION INCOMPLETE / OUTPUT-LENGTH" : "PRODUCT READINESS / UNRESOLVED",
      error: report.error, missionOutcome: "NOT STARTED / AUTONOMOUS PRODUCT ACCEPTANCE INCONCLUSIVE",
      confirmedClackDefect: false, automaticRegressionEstablished: false, contextBlock: false, deadline: false, engineStall: false,
      boundary: "Complete provider length response, not transport termination. Partial tool-looking content is not a native call. Model/parser inner cause remains unproven." },
    usability: "LOCAL AGENT USABILITY STILL LIMITED - Automatic readiness blocked; task quality not evaluated",
    cloudInference: 0, modelDownloads: 0, remoteMutations: 0, manualRetries: 0, responses,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = path.resolve(process.argv[2]);
  assert.equal(path.basename(output), "forgeboard-nemotron-hardened-20261021-01");
  const report = JSON.parse(await readFile(path.join(output, "mission-a-1.json"), "utf8"));
  const setup = JSON.parse(await readFile(path.join(output, "setup.json"), "utf8"));
  const summary = reconstructReadiness(report,
    lines(await readFile(path.join(output, "mission-a-1.requests.jsonl"), "utf8")),
    lines(await readFile(path.join(output, "mission-a-1.jsonl"), "utf8")));
  for (const file of setup.source) assert.equal(hash(await readFile(file.path)), file.sha256, `Frozen source changed: ${file.path}`);
  assert.deepEqual(await readdir(setup.root), [".git"], "No application should have been authored during readiness");
  const failure = JSON.parse(await readFile(path.join(output, "mission-a-1.failure.json"), "utf8"));
  assert.equal(failure.childExit.code, 0, "Unexpected native host exit");
  const startLine = (await readFile(path.join(output, "runner.log"), "utf8")).split("\n").find(line => line.startsWith('{"event":"native-host-start"'));
  const nativeStart = JSON.parse(startLine);
  assert.equal(nativeStart.pid, failure.childExit.pid);
  summary.base = setup.head;
  summary.process = { runnerPid: nativeStart.runnerPid, runnerExit: 1, native: failure.childExit,
    explanation: "Runner asserts Ready and exits nonzero after preserving the production Incomplete report; native host returned its report and exited normally." };
  summary.sourceFreeze = { checkedFiles: setup.source.length, changedDuringRun: [], root: setup.root, authoredFiles: [],
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
  summary.artifacts = [];
  for (const name of ["setup.json", "mission-a-1.json", "mission-a-1.native-report.json", "mission-a-1.failure.json", "mission-a-1.jsonl", "mission-a-1.requests.jsonl", "mission-a-1.receive.jsonl", "runner.log"])
    summary.artifacts.push({ name, sha256: hash(await readFile(path.join(output, name))) });
  await writeFile("src/test/fixtures/hardened-nemotron-20261021.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ readiness: summary.readinessRequests, mission: summary.missionRequests, source: summary.sourceFreeze, terminal: summary.terminal }));
}
