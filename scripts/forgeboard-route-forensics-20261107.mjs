import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverForgeBoardRouteContract } from "./forgeboard-route-contract.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const id = "forgeboardmuse-20261107-01";
const root = path.join(repo, "src-tauri/target/real-qwen-product", id);
const source = path.join(root, "evaluation-snapshot");
const copy = path.join(root, "route-forensics-copy");
const marker = path.join(root, "route-forensics.started");
const reportPath = path.join(root, "route-forensics.json");
const sha = value => createHash("sha256").update(value).digest("hex");
const refresh = process.argv.includes("--refresh");

if (refresh) {
  await readFile(marker);
  await readdir(copy);
} else {
  await writeFile(marker, JSON.stringify({ at: Date.now(), mode: "offline-source-only" }), { flag: "wx" });
  await cp(source, copy, { recursive: true, errorOnExist: true, force: false,
    filter: src => !src.split(path.sep).some(part => [".git", "node_modules", "dist", "build", "coverage"].includes(part)) });
}

async function inventory(directory, relative = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(relative, entry.name), absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in forensic copy: ${name}`);
    if (entry.isDirectory()) files.push(...await inventory(absolute, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}
const files = (await inventory(copy)).sort();
const originalFiles = (await inventory(source)).sort();
assert.deepEqual(files, originalFiles, "analysis copy inventory differs from frozen snapshot");
const entries = await Promise.all(files.filter(file => /\.[cm]?[jt]sx?$/.test(file)).map(async file => ({
  path: file.replaceAll("\\", "/"), source: await readFile(path.join(copy, file), "utf8"),
})));
const frontend = entries.filter(entry => /(?:^|\/)(?:frontend|client|web)(?:\/|$)/i.test(entry.path)).map(entry => entry.source);
const readme = await readFile(path.join(copy, files.find(file => /^readme\.md$/i.test(file)) ?? "README.md"), "utf8").catch(() => "");
const routes = discoverForgeBoardRouteContract({ backendSources: entries, frontendSources: frontend, readme });
const sourceHashes = await Promise.all(files.map(async file => ({
  file: file.replaceAll("\\", "/"),
  frozen: sha(await readFile(path.join(source, file))),
  analysisCopy: sha(await readFile(path.join(copy, file))),
})));
assert(sourceHashes.every(item => item.frozen === item.analysisCopy), "forensic copy changed source bytes");

const server = await readFile(path.join(copy, "backend/src/server.ts"), "utf8");
const service = await readFile(path.join(copy, "backend/src/service.ts"), "utf8");
const validation = await readFile(path.join(copy, "backend/src/validation.ts"), "utf8");
const store = await readFile(path.join(copy, "backend/src/store.ts"), "utf8");
const frontendApi = await readFile(path.join(copy, "frontend/src/api.ts"), "utf8");
const app = await readFile(path.join(copy, "frontend/src/App.tsx"), "utf8");
const missionSource = await readFile(path.join(repo, "src/test/forgeboardMuseAgent20261104.tsx"), "utf8");
const mission = missionSource.match(/const mission = `([\s\S]*?)`;/)?.[1] ?? "";
const output = {
  runId: id,
  mode: "offline-source-only; no application server, npm install, build, tests, browser, model or network request",
  sourceInventory: { files: files.length, exactByteMatches: sourceHashes.length },
  discoveredRouteContract: routes,
  authoredBackend: {
    projects: { list: /app\.get\('\/projects'/.test(server), create: /app\.post\('\/projects'/.test(server),
      read: /app\.get\('\/projects\/:id'/.test(server), update: /app\.patch\('\/projects\/:id'/.test(server),
      delete: /app\.delete\('\/projects\/:id'/.test(server) },
    tasks: { list: /app\.get\('\/tasks'/.test(server), create: /app\.post\('\/tasks'/.test(server),
      read: /app\.get\('\/tasks\/:id'/.test(server), update: /app\.patch\('\/tasks\/:id'/.test(server),
      delete: /app\.delete\('\/tasks\/:id'/.test(server), association: /getProject\(parsed\.data\.projectId\)/.test(server) },
    validation: { projectSchema: /createProjectSchema/.test(server), taskSchema: /createTaskSchema/.test(server),
      filterSchema: /filterSchema\.safeParse/.test(server), tagsArray: /tags:\s*z\.array/.test(validation) },
    serviceFilters: { projectId: /filters\.projectId/.test(service), status: /filters\.status/.test(service),
      priority: /filters\.priority/.test(service), tags: /filters\.tags/.test(service),
      search: /filters\.search/.test(service), pagination: /filters\.page/.test(service) && /filters\.limit/.test(service) && /\.slice\(/.test(service) },
    persistence: { reads: /fs\.readFile/.test(store), writes: /fs\.writeFile/.test(store), atomicRename: /fs\.rename/.test(store) },
    sse: { route: /app\.get\('\/events'/.test(server), clients: /addClient/.test(server) && /removeClient/.test(server),
      mutationBroadcast: /broadcast\(/.test(service) },
  },
  authoredFrontend: {
    APIBase: frontendApi.match(/const API = ['"]([^'"]+)/)?.[1] ?? null,
    projectPath: frontendApi.match(/listProjects:[^\n]+/)?.[0] ?? null,
    taskPath: frontendApi.match(/listTasks:[^\n]+/)?.[0] ?? null,
    explicitPage50: /limit:\s*'50'/.test(app),
    missingComponents: ["frontend/src/components/Projects.tsx", "frontend/src/components/Tasks.tsx"].filter(file => !files.includes(file)),
  },
  missionRequiresApiPrefix: /\/api\//.test(mission),
  historicalVerdictUnchanged: "FORGEBOARD_FAIL; this source-only route analysis is not an acceptance evaluation",
  sourceHashes,
  runtimeStarted: false,
  inference: false,
};
await writeFile(reportPath, JSON.stringify(output, null, 2), { flag: refresh ? "w" : "wx" });
console.log(JSON.stringify({ reportPath, routeContract: routes.ok,
  projects: routes.projects.basePath, tasks: routes.tasks.basePath, events: routes.events?.path,
  routeErrors: routes.errors, sourceFiles: files.length, hashesMatch: true,
  missionRequiresApiPrefix: output.missionRequiresApiPrefix,
  sourceFilterEvidence: routes.semantics }, null, 2));
