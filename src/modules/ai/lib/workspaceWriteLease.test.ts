import { afterEach, describe, expect, it } from "vitest";
import {
  acquireWorkspaceWriteLease,
  clearWorkspaceWriteLeasesForTests,
  currentWorkspaceWriteLease,
  releaseWorkspaceWriteLeasesForSession,
} from "./workspaceWriteLease";

describe("workspace write leases", () => {
  afterEach(() => {
    clearWorkspaceWriteLeasesForTests();
  });

  it("grants one writer and queues the next writer in FIFO order", async () => {
    const first = await acquireWorkspaceWriteLease({
      workspaceId: "local:/repo",
      sessionId: "chat-a",
      agentId: "coder",
    });
    expect(first).toMatchObject({ ok: true, waited: false });

    let secondResolved = false;
    const secondPromise = acquireWorkspaceWriteLease({
      workspaceId: "local:/repo",
      sessionId: "chat-b",
      agentId: "reviewer",
    }).then((result) => {
      secondResolved = true;
      return result;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    releaseWorkspaceWriteLeasesForSession("chat-a");
    await expect(secondPromise).resolves.toMatchObject({
      ok: true,
      waited: true,
      lease: { ownerSessionId: "chat-b" },
    });
  });

  it("is reentrant for one logical run", async () => {
    const first = await acquireWorkspaceWriteLease({
      workspaceId: "local:/repo",
      sessionId: "chat-a",
      agentId: "coder",
    });
    const second = await acquireWorkspaceWriteLease({
      workspaceId: "local:/repo",
      sessionId: "chat-a",
      agentId: "coder",
    });

    expect(first).toMatchObject({ ok: true, waited: false });
    expect(second).toMatchObject({ ok: true, waited: false });
    expect(currentWorkspaceWriteLease("local:/repo")?.ownerSessionId).toBe(
      "chat-a",
    );
  });

  it("keeps distinct workspaces independent", async () => {
    const [first, second] = await Promise.all([
      acquireWorkspaceWriteLease({
        workspaceId: "local:/repo-a",
        sessionId: "chat-a",
        agentId: "coder",
      }),
      acquireWorkspaceWriteLease({
        workspaceId: "local:/repo-b",
        sessionId: "chat-b",
        agentId: "reviewer",
      }),
    ]);

    expect(first).toMatchObject({ ok: true, waited: false });
    expect(second).toMatchObject({ ok: true, waited: false });
  });

  it("removes an aborted waiter without disturbing the owner", async () => {
    await acquireWorkspaceWriteLease({
      workspaceId: "local:/repo",
      sessionId: "chat-a",
      agentId: "coder",
    });
    const controller = new AbortController();
    const waiting = acquireWorkspaceWriteLease({
      workspaceId: "local:/repo",
      sessionId: "chat-b",
      agentId: "reviewer",
      signal: controller.signal,
    });

    controller.abort();

    await expect(waiting).resolves.toMatchObject({
      ok: false,
      code: "workspace_write_wait_cancelled",
    });
    expect(currentWorkspaceWriteLease("local:/repo")?.ownerSessionId).toBe(
      "chat-a",
    );
  });

  it("cancels a queued session during cleanup", async () => {
    await acquireWorkspaceWriteLease({
      workspaceId: "local:/repo",
      sessionId: "chat-a",
      agentId: "coder",
    });
    const waiting = acquireWorkspaceWriteLease({
      workspaceId: "local:/repo",
      sessionId: "chat-b",
      agentId: "reviewer",
    });

    releaseWorkspaceWriteLeasesForSession("chat-b");

    await expect(waiting).resolves.toMatchObject({
      ok: false,
      code: "workspace_write_wait_cancelled",
    });
  });
});
