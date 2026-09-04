import type { UIMessage } from "@ai-sdk/react";
import type { AttachmentMessageReference } from "./attachmentMessages";
import {
  collectPeerTaskAttachmentReferences,
  peerTaskArtifactToMessagePart,
} from "./peerTaskArtifacts";
import type {
  PeerTask,
  PeerTaskExecutionMode,
  PeerTaskKind,
} from "./peerTasks";
import type { SessionMeta } from "./sessions";

export type DelegationArtifactChoice = {
  reference: AttachmentMessageReference;
  originLabel: string;
};

export function eligibleDelegationTargets(
  sessions: readonly SessionMeta[],
  sourceSessionId: string,
): SessionMeta[] {
  const source = sessions.find((session) => session.id === sourceSessionId);
  const workspaceId = source?.profile?.workspaceId;
  if (!workspaceId) return [];

  return sessions
    .filter(
      (session) =>
        session.id !== sourceSessionId &&
        session.profile?.workspaceId === workspaceId &&
        Boolean(session.profile.agentId && session.profile.modelId),
    )
    .sort((left, right) => {
      const leftBusy = left.run?.state === "running" ? 1 : 0;
      const rightBusy = right.run?.state === "running" ? 1 : 0;
      return leftBusy - rightBusy || right.updatedAt - left.updatedAt;
    });
}

export function delegationTargetStatus(session: SessionMeta): string {
  return session.run?.state === "running" ? "Running, will queue" : "Idle";
}

export function collectDelegationArtifactChoices(
  messages: readonly UIMessage[],
  tasks: readonly PeerTask[],
  sourceSessionId: string,
): DelegationArtifactChoice[] {
  const choices = new Map<string, DelegationArtifactChoice>();
  for (const reference of collectPeerTaskAttachmentReferences(messages)) {
    choices.set(reference.contentId, {
      reference,
      originLabel: "From this chat",
    });
  }

  for (const task of tasks) {
    if (
      task.sourceSessionId !== sourceSessionId &&
      task.targetSessionId !== sourceSessionId
    ) {
      continue;
    }
    for (const artifact of task.result?.artifacts ?? []) {
      const reference = peerTaskArtifactToMessagePart(artifact).data;
      if (choices.has(reference.contentId)) continue;
      choices.set(reference.contentId, {
        reference,
        originLabel: "Returned by another agent",
      });
    }
  }

  return [...choices.values()];
}

export function selectedDelegationArtifacts(
  choices: readonly DelegationArtifactChoice[],
  selectedContentIds: ReadonlySet<string>,
): AttachmentMessageReference[] {
  return choices
    .filter((choice) => selectedContentIds.has(choice.reference.contentId))
    .map((choice) => choice.reference);
}

export function buildDelegationRequest(input: {
  sourceSessionId: string;
  targetSessionId: string;
  kind: PeerTaskKind;
  executionMode: PeerTaskExecutionMode;
  prompt: string;
  choices: readonly DelegationArtifactChoice[];
  selectedContentIds: ReadonlySet<string>;
}) {
  return {
    sourceSessionId: input.sourceSessionId,
    targetSessionId: input.targetSessionId,
    kind: input.kind,
    executionMode: input.executionMode,
    prompt: input.prompt,
    attachmentReferences: selectedDelegationArtifacts(
      input.choices,
      input.selectedContentIds,
    ),
    awaitCompletion: false,
  } as const;
}

export function delegationStatusLabel(task: PeerTask): string {
  if (task.status === "waiting") return "Waiting";
  if (task.status === "queued") return "Queued";
  if (task.status === "running") return "Working";
  if (task.status === "failed") return "Failed";
  if (task.status === "cancelled") return "Cancelled";
  if (task.status === "blocked") return "Blocked";
  if (task.changeSet?.patch && !task.changeSet.appliedAt)
    return "Changes ready";
  if (task.kind === "review") return "Review complete";
  return "Completed";
}

export function delegationCardTitle(
  task: PeerTask,
  viewingSource: boolean,
  sourceAgentName: string,
  targetAgentName: string,
): string {
  if (!viewingSource) return `Delegated by ${sourceAgentName}`;
  if (task.status === "waiting") return `${targetAgentName} is waiting`;
  if (task.status === "queued") return `${targetAgentName} is queued`;
  if (task.status === "running") return `${targetAgentName} is working`;
  if (task.status === "failed") return `${targetAgentName} failed`;
  if (task.status === "cancelled") return "Delegated task cancelled";
  if (task.status === "blocked") return `${targetAgentName} is blocked`;
  if (task.changeSet?.patch && !task.changeSet.appliedAt) {
    return "Changes ready to review";
  }
  if (task.kind === "review") return "Review complete";
  return `${targetAgentName} completed the task`;
}
