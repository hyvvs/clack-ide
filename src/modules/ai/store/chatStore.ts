import type { Chat, UIMessage } from "@ai-sdk/react";
import { create } from "zustand";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setLastUsedAiSelection } from "@/modules/settings/store";
import {
  DEFAULT_MODEL_ID,
  endpointIdFromCompatModel,
  getModel,
  isCompatModelId,
  providerNeedsKey,
  type ModelId,
  type ProviderId,
} from "../config";
import { useTodosStore } from "./todoStore";
import { usePlanStore } from "./planStore";
import type { AgentUsage } from "../lib/agent";
import { EMPTY_PROVIDER_KEYS, type ProviderKeys, type CustomEndpointKeys } from "../lib/keyring";
import {
  deleteSessionData,
  deriveTitle,
  loadAll,
  loadMessages,
  newSessionId,
  saveActiveId,
  saveMessages,
  saveSessionsList,
  recoverInterruptedSessions,
  type SessionMeta,
  type SessionRunState,
} from "../lib/sessions";
import { pushRecentModel } from "../lib/modelPrefs";
import { providerForSelectedModel } from "../lib/providerRestore";
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

  /**
   * Set by AgentRunBridge each render. Lets surfaces outside the chat hook
   * tree (e.g. the AI diff tab in the editor area) resolve a pending tool
   * approval through the active session's `addToolApprovalResponse`.
   */
  approvalResponder: ApprovalResponder | null;
  setApprovalResponder: (fn: ApprovalResponder | null) => void;
  respondToApproval: (approvalId: string, approved: boolean) => void;

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

  agentMeta: AgentMeta;
  patchAgentMeta: (patch: Partial<AgentMeta>) => void;
  resetAgentMeta: () => void;
  setProviderRetry: (id: string, retry: ProviderRetryState) => void;
  clearProviderRetry: (id: string) => void;

  pendingApprovalsBySession: Record<string, PendingToolApproval[]>;
  setPendingApprovals: (
    sessionId: string,
    approvals: PendingToolApproval[],
  ) => void;

  beginRun: (
    id: string,
    agentId: string,
    commandName?: string,
    modelId?: string,
  ) => void;
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
    const oldest = chats.keys().next().value;
    if (!oldest || oldest === id) break;
    if (useChatStore.getState().activeSessionId === oldest) break;
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

  approvalResponder: null,
  setApprovalResponder: (fn) => set({ approvalResponder: fn }),
  respondToApproval: (approvalId, approved) => {
    const fn = get().approvalResponder;
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
    set({ selectedModelId: id });
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

  agentMeta: IDLE_META,
  patchAgentMeta: (patch) =>
    set((s) => ({ agentMeta: { ...s.agentMeta, ...patch } })),
  resetAgentMeta: () => set({ agentMeta: IDLE_META }),
  setProviderRetry: (id, retry) => {
    const state = get();
    const run = state.sessions.find((session) => session.id === id)?.run;
    if (run?.state !== "running" || state.activeSessionId !== id) return;
    set((store) => ({
      agentMeta: {
        ...store.agentMeta,
        status: "retrying",
        step: null,
        error: null,
        providerRetry: retry,
      },
    }));
  },
  clearProviderRetry: (id) => {
    const state = get();
    const run = state.sessions.find((session) => session.id === id)?.run;
    if (state.activeSessionId !== id || !state.agentMeta.providerRetry) return;
    set((store) => ({
      agentMeta: {
        ...store.agentMeta,
        status: run?.state === "running" ? "thinking" : store.agentMeta.status,
        providerRetry: null,
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

  beginRun: (id, agentId, commandName, modelId) => {
    const now = Date.now();
    const next = get().sessions.map((session) =>
      session.id === id
        ? {
            ...session,
            run: {
              state: "running" as const,
              agentId,
              modelId: modelId ?? get().selectedModelId,
              ...(commandName ? { commandName } : {}),
              startedAt: now,
              budget: createRunBudget(permissionModeForAgent(agentId)),
            },
            updatedAt: now,
          }
        : session,
    );
    set({
      sessions: next,
      agentMeta: {
        ...get().agentMeta,
        status: "thinking",
        step: null,
        approvalsPending: 0,
        error: null,
        providerRetry: null,
      },
    });
    useTodosStore.getState().prepareRun(id);
    runLoopTrackers.set(id, createRunLoopTracker());
    void saveSessionsList(next);
  },

  startRunBatch: (id) => {
    const session = get().sessions.find((item) => item.id === id);
    const run = session?.run;
    if (!run || run.state !== "running") {
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
      agentMeta: started.isLogicalContinuation
        ? {
            ...state.agentMeta,
            status: "thinking",
            step: "Continuing autonomously...",
            hitStepCap: false,
          }
        : state.agentMeta,
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
    if (!run || run.state !== "running") return;
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
      agentMeta: {
        ...state.agentMeta,
        hitStepCap: budget.phase === "soft-limit",
        step:
          budget.phase === "auto-continue-pending"
            ? "Continuing autonomously..."
            : null,
      },
    }));
    void saveSessionsList(next);
  },

  consumeAutoContinuation: (id) => {
    const session = get().sessions.find((item) => item.id === id);
    const run = session?.run;
    if (!run || run.state !== "running" || !run.budget) return false;
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
      agentMeta: {
        ...state.agentMeta,
        status: "thinking",
        step: "Continuing autonomously...",
        hitStepCap: false,
      },
    }));
    void saveSessionsList(next);
    return true;
  },

  resumeRun: (id, allowHardLimit) => {
    const session = get().sessions.find((item) => item.id === id);
    const run = session?.run;
    if (!run || run.state !== "running" || !run.budget) return false;
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
      agentMeta: {
        ...state.agentMeta,
        status: "thinking",
        step: "Continuing...",
        hitStepCap: false,
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
          (get().activeSessionId === id ? get().agentMeta.error : undefined) ??
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
      ...(store.activeSessionId === id
        ? {
            agentMeta: {
              ...store.agentMeta,
              status:
                state === "failed" ? ("error" as const) : ("idle" as const),
              step: null,
              approvalsPending: 0,
              error: state === "failed" ? (runError ?? null) : null,
              providerRetry: null,
            },
          }
        : {}),
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
    const recovered = recoverInterruptedSessions(loaded.sessions);
    const sessions = recovered.sessions;
    if (recovered.interruptedIds.length > 0) {
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
      };
      nextSessions = [fresh, ...sessions];
      void saveSessionsList(nextSessions);
    }
    void saveActiveId(freshId);

    const restoredRun = nextSessions.find(
      (session) => session.id === freshId,
    )?.run;
    const restoredError =
      restoredRun?.state === "failed" ? restoredRun.error ?? null : null;

    set({
      sessions: nextSessions,
      activeSessionId: freshId,
      sessionsHydrated: true,
      agentMeta: restoredError
        ? { ...IDLE_META, status: "error", error: restoredError }
        : IDLE_META,
    });
  },

  newSession: () => {
    const id = newSessionId();
    const meta: SessionMeta = {
      id,
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [meta, ...get().sessions];
    set({ sessions: next, activeSessionId: id, agentMeta: IDLE_META });
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
        agentMeta: restoredError
          ? { ...IDLE_META, status: "error", error: restoredError }
          : IDLE_META,
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
      delete pendingApprovalsBySession[id];
      return { pendingApprovalsBySession };
    });

    if (remaining.length === 0) {
      const fresh: SessionMeta = {
        id: newSessionId(),
        title: "New chat",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      set({ sessions: [fresh], activeSessionId: fresh.id });
      void saveSessionsList([fresh]);
      void saveActiveId(fresh.id);
      return;
    }

    const wasActive = get().activeSessionId === id;
    const nextActive = wasActive ? remaining[0].id : get().activeSessionId;
    set({ sessions: remaining, activeSessionId: nextActive });
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

export function getAgentMeta(): AgentMeta {
  return useChatStore.getState().agentMeta;
}

export function getActiveProviderKey(): string | null {
  const { selectedModelId, apiKeys, customEndpointKeys } = useChatStore.getState();
  if (isCompatModelId(selectedModelId)) {
    const eid = endpointIdFromCompatModel(selectedModelId);
    return customEndpointKeys[eid] ?? null;
  }
  return apiKeys[getModel(selectedModelId as ModelId).provider] ?? null;
}

export function hasKeyForModel(modelId: string): boolean {
  const { apiKeys } = useChatStore.getState();
  if (isCompatModelId(modelId)) {
    return true;
  }
  const provider = getModel(modelId as ModelId).provider;
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
  const provider = providerForSelectedModel(
    modelId,
    usePreferencesStore.getState().customEndpoints,
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
  const state = useChatStore.getState();
  const id = state.activeSessionId;
  if (!id) return;
  const chat = chats.get(id);
  const pending = state.pendingApprovalsBySession[id] ?? [];
  const approvalIds =
    pending.length > 0
      ? pending.map((approval) => approval.id)
      : pendingApprovalIds(chat?.messages ?? []);
  state.finishRun(id, "cancelled");
  for (const approvalId of approvalIds) {
    state.respondToApproval(approvalId, false);
  }
  await chat?.stop();
  const latest = useChatStore.getState();
  usePlanStore.getState().disable();
  latest.patchAgentMeta({
    status: "idle",
    step: null,
    approvalsPending: 0,
    error: null,
  });
}
