import { AgentRunBridge } from "@/modules/ai/components/AgentRunBridge";
import { PeerTaskQueueBridge } from "@/modules/ai/components/PeerTaskQueueBridge";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { saveCustomAgents } from "@/modules/ai/lib/agents";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { loadConversationMemory } from "@/modules/ai/lib/conversationMemory";
import {
  sessionInference,
  subscribeInference,
} from "@/modules/ai/lib/inferenceLifecycle";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { native } from "@/modules/ai/lib/native";
import { requestPeerTask } from "@/modules/ai/lib/peerTaskCoordinator";
import {
  saveSelfHostedModel,
  selfHostedSelectionId,
  selfHostedTransportIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  emptySelfHostedState,
  readSelfHostedState,
  setProfileOverride,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  awaitSessionWrites,
  createConversationProfile,
  loadMessages,
  type SessionMeta,
  saveMessages,
  saveSessionsList,
} from "@/modules/ai/lib/sessions";
import { loadTodos } from "@/modules/ai/lib/todos";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import {
  prepareSessionChat,
  sendMessageToSession,
} from "@/modules/ai/store/chatRuntime";
import { sessionEffort, setSessionEffort } from "@/modules/ai/store/reasoningEffort";
import {
  cancelRun,
  chats,
  flushPersist,
  persistCompactionSource,
  useChatStore,
} from "@/modules/ai/store/chatStore";
import {
  flushPeerTasks,
  usePeerTaskStore,
} from "@/modules/ai/store/peerTaskStore";
import { flushTodoPersistence, getTodos } from "@/modules/ai/store/todoStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setAgentPermissionProfiles,
  updateSelfHostedProfiles,
} from "@/modules/settings/store";
import { Channel, invoke } from "@tauri-apps/api/core";
import { streamText, tool, type ToolSet } from "ai";
import { z } from "zod";
import { createRoot } from "react-dom/client";
import { createOllamaStreamTrace, ollamaDiagnosticMetrics, ollamaReplayParams } from "@/test/ollamaStreamTrace";
import { createOllamaModel, ollamaBody } from "@/modules/ai/lib/ollamaModel";
import { createProxyFetch } from "@/modules/ai/lib/proxyFetch";
import { verifiedProviderFetch } from "@/modules/ai/lib/answerContinuation";
import { canonicalJson } from "@/modules/ai/lib/canonicalJson";
import { assertRequestBudget } from "@/modules/ai/lib/contextBudget";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";
import { AcceptanceApprovalBlocked, observeAcceptanceRun, type AcceptanceSnapshot } from "@/test/acceptanceApprovalLifecycle";

type Phase =
  | "stream-diagnostic"
  | "stability"
  | "preflight"
  | "system-preflight"
  | "mission-a"
  | "resume-a"
  | "restart"
  | "mission-b"
  | "offline";
type Configuration = {
  root: string;
  server: string;
  report: string;
  realProduct?: { phase: Phase; modelId?: string; toolProtocol?: boolean; maxOutput?: number; singleSpec?: boolean; reasoningChoice?: "automatic" | "none" | "low"; traceStreams?: boolean; prepareOnly?: boolean };
  streamDiagnostic?: { body: Record<string, unknown>; sourceRequestId: string };
};
type Part = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  toolCallId?: string;
};
const mission = `Build ForgeBoard from scratch in this empty workspace. You own implementation: inspect, plan, create, implement, test, debug and finish using available tools, not merely a description. Work as one persistent Coder, without delegation or other agents.
ForgeBoard is a substantial local-first developer project/task board with a React + TypeScript frontend, Node + TypeScript backend, and npm (not yarn/pnpm). Choose appropriate supporting libraries and architecture. No cloud APIs, telemetry, analytics SaaS, external AI or external cloud database.
Provide project create/list/edit/delete/open and task create/edit/delete/view within projects. Tasks have title, optional description, status (Backlog, Todo, In Progress, Blocked, Done), priority (Low, Medium, High, Urgent), multiple tags, created/updated timestamps. Support combined project/status/priority/tag filters and free-text search over task titles and descriptions. Initial task page size is 50.
Persist data locally across backend restart. Ignore runtime databases/user data in Git. Use real Server-Sent Events for task/project mutations and update the frontend without manual refresh, not polling. Backend API port must be 4317. Enforce a maximum task title length of 120 characters in backend validation. Use 750 ms debounce wherever editable/search-like debouncing is used.
API needs input validation, meaningful HTTP status codes, deterministic JSON errors, stable successful responses, missing-resource handling and no client stack traces. Frontend needs loading, error and empty states and keyboard-operable normal controls. Functional clarity matters more than visual polish.
Write meaningful automated backend API, validation, persistence, combined filtering/search tests and important frontend behavior tests where practical. Actually execute tests, debug failures and run a real production build. Write a useful README with setup/dev/test/build commands, runtime persistence and architecture. Finish all requirements, preserving unfinished work in your structured plan and reporting verification evidence truthfully.`;
const correction =
  "Change the task page size requirement from 50 to 25. The new value supersedes 50 everywhere. Continue the same project and do not restart from scratch.";
const feature = `Add durable activity history to ForgeBoard: task created/updated/status/priority/tags/deleted events, timestamps and task/project identity, useful before/after information; safe undo of the most recent reversible task edit with honest deletion semantics; activity filtering by project/task/action; understandable frontend history view; restart-safe persistence; meaningful backend/frontend tests and README updates. Preserve existing behavior. Use npm, local-only services and existing project constraints.`;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Observe native response channels without replacing routing or provider responses.
function audit(report: string, trace?: ReturnType<typeof createOllamaStreamTrace>, traceStreams = false, captureProtocol = false) {
  type Event = { kind: string; bytes?: number[]; [key: string]: unknown };
  const descriptor = Object.getOwnPropertyDescriptor(
    Channel.prototype,
    "onmessage",
  );
  assert(
    descriptor?.get && descriptor.set,
    "Native channel observer unavailable",
  );
  let pending = Promise.resolve();
  const emit = (data: unknown) => {
    pending = pending.then(async () => {
      const response = await fetch(new URL("/evidence", report), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      assert(response.ok, "Acceptance evidence could not be persisted");
    });
  };
  Object.defineProperty(Channel.prototype, "onmessage", {
    ...descriptor,
    set(previous: (event: Event) => void) {
      const requestTrace = trace ?? (traceStreams ? createOllamaStreamTrace() : undefined);
      const observerStartedAt = Date.now();
      const decoder = new TextDecoder();
      let line = "";
      let first = false;
      let capturedBytes = 0;
      descriptor.set?.call(this, (event: Event) => {
        if (
          typeof event?.requestId !== "string" ||
          !event.requestId.startsWith("inference-")
        ) {
          previous.call(this, event);
          return;
        }
        if (event.kind === "chunk" && event.bytes) {
          if (captureProtocol) {
            capturedBytes += event.bytes.length;
            if (capturedBytes <= 1024 * 1024)
              emit({ kind: "tool-protocol-raw-chunk", requestId: event.requestId, at: Date.now(), bytes: event.bytes });
            else emit({ kind: "tool-protocol-capture-overflow", requestId: event.requestId, at: Date.now(), capturedBytes });
          }
          requestTrace?.receive(event.bytes, Date.now());
          if (!first) {
            first = true;
            emit({
              kind: "first-byte",
              at: Date.now(),
              requestId: event.requestId,
            });
          }
          line += decoder.decode(Uint8Array.from(event.bytes), {
            stream: true,
          });
          const lines = line.split("\n");
          line = lines.pop() ?? "";
          for (const text of lines) {
            try {
              const frame = JSON.parse(text);
              if (frame.done) {
                const { message: _privateReasoning, ...metrics } = frame;
                emit({
                  kind: "engine-finish",
                  at: Date.now(),
                  requestId: event.requestId,
                  metrics: requestTrace ? ollamaDiagnosticMetrics(metrics) : metrics,
                });
              }
            } catch {
              /* HTTP error bodies need not be NDJSON. */
            }
          }
          if (line.length > 4 * 1024 * 1024) line = "";
        } else if (requestTrace && event.kind === "headers") {
          emit({ kind: "diagnostic-headers", at: Date.now(), requestId: event.requestId, status: event.status });
        } else if (["settled", "phase", "admission"].includes(event.kind))
          emit({ ...event, at: Date.now() });
        if (traceStreams && event.kind === "settled" && requestTrace) {
          const at = Date.now();
          if (event.phase === "completed") requestTrace.end(at);
          emit({ kind: "native-stream-trace", requestId: event.requestId, observerStartedAt, at,
            phase: event.phase, error: event.error ?? null, summary: requestTrace.summary() });
        }
        previous.call(this, event);
      });
    },
  });
  return { emit, flush: () => pending };
}

export async function runRealLocalProduct(config: Configuration) {
  assert(config.realProduct, "Missing real product phase");
  const phase = config.realProduct.phase;
  const modelId = config.realProduct.modelId ?? "qwen38-uncensored:latest";
  assert(["qwen38-uncensored:latest", "qwen3-coder:30b", "qwen38-iq4xs:latest", "devstral-small-2:24b"].includes(modelId) || [
    "muse-glimmer:30b",
    "north-mini-code-1.0:q4_K_M",
    "nemotron-3.5-lightning:30b-a3b-q4_K_M",
    "hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M",
    "hf.co/HauhauCS/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-MTP:Q4_K_M",
    "hf.co/HauhauCS/Qwen3.6-27B-Uncensored-HauhauCS-Aggressive:IQ3_M",
  ].includes(modelId), "Unauthorized comparison model");
  const trace = config.realProduct.phase === "stream-diagnostic" ? createOllamaStreamTrace() : undefined;
  const evidence = audit(config.report, trace, config.realProduct.traceStreams, config.realProduct.toolProtocol);
  if (trace) {
    assert(config.streamDiagnostic, "Missing explicit diagnostic replay body");
    const { body, sourceRequestId } = config.streamDiagnostic;
    const params = ollamaReplayParams(body);
    assert(canonicalJson(ollamaBody("qwen38-uncensored:latest", params, true)) === canonicalJson(body),
      "Diagnostic serialization changed the captured request");
    const limits = { runtimeTarget: 32768, maxOutput: 2048, outputReserve: 2048 };
    assertRequestBudget(limits, body);
    const controller = new AbortController();
    // Leave production's 600s request deadline authoritative, plus teardown slack.
    const boundMs = 630_000;
    const timer = setTimeout(() => {
      evidence.emit({ kind: "diagnostic-cancel", at: Date.now(), reason: "evaluator-bound", boundMs });
      controller.abort();
    }, boundMs);
    let outcome = "completed";
    let errorCode: string | null = null;
    const startedAt = Date.now();
    const model = createOllamaModel({ modelId: "qwen38-uncensored:latest", baseURL: config.server,
      fetch: verifiedProviderFetch(createProxyFetch({ selfHosted: true, allowPrivateNetwork: true,
        admission: { endpointId: "real-qwen", profileId: '["real-qwen","qwen38-uncensored:latest",null]', capacity: 1 } })) });
    try {
      const response = await model.doStream({ ...params, abortSignal: controller.signal });
      const reader = response.stream.getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) { trace.end(Date.now()); break; }
          trace.sdkPart(part.value.type, Date.now());
          if (part.value.type === "error") throw part.value.error;
        }
      } finally { reader.releaseLock(); }
    } catch (error) {
      outcome = controller.signal.aborted ? "evaluator-bound" : "failed";
      errorCode = error instanceof InferenceTransportError ? error.code : "adapter-error";
    } finally { clearTimeout(timer); }
    const summary = trace.summary();
    evidence.emit({ kind: "stream-diagnostic-summary", at: Date.now(), sourceRequestId, outcome, errorCode, summary });
    await evidence.flush();
    return { phase: "stream-diagnostic", sourceRequestId, diagnosticStartedAt: startedAt, elapsedMs: Date.now() - startedAt,
      limits, outcome, errorCode, summary, toolExecutionCount: 0, cloudInference: 0, boundMs };
  }
  await usePreferencesStore.getState().init();
  const root = await native.workspaceAuthorize(config.root);
  if (phase === "stability") {
    const startedAt = Date.now();
    let heartbeats = 0;
    for (let step = 0; step <= 22; step++) {
      const shell = await native.shellIdentity();
      evidence.emit({ kind: "harness-heartbeat", elapsedMs: Date.now() - startedAt, shell });
      await evidence.flush();
      heartbeats++;
      if (step < 22) await new Promise(resolve => setTimeout(resolve, 30_000));
    }
    return { phase, heartbeats, elapsedMs: Date.now() - startedAt, cloudInference: 0 };
  }
  useChatStore.getState().setLive({
    ...useChatStore.getState().live,
    getCwd: () => root,
    getWorkspaceRoot: () => root,
    getActiveFile: () => null,
  });
  await useAgentsStore.getState().hydrate();
  await useChatStore.getState().hydrateSessions();
  if (phase === "preflight") {
    let state = saveSelfHostedModel(
      addSelfHostedEndpoint(
        emptySelfHostedState(),
        createSelfHostedEndpoint(
          {
            alias: "Real Qwen product acceptance",
            baseURL: config.server,
            backendHint: "ollama",
            allowPrivateNetwork: true,
          },
          "real-qwen",
        ),
      ),
      "real-qwen",
      modelId,
    );
    state = setProfileOverride(
      state,
      state.profiles[0].id,
      "workingContext",
      32768,
    );
    state = setProfileOverride(
      state,
      state.profiles[0].id,
      "concurrentGenerations",
      1,
    );
    const maxOutput = config.realProduct.maxOutput;
    if (maxOutput !== undefined) {
      assert(
        Number.isSafeInteger(maxOutput) &&
          maxOutput >= 256 &&
          maxOutput <= 16384,
        "Invalid acceptance output allowance",
      );
      for (const field of ["maxOutput", "outputReserve"] as const)
        state = setProfileOverride(
          state,
          state.profiles[0].id,
          field,
          maxOutput,
        );
    }
    const saved = await updateSelfHostedProfiles(() => state);
    usePreferencesStore.setState({ selfHostedInference: saved });
    const agents = [
      {
        id: "real:researcher",
        name: "Researcher",
        description: "Investigates existing project evidence",
        instructions:
          "Investigate the assigned project questions using actual files and tool results. Report source-linked findings and uncertainty. Do not edit project source.",
        icon: "architect" as const,
        builtIn: false,
      },
    ];
    await saveCustomAgents(agents);
    useAgentsStore.setState({ customAgents: agents, hydrated: true });
    const permissions = Object.fromEntries(
      [
        "builtin:coder",
        "builtin:architect",
        "builtin:reviewer",
        "real:researcher",
      ].map((id) => [
        id,
        { mode: "trusted-workspace" as const, categories: {} },
      ]),
    );
    await setAgentPermissionProfiles(permissions);
    usePreferencesStore.setState({ agentPermissionProfiles: permissions });
  }
  if (phase !== "restart") {
    const probed = await createSelfHostedProbeClient().refresh({
      endpointId: "real-qwen",
      selectedModelId: modelId,
      allowPrivateNetwork: true,
    });
    assert(probed.connected, "Authorized Ollama tunnel unavailable");
    const entries = await invoke<[string, unknown][]>(
      "self_hosted_profiles_snapshot",
    );
    usePreferencesStore.setState({
      selfHostedInference: readSelfHostedState(
        new Map(entries).get("selfHostedInference"),
      ),
    });
  }
  const state = usePreferencesStore.getState().selfHostedInference;
  const profile = state.profiles.find(
    (p) => p.transportModelId === modelId,
  );
  assert(profile, "Persisted exact model profile missing");
  const selection = selfHostedSelectionId(profile);
  const limits =
    phase === "restart"
      ? undefined
      : profileBudgetLimits(
          state,
          profile.id,
          await createSelfHostedProbeClient().read({
            endpointId: "real-qwen",
            selectedModelId: modelId,
            allowPrivateNetwork: true,
          }),
        );
  const add = async (id: string, agentId: string) => {
    if (useChatStore.getState().sessions.some((s) => s.id === id)) return;
    const session: SessionMeta = {
      id,
      title: id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profileVersion: 1,
      profile: createConversationProfile({
        agentId,
        modelId: selection,
        workspaceRoot: root,
        workspaceEnvironment: "local",
      }),
    };
    useChatStore.setState((s) => ({ sessions: [...s.sessions, session] }));
    await saveSessionsList(useChatStore.getState().sessions);
  };
  if (phase === "preflight") await add("real-preflight", "builtin:coder");
  if (phase === "mission-a") {
    await add("real-mission-a", "builtin:coder");
  }
  let reasoningControl: unknown;
  if (phase === "preflight" && config.realProduct.prepareOnly) {
    const session = useChatStore.getState().sessions.find(s => s.id === "real-preflight");
    assert(session, "Metadata discovery session unavailable");
    const captured = sessionEffort(session);
    reasoningControl = { requested: "discovery-only", effective: captured.choice, capability: captured.capability };
    evidence.emit({ kind: "reasoning-control", at: Date.now(), sessionId: session.id, control: reasoningControl });
  }
  if (["mission-a", "system-preflight"].includes(phase) && config.realProduct.reasoningChoice) {
    const id = phase === "mission-a" ? "real-mission-a" : "real-preflight";
    const session = useChatStore.getState().sessions.find(s => s.id === id);
    assert(session, "Reasoning preflight session unavailable");
    const captured = sessionEffort(session);
    if (config.realProduct.reasoningChoice === "none" && captured.capability.status === "unsupported") {
      reasoningControl = { requested: "none", effective: "unsupported-no-control", capability: captured.capability,
        wireControl: "omitted", reason: "Exact model metadata advertises no native thinking control; no override or Automatic substitution." };
    } else {
      await setSessionEffort(id, config.realProduct.reasoningChoice);
      reasoningControl = { requested: config.realProduct.reasoningChoice, effective: config.realProduct.reasoningChoice, capability: captured.capability };
    }
    evidence.emit({ kind: "reasoning-control", at: Date.now(), sessionId: id, control: reasoningControl });
  }
  if (phase === "offline") await add("real-offline", "builtin:coder");
  await usePeerTaskStore.getState().hydrate({
    sessions: useChatStore.getState().sessions,
    isAgentConfigured: (id) =>
      useAgentsStore
        .getState()
        .all()
        .some((a) => a.id === id),
    isModelConfigured: (id) => id === selection,
  });
  const element = document.getElementById("root");
  assert(element, "Acceptance document missing root");
  createRoot(element).render(
    <>
      <AgentRunBridge openAiDiffTab={() => null} closeAiDiffTab={() => {}} />
      <PeerTaskQueueBridge />
    </>,
  );
  const planSnapshots: unknown[] = [];
  let lastPlan = "";
  const unobserve = useChatStore.subscribe((s) => {
    const current = JSON.stringify(
      s.sessions.map((x) => ({ id: x.id, run: x.run, todos: getTodos(x.id) })),
    );
    if (lastPlan !== current) {
      lastPlan = current;
      evidence.emit({
        kind: "state",
        at: Date.now(),
        sessions: JSON.parse(current),
      });
    }
  });
  const capacity = subscribeInference(() =>
    evidence.emit({
      kind: "capacity",
      at: Date.now(),
      sessions: useChatStore
        .getState()
        .sessions.map((s) => ({ id: s.id, inference: sessionInference(s.id) })),
    }),
  );
  let harnessStop: { classification: string; reason: string } | undefined;
  const run = async (id: string, text: string, onSent?: () => Promise<void>) => {
    await prepareSessionChat(id);
    useChatStore.setState({ activeSessionId: id });
    let notification: Promise<void> | undefined;
    let notificationError: unknown;
    const notify = () => {
      if (!onSent || notification || !chats.get(id)?.messages.some(m => m.role === "user" && m.parts.some(p => p.type === "text" && p.text === text))) return;
      notification = onSent().catch(error => { notificationError = error; });
    };
    const sentMonitor = onSent ? setInterval(notify, 25) : undefined;
    try { await sendMessageToSession(id, { text }); }
    finally { clearInterval(sentMonitor); notify(); await notification; }
    if (notificationError) throw notificationError;
    assert(!onSent || notification, "Correction message was not observed");
    const read = (): AcceptanceSnapshot => {
      const session = useChatStore.getState().sessions.find((s) => s.id === id);
      const chat = chats.get(id);
      assert(session?.run && chat, "Live acceptance run disappeared");
      const parts = chat.messages.flatMap(m => m.parts) as Array<Part & { approval?: { id?: string } }>;
      const approvals = parts.filter(p => p.state === "approval-requested" && p.approval?.id).map(p => ({
        id: p.approval?.id ?? "", toolCallId: p.toolCallId ?? "", toolName: p.type.slice(5), input: p.input as Record<string, unknown>,
      }));
      return {
        sessionId: id, runId: `${id}:${session.run.startedAt}`, workspaceRoot: session.run.workspaceRoot ?? "",
        cwd: useChatStore.getState().live.getCwd(), state: session.run.state,
        active: chat.status === "submitted" || chat.status === "streaming" ||
          session.run.budget?.phase === "auto-continue-pending" || session.run.budget?.phase === "running",
        responderReady: !!useChatStore.getState().approvalRespondersBySession[id] &&
          approvals.every(a => useChatStore.getState().pendingApprovalsBySession[id]?.some(p => p.id === a.id)),
        approvals,
        effects: parts.filter(p => p.toolCallId).map(p => ({ toolCallId: p.toolCallId ?? "", state: p.state ?? "", output: p.output })),
      };
    };
    const first = read();
    try {
      await observeAcceptanceRun({ expected: { sessionId: first.sessionId, runId: first.runId, workspaceRoot: first.workspaceRoot }, read, sleep: () => sleep(250), emit: evidence.emit,
        evaluate: async (subject, signal) => {
          await evidence.flush();
          const response = await fetch(new URL("/approval", config.report), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subject), signal });
          assert(response.ok, "Evaluator approval route failed");
          return response.json();
        },
        respond: (approvalId, sessionId) => useChatStore.getState().respondToApproval(approvalId, true, sessionId),
      });
    } catch (error) {
      if (!(error instanceof AcceptanceApprovalBlocked)) throw error;
      harnessStop = { classification: error.classification, reason: error.message };
      evidence.emit({ kind: "harness-blocked", at: Date.now(), ...first, ...harnessStop });
      await evidence.flush();
      await cancelRun(id);
    }
  };
  let correctionSent = false;
  let correctionEvidence: unknown;
  let protocolResult: unknown;
  let systemProbe: string | undefined;
  try {
    if (phase === "system-preflight") {
      const preflightSession = useChatStore.getState().sessions.find(s => s.id === "real-preflight");
      assert(preflightSession, "Preflight session missing");
      const model = await buildConfiguredLanguageModel(
        selection,
        EMPTY_PROVIDER_KEYS,
        {
          selfHostedInference: state,
          reasoning: sessionEffort(preflightSession),
          capturedModelIdentity:
            selfHostedTransportIdentity(selection, state) ?? undefined,
          inferenceScope: {
            sessionId: "real-system-preflight",
            runId: crypto.randomUUID(),
            isCurrent: () => true,
          },
        },
      );
      const probeMessages = config.realProduct.toolProtocol ? [
        { role: "system" as const, content: "You are a tool-using assistant. Follow the user's tool request." },
        { role: "user" as const, content: 'Call get_test_value exactly once with value "protocol-check". Do not answer in prose.' },
      ] : [
          {
            role: "system" as const,
            content: "Follow the user request. Preserve original constraints.",
          },
          {
            role: "system" as const,
            content:
              "Continue the same answer without repeating prior text. This is a bounded transport check, with no tools or file changes.",
          },
          { role: "user" as const, content: "Reply with exactly READY. Do not call tools." },
        ];
      const tools: ToolSet = config.realProduct.toolProtocol
        ? { get_test_value: tool({ description: "Harmless diagnostic value lookup; no filesystem, shell or external effects.", inputSchema: z.object({ value: z.string() }) }) }
        : { acceptance_probe: tool({ description: "Compatibility schema only; must not be called.", inputSchema: z.object({ value: z.string() }) }) };
      if (config.realProduct.toolProtocol) evidence.emit({ kind: "tool-protocol-input", at: Date.now(), modelId, messages: probeMessages, toolName: "get_test_value", toolExecutionCount: 0 });
      const result = streamText({
        model,
        messages: probeMessages,
        tools,
        maxOutputTokens: 2048,
        maxRetries: 0,
      });
      systemProbe = await result.text;
      const calls = await result.toolCalls;
      if (config.realProduct.toolProtocol) {
        protocolResult = { text: systemProbe, calls, finishReason: await result.finishReason, usage: await result.usage, toolExecutionCount: 0 };
        evidence.emit({ kind: "tool-protocol-result", at: Date.now(), modelId, result: protocolResult });
      } else {
        assert(systemProbe.trim().length > 0, "Native multi-system transport probe did not complete");
        assert(calls.length === 0, "Compatibility preflight returned a tool call; nothing was executed");
      }
      evidence.emit({ kind: "compatibility-preflight", at: Date.now(), modelId, text: systemProbe, finishReason: await result.finishReason, usage: await result.usage, toolExecutionCount: 0, reasoningControl });
    }
    if (phase === "preflight" && !config.realProduct.prepareOnly)
      await run(
        "real-preflight",
        "Reply with exactly READY. Do not use tools or modify any files.",
      );
    if (phase === "mission-a" || phase === "resume-a") {
      const original = await loadMessages("real-mission-a");
      if (phase === "mission-a")
        assert(!original?.length, "Mission A cannot be silently replayed");
      let correcting = false;
      const alreadyCorrected =
        original?.some(
          (m) =>
            m.role === "user" &&
            m.parts.some((p) => p.type === "text" && p.text === correction),
        ) ?? false;
      const correctionRequest = async (value: Record<string, unknown>) => {
        const response = await fetch(new URL("/correction", config.report), {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "real-mission-a", ...value }), signal: AbortSignal.timeout(30000),
        });
        assert(response.ok, "Correction observation failed");
        return response.json();
      };
      let observation: Promise<void> | undefined;
      let observed = "";
      const observeCorrection = async () => {
        const parts = chats
          .get("real-mission-a")
          ?.messages.flatMap((m) => m.parts).filter(p => p.type.startsWith("tool-") && "state" in p && p.state === "output-available") as Part[] | undefined;
        const plan = getTodos("real-mission-a");
        if (
          JSON.stringify(plan) !==
          JSON.stringify(planSnapshots[planSnapshots.length - 1])
        )
          planSnapshots.push(plan);
        if (config.realProduct?.singleSpec || alreadyCorrected || correcting || harnessStop) return;
        const snapshot = JSON.stringify({ parts: parts ?? [], plan });
        if (observed === snapshot) return;
        observed = snapshot;
        const result = await correctionRequest({ action: "observe", parts: parts ?? [], plan });
        if (result.boundary && result.status === "pending" && !harnessStop) {
          correcting = true;
          correctionEvidence = result.boundary;
          evidence.emit({
            kind: "correction-boundary",
            evidence: correctionEvidence,
          });
          await evidence.flush();
          await cancelRun("real-mission-a");
        }
      };
      const observe = () => {
        if (observation) return;
        observation = observeCorrection().catch(async error => {
          harnessStop = { classification: "HARNESS-BLOCKED", reason: String(error) };
          evidence.emit({ kind: "harness-blocked", at: Date.now(), ...harnessStop });
          await cancelRun("real-mission-a");
        }).finally(() => { observation = undefined; });
      };
      const monitor = setInterval(() => {
        observe();
      }, 250);
      try {
        await run(
          "real-mission-a",
          phase === "mission-a"
            ? mission
            : "Continue the original ForgeBoard project from the existing state.",
        );
      } finally {
        clearInterval(monitor);
        await observation;
        await observeCorrection();
      }
      if (correcting && !harnessStop) {
        const claim = await correctionRequest({ action: "dispatch" });
        assert(claim.claimed, "Correction was already dispatched; never replay uncertain sends");
        correctionSent = true;
        await run("real-mission-a", correction, async () => {
          const messages = chats.get("real-mission-a")?.messages.filter(m => m.role === "user" && m.parts.some(p => p.type === "text" && p.text === correction)) ?? [];
          assert(messages.length === 1, "Correction must be sent exactly once");
          const messageId = messages[0].id;
          const sent = await correctionRequest({ action: "observe", messageId });
          evidence.emit({ kind: "correction-sent", at: sent.sentAt, messageId, text: correction, count: messages.length });
          await evidence.flush();
        });
      }
    }
    if (phase === "offline") {
      await run("real-offline", "Reply READY without tools or file changes.");
    }
    if (phase === "mission-b") {
      await add("real-team-owner", "builtin:architect");
      await saveMessages("real-team-owner", [
        {
          id: "private-team-owner",
          role: "user",
          parts: [
            {
              type: "text",
              text: "PRIVATE_PARENT_CANARY_7b32017: unrelated private note, not authorized task evidence.",
            },
          ],
        },
      ]);
      const roles = [
        ["Architect", "builtin:architect"],
        ["Researcher", "real:researcher"],
        ["Coder", "builtin:coder"],
        ["Reviewer", "builtin:reviewer"],
      ];
      const tasks: string[] = [];
      for (const [role, agentId] of roles) {
        const id = `real-team-${role}`;
        await add(id, agentId);
        const response = await requestPeerTask({
          sourceSessionId: "real-team-owner",
          targetSessionId: id,
          kind: role === "Reviewer" ? "review" : "delegate",
          executionMode: role === "Coder" ? "shared-write" : "read-only",
          dependsOn: tasks.slice(-1),
          awaitCompletion: true,
          prompt: `${feature}\nDo not implement Mission A or rebuild missing prerequisites. Report any missing foundation honestly.\nYour role: ${role}. ${role === "Architect" ? "Inspect the current project, produce a concrete implementation plan and risks; do not implement." : role === "Researcher" ? "Investigate persistence, mutation/SSE flow, safe undo boundaries and tests. Do not implement." : role === "Coder" ? "Implement, test, debug, document and finish this feature using the authorized dependency evidence." : "Independently inspect actual files, tests, persistence/undo and regressions. Report concrete defects; do not accept prose as evidence."}`,
        });
        assert(response.ok, JSON.stringify(response));
        tasks.push(response.task.id);
        evidence.emit({ kind: "peer-result", task: response.task });
        if (response.task.status !== "completed") break;
      }
    }
    await sleep(1000);
    const sessions = useChatStore
      .getState()
      .sessions.filter((s) => s.id.startsWith("real-"));
    const conversations = [];
    for (const session of sessions) {
      const messages = chats.get(session.id)?.messages;
      if (messages) {
        await persistCompactionSource(session.id, messages);
        flushPersist(session.id);
      }
      await awaitSessionWrites(session.id);
      conversations.push({
        id: session.id,
        messages: await loadMessages(session.id),
        todos:
          phase === "restart"
            ? await loadTodos(session.id)
            : getTodos(session.id),
        memory: await loadConversationMemory({
          sessionId: session.id,
          workspaceId: session.profile?.workspaceId ?? null,
        }),
      });
    }
    await flushTodoPersistence();
    await flushPeerTasks();
    await evidence.flush();
    return {
      phase,
      sessions,
      conversations,
      tasks: usePeerTaskStore.getState().tasks,
      correctionSent,
      harnessStop,
      traceStreams: config.realProduct.traceStreams ?? false,
      prepareOnly: config.realProduct.prepareOnly ?? false,
      correctionEvidence,
      reasoningControl,
      systemProbe,
      protocolResult,
      planSnapshots,
      limits,
      outcomes: [{ name: `real-product-${phase}`, taskIds: [] }],
      cloudInference: 0,
    };
  } finally {
    unobserve();
    capacity();
    await evidence.flush();
  }
}
