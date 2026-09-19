import path from "node:path";

const frontendDirectories = new Set(["src", "public", "scripts", "node_modules"]);

// Vite's root watcher must not descend into unrelated projects or native build
// output. Root config files and dependencies explicitly watched by Vite remain live.
export function createDevWatchIgnore(root, paths = path) {
  return (file, stats) => {
    const relative = paths.relative(root, file);
    if (!relative || relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)) {
      return false;
    }
    const parts = relative.split(paths.sep);
    return (parts.length > 1 || stats?.isDirectory() === true)
      && !frontendDirectories.has(parts[0]);
  };
}
