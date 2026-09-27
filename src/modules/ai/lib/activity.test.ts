import { describe, expect, it } from "vitest";
import type { UIMessage, UIMessageChunk } from "ai";
import {
  activitySchema,
  activityText,
  conversationActivity,
  createActivityRecorder,
  messageActivity,
  readActivity,
  reasoningFormat,
  taskActivity,
  type ActivityOwner,
} from "@/modules/ai/lib/activity";
import {
  PEER_TASK_SCHEMA_VERSION,
  type PeerTask,
} from "@/modules/ai/lib/peerTasks";

const owner: ActivityOwner = {
  sessionId: "chat",
  runId: "chat:1",
  workspaceId: "workspace",
  agentId: "agent-original",
  modelId: "model-original",
  providerId: "openai",
};
function message(parts: unknown[], providerId = "openai"): UIMessage {
  return {
    id: "message",
    role: "assistant",
    parts,
    metadata: {
      clackActivity: {
        version: 1,
        owner: { ...owner, providerId },
        receipts: parts.map((_part, index) => ({
          id: `part-${index}`,
          at: 10 + index,
          kind: "part",
          label: "start",
          part: index,
          format: reasoningFormat(providerId),
        })),
        omitted: 0,
      },
    },
  } as UIMessage;
}
function task(overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    schemaVersion: PEER_TASK_SCHEMA_VERSION,
    id: "task",
    rootTaskId: "task",
    parentTaskId: null,
    sourceSessionId: "chat",
    targetSessionId: "peer",
    sourceAgentId: "agent",
    sourceModelId: "model",
    targetAgentId: "peer-agent",
    targetModelId: "peer-model",
    workspaceId: "workspace",
    workspaceRoot: "/project",
    workspaceEnvironment: { kind: "local" },
    kind: "delegate",
    executionMode: "read-only",
    prompt: "Private task prompt",
    artifactRefs: [],
    hopCount: 0,
    dependsOn: [],
    status: "running",
    createdAt: 1,
    updatedAt: 3,
    ...overrides,
  };
}
const events = (m: UIMessage) => messageActivity(m, "chat", "workspace");

describe("truthful activity", () => {
  it.each([
    "openai",
    "google",
  ])("labels %s exposed summary text without claiming raw reasoning", (provider) => {
    expect(
      events(
        message(
          [{ type: "reasoning", text: "Compare interfaces", state: "done" }],
          provider,
        ),
      )[0],
    ).toMatchObject({ kind: "summary", label: "Provider reasoning summary" });
  });
  it.each([
    "xai",
    "groq",
    "cerebras",
    "deepseek",
  ])("labels actual %s content", (provider) => {
    expect(
      events(
        message([{ type: "reasoning", text: "Returned text" }], provider),
      )[0].label,
    ).toBe("Provider reasoning content");
  });
  it.each([
    "anthropic",
    "openai-compatible",
    "ollama",
    "unknown",
  ])("does not guess raw/summary for %s", (provider) => {
    expect(
      events(
        message([{ type: "reasoning", text: "Returned text" }], provider),
      )[0].label,
    ).toContain("format unspecified");
  });
  it("does not synthesize reasoning for ordinary prose, token usage or model name", () => {
    const m = message(
      [{ type: "text", text: "I thought carefully. Final answer." }],
      "reasoning-pro",
    );
    expect(events(m)).toEqual([]);
  });
  it("separates assistant progress, reasoning, runtime and final answer", () => {
    const m = message([
      { type: "reasoning", text: "Summary" },
      { type: "text", text: "Checking the file" },
      {
        type: "tool-read_file",
        toolCallId: "call",
        input: { path: "src/a.ts" },
        state: "output-available",
        output: "Private raw file content",
      },
      { type: "text", text: "Final answer" },
    ]);
    const result = events(m);
    expect(result.map((e) => e.kind)).toContain("progress");
    expect(result.map((e) => e.kind)).toContain("runtime");
    expect(JSON.stringify(result)).not.toContain("Private raw file content");
    expect(JSON.stringify(result)).not.toContain("Final answer");
  });
  it.each([
    null,
    12,
    {},
    ["invalid"],
  ])("ignores malformed reasoning text %j", (text) => {
    expect(events(message([{ type: "reasoning", text }]))).toEqual([]);
  });
  it("never renders Anthropic redacted data or provider signatures", () => {
    expect(
      events(
        message(
          [
            {
              type: "reasoning",
              text: "do not display",
              providerMetadata: { anthropic: { redactedData: "encrypted" } },
            },
          ],
          "anthropic",
        ),
      ),
    ).toEqual([]);
    expect(
      JSON.stringify(
        events(
          message(
            [
              {
                type: "reasoning",
                text: "Visible",
                providerMetadata: {
                  google: { thoughtSignature: "secret-signature" },
                },
              },
            ],
            "google",
          ),
        ),
      ),
    ).not.toContain("secret-signature");
  });
  it("isolates chat/workspace, even with a known message ID", () => {
    const m = message([{ type: "reasoning", text: "private" }]);
    expect(messageActivity(m, "other", "workspace")).toEqual([]);
    expect(messageActivity(m, "chat", "other")).toEqual([]);
  });
  it("retains captured provenance without relabeling historical events", () => {
    const result = conversationActivity(
      [message([{ type: "reasoning", text: "summary" }])],
      [],
      "chat",
      "workspace",
      {
        state: "running",
        startedAt: 22,
        modelId: "new-model",
        agentId: "new-agent",
        workspaceId: "workspace",
      },
    );
    expect(result[0].owner).toEqual(owner);
    expect(result[1].owner?.modelId).toBe("new-model");
  });
  it.each([
    "cancelled",
    "interrupted",
    "failed",
    "completed",
  ] as const)("preserves terminal run status %s after restart", (state) => {
    const m = message([
      { type: "reasoning", text: "partial", state: "streaming" },
    ]);
    const run = { startedAt: 1, endedAt: 100, state, workspaceId: "workspace" };
    const before = conversationActivity([m], [], "chat", "workspace", run);
    expect(
      conversationActivity(
        JSON.parse(JSON.stringify([m])),
        [],
        "chat",
        "workspace",
        JSON.parse(JSON.stringify(run)),
      ),
    ).toEqual(before);
    expect(before.map((e) => e.label)).toContain(`Run ${state}`);
    expect(before[0].source).toBe("Partial output");
  });
  it("legacy messages keep ordering and explicitly unavailable times/provenance", () => {
    const m = {
      ...message([
        { type: "reasoning", text: "First" },
        { type: "reasoning", text: "Second" },
      ]),
      metadata: undefined,
    };
    expect(events(m).map((e) => [e.detail, e.at, e.owner])).toEqual([
      ["First", undefined, undefined],
      ["Second", undefined, undefined],
    ]);
  });
  it.each([
    2,
    "1",
    null,
  ])("rejects unsupported metadata version %j without breaking history", (version) => {
    const m = message([{ type: "reasoning", text: "Evidence" }]);
    (
      m.metadata as { clackActivity: { version: unknown } }
    ).clackActivity.version = version;
    expect(readActivity(m, "chat", "workspace")).toBeNull();
    expect(events(m)[0].label).toContain("unspecified");
  });
  it("rejects conflicting receipt identities and nonexistent source parts", () => {
    const m = message([{ type: "reasoning", text: "Evidence" }]);
    const record = readActivity(m, "chat", "workspace");
    if (!record) throw new Error("Missing fixture record");
    record.receipts.push(record.receipts[0]);
    m.metadata = { clackActivity: record };
    expect(readActivity(m, "chat", "workspace")).toBeNull();
    record.receipts = [{ ...record.receipts[0], part: 99 }];
    expect(readActivity(m, "chat", "workspace")).toBeNull();
  });
  it.each([
    "input-streaming",
    "input-available",
    "approval-requested",
    "output-available",
    "output-error",
    "output-denied",
  ])("reports actual tool state %s without claiming execution prematurely", (state) => {
    const m = message([
      {
        type: "tool-run_command",
        toolCallId: "c",
        state,
        input: { command: "curl --password very-secret" },
        output: "secret result",
      },
    ]);
    const result = events(m);
    expect(JSON.stringify(result)).not.toContain("very-secret");
    expect(JSON.stringify(result)).not.toContain("secret result");
    expect(result[0].toolCallId).toBe("c");
  });
  it("redacts credentials, protected paths, URL auth and private keys", () => {
    const secret =
      "api_key=abc Authorization: Bearer abcdefg sk-abcdefghijk https://user:pass@host token=secret-value\n-----BEGIN PRIVATE KEY-----\nkeybytes\n-----END PRIVATE KEY-----";
    const text = activityText(secret);
    for (const value of [
      "=abc",
      "abcdefg",
      "user:pass",
      "secret-value",
      "keybytes",
    ])
      expect(text).not.toContain(value);
    const result = events(
      message([
        {
          type: "tool-read_file",
          toolCallId: "c",
          state: "input-available",
          input: { path: "/home/.ssh/id_rsa" },
        },
      ]),
    );
    expect(result[0].detail).toContain("[Protected path]");
  });
  it("bounds detail while leaving source transcript intact", () => {
    const m = message([{ type: "reasoning", text: "x".repeat(50000) }]);
    expect(events(m)[0].detail?.length).toBeLessThanOrEqual(4000);
    expect((m.parts[0] as { text: string }).text.length).toBe(50000);
  });
});

describe("activity receipts and collaboration", () => {
  it("records boundaries not token deltas, and deduplicates a repeated event ID", () => {
    const record = createActivityRecorder(owner, undefined, [], () => 1);
    const start: UIMessageChunk = { type: "reasoning-start", id: "r" };
    expect(record.observe(start)).toBe(true);
    expect(record.observe(start)).toBe(false);
    for (let i = 0; i < 100; i++)
      expect(
        record.observe({ type: "reasoning-delta", id: "r", delta: "a" }),
      ).toBe(false);
    expect(record.snapshot().receipts).toHaveLength(1);
  });
  it("maps repeated IDs across steps to distinct original parts", () => {
    const record = createActivityRecorder(owner);
    for (let i = 0; i < 2; i++) {
      record.observe({ type: "start-step" });
      record.observe({ type: "reasoning-start", id: "0" });
      record.observe({ type: "finish-step" });
    }
    expect(record.snapshot().receipts.map((r) => r.part)).toEqual([1, 3]);
  });
  it("bounds receipt metadata and explicitly counts unretained boundaries", () => {
    const record = createActivityRecorder(owner);
    for (let i = 0; i < 550; i++)
      record.add({
        id: `id-${i}`,
        kind: "request",
        label: "Request completed",
      });
    expect(record.snapshot().receipts).toHaveLength(512);
    expect(record.snapshot().omitted).toBe(38);
    expect(
      record.add({ id: "id-549", kind: "request", label: "Request completed" }),
    ).toBe(false);
    expect(record.snapshot().omitted).toBe(38);
    expect(activitySchema.safeParse(record.snapshot()).success).toBe(true);
  });
  it("reuses continuation receipts without duplicating or mutating previous snapshots", () => {
    const a = createActivityRecorder(owner);
    a.add({ id: "request", kind: "request", label: "Request" });
    const snapshot = a.snapshot();
    const b = createActivityRecorder(owner, snapshot);
    expect(b.add({ id: "request", kind: "request", label: "Request" })).toBe(
      false,
    );
    b.add({ id: "new", kind: "request", label: "Request" });
    expect(snapshot.receipts).toHaveLength(1);
    expect(b.snapshot().receipts).toHaveLength(2);
  });
  it("renders delegation, handoff, dependency resume and review receipt from existing task records", () => {
    const t = task({
      kind: "review",
      dependsOn: ["dependency"],
      dependenciesSatisfiedAt: 3,
      startedAt: 4,
      status: "completed",
      endedAt: 7,
      handoff: {
        version: 1,
        key: "a".repeat(64),
        digest: "b".repeat(64),
        recipientSessionId: "peer",
        createdAt: 2,
        sources: ["proof"],
        omitted: 0,
      },
      result: {
        summary: "private review",
        targetSessionId: "peer",
        targetAgentId: "peer-agent",
        targetModelId: "peer-model",
        completedAt: 7,
        artifacts: [],
      },
    });
    const result = taskActivity([t], "chat", "workspace");
    expect(result.map((e) => e.label)).toEqual([
      "Review delegated",
      "Task dependencies recorded",
      "Dependencies satisfied",
      "Evidence handoff prepared",
      "Task started",
      "Task completed",
      "Review returned",
    ]);
    expect(JSON.stringify(result)).not.toContain("Private task prompt");
    expect(JSON.stringify(result)).not.toContain("private review");
  });
  it.each([
    "blocked",
    "cancelled",
    "failed",
  ] as const)("shows actual task status %s", (status) => {
    expect(
      taskActivity([task({ status })], "chat", "workspace").map((e) => e.label),
    ).toContain(`Task ${status}`);
  });
  it("hides other tasks even in the same workspace and tasks from other workspaces", () => {
    expect(taskActivity([task()], "outsider", "workspace")).toEqual([]);
    expect(taskActivity([task()], "chat", "other")).toEqual([]);
  });
  it("shows scoped clarification and delivery evidence without replay or duplicate IDs", () => {
    const t = task({
      communication: [
        {
          id: "question",
          taskId: "task",
          recipientTaskId: "task",
          rootTaskId: "task",
          workspaceId: "workspace",
          parentTaskId: null,
          policyVersion: 1,
          sender: {
            sessionId: "peer",
            agentId: "peer-agent",
            modelId: "small",
            policyRevision: "a".repeat(64),
          },
          recipient: {
            sessionId: "chat",
            agentId: "agent",
            modelId: "large",
            policyRevision: "b".repeat(64),
          },
          runStartedAt: 1,
          sequence: 1,
          kind: "clarification-request",
          text: "Which API? password=private",
          evidence: [],
          toolCallId: "ask",
          createdAt: 5,
          deadline: 99,
          digest: "c".repeat(64),
          state: "answered",
          deliveredAt: 6,
          acknowledgedAt: 7,
        },
      ],
    });
    const first = conversationActivity([], [t, t], "chat", "workspace");
    expect(
      first.filter((e) => e.label.includes("clarification request")),
    ).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain("password=private");
    expect(
      conversationActivity(
        [],
        JSON.parse(JSON.stringify([t, t])),
        "chat",
        "workspace",
      ),
    ).toEqual(first);
  });
});
