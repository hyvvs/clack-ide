/** Single eligible hosted-provider Agent control. No Ollama requests.
 * Isolated Tauri data, original mission, real Clack tools and native approvals.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { evaluateAcceptanceApproval } from "./strong-hosted-approval.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const offlineDryRun = process.argv[2]?.startsWith("--offline-dry-run=") ?? false;
const offlineLabel = offlineDryRun ? process.argv[2].slice("--offline-dry-run=".length) : "";
if (offlineDryRun) assert(/^(probe|verify)$/.test(offlineLabel), "Use only isolated offline probe/verify modes");
else assert(process.argv.length === 2, "Unrecognized runner arguments");
// An earlier WebView dry run reached the real hosted model despite its native
// ai_http_stream guard: the production OpenRouter path uses browser fetch.
// A JavaScript fetch wrapper or WebView2 HTTP proxy is not a kernel-enforced,
// protocol-complete process-tree egress boundary. Until an independent OS
// sandbox with verified loopback and external-denial proofs is installed, do
// not even create the test workspace or start Vite/WebView/native host.
if (offlineDryRun) throw new Error(
  "POST-POLICY HOSTED TEST ISOLATION UNSAFE: independent process-tree " +
  "network-egress containment has not been proven; offline WebView launch " +
  "is prohibited before any settings, workspace, or provider initialization."
);
const runName = offlineDryRun
  ? `post-policy-harness-offline-${offlineLabel}-20261029-01`
  : "post-policy-laguna-notes-live-20261029-02";
const owned = path.join(repo, "src-tauri", "target", "remote-controls", runName);
const root = path.join(owned, offlineDryRun
  ? "post-policy-hosted-notes-20261029-01" : "post-policy-hosted-notes-20261029-02");
const modelId = "poolside/laguna-s-2.1:free";
const selectionId = "saved-provider:spm-79c4acdb-3952-4379-a3e2-55d9a38928e3";
const phase = "mission-a-1";
assert(!existsSync(owned), "One-shot remote control already exists; never replay");

const originalSettings = path.join(process.env.APPDATA ?? "", "app.clack.dev", "terax-settings.json");
const original = await readFile(originalSettings);
const settings = JSON.parse(original.toString("utf8"));
const selected = settings.savedProviderModels?.find(m => `saved-provider:${m.id}` === selectionId);
assert(selected?.providerId === "openrouter" && selected.transportModelId === modelId && selected.enabled,
  "Expected original enabled OpenRouter model selection");
assert(settings.lastUsedModelId?.startsWith("saved-provider:"), "Original saved selection missing");
// Runtime isolation: only create new files under this exclusive, ignored root.
await mkdir(root, { recursive: true });
const init = spawnSync("git", ["init", "-q"], { cwd: root, windowsHide: true, encoding: "utf8" });
assert.equal(init.status, 0, init.stderr || "Scratch git init failed");
await mkdir(path.join(owned, "data"));
const isolatedSettings = JSON.parse(original.toString("utf8"));
isolatedSettings.lastUsedModelId = selectionId;
isolatedSettings.lastUsedProviderId = "openrouter";
if (offlineDryRun) {
  // Synthetic exact-ID catalog evidence, accepted through the *existing*
  // freshness/identity contract. Prevent any OpenRouter metadata HTTP lookup.
  const chosen = isolatedSettings.savedProviderModels.find(m => m.id === selected.id);
  chosen.providerEvidence = {
    version: 1, providerId: "openrouter", modelId, origin: "provider-metadata",
    lookup: "catalog", observedAt: Date.now(), context: 262144, output: 32768,
    capabilities: { supportedParameters: ["tools", "tool_choice", "max_tokens", "reasoning"],
      reasoning: { mandatory: false, defaultEnabled: true } },
  };
}
await writeFile(path.join(owned, "data", "terax-settings.json"), JSON.stringify(isolatedSettings), { flag: "wx" });
const originalHash = createHash("sha256").update(original).digest("hex");
const eventFile = path.join(owned, `${phase}.events.jsonl`);
const wireFile = path.join(owned, `${phase}.wire-controls.jsonl`);
const reportFile = path.join(owned, `${phase}.native-report.json`);
let complete;
const reportPromise = new Promise(resolve => { complete = resolve; });
const pending = new Map();
let activeOwner = null;
let finalReceived = false;
let eventCount = 0;
let wireCount = 0;
let computedBudget = null;
const server = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  const json = value => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); };
  try {
    if (request.method === "OPTIONS") return void (response.statusCode = 204, response.end());
    if (request.method === "GET" && request.url === "/configuration")
      return json({ root, report: `http://127.0.0.1:${server.address().port}/report`,
        modelId, selectionId, provider: "openrouter", offlineDryRun });
    if (request.method !== "POST" || !["/report", "/approval"].includes(request.url)) {
      response.statusCode = 404; return json({ error: "Unrecognized control route" });
    }
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      assert(body.length <= 128 * 1024, "Event exceeded limit");
    }
    const value = JSON.parse(body);
    if (request.url === "/report" && value.kind === "wire-serialized") {
      assert(value.modelId === modelId && Number.isSafeInteger(value.max_tokens) &&
        value.max_tokens > 0 && value.ordinal === wireCount + 1,
        "Invalid actual native outbound budget receipt");
      assert(value.outputFieldsPresent?.max_tokens === true,
        "Missing OpenRouter max_tokens in actual serialized request");
      assert(value.outputFieldsPresent?.reasoning_effort === false &&
        value.outputFieldsPresent?.reasoning === false &&
        value.outputFieldsPresent?.include_reasoning === false,
        "Unverified reasoning control was sent");
      assert(value.captureStage === "after-sdk-and-preflight",
        "Hosted capture must observe the final browser fetch after preflight");
      assert(computedBudget?.outputAllowance === 8192, "No trusted computed Agent allowance");
      assert(value.max_tokens === computedBudget.outputAllowance,
        "Preflight/SDK/native serialized output differs from computed policy allowance");
      wireCount++;
      await appendFile(wireFile, JSON.stringify({
        ordinal: wireCount, at: value.at, nativeRequestId: value.nativeRequestId,
        modelId, max_tokens: value.max_tokens,
        max_completion_tokens: value.max_completion_tokens,
        fields: value.outputFieldsPresent, toolsCount: value.toolsCount,
        byteLength: value.byteLength,
        captureStage: value.captureStage,
        computedAllowance: computedBudget.outputAllowance,
        providerOutputCap: computedBudget.providerOutputCap,
        reportedContext: computedBudget.reportedContext,
      }) + "\n");
      return json({ ok: true });
    }
    if (request.url === "/report" && value.kind === "budget-computed") {
      assert(!computedBudget && value.modelId === modelId &&
        value.outputAllowance === 8192 && value.providerOutputCap >= 8192 &&
        value.reasoningDefaultEnabled === true &&
        value.effortStatus === "unknown", "Untrusted or incorrect production budget receipt");
      computedBudget = {
        modelId, outputAllowance: value.outputAllowance,
        reportedContext: value.reportedContext,
        providerOutputCap: value.providerOutputCap,
        explicitMaxOutput: value.explicitMaxOutput,
        explicitOutputReserve: value.explicitOutputReserve,
        reasoningDefaultEnabled: value.reasoningDefaultEnabled,
        effortStatus: value.effortStatus, effortChoice: value.effortChoice,
        metadataOrigin: value.metadataOrigin, at: value.at,
      };
      await writeFile(path.join(owned, `${phase}.computed-budget.json`),
        JSON.stringify(computedBudget, null, 2), { flag: "wx" });
      return json({ ok: true });
    }
    if (request.url === "/approval") {
      assert(activeOwner && pending.has(value.id), "Unregistered pending production approval");
      const source = pending.get(value.id);
      assert(value.toolCallId === source.toolCallId && value.toolName === source.toolName &&
        JSON.stringify(value.input) === JSON.stringify(source.input), "Approval input changed");
      const decision = await evaluateAcceptanceApproval(value, {
        ...activeOwner, approvals: [...pending.values()],
      });
      pending.delete(value.id);
      await appendFile(eventFile, JSON.stringify({ kind: "approval-evaluated", at: Date.now(),
        approved: decision.approved, reasonCode: decision.approved ? "safe" : "denied" }) + "\n");
      return json({ approved: decision.approved, reason: decision.reason, targets: [] });
    }
    assert(++eventCount <= 50000, "Excessive control events");
    if (value.kind === "approval-pending") {
      assert(value.sessionId === "post-policy-hosted-notes-control" && value.workspaceRoot === root);
      assert(typeof value.runId === "string" && value.runId.startsWith("post-policy-hosted-notes-control:"));
      assert(value.approval?.id && value.approval.toolCallId && value.approval.toolName);
      if (activeOwner) assert(JSON.stringify(activeOwner) === JSON.stringify({
        sessionId: value.sessionId, runId: value.runId, workspaceRoot: value.workspaceRoot,
      }));
      else activeOwner = { sessionId: value.sessionId, runId: value.runId, workspaceRoot: value.workspaceRoot };
      assert(!pending.has(value.approval.id), "Duplicate approval");
      pending.set(value.approval.id, structuredClone(value.approval));
    }
    if (value.kind === "final") {
      assert(!finalReceived, "One final report only");
      assert(value.provider === "openrouter" && value.modelId === modelId);
      finalReceived = true;
      await writeFile(reportFile, JSON.stringify(value, null, 2), { flag: "wx" });
      complete(value);
    } else {
      // Persist strictly content-free, bounded evidence. Approval inputs stay
      // only in the pending in-memory map and are never copied to disk.
      await appendFile(eventFile, JSON.stringify({
        kind: typeof value.kind === "string" ? value.kind.slice(0, 64) : "unknown",
        at: Number.isSafeInteger(value.at) ? value.at : Date.now(),
        state: typeof value.state === "string" ? value.state.slice(0, 32) : undefined,
        stage: typeof value.stage === "string" ? value.stage.slice(0, 80) : undefined,
        steps: Number.isSafeInteger(value.steps) ? value.steps : undefined,
        continuations: Number.isSafeInteger(value.continuations) ? value.continuations : undefined,
        budgetPhase: typeof value.budgetPhase === "string" ? value.budgetPhase : undefined,
        retry: Number.isSafeInteger(value.retry) ? value.retry : undefined,
        compactionAt: Number.isSafeInteger(value.compactionAt) ? value.compactionAt : undefined,
        nativeRequestId: typeof value.nativeRequestId === "string" && /^inference-\d+$/.test(value.nativeRequestId) ? value.nativeRequestId : undefined,
        ...(offlineDryRun && value.kind === "milestone" && typeof value.stage === "string"
          ? { stage: value.stage.slice(0, 80) } : {}),
      }) + "\n");
    }
    return json({ ok: true });
  } catch (error) {
    response.statusCode = 400; return json({ error: error instanceof Error ? error.name : "Invalid event" });
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let vite, child, terminal = null, nativeExit = null;
const startedAt = Date.now();
try {
  const build = spawnSync("cargo", ["build", "--locked", "--example", "remote_control_host", "--target-dir", "target/codex-test"],
    { cwd: path.join(repo, "src-tauri"), windowsHide: true, encoding: "utf8", timeout: 300000 });
  assert.equal(build.status, 0, build.stderr?.slice(-3000) || "Native host build failed");
  vite = await createViteServer({
    root: repo,
    plugins: [{ name: "remote-notes-real-agent-control", configureServer(s) {
      s.middlewares.use("/coworking-acceptance.html", async (_req, res) => {
        res.setHeader("content-type", "text/html");
        res.end(await s.transformIndexHtml("/coworking-acceptance.html",
          '<html><body><div id="root"></div><script type="module" src="/src/test/postPolicyHostedNotesAgent.tsx"></script></body></html>'));
      });
    }}],
    server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null, forwardConsole: false },
  });
  await vite.listen();
  const env = Object.fromEntries(["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "HOME", "LANG"]
    .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, { APPDATA: path.join(owned, "data"), LOCALAPPDATA: path.join(owned, "data"),
    TEMP: owned, TMP: owned, CLACK_ACCEPTANCE_ROOT: owned, CLACK_REAL_PRODUCT_PHASE: phase,
    ...(offlineDryRun ? { CLACK_HOSTED_OFFLINE_DRY_RUN: "1" } : {}),
    CLACK_ACCEPTANCE_URL: `${vite.resolvedUrls.local[0]}coworking-acceptance.html?configuration=${encodeURIComponent(url + "/configuration")}`,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--disable-gpu --disable-gpu-compositing" });
  // No CLACK_ACCEPTANCE_OLLAMA_URL and no local inference. The production
  // hosted provider uses ordinary HTTPS fetch rather than native Ollama IPC.
  const nativePath = path.join(repo, "src-tauri", "target", "codex-test", "debug", "examples", "remote_control_host.exe");
  child = spawn(nativePath, [], { cwd: root, env, windowsHide: true });
  child.once("exit", (code, signal) => { nativeExit = { code, signal, at: Date.now() }; });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  console.log(JSON.stringify({ event: "remote-control-native-start", pid: child.pid, modelId, at: Date.now() }));
  let timer;
  const bound = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Test-host 90-minute upper safety bound reached")), 90 * 60 * 1000);
  });
  const exited = new Promise((_, reject) => {
    child.once("exit", code => reject(new Error(`Native host exited before report: ${code}`)));
  });
  terminal = await Promise.race([reportPromise, bound, exited]).finally(() => clearTimeout(timer));
  await new Promise((resolve, reject) => {
    if (nativeExit) return resolve();
    const limit = setTimeout(() => reject(new Error("Native host did not close after terminal receipt")), 30000);
    child.once("exit", () => { clearTimeout(limit); resolve(); });
  });
  const nativeWire = await readFile(wireFile, "utf8").catch(() => "");
  wireCount = nativeWire.trim() ? nativeWire.trim().split("\n").length : 0;
  if (offlineDryRun && terminal.state === "offline-dry-run-complete" && wireCount < 1)
    throw new Error("Offline dry-run did not reach preflighted SDK serialization");
  await writeFile(path.join(owned, `${phase}.json`), JSON.stringify({
    startedAt, endedAt: Date.now(), modelId, provider: "openrouter", selectionId,
    settingsSourceSha256: originalHash, missionStarted: terminal.missionStarted,
    finalState: terminal.state, generationSteps: terminal.generationSteps,
    continuations: terminal.continuations, genuineToolCalls: terminal.toolCalls,
    byName: terminal.byName ?? [], nativeExit, productionModelPath: true,
    capturedOutboundGenerations: wireCount,
    outboundMaxTokens: computedBudget?.outputAllowance ?? null,
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ event: "remote-control-agent-terminal", state: terminal.state,
    generationSteps: terminal.generationSteps, genuineToolCalls: terminal.toolCalls,
    nativeExitCode: nativeExit?.code, wireCaptures: wireCount }));
} catch (error) {
  await writeFile(path.join(owned, `${phase}.failure.json`), JSON.stringify({
    startedAt, endedAt: Date.now(), errorKind: error instanceof Error ? error.name : "unknown",
    terminalReported: finalReceived, nativeExit,
  }, null, 2), { flag: "wx" }).catch(() => {});
  console.error(JSON.stringify({ event: "remote-control-harness-error", kind: error instanceof Error ? error.name : "unknown" }));
  process.exitCode = 1;
} finally {
  if (child && !nativeExit) {
    if (process.platform === "win32")
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill();
  }
  await vite?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
