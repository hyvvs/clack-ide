import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  cancelConversationMemory,
  commitConversationMemory,
  inspectMemorySources,
  loadConversationMemory,
  onConversationMemoryChanged,
  readMemoryEvidence,
  type MemoryCandidate,
  type MemoryPreparation,
} from "@/modules/ai/lib/conversationMemory";
import {
  deleteSessionData,
  loadAll,
  loadMessages,
  saveMessages,
  saveSessionsList,
} from "@/modules/ai/lib/sessions";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  entries: vi.fn(),
  get: vi.fn(),
  reconcile: vi.fn().mockResolvedValue({ removedCount: 0, issues: [] }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    entries = mocks.entries;
    get = mocks.get;
  },
}));
vi.mock("@/modules/ai/lib/attachmentStore", () => ({
  reconcileAttachmentContent: mocks.reconcile,
  storeAttachmentContent: vi.fn(),
}));
vi.mock("@/modules/ai/lib/peerTasks", () => ({
  loadPeerTasks: vi.fn().mockResolvedValue([]),
  collectPeerTaskContentIds: vi.fn().mockReturnValue([]),
}));

const owner = { sessionId: "chat-a", workspaceId: "local:/project" };
const preparation: MemoryPreparation = {
  runtimeId: "test-process",
  owner,
  source: {
    transcriptRevision: 1,
    profileRevision: 1,
    transcriptHash: "a".repeat(64),
    profileHash: "b".repeat(64),
  },
  generation: 1,
  previous: null,
};
const candidate: MemoryCandidate = {
  preparation,
  policyVersion: "test",
  start: 0,
  end: 1,
  sources: [{ kind: "message", messageId: "u1" }],
  claims: [],
};
const message: UIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "Keep originals." }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockReset().mockImplementation((command: string) => {
    if (command === "conversation_session_entries") return mocks.entries();
    if (command === "conversation_session_get") return mocks.get();
    return Promise.resolve();
  });
  mocks.entries.mockResolvedValue([]);
  mocks.get.mockResolvedValue(null);
});

describe("conversation memory native integration boundary", () => {
  it("loads only the explicit conversation and workspace owner", async () => {
    const view = { preparation, revision: null };
    mocks.invoke.mockResolvedValue(view);
    expect(await loadConversationMemory(owner)).toBe(view);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "conversation_memory_load",
      { owner },
    );
  });

  it("carries the complete source revision and expected predecessor to publication", async () => {
    mocks.invoke.mockResolvedValue("revision-id");
    expect(await commitConversationMemory(candidate)).toBe("revision-id");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "conversation_memory_commit",
      { candidate },
    );
  });

  it("never publishes an already cancelled preparation", async () => {
    await expect(
      commitConversationMemory(candidate, AbortSignal.abort()),
    ).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("cancels the captured generation without cancelling a later preparation", async () => {
    let settle: (value: string) => void = () => undefined;
    mocks.invoke.mockImplementation((command: string) =>
      command === "conversation_memory_commit"
        ? new Promise<string>((resolve) => {
            settle = resolve;
          })
        : Promise.resolve(),
    );
    const controller = new AbortController();
    const pending = commitConversationMemory(candidate, controller.signal);
    controller.abort();
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "conversation_memory_cancel",
      { preparation },
    );
    // An atomic publication that already won the race reports its real outcome.
    settle("committed-before-cancel");
    expect(await pending).toBe("committed-before-cancel");
  });

  it("removes abort listeners when publication settles", async () => {
    const controller = new AbortController();
    await commitConversationMemory(candidate, controller.signal);
    controller.abort();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("exposes recoverable storage errors without substituting generated content", async () => {
    mocks.invoke.mockRejectedValue("memory_integrity_failed");
    await expect(loadConversationMemory(owner)).rejects.toBe(
      "memory_integrity_failed",
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("inspects evidence against the captured source revision", async () => {
    await inspectMemorySources(preparation, candidate.sources);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "conversation_memory_sources",
      { preparation, sources: candidate.sources },
    );
  });

  it("resolves immutable evidence by revision and identity, never by a path", async () => {
    await readMemoryEvidence(owner, "revision-id", "evidence-id");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "conversation_memory_evidence",
      { owner, revisionId: "revision-id", evidenceId: "evidence-id" },
    );
  });

  it("uses native change events for cross-window observers", async () => {
    const callback = vi.fn();
    const unlisten = vi.fn();
    mocks.listen.mockImplementation(
      async (_name: string, listener: (event: { payload: string }) => void) => {
        listener({ payload: "chat-a" });
        return unlisten;
      },
    );
    expect(await onConversationMemoryChanged(callback)).toBe(unlisten);
    expect(callback).toHaveBeenCalledExactlyOnceWith("chat-a");
  });

  it("supports explicit cancellation without a provider request", async () => {
    await cancelConversationMemory(preparation);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "conversation_memory_cancel",
      { preparation },
    );
  });
});

describe("existing session persistence integration", () => {
  it("keeps messages unchanged while sharing the native publication lock", async () => {
    const before = JSON.stringify(message);
    await saveMessages("chat-a", [message]);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "conversation_source_set",
      { key: "messages:chat-a", value: [message] },
    );
    expect(JSON.stringify(message)).toBe(before);
  });

  it("routes profiles through the same existing session store ownership", async () => {
    const sessions = [
      { id: "chat-a", title: "Renamed", createdAt: 1, updatedAt: 2 },
    ];
    await saveSessionsList(sessions);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "conversation_source_set",
      { key: "sessions", value: sessions },
    );
  });

  it("keeps same-chat write order while unrelated chats persist independently", async () => {
    let release: () => void = () => undefined;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = saveMessages("ordered", [message]);
    const second = saveMessages("ordered", [{ ...message, id: "later" }]);
    const independent = saveMessages("independent", [message]);
    await independent;
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    release();
    await first;
    await second;
    expect(mocks.invoke).toHaveBeenLastCalledWith("conversation_source_set", {
      key: "messages:ordered",
      value: [{ ...message, id: "later" }],
    });
  });

  it("does not poison subsequent source writes after a failed save", async () => {
    mocks.invoke.mockRejectedValueOnce("disk unavailable");
    await expect(saveMessages("retry", [message])).rejects.toBe(
      "disk unavailable",
    );
    await saveMessages("retry", [message]);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("invalidates durable memory before reconciling attachment deletion", async () => {
    await deleteSessionData("chat-a");
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "conversation_source_delete",
      { sessionId: "chat-a" },
    );
    expect(mocks.reconcile).toHaveBeenCalled();
    expect(mocks.invoke.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reconcile.mock.invocationCallOrder[0],
    );
  });

  it("loads legacy sessions without creating memory or changing original messages", async () => {
    mocks.entries.mockResolvedValue([
      ["sessions", [{ id: "legacy", title: "Legacy" }]],
      ["messages:legacy", [message]],
    ]);
    mocks.get.mockResolvedValue([message]);
    expect((await loadAll()).sessions[0].id).toBe("legacy");
    expect(await loadMessages("legacy")).toEqual([message]);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "conversation_session_entries",
      "conversation_session_get",
    ]);
  });
});
