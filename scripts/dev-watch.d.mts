import type { Stats } from "node:fs";
import type path from "node:path";

export function createDevWatchIgnore(
  root: string,
  paths?: typeof path.win32,
): (file: string, stats?: Pick<Stats, "isDirectory">) => boolean;
