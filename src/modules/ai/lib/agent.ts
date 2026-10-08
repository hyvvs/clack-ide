import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import {
  DEFAULT_MODEL_ID,
  endpointIdFromCompatModel,
  isCompatModelId,
  LMSTUDIO_DEFAULT_BASE_URL,
  MLX_DEFAULT_BASE_URL,
  modelKeepsReasoning,
  OLLAMA_DEFAULT_BASE_URL,
  providerNeedsKey,
  resolveModel,
  selectSystemPrompt,
  type CustomEndpoint,
  type ModelInfo,
  type ProviderId,
} from "../config";
import { buildRuntimeTools as buildTools } from "@/modules/ai/tools/customExecution";
import type { ToolContext } from "@/modules/ai/tools/context";
import { compactModelMessagesDetailed } from "./compact";
import type { ProviderKeys, CustomEndpointKeys } from "./keyring";
import { createProxyFetch } from "./proxyFetch";
import { cancelSessionInference, type InferenceScope } from "@/modules/ai/lib/inferenceLifecycle";
import { createOutputWatchdog, describeWatchdog, readWatchdogError, watchdogInstruction, type OutputWatchdog } from "@/modules/ai/lib/outputWatchdog";
import { gateInferenceTools } from "@/modules/ai/lib/inferenceToolGate";
import {
  verifiedProviderFetch,
  withAnswerContinuation,
  readAnswer,
  type AnswerState,
} from "@/modules/ai/lib/answerContinuation";
import {
  prepareToolExposure,
  sameToolRevision,
  toolRevisionIdentity,
} from "@/modules/ai/lib/toolExposure";
import { resolveCurrentAgentPermission } from "@/modules/ai/lib/permissions";
import { retrieveScopedEvidence } from "@/modules/ai/lib/scopedEvidence";
import { runRetrievalAllowance } from "@/modules/ai/lib/retrievalAllowance";
import {
  loadTargetContext,
  targetContextKey,
} from "@/modules/ai/lib/targetContext";
import type { ModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  endpointInferenceAdmission,
  type InferenceAdmission,
} from "@/modules/ai/lib/inferenceAdmission";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { effectiveProfileValue } from "@/modules/ai/lib/selfHostedProfiles";
import { createCalibrationCapture, type CalibrationCaptureOptions } from "@/modules/ai/lib/calibrationCapture";
import { recordPassiveCalibration } from "@/modules/ai/lib/inferenceCalibration";
import {
  captureEffort,
  effortCapability,
  type EffortCapture,
} from "@/modules/ai/lib/reasoningEffort";
import {
  createRequestPreflight,
  preflightFetch,
  modelBudgetLimits,
} from "@/modules/ai/lib/requestPreflight";
import {
  measureRequest,
  resolveContextBudget,
  ContextBudgetError,
} from "@/modules/ai/lib/contextBudget";
import {
  createConversationCompactor,
  type ConversationCompactionContext,
  type CompactionNotice,
} from "@/modules/ai/lib/conversationCompaction";
import {
  retrieveConversationEvidence,
  type RetrievalNotice,
} from "@/modules/ai/lib/conversationRetrieval";
import {
  selfHostedTransportIdentity,
  selfHostedCredential,
} from "@/modules/ai/lib/selfHostedModels";
import { AGENT_SOFT_STEP_LIMIT, type RunStepObservation } from "./runBudget";
import {
  AGENT_PROVIDER_MAX_RETRIES,
  withProviderRetryTracking,
  type ProviderRetryEvent,
} from "./providerRetry";
import {
  isSavedProviderModelSelectionId,
  resolveSavedProviderModelTarget,
  resolveModelSelectionInfo,
  type ModelTransportIdentity,
  type SavedProviderModel,
} from "./savedProviderModels";

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> =
  {
    read_file: (i) => `Reading ${shortPath(i.path)}`,
    list_directory: (i) => `Listing ${shortPath(i.path)}`,
    grep: (i) => `Grepping ${ellipsize(String(i.pattern ?? ""), 40)}`,
    glob: (i) => `Globbing ${ellipsize(String(i.pattern ?? ""), 40)}`,
    edit: (i) => `Editing ${shortPath(i.path)}`,
    multi_edit: (i) => `Editing ${shortPath(i.path)}`,
    write_file: (i) => `Writing ${shortPath(i.path)}`,
    create_directory: (i) => `Creating ${shortPath(i.path)}`,
    bash_run: (i) => `Running ${ellipsize(String(i.command ?? ""), 60)}`,
    bash_background: (i) =>
      `Spawning ${ellipsize(String(i.command ?? ""), 60)}`,
    bash_logs: () => `Reading logs`,
    bash_list: () => `Listing background processes`,
    bash_kill: () => `Stopping background process`,
    suggest_command: (i) =>
      `Suggesting ${ellipsize(String(i.command ?? ""), 60)}`,
    todo_write: (i) =>
      `Updating plan (${Array.isArray(i.todos) ? i.todos.length : 0} items)`,
    run_subagent: (i) => `Spawning ${String(i.type ?? "subagent")} subagent`,
  };

function shortPath(p: unknown): string {
  if (typeof p !== "string") return "";
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function ellipsize(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type BuildModelOptions = {
  calibration?: Pick<CalibrationCaptureOptions, "requestClass" | "record" | "onQueued">;
  reasoning?: EffortCapture;
  assertedContext?: number;
  admission?: InferenceAdmission;
  selfHostedInference?: SelfHostedState;
  inferenceScope?: InferenceScope;
  selfHosted?: boolean;
  allowPrivateNetwork?: boolean;
  modelIdOverride?: string;
  lmstudioBaseURL?: string;
  mlxBaseURL?: string;
  ollamaBaseURL?: string;
  openaiCompatibleBaseURL?: string;
};

const modelCache = new Map<string, LanguageModel>();

export async function buildLanguageModel(
  provider: ProviderId,
  keys: ProviderKeys,
  resolvedModelId: string,
  options: BuildModelOptions = {},
  customEndpointKey?: string | null,
): Promise<LanguageModel> {
  if (providerNeedsKey(provider) && !keys[provider]) {
    throw new Error(
      `No API key configured for ${provider}. Open Settings → AI to add one.`,
    );
  }
  const key = keys[provider] ?? "";
  const lmstudioURL = options.lmstudioBaseURL ?? LMSTUDIO_DEFAULT_BASE_URL;
  const mlxURL = options.mlxBaseURL ?? MLX_DEFAULT_BASE_URL;
  const ollamaURL = options.ollamaBaseURL ?? OLLAMA_DEFAULT_BASE_URL;
  const compatURL = options.openaiCompatibleBaseURL ?? "";
  const epKey = customEndpointKey ?? "";
  const localProvider = [
    "lmstudio",
    "mlx",
    "ollama",
    "openai-compatible",
  ].includes(provider);
  let admission =
    options.admission ??
    (localProvider
      ? endpointInferenceAdmission(
          `legacy:${provider}`,
          resolvedModelId,
          options.selfHostedInference,
        )
      : undefined);
  const calibrationProfile = options.selfHostedInference?.profiles.find(p =>
    p.endpointId === admission?.endpointId && p.transportModelId === resolvedModelId &&
    (p.id === admission?.profileId || p.id === options.selfHostedInference?.endpoints.find(e => e.id === p.endpointId)?.legacy?.profileId),
  );
  if (admission && calibrationProfile) admission = { ...admission, profileId: calibrationProfile.id };
  const reasoning = options.reasoning
    ? structuredClone(options.reasoning)
    : undefined;
  if (
    reasoning &&
    (reasoning.adapter !== provider || reasoning.model !== resolvedModelId)
  )
    throw new Error(
      "Captured reasoning effort belongs to another model route.",
    );
  if (reasoning && reasoning.choice !== "automatic") {
    const endpoint = options.selfHostedInference?.endpoints.find(
      (e) => e.id === admission?.endpointId,
    );
    const current = effortCapability(
      {
        providerId: provider,
        transportModelId: resolvedModelId,
        ...(provider === "openai-compatible"
          ? { endpointBaseURL: compatURL }
          : {}),
        ...(options.selfHosted && endpoint && admission
          ? {
              selfHosted: {
                endpointId: endpoint.id,
                profileId: admission.profileId,
                configurationRevision: endpoint.configurationRevision,
                allowPrivateNetwork: options.allowPrivateNetwork === true,
                credentialRef: endpoint.credentialRef,
                credentialRequired: false,
              },
            }
          : {}),
      },
      options.selfHostedInference,
    );
    if (
      current.status !== "supported" ||
      current.revision !== reasoning.capability.revision ||
      current.mapping !== reasoning.capability.mapping ||
      !current.levels.includes(reasoning.choice)
    )
      throw new Error(
        "Captured reasoning effort evidence is no longer valid. Start a new request.",
      );
  }
  const cacheKey = JSON.stringify([
    provider,
    key,
    epKey,
    resolvedModelId,
    lmstudioURL,
    mlxURL,
    ollamaURL,
    compatURL,
    options.selfHosted,
    options.allowPrivateNetwork,
    admission,
    options.selfHostedInference?.revision,
    options.assertedContext,
    reasoning,
  ]);
  const hit = options.inferenceScope || options.calibration ? undefined : modelCache.get(cacheKey);
  if (hit) return hit;

  let built: LanguageModel;
  const preflight = createRequestPreflight({
    validateRouting: options.inferenceScope?.validateFallback,
    requireRequestedOutput: Boolean(options.inferenceScope?.fallbackToken),
    cachedMetadataOnly: Boolean(options.inferenceScope?.fallbackToken),
    reasoning:
      reasoning ??
      captureEffort(resolvedModelId, {
        providerId: provider,
        transportModelId: resolvedModelId,
        ...(provider === "openai-compatible"
          ? { endpointBaseURL: compatURL }
          : {}),
      }),
    modelId: resolvedModelId,
    local: localProvider,
    state: options.selfHostedInference,
    admission,
    assertedContext: options.assertedContext,
    optimization: options.calibration?.requestClass === "optimization",
    validateEvidence: () =>
      options.inferenceScope?.validateEvidence?.() ?? Promise.resolve(),
  });
  const calibrationEndpoint = options.selfHostedInference?.endpoints.find(e => e.id === calibrationProfile?.endpointId && e.deletedAt === undefined);
  const calibration = calibrationProfile && calibrationEndpoint ? createCalibrationCapture({
    profileId: calibrationProfile.id,
    endpointId: calibrationEndpoint.id,
    configurationRevision: calibrationEndpoint.configurationRevision,
    thermal: preflight.thermal,
    isCurrent: options.inferenceScope?.isCurrent,
    record: options.calibration?.record ?? recordPassiveCalibration,
    requestClass: options.calibration?.requestClass,
    onQueued: options.calibration?.onQueued,
  }) : undefined;
  const cloudFetch = verifiedProviderFetch(
    options.inferenceScope?.fallbackToken
      ? createProxyFetch({ scope: options.inferenceScope, preflight })
      : preflightFetch((input, init) => globalThis.fetch(input, init), preflight),
    options.inferenceScope?.onResponseBody,
  );
  const scopedLocalFetch = verifiedProviderFetch(
    createProxyFetch({
      allowPrivateNetwork: true,
      scope: options.inferenceScope,
      admission,
      preflight,
      onAdmission: calibration?.observe,
    }),
    options.inferenceScope?.onResponseBody,
  );
  switch (provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      built = createOpenAI({ apiKey: key, fetch: cloudFetch })(resolvedModelId);
      break;
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      built = createAnthropic({ apiKey: key, fetch: cloudFetch })(
        resolvedModelId,
      );
      break;
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      built = createGoogleGenerativeAI({ apiKey: key, fetch: cloudFetch })(
        resolvedModelId,
      );
      break;
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      built = createXai({ apiKey: key, fetch: cloudFetch })(resolvedModelId);
      break;
    }
    case "cerebras": {
      const { createCerebras } = await import("@ai-sdk/cerebras");
      built = createCerebras({ apiKey: key, fetch: cloudFetch })(
        resolvedModelId,
      );
      break;
    }
    case "deepseek": {
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "deepseek",
        fetch: cloudFetch,
        baseURL: "https://api.deepseek.com",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "mistral": {
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "mistral",
        fetch: cloudFetch,
        baseURL: "https://api.mistral.ai/v1",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      built = createGroq({ apiKey: key, fetch: cloudFetch })(resolvedModelId);
      break;
    }
    case "openrouter": {
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "openrouter",
        fetch: cloudFetch,
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: key,
        headers: {
          "HTTP-Referer": "https://github.com/crynta/terax-ai",
          "X-Title": "Clack",
        },
      })(resolvedModelId);
      break;
    }
    case "openai-compatible": {
      if (!compatURL) {
        throw new Error(
          "OpenAI-compatible provider has no base URL. Set it in Settings → Models.",
        );
      }
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: compatURL,
        apiKey: options.selfHosted
          ? customEndpointKey || undefined
          : epKey || key || undefined,
        fetch: options.selfHosted
          ? verifiedProviderFetch(
              createProxyFetch({
                allowPrivateNetwork: options.allowPrivateNetwork === true,
                selfHosted: true,
                scope: options.inferenceScope,
                admission,
                preflight,
                onAdmission: calibration?.observe,
              }),
              options.inferenceScope?.onResponseBody,
            )
          : scopedLocalFetch,
      })(resolvedModelId);
      break;
    }
    case "lmstudio": {
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "lmstudio",
        baseURL: lmstudioURL,
        fetch: scopedLocalFetch,
      })(resolvedModelId);
      break;
    }
    case "mlx": {
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "mlx",
        baseURL: mlxURL,
        fetch: scopedLocalFetch,
      })(resolvedModelId);
      break;
    }
    case "ollama": {
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "ollama",
        baseURL: ollamaURL,
        fetch: scopedLocalFetch,
      })(resolvedModelId);
      break;
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${_exhaustive as ProviderId}`);
    }
  }
  built = preflight.wrap(calibration ? calibration.wrap(built) : built);
  if (!options.inferenceScope && !options.calibration) modelCache.set(cacheKey, built);
  return built;
}

export type LocalProviderConfig = {
  reasoning?: EffortCapture;
  inferenceScope?: InferenceScope;
  selfHostedInference?: SelfHostedState;
  lmstudioBaseURL?: string;
  lmstudioModelId?: string;
  mlxBaseURL?: string;
  mlxModelId?: string;
  ollamaBaseURL?: string;
  ollamaModelId?: string;
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  openrouterModelId?: string;
  savedProviderModels?: readonly SavedProviderModel[];
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
  capturedModelIdentity?: ModelTransportIdentity;
};

export function buildConfiguredLanguageModel(
  modelId: string,
  keys: ProviderKeys,
  local: LocalProviderConfig = {},
): Promise<LanguageModel> {
  const hosted =
    local.capturedModelIdentity ??
    selfHostedTransportIdentity(modelId, local.selfHostedInference);
  if (hosted?.selfHosted) {
    return buildLanguageModel(
      "openai-compatible",
      keys,
      hosted.transportModelId,
      {
        selfHosted: true,
        reasoning: local.reasoning,
        selfHostedInference: local.selfHostedInference,
        admission: endpointInferenceAdmission(
          hosted.selfHosted.endpointId,
          hosted.selfHosted.profileId,
          local.selfHostedInference,
        ),
        inferenceScope: local.inferenceScope,
        openaiCompatibleBaseURL: hosted.endpointBaseURL,
        allowPrivateNetwork: hosted.selfHosted.allowPrivateNetwork,
      },
      selfHostedCredential(hosted, keys, local.customEndpointKeys ?? {}),
    );
  }
  if (local.capturedModelIdentity) {
    const captured = local.capturedModelIdentity;
    return buildLanguageModel(
      captured.providerId,
      keys,
      captured.transportModelId,
      {
        assertedContext: captured.customEndpointId
          ? local.customEndpoints?.find(
              (ep) => ep.id === captured.customEndpointId,
            )?.contextLimit
          : undefined,
        reasoning: local.reasoning,
        lmstudioBaseURL: local.lmstudioBaseURL,
        admission: captured.customEndpointId
          ? endpointInferenceAdmission(
              captured.customEndpointId,
              captured.transportModelId,
              local.selfHostedInference,
            )
          : undefined,
        selfHostedInference: local.selfHostedInference,
        inferenceScope: local.inferenceScope,
        mlxBaseURL: local.mlxBaseURL,
        ollamaBaseURL: local.ollamaBaseURL,
        openaiCompatibleBaseURL:
          captured.endpointBaseURL ?? local.openaiCompatibleBaseURL,
      },
      captured.customEndpointId
        ? local.customEndpointKeys?.[captured.customEndpointId]
        : undefined,
    );
  }
  if (isSavedProviderModelSelectionId(modelId)) {
    const target = resolveSavedProviderModelTarget(
      modelId,
      local.savedProviderModels ?? [],
    );
    if (!target) {
      throw new Error(`Saved provider model is unavailable: ${modelId}`);
    }
    return buildLanguageModel(
      target.providerId,
      keys,
      target.transportModelId,
      {
        reasoning: local.reasoning,
        lmstudioBaseURL: local.lmstudioBaseURL,
        inferenceScope: local.inferenceScope,
        mlxBaseURL: local.mlxBaseURL,
        ollamaBaseURL: local.ollamaBaseURL,
        openaiCompatibleBaseURL: local.openaiCompatibleBaseURL,
      },
    );
  }
  if (isCompatModelId(modelId)) {
    const eid = endpointIdFromCompatModel(modelId);
    const ep = local.customEndpoints?.find((e) => e.id === eid);
    if (!ep) throw new Error(`Custom endpoint not found: ${eid}`);
    if (!ep.modelId.trim()) {
      throw new Error(`${ep.name}: no model id set. Open Settings → Models.`);
    }
    return buildLanguageModel(
      "openai-compatible",
      keys,
      ep.modelId.trim(),
      {
        reasoning: local.reasoning,
        openaiCompatibleBaseURL: ep.baseURL,
        selfHostedInference: local.selfHostedInference,
        assertedContext: ep.contextLimit,
        admission: endpointInferenceAdmission(
          eid,
          ep.modelId.trim(),
          local.selfHostedInference,
        ),
        inferenceScope: local.inferenceScope,
      },
      local.customEndpointKeys?.[eid],
    );
  }
  const m = resolveModel(modelId);
  let resolvedId: string = m.id;
  if (m.id === "lmstudio-local") {
    if (!local.lmstudioModelId?.trim()) {
      throw new Error(
        "LM Studio: no model id set. Open Settings → Models and enter the model id loaded in LM Studio.",
      );
    }
    resolvedId = local.lmstudioModelId.trim();
  } else if (m.id === "mlx-local") {
    if (!local.mlxModelId?.trim()) {
      throw new Error(
        "MLX: no model id set. Open Settings → Models and enter the model id served by mlx_lm.server.",
      );
    }
    resolvedId = local.mlxModelId.trim();
  } else if (m.id === "ollama-local") {
    if (!local.ollamaModelId?.trim()) {
      throw new Error(
        "Ollama: no model id set. Open Settings → Models and enter the model id (e.g. the name from `ollama list`).",
      );
    }
    resolvedId = local.ollamaModelId.trim();
  } else if (m.id === "openai-compatible-custom") {
    if (!local.openaiCompatibleModelId?.trim()) {
      throw new Error(
        "OpenAI-compatible: no model id set. Open Settings → Models.",
      );
    }
    resolvedId = local.openaiCompatibleModelId.trim();
  } else if (m.id === "openrouter-custom") {
    if (!local.openrouterModelId?.trim()) {
      throw new Error(
        "OpenRouter: no model id set. Open Settings → Models and enter an OpenRouter model id (e.g. anthropic/claude-sonnet-4-6).",
      );
    }
    resolvedId = local.openrouterModelId.trim();
  }
  return buildLanguageModel(m.provider, keys, resolvedId, {
    reasoning: local.reasoning,
    selfHostedInference: local.selfHostedInference,
    inferenceScope: local.inferenceScope,
    lmstudioBaseURL: local.lmstudioBaseURL,
    mlxBaseURL: local.mlxBaseURL,
    ollamaBaseURL: local.ollamaBaseURL,
    openaiCompatibleBaseURL: local.openaiCompatibleBaseURL,
  });
}

const PLAN_MODE_PROMPT = `## PLAN MODE — ACTIVE
Mutating tools (write_file, edit, multi_edit, create_directory) will queue their changes for the user to review as a single diff. Do NOT execute bash_run or bash_background while plan mode is active — restrict yourself to reads (read_file, grep, glob, list_directory) and the queued mutations. After queueing the full set of edits, stop and return a brief summary; do not continue acting until the user has accepted/rejected.`;

export function buildStableSystem(
  modelId: string,
  persona: { name: string; instructions: string } | null,
  customInstructions: string | undefined,
  projectMemory: string | null,
): string {
  const base = selectSystemPrompt(modelId);
  const personaBlock = persona?.instructions.trim()
    ? `\n\n## ACTIVE AGENT — ${persona.name}\n${persona.instructions.trim()}`
    : "";
  const customBlock = customInstructions?.trim()
    ? `\n\n## USER CUSTOM INSTRUCTIONS — follow unless they conflict with safety rules above\n${customInstructions.trim()}`
    : "";
  const memoryBlock =
    projectMemory && projectMemory.trim().length > 0
      ? `\n\n## PROJECT MEMORY\n${projectMemory.trim()}`
      : "";
  return `${base}${memoryBlock}${personaBlock}${customBlock}`;
}

export function planModeSystemText(active: boolean): string {
  return active ? PLAN_MODE_PROMPT : "";
}

// OpenAI / Gemini / DeepSeek apply prefix caching automatically; only
// Anthropic needs explicit breakpoints. Mark the stable system prefix and
// the rotating conversation tail.
function applyCacheBreakpoints(
  messages: ModelMessage[],
  provider: ProviderId,
): ModelMessage[] {
  if (provider !== "anthropic" || messages.length === 0) return messages;
  const marker = {
    anthropic: { cacheControl: { type: "ephemeral" as const } },
  };
  const withMarker = (m: ModelMessage): ModelMessage => ({
    ...m,
    providerOptions: { ...(m.providerOptions ?? {}), ...marker },
  });
  const out = messages.slice();
  out[0] = withMarker(out[0]);
  const lastIdx = out.length - 1;
  if (lastIdx > 0) out[lastIdx] = withMarker(out[lastIdx]);
  return out;
}

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type AgentUsageDelta = AgentUsage & {
  lastInputTokens: number;
  lastCachedTokens: number;
};

const EMPTY_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

export type RunAgentOptions = {
  validateRouting?: () => Promise<void>;
  mandatoryTools?: string[];
  requiredOutput?: number;
  onRequestPrepared?: (requirements: import("@/modules/ai/lib/inferenceFallback").FallbackRequirements) => void;
  watchdog?: OutputWatchdog;
  onAnswerState?: (state: AnswerState) => void;
  reasoning?: EffortCapture;
  inputCapabilities?: ModelInputCapabilities;
  onRetrieved?: (notice: RetrievalNotice) => void;
  compaction?: ConversationCompactionContext;
  onOptimized?: (notice: CompactionNotice) => void;
  inferenceScope?: InferenceScope;
  selfHostedInference?: SelfHostedState;
  keys: ProviderKeys;
  modelId?: string;
  customInstructions?: string;
  agentPersona?: { name: string; instructions: string } | null;
  toolContext: ToolContext;
  onStep?: (step: string | null) => void;
  onUsage?: (delta: AgentUsageDelta) => void;
  onCompact?: (info: { droppedCount: number }) => void;
  onRunStep?: (observation: RunStepObservation) => void;
  onProviderRetry?: (event: ProviderRetryEvent) => void;
  onProviderRecovered?: () => void;
  onFinishMeta?: (info: {
    hitStepCap: boolean;
    finishReason: string;
    steps: number;
  }) => void;
  lmstudioBaseURL?: string;
  lmstudioModelId?: string;
  mlxBaseURL?: string;
  mlxModelId?: string;
  ollamaBaseURL?: string;
  ollamaModelId?: string;
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  openaiCompatibleContextLimit?: number;
  openrouterModelId?: string;
  savedProviderModels?: readonly SavedProviderModel[];
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
  capturedModelIdentity?: ModelTransportIdentity;
  planMode?: boolean;
  projectMemory?: string | null;
  logicalContinuation?: boolean;
  recovery?: boolean;
  uiMessages: UIMessage[];
  abortSignal?: AbortSignal;
};

export async function runAgentStream(opts: RunAgentOptions) {
  const inferenceScope: InferenceScope = opts.inferenceScope
    ? { ...opts.inferenceScope }
    : {
        sessionId: crypto.randomUUID(),
        runId: crypto.randomUUID(),
        isCurrent: () => !opts.abortSignal?.aborted,
      };
  inferenceScope.validateEvidence = opts.validateRouting ?? inferenceScope.validateEvidence;
  inferenceScope.validateFallback = opts.validateRouting;
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
  const baseModel = await buildConfiguredLanguageModel(modelId, opts.keys, {
    reasoning: opts.reasoning,
    inferenceScope,
    selfHostedInference: opts.selfHostedInference,
    lmstudioBaseURL: opts.lmstudioBaseURL,
    lmstudioModelId: opts.lmstudioModelId,
    mlxBaseURL: opts.mlxBaseURL,
    mlxModelId: opts.mlxModelId,
    ollamaBaseURL: opts.ollamaBaseURL,
    ollamaModelId: opts.ollamaModelId,
    openaiCompatibleBaseURL: opts.openaiCompatibleBaseURL,
    openaiCompatibleModelId: opts.openaiCompatibleModelId,
    openrouterModelId: opts.openrouterModelId,
    savedProviderModels: opts.savedProviderModels,
    customEndpoints: opts.customEndpoints,
    customEndpointKeys: opts.customEndpointKeys,
    capturedModelIdentity: opts.capturedModelIdentity,
  });
  const endpoints = opts.customEndpoints ?? [];
  let info: ModelInfo;
  try {
    info = resolveModelSelectionInfo(
      modelId,
      endpoints,
      opts.savedProviderModels ?? [],
      opts.selfHostedInference,
    );
  } catch {
    const captured = opts.capturedModelIdentity;
    if (!captured)
      throw new Error(`Model selection is unavailable: ${modelId}`);
    info = {
      id: modelId,
      provider: captured.providerId,
      label: captured.transportModelId,
      hint: captured.providerId,
      description: captured.transportModelId,
      capabilities: { intelligence: 3, speed: 3, cost: 3 },
    };
  }
  const provider = info.provider;

  const stableSystem = buildStableSystem(
    modelId,
    opts.agentPersona ?? null,
    opts.customInstructions,
    opts.projectMemory ?? null,
  );

  const history = await convertToModelMessages(opts.uiMessages);
  const keepsReasoning = modelKeepsReasoning(info);
  const prunedHistory = pruneMessages({
    messages: history,
    reasoning: keepsReasoning ? "none" : "before-last-message",
    emptyMessages: "remove",
  });
  let compactor:
    | Awaited<ReturnType<typeof createConversationCompactor>>
    | undefined;
  const requestToolContext: ToolContext = opts.compaction
    ? {
        ...opts.toolContext,
        requestConversationEvidence: (query, anchor, expand) =>
          compactor?.requestEvidence(query, anchor, expand) ?? {
            status: "unavailable",
            message: "Context preparation has not started.",
          },
      }
    : opts.toolContext;
  const availableTools =
    opts.toolContext.isPeerReplyOnly?.() ||
    opts.inputCapabilities?.tools === "unsupported"
      ? {}
      : await buildTools(requestToolContext);
  const permittedTools = opts.mandatoryTools
    ? Object.fromEntries(Object.entries(availableTools).filter(([name]) => opts.mandatoryTools?.includes(name)))
    : availableTools;
  const exposureTarget = {
    modelId,
    provider,
    identity: opts.capturedModelIdentity,
    profiles: opts.selfHostedInference,
    endpoints: opts.customEndpoints,
    savedModels: opts.savedProviderModels,
    reasoning: opts.reasoning,
    credentials: [opts.keys, opts.customEndpointKeys],
  };
  const exposure = await prepareToolExposure(permittedTools, {
    mandatory: opts.mandatoryTools,
    context: requestToolContext,
    messages: prunedHistory,
    uiMessages: opts.uiMessages,
    target: exposureTarget,
    system: stableSystem + (opts.planMode ? PLAN_MODE_PROMPT : ""),
    limits: await modelBudgetLimits(baseModel),
  });
  const pinnedTools = new Set(exposure.names);
  let stepsSeen = 0;
  const hostedProfile = opts.selfHostedInference?.profiles.find(
    p => p.id === opts.capturedModelIdentity?.selfHosted?.profileId,
  );
  const continuationSetting = hostedProfile && opts.selfHostedInference
    ? effectiveProfileValue(opts.selfHostedInference, hostedProfile.id, "autoContinuation").value
    : undefined;
  const continuationCount = hostedProfile && opts.selfHostedInference
    ? effectiveProfileValue(opts.selfHostedInference, hostedProfile.id, "continuationCount").value
    : undefined;
  const runCalls = opts.compaction;
  const lastMessage = opts.uiMessages[opts.uiMessages.length - 1];
  const watchdog = opts.watchdog ?? createOutputWatchdog(watchdogInstruction(opts.uiMessages));
  let answerState: AnswerState | undefined;
  let watchdogStopped = false;
  const stopWatchdog = (error: unknown) => {
    const stop = readWatchdogError(error);
    if (!stop || watchdogStopped || !inferenceScope.isCurrent()) return;
    watchdogStopped = true;
    if (answerState) opts.onAnswerState?.({ ...answerState, state: "incomplete", watchdog: stop, reason: describeWatchdog(stop.reason) });
    void cancelSessionInference(inferenceScope.sessionId);
  };
  const validateRecovery = async () => {
    const current = await buildTools(requestToolContext);
    await prepareToolExposure(
      Object.fromEntries(
        Object.entries(current).filter(
          ([name, definition]) =>
            name in permittedTools &&
            sameToolRevision(definition, permittedTools[name]),
        ),
      ),
      {
        context: requestToolContext,
        messages: prunedHistory,
        uiMessages: opts.uiMessages,
        target: exposureTarget,
        system: stableSystem,
        limits: await modelBudgetLimits(baseModel),
        mandatory: [...pinnedTools],
      },
    );
  };
  const chargeRecovery = async () => {
    if (!runCalls)
      throw new ContextBudgetError(
        "recovery-run-budget",
        "Recovery requires the existing logical run budget.",
      );
    if (runCalls.remainingCalls() <= stepsSeen + 1)
      throw new ContextBudgetError(
        "recovery-run-budget",
        "The logical run has insufficient budget for another inference attempt.",
      );
    await runCalls.chargeCall();
  };
  const trackedModel = withProviderRetryTracking(
    baseModel,
    {
      onRetry: (event) => opts.onProviderRetry?.(event),
      onRecovered: () => opts.onProviderRecovered?.(),
    },
    AGENT_PROVIDER_MAX_RETRIES,
    {
      isCurrent: inferenceScope.isCurrent,
      beforeRetry: async () => {
        await validateRecovery();
        await chargeRecovery();
      },
    },
  );
  const model = withAnswerContinuation(trackedModel, {
    watchdog,
    onWatchdog: stopWatchdog,
    recovery: opts.recovery,
    previous: lastMessage?.role === "assistant"
      ? readAnswer(lastMessage) ?? undefined
      : undefined,
    knownToolIds: opts.uiMessages.flatMap(m =>
      m.parts.flatMap(p => "toolCallId" in p ? [p.toolCallId] : []),
    ),
    runId: inferenceScope.runId,
    provider,
    modelId,
    signal: opts.abortSignal,
    isCurrent: inferenceScope.isCurrent,
    onState: state => { answerState = state; opts.onAnswerState?.(state); },
    maxContinuations: continuationSetting === false ? 0
      : typeof continuationCount === "number"
        ? Math.max(0, Math.min(3, continuationCount)) : 3,
    limits: () => modelBudgetLimits(baseModel),
    remaining: runCalls
      ? () => Math.max(0, runCalls.remainingCalls() - stepsSeen)
      : undefined,
    charge: runCalls
      ? async () => {
          if (runCalls.remainingCalls() <= stepsSeen + 1)
            throw new ContextBudgetError(
              "answer-run-budget",
              "The logical run has insufficient remaining budget for an output continuation.",
            );
          await runCalls.chargeCall();
        }
      : undefined,
    validate: validateRecovery,
  });
  const tools = gateInferenceTools(
    permittedTools,
    inferenceScope,
    opts.abortSignal,
  );
  const preparationBudget = resolveContextBudget(
    await modelBudgetLimits(baseModel),
    measureRequest({
      system: stableSystem + (opts.planMode ? PLAN_MODE_PROMPT : ""),
      tools: exposure.schemas,
    }),
  );
  if (opts.requiredOutput && preparationBudget.output < opts.requiredOutput)
    throw new ContextBudgetError("fallback-output", "Fallback cannot preserve the captured output allowance.");
  opts.onRequestPrepared?.({ tools: [...exposure.names], output: preparationBudget.output,
    permissions: JSON.stringify([usePreferencesStore.getState().agentPermissionProfiles, usePreferencesStore.getState().agentWorkspacePermissions]) });
  const compact = opts.compaction
    ? { messages: prunedHistory, compacted: false, droppedCount: 0 }
    : compactModelMessagesDetailed(prunedHistory, preparationBudget.working);
  const compactedHistory = compact.messages;
  if (compact.compacted) {
    opts.onCompact?.({ droppedCount: compact.droppedCount });
  }

  const continuationInstruction = opts.recovery
    ? "\n\nThe user explicitly requested recovery of an interrupted answer. The durable assistant text is already visible. Continue from its exact ending without repeating any prefix, recap, reasoning summary, or previous tool call. This is a new generation, not an exact transport resume. Never repeat a completed or uncertain external effect."
    : opts.logicalContinuation
      ? "\n\nThis generation continues the same logical run after an internal step batch. Continue from the existing plan and tool results without recapping or restarting the task."
      : "";
  const messages: ModelMessage[] = [
    { role: "system", content: `${stableSystem}${continuationInstruction}` },
  ];
  if (opts.planMode) {
    messages.push({ role: "system", content: PLAN_MODE_PROMPT });
  }
  const systemMessages = messages.slice();
  messages.push(...compactedHistory);

  const finalMessages = applyCacheBreakpoints(messages, provider);
  const openRouterErrorTransform =
    provider === "openrouter"
      ? (await import("@/modules/ai/lib/openRouterErrors"))
          .preserveOpenRouterErrorMetadata
      : undefined;

  let targetSeed:
    | import("@/modules/ai/lib/conversationMemory").MemoryRevision
    | undefined;
  if (opts.compaction?.hasTargetContext && opts.inputCapabilities) {
    await opts.compaction.ready();
    const preferences = usePreferencesStore.getState();
    const key = await targetContextKey({
      modelId,
      configuration: opts,
      system: [
        { role: "system", content: stableSystem },
        ...(opts.planMode
          ? [{ role: "system" as const, content: PLAN_MODE_PROMPT }]
          : []),
      ],
      tools: { exposure: exposure.identity, schemas: exposure.schemas },
      limits: await modelBudgetLimits(baseModel),
      capabilities: opts.inputCapabilities,
      permissions: [
        preferences.agentPermissionProfiles,
        preferences.agentWorkspacePermissions,
      ],
      workspace: [
        opts.compaction.owner.workspaceId,
        opts.toolContext.getAgentId(),
      ],
      credentials: [opts.keys, opts.customEndpointKeys ?? {}],
    });
    opts.abortSignal?.throwIfAborted();
    targetSeed =
      (await loadTargetContext(opts.compaction.owner, key)) ?? undefined;
    opts.abortSignal?.throwIfAborted();
    if (!inferenceScope.isCurrent())
      throw new Error(
        "The captured conversation run changed during target context loading.",
      );
  }
  compactor = opts.compaction
    ? await createConversationCompactor({
        targetSeed,
        context: {
          ...opts.compaction,
          remainingCalls: () =>
            Math.max(
              0,
              (opts.compaction?.remainingCalls() ?? 0) - stepsSeen - 1,
            ),
          chargeCall: async () => {
            if ((opts.compaction?.remainingCalls() ?? 0) <= stepsSeen + 1)
              throw new ContextBudgetError(
                "compaction-run-budget",
                "The logical run has insufficient remaining budget for preparation and a response.",
              );
            await opts.compaction?.chargeCall();
          },
        },
        materialized: opts.uiMessages,
        system: systemMessages,
        keepReasoning: keepsReasoning,
        tools: exposure.schemas,
        model: baseModel,
        scope: inferenceScope,
        limits: () => modelBudgetLimits(baseModel),
        signal: opts.abortSignal,
        onStep: opts.onStep,
        onOptimized: opts.onOptimized,
        retrieve: retrieveConversationEvidence,
        allowance: runRetrievalAllowance(inferenceScope),
        scopedEvidence: opts.toolContext.getWorkspaceId?.()
          ? {
              read: retrieveScopedEvidence,
              allowed: () =>
                resolveCurrentAgentPermission("read_file", {}, opts.toolContext)
                  .outcome === "allow",
            }
          : undefined,
        onRetrieved: opts.onRetrieved,
        onUsage: (usage) =>
          opts.onUsage?.({
            ...usage,
            lastInputTokens: usage.inputTokens,
            lastCachedTokens: usage.cachedInputTokens,
          }),
      })
    : undefined;
  const preparedContext = compactor;
  inferenceScope.validateEvidence = async () => {
    await opts.validateRouting?.();
    await preparedContext?.validateEvidence();
    await opts.toolContext.validatePeerReview?.();
  };
  return streamText({
    maxOutputTokens: opts.requiredOutput,
    model,
    messages: finalMessages,
    tools,
    activeTools: exposure.names,
    includeRawChunks: provider === "openrouter",
    experimental_transform: openRouterErrorTransform,
    onError: compactor
      ? () => {
          compactor?.dispose();
          opts.onStep?.(null);
        }
      : provider === "openrouter"
        ? () => undefined
        : undefined,
    onAbort: () => compactor?.dispose(),
    prepareStep: async ({ messages: stepMessages, stepNumber }) => {
      if (watchdog.error) throw watchdog.error;
      const currentTools =
        opts.toolContext.isPeerReplyOnly?.() ||
        opts.inputCapabilities?.tools === "unsupported"
          ? {}
          : await buildTools(requestToolContext);
      const selection = await prepareToolExposure(
        Object.fromEntries(
          Object.entries(currentTools).filter(
            ([name, definition]) =>
              name in permittedTools &&
              sameToolRevision(definition, permittedTools[name]),
          ),
        ),
        {
          context: requestToolContext,
          messages: stepMessages,
          uiMessages: opts.uiMessages,
          target: exposureTarget,
          system: systemMessages,
          limits: await modelBudgetLimits(baseModel),
          mandatory: [...pinnedTools],
        },
      );
      for (const name of selection.names) pinnedTools.add(name);
      if (!preparedContext) return { activeTools: selection.names };
      if ((opts.compaction?.remainingCalls() ?? 0) <= stepNumber)
        throw new ContextBudgetError(
          "compaction-run-budget",
          "The logical run reached its request limit.",
        );
      return {
        activeTools: selection.names,
        messages: applyCacheBreakpoints(
          await preparedContext.prepare(
            stepMessages.slice(finalMessages.length),
            selection.schemas,
          ),
          provider,
        ),
      };
    },
    maxRetries: 0,
    stopWhen: [
      stepCountIs(
        opts.toolContext.isPeerReplyOnly?.()
          ? 1
          : Math.max(
              1,
              Math.min(
                AGENT_SOFT_STEP_LIMIT,
                opts.toolContext.peerRemainingSteps?.() ??
                  AGENT_SOFT_STEP_LIMIT,
              ),
            ),
      ),
      () => opts.toolContext.shouldYieldPeerRun?.() ?? false,
    ],
    abortSignal: opts.abortSignal,
    onStepFinish: (step) => {
      stepsSeen++;
      if (opts.onStep) {
        const last = step.toolCalls?.[step.toolCalls.length - 1];
        if (last) {
          const label = TOOL_LABELS[last.toolName];
          opts.onStep(
            label
              ? label((last.input ?? {}) as Record<string, unknown>)
              : `Calling ${last.toolName}`,
          );
        } else if (step.text) {
          opts.onStep("Writing");
        }
      }
      if (opts.onUsage && step.usage) {
        const u = step.usage;
        const stepInput = u.inputTokens ?? 0;
        const stepCached = u.inputTokenDetails?.cacheReadTokens ?? 0;
        opts.onUsage({
          inputTokens: stepInput,
          outputTokens: u.outputTokens ?? 0,
          cachedInputTokens: stepCached,
          lastInputTokens: stepInput,
          lastCachedTokens: stepCached,
        });
      }
      for (const call of step.toolCalls ?? []) {
        const observation = runStepObservation({ toolResults: step.toolResults, toolCalls: [call] });
        if (!observation) continue;
        opts.onRunStep?.(observation);
        const stop = watchdog.tool(observation, permittedTools[call.toolName] ? toolRevisionIdentity(permittedTools[call.toolName]) : null);
        if (stop) { stopWatchdog(stop); throw stop; }
      }
    },
    onFinish: (result) => {
      compactor?.dispose();
      opts.onStep?.(null);
      const finishReason =
        (result as { finishReason?: string } | undefined)?.finishReason ?? "";
      opts.onFinishMeta?.({
        hitStepCap:
          stepsSeen >= AGENT_SOFT_STEP_LIMIT && finishReason === "tool-calls",
        finishReason,
        steps: stepsSeen,
      });
    },
  });
}

function runStepObservation(step: {
  toolCalls?: Array<{
    toolCallId?: string;
    toolName: string;
    input?: unknown;
  }>;
  toolResults?: unknown[];
}): RunStepObservation | null {
  const call = step.toolCalls?.[step.toolCalls.length - 1];
  if (!call) return null;
  const result = step.toolResults?.find(
    (candidate) =>
      (candidate as { toolCallId?: string } | undefined)?.toolCallId ===
      call.toolCallId,
  );
  const output =
    result && typeof result === "object" && "output" in result
      ? (result as { output: unknown }).output
      : result;
  return {
    toolName: call.toolName,
    input: call.input,
    output,
    failed: isFailedToolOutput(result, output),
  };
}

function isFailedToolOutput(result: unknown, output: unknown): boolean {
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (record.error != null || record.errorText != null) return true;
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    return record.error != null || record.ok === false;
  }
  return false;
}

export { EMPTY_USAGE };
