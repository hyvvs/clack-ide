import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { awaitSessionWrites } from "@/modules/ai/lib/sessions";
import {
  projectMemoryClient,
  projectSlice,
  projectSources,
  type ProjectMemoryView,
} from "@/modules/ai/lib/projectMemory";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/modules/ai/lib/sessions", () => ({
  awaitSessionWrites: vi.fn(async () => {}),
}));
beforeEach(() => vi.clearAllMocks());
const view: ProjectMemoryView = {
  workspace: "local:/work",
  checkout: "local:/work",
  baseSha: null,
  revision: 5,
  entries: [],
};
const source = {
  key: "m:0",
  label: "source",
  text: "Private. Use port 1420. Private.",
  locator: { kind: "part" as const, messageId: "m", partIndex: 0 },
};

describe("project memory ownership client", () => {
  it("bounds the source picker to the latest 128 eligible parts", () => {
    const sources = projectSources(
      Array.from({ length: 200 }, (_, i) => ({
        id: `m-${i}`,
        role: "user" as const,
        parts: [{ type: "text" as const, text: `Requirement ${i}` }],
      })),
    );
    expect(sources).toHaveLength(128);
    expect(sources[0].text).toBe("Requirement 72");
    expect(sources[127].text).toBe("Requirement 199");
  });
  it("offers only original user requirements and completed tool output", () => {
    const sources = projectSources([
      { id: "m", role: "user", parts: [{ type: "text", text: source.text }] },
      {
        id: "a",
        role: "assistant",
        parts: [
          { type: "text", text: "Unsupported assertion" },
          { type: "reasoning", text: "private" },
          {
            type: "tool-read_file",
            toolCallId: "call",
            state: "output-available",
            input: { path: "design.txt" },
            output: "Original result",
          },
        ],
      },
    ]);
    expect(sources.map((s) => s.text)).toEqual([
      source.text,
      "Original result",
    ]);
    expect(sources[1].locator).toEqual({
      kind: "part",
      messageId: "a",
      partIndex: 2,
    });
  });
  it("uses UTF-8 source spans without surrounding private context", () => {
    expect(projectSlice("caf\u00e9: Use port 1420.", "Use port 1420.")).toEqual(
      { start: 7, end: 21 },
    );
  });
  it.each([
    "",
    "invented",
    "x".repeat(4097),
  ])("rejects invalid or oversized excerpt", (excerpt) => {
    expect(() => projectSlice(source.text, excerpt)).toThrow();
  });
  it("binds reads to the caller conversation, not a supplied project ID", async () => {
    await projectMemoryClient("a").load();
    expect(invoke).toHaveBeenCalledWith("project_memory_load", {
      sessionId: "a",
    });
  });
  it("waits for durable originals and proposes only a bounded source reference", async () => {
    await projectMemoryClient("a").propose(
      view,
      source,
      "Use port 1420.",
      "requirements",
    );
    expect(awaitSessionWrites).toHaveBeenCalledWith("a");
    expect(invoke).toHaveBeenCalledWith("project_memory_propose", {
      sessionId: "a",
      expectedRevision: 5,
      proposal: {
        locator: source.locator,
        start: 9,
        end: 23,
        section: "requirements",
        conflicts: [],
      },
    });
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain(
      "Private",
    );
  });
  it("cannot serialize or bypass native confirmation with a boolean grant", async () => {
    await projectMemoryClient("a").decide(view, "record", { kind: "approve" });
    expect(invoke).toHaveBeenCalledWith("project_memory_decide", {
      sessionId: "a",
      expectedRevision: 5,
      id: "record",
      decision: { kind: "approve" },
    });
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain(
      "confirmed",
    );
  });
  it("inspection is revision-bound and uses no generic blob/file read", async () => {
    await projectMemoryClient("b").inspect(view, "record");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("project_memory_inspect", {
      sessionId: "b",
      expectedRevision: 5,
      id: "record",
    });
  });
  it("correction/revocation preserve expected revision and source owner", async () => {
    const client = projectMemoryClient("b");
    await client.decide(view, "record", {
      kind: "correct",
      text: "New explicit instruction",
    });
    await client.decide(view, "record", { kind: "revoke" });
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(
          ([, args]) =>
            (args as { expectedRevision: number }).expectedRevision === 5,
        ),
    ).toBe(true);
  });
  it("rejects invalid categories without making an IPC request", async () => {
    await expect(
      projectMemoryClient("a").propose(
        view,
        source,
        "Use port 1420.",
        "global",
      ),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("propagates stale and unauthorized native failures instead of retrying with broader scope", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error("project_stale_revision"),
    );
    await expect(
      projectMemoryClient("a").inspect(view, "record"),
    ).rejects.toThrow("project_stale_revision");
    expect(invoke).toHaveBeenCalledOnce();
  });
});
