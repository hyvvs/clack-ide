// Independent R5ag acceptance evaluator. Never edits Agent-authored source.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "");
const evidence = path.resolve(process.argv[3] ?? "");
assert(process.argv[2] && process.argv[3] && root !== evidence);
const excluded = new Set([".git", "node_modules", "dist", "build", "coverage", ".cache", "data"]);
const ignoredRuntime = /^(?:notes|database|store|db|data)\.(?:json|sqlite|db)$/i;
const hashes = async (dir, prefix = "") => {
  const result = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) Object.assign(result, await hashes(path.join(dir, entry.name), relative));
    } else if (entry.isFile() && !ignoredRuntime.test(entry.name) && !entry.name.endsWith(".tsbuildinfo")) {
      const content = await readFile(path.join(dir, entry.name));
      result[relative] = createHash("sha256").update(content).digest("hex");
    }
  }
  return result;
};
const frozen = await hashes(root);
const frozenPath = path.join(evidence, "frozen-source-manifest.json");
const priorFreeze = await readFile(frozenPath, "utf8").catch(error => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (priorFreeze !== null) {
  assert.deepEqual(JSON.parse(priorFreeze), frozen, "Already-frozen source changed");
} else {
  await writeFile(frozenPath, JSON.stringify(frozen, null, 2), { flag: "wx" });
}
const report = { runId: "qwen-smoke-r5an-20261024-01", frozenFiles: Object.keys(frozen),
  checkedAt: new Date().toISOString(), checks: {} };
const check = (name, fn) => {
  try { report.checks[name] = { status: "PASS", ...fn() }; }
  catch (error) { report.checks[name] = { status: "FAIL", error: String(error?.message ?? error) }; }
};
const pkgPath = path.join(root, "package.json");
let pkg;
try { pkg = JSON.parse(await readFile(pkgPath, "utf8")); } catch {}
check("authoredTests", () => {
  assert(Object.keys(frozen).some(file => /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]s$/i.test(file)),
    "No authored automated test file");
  return { present: true };
});
check("readme", () => {
  const file = Object.keys(frozen).find(f => /^readme\.md$/i.test(f));
  assert(file, "No README.md");
  return { present: true };
});
check("runtimeIgnore", () => {
  const file = Object.keys(frozen).find(f => /^\.gitignore$/i.test(f));
  assert(file, "No .gitignore");
  return { present: true };
});
const command = (name, args, timeoutMs = 90000) => {
  const result = spawnSync(name, args, {
    cwd: root, windowsHide: true, encoding: "utf8", timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024, env: { ...process.env, CI: "true" },
  });
  return { exitCode: result.status, signal: result.signal, error: result.error?.message,
    outputTail: ((result.stdout ?? "") + "\n" + (result.stderr ?? "")).slice(-2400) };
};
const npm = args => process.platform === "win32"
  ? command(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm.cmd " + args])
  : command("npm", args.split(" "));
// npm walks up parent directories to find package.json. An empty Agent output
// MUST NOT accidentally run Clack's own test/build commands.
if (pkg) {
  const tests = npm("test");
  report.checks.actualTests = { status: tests.exitCode === 0 ? "PASS" : "FAIL", ...tests };
  const build = npm("run build");
  report.checks.productionBuild = { status: build.exitCode === 0 ? "PASS" : "FAIL", ...build };
} else {
  report.checks.actualTests = { status: "BLOCKED", reason: "Agent authored no package.json" };
  report.checks.productionBuild = { status: "BLOCKED", reason: "Agent authored no package.json" };
}
const tscPath = path.join(root, "node_modules", "typescript", "bin", "tsc");
if (await stat(tscPath).then(s => s.isFile()).catch(() => false)) {
  const types = command(process.execPath, [tscPath, "--noEmit"]);
  report.checks.typescript = { status: types.exitCode === 0 ? "PASS" : "FAIL", ...types };
} else {
  report.checks.typescript = { status: "BLOCKED", reason: "No installed local TypeScript compiler" };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const endpoint = "http://127.0.0.1:4321";
async function http(route, method = "GET", value) {
  const response = await fetch(endpoint + route, { method,
    headers: value === undefined ? undefined : { "content-type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(2500) });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}
async function start() {
  const script = pkg?.scripts?.start ? "start" : pkg?.scripts?.dev ? "dev" : null;
  assert(script, "No npm start/dev script");
  const cmd = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd run " + script] : ["run", script];
  const child = spawn(cmd, args, { cwd: root, windowsHide: true, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) break;
    try { if ((await http("/health")).status === 200) return child; } catch {}
    await sleep(400);
  }
  stop(child);
  throw new Error("Backend did not become healthy within 20s");
}
function stop(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill("SIGTERM");
}
let child;
try {
  let portOccupied = false;
  try { await http("/health"); portOccupied = true; } catch {}
  assert(!portOccupied, "Port 4321 occupied before evaluator startup");
  child = await start();
  report.checks.startup = { status: "PASS" };
  const run = async (name, fn) => {
    try { report.checks[name] = { status: "PASS", details: await fn() }; }
    catch (error) { report.checks[name] = { status: "FAIL", error: String(error?.message ?? error) }; }
  };
  await run("health", async () => { const r = await http("/health"); assert.equal(r.status, 200); return r; });
  await run("listNotes", async () => { const r = await http("/notes"); assert.equal(r.status, 200); return r; });
  let id;
  await run("createNote", async () => {
    const r = await http("/notes", "POST", { title: "R5ag acceptance note", body: "independent" });
    assert.equal(r.status, 201);
    id = r.body.id ?? r.body.note?.id;
    assert(typeof id === "string" && id.length > 0, "POST has no usable id");
    return { status: r.status, id };
  });
  if (id) {
    await run("getNote", async () => { const r = await http("/notes/" + encodeURIComponent(id)); assert.equal(r.status, 200); return r; });
    await run("patchNote", async () => {
      const r = await http("/notes/" + encodeURIComponent(id), "PATCH", { title: "Updated R5ag title" });
      assert.equal(r.status, 200); return r;
    });
  }
  await run("invalidEmptyTitle", async () => {
    const r = await http("/notes", "POST", { title: "" }); assert.equal(r.status, 400); return r;
  });
  await run("invalidLongTitle", async () => {
    const r = await http("/notes", "POST", { title: "x".repeat(121) }); assert.equal(r.status, 400); return r;
  });
  await run("missingNote", async () => {
    const r = await http("/notes/not-a-real-id"); assert.equal(r.status, 404); return r;
  });
  await run("malformedInput", async () => {
    const r = await http("/notes", "POST", { title: 123 }); assert.equal(r.status, 400); return r;
  });
  if (id) await run("deleteNote", async () => {
    const r = await http("/notes/" + encodeURIComponent(id), "DELETE");
    assert([200, 204].includes(r.status), "DELETE should succeed");
    const missing = await http("/notes/" + encodeURIComponent(id));
    assert.equal(missing.status, 404); return { status: r.status, afterDelete: missing.status };
  });
  let savedId;
  await run("persistentCreate", async () => {
    const r = await http("/notes", "POST", { title: "Persist across restart" });
    assert.equal(r.status, 201);
    savedId = r.body.id ?? r.body.note?.id;
    assert(typeof savedId === "string"); return { id: savedId, status: r.status };
  });
  stop(child); child = undefined;
  await sleep(1500);
  if (savedId) await run("persistenceAcrossRestart", async () => {
    child = await start();
    const r = await http("/notes/" + encodeURIComponent(savedId));
    assert.equal(r.status, 200);
    assert(JSON.stringify(r.body).includes("Persist across restart"), "Note body not durable");
    return { status: r.status, id: savedId };
  });
} catch (error) {
  report.checks.startup = { status: "FAIL", error: String(error?.message ?? error) };
  for (const name of ["health", "listNotes", "createNote", "getNote", "patchNote",
    "invalidEmptyTitle", "invalidLongTitle", "missingNote", "malformedInput",
    "deleteNote", "persistentCreate", "persistenceAcrossRestart"]) {
    if (!report.checks[name]) report.checks[name] = { status: "BLOCKED", reason: "No healthy backend" };
  }
} finally {
  stop(child);
}
const after = await hashes(root);
report.sourceUntouched = JSON.stringify(frozen) === JSON.stringify(after);
report.afterFileCount = Object.keys(after).length;
report.passed = Object.values(report.checks).every(c => c.status === "PASS") && report.sourceUntouched;
await writeFile(path.join(evidence, "independent-notes-check.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ passed: report.passed, sourceUntouched: report.sourceUntouched,
  checks: Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.status])) }, null, 2));
if (!report.passed) process.exitCode = 1;
