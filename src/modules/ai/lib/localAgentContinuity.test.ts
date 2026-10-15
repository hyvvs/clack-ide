import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/ai/lib/agent", () => ({ runAgentStream: vi.fn() }));
import {
  createRunBudget,
  recordRunBatch,
  consumeAutoContinuation,
  failedCommandOutput,
} from "@/modules/ai/lib/runBudget";
import {
  groupCompactionUnits,
  type CompactionUnit,
} from "@/modules/ai/lib/compactionPlan";
import { readProjectMemory } from "@/modules/ai/lib/transport";
import { native } from "@/modules/ai/lib/native";

describe("independent local-agent operational continuity", () => {
  it.each([
    { exit_code: 1 },
    { exit_code: null },
    { exit_code: 0, timed_out: true },
  ])("keeps real failed command evidence protected: %j", (output) => {
    expect(failedCommandOutput("bash_run", output)).toBe(true);
    expect(failedCommandOutput("custom_data", output)).toBe(false);
    const units: CompactionUnit[] = [
      {
        messageId: "failed-test",
        role: "assistant",
        hasContentReferences: false,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "test",
                toolName: "bash_run",
                input: { command: "npm test" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "test",
                toolName: "bash_run",
                output: { type: "json", value: output },
              },
            ],
          },
        ],
      },
    ];
    expect(groupCompactionUnits(units)[0].protected).toBe(true);
  });
  it("does not complete a normal answer with explicitly unfinished obligations", () => {
    const budget = recordRunBatch(
      createRunBudget("full-access"),
      {
        steps: 3,
        hitSoftLimit: false,
        finishReason: "stop",
        unfinishedWork: true,
      },
      "full-access",
    );
    expect(budget.phase).toBe("auto-continue-pending");
    expect(budget.stopReason).toBe("unfinished-work");
    expect(consumeAutoContinuation(budget)?.continuationCount).toBe(1);
  });
  it.each([
    "ask",
    "custom",
    "chat-only",
  ] as const)("does not autonomously continue unfinished work in %s", (mode) => {
    const budget = recordRunBatch(
      createRunBudget(mode),
      {
        steps: 1,
        hitSoftLimit: false,
        finishReason: "stop",
        unfinishedWork: true,
      },
      mode,
    );
    expect(budget.phase).toBe("soft-limit");
    expect(consumeAutoContinuation(budget)).toBeNull();
  });
  it.each([
    "length",
    "error",
    "content-filter",
    "unknown",
  ])("does not repurpose unfinished work to replay a %s finish", (finishReason) => {
    const budget = recordRunBatch(
      createRunBudget("full-access"),
      { steps: 1, hitSoftLimit: false, finishReason, unfinishedWork: true },
      "full-access",
    );
    expect(consumeAutoContinuation(budget)).toBeNull();
  });
  it("bounds a model that keeps announcing completion without updating its plan", () => {
    let budget = createRunBudget("full-access");
    for (let turn = 0; turn < 10; turn++) {
      budget = recordRunBatch(
        budget,
        {
          steps: 1,
          hitSoftLimit: false,
          finishReason: "stop",
          unfinishedWork: true,
        },
        "full-access",
      );
      if (turn < 9) {
        const next = consumeAutoContinuation(budget);
        if (!next) throw new Error("Expected authorized continuation");
        budget = next;
      }
    }
    expect(budget.phase).toBe("hard-limit");
    expect(budget.stopReason).toBe("continuations");
    expect(budget.continuationCount).toBe(9);
  });
  it("does not continue a concise completed answer or a completed plan", () => {
    expect(
      recordRunBatch(
        createRunBudget("full-access"),
        {
          steps: 1,
          hitSoftLimit: false,
          finishReason: "stop",
          unfinishedWork: false,
        },
        "full-access",
      ).phase,
    ).toBe("complete");
  });
  it("waits for the user when the explicit plan reports a blocker", () => {
    const budget = recordRunBatch(
      createRunBudget("full-access"),
      {
        steps: 1,
        hitSoftLimit: false,
        finishReason: "stop",
        unfinishedWork: true,
        blockedWork: true,
      },
      "full-access",
    );
    expect(budget.phase).toBe("soft-limit");
    expect(budget.stopReason).toBe("blocked-work");
    expect(consumeAutoContinuation(budget)).toBeNull();
  });

  it("keeps the most recent accepted task plan and its source pair verbatim", () => {
    const plan = (id: string, ok = true): CompactionUnit => ({
      messageId: id,
      role: "assistant",
      hasContentReferences: false,
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: id,
              toolName: "todo_write",
              input: {
                todos: [
                  {
                    title: "Fix the failing test; then document",
                    status: "in_progress",
                  },
                ],
              },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: id,
              toolName: "todo_write",
              output: {
                type: "json",
                value: ok ? { ok: true } : { error: "invalid plan" },
              },
            },
          ],
        },
      ],
    });
    const groups = groupCompactionUnits([
      plan("old"),
      plan("current"),
      plan("rejected", false),
    ]);
    expect(groups.map((group) => group.protected)).toEqual([false, true, true]);
  });
});

describe("workspace instruction freshness", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("does not serve a recently cached instruction after the file changes", async () => {
    const read = vi.spyOn(native, "readFile");
    read.mockResolvedValueOnce({
      kind: "text",
      content: "Use timeout 900",
      size: 15,
    });
    expect(await readProjectMemory("/independent-freshness-change")).toBe(
      "Use timeout 900",
    );
    read.mockResolvedValueOnce({
      kind: "text",
      content: "Use timeout 750; 900 is obsolete",
      size: 31,
    });
    expect(await readProjectMemory("/independent-freshness-change")).toBe(
      "Use timeout 750; 900 is obsolete",
    );
  });
  it("observes newly created workspace instructions after a negative read", async () => {
    const read = vi
      .spyOn(native, "readFile")
      .mockRejectedValue(new Error("not found"));
    expect(await readProjectMemory("/independent-freshness-new")).toBeNull();
    read.mockResolvedValueOnce({
      kind: "text",
      content: "Never modify public-api.ts",
      size: 26,
    });
    expect(await readProjectMemory("/independent-freshness-new")).toBe(
      "Never modify public-api.ts",
    );
  });
});
