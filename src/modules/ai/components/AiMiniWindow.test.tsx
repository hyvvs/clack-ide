import { describe, expect, it, vi } from "vitest";
import { invokeHeaderStop, shouldShowHeaderStop } from "./AiMiniWindow";

describe("AI header Stop", () => {
  it("appears only for an active run", () => {
    expect(shouldShowHeaderStop("running")).toBe(true);
    expect(shouldShowHeaderStop("cancelled")).toBe(false);
    expect(shouldShowHeaderStop("interrupted")).toBe(false);
    expect(shouldShowHeaderStop("completed")).toBe(false);
    expect(shouldShowHeaderStop("failed")).toBe(false);
    expect(shouldShowHeaderStop(undefined)).toBe(false);
  });

  it("uses one cancellation callback", async () => {
    const cancel = vi.fn(async () => {});
    await invokeHeaderStop(cancel);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
