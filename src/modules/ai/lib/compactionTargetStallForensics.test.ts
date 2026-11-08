/** Offline diagnostic: Agent's target_context_load precedes extractor creation.
 * This exercises the actual native-command wrapper, never a native host/model.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadTargetContext } from "@/modules/ai/lib/targetContext";
import { COMPACTION_POLICY } from "@/modules/ai/lib/compactionExtraction";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("target preparation has no extractor-owned deadline", () => {
  it("5b: unresolved native target load does not settle at the extractor deadline", async () => {
    vi.useFakeTimers();
    let release!: (value: null) => void;
    const native = new Promise<null>(resolve => { release = resolve; });
    vi.mocked(invoke).mockReturnValueOnce(native);
    const owner = { sessionId: "offline-forensics", workspaceId: "local:/workspace" };
    const result = loadTargetContext(owner, "offline-context-key");
    let phase: "pending" | "finished" = "pending";
    const settled = result.finally(() => { phase = "finished"; });

    await vi.advanceTimersByTimeAsync(COMPACTION_POLICY.timeoutMs + 1);
    expect(phase).toBe("pending");
    expect(invoke).toHaveBeenCalledWith("target_context_load", {
      owner, key: "offline-context-key",
    });

    release(null);
    expect(await settled).toBeNull();
    expect(phase).toBe("finished");
  });
});
