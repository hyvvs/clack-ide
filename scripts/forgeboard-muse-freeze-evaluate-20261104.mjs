/** One independent, one-shot post-termination ForgeBoard product evaluator.
 * The Clack Agent / Ollama are NEVER invoked. Generated source is NEVER edited.
 * Runtime compilation, tests and data writes happen in an evaluator-owned COPY.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateFrontend } from "./forgeboard-muse-browser-probe-20261104.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const id = "forgeboardmuse-20261104-01";
const owned = path.join(repo, "src-tauri/target/real-qwen-product", id);
const source = path.join(owned, "workspace");
const frozen = path.join(owned, "evaluation-snapshot");
const work = path.join(owned, "evaluation-working");
const receiptPath = path.join(owned, "independent-evaluation.json");
const marker = path.join(owned, "independent-evaluation.started");
const state = { runId: id, startedAt: Date.now(), frozen: [], structure: {}, commands: {}, api: {}, frontend: {}, accessibility: {}, checks: {}, errors: [], verdict: "INCOMPLETE" };
const save = async () => writeFile(receiptPath, JSON.stringify({ ...state, savedAt: Date.now() }, null, 2));
const sha = buffer => createHash("sha256").update(buffer).digest("hex");
const exists = async p => !!(await stat(p).catch(() => null));
const read = async p => readFile(p, "utf8").catch(() => "");
const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Do not accept a live/missing host in place of the terminated single mission.
const runner = JSON.parse(await readFile(path.join(owned, "mission-a-1.json"), "utf8"));
const report = JSON.parse(await readFile(path.join(owned, "mission-a-1.native-report.json"), "utf8"));
const correction = JSON.parse(await readFile(path.join(owned, "correction-state.json"), "utf8").catch(() => '{"status":"missing"}'));
state.correction = { status: correction.status, eligible: !!correction.boundary,
  confirmedWrites: correction.writes?.length ?? 0, sentOnce: correction.status === "sent" && !!correction.messageId };
assert.equal(runner.runId, id);
assert.equal(runner.nativeExit?.code, 0);
assert.equal(report.missionStarted, true);
assert.equal(report.cloudInference, 0);
await writeFile(marker, JSON.stringify({ at: state.startedAt, runner: "mission-a-1" }), { flag: "wx" });

// Hash every authored ordinary file in the original workspace (including
// README, lockfile and .gitignore) before copying. No symlink traversal.
async function inventory(directory, relative = "", depth = 0) {
  assert(depth < 24, "Unexpected source depth");
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "build", "coverage", ".next", ".vite", "data", ".turbo"].includes(item.name)) continue;
    const rel = path.join(relative, item.name), abs = path.join(directory, item.name);
    if (item.isSymbolicLink()) { state.errors.push(`Symlink omitted: ${rel}`); continue; }
    if (item.isDirectory()) await inventory(abs, rel, depth + 1);
    else if (item.isFile()) {
      const s = await stat(abs);
      if (s.size > 12 * 1024 * 1024) { state.errors.push(`Oversized source: ${rel}`); continue; }
      const data = await readFile(abs);
      state.frozen.push({ file: rel.replaceAll("\\", "/"), bytes: data.length, sha256: sha(data) });
    }
  }
}
await inventory(source);
state.frozen.sort((a, b) => a.file.localeCompare(b.file));
await save();
const excludeSnapshot = (file) => !path.relative(source, file).split(path.sep).some(segment => segment === ".git" || segment === "node_modules");
await cp(source, frozen, { recursive: true, errorOnExist: true, force: false, filter: excludeSnapshot });
await cp(frozen, work, { recursive: true, errorOnExist: true, force: false });

const files = state.frozen.map(e => e.file);
const rootPkg = JSON.parse((await readFile(path.join(work, "package.json"), "utf8").catch(() => "null")));
state.structure = {
  files,
  rootPackage: rootPkg?.name ?? null,
  rootScripts: rootPkg?.scripts ?? {},
  hasReadme: files.some(f => /^readme\.md$/i.test(f)),
  hasGitignore: files.includes(".gitignore"),
  tsFiles: files.filter(f => /\.[cm]?tsx?$/.test(f)),
  testFiles: files.filter(f => /(?:^|\/)(?:[^/]*\.)?(?:test|spec)\.[cm]?[jt]sx?$/.test(f)),
  frontendFiles: files.filter(f => /\.(?:tsx|jsx)$/.test(f) && !/(?:^|\/)(?:test|spec|__tests__)(?:\/|\.)/i.test(f)),
};
const readme = (await read(path.join(work, files.find(f => /^readme\.md$/i.test(f)) ?? "README.md")));
const gitignore = await read(path.join(work, ".gitignore"));
const scripts = rootPkg?.scripts ?? {};
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
async function run(command, args, directory = work, timeoutMs = 300000) {
  const p = spawn(command, args, { cwd: directory, env: { ...process.env, CI: "1", NODE_ENV: "test" }, windowsHide: true, shell: process.platform === "win32" });
  let stdout = "", stderr = "", timedOut = false;
  p.stdout?.on("data", c => { stdout = (stdout + c).slice(-64000); });
  p.stderr?.on("data", c => { stderr = (stderr + c).slice(-48000); });
  const timeout = setTimeout(() => { timedOut = true; killTree(p); }, timeoutMs);
  const result = await new Promise(resolve => {
    p.once("error", e => resolve({ exit: null, error: String(e), stdout, stderr, timedOut }));
    p.once("exit", code => resolve({ exit: code, stdout, stderr, timedOut }));
  });
  clearTimeout(timeout);
  return result;
}
function killTree(p) {
  if (!p?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true, timeout: 10000, stdio: "ignore" });
  else p.kill("SIGTERM");
}
const packages = (await Promise.all([".", "frontend", "client", "web", "backend", "server", "api"].map(async sub => {
  const filename = path.join(work, sub, "package.json");
  if (!await exists(filename)) return null;
  return { path: sub, package: JSON.parse(await readFile(filename, "utf8")) };
}))).filter(Boolean);
state.structure.packages = packages.map(e => ({ path: e.path, scripts: e.package.scripts ?? {}, dependencies: Object.keys(e.package.dependencies ?? {}) }));
await save();

// Never silently treat absent or zero-discovered tests as passing. npm install
// is permitted only in evaluation-working; the frozen tree remains immutable.
for (const entry of packages) {
  const directory = path.join(work, entry.path);
  const key = entry.path;
  const lock = await exists(path.join(directory, "package-lock.json"));
  if (!(await exists(path.join(directory, "node_modules")))) {
    state.commands[`${key}:install`] = await run(cmd, [lock ? "ci" : "install", "--no-audit", "--no-fund"], directory, 300000);
    await save();
  }
  if (entry.package.scripts?.typecheck) { state.commands[`${key}:typecheck`] = await run(cmd, ["run", "typecheck"], directory); await save(); }
  if (entry.package.scripts?.["check-types"]) { state.commands[`${key}:check-types`] = await run(cmd, ["run", "check-types"], directory); await save(); }
  if (entry.package.scripts?.build) { state.commands[`${key}:build`] = await run(cmd, ["run", "build"], directory); await save(); }
  if (entry.package.scripts?.test) { state.commands[`${key}:test`] = await run(cmd, ["test"], directory); await save(); }
}

// Runtime API behavior is intentionally probed independently of authored tests.
// The concrete startup/route discovery and frontend browser checks are below.
// They are evaluated on evaluation-working, never on source or frozen.
const base = "http://127.0.0.1:4317";
async function request(endpoint, method = "GET", body, timeout = 7000) {
  try {
    const response = await fetch(base + endpoint, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: response.status, json, text: text.slice(0, 1000), contentType: response.headers.get("content-type") };
  } catch (error) { return { status: null, error: error?.name ?? "network-error" }; }
}
const unwrap = (result, key) => result?.json?.[key] ?? result?.json?.data?.[key] ?? result?.json?.data ?? result?.json;
const uid = entity => entity?.id ?? entity?._id ?? null;
const ok = r => [200, 201].includes(r?.status);
const invalid = r => [400, 422].includes(r?.status) && r?.json && typeof r.json === "object";
const taskList = result => {
  const value = unwrap(result, "tasks");
  return Array.isArray(value) ? value : value?.items ?? value?.tasks ?? value?.results ?? [];
};
async function connectSse() {
  for (const endpoint of ["/api/events", "/events", "/api/stream", "/api/sse", "/api/tasks/events"]) {
    const controller = new AbortController();
    let response;
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      response = await fetch(base + endpoint, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
        controller.abort(); continue;
      }
      const reader = response.body.getReader();
      const events = [];
      let buffer = "";
      const reading = (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return;
            buffer += new TextDecoder().decode(value, { stream: true });
            while (/\r?\n\r?\n/.test(buffer)) {
              const match = /\r?\n\r?\n/.exec(buffer);
              const frame = buffer.slice(0, match.index);
              buffer = buffer.slice(match.index + match[0].length);
              const data = frame.split(/\r?\n/).filter(x => x.startsWith("data:")).map(x => x.slice(5).trim()).join("\n");
              if (!data) continue;
              try { events.push(JSON.parse(data)); }
              catch { events.push({ unstructuredText: data.slice(0, 300) }); }
            }
          }
        } catch { /* Cancellation of evaluator's own SSE subscription is expected. */ }
      })();
      return {
        endpoint,
        async finish(mutationId) {
          for (let i = 0; i < 50; i++) {
            if (events.some(e => JSON.stringify(e).includes(String(mutationId)))) break;
            await pause(140);
          }
          controller.abort(); await reading;
          return { endpoint, events: events.slice(0, 12),
            structuredMutation: events.some(e => !e.unstructuredText && JSON.stringify(e).includes(String(mutationId))) };
        },
      };
    } catch { controller.abort(); clearTimeout(timeout); }
  }
  return null;
}
let server, frontend;
async function start() {
  const choices = [
    [".", "start:backend"], [".", "start:server"], [".", "start"],
    ["backend", "start"], ["server", "start"], ["api", "start"],
    [".", "dev:backend"], ["backend", "dev"], ["server", "dev"],
  ];
  const choice = choices.find(([directory, script]) => packages.some(p => p.path === directory && !!p.package.scripts?.[script]));
  if (!choice) { state.errors.push("No runnable backend npm start script"); return false; }
  const [directory, script] = choice;
  state.api.startupCommand = { directory, script };
  server = spawn(cmd, ["run", script], { cwd: path.join(work, directory),
    env: { ...process.env, NODE_ENV: "production", PORT: "4317" }, windowsHide: true,
    shell: process.platform === "win32", stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    const response = await request("/api/projects", "GET", undefined, 900);
    if (response.status !== null) return true;
    if (server.exitCode !== null) return false;
    await pause(450);
  }
  return false;
}
async function stop() {
  if (frontend) { killTree(frontend); frontend = undefined; }
  if (!server) return;
  killTree(server); server = undefined;
  await pause(800);
}
async function startFrontend() {
  const direct = await request("/");
  if (direct.status === 200 && /text\/html/.test(direct.contentType ?? "") &&
    /<html|<div\s+id=["']root|<script/i.test(direct.text)) return base;
  const candidates = ["frontend", "client", "web", "."];
  const choice = candidates.flatMap(dir => {
    const pkg = packages.find(p => p.path === dir)?.package;
    return ["dev", "preview", "start:frontend", "start"].filter(x => pkg?.scripts?.[x] &&
      (dir !== "." || x !== "start")).map(script => [dir, script]);
  })[0];
  if (!choice) return null;
  const [directory, script] = choice;
  frontend = spawn(cmd, ["run", script, "--", "--host", "127.0.0.1", "--port", "4318"], {
    cwd: path.join(work, directory), shell: process.platform === "win32", windowsHide: true,
    env: { ...process.env, PORT: "4318", VITE_API_URL: base, NODE_ENV: "development" }, stdio: "ignore",
  });
  for (let i = 0; i < 45; i++) {
    try {
      const response = await fetch("http://127.0.0.1:4318/", { signal: AbortSignal.timeout(900) });
      if (response.ok && response.headers.get("content-type")?.includes("text/html")) return "http://127.0.0.1:4318/";
    } catch { /* frontend process starting */ }
    if (frontend.exitCode !== null) break;
    await pause(300);
  }
  return null;
}

try {
  state.api.started = await start();
  await save();
  if (state.api.started) {
    const s = state.api;
    s.initialProjects = await request("/api/projects");
    s.projectCreate = await request("/api/projects", "POST", { name: "Evaluator Project", description: "Persist and filter me" });
    const project = unwrap(s.projectCreate, "project"), projectId = uid(project);
    s.projectId = projectId;
    if (projectId != null) {
      const pid = encodeURIComponent(projectId);
      s.projectGet = await request(`/api/projects/${pid}`);
      s.projectList = await request("/api/projects");
      s.projectUpdate = await request(`/api/projects/${pid}`, "PATCH", { name: "Evaluator Project Updated" });
      s.badProjectTask = await request("/api/tasks", "POST", { projectId: "__missing-project__", title: "Invalid reference" });
      const events = await connectSse();
      s.sseConnect = { ok: !!events, endpoint: events?.endpoint ?? null };
      s.taskCreate = await request("/api/tasks", "POST", { projectId, title: "Alpha release", description: "search needle", status: "Todo", priority: "High", tags: ["alpha", "release"] });
      const task = unwrap(s.taskCreate, "task"), taskId = uid(task);
      s.taskId = taskId;
      if (events) {
        s.sseReceipt = await events.finish(taskId ?? "__no_task_id__");
        s.sseUpdate = { ok: !!taskId && s.sseReceipt.structuredMutation };
      }
      if (taskId != null) {
        const tid = encodeURIComponent(taskId);
        s.taskGet = await request(`/api/tasks/${tid}`);
        s.taskList = await request("/api/tasks");
        s.taskUpdate = await request(`/api/tasks/${tid}`, "PATCH", { status: "In Progress", priority: "Urgent", tags: ["alpha", "work"] });
        s.taskAfterUpdate = await request(`/api/tasks/${tid}`);
        s.secondTaskCreate = await request("/api/tasks", "POST", { projectId, title: "Beta documentation", description: "other text", status: "Done", priority: "Low", tags: ["beta"] });
        s.secondTaskId = uid(unwrap(s.secondTaskCreate, "task"));
        s.search = await request("/api/tasks?search=needle");
        s.projectFilter = await request(`/api/tasks?projectId=${pid}`);
        s.statusFilter = await request("/api/tasks?status=In%20Progress");
        s.priorityFilter = await request("/api/tasks?priority=Urgent");
        s.tagFilter = await request("/api/tasks?tag=alpha");
        s.combined = await request(`/api/tasks?projectId=${pid}&status=In%20Progress&priority=Urgent&tag=alpha&search=needle`);
        s.pagination = await request("/api/tasks?page=1&limit=1");
        s.paginationNext = await request("/api/tasks?page=2&limit=1");
        s.searchNegative = await request("/api/tasks?search=nonexistent-evaluator-needle");
        s.statusNegative = await request("/api/tasks?status=Done");
        s.priorityNegative = await request("/api/tasks?priority=Low");
        s.tagNegative = await request("/api/tasks?tag=beta");
        s.invalidStatus = await request(`/api/tasks/${tid}`, "PATCH", { status: "Imaginary" });
        s.invalidPriority = await request(`/api/tasks/${tid}`, "PATCH", { priority: "Imaginary" });
        s.invalidTitle = await request(`/api/tasks/${tid}`, "PATCH", { title: "x".repeat(121) });
        s.missingGet = await request("/api/tasks/__missing__");
        s.missingPatch = await request("/api/tasks/__missing__", "PATCH", { title: "x" });
        s.missingDelete = await request("/api/tasks/__missing__", "DELETE");
        s.malformed = await request("/api/tasks", "POST", "{bad-json");
        await stop();
        s.stoppedHealth = await request("/api/projects", "GET", undefined, 1000);
        s.restarted = await start();
        if (s.restarted) {
          s.persistedTask = await request(`/api/tasks/${tid}`);
          s.persistedProject = await request(`/api/projects/${pid}`);
          s.taskDelete = await request(`/api/tasks/${tid}`, "DELETE");
          s.deletedTask = await request(`/api/tasks/${tid}`);
          if (s.secondTaskId != null) {
            s.persistedSecond = await request(`/api/tasks/${encodeURIComponent(s.secondTaskId)}`);
            s.secondTaskDelete = await request(`/api/tasks/${encodeURIComponent(s.secondTaskId)}`, "DELETE");
          }
        }
      }
      s.missingProjectGet = await request("/api/projects/__missing__");
      s.missingProjectPatch = await request("/api/projects/__missing__", "PATCH", { name: "x" });
      s.missingProjectDelete = await request("/api/projects/__missing__", "DELETE");
      s.invalidProject = await request("/api/projects", "POST", { name: "" });
      // Browser drives real hydrated React controls while the evaluated local
      // backend is still live; no source edits, fake polling or mocked APIs.
      const frontendUrl = await startFrontend();
      state.frontend.startupUrl = frontendUrl;
      if (frontendUrl) {
        const probe = await evaluateFrontend({ url: frontendUrl, owned,
          apiProjects: () => request("/api/projects"), apiTasks: () => request("/api/tasks") });
        state.frontend = { ...state.frontend, ...probe };
        state.accessibility.baseline = probe.baseline;
        await save();
      }
      // Original task-page default is 50, changed to 25 ONLY if the previous
      // strict production correction observer actually dispatched once.
      if (ok(s.secondTaskCreate)) {
        s.defaultPageSizeExpected = state.correction.sentOnce ? 25 : 50;
        s.bulkCreate = [];
        for (let n = 0; n < 52; n++) {
          const r = await request("/api/tasks", "POST", { projectId, title: `Page seed ${n}`, status: "Todo", priority: "Low", tags: ["page-seed"] });
          s.bulkCreate.push({ status: r.status, id: uid(unwrap(r, "task")) });
          if (!ok(r)) break;
        }
        s.defaultFirstPage = await request("/api/tasks");
        s.defaultSecondPage = await request("/api/tasks?page=2");
        await save();
      }
      s.projectDelete = await request(`/api/projects/${pid}`, "DELETE");
      s.deletedProject = await request(`/api/projects/${pid}`);
    }
    await save();
  }
} finally { await stop(); }

// Recorded checks must be evidence-based. A frontend rendering screenshot or
// successful HTTP GET alone never establishes accessible/usable interactions.
const statuses = ["Backlog", "Todo", "In Progress", "Blocked", "Done"];
const priorities = ["Low", "Medium", "High", "Urgent"];
const s = state.api;
const containsTask = r => {
  const list = taskList(r);
  return Array.isArray(list) && list.some(v => uid(v) === s.taskId);
};
const excludesSecond = r => s.secondTaskId != null && !taskList(r).some(v => uid(v) === s.secondTaskId);
const testOutput = Object.entries(state.commands).filter(([k]) => k.endsWith(":test"));
const testNonzero = testOutput.some(([, v]) => v.exit === 0 && !/(?:No tests found|0 tests|0 passing|0 passed)/i.test(v.stdout + v.stderr) &&
  /(?:\b[1-9]\d*\s+(?:tests?|passing)|# tests\s+[1-9]|✓ |✔ |PASS\s+\S+)/i.test(v.stdout + v.stderr));
const builds = Object.entries(state.commands).filter(([k]) => k.endsWith(":build"));
const allBuildsPass = builds.length && builds.every(([, v]) => v.exit === 0);
state.checks = {
  stackReact: state.structure.frontendFiles.length > 0 && packages.some(p => !!p.package.dependencies?.react),
  stackNodeTypeScript: state.structure.tsFiles.length > 0 && packages.some(p => !!p.package.dependencies?.typescript || !!p.package.devDependencies?.typescript),
  typescript: builds.length > 0 && allBuildsPass && !Object.entries(state.commands).some(([k, v]) => /(typecheck|check-types)$/.test(k) && v.exit !== 0),
  productionFrontendBuild: !!allBuildsPass && packages.some(p => !!p.package.dependencies?.react),
  backendBuild: !!allBuildsPass,
  authoredTests: state.structure.testFiles.length > 0,
  testsDiscovered: testNonzero,
  npmTestsPass: testOutput.length > 0 && testOutput.every(([, v]) => v.exit === 0) && testNonzero,
  backendStarts: s.started === true,
  projectCreate: ok(s.projectCreate) && s.projectId != null,
  projectList: ok(s.initialProjects) && ok(s.projectList),
  projectRead: ok(s.projectGet),
  projectUpdate: ok(s.projectUpdate),
  projectDelete: [200, 204].includes(s.projectDelete?.status) && s.deletedProject?.status === 404,
  taskCreate: ok(s.taskCreate) && s.taskId != null,
  taskList: ok(s.taskList) && ok(s.secondTaskCreate) && s.secondTaskId != null,
  taskRead: ok(s.taskGet),
  taskUpdate: ok(s.taskUpdate),
  taskDelete: [200, 204].includes(s.taskDelete?.status) && s.deletedTask?.status === 404,
  projectAssociation: uid(unwrap(s.taskGet, "task")) === s.taskId && unwrap(s.taskGet, "task")?.projectId === s.projectId,
  statusPriority: statuses.includes(unwrap(s.taskAfterUpdate, "task")?.status) && priorities.includes(unwrap(s.taskAfterUpdate, "task")?.priority) && invalid(s.invalidStatus) && invalid(s.invalidPriority),
  tags: Array.isArray(unwrap(s.taskAfterUpdate, "task")?.tags) && containsTask(s.tagFilter) && excludesSecond(s.tagFilter) && taskList(s.tagNegative).some(v => uid(v) === s.secondTaskId),
  validation: invalid(s.invalidProject) && invalid(s.invalidTitle) && invalid(s.malformed) && invalid(s.badProjectTask),
  missingIds: [s.missingGet, s.missingPatch, s.missingDelete, s.missingProjectGet, s.missingProjectPatch, s.missingProjectDelete].every(v => v?.status === 404),
  search: containsTask(s.search) && excludesSecond(s.search) && !containsTask(s.searchNegative),
  projectFilter: containsTask(s.projectFilter) && taskList(s.projectFilter).some(v => uid(v) === s.secondTaskId),
  statusFilter: containsTask(s.statusFilter) && excludesSecond(s.statusFilter) && taskList(s.statusNegative).some(v => uid(v) === s.secondTaskId),
  priorityFilter: containsTask(s.priorityFilter) && excludesSecond(s.priorityFilter) && taskList(s.priorityNegative).some(v => uid(v) === s.secondTaskId),
  combinedFilters: containsTask(s.combined) && excludesSecond(s.combined),
  pagination: s.pagination?.status === 200 && s.paginationNext?.status === 200 &&
    taskList(s.pagination).length === 1 && taskList(s.paginationNext).length === 1 &&
    uid(taskList(s.pagination)[0]) !== uid(taskList(s.paginationNext)[0]) &&
    [uid(taskList(s.pagination)[0]), uid(taskList(s.paginationNext)[0])].includes(s.taskId) &&
    [uid(taskList(s.pagination)[0]), uid(taskList(s.paginationNext)[0])].includes(s.secondTaskId),
  defaultPageSize: s.bulkCreate?.length === 52 && s.bulkCreate.every(r => [200, 201].includes(r.status) && r.id != null) &&
    taskList(s.defaultFirstPage).length === s.defaultPageSizeExpected && taskList(s.defaultSecondPage).length > 0,
  persistence: s.stoppedHealth?.status === null && s.restarted === true && ok(s.persistedTask) && ok(s.persistedProject) && ok(s.persistedSecond),
  sseConnect: state.api.sseConnect?.ok === true,
  sseUpdate: state.api.sseUpdate?.ok === true,
  frontendUsable: state.frontend.browserWorkflows?.passed === true,
  accessibility: state.accessibility.baseline?.passed === true,
  readme: state.structure.hasReadme && /npm (?:install|ci)/i.test(readme) && /npm (?:run\s+build|test|start)/i.test(readme) && /SSE|event.stream|EventSource/i.test(readme) && /persis|data.*file|sqlite/i.test(readme),
  gitignore: state.structure.hasGitignore && /node_modules/.test(gitignore) && /(data|\.db|\.json|\.sqlite)/i.test(gitignore),
  nativeAgent: runner.totalNativeDispatches > 0 && report.cloudInference === 0 && report.sessions?.some(x => x.id === "real-mission-a" && x.run?.state === "completed"),
  noExternalModel: report.cloudInference === 0 && !state.structure.files.some(f => /\.(?:env|pem|key)$/i.test(f)),
};
state.verdict = Object.values(state.checks).every(Boolean) ? "FORGEBOARD_PASS" : "FORGEBOARD_FAIL";
await save();
console.log(JSON.stringify({ verdict: state.verdict, checks: state.checks, files: state.frozen.length,
  errors: state.errors, commands: Object.fromEntries(Object.entries(state.commands).map(([k, v]) => [k, v.exit])) }, null, 2));
