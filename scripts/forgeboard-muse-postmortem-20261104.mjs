/** Read-only postmortem of the ONE ForgeBoard Muse mission and ONE frozen eval.
 * Writes only new, task-owned derived evidence; never invokes models or Agent. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const run = "forgeboardmuse-20261104-01";
const owned = path.join(repo, "src-tauri/target/real-qwen-product", run);
const csv = path.join(repo, "docs/FORGEBOARD_MUSE_NATIVE_REQUESTS_2026-11-04.csv");
const outfile = path.join(owned, "postmortem-audit.json");
const json = name => readFile(path.join(owned, name), "utf8").then(JSON.parse);
const jsonl = async name => (await readFile(path.join(owned, name), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const hash = b => createHash("sha256").update(b).digest("hex");
const [runner, report, evalReceipt, requests, receive, events, parser, trust, correction] = await Promise.all([
  json("mission-a-1.json"), json("mission-a-1.native-report.json"), json("independent-evaluation.json"),
  jsonl("mission-a-1.requests.jsonl"), jsonl("mission-a-1.receive.jsonl"), jsonl("mission-a-1.jsonl"),
  json("mission-a-1.parser-final.json"), jsonl("mission-a-1.trust-timeline.jsonl"), json("correction-state.json"),
]);
assert.equal(runner.runId, run);
assert.equal(runner.nativeExit?.code, 0);
assert.equal(runner.missionStarted, true);
assert.equal(runner.cloudInference, 0);
assert.equal(requests.length, 25);
assert.equal(receive.length, 25);
assert(requests.every(r => r.modelMatches === true && r.thinkKind === "absent"));
assert.equal(requests.filter(r => r.numPredict === 32 && r.toolSchemas === 0).length, 7);
assert.equal(requests.filter(r => r.numPredict === 512 && r.toolSchemas === 1).length, 2);
assert.equal(requests.filter(r => r.agentBatch === "initial-batch").length, 16);
assert.equal(requests.filter(r => r.agentBatch === "logical-continuation").length, 0);
assert.equal(receive.filter(r => r.httpStatus === 200 && !r.failureCode && r.lastRequestStage === "eof").length, 24);
assert.equal(receive.filter(r => r.failureCode === "stream-idle-timeout").length, 1);
const timeout = receive.find(r => r.requestId === "inference-25");
assert.equal(timeout.httpStatus, 200);
assert.equal(timeout.bodyChunks, 3);
assert.equal(timeout.bodyBytes, 449);
assert.equal(timeout.lastRequestStage, "first-body-chunk");
const chunk = timeout.events.findLast(e => e.kind === "body");
const deadline = timeout.events.find(e => e.kind === "deadline-observed");
const header = timeout.events.find(e => e.kind === "headers");
assert(header && chunk && deadline);
const tools = events.find(e => e.kind === "agent-native-tool-summary")?.toolSummary;
assert.equal(tools?.calls, 15);
assert.deepEqual(Object.fromEntries(tools.byName.map(x => [x.name, x.count])),
  { list_directory: 1, todo_write: 1, create_directory: 4, write_file: 9 });
assert(tools.byName.every(x => x.states.every(s => s === "output-available")));
assert.equal(correction.status, "pending");
assert.equal(correction.boundary, undefined);
assert.equal(correction.writes.length, 9);
assert.equal(runner.correctionSent, false);
assert.equal(parser.failureCount, 2);
assert.deepEqual([...parser.stages].sort(), ["completion-scanner", "native-adapter"]);
assert.equal(evalReceipt.verdict, "FORGEBOARD_FAIL");
assert.equal(evalReceipt.frozen.length, 7);
assert.equal(evalReceipt.commands["backend:install"].exit, 0);
assert.equal(evalReceipt.commands["backend:build"].exit, 2);
assert.equal(evalReceipt.commands["backend:test"].exit, 1);
assert.equal(evalReceipt.checks.authoredTests, false);
assert.equal(evalReceipt.checks.backendStarts, false);
assert.equal(evalReceipt.checks.stackReact, false);
const calibration = trust.findLast(x => x.calibration?.status === "verified")?.calibration;
assert.equal(calibration?.highest, 73728);
assert.equal(calibration?.attempts.length, 7);
assert.equal(new Set(trust.map(x => x.calibration?.id).filter(Boolean)).size, 1);
const proofs = trust.findLast(x => x.proofs?.length >= 2)?.proofs;
assert(proofs?.some(x => x.context === 73728 && x.status === "verified"));
assert(proofs?.some(x => x.context === 32768 && x.status === "verified"));
assert.equal(new Set(trust.map(x => x.calibration?.runtimeEpoch).filter(Boolean)).size, 1);
const journalFile = path.join(owned, "request25-system-ollama-journal.txt");
const journalBuffer = await readFile(journalFile);
const journal = journalBuffer.toString("utf8");
assert.equal(hash(journalBuffer), "1ab79fea10e3b38d9d675061b4c251b94413d789fba7205e9e9c771166996b07");
assert(/task 4252 \| n_gen\s*=\s*1724/.test(journal));
assert(/tg\s*=\s*9\.56 t\/s/.test(journal));
assert(/POST\s+"\/api\/chat"/.test(journal));
const allFrozen = [];
for (const f of evalReceipt.frozen) {
  const a = await readFile(path.join(owned, "workspace", f.file));
  const b = await readFile(path.join(owned, "evaluation-snapshot", f.file));
  assert.equal(hash(a), f.sha256, `Original source changed since freeze: ${f.file}`);
  assert.equal(hash(b), f.sha256, `Evaluator freeze changed: ${f.file}`);
  allFrozen.push({ file: f.file, sha256: f.sha256 });
}
const summary = {
  runId: run, startingHead: "74ed1fd61906f93b199bbdfa27feda380d78d467",
  model: "muse-glimmer:30b", digest: "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1",
  provider: "ollama-0.40.11", totalNative: requests.length, nativeCompleted: 24, nativeTimedOut: 1,
  initialCalibrations: 7, nativeToolVerifiers: 2, agentGenerations: 16, logicalContinuations: 0, renewalCount: 0,
  selectedAgentContext: 32768, output: 8192, calibratedHighest: calibration.highest,
  calibration: { id: calibration.id, expiresAt: calibration.expiresAt, runtimeEpoch: calibration.runtimeEpoch },
  selectedToolProof: proofs.find(x => x.context === 32768),
  tools: tools.byName.map(({ name, count }) => ({ name, count })), totalToolCalls: tools.calls,
  correction: { status: correction.status, eligible: !!correction.boundary, confirmedWrites: correction.writes.length, sent: runner.correctionSent },
  terminal: { hostExit: runner.nativeExit, agentRunState: "failed", inferenceError: "stream-idle-timeout" },
  timeout: { requestId: timeout.requestId, httpStatus: timeout.httpStatus, lastRequestStage: timeout.lastRequestStage,
    headersMs: Math.round(header.elapsedUs / 1000), lastBodyMs: Math.round(chunk.elapsedUs / 1000),
    deadlineMs: Math.round(deadline.elapsedUs / 1000), postLastBodyIdleMs: Math.round((deadline.elapsedUs - chunk.elapsedUs) / 1000),
    bodyChunks: timeout.bodyChunks, bodyBytes: timeout.bodyBytes, providerDone: false, eof: false,
    providerLogTask: 4252, providerLogLastGeneratedTokens: 1724, providerLogTokenRate: 9.56,
    providerJournalSha256: hash(journalBuffer), providerLogErrors: 0 },
  parserFailureObservations: parser,
  evaluation: { verdict: evalReceipt.verdict, authoredFiles: allFrozen, checks: evalReceipt.checks,
    buildExit: evalReceipt.commands["backend:build"].exit, testExit: evalReceipt.commands["backend:test"].exit,
    installExit: evalReceipt.commands["backend:install"].exit,
    evaluationSha256: hash(await readFile(path.join(owned, "independent-evaluation.json"))) },
  limitations: [
    "Ollama runner timestamps are from read-only system journald; no independent synchronized remote perf sampler was started.",
    "The remote runner made internal token progress but Clack received no further HTTP body chunks for 180 seconds; causal buffering layer is not established.",
    "One frozen evaluator checked incomplete application; absence of runtime routes prevented CRUD/SSE/frontend/accessibility functional evaluation.",
  ],
};
const esc = s => `"${String(s ?? "").replaceAll('"', '""')}"`;
const head = ["requestId", "agentBatch", "context", "output", "toolSchemas", "httpStatus", "lastRequestStage", "failureCode", "headersMs", "eofOrDeadlineMs", "bodyChunks", "bodyBytes", "providerDone", "eof"];
const rows = requests.map(req => {
  const obs = receive.find(r => r.requestId === req.requestId);
  assert(obs, `Missing native receipt ${req.requestId}`);
  const at = kind => obs.events?.find(e => e.kind === kind)?.elapsedUs;
  const end = obs.events?.findLast(e => ["eof", "deadline-observed"].includes(e.kind))?.elapsedUs;
  return [req.requestId, req.agentBatch, req.numCtx, req.numPredict, req.toolSchemas, obs.httpStatus, obs.lastRequestStage,
    obs.failureCode ?? "", Math.round((at("headers") ?? 0) / 1000), Math.round((end ?? 0) / 1000), obs.bodyChunks ?? 0,
    obs.bodyBytes ?? 0, !!obs.events?.some(e => e.kind === "provider-done"), !!obs.events?.some(e => e.kind === "eof")];
});
await writeFile(csv, [head, ...rows].map(row => row.map(esc).join(",")).join("\n") + "\n", { flag: "wx" });
await writeFile(outfile, JSON.stringify(summary, null, 2), { flag: "wx" });
console.log(JSON.stringify({ runId: run, auditFile: outfile, csvFile: csv,
  requestRows: rows.length, timedOut: summary.timeout, evaluation: summary.evaluation.verdict,
  csvSha256: hash(await readFile(csv)), auditSha256: hash(await readFile(outfile)) }, null, 2));
