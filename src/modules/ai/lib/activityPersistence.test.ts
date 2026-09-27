import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
const { disk, invoke } = vi.hoisted(() => {
  const disk = new Map<string, unknown>();
  return {
    disk,
    invoke: vi.fn(
      async (command: string, args: { key: string; value?: unknown }) => {
        if (command === "conversation_source_set") {
          disk.set(args.key, JSON.parse(JSON.stringify(args.value)));
          return;
        }
        if (command === "conversation_session_get")
          return structuredClone(disk.get(args.key) ?? null);
        throw new Error(`Unexpected IPC ${command}`);
      },
    ),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import {
  saveMessages,
  loadMessages,
  recoverInterruptedSessions,
} from "@/modules/ai/lib/sessions";
import {
  conversationActivity,
  createActivityRecorder,
} from "@/modules/ai/lib/activity";

describe("activity through existing session persistence (native IPC fixture)", () => {
  it("retains transcripts and activity across load/recovery without duplicate entries or new stores", async () => {
    const recorder = createActivityRecorder({
      sessionId: "chat",
      runId: "chat:1",
      workspaceId: "workspace",
      providerId: "openai",
    });
    recorder.observe({ type: "reasoning-start", id: "r" });
    const messages: UIMessage[] = [
      {
        id: "m",
        role: "assistant",
        parts: [{ type: "reasoning", text: "partial", state: "streaming" }],
        metadata: { clackActivity: recorder.snapshot() },
      },
    ];
    await saveMessages("chat", messages);
    const first = await loadMessages("chat");
    const second = await loadMessages("chat");
    if (!first || !second) throw new Error("Missing persisted messages");
    expect(first).toEqual(messages);
    expect(second).toEqual(first);
    const recovered = recoverInterruptedSessions(
      [
        {
          id: "chat",
          title: "Renamed",
          createdAt: 1,
          updatedAt: 1,
          run: { state: "running", startedAt: 1, workspaceId: "workspace" },
        },
      ],
      100,
    );
    const events = conversationActivity(
      first,
      [],
      "chat",
      "workspace",
      recovered.sessions[0].run,
    );
    expect(events.map((e) => e.label)).toContain("Run interrupted");
    expect(
      conversationActivity(
        second,
        [],
        "chat",
        "workspace",
        recoverInterruptedSessions(recovered.sessions, 200).sessions[0].run,
      ),
    ).toEqual(events);
    expect([...disk.keys()]).toEqual(["messages:chat"]);
    expect(
      invoke.mock.calls.filter((call) => call[0] === "conversation_source_set"),
    ).toHaveLength(1);
  });
});
