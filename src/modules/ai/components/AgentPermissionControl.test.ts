import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  requiresFullAccessConfirmation,
  withAgentPermissionProfile,
} from "@/modules/ai/components/AgentPermissionControl";
import { normalizeAgentPermissionProfiles } from "@/modules/settings/store";

describe("AgentPermissionControl policy updates", () => {
  it("stores independent profiles under stable agent ids", () => {
    const coder = withAgentPermissionProfile({}, "builtin:coder", {
      mode: "full-access",
      categories: {},
    });
    const profiles = withAgentPermissionProfile(coder, "builtin:reviewer", {
      mode: "chat-only",
      categories: {},
    });

    expect(profiles["builtin:coder"].mode).toBe("full-access");
    expect(profiles["builtin:reviewer"].mode).toBe("chat-only");
    expect(normalizeAgentPermissionProfiles(profiles)).toEqual(profiles);
  });

  it("uses the same permission control in chat and Settings", () => {
    const chat = readFileSync(
      join(
        process.cwd(),
        "src",
        "modules",
        "ai",
        "components",
        "AiMiniWindow.tsx",
      ),
      "utf8",
    );
    const settings = readFileSync(
      join(process.cwd(), "src", "settings", "sections", "AgentsSection.tsx"),
      "utf8",
    );

    expect(chat).toContain("<AgentPermissionControl");
    expect(settings).toContain("<AgentPermissionControl");
  });

  it("requires deliberate confirmation only when entering Full Access", () => {
    expect(requiresFullAccessConfirmation("ask", "full-access")).toBe(true);
    expect(
      requiresFullAccessConfirmation("full-access", "full-access"),
    ).toBe(false);
    expect(requiresFullAccessConfirmation("ask", "trusted-workspace")).toBe(
      false,
    );
  });
});
