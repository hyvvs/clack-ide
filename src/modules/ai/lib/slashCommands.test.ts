import { afterEach, describe, expect, it } from "vitest";
import { usePlanStore } from "../store/planStore";
import { SLASH_COMMANDS, tryRunSlashCommand } from "./slashCommands";

afterEach(() => usePlanStore.getState().disable());

describe("slash command metadata", () => {
  it("exposes only functional commands with descriptions", () => {
    expect(Object.keys(SLASH_COMMANDS)).toEqual([
      "init",
      "plan",
      "claude-code",
    ]);
    for (const command of Object.values(SLASH_COMMANDS)) {
      expect(command.description.trim().length).toBeGreaterThan(0);
      expect(command.invocation).toBe(`#${command.name}`);
    }
  });

  it("does not claim unknown hash entries as commands", () => {
    expect(tryRunSlashCommand("#not-a-command")).toEqual({ kind: "none" });
  });

  it("runs a plan request through the real plan-mode path", () => {
    expect(tryRunSlashCommand("#plan refactor the parser")).toEqual({
      kind: "send-prompt",
      prompt: "refactor the parser",
      commandName: "plan",
    });
  });
});
