import { tool } from "ai";
import { z } from "zod";
import { requestPeerTask } from "../lib/peerTaskCoordinator";
import { useChatStore } from "../store/chatStore";
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

  return {
    request_peer_task: tool({
      description: `Ask another persistent Clack conversation to perform a bounded task in the same workspace. Use this for an independent review, a focused question, or delegated work that benefits from the target chat's own agent and model. The task and result are visible in both conversations. Starting another provider run may require user approval. Do not use this for a quick read-only subagent investigation.

Available target conversations:
${targets.length > 0 ? targets.join("\n") : "- No eligible peer conversations are currently configured."}`,
      inputSchema: z.object({
        targetSessionId: z.string().describe("Exact target conversation ID."),
        kind: z.enum(["delegate", "review", "question"]),
        prompt: z
          .string()
          .min(1)
          .max(12_000)
          .describe("Self-contained bounded task. Do not include secrets or hidden reasoning."),
        artifactRefs: z
          .array(
            z.object({
              kind: z.enum(["file", "diff"]),
              path: z.string().min(1),
            }),
          )
          .max(20)
          .optional()
          .describe("Optional workspace file or diff paths; contents are not copied."),
      }),
      execute: async ({ targetSessionId, kind, prompt, artifactRefs }) => {
        const currentSessionId = ctx.getSessionId();
        if (!currentSessionId) {
          return { error: "No source conversation is active.", code: "peer_source_missing" };
        }
        const result = await requestPeerTask({
          sourceSessionId: currentSessionId,
          targetSessionId,
          kind,
          prompt,
          artifactRefs,
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
  } as const;
}
