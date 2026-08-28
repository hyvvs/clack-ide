import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getConfiguredBackgroundStyle } from "./ConfiguredBackgroundLayer";

const readSource = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8");

describe("configured background layer", () => {
  it("uses the same wallpaper appearance for viewport and contained surfaces", () => {
    const shared = {
      url: "blob:configured-wallpaper",
      blur: 14,
      blurActive: true,
      renderedOpacity: 0.32,
      suspendAnimated: false,
    };
    const viewport = getConfiguredBackgroundStyle({
      ...shared,
      placement: "viewport",
    });
    const contained = getConfiguredBackgroundStyle({
      ...shared,
      placement: "contained",
    });

    expect(contained.backgroundImage).toBe(viewport.backgroundImage);
    expect(contained.backgroundSize).toBe(viewport.backgroundSize);
    expect(contained.backgroundPosition).toBe(viewport.backgroundPosition);
    expect(contained.opacity).toBe(viewport.opacity);
    expect(contained.filter).toBe(viewport.filter);
    expect(contained.transition).toBe(viewport.transition);
  });

  it("keeps a contained wallpaper absolute within its positioned owner", () => {
    const style = getConfiguredBackgroundStyle({
      placement: "contained",
      url: "blob:configured-wallpaper",
      blur: 12,
      blurActive: true,
      renderedOpacity: 0.3,
      suspendAnimated: false,
    });
    expect(style).toMatchObject({
      position: "absolute",
      inset: 0,
      zIndex: 0,
      pointerEvents: "none",
    });
  });

  it("preserves fixed viewport positioning for Settings", () => {
    const style = getConfiguredBackgroundStyle({
      placement: "viewport",
      url: "blob:configured-wallpaper",
      blur: 12,
      blurActive: true,
      renderedOpacity: 0.3,
      suspendAnimated: false,
    });
    expect(style).toMatchObject({
      position: "fixed",
      inset: 0,
      zIndex: 10,
      pointerEvents: "none",
    });
  });

  it("wires Settings and AI Chat to the same configured renderer", () => {
    const settingsSurface = readSource(
      "src",
      "modules",
      "theme",
      "SurfaceLayer.tsx",
    );
    const aiWindow = readSource(
      "src",
      "modules",
      "ai",
      "components",
      "AiMiniWindow.tsx",
    );
    const renderer = readSource(
      "src",
      "modules",
      "theme",
      "ConfiguredBackgroundLayer.tsx",
    );

    expect(settingsSurface).toContain(
      '<ConfiguredBackgroundLayer placement="viewport" />',
    );
    expect(aiWindow).toContain(
      '<ConfiguredBackgroundLayer placement="contained" />',
    );
    expect(renderer).toContain("s.backgroundImageId");
    expect(renderer).toContain("s.backgroundOpacity");
    expect(renderer).toContain("s.backgroundBlur");
    expect(renderer).toContain("opacity * BG_OPACITY_RENDER_FACTOR");
  });
});
