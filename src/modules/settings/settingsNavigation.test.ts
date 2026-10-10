import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { readSettingsRoute } from "@/modules/settings/settingsNavigation";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it.each([
  "agents",
  "models",
] as const)("uses the same bounded route for new and already-open %s Settings", async (tab) => {
  const target = {
    agentId: "custom:Pooper & Captain",
    sessionId: "chat-a",
    connectionId: "endpoint?exact",
  };
  await openSettingsWindow(tab, target);
  const calls = vi.mocked(invoke).mock.calls;
  const query = calls[calls.length - 1]?.[1] as { tab: string };
  expect(readSettingsRoute(`tab=${query.tab}`)).toEqual({ tab, target });
  expect(
    readSettingsRoute(
      new URL(`https://fixture/settings.html?tab=${query.tab}`).search,
    ),
  ).toEqual({ tab, target });
});
it("retains legacy navigation and ignores unsupported or oversized route data", () => {
  expect(readSettingsRoute("tab=ai").tab).toBe("models");
  expect(readSettingsRoute("tab=connections").tab).toBe("models");
  expect(readSettingsRoute(`tab=unknown&agentId=${"x".repeat(257)}`)).toEqual({
    tab: "general",
    target: {},
  });
});
