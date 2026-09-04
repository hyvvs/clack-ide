import { tool } from "ai";
import { z } from "zod";
import { cancelPeerTask, requestPeerTask } from "../lib/peerTaskCoordinator";
import { PEER_TASK_MAX_DEPENDENCIES } from "../lib/peerTasks";
import { useChatStore } from "../store/chatStore";
import { usePeerTaskStore } from "../store/peerTaskStore";
import type { ToolContext } from "./context";

export function buildPeerTaskTools(ctx: ToolContext) {
  const sourceSessionId = ctx.getSessionId();
  const source = useChatStore
    .getState()
    .sessions.find((session) => session.id === sourceSessionId);
  const targets = useChatStore
    .getState()
    .sessions.filter(
      (session) =>
        session.id !== sourceSessionId &&
        session.profile?.workspaceId &&
        session.profile.workspaceId === source?.profile?.workspaceId,
    )
    .map(
      (session) =>
        `- ${session.id}: ${session.title} (agent ${session.profile?.agentId}, model ${session.profile?.modelId}${
          session.run?.state === "running" ? ", busy - task will queue" : ""
        })`,
    );
  const currentTaskId = source?.run?.peerTaskId;
  const currentTask = usePeerTaskStore
    .getState()
    .tasks.find((task) => task.id === currentTaskId);
  const dependencyCandidates = currentTask
    ? usePeerTaskStore
        .getState()
        .tasks.filter((task) => task.rootTaskId === currentTask.rootTaskId)
        .map(
          (task) =>
            `- ${task.id}: ${task.prompt.slice(0, 120)} (${task.status})`,
        )
    : [];

  return {
    request_peer_task: tool({
      description: `Ask another persistent Clack conversation to perform a bounded task in the same workspace. Use this for an independent review, a focused question, or delegated work that benefits from the target chat's own agent and model. The task and result are visible in both conversations. Starting another provider run may require user approval. Do not use this for a quick read-only subagent investigation.

Available target conversations:
${targets.length > 0 ? targets.join("\n") : "- No eligible peer conversations are currently configured."}

Tasks in this collaboration that may be used as prerequisites:
${dependencyCandidates.length > 0 ? dependencyCandidates.join("\n") : "- No dependency candidates are available. Create a normal peer task without dependencies."}`,
      inputSchema: z.object({
        targetSessionId: z.string().describe("Exact target conversation ID."),
        kind: z.enum(["delegate", "review", "question"]),
        executionMode: z
          .enum(["read-only", "shared-write", "isolated-worktree"])
          .default("read-only")
          .describe(
            "Read-only blocks mutation tools. Shared-write serializes mutations in the project checkout. Isolated-worktree requires a clean local Git repository and returns a reviewable patch.",
          ),
        prompt: z
          .string()
          .min(1)
          .max(12_000)
          .describe(
            "Self-contained bounded task. Do not include secrets or hidden reasoning.",
          ),
        artifactRefs: z
          .array(
            z.object({
              kind: z.enum(["file", "diff"]),
              path: z.string().min(1),
            }),
          )
          .max(8)
          .optional()
          .describe(
            "Optional workspace file or diff paths. Clack snapshots their exact contents when the task is created.",
          ),
        dependsOn: z
          .array(z.string().min(1))
          .max(PEER_TASK_MAX_DEPENDENCIES)
          .optional()
          .describe(
            "Optional peer task IDs from this collaboration. This task waits until all listed tasks complete successfully and becomes blocked if one fails or is cancelled.",
          ),
      }),
      execute: async ({
        targetSessionId,
        kind,
        executionMode,
        prompt,
        artifactRefs,
        dependsOn,
      }) => {
        const currentSessionId = ctx.getSessionId();
        if (!currentSessionId) {
          return {
            error: "No source conversation is active.",
            code: "peer_source_missing",
          };
        }
        const result = await requestPeerTask({
          sourceSessionId: currentSessionId,
          targetSessionId,
          kind,
          executionMode,
          prompt,
          artifactRefs,
          dependsOn,
        });
        if (!result.ok) return { error: result.message, code: result.code };
        return {
          taskId: result.task.id,
          status: result.task.status,
          targetSessionId: result.task.targetSessionId,
          result: result.task.result?.summary,
          error: result.task.error,
        };
      },
    }),
    cancel_peer_task: tool({
      description: `Cancel an active peer task in the current collaboration. Set cascade to true to cancel its active descendants as well. Completed, failed, blocked, sibling, and unrelated tasks are not cancelled.

Tasks in this collaboration:
${dependencyCandidates.length > 0 ? dependencyCandidates.join("\n") : "- No cancellable collaboration is active."}`,
      inputSchema: z.object({
        taskId: z.string().min(1).describe("Exact peer task ID."),
        cascade: z
          .boolean()
          .default(false)
          .describe(
            "Cancel active descendants in the selected task's subtree.",
          ),
        reason: z
          .string()
          .min(1)
          .max(500)
          .optional()
          .describe("Brief human-readable reason for the cancellation."),
      }),
      execute: async ({ taskId, cascade, reason }) => {
        const currentSessionId = ctx.getSessionId();
        const liveSession = useChatStore
          .getState()
          .sessions.find((session) => session.id === currentSessionId);
        const liveTask = usePeerTaskStore
          .getState()
          .tasks.find((task) => task.id === liveSession?.run?.peerTaskId);
        if (!liveTask) {
          return {
            error: "Only an active peer task may cancel collaboration work.",
            code: "peer_cancellation_source_missing",
          };
        }
        const result = await cancelPeerTask(taskId, {
          actor: "programmatic",
          cascade,
          reason,
          authorizedRootTaskId: liveTask.rootTaskId,
        });
        if (!result.ok) return { error: result.message, code: result.code };
        return {
          status: result.alreadyTerminal ? "already_terminal" : "cancelled",
          cancelledTaskIds: result.cancelledTaskIds,
          cancelledDescendantCount: result.cancelledDescendantCount,
        };
      },
    }),
  } as const;
}
