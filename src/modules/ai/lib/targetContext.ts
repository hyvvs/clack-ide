import { invoke } from "@tauri-apps/api/core";
import { canonicalJson } from "@/modules/ai/lib/canonicalJson";
import type { ModelMessage } from "ai";
import type { LocalProviderConfig } from "@/modules/ai/lib/agent";
import type { BudgetLimits } from "@/modules/ai/lib/contextBudget";
import type { ModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
import type { InferenceScope } from "@/modules/ai/lib/inferenceLifecycle";
import { awaitAbortableRead, emitPreparationPhase } from "@/modules/ai/lib/preparationLifecycle";
import {
  readCompactionSources,
  type MemoryCandidate,
  type MemoryOwner,
  type MemoryRevision,
  type MemoryView,
} from "@/modules/ai/lib/conversationMemory";

export async function contextDigest(value: unknown): Promise<string> {
  // Match serde_json's ordered object keys, including numeric tool-output keys.
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function targetContextKey(input: {
  modelId: string;
  configuration: LocalProviderConfig;
  system: ModelMessage[];
  tools: unknown;
  limits: BudgetLimits;
  capabilities: ModelInputCapabilities;
  permissions: unknown;
  workspace: unknown;
  credentials: unknown;
}) {
  const { configuration: config, ...rest } = input;
  return contextDigest({
    policy: "c2-target-v1",
    extraction: "c1b-extraction-v1",
    effort:
      config.reasoning && config.reasoning.choice !== "automatic"
        ? config.reasoning
        : "provider-default",
    ...rest,
    identity: resolveModelTransportIdentity(input.modelId, config),
    profiles: config.selfHostedInference,
    endpoints: config.customEndpoints,
    savedModels: config.savedProviderModels,
    urls: [
      config.lmstudioBaseURL,
      config.mlxBaseURL,
      config.ollamaBaseURL,
      config.openaiCompatibleBaseURL,
    ],
  });
}

export type SwitchSource = {
  token: string;
  session: SessionMeta;
  view: MemoryView;
  settingsHash: string;
};
export class SwitchConsentRequired extends Error {}
export async function beginTargetContext(
  owner: MemoryOwner, signal?: AbortSignal, scope?: InferenceScope,
): Promise<SwitchSource> {
  signal?.throwIfAborted();
  emitPreparationPhase(scope, "target-begin-start");
  const native = invoke<SwitchSource>("target_context_begin", { owner });
  if (signal) {
    // Native may allocate its 180-second switch lease after the caller aborts.
    // Release that *exact* token on late completion, never a later switch.
    void native.then(source => {
      if (signal.aborted) void cancelTargetContext(owner.sessionId, source.token).catch(() => undefined);
    }).catch(() => undefined);
  }
  const source = await awaitAbortableRead(native, signal);
  emitPreparationPhase(scope, "target-begin-settled");
  return source;
}
export const loadTargetContext = async (
  owner: MemoryOwner,
  key: string,
  signal?: AbortSignal,
  scope?: InferenceScope,
): Promise<MemoryRevision | null> => {
  signal?.throwIfAborted();
  emitPreparationPhase(scope, "target-load-start");
  return awaitAbortableRead(
    invoke<MemoryRevision | null>("target_context_load", { owner, key }), signal,
  ).then(value => {
    emitPreparationPhase(scope, "target-load-settled");
    return value;
  });
};

export function createTargetDraft(source: SwitchSource, scope?: InferenceScope) {
  let view = source.view;
  let candidate: MemoryCandidate | undefined;
  const toCandidate = (revision: MemoryRevision): MemoryCandidate => ({
    preparation: source.view.preparation,
    policyVersion: revision.policyVersion,
    start: revision.coverage.start,
    end: revision.coverage.end,
    ...(revision.coverage.unitMode ? {unitMode: revision.coverage.unitMode} : {}),
    sources: revision.evidence.map((item) => item.locator),
    claims: revision.claims,
  });
  return {
    memory: {
      load: async () => view,
      read: readCompactionSources,
      commit: async (next: MemoryCandidate, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        const locators = next.sources.flatMap((locator) => {
          if (
            locator.kind !== "retained" ||
            locator.revisionId !== view.revisionId
          )
            return [locator];
          const evidence = view.revision?.evidence.find(
            (item) => item.id === locator.evidenceId,
          );
          if (!evidence) throw new Error("A staged memory source is missing.");
          return [evidence.locator];
        });
        const prepared = {
          ...next,
          preparation: source.view.preparation,
          sources: locators,
        };
        emitPreparationPhase(scope, "target-preview-start");
        const revision = await awaitAbortableRead(
          invoke<MemoryRevision>("target_context_preview", { candidate: prepared, token: source.token }),
          signal,
        );
        signal?.throwIfAborted();
        emitPreparationPhase(scope, "target-preview-settled");
        const id = await contextDigest(revision);
        signal?.throwIfAborted();
        candidate = prepared;
        view = {
          ...source.view,
          revision,
          revisionId: id,
          uncoveredMessages:
            revision.coverage.sourceMessageCount - revision.coverage.end,
        };
        return id;
      },
    },
    candidate: () =>
      candidate ?? (view.revision ? toCandidate(view.revision) : null),
    view: () => view,
  };
}

export const commitTargetContext = async (request: {
  token: string;
  settingsHash: string;
  expectedSession: SessionMeta;
  preparation: MemoryView["preparation"];
  modelId: string;
  key: string;
  candidate: MemoryCandidate | null;
}, scope?: InferenceScope): Promise<SessionMeta> => {
  emitPreparationPhase(scope, "target-commit-start");
  // Do not detach a native atomic session/model CAS from its actual result.
  const result = await invoke<SessionMeta>("target_context_commit", { request });
  emitPreparationPhase(scope, "target-commit-settled");
  return result;
};

export const cancelTargetContext = (
  sessionId: string,
  token: string,
): Promise<void> => invoke("target_context_cancel", { sessionId, token });
