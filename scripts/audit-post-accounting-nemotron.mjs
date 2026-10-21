import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { decodeResponse } from "./audit-fresh-nemotron.mjs";

const directory = "src-tauri/target/real-qwen-product/forgeboard-nemotron-hardened-20261021-03";
const hash = value => createHash("sha256").update(value).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const rows = async file => (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);

export function classifyReadinessAbort({ requests, events, failure, calibration }) {
  assert.equal(failure.childExit.code, 3221226505);
  assert.match(failure.nativeLog, /hardened_agent_acceptance\.rs:247:29/);
  assert.match(failure.nativeLog, /num_ctx.*is_some_and\(\|n\| n <= 65536\)/);
  assert.match(failure.nativeLog, /panic in a function that cannot unwind/);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body.options, { num_ctx: 4096, num_predict: 32 });
  assert.deepEqual(requests[0].body.messages, [{ content: "Reply with OK.", role: "user" }]);
  assert(!events.some(e => ["mission-readiness", "state", "tool-state", "correction-sent"].includes(e.kind)));
  assert.equal(calibration.highest, null);
  assert.equal(calibration.attempts.length, 1);
  assert.equal(calibration.attempts[0].outcome, "timeout");
  const intercepted = (failure.nativeLog.match(/CLACK_ACCEPTANCE_INFERENCE /g) ?? []).length;
  assert.equal(intercepted, 2);
  return { classification: "TEST_HARNESS / PREMISSION ABORT / INCONCLUSIVE", completion: "CLACK-BLOCKED / ACCEPTANCE HARNESS",
    specificationSends: 0, missionRequests: 0, nativeMissionCalls: 0, sourceMutations: 0,
    providerReadinessRequests: requests.length, interceptedRequests: intercepted,
    rejectedSecondRequest: { forwarded: false, captured: false, exactBody: null,
      reason: "Context assertion failed before audit append and native handler dispatch; missing, invalid or over-limit num_ctx cannot be distinguished from the log" },
    coldReadinessTimeoutMs: calibration.attempts[0].latencyMs,
    modelQualityVerdict: "Not evaluated; no ForgeBoard task was sent", confirmedProductionDefect: false };
}

export async function audit() {
  const setup = await json(directory + "/setup.json");
  const failure = await json(directory + "/mission-a-1.failure.json");
  const requests = await rows(directory + "/mission-a-1.requests.jsonl");
  const events = await rows(directory + "/mission-a-1.jsonl");
  const state = (await json(directory + "/data/terax-settings.json")).selfHostedInference;
  const profile = state.profiles.find(p => p.transportModelId === setup.model);
  assert.equal(profile.modelRevision, setup.digest);
  assert.equal(profile.contextCalibration.scope.providerVersion, "0.40.5");
  for (const source of setup.source) assert.equal(hash(await readFile(source.path)), source.sha256, source.path);
  assert.deepEqual(await readdir(setup.root), [".git"]);
  const gitStatus = execFileSync("git", ["status", "--short"], { cwd: setup.root, encoding: "utf8" });
  assert.equal(gitStatus, "");
  const freeze = { root: setup.root, files: [], gitStatus, sourceUnchanged: setup.source.length, missionStarted: false,
    note: "Empty Git workspace preserved. No product audit or dependency install: specification never dispatched." };
  try { await writeFile(directory + "/source-freeze.json", JSON.stringify(freeze, null, 2), { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; assert.deepEqual(await json(directory + "/source-freeze.json"), freeze); }
  const summary = { base: setup.head, runId: setup.runId, root: setup.root, model: setup.model, digest: setup.digest,
    route: setup.route, providerVersion: profile.contextCalibration.scope.providerVersion,
    ...classifyReadinessAbort({ requests, events, failure, calibration: profile.contextCalibration }),
    runner: { startedAt: failure.startedAt, endedAt: failure.endedAt, elapsedMs: failure.endedAt - failure.startedAt,
      hostExit: failure.childExit, hostExitHex: "0xC0000409", panic: failure.nativeLog.split("\n").filter(line => /panicked at|assertion failed:|cannot unwind|aborting/.test(line)) },
    readiness: { calibration: profile.contextCalibration, toolVerification: profile.toolVerification,
      overrides: profile.overrides, recommendations: profile.recommendations, ready: false },
    request: { ...requests[0], response: decodeResponse(requests[0], events) },
    productAudit: { performed: false, executed: 0, passed: null, failed: null, blocked: null,
      reason: "No product implementation: premission native harness abort; not a 0/19 model score" },
    configuration: { selectedReasoning: "automatic", firstProbeThink: Object.hasOwn(requests[0].body, "think") ? requests[0].body.think : "omitted",
      missionContext: null, loadedContext: null, missionOutput: null, fallback: "never", cloudInference: 0, downloads: 0 },
    accounting: { missionObserved: false, maximumRequired: null, minimumHeadroom: null, excludedAnnotations: null,
      excludedEstimatedTokens: null, receiptSavings: null, compactions: 0, retrievals: 0, extractions: 0,
      note: "Offline f662fb5 regression passed; no long-session live accounting evidence was produced" },
    freeze, artifacts: [], nextRecommendation: "Repair acceptance-host fail-closed diagnostics for readiness requests before separately authorizing a fresh mission; do not tune production readiness or model settings" };
  for (const name of ["setup.json", "mission-a-1.failure.json", "mission-a-1.jsonl", "mission-a-1.requests.jsonl", "mission-a-1.receive.jsonl", "runner.log", "source-freeze.json", "data/terax-settings.json"])
    summary.artifacts.push({ name, sha256: hash(await readFile(path.join(directory, name))) });
  await writeFile("src/test/fixtures/post-accounting-nemotron-20261021.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ classification: summary.classification, durationMs: summary.runner.elapsedMs,
    readinessRequests: summary.providerReadinessRequests, specSends: summary.specificationSends, missionRequests: summary.missionRequests,
    hostExit: summary.runner.hostExitHex, sourceUnchanged: setup.source.length, artifacts: summary.artifacts.length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await audit();
