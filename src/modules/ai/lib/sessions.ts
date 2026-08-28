import type { UIMessage } from "@ai-sdk/react";
import { LazyStore } from "@tauri-apps/plugin-store";
import type { NormalizedAiError } from "@/modules/ai/lib/errors";
import type { RunBudgetState } from "@/modules/ai/lib/runBudget";
import type { ProviderId } from "@/modules/ai/config";
import { workspacePermissionKey } from "@/modules/ai/lib/permissions";
import { normalizeWorkspacePath } from "@/modules/workspace";

export const SESSION_PROFILE_SCHEMA_VERSION = 1;

export type ConversationProfile = {
  agentId: string | null;
  modelId: string | null;
  workspaceId: string | null;
  workspaceRoot: string | null;
};

export type SessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  profileVersion?: number;
  profile?: ConversationProfile;
  run?: SessionRun;
};

export type SessionRunState =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type SessionRun = {
  state: SessionRunState;
  agentId?: string;
  modelId?: string;
  workspaceId?: string;
  workspaceRoot?: string;
  providerId?: ProviderId;
  transportModelId?: string;
  endpointBaseURL?: string;
  customEndpointId?: string;
  peerTaskId?: string;
  commandName?: string;
  startedAt: number;
  budget?: RunBudgetState;
  endedAt?: number;
  error?: NormalizedAiError;
};

const STORE_PATH = "terax-ai-sessions.json";
const KEY_SESSIONS = "sessions";
const KEY_ACTIVE = "activeId";
const messagesKey = (id: string) => `messages:${id}`;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export type LoadedSessions = {
  sessions: SessionMeta[];
  activeId: string | null;
};

export function createConversationProfile(input: {
  agentId: string | null;
  modelId: string | null;
  workspaceRoot: string | null;
  workspaceEnvironment?: string;
}): ConversationProfile {
  const root = input.workspaceRoot?.trim()
    ? normalizeWorkspacePath(input.workspaceRoot)
    : null;
  return {
    agentId: nonEmpty(input.agentId),
    modelId: nonEmpty(input.modelId),
    workspaceId: root
      ? workspacePermissionKey(root, input.workspaceEnvironment)
      : null,
    workspaceRoot: root,
  };
}

export function migrateSessionProfiles(
  sessions: readonly SessionMeta[],
  defaults: { agentId: string; modelId: string },
): { sessions: SessionMeta[]; changed: boolean } {
  let changed = false;
  const migrated = sessions.map((session) => {
    const raw = session as SessionMeta & {
      profile?: Partial<ConversationProfile>;
      profileVersion?: number;
    };
    const hasCurrentProfile =
      raw.profileVersion === SESSION_PROFILE_SCHEMA_VERSION && !!raw.profile;
    const profile = hasCurrentProfile && raw.profile
      ? normalizeConversationProfile(raw.profile)
      : createConversationProfile({
          agentId: defaults.agentId,
          modelId: defaults.modelId,
          workspaceRoot: null,
        });
    const next = {
      ...session,
      profileVersion: SESSION_PROFILE_SCHEMA_VERSION,
      profile,
    };
    if (!hasCurrentProfile || JSON.stringify(next) !== JSON.stringify(session)) {
      changed = true;
    }
    return next;
  });
  return { sessions: migrated, changed };
}

export function validateConversationProfileForRun(
  profile: ConversationProfile,
  currentWorkspaceRoot: string | null,
  workspaceEnvironment?: string,
): { ok: true } | { ok: false; reason: string } {
  if (!profile.agentId) {
    return { ok: false, reason: "This chat has no agent selected." };
  }
  if (!profile.modelId) {
    return { ok: false, reason: "This chat has no model selected." };
  }
  if (!profile.workspaceId || !profile.workspaceRoot) {
    if (!currentWorkspaceRoot) return { ok: true };
    return {
      ok: false,
      reason: "Bind this chat to the current workspace before starting a run.",
    };
  }
  if (!currentWorkspaceRoot) {
    return {
      ok: false,
      reason: "Open the workspace owned by this chat before starting a run.",
    };
  }
  const current = createConversationProfile({
    agentId: profile.agentId,
    modelId: profile.modelId,
    workspaceRoot: currentWorkspaceRoot,
    workspaceEnvironment,
  });
  if (current.workspaceId !== profile.workspaceId) {
    return {
      ok: false,
      reason: `This chat belongs to ${profile.workspaceRoot}. Switch back or create a new chat in the current workspace.`,
    };
  }
  return { ok: true };
}

function normalizeConversationProfile(
  value: Partial<ConversationProfile>,
): ConversationProfile {
  const root = nonEmpty(value.workspaceRoot);
  const workspaceId = nonEmpty(value.workspaceId);
  return {
    agentId: nonEmpty(value.agentId),
    modelId: nonEmpty(value.modelId),
    workspaceId: root && workspaceId ? workspaceId : null,
    workspaceRoot: root && workspaceId ? normalizeWorkspacePath(root) : null,
  };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function loadAll(): Promise<LoadedSessions> {
  // One IPC roundtrip via entries() rather than two parallel get()s. Per-
  // session messages are loaded lazily via `loadMessages` only when a
  // session is opened, so cold boot stays at a single store call.
  const entries = await store.entries();
  let sessions: SessionMeta[] | undefined;
  let activeId: string | null | undefined;
  for (const [k, v] of entries) {
    if (k === KEY_SESSIONS) sessions = v as SessionMeta[];
    else if (k === KEY_ACTIVE) activeId = v as string | null;
  }
  return { sessions: sessions ?? [], activeId: activeId ?? null };
}

export function recoverInterruptedSessions(
  sessions: readonly SessionMeta[],
  now = Date.now(),
): { sessions: SessionMeta[]; interruptedIds: string[] } {
  const interruptedIds: string[] = [];
  const recovered = sessions.map((session) => {
    if (session.run?.state !== "running") return session;
    interruptedIds.push(session.id);
    return {
      ...session,
      run: { ...session.run, state: "interrupted" as const, endedAt: now },
    };
  });
  return { sessions: recovered, interruptedIds };
}

export async function loadMessages(id: string): Promise<UIMessage[] | null> {
  return (await store.get<UIMessage[]>(messagesKey(id))) ?? null;
}

export async function saveSessionsList(sessions: SessionMeta[]): Promise<void> {
  await store.set(KEY_SESSIONS, sessions);
}

export async function saveActiveId(id: string | null): Promise<void> {
  await store.set(KEY_ACTIVE, id);
}

export async function saveMessages(
  id: string,
  messages: UIMessage[],
): Promise<void> {
  await store.set(messagesKey(id), messages);
}

export async function deleteSessionData(id: string): Promise<void> {
  await store.delete(messagesKey(id));
}

export function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveTitle(messages: UIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const p of m.parts) {
      if (p.type !== "text") continue;
      const text = (p as { text: string }).text
        .replace(/<terminal-context[\s\S]*?<\/terminal-context>\s*/g, "")
        .replace(/<selection[\s\S]*?<\/selection>\s*/g, "")
        .replace(/<file[\s\S]*?<\/file>\s*/g, "")
        .trim();
      if (!text) continue;
      const first = text.split("\n")[0].trim();
      return first.length > 40 ? `${first.slice(0, 40)}…` : first;
    }
  }
  return "New chat";
}
