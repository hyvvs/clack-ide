import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDiagnosticRequest, requestLatencies } from "./audit-devstral-latency.mjs";

const request = () => ({ requestId: "inference-11", url: "http://127.0.0.1:11435/api/chat", at: 1000,
  body: { model: "devstral-small-2:24b", messages: [{ role: "user", content: "original" }], tools: [{ type: "function" }], stream: true,
    options: { num_ctx: 32768, num_predict: 2048 } } });

test("diagnostic retains exact captured messages, tools and native controls", () => {
  const original = request();
  const before = structuredClone(original);
  const result = validateDiagnosticRequest(original);
  assert.deepEqual(JSON.parse(result.bytes), original.body);
  assert.equal(result.sha256.length, 64);
  assert.deepEqual(original, before);
});

for (const [name, mutate] of [
  ["model", (item) => { item.body.model = "other"; }],
  ["destination", (item) => { item.url = "https://example.com/api/chat"; }],
  ["context", (item) => { item.body.options.num_ctx = 65536; }],
  ["output", (item) => { item.body.options.num_predict = 8192; }],
  ["thinking override", (item) => { item.body.think = false; }],
  ["extra native setting", (item) => { item.body.keep_alive = "1h"; }],
  ["sampling override", (item) => { item.body.options.temperature = 0; }],
  ["different attempt", (item) => { item.requestId = "inference-12"; }],
]) test(`diagnostic rejects changed ${name}`, () => {
  const item = request();
  mutate(item);
  assert.throws(() => validateDiagnosticRequest(item));
});

test("latency uses native monotonic deltas, not wall-clock subtraction", () => {
  const result = requestLatencies([request()], [{ requestId: "inference-11", droppedEvents: 0, events: [
    { kind: "dispatch", at: 1000, elapsedUs: 8000 },
    { kind: "headers", at: 500, elapsedUs: 2_008_000 },
    { kind: "body", at: 501, elapsedUs: 2_009_000 },
    { kind: "completed", at: 502, elapsedUs: 2_010_000 },
  ] }], []);
  assert.equal(result[0].headersMs, 2000);
  assert.equal(result[0].bodyMs, 2001);
  assert.equal(result[0].completedMs, 2002);
  assert.equal(result[0].firstParsedAt, null);
  assert.equal(result[0].firstStructuredMs, null);
});

test("unobserved receive stages stay unknown rather than becoming zero latency", () => {
  const result = requestLatencies([request()], [{ requestId: "inference-11", droppedEvents: 0, events: [
    { kind: "dispatch", at: 1000, elapsedUs: 8000 },
    { kind: "cancellation-observed", at: 121000, elapsedUs: 120_008_000 },
  ] }], []);
  assert.equal(result[0].headersMs, null);
  assert.equal(result[0].bodyMs, null);
  assert.equal(result[0].cancelledMs, 120000);
  assert.equal(result[0].finish, null);
});

test("incomplete trace capture is rejected", () => {
  assert.throws(() => requestLatencies([request()], [], []));
  assert.throws(() => requestLatencies([request()], [{ requestId: "inference-11", droppedEvents: 1, events: [] }], []));
});
