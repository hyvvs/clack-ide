import { isCompatModelId, MODELS, type ModelInfo } from "@/modules/ai/config";
import type { AttachmentRecord } from "./attachments";
import { isSavedProviderModelSelectionId } from "./savedProviderModels";
import {
  resolveSelfHostedSelection,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { selfHostedCapabilities } from "@/modules/ai/lib/selfHostedCapabilities";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";

export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export type ModelInputCapabilities = {
  text: CapabilitySupport;
  image: CapabilitySupport;
  document: CapabilitySupport;
  tools: CapabilitySupport;
  audio: CapabilitySupport;
  evidence: "registry" | "freeform" | "unknown-model" | "server";
};

export type AttachmentCapabilityStatus =
  | {
      state: "ready";
      support: "supported";
      label: string;
      message: string;
    }
  | {
      state: "blocked";
      support: "unsupported" | "unknown";
      label: string;
      message: string;
    };

const FREEFORM_MODEL_IDS = new Set([
  "openrouter-custom",
  "openai-compatible-custom",
  "lmstudio-local",
  "mlx-local",
  "ollama-local",
]);

export function resolveModelInputCapabilities(
  selectionId: string,
  state?: SelfHostedState,
  snapshot: ProbeSnapshot | null = null,
): ModelInputCapabilities {
  const target = state && resolveSelfHostedSelection(state, selectionId);
  if (target?.status === "available")
    return selfHostedCapabilities(
      target.endpoint,
      target.profile.transportModelId,
      snapshot,
    );
  if (target?.status === "missing")
    return {
      text: "unsupported",
      image: "unsupported",
      document: "unsupported",
      tools: "unsupported",
      audio: "unsupported",
      evidence: "server",
    };
  if (
    isSavedProviderModelSelectionId(selectionId) ||
    isCompatModelId(selectionId) ||
    FREEFORM_MODEL_IDS.has(selectionId)
  ) {
    return freeformCapabilities();
  }

  const model = MODELS.find((candidate) => candidate.id === selectionId);
  if (!model) {
    return {
      text: "supported",
      image: "unknown",
      document: "unknown",
      tools: "unknown",
      audio: "unknown",
      evidence: "unknown-model",
    };
  }
  return capabilitiesFromRegistry(model);
}

export function attachmentCapabilityStatus(
  attachment: AttachmentRecord,
  capabilities: ModelInputCapabilities,
): AttachmentCapabilityStatus {
  if (
    attachment.contentKind === "text" ||
    attachment.contentKind === "selection"
  ) {
    return readyStatus("Text content is ready for the selected model.");
  }
  if (attachment.contentKind === "image") {
    if (attachment.detectedMediaType === "image/svg+xml") {
      return readyStatus(
        "SVG source is ready as bounded text for the selected model.",
      );
    }
    return supportStatus(
      capabilities.image,
      "Image is ready for the selected model.",
      "The selected model does not support image input.",
      "Image support is unknown for the selected model. Choose a model with confirmed vision support.",
    );
  }
  if (attachment.contentKind === "document") {
    if (attachment.documentRepresentation?.textContentRef) {
      return readyStatus(
        "Extracted PDF text is ready with page provenance for the selected model.",
      );
    }
    return supportStatus(
      capabilities.document,
      "Document input is ready for the selected model.",
      "The selected model does not support native document input.",
      "Document support is unknown for the selected model.",
    );
  }
  if (
    attachment.contentKind === "archive" &&
    attachment.archiveRepresentation?.manifestContentRef
  ) {
    return readyStatus(
      "Archive manifest and selected normalized entries are ready for the selected model.",
    );
  }
  return readyStatus(
    "Clack will provide metadata only for this attachment type.",
  );
}

export function firstBlockedAttachment(
  attachments: readonly AttachmentRecord[],
  capabilities: ModelInputCapabilities,
): { attachment: AttachmentRecord; status: AttachmentCapabilityStatus } | null {
  for (const attachment of attachments) {
    if (attachment.processingState !== "ready") continue;
    const status = attachmentCapabilityStatus(attachment, capabilities);
    if (status.state === "blocked") return { attachment, status };
  }
  return null;
}

function capabilitiesFromRegistry(model: ModelInfo): ModelInputCapabilities {
  return {
    text: "supported",
    image: model.tags?.includes("vision") ? "supported" : "unsupported",
    document: "unsupported",
    tools: model.tags?.includes("tools") ? "supported" : "unsupported",
    audio: "unsupported",
    evidence: "registry",
  };
}

function freeformCapabilities(): ModelInputCapabilities {
  return {
    text: "supported",
    image: "unknown",
    document: "unknown",
    tools: "unknown",
    audio: "unknown",
    evidence: "freeform",
  };
}

function readyStatus(message: string): AttachmentCapabilityStatus {
  return {
    state: "ready",
    support: "supported",
    label: "Ready",
    message,
  };
}

function supportStatus(
  support: CapabilitySupport,
  supportedMessage: string,
  unsupportedMessage: string,
  unknownMessage: string,
): AttachmentCapabilityStatus {
  if (support === "supported") return readyStatus(supportedMessage);
  return {
    state: "blocked",
    support,
    label:
      support === "unsupported" ? "Unsupported by model" : "Support unknown",
    message: support === "unsupported" ? unsupportedMessage : unknownMessage,
  };
}
