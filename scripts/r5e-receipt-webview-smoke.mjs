/** Disposable receipt-only native WebView test, must PASS before any inference. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const repo = fileURLToPath(new URL("../", import.meta.url));
const root = path.join(repo, "src-tauri/target/r5e-webview-smoke-20261022-01");
const artifact = path.join(repo, "src-tauri/target/r5e-webview-smoke-20261022-01-result.json");
const binary = path.join(repo, "src-tauri/target/codex-test/debug/examples/hardened_agent_acceptance.exe");
assert((await stat(binary)).size > 0);
await mkdir(root); // Exclusive, fail rather than reuse any prior evidence.
await mkdir(path.join(root, "data"));
const evidence = { kind: "r5e-webview-smoke", syntheticOnly: true, inferenceAttempts: 0, gatePassed: false };
let vite, collector, host, deadline;
try {
  vite = await createViteServer({ root: repo, plugins: [{
    name: "r5e-receipt-only", configureServer(s) {
      s.middlewares.use("/coworking-acceptance.html", async (_req, res) => {
        res.setHeader("content-type", "text/html");
        res.end(await s.transformIndexHtml("/coworking-acceptance.html",
          '<html><body><script type="module" src="/src/test/r5eReceiptWebviewSmoke.ts"></script></body></html>'));
      });
    },
  }], server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null } });
  await vite.listen();
  const origin = new URL(vite.resolvedUrls.local[0]).origin;
  collector = spawn(process.execPath, [
    path.join(repo, "scripts/r5e-receipt-collector-child.mjs"), root, origin,
  ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const ready = await Promise.race([
    new Promise((resolve, reject) => {
      collector.stdout.once("data", buffer => {
        try { resolve(JSON.parse(String(buffer).trim()).port); } catch (error) { reject(error); }
      });
      collector.once("error", reject);
      collector.once("exit", () => reject(new Error("Collector exited before readiness")));
    }),
    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Collector startup bound")), 5000); }),
  ]);
  clearTimeout(deadline);
  assert(Number.isInteger(ready) && ready > 0);
  const base = `http://127.0.0.1:${ready}`;
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG"]
    .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, {
    APPDATA: path.join(root, "data"), LOCALAPPDATA: path.join(root, "data"), TEMP: root, TMP: root,
    CLACK_ACCEPTANCE_ROOT: root, CLACK_REAL_PRODUCT_PHASE: "receipt-smoke-only",
    CLACK_ACCEPTANCE_URL: `${origin}/coworking-acceptance.html?configuration=${encodeURIComponent(base + "/configuration")}`,
  });
  host = spawn(binary, [], { cwd: root, env, windowsHide: true });
  let hostExit;
  try {
    hostExit = await Promise.race([
      once(host, "exit").then(([code, signal]) => ({ code, signal })),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("90-second smoke host bound")), 90_000); }),
    ]);
  } finally { clearTimeout(deadline); }
  evidence.hostExit = hostExit;
  // Terminate the collector process ungracefully after browser acknowledgements.
  // Previously acknowledged data must survive without graceful shutdown.
  const collectorExit = once(collector, "exit");
  collector.kill();
  await collectorExit;
  collector = null;
  const loadLines = async name => (await readFile(path.join(root, name), "utf8"))
    .trim().split("\n").map(JSON.parse);
  const audit = await loadLines("redacted-browser-http.jsonl");
  const events = await loadLines("redacted-preflight-events.jsonl");
  const final = JSON.parse(await readFile(path.join(root, "redacted-final-report.json"), "utf8"));
  assert.deepEqual(hostExit, { code: 0, signal: null }, "Native smoke host failed");
  for (const route of ["/events", "/report"]) {
    assert(audit.some(e => e.route === route && e.method === "OPTIONS" && e.originMatches && e.preflightContentType),
      `No genuine WebView CORS preflight for ${route}`);
    assert(audit.some(e => e.route === route && e.method === "POST" && e.originMatches),
      `No genuine WebView cross-origin POST for ${route}`);
  }
  assert.deepEqual(events, [
    { kind: "request-started", ordinal: 1 },
    { kind: "frontend-native-event", ordinal: 1, phase: "headers", bytes: 0 },
    { kind: "request-failed", ordinal: 1 },
  ]);
  assert.deepEqual(final, {
    kind: "r5e-browser-smoke", browser: true, eventAcks: 3,
    sensitiveEventRejected: true, sensitiveReportRejected: true,
  });
  assert.equal(audit.filter(e => e.route === "/events" && e.method === "POST").length, 4);
  assert.equal(audit.filter(e => e.route === "/report" && e.method === "POST").length, 2);
  assert(!JSON.stringify({ audit, events, final }).includes("PRIVATE_MARKER"));
  evidence.gatePassed = true;
  evidence.auditCounts = {
    corsPreflights: audit.filter(e => e.method === "OPTIONS").length,
    browserEventPosts: audit.filter(e => e.method === "POST" && e.route === "/events").length,
    browserReportPosts: audit.filter(e => e.method === "POST" && e.route === "/report").length,
    acknowledgedEventsAfterCollectorKill: events.length,
    durableFinalReportAfterCollectorKill: true,
  };
} catch (error) {
  evidence.failure = error instanceof Error ? error.message.replaceAll(root, "[smoke workspace]") : "unknown";
} finally {
  if (host && host.exitCode === null) host.kill();
  if (collector && collector.exitCode === null) collector.kill();
  await vite?.close();
  await writeFile(artifact, JSON.stringify(evidence, null, 2), { flag: "wx" });
  console.log(JSON.stringify(evidence));
  if (!evidence.gatePassed) process.exitCode = 1;
}
