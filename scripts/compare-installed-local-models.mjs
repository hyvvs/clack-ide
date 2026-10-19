import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const repository = process.cwd();
const candidates = [
  ["qwen36moe", "hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M", "41"],
  ["gemma4", "hf.co/HauhauCS/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-MTP:Q4_K_M", "42"],
  ["qwen36dense", "hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive:IQ3_M", "43"],
];
const evidenceRoot = path.join(repository, "src-tauri/target/installed-local-models-20261019-01");
const inventory = JSON.parse(await readFile(path.join(evidenceRoot, "inventory.json"), "utf8"));
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const files = [...new Set([...tracked, "scripts/inventory-installed-local-models.mjs", "scripts/compare-installed-local-models.mjs", "src/test/installedModelComparison.test.ts"])];
async function freeze() {
  const hashes = {};
  for (const file of files) hashes[file] = createHash("sha256").update(await readFile(file)).digest("hex");
  return hashes;
}
const before = await freeze();
const isolation = execFileSync("powershell.exe", ["-NoProfile", "-Command",
  `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and ($_.Name -match '^(clack|coworking_acceptance|cargo|rustc|node)\\.exe$') -and ($_.CommandLine -match 'clack|acceptance|vite|vitest|cargo|rustc|compare-installed') } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`,
], { encoding: "utf8", windowsHide: true }).trim();
assert(!isolation, `Concurrent process: ${isolation}`);
await writeFile(path.join(evidenceRoot, "comparison-before.json"), JSON.stringify({ at: Date.now(), head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), isolation: [], files: before }, null, 2), { flag: "wx" });
async function phase(name, runId, root, model) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("CLACK_PRODUCT_")) delete env[key];
  Object.assign(env, { CLACK_PRODUCT_RUN_ID: runId, CLACK_PRODUCT_WORKSPACE: root,
    CLACK_PRODUCT_MODEL: model, CLACK_PRODUCT_MAX_OUTPUT: "2048", CLACK_PRODUCT_TRACE: "1" });
  if (name === "preflight") env.CLACK_PRODUCT_PREPARE_ONLY = "1";
  else env.CLACK_PRODUCT_REASONING = "none";
  if (name === "system-preflight") env.CLACK_PRODUCT_TOOL_PROTOCOL = "1";
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["scripts/check-real-local-product.mjs", name, "1"], { cwd: repository, env, windowsHide: true, stdio: "inherit" });
    child.once("error", error => resolve({ code: null, error: String(error) }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}
const results = [];
for (const [label, model, suffix] of candidates) {
  assert(inventory.models.some(item => item.name === model), "Model must already be installed");
  const root = `C:/Users/Hayden/Documents/forgeboard-qwen-none-20261019-${suffix}`;
  const runId = `installed-${label}-20261019-01`;
  const evidence = path.join(repository, "src-tauri/target/real-qwen-product", runId);
  await mkdir(root);
  await mkdir(evidence);
  execFileSync("git", ["-C", root, "init", "--quiet"], { windowsHide: true });
  assert.deepEqual(await readdir(root), [".git"]);
  const result = { label, model, root, runId, evidence, initialFiles: [] };
  results.push(result);
  result.preflight = await phase("preflight", runId, root, model);
  if (result.preflight.code === 0) {
    result.smoke = await phase("system-preflight", runId, root, model);
    try {
      const probe = JSON.parse(await readFile(path.join(evidence, "system-preflight-1.json"), "utf8"));
      const protocol = probe.protocolResult;
      result.protocol = protocol;
      result.reasoning = probe.reasoningControl;
      result.smokePassed = result.smoke.code === 0 && protocol.toolExecutionCount === 0 && protocol.calls.length === 1 &&
        protocol.calls[0].toolName === "get_test_value" && protocol.calls[0].input?.value === "protocol-check";
    } catch (error) { result.probeError = String(error); }
    if (result.smokePassed) result.mission = await phase("mission-a", runId, root, model);
  }
  const after = await freeze();
  result.changedSource = files.filter(file => before[file] !== after[file]);
  await writeFile(path.join(evidence, "source-freeze-after.json"), JSON.stringify({ at: Date.now(), changed: result.changedSource, files: after }, null, 2), { flag: "wx" });
  await writeFile(path.join(evidenceRoot, "comparison-progress.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ event: "candidate-complete", ...result }));
  assert.equal(result.changedSource.length, 0, "Source changed during comparison; stop rather than continue");
}
console.log("COMPARISON FINISHED: no retries, no downloads, no cloud, no push");
