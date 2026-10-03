import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  executeCustomTool,
  type ExecutionRecord,
} from "@/modules/ai/lib/customToolExecution";
import {
  cancelSessionInference,
  sessionInference,
} from "@/modules/ai/lib/inferenceLifecycle";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const reference = { id: "tool-a", version: 3, hash: "a".repeat(64) };
function record(state = "awaiting-approval"): ExecutionRecord {
  return {
    id: "call",
    sessionId: "chat",
    workspaceId: "local:/work",
    agentId: "builtin:coder",
    runId: 1,
    tool: reference,
    toolName: "custom_read",
    kind: "native",
    argumentsHash: "b".repeat(64),
    state,
    effect: "none",
    createdAt: 1,
    updatedAt: 2,
    approval: null,
    result: null,
    error: null,
    transitions:
      state === "awaiting-approval"
        ? [[state, 1]]
        : [
            ["awaiting-approval", 1],
            ["approved", 2],
            ["running", 3],
            [state, 4],
          ],
  };
}
const options = () => ({
  sessionId: "chat",
  runId: 1,
  callId: "model-call",
  tool: reference,
  arguments: { path: "input.txt" },
  isCurrent: () => true,
  onRecord: vi.fn(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("T2 native execution client", () => {
  it("passes immutable capture once; execution accepts only the native ID", async () => {
    vi.mocked(listen).mockResolvedValue(vi.fn());
    vi.mocked(invoke)
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce({ ...record("succeeded"), result: "real result" });
    const input = options();
    const result = await executeCustomTool(input);
    expect(invoke).toHaveBeenNthCalledWith(1, "custom_tool_prepare", {
      request: {
        sessionId: "chat",
        runId: 1,
        callId: "model-call",
        tool: reference,
        arguments: { path: "input.txt" },
        test: false,
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "custom_tool_execute", {
      executionId: "call",
    });
    expect(result.result).toBe("real result");
    expect(sessionInference("chat")).toBeNull();
  });
  it.each([
    "succeeded",
    "denied",
    "cancelled",
    "timed-out",
    "interrupted",
  ])("does not replay an existing %s receipt", async (state) => {
    vi.mocked(invoke).mockResolvedValue(record(state));
    expect((await executeCustomTool(options())).state).toBe(state);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(listen).not.toHaveBeenCalled();
  });
  it("cancels a preparation that completed after Stop without executing", async () => {
    const ready = deferred<ExecutionRecord>();
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "custom_tool_prepare" ? ready.promise : undefined,
    );
    const call = executeCustomTool(options());
    const rejection = expect(call).rejects.toMatchObject({
      name: "AbortError",
    });
    const stop = cancelSessionInference("chat");
    ready.resolve(record());
    await rejection;
    await stop;
    expect(invoke).not.toHaveBeenCalledWith(
      "custom_tool_execute",
      expect.anything(),
    );
    expect(invoke).toHaveBeenCalledWith("custom_tool_cancel", {
      sessionId: "chat",
      executionId: "call",
    });
  });
  it("D1 stops an owned execution and suppresses callbacks after the run changes", async () => {
    const done = deferred<ExecutionRecord>();
    let current = true;
    vi.mocked(listen).mockResolvedValue(vi.fn());
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "custom_tool_prepare") return record();
      if (command === "custom_tool_execute") return done.promise;
      if (command === "custom_tool_cancel")
        done.resolve({ ...record("cancelled"), effect: "unknown" });
    });
    const input = { ...options(), isCurrent: () => current };
    const call = executeCustomTool(input);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("custom_tool_execute", {
        executionId: "call",
      }),
    );
    current = false;
    await cancelSessionInference("chat");
    expect((await call).state).toBe("cancelled");
    expect(input.onRecord).toHaveBeenCalledTimes(1);
  });
  it("ignores forged event payload state and late native history", async () => {
    let event!: (event: {
      payload: { id: string; sessionId: string; state?: string };
    }) => void;
    const history = deferred<ExecutionRecord[]>(),
      done = deferred<ExecutionRecord>();
    const unlisten = vi.fn();
    vi.mocked(listen).mockImplementation(async (_name, callback) => {
      event = callback as typeof event;
      return unlisten;
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "custom_tool_prepare") return record();
      if (command === "custom_tool_execute") return done.promise;
      if (command === "custom_tool_history") return history.promise;
    });
    const input = options(),
      call = executeCustomTool(input);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("custom_tool_execute", {
        executionId: "call",
      }),
    );
    event({ payload: { id: "call", sessionId: "chat", state: "succeeded" } });
    expect(input.onRecord).toHaveBeenCalledTimes(1);
    done.resolve(record("denied"));
    await call;
    history.resolve([record("running")]);
    await Promise.resolve();
    await Promise.resolve();
    expect(input.onRecord).toHaveBeenCalledTimes(2);
    expect(input.onRecord.mock.lastCall?.[0].state).toBe("denied");
    expect(unlisten).toHaveBeenCalledOnce();
  });
  it("cleans up pending native work if event registration fails", async () => {
    vi.mocked(invoke).mockResolvedValue(record());
    vi.mocked(listen).mockRejectedValue(new Error("disconnected"));
    await expect(executeCustomTool(options())).rejects.toThrow("disconnected");
    expect(invoke).toHaveBeenCalledWith("custom_tool_cancel", {
      sessionId: "chat",
      executionId: "call",
    });
    expect(sessionInference("chat")).toBeNull();
  });
});
