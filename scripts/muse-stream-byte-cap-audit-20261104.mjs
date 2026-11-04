/** Supplemental OFFLINE analysis of the stopped diagnostic relay connection cap.
 * This never sends HTTP requests, changes Clack/Ollama or replays inference.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = fileURLToPath(new URL("../", import.meta.url));
const root = path.join(repo, "src-tauri/target/real-qwen-product/musestreambyte-20261104-01");
const bytes = await readFile(path.join(root, "remote-evidence/relay-bytes.jsonl"));
const rows = bytes.toString("utf8").trim().split(/\r?\n/).map(JSON.parse);
const source = await readFile(path.join(repo, "scripts/muse-stream-byte-relay-20261104.py"), "utf8");
const audit = JSON.parse(await readFile(path.join(root, "byte-boundary-audit.json"), "utf8"));
const native = audit.nativeContextAttempts;
const sha = b => createHash("sha256").update(b).digest("hex");
assert.equal(sha(bytes), "05d5c58adb3d7524ba28c094efcc11b4c9791d9a405902d91a270497f45ed6e7");
assert(source.includes("MAX_CONNECTIONS = 48"));
assert.equal(audit.calibration.status, "incomplete");
assert.equal(audit.targetSent, false);
assert.equal(native.length, 5);
const rejected = rows.filter(e => e.event === "rejected");
assert.deepEqual(rejected.map(e => e.connection), [49, 50, 51, 52]);
const accepted = rows.filter(e => e.event === "accepted");
assert.equal(accepted.length, 48);
const socketErrors = rows.filter(e => e.event === "socket-error" || e.event === "upstream-error");
assert.equal(socketErrors.length, 0);
const target= native.at(-1);
assert.equal(target.requestId,"inference-5");
assert.equal(target.context,49152);
const done = target.dispatchedUtcMs + target.doneMs;
const eof = target.dispatchedUtcMs + target.eofMs;
const diagnosticEnded = JSON.parse(await readFile(path.join(root,"stream-diagnostic-1.native-report.json"),"utf8")).endedAt;
const rejects = rejected.map(e=>({connection:e.connection,utcMs:Number(e.utc_ns)/1e6,
  afterNativeProviderDoneMs:Math.round(Number(e.utc_ns)/1e6-done),
  afterNativeEofMs:Math.round(Number(e.utc_ns)/1e6-eof),
  beforeCalibrationGateEndedMs:Math.round(diagnosticEnded-Number(e.utc_ns)/1e6)}));
assert(rejects.every(e=>e.afterNativeEofMs>0 && e.beforeCalibrationGateEndedMs>0));
const acceptedCalibrations = audit.relay.mappings.map(mapping => {
  assert(mapping.unambiguous === true);
  const connection = audit.relay.connectionSummaries.find(c=>c.id===mapping.nearest.id);
  assert(connection);
  const downstream = connection.directions["ollama-to-client"];
  const upstream = connection.directions["client-to-ollama"];
  assert(downstream.forwardMatchesReads && upstream.forwardMatchesReads);
  return {
    inference: mapping.requestId, relayConnection: connection.id,
    requestReadBytes: upstream.readBytes, requestForwardedBytes: upstream.forwardedBytes,
    responseReadBytes: downstream.readBytes, responseForwardedBytes: downstream.forwardedBytes,
    largestOllamaToRelayReadGapMs: downstream.maxReadGapMs,
    largestRelayToClackForwardGapMs: downstream.maxForwardGapMs,
    firstResponseReadUtcMs: downstream.firstReadUtcMs,
    lastResponseReadUtcMs: downstream.lastReadUtcMs,
    firstResponseForwardUtcMs: downstream.firstForwardUtcMs,
    lastResponseForwardUtcMs: downstream.lastForwardUtcMs,
    socketErrors: connection.errors,
  };
});
const max = x=>Math.max(...x);
const report = {
  kind:"diagnostic-instrumentation-limit", runId:"musestreambyte-20261104-01",
  relayCap:48,acceptedConnections:48,rejectedConnections:4, socketErrors:0,
  rejectedRequests:rejects,
  fifthInference:{requestId:target.requestId,context:49152,output:32,
    nativeHTTP:target.httpStatus,nativeProviderDoneUtcMs:done,nativeEOFUtcMs:eof,
    nativeBodyReads:target.bodyChunks,nativeBodyBytes:target.bodyBytes,
    postInferenceCalibrationOutcome:"transient",persistedFailure:"offline",gateEndedUtcMs:diagnosticEnded},
  calibratedConnections:acceptedCalibrations,
  largestCalibrationOllamaToRelayReadGapMs:max(acceptedCalibrations.map(e=>e.largestOllamaToRelayReadGapMs)),
  largestCalibrationRelayToClackForwardGapMs:max(acceptedCalibrations.map(e=>e.largestRelayToClackForwardGapMs)),
  largestCalibrationNativeBodyReadGapMs:max(native.map(e=>e.bodyMaxInterReadGapMs)),
  relayBytesSHA256:sha(bytes),
  conclusion:"The task-owned MAX_CONNECTIONS=48 relay itself rejected four post-inference metadata TCP connections before the qualification gate closed. The 49152 model inference had completed with HTTP 200, provider done and EOF. These rejections explain the metadata offline outcome without implicating the runner. No long target dispatched; do not classify the historical stall or rerun.",
  limitations:["Routed HTTP request method/path not decoded by byte-transparent relay, so rejected connection purpose is inferred from timing and normal calibration metadata sequence, not payload inspection.",
    "Relay and native clocks are different hosts: cross-host UTC alignment is approximate, while each individual read/forward interval is monotonic on its own host."]
};
await writeFile(path.join(root,"relay-cap-supplement.json"),JSON.stringify(report,null,2),{flag:"wx"});
console.log(JSON.stringify({rejected:rejects,calibrated:acceptedCalibrations,
  largestCalibrationOllamaToRelayReadGapMs:report.largestCalibrationOllamaToRelayReadGapMs,
  largestCalibrationRelayToClackForwardGapMs:report.largestCalibrationRelayToClackForwardGapMs,
  largestCalibrationNativeBodyReadGapMs:report.largestCalibrationNativeBodyReadGapMs,
  outcome:report.conclusion,sha256:sha(await readFile(path.join(root,"relay-cap-supplement.json")))},null,2));
