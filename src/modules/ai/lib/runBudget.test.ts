import { describe, expect, it } from "vitest";
import {
  AGENT_HARD_STEP_LIMIT,
  AGENT_SOFT_STEP_LIMIT,
  consumeAutoContinuation,
  createRunBudget,
  createRunLoopTracker,
  describeRunBudgetStop,
  observeRunStep,
  recordRunBatch,
  resumeRunBudget,
} from "./runBudget";

const cappedBatch = {
  steps: AGENT_SOFT_STEP_LIMIT,
  hitSoftLimit: true,
  finishReason: "tool-calls",
};

describe("run budget policy", () => {
  it.each([
    "chat-only",
    "ask",
    "custom",
  ] as const)("keeps %s behind the soft Continue gate", (mode) => {
    const budget = recordRunBatch(createRunBudget(mode), cappedBatch, mode);

    expect(budget.phase).toBe("soft-limit");
    expect(budget.autoContinue).toBe(false);
  });

  it.each([
    "trusted-workspace",
    "full-access",
  ] as const)("automatically continues ordinary soft boundaries for %s", (mode) => {
    const pending = recordRunBatch(createRunBudget(mode), cappedBatch, mode);
    const resumed = consumeAutoContinuation(pending);

    expect(pending.phase).toBe("auto-continue-pending");
    expect(resumed?.phase).toBe("running");
    expect(resumed?.continuationCount).toBe(1);
    expect(resumed?.continuationPromptPending).toBe(true);
  });

  it("retains cumulative steps across batches", () => {
    const first = recordRunBatch(
      createRunBudget("full-access"),
      cappedBatch,
      "full-access",
    );
    const resumed = consumeAutoContinuation(first);
    expect(resumed).not.toBeNull();
    if (!resumed) throw new Error("expected an automatic continuation");
    const second = recordRunBatch(
      resumed,
      { steps: 7, hitSoftLimit: false, finishReason: "stop" },
      "full-access",
    );

    expect(second.totalSteps).toBe(AGENT_SOFT_STEP_LIMIT + 7);
    expect(second.phase).toBe("complete");
  });

  it("stops automatic continuation at the hard total-step ceiling", () => {
    const current = {
      ...createRunBudget("full-access"),
      totalSteps: AGENT_HARD_STEP_LIMIT - AGENT_SOFT_STEP_LIMIT,
      continuationCount: 8,
    };
    const stopped = recordRunBatch(current, cappedBatch, "full-access");

    expect(stopped.phase).toBe("hard-limit");
    expect(stopped.stopReason).toBe("total-steps");
    expect(consumeAutoContinuation(stopped)).toBeNull();
    expect(describeRunBudgetStop(stopped)).toContain("autonomous ceiling");
  });

  it("allows an explicit user to extend a hard limit by another bounded window", () => {
    const hard = {
      ...createRunBudget("full-access"),
      totalSteps: AGENT_HARD_STEP_LIMIT,
      phase: "hard-limit" as const,
      stopReason: "total-steps" as const,
    };
    const resumed = resumeRunBudget(hard, true);

    expect(resumed?.phase).toBe("running");
    expect(resumed?.hardStepLimit).toBe(AGENT_HARD_STEP_LIMIT * 2);
    expect(resumed?.continuationCount).toBe(1);
  });
});

describe("run loop protection", () => {
  it("stops after three identical failing calls with identical results", () => {
    const failure = {
      toolName: "edit",
      input: { path: "src/app.ts", old_string: "missing" },
      output: { error: "old_string not found" },
      failed: true,
    };
    let tracker = createRunLoopTracker();
    tracker = observeRunStep(tracker, failure);
    tracker = observeRunStep(tracker, failure);
    tracker = observeRunStep(tracker, failure);

    expect(tracker.detected).toBe(true);
  });

  it("does not flag repeated calls when output changes", () => {
    let tracker = createRunLoopTracker();
    tracker = observeRunStep(tracker, {
      toolName: "bash_run",
      input: { command: "npm test" },
      output: { error: "1 test failed" },
      failed: true,
    });
    tracker = observeRunStep(tracker, {
      toolName: "bash_run",
      input: { command: "npm test" },
      output: { error: "2 tests failed" },
      failed: true,
    });

    expect(tracker.detected).toBe(false);
    expect(tracker.repeatCount).toBe(1);
  });

  it("resets failure repetition after a successful step", () => {
    let tracker = createRunLoopTracker();
    tracker = observeRunStep(tracker, {
      toolName: "edit",
      input: { path: "a" },
      output: { error: "missing" },
      failed: true,
    });
    tracker = observeRunStep(tracker, {
      toolName: "read_file",
      input: { path: "a" },
      output: { content: "changed" },
      failed: false,
    });

    expect(tracker).toEqual(createRunLoopTracker());
  });
});
