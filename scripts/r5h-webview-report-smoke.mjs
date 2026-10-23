/** Real, no-inference native Tauri WebView → exact R5h reporting sanitizer. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, appendFile, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { persistR5hReport } from "./r5h-safe-report.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const runName = process.argv[2];
assert.equal(runName, "r5j-webview-failure-smoke-20261023-01", "One exclusive R5j smoke run required");
const root = path.join(repo, "src-tauri/target", runName);
const binary = path.join(repo, "src-tauri/target/codex-test/debug/examples/hardened_agent_acceptance.exe");
assert((await stat(binary)).size > 0);
await mkdir(root); // Exclusive; fail on a reused run.
await mkdir(path.join(root, "data"));
const result = { smoke: "real-native-Tauri-WebView", syntheticOnly: true, inferenceRequests: 0, passed: false };
let vite, collector, host, deadline;
try {
  vite = await createViteServer({ root: repo, plugins: [{
    name: "r5h-safe-report-only", configureServer(s) {
      s.middlewares.use("/coworking-acceptance.html", async (_req, res) => {
        res.setHeader("content-type", "text/html");
        res.end(await s.transformIndexHtml("/coworking-acceptance.html",
          '<html><body><script type="module" src="/src/test/r5hSafeFailureWebview.ts"></script></body></html>'));
      });
    },
  }], server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null } });
  await vite.listen();
  const origin = new URL(vite.resolvedUrls.local[0]).origin;
  let endpoint;
  collector = createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    const url = req.url;
    if (url === "/configuration") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ report: endpoint + "/report", events: endpoint + "/events", syntheticOnly: true }));
      return;
    }
    if (url !== "/report" && url !== "/events") { res.statusCode = 404; res.end(); return; }
    await appendFile(path.join(root, "origin-audit.jsonl"), JSON.stringify({
      route: url,
      method: req.method, matchesFrontendOrigin: req.headers.origin === origin,
      preflightContentType: req.headers["access-control-request-headers"] === "content-type",
    }) + "\n");
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
    if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
    try {
      let source = "";
      for await (const part of req) {
        source += part;
        assert(source.length <= 65536, "Oversized synthetic receipt");
      }
      const parsed = JSON.parse(source);
      if (url === "/events") {
        assert(Object.keys(parsed).sort().join(",") === "kind,ordinal", "Sensitive event keys");
        assert(["calibration-start", "calibration-failed"].includes(parsed.kind), "Non-synthetic event");
        assert(parsed.ordinal === (parsed.kind === "calibration-start" ? 1 : 2), "Wrong event ordinal");
        await appendFile(path.join(root, "durable-incremental-events.jsonl"), JSON.stringify(parsed) + "\n");
      } else {
        // Reuses the exact strict persistence helper the live runner uses.
        await persistR5hReport(parsed, path.join(root, "durable-final-report.json"));
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false }));
    }
  });
  await new Promise(resolve => collector.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${collector.address().port}`;
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG"]
    .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, {
    APPDATA: path.join(root, "data"), LOCALAPPDATA: path.join(root, "data"), TEMP: root, TMP: root,
    CLACK_ACCEPTANCE_ROOT: root, CLACK_REAL_PRODUCT_PHASE: "r5h-synthetic-no-inference",
    CLACK_ACCEPTANCE_URL: `${origin}/coworking-acceptance.html?configuration=${encodeURIComponent(endpoint + "/configuration")}`,
  });
  host = spawn(binary, [], { cwd: root, env, windowsHide: true });
  const outcome = await Promise.race([
    once(host, "exit").then(([code, signal]) => ({ code, signal })),
    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Native smoke deadline")), 90_000); }),
  ]);
  clearTimeout(deadline);
  result.hostExit = outcome;
  await new Promise(resolve => collector.close(resolve));
  collector = null;
  const audit = (await readFile(path.join(root, "origin-audit.jsonl"), "utf8"))
    .trim().split("\n").map(JSON.parse);
  const final = JSON.parse(await readFile(path.join(root, "durable-final-report.json"), "utf8"));
  const events = (await readFile(path.join(root, "durable-incremental-events.jsonl"), "utf8"))
    .trim().split("\n").map(JSON.parse);
  assert.deepEqual(outcome, { code: 0, signal: null });
  assert(audit.some(a => a.method === "OPTIONS" && a.matchesFrontendOrigin && a.preflightContentType));
  assert(audit.some(a => a.method === "POST" && a.matchesFrontendOrigin));
  for (const route of ["/events", "/report"]) {
    assert(audit.some(a => a.route === route && a.method === "OPTIONS" && a.matchesFrontendOrigin && a.preflightContentType));
    assert(audit.some(a => a.route === route && a.method === "POST" && a.matchesFrontendOrigin));
  }
  assert.deepEqual(events, [
    { kind: "calibration-start", ordinal: 1 }, { kind: "calibration-failed", ordinal: 2 },
  ]);
  assert.deepEqual(final, {
    ok: false, kind: "r5h-synthetic-failure", missionStarted: false, calibrationRequests: 0, missionRequests: 0,
    lastDurableStage: "calibration-start-ack", nativeDispatchAttempted: false,
    failureStage: "calibration-invocation", failureCode: "settings-unavailable",
    failureClass: "Error", failureOwner: "native-ipc",
  });
  assert(!JSON.stringify({ audit, final, events }).includes("PRIVATE_PROMPT"));
  result.passed = true;
  result.events = { preflight: audit.filter(x=>x.method==="OPTIONS").length,
    posted: audit.filter(x=>x.method==="POST").length,
    durableIncremental: events.length, durableFinal: true, safeCode: final.failureCode };
} catch (error) {
  result.failureCode = error instanceof Error ? error.name : "unknown";
} finally {
  clearTimeout(deadline);
  if (host && host.exitCode === null) host.kill();
  if (collector) { collector.closeAllConnections(); await new Promise(resolve => collector.close(resolve)); }
  await vite?.close();
  await writeFile(path.join(root, "smoke-result.json"), JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
