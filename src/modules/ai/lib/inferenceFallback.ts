import type { UIMessage, UIMessageChunk } from "ai";
import type { ModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import type { ModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import type { EffortCapture } from "@/modules/ai/lib/reasoningEffort";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import { assessModelSwitch } from "@/modules/ai/lib/modelSwitchEligibility";
import { isRetryableProviderAttempt } from "@/modules/ai/lib/providerRetry";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";

export const FALLBACK_CATEGORIES = [
  "conversation",
  "source files",
  "attachments",
  "memory",
  "artifacts",
  "tool results",
] as const;
export const FALLBACK_ROUTING_ENABLED = true;
export type FallbackDestination = {
  modelId: string;
  identity: ModelTransportIdentity;
  baseUrl: string;
  configurationHash: string;
};
export type FallbackPolicy = {
  version: 1;
  revision: number;
  mode: "never" | "ask" | "trusted";
  agentId: string | null;
  workspaceId: string | null;
  primary: FallbackDestination | null;
  destination: FallbackDestination | null;
  categories: string[];
  history: {
    id?: string;
    kind: string;
    at: number;
    mode?: string;
    runId?: number;
    destination?: FallbackDestination;
  }[];
};
export type FallbackRequirements = {
  tools: string[];
  output: number;
  permissions?: string;
};
export type FallbackRequest = {
  primary: FallbackDestination;
  messages: UIMessage[];
  requirements: FallbackRequirements;
  reasoning?: EffortCapture;
  error: unknown;
  signal?: AbortSignal;
};

function validDestination(
  value: FallbackDestination | null | undefined,
): boolean {
  return (
    !!value &&
    typeof value.modelId === "string" &&
    value.modelId.length <= 1024 &&
    typeof value.baseUrl === "string" &&
    value.baseUrl.length <= 4096 &&
    typeof value.configurationHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.configurationHash) &&
    !!value.identity &&
    typeof value.identity.providerId === "string" &&
    typeof value.identity.transportModelId === "string"
  );
}

export function effectiveFallback(
  value: unknown,
  enabled = FALLBACK_ROUTING_ENABLED,
): FallbackPolicy | null {
  if (!value || typeof value !== "object") return null;
  const p = value as FallbackPolicy;
  if (
    p.version !== 1 ||
    !Number.isSafeInteger(p.revision) ||
    p.revision < 1 ||
    !["never", "ask", "trusted"].includes(p.mode) ||
    !Array.isArray(p.history) ||
    p.history.length > 32 ||
    p.history.some(
      (entry) =>
        !entry ||
        typeof entry.kind !== "string" ||
        !Number.isFinite(entry.at) ||
        (entry.destination !== undefined &&
          !validDestination(entry.destination)),
    ) ||
    (p.agentId !== null && typeof p.agentId !== "string") ||
    (p.workspaceId !== null && typeof p.workspaceId !== "string") ||
    JSON.stringify(p).length > 64 * 1024 ||
    (p.mode !== "never" &&
      (!validDestination(p.destination) ||
        !validDestination(p.primary) ||
        JSON.stringify(p.categories) !== JSON.stringify(FALLBACK_CATEGORIES)))
  )
    return null;
  return enabled ? p : { ...p, mode: "never" };
}

export function sameDestination(
  a: FallbackDestination,
  b: FallbackDestination,
): boolean {
  return (
    a.modelId === b.modelId &&
    a.baseUrl === b.baseUrl &&
    a.configurationHash === b.configurationHash &&
    JSON.stringify(a.identity) === JSON.stringify(b.identity)
  );
}

export function fallbackCompatibility(
  request: FallbackRequest,
  destination: FallbackDestination,
  capabilities: ModelInputCapabilities,
  profiles?: SelfHostedState,
): EffortCapture {
  if (
    capabilities.text === "unsupported" ||
    (request.requirements.tools.length && capabilities.tools !== "supported")
  )
    throw new Error(
      "Fallback cannot satisfy the captured chat/tool requirements.",
    );
  const assessment = assessModelSwitch({
    messages: request.messages,
    targetModelId: destination.modelId,
    contextLimit: null,
    providerChanged: true,
    capabilities,
  });
  if (assessment.blockingReasons?.length || assessment.status === "blocked")
    throw new Error(
      `Fallback incompatible: ${(assessment.blockingReasons ?? assessment.reasons).join(" ")}`,
    );
  if (
    assessment.reasons.some((reason) =>
      /compatibility is unconfirmed|support is unconfirmed|input compatibility.*unconfirmed/i.test(
        reason,
      ),
    )
  )
    throw new Error(
      "Fallback attachment or tool-history support is unconfirmed. Nothing was sent.",
    );
  const reasoning = captureEffort(
    destination.modelId,
    destination.identity,
    undefined,
    profiles,
  );
  if (request.reasoning && request.reasoning.choice !== "automatic") {
    if (
      reasoning.capability.status !== "supported" ||
      !reasoning.capability.levels.includes(request.reasoning.choice)
    )
      throw new Error(
        "Fallback does not support the captured reasoning effort. Nothing was sent.",
      );
    reasoning.choice = request.reasoning.choice;
  }
  return reasoning;
}

export function safeFallbackHistory(messages: readonly UIMessage[]): boolean {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].role === "user") {
      lastUser = i;
      break;
    }
  return (
    lastUser >= 0 &&
    messages.slice(lastUser + 1).every((m) => m.parts.length === 0)
  );
}

// Buffer only structural prefixes. Once any output/tool part is visible, rerouting is forbidden.
export function fallbackStream(options: {
  primary: () => Promise<ReadableStream<UIMessageChunk>>;
  error: () => unknown;
  fallback: (error: unknown) => Promise<ReadableStream<UIMessageChunk> | null>;
  formatError: (error: unknown) => string;
  signal?: AbortSignal;
  eligible: boolean;
}): ReadableStream<UIMessageChunk> {
  let reader: ReadableStreamDefaultReader<UIMessageChunk> | undefined;
  let cancelled = false;
  return new ReadableStream({
    async start(controller) {
      const prefix: UIMessageChunk[] = [];
      let bytes = 0;
      let visible = false;
      const emit = (part: UIMessageChunk) => {
        if (!cancelled) controller.enqueue(part);
      };
      const flush = () => {
        for (const p of prefix) emit(p);
        prefix.length = 0;
      };
      let failure: unknown;
      try {
        reader = (await options.primary()).getReader();
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value.type === "error") {
            failure = options.error() ?? new Error(value.errorText);
            break;
          }
          const metadata =
            value.type === "message-metadata"
              ? (value.messageMetadata as {
                  clackAnswer?: {
                    watchdog?: unknown;
                    segments?: { pending?: unknown[]; outputTokens?: number }[];
                  };
                })
              : undefined;
          const harmlessMetadata =
            metadata?.clackAnswer &&
            !metadata.clackAnswer.watchdog &&
            metadata.clackAnswer.segments?.every(
              (s) => !s.pending?.length && !s.outputTokens,
            );
          const structural =
            [
              "start",
              "start-step",
              "finish-step",
              "finish",
              "text-start",
              "reasoning-start",
              "text-end",
              "reasoning-end",
            ].includes(value.type) || Boolean(harmlessMetadata);
          if (
            !visible &&
            structural &&
            prefix.length < 256 &&
            bytes < 64 * 1024
          ) {
            prefix.push(value);
            bytes += JSON.stringify(value).length;
          } else {
            visible = true;
            flush();
            emit(value);
          }
        }
      } catch (error) {
        failure = options.error() ?? error;
      }
      if (failure) {
        await reader?.cancel().catch(() => undefined);
        try {
          if (
            !visible &&
            !cancelled &&
            !options.signal?.aborted &&
            options.eligible &&
            isRetryableProviderAttempt(failure)
          ) {
            const alternate = await options.fallback(failure);
            if (alternate) {
              prefix.length = 0;
              reader = alternate.getReader();
              while (!cancelled) {
                const { value, done } = await reader.read();
                if (done) break;
                emit(value);
              }
              if (!cancelled) controller.close();
              return;
            }
          }
        } catch (error) {
          failure = error;
        }
        flush();
        emit({ type: "error", errorText: options.formatError(failure) });
      } else {
        flush();
      }
      if (!cancelled) controller.close();
    },
    async cancel() {
      cancelled = true;
      await reader?.cancel().catch(() => undefined);
    },
  });
}
