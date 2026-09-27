import { z } from "zod";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";

export const PEER_COMMUNICATION_POLICY = 1;
export const PEER_COMMUNICATION_ENABLED = true;
export const PEER_MESSAGE_BYTES = 4096;
export const PEER_EVENTS_PER_TASK = 32;
export const PEER_QUESTION_ROUNDS = 2;
export const PEER_ROOT_QUESTION_ROUNDS = 4;
export const PEER_QUESTION_LIFETIME = 10 * 60 * 1000;
export const peerMessageKinds = [
  "clarification-request",
  "clarification-response",
  "finding",
  "blocker",
  "review-request",
  "review-response",
  "dependency-update",
  "note",
] as const;
const id = z.string().min(1).max(256);
const stamp = z
  .object({
    sessionId: id,
    agentId: id,
    modelId: id,
    policyRevision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const eventSchema = z
  .object({
    id,
    taskId: id,
    recipientTaskId: id,
    rootTaskId: id,
    workspaceId: id,
    parentTaskId: id.nullable(),
    policyVersion: z.literal(1),
    sender: stamp,
    recipient: stamp,
    runStartedAt: z.number().nonnegative(),
    sequence: z.number().int().positive(),
    kind: z.enum(peerMessageKinds),
    text: z.string().min(1).max(PEER_MESSAGE_BYTES),
    evidence: z
      .array(
        z
          .object({
            taskId: id,
            artifactId: id,
            contentHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(8),
    replyTo: id.optional(),
    sourceMessageId: id.optional(),
    toolCallId: id,
    createdAt: z.number().nonnegative(),
    deadline: z.number().nonnegative(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum([
      "queued",
      "delivered",
      "acknowledged",
      "answered",
      "cancelled",
      "blocked",
    ]),
    deliveredAt: z.number().nonnegative().optional(),
    acknowledgedAt: z.number().nonnegative().optional(),
    detail: z.string().max(500).optional(),
  })
  .strict();
export type PeerCommunicationEvent = z.infer<typeof eventSchema>;
export type PeerEndpoint = PeerCommunicationEvent["sender"];
export type PeerCommunicationInput = Pick<
  PeerCommunicationEvent,
  "kind" | "text" | "replyTo" | "evidence"
> & { taskId: string; recipientTaskId?: string };
export type PeerCommunicationActor = PeerEndpoint & {
  runStartedAt: number;
  toolCallId: string;
  sourceMessageId?: string;
};

export async function communicationDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(value, (_key, item: unknown) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          )
        : item,
    ),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function communicationPayload(event: PeerCommunicationEvent) {
  const {
    state: _state,
    deliveredAt: _delivered,
    acknowledgedAt: _ack,
    detail: _detail,
    digest: _digest,
    ...payload
  } = event;
  return payload;
}

export function parsePeerCommunication(
  value: unknown,
): PeerCommunicationEvent[] {
  const events = z.array(eventSchema).max(PEER_EVENTS_PER_TASK).parse(value);
  const ids = new Set<string>();
  for (const [index, event] of events.entries()) {
    if (
      event.sequence !== index + 1 ||
      ids.has(event.id) ||
      new TextEncoder().encode(event.text).length > PEER_MESSAGE_BYTES ||
      event.deadline !== event.createdAt + PEER_QUESTION_LIFETIME
    ) {
      throw new Error("peer_communication_corrupt");
    }
    ids.add(event.id);
  }
  return events;
}

export function activePeerTask(task: PeerTask): boolean {
  return (
    task.status === "running" ||
    task.status === "waiting" ||
    task.status === "queued"
  );
}

export function permitsPeerEvent(
  task: PeerTask,
  kind: PeerCommunicationEvent["kind"],
): boolean {
  return (
    activePeerTask(task) ||
    (task.status === "completed" &&
      kind !== "clarification-request" &&
      kind !== "clarification-response")
  );
}

export function pendingPeerQuestion(
  task: PeerTask,
): PeerCommunicationEvent | undefined {
  return task.communication?.find(
    (event) =>
      event.kind === "clarification-request" &&
      (event.state === "queued" ||
        event.state === "delivered" ||
        event.state === "acknowledged"),
  );
}

export function routePeerCommunication(
  tasks: readonly PeerTask[],
  input: PeerCommunicationInput,
  actor: PeerCommunicationActor,
) {
  const task = tasks.find((item) => item.id === input.taskId);
  const recipientTask = tasks.find(
    (item) => item.id === (input.recipientTaskId ?? input.taskId),
  );
  if (!task || !recipientTask || !permitsPeerEvent(task, input.kind))
    throw new Error("peer_communication_task_inactive");
  const fromTarget =
    actor.sessionId === task.targetSessionId &&
    actor.agentId === task.targetAgentId &&
    actor.modelId === task.targetModelId;
  const fromSource =
    actor.sessionId === task.sourceSessionId &&
    actor.agentId === task.sourceAgentId &&
    actor.modelId === task.sourceModelId;
  if (!fromTarget && !fromSource)
    throw new Error("peer_communication_sender_denied");
  if (
    task.workspaceId !== recipientTask.workspaceId ||
    task.rootTaskId !== recipientTask.rootTaskId
  )
    throw new Error("peer_communication_workspace_denied");
  let sessionId: string;
  if (recipientTask.id === task.id) {
    sessionId = fromTarget ? task.sourceSessionId : task.targetSessionId;
  } else {
    const related =
      task.parentTaskId === recipientTask.id ||
      recipientTask.parentTaskId === task.id ||
      recipientTask.dependsOn.includes(task.id);
    if (!fromTarget || !related || !activePeerTask(recipientTask))
      throw new Error("peer_communication_route_denied");
    sessionId = recipientTask.targetSessionId;
  }
  if (sessionId === actor.sessionId)
    throw new Error("peer_communication_self_route");
  if (
    input.kind === "clarification-request" &&
    (!fromTarget || recipientTask.id !== task.id)
  )
    throw new Error("peer_clarification_route_denied");
  for (const evidence of input.evidence) {
    const source = tasks.find((item) => item.id === evidence.taskId);
    // Only evidence already owned by the addressed task crosses this boundary.
    if (!source || source.id !== task.id)
      throw new Error("peer_communication_evidence_denied");
    const artifact = [
      ...source.artifactRefs,
      ...(source.result?.artifacts ?? []),
    ].find((item) => item.id === evidence.artifactId);
    if (
      !artifact ||
      artifact.workspaceId !== task.workspaceId ||
      artifact.contentRef.contentHash !== evidence.contentHash ||
      artifact.accessPolicy !== "model-input"
    )
      throw new Error("peer_communication_evidence_missing");
  }
  const recipientIdentity =
    sessionId === recipientTask.sourceSessionId
      ? {
          agentId: recipientTask.sourceAgentId,
          modelId: recipientTask.sourceModelId,
        }
      : {
          agentId: recipientTask.targetAgentId,
          modelId: recipientTask.targetModelId,
        };
  return { task, recipientTask, sessionId, recipientIdentity };
}

export async function preparePeerCommunication(
  tasks: readonly PeerTask[],
  input: PeerCommunicationInput,
  actor: PeerCommunicationActor,
  recipient: PeerEndpoint,
  now = Date.now(),
): Promise<PeerCommunicationEvent> {
  if (
    !input.text.trim() ||
    new TextEncoder().encode(input.text.trim()).length > PEER_MESSAGE_BYTES ||
    new Set(input.evidence.map((item) => `${item.taskId}:${item.artifactId}`))
      .size !== input.evidence.length
  )
    throw new Error("peer_communication_payload_invalid");
  const { task, recipientTask, sessionId, recipientIdentity } =
    routePeerCommunication(tasks, input, actor);
  if (
    recipient.sessionId !== sessionId ||
    recipient.agentId !== recipientIdentity.agentId ||
    recipient.modelId !== recipientIdentity.modelId
  )
    throw new Error("peer_communication_recipient_denied");
  const events = task.communication ?? [];
  const duplicate = events.find(
    (event) =>
      event.sender.sessionId === actor.sessionId &&
      event.toolCallId === actor.toolCallId,
  );
  if (duplicate) {
    if (
      duplicate.kind !== input.kind ||
      duplicate.runStartedAt !== actor.runStartedAt ||
      duplicate.text !== input.text.trim() ||
      duplicate.replyTo !== input.replyTo ||
      JSON.stringify(duplicate.evidence) !== JSON.stringify(input.evidence) ||
      duplicate.recipientTaskId !== recipientTask.id
    )
      throw new Error("peer_communication_identity_conflict");
    return duplicate;
  }
  if (events.length >= PEER_EVENTS_PER_TASK)
    throw new Error("peer_communication_event_limit");
  if (input.kind === "clarification-request") {
    const rounds = events.filter((event) => event.kind === input.kind);
    const rootRounds = tasks
      .filter((item) => item.rootTaskId === task.rootTaskId)
      .flatMap((item) => item.communication ?? [])
      .filter((event) => event.kind === input.kind);
    if (pendingPeerQuestion(task))
      throw new Error("peer_clarification_outstanding");
    if (
      rounds.length >= PEER_QUESTION_ROUNDS ||
      rootRounds.length >= PEER_ROOT_QUESTION_ROUNDS
    )
      throw new Error("peer_clarification_round_limit");
    if (
      rounds.some(
        (event) =>
          event.text.toLowerCase().replace(/\s+/g, " ") ===
          input.text.trim().toLowerCase().replace(/\s+/g, " "),
      )
    )
      throw new Error("peer_clarification_no_progress");
  }
  if (input.replyTo) {
    const question = events.find((event) => event.id === input.replyTo);
    if (
      !question ||
      question.recipient.sessionId !== actor.sessionId ||
      question.sender.sessionId !== recipient.sessionId ||
      question.state !== "acknowledged" ||
      now >= question.deadline ||
      (input.kind === "clarification-response" &&
        question.kind !== "clarification-request") ||
      (input.kind === "review-response" && question.kind !== "review-request")
    )
      throw new Error("peer_communication_reply_stale");
  } else if (
    input.kind === "clarification-response" ||
    input.kind === "review-response"
  )
    throw new Error("peer_communication_reply_required");
  const payload = {
    id: crypto.randomUUID(),
    taskId: task.id,
    recipientTaskId: recipientTask.id,
    rootTaskId: task.rootTaskId,
    workspaceId: task.workspaceId,
    parentTaskId: task.parentTaskId,
    policyVersion: PEER_COMMUNICATION_POLICY,
    sender: {
      sessionId: actor.sessionId,
      agentId: actor.agentId,
      modelId: actor.modelId,
      policyRevision: actor.policyRevision,
    },
    recipient,
    runStartedAt: actor.runStartedAt,
    ...(actor.sourceMessageId
      ? { sourceMessageId: actor.sourceMessageId }
      : {}),
    toolCallId: actor.toolCallId,
    sequence: events.length + 1,
    kind: input.kind,
    text: input.text.trim(),
    evidence: input.evidence,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    createdAt: now,
    deadline: now + PEER_QUESTION_LIFETIME,
  };
  return eventSchema.parse({
    ...payload,
    digest: await communicationDigest(payload),
    state: "queued",
  });
}

export function transitionPeerEvent(
  task: PeerTask,
  eventId: string,
  state: PeerCommunicationEvent["state"],
  now = Date.now(),
  detail?: string,
): PeerTask {
  const event = task.communication?.find((item) => item.id === eventId);
  if (!event) throw new Error("peer_communication_missing");
  if (event.state === state) return task;
  const allowed =
    state === "cancelled" ||
    state === "blocked" ||
    (event.state === "queued" && state === "delivered") ||
    (event.state === "delivered" && state === "acknowledged") ||
    (event.state === "acknowledged" && state === "answered");
  if (
    !permitsPeerEvent(task, event.kind) ||
    ["cancelled", "blocked", "answered"].includes(event.state) ||
    !allowed
  )
    throw new Error("peer_communication_transition_stale");
  return {
    ...task,
    updatedAt: now,
    communication: task.communication?.map((item) =>
      item.id !== eventId
        ? item
        : {
            ...item,
            state,
            ...(state === "delivered" ? { deliveredAt: now } : {}),
            ...(state === "acknowledged" ? { acknowledgedAt: now } : {}),
            ...(detail ? { detail: detail.slice(0, 500) } : {}),
          },
    ),
  };
}

export function reconcilePeerCommunication(
  tasks: readonly PeerTask[],
  now = Date.now(),
  restarted = false,
): PeerTask[] {
  return tasks.map((task) => {
    const pending = task.communication?.filter(
      (event) =>
        event.state === "queued" ||
        event.state === "delivered" ||
        (event.state === "acknowledged" &&
          event.kind === "clarification-request"),
    );
    if (!pending?.length) return task;
    const expired = pending.some((event) => now >= event.deadline);
    const stop =
      pending.some((event) => !permitsPeerEvent(task, event.kind)) ||
      restarted ||
      expired;
    if (!stop) return task;
    const detail = restarted
      ? "Communication interrupted. Reconcile the task before authorizing another run."
      : expired
        ? "Clarification deadline exceeded."
        : "The task is no longer active.";
    return {
      ...task,
      ...(activePeerTask(task) &&
      pending.some((event) => event.kind === "clarification-request")
        ? {
            status: "blocked" as const,
            endedAt: now,
            error: { code: "peer_communication_blocked", message: detail },
          }
        : {}),
      communication: task.communication?.map((event) =>
        pending.includes(event)
          ? {
              ...event,
              state:
                task.status === "cancelled"
                  ? ("cancelled" as const)
                  : ("blocked" as const),
              detail,
            }
          : event,
      ),
    };
  });
}

export function formatPeerCommunication(event: PeerCommunicationEvent): string {
  return JSON.stringify({
    type: "task-communication",
    id: event.id,
    taskId: event.taskId,
    sender: event.sender,
    kind: event.kind,
    text: event.text,
    evidence: event.evidence,
    replyTo: event.replyTo,
    sourceMessageId: event.sourceMessageId,
    digest: event.digest,
  });
}
