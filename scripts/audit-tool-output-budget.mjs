import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const hash = s => createHash("sha256").update(s).digest("hex");
const json = async p => JSON.parse(await readFile(p, "utf8"));
const lines = async p => (await readFile(p, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
const baseline = "src-tauri/target/real-qwen-product/forgeboard-nemotron-hardened-20261021-01/mission-a-1";
const liveRoot = "src-tauri/target/real-qwen-product/reasoning-aware-tool-readiness-20261021-01/";
const differentialRoot = "src-tauri/target/reasoning-tool-readiness-20261021-01/";
const live = liveRoot + "mission-a-1";
const prior = (await lines(baseline + ".requests.jsonl")).find(r => r.requestId === "inference-7");
const requests = await lines(live + ".requests.jsonl");
const differential = await json(differentialRoot + "differential.json");
const report = await json(live + ".json");
assert(report.ok && report.readinessOnly && !report.sessions.length && !report.conversations.length);
assert.equal(report.readiness.after.tools, "Verified");
assert.equal(report.readiness.after.status, "Ready");
assert.equal(requests.length, 7);
assert(requests.every(r => r.body.model === prior.body.model && r.url === prior.url));
assert.deepEqual(requests[6].body, prior.body);
assert.equal(differential.results.length, 1);
const direct = await json(differentialRoot + "1024.request.json");
direct.body.options.num_predict = 512;
assert.deepEqual(direct.body, prior.body);
async function response(prefix, requestId) {
  const events = (await lines(prefix + ".jsonl")).filter(e => e.kind === "hardened-native-event" && e.event.requestId === requestId);
  const decoder = new TextDecoder(); let text = "";
  for (const event of events) if (event.event.kind === "chunk") text += decoder.decode(Uint8Array.from(event.event.bytes), { stream: true });
  const frames = text.trim().split("\n").map(JSON.parse);
  assert(frames[frames.length - 1].done);
  const calls = frames.flatMap(f => f.message?.tool_calls ?? []);
  return { frames: frames.length, reasoningFrames: frames.filter(f => f.message?.thinking).length,
    contentFrames: frames.filter(f => f.message?.content).length, calls,
    reasoningChars: frames.map(f => f.message?.thinking ?? "").join("").length,
    contentChars: frames.map(f => f.message?.content ?? "").join("").length,
    final: frames[frames.length - 1],
    lastNonemptyField: frames.slice().reverse().find(f => f.message?.content || f.message?.thinking)?.message.content ? "content" : "thinking" };
}
const oldResponse = await response(baseline, "inference-7"), newResponse = await response(live, "inference-7");
assert.equal(oldResponse.final.eval_count, 512);
assert.equal(oldResponse.final.done_reason, "length");
assert.equal(oldResponse.calls.length, 0);
assert.equal(newResponse.calls.length, 1);
assert.deepEqual(newResponse.calls[0].function.arguments, { key: "clack-probe-v1", count: 1 });
const setup = await json(liveRoot + "setup.json");
const changed = [];
for (const file of setup.source) {
  const after = hash(await readFile(file.path));
  if (after !== file.sha256) changed.push({ ...file, after });
}
assert.deepEqual(changed.map(f => f.path).sort(), ["src-tauri/src/modules/self_hosted_profiles.rs", "src/modules/ai/lib/toolVerificationSchema.ts"]);
const summary = {
  base: setup.head, model: prior.body.model, digest: differential.digest, providerVersion: report.initialHealth.body.version,
  exactBaselineRequest: prior, baselineResponse: oldResponse, differential: differential.results,
  production: { requests: requests.length, calibrationRequests: 6, toolRequests: 1, outputs: [512], think: "omitted",
    context: report.readiness.context, effective: report.readiness.effective,
    tools: report.readiness.after.tools, readiness: report.readiness.after.status, record: report.readiness.profile.toolVerification,
    response: newResponse, startedAt: report.startedAt, readyAt: report.readiness.readyAt, endedAt: report.endedAt,
    same512RequestBody: true, executedTools: 0, sessions: report.sessions, conversations: report.conversations },
  controls: { initial: 512, ladder: [512, 1024, 2048], maxRequests: 5, deadlineMs: 120000, trigger: "normalized length without a native verdict" },
  newInference: { total: 8, differential: 1, contextRevalidation: 6, productionTools: 1, otherModels: 0, cloud: 0, downloads: 0, forgeboard: 0 },
  classification: "REASONING-AWARE TOOL READINESS READY",
  limitations: ["Live production passed at 512; no live escalated native PASS is claimed.",
    "Same 512 body has both length/no-call and native PASS evidence. No deterministic per-model output threshold is established.",
    "No separate hidden-reasoning token counter exists in this evidence.",
    "Native allowance/attempt validation and matching TS outcome refinement were completed after live Ready; focused persistence tests validate all supported allowances, without more inference."],
  postLiveValidationChanges: changed,
  artifacts: [],
};
for (const file of [baseline + ".requests.jsonl", baseline + ".jsonl", differentialRoot + "1024.request.json", differentialRoot + "1024.response.ndjson",
  differentialRoot + "differential.json", live + ".json", live + ".requests.jsonl", live + ".jsonl", live + ".receive.jsonl", liveRoot + "setup.json"])
  summary.artifacts.push({ path: file, sha256: hash(await readFile(file)) });
await writeFile("src/test/fixtures/reasoning-tool-readiness-20261021.json", JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ productionReady: summary.production.readiness, totalNewInference: 8, oldOutput: 512,
  differential: summary.differential.map(r => ({ output: r.output, tokens: r.outputTokens, finish: r.finish, native: r.calls.length })),
  nativeOutputTokens: newResponse.final.eval_count, changedAfterLive: changed.map(f => f.path) }));
