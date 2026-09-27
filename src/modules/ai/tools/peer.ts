import { tool } from "ai";
import { z } from "zod";
import { cancelPeerTask, requestPeerTask } from "../lib/peerTaskCoordinator";
import { PEER_TASK_MAX_DEPENDENCIES } from "../lib/peerTasks";
import { useChatStore } from "../store/chatStore";
import { usePeerTaskStore } from "../store/peerTaskStore";
import type { ToolContext } from "./context";
import { peerMessageKinds } from "@/modules/ai/lib/peerCommunication";
import {
  blockPeerCommunication,
  sendPeerCommunication,
} from "@/modules/ai/lib/peerCommunicationCoordinator";
import { peerWaitingSessions } from "@/modules/ai/lib/peerCommunicationRuntime";

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
  const capturedRunStartedAt = source?.run?.startedAt;
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
    communicate_peer_task: tool({
      description: `Send a bounded task-scoped note or ask the source to clarify your current task. Clarification yields your run until the source answers; do not repeat the question. Only explicit task endpoints, parent/child edges and dependency producer-to-consumer edges are allowed. No full transcripts, secrets or hidden reasoning. Evidence must already belong to the addressed task. Current task: ${currentTaskId ?? "none"}.`,
      inputSchema: z.object({
        taskId: z.string().min(1),
        recipientTaskId: z.string().min(1).optional(),
        kind: z.enum(peerMessageKinds),
        text: z.string().min(1).max(4096),
        replyTo: z.string().optional(),
        evidence: z
          .array(
            z.object({
              taskId: z.string(),
              artifactId: z.string(),
              contentHash: z.string().regex(/^[a-f0-9]{64}$/),
            }),
          )
          .max(8)
          .default([]),
      }),
      execute: async (input, options) => {
        try {
          if (!sourceSessionId || capturedRunStartedAt === undefined)
            throw new Error("No active communication run.");
          return await sendPeerCommunication(
            sourceSessionId,
            capturedRunStartedAt,
            options.toolCallId,
            input,
          );
        } catch (error) {
          const message = String(error);
          if (
            sourceSessionId &&
            input.taskId === currentTaskId &&
            /round_limit|no_progress|event_limit/.test(message)
          ) {
            peerWaitingSessions.add(sourceSessionId);
            await blockPeerCommunication(input.taskId, message);
          }
          return { code: "peer_communication_denied", error: message };
        }
      },
    }),
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
          awaitCompletion: false,
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
