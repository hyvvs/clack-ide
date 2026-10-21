import type { UIMessage } from "@ai-sdk/react";
import {
  ACTIVITY_ENABLED,
  type ActivityOwner,
} from "@/modules/ai/lib/activity";
import {
  activityStream,
  type ActivityStreamContext,
} from "@/modules/ai/lib/activityStream";
import type { CustomEndpoint } from "../config";
import { runAgentStream, type AgentUsageDelta } from "./agent";
import { acquireRemoteConnection, holdRemoteStream, remoteEndpointForModel } from "@/modules/ai/lib/remoteConnection";
import type { ProviderKeys, CustomEndpointKeys } from "./keyring";
import { native } from "./native";
import type { ToolContext } from "../tools/tools";
import type { RunStepObservation } from "./runBudget";
import type { ProviderRetryEvent } from "./providerRetry";
import {
  resolveModelTransportIdentity,
  type ModelTransportIdentity,
  type SavedProviderModel,
} from "@/modules/ai/lib/savedProviderModels";
import { resolveProviderContext } from "@/modules/ai/lib/providerContext";
import type { WorkspaceEnv } from "@/modules/workspace/env";
import { materializeAttachmentMessages } from "./attachmentMessages";
import {
  resolveModelInputCapabilities,
  type ModelInputCapabilities,
} from "./modelCapabilities";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { resolveSelfHostedSelection, endpointBackend } from "@/modules/ai/lib/selfHostedProfiles";
import { readSelfHostedSnapshot } from "@/modules/ai/lib/selfHostedCapabilities";
import type { InferenceScope } from "@/modules/ai/lib/inferenceLifecycle";
import {
  createOutputWatchdog,
  watchdogInstruction,
  type OutputWatchdog,
} from "@/modules/ai/lib/outputWatchdog";
import { answerMetadataStream } from "@/modules/ai/lib/answerContinuation";
import type {
  ConversationCompactionContext,
  CompactionNotice,
} from "@/modules/ai/lib/conversationCompaction";
import {
  fallbackStream,
  safeFallbackHistory,
  type FallbackRequirements,
} from "@/modules/ai/lib/inferenceFallback";
import type { RunAgentOptions } from "@/modules/ai/lib/agent";

export type FallbackAttempt = {
  configuration: Partial<RunAgentOptions>;
  capabilities: ModelInputCapabilities;
};
export type PrepareFallback = (request: {
  primary: Partial<RunAgentOptions>;
  originals: UIMessage[];
  requirements: FallbackRequirements;
  error: unknown;
  signal?: AbortSignal;
}) => Promise<FallbackAttempt | null>;

const PROJECT_MEMORY_MAX_BYTES = 32 * 1024;

export async function readProjectMemory(
  workspaceRoot: string | null,
  workspace?: WorkspaceEnv,
): Promise<string | null> {
  if (!workspaceRoot) return null;
  for (const name of ["CLACK.md", "TERAX.md"]) {
    const path = `${workspaceRoot.replace(/\/$/, "")}/${name}`;
    try {
      const r = await native.readFile(path, workspace);
      if (r.kind !== "text") {
        continue;
      }
      const content =
        r.content.length > PROJECT_MEMORY_MAX_BYTES
          ? r.content.slice(0, PROJECT_MEMORY_MAX_BYTES)
          : r.content;
      return content;
    } catch {
      continue;
    }
  }
  return null;
}

type LiveSnapshot = {
  cwd: string | null;
  terminalPrivate: boolean;
  workspaceRoot: string | null;
  activeFile: string | null;
};

export type ShellIdentity = {
  name: string;
  syntax: string;
};

type Deps = {
  prepareFallback?: PrepareFallback;
  getActivityOwner?: () => ActivityOwner | undefined;
  onRetrieved?: import("@/modules/ai/lib/agent").RunAgentOptions["onRetrieved"];
  prepareCompactionContext?: (
    originals: UIMessage[],
  ) => Promise<ConversationCompactionContext>;
  onOptimized?: (notice: CompactionNotice) => void;
  getInferenceScope?: () => InferenceScope | undefined;
  getSelfHostedInference?: () => SelfHostedState;
  getKeys: () => ProviderKeys;
  toolContext: ToolContext;
  getModelId: () => string;
  getCustomInstructions: () => string;
  getAgentPersona: () => { name: string; instructions: string } | null;
  getLive: () => LiveSnapshot;
  getShellIdentity?: () => Promise<ShellIdentity> | ShellIdentity;
  getLmstudioBaseURL?: () => string | undefined;
  getLmstudioModelId?: () => string | undefined;
  getMlxBaseURL?: () => string | undefined;
  getMlxModelId?: () => string | undefined;
  getOllamaBaseURL?: () => string | undefined;
  getOllamaModelId?: () => string | undefined;
  getOpenaiCompatibleBaseURL?: () => string | undefined;
  getOpenaiCompatibleModelId?: () => string | undefined;
  getOpenaiCompatibleContextLimit?: () => number | undefined;
  getOpenrouterModelId?: () => string | undefined;
  getSavedProviderModels?: () => readonly SavedProviderModel[];
  getCapturedModelIdentity?: () => ModelTransportIdentity | undefined;
  getReasoning?: () =>
    | import("@/modules/ai/lib/reasoningEffort").EffortCapture
    | undefined;
  getCustomEndpoints?: () => readonly CustomEndpoint[];
  getCustomEndpointKeys?: () => CustomEndpointKeys;
  onStep?: (step: string | null) => void;
  onUsage?: (delta: AgentUsageDelta) => void;
  onCompact?: (info: { droppedCount: number }) => void;
  onBatchStart?: () => { isLogicalContinuation: boolean };
  onRunStep?: (observation: RunStepObservation) => void;
  onFinishMeta?: (info: {
    hitStepCap: boolean;
    finishReason: string;
    steps: number;
  }) => void;
  onError?: (error: unknown) => string;
  onProviderRetry?: (event: ProviderRetryEvent) => void;
  onProviderRecovered?: () => void;
  getPlanMode?: () => boolean;
};

type SendOptions = {
  messages: UIMessage[];
  abortSignal?: AbortSignal;
  [k: string]: unknown;
};

export function createContextAwareTransport(deps: Deps) {
  let fallbackCapture: { runId: string; attempt: FallbackAttempt } | undefined;
  let watchdogOwner: { runId: string; detector: OutputWatchdog } | undefined;
  let captured:
    | {
        runId: string;
        configuration: Pick<
          import("@/modules/ai/lib/agent").RunAgentOptions,
          | "keys"
          | "modelId"
          | "reasoning"
          | "selfHostedInference"
          | "customInstructions"
          | "agentPersona"
          | "lmstudioBaseURL"
          | "lmstudioModelId"
          | "mlxBaseURL"
          | "mlxModelId"
          | "ollamaBaseURL"
          | "ollamaModelId"
          | "openaiCompatibleBaseURL"
          | "openaiCompatibleModelId"
          | "openaiCompatibleContextLimit"
          | "openrouterModelId"
          | "savedProviderModels"
          | "capturedModelIdentity"
          | "customEndpoints"
          | "customEndpointKeys"
          | "planMode"
        >;
      }
    | undefined;
  let hostedCapabilities:
    | {
        identity: NonNullable<ModelTransportIdentity["selfHosted"]>;
        capabilities: ModelInputCapabilities;
      }
    | undefined;
  const run = async (
    options: SendOptions,
    activity?: ActivityStreamContext,
  ) => {
    const recovery =
      (options.body as { clackRecovery?: boolean } | undefined)
        ?.clackRecovery === true;
    const scope = deps.getInferenceScope?.();
    if (fallbackCapture?.runId !== scope?.runId) fallbackCapture = undefined;
    if (!scope || watchdogOwner?.runId !== scope.runId)
      watchdogOwner = {
        runId: scope?.runId ?? crypto.randomUUID(),
        detector: createOutputWatchdog(watchdogInstruction(options.messages)),
      };
    const watchdog = watchdogOwner.detector;
    if (recovery && (!captured || captured.runId !== scope?.runId))
      throw new Error(
        "Captured request settings are unavailable after restart. Send a new instruction; the partial answer remains preserved.",
      );
    const reasoning = recovery
      ? captured?.configuration.reasoning
      : deps.getReasoning?.();
    const batch = deps.onBatchStart?.() ?? { isLogicalContinuation: false };
    const compaction = await deps.prepareCompactionContext?.(options.messages);
    const live = deps.getLive();
    const projectMemory = await readProjectMemory(
      live.workspaceRoot,
      deps.toolContext.getWorkspaceEnv?.(),
    );
    const shellIdentity = await deps.getShellIdentity?.();
    const envBlock = formatEnvBlock(live, shellIdentity);
    let hostedState = recovery
      ? captured?.configuration.selfHostedInference
      : deps.getSelfHostedInference?.();
    if (!recovery && !batch.isLogicalContinuation && hostedState) {
      const target = resolveSelfHostedSelection(hostedState, deps.getModelId());
      if (target.status === "available" && !target.profile.overrides.workingContext && endpointBackend(target.endpoint) === "ollama") {
        const { ensureSelectedContext } = await import("@/modules/ai/lib/contextCalibrationRuntime");
        hostedState = await ensureSelectedContext(hostedState, deps.getModelId(), options.abortSignal ?? new AbortController().signal, scope);
      }
    }
    const capturedIdentity = recovery
      ? captured?.configuration.capturedModelIdentity
      : deps.getCapturedModelIdentity?.();
    const configuration =
      recovery && captured
        ? captured.configuration
        : structuredClone({
            keys: deps.getKeys(),
            modelId: deps.getModelId(),
            reasoning,
            selfHostedInference: hostedState,
            customInstructions: deps.getCustomInstructions(),
            agentPersona: deps.getAgentPersona(),
            lmstudioBaseURL: deps.getLmstudioBaseURL?.(),
            lmstudioModelId: deps.getLmstudioModelId?.(),
            mlxBaseURL: deps.getMlxBaseURL?.(),
            mlxModelId: deps.getMlxModelId?.(),
            ollamaBaseURL: deps.getOllamaBaseURL?.(),
            ollamaModelId: deps.getOllamaModelId?.(),
            openaiCompatibleBaseURL: deps.getOpenaiCompatibleBaseURL?.(),
            openaiCompatibleModelId: deps.getOpenaiCompatibleModelId?.(),
            openaiCompatibleContextLimit:
              deps.getOpenaiCompatibleContextLimit?.(),
            openrouterModelId: deps.getOpenrouterModelId?.(),
            savedProviderModels: deps.getSavedProviderModels?.(),
            capturedModelIdentity: capturedIdentity,
            customEndpoints: deps.getCustomEndpoints?.(),
            customEndpointKeys: deps.getCustomEndpointKeys?.(),
            planMode: deps.getPlanMode?.(),
          });
    if (!configuration.modelId)
      throw new Error(
        "Captured model selection is unavailable. Choose a model before sending.",
      );
    const route =
      configuration.capturedModelIdentity ??
      resolveModelTransportIdentity(configuration.modelId, configuration);
    const providerEvidence =
      route.providerId === "openrouter"
        ? (
            await resolveProviderContext(
              route.transportModelId,
              route.providerId,
              false,
              route.providerEvidence,
            )
          ).reportedEvidence
        : undefined;
    options.abortSignal?.throwIfAborted();
    const identity = capturedIdentity?.selfHosted;
    const snapshot =
      hostedState && (!identity || hostedCapabilities?.identity !== identity)
        ? await readSelfHostedSnapshot(hostedState, configuration.modelId)
        : null;
    const capabilities =
      identity && hostedCapabilities?.identity === identity
        ? hostedCapabilities.capabilities
        : resolveModelInputCapabilities(
            configuration.modelId,
            hostedState,
            snapshot,
            { identity: route, evidence: providerEvidence },
          );
    if (identity) hostedCapabilities = { identity, capabilities };
    else hostedCapabilities = undefined;
    if (capabilities.text === "unsupported")
      throw new Error(
        "Model unavailable or not a chat model. Choose a chat model in Models & Providers.",
      );
    const messagesWithAttachments = await materializeAttachmentMessages(
      options.messages,
      capabilities,
    );
    if (!recovery && scope) captured = { runId: scope.runId, configuration };
    let primaryError: unknown;
    let primaryBody = false;
    let requirements: FallbackRequirements = { tools: [], output: 0 };
    const execute = (attempt?: FallbackAttempt) =>
      answerMetadataStream(async (onAnswerState) => {
        const attemptMessages = attempt
          ? await materializeAttachmentMessages(
              options.messages,
              attempt.capabilities,
            )
          : messagesWithAttachments;
        const result = await runAgentStream({
          watchdog,
          onAnswerState,
          reasoning,
          compaction,
          onRetrieved: deps.onRetrieved,
          onOptimized: deps.onOptimized,
          inferenceScope: scope
            ? {
                ...(activity?.scope ?? scope),
                onResponseBody: () => {
                  primaryBody = true;
                },
              }
            : undefined,
          selfHostedInference: hostedState,
          toolContext: {
            ...deps.toolContext,
            onCustomToolActivity: (id, state, effect) =>
              activity?.customTool(id, state, effect),
          },
          onStep: (value) => {
            if (scope?.isCurrent() !== false) deps.onStep?.(value);
          },
          onUsage: (value) => {
            if (scope?.isCurrent() !== false) deps.onUsage?.(value);
          },
          onCompact: (value) => {
            if (scope?.isCurrent() !== false) deps.onCompact?.(value);
          },
          onRunStep: (value) => {
            if (scope?.isCurrent() !== false) deps.onRunStep?.(value);
          },
          onProviderRetry: (event) => {
            if (scope?.isCurrent() === false) return;
            deps.onProviderRetry?.(event);
            activity?.retry(event);
          },
          onProviderRecovered: () => {
            if (scope?.isCurrent() === false) return;
            deps.onProviderRecovered?.();
            activity?.recovered();
          },
          onFinishMeta: (value) => {
            if (scope?.isCurrent() !== false) deps.onFinishMeta?.(value);
          },
          projectMemory,
          logicalContinuation: batch.isLogicalContinuation,
          abortSignal: options.abortSignal,
          ...configuration,
          ...(attempt?.configuration ?? {}),
          onRequestPrepared: (value) => {
            requirements = value;
          },
          inputCapabilities: attempt?.capabilities ?? capabilities,
          toolSelectionMessages: attemptMessages,
          uiMessages: envBlock
            ? injectEnvIntoLastUser(attemptMessages, envBlock)
            : attemptMessages,
          recovery,
        });
        return result.toUIMessageStream({
          originalMessages: options.messages,
          onError: (error) => {
            if (!attempt && deps.prepareFallback) {
              primaryError = error;
              return "Primary inference failed.";
            }
            return (
              (scope?.isCurrent() === false
                ? "Cancelled or superseded run."
                : deps.onError?.(error)) ??
              "The AI run failed for an unexpected reason."
            );
          },
        });
      });
    if (!deps.prepareFallback || fallbackCapture)
      return execute(fallbackCapture?.attempt);
    return fallbackStream({
      primary: () => Promise.resolve(execute()),
      error: () => primaryError,
      eligible:
        !recovery &&
        !batch.isLogicalContinuation &&
        safeFallbackHistory(options.messages),
      signal: options.abortSignal,
      formatError: (error) =>
        deps.onError?.(error) ?? "The AI run failed for an unexpected reason.",
      fallback: async (error) => {
        if (primaryBody || scope?.isCurrent() === false) return null;
        const attempt = await deps.prepareFallback?.({
          primary: configuration,
          originals: options.messages,
          requirements,
          error,
          signal: options.abortSignal,
        });
        if (
          !attempt ||
          scope?.isCurrent() === false ||
          options.abortSignal?.aborted
        )
          return null;
        await compaction?.chargeCall();
        if (scope) fallbackCapture = { runId: scope.runId, attempt };
        return execute(attempt);
      },
    });
  };

  const connectedRun = async (options: SendOptions, activity?: ActivityStreamContext) => {
    const release=await acquireRemoteConnection(remoteEndpointForModel(deps.getModelId(),deps.getSelfHostedInference?.()),options.abortSignal,deps.getInferenceScope?.());
    try { return holdRemoteStream(await run(options,activity),release); }
    catch(error){release();throw error;}
  };
  return {
    canRecover: (runId: string) => captured?.runId === runId,
    sendMessages: (options: SendOptions) => {
      const owner = ACTIVITY_ENABLED ? deps.getActivityOwner?.() : undefined;
      if (!owner) return connectedRun(options);
      return Promise.resolve(
        activityStream(
          options.messages,
          owner,
          deps.getInferenceScope?.(),
          (context) => connectedRun(options, context),
          (error) =>
            deps.onError?.(error) ??
            "The AI run failed for an unexpected reason.",
        ),
      );
    },
    async reconnectToStream(): Promise<null> {
      return null;
    },
  };
}

function injectEnvIntoLastUser(
  messages: UIMessage[],
  envBlock: string,
): UIMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const parts = m.parts as ReadonlyArray<{ type: string; text?: string }>;
    let textIdx = -1;
    for (let j = 0; j < parts.length; j++) {
      if (parts[j].type === "text") {
        textIdx = j;
        break;
      }
    }
    const nextParts =
      textIdx === -1
        ? [{ type: "text", text: envBlock }, ...parts]
        : parts.map((p, idx) =>
            idx === textIdx
              ? { ...p, text: `${envBlock}\n\n${p.text ?? ""}` }
              : p,
          );
    const out = messages.slice();
    out[i] = { ...m, parts: nextParts } as UIMessage;
    return out;
  }
  return messages;
}

export function formatEnvBlock(
  live: LiveSnapshot,
  shellIdentity?: ShellIdentity,
): string | null {
  const lines: string[] = [];
  if (live.workspaceRoot) lines.push(`workspace_root: ${live.workspaceRoot}`);
  if (live.cwd) lines.push(`active_terminal_cwd: ${live.cwd}`);
  if (live.activeFile) lines.push(`active_file: ${live.activeFile}`);
  if (live.terminalPrivate) lines.push("active_terminal_mode: private");
  if (shellIdentity) {
    lines.push(`shell: ${shellIdentity.name}`);
    lines.push(`shell_syntax: ${shellIdentity.syntax}`);
  }
  if (lines.length === 0) return null;
  return `<env>\n${lines.join("\n")}\n</env>`;
}

export const CONTEXT_BLOCK_RE =
  /^<terminal-context[^>]*>[\s\S]*?<\/terminal-context>\n*/;

export function stripContextBlock(text: string): string {
  return text.replace(CONTEXT_BLOCK_RE, "");
}
