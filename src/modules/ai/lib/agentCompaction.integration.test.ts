import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { invoke } from "@tauri-apps/api/core";
import { runAgentStream } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import type { ToolContext } from "@/modules/ai/tools/tools";
import type {
  MemoryCandidate,
  MemoryEvidence,
  MemoryView,
} from "@/modules/ai/lib/conversationMemory";
import { sessionInference } from "@/modules/ai/lib/inferenceLifecycle";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";

const fixture = vi.hoisted(() => ({
  toolOutput: "Latest exact tool output",
  execute: vi.fn(),
  requestEvidence: false,
  shared: false,
  revokeAtAdmission: false,
  revoked: false,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_event: unknown) => {};
  },
}));
vi.mock("@/modules/ai/tools/tools", async () => {
  const { tool } = await import("ai");
  const { z } = await import("zod");
  const { buildEvidenceTools } = await import("@/modules/ai/tools/evidence");
  return {
    buildTools: (ctx: ToolContext) => ({
      ...buildEvidenceTools(ctx),
      read_fixture: tool({
        description: "Read test evidence",
        inputSchema: z.object({}),
        execute: async () => {
          fixture.execute();
          return fixture.toolOutput;
        },
      }),
    }),
  };
});

type Body = {
  model: string;
  stream?: boolean;
  tools?: unknown[];
  max_tokens?: number;
  messages: Array<{ role: string; content: string }>;
};
const owner = {
  sessionId: "integration-chat",
  workspaceId: "local:/integration",
};
let originals: UIMessage[];
let view: MemoryView;
let streams: Body[];
let extracts: Body[];
let maxActive: number;
let active: number;
let changedDuringExtraction: boolean;
const approvals = new Map<string, (approved: boolean) => void>();
const records = new Map<string, MemoryEvidence>();
const evidenceId = (id: string) =>
  (originals.findIndex((m) => m.id === id) + 1).toString(16).padStart(64, "0");
function complete(text: string) {
  return {
    id: "extract",
    object: "chat.completion",
    created: 1,
    model: "private-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 200, completion_tokens: 700, total_tokens: 900 },
  };
}
function sse(first: boolean, recovered = false) {
  const event = (delta: unknown, finish_reason: string | null) =>
    `data: ${JSON.stringify({ id: "response", object: "chat.completion.chunk", created: 1, model: "private-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return first
    ? event(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "new-call",
              type: "function",
              function: fixture.requestEvidence
                ? {
                    name: "request_conversation_evidence",
                    arguments: JSON.stringify({
                      query: "socket_timeout_ms",
                      anchor: "a0",
                      expand: true,
                    }),
                  }
                : { name: "read_fixture", arguments: "{}" },
            },
          ],
        },
        null,
      ) +
        event({}, "tool_calls") +
        "data: [DONE]\n\n"
    : event(
        {
          role: "assistant",
          content: recovered
            ? "The original socket_timeout_ms decision was 7351, not 5000, due to the deployed proxy."
            : "Continued with the original constraints.",
        },
        null,
      ) +
        event({}, "stop") +
        "data: [DONE]\n\n";
}
beforeEach(() => {
  vi.clearAllMocks();
  approvals.clear();
  records.clear();
  streams = [];
  extracts = [];
  active = 0;
  maxActive = 0;
  changedDuringExtraction = false;
  fixture.toolOutput = "Latest exact tool output";
  fixture.requestEvidence = false;
  fixture.shared = false;
  fixture.revokeAtAdmission = false;
  fixture.revoked = false;
  originals = [
    {
      id: "u",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Never remove workspace authorization. Keep port 1420.",
        },
      ],
    },
    ...Array.from(
      { length: 8 },
      (_, i): UIMessage => ({
        id: `a${i}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `Decision ${i}: migration remains unresolved.\n${"old observation ".repeat(550)}`,
          },
        ],
      }),
    ),
    {
      id: "latest",
      role: "user",
      parts: [{ type: "text", text: "Continue the migration." }],
    },
  ];
  view = {
    preparation: {
      runtimeId: "process",
      owner,
      source: {
        transcriptRevision: 1,
        profileRevision: 1,
        transcriptHash: "a".repeat(64),
        profileHash: "b".repeat(64),
      },
      generation: 0,
      previous: null,
    },
    revisionId: null,
    revision: null,
    uncoveredMessages: originals.length,
    sourceChanged: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No cloud fallback allowed");
    }),
  );
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "conversation_memory_load") {
      expect(args).toEqual({ owner });
      return structuredClone(view);
    }
    if (command === "conversation_memory_retrieve") {
      const a = args as {
        preparation: unknown;
        messageIds: string[];
        maxBytes: number;
        maxChunks: number;
      };
      expect(a.preparation).toEqual(view.preparation);
      let bytes = 0;
      const chunks: unknown[] = [];
      const issues: unknown[] = [];
      for (const id of a.messageIds) {
        const index = originals.findIndex((m) => m.id === id);
        const text = JSON.stringify(originals[index]);
        const size = new TextEncoder().encode(text).byteLength;
        if (bytes + size > a.maxBytes || chunks.length >= a.maxChunks) {
          issues.push({ messageId: id, status: "oversized" });
          continue;
        }
        bytes += size;
        chunks.push({
          messageId: id,
          messageIndex: index,
          contentId: null,
          text,
          evidence: {
            id: evidenceId(id),
            digest: "d".repeat(64),
            sourceRevision: 1,
            locator: { kind: "message", messageId: id },
            contentIds: [],
            relatedSessions: [owner.sessionId],
          },
        });
      }
      return { chunks, issues };
    }
    if (command === "conversation_memory_extract_sources") {
      const a = args as {
        preparation: unknown;
        sources: Array<{ messageId: string }>;
      };
      expect(a.preparation).toEqual(view.preparation);
      return a.sources.map((locator) => {
        const evidence: MemoryEvidence = {
          id: evidenceId(locator.messageId),
          digest: "d".repeat(64),
          sourceRevision: 1,
          locator: { kind: "message", messageId: locator.messageId },
          contentIds: [],
          relatedSessions: [owner.sessionId],
        };
        records.set(evidence.id, evidence);
        return {
          evidence,
          value: structuredClone(
            originals.find((m) => m.id === locator.messageId),
          ),
        };
      });
    }
    if (command === "conversation_memory_commit") {
      const { candidate } = args as { candidate: MemoryCandidate };
      if (
        JSON.stringify(candidate.preparation) !==
        JSON.stringify(view.preparation)
      )
        throw new Error("memory_stale_preparation");
      const number = (view.revision?.revision ?? 0) + 1;
      const revisionId = number.toString(16).padStart(64, "0");
      view = {
        ...view,
        revisionId,
        preparation: {
          ...view.preparation,
          previous: revisionId,
          generation: view.preparation.generation + 1,
        },
        revision: {
          schemaVersion: 1,
          preparation: candidate.preparation,
          revision: number,
          createdAt: 1,
          policyVersion: candidate.policyVersion,
          producer: {},
          coverage: {
            start: candidate.start,
            end: candidate.end,
            digest: "c".repeat(64),
            latestMessageId: originals[candidate.end - 1].id,
            sourceMessageCount: originals.length,
          },
          claims: candidate.claims,
          evidence: [...records.values()].filter((e) =>
            candidate.sources.some((s) =>
              s.kind === "retained"
                ? s.evidenceId === e.id
                : s.kind === "message" &&
                  e.locator.kind === "message" &&
                  s.messageId === e.locator.messageId,
            ),
          ),
        },
      };
      return revisionId;
    }
    if (command === "scoped_evidence_retrieve") {
      if (fixture.revoked) throw new Error("scoped_evidence_stale_receipt");
      const text =
        "socket_timeout_ms = 7351, NOT 5000, required by the deployed proxy.";
      const chunks = [
        {
          id: "e".repeat(64),
          kind: "project",
          workspaceId: owner.workspaceId,
          checkout: owner.workspaceId,
          source: {
            recordId: "approved-decision",
            sessionId: "source-large-chat",
            locator: {
              kind: "part",
              messageId: "approved-source",
              partIndex: 0,
            },
          },
          revision: 3,
          contentHash: "f".repeat(64),
          text,
          start: 0,
          end: text.length,
          required: true,
          freshness: "current",
          qualification: "user-requirement",
          reason: "project-lexical-relevance",
        },
        {
          id: "a".repeat(64),
          kind: "task-result",
          workspaceId: owner.workspaceId,
          checkout: owner.workspaceId,
          source: { taskId: "declared-review-dependency" },
          revision: "b".repeat(64),
          contentHash: "c".repeat(64),
          text: "The proxy requires 7351.",
          start: 0,
          end: 24,
          required: true,
          freshness: "historical-task-evidence-not-current-project-state",
          qualification: "agent-finding",
          reason: "declared-task-dependency",
        },
      ];
      chunks[1].end = chunks[1].text.length;
      return {
        chunks,
        issues: [],
        omitted: 0,
        stamp: "d".repeat(64),
        reads: 2,
        bytes: chunks.reduce(
          (n, c) => n + new TextEncoder().encode(JSON.stringify(c)).byteLength,
          0,
        ),
      };
    }
    if (command === "ai_http_open") return crypto.randomUUID();
    if (command === "ai_http_preflight") {
      const a = args as { requestId: string; approved: boolean };
      approvals.get(a.requestId)?.(a.approved);
      return null;
    }
    if (command !== "ai_http_stream") return null;
    const a = args as {
      requestId: string;
      body: number[];
      admission: { endpointId: string };
      onEvent: { onmessage: (value: unknown) => void };
    };
    expect(a.admission.endpointId).toBe("compaction-fixture");
    if (fixture.revokeAtAdmission) fixture.revoked = true;
    const approved = await new Promise<boolean>((resolve) => {
      approvals.set(a.requestId, resolve);
      a.onEvent.onmessage({ kind: "preflight", requestId: a.requestId });
    });
    if (!approved) {
      expect(fixture.revokeAtAdmission).toBe(true);
      a.onEvent.onmessage({
        kind: "settled",
        requestId: a.requestId,
        phase: "failed",
      });
      return null;
    }
    active++;
    maxActive = Math.max(maxActive, active);
    const body = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(a.body)),
    ) as Body;
    expect(body.model).toBe("private-model");
    let payload: string;
    if (body.stream) {
      streams.push(body);
      payload = sse(
        streams.length === 1,
        JSON.stringify(body).includes("socket_timeout_ms = 7351"),
      );
    } else {
      extracts.push(body);
      expect(body.tools).toBeUndefined();
      const source = JSON.parse(body.messages[1].content) as {
        sources: Array<{ id: string; passages: string[] }>;
      };
      payload = JSON.stringify(
        complete(
          JSON.stringify({
            claims: source.sources.map((s) => ({
              source: s.id,
              section: "decisions",
              text: s.passages[0].split("\n")[0],
              quote: s.passages[0].split("\n")[0],
              status: "unresolved",
              contradicts: [],
            })),
          }),
        ),
      );
      if (changedDuringExtraction) view.preparation.generation++;
    }
    a.onEvent.onmessage({
      kind: "headers",
      requestId: a.requestId,
      status: 200,
      headers: {
        "content-type": body.stream ? "text/event-stream" : "application/json",
      },
    });
    a.onEvent.onmessage({
      kind: "chunk",
      requestId: a.requestId,
      bytes: [...new TextEncoder().encode(payload)],
    });
    active--;
    a.onEvent.onmessage({
      kind: "settled",
      requestId: a.requestId,
      phase: "completed",
    });
    return null;
  });
});
afterEach(() => vi.unstubAllGlobals());

async function run(contextLimit = 20000) {
  const chargeCall = vi.fn(async () => {});
  const optimized = vi.fn();
  const result = await runAgentStream({
    keys: EMPTY_PROVIDER_KEYS,
    modelId: "compat-compaction-fixture",
    customEndpoints: [
      {
        id: "compaction-fixture",
        name: "Private model",
        modelId: "private-model",
        baseURL: "http://localhost:1234/v1",
        contextLimit,
      },
    ],
    inferenceScope: {
      sessionId: owner.sessionId,
      runId: crypto.randomUUID(),
      isCurrent: () => true,
    },
    compaction: {
      owner,
      originals: structuredClone(originals),
      ready: async () => {},
      remainingCalls: () => 100,
      chargeCall,
    },
    onOptimized: optimized,
    toolContext: (fixture.shared
      ? {
          getWorkspaceId: () => owner.workspaceId,
          getWorkspaceRoot: () => "/integration",
          getCwd: () => "/integration",
          getSessionId: () => owner.sessionId,
          getAgentId: () => "reviewer",
        }
      : {}) as ToolContext,
    uiMessages: structuredClone(originals),
  });
  const errors: unknown[] = [];
  const chunks = [];
  for await (const chunk of result.fullStream) {
    chunks.push(chunk);
    if (chunk.type === "error") errors.push(chunk.error);
  }
  return { errors, chunks, chargeCall, optimized };
}
describe("automatic compaction in the real agent request path", () => {
  it("answers in a small target from project and task evidence absent from its own transcript", async () => {
    fixture.shared = true;
    originals = [
      {
        id: "target-mission",
        role: "user",
        parts: [{ type: "text", text: "Which socket_timeout_ms is required?" }],
      },
    ];
    const before = JSON.stringify(originals);
    const outcome = await run(8192);
    expect(outcome.errors).toEqual([]);
    expect(extracts).toHaveLength(0);
    expect(streams).toHaveLength(2);
    expect(JSON.stringify(streams[0])).toContain("approved-decision");
    expect(JSON.stringify(streams[0])).toContain("declared-review-dependency");
    expect(JSON.stringify(streams[0])).not.toContain("Private introduction");
    expect(JSON.stringify(outcome.chunks)).toContain("7351, not 5000");
    expect(
      resolveContextBudget({ deployed: 8192 }, measureRequest(streams[0])).fits,
    ).toBe(true);
    expect(JSON.stringify(originals)).toBe(before);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("blocks shared evidence revoked while waiting for native inference admission", async () => {
    fixture.shared = true;
    fixture.revokeAtAdmission = true;
    originals = [
      {
        id: "mission",
        role: "user",
        parts: [{ type: "text", text: "Review the proxy." }],
      },
    ];
    const outcome = await run(8192);
    expect(outcome.errors).toHaveLength(1);
    expect(streams).toHaveLength(0);
    expect(extracts).toHaveLength(0);
    expect(String(outcome.errors[0])).toContain("stale_receipt");
  });
  it("prepares model-requested anchored evidence before the next SDK step", async () => {
    fixture.requestEvidence = true;
    const early = originals[1].parts[0];
    if (early.type !== "text") throw new Error("fixture");
    early.text += "\nOriginal socket_timeout_ms = 7351, not 5000.";
    originals[originals.length - 1].parts = [
      { type: "text", text: "Continue with the next milestone." },
    ];
    const outcome = await run();
    expect(outcome.errors).toEqual([]);
    expect(streams).toHaveLength(2);
    expect(JSON.stringify(streams[0])).not.toContain(
      "socket_timeout_ms = 7351",
    );
    expect(JSON.stringify(streams[1])).toContain("socket_timeout_ms = 7351");
    expect(JSON.stringify(outcome.chunks)).toContain("7351, not 5000");
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("answers from original evidence absent from the committed compacted claims", async () => {
    const early = originals[1].parts[0];
    if (early.type !== "text") throw new Error("fixture");
    early.text +=
      "\nHistorical decision: socket_timeout_ms = 7351, NOT 5000, because the deployed proxy requires it.";
    originals[originals.length - 1].parts = [
      {
        type: "text",
        text: "What socket_timeout_ms did we choose earlier, and why?",
      },
    ];
    const before = JSON.stringify(originals);
    const outcome = await run();
    expect(outcome.errors).toEqual([]);
    expect(JSON.stringify(view.revision?.claims)).not.toContain(
      "socket_timeout_ms",
    );
    expect(JSON.stringify(streams[0])).toContain(
      "Retrieved original conversation evidence",
    );
    expect(JSON.stringify(streams[0])).toContain("socket_timeout_ms = 7351");
    expect(JSON.stringify(outcome.chunks)).toContain("7351, not 5000");
    expect(JSON.stringify(originals)).toBe(before);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("extracts and publishes before the response, then preserves subsequent paired tool history", async () => {
    const before = JSON.stringify(originals);
    const outcome = await run();
    expect(outcome.errors).toEqual([]);
    expect(extracts.length).toBeGreaterThan(0);
    expect(extracts.length).toBeLessThanOrEqual(4);
    expect(streams).toHaveLength(2);
    expect(JSON.stringify(streams[0])).toContain(
      "Never remove workspace authorization. Keep port 1420.",
    );
    expect(JSON.stringify(streams[0])).toContain(
      "Derived conversation evidence",
    );
    expect(JSON.stringify(streams[1])).toContain("new-call");
    expect(JSON.stringify(streams[1])).toContain("Latest exact tool output");
    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(outcome.chargeCall).toHaveBeenCalledTimes(extracts.length);
    expect(outcome.optimized).toHaveBeenCalled();
    expect(maxActive).toBe(1);
    expect(sessionInference(owner.sessionId)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(originals)).toBe(before);
    expect(view.revision?.coverage.end).toBeLessThan(originals.length);
  });
  it("does not send the user request after a stale extraction result", async () => {
    changedDuringExtraction = true;
    const outcome = await run();
    expect(outcome.errors).toHaveLength(1);
    expect(streams).toHaveLength(0);
    expect(view.revision).toBeNull();
  });
  it("blocks a new oversized tool result before the next provider request", async () => {
    fixture.toolOutput = "x".repeat(150000);
    const outcome = await run();
    expect(outcome.errors).toHaveLength(1);
    expect(streams).toHaveLength(1);
    expect(fixture.execute).toHaveBeenCalledOnce();
  });
});
