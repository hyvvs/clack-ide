import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEVSTRAL_MODEL = "devstral-small-2:24b";
export const DEVSTRAL_ENDPOINT = "http://127.0.0.1:11435/api/chat";

export function validateDiagnosticRequest(request) {
  assert.equal(request.requestId, "inference-11");
  assert.equal(request.url, DEVSTRAL_ENDPOINT);
  assert.equal(request.body.model, DEVSTRAL_MODEL);
  assert.equal(request.body.stream, true);
  assert.deepEqual(request.body.options, { num_ctx: 32768, num_predict: 2048 });
  assert(!Object.hasOwn(request.body, "think"));
  assert.deepEqual(Object.keys(request.body).sort(), ["messages", "model", "options", "stream", "tools"]);
  assert(Array.isArray(request.body.messages) && request.body.messages.length > 0);
  assert(Array.isArray(request.body.tools) && request.body.tools.length > 0);
  const bytes = Buffer.from(JSON.stringify(request.body));
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function requestLatencies(requests, receives, events) {
  return requests.map((request) => {
    const native = receives.find((item) => item.requestId === request.requestId);
    assert(native, `Missing native trace ${request.requestId}`);
    assert.equal(native.droppedEvents, 0);
    const dispatch = native.events.find((item) => item.kind === "dispatch");
    assert(dispatch, "Missing dispatch trace");
    const stamp = (kind) => native.events.find((item) => item.kind === kind);
    const elapsed = (kind) => {
      const item = stamp(kind);
      return item ? (item.elapsedUs - dispatch.elapsedUs) / 1000 : null;
    };
    const trace = events.find((item) => item.kind === "native-stream-trace" && item.requestId === request.requestId);
    const firstToolAt = trace?.summary.categoryTimes?.tools?.firstAt;
    const final = events.find((item) => item.kind === "engine-finish" && item.requestId === request.requestId);
    return {
      requestId: request.requestId,
      ipcObservedAt: request.at,
      dispatch,
      headersMs: elapsed("headers"),
      bodyMs: elapsed("body"),
      ipcForwardMs: elapsed("ipc-forwarded"),
      firstParsedAt: trace?.summary.firstFrameAt ?? null,
      firstStructuredMs: firstToolAt === undefined ? null : firstToolAt - dispatch.at,
      completedMs: elapsed("completed"),
      cancelledMs: elapsed("cancellation-observed"),
      finish: final?.metrics ?? null,
    };
  });
}

export async function reconstruct(directory) {
  const jsonl = async (name) => (await readFile(path.join(directory, name), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  const requests = await jsonl("mission-a-1.requests.jsonl");
  const events = await jsonl("mission-a-1.jsonl");
  const receives = await jsonl("mission-a-1.receive.jsonl");
  assert.equal(requests.length, 11);
  const last = requests.at(-1);
  const { bytes, sha256 } = validateDiagnosticRequest(last);
  const report = JSON.parse(await readFile(path.join(directory, "mission-a-1.json"), "utf8"));
  const session = report.sessions.find((item) => item.id === "real-mission-a");
  const conversation = report.conversations.find((item) => item.id === session.id);
  assert.equal(report.cloudInference, 0);
  assert.equal(session.run.budget.continuationCount, 0);
  const latencies = requestLatencies(requests, receives, events);
  const native = receives.at(-1);
  const trace = events.find((item) => item.kind === "native-stream-trace" && item.requestId === last.requestId);
  assert.equal(native.bodyBytes, 0);
  assert.equal(trace.summary.frames, 0);
  assert.equal(session.run.error.errorCode, "overall-deadline");
  return {
    requestId: last.requestId,
    model: last.body.model,
    options: last.body.options,
    think: "omitted",
    messages: last.body.messages.length,
    schemas: last.body.tools.length,
    capturedBodyReserializedBytes: bytes.length,
    payloadSha256: sha256,
    payloadIdentity: "JSON content preserved; original raw serialized byte order was not retained",
    latencies,
    finalNativeTrace: native,
    finalIpcTrace: trace,
    finalRequestEvents: events.filter((item) => item.requestId === last.requestId && item.kind !== "native-stream-trace"),
    nativeBudget: report.wireBudgets.find((item) => item.requestId === last.requestId),
    runError: session.run.error,
    runEndedAt: session.run.endedAt,
    answerRecovery: conversation.messages.filter((item) => item.role === "assistant").flatMap((item) => item.parts.filter((part) => /answer|recovery/.test(part.type))),
    preparationStart: "NOT RECORDED",
    preparationEnd: "NOT RECORDED",
    recoveryTimerStart: "NOT RECORDED",
    requestConstruction: "NOT RECORDED (code places it before dispatch trace)",
    physicalSocketSend: "NOT RECORDED",
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  assert.equal(process.argv.length, 3, "Usage: node scripts/audit-devstral-latency.mjs <existing-evidence-directory>");
  console.log(JSON.stringify(await reconstruct(path.resolve(process.argv[2])), null, 2));
}
