import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const hostPath = fileURLToPath(new URL("./forgeboard-muse-instrumented-one-20261108.mjs", import.meta.url));

// Execute the actual /evidence branch in isolation. Importing the one-shot host
// would start its guarded mission and require native inference infrastructure.
async function clientStreamHandler() {
  const host = await readFile(hostPath, "utf8");
  const startMarker = '      if (value.kind === "r5di-client-stream") {';
  const endMarker = '      if (value.kind === "r5de-cancellation") {';
  const start = host.indexOf(startMarker);
  const end = host.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, "Canonical client-stream handler must be present");
  const AsyncFunction = (async () => {}).constructor;
  return new AsyncFunction("value", "output", "appendFile", "assert", "json",
    `${host.slice(start, end)}\nthrow new Error("Client-stream handler returned without processing evidence");`);
}

test("canonical ForgeBoard host persists a timed-out terminal client stream", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "forgeboard-stream-offline-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "mission-a-1");
  const handler = await clientStreamHandler();
  const result = await handler({ kind: "r5di-client-stream", details: {
    requestId: "inference-3", phase: "timed-out", firstAt: 100, lastAt: 450,
    firstChunkAt: null, chunks: 0, maxGapMs: 350,
    privatePayload: "must not be persisted",
  } }, output, appendFile, assert, value => value);

  assert.deepEqual(result, { ok: true });
  const written = await readFile(`${output}.client-stream.jsonl`, "utf8");
  assert.deepEqual(written.trim().split("\n").map(JSON.parse), [{
    requestId: "inference-3", phase: "timed-out", firstAt: 100, lastAt: 450,
    firstChunkAt: null, chunks: 0, maxGapMs: 350,
  }]);
  assert(!written.includes("privatePayload"));
});

test("canonical ForgeBoard host rejects unknown terminal phases before persistence", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "forgeboard-stream-offline-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "mission-a-1");
  const handler = await clientStreamHandler();

  await assert.rejects(handler({ kind: "r5di-client-stream", details: {
    requestId: "inference-3", phase: "invented-phase", firstAt: 100, lastAt: 450,
    firstChunkAt: null, chunks: 0, maxGapMs: 350,
  } }, output, appendFile, assert, value => value), /Unexpected native settlement/);
  await assert.rejects(stat(`${output}.client-stream.jsonl`), { code: "ENOENT" });
});
