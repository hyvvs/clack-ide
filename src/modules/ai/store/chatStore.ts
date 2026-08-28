import type { Chat, UIMessage } from "@ai-sdk/react";
import { create } from "zustand";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setLastUsedAiSelection } from "@/modules/settings/store";
import { currentWorkspaceScopeKey } from "@/modules/workspace";
import {
  DEFAULT_MODEL_ID,
  endpointIdFromCompatModel,
  isCompatModelId,
  providerNeedsKey,
  type ProviderId,
} from "../config";
import { useTodosStore } from "./todoStore";
import { usePlanStore } from "./planStore";
import type { AgentUsage } from "../lib/agent";
import { EMPTY_PROVIDER_KEYS, type ProviderKeys, type CustomEndpointKeys } from "../lib/keyring";
import {
  createConversationProfile,
  deleteSessionData,
  deriveTitle,
  loadAll,
  loadMessages,
  migrateSessionProfiles,
  newSessionId,
  saveActiveId,
  saveMessages,
  saveSessionsList,
  validateConversationProfileForRun,
  recoverInterruptedSessions,
  type SessionMeta,
  type SessionRunState,
} from "../lib/sessions";
import { useAgentsStore } from "./agentsStore";
import { pushRecentModel } from "../lib/modelPrefs";
import { providerForSelectedModel } from "../lib/providerRestore";
import {
  resolveModelTransportIdentity,
  type ModelTransportIdentity,
} from "../lib/savedProviderModels";
import {
  clearChatPermissions,
  normalizeAgentPermissionProfile,
} from "../lib/permissions";
import type { NormalizedAiError } from "../lib/errors";
import {
  consumeAutoContinuation as consumeBudgetAutoContinuation,
  createRunBudget,
  createRunLoopTracker,
  autoContinueForPermissionMode,
  normalizeRunBudget,
  observeRunStep,
  recordRunBatch as recordBudgetBatch,
  resumeRunBudget,
  startRunBatch as startBudgetBatch,
  type RunBatchResult,
  type RunLoopTracker,
  type RunStepObservation,
} from "../lib/runBudget";

export type Live = {
  getCwd: () => string | null;
  getTerminalContext: () => string | null;
  isActiveTerminalPrivate: () => boolean;
  injectIntoActivePty: (text: string) => boolean;
  getWorkspaceRoot: () => string | null;
  getActiveFile: () => string | null;
  openPreview: (url: string) => boolean;
  spawnManagedAgent: (
    prompt: string,
    sessionId: string,
  ) => { tabId: number; leafId: number } | null;
  readLeafBuffer: (leafId: number) => string | null;
};

export type AgentRunStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "retrying"
  | "awaiting-approval"
  | "error";

export type ProviderRetryState = {
  error: NormalizedAiError;
  retryNumber: number;
  maxRetries: number;
};

export type AgentMeta = {
  status: AgentRunStatus;
  step: string | null;
  approvalsPending: number;
  error: NormalizedAiError | null;
  providerRetry: ProviderRetryState | null;
  tokens: AgentUsage;
  lastInputTokens: number;
  lastCachedTokens: number;
  hitStepCap: boolean;
  compactionNotice: { droppedCount: number; at: number } | null;
};

const ZERO_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

const IDLE_META: AgentMeta = {
  status: "idle",
  step: null,
  approvalsPending: 0,
  error: null,
  providerRetry: null,
  tokens: ZERO_USAGE,
  lastInputTokens: 0,
  lastCachedTokens: 0,
  hitStepCap: false,
  compactionNotice: null,
};

export type MiniState = {
  open: boolean;
  minimized: boolean;
};

export type PendingToolApproval = {
  id: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type PendingSelection = {
  id: string;
  text: string;
  source: "terminal" | "editor";
};

export type ApprovalResponder = (
  approvalId: string,
  approved: boolean,
) => void;

type StoreState = {
  live: Live;
  setLive: (live: Live) => void;

  approvalRespondersBySession: Record<string, ApprovalResponder>;
  setApprovalResponder: (
    sessionId: string,
    fn: ApprovalResponder | null,
  ) => void;
  respondToApproval: (
    approvalId: string,
    approved: boolean,
    sessionId?: string,
  ) => void;

  apiKeys: ProviderKeys;
  setApiKeys: (keys: ProviderKeys) => void;
  setApiKey: (provider: ProviderId, key: string | null) => void;

  customEndpointKeys: CustomEndpointKeys;
  setCustomEndpointKeys: (keys: CustomEndpointKeys) => void;

  selectedModelId: string;
  setSelectedModelId: (id: string, persistSelection?: boolean) => void;

  mini: MiniState;
  openMini: () => void;
  minimizeMini: () => void;
  closeMini: () => void;
  toggleMini: () => void;
  showApprovalAttention: () => void;

  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  openExperience: () => void;

  focusSignal: number;
  pendingPrefill: string | null;
  focusInput: (prefill?: string | null) => void;
  consumePrefill: () => string | null;

  pendingSelections: PendingSelection[];
  attachSelection: (text: string, source: "terminal" | "editor") => void;
  consumeSelections: () => PendingSelection[];

  runtimeBySession: Record<string, AgentMeta>;
  patchAgentMeta: (sessionId: string, patch: Partial<AgentMeta>) => void;
  resetAgentMeta: (sessionId: string) => void;
  setProviderRetry: (id: string, retry: ProviderRetryState) => void;
  clearProviderRetry: (id: string) => void;

  pendingApprovalsBySession: Record<string, PendingToolApproval[]>;
  setPendingApprovals: (
    sessionId: string,
    approvals: PendingToolApproval[],
  ) => void;

  beginRun: (
    id: string,
    commandName?: string,
  ) => { ok: true } | { ok: false; reason: string };
  startRunBatch: (id: string) => { isLogicalContinuation: boolean };
  recordRunStep: (id: string, observation: RunStepObservation) => void;
  recordRunBatch: (id: string, result: RunBatchResult) => void;
  consumeAutoContinuation: (id: string) => boolean;
  resumeRun: (id: string, allowHardLimit: boolean) => boolean;
  finishRun: (
    id: string,
    state: Exclude<SessionRunState, "running">,
    error?: NormalizedAiError,
  ) => void;

  // Sessions
  sessionsHydrated: boolean;
  sessions: SessionMeta[];
  activeSessionId: string | null;
  hydrateSessions: () => Promise<void>;
  newSession: () => string;
  switchSession: (id: string) => void;
  setSessionAgentId: (id: string, agentId: string) => boolean;
  bindSessionToCurrentWorkspace: (id: string) => boolean;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  /** Persist messages of a session and bump its updatedAt + auto-title. */
  persistMessages: (id: string, messages: UIMessage[]) => void;
};

const NOOP_LIVE: Live = {
  getCwd: () => null,
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  getWorkspaceRoot: () => null,
  getActiveFile: () => null,
  openPreview: () => false,
  spawnManagedAgent: () => null,
  readLeafBuffer: () => null,
};

const CHATS_LRU_CAP = 8;
export const chats = new Map<string, Chat<UIMessage>>();

export function touchChat(id: string, c: Chat<UIMessage>) {
  if (chats.has(id)) chats.delete(id);
  chats.set(id, c);
  while (chats.size > CHATS_LRU_CAP) {
    const activeSessionId = useChatStore.getState().activeSessionId;
    const oldest = Array.from(chats.keys()).find((candidate) => {
      if (candidate === id || candidate === activeSessionId) return false;
      const run = useChatStore
        .getState()
        .sessions.find((session) => session.id === candidate)?.run;
      return run?.state !== "running";
    });
    if (!oldest) break;
    flushPersistEntry(oldest);
    void chats.get(oldest)?.stop();
    chats.delete(oldest);
  }
}
// Initial messages for a session, populated at hydration time and consumed
// when the matching Chat is constructed.
export const seedMessages = new Map<string, UIMessage[]>();
const runLoopTrackers = new Map<string, RunLoopTracker>();

function permissionModeForAgent(agentId: string) {
  const profile = usePreferencesStore.getState().agentPermissionProfiles[agentId];
  return normalizeAgentPermissionProfile(profile).mode;
}

// Trailing debounce for per-token message persistence. Streaming fires
// `persistMessages` on every token; without this we'd JSON-serialize the
// full message array and round-trip to the store plugin per token, which
// stalls the UI. Flush on idle (status transition) via `flushPersist`.
const PERSIST_DEBOUNCE_MS = 300;
const pendingPersist = new Map<
  string,
  { latest: UIMessage[]; timer: ReturnType<typeof setTimeout> }
>();

function flushPersistEntry(id: string) {
  const entry = pendingPersist.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingPersist.delete(id);
  void saveMessages(id, entry.latest);
}

export function flushPersist(id?: string): void {
  if (id) {
    flushPersistEntry(id);
    return;
  }
  for (const key of Array.from(pendingPersist.keys())) flushPersistEntry(key);
}

export const useChatStore = create<StoreState>((set, get) => ({
  live: NOOP_LIVE,
  setLive: (live) => set({ live }),

  approvalRespondersBySession: {},
  setApprovalResponder: (sessionId, fn) =>
    set((state) => {
      const next = { ...state.approvalRespondersBySession };
      if (fn) next[sessionId] = fn;
      else delete next[sessionId];
      return { approvalRespondersBySession: next };
    }),
  respondToApproval: (approvalId, approved, explicitSessionId) => {
    const state = get();
    const sessionId =
      explicitSessionId ??
      Object.entries(state.pendingApprovalsBySession).find(([, approvals]) =>
        approvals.some((approval) => approval.id === approvalId),
      )?.[0];
    const fn = sessionId
      ? state.approvalRespondersBySession[sessionId]
      : undefined;
    if (fn) fn(approvalId, approved);
  },

  apiKeys: { ...EMPTY_PROVIDER_KEYS },
  setApiKeys: (keys) => set({ apiKeys: keys }),
  setApiKey: (provider, key) => {
    set({ apiKeys: { ...get().apiKeys, [provider]: key } });
  },

  customEndpointKeys: {},
  setCustomEndpointKeys: (keys) => set({ customEndpointKeys: keys }),

  selectedModelId: DEFAULT_MODEL_ID,
  setSelectedModelId: (id, persistSelection = true) => {
    const state = get();
    const active = state.sessions.find(
      (session) => session.id === state.activeSessionId,
    );
    if (!persistSelection && state.sessionsHydrated && active?.profile?.modelId) {
      set({ selectedModelId: active.profile.modelId });
      return;
    }
    if (active?.run?.state === "running") return;
    const next = active
      ? state.sessions.map((session) =>
          session.id === active.id
            ? {
                ...session,
                profile: {
                  ...(session.profile ??
                    createConversationProfile({
                      agentId: useAgentsStore.getState().activeId,
                      modelId: id,
                      workspaceRoot: null,
                    })),
                  modelId: id,
                },
                updatedAt: Date.now(),
              }
            : session,
        )
      : state.sessions;
    set({ selectedModelId: id, sessions: next });
    if (active) void saveSessionsList(next);
    if (persistSelection) recordSelectedModelUse(id);
  },

  mini: { open: false, minimized: false },
  openMini: () => set({ mini: { open: true, minimized: false } }),
  minimizeMini: () => set({ mini: { open: false, minimized: true } }),
  closeMini: () => set({ mini: { open: false, minimized: false } }),
  toggleMini: () =>
    set((state) => ({
      mini: state.mini.open
        ? { open: false, minimized: false }
        : { open: true, minimized: false },
    })),
  showApprovalAttention: () =>
    set((state) =>
      state.mini.minimized
        ? state
        : { mini: { open: true, minimized: false } },
    ),

  panelOpen: false,
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openExperience: () =>
    set((s) => ({
      mini: { open: true, minimized: false },
      panelOpen: true,
      focusSignal: s.focusSignal + 1,
    })),

  focusSignal: 0,
  pendingPrefill: null,
  focusInput: (prefill = null) =>
    set((s) => ({
      panelOpen: true,
      focusSignal: s.focusSignal + 1,
      pendingPrefill: prefill ?? null,
    })),
  consumePrefill: () => {
    const v = get().pendingPrefill;
    if (v != null) set({ pendingPrefill: null });
    return v;
  },

  pendingSelections: [],
  attachSelection: (text, source) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = `sel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({
      panelOpen: true,
      focusSignal: s.focusSignal + 1,
      pendingSelections: [...s.pendingSelections, { id, text: trimmed, source }],
    }));
  },
  consumeSelections: () => {
    const v = get().pendingSelections;
    if (v.length > 0) set({ pendingSelections: [] });
    return v;
  },

  runtimeBySession: {},
  patchAgentMeta: (sessionId, patch) =>
    set((state) => ({
      runtimeBySession: {
        ...state.runtimeBySession,
        [sessionId]: {
          ...(state.runtimeBySession[sessionId] ?? IDLE_META),
          ...patch,
        },
      },
    })),
  resetAgentMeta: (sessionId) =>
    set((state) => ({
      runtimeBySession: {
        ...state.runtimeBySession,
        [sessionId]: IDLE_META,
      },
    })),
  setProviderRetry: (id, retry) => {
    const state = get();
    const run = state.sessions.find((session) => session.id === id)?.run;
    if (run?.state !== "running") return;
    set((store) => ({
      runtimeBySession: {
        ...store.runtimeBySession,
        [id]: {
          ...(store.runtimeBySession[id] ?? IDLE_META),
          status: "retrying",
          step: null,
          error: null,
          providerRetry: retry,
        },
      },
    }));
  },
  clearProviderRetry: (id) => {
    const state = get();
    const run = state.sessions.find((session) => session.id === id)?.run;
    const runtime = state.runtimeBySession[id];
    if (!runtime?.providerRetry) return;
    set((store) => ({
      runtimeBySession: {
        ...store.runtimeBySession,
        [id]: {
          ...runtime,
          status: run?.state === "running" ? "thinking" : runtime.status,
          providerRetry: null,
        },
      },
    }));
  },

  pendingApprovalsBySession: {},
  setPendingApprovals: (sessionId, approvals) =>
    set((state) => ({
      pendingApprovalsBySession: {
        ...state.pendingApprovalsBySession,
        [sessionId]: approvals,
      },
    })),

  beginRun: (id, commandName) => {
    const session = get().sessions.find((item) => item.id === id);
    if (!session) return { ok: false, reason: "Chat session not found." };
    if (session.run?.state === "running") {
      return { ok: false, reason: "This chat is already running." };
    }
    const profile =
      session.profile ??
      createConversationProfile({
        agentId: useAgentsStore.getState().activeId,
        modelId: get().selectedModelId,
        workspaceRoot: null,
      });
    const validation = validateConversationProfileForRun(
      profile,
      get().live.getWorkspaceRoot(),
      currentWorkspaceScopeKey(),
    );
    if (!validation.ok) return validation;

    const { agentId, modelId, workspaceId, workspaceRoot } = profile;
    if (!agentId || !modelId) {
      return { ok: false, reason: "The chat identity is incomplete." };
    }
    if (!useAgentsStore.getState().all().some((agent) => agent.id === agentId)) {
      return {
        ok: false,
        reason: "This chat's agent no longer exists. Select another agent.",
      };
    }
    const preferences = usePreferencesStore.getState();
    let transportIdentity: ModelTransportIdentity;
    try {
      transportIdentity = resolveModelTransportIdentity(modelId, {
        customEndpoints: preferences.customEndpoints,
        savedProviderModels: preferences.savedProviderModels,
        lmstudioModelId: preferences.lmstudioModelId,
        mlxModelId: preferences.mlxModelId,
        ollamaModelId: preferences.ollamaModelId,
        openaiCompatibleBaseURL: preferences.openaiCompatibleBaseURL,
        openaiCompatibleModelId: preferences.openaiCompatibleModelId,
        openrouterModelId: preferences.openrouterModelId,
      });
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
    const now = Date.now();
    const next = get().sessions.map((session) =>
      session.id === id
        ? {
            ...session,
            profileVersion: 1,
            profile,
            run: {
              state: "running" as const,
              agentId,
              modelId,
              providerId: transportIdentity.providerId,
              transportModelId: transportIdentity.transportModelId,
              ...(transportIdentity.endpointBaseURL
                ? { endpointBaseURL: transportIdentity.endpointBaseURL }
                : {}),
              ...(transportIdentity.customEndpointId
                ? { customEndpointId: transportIdentity.customEndpointId }
                : {}),
              ...(workspaceId ? { workspaceId } : {}),
              ...(workspaceRoot ? { workspaceRoot } : {}),
              ...(commandName ? { commandName } : {}),
              startedAt: now,
              budget: createRunBudget(permissionModeForAgent(agentId)),
            },
            updatedAt: now,
          }
        : session,
    );
    const runtime = get().runtimeBySession[id] ?? IDLE_META;
    set((state) => ({
      sessions: next,
      runtimeBySession: {
        ...state.runtimeBySession,
        [id]: {
          ...runtime,
          status: "thinking",
          step: null,
          approvalsPending: 0,
          error: null,
          providerRetry: null,
        },
      },
    }));
    useTodosStore.getState().prepareRun(id);
    runLoopTrackers.set(id, createRunLoopTracker());
    void saveSessionsList(next);
    return { ok: true };
  },

  startRunBatch: (id) => {
    const session = get().sessions.find((item) => item.id === id);
    const run = session?.run;
    if (run?.state !== "running") {
      return { isLogicalContinuation: false };
    }
    const mode = permissionModeForAgent(run.agentId ?? "builtin:coder");
    const started = startBudgetBatch(normalizeRunBudget(run.budget, mode));
    const next = get().sessions.map((item) =>
      item.id === id && item.run
        ? { ...item, run: { ...item.run, budget: started.budget } }
        : item,
    );
    set((state) => ({
      sessions: next,
      runtimeBySession: started.isLogicalContinuation
        ? {
            ...state.runtimeBySession,
            [id]: {
              ...(state.runtimeBySession[id] ?? IDLE_META),
              status: "thinking",
              step: "Continuing autonomously...",
              hitStepCap: false,
            },
          }
        : state.runtimeBySession,
    }));
    void saveSessionsList(next);
    return { isLogicalContinuation: started.isLogicalContinuation };
  },

  recordRunStep: (id, observation) => {
    const run = get().sessions.find((item) => item.id === id)?.run;
    if (run?.state !== "running") return;
    const current = runLoopTrackers.get(id) ?? createRunLoopTracker();
    runLoopTrackers.set(id, observeRunStep(current, observation));
  },

  recordRunBatch: (id, result) => {
    const session = get().sessions.find((item) => item.id === id);
    const run = session?.run;
    if (run?.state !== "running") return;
    const mode = permissionModeForAgent(run.agentId ?? "builtin:coder");
    const tracker = runLoopTrackers.get(id) ?? createRunLoopTracker();
    const budget = recordBudgetBatch(
      normalizeRunBudget(run.budget, mode),
      { ...result, repeatedFailureDetected: tracker.detected },
      mode,
    );
    const next = get().sessions.map((item) =>
      item.id === id && item.run
        ? { ...item, run: { ...item.run, budget }, updatedAt: Date.now() }
        : item,
    );
    set((state) => ({
      sessions: next,
      runtimeBySession: {
        ...state.runtimeBySession,
        [id]: {
          ...(state.runtimeBySession[id] ?? IDLE_META),
          hitStepCap: budget.phase === "soft-limit",
          step:
            budget.phase === "auto-continue-pending"
              ? "Continuing autonomously..."
              : null,
        },
      },
    }));
    void saveSessionsList(next);
  },

  consumeAutoContinuation: (id) => {
    const session = get().sessions.find((item) => item.id === id);
    const run = session?.run;
    if (run?.state !== "running" || !run.budget) return false;
    const mode = permissionModeForAgent(run.agentId ?? "builtin:coder");
    if (!autoContinueForPermissionMode(mode)) {
      const budget = { ...run.budget, autoContinue: false, phase: "soft-limit" as const };
      const next = get().sessions.map((item) =>
        item.id === id && item.run
          ? { ...item, run: { ...item.run, budget } }
          : item,
      );
      set({ sessions: next });
      void saveSessionsList(next);
      return false;
    }
    const budget = consumeBudgetAutoContinuation(run.budget);
    if (!budget) return false;
    const next = get().sessions.map((item) =>
      item.id === id && item.run
        ? { ...item, run: { ...item.run, budget }, updatedAt: Date.now() }
        : item,
    );
    set((state) => ({
      sessions: next,
      runtimeBySession: {
        ...state.runtimeBySession,
        [id]: {
          ...(state.runtimeBySession[id] ?? IDLE_META),
          status: "thinking",
          step: "Continuing autonomously...",
          hitStepCap: false,
        },
      },
    }));
    void saveSessionsList(next);
    return true;
  },

  resumeRun: (id, allowHardLimit) => {
    const session = get().sessions.find((item) => item.id === id);
    const run = session?.run;
    if (run?.state !== "running" || !run.budget) return false;
    const budget = resumeRunBudget(run.budget, allowHardLimit);
    if (!budget) return false;
    if (allowHardLimit) {
      runLoopTrackers.set(id, createRunLoopTracker());
    }
    const next = get().sessions.map((item) =>
      item.id === id && item.run
        ? { ...item, run: { ...item.run, budget }, updatedAt: Date.now() }
        : item,
    );
    set((state) => ({
      sessions: next,
      runtimeBySession: {
        ...state.runtimeBySession,
        [id]: {
          ...(state.runtimeBySession[id] ?? IDLE_META),
          status: "thinking",
          step: "Continuing...",
          hitStepCap: false,
        },
      },
    }));
    void saveSessionsList(next);
    return true;
  },

  finishRun: (id, state, error) => {
    const current = get().sessions.find((session) => session.id === id);
    const currentRun = current?.run;
    if (currentRun?.state !== "running") return;
    const now = Date.now();
    const runError =
      state === "failed"
        ? (error ??
          get().runtimeBySession[id]?.error ??
          currentRun.error)
        : undefined;
    const next = get().sessions.map((session) =>
      session.id === id
        ? {
            ...session,
            run: {
              ...currentRun,
              state,
              endedAt: now,
              ...(runError ? { error: runError } : {}),
            },
            updatedAt: now,
          }
        : session,
    );
    set((store) => ({
      sessions: next,
      pendingApprovalsBySession: {
        ...store.pendingApprovalsBySession,
        [id]: [],
      },
      runtimeBySession: {
        ...store.runtimeBySession,
        [id]: {
          ...(store.runtimeBySession[id] ?? IDLE_META),
          status:
            state === "failed" ? ("error" as const) : ("idle" as const),
          step: null,
          approvalsPending: 0,
          error: state === "failed" ? (runError ?? null) : null,
          providerRetry: null,
        },
      },
    }));
    void saveSessionsList(next);
    useTodosStore.getState().finalizeRun(id, state);
    runLoopTrackers.delete(id);
  },

  sessionsHydrated: false,
  sessions: [],
  activeSessionId: null,

  hydrateSessions: async () => {
    if (get().sessionsHydrated) return;
    const loaded = await loadAll();
    const profiled = migrateSessionProfiles(loaded.sessions, {
      agentId: useAgentsStore.getState().activeId,
      modelId: get().selectedModelId,
    });
    const recovered = recoverInterruptedSessions(profiled.sessions);
    const sessions = recovered.sessions;
    if (profiled.changed || recovered.interruptedIds.length > 0) {
      await Promise.all(
        recovered.interruptedIds.map((id) =>
          useTodosStore.getState().hydrate(id),
        ),
      );
      for (const id of recovered.interruptedIds) {
        useTodosStore.getState().finalizeRun(id, "interrupted");
      }
      void saveSessionsList(sessions);
    }

    // Reuse the most recent untitled "New chat" session if one exists from
    // the previous run — no point stacking empty placeholder sessions every
    // launch. Otherwise prepend a fresh one.
    const interruptedActive = recovered.interruptedIds.includes(
      loaded.activeId ?? "",
    )
      ? sessions.find((session) => session.id === loaded.activeId) ?? null
      : null;
    const reusable = sessions[0]?.title === "New chat" ? sessions[0] : null;
    let nextSessions: SessionMeta[];
    let freshId: string;
    if (interruptedActive) {
      nextSessions = sessions;
      freshId = interruptedActive.id;
      const messages = await loadMessages(freshId);
      if (messages && messages.length > 0) seedMessages.set(freshId, messages);
    } else if (reusable) {
      nextSessions = sessions;
      freshId = reusable.id;
    } else {
      freshId = newSessionId();
      const fresh: SessionMeta = {
        id: freshId,
        title: "New chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        profileVersion: 1,
        profile: createConversationProfile({
          agentId: useAgentsStore.getState().activeId,
          modelId: get().selectedModelId,
          workspaceRoot: get().live.getWorkspaceRoot(),
        }),
      };
      nextSessions = [fresh, ...sessions];
      void saveSessionsList(nextSessions);
    }
    void saveActiveId(freshId);

    set({
      sessions: nextSessions,
      activeSessionId: freshId,
      sessionsHydrated: true,
      selectedModelId:
        nextSessions.find((session) => session.id === freshId)?.profile
          ?.modelId ?? get().selectedModelId,
      runtimeBySession: Object.fromEntries(
        nextSessions.map((session) => [
          session.id,
          session.run?.state === "failed" && session.run.error
            ? { ...IDLE_META, status: "error", error: session.run.error }
            : IDLE_META,
        ]),
      ),
    });
  },

  newSession: () => {
    const id = newSessionId();
    const meta: SessionMeta = {
      id,
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profileVersion: 1,
      profile: createConversationProfile({
        agentId: useAgentsStore.getState().activeId,
        modelId: get().selectedModelId,
        workspaceRoot: get().live.getWorkspaceRoot(),
      }),
    };
    const next = [meta, ...get().sessions];
    set({
      sessions: next,
      activeSessionId: id,
      selectedModelId: meta.profile?.modelId ?? get().selectedModelId,
      runtimeBySession: { ...get().runtimeBySession, [id]: IDLE_META },
    });
    void saveSessionsList(next);
    void saveActiveId(id);
    return id;
  },

  switchSession: (id) => {
    if (get().activeSessionId === id) return;
    if (!get().sessions.some((s) => s.id === id)) return;

    // Lazily seed the chat with persisted messages the first time we open
    // this session. Subsequent switches reuse the cached Chat instance.
    const flip = () => {
      const session = get().sessions.find((item) => item.id === id);
      const restoredError =
        session?.run?.state === "failed" ? session.run.error ?? null : null;
      set({
        activeSessionId: id,
        selectedModelId: session?.profile?.modelId ?? get().selectedModelId,
        runtimeBySession: {
          ...get().runtimeBySession,
          [id]:
            get().runtimeBySession[id] ??
            (restoredError
              ? { ...IDLE_META, status: "error", error: restoredError }
              : IDLE_META),
        },
      });
      void saveActiveId(id);
    };
    if (chats.has(id) || seedMessages.has(id)) {
      flip();
      return;
    }
    void loadMessages(id).then((m) => {
      if (m && m.length > 0 && !chats.has(id)) seedMessages.set(id, m);
      flip();
    });
  },

  setSessionAgentId: (id, agentId) => {
    const session = get().sessions.find((item) => item.id === id);
    if (!session || session.run?.state === "running") return false;
    const next = get().sessions.map((item) =>
      item.id === id
        ? {
            ...item,
            profile: {
              ...(item.profile ??
                createConversationProfile({
                  agentId,
                  modelId: get().selectedModelId,
                  workspaceRoot: null,
                })),
              agentId,
            },
            updatedAt: Date.now(),
          }
        : item,
    );
    set({ sessions: next });
    void saveSessionsList(next);
    return true;
  },

  bindSessionToCurrentWorkspace: (id) => {
    const session = get().sessions.find((item) => item.id === id);
    const workspaceRoot = get().live.getWorkspaceRoot();
    if (!session || session.run?.state === "running" || !workspaceRoot) {
      return false;
    }
    const profile = createConversationProfile({
      agentId:
        session.profile?.agentId ?? useAgentsStore.getState().activeId,
      modelId: session.profile?.modelId ?? get().selectedModelId,
      workspaceRoot,
    });
    const next = get().sessions.map((item) =>
      item.id === id
        ? { ...item, profile, updatedAt: Date.now() }
        : item,
    );
    set({ sessions: next });
    void saveSessionsList(next);
    return true;
  },

  deleteSession: (id) => {
    const remaining = get().sessions.filter((s) => s.id !== id);
    chats.get(id)?.stop();
    chats.delete(id);
    seedMessages.delete(id);
    runLoopTrackers.delete(id);
    const pend = pendingPersist.get(id);
    if (pend) {
      clearTimeout(pend.timer);
      pendingPersist.delete(id);
    }
    void deleteSessionData(id);
    clearChatPermissions(id);
    void useTodosStore.getState().clearSession(id);

    set((state) => {
      const pendingApprovalsBySession = {
        ...state.pendingApprovalsBySession,
      };
      const runtimeBySession = { ...state.runtimeBySession };
      const approvalRespondersBySession = {
        ...state.approvalRespondersBySession,
      };
      delete pendingApprovalsBySession[id];
      delete runtimeBySession[id];
      delete approvalRespondersBySession[id];
      return {
        pendingApprovalsBySession,
        runtimeBySession,
        approvalRespondersBySession,
      };
    });

    if (remaining.length === 0) {
      const fresh: SessionMeta = {
        id: newSessionId(),
        title: "New chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        profileVersion: 1,
        profile: createConversationProfile({
          agentId: useAgentsStore.getState().activeId,
          modelId: get().selectedModelId,
          workspaceRoot: get().live.getWorkspaceRoot(),
        }),
      };
      set((state) => ({
        sessions: [fresh],
        activeSessionId: fresh.id,
        runtimeBySession: {
          ...state.runtimeBySession,
          [fresh.id]: IDLE_META,
        },
      }));
      void saveSessionsList([fresh]);
      void saveActiveId(fresh.id);
      return;
    }

    const wasActive = get().activeSessionId === id;
    const nextActive = wasActive ? remaining[0].id : get().activeSessionId;
    const nextModel = wasActive
      ? remaining.find((session) => session.id === nextActive)?.profile
          ?.modelId ?? get().selectedModelId
      : get().selectedModelId;
    set({
      sessions: remaining,
      activeSessionId: nextActive,
      selectedModelId: nextModel,
    });
    void saveSessionsList(remaining);
    if (wasActive) void saveActiveId(nextActive);
  },

  renameSession: (id, title) => {
    const next = get().sessions.map((s) =>
      s.id === id ? { ...s, title, updatedAt: Date.now() } : s,
    );
    set({ sessions: next });
    void saveSessionsList(next);
  },

  persistMessages: (id, messages) => {
    // Debounce the message-blob write so streaming doesn't pound the store.
    const existing = pendingPersist.get(id);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      const entry = pendingPersist.get(id);
      if (!entry) return;
      pendingPersist.delete(id);
      void saveMessages(id, entry.latest);
    }, PERSIST_DEBOUNCE_MS);
    pendingPersist.set(id, { latest: messages, timer });

    // Update zustand session list only when the derived title actually
    // changes — otherwise we'd rewrite the sessions array (and trigger
    // re-renders + a store write) on every token.
    const sessions = get().sessions;
    const meta = sessions.find((s) => s.id === id);
    if (!meta) return;
    const isUntitled = !meta.title || meta.title === "New chat";
    if (!isUntitled) return;
    const nextTitle = deriveTitle(messages);
    if (nextTitle === meta.title) return;
    const next = sessions.map((s) =>
      s.id === id ? { ...s, title: nextTitle, updatedAt: Date.now() } : s,
    );
    set({ sessions: next });
    void saveSessionsList(next);
  },
}));

export function getAgentMeta(sessionId?: string | null): AgentMeta {
  const state = useChatStore.getState();
  const id = sessionId ?? state.activeSessionId;
  return id ? (state.runtimeBySession[id] ?? IDLE_META) : IDLE_META;
}

export function useActiveAgentMeta(): AgentMeta {
  return useChatStore((state) => {
    const id = state.activeSessionId;
    return id ? (state.runtimeBySession[id] ?? IDLE_META) : IDLE_META;
  });
}

export function getActiveProviderKey(): string | null {
  const { selectedModelId, apiKeys, customEndpointKeys } = useChatStore.getState();
  if (isCompatModelId(selectedModelId)) {
    const eid = endpointIdFromCompatModel(selectedModelId);
    return customEndpointKeys[eid] ?? null;
  }
  const preferences = usePreferencesStore.getState();
  const provider = providerForSelectedModel(
    selectedModelId,
    preferences.customEndpoints,
    preferences.savedProviderModels,
  );
  return provider ? (apiKeys[provider] ?? null) : null;
}

export function hasKeyForModel(modelId: string): boolean {
  const { apiKeys } = useChatStore.getState();
  if (isCompatModelId(modelId)) {
    return true;
  }
  const preferences = usePreferencesStore.getState();
  const provider = providerForSelectedModel(
    modelId,
    preferences.customEndpoints,
    preferences.savedProviderModels,
  );
  if (!provider) return false;
  return providerNeedsKey(provider) ? !!apiKeys[provider] : true;
}

export function getChat(sessionId?: string): Chat<UIMessage> | undefined {
  if (sessionId) return chats.get(sessionId);
  const id = useChatStore.getState().activeSessionId;
  return id ? chats.get(id) : undefined;
}

export function stop(): void {
  void cancelActiveRun();
}

export function recordSelectedModelUse(modelId: string): void {
  const preferences = usePreferencesStore.getState();
  const provider = providerForSelectedModel(
    modelId,
    preferences.customEndpoints,
    preferences.savedProviderModels,
  );
  if (!provider) return;
  void pushRecentModel(modelId);
  void setLastUsedAiSelection(provider, modelId);
}

export function pendingApprovalIds(messages: readonly UIMessage[]): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      const candidate = part as {
        state?: string;
        approval?: { id?: string };
      };
      if (
        candidate.state === "approval-requested" &&
        candidate.approval?.id
      ) {
        ids.push(candidate.approval.id);
      }
    }
  }
  return ids;
}

export async function cancelActiveRun(): Promise<void> {
  const id = useChatStore.getState().activeSessionId;
  if (!id) return;
  await cancelRun(id);
}

export async function cancelRun(id: string): Promise<void> {
  const state = useChatStore.getState();
  const chat = chats.get(id);
  const pending = state.pendingApprovalsBySession[id] ?? [];
  const approvalIds =
    pending.length > 0
      ? pending.map((approval) => approval.id)
      : pendingApprovalIds(chat?.messages ?? []);
  state.finishRun(id, "cancelled");
  for (const approvalId of approvalIds) {
    state.respondToApproval(approvalId, false, id);
  }
  await chat?.stop();
  const latest = useChatStore.getState();
  if (latest.activeSessionId === id) usePlanStore.getState().disable();
  latest.patchAgentMeta(id, {
    status: "idle",
    step: null,
    approvalsPending: 0,
    error: null,
  });
}

export async function interruptAllRunsForShutdown(): Promise<void> {
  const state = useChatStore.getState();
  const runningIds = state.sessions
    .filter((session) => session.run?.state === "running")
    .map((session) => session.id);
  for (const id of runningIds) {
    const pending = state.pendingApprovalsBySession[id] ?? [];
    for (const approval of pending) {
      state.respondToApproval(approval.id, false, id);
    }
    state.finishRun(id, "interrupted");
    state.patchAgentMeta(id, {
      status: "idle",
      step: null,
      approvalsPending: 0,
      error: null,
      providerRetry: null,
    });
  }
  await Promise.allSettled(
    runningIds.map(async (id) => {
      await chats.get(id)?.stop();
      flushPersist(id);
    }),
  );
}
