import { invoke } from "@tauri-apps/api/core";
import type { UIMessage } from "ai";
import { awaitSessionWrites } from "@/modules/ai/lib/sessions";
import type { MemorySourceLocator } from "@/modules/ai/lib/conversationMemory";

export const PROJECT_SECTIONS = [
  "requirements",
  "architecture",
  "interfaces",
  "bugs",
  "milestones",
  "constraints",
  "findings",
  "verification",
  "uncertainty",
] as const;
export type ProjectEntry = {
  id: string;
  section: string;
  text: string;
  qualification: string;
  status: "pending" | "approved" | "revoked" | "superseded";
  sourceState: string;
  sourceSessionId: string;
  locator: MemorySourceLocator;
  sliceHash: string;
  start: number;
  end: number;
  authorAgent: string;
  supersedes: string | null;
  conflicts: string[];
  updatedAt: number;
  freshness?: string;
  knowledge?: {
    verifiedBy: string;
    verifiedAt: number;
    revision: number;
    records: string[];
    dependencies: {
      path: string;
      canonical: string;
      contentHash: string;
      sliceHash: string;
      end: number;
      environment: boolean;
    }[];
  } | null;
};
export type ProjectFreshness = {
  revision: number;
  entries: {
    id: string;
    freshness: string;
    sourceState: string;
    evidence: {
      path: string;
      contentHash?: string;
      excerpt?: string;
      changed?: boolean;
      error?: string;
    }[];
  }[];
  reads: number;
  bytes: number;
};

export function projectDependencies(files: string, environment: string) {
  const dependencies = [
    ...files
      .split(/\r?\n/)
      .map((path) => ({ path: path.trim(), environment: false })),
    ...environment
      .split(/\r?\n/)
      .map((path) => ({ path: path.trim(), environment: true })),
  ].filter((d) => d.path);
  if (
    !dependencies.length ||
    dependencies.length > 8 ||
    new Set(dependencies.map((d) => d.path)).size !== dependencies.length
  )
    throw new Error("Choose one to eight distinct evidence paths.");
  return dependencies;
}

export function freshnessTargets(view: ProjectMemoryView, force: boolean) {
  return view.entries
    .filter(
      (e) =>
        e.status === "approved" &&
        e.knowledge &&
        (force ||
          e.freshness === "needs-revalidation" ||
          e.freshness === "potentially-stale"),
    )
    .slice(0, 8)
    .map((e) => e.id);
}

export function applyFreshness(
  view: ProjectMemoryView,
  result: ProjectFreshness,
): ProjectMemoryView {
  if (view.revision !== result.revision)
    throw new Error("Stale project evidence response.");
  return {
    ...view,
    entries: view.entries.map((entry) => {
      const current = result.entries.find((e) => e.id === entry.id);
      return current
        ? {
            ...entry,
            freshness: current.freshness,
            sourceState: current.sourceState,
          }
        : entry;
    }),
  };
}
export type ProjectMemoryView = {
  workspace: string;
  checkout: string;
  baseSha: string | null;
  revision: number;
  entries: ProjectEntry[];
};
export type ProjectSource = {
  key: string;
  label: string;
  text: string;
  locator: MemorySourceLocator;
};

export function projectSources(messages: UIMessage[]): ProjectSource[] {
  const sources: ProjectSource[] = [];
  for (let i = messages.length - 1; i >= 0 && sources.length < 128; i--) {
    const message = messages[i];
    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0 && sources.length < 128;
      partIndex--
    ) {
      const part = message.parts[partIndex];
      const value = part as unknown as Record<string, unknown>;
      const text =
        message.role === "user" && part.type === "text"
          ? part.text
          : (part.type.startsWith("tool-") || part.type === "dynamic-tool") &&
              value.state === "output-available" &&
              typeof value.output === "string"
            ? value.output
            : null;
      if (!text?.trim()) continue;
      sources.push({
        key: `${message.id}:${partIndex}`,
        label: `${message.role === "user" ? "Requirement" : "Tool result"}: ${text.slice(0, 70)}`,
        text,
        locator: { kind: "part" as const, messageId: message.id, partIndex },
      });
    }
  }
  return sources.reverse();
}

export function projectSlice(
  source: string,
  excerpt: string,
): { start: number; end: number } {
  const offset = source.indexOf(excerpt);
  const encoder = new TextEncoder();
  const size = encoder.encode(excerpt).byteLength;
  if (!excerpt.trim() || offset < 0 || size > 4096)
    throw new Error("Select an exact original excerpt of at most 4 KiB.");
  const start = encoder.encode(source.slice(0, offset)).byteLength;
  return { start, end: start + size };
}

export function projectMemoryClient(sessionId: string) {
  return {
    load: () => invoke<ProjectMemoryView>("project_memory_load", { sessionId }),
    verify: (
      view: ProjectMemoryView,
      id: string,
      files: string,
      environment: string,
      dependsOn: string[],
    ) =>
      invoke<void>("project_memory_verify", {
        sessionId,
        expectedRevision: view.revision,
        id,
        dependencies: projectDependencies(files, environment),
        dependsOn,
      }),
    revalidate: (view: ProjectMemoryView, ids: string[]) =>
      invoke<ProjectFreshness>("project_memory_revalidate", {
        sessionId,
        expectedRevision: view.revision,
        ids,
      }),
    async propose(
      view: ProjectMemoryView,
      source: ProjectSource,
      excerpt: string,
      section: string,
    ) {
      const range = projectSlice(source.text, excerpt);
      if (!(PROJECT_SECTIONS as readonly string[]).includes(section))
        throw new Error("Invalid project knowledge category.");
      await awaitSessionWrites(sessionId);
      await invoke("project_memory_propose", {
        sessionId,
        expectedRevision: view.revision,
        proposal: { locator: source.locator, ...range, section, conflicts: [] },
      });
    },
    decide: (
      view: ProjectMemoryView,
      id: string,
      decision:
        | { kind: "approve" | "revoke" }
        | { kind: "correct"; text: string },
    ) =>
      invoke<void>("project_memory_decide", {
        sessionId,
        expectedRevision: view.revision,
        id,
        decision,
      }),
    inspect: (view: ProjectMemoryView, id: string) =>
      invoke<{ text: string; sourceState: string; sliceHash: string }>(
        "project_memory_inspect",
        { sessionId, expectedRevision: view.revision, id },
      ),
  };
}
