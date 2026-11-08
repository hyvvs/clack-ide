import ts from "typescript";

const METHODS = new Set(["get", "post", "patch", "put", "delete"]);
const RESOURCES = ["projects", "tasks"];

function staticText(node) {
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function identifier(node) {
  return node && ts.isIdentifier(node) ? node.text : null;
}

function joinPath(prefix, route) {
  const joined = `${prefix || ""}/${route || ""}`.replace(/\/+/g, "/");
  const normalized = joined.startsWith("/") ? joined : `/${joined}`;
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function parseSource({ path = "backend.ts", source }) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    /\.tsx?$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
  const mounts = new Map();
  const calls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text.toLowerCase();
      const receiver = identifier(node.expression.expression);
      if (method === "use" && receiver === "app" && node.arguments.length >= 2) {
        const prefix = staticText(node.arguments[0]);
        const router = identifier(node.arguments[1]);
        if (prefix !== null && router) {
          const list = mounts.get(router) ?? [];
          list.push(prefix);
          mounts.set(router, list);
        }
      }
      if (METHODS.has(method) && receiver && node.arguments.length >= 2) {
        const route = staticText(node.arguments[0]);
        if (route !== null) calls.push({ receiver, method: method.toUpperCase(), route,
          handler: node.arguments.slice(1).map(arg => arg.getText(file)).join("\n"), file: path });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const routes = [];
  for (const call of calls) {
    const prefixes = call.receiver === "app" ? [""] : mounts.get(call.receiver);
    if (!prefixes?.length) continue;
    for (const prefix of prefixes) routes.push({ ...call, path: joinPath(prefix, call.route) });
  }
  return routes;
}

function call(handler, name) {
  return new RegExp(`(?:^|[^A-Za-z0-9_$])${name}\\s*\\(`).test(handler);
}
function status(handler, code) {
  const compact = handler.replace(/\s+/g, "");
  return compact.includes(`status(${code})`) || compact.includes(`sendStatus(${code})`)
    || compact.includes(`jsonError(res,${code},`);
}
function itemPath(path, base) {
  const rest = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : "";
  return !!rest && !rest.includes("/") && rest.startsWith(":");
}

function routeAt(routes, method, path) {
  return routes.find(route => route.method === method && route.path === path);
}
function itemRouteAt(routes, method, base) {
  return routes.find(route => route.method === method && itemPath(route.path, base));
}

function candidateFor(routes, resource, base) {
  const isProject = resource === "projects";
  const list = routeAt(routes, "GET", base);
  const create = routeAt(routes, "POST", base);
  const read = itemRouteAt(routes, "GET", base);
  const update = itemRouteAt(routes, "PATCH", base) ?? itemRouteAt(routes, "PUT", base);
  const remove = itemRouteAt(routes, "DELETE", base);
  const methods = {
    list: !!list && call(list.handler, isProject ? "listProjects" : "listTasks"),
    create: !!create && call(create.handler, isProject ? "createProject" : "createTask"),
    read: !!read && call(read.handler, isProject ? "getProject" : "getTask") && status(read.handler, 404),
    update: !!update && call(update.handler, isProject ? "updateProject" : "updateTask") && status(update.handler, 404),
    delete: !!remove && call(remove.handler, isProject ? "deleteProject" : "deleteTask") && status(remove.handler, 404),
  };
  if (isProject) {
    methods.createValidation = !!create && /createProjectSchema\s*\.\s*safeParse\s*\(/.test(create.handler);
    methods.updateValidation = !!update && /updateProjectSchema\s*\.\s*safeParse\s*\(/.test(update.handler);
    methods.missingIds = methods.read && methods.update && methods.delete;
  } else {
    methods.listFilters = !!list && /filterSchema\s*\.\s*safeParse\s*\(/.test(list.handler);
    methods.createValidation = !!create && /createTaskSchema\s*\.\s*safeParse\s*\(/.test(create.handler);
    methods.updateValidation = !!update && /updateTaskSchema\s*\.\s*safeParse\s*\(/.test(update.handler);
    methods.projectAssociation = !!create && call(create.handler, "getProject") && /projectId/.test(create.handler);
    methods.missingIds = methods.read && methods.update && methods.delete;
  }
  const complete = Object.values(methods).every(Boolean);
  return { basePath: base, itemPath: `${base}/:id`, methods, complete,
    evidence: Object.fromEntries(Object.entries({ list, create, read, update, delete: remove })
      .map(([key, route]) => [key, route ? { method: route.method, path: route.path, file: route.file } : null])) };
}

function serviceSemantics(allSource, sources) {
  const serviceSource = sources.find(item => /(?:export\s+)?(?:async\s+)?function\s+listTasks\b/.test(item.source))?.source ?? allSource;
  const listTasks = serviceSource.match(/(?:export\s+)?(?:async\s+)?function\s+listTasks\b[\s\S]*?(?=(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(|$)/)?.[0] ?? "";
  const hasFilter = key => new RegExp(`filters\\.${key}\\b`).test(listTasks);
  const storeSource = allSource;
  return {
    taskSearch: hasFilter("search") && /toLowerCase\s*\(\s*\)/.test(listTasks),
    projectFilter: hasFilter("projectId"),
    statusFilter: hasFilter("status"),
    priorityFilter: hasFilter("priority"),
    tagFilter: hasFilter("tags") || hasFilter("tag"),
    pagination: hasFilter("page") && hasFilter("limit") && /\.slice\s*\(/.test(listTasks),
    persistence: /readStore\s*\(/.test(allSource) && /writeStore\s*\(/.test(allSource)
      && /readFile\s*\(/.test(storeSource) && /writeFile\s*\(/.test(storeSource) && /rename\s*\(/.test(storeSource),
    mutationEvents: /broadcast\s*\(/.test(allSource),
    tagFilterKey: /\btags\s*:\s*z\s*\.\s*array/.test(allSource) ? "tags"
      : /\btag\s*:\s*z\s*\./.test(allSource) ? "tag" : null,
    tagFilterRepeated: /\btags\s*:\s*z\s*\.\s*array/.test(allSource),
  };
}

function documentedRouteReferences(readme) {
  const pattern = /(?:(GET|POST|PATCH|PUT|DELETE|SSE)\s+)?(?:[`"'(]\s*)?(\/(?:[A-Za-z0-9._~-]+\/)*(?:projects|tasks|events?)(?:\/(?::[A-Za-z][A-Za-z0-9_-]*|\{[A-Za-z][A-Za-z0-9_-]*\}))?)(?=[\s`"')?#]|$)/gi;
  const references = [];
  for (const match of readme.matchAll(pattern)) {
    const method = match[1]?.toUpperCase() === "SSE" ? "GET" : match[1]?.toUpperCase() ?? null;
    const path = joinPath("", match[2].replace(/\{([^}]+)\}/g, ":$1"));
    references.push({ method, path });
  }
  return [...new Map(references.map(reference => [`${reference.method ?? "*"} ${reference.path}`, reference])).values()];
}

function referencesForResource(references, resource) {
  const suffix = resource === "events" ? /\/(?:events?)$/ : new RegExp(`/${resource}(?:$|/:)`);
  return references.filter(reference => suffix.test(reference.path));
}

function chooseResourceCandidate(candidates, references) {
  const complete = candidates.filter(candidate => candidate.complete);
  const documentedBases = new Set(references.map(reference => reference.path.replace(/\/:([^/]+)$/, "")));
  const documentedMatches = complete.filter(candidate => documentedBases.has(candidate.basePath));
  if (documentedMatches.length > 0) return documentedMatches[0];
  if (complete.length > 0) return complete[0];
  return [...candidates].sort((a, b) =>
    Object.values(b.methods).filter(Boolean).length - Object.values(a.methods).filter(Boolean).length
  )[0] ?? null;
}

function chooseSseCandidate(routes, references) {
  const candidates = routes.filter(route => route.method === "GET" && !route.path.includes(":" )
    && (/events?|stream|sse/i.test(route.path))
    && ((call(route.handler, "addClient") && call(route.handler, "removeClient"))
      || (/text\/event-stream/.test(route.handler) && /\.write\s*\(/.test(route.handler))))
    .map(route => ({ path: route.path, method: "GET", file: route.file,
      implementation: call(route.handler, "addClient") ? "registered-client" : "direct-event-stream" }));
  const documentedMatches = candidates.filter(candidate => references.some(reference =>
    reference.path === candidate.path && (!reference.method || reference.method === "GET")));
  if (documentedMatches.length > 0) return documentedMatches[0];
  return candidates[0] ?? null;
}

export function discoverForgeBoardRouteContract({ backendSources = [], frontendSources = [], readme = "" } = {}) {
  const routes = backendSources.flatMap(parseSource);
  const allSource = backendSources.map(item => item.source).join("\n");
  // Backend registration is authoritative. README/API references are checked
  // against those registrations; frontend strings never select an endpoint.
  void frontendSources;
  const documentationRoutes = documentedRouteReferences(readme);
  const documentationMismatches = documentationRoutes.filter(reference =>
    !routes.some(route => route.path === reference.path && (!reference.method || route.method === reference.method)));
  const resources = {};
  for (const resource of RESOURCES) {
    const suffix = `/${resource}`;
    const bases = [...new Set(routes.map(route => route.path).filter(path => path.endsWith(suffix)))];
    const candidates = bases.map(base => candidateFor(routes, resource, base));
    const selected = chooseResourceCandidate(candidates, referencesForResource(documentationRoutes, resource));
    resources[resource] = selected ?? { basePath: null, itemPath: null, methods: {}, complete: false,
      evidence: {}, candidates };
  }
  const semantics = serviceSemantics(allSource, backendSources);
  const events = chooseSseCandidate(routes, referencesForResource(documentationRoutes, "events"));
  const errors = [];
  for (const resource of RESOURCES) if (!resources[resource].complete)
    errors.push(`${resource} route set is missing required CRUD methods or handler semantics`);
  if (!events) errors.push("SSE route is missing a verified event-stream implementation");
  for (const reference of documentationMismatches)
    errors.push(`README/API documentation route is not registered by the backend: ${reference.method ?? "*"} ${reference.path}`);
  for (const key of ["taskSearch", "projectFilter", "statusFilter", "priorityFilter", "tagFilter", "pagination", "persistence", "mutationEvents"])
    if (!semantics[key]) errors.push(`backend source semantics missing: ${key}`);
  return {
    ok: errors.length === 0,
    projects: resources.projects,
    tasks: resources.tasks,
    events,
    semantics,
    documentation: { routes: documentationRoutes, mismatches: documentationMismatches },
    errors,
    routeCount: routes.length,
    routes: routes.map(({ method, path, file }) => ({ method, path, file })),
  };
}

export function taskFilterPath(contract, values) {
  const base = contract?.tasks?.basePath;
  if (!base || !contract.semantics?.tagFilterKey) throw new Error("Task filter route contract is unavailable");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (key === "tag") {
      const field = contract.semantics.tagFilterKey;
      if (contract.semantics.tagFilterRepeated) {
        for (const tag of Array.isArray(value) ? value : [value]) params.append(field, String(tag));
      } else params.set(field, Array.isArray(value) ? String(value[0] ?? "") : String(value));
    } else params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
