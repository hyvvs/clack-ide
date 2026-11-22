import type { ModelMessage, ToolSet, UIMessage } from "ai";
import {
  ContextBudgetError,
  measureRequest,
  resolveContextBudget,
  type BudgetLimits,
  type SchemaKind,
} from "@/modules/ai/lib/contextBudget";
import { serializedToolSchemas } from "@/modules/ai/lib/requestPreflight";
import { contextDigest } from "@/modules/ai/lib/targetContext";
import {
  resolveCurrentAgentPermission,
  requiresWorkspaceWriteLease,
} from "@/modules/ai/lib/permissions";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ToolContext } from "@/modules/ai/tools/context";
import { handoffObjective } from "@/modules/ai/lib/peerHistory";
import { referencedFiles } from "@/modules/ai/lib/scopedEvidence";
import { operationCapabilities, resolveToolObjective, type ToolCapability, type ToolObjective } from "@/modules/ai/lib/toolObjective";
import { getTodos } from "@/modules/ai/store/todoStore";
import { capabilityIndexFromTools, providerCapabilityCandidates } from "@/modules/ai/lib/capabilityIndex";

export const EXPOSURE_POLICY = "tf-exposure-v6";
export const EXPOSURE_LIMITS = {
  candidates: 192,
  optional: 16,
  bytes: 262144,
  candidateBytes: 2097152,
  optionalContextShare: 0.25,
  rankingCharacters: 8192,
  cache: 32,
} as const;
const identities = new WeakMap<object, unknown>();
const cache = new Map<string, { names: string[]; fallback: boolean }>();
export function identifyTool(tool: object, identity: unknown) {
  identities.set(tool, structuredClone(identity));
}
export function sameToolRevision(a: object, b: object): boolean {
  return (
    JSON.stringify(identities.get(a)) === JSON.stringify(identities.get(b))
  );
}
export function toolRevisionIdentity(tool: object): unknown {
  return identities.get(tool) ?? null;
}
export function toolSchemaKinds(tools: ToolSet): Record<string, SchemaKind> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const identity = identities.get(tool) as
        | { definition?: { binding?: { kind?: string } } }
        | undefined;
      return [
        name,
        identity?.definition?.binding?.kind === "mcp"
          ? "mcp"
          : name.startsWith("custom_")
            ? "custom"
            : "builtin",
      ];
    }),
  );
}
export function clearExposureCache() {
  cache.clear();
}
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const words = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter(
        (w) =>
          w.length > 2 &&
          !/^(the|and|this|that|with|from|for|tool|tools|please|project|workspace|use|using)$/.test(
            w,
          ),
      )
      .slice(0, 128),
  );

export function requiredToolNames(messages: readonly ModelMessage[]): string[] {
  const pending = new Map<string, string>();
  let tail = new Set<string>();
  for (const message of messages) {
    if (message.role === "user") tail = new Set();
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-call") {
        pending.set(part.toolCallId, part.toolName);
        tail.add(part.toolName);
      } else if (part.type === "tool-result") {
        pending.delete(part.toolCallId);
        tail.add(part.toolName);
      }
    }
  }
  return [...new Set([...pending.values(), ...tail])].sort(compare);
}
export function exposureQuery(messages: readonly ModelMessage[]): string {
  return continuedExposureQuery(messages.filter(m => m.role === "user").slice(-128).map(message => (
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n")
  )));
}
export function uiExposureQuery(messages: readonly UIMessage[]): string {
  return continuedExposureQuery(messages.filter(m => m.role === "user").slice(-128).map(message => message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n")));
}
function continuedExposureQuery(users: readonly string[]): string {
  const latest = users[users.length - 1] ?? "";
  const continuation = (text: string) => !handoffObjective(text) &&
    /^(?:(?:continue|resume|finish|complete|proceed with)(?:\s+(?:the\s+)?(?:same|current|original|existing)\b[^\n]*|[.!?\s]*)|keep going[.!?\s]*)$/i.test(text.trim().replace(/^<env>[\s\S]*?<\/env>\s*/, ""));
  if (continuation(latest)) {
    for (let i = users.length - 2; i >= Math.max(0, users.length - 128); i--) {
      if (continuation(users[i])) continue;
      const objective = handoffObjective(users[i]) ?? users[i];
      return `${latest.slice(-512)}\n${objective.slice(-(EXPOSURE_LIMITS.rankingCharacters - 513))}`;
    }
  }
  return (handoffObjective(latest) ?? latest).slice(-EXPOSURE_LIMITS.rankingCharacters);
}
export function requiredUiToolNames(messages: readonly UIMessage[]): string[] {
  const names = new Set<string>();
  let latestUser = -1;
  for (const [index, message] of messages.entries())
    if (message.role === "user") latestUser = index;
  for (const [index, message] of messages.entries())
    for (const part of message.parts) {
      if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-"))
        continue;
      const state = (part as { state?: string }).state;
      if (
        index < latestUser &&
        ["output-available", "output-error", "output-denied"].includes(
          state ?? "",
        )
      )
        continue;
      names.add(
        part.type === "dynamic-tool"
          ? (part as { toolName: string }).toolName
          : part.type.slice(5),
      );
    }
  return [...names].sort(compare);
}
type Schema = Awaited<ReturnType<typeof serializedToolSchemas>>[number];
export function selectToolSchemas(input: {
  schemas: Schema[];
  query: string;
  mandatory?: readonly string[];
  system?: unknown;
  messages?: unknown;
  limits?: BudgetLimits;
  reuseNames?: readonly string[];
  reuseFallback?: boolean;
  objective?: ToolObjective;
  capabilities?: Readonly<Record<string, readonly ToolCapability[]>>;
}) {
  const schemas = [...input.schemas].sort((a, b) =>
    compare(a.function.name, b.function.name),
  );
  if (
    schemas.length > EXPOSURE_LIMITS.candidates ||
    bytes(schemas) > EXPOSURE_LIMITS.candidateBytes
  )
    throw new ContextBudgetError(
      "tool-exposure-capacity",
      "The permitted schema set exceeds bounded selection capacity. Narrow tool assignments before retrying.",
    );
  const byName = new Map(schemas.map((s) => [s.function.name, s]));
  if (byName.size !== schemas.length)
    throw new ContextBudgetError(
      "tool-exposure-identity",
      "Conflicting callable tool names cannot be selected.",
    );
  const selectionQuery = input.objective?.query || input.query;
  const named = new Set(input.query.slice(-EXPOSURE_LIMITS.rankingCharacters).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  const mandatory = [...new Set([...(input.mandatory ?? []), ...schemas.filter(schema => named.has(schema.function.name)).map(schema => schema.function.name)])].sort(compare);
  for (const name of mandatory)
    if (!byName.has(name))
      throw new ContextBudgetError(
        "tool-exposure-required-unavailable",
        `Required tool '${name}' is no longer permitted or executable. Resolve the active tool lifecycle before retrying.`,
      );
  const boundedQuery = selectionQuery.slice(-EXPOSURE_LIMITS.rankingCharacters);
  const conversational = /^(hello|hi|hey|thanks|thank you)[.!?\s]*$/i.test(
    boundedQuery.trim(),
  );
  const query = words(boundedQuery);
  const ranked = input.reuseNames
    ? []
    : schemas
        .map((schema) => {
          const name = words(schema.function.name.replace(/_/g, " "));
          const description = ["request_peer_task", "cancel_peer_task"].includes(schema.function.name)
            ? (schema.function.description ?? "").split("\n\n", 1)[0] : schema.function.description ?? "";
          const metadata = words(
            `${description} ${JSON.stringify(schema.function.parameters)}`.slice(
              0,
              EXPOSURE_LIMITS.rankingCharacters,
            ),
          );
          let score = 0;
          for (const word of query)
            score += name.has(word) ? 8 : metadata.has(word) ? 1 : 0;
          if (schema.function.name === "read_file" && /\bread\b/i.test(boundedQuery) && referencedFiles(boundedQuery).length) score += 16;
          if (
            /\b(fix|edit|file|files|code|implement|create|directory|read|search)\b/i.test(
              boundedQuery,
            ) &&
            /^(read_file|list_directory|grep|glob|edit|multi_edit|write_file|create_directory|todo_write)$/.test(
              schema.function.name,
            )
          )
            score += 4;
          if (
            /\b(test|build|install|command|server|shell)\b/i.test(
              boundedQuery,
            ) &&
            /^(bash_run|bash_background|bash_list|bash_logs|bash_kill|open_preview)$/.test(
              schema.function.name,
            )
          )
            score += 4;
          return { schema, score };
        })
        .sort(
          (a, b) =>
            b.score - a.score ||
            compare(a.schema.function.name, b.schema.function.name),
        );
  const fallback =
    input.reuseFallback ??
    (!conversational &&
      (!ranked.some((r) => r.score > 0) ||
        (ranked[EXPOSURE_LIMITS.optional]?.score > 0 &&
          ranked[0].score === ranked[EXPOSURE_LIMITS.optional].score &&
          ranked[EXPOSURE_LIMITS.optional].score ===
            ranked[EXPOSURE_LIMITS.optional - 1].score)));
  const selected = new Set(mandatory);
  const capabilities = (name: string) => input.capabilities?.[name] ?? operationCapabilities(name);
  for (const capability of input.objective?.required ?? []) {
    if ([...selected].some(name => capabilities(name).includes(capability))) continue;
    const eligible = schemas.filter(s => capabilities(s.function.name).includes(capability));
    eligible.sort((a, b) => measureRequest({ tools: [a] }).tools - measureRequest({ tools: [b] }).tools || compare(a.function.name, b.function.name));
    if (eligible[0]) selected.add(eligible[0].function.name);
  }
  const dependencies: Record<string, string[]> = {
    edit: ["read_file"],
    multi_edit: ["read_file"],
    write_file: ["list_directory"],
    create_directory: ["list_directory"],
    bash_background: ["bash_list", "bash_logs", "bash_kill", "open_preview"],
  };
  const requiredCost = measureRequest({ system: input.system, messages: input.messages, tools: schemas.filter(schema => selected.has(schema.function.name)) });
  const requiredBudget = resolveContextBudget(input.limits ?? {}, requiredCost);
  const schemaAllowance = Math.floor(Math.min(requiredBudget.ceiling * EXPOSURE_LIMITS.optionalContextShare, Math.max(0, requiredBudget.working - requiredCost.conversation) / 2));
  if (input.reuseNames)
    for (const name of input.reuseNames) {
      if (!byName.has(name))
        throw new ContextBudgetError(
          "tool-exposure-cache-stale",
          "Cached schema is no longer permitted.",
        );
      selected.add(name);
    }
  // Ambiguity is NOT permission to dump hundreds of schemas. Bound every
  // optional branch to the same small-model budget; preserve mandatory tools
  // and only the explicitly applicable dependency set.
  for (const { schema, score } of conversational
    ? []
    : fallback
      ? ranked.slice(0, EXPOSURE_LIMITS.optional)
      : ranked.filter((r) => r.score >= Math.min(4, ranked[0]?.score || 1)).slice(0, EXPOSURE_LIMITS.optional)) {
    if (fallback || score > 0) {
      if (["delegated", "read-only"].includes(input.objective?.kind ?? "") && (requiresWorkspaceWriteLease(schema.function.name) || capabilities(schema.function.name).some(c => ["create", "modify", "command"].includes(c))) && !mandatory.includes(schema.function.name)) continue;
      if (fallback && !ranked.some(r => r.score > 0) && !capabilities(schema.function.name).includes("read") && schema.function.name !== "list_directory") continue;
      if (!mandatory.includes(schema.function.name) && selected.has(schema.function.name)) continue;
      if (input.objective?.kind === "implementation" && capabilities(schema.function.name).length && capabilities(schema.function.name).every(c => [...selected].some(name => capabilities(name).includes(c)))) continue;
      const trial = new Set([...selected, schema.function.name]);
      for (const name of trial)
        for (const dependency of dependencies[name] ?? []) if (byName.has(dependency)) trial.add(dependency);
      if (fallback || selected.size === 0 || measureRequest({ tools: schemas.filter(item => trial.has(item.function.name)) }).tools <= schemaAllowance)
        for (const name of trial) selected.add(name);
    }
  }
  for (const name of [...selected])
    for (const dependency of dependencies[name] ?? [])
      if (byName.has(dependency)) selected.add(dependency);
  const exposed = schemas.filter((s) => selected.has(s.function.name));
  const fullCost = measureRequest({
    system: input.system,
    messages: input.messages,
    tools: schemas,
  });
  const cost = measureRequest({
    system: input.system,
    messages: input.messages,
    tools: exposed,
  });
  const budget = resolveContextBudget(input.limits ?? {}, cost);
  if (bytes(exposed) > EXPOSURE_LIMITS.bytes)
    throw new ContextBudgetError(
      "tool-exposure-required-capacity",
      "Mandatory or uncertain schema exposure exceeds the bounded payload. Narrow assignments or resolve tool lifecycles; no required schema was dropped.",
      budget,
    );
  return {
    names: exposed.map((s) => s.function.name),
    schemas: exposed,
    budget,
    metrics: {
      permitted: schemas.length,
      exposed: exposed.length,
      mandatory: mandatory.length,
      fallback,
      bytesBefore: bytes(schemas),
      bytesAfter: bytes(exposed),
      tokensBefore: fullCost.tools,
      tokensAfter: cost.tools,
      workingBefore: resolveContextBudget(input.limits ?? {}, fullCost).working,
      workingAfter: budget.working,
    },
  };
}

export async function prepareToolExposure(
  tools: ToolSet,
  input: {
    context: ToolContext;
    messages: ModelMessage[];
    target: unknown;
    system?: unknown;
    limits?: BudgetLimits;
    mandatory?: readonly string[];
    uiMessages?: readonly UIMessage[];
    query?: string;
    objectiveMessages?: readonly UIMessage[];
  },
) {
  const authorization = () =>
    JSON.stringify([
      input.context.getSessionId(),
      input.context.getWorkspaceId?.(),
      input.context.getWorkspaceRoot(),
      input.context.getAgentId(),
      input.context.getRunId?.(),
      input.context.getMutationMode?.(),
      usePreferencesStore.getState().agentPermissionProfiles,
      usePreferencesStore.getState().agentWorkspacePermissions,
    ]);
  const capturedAuthorization = authorization();
  const registry=capabilityIndexFromTools(tools);
  const eligible = Object.fromEntries(
    Object.entries(tools).filter(
      ([name]) => {
        const descriptor=registry.callable(name)?.security;
        // A dynamic candidate may be visible to F1 for stable tool-call
        // continuation even when the descriptor has no authenticated native
        // provenance (older conversation tool schemas and offline fixtures).
        // Exposure does not create runnable authority: all production tools
        // are independently wrapped through the live registry and the native
        // executor rejects unknown/mismatched tools at invocation.
        return resolveCurrentAgentPermission(name, {}, input.context,
          descriptor?.provenance === "unknown" ? undefined : descriptor,
          "exposure").outcome !==
          "deny" &&
        !(
          input.context.getMutationMode?.() === "read-only" &&
          requiresWorkspaceWriteLease(name)
        );
      },
    ),
  );
  const mandatory = [
    ...new Set([
      ...requiredToolNames(input.messages),
      ...requiredUiToolNames(input.uiMessages ?? []),
      ...(input.mandatory ?? []),
    ]),
  ].sort(compare);
  // Discover/index independently of the provider's F1 schema ceiling; only
  // bounded, selected candidates incur JSON-schema serialization.
  const permitted = providerCapabilityCandidates(eligible, {
    query: input.query ?? exposureQuery(input.messages),
    mandatory,
  });
  const schemas = await serializedToolSchemas(permitted);
  const objectiveMessages = input.objectiveMessages ?? input.uiMessages;
  const objective = objectiveMessages ? resolveToolObjective(objectiveMessages, getTodos(input.context.getSessionId())) : undefined;
  const capabilities = Object.fromEntries(Object.entries(permitted).map(([name, tool]) => {
    const identity = identities.get(tool) as { definition?: { binding?: { kind?: string; operation?: string } } } | undefined;
    const binding = identity?.definition?.binding;
    return [name, operationCapabilities(binding?.kind === "native" ? binding.operation ?? "" : identity ? "" : name)];
  }));
  const preferences = usePreferencesStore.getState();
  const key = await contextDigest({
    policy: EXPOSURE_POLICY,
    source: [input.messages, input.uiMessages],
    query: input.query,
    objective,
    capabilities,
    session: input.context.getSessionId(),
    workspace: input.context.getWorkspaceId?.(),
    root: input.context.getWorkspaceRoot(),
    agent: input.context.getAgentId(),
    run: input.context.getRunId?.(),
    mutation: input.context.getMutationMode?.(),
    target: input.target,
    system: input.system,
    limits: input.limits,
    mandatory,
    permissions: [
      preferences.agentPermissionProfiles,
      preferences.agentWorkspacePermissions,
    ],
    tools: schemas.map((s) => [
      s,
      identities.get(permitted[s.function.name]) ?? {
        builtin: s.function.name,
      },
    ]),
  });
  const hit = cache.get(key);
  const selection = selectToolSchemas({
    schemas,
    mandatory,
    query: input.query ?? exposureQuery(input.messages),
    system: input.system,
    messages: input.messages,
    limits: input.limits,
    reuseNames: hit?.names,
    reuseFallback: hit?.fallback,
    objective,
    capabilities,
  });
  const cacheHit = hit !== undefined;
  if (!cacheHit) {
    if (cache.size >= EXPOSURE_LIMITS.cache)
      cache.delete(cache.keys().next().value as string);
    cache.set(key, {
      names: selection.names,
      fallback: selection.metrics.fallback,
    });
  }
  const identity = await contextDigest({
    policy: EXPOSURE_POLICY,
    session: input.context.getSessionId(),
    workspace: input.context.getWorkspaceId?.(),
    agent: input.context.getAgentId(),
    mutation: input.context.getMutationMode?.(),
    tools: selection.schemas.map((s) => [
      s,
      identities.get(permitted[s.function.name]) ?? {
        builtin: s.function.name,
      },
    ]),
  });
  if (authorization() !== capturedAuthorization)
    throw new ContextBudgetError(
      "tool-exposure-policy-changed",
      "Tool ownership or permission policy changed during selection. No request was sent; retry with current policy.",
    );
  return {
    ...selection,
    key,
    identity,
    cacheHit,
    objective,
    tools: Object.fromEntries(
      selection.names.map((name) => [name, permitted[name]]),
    ),
  };
}
