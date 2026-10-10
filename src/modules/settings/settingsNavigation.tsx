import { createContext, useContext } from "react";
import type {
  SettingsTab,
  SettingsTarget,
} from "@/modules/settings/openSettingsWindow";

const tabs = new Set<SettingsTab>([
  "general",
  "themes",
  "shortcuts",
  "models",
  "agents",
  "about",
]);
export function readSettingsRoute(query: string): {
  tab: SettingsTab;
  target: SettingsTarget;
} {
  const params = new URLSearchParams(query);
  const tab = params.get("tab");
  const target: SettingsTarget = {};
  for (const key of ["agentId", "sessionId", "connectionId"] as const) {
    const value = params.get(key);
    if (value && value.length <= 256) target[key] = value;
  }
  return {
    tab:
      tab === "ai" || tab === "connections"
        ? "models"
        : tabs.has(tab as SettingsTab)
          ? (tab as SettingsTab)
          : "general",
    target,
  };
}

export const SettingsTargetContext = createContext<SettingsTarget>({});
export const useSettingsTarget = () => useContext(SettingsTargetContext);
