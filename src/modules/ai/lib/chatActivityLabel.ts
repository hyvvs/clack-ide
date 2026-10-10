import type { AgentMeta } from "@/modules/ai/store/chatStore";
import type { SessionRun } from "@/modules/ai/lib/sessions";

export function chatActivityLabel(
  run?: SessionRun,
  meta?: Pick<AgentMeta, "status" | "step">,
): string {
  if (run?.state === "interrupted") return "Interrupted";
  if (run?.state === "cancelled") return "Stopped";
  if (run?.state === "failed") return "Failed";
  if (run?.state === "completed") return "Done";
  if (run?.budget?.phase === "soft-limit") return "Waiting for continuation";
  if (run?.budget?.phase === "hard-limit") return "Run limit reached";
  if (meta?.status === "awaiting-approval") return "Awaiting approval";
  if (meta?.status === "retrying") return "Retrying";
  if (meta?.status === "error") return "Blocked";
  if (meta?.step?.includes("request_peer_task")) return "Assigning work";
  if (/read_file|grep|glob|list_directory/.test(meta?.step ?? ""))
    return "Reading workspace evidence";
  if (meta?.step) return "Running a tool";
  if (meta?.status === "streaming") return "Generating response";
  return run?.state === "running" ? "Preparing response" : "Ready";
}
