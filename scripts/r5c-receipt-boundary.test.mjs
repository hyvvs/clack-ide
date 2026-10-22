import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createR5bReceiptHandler, validateR5bEvent } from "./r5c-receipt-boundary.mjs";

const moduleUrl = pathToFileURL(fileURLToPath(new URL("./r5c-receipt-boundary.mjs", import.meta.url))).href;

test("redacted incremental receipts are durable after killing the receipt host without final report", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "clack-r5c-owned-"));
  const code = `import {createR5bReceiptHandler} from ${JSON.stringify(moduleUrl)};
    import {createServer} from 'node:http';
    const server=createServer(createR5bReceiptHandler({root:process.argv[1],configuration:()=>({status:'ok'}),onReport:()=>{}}));
    server.listen(0,'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\\n'));`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", code, root], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let killed = false;
  try {
    const port = await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.once("data", data => resolve(Number(String(data).trim())));
        child.once("error", reject);
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("receipt fixture unavailable")), 4000)),
    ]);
    const post = async event => fetch(`http://127.0.0.1:${port}/events`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event),
    });
    assert.equal((await post({ kind: "request-started", ordinal: 1 })).status, 200);
    assert.equal((await post({
      kind: "preflight-decision", at: 1, modelMatches: true, serializedContext: 32768,
      trustedTarget: 32768, admittedByRoute: true, runtimeObserved: false,
    })).status, 200);
    // Exercise the exact redacted frontend-stage receipts required by R5d.
    // Each HTTP 200 acknowledges an on-disk append before host termination.
    assert.equal((await post({ kind: "frontend-native-event", ordinal: 1, phase: "headers", bytes: 0 })).status, 200);
    assert.equal((await post({ kind: "frontend-native-event", ordinal: 1, phase: "chunk", bytes: 623 })).status, 200);
    assert.equal((await post({ kind: "frontend-native-event", ordinal: 1, phase: "settled", bytes: 0 })).status, 200);
    assert.equal((await post({ kind: "preflight-decision", at: 2, modelMatches: true,
      serializedContext: null, trustedTarget: null, admittedByRoute: true,
      runtimeObserved: false, prompt: "PRIVATE_CONTENT",
    })).status, 400);
    assert.equal((await post({ kind: "request-failed", ordinal: 1 })).status, 200);
    // No /report occurs. The host is interrupted as in R5b, with no cleanup
    // promise or final snapshot to rescue in-memory state.
    const exited = once(child, "exit");
    child.kill(); killed = true;
    await exited;
    const receipts = (await readFile(path.join(root, "redacted-preflight-events.jsonl"), "utf8"))
      .trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(receipts.map(e => e.kind), [
      "request-started", "preflight-decision", "frontend-native-event",
      "frontend-native-event", "frontend-native-event", "request-failed",
    ]);
    assert.equal(receipts[1].trustedTarget, 32768);
    assert.deepEqual(receipts.slice(2, 5).map(e => [e.phase, e.bytes]), [
      ["headers", 0], ["chunk", 623], ["settled", 0],
    ]);
    assert(!JSON.stringify(receipts).includes("PRIVATE_CONTENT"));
  } finally {
    if (!killed) child.kill();
    // Only the isolated fixture directory created by this test is removed.
    await rm(root, { recursive: true, force: false });
  }
});

test("malformed, unbounded or sensitive receipt fields fail closed", () => {
  assert.throws(() => validateR5bEvent({ kind: "request-started", ordinal: 3 }));
  assert.throws(() => validateR5bEvent({ kind: "preflight-decision", modelMatches: true, admittedByRoute: true, runtimeObserved: false, serializedContext: -1 }));
  assert.throws(() => validateR5bEvent({ kind: "request-completed", ordinal: 1, model: "SECRET" }));
  assert.deepEqual(validateR5bEvent({ kind: "request-completed", ordinal: 1, finishReason: "stop" }), { kind: "request-completed", ordinal: 1, finishReason: "stop" });
  assert.deepEqual(validateR5bEvent({ kind: "request-cancelled", ordinal: 1 }), { kind: "request-cancelled", ordinal: 1 });
  assert.deepEqual(validateR5bEvent({ kind: "request-timed-out", ordinal: 2 }), { kind: "request-timed-out", ordinal: 2 });
  assert.deepEqual(validateR5bEvent({ kind: "frontend-native-event", ordinal: 1, phase: "settled", bytes: 0 }), { kind: "frontend-native-event", ordinal: 1, phase: "settled", bytes: 0 });
  assert.throws(() => validateR5bEvent({ kind: "frontend-native-event", ordinal: 1, phase: "chunk", bytes: 12, content: "PRIVATE" }));
});

test("final report HTTP acknowledgement waits for asynchronous durable persistence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "clack-r5d-report-"));
  let permit;
  const gate = new Promise(resolve => { permit = resolve; });
  const reportFile = path.join(root, "final-report.json");
  const { writeFile } = await import("node:fs/promises");
  const server = createServer(createR5bReceiptHandler({ root,
    configuration: () => ({}),
    onReport: async report => {
      await gate;
      await writeFile(reportFile, JSON.stringify(report), { flag: "wx" });
    },
  }));
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${server.address().port}/report`;
    let replied = false;
    const request = fetch(target, { method: "POST", body: JSON.stringify({ kind: "r5d-result", inferenceAttempts: 1 }) })
      .then(response => { replied = true; return response; });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(replied, false, "report acknowledged before disk persistence");
    permit();
    assert.equal((await request).status, 200);
    assert.deepEqual(JSON.parse(await readFile(reportFile, "utf8")), { kind: "r5d-result", inferenceAttempts: 1 });
  } finally {
    permit();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: false });
  }
});

test("cross-origin JSON POSTs are allowed by the collector's browser preflight", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "clack-r5d-cors-"));
  const server = createServer(createR5bReceiptHandler({
    root, configuration: () => ({}), onReport: () => {},
  }));
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    for (const route of ["events", "report"]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/${route}`, {
        method: "OPTIONS",
        headers: {
          origin: "http://127.0.0.1:5173",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
      assert.match(response.headers.get("access-control-allow-headers") ?? "", /content-type/i);
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: false });
  }
});
