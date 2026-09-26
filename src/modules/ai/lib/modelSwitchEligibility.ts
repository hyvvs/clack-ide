import type { UIMessage } from "ai";
import {
  endpointIdFromCompatModel,
  isCompatModelId,
  MODEL_CONTEXT_LIMITS,
  type CustomEndpoint,
} from "../config";
import {
  attachmentReferenceAsRecord,
  CLACK_ATTACHMENT_PART_TYPE,
  isAttachmentMessagePart,
} from "./attachmentMessages";
import {
  attachmentCapabilityStatus,
  resolveModelInputCapabilities,
  type CapabilitySupport,
  type ModelInputCapabilities,
} from "./modelCapabilities";
import { isSavedProviderModelSelectionId } from "./savedProviderModels";
import {
  estimateTextTokens,
  resolveContextBudget,
  type BudgetLimits,
} from "@/modules/ai/lib/contextBudget";

export type ModelSwitchAssessment = {
  status: "compatible" | "blocked" | "warning";
  reasons: string[];
  blockingReasons?: string[];
  details?: string[];
  estimatedTokens: number;
  contextLimit: number | null;
  workingBudget?: number;
};

export function knownModelContextLimit(
  modelId: string,
  endpoints: readonly CustomEndpoint[] = [],
  legacyContextLimit?: number,
): number | null {
  const positive = (value: number | undefined) =>
    value && Number.isFinite(value) && value > 0 ? value : null;
  if (isCompatModelId(modelId)) {
    return positive(
      endpoints.find((ep) => ep.id === endpointIdFromCompatModel(modelId))
        ?.contextLimit,
    );
  }
  if (modelId === "openai-compatible-custom")
    return positive(legacyContextLimit);
  // Freeform IDs have display estimates in config, not verified model windows.
  if (
    resolveModelInputCapabilities(modelId).evidence !== "registry" ||
    isSavedProviderModelSelectionId(modelId)
  )
    return null;
  return positive(MODEL_CONTEXT_LIMITS[modelId]);
}

export function assessModelSwitch({
  messages,
  targetModelId,
  contextLimit,
  systemText = "",
  providerChanged = false,
  capabilities = resolveModelInputCapabilities(targetModelId),
  budgetLimits,
  toolTokens = 0,
}: {
  messages: readonly UIMessage[];
  targetModelId: string;
  contextLimit: number | null;
  systemText?: string;
  providerChanged?: boolean;
  capabilities?: ModelInputCapabilities;
  budgetLimits?: BudgetLimits;
  toolTokens?: number;
}): ModelSwitchAssessment {
  const blocked = new Set<string>();
  if (capabilities.text === "unsupported")
    blocked.add("The selected model is unavailable or does not support chat.");
  const warnings = new Set<string>();
  let tokens = 0;
  let overhead = 0;
  const check = (
    support: CapabilitySupport,
    incompatible: string,
    unknown: string,
  ) => {
    if (support === "unsupported") blocked.add(incompatible);
    if (support === "unknown") warnings.add(unknown);
  };
  const image = () => {
    check(
      capabilities.image,
      "This chat contains images that this model cannot receive.",
      "Image support is unconfirmed. Sending remains blocked until you choose a model with confirmed vision support.",
    );
    if (capabilities.image === "supported")
      warnings.add(
        "Images add model-dependent context usage that this estimate cannot measure.",
      );
  };
  for (const message of messages) {
    overhead += 8;
    for (const part of message.parts) {
      if (part.type === "text" || part.type === "reasoning") {
        tokens += estimateTextTokens(part.text);
        if (part.type === "reasoning" && providerChanged)
          warnings.add(
            "Provider-specific reasoning may not transfer identically. Your saved transcript will remain intact.",
          );
      } else if (
        part.type.startsWith("tool-") ||
        part.type === "dynamic-tool"
      ) {
        const tool = part as {
          input?: unknown;
          output?: unknown;
          errorText?: string;
        };
        tokens +=
          estimateTextTokens(JSON.stringify(tool.input) ?? "") +
          estimateTextTokens(JSON.stringify(tool.output) ?? "") +
          estimateTextTokens(tool.errorText ?? "");
        overhead += 64;
        check(
          capabilities.tools,
          "This chat contains tool history that this model does not support.",
          "Tool-history compatibility is unconfirmed for this model.",
        );
      } else if (isAttachmentMessagePart(part)) {
        const ref = part.data;
        const status = attachmentCapabilityStatus(
          attachmentReferenceAsRecord(ref),
          capabilities,
        );
        if (ref.contentKind === "image" && ref.mediaType !== "image/svg+xml") {
          image();
        } else {
          if (status.state === "blocked")
            check(
              status.support,
              "This chat contains attachments that this model cannot receive.",
              "Attachment compatibility is unconfirmed. Sending may remain blocked for this model.",
            );
          const textBytes =
            ref.contentKind === "document"
              ? ref.documentRepresentation?.textContentRef?.byteSize
              : ref.contentKind === "archive"
                ? ref.archiveRepresentation?.manifestContentRef?.byteSize
                : ref.contentKind === "binary"
                  ? 0
                  : ref.byteSize;
          // Count delivered text/manifest bytes, never the original PDF/ZIP payload.
          // Reference-only preview uses an upper bound until delivery materializes text.
          tokens += textBytes ?? 0;
          tokens += estimateTextTokens(ref.displayName) + 256;
        }
      } else if (part.type === CLACK_ATTACHMENT_PART_TYPE) {
        blocked.add(
          "A historical attachment reference could not be validated. Resolve it before changing models.",
        );
      } else if (part.type === "file") {
        if (part.mediaType.startsWith("image/")) image();
        else {
          check(
            part.mediaType.startsWith("audio/")
              ? capabilities.audio
              : part.mediaType === "application/pdf"
                ? capabilities.document
                : "unknown",
            "This chat contains file input that this model cannot receive.",
            "Historical file-input compatibility and context usage are unconfirmed for this model.",
          );
        }
      }
    }
  }
  const system = estimateTextTokens(systemText);
  const estimatedTokens = tokens + overhead + system + toolTokens;
  let budget: ReturnType<typeof resolveContextBudget> | undefined;
  try {
    budget = resolveContextBudget(
      budgetLimits ?? { reported: contextLimit ?? undefined },
      {
        system,
        tools: toolTokens,
        conversation: tokens + overhead,
        uncertainMedia: false,
      },
    );
    contextLimit =
      budget.source === "unknown-policy" && budget.ceiling >= 4096
        ? null
        : budget.ceiling;
  } catch (error) {
    blocked.add(
      error instanceof Error ? error.message : "Invalid context settings.",
    );
  }
  if (contextLimit !== null && budget && !budget.fits)
    blocked.add(
      "This conversation is too large for this model's context window.",
    );
  else if (messages.length > 0) {
    if (contextLimit === null)
      warnings.add(
        "This model's context window is unknown. Clack cannot confirm that this conversation fits.",
      );
    else if (estimatedTokens >= contextLimit * 0.55)
      warnings.add(
        "This conversation approaches the model's context budget. Existing compaction may shorten outgoing tool results; your saved transcript stays intact.",
      );
  }
  return {
    status: blocked.size ? "blocked" : warnings.size ? "warning" : "compatible",
    reasons: [...blocked, ...warnings],
    blockingReasons: [...blocked],
    estimatedTokens,
    contextLimit,
    workingBudget: budget?.working,
  };
}
