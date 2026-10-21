import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { endpointBackend } from "@/modules/ai/lib/selfHostedProfiles";
import { z } from "zod";

export type EffortMapping =
  | "responses"
  | "chat"
  | "anthropic"
  | "google-level"
  | "google-budget"
  | "ollama-boolean"
  | "ollama-level"
  | "ollama-mixed";
export type EffortCapability = {
  status: "supported" | "unsupported" | "unknown";
  levels: string[];
  mapping?: EffortMapping;
  ollamaControls?: Record<string, boolean | string>;
  evidence: string;
  revision: string;
  expiresAt?: number;
};
export type EffortCapture = {
  automaticAgentRecommendation?: string;
  unresolvedExplicitChoice?: string;
  version: 1;
  key: string;
  provider: string;
  adapter: string;
  model: string;
  choice: string;
  capability: EffortCapability;
};
export type EffortPreferences = {
  version: 1;
  choices: { key: string; choice: string; revision: string }[];
};

const revision = "r2-2026-10-03-v1";
const labels: Record<string, string> = {
  automatic: "Automatic",
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  on: "On",
  xhigh: "Extra high",
  max: "Maximum",
  "0": "Off",
  "1024": "1K tokens",
  "4096": "4K tokens",
  "8192": "8K tokens",
};
export const effortLabel = (choice: string) => labels[choice] ?? choice;

// Exact API/model contracts, intersected with the installed adapters. Unknown IDs
// never inherit settings from a name prefix, registry tag or another provider.
export const EFFORT_CONTRACTS: Record<
  string,
  { levels: string[]; mapping: EffortMapping; evidence: string }
> = {};
function register(
  provider: string,
  models: string[],
  levels: string[],
  mapping: EffortMapping,
  evidence: string,
) {
  for (const model of models)
    EFFORT_CONTRACTS[`${provider}:${model}`] = { levels, mapping, evidence };
}
register(
  "openai",
  ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
  ["none", "low", "medium", "high", "xhigh"],
  "responses",
  "https://developers.openai.com/api/docs/models/",
);
register(
  "openai",
  ["gpt-5.3-codex"],
  ["low", "medium", "high", "xhigh"],
  "responses",
  "https://developers.openai.com/api/docs/models/gpt-5.3-codex",
);
register(
  "anthropic",
  ["claude-opus-4-7"],
  ["low", "medium", "high", "xhigh", "max"],
  "anthropic",
  "https://platform.claude.com/docs/en/build-with-claude/effort",
);
register(
  "anthropic",
  ["claude-opus-4-6", "claude-sonnet-4-6"],
  ["low", "medium", "high", "max"],
  "anthropic",
  "https://platform.claude.com/docs/en/build-with-claude/effort",
);
register(
  "google",
  ["gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash"],
  ["minimal", "low", "medium", "high"],
  "google-level",
  "https://ai.google.dev/gemini-api/docs/generate-content/thinking",
);
register(
  "google",
  ["gemini-3.1-pro-preview"],
  ["low", "medium", "high"],
  "google-level",
  "https://ai.google.dev/gemini-api/docs/generate-content/thinking",
);
register(
  "google",
  ["gemini-2.5-pro"],
  ["1024", "4096", "8192"],
  "google-budget",
  "https://ai.google.dev/gemini-api/docs/generate-content/thinking",
);
register(
  "google",
  ["gemini-2.5-flash"],
  ["0", "1024", "4096", "8192"],
  "google-budget",
  "https://ai.google.dev/gemini-api/docs/generate-content/thinking",
);
register(
  "groq",
  ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
  ["low", "medium", "high"],
  "chat",
  "https://console.groq.com/docs/reasoning",
);
register(
  "cerebras",
  ["gpt-oss-120b"],
  ["low", "medium", "high"],
  "chat",
  "https://inference-docs.cerebras.ai/capabilities/reasoning",
);
register(
  "deepseek",
  ["deepseek-v4-pro", "deepseek-v4-flash"],
  ["low", "high", "max"],
  "chat",
  "https://api-docs.deepseek.com/guides/thinking_mode/",
);

const unsupported = new Set([
  "openai:gpt-4.1-mini",
  "anthropic:claude-haiku-4-5",
]);
const deploymentContract = z
  .object({
    status: z.enum(["supported", "unsupported"]),
    wire: z.literal("reasoning_effort"),
    accounting: z.literal("shared-output"),
    levels: z
      .array(
        z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
      )
      .max(7),
  })
  .strict();

const ollamaLevels = ["none", "on", "minimal", "low", "medium", "high", "xhigh", "max"];

export function effortCapability(
  identity: ModelTransportIdentity,
  state?: SelfHostedState,
  now = Date.now(),
): EffortCapability {
  const unknown: EffortCapability = {
    status: "unknown",
    levels: [],
    evidence: "No verified effort contract for this model and API.",
    revision,
  };
  if (identity.selfHosted) {
    const route = identity.selfHosted;
    const endpoint = state?.endpoints.find(
      (e) => e.id === route.endpointId && !e.deletedAt,
    );
    const profile = state?.profiles.find((p) => p.id === route.profileId);
    if (
      !endpoint ||
      !profile ||
      profile.endpointId !== endpoint.id ||
      endpoint.configurationRevision !== route.configurationRevision ||
      profile.transportModelId !== identity.transportModelId
    )
      return unknown;
    if (endpointBackend(endpoint) === "ollama") {
      const thinking = profile.evidence.filter(e => ["probe.thinking", "probe.thinkingControls"].includes(e.metric) &&
        e.scope.endpointId === endpoint.id && e.scope.transportModelId === profile.transportModelId &&
        e.scope.configurationRevision === endpoint.configurationRevision && e.scope.deploymentId === profile.deploymentId &&
        (!profile.modelRevision || e.scope.modelRevision === profile.modelRevision) &&
        e.observedAt !== null && e.observedAt <= now && now - e.observedAt < 30_000 && e.confidence === "reported" &&
        ["backend-reported", "advertised"].includes(e.source));
      const controls = thinking.filter(e => e.metric === "probe.thinkingControls");
      const declared = thinking.filter(e => e.metric === "probe.thinking");
      let levels: string[], mapping: EffortMapping = "ollama-boolean";
      let ollamaControls: EffortCapability["ollamaControls"];
      if (controls.length === 1 && typeof controls[0].value === "string") {
        try {
          const values = z.array(z.union([z.boolean(), z.string().min(1).max(32).regex(/^[^\u0000-\u001f\u007f-\u009f]+$/)])).min(1).max(16).parse(JSON.parse(controls[0].value));
          const normalized: Record<string, boolean | string> = {};
          for (const level of ollamaLevels) {
            if (level === "none" && values.includes(false)) normalized[level] = false;
            else if (level === "on" && values.includes(true)) normalized[level] = true;
            else if (values.includes(level)) normalized[level] = level;
          }
          levels = Object.keys(normalized);
          if (!levels.length) return unknown;
          const wireValues = Object.values(normalized);
          if (wireValues.every(v => typeof v === "string")) mapping = "ollama-level";
          else if (wireValues.some(v => typeof v === "string")) {
            mapping = "ollama-mixed";
            ollamaControls = normalized;
          }
        } catch { return unknown; }
      } else if (controls.length) return unknown;
      else if (declared.length === 1 && typeof declared[0].value === "boolean") levels = declared[0].value ? ["none", "on"] : [];
      else return unknown;
      return { status: levels.length ? "supported" : "unsupported", levels, mapping,
        ...(ollamaControls ? { ollamaControls } : {}),
        evidence: "Ollama native thinking contract; boolean controls are not effort levels",
        revision: JSON.stringify([revision, endpoint.configurationRevision, profile.id, profile.modelRevision, profile.backend, levels, mapping, ...(ollamaControls ? [ollamaControls] : [])]),
        expiresAt: Math.min(...thinking.map(e => (e.observedAt ?? now) + 30_000)) };
    }
    const evidence = profile.evidence.filter(
      (e) =>
        e.metric === "reasoning.effort" &&
        e.source === "backend-reported" &&
        e.confidence === "reported" &&
        e.scope.endpointId === endpoint.id &&
        e.scope.transportModelId === profile.transportModelId &&
        e.scope.deploymentId === profile.deploymentId &&
        e.scope.configurationRevision === endpoint.configurationRevision &&
        (!profile.modelRevision || e.scope.modelRevision === profile.modelRevision) &&
        e.observedAt !== null &&
        e.observedAt <= now &&
        now - e.observedAt < 30_000,
    );
    // Conflicting declarations are not resolved by array order.
    if (
      evidence.length !== 1 ||
      typeof evidence[0].value !== "string" ||
      evidence[0].observedAt === null
    )
      return unknown;
    try {
      const parsed = deploymentContract.parse(JSON.parse(evidence[0].value));
      if (
        new Set(parsed.levels).size !== parsed.levels.length ||
        (parsed.status === "supported") !== parsed.levels.length > 0
      )
        return unknown;
      return {
        status: parsed.status,
        levels: parsed.levels,
        mapping: "chat",
        evidence: "Backend-reported, revision-bound reasoning.effort contract",
        revision: JSON.stringify([
          revision,
          endpoint.configurationRevision,
          profile.id,
          profile.modelRevision,
          profile.backend,
          evidence[0].value,
        ]),
        expiresAt: evidence[0].observedAt + 30_000,
      };
    } catch {
      return unknown;
    }
  }
  // A compatible route, including a proxy to a named cloud model, is not that cloud API.
  if (identity.endpointBaseURL || identity.customEndpointId) return unknown;
  const key = `${identity.providerId}:${identity.transportModelId}`;
  const contract = EFFORT_CONTRACTS[key];
  if (contract)
    return {
      ...contract,
      levels: [...contract.levels],
      status: "supported",
      revision: `${revision}:${key}`,
    };
  return unsupported.has(key)
    ? {
        ...unknown,
        status: "unsupported",
        evidence:
          "This exact model has no supported effort control in this API.",
      }
    : unknown;
}

export function effortKey(
  selection: string,
  identity: ModelTransportIdentity,
): string {
  return JSON.stringify([
    selection,
    identity.providerId,
    identity.transportModelId,
    identity.selfHosted?.endpointId ?? identity.customEndpointId ?? null,
    identity.endpointBaseURL ?? null,
    identity.selfHosted?.configurationRevision ?? null,
  ]);
}

export function captureEffort(
  selection: string,
  identity: ModelTransportIdentity,
  preferences?: EffortPreferences,
  state?: SelfHostedState,
): EffortCapture {
  const capability = effortCapability(identity, state);
  const key = effortKey(selection, identity);
  const owned = preferences?.version === 1 && Array.isArray(preferences.choices) && preferences.choices.length <= 32
    ? preferences.choices.filter(e => e?.key === key) : [];
  const matches =
    preferences?.version === 1 &&
    Array.isArray(preferences.choices) &&
    preferences.choices.length <= 32
      ? preferences.choices.filter(
          (e) => e?.key === key && e.revision === capability.revision,
        )
      : [];
  const choice =
    matches.length === 1 &&
    capability.status === "supported" &&
    capability.levels.includes(matches[0].choice)
      ? matches[0].choice
      : "automatic";
  return {
    version: 1,
    key,
    ...(choice === "automatic" && identity.selfHosted && identity.providerId === "ollama" && owned.length === 1 &&
      typeof owned[0].choice === "string" && owned[0].choice.length <= 32 && owned[0].choice !== "automatic"
      ? {unresolvedExplicitChoice: owned[0].choice} : {}),
    provider: identity.providerId,
    adapter: identity.selfHosted && identity.providerId !== "ollama" ? "openai-compatible" : identity.providerId,
    model: identity.transportModelId,
    choice,
    capability,
  };
}

export function effortProviderOptions(capture: EffortCapture): ProviderOptions {
  const { capability: c, choice, adapter } = capture;
  if (choice === "automatic") return {};
  if (
    c.status !== "supported" ||
    !c.levels.includes(choice) ||
    (c.expiresAt !== undefined && Date.now() >= c.expiresAt)
  )
    throw new Error(
      "Reasoning effort evidence changed or expired. Start a new request.",
    );
  switch (c.mapping) {
    case "ollama-boolean":
      return { ollama: { think: choice === "on" } };
    case "ollama-level":
      return { ollama: { think: choice } };
    case "ollama-mixed": {
      const value = c.ollamaControls?.[choice];
      if (value !== choice && !(choice === "none" && value === false) && !(choice === "on" && value === true))
        throw new Error("Unsupported native reasoning control.");
      return { ollama: { think: value } };
    }
    case "responses":
      return { openai: { reasoningEffort: choice } };
    case "anthropic":
      return { anthropic: { effort: choice } };
    case "google-level":
      return { google: { thinkingConfig: { thinkingLevel: choice } } };
    case "google-budget":
      return { google: { thinkingConfig: { thinkingBudget: Number(choice) } } };
    case "chat":
      return { [adapter]: { reasoningEffort: choice } };
    default:
      throw new Error("Unsupported reasoning effort mapping.");
  }
}

export function sameEffortContract(
  captured: EffortCapture,
  current: EffortCapability,
): boolean {
  return captured.capability.status === "supported" &&
    current.status === "supported" &&
    current.revision === captured.capability.revision &&
    current.mapping === captured.capability.mapping &&
    current.levels.length === captured.capability.levels.length &&
    current.levels.every(level => captured.capability.levels.includes(level)) &&
    (current.mapping !== "ollama-mixed" || current.levels.every(level => current.ollamaControls?.[level] === captured.capability.ollamaControls?.[level])) &&
    current.levels.includes(captured.choice);
}

export function effortBudget(capture?: EffortCapture): number | undefined {
  return capture?.capability.mapping === "google-budget" &&
    capture.choice !== "automatic"
    ? Number(capture.choice) || undefined
    : undefined;
}
