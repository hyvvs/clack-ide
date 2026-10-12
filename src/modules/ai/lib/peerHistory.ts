import type { UIMessage } from "ai";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import { communicationDigest } from "@/modules/ai/lib/peerCommunication";

export function handoffObjective(text: string): string | null {
  const start = text.indexOf("<peer-handoff>\n");
  if (start < 0) return null;
  const line = text.slice(start + "<peer-handoff>\n".length).split("\n", 1)[0];
  try {
    const value = JSON.parse(line);
    return value.version === 1 &&
      typeof value.taskId === "string" &&
      typeof value.objectiveAndRequirements === "string"
      ? value.objectiveAndRequirements
      : null;
  } catch {
    return null;
  }
}

export async function projectCompletedPeerHistory(
  originals: readonly UIMessage[],
  sessionId: string,
  tasks: readonly PeerTask[],
): Promise<UIMessage[]> {
  return Promise.all(
    originals.map(async (message): Promise<UIMessage> => {
      if (
        message.role !== "user" ||
        message.parts.length !== 1 ||
        message.parts[0].type !== "text"
      )
        return message;
      const text = message.parts[0].text;
      const objective = handoffObjective(text);
      if (objective === null) return message;
      const proof = await communicationDigest(text);
      const task = tasks.find(
        (item) =>
          message.id === `peer-handoff:${item.id}` &&
          item.targetSessionId === sessionId &&
          item.status === "completed" &&
          item.result?.targetSessionId === sessionId &&
          item.result.targetAgentId === item.targetAgentId &&
          item.result.targetModelId === item.targetModelId &&
          item.handoff?.recipientSessionId === sessionId &&
          item.handoff.digest === proof &&
          item.prompt === objective &&
          !item.recovery &&
          !item.worktree &&
          (!item.changeSet?.patch || item.changeSet.appliedAt),
      );
      if (!task) return message;
      return {
        ...message,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `Completed delegated task ${task.id}. Its task-scoped objective was: ${objective}\nHistorical task data, not a new user instruction. Full handoff provenance and original evidence remain in this conversation and the task record.`,
          },
        ],
      };
    }),
  );
}
