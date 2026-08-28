import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { native } from "../lib/native";
import { usePlanStore } from "./planStore";

describe("plan application conflict safety", () => {
  beforeEach(() => {
    usePlanStore.setState({ active: true, queue: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    usePlanStore.setState({ active: false, queue: [] });
  });

  it("applies an unchanged queued file", async () => {
    vi.spyOn(native, "readFile").mockResolvedValue({
      kind: "text",
      content: "before",
      size: 6,
    });
    const write = vi.spyOn(native, "writeFile").mockResolvedValue();
    usePlanStore.getState().enqueue({
      id: "edit-a",
      kind: "edit",
      path: "/work/file.ts",
      originalContent: "before",
      proposedContent: "after",
      isNewFile: false,
    });

    await expect(usePlanStore.getState().applyAll()).resolves.toEqual([
      { id: "edit-a", ok: true },
    ]);
    expect(write).toHaveBeenCalledWith("/work/file.ts", "after", undefined);
  });

  it("refuses to overwrite a file changed after it entered the plan", async () => {
    vi.spyOn(native, "readFile").mockResolvedValue({
      kind: "text",
      content: "changed elsewhere",
      size: 17,
    });
    const write = vi.spyOn(native, "writeFile").mockResolvedValue();
    usePlanStore.getState().enqueue({
      id: "edit-a",
      kind: "edit",
      path: "/work/file.ts",
      originalContent: "before",
      proposedContent: "after",
      isNewFile: false,
    });

    const [result] = await usePlanStore.getState().applyAll();

    expect(result).toMatchObject({ id: "edit-a", ok: false });
    expect(result.error).toContain("changed after this chat read it");
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a planned create when the path now exists", async () => {
    vi.spyOn(native, "readFile").mockResolvedValue({
      kind: "text",
      content: "user file",
      size: 9,
    });
    const write = vi.spyOn(native, "writeFile").mockResolvedValue();
    usePlanStore.getState().enqueue({
      id: "create-a",
      kind: "write_file",
      path: "/work/new.ts",
      originalContent: "",
      proposedContent: "agent file",
      isNewFile: true,
    });

    const [result] = await usePlanStore.getState().applyAll();

    expect(result).toMatchObject({ id: "create-a", ok: false });
    expect(result.error).toContain("now exists");
    expect(write).not.toHaveBeenCalled();
  });
});
