import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertToModelMessages, pruneMessages } from "ai";
import { createServer } from "vite";

const directory = process.argv[2];
assert(directory && path.isAbsolute(directory), "Supply the preserved absolute evidence directory");
const hashes = {};
const read = async name => {
  const file = path.join(directory, name);
  assert((await stat(file)).size < 4 * 1024 * 1024, "Evidence exceeds diagnostic bound");
  const text = await readFile(file, "utf8");
  assert(Buffer.byteLength(text) < 4 * 1024 * 1024, "Evidence exceeds diagnostic bound");
  hashes[name] = createHash("sha256").update(text).digest("hex");
  return text;
};
const report = JSON.parse(await read("mission-a-1.json"));
const requests = (await read("mission-a-1.requests.jsonl")).trim().split("\n").map(JSON.parse);
const events = (await read("mission-a-1.jsonl")).trim().split("\n").map(JSON.parse);
assert.equal(requests.length, 26, "This diagnostic describes the preserved -04 request-26 boundary");
assert.equal(report.runId, "forgeboard-none-20261017-04");
const request = requests.at(-1);
assert.equal(request.requestId, "inference-26");
assert.equal(request.body.model, "qwen38-uncensored:latest");
assert.deepEqual(request.body.options, { num_ctx: 32768, num_predict: 2048 });
assert.equal(request.body.think, false);
const stream = events.find(e => e.kind === "native-stream-trace" && e.requestId === request.requestId);
assert(stream, "Missing bounded stream trace");
const trace = stream.summary;
assert.equal(trace.droppedEvents, 0);
assert.equal(trace.droppedFrames, 0);
assert.equal(trace.invalid, 0);
assert.equal(trace.pendingBytes, 0);
const cutoff = stream.at - 60_000;
const finalWindow = trace.events.filter(e => e.at >= cutoff);
const conversation = report.conversations.find(c => c.id === "real-mission-a");
const original = conversation.messages;
let steps = 0;
const boundary = original[1].parts.findIndex(p => p.type === "step-start" && ++steps === 25);
assert(boundary > 0);
const ui = [original[0], { ...original[1], parts: original[1].parts.slice(0, boundary) }];
const injected = structuredClone(ui);
injected[0].parts[0].text = requests[24].body.messages.find(m => m.role === "user").content;
const history = pruneMessages({ messages: await convertToModelMessages(injected), reasoning: "before-last-message", emptyMessages: "remove" });
const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), server: { watch: null, hmr: false }, logLevel: "error" });
try {
  const { selectToolSchemas, uiExposureQuery, requiredUiToolNames, requiredToolNames } = await vite.ssrLoadModule("/src/modules/ai/lib/toolExposure.ts");
  const mandatory = [...new Set([...requiredUiToolNames(ui), ...requiredToolNames(history)])].sort();
  const select = (schemas, messages = history, required = mandatory) => selectToolSchemas({ schemas, mandatory: required, query: uiExposureQuery(ui), system: requests[23].body.messages.find(m => m.role === "system").content, messages, limits: report.limits });
  const selected = select(requests[23].body.tools);
  const userOnly = select(requests[23].body.tools, history.slice(0, 1), []);
  assert.deepEqual(userOnly.names, requests[23].body.tools.map(t => t.function.name).sort());
  const actual = requests[24].body.tools.map(t => t.function.name).sort();
  assert.deepEqual(selected.names, actual);
  assert.deepEqual(select([...requests[23].body.tools].reverse()).names, actual);
  assert.deepEqual(select(requests[23].body.tools).names, actual);
  const toolParts = original.flatMap(m => m.parts).filter(p => p.type.startsWith("tool-"));
  assert.equal(new Set(toolParts.map(p => p.toolCallId)).size, toolParts.length);
  assert.equal(original.filter(m => m.role === "user").length, 1);
  const stamp = at => at === null || at === undefined ? "not recorded" : { epochMs: at, utc: new Date(at).toISOString() };
  const category = name => stamp(trace.categoryTimes[name]?.lastAt);
  console.log(JSON.stringify({
    requestId: request.requestId, capturedBodyJsonSHA256: createHash("sha256").update(JSON.stringify(request.body)).digest("hex"),
    layer: trace.timestampLayer, dispatch: stamp(request.at), observerStart: stamp(stream.observerStartedAt),
    nativeAttemptStart: stamp(events.find(e => e.kind === "admission" && e.requestId === request.requestId)?.observation.attemptStartedAt),
    firstRaw: stamp(trace.firstRawAt), lastRaw: stamp(trace.lastRawAt), firstFrame: stamp(trace.firstFrameAt), lastFrame: stamp(trace.lastFrameAt),
    lastMeaningful: stamp(trace.lastMeaningfulAt), lastReasoning: category("reasoning"), lastToolFrame: category("tools"), lastEmptyMetadata: category("empty-or-metadata"),
    watchdogReset: "not recorded", timeout: stamp(stream.at), explicitCancellation: "not recorded", physicalSocketClose: "not recorded",
    meaningfulGapMs: stream.at - trace.lastMeaningfulAt, rawGapMs: stream.at - trace.lastRawAt,
    finalWindowEvents: finalWindow, final: trace.final, sdkTimestamps: trace.sdk,
    counters: { chunks: trace.chunks, frames: trace.frames, bytes: trace.bytes, categories: trace.categories },
    toolSelection: { scope: "Offline production selector over the 16 captured schemas and installed-SDK reconstruction of pre-batch-25 UI history; not an inference replay or an assertion about unrecorded candidates/cache hits", userOnlyCount: userOnly.names.length, mandatory, selected: selected.names, metrics: selected.metrics,
      removed: requests[23].body.tools.map(t => t.function.name).filter(name => !actual.includes(name)) },
    transcript: { userMessages: 1, toolCalls: toolParts.length, uniqueToolCallIds: toolParts.length, pending: toolParts.filter(p => p.state !== "output-available").map(p => ({ id: p.toolCallId, state: p.state })), lastAssistantPart: { type: original[1].parts.at(-1).type, state: original[1].parts.at(-1).state, characters: original[1].parts.at(-1).text?.length } },
    finalEngineMetadata: report.finalModels, hashes, newInference: 0, nativeEffects: 0,
  }, null, 2));
} finally { await vite.close(); }
