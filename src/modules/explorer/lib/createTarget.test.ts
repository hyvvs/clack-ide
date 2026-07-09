import { describe, expect, it } from "vitest";
import {
  duplicateCreateMessage,
  existingNameConflict,
  isDotfileName,
  resolveCreateTarget,
  validateCreateName,
} from "./createTarget";
import type { DirEntry } from "./useFileTree";

const root = "C:/repo";

function entry(name: string, kind: DirEntry["kind"] = "file"): DirEntry {
  return {
    name,
    kind,
    size: 0,
    mtime: 0,
    gitignored: false,
  };
}

describe("resolveCreateTarget", () => {
  it("targets a right-clicked folder", () => {
    expect(
      resolveCreateTarget({
        rootPath: root,
        contextEntry: { path: `${root}/folder-a`, isDir: true },
        source: "context",
      }),
    ).toBe(`${root}/folder-a`);
  });

  it("targets the parent of a right-clicked file", () => {
    expect(
      resolveCreateTarget({
        rootPath: root,
        contextEntry: { path: `${root}/folder-a/file-1.txt`, isDir: false },
        source: "context",
      }),
    ).toBe(`${root}/folder-a`);
  });

  it("targets the explorer location for empty explorer space", () => {
    expect(
      resolveCreateTarget({
        rootPath: root,
        explorerLocation: `${root}/folder-a`,
        source: "empty",
      }),
    ).toBe(`${root}/folder-a`);
  });

  it("targets one selected folder from the toolbar", () => {
    expect(
      resolveCreateTarget({
        rootPath: root,
        selectedEntries: [{ path: `${root}/folder-a`, isDir: true }],
        source: "toolbar",
      }),
    ).toBe(`${root}/folder-a`);
  });

  it("targets a selected file parent from the toolbar", () => {
    expect(
      resolveCreateTarget({
        rootPath: root,
        selectedEntries: [{ path: `${root}/folder-a/file-1.txt`, isDir: false }],
        source: "toolbar",
      }),
    ).toBe(`${root}/folder-a`);
  });

  it("targets the explorer location for multi-selection toolbar creates", () => {
    expect(
      resolveCreateTarget({
        rootPath: root,
        explorerLocation: root,
        selectedEntries: [
          { path: `${root}/folder-a`, isDir: true },
          { path: `${root}/folder-b`, isDir: true },
        ],
        source: "toolbar",
      }),
    ).toBe(root);
  });

  it("returns null when no workspace or explorer location exists", () => {
    expect(resolveCreateTarget({ rootPath: null, source: "toolbar" })).toBeNull();
  });
});

describe("validateCreateName", () => {
  it("allows ordinary names and dotfiles", () => {
    expect(validateCreateName("file.txt")).toEqual({
      ok: true,
      name: "file.txt",
    });
    expect(validateCreateName(".gitignore")).toEqual({
      ok: true,
      name: ".gitignore",
    });
    expect(validateCreateName(".env.example")).toEqual({
      ok: true,
      name: ".env.example",
    });
  });

  it("blocks empty names and path traversal", () => {
    expect(validateCreateName("")).toMatchObject({ ok: false });
    expect(validateCreateName("../secret.txt")).toMatchObject({ ok: false });
    expect(validateCreateName("folder/file.txt")).toMatchObject({ ok: false });
  });

  it("blocks Windows-invalid names", () => {
    expect(validateCreateName("bad:name.txt")).toMatchObject({ ok: false });
    expect(validateCreateName("CON")).toMatchObject({ ok: false });
    expect(validateCreateName("name.")).toMatchObject({ ok: false });
  });
});

describe("dotfile and duplicate helpers", () => {
  it("recognizes real dotfiles", () => {
    expect(isDotfileName(".gitignore")).toBe(true);
    expect(isDotfileName(".")).toBe(false);
    expect(isDotfileName("README.md")).toBe(false);
  });

  it("detects duplicate names case-insensitively", () => {
    expect(existingNameConflict([entry(".gitignore")], ".GITIGNORE")?.name).toBe(
      ".gitignore",
    );
    expect(existingNameConflict([entry("src", "dir")], "README.md")).toBeNull();
  });

  it("formats duplicate create errors with the target folder", () => {
    expect(duplicateCreateMessage(".gitignore", "C:\\repo\\project")).toBe(
      ".gitignore already exists in C:/repo/project.",
    );
  });
});
