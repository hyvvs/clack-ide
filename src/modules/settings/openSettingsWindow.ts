import { invoke } from "@tauri-apps/api/core";

export type SettingsTab =
  | "general"
  | "themes"
  | "shortcuts"
  | "models"
  | "agents"
  | "about";

export type SettingsTarget = { agentId?: string; sessionId?: string; connectionId?: string };

export async function openSettingsWindow(tab?: SettingsTab, target: SettingsTarget = {}): Promise<void> {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  for (const [key, value] of Object.entries(target)) {
    if (value && value.length <= 256) params.set(key, value);
  }
  // The existing native command appends this query after ?tab= and emits it
  // unchanged to an already-open Settings window.
  await invoke("open_settings_window", { tab: tab ? params.toString().slice(4) : null });
}
