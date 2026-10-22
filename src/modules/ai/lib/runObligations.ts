import type { UIMessage } from "ai";
import { readAnswer } from "./answerContinuation";
import type { PeerTask } from "./peerTasks";
import type { SessionRun } from "./sessions";
import { type Todo, validateTodos } from "./todos";
import { continuationOnly } from "./toolObjective";

// This is a read-only view of existing sources, NOT a replacement plan or a
// permission/effect authority. The model never supplies a trusted verification.
export type ObligationState =
  | "not-started"
  | "in-progress"
  | "completed-unverified"
  | "verified-complete"
  | "failed"
  | "blocked"
  | "superseded";
export type ValidationCheck = {
  id: string;
  kind: "test" | "build";
  command: string;
  result: "passed-at-execution" | "failed" | "stale-after-write";
};
export type ScopedObligationProof = {
  obligationId: string;
  sessionId: string;
  workspaceId: string;
  runStartedAt: number;
  /** Opaque source/checkout revision captured by an independent verifier. */
  revision: string;
  /** Number of user turns covered by the independent verification. */
  userTurnCount: number;
  passed: boolean;
  source: "trusted-validation";
};
export type ObligationView = {
  id: string;
  title: string;
  state: ObligationState;
  explanation: string;
};
export type RunObligationReport = {
  obligations: ObligationView[];
  writesObserved: number;
  checks: ValidationCheck[];
  toolFailures: { id: string; name: string; reason: string }[];
  peerOutstanding: number;
  peerClaimedComplete: number;
  latestInstruction: string | null;
  laterInstructions: string[];
  unmatchedInstructions: boolean;
  outcome: "verified" | "unfinished" | "blocked" | "unverified";
  terminalReason: string;
};
type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const toolName = (part: ToolPart) =>
  part.type === "dynamic-tool"
    ? part.toolName
    : part.type.startsWith("tool-")
      ? part.type.slice(5)
      : null;
const text = (message: UIMessage) =>
  message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");

/** Recognize only a standalone, unambiguous standard test/build command. */
function checkKind(command: string): "test" | "build" | null {
  const match =
    /^(?:npm(?:\.cmd)?\s+(?:run\s+)?)(test|build)(?:\s+--(?:\s+[\w.-]+)*)?\s*$/i.exec(
      command.trim(),
    );
  return match?.[1]?.toLowerCase() === "test"
    ? "test"
    : match?.[1]?.toLowerCase() === "build"
      ? "build"
      : null;
}
function terminalReason(
  run: SessionRun | undefined,
  last: UIMessage | undefined,
): string {
  if (!run) return "No recorded Agent run; task completion unverified.";
  if (run.state === "cancelled")
    return "User cancelled the run; outstanding work remains.";
  if (run.state === "interrupted")
    return "Run interrupted; partial work preserved, no automatic replay.";
  if (run.state === "failed")
    return `Run failed: ${run.error?.message ?? "see recorded error"}`;
  const answer = last?.role === "assistant" ? readAnswer(last) : null;
  if (answer?.state === "incomplete")
    return answer.reason
      ? `Answer incomplete: ${answer.reason}`
      : "Answer incomplete; its continuation did not finish.";
  if (run.budget?.phase === "hard-limit")
    return `Run budget exhausted: ${run.budget.stopReason ?? "limit"}; no automatic continuation.`;
  if (run.budget?.phase === "soft-limit")
    return `Run paused: ${run.budget.stopReason ?? "continuation requires approval"}; existing continuation policy applies.`;
  if (run.budget?.phase === "auto-continue-pending")
    return "Bounded automatic continuation pending under existing policy.";
  if (run.state === "running") return "Agent run in progress.";
  return `Model response ended (${run.budget?.lastFinishReason || "reason unavailable"}); this is not proof of task completion.`;
}

export function inspectRunObligations(input: {
  sessionId: string;
  workspaceId: string | null | undefined;
  run?: SessionRun;
  todos: readonly Todo[];
  messages: readonly UIMessage[];
  peerTasks?: readonly Pick<
    PeerTask,
    "sourceSessionId" | "workspaceId" | "status" | "createdAt"
  >[];
  /** ONLY the native/independent verifier may provide these; never AI tool input or prose. */
  proofs?: readonly ScopedObligationProof[];
  /** Live native revision witness. Without it even a passing check cannot certify current source. */
  currentRevision?: string;
}): RunObligationReport {
  const { messages, sessionId, workspaceId, run } = input;
  const userTurns = messages.filter((m) => m.role === "user").length;
  const entries = validateTodos([...input.todos])
    ? []
    : input.todos.slice(0, 16);
  let lastAcceptedPlan = -1;
  let lastInstruction = -1;
  let latestInstruction: string | null = null;
  let writesObserved = 0;
  const checks: ValidationCheck[] = [];
  const toolFailures: RunObligationReport["toolFailures"] = [];
  for (const [index, message] of messages.entries()) {
    if (
      message.role === "user" &&
      text(message).trim() &&
      !continuationOnly(text(message))
    ) {
      lastInstruction = index;
      latestInstruction = text(message).trim().slice(0, 800);
    }
    if (message.role !== "assistant") continue;
    for (const [partIndex, part] of (message.parts as ToolPart[]).entries()) {
      const name = toolName(part);
      const output = object(part.output);
      const id = `${message.id}:${partIndex}`;
      if (
        name &&
        (part.state === "output-error" || typeof output?.error === "string")
      ) {
        toolFailures.push({
          id,
          name: name.slice(0, 80),
          reason:
            typeof output?.error === "string"
              ? output.error.slice(0, 240)
              : "Tool result reported an error.",
        });
      }
      if (part.state !== "output-available") continue;
      if (name === "todo_write" && output?.ok === true)
        lastAcceptedPlan = index;
      if (
        name === "write_file" &&
        output?.ok === true &&
        output.clackWorkspaceWrite === true
      ) {
        writesObserved++;
        for (const check of checks)
          if (check.result === "passed-at-execution")
            check.result = "stale-after-write";
      } else if (
        ["edit", "multi_edit", "create_directory"].includes(name ?? "") &&
        !output?.error
      ) {
        for (const check of checks)
          if (check.result === "passed-at-execution")
            check.result = "stale-after-write";
      }
      if (name === "bash_run") {
        const command = object(part.input)?.command;
        if (typeof command !== "string") continue;
        const kind = checkKind(command);
        if (kind && output && typeof output.exit_code === "number") {
          if (output.exit_code !== 0 || output.timed_out !== false)
            toolFailures.push({
              id,
              name: "bash_run",
              reason: `${kind} command did not complete successfully (exit ${output.exit_code}).`,
            });
          checks.push({
            id,
            kind,
            command: command.slice(0, 200),
            result:
              output.exit_code === 0 && output.timed_out === false
                ? "passed-at-execution"
                : "failed",
          });
        }
      }
    }
  }
  const unmatchedInstructions =
    lastAcceptedPlan >= 0 && lastInstruction > lastAcceptedPlan;
  const laterInstructions = unmatchedInstructions
    ? messages
        .slice(lastAcceptedPlan + 1)
        .filter(
          (m) =>
            m.role === "user" && !!text(m).trim() && !continuationOnly(text(m)),
        )
        .map((m) => text(m).trim().slice(0, 800))
        .filter((instruction, i, all) => all.lastIndexOf(instruction) === i)
        .slice(-4)
    : [];
  const peers =
    input.peerTasks?.filter(
      (p) =>
        p.sourceSessionId === sessionId &&
        !!workspaceId &&
        p.workspaceId === workspaceId &&
        (!run || p.createdAt >= run.startedAt),
    ) ?? [];
  const peerOutstanding = peers.filter((p) => p.status !== "completed").length;
  const peerClaimedComplete = peers.filter(
    (p) => p.status === "completed",
  ).length;
  const obligations: ObligationView[] = entries.map((todo) => {
    let state: ObligationState =
      todo.status === "pending"
        ? "not-started"
        : todo.status === "in_progress" || todo.status === "interrupted"
          ? "in-progress"
          : todo.status === "completed"
            ? "completed-unverified"
            : todo.status === "blocked"
              ? "blocked"
              : todo.status === "failed"
                ? "failed"
                : "blocked";
    const proof = input.proofs?.find(
      (p) =>
        p.obligationId === todo.id &&
        p.sessionId === sessionId &&
        !!workspaceId &&
        p.workspaceId === workspaceId &&
        !!run &&
        run.workspaceId === workspaceId &&
        p.runStartedAt === run.startedAt &&
        p.source === "trusted-validation" &&
        p.userTurnCount === userTurns &&
        !!input.currentRevision &&
        p.revision === input.currentRevision,
    );
    if (
      proof?.passed === true &&
      state === "completed-unverified" &&
      !unmatchedInstructions
    )
      state = "verified-complete";
    if (proof?.passed === false) state = "failed";
    const explanation =
      state === "verified-complete"
        ? "Independent check bound to current workspace revision and all user turns."
        : state === "completed-unverified"
          ? "Todo reports completion; current independent validation is unavailable or stale."
          : state === "blocked"
            ? todo.status === "cancelled"
              ? "Todo was cancelled; no authoritative replacement or supersession is established."
              : "Marked blocked in the accepted plan."
            : state === "failed"
              ? "Explicit failure or failed scoped verification."
              : "Still outstanding in the accepted plan.";
    return { id: todo.id, title: todo.title, state, explanation };
  });
  const active = obligations.filter((o) => o.state !== "superseded");
  const outcome: RunObligationReport["outcome"] =
    active.some((o) => o.state === "failed" || o.state === "blocked") ||
    peers.some(
      (p) =>
        p.status === "blocked" ||
        p.status === "failed" ||
        p.status === "cancelled",
    )
      ? "blocked"
      : active.some(
            (o) => o.state === "not-started" || o.state === "in-progress",
          ) || peerOutstanding > 0
        ? "unfinished"
        : active.length > 0 &&
            active.every((o) => o.state === "verified-complete") &&
            peerClaimedComplete === 0 &&
            !unmatchedInstructions
          ? "verified"
          : "unverified";
  return {
    obligations,
    writesObserved,
    checks: checks.slice(-24),
    toolFailures: toolFailures.slice(-8),
    peerOutstanding,
    peerClaimedComplete,
    latestInstruction,
    laterInstructions,
    unmatchedInstructions,
    outcome,
    terminalReason: terminalReason(run, messages[messages.length - 1]),
  };
}
