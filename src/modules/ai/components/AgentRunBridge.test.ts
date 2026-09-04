import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  agentRunBridgeSessionIds,
  pendingApprovalsForRun,
} from "./AgentRunBridge";

describe("agentRunBridgeSessionIds", () => {
  it("keeps the foreground session and every background run bridged", () => {
    expect(
      agentRunBridgeSessionIds(
        [
          { id: "foreground" },
          { id: "background-a", run: { state: "running" } },
          { id: "background-b", run: { state: "running" } },
          { id: "finished", run: { state: "completed" } },
        ],
        "foreground",
      ),
    ).toEqual(["foreground", "background-a", "background-b"]);
  });

  it("does not duplicate a foreground session that is also running", () => {
    expect(
      agentRunBridgeSessionIds(
        [{ id: "foreground", run: { state: "running" } }],
        "foreground",
      ),
    ).toEqual(["foreground"]);
  });

  it("does not revive a persisted approval after its run was interrupted", () => {
    const messages = [
      {
        id: "assistant",
        role: "assistant" as const,
        parts: [
          {
            type: "tool-write_file",
            state: "approval-requested",
            approval: { id: "approval-1" },
            input: { path: "README.md" },
          },
        ],
      },
    ] as unknown as UIMessage[];

    expect(pendingApprovalsForRun(messages, "chat", "interrupted")).toEqual(
      [],
    );
    expect(pendingApprovalsForRun(messages, "chat", "running")).toHaveLength(
      1,
    );
  });
});
