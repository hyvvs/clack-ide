import { afterEach, describe, expect, it, vi } from "vitest";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { gateInferenceTools } from "@/modules/ai/lib/inferenceToolGate";
import {
  beginInference,
  sessionInference,
} from "@/modules/ai/lib/inferenceLifecycle";
import {
  acquireWorkspaceWriteLease,
  clearWorkspaceWriteLeasesForTests,
  releaseWorkspaceWriteLeasesForSession,
} from "@/modules/ai/lib/workspaceWriteLease";

const scope = { sessionId: "gate", runId: "run", isCurrent: () => true };
const options = { toolCallId: "call", messages: [] };
function approve(tools: ToolSet) {
  const gate = tools.work.needsApproval;
  if (typeof gate !== "function") throw new Error("missing gate");
  return gate({}, options);
}
afterEach(() => clearWorkspaceWriteLeasesForTests());

describe("inference/tool lock ordering", () => {
  it("does not run a streamed tool call after failed native settlement", async () => {
    const attempt = beginInference(scope, vi.fn());
    const decision = vi.fn(() => false);
    const tools = gateInferenceTools(
      { work: tool({ inputSchema: z.object({}), needsApproval: decision }) },
      scope,
    );
    const result = Promise.resolve(approve(tools));
    attempt.update("disconnected");
    attempt.settle();
    await expect(result).rejects.toMatchObject({ code: "native-transport" });
    expect(decision).not.toHaveBeenCalled();
  });
  it.each([
    true,
    false,
  ])("defers approval decision until native settlement (approval=%s)", async (approval) => {
    const attempt = beginInference(scope, vi.fn());
    const decision = vi.fn(() => approval);
    const tools = gateInferenceTools(
      {
        work: tool({
          inputSchema: z.object({}),
          needsApproval: decision,
          execute: async () => "done",
        }),
      },
      scope,
    );
    const result = approve(tools);
    await Promise.resolve();
    expect(decision).not.toHaveBeenCalled();
    attempt.update("completed");
    attempt.settle();
    expect(await result).toBe(approval);
    expect(sessionInference(scope.sessionId)).toBeNull();
  });
  it("does not start a child or local tool after Stop while draining", async () => {
    const controller = new AbortController();
    const attempt = beginInference(scope, vi.fn());
    const decision = vi.fn(() => false);
    const tools = gateInferenceTools(
      {
        work: tool({
          inputSchema: z.object({}),
          needsApproval: decision,
          execute: async () => "child",
        }),
      },
      scope,
      controller.signal,
    );
    const result = Promise.resolve(approve(tools));
    controller.abort();
    attempt.settle();
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
    expect(decision).not.toHaveBeenCalled();
  });
  it("ignores another session's attempt and does not hold inference while waiting on write lease", async () => {
    const other = beginInference({ ...scope, sessionId: "other" }, vi.fn());
    await acquireWorkspaceWriteLease({
      workspaceId: "local:/repo",
      sessionId: "writer",
      agentId: "writer-agent",
    });
    const tools = gateInferenceTools(
      {
        work: tool({ inputSchema: z.object({}), execute: async () => "write" }),
      },
      scope,
    );
    expect(await approve(tools)).toBe(false);
    let granted = false;
    const wait = acquireWorkspaceWriteLease({
      workspaceId: "local:/repo",
      sessionId: scope.sessionId,
      agentId: "agent",
    }).then((r) => {
      granted = r.ok;
    });
    await Promise.resolve();
    expect(granted).toBe(false);
    expect(sessionInference(scope.sessionId)).toBeNull();
    releaseWorkspaceWriteLeasesForSession("writer");
    await wait;
    expect(granted).toBe(true);
    other.settle();
  });
  it("a parent releases before child work and reacquires for its next model step", async () => {
    const parent = beginInference(scope, vi.fn());
    const tools = gateInferenceTools(
      {
        work: tool({ inputSchema: z.object({}), execute: async () => "child" }),
      },
      scope,
    );
    const ready = approve(tools);
    parent.update("completed");
    parent.settle();
    expect(await ready).toBe(false);
    const child = beginInference(scope, vi.fn());
    expect(sessionInference(scope.sessionId)).not.toBeNull();
    child.settle();
    const next = beginInference(scope, vi.fn());
    expect(sessionInference(scope.sessionId)).not.toBeNull();
    next.settle();
  });
});
