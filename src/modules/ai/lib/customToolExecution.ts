import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beginInference } from "@/modules/ai/lib/inferenceLifecycle";
import type {
  CapturedToolVersion,
  ToolBinding,
} from "@/modules/ai/lib/customTools";

export type ExecutionRecord = {
  id: string;
  sessionId: string;
  agentId: string;
  workspaceId: string;
  runId: number | null;
  tool: CapturedToolVersion;
  toolName: string;
  kind: string;
  function?: Extract<ToolBinding, { kind: "wasi" }>;
  argumentsHash: string;
  state: string;
  effect: string;
  createdAt: number;
  updatedAt: number;
  approval: string | null;
  result: unknown;
  error: string | null;
  transitions: [string, number][];
};
export const executionHistory = (sessionId: string) =>
  invoke<ExecutionRecord[]>("custom_tool_history", { sessionId });
export const cancelExecution = (sessionId: string, executionId: string) =>
  invoke<void>("custom_tool_cancel", { sessionId, executionId });

export async function executeCustomTool(options: {
  sessionId: string;
  runId?: number;
  callId: string;
  tool: CapturedToolVersion;
  arguments: unknown;
  test?: boolean;
  signal?: AbortSignal;
  isCurrent: () => boolean;
  onRecord?: (record: ExecutionRecord) => void;
}): Promise<ExecutionRecord> {
  let id: string | undefined;
  let stopped = options.signal?.aborted ?? false;
  const abort = () => {
    stopped = true;
    if (id) void cancelExecution(options.sessionId, id).catch(() => {});
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  const lifecycle = beginInference(
    {
      sessionId: options.sessionId,
      runId: `${options.sessionId}:${options.runId ?? options.callId}`,
      label: "custom tool",
      isCurrent: options.isCurrent,
    },
    abort,
  );
  let unlisten: (() => void) | undefined;
  let last: ExecutionRecord | undefined;
  let finished = false;
  const report = (record: ExecutionRecord) => {
    if (
      finished ||
      (last && record.transitions.length <= last.transitions.length)
    )
      return;
    last = record;
    if (options.isCurrent()) options.onRecord?.(record);
  };
  try {
    const prepared = await invoke<ExecutionRecord>("custom_tool_prepare", {
      request: {
        sessionId: options.sessionId,
        runId: options.runId ?? null,
        callId: options.callId,
        tool: options.tool,
        arguments: options.arguments,
        test: options.test ?? false,
      },
    });
    id = prepared.id;
    report(prepared);
    if (stopped || !options.isCurrent()) {
      await cancelExecution(options.sessionId, id);
      throw new DOMException("Cancelled", "AbortError");
    }
    if (prepared.state !== "awaiting-approval") return prepared;
    unlisten = await listen<{ sessionId: string; id: string }>(
      "clack:custom-tool-execution",
      ({ payload }) => {
        if (
          payload.id !== id ||
          payload.sessionId !== options.sessionId ||
          !options.isCurrent()
        )
          return;
        void executionHistory(options.sessionId)
          .then((records) => {
            const record = records.find((r) => r.id === id);
            if (record) report(record);
          })
          .catch(() => {});
      },
    );
    if (stopped || !options.isCurrent()) {
      await cancelExecution(options.sessionId, id);
      throw new DOMException("Cancelled", "AbortError");
    }
    const record = await invoke<ExecutionRecord>("custom_tool_execute", {
      executionId: id,
    });
    report(record);
    lifecycle.update(
      record.state === "succeeded"
        ? "completed"
        : record.state === "cancelled"
          ? "cancelled"
          : "failed",
    );
    return record;
  } catch (error) {
    if (id) await cancelExecution(options.sessionId, id).catch(() => {});
    throw error;
  } finally {
    finished = true;
    unlisten?.();
    options.signal?.removeEventListener("abort", abort);
    lifecycle.settle();
  }
}
