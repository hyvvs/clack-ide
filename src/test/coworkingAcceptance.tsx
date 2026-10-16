import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { AgentRunBridge } from "@/modules/ai/components/AgentRunBridge";
import { PeerTaskQueueBridge } from "@/modules/ai/components/PeerTaskQueueBridge";
import {
  createConversationProfile,
  saveSessionsList,
  awaitSessionWrites,
  loadMessages,
  saveMessages,
} from "@/modules/ai/lib/sessions";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  emptySelfHostedState,
  ensureSelfHostedProfile,
  setProfileOverride,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  saveSelfHostedModel,
  selfHostedSelectionId,
} from "@/modules/ai/lib/selfHostedModels";
import {
  updateSelfHostedProfiles,
  setAgentPermissionProfiles,
} from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import {
  useChatStore,
  chats,
  flushPersist,
  seedMessages,
} from "@/modules/ai/store/chatStore";
import { sendMessageToSession } from "@/modules/ai/store/chatRuntime";
import {
  flushPeerTasks,
  usePeerTaskStore,
} from "@/modules/ai/store/peerTaskStore";
import {
  requestPeerTask,
  applyPeerTaskChangeSet,
  cancelPeerTask,
  discardPeerTaskWorktree,
  type PeerTaskRequest,
} from "@/modules/ai/lib/peerTaskCoordinator";
import { native } from "@/modules/ai/lib/native";
import { saveCustomAgents, type Agent } from "@/modules/ai/lib/agents";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import { projectCompletedPeerHistory } from "@/modules/ai/lib/peerHistory";
import {
  subscribeInference,
  sessionInference,
} from "@/modules/ai/lib/inferenceLifecycle";
import {
  dispatcherActiveCount,
  dispatcherTaskStatus,
} from "@/modules/ai/lib/dispatcherTasks";
import {
  retryTaskWithoutEffects,
  archiveFinishedTasks,
  setTaskArchived,
  checkTaskRetry,
} from "@/modules/ai/lib/taskResultActions";
import { finishedTasksToArchive } from "@/modules/ai/lib/taskArchive";

type Configuration = {
  root: string;
  server: string;
  report: string;
  phase: "exercise" | "restart";
  smallTeam?: boolean;
  localAgent?: boolean;
  ollama?: { live: boolean; model: string };
  realProduct?: { phase: "stream-diagnostic" | "preflight" | "system-preflight" | "mission-a" | "resume-a" | "restart" | "mission-b" | "offline" | "stability"; maxOutput?: number; singleSpec?: boolean; reasoningChoice?: "automatic" | "none" };
  streamDiagnostic?: { body: Record<string, unknown>; sourceRequestId: string };
};
const outcomes: { name: string; taskIds: string[] }[] = [];
const lifecycle: { id: string; status: string; at: number }[] = [];
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function task(id: string): PeerTask {
  const value = usePeerTaskStore.getState().tasks.find((t) => t.id === id);
  assert(value, `Missing durable task ${id}`);
  return value;
}
function waitState(predicate: () => boolean, label: string): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      release();
      reject(new Error(`Barrier timeout: ${label}`));
    }, 60000);
    const check = () => {
      if (predicate()) {
        release();
        resolve();
      }
    };
    const unsubscribers = [
      usePeerTaskStore.subscribe(check),
      useChatStore.subscribe(check),
      subscribeInference(check),
    ];
    const release = () => {
      clearTimeout(timeout);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
    check();
  });
}
async function completed(id: string) {
  await waitState(
    () =>
      ["completed", "failed", "cancelled", "blocked"].includes(task(id).status),
    id,
  );
  const value = task(id);
  assert(value.status === "completed", `${id}: ${JSON.stringify(value.error)}`);
  assert(
    value.result?.targetAgentId === value.targetAgentId,
    "Wrong result Agent",
  );
  assert(
    value.result?.targetModelId === value.targetModelId,
    "Wrong result model",
  );
  assert(value.handoff, "Production handoff receipt missing");
  return value;
}
async function main(config: Configuration) {
  if (config.realProduct) {
    const { runRealLocalProduct } = await import("@/test/realLocalProductAcceptance");
    return runRealLocalProduct(config);
  }
  if (config.ollama) {
    await fetch(new URL("/progress?stage=import-ollama", config.report));
    const { runOllamaAcceptance } = await import("@/test/ollamaAcceptance");
    return runOllamaAcceptance(config);
  }
  await usePreferencesStore.getState().init();
  const root = await native.workspaceAuthorize(config.root);
  useChatStore
    .getState()
    .setLive({
      ...useChatStore.getState().live,
      getCwd: () => root,
      getWorkspaceRoot: () => root,
      getActiveFile: () => null,
    });
  if (config.phase === "restart") {
    await useAgentsStore.getState().hydrate();
    await useChatStore.getState().hydrateSessions();
    if (config.localAgent) return (await import("@/test/localAgentAcceptance")).localAgentRestart();
    const sessions = useChatStore.getState().sessions;
    const recovery = {
      sessions,
      isAgentConfigured: (id: string) =>
        useAgentsStore
          .getState()
          .all()
          .some((item) => item.id === id),
      isModelConfigured: (id: string) =>
        sessions.some((item) => item.profile?.modelId === id),
    };
    await usePeerTaskStore.getState().hydrate(recovery);
    const interrupted = usePeerTaskStore
      .getState()
      .tasks.find((item) => item.prompt.startsWith("RESTART_HOLD"));
    assert(
      interrupted?.status === "failed" && interrupted.recovery,
      "Running task did not recover without replay",
    );
    const before = JSON.stringify(usePeerTaskStore.getState().tasks);
    await usePeerTaskStore.getState().hydrate(recovery);
    assert(
      JSON.stringify(usePeerTaskStore.getState().tasks) === before,
      "Recovery was not idempotent",
    );
    await flushPeerTasks();
    await Promise.all(sessions.map((item) => awaitSessionWrites(item.id)));
    return {
      outcomes: [
        { name: "native-process-restart-no-replay", taskIds: [interrupted.id] },
      ],
      lifecycle,
      phases: [],
      tasks: usePeerTaskStore.getState().tasks,
      sessions,
      conversations: await Promise.all(
        sessions.map(async (item) => ({
          id: item.id,
          messages: await loadMessages(item.id),
        })),
      ),
    };
  }
  const definitions = ["Architect", "Researcher", "Coder", "Reviewer"] as const;
  const agents: Agent[] = definitions.map((name) => ({
    id: `acceptance:${name}`,
    name,
    description: `Controlled ${name} role`,
    icon: "coder",
    builtIn: false,
    instructions: `ROLE=${name}. Perform only the explicit bounded task. Report tool evidence, never claim unobserved effects.`,
  }));
  useAgentsStore.setState({
    customAgents: agents,
    activeId: agents[0].id,
    hydrated: true,
  });
  await saveCustomAgents(agents);
  let models = addSelfHostedEndpoint(
    emptySelfHostedState(),
    createSelfHostedEndpoint(
      {
        alias: "Controlled local endpoint",
        baseURL: config.server,
        backendHint: "vllm",
        allowPrivateNetwork: true,
      },
      "acceptance-local",
    ),
  );
  for (const capacity of [4096, 8192, 16384, 32768, 131072]) {
    const { state, profile } = ensureSelfHostedProfile(
      models,
      "acceptance-local",
      `fixture-${capacity}`,
    );
    models = saveSelfHostedModel(
      state,
      "acceptance-local",
      profile.transportModelId,
    );
    for (const [field, value] of [
      ["configuredContext", capacity],
      [
        "outputReserve",
        capacity === 4096 ? 256 : capacity === 8192 ? 512 : 1024,
      ],
      ["maxOutput", capacity === 4096 ? 256 : capacity === 8192 ? 512 : 1024],
      ["concurrentGenerations", 1],
    ] as const)
      models = setProfileOverride(models, profile.id, field, value);
  }
  const persisted = await updateSelfHostedProfiles(() => models);
  usePreferencesStore.setState({
    selfHostedInference: persisted,
    hydrated: true,
    agentPermissionProfiles: Object.fromEntries(
      agents.map((agent) => [
        agent.id,
        { mode: "full-access", categories: {} },
      ]),
    ),
  });
  await setAgentPermissionProfiles(
    usePreferencesStore.getState().agentPermissionProfiles,
  );
  const selection = (capacity: number) => {
    const profile = persisted.profiles.find(
      (p) => p.transportModelId === `fixture-${capacity}`,
    );
    assert(profile, "Missing model profile");
    return selfHostedSelectionId(profile);
  };
  const sessions = [
    "Architect",
    "Researcher",
    "Coder",
    "Reviewer",
    ...Array.from({ length: 12 }, (_, i) => `worker-${i}`),
    "small-Researcher",
    "small-Reviewer",
    "small-Coder",
    "small-fresh-Reviewer",
    "four-basic",
  ].map((id, index) => ({
    id,
    title: id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    profileVersion: 1,
    profile: createConversationProfile({
      agentId: id.startsWith("small-")
        ? agents.find((agent) => agent.name === id.split("-").slice(-1)[0])?.id ?? null
        : agents[index < 4 ? index : index % 4].id,
      modelId: selection(
        id === "four-basic" ? 4096 : id.startsWith("small-") ? 8192 : 16384,
      ),
      workspaceRoot: root,
      workspaceEnvironment: "local",
    }),
  }));
  await saveSessionsList(sessions);
  const privateSource = [
    {
      id: "private-parent",
      role: "user" as const,
      parts: [
        {
          type: "text" as const,
          text: "PRIVATE_PARENT_CANARY_7b32017: This private note must not be copied to a delegated worker.",
        },
      ],
    },
  ];
  await saveMessages("Architect", privateSource);
  seedMessages.set("Architect", privateSource);
  useChatStore.setState({
    sessions,
    sessionsHydrated: true,
    activeSessionId: "Architect",
    selectedModelId: selection(16384),
  });
  await usePeerTaskStore
    .getState()
    .hydrate({
      sessions,
      isAgentConfigured: () => true,
      isModelConfigured: () => true,
    });
  const seen = new Map<string, string>();
  usePeerTaskStore.subscribe((state) => {
    for (const item of state.tasks)
      if (seen.get(item.id) !== item.status) {
        lifecycle.push({
          id: item.id,
          status: item.status,
          at: item.updatedAt,
        });
        seen.set(item.id, item.status);
      }
  });
  const element = document.getElementById("root");
  assert(element, "Fixture root missing");
  createRoot(element).render(
    <>
      <AgentRunBridge openAiDiffTab={() => null} closeAiDiffTab={() => {}} />
      <PeerTaskQueueBridge />
    </>,
  );
  if (config.localAgent)
    return (await import("@/test/localAgentAcceptance")).runLocalAgentAcceptance(root, selection, config.report);
  const delegate = async (prompt: string, targetSessionId = "Researcher") => {
    const response = await requestPeerTask({
      sourceSessionId: "Architect",
      targetSessionId,
      prompt,
      kind: "question",
      awaitCompletion: true,
    });
    assert(response.ok, JSON.stringify(response));
    return completed(response.task.id);
  };
  const mission = async (capacity: number) => {
    for (const id of definitions)
      assert(
        useChatStore
          .getState()
          .setSessionModelId(id, selection(capacity), false),
        "Idle model selection failed",
      );
    const created: string[] = [];
    const stage = async (
      name: string,
      targetSessionId: string,
      kind: "delegate" | "review",
      followUpTo?: string,
      finding?: PeerTask,
    ) => {
      const before = new Set(
        usePeerTaskStore.getState().tasks.map((item) => item.id),
      );
      await sendMessageToSession("Architect", {
        text: `Delegate using request_peer_task with these exact bounded arguments. MISSION_CONFIG=${JSON.stringify({ targetSessionId, kind, followUpTo, artifactRefs: finding ? [{ kind: "file", path: "config.json" }] : undefined, executionMode: targetSessionId === "Coder" ? "isolated-worktree" : "read-only", prompt: `${name}: Read the current configuration and source evidence.${targetSessionId === "Coder" ? " Edit src/timeout.js to implement the current timeout." : ""} Preserve allowRemote=false. Use only the required task tools.${finding ? ` Qualified Researcher finding from task ${finding.id}: ${finding.result?.summary}. Verify against the explicitly shared configuration snapshot.` : ""}` })}`,
      });
      assert(
        !chats.get("Architect")?.error,
        `Architect request failed: ${JSON.stringify(useChatStore.getState().runtimeBySession.Architect?.error)} ${chats.get("Architect")?.error}`,
      );
      const child = usePeerTaskStore
        .getState()
        .tasks.find((item) => !before.has(item.id));
      assert(child, `Architect did not delegate ${name}`);
      created.push(child.id);
      return completed(child.id);
    };
    const research = await stage("MISSION_RESEARCH", "Researcher", "delegate");
    const initial = await stage(
      "MISSION_CODER_INITIAL",
      "Coder",
      "delegate",
      undefined,
      research,
    );
    assert(
      initial.changeSet?.patch.includes("800"),
      "Initial coding work did not create the intentional review defect",
    );
    const review = await stage(
      "MISSION_REVIEW_INITIAL",
      "Reviewer",
      "review",
      initial.id,
    );
    assert(
      review.result?.summary.includes("800") &&
        review.result.summary.includes("750"),
      "Reviewer did not compare immutable patch and current config",
    );
    const correction = await stage(
      "MISSION_CODER_CORRECT",
      "Coder",
      "delegate",
      review.id,
    );
    assert(
      correction.changeSet?.patch.includes("750"),
      "Correction did not produce real patch",
    );
    const final = await stage(
      "MISSION_REVIEW_FINAL",
      "Reviewer",
      "review",
      correction.id,
    );
    assert(
      final.result?.summary.includes("verified"),
      "Final review did not verify the corrected patch",
    );
    await sendMessageToSession("Architect", {
      text: `Read the final review result using request_conversation_evidence, then report the reviewed correction. MISSION_AGGREGATE=${final.id}`,
    });
    assert(
      !chats.get("Architect")?.error,
      `Architect aggregation failed: ${JSON.stringify(useChatStore.getState().sessions.find((item) => item.id === "Architect")?.run?.error)}`,
    );
    const apply = await applyPeerTaskChangeSet(correction.id);
    assert(apply.ok, JSON.stringify(apply));
    const file = await native.readFile(`${root}/src/timeout.js`);
    assert(
      file.kind === "text" && file.content.includes("750"),
      "Approved patch was not applied to the real workspace",
    );
    outcomes.push({
      name: `native-team-mission-${capacity}`,
      taskIds: created,
    });
  };
  await mission(16384);
  await sendMessageToSession("four-basic", { text: "Hello" });
  assert(
    !chats.get("four-basic")?.error,
    `Basic 4k conversation failed: ${JSON.stringify(useChatStore.getState().sessions.find((item) => item.id === "four-basic")?.run?.error)}`,
  );
  outcomes.push({
    name: "native-capacity-4096-basic-conversation",
    taskIds: [],
  });
  await native.gitStage(root, ["src/timeout.js"]);
  await native.gitCommit(
    root,
    "Accept reviewed timeout correction in controlled fixture",
  );
  assert(
    !(await native.gitStatus(root)).changedFiles.length,
    "Controlled workspace was not clean before isolated mixed edits",
  );
  const mixed: string[] = [];
  const assign = async (
    targetSessionId: string,
    prompt: string,
    extra: Partial<PeerTaskRequest> = {},
  ) => {
    const response = await requestPeerTask({
      sourceSessionId: "Architect",
      targetSessionId,
      prompt,
      kind: "question",
      ...extra,
      awaitCompletion: false,
    });
    assert(response.ok, JSON.stringify(response));
    assert(
      usePeerTaskStore
        .getState()
        .tasks.some((item) => item.id === response.task.id),
      "Mixed task was not immediately visible",
    );
    return completed(response.task.id);
  };
  const small = await assign(
    "small-Researcher",
    "SMALL_BOUND: read config.json and report the exact corrected timeout and remote-access restriction.",
  );
  const smallReview = await assign(
    "small-Reviewer",
    "SMALL_VERIFY: inspect the declared producer using request_conversation_evidence and report its qualified historical finding. Do not assert current file state without a new observation.",
    { followUpTo: small.id },
  );
  assert(
    small.result?.summary.includes("750") &&
      smallReview.result?.summary.includes("750"),
    "8k bounded team lost current evidence",
  );
  outcomes.push({
    name: "native-bounded-team-8k",
    taskIds: [small.id, smallReview.id],
  });
  if (config.smallTeam) {
    const coding = await assign("small-Coder", "SMALL_CODE: use read_file config.json, then read_file src/small-timeout.js and edit that function to implement the current timeout. Preserve allowRemote=false.", { kind: "delegate", executionMode: "isolated-worktree", followUpTo: small.id });
    assert(coding.changeSet?.patch.includes("750"), "8k coder did not produce the actual correction");
    const reviewPrompt = "SMALL_REVIEW_CODE: use read_file config.json and request_conversation_evidence to verify the immutable patch against the exact current timeout and allowRemote=false.";
    const narrow = await requestPeerTask({ sourceSessionId: "Architect", targetSessionId: "small-fresh-Reviewer", prompt: reviewPrompt, kind: "review", followUpTo: coding.id, awaitCompletion: false });
    assert(narrow.ok, JSON.stringify(narrow));
    await waitState(() => ["completed", "failed"].includes(task(narrow.task.id).status), "8k immutable review boundary");
    let review: PeerTask;
    if (task(narrow.task.id).status === "failed") {
      const failed = useChatStore.getState().sessions.find(item => item.id === "small-fresh-Reviewer")?.run;
      assert(failed?.error?.kind === "bad_request" && failed.error.errorCode === "retrieval-budget", "8k review failed for a non-capacity reason");
      outcomes.push({ name: "native-8k-review-required-overflow", taskIds: [narrow.task.id] });
      assert(useChatStore.getState().setSessionModelId("small-fresh-Reviewer", selection(16384), false), "Larger idle review model selection failed");
      review = await assign("small-fresh-Reviewer", `${reviewPrompt} New verification on the explicitly selected 16k Reviewer after capacity-blocked attempt ${narrow.task.id}. Inspect the original patch; do not replay the code edit.`, { kind: "review", followUpTo: coding.id });
    } else review = await completed(narrow.task.id);
    assert(review.result?.summary.includes("verified"), "8k reviewer did not verify actual patch evidence");
    assert((await applyPeerTaskChangeSet(coding.id)).ok, "8k reviewed Apply failed");
    const actual = await native.readFile(`${root}/src/small-timeout.js`);
    assert(actual.kind === "text" && actual.content.includes("750"), "8k correction did not reach the real filesystem");
    outcomes.push({ name: review.targetModelId === selection(8192) ? "native-editing-team-8k" : "native-8k-coder-16k-reviewer", taskIds: [small.id, coding.id, review.id] });
    await flushPeerTasks();
    flushPersist();
    await Promise.all(sessions.map(item => awaitSessionWrites(item.id)));
    return { outcomes, lifecycle, phases: [], tasks: usePeerTaskStore.getState().tasks,
      conversations: [...chats.entries()].map(([id, chat]) => ({ id, messages: chat.messages })),
      sessions: useChatStore.getState().sessions,
    };
  }
  assert(
    useChatStore
      .getState()
      .setSessionModelId("Architect", selection(32768), false),
    "Idle source model change failed",
  );
  const changedSource = await assign(
    "Researcher",
    "SOURCE_SWITCH: read config.json and report the exact timeout.",
  );
  assert(
    changedSource.sourceModelId === selection(32768),
    "Delegation reused the old idle source model",
  );
  assert(
    useChatStore
      .getState()
      .setSessionModelId("Architect", selection(16384), false),
    "Source model restore failed",
  );
  outcomes.push({
    name: "native-source-model-switch-identity",
    taskIds: [changedSource.id],
  });
  for (const capacity of [32768, 131072]) {
    assert(
      useChatStore
        .getState()
        .setSessionModelId("small-Researcher", selection(capacity), false),
      "Idle recipient model change failed",
    );
    const value = await assign(
      "small-Researcher",
      `CAPACITY_${capacity}: read config.json and report the exact timeout.`,
    );
    assert(
      value.targetModelId === selection(capacity) &&
        value.result?.summary.includes("750"),
      "Recipient model/capacity isolation failed",
    );
    outcomes.push({ name: `native-capacity-${capacity}`, taskIds: [value.id] });
  }
  assert(
    useChatStore
      .getState()
      .setSessionModelId("small-Researcher", selection(4096), false),
    "4k recipient selection failed",
  );
  const four = await requestPeerTask({
    sourceSessionId: "Architect",
    targetSessionId: "small-Researcher",
    kind: "question",
    prompt: "CAPACITY_4096: read config.json and report the exact timeout.",
    awaitCompletion: false,
  });
  assert(four.ok, JSON.stringify(four));
  await waitState(
    () => ["completed", "failed"].includes(task(four.task.id).status),
    "honest 4k preflight result",
  );
  assert(
    task(four.task.id).status === "failed" && task(four.task.id).preRunFailure,
    "4k capacity did not reject genuinely oversized protected context before transmission",
  );
  outcomes.push({
    name: "native-capacity-4096-protected-overflow",
    taskIds: [four.task.id],
  });
  for (let round = 0; round < 10; round++) {
    const read = await assign(
      "Researcher",
      `MIXED_READ_${round}: read config.json and report the exact timeout.`,
    );
    mixed.push(read.id);
    const edit = await assign(
      "Coder",
      `MIXED_EDIT_${round}: use read_file config.json, then write_file src/generated-${round}.json with the current timeoutMs and allowRemote values. Preserve false.`,
      { kind: "delegate", executionMode: "isolated-worktree" },
    );
    assert(
      edit.changeSet?.changedPaths.includes(`src/generated-${round}.json`),
      "Mixed edit did not create its real file",
    );
    mixed.push(edit.id);
    const review = await assign(
      "Reviewer",
      `MIXED_REVIEW_${round}: read config.json and use request_conversation_evidence to review the immutable patch, including timeoutMs and allowRemote.`,
      { kind: "review", followUpTo: edit.id },
    );
    assert(
      review.result?.summary.includes("verified"),
      "Mixed reviewer did not verify actual patch evidence",
    );
    mixed.push(review.id);
    const dependent = await assign(
      "worker-1",
      `MIXED_DEPENDENCY_${round}: read config.json and report the exact timeout, retaining the completed review as historical evidence.`,
      { followUpTo: review.id },
    );
    assert(
      dependent.dependsOn.includes(review.id),
      "Dependent task lost its producer",
    );
    mixed.push(dependent.id);
    const applied = await applyPeerTaskChangeSet(edit.id);
    assert(applied.ok, JSON.stringify(applied));
    const actual = await native.readFile(`${root}/src/generated-${round}.json`);
    assert(
      actual.kind === "text" &&
        JSON.parse(actual.content).timeoutMs === 750 &&
        JSON.parse(actual.content).allowRemote === false,
      "Mixed Apply did not preserve configuration",
    );
    await native.gitStage(root, [`src/generated-${round}.json`]);
    await native.gitCommit(
      root,
      `Accept reviewed generated configuration ${round} in controlled fixture`,
    );
    assert(
      !(await native.gitStatus(root)).changedFiles.length,
      "Controlled Source Control checkpoint left unexpected files",
    );
    if (round === 0) {
      const clarified = await assign(
        "worker-2",
        "MIXED_CLARIFY_0: use communicate_peer_task to ask the source which timeout requirement applies, then read config.json and verify the answer.",
      );
      assert(
        clarified.communication?.some(
          (item) =>
            item.kind === "clarification-request" && item.state === "answered",
        ),
        "Clarification request was not answered",
      );
      assert(
        clarified.communication?.some(
          (item) => item.kind === "clarification-response",
        ),
        "Source response provenance missing",
      );
      mixed.push(clarified.id);
    } else if (round === 1) {
      const failed = await requestPeerTask({
        sourceSessionId: "Architect",
        targetSessionId: "worker-2",
        kind: "question",
        prompt: "MIXED_FAIL_1: read config.json and report the exact timeout.",
        awaitCompletion: false,
      });
      assert(failed.ok, JSON.stringify(failed));
      await waitState(
        () => task(failed.task.id).status === "failed",
        "controlled read failure",
      );
      const retried = await retryTaskWithoutEffects(
        failed.task.id,
        "Architect",
      );
      const success = await completed(retried.id);
      assert(
        success.retryOfTaskId === failed.task.id &&
          task(failed.task.id).status === "failed",
        "Safe Retry lost original failure provenance",
      );
      mixed.push(success.id);
    } else
      mixed.push(
        (
          await assign(
            "worker-2",
            `MIXED_SAME_AGENT_${round}: read config.json and report the exact timeout.`,
          )
        ).id,
      );
  }
  assert(
    mixed.length === 50 && new Set(mixed).size === 50,
    "Mixed cohort did not contain 50 distinct successful delegations",
  );
  outcomes.push({ name: "sequential-mixed-50", taskIds: mixed });
  const first = await delegate(
    "READ_BOUND_0: read config.json and report the exact timeout value.",
  );
  assert(
    first.result?.summary.includes("750"),
    "Bounded read did not report actual fixture value",
  );
  outcomes.push({ name: "native-read-16k", taskIds: [first.id] });

  for (let index = 1; index < 50; index++) {
    const value = await delegate(
      `READ_BOUND_${index}: read config.json and report the exact timeout value.`,
      index % 2 ? "Researcher" : "Reviewer",
    );
    assert(value.result?.summary.includes("750"), "Read evidence lost");
    outcomes.push({ name: `sequential-${index}`, taskIds: [value.id] });
  }
  const parallelTasks = await Promise.all(
    Array.from({ length: 12 }, async (_, index) => {
      const response = await requestPeerTask({
        sourceSessionId: "Architect",
        targetSessionId: `worker-${index}`,
        prompt: `PARALLEL_${index}: read config.json and report the timeout.`,
        kind: "question",
        awaitCompletion: false,
      });
      assert(response.ok, JSON.stringify(response));
      assert(
        usePeerTaskStore
          .getState()
          .tasks.some((item) => item.id === response.task.id),
        "Task was not immediately visible",
      );
      return response.task;
    }),
  );
  await waitState(
    () =>
      parallelTasks.some(
        (item) => sessionInference(item.targetSessionId)?.phase === "queued",
      ),
    "real endpoint capacity barrier",
  );
  assert(
    dispatcherActiveCount(usePeerTaskStore.getState().tasks) === 12,
    "Dispatcher omitted active/queued workers",
  );
  const phases = parallelTasks.map((item) => ({
    id: item.id,
    phase: dispatcherTaskStatus(
      task(item.id),
      sessionInference(item.targetSessionId),
    ),
  }));
  assert(
    phases.some((item) => item.phase === "Waiting for model capacity"),
    "Capacity phase was not represented in Dispatcher",
  );
  await fetch(new URL("../release-parallel", config.server), {
    method: "POST",
  });
  const parallel = await Promise.all(
    parallelTasks.map((item) => completed(item.id)),
  );
  for (const item of parallel)
    assert(
      item.result?.summary.includes("750"),
      "Parallel result lost evidence",
    );
  outcomes.push({
    name: "parallel-12",
    taskIds: parallel.map((item) => item.id),
  });

  const archived = parallel[0];
  const preserved = JSON.stringify(archived.result);
  await setTaskArchived(archived.id, "Architect", true);
  assert(
    task(archived.id).archivedAt &&
      JSON.stringify(task(archived.id).result) === preserved,
    "Archive lost durable result",
  );
  await setTaskArchived(archived.id, "Architect", false);
  assert(!task(archived.id).archivedAt, "Restore failed");
  const eligible = finishedTasksToArchive(
    usePeerTaskStore.getState().tasks,
  ).map((item) => item.id);
  await archiveFinishedTasks(eligible);
  assert(
    eligible.every((id) => task(id).archivedAt),
    "Clear finished did not archive eligible records",
  );
  assert(
    JSON.stringify(task(archived.id).result) === preserved,
    "Clear finished deleted evidence",
  );
  outcomes.push({ name: "native-archive-restore-clear", taskIds: eligible });

  const two = await updateSelfHostedProfiles((current) =>
    current.profiles.reduce(
      (state, profile) =>
        setProfileOverride(state, profile.id, "concurrentGenerations", 2),
      current,
    ),
  );
  usePreferencesStore.setState({ selfHostedInference: two });
  await fetch(new URL("../capacity-two", config.server), { method: "POST" });
  const atTwo = await Promise.all(
    Array.from({ length: 4 }, async (_, index) => {
      const response = await requestPeerTask({
        sourceSessionId: "Architect",
        targetSessionId: `worker-${index}`,
        kind: "question",
        prompt: `CAPACITY_TWO_${index}: read config.json and report the timeout.`,
        awaitCompletion: false,
      });
      assert(response.ok, JSON.stringify(response));
      return response.task;
    }),
  );
  await waitState(
    () =>
      atTwo.filter(
        (item) =>
          sessionInference(item.targetSessionId)?.phase ===
          "waiting-first-output",
      ).length === 2 &&
      atTwo.some(
        (item) => sessionInference(item.targetSessionId)?.phase === "queued",
      ),
    "actual capacity-two barrier",
  );
  assert(
    dispatcherActiveCount(usePeerTaskStore.getState().tasks) === 4,
    "Capacity-two Dispatcher count mismatch",
  );
  await fetch(new URL("../release-two", config.server), { method: "POST" });
  await Promise.all(atTwo.map((item) => completed(item.id)));
  outcomes.push({
    name: "native-capacity-two",
    taskIds: atTwo.map((item) => item.id),
  });

  const cancelled: PeerTask[] = [];
  for (const [index, state] of ["STREAM", "FIRST", "QUEUED"].entries()) {
    const response = await requestPeerTask({
      sourceSessionId: "Architect",
      targetSessionId: `worker-${index}`,
      kind: "question",
      prompt: `CANCEL_HOLD_${state}: read config.json and report the timeout.`,
      awaitCompletion: false,
    });
    assert(response.ok, JSON.stringify(response));
    cancelled.push(response.task);
    await waitState(
      () =>
        sessionInference(`worker-${index}`)?.phase ===
        ["generating", "waiting-first-output", "queued"][index],
      `cancel ${state} barrier`,
    );
  }
  await waitState(
    () =>
      sessionInference("worker-0")?.phase === "generating" &&
      sessionInference("worker-1")?.phase === "waiting-first-output" &&
      sessionInference("worker-2")?.phase === "queued",
    "stream/first-output/queue cancellation barrier",
  );
  for (const item of [...cancelled].reverse()) {
    const stopped = await cancelPeerTask(item.id);
    assert(
      stopped.ok && task(item.id).status === "cancelled",
      "Actual cancellation failed",
    );
  }
  const afterCancel = await assign(
    "worker-3",
    "AFTER_CANCEL: read config.json and report the timeout.",
  );
  assert(
    afterCancel.result?.summary.includes("750"),
    "Cancellation did not free endpoint capacity",
  );
  outcomes.push({
    name: "native-cancellation-three-phases",
    taskIds: [...cancelled.map((item) => item.id), afterCancel.id],
  });

  const large = await assign(
    "worker-3",
    "LARGE_READ: use read_file logs/huge.txt with offset=40000 and limit=2. Report only that original window and disclose the remaining content was not read.",
  );
  assert(
    large.result?.summary.includes("Observation 40000"),
    "Large file window evidence lost",
  );
  outcomes.push({ name: "native-bounded-large-file", taskIds: [large.id] });
  const unsafe = await requestPeerTask({
    sourceSessionId: "Architect",
    targetSessionId: "worker-4",
    kind: "delegate",
    executionMode: "isolated-worktree",
    prompt:
      "UNSAFE_WRITE: use read_file config.json, then write_file src/unsafe.json preserving the configuration.",
    awaitCompletion: false,
  });
  assert(unsafe.ok, JSON.stringify(unsafe));
  await waitState(
    () => task(unsafe.task.id).status === "failed",
    "terminal failure after write",
  );
  const checkout = task(unsafe.task.id).worktree?.checkoutRoot;
  assert(checkout, "Failed staged effect was not preserved");
  const unsafeFile = await native.readFile(`${checkout}/src/unsafe.json`);
  assert(
    unsafeFile.kind === "text" &&
      JSON.parse(unsafeFile.content).timeoutMs === 750,
    "Expected staged effect missing",
  );
  let denied = false;
  try {
    await checkTaskRetry(unsafe.task.id, "Architect");
  } catch {
    denied = true;
  }
  assert(
    denied &&
      !usePeerTaskStore
        .getState()
        .tasks.some((item) => item.retryOfTaskId === unsafe.task.id),
    "Mutating failure allowed blind Retry",
  );
  assert(
    (await discardPeerTaskWorktree(unsafe.task.id)).ok,
    "Explicit scratch worktree disposal failed",
  );
  outcomes.push({
    name: "native-mutating-retry-denied",
    taskIds: [unsafe.task.id],
  });

  const restart = await requestPeerTask({
    sourceSessionId: "Architect",
    targetSessionId: "worker-0",
    kind: "question",
    prompt: "RESTART_HOLD: read config.json and report the timeout.",
    awaitCompletion: false,
  });
  assert(restart.ok, JSON.stringify(restart));
  await waitState(
    () => sessionInference("worker-0")?.phase === "waiting-first-output",
    "real restart request barrier",
  );
  assert(
    task(restart.task.id).status === "running",
    "Restart fixture did not preserve a live task",
  );

  await flushPeerTasks();
  flushPersist();
  await Promise.all(sessions.map((item) => awaitSessionWrites(item.id)));
  return {
    outcomes,
    lifecycle,
    phases,
    tasks: usePeerTaskStore.getState().tasks,
    conversations: [...chats.entries()].map(([id, chat]) => ({
      id,
      messages: chat.messages,
    })),
    sessions: useChatStore.getState().sessions,
  };
}
const configurationURL = new URL(location.href).searchParams.get(
  "configuration",
);
if (configurationURL) {
  void fetch(configurationURL)
    .then((response) => response.json() as Promise<Configuration>)
    .then(async (config) => {
      let result: unknown;
      try {
        result = { ok: true, ...(await main(config)) };
      } catch (error) {
        result = {
          ok: false,
          error: String(error),
          outcomes,
          lifecycle,
          tasks: usePeerTaskStore.getState().tasks,
          settings: await invoke("self_hosted_profiles_snapshot"),
          captured: usePreferencesStore.getState().selfHostedInference,
          sessions: useChatStore.getState().sessions,
          conversations: await Promise.all(
            [...chats.entries()].map(async ([id, chat]) => ({
              id,
              messages: chat.messages,
              working: await projectCompletedPeerHistory(
                chat.messages,
                id,
                usePeerTaskStore.getState().tasks,
              ),
            })),
          ),
        };
      }
      await fetch(config.report, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      await invoke("coworking_exit");
    });
}
