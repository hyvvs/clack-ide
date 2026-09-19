import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";
import { createDevWatchIgnore } from "./dev-watch.mjs";

describe.each([path.win32, path.posix])("development watch boundaries", (paths) => {
  const root = paths.resolve("clack");
  const ignore = createDevWatchIgnore(root, paths);
  const directory = { isDirectory: () => true };
  const file = { isDirectory: () => false };

  it("prunes unrelated projects and native output at the directory boundary", () => {
    for (const name of ["other-project", "src-tauri", "dist", "docs"]) {
      expect(ignore(paths.join(root, name), directory)).toBe(true);
      expect(ignore(paths.join(root, name, "nested", "file.ts"))).toBe(true);
    }
  });

  it("keeps frontend files, assets, and scripts hot-reloadable", () => {
    for (const name of ["src", "public", "scripts", "node_modules"]) {
      expect(ignore(paths.join(root, name), directory)).toBe(false);
      expect(ignore(paths.join(root, name, "nested", "file.ts"), file)).toBe(false);
    }
  });

  it("allows root configs and external dependencies without prefix collisions", () => {
    expect(ignore(root, directory)).toBe(false);
    for (const name of ["vite.config.ts", "package.json", "package-lock.json", ".env.local"]) {
      expect(ignore(paths.join(root, name), file)).toBe(false);
    }
    expect(ignore(paths.resolve(root, "..", "clack-extra", "entry.ts"), file)).toBe(false);
    expect(ignore(paths.resolve(root, ".."), directory)).toBe(false);
  });
});

it("Vite watches frontend changes without descending into unrelated project trees", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "clack-dev-watch-"));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    for (const name of ["src", "public", "scripts", "other-project", "src-tauri"]) {
      await mkdir(path.join(root, name, "nested"), { recursive: true });
      await writeFile(path.join(root, name, "nested", "file.ts"), "export const value = 1;");
    }
    await writeFile(path.join(root, "index.html"), "<div>test</div>");
    server = await createServer({
      configFile: false,
      root,
      server: {
        middlewareMode: true,
        hmr: false,
        watch: { ignored: [createDevWatchIgnore(root)] },
      },
    });
    const watched = () => Object.keys(server!.watcher.getWatched()).map(p => path.relative(root, p));
    await expect.poll(watched).toContain(path.join("src", "nested"));
    expect(watched()).not.toContain("other-project");
    expect(watched()).not.toContain("src-tauri");
    const changed: string[] = [];
    server.watcher.on("change", file => changed.push(path.resolve(file)));
    const source = path.join(root, "src", "nested", "file.ts");
    const config = path.join(root, "index.html");
    await writeFile(source, "export const value = 2;");
    await writeFile(config, "<div>updated</div>");
    await expect.poll(() => changed).toEqual(expect.arrayContaining([source, config]));
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
