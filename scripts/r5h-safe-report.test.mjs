import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyR5hFailure, persistR5hReport, sanitizeR5hReport } from "./r5h-safe-report.mjs";

test("deliberate calibration failure persists only safe diagnostics, before acknowledgment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clack-r5h-test-"));
  try {
    const classified = classifyR5hFailure(
      Object.assign(new Error("PRIVATE-PROMPT https://secret.example cred=PRIVATE"), { code: "server-unavailable" }),
      "calibration-invocation", "calibration-start-ack", false,
    );
    const record = { kind: "r5h-synthetic-failure", ok: false, missionStarted: false,
      calibrationRequests: 0, missionRequests: 0, ...classified, sensitiveText: "PRIVATE-PROMPT" };
    const file = path.join(root, "final.json");
    const ack = await persistR5hReport(record, file);
    const durable = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(durable, ack);
    assert.deepEqual(durable, {
      ok: false, kind: "r5h-synthetic-failure", missionStarted: false,
      calibrationRequests: 0, missionRequests: 0,
      lastDurableStage: "calibration-start-ack", nativeDispatchAttempted: false,
      failureStage: "calibration-invocation", failureCode: "server-unavailable",
      failureClass: "Error", failureOwner: "native-ipc",
    });
    assert(!JSON.stringify(durable).includes("PRIVATE"));
    await assert.rejects(() => persistR5hReport(record, file), /EEXIST/);
  } finally { await rm(root, { recursive: true }); }
});

test("rejects arbitrary failure labels, persists no unsafe keys", () => {
  const base = { kind: "r5h-synthetic-failure", ok: false, missionStarted: false,
    calibrationRequests: 0, missionRequests: 0,
    lastDurableStage: "calibration-start-ack", nativeDispatchAttempted: false,
    failureStage: "calibration-invocation", failureCode: "unclassified",
    failureClass: "unknown", failureOwner: "calibration" };
  assert.throws(() => sanitizeR5hReport({ ...base, failureCode: "private prompt" }));
  assert.throws(() => sanitizeR5hReport({ ...base, failureStage: "http://private" }));
  assert.throws(() => sanitizeR5hReport({ ...base, nativeDispatchAttempted: "false" }));
  assert(!JSON.stringify(sanitizeR5hReport({ ...base, messages: ["PRIVATE"] })).includes("PRIVATE"));
});

test("classifies real native lease string without persisting the message", () => {
  const failure = classifyR5hFailure("Context verification is already running on this server; private=SECRET",
    "calibration-invocation", "calibration-start-ack", false);
  assert.equal(failure.failureCode, "context-lease-held");
  assert.equal(failure.failureOwner, "native-ipc");
  assert(!JSON.stringify(failure).includes("SECRET"));
});

test("recognized native IPC error code determines owner independent of private message", () => {
  const error = Object.assign(new Error("PRIVATE_PROMPT SECRET_URL credentials"), { code: "settings-unavailable" });
  const failure = classifyR5hFailure(error, "calibration-invocation", "calibration-start-ack", false);
  assert.deepEqual(failure, {
    failureStage: "calibration-invocation", failureCode: "settings-unavailable",
    failureClass: "Error", failureOwner: "native-ipc",
    nativeDispatchAttempted: false, lastDurableStage: "calibration-start-ack",
  });
  assert(!JSON.stringify(failure).includes("PRIVATE"));
});
