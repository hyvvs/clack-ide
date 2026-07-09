import { LazyStore } from "@tauri-apps/plugin-store";
import {
  removeRecentWorkspace as removeRecentWorkspaceEntry,
  type RecentWorkspace,
  upsertRecentWorkspace,
} from "./root";

const STORE_PATH = "clack-workspaces.json";
const KEY_RECENT = "recentWorkspaces";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 300 });

export async function loadRecentWorkspaces(): Promise<RecentWorkspace[]> {
  const value = await store.get<RecentWorkspace[]>(KEY_RECENT);
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item.path === "string");
}

export async function recordRecentWorkspace(
  path: string,
): Promise<RecentWorkspace[]> {
  const next = upsertRecentWorkspace(
    await loadRecentWorkspaces(),
    path,
    Date.now(),
  );
  await store.set(KEY_RECENT, next);
  return next;
}

export async function removeRecentWorkspace(
  path: string,
): Promise<RecentWorkspace[]> {
  const next = removeRecentWorkspaceEntry(await loadRecentWorkspaces(), path);
  await store.set(KEY_RECENT, next);
  return next;
}
