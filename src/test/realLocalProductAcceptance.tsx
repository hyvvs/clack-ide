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
import { generateText } from "ai";
import { createRoot } from "react-dom/client";

type Phase =
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
  realProduct?: { phase: Phase };
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Observe native response channels without replacing routing or provider responses.
function audit(report: string) {
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
      const decoder = new TextDecoder();
      let line = "";
      let first = false;
      descriptor.set?.call(this, (event: Event) => {
        if (
          typeof event?.requestId !== "string" ||
          !event.requestId.startsWith("inference-")
        ) {
          previous.call(this, event);
          return;
        }
        if (event.kind === "chunk" && event.bytes) {
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
                  metrics,
                });
              }
            } catch {
              /* HTTP error bodies need not be NDJSON. */
            }
          }
          if (line.length > 4 * 1024 * 1024) line = "";
        } else if (["settled", "phase", "admission"].includes(event.kind))
          emit({ ...event, at: Date.now() });
        previous.call(this, event);
      });
    },
  });
  return { emit, flush: () => pending };
}

export async function runRealLocalProduct(config: Configuration) {
  assert(config.realProduct, "Missing real product phase");
  const phase = config.realProduct.phase;
  const evidence = audit(config.report);
  await usePreferencesStore.getState().init();
  const root = await native.workspaceAuthorize(config.root);
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
      "qwen38-uncensored:latest",
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
      selectedModelId: "qwen38-uncensored:latest",
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
    (p) => p.transportModelId === "qwen38-uncensored:latest",
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
            selectedModelId: "qwen38-uncensored:latest",
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
  if (phase === "mission-a") await add("real-mission-a", "builtin:coder");
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
  const run = async (id: string, text: string) => {
    await prepareSessionChat(id);
    useChatStore.setState({ activeSessionId: id });
    await sendMessageToSession(id, { text });
    // Let production automatic continuations and bridge persistence settle.
    for (;;) {
      await sleep(1000);
      const session = useChatStore.getState().sessions.find((s) => s.id === id);
      const chat = chats.get(id);
      if (
        (session?.run?.state && session.run.state !== "running") ||
        useChatStore.getState().pendingApprovalsBySession[id]?.length ||
        !chat ||
        (chat.status !== "submitted" &&
          chat.status !== "streaming" &&
          session?.run?.budget?.phase !== "auto-continue-pending" &&
          session?.run?.budget?.phase !== "running")
      )
        break;
    }
  };
  let correctionSent = false;
  let correctionEvidence: unknown;
  let systemProbe: string | undefined;
  try {
    if (phase === "system-preflight") {
      const model = await buildConfiguredLanguageModel(
        selection,
        EMPTY_PROVIDER_KEYS,
        {
          selfHostedInference: state,
          capturedModelIdentity:
            selfHostedTransportIdentity(selection, state) ?? undefined,
          inferenceScope: {
            sessionId: "real-system-preflight",
            runId: crypto.randomUUID(),
            isCurrent: () => true,
          },
        },
      );
      const result = await generateText({
        model,
        messages: [
          {
            role: "system",
            content: "Follow the user request. Preserve original constraints.",
          },
          {
            role: "system",
            content:
              "Continue the same answer without repeating prior text. This is a bounded transport check, with no tools or file changes.",
          },
          { role: "user", content: "Reply with exactly READY." },
        ],
        maxOutputTokens: 2048,
        maxRetries: 0,
      });
      systemProbe = result.text;
      assert(
        systemProbe.trim().length > 0,
        "Native multi-system transport probe did not complete",
      );
    }
    if (phase === "preflight")
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
      const monitor = setInterval(() => {
        const parts = chats
          .get("real-mission-a")
          ?.messages.flatMap((m) => m.parts) as Part[] | undefined;
        const writes =
          parts?.filter(
            (p) =>
              ["tool-write_file", "tool-edit", "tool-multi_edit"].includes(
                p.type,
              ) &&
              p.state === "output-available" &&
              !(p.output as { error?: unknown })?.error,
          ) ?? [];
        const old = writes.find((p) =>
          /(?:page|limit|size|perPage)[^\n]{0,70}\b50\b/i.test(
            JSON.stringify(p.input),
          ),
        );
        const plan = getTodos("real-mission-a");
        if (
          JSON.stringify(plan) !==
          JSON.stringify(planSnapshots[planSnapshots.length - 1])
        )
          planSnapshots.push(plan);
        if (!alreadyCorrected && !correcting && writes.length >= 3 && old) {
          correcting = true;
          correctionEvidence = {
            at: Date.now(),
            writes: writes.length,
            source: old,
          };
          evidence.emit({
            kind: "correction-boundary",
            evidence: correctionEvidence,
          });
          void cancelRun("real-mission-a");
        }
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
      }
      if (correcting) {
        correctionSent = true;
        await run("real-mission-a", correction);
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
      correctionEvidence,
      systemProbe,
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
