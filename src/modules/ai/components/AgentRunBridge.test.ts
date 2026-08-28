import { describe, expect, it } from "vitest";
import { agentRunBridgeSessionIds } from "./AgentRunBridge";

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
});
