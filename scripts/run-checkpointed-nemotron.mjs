import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { constants, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const hash = value => createHash("sha256").update(value).digest("hex");
const selectedPath = "src-tauri/target/checkpoint-live-setup.json";
const base = "8a4f7bc";
const model = "nemotron-3.5-lightning:30b-a3b-q4_K_M";
const digest = "e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2";
const endpoint = "http://127.0.0.1:11435";
const metadata = async route => {
  const at = Date.now();
  const response = await fetch(endpoint + route, { signal: AbortSignal.timeout(5000) });
  assert(response.ok, `Metadata unavailable: ${route}`);
  return { at, elapsedMs: Date.now() - at, status: response.status, body: await response.json() };
};

if (process.argv[2] === "prepare") {
  assert(git("rev-parse", "HEAD").startsWith(base));
  assert(!existsSync(selectedPath), "An existing attempt must never be silently repeated");
  let suffix = 1, root, runId, output;
  do {
    const n = String(suffix++).padStart(2, "0");
    root = `C:/Users/Hayden/Documents/forgeboard-nemotron35-lightning-20261022-${n}`;
    runId = `forgeboard-nemotron-checkpointed-20261022-${n}`;
    output = `src-tauri/target/real-qwen-product/${runId}`;
    assert(suffix < 100);
  } while (existsSync(root) || existsSync(output));
  const profileSource = "src-tauri/target/real-qwen-product/forgeboard-nemotron-hardened-20261021-04/data/terax-settings.json";
  const previous = JSON.parse(readFileSync(profileSource));
  const connection = previous.selfHostedInference.endpoints.find(e => e.id === "real-qwen" && e.deletedAt == null);
  assert.equal(new URL(connection.baseURL).href, endpoint + "/");
  assert.equal(connection.backendHint ?? connection.detectedBackend, "ollama");
  assert(!connection.credentialRef && !connection.ssh);
  const profile = previous.selfHostedInference.profiles.find(p => p.transportModelId === model && p.endpointId === connection.id);
  assert.equal(profile.modelRevision, digest);
  assert.deepEqual(profile.overrides, {});
  const version = await metadata("/api/version"), tags = await metadata("/api/tags"), loaded = await metadata("/api/ps");
  assert.equal(version.body.version, "0.40.5");
  assert.equal(tags.body.models.find(m => m.name === model)?.digest, digest);
  mkdirSync(root);
  execFileSync("git", ["init", "--initial-branch=main", root], { encoding: "utf8" });
  assert.deepEqual(readdirSync(root), [".git"]);
  mkdirSync(output);
  mkdirSync(output + "/data");
  copyFileSync(profileSource, output + "/data/terax-settings.json", constants.COPYFILE_EXCL);
  const names = new Set(git("ls-files", "src", "src-tauri/src", "scripts", "src-tauri/examples/hardened_agent_acceptance.rs", "src-tauri/examples/support", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "package.json", "package-lock.json", "vite.config.ts").trim().split("\n"));
  names.add("src-tauri/examples/support/checkpoint_observation.rs"); names.add("scripts/run-checkpointed-nemotron.mjs");
  const source = [...names].filter(p => /\.(tsx?|rs|mjs|json|toml|lock)$/.test(p)).sort().map(path => ({ path, sha256: hash(readFileSync(path)) }));
  const mission = readFileSync("src/test/realLocalProductAcceptance.tsx", "utf8").match(/const mission = `([\s\S]*?)`;/)[1];
  assert.equal(hash(mission), "f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801");
  const setup = { at: Date.now(), head: git("rev-parse", "HEAD").trim(), root, runId, model, digest, source,
    specificationSha256: hash(mission), route: endpoint, version, loaded,
    workspaceNameReason: "Preferred checkpointed prefix is unsupported by the existing approval allowlist. Reuse the supported disposable Nemotron prefix without editing that original dirty file.",
    controls: { reasoning: "automatic", context: "automatic", output: "automatic", fallback: "never" },
    savedConnection: { source: profileSource, sha256: hash(readFileSync(profileSource)), endpointId: connection.id,
      configurationRevision: connection.configurationRevision, profileId: profile.id, calibrationStatus: profile.contextCalibration?.status, toolStatus: profile.toolVerification?.status },
    readinessPolicy: "Existing settings copied byte-for-byte, no evidence scope/timestamp/control edits. Production decides reuse/revalidation.",
    inference: 0, productionSourceChanges: 0 };
  writeFileSync(output + "/setup.json", JSON.stringify(setup, null, 2), { flag: "wx" });
  writeFileSync(selectedPath, JSON.stringify({ root, runId, output }), { flag: "wx" });
  console.log(JSON.stringify({ root, runId, sourceFiles: source.length, savedConnection: setup.savedConnection, inference: 0 }, null, 2));
} else {
  assert.equal(process.argv[2], "run", "Choose prepare or run explicitly");
  const selected = JSON.parse(readFileSync(selectedPath));
  const setup = JSON.parse(readFileSync(selected.output + "/setup.json"));
  assert.equal(git("rev-parse", "HEAD").trim(), setup.head);
  for (const f of setup.source) assert.equal(hash(readFileSync(f.path)), f.sha256, f.path);
  const processScript = "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(clack|hardened_agent_acceptance|coworking_acceptance|cargo|rustc|rustdoc)(\\.exe)?$' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'vitest|check-hardened-local-agent|check-real-local-product') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress";
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", processScript], { encoding: "utf8", windowsHide: true });
  const isolation = raw.trim() ? JSON.parse(raw) : [];
  assert(Array.isArray(isolation) && isolation.length === 0, "Competing Clack test/build/acceptance process");
  assert.deepEqual(readdirSync(setup.root), [".git"]);
  const version = await metadata("/api/version"), tags = await metadata("/api/tags"), loaded = await metadata("/api/ps");
  assert.equal(version.body.version, "0.40.5");
  assert.equal(tags.body.models.find(m => m.name === setup.model)?.digest, setup.digest);
  writeFileSync(selected.output + "/preflight.json", JSON.stringify({ at: Date.now(), isolation, sourceHashCount: setup.source.length, version, loaded, inference: 0 }, null, 2), { flag: "wx" });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CLACK_PRODUCT_") && !key.startsWith("CLACK_STREAM_")));
  Object.assign(env, { CLACK_PRODUCT_RUN_ID: setup.runId, CLACK_PRODUCT_WORKSPACE: setup.root, CLACK_PRODUCT_MODEL: setup.model,
    CLACK_PRODUCT_DIGEST: setup.digest, CLACK_PRODUCT_TRACE: "1" });
  const startedAt = Date.now();
  const log = createWriteStream(selected.output + "/runner.log", { flags: "wx" });
  const child = spawn(process.execPath, ["scripts/check-hardened-local-agent.mjs", "mission-a", "1"], { env, windowsHide: true });
  child.stdout.on("data", b => { log.write(b); process.stdout.write(b); });
  child.stderr.on("data", b => { log.write(b); process.stderr.write(b); });
  child.once("error", error => { console.error(error); process.exitCode = 1; });
  child.once("close", (code, signal) => {
    log.end();
    writeFileSync(selected.output + "/runner-exit.json", JSON.stringify({ startedAt, endedAt: Date.now(), code, signal, runnerPid: child.pid }, null, 2), { flag: "wx" });
    process.exitCode = code ?? 1;
  });
}
