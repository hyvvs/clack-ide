import { open } from "@tauri-apps/plugin-dialog";
import { normalizeWorkspacePath } from "./root";

export async function pickWorkspaceFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open Folder",
  });
  return typeof selected === "string" ? normalizeWorkspacePath(selected) : null;
}
