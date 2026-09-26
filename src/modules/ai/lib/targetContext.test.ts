import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  contextDigest,
  createTargetDraft,
  targetContextKey,
  type SwitchSource,
} from "@/modules/ai/lib/targetContext";
import type {
  MemoryCandidate,
  MemoryRevision,
} from "@/modules/ai/lib/conversationMemory";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const input: Parameters<typeof targetContextKey>[0] = {
  modelId: "compat-test",
  configuration: {
    customEndpoints: [
      {
        id: "test",
        name: "Target",
        modelId: "actual-model",
        baseURL: "http://localhost:1234/v1",
        contextLimit: 8192,
      },
    ],
  },
  system: [{ role: "system", content: "Keep authorization." }],
  tools: { read_file: { inputSchema: { type: "object" } } },
  limits: { deployed: 8192, outputReserve: 1024 },
  capabilities: {
    text: "supported",
    image: "unknown",
    tools: "supported",
    audio: "unknown",
    document: "unknown",
    evidence: "server",
  },
  permissions: { agent: "read-only" },
  workspace: ["local:/workspace", "agent-a"],
  credentials: ["credential-revision-a"],
};
beforeEach(() => vi.clearAllMocks());

describe("target snapshot identity", () => {
  it("hashes numeric object keys in native lexical order", async () => {
    const { createHash } = await import("node:crypto");
    expect(await contextDigest({ "2": "second", "10": "tenth" })).toBe(
      createHash("sha256").update('{"10":"tenth","2":"second"}').digest("hex"),
    );
  });
  it("is deterministic regardless of object property order", async () => {
    expect(await contextDigest({ b: 1, a: { z: 3, c: 2 } })).toBe(
      await contextDigest({ a: { c: 2, z: 3 }, b: 1 }),
    );
    expect(await targetContextKey(structuredClone(input))).toBe(
      await targetContextKey(input),
    );
  });
  it.each([
    [
      "model",
      (v: typeof input) => {
        const endpoint = v.configuration.customEndpoints?.[0];
        if (!endpoint) throw new Error("fixture");
        endpoint.modelId = "other-model";
      },
    ],
    [
      "endpoint",
      (v: typeof input) => {
        const endpoint = v.configuration.customEndpoints?.[0];
        if (!endpoint) throw new Error("fixture");
        endpoint.baseURL = "https://other.example/v1";
      },
    ],
    [
      "deployment",
      (v: typeof input) => {
        v.limits.deployed = 4096;
      },
    ],
    [
      "output reserve",
      (v: typeof input) => {
        v.limits.outputReserve = 2048;
      },
    ],
    [
      "system requirements",
      (v: typeof input) => {
        v.system = [{ role: "system", content: "Changed requirements." }];
      },
    ],
    [
      "tool schemas",
      (v: typeof input) => {
        v.tools = { other: {} };
      },
    ],
    [
      "permissions",
      (v: typeof input) => {
        v.permissions = { agent: "chat-only" };
      },
    ],
    [
      "workspace",
      (v: typeof input) => {
        v.workspace = ["local:/other", "agent-a"];
      },
    ],
    [
      "agent",
      (v: typeof input) => {
        v.workspace = ["local:/workspace", "agent-b"];
      },
    ],
    [
      "credential revision",
      (v: typeof input) => {
        v.credentials = ["credential-revision-b"];
      },
    ],
    [
      "tools capability",
      (v: typeof input) => {
        v.capabilities.tools = "unsupported";
      },
    ],
    [
      "image capability",
      (v: typeof input) => {
        v.capabilities.image = "supported";
      },
    ],
    [
      "working target",
      (v: typeof input) => {
        v.limits.workingTarget = 2000;
      },
    ],
  ] as const)("invalidates %s changes", async (_, change) => {
    const changed = structuredClone(input);
    change(changed);
    expect(await targetContextKey(changed)).not.toBe(
      await targetContextKey(input),
    );
  });
});

function source(): SwitchSource {
  return {
    token: "switch:issued",
    settingsHash: "a".repeat(64),
    session: { id: "chat", title: "A", createdAt: 1, updatedAt: 1 },
    view: {
      preparation: {
        owner: { sessionId: "chat", workspaceId: null },
        runtimeId: "process",
        previous: null,
        generation: 0,
        source: {
          transcriptHash: "a".repeat(64),
          profileHash: "b".repeat(64),
          transcriptRevision: 1,
          profileRevision: 1,
        },
      },
      revision: null,
      revisionId: null,
      uncoveredMessages: 3,
      sourceChanged: false,
    },
  };
}
function candidate(s: SwitchSource): MemoryCandidate {
  return {
    preparation: s.view.preparation,
    start: 0,
    end: 1,
    policyVersion: "c1b-extraction-v1",
    claims: [],
    sources: [{ kind: "message", messageId: "m" }],
  };
}
function revision(c: MemoryCandidate): MemoryRevision {
  return {
    schemaVersion: 1,
    preparation: c.preparation,
    revision: 1,
    createdAt: 1,
    producer: {},
    policyVersion: c.policyVersion,
    coverage: {
      start: 0,
      end: c.end,
      digest: "c".repeat(64),
      latestMessageId: "m",
      sourceMessageCount: 3,
    },
    claims: c.claims,
    evidence: [
      {
        id: "d".repeat(64),
        locator: { kind: "message", messageId: "m" },
        digest: "e".repeat(64),
        sourceRevision: 1,
        contentIds: [],
        relatedSessions: ["chat"],
      },
    ],
  };
}
describe("uncommitted target drafts", () => {
  it("keeps original memory unchanged and resolves staged citations back to originals", async () => {
    const captured = source();
    const before = structuredClone(captured);
    const draft = createTargetDraft(captured);
    vi.mocked(invoke).mockImplementation(async (_, args) =>
      revision((args as { candidate: MemoryCandidate }).candidate),
    );
    const id = await draft.memory.commit(candidate(captured));
    expect(captured).toEqual(before);
    await draft.memory.commit({
      ...candidate(captured),
      end: 2,
      sources: [
        { kind: "retained", revisionId: id, evidenceId: "d".repeat(64) },
      ],
    });
    expect(draft.candidate()?.sources).toEqual([
      { kind: "message", messageId: "m" },
    ]);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(([command]) => command === "target_context_preview"),
    ).toBe(true);
  });
  it("does not activate failed or cancelled preview responses", async () => {
    const captured = source();
    const draft = createTargetDraft(captured);
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk error"));
    await expect(draft.memory.commit(candidate(captured))).rejects.toThrow();
    expect(draft.candidate()).toBeNull();
    const controller = new AbortController();
    vi.mocked(invoke).mockImplementationOnce(async () => {
      controller.abort();
      return revision(candidate(captured));
    });
    await expect(
      draft.memory.commit(candidate(captured), controller.signal),
    ).rejects.toThrow();
    expect(draft.candidate()).toBeNull();
    expect(draft.view()).toEqual(captured.view);
  });
  it("retains an earlier valid draft if a later batch fails", async () => {
    const captured = source();
    const draft = createTargetDraft(captured);
    vi.mocked(invoke).mockResolvedValueOnce(revision(candidate(captured)));
    await draft.memory.commit(candidate(captured));
    const before = structuredClone(draft.view());
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error("memory_stale_preparation"),
    );
    await expect(
      draft.memory.commit({ ...candidate(captured), end: 2 }),
    ).rejects.toThrow();
    expect(draft.view()).toEqual(before);
  });
});
