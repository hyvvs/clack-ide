import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "@/modules/ai/lib/agents";
import { buildStableSystem } from "@/modules/ai/lib/agent";
import { createRunBudget, failedCommandOutput, recordRunBatch } from "@/modules/ai/lib/runBudget";

const coder = BUILTIN_AGENTS.find(agent => agent.id === "builtin:coder");
const reviewer = BUILTIN_AGENTS.find(agent => agent.id === "builtin:reviewer");

describe("R5ag truthful coding completion guidance (no new completion authority)", () => {
  it("ships only as normal, trusted Coder instructions to the production system builder", () => {
    expect(coder).toBeDefined();
    const instructions = buildStableSystem("example", coder!, undefined, null);
    expect(instructions).toContain("When the request is to create or modify runnable software");
    expect(instructions).toContain("implement the necessary scripts and automated tests");
    expect(instructions).toContain("inspect exit codes and errors, repair failures");
    expect(instructions).toContain("Do not claim a build, test or behavior passed unless you actually observed it pass");
    expect(instructions).toContain("within the normal run budget and permissions");
    expect(buildStableSystem("example", reviewer!, undefined, null)).not.toContain("implement the necessary scripts and automated tests");
  });
  it("does not require tests or builds for legitimate short and non-executable work", () => {
    expect(coder!.instructions).toContain("For tasks that do not require runnable software");
    expect(coder!.instructions).toContain("do not invent a build or tests");
    expect(recordRunBatch(createRunBudget("full-access"), {
      steps: 1, finishReason: "stop", hitSoftLimit: false, unfinishedWork: false,
    }, "full-access").phase).toBe("complete");
  });
  it("retains outstanding-work, budget, and genuine shell-failure semantics", () => {
    expect(recordRunBatch(createRunBudget("full-access"), {
      steps: 2, finishReason: "stop", hitSoftLimit: false, unfinishedWork: true,
    }, "full-access").phase).toBe("auto-continue-pending");
    expect(failedCommandOutput("bash_run", { exit_code: 1 })).toBe(true);
    expect(failedCommandOutput("bash_run", { exit_code: 0 })).toBe(false);
    expect(failedCommandOutput("bash_run", { exit_code: null, timed_out: true })).toBe(true);
    expect(coder!.instructions).toContain("blocked, cancelled or still failing");
  });
});
