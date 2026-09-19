import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type MemoryOwner = { sessionId: string; workspaceId: string | null };
export type MemorySourceVersion = {
  transcriptRevision: number;
  profileRevision: number;
  transcriptHash: string;
  profileHash: string;
};
export type MemoryPreparation = {
  runtimeId: string;
  owner: MemoryOwner;
  source: MemorySourceVersion;
  generation: number;
  previous: string | null;
};
export type MemorySourceLocator =
  | { kind: "message"; messageId: string }
  | { kind: "part"; messageId: string; partIndex: number }
  | { kind: "taskResult"; taskId: string }
  | { kind: "artifact"; taskId: string; artifactId: string }
  | { kind: "retained"; revisionId: string; evidenceId: string };
export type MemoryEvidence = {
  id: string;
  sourceRevision: number;
  locator: MemorySourceLocator;
  digest: string;
  contentIds: string[];
  relatedSessions: string[];
};
export type MemoryClaim = {
  id: string;
  section:
    | "objective"
    | "requirements"
    | "constraints"
    | "decisions"
    | "completed-work"
    | "active-tasks"
    | "files-and-artifacts"
    | "unresolved-issues"
    | "errors"
    | "agent-findings"
    | "project-state"
    | "uncertainty";
  status:
    | "user-requirement"
    | "verified-observation"
    | "inference"
    | "unresolved"
    | "superseded"
    | "stale";
  text: string;
  sources: string[];
  observedAt: number;
  contradicts: string[];
};
export type MemoryCandidate = {
  preparation: MemoryPreparation;
  policyVersion: string;
  start: number;
  end: number;
  sources: MemorySourceLocator[];
  claims: MemoryClaim[];
};
export type MemoryRevision = {
  schemaVersion: 1;
  preparation: MemoryPreparation;
  revision: number;
  createdAt: number;
  policyVersion: string;
  producer: Record<string, unknown>;
  coverage: {
    start: number;
    end: number;
    digest: string;
    latestMessageId: string;
    sourceMessageCount: number;
  };
  evidence: MemoryEvidence[];
  claims: MemoryClaim[];
};
export type MemoryView = {
  preparation: MemoryPreparation;
  revisionId: string | null;
  revision: MemoryRevision | null;
  uncoveredMessages: number;
  sourceChanged: boolean;
};

// All source content is read under native ownership and revision checks.
export function readCompactionSources(
  preparation: MemoryPreparation,
  sources: MemorySourceLocator[],
): Promise<Array<{ evidence: MemoryEvidence; value: unknown }>> {
  return invoke("conversation_memory_extract_sources", {
    preparation,
    sources,
  });
}

export function loadConversationMemory(
  owner: MemoryOwner,
): Promise<MemoryView> {
  return invoke("conversation_memory_load", { owner });
}

export async function commitConversationMemory(
  candidate: MemoryCandidate,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const cancel = () => {
    void cancelConversationMemory(candidate.preparation).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await invoke("conversation_memory_commit", { candidate });
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export function cancelConversationMemory(
  preparation: MemoryPreparation,
): Promise<void> {
  return invoke("conversation_memory_cancel", { preparation });
}

export function inspectMemorySources(
  preparation: MemoryPreparation,
  sources: MemorySourceLocator[],
): Promise<MemoryEvidence[]> {
  return invoke("conversation_memory_sources", { preparation, sources });
}

export function readMemoryEvidence(
  owner: MemoryOwner,
  revisionId: string,
  evidenceId: string,
): Promise<unknown> {
  return invoke("conversation_memory_evidence", {
    owner,
    revisionId,
    evidenceId,
  });
}

export function onConversationMemoryChanged(
  onChange: (sessionId: string) => void,
) {
  return listen<string>("clack:conversation-memory", (event) =>
    onChange(event.payload),
  );
}
