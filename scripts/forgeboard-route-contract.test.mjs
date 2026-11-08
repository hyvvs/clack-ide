import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { discoverForgeBoardRouteContract, taskFilterPath } from "./forgeboard-route-contract.mjs";

function fixture(prefix = "") {
  const route = path => `${prefix}${path}`;
  const backend = `
    const app = express();
    app.get('${route("/projects")}', async (_req, res) => { const rows = await svc.listProjects(); res.json({data: rows}); });
    app.post('${route("/projects")}', async (req, res) => { const parsed = createProjectSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({error:'invalid'}); const row = await svc.createProject(parsed.data); res.status(201).json({data:row}); });
    app.get('${route("/projects/:id")}', async (req, res) => { const row = await svc.getProject(req.params.id); if (!row) return res.status(404).json({error:'missing'}); res.json({data:row}); });
    app.patch('${route("/projects/:id")}', async (req, res) => { const parsed = updateProjectSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({error:'invalid'}); const row = await svc.updateProject(req.params.id, parsed.data); if (!row) return res.status(404).json({error:'missing'}); res.json({data:row}); });
    app.delete('${route("/projects/:id")}', async (req, res) => { const ok = await svc.deleteProject(req.params.id); if (!ok) return res.status(404).json({error:'missing'}); res.status(204).send(); });
    app.get('${route("/tasks")}', async (req, res) => { const parsed = filterSchema.safeParse(req.query); if (!parsed.success) return res.status(400).json({error:'invalid'}); const rows = await svc.listTasks(parsed.data); res.json({data:rows.items}); });
    app.post('${route("/tasks")}', async (req, res) => { const parsed = createTaskSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({error:'invalid'}); const project = await svc.getProject(parsed.data.projectId); if (!project) return res.status(400).json({error:'project'}); const row = await svc.createTask(parsed.data); res.status(201).json({data:row}); });
    app.get('${route("/tasks/:id")}', async (req, res) => { const row = await svc.getTask(req.params.id); if (!row) return res.status(404).json({error:'missing'}); res.json({data:row}); });
    app.patch('${route("/tasks/:id")}', async (req, res) => { const parsed = updateTaskSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({error:'invalid'}); const row = await svc.updateTask(req.params.id, parsed.data); if (!row) return res.status(404).json({error:'missing'}); res.json({data:row}); });
    app.delete('${route("/tasks/:id")}', async (req, res) => { const ok = await svc.deleteTask(req.params.id); if (!ok) return res.status(404).json({error:'missing'}); res.status(204).send(); });
    app.get('${route("/events")}', (req, res) => { addClient(res, 'client'); req.on('close', () => removeClient(res)); });
  `;
  const service = `
    export async function listTasks(filters) {
      let tasks = await readStore();
      if (filters.projectId) tasks = tasks.filter(t => t.projectId === filters.projectId);
      if (filters.status) tasks = tasks.filter(t => t.status === filters.status);
      if (filters.priority) tasks = tasks.filter(t => t.priority === filters.priority);
      if (filters.tags) tasks = tasks.filter(t => filters.tags.every(tag => t.tags.includes(tag)));
      if (filters.search) tasks = tasks.filter(t => t.title.toLowerCase().includes(filters.search.toLowerCase()));
      const start = (filters.page - 1) * filters.limit; return tasks.slice(start, start + filters.limit);
    }
    export async function createProject(x) { await writeStore(x); broadcast('projects', x); }
    export async function listProjects() { return readStore(); }
    export async function getProject(id) { return readStore(id); }
    export async function updateProject(id,x) { await writeStore(x); return x; }
    export async function deleteProject(id) { await writeStore(id); return true; }
    export async function createTask(x) { await writeStore(x); broadcast('tasks', x); }
    export async function getTask(id) { return readStore(id); }
    export async function updateTask(id,x) { await writeStore(x); return x; }
    export async function deleteTask(id) { await writeStore(id); return true; }
  `;
  const store = `import { promises as fs } from 'fs'; async function readStore(){return fs.readFile('db')} async function writeStore(x){await fs.writeFile('db',x); await fs.rename('tmp','db')}`;
  const validation = `export const filterSchema = z.object({projectId:z.string().optional(),status:z.string().optional(),priority:z.string().optional(),tags:z.array(z.string()).optional(),search:z.string().optional(),page:z.number(),limit:z.number()})`;
  return {
    backendSources: [
      { path: "backend/src/server.ts", source: backend },
      { path: "backend/src/service.ts", source: service },
      { path: "backend/src/store.ts", source: store },
      { path: "backend/src/validation.ts", source: validation },
    ],
    frontendSources: [`export const api={listProjects:()=>req('${route("/projects")}'),listTasks:()=>req('${route("/tasks")}')}`],
  };
}

describe("ForgeBoard API route contract discovery", () => {
  it("discovers and verifies a valid unprefixed projects/tasks/SSE API", () => {
    const contract = discoverForgeBoardRouteContract(fixture());
    expect(contract.ok).toBe(true);
    expect(contract.projects).toMatchObject({ basePath: "/projects", complete: true });
    expect(contract.tasks).toMatchObject({ basePath: "/tasks", complete: true });
    expect(contract.events).toMatchObject({ path: "/events", method: "GET" });
    expect(taskFilterPath(contract, { tag: ["alpha", "release"], projectId: "p", search: "needle" }))
      .toBe("/tasks?tags=alpha&tags=release&projectId=p&search=needle");
  });

  it("discovers and verifies a valid /api-prefixed projects/tasks/SSE API", () => {
    const contract = discoverForgeBoardRouteContract(fixture("/api"));
    expect(contract.ok).toBe(true);
    expect(contract.projects.basePath).toBe("/api/projects");
    expect(contract.tasks.basePath).toBe("/api/tasks");
    expect(contract.events.path).toBe("/api/events");
    expect(taskFilterPath(contract, { tag: ["alpha", "release"] })).toBe("/api/tasks?tags=alpha&tags=release");
  });

  it("cross-checks documented routes against source without letting stale docs override registration", () => {
    const documented = discoverForgeBoardRouteContract({
      ...fixture(),
      readme: "API: `GET /projects`, `POST /projects`, `GET /tasks`, and `SSE /events`.",
    });
    expect(documented.ok).toBe(true);
    expect(documented.documentation.mismatches).toEqual([]);

    const stale = discoverForgeBoardRouteContract({
      ...fixture(),
      readme: "API: `GET /api/projects`.",
    });
    expect(stale.projects.basePath).toBe("/projects");
    expect(stale.documentation.mismatches).toEqual([{ method: "GET", path: "/api/projects" }]);
    expect(stale.ok).toBe(false);
  });

  it("discovers a recognized router-mounted prefix from actual registration", () => {
    const full = fixture();
    full.backendSources[0].source = full.backendSources[0].source
      .replace("const app = express();", "const app = express(); const api = express.Router(); app.use('/api', api);")
      .replace(/app\.(get|post|patch|delete)\(/g, "api.$1(");
    const contract = discoverForgeBoardRouteContract(full);
    expect(contract.ok).toBe(true);
    expect(contract.projects.basePath).toBe("/api/projects");
    expect(contract.tasks.basePath).toBe("/api/tasks");
    expect(contract.events.path).toBe("/api/events");
  });

  it("accepts both equivalent route families when both are actually registered", () => {
    const unprefixed = fixture();
    const prefixed = fixture("/api");
    const contract = discoverForgeBoardRouteContract({
      backendSources: [...unprefixed.backendSources, ...prefixed.backendSources],
    });
    expect(contract.ok).toBe(true);
    expect(["/projects", "/api/projects"]).toContain(contract.projects.basePath);
    expect(["/tasks", "/api/tasks"]).toContain(contract.tasks.basePath);
    expect(["/events", "/api/events"]).toContain(contract.events.path);
  });

  it("fails when project/task/SSE API routes are missing", () => {
    const contract = discoverForgeBoardRouteContract({ backendSources: [{ path: "server.ts", source: "const app=express(); app.get('/health', (_q,r)=>r.json({ok:true}));" }] });
    expect(contract.ok).toBe(false);
    expect(contract.projects.complete).toBe(false);
    expect(contract.tasks.complete).toBe(false);
    expect(contract.events).toBeNull();
  });

  it("fails partial route sets even when a collection endpoint exists", () => {
    const full = fixture();
    full.backendSources[0].source = full.backendSources[0].source
      .replace(/app\.(?:post|patch|delete)\('\/projects[^\n]*\n/g, "")
      .replace(/app\.get\('\/projects\/:id[^\n]*\n/g, "")
      .replace(/app\.(?:post|patch|delete)\('\/tasks[^\n]*\n/g, "")
      .replace(/app\.get\('\/tasks\/:id[^\n]*\n/g, "")
      .replace(/app\.get\('\/events[^\n]*\n/g, "");
    const contract = discoverForgeBoardRouteContract(full);
    expect(contract.ok).toBe(false);
    expect(contract.projects.methods.list).toBe(true);
    expect(contract.projects.complete).toBe(false);
    expect(contract.tasks.complete).toBe(false);
  });

  it("rejects routes that return 200 but do not implement the required resource semantics", () => {
    const full = fixture();
    full.backendSources[0].source = full.backendSources[0].source.replace(/svc\.\w+\(/g, "unrelated(");
    const contract = discoverForgeBoardRouteContract(full);
    expect(contract.ok).toBe(false);
    expect(contract.projects.complete).toBe(false);
    expect(contract.tasks.complete).toBe(false);
  });

  it("does not accept a JSON health route as the required SSE event stream", () => {
    const full = fixture();
    full.backendSources[0].source = full.backendSources[0].source
      .replace(/app\.get\('\/events',[\s\S]*?\);\n/, "app.get('/events', (_req, res) => res.json({ok:true}));\n");
    const contract = discoverForgeBoardRouteContract(full);
    expect(contract.events).toBeNull();
    expect(contract.ok).toBe(false);
    expect(contract.errors).toContain("SSE route is missing a verified event-stream implementation");
  });

  it("keeps the frozen evaluator bound to discovered route paths, not a hard-coded /api prefix", async () => {
    const evaluator = await readFile(new URL("./forgeboard-muse-instrumented-freeze-20261107.mjs", import.meta.url), "utf8");
    const browserProbe = await readFile(new URL("./forgeboard-muse-browser-probe-20261104.mjs", import.meta.url), "utf8");
    expect(evaluator).toContain("discoverForgeBoardRouteContract");
    expect(evaluator).toContain("const projectBase = state.api.routeContract.projects.basePath");
    expect(evaluator).toContain("const taskBase = state.api.routeContract.tasks.basePath");
    expect(evaluator).toContain("state.api.routeContract.events?.path");
    expect(evaluator).toContain("apiRouteContract: s.routeContract?.ok === true");
    expect(evaluator).not.toContain('"/api/projects"');
    expect(evaluator).not.toContain('"/api/tasks"');
    expect(evaluator).not.toContain('"/api/events"');
    expect(browserProbe).not.toContain('"/api/projects"');
    expect(browserProbe).not.toContain('"/api/tasks"');
    expect(browserProbe).not.toContain('"/api/events"');
  });
});
