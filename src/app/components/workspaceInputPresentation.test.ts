import { describe, expect, it } from "vitest";
import { resolveWorkspaceInputPresentation } from "./workspaceInputPresentation";

describe("workspace input presentation", () => {
  it("keeps the AI dock open whenever the AI experience is open", () => {
    expect(
      resolveWorkspaceInputPresentation({
        isBlockTab: false,
        hasComposer: true,
        mode: "shell",
        keysLoaded: true,
        panelOpen: true,
      }),
    ).toMatchObject({
      mounted: true,
      open: true,
      effectiveMode: "ai",
    });
  });

  it("keeps the Shell and AI selector available on block terminals", () => {
    expect(
      resolveWorkspaceInputPresentation({
        isBlockTab: true,
        hasComposer: true,
        mode: "ai",
        keysLoaded: true,
        panelOpen: true,
      }),
    ).toMatchObject({
      showToggle: true,
      effectiveMode: "ai",
      open: true,
    });
  });
});
