import { invoke } from "@tauri-apps/api/core";
import type { ModelMessage } from "ai";
import type { LocalProviderConfig } from "@/modules/ai/lib/agent";
import type { BudgetLimits } from "@/modules/ai/lib/contextBudget";
import type { ModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import type { SessionMeta } from "@/modules/ai/lib/sessions";
import {
  readCompactionSources,
  type MemoryCandidate,
  type MemoryOwner,
  type MemoryRevision,
  type MemoryView,
} from "@/modules/ai/lib/conversationMemory";

export async function contextDigest(value: unknown): Promise<string> {
  // Match serde_json's ordered object keys, including numeric tool-output keys.
  const canonical = (input: unknown): string => {
    if (Array.isArray(input)) return `[${input.map(canonical).join(",")}]`;
    if (input && typeof input === "object")
      return `{${Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
        .join(",")}}`;
    return JSON.stringify(input) ?? "null";
  };
  const bytes = new TextEncoder().encode(canonical(value));
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
    effort: "provider-default",
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
export const beginTargetContext = (owner: MemoryOwner): Promise<SwitchSource> =>
  invoke("target_context_begin", { owner });
export const loadTargetContext = (
  owner: MemoryOwner,
  key: string,
): Promise<MemoryRevision | null> =>
  invoke("target_context_load", { owner, key });

export function createTargetDraft(source: SwitchSource) {
  let view = source.view;
  let candidate: MemoryCandidate | undefined;
  const toCandidate = (revision: MemoryRevision): MemoryCandidate => ({
    preparation: source.view.preparation,
    policyVersion: revision.policyVersion,
    start: revision.coverage.start,
    end: revision.coverage.end,
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
        const revision = await invoke<MemoryRevision>(
          "target_context_preview",
          { candidate: prepared, token: source.token },
        );
        signal?.throwIfAborted();
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

export const commitTargetContext = (request: {
  token: string;
  settingsHash: string;
  expectedSession: SessionMeta;
  preparation: MemoryView["preparation"];
  modelId: string;
  key: string;
  candidate: MemoryCandidate | null;
}): Promise<SessionMeta> => invoke("target_context_commit", { request });

export const cancelTargetContext = (
  sessionId: string,
  token: string,
): Promise<void> => invoke("target_context_cancel", { sessionId, token });
