import type { AgentPermissionMode } from "@/modules/ai/lib/permissions";

export const AGENT_SOFT_STEP_LIMIT = 24;
export const AGENT_HARD_STEP_LIMIT = 240;
export const AGENT_MAX_AUTO_CONTINUATIONS = 9;
export const REPEATED_FAILURE_LIMIT = 3;

export type RunBudgetPhase =
  | "running"
  | "soft-limit"
  | "auto-continue-pending"
  | "hard-limit"
  | "complete";

export type RunBudgetStopReason =
  | "total-steps"
  | "continuations"
  | "repeated-failure";

export type RunBudgetState = {
  softStepLimit: number;
  hardStepLimit: number;
  autoContinue: boolean;
  maxAutoContinuations: number;
  totalSteps: number;
  continuationCount: number;
  peerTaskCount: number;
  phase: RunBudgetPhase;
  stopReason: RunBudgetStopReason | null;
  lastFinishReason: string;
  continuationPromptPending: boolean;
};

export type RunBatchResult = {
  steps: number;
  hitSoftLimit: boolean;
  finishReason: string;
  repeatedFailureDetected?: boolean;
};

export type RunStepObservation = {
  toolName: string;
  input: unknown;
  output: unknown;
  failed: boolean;
};

export type RunLoopTracker = {
  failureFingerprint: string | null;
  repeatCount: number;
  detected: boolean;
};

export function autoContinueForPermissionMode(
  mode: AgentPermissionMode,
): boolean {
  return mode === "trusted-workspace" || mode === "full-access";
}

export function createRunBudget(mode: AgentPermissionMode): RunBudgetState {
  return {
    softStepLimit: AGENT_SOFT_STEP_LIMIT,
    hardStepLimit: AGENT_HARD_STEP_LIMIT,
    autoContinue: autoContinueForPermissionMode(mode),
    maxAutoContinuations: AGENT_MAX_AUTO_CONTINUATIONS,
    totalSteps: 0,
    continuationCount: 0,
    peerTaskCount: 0,
    phase: "running",
    stopReason: null,
    lastFinishReason: "",
    continuationPromptPending: false,
  };
}

export function normalizeRunBudget(
  value: RunBudgetState | undefined,
  mode: AgentPermissionMode,
): RunBudgetState {
  const defaults = createRunBudget(mode);
  if (!value) return defaults;
  return {
    ...defaults,
    ...value,
    autoContinue: autoContinueForPermissionMode(mode),
  };
}

export function recordRunBatch(
  current: RunBudgetState,
  result: RunBatchResult,
  mode: AgentPermissionMode,
): RunBudgetState {
  const next: RunBudgetState = {
    ...current,
    autoContinue: autoContinueForPermissionMode(mode),
    totalSteps: current.totalSteps + Math.max(0, result.steps),
    lastFinishReason: result.finishReason,
    continuationPromptPending: false,
  };

  if (result.repeatedFailureDetected) {
    return {
      ...next,
      phase: "hard-limit",
      stopReason: "repeated-failure",
    };
  }

  if (!result.hitSoftLimit) {
    return { ...next, phase: "complete", stopReason: null };
  }

  if (next.totalSteps >= next.hardStepLimit) {
    return { ...next, phase: "hard-limit", stopReason: "total-steps" };
  }

  if (next.continuationCount >= next.maxAutoContinuations) {
    return { ...next, phase: "hard-limit", stopReason: "continuations" };
  }

  return {
    ...next,
    phase: next.autoContinue ? "auto-continue-pending" : "soft-limit",
    stopReason: null,
  };
}

export function consumeAutoContinuation(
  current: RunBudgetState,
): RunBudgetState | null {
  if (current.phase !== "auto-continue-pending") return null;
  return {
    ...current,
    continuationCount: current.continuationCount + 1,
    phase: "running",
    stopReason: null,
    continuationPromptPending: true,
  };
}

export function resumeRunBudget(
  current: RunBudgetState,
  allowHardLimit: boolean,
): RunBudgetState | null {
  const isSoftLimit = current.phase === "soft-limit";
  const isHardLimit = current.phase === "hard-limit";
  if (!isSoftLimit && !(allowHardLimit && isHardLimit)) return null;

  const extendingHardLimit = isHardLimit && allowHardLimit;
  return {
    ...current,
    hardStepLimit: extendingHardLimit
      ? current.totalSteps + AGENT_HARD_STEP_LIMIT
      : current.hardStepLimit,
    maxAutoContinuations: extendingHardLimit
      ? current.continuationCount + AGENT_MAX_AUTO_CONTINUATIONS
      : current.maxAutoContinuations,
    continuationCount: current.continuationCount + 1,
    phase: "running",
    stopReason: null,
    continuationPromptPending: true,
  };
}

export function startRunBatch(current: RunBudgetState): {
  budget: RunBudgetState;
  isLogicalContinuation: boolean;
} {
  return {
    budget: {
      ...current,
      phase: "running",
      continuationPromptPending: false,
    },
    isLogicalContinuation: current.continuationPromptPending,
  };
}

export function createRunLoopTracker(): RunLoopTracker {
  return { failureFingerprint: null, repeatCount: 0, detected: false };
}

export function observeRunStep(
  current: RunLoopTracker,
  observation: RunStepObservation,
): RunLoopTracker {
  if (!observation.failed) return createRunLoopTracker();
  const fingerprint = stableFingerprint({
    toolName: observation.toolName,
    input: observation.input,
    output: observation.output,
  });
  const repeatCount =
    fingerprint === current.failureFingerprint ? current.repeatCount + 1 : 1;
  return {
    failureFingerprint: fingerprint,
    repeatCount,
    detected: repeatCount >= REPEATED_FAILURE_LIMIT,
  };
}

export function describeRunBudgetStop(budget: RunBudgetState): string {
  if (budget.stopReason === "repeated-failure") {
    return `Clack stopped after detecting the same failing tool call ${REPEATED_FAILURE_LIMIT} times. ${budget.totalSteps} total steps and ${budget.continuationCount} continuations were used.`;
  }
  if (budget.stopReason === "continuations") {
    return `Clack reached its continuation ceiling after ${budget.totalSteps} total steps and ${budget.continuationCount} continuations.`;
  }
  return `Clack reached its autonomous ceiling after ${budget.totalSteps} total steps and ${budget.continuationCount} continuations.`;
}

function stableFingerprint(value: unknown): string {
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object") return item;
    if (seen.has(item)) return "[circular]";
    seen.add(item);
    if (Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
  });
  return (serialized ?? String(value)).slice(0, 8_192);
}
