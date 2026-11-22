import { asSchema, type ToolSet } from "ai";
import { toolRevisionIdentity } from "@/modules/ai/lib/toolExposure";
import { ContextBudgetError } from "@/modules/ai/lib/contextBudget";
import type { CapturedToolVersion, ToolBinding, ToolDefinition, ToolRegistryView } from "@/modules/ai/lib/customTools";
import { builtinToolSecurity, unknownToolSecurity,
  type ToolRegistrySecurity, type ToolSideEffect } from "@/modules/ai/lib/toolFabricPolicy";

// Discovery is not authorization. Only the original AI SDK/Tauri/Rust tool can execute.
export const CAPABILITY_INDEX_LIMITS = {
  entries: 4096,
  results: 64,
  queryCharacters: 1024,
  providerCandidates: 192,
} as const;
export type CapabilitySource =
  | "builtin" | "custom" | "remote-mcp" | "local-mcp" | "wasi" | "integration";
export type CapabilityRoute =
  | { kind: "builtin"; name: string }
  | { kind: "native-custom"; reference: CapturedToolVersion };
/** One normalized view over the EXISTING builtin/T1/T2/MCP owners.
 * The registry is descriptive, not an authorization or alternate executor. */
export type ToolPermissionClass =
  | "read-only" | "workspace-effect" | "external-effect" | "sensitive";
export type ToolEffectClass =
  | "none" | "workspace" | "external" | "unknown";
export type ToolQualification =
  | "available" | "needs-approval" | "unavailable" | "unknown";
export type ToolFabricMetadata = {
  semanticCapability: string;
  permissionClass: ToolPermissionClass;
  effectClass: ToolEffectClass;
  latencyClass: "short" | "medium" | "long" | "unknown";
  costClass: "none" | "provider-billed" | "unknown";
  authentication: "none" | "runtime-owned" | "unknown";
  qualification: ToolQualification;
  availability: "available" | "unavailable";
};
export type CapabilityContract = {
  id: string;
  qualifiedName: string;
  callableName: string;
  nativeName: string;
  nativeOperation: string | null;
  displayName: string;
  description: string;
  source: CapabilitySource;
  sourceOwner: string;
  origin: string;
  workspaceId: string | null;
  scope: string;
  agents: readonly string[];
  conversations: readonly string[];
  permissions: readonly string[];
  hints: { read: boolean; write: boolean; destructive: boolean; openWorld: boolean };
  available: boolean;
  enabled: boolean;
  revision: string;
  route: CapabilityRoute;
  inputSchema: unknown;
  result: { outputSchema: unknown; description: string; supportedFormats: readonly string[] };
  discovery: { summary: string; terms: readonly string[] };
  fabric: ToolFabricMetadata;
  /** TF's canonical conservative security metadata in the EXISTING registry.
   * Catalog visibility never grants an execution token or user approval. */
  security: ToolRegistrySecurity;
};
export type CapabilitySearch = {
  query?: string;
  source?: CapabilitySource;
  sourceOwner?: string;
  workspaceId?: string;
  enabledOnly?: boolean;
  limit?: number;
  offset?: number;
};
export type CapabilitySeed = Omit<CapabilityContract, "id" | "qualifiedName" | "discovery" | "fabric" | "security"> & { fabric?: ToolFabricMetadata; security?: ToolRegistrySecurity };
export type CompactCapability = Pick<CapabilityContract,
  "id" | "callableName" | "nativeName" | "displayName" | "source" |
  "sourceOwner" | "origin" | "available" | "enabled" | "revision"> & {
    summary: string;
  };

const semanticNames: Readonly<Record<string, string>> = {
  read_file: "read_file", list_directory: "list_directory",
  grep: "search_repository", glob: "search_repository",
  write_file: "write_file", edit: "edit_file", multi_edit: "edit_file",
  create_directory: "create_directory",
  tf_fs_read: "read_file", tf_fs_write: "write_file",
  tf_fs_delete: "delete_file", tf_repo_read: "inspect_repository",
  tf_repo_write: "modify_repository", tf_build_run: "execute_build",
  bash_run: "execute_command", bash_background: "execute_command",
  bash_list: "inspect_command", bash_logs: "inspect_command", bash_kill: "terminate_command",
  fetch_web_page: "fetch_web_page", discover_capabilities: "discover_capabilities",
  compare_web_sources: "compare_web_sources",
  request_conversation_evidence: "retrieve_conversation_evidence",
};
const readOperations = new Set([
  "read_file", "list_directory", "grep", "glob", "bash_list", "bash_logs",
  "request_conversation_evidence", "discover_capabilities", "fetch_web_page",
  "compare_web_sources",
  "tf_fs_read", "tf_repo_read",
]);
const workspaceOperations = new Set([
  "write_file", "edit", "multi_edit", "create_directory",
  "bash_run", "bash_background", "bash_kill",
  "tf_fs_write", "tf_fs_delete", "tf_repo_write", "tf_build_run",
]);
function normalizedFabric(c: CapabilitySeed): ToolFabricMetadata {
  if (c.fabric) return c.fabric;
  const name = c.nativeOperation ?? c.nativeName;
  const knownRead = c.source === "builtin" && readOperations.has(name);
  const knownWorkspace = c.source === "builtin" && workspaceOperations.has(name);
  const network = c.hints.openWorld ||
    name === "fetch_web_page" || name === "compare_web_sources";
  const external = c.source === "remote-mcp" || c.source === "integration" ||
    c.source === "local-mcp";
  // An MCP description/permission string is untrusted metadata. Even an
  // apparent GET/read tool cannot downgrade an unknown remote side effect.
  const permissionClass: ToolPermissionClass =
    knownRead ? "read-only" : knownWorkspace ? "workspace-effect" :
    external || network ? "external-effect" : "sensitive";
  // An HTTP GET does not intentionally mutate Clack state, but the remote
  // service may log, bill or trigger actions. Its external effect is unknown.
  const effectClass: ToolEffectClass = knownRead && !network ? "none" :
    knownWorkspace ? "workspace" : "unknown";
  return {
    semanticCapability: semanticNames[name] ?? (external ? "external_capability" : name),
    permissionClass, effectClass,
    latencyClass: network ? "long" : external ? "unknown" :
      name.startsWith("bash_") ? "medium" : "short",
    // A remote integration may bill the caller even if its declaration does
    // not mention a network permission. Never label its cost as free.
    costClass: network || external ? "unknown" : "none",
    authentication: c.source === "builtin" ? "none" :
      external || network ? "runtime-owned" : "unknown",
    qualification: !c.enabled || !c.available ? "unavailable"
      : c.source === "builtin" && knownRead && !network
        ? "available" : "needs-approval",
    availability: c.enabled && c.available ? "available" : "unavailable",
  };
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const terms = (value: string) => [...new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 128))];
const key = (source: string, owner: string, name: string, workspace: string | null) =>
  // JSON tuples, unlike separator concatenation, cannot collide on reserved characters.
  JSON.stringify([source, workspace, owner, name]);

function securityForSeed(seed:CapabilitySeed,id:string):ToolRegistrySecurity {
  // Never accept untrusted provider/user-supplied `security` as an executable
  // grant, even when the descriptor advertises clack-builtin provenance.
  // Resolve only the known builtin table or an authenticated native T1/T2
  // route carrying its exact captured immutable revision.
  if(seed.source==="builtin"){
    const trusted=builtinToolSecurity(seed.callableName);
    return trusted ? {...trusted,id,revision:seed.revision,
      available:seed.enabled&&seed.available} :
      unknownToolSecurity(seed.callableName,id,seed.revision);
  }
  // Native T1/T2 approved registrations own their own credential and effect
  // admission. Descriptions/permission hints from MCP are not authority. The
  // generic upper bound is always effectful and requires approval; its actual
  // receiver is still checked again by the existing native executor.
  if(seed.route.kind==="native-custom" && seed.enabled && seed.available){
    const effects:ToolSideEffect[]=["external-side-effect"];
    return {id,revision:seed.revision,name:seed.callableName,
      provider:seed.sourceOwner,category:"native-custom",effects,
      resources:[],requiresApproval:true,requiresCredentials:false,
      requiresSandbox:[],available:true,provenance:"native-verified"};
  }
  return unknownToolSecurity(seed.callableName,id,seed.revision);
}

export class CapabilityIndex {
  private readonly byId = new Map<string, CapabilityContract>();
  private readonly byName = new Map<string, CapabilityContract | null>();
  constructor(seeds: readonly CapabilitySeed[]) {
    if (seeds.length > CAPABILITY_INDEX_LIMITS.entries)
      throw Error("capability-index-capacity");
    for (const seed of seeds) {
      const id = key(seed.source, seed.sourceOwner, seed.nativeName, seed.workspaceId);
      if (this.byId.has(id)) throw Error("capability-index-identity");
      const summary = seed.description.slice(0, 240);
      const contract: CapabilityContract = {
        ...seed, id, qualifiedName: id,
        fabric: normalizedFabric(seed),
        security: securityForSeed(seed,id),
        discovery: { summary, terms: terms(`${seed.displayName} ${seed.nativeName} ${summary}`) },
      };
      this.byId.set(id, contract);
      // Names from distinct servers may collide in the catalog. Never resolve
      // an ambiguous name as a callable: dispatch requires a unique alias.
      this.byName.set(seed.callableName,
        this.byName.has(seed.callableName) ? null : contract);
    }
  }
  get size() { return this.byId.size; }
  get(id: string) { return this.byId.get(id); }
  callable(name: string) { return this.byName.get(name) ?? undefined; }
  search(options: CapabilitySearch = {}): CapabilityContract[] {
    const query = terms((options.query ?? "").slice(0, CAPABILITY_INDEX_LIMITS.queryCharacters));
    const limit = Math.max(0, Math.min(CAPABILITY_INDEX_LIMITS.results, Math.floor(options.limit ?? 24)));
    const offset = Math.max(0, Math.min(CAPABILITY_INDEX_LIMITS.entries, Math.floor(options.offset ?? 0)));
    return [...this.byId.values()]
      .filter(c => (!options.source || c.source === options.source)
        && (!options.sourceOwner || c.sourceOwner === options.sourceOwner)
        && (!options.workspaceId || c.workspaceId === options.workspaceId || c.workspaceId === null)
        && (!options.enabledOnly || (c.enabled && c.available)))
      .map(c => ({ c, score: query.reduce((score, word) =>
        score + (c.discovery.terms.includes(word) ? 1 : 0)
        + (terms(c.nativeName).includes(word) ? 4 : 0), 0) }))
      .filter(r => query.length === 0 || r.score > 0)
      .sort((a, b) => b.score - a.score || compare(a.c.id, b.c.id))
      .slice(offset, offset + limit).map(r => r.c);
  }
  discover(options: CapabilitySearch = {}): CompactCapability[] {
    return this.search(options).map(c => ({
      id: c.id, callableName: c.callableName, nativeName: c.nativeName,
      displayName: c.displayName, source: c.source, sourceOwner: c.sourceOwner,
      origin: c.origin, available: c.available, enabled: c.enabled,
      revision: c.revision, summary: c.discovery.summary,
    }));
  }
  // A capability snapshot never confers authority. Look up the *current* tool,
  // compare its captured native revision and let its original executor reauthorize.
  resolveCallable(id: string, current: ToolSet): ToolSet[string] | undefined {
    const captured = this.get(id);
    if (!captured?.enabled || !captured.available) return undefined;
    const live = current[captured.callableName];
    if (!live) return undefined;
    const now = capabilityIndexFromTools({ [captured.callableName]: live }).callable(captured.callableName);
    return now?.id === captured.id && now.revision === captured.revision ? live : undefined;
  }
}

const readOnly = new Set(["read_file", "list_directory", "grep", "glob", "bash_list", "bash_logs", "tf_fs_read", "tf_repo_read"]);
const writing = new Set(["write_file", "edit", "multi_edit", "create_directory", "bash_run", "bash_background", "bash_kill",
  "tf_fs_write", "tf_fs_delete", "tf_repo_write", "tf_build_run"]);
function hints(name: string, permissions: readonly string[], binding?: ToolBinding) {
  const read = readOnly.has(name) || permissions.includes("read-files");
  const write = writing.has(name) || permissions.some(p => p === "write-files" || p === "create-files");
  return {
    read, write,
    destructive: ["bash_run", "bash_kill", "bash_background", "tf_fs_delete", "tf_repo_write", "tf_build_run"].includes(name) ||
      permissions.includes("run-commands"),
    openWorld: binding?.kind === "http" || binding?.kind === "mcp" || permissions.includes("network"),
  };
}
export function capabilityIndexFromTools(tools: ToolSet): CapabilityIndex {
  const seeds: CapabilitySeed[] = Object.entries(tools).map(([name, tool]) => {
    const identity = toolRevisionIdentity(tool) as
      | { reference?: CapturedToolVersion; definition?: ToolDefinition; workspaceId?: string; origin?: string } | null;
    const definition = identity?.definition;
    const binding = definition?.binding;
    const source: CapabilitySource = binding?.kind === "mcp" ? "remote-mcp"
      : binding?.kind === "wasi" ? "wasi"
      : definition ? "custom" : "builtin";
    const nativeName = binding?.kind === "mcp" ? binding.tool : definition?.name ?? name;
    const sourceOwner = binding?.kind === "mcp" ? binding.server
      : identity?.reference?.id ?? "clack";
    const permissions = definition?.permissions ?? [];
    const route: CapabilityRoute = identity?.reference
      ? { kind: "native-custom", reference: identity.reference }
      : { kind: "builtin", name };
    return {
      callableName: name, nativeName,
      nativeOperation: binding?.kind === "native" ? binding.operation : null,
      displayName: definition?.name ?? name,
      description: definition?.description ?? tool.description ?? "",
      source, sourceOwner, origin: identity?.origin ?? (definition ? "native-user" : "clack"),
      workspaceId: identity?.workspaceId ?? null,
      scope: definition?.scope ?? "workspace",
      agents: definition?.agents ?? [], conversations: definition?.conversations ?? [],
      permissions, hints: hints(name, permissions, binding),
      available: true, enabled: true,
      revision: identity?.reference
        ? `${identity.reference.version}:${identity.reference.hash}` : "builtin",
      route, inputSchema: definition?.inputSchema ?? tool.inputSchema,
      result: {
        outputSchema: definition?.outputSchema ?? null,
        description: definition?.outputDescription ?? "",
        // Rich MCP resources/images are not executable yet.
        supportedFormats: ["text"],
      },
    };
  });
  return new CapabilityIndex(seeds);
}

// Native registry snapshots include installed-but-disabled tools. This is
// discovery only; the runtime still calls loadEligible and captures versions
// before constructing a callable, and Rust reauthorizes every invocation.
export function capabilityIndexFromRegistry(
  view: ToolRegistryView,
  builtins: ToolSet = {},
): CapabilityIndex {
  if (view.schemaVersion !== 1 || !Array.isArray(view.entries))
    throw Error("capability-registry-version");
  const indexedBuiltins = capabilityIndexFromTools(builtins);
  // Search is page-bounded; retain all builtins, even in synthetic catalogs.
  const builtinSeeds: CapabilitySeed[] = Object.keys(builtins).map(name => {
    const c = indexedBuiltins.callable(name);
    if (!c) throw Error("capability-index-builtin-unavailable");
    const { id: _id, qualifiedName: _qualifiedName, discovery: _discovery, fabric: _fabric, ...seed } = c;
    void _id; void _qualifiedName; void _discovery; void _fabric;
    return seed;
  });
  const seeds: CapabilitySeed[] = view.entries.map(entry => {
    const version = entry.current;
    const d = version.definition;
    const binding = d.binding;
    const source: CapabilitySource = binding.kind === "mcp" ? "remote-mcp"
      : binding.kind === "wasi" ? "wasi" : "custom";
    const name = binding.kind === "mcp" ? binding.tool : d.name;
    return {
      callableName: d.name, nativeName: name,
      nativeOperation: binding.kind === "native" ? binding.operation : null,
      displayName: d.name,
      description: d.description, source,
      sourceOwner: binding.kind === "mcp" ? binding.server : entry.id,
      origin: version.source, workspaceId: entry.workspaceId,
      scope: d.scope, agents: d.agents, conversations: d.conversations,
      permissions: d.permissions, hints: hints(d.name, d.permissions, binding),
      available: entry.eligible && entry.executable && version.status === "authorized",
      enabled: version.enabled && version.status === "authorized",
      revision: `${version.version}:${version.hash}`,
      route: { kind: "native-custom", reference: { id: entry.id, version: version.version, hash: version.hash } },
      inputSchema: d.inputSchema,
      result: { outputSchema: d.outputSchema, description: d.outputDescription, supportedFormats: ["text"] },
    };
  });
  return new CapabilityIndex([...builtinSeeds, ...seeds]);
}

// Obtain the exact JSON schema only for a chosen capability; the index itself
// never serializes all candidate schemas just to offer search.
export async function capabilityInputJsonSchema(capability: CapabilityContract): Promise<unknown> {
  if (capability.route.kind === "native-custom") return structuredClone(capability.inputSchema);
  return structuredClone(await asSchema(capability.inputSchema as ToolSet[string]["inputSchema"]).jsonSchema);
}

// A bounded *candidate* bridge, not an alternative to F1 exposure/permission policy.
// Under the existing 192-candidate ceiling F1 receives its original exact ToolSet.
export function providerCapabilityCandidates(
  tools: ToolSet,
  options: { query?: string; mandatory?: readonly string[] } = {},
): ToolSet {
  const entries = Object.entries(tools);
  // The metadata index is built even for today's smaller catalogs. This is
  // the common discovery contract, never a replacement for F1's final gate.
  const index = capabilityIndexFromTools(tools);
  if (entries.length <= CAPABILITY_INDEX_LIMITS.providerCandidates) return tools;
  const named = new Set((options.query ?? "").slice(-8192).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  // Match F1's explicit-name semantics *before* pruning: an explicitly named
  // callable must not disappear merely because there are hundreds installed.
  const mandatory = new Set([
    ...(options.mandatory ?? []),
    ...entries.filter(([name]) => named.has(name)).map(([name]) => name),
  ]);
  for (const name of mandatory)
    if (!(name in tools))
      throw new ContextBudgetError("tool-exposure-required-unavailable",
        `Required tool '${name}' is no longer permitted or executable. Resolve the active tool lifecycle before retrying.`);
  const always = [...entries].filter(([name]) => {
    const c = index.callable(name);
    return mandatory.has(name) || c?.source === "builtin";
  }).map(([name]) => name);
  if (always.length > CAPABILITY_INDEX_LIMITS.providerCandidates)
    throw Error("capability-provider-required-capacity");
  const chosen = new Set(always);
  for (const c of index.search({ query: options.query, limit: CAPABILITY_INDEX_LIMITS.results }))
    if (chosen.size < CAPABILITY_INDEX_LIMITS.providerCandidates) chosen.add(c.callableName);
  // Deterministic fallback ensures a useful bounded set for vague objectives.
  for (const c of index.search({ limit: CAPABILITY_INDEX_LIMITS.results, offset: 0 }))
    if (chosen.size < CAPABILITY_INDEX_LIMITS.providerCandidates) chosen.add(c.callableName);
  return Object.fromEntries(entries.filter(([name]) => chosen.has(name)));
}
