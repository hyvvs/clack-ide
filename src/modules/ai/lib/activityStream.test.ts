import { describe, expect, it, vi } from "vitest";
import {
  convertToModelMessages,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { activityStream } from "@/modules/ai/lib/activityStream";
import {
  messageActivity,
  readActivity,
  type ActivityOwner,
} from "@/modules/ai/lib/activity";
import {
  beginInference,
  cancelSessionInference,
} from "@/modules/ai/lib/inferenceLifecycle";

const owner: ActivityOwner = {
  sessionId: "chat",
  runId: "chat:1",
  workspaceId: "workspace",
  providerId: "openai",
  agentId: "captured-agent",
  modelId: "captured-model",
};
function chunks(values: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(c) {
      for (const v of values) c.enqueue(v);
      c.close();
    },
  });
}
async function collect(
  stream: ReadableStream<UIMessageChunk>,
  message?: UIMessage,
) {
  const result: UIMessage[] = [];
  for await (const m of readUIMessageStream({
    stream,
    message,
    terminateOnError: false,
  }))
    result.push(structuredClone(m));
  return result;
}
const reasoning: UIMessageChunk[] = [
  { type: "start", messageId: "sdk-id" },
  { type: "start-step" },
  { type: "reasoning-start", id: "r" },
  { type: "reasoning-delta", id: "r", delta: "Compare " },
  { type: "reasoning-delta", id: "r", delta: "interfaces." },
  { type: "reasoning-end", id: "r" },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "Final answer" },
  { type: "text-end", id: "t" },
  { type: "finish-step" },
  { type: "finish", finishReason: "stop" },
];
const latest = (messages: UIMessage[]) => messages[messages.length - 1];

describe("real SDK activity stream integration", () => {
  it("assembles incremental reasoning independently from final answer and persists metadata", async () => {
    const updates = await collect(
      activityStream(
        [],
        owner,
        undefined,
        async () => chunks(reasoning),
        () => "safe",
      ),
    );
    expect(
      updates.some((m) =>
        m.parts.some((p) => p.type === "reasoning" && p.text === "Compare "),
      ),
    ).toBe(true);
    const message = latest(updates);
    expect(message.parts.map((p) => p.type)).toEqual([
      "step-start",
      "reasoning",
      "text",
    ]);
    const activity = messageActivity(message, "chat", "workspace");
    expect(activity.filter((e) => e.kind === "summary")).toHaveLength(1);
    expect(activity[0].detail).toBe("Compare interfaces.");
    expect(readActivity(message, "chat", "workspace")?.receipts).toHaveLength(
      3,
    );
    expect(
      messageActivity(JSON.parse(JSON.stringify(message)), "chat", "workspace"),
    ).toEqual(activity);
  });
  it("metadata does not add prompt content or alter existing messages", async () => {
    const message = latest(
      await collect(
        activityStream(
          [],
          owner,
          undefined,
          async () => chunks(reasoning),
          () => "safe",
        ),
      ),
    );
    expect(await convertToModelMessages([message])).toEqual(
      await convertToModelMessages([{ ...message, metadata: undefined }]),
    );
  });
  it("an activity-only failed response adds no model message", async () => {
    const message = latest(
      await collect(
        activityStream(
          [],
          owner,
          undefined,
          async () => {
            throw new Error("failed");
          },
          () => "safe",
        ),
      ),
    );
    expect(await convertToModelMessages([message])).toEqual([]);
  });
  it("provider artifacts do not shift subsequent reasoning provenance or expose bytes", async () => {
    const artifact: UIMessageChunk = {
      type: "file",
      mediaType: "image/png",
      url: "data:image/png;base64,private-bytes",
    };
    const message = latest(
      await collect(
        activityStream(
          [],
          owner,
          undefined,
          async () => chunks([artifact, ...reasoning]),
          () => "safe",
        ),
      ),
    );
    const result = messageActivity(message, "chat", "workspace");
    expect(result[0].label).toBe("Provider artifact returned");
    expect(result[1].label).toBe("Provider reasoning summary");
    expect(result[1].detail).toBe("Compare interfaces.");
    expect(JSON.stringify(result)).not.toContain("private-bytes");
  });
  it("records retries and recovery from real callbacks without duplicating reasoning", async () => {
    const message = latest(
      await collect(
        activityStream(
          [],
          owner,
          undefined,
          async (context) => {
            context.retry({
              retryNumber: 1,
              maxRetries: 2,
              error: "api_key=private",
            });
            context.recovered();
            return chunks(reasoning);
          },
          () => "safe",
        ),
      ),
    );
    const events = messageActivity(message, "chat", "workspace");
    expect(events.filter((e) => e.kind === "summary")).toHaveLength(1);
    expect(events.map((e) => e.label)).toContain("Provider retry 1/2");
    expect(events.map((e) => e.label)).toContain("Provider request recovered");
    expect(JSON.stringify(message.metadata)).not.toContain("private");
  });
  it("records observed D1 transitions, including cancellation, without owning inference", async () => {
    const abort = vi.fn();
    const message = latest(
      await collect(
        activityStream(
          [],
          owner,
          { sessionId: "chat", runId: "chat:1", isCurrent: () => true },
          async (context) => {
            const inference = beginInference(context.scope, abort);
            inference.update("waiting-first-output");
            inference.update("waiting-first-output");
            const cancelled = cancelSessionInference("chat");
            inference.update("cancelled");
            inference.settle();
            await cancelled;
            return chunks([{ type: "abort" }]);
          },
          () => "safe",
        ),
      ),
    );
    const labels = messageActivity(message, "chat", "workspace").map(
      (e) => e.label,
    );
    expect(labels.filter((l) => l === "Waiting for server...")).toHaveLength(1);
    expect(labels).toContain("Stopping...");
    expect(labels).toContain("Request cancelled");
    expect(abort).toHaveBeenCalledOnce();
  });
  it("does not accept stale callbacks from an old run", async () => {
    const message = latest(
      await collect(
        activityStream(
          [],
          owner,
          { sessionId: "chat", runId: "old", isCurrent: () => false },
          async (context) => {
            context.retry({ retryNumber: 1, maxRetries: 2, error: "stale" });
            const request = beginInference(context.scope, () => {});
            request.settle();
            return chunks(reasoning);
          },
          () => "safe",
        ),
      ),
    );
    expect(
      messageActivity(message, "chat", "workspace").some(
        (e) => e.label.includes("retry") || e.label.includes("Connecting"),
      ),
    ).toBe(false);
  });
  it("preserves partial output after abort rather than marking it complete", async () => {
    const message = latest(
      await collect(
        activityStream(
          [],
          owner,
          undefined,
          async () => chunks([...reasoning.slice(0, 4), { type: "abort" }]),
          () => "safe",
        ),
      ),
    );
    const result = messageActivity(message, "chat", "workspace");
    expect(result[0].source).toBe("Partial output");
    expect(result.map((e) => e.label)).toContain("Response cancelled");
    expect(result.some((e) => e.label.startsWith("Response ended"))).toBe(
      false,
    );
  });
  it("records preparation failure before any model output", async () => {
    const handler = vi.fn(() => "Safe error");
    const message = latest(
      await collect(
        activityStream(
          [],
          owner,
          undefined,
          async () => {
            throw new Error("secret");
          },
          handler,
        ),
      ),
    );
    expect(
      messageActivity(message, "chat", "workspace").map((e) => e.label),
    ).toContain("Request did not complete");
    expect(handler).toHaveBeenCalledOnce();
    expect(JSON.stringify(message.metadata)).not.toContain("secret");
  });
  it("tool/approval/result boundaries correlate with the real SDK's original parts", async () => {
    const toolChunks: UIMessageChunk[] = [
      { type: "start-step" },
      { type: "tool-input-start", toolCallId: "c", toolName: "read_file" },
      {
        type: "tool-input-available",
        toolCallId: "c",
        toolName: "read_file",
        input: { path: "src/a.ts" },
      },
      {
        type: "tool-approval-request",
        toolCallId: "c",
        approvalId: "approval",
      },
      {
        type: "tool-output-available",
        toolCallId: "c",
        output: { ok: false, error: "permission denied" },
      },
      { type: "finish", finishReason: "tool-calls" },
    ];
    const message = latest(
      await collect(
        activityStream(
          [],
          owner,
          undefined,
          async () => chunks(toolChunks),
          () => "safe",
        ),
      ),
    );
    const result = messageActivity(message, "chat", "workspace");
    expect(result.map((e) => e.label)).toEqual([
      "read_file: Tool selected",
      "read_file: Call requested",
      "read_file: Approval requested",
      "read_file: Failed result received",
      "Response ended: tool-calls",
    ]);
    expect(result.slice(0, 4).every((e) => e.toolCallId === "c")).toBe(true);
  });
  it("continuation retains prior receipts and correlates newly appended parts", async () => {
    const first = latest(
      await collect(
        activityStream(
          [],
          owner,
          undefined,
          async () => chunks(reasoning),
          () => "safe",
        ),
      ),
    );
    const second = latest(
      await collect(
        activityStream(
          [first],
          owner,
          undefined,
          async () => chunks(reasoning),
          () => "safe",
        ),
        first,
      ),
    );
    expect(second.id).toBe(first.id);
    expect(readActivity(second, "chat", "workspace")?.receipts).toHaveLength(6);
    expect(
      messageActivity(second, "chat", "workspace").filter(
        (e) => e.kind === "summary",
      ),
    ).toHaveLength(2);
  });
  it("a later run appended to the same message cannot relabel prior evidence", async () => {
    const first = latest(
      await collect(
        activityStream(
          [],
          owner,
          undefined,
          async () => chunks(reasoning),
          () => "safe",
        ),
      ),
    );
    const secondOwner = {
      ...owner,
      runId: "chat:2",
      providerId: "groq",
      agentId: "new-agent",
      modelId: "new-model",
    };
    const second = latest(
      await collect(
        activityStream(
          [first],
          secondOwner,
          undefined,
          async () => chunks(reasoning),
          () => "safe",
        ),
        first,
      ),
    );
    const result = messageActivity(second, "chat", "workspace").filter(
      (e) => e.kind === "summary" || e.kind === "reasoning",
    );
    expect(result[0].owner).toEqual(owner);
    expect(result[1].owner).toEqual(secondOwner);
    expect(result.map((e) => e.kind)).toEqual(["summary", "reasoning"]);
  });
});
