import { describe, expect, it } from "vitest";
import { CLACK_Z_INDEX, CLACK_Z_INDEX_CEILING } from "@/lib/layers";

describe("app z-index layers", () => {
  it("keeps visual background effects below file content", () => {
    expect(CLACK_Z_INDEX.backgroundEffects).toBeLessThan(
      CLACK_Z_INDEX.fileContent,
    );
  });

  it("keeps file content below app overlays", () => {
    expect(CLACK_Z_INDEX.fileContent).toBeLessThan(
      CLACK_Z_INDEX.miniWindow,
    );
    expect(CLACK_Z_INDEX.miniWindow).toBeLessThan(CLACK_Z_INDEX.floatingUi);
  });

  it("keeps app layers out of max z-index ranges", () => {
    expect(Math.max(...Object.values(CLACK_Z_INDEX))).toBeLessThan(
      CLACK_Z_INDEX_CEILING,
    );
  });
});
