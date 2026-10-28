/** One isolated hosted-provider control using the real Clack Agent runtime.
 * No Ollama context calibration, self-hosted proof, Agent semantic override,
 * manually executed app tools, or synthetic model responses.
 */
import { createRoot } from "react-dom/client";
import { AgentRunBridge } from "@/modules/ai/components/AgentRunBridge";
import { PeerTaskQueueBridge } from "@/modules/ai/components/PeerTaskQueueBridge";
import { native } from "@/modules/ai/lib/native";
import { getAllKeys } from "@/modules/ai/lib/keyring";
import { getAgentMeta } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { useChatStore, chats, cancelRun, flushPersist, persistCompactionSource } from "@/modules/ai/store/chatStore";
import { usePeerTaskStore, flushPeerTasks } from "@/modules/ai/store/peerTaskStore";
import { flushTodoPersistence } from "@/modules/ai/store/todoStore";
import { createConversationProfile, saveSessionsList, awaitSessionWrites, loadMessages } from "@/modules/ai/lib/sessions";
import { prepareSessionChat, sendMessageToSession } from "@/modules/ai/store/chatRuntime";
import { observeAcceptanceRun, AcceptanceApprovalBlocked, type AcceptanceSnapshot } from "@/test/acceptanceApprovalLifecycle";
import { installSelfHostedInferencePhaseObserver } from "@/modules/ai/lib/inferenceDiagnosticCorrelation";
import { getProvider } from "@/modules/ai/config";
import { findSavedProviderModel } from "@/modules/ai/lib/savedProviderModels";
import { invoke } from "@tauri-apps/api/core";

const mission = `Build a tiny local-first Node + TypeScript notes API from scratch in this EMPTY workspace. You own all implementation, tests, debugging and build using Clack's real tools; do not only describe code. Work as a single persistent Coder, using npm only. Do not use any cloud APIs or hosted databases.
Implement GET /health, GET /notes, POST /notes, GET /notes/:id, PATCH /notes/:id and DELETE /notes/:id on port 4321. Notes have id, non-empty title (maximum 120 characters), optional body and createdAt/updatedAt timestamps. Validate inputs and return deterministic JSON errors and meaningful HTTP codes, including missing IDs. Persist notes locally in a data file across backend restart, and ignore the runtime file in Git. Write automated executable backend API tests including CRUD, malformed input, missing resource, and persistence across restart. Provide a useful README with npm commands. Actually run your automated tests and the production TypeScript build and debug any failures; use native workspace tools and report results honestly. Do not create a frontend or ForgeBoard.`;

type Config = { root: string; report: string; modelId: string; selectionId: string; provider: "openrouter" };
const url = new URL(location.href).searchParams.get("configuration");
if (!url) throw new Error("Missing exclusive remote-control configuration");
const cfg = await (await fetch(url)).json() as Config;
if (cfg.provider !== "openrouter" || cfg.modelId !== "nvidia/nemotron-3-ultra-550b-a55b:free")
  throw new Error("Remote control identity mismatch");
if (!cfg.selectionId.startsWith("saved-provider:"))
  throw new Error("Expected existing saved provider selection");

const send = async (payload: Record<string, unknown>) => {
  const result = await fetch(cfg.report, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!result.ok) throw new Error("Remote control collector rejected receipt");
};
const evidence = (kind: string, details: Record<string, unknown>) =>
  void send({ kind, at: Date.now(), ...details }).catch(() => {});
let started = false;
let sent = false;
let failureStage = "initialization";
let uninstall = () => {};
const sessionId = "remote-notes-control";
try {
  await usePreferencesStore.getState().init();
  const pref = usePreferencesStore.getState();
  const selected = findSavedProviderModel(cfg.selectionId, pref.savedProviderModels);
  if (!selected?.enabled || selected.providerId !== cfg.provider || selected.transportModelId !== cfg.modelId)
    throw new Error("Saved OpenRouter model changed before control");
  getProvider(cfg.provider);
  // The production Clack keyring is accessed through ordinary Tauri IPC; no
  // credential is recorded in diagnostic receipts or copied to app settings.
  const keys = await getAllKeys();
  if (!keys.openrouter) throw new Error("Saved OpenRouter credential unavailable");
  useChatStore.getState().setApiKeys(keys);
  const root = await native.workspaceAuthorize(cfg.root);
  useChatStore.getState().setLive({
    ...useChatStore.getState().live,
    getCwd: () => root,
    getWorkspaceRoot: () => root,
    getActiveFile: () => null,
  });
  await useAgentsStore.getState().hydrate();
  await useChatStore.getState().hydrateSessions();
  if (useChatStore.getState().sessions.some(s => s.id === sessionId))
    throw new Error("Control session already exists; no replay");
  const session = {
    id: sessionId, title: sessionId, createdAt: Date.now(), updatedAt: Date.now(),
    profileVersion: 1 as const,
    profile: createConversationProfile({
      agentId: "builtin:coder", modelId: cfg.selectionId,
      workspaceRoot: root, workspaceEnvironment: "local",
    }),
  };
  useChatStore.setState(s => ({ sessions: [...s.sessions, session] }));
  await saveSessionsList(useChatStore.getState().sessions);
  await usePeerTaskStore.getState().hydrate({
    sessions: useChatStore.getState().sessions,
    isAgentConfigured: id => useAgentsStore.getState().all().some(a => a.id === id),
    isModelConfigured: id => id === cfg.selectionId,
  });
  const element = document.getElementById("root");
  if (!element) throw new Error("Missing Agent UI root");
  createRoot(element).render(<><AgentRunBridge openAiDiffTab={() => null} closeAiDiffTab={() => {}} /><PeerTaskQueueBridge /></>);
  // Opt-in diagnostic observer is passive and bounded, never logs content.
  let observedPhases = 0;
  uninstall = installSelfHostedInferencePhaseObserver(({ event }) => {
    if (++observedPhases > 512) return;
    evidence("agent-phase", {
      stage: event.stage, generationId: event.generationId, attempt: event.attempt,
      nativeRequestId: event.nativeRequestId,
    });
  });
  let previous = "";
  const unsubscribe = useChatStore.subscribe(s => {
    const value = s.sessions.find(item => item.id === sessionId);
    if (!value?.run) return;
    const meta = getAgentMeta(sessionId);
    const current = JSON.stringify({ state: value.run.state, steps: value.run.budget?.totalSteps,
      continuations: value.run.budget?.continuationCount, budgetPhase: value.run.budget?.phase,
      retry: meta?.providerRetry?.retryNumber ?? null,
      compactionAt: meta?.compactionNotice?.at ?? null });
    if (current !== previous) {
      previous = current;
      evidence("state", { sessionId, state: value.run.state,
        steps: value.run.budget?.totalSteps, continuations: value.run.budget?.continuationCount,
        budgetPhase: value.run.budget?.phase, retry: meta?.providerRetry?.retryNumber ?? null,
        compactionAt: meta?.compactionNotice?.at ?? null, runStartedAt: value.run.startedAt });
    }
  });
  try {
    failureStage = "mission";
    await prepareSessionChat(sessionId);
    useChatStore.setState({ activeSessionId: sessionId });
    started = true;
    await sendMessageToSession(sessionId, { text: mission });
    const read = (): AcceptanceSnapshot => {
      const active = useChatStore.getState().sessions.find(s => s.id === sessionId);
      const chat = chats.get(sessionId);
      if (!active?.run || !chat) throw new Error("Control run vanished");
      const parts = chat.messages.flatMap(m => m.parts) as Array<{
        type: string; state?: string; toolCallId?: string; output?: unknown;
        input?: unknown; approval?: { id?: string };
      }>;
      return {
        sessionId, runId: `${sessionId}:${active.run.startedAt}`, workspaceRoot: active.run.workspaceRoot ?? "",
        cwd: useChatStore.getState().live.getCwd(),
        state: active.run.state,
        active: chat.status === "submitted" || chat.status === "streaming" ||
          ["running", "auto-continue-pending"].includes(active.run.budget?.phase ?? ""),
        responderReady: !!useChatStore.getState().approvalRespondersBySession[sessionId],
        approvals: parts.filter(p => p.state === "approval-requested" && p.approval?.id).map(p => ({
          id: p.approval!.id!, toolCallId: p.toolCallId ?? "", toolName: p.type.slice(5),
          input: p.input as Record<string, unknown>,
        })),
        effects: parts.filter(p => p.toolCallId).map(p => ({ toolCallId: p.toolCallId!, state: p.state ?? "", output: p.output })),
      };
    };
    const initial = read();
    let harnessBlocked: string | undefined;
    try {
      await observeAcceptanceRun({
        expected: { sessionId, runId: initial.runId, workspaceRoot: initial.workspaceRoot },
        read, sleep: () => new Promise(r => setTimeout(r, 250)),
        emit: event => {
          if (event.kind === "approval-pending") {
            // The local evaluator needs the ephemeral exact input for its
            // safety decision. It never persists or logs this input.
            void send({ ...event }).catch(() => {});
          } else {
            evidence(event.kind as string, { approvalId: event.approvalId, sessionId });
          }
        },
        evaluate: async (subject, signal) => {
          const res = await fetch(new URL("/approval", cfg.report), {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(subject), signal,
          });
          if (!res.ok) throw new Error("Approval collector unavailable");
          return res.json();
        },
        respond: (id, owner) => useChatStore.getState().respondToApproval(id, true, owner),
      });
    } catch (error) {
      if (!(error instanceof AcceptanceApprovalBlocked)) throw error;
      harnessBlocked = error.message;
      evidence("harness-blocked", { reasonCode: "approval-safety-gate" });
      // Ordinary Clack cancellation, not a retry or manual repair.
      await cancelRun(sessionId);
    }
    failureStage = "persist";
    await new Promise(r => setTimeout(r, 1000));
    const final = useChatStore.getState().sessions.find(s => s.id === sessionId);
    if (!final) throw new Error("Control session disappeared");
    const messages = chats.get(sessionId)?.messages;
    if (messages) {
      await persistCompactionSource(sessionId, messages);
      flushPersist(sessionId);
    }
    await awaitSessionWrites(sessionId);
    await flushTodoPersistence();
    await flushPeerTasks();
    const persisted = await loadMessages(sessionId);
    const parts = (persisted ?? []).flatMap(m => m.parts ?? []) as Array<{ type: string; toolCallId?: string; state?: string }>;
    const unique = [...new Map(parts.filter(p => p.type.startsWith("tool-") && p.toolCallId)
      .map(p => [p.toolCallId, { name: p.type.slice(5), state: p.state ?? "unknown" }])).values()];
    const byName = [...new Set(unique.map(t => t.name))].map(name => ({
      name, count: unique.filter(t => t.name === name).length,
      states: unique.filter(t => t.name === name).map(t => t.state),
    }));
    await send({
      kind: "final", at: Date.now(), missionStarted: started, modelId: cfg.modelId, provider: cfg.provider,
      state: final.run?.state ?? "missing", generationSteps: final.run?.budget?.totalSteps ?? 0,
      continuations: final.run?.budget?.continuationCount ?? 0, budgetPhase: final.run?.budget?.phase,
      toolCalls: unique.length, byName, harnessBlocked: !!harnessBlocked,
    });
    sent = true;
  } finally { unsubscribe(); }
} catch (error) {
  if (!sent) {
    await send({ kind: "final", at: Date.now(), missionStarted: started,
      modelId: cfg.modelId, provider: cfg.provider, state: "failed",
      failureStage, failureClass: error instanceof Error ? error.name : "Unknown",
    }).catch(() => {});
  }
} finally {
  uninstall();
  await invoke("coworking_exit");
}
