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
import { promotePeerFinding } from "@/modules/ai/lib/peerKnowledge";

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
    promote_peer_finding: tool({
      description:
        "Propose a bounded excerpt of a completed task result as shared project knowledge. Only your own task endpoints are eligible. Native user approval and evidence verification are always required, including in Full Access. This does not run tests or turn an assumption into a fact automatically.",
      inputSchema: z.object({
        taskId: z.string().min(1),
        excerpt: z.string().min(1).max(2000),
        files: z.array(z.string().min(1).max(1000)).min(1).max(8),
      }),
      execute: async ({ taskId, excerpt, files }) => {
        try {
          if (!sourceSessionId) throw new Error("No source conversation.");
          return await promotePeerFinding(
            sourceSessionId,
            taskId,
            excerpt,
            files,
          );
        } catch (error) {
          return {
            error: String(error),
            code: "peer_finding_promotion_denied",
          };
        }
      },
    }),
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
      description: `Assign a bounded same-workspace task to another persistent Clack conversation for review, a focused question or delegated work using its own agent/model. Task and result appear in both chats; starting another provider run may require user approval. For quick read-only investigation, use a subagent instead.

Available target conversations:
${targets.length > 0 ? targets.join("\n") : "- No eligible peer conversations are currently configured."}

Tasks in this collaboration that may be used as prerequisites:
${dependencyCandidates.length > 0 ? dependencyCandidates.join("\n") : "- No dependency candidates are available. Create a normal peer task without dependencies."}`,
      inputSchema: z.object({
        targetSessionId: z.string().describe("Exact target conversation ID."),
        followUpTo: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Completed owned/performed task ID; review its immutable result or delegate corrections. Adds a prerequisite edge within graph limits; never transfers private transcripts.",
          ),
        kind: z.enum(["delegate", "review", "question"]),
        executionMode: z
          .enum(["read-only", "shared-write", "isolated-worktree"])
          .default("read-only")
          .describe(
            "Read-only blocks mutations; shared-write serializes checkout writes; isolated-worktree requires clean local Git and returns a reviewable patch.",
          ),
        prompt: z
          .string()
          .min(1)
          .max(12_000)
          .describe(
            "Self-contained bounded task; no secrets or hidden reasoning.",
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
            "Workspace file/diff paths; contents snapshotted at task creation.",
          ),
        dependsOn: z
          .array(z.string().min(1))
          .max(PEER_TASK_MAX_DEPENDENCIES)
          .optional()
          .describe(
            "Peer task prerequisites; wait for all to succeed, block on failure or cancellation.",
          ),
      }),
      execute: async ({
        targetSessionId,
        kind,
        executionMode,
        prompt,
        artifactRefs,
        dependsOn,
        followUpTo,
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
          followUpTo,
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
      description: `Cancel an active task in this collaboration; cascade=true also cancels active descendants. Never cancels completed, failed, blocked, sibling or unrelated tasks.

Tasks in this collaboration:
${dependencyCandidates.length > 0 ? dependencyCandidates.join("\n") : "- No cancellable collaboration is active."}`,
      inputSchema: z.object({
        taskId: z.string().min(1).describe("Exact peer task ID."),
        cascade: z
          .boolean()
          .default(false)
          .describe(
            "Also cancel active descendants in this task's subtree.",
          ),
        reason: z
          .string()
          .min(1)
          .max(500)
          .optional()
          .describe("Brief cancellation reason."),
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
