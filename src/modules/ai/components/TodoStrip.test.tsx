import { describe, expect, it } from "vitest";
import { shouldShowTodoStrip } from "@/modules/ai/components/TodoStrip";

describe("active TodoStrip visibility", () => {
  it("shows only non-empty active-run todos", () => {
    expect(shouldShowTodoStrip("running", 3)).toBe(true);
    expect(shouldShowTodoStrip("running", 0)).toBe(false);
  });

  it.each(["completed", "cancelled", "interrupted", "failed"])(
    "hides terminal %s todos",
    (state) => {
      expect(shouldShowTodoStrip(state, 3)).toBe(false);
    },
  );
});
