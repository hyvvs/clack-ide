import { describe, expect, it } from "vitest";
import {
  isConvertedLocalAssetUrl,
  isPathInside,
  normalizeLocalPath,
  resolveMarkdownImageRenderSrc,
  resolveMarkdownImageSrc,
} from "./imagePolicy";

const root = "C:/repo";
const markdown = "C:/repo/docs/README.md";
const rootMarkdown = "C:/repo/README.md";

describe("normalizeLocalPath", () => {
  it("normalizes separators and dot segments", () => {
    expect(normalizeLocalPath("C:\\repo\\docs\\..\\image.png")).toBe(
      "C:/repo/image.png",
    );
  });
});

describe("isPathInside", () => {
  it("accepts the root and children", () => {
    expect(isPathInside("C:/repo", root)).toBe(true);
    expect(isPathInside("C:/repo/docs/a.png", root)).toBe(true);
  });

  it("rejects sibling prefixes", () => {
    expect(isPathInside("C:/repo-other/a.png", root)).toBe(false);
  });
});

describe("resolveMarkdownImageSrc", () => {
  it("resolves relative image paths from the Markdown file directory", () => {
    expect(
      resolveMarkdownImageSrc({
        src: "./screenshots/local-image.png",
        markdownPath: markdown,
        workspaceRoot: root,
      }),
    ).toEqual({
      kind: "local",
      path: "C:/repo/docs/screenshots/local-image.png",
    });
  });

  it("resolves paths without ./ from the Markdown file directory", () => {
    expect(
      resolveMarkdownImageSrc({
        src: "screenshots/local-image.png",
        markdownPath: markdown,
        workspaceRoot: root,
      }),
    ).toEqual({
      kind: "local",
      path: "C:/repo/docs/screenshots/local-image.png",
    });
  });

  it("resolves actual README-style workspace paths", () => {
    expect(
      resolveMarkdownImageSrc({
        src: "docs/screenshots/hero-now-playing.png",
        markdownPath: rootMarkdown,
        workspaceRoot: root,
      }),
    ).toEqual({
      kind: "local",
      path: "C:/repo/docs/screenshots/hero-now-playing.png",
    });
    expect(
      resolveMarkdownImageSrc({
        src: "public/orison-icon.png",
        markdownPath: rootMarkdown,
        workspaceRoot: root,
      }),
    ).toEqual({
      kind: "local",
      path: "C:/repo/public/orison-icon.png",
    });
  });

  it("resolves root-relative paths from the workspace root", () => {
    expect(
      resolveMarkdownImageSrc({
        src: "/screenshots/local-image.png",
        markdownPath: markdown,
        workspaceRoot: root,
      }),
    ).toEqual({
      kind: "local",
      path: "C:/repo/screenshots/local-image.png",
    });
  });

  it("blocks traversal outside the workspace", () => {
    expect(
      resolveMarkdownImageSrc({
        src: "../../secret.png",
        markdownPath: markdown,
        workspaceRoot: root,
      }),
    ).toMatchObject({
      kind: "blocked",
      reason: "image path is outside the workspace",
    });
  });

  it("blocks unsafe protocols", () => {
    expect(
      resolveMarkdownImageSrc({
        src: "javascript:alert(1)",
        markdownPath: markdown,
        workspaceRoot: root,
      }),
    ).toMatchObject({
      kind: "blocked",
      reason: "unsupported protocol: javascript",
    });
  });

  it("decodes URL-encoded local image paths", () => {
    expect(
      resolveMarkdownImageSrc({
        src: "screenshots/My%20Image.png",
        markdownPath: markdown,
        workspaceRoot: root,
      }),
    ).toEqual({
      kind: "local",
      path: "C:/repo/docs/screenshots/My Image.png",
    });
  });

  it("passes through http and https sources", () => {
    expect(
      resolveMarkdownImageSrc({
        src: "https://clack.dev/logo.png",
        markdownPath: markdown,
        workspaceRoot: root,
      }),
    ).toEqual({ kind: "remote", src: "https://clack.dev/logo.png" });
  });
});

describe("resolveMarkdownImageRenderSrc", () => {
  it("converts safe local paths into asset URLs", () => {
    expect(
      resolveMarkdownImageRenderSrc(
        {
          src: "docs/screenshots/hero-now-playing.png",
          markdownPath: rootMarkdown,
          workspaceRoot: root,
        },
        (path) => `http://asset.localhost/${encodeURIComponent(path)}`,
      ),
    ).toEqual({
      kind: "render",
      source: "local",
      path: "C:/repo/docs/screenshots/hero-now-playing.png",
      src: "http://asset.localhost/C%3A%2Frepo%2Fdocs%2Fscreenshots%2Fhero-now-playing.png",
    });
  });

  it("preserves local image query and hash suffixes", () => {
    expect(
      resolveMarkdownImageRenderSrc(
        {
          src: "screenshots/My%20Image.png?raw=1#preview",
          markdownPath: markdown,
          workspaceRoot: root,
        },
        (path) => `http://asset.localhost/${encodeURIComponent(path)}`,
      ),
    ).toMatchObject({
      kind: "render",
      source: "local",
      path: "C:/repo/docs/screenshots/My Image.png",
      src: "http://asset.localhost/C%3A%2Frepo%2Fdocs%2Fscreenshots%2FMy%20Image.png?raw=1#preview",
    });
  });
});

describe("isConvertedLocalAssetUrl", () => {
  it("recognizes Tauri asset URL shapes", () => {
    expect(isConvertedLocalAssetUrl("http://asset.localhost/C%3A%2Ffile.png")).toBe(
      true,
    );
    expect(isConvertedLocalAssetUrl("asset://localhost/%2Ffile.png")).toBe(true);
    expect(isConvertedLocalAssetUrl("https://example.com/file.png")).toBe(false);
  });
});
