import type { UIMessage } from "ai";
import type { ExecutionRecord } from "@/modules/ai/lib/customToolExecution";
import type { PeerTask } from "@/modules/ai/lib/peerTasks";
import { readActivity } from "@/modules/ai/lib/activityRecord";

// These built-in executors only inspect data; permission categories alone do not prove this.
const readOnlyTools = new Set([
  "read_file",
  "list_directory",
  "grep",
  "glob",
  "request_conversation_evidence",
  "read_agent_output",
  "get_terminal_output",
  "bash_logs",
  "bash_list",
]);
const terminalStates = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

export function replaySafeExecution(
  record: ExecutionRecord,
  task: PeerTask,
  runId: number,
): boolean {
  return (
    record.sessionId === task.targetSessionId &&
    record.workspaceId === task.workspaceId &&
    record.agentId === task.targetAgentId &&
    record.runId === runId &&
    (!record.taskId || record.taskId === task.id) &&
    record.kind === "native" &&
    record.effect === "none" &&
    ["succeeded", "failed", "cancelled", "denied"].includes(record.state)
  );
}

export function replaySafeMessages(
  task: PeerTask,
  messages: UIMessage[],
  runId: number,
  records?: ExecutionRecord[],
): boolean {
  return messages
    .filter((m) => m.role === "assistant")
    .every((message) => {
      const activity = readActivity(
        message,
        task.targetSessionId,
        task.workspaceId,
      );
      return message.parts.every((part, index) => {
        if (part.type === "text" && !part.text.trim()) return true;
        if (part.type === "step-start") return true;
        const receipts =
          activity?.receipts.filter((r) => r.part === index) ?? [];
        const owners = receipts.length
          ? receipts.map((r) => r.owner ?? activity?.owner)
          : [activity?.owner];
        const priorRun =
          receipts.length > 0 &&
          activity?.omitted === 0 &&
          owners.every((owner) => {
            const prefix = `${task.targetSessionId}:`;
            const startedAt = owner?.runId.startsWith(prefix)
              ? Number(owner.runId.slice(prefix.length))
              : NaN;
            return (
              owner &&
              owner.taskId !== task.id &&
              Number.isSafeInteger(startedAt) &&
              startedAt > 0 &&
              startedAt < runId
            );
          });
        if (priorRun) {
          const state = (part as { state?: string }).state;
          return (
            (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) ||
            terminalStates.has(state ?? "")
          );
        }
        if (part.type === "text" || part.type === "reasoning") {
          const receipt = activity?.receipts.find((r) => r.part === index);
          const owner = receipt?.owner ?? activity?.owner;
          return (
            owner?.runId === `${task.targetSessionId}:${runId}` &&
            owner.taskId === task.id
          );
        }
        if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-"))
          return false;
        const tool = part as {
          state?: string;
          toolName?: string;
          output?: unknown;
        };
        const name =
          part.type === "dynamic-tool"
            ? (tool.toolName ?? "")
            : part.type.slice(5);
        if (!terminalStates.has(tool.state ?? "")) return false;
        if (readOnlyTools.has(name)) return true;
        if (!name.startsWith("custom_")) return false;
        // The preliminary UI check cannot authorize execution. The native history check is mandatory.
        if (records === undefined) return true;
        const output = tool.output as { executionId?: string } | undefined;
        return records.some(
          (r) =>
            r.id === output?.executionId &&
            r.toolName === name &&
            replaySafeExecution(r, task, runId),
        );
      });
    });
}
