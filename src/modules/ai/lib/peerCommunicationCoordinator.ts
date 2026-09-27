import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  useChatStore,
  getChat,
  persistCompactionSource,
} from "@/modules/ai/store/chatStore";
import {
  flushPeerTasks,
  usePeerTaskStore,
} from "@/modules/ai/store/peerTaskStore";
import { sendPeerCommunicationToSession } from "@/modules/ai/store/chatRuntime";
import { sessionInference } from "@/modules/ai/lib/inferenceLifecycle";
import { inspectAttachmentContent } from "@/modules/ai/lib/attachmentStore";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import {
  currentWorkspaceWriteLease,
  isWaitingForWorkspaceWriteLease,
} from "@/modules/ai/lib/workspaceWriteLease";
import { resolveCurrentAgentPermission } from "@/modules/ai/lib/permissions";
import {
  peerReplySessions,
  peerWaitingSessions,
} from "@/modules/ai/lib/peerCommunicationRuntime";
import {
  activePeerTask,
  communicationDigest,
  communicationPayload,
  formatPeerCommunication,
  pendingPeerQuestion,
  preparePeerCommunication,
  reconcilePeerCommunication,
  routePeerCommunication,
  transitionPeerEvent,
  PEER_COMMUNICATION_ENABLED,
  permitsPeerEvent,
  type PeerCommunicationEvent,
  type PeerCommunicationInput,
} from "@/modules/ai/lib/peerCommunication";

async function endpoint(sessionId: string, workspaceId: string) {
  const session = useChatStore
    .getState()
    .sessions.find((item) => item.id === sessionId);
  const profile = session?.profile;
  if (
    !profile?.agentId ||
    !profile.modelId ||
    profile.workspaceId !== workspaceId
  )
    throw new Error("peer_communication_workspace_unavailable");
  const preferences = usePreferencesStore.getState();
  const agent = useAgentsStore
    .getState()
    .all()
    .find((item) => item.id === profile.agentId);
  if (!agent) throw new Error("peer_communication_agent_unavailable");
  return {
    sessionId,
    agentId: profile.agentId,
    modelId: profile.modelId,
    policyRevision: await communicationDigest({
      profile,
      agent,
      transport: resolveModelTransportIdentity(profile.modelId, preferences),
      modelRevision: session?.modelRevision ?? 0,
      permissions: preferences.agentPermissionProfiles[profile.agentId],
      workspacePermissions: preferences.agentWorkspacePermissions.filter(
        (rule) =>
          rule.agentId === profile.agentId &&
          rule.workspaceKey === profile.workspaceId,
      ),
    }),
  };
}

function mayWake(sessionId: string) {
  const session = useChatStore
    .getState()
    .sessions.find((item) => item.id === sessionId);
  if (!session?.profile?.agentId) return false;
  const agentId = session.profile.agentId;
  const workspaceRoot = session.profile.workspaceRoot;
  return (
    resolveCurrentAgentPermission(
      "communicate_peer_task",
      {},
      {
        getSessionId: () => sessionId,
        getAgentId: () => agentId,
        getCwd: () => workspaceRoot,
        getWorkspaceRoot: () => workspaceRoot,
      },
    ).outcome === "allow"
  );
}

export async function sendPeerCommunication(
  sessionId: string,
  startedAt: number,
  toolCallId: string,
  input: PeerCommunicationInput,
) {
  if (!PEER_COMMUNICATION_ENABLED)
    throw new Error("Peer communication is disabled.");
  const state = usePeerTaskStore.getState();
  const session = useChatStore
    .getState()
    .sessions.find((item) => item.id === sessionId);
  const task = state.tasks.find((item) => item.id === input.taskId);
  if (
    !task ||
    !state.recoveryReady ||
    session?.run?.state !== "running" ||
    session.run.startedAt !== startedAt ||
    peerReplySessions.has(sessionId)
  )
    throw new Error("peer_communication_stale_run");
  const actor = {
    ...(await endpoint(sessionId, task.workspaceId)),
    runStartedAt: startedAt,
    toolCallId,
  };
  if (
    session.run.agentId !== actor.agentId ||
    session.run.modelId !== actor.modelId
  )
    throw new Error("peer_communication_profile_changed");
  const route = routePeerCommunication(state.tasks, input, actor);
  const recipient = await endpoint(route.sessionId, task.workspaceId);
  const event = await preparePeerCommunication(
    state.tasks,
    input,
    actor,
    recipient,
  );
  if (event.kind === "clarification-request" && event.state !== "answered")
    peerWaitingSessions.add(sessionId);
  await usePeerTaskStore.getState().updateCommunication((tasks) => {
    const current = tasks.find((item) => item.id === task.id);
    const run = useChatStore
      .getState()
      .sessions.find((item) => item.id === sessionId)?.run;
    if (
      run?.state !== "running" ||
      run.startedAt !== startedAt ||
      !current ||
      !permitsPeerEvent(current, input.kind)
    )
      throw new Error("peer_communication_stale_run");
    if (current.communication?.some((item) => item.id === event.id))
      return tasks;
    if (current !== task) throw new Error("peer_communication_stale_revision");
    return tasks.map((item) => {
      if (item.id !== task.id) return item;
      const base =
        event.replyTo &&
        (event.kind === "clarification-response" ||
          event.kind === "review-response")
          ? transitionPeerEvent(item, event.replyTo, "answered")
          : item;
      return {
        ...base,
        updatedAt: Date.now(),
        communication: [...(base.communication ?? []), event],
      };
    });
  });
  return { eventId: event.id, status: event.state, taskId: event.taskId };
}

async function receipt(
  taskId: string,
  eventId: string,
  state: PeerCommunicationEvent["state"],
) {
  await usePeerTaskStore
    .getState()
    .updateCommunication((tasks) =>
      tasks.map((task) =>
        task.id === taskId ? transitionPeerEvent(task, eventId, state) : task,
      ),
    );
}

async function validateDelivery(event: PeerCommunicationEvent) {
  const task = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === event.taskId);
  if (
    !task ||
    !permitsPeerEvent(task, event.kind) ||
    Date.now() >= event.deadline
  )
    throw new Error("peer_communication_delivery_stale");
  if (event.digest !== (await communicationDigest(communicationPayload(event))))
    throw new Error("peer_communication_integrity_failed");
  const [sender, recipient] = [
    await endpoint(event.sender.sessionId, event.workspaceId),
    await endpoint(event.recipient.sessionId, event.workspaceId),
  ];
  if (
    JSON.stringify(sender) !== JSON.stringify(event.sender) ||
    JSON.stringify(recipient) !== JSON.stringify(event.recipient)
  )
    throw new Error("peer_communication_policy_changed");
  routePeerCommunication(usePeerTaskStore.getState().tasks, event, {
    ...event.sender,
    runStartedAt: event.runStartedAt,
    toolCallId: event.toolCallId,
  });
  if (event.evidence.length && task.recovery?.contentIssues?.length)
    throw new Error("peer_communication_evidence_unavailable");
  for (const evidence of event.evidence) {
    const content = await inspectAttachmentContent(evidence.contentHash);
    if (content.contentHash !== evidence.contentHash)
      throw new Error("peer_communication_evidence_corrupt");
  }
  return task;
}

const delivering = new Set<string>();
export async function blockPeerCommunication(
  taskId: string,
  message: string,
): Promise<void> {
  await usePeerTaskStore.getState().updateCommunication((tasks) =>
    tasks.map((task) =>
      task.id === taskId && activePeerTask(task)
        ? {
            ...task,
            status: "blocked",
            endedAt: Date.now(),
            error: {
              code: "peer_clarification_blocked",
              message: message.slice(0, 500),
            },
          }
        : task,
    ),
  );
}

export async function pumpPeerCommunication(): Promise<void> {
  try {
    await dispatchQueuedCommunication();
  } catch (error) {
    usePeerTaskStore.setState({
      recoveryReady: false,
      recoveryError: String(error),
    });
  }
}

async function dispatchQueuedCommunication(): Promise<void> {
  const store = usePeerTaskStore.getState();
  if (!PEER_COMMUNICATION_ENABLED || !store.recoveryReady) return;
  const reconciled = reconcilePeerCommunication(store.tasks);
  if (reconciled.some((task, index) => task !== store.tasks[index]))
    await store.updateCommunication(() => reconciled);
  for (const task of usePeerTaskStore.getState().tasks) {
    const question = pendingPeerQuestion(task);
    if (
      question?.state !== "queued" ||
      delivering.has(question.recipient.sessionId) ||
      !activePeerTask(task) ||
      sessionInference(task.targetSessionId)
    )
      continue;
    const recipientId = question.recipient.sessionId;
    if (
      currentWorkspaceWriteLease(task.workspaceId)?.ownerSessionId ===
        task.targetSessionId &&
      isWaitingForWorkspaceWriteLease(task.workspaceId, recipientId)
    ) {
      await blockPeerCommunication(
        task.id,
        "Clarification cannot reach a safe source boundary while that source waits for this task's write lease. Reconcile the task before retrying.",
      );
      continue;
    }
    const sourceChat = getChat(recipientId);
    if (
      sessionInference(recipientId) ||
      sourceChat?.status === "submitted" ||
      sourceChat?.status === "streaming" ||
      peerWaitingSessions.has(recipientId)
    )
      continue;
    const source = useChatStore
      .getState()
      .sessions.find((session) => session.id === recipientId);
    if (
      source?.run?.peerTaskId &&
      usePeerTaskStore
        .getState()
        .tasks.some(
          (item) =>
            item.id === source.run?.peerTaskId && item.status === "running",
        )
    )
      continue;
    if (
      source?.run?.state === "running" &&
      source.run.budget?.phase !== "complete"
    )
      continue;
    if (
      source?.run?.state === "cancelled" ||
      source?.run?.state === "interrupted" ||
      source?.run?.state === "failed"
    )
      continue;
    delivering.add(recipientId);
    try {
      await flushPeerTasks();
      await validateDelivery(question);
      if (!mayWake(recipientId))
        throw new Error(
          "Source permission does not authorize an automatic clarification run.",
        );
      await receipt(task.id, question.id, "delivered");
      await receipt(task.id, question.id, "acknowledged");
      await validateDelivery(question);
      if (
        !usePeerTaskStore
          .getState()
          .tasks.some((item) => item.id === task.id && activePeerTask(item))
      )
        throw new Error("peer_communication_delivery_stale");
      const text = `A child task needs one clarification. Answer only the missing requirement in at most 1000 characters. Do not include unrelated chat history, secrets, hidden reasoning, or instructions to change permissions. If the evidence is insufficient, say so. This reply will be explicitly shared with the assigned child.\n${formatPeerCommunication(question)}`;
      const previousMessages = new Set(
        (getChat(recipientId)?.messages ?? []).map((message) => message.id),
      );
      const replyRun = sendPeerCommunicationToSession(recipientId, text, true, {
        ...question.recipient,
        workspaceId: question.workspaceId,
      });
      const replyGeneration = useChatStore
        .getState()
        .sessions.find((item) => item.id === recipientId)?.run?.startedAt;
      await replyRun;
      await validateDelivery(question);
      const currentSourceRun = useChatStore
        .getState()
        .sessions.find((item) => item.id === recipientId)?.run;
      if (
        !currentSourceRun ||
        currentSourceRun.startedAt !== replyGeneration ||
        ["failed", "cancelled", "interrupted"].includes(currentSourceRun.state)
      )
        throw new Error("peer_communication_reply_generation_changed");
      const messages = getChat(recipientId)?.messages ?? [];
      const last = [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" && !previousMessages.has(message.id),
        );
      const answer = last?.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!answer)
        throw new Error("The source did not provide a clarification response.");
      await persistCompactionSource(recipientId, messages);
      const latest = usePeerTaskStore.getState().tasks;
      const sourceRun = useChatStore
        .getState()
        .sessions.find((item) => item.id === recipientId)?.run;
      const reply = await preparePeerCommunication(
        latest,
        {
          taskId: task.id,
          kind: "clarification-response",
          text: answer,
          evidence: [],
          replyTo: question.id,
        },
        {
          ...question.recipient,
          runStartedAt: sourceRun?.startedAt ?? 0,
          toolCallId: `reply:${question.id}`,
          sourceMessageId: last?.id,
        },
        question.sender,
      );
      await usePeerTaskStore.getState().updateCommunication((tasks) =>
        tasks.map((item) => {
          if (item.id !== task.id) return item;
          if (
            useChatStore
              .getState()
              .sessions.find((session) => session.id === recipientId)?.run
              ?.startedAt !== replyGeneration
          )
            throw new Error("peer_communication_reply_generation_changed");
          const answered = transitionPeerEvent(item, question.id, "answered");
          return {
            ...answered,
            communication: [...(answered.communication ?? []), reply],
          };
        }),
      );
    } catch (error) {
      if (usePeerTaskStore.getState().recoveryReady)
        await blockPeerCommunication(task.id, String(error));
    } finally {
      delivering.delete(recipientId);
    }
  }
}

export async function awaitPeerClarification(
  taskId: string,
): Promise<string | null> {
  const task = usePeerTaskStore
    .getState()
    .tasks.find((item) => item.id === taskId);
  const question =
    task &&
    (pendingPeerQuestion(task) ??
      task.communication?.find(
        (event) =>
          event.kind === "clarification-request" &&
          event.state === "answered" &&
          task.communication?.some(
            (reply) => reply.replyTo === event.id && reply.state === "queued",
          ),
      ));
  if (!task || !question) return null;
  return new Promise<string>((resolve, reject) => {
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        if (!usePeerTaskStore.getState().recoveryReady)
          throw new Error("Peer task persistence requires recovery.");
        const current = usePeerTaskStore
          .getState()
          .tasks.find((item) => item.id === taskId);
        if (!current || !activePeerTask(current))
          throw new Error("Clarification task stopped.");
        if (Date.now() >= question.deadline)
          throw new Error("Clarification deadline exceeded.");
        const reply = current.communication?.find(
          (event) =>
            event.replyTo === question.id &&
            event.kind === "clarification-response",
        );
        if (!reply) return;
        await validateDelivery(reply);
        await receipt(taskId, reply.id, "delivered");
        await receipt(taskId, reply.id, "acknowledged");
        cleanup();
        resolve(formatPeerCommunication(reply));
      } catch (error) {
        cleanup();
        reject(error);
      } finally {
        checking = false;
      }
    };
    const unsubscribe = usePeerTaskStore.subscribe(() => {
      void check();
    });
    const timer = setTimeout(
      () => {
        void check();
      },
      Math.max(1, question.deadline - Date.now()),
    );
    function cleanup() {
      unsubscribe();
      clearTimeout(timer);
    }
    void check();
    void pumpPeerCommunication();
  });
}

export async function receiveQueuedPeerNotes(taskId: string): Promise<string> {
  const recipient = usePeerTaskStore
    .getState()
    .tasks.find((task) => task.id === taskId);
  const notes = usePeerTaskStore
    .getState()
    .tasks.flatMap((task) => task.communication ?? [])
    .filter(
      (event) =>
        event.recipientTaskId === taskId &&
        event.recipient.sessionId === recipient?.targetSessionId &&
        event.state === "queued" &&
        event.kind !== "clarification-request" &&
        event.kind !== "clarification-response",
    );
  const delivered: string[] = [];
  for (const event of notes) {
    await validateDelivery(event);
    await receipt(event.taskId, event.id, "delivered");
    await receipt(event.taskId, event.id, "acknowledged");
    delivered.push(formatPeerCommunication(event));
  }
  return delivered.join("\n");
}
