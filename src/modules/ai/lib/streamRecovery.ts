import type { UIMessage } from "ai";
import type { SessionRun } from "@/modules/ai/lib/sessions";
import { readAnswer } from "@/modules/ai/lib/answerContinuation";
import type { ExecutionRecord } from "@/modules/ai/lib/customToolExecution";

export function recoveryAvailability(
  run: SessionRun | undefined,
  messages: UIMessage[],
  sessionId: string,
): { allowed: boolean; partial: boolean; reason: string } {
  const denied = (reason: string) => ({
    allowed: false,
    partial: false,
    reason,
  });
  if (!run || (run.state !== "failed" && run.state !== "interrupted"))
    return denied("This run is not interrupted.");
  if (run.error?.kind === "watchdog" || messages.slice(-1).some(m => readAnswer(m)?.watchdog))
    return denied("A watchdog stopped this run. Send a new instruction; partial output and completed effects are preserved.");
  if ((run.recoveryAttempts ?? 0) >= 1)
    return denied(
      "Explicit recovery exhausted. Send a new instruction without replaying prior effects.",
    );
  if (
    !run.budget ||
    run.budget.totalSteps + 1 >= run.budget.hardStepLimit ||
    run.budget.phase === "hard-limit"
  )
    return denied("The existing run budget is exhausted.");
  if (run.peerTaskId)
    return denied("Recover this delegated task through its task owner.");
  const tail: UIMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && messages[i].role !== "user"; i--)
    tail.unshift(messages[i]);
  if (
    tail.some(
      (m) =>
        m.parts.some(
          (p) => p.type === "dynamic-tool" || p.type.startsWith("tool-"),
        ) || readAnswer(m)?.segments.some((s) => s.pending.length),
    )
  )
    return denied(
      "Tool state requires reconciliation. No call or approval will be replayed; send a new, explicitly authorized instruction.",
    );
  if (tail.some((m) => m.parts.some((p) => p.type === "reasoning" && p.text)))
    return denied(
      "Reasoning already streamed. Exact reasoning resume is unavailable; send a new instruction.",
    );
  const partial = tail.some((m) =>
    m.parts.some((p) => p.type === "text" && p.text.length > 0),
  );
  if (
    partial &&
    readAnswer(tail[tail.length - 1])?.runId !== `${sessionId}:${run.startedAt}`
  )
    return denied(
      "Partial answer provenance is unavailable. Send a new instruction.",
    );
  if (
    run.error &&
    [
      "authentication",
      "authorization",
      "quota",
      "bad_request",
      "tool",
      "internal",
      "model_not_found",
    ].includes(run.error.kind)
  )
    return denied(
      "Resolve the reported issue and send a new instruction. The existing answer remains preserved.",
    );
  return {
    allowed: true,
    partial,
    reason: partial
      ? "New generation from the preserved answer, not an exact resume."
      : "Retry the same captured request.",
  };
}

export function unresolvedExecution(
  records: ExecutionRecord[],
  runId: number,
): boolean {
  // Even a completed read must not be replayed by a retry of its original task.
  return records.some((record) => record.runId === runId);
}
