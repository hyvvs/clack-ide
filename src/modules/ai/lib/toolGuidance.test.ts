import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, type ToolSet } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  CORE_SYSTEM_PROMPT,
  DEFAULT_CLACK_BEHAVIOR,
  SYSTEM_PROMPT_LITE,
} from "@/modules/ai/config";
import { buildStableSystem, planModeSystemText } from "@/modules/ai/lib/agent";
import { serializedToolSchemas } from "@/modules/ai/lib/requestPreflight";
import {
  clearExposureCache,
  prepareToolExposure,
} from "@/modules/ai/lib/toolExposure";
import { buildEditTools } from "@/modules/ai/tools/edit";
import { buildFsTools } from "@/modules/ai/tools/fs";
import { buildShellTools } from "@/modules/ai/tools/shell";
import type { ToolContext } from "@/modules/ai/tools/context";
import { usePreferencesStore } from "@/modules/settings/preferences";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
const originalPreferences = usePreferencesStore.getState();
const context: ToolContext = {
  getCwd: () => "/work",
  getWorkspaceRoot: () => "/work",
  getWorkspaceId: () => "local:/work",
  getAgentId: () => "builtin:coder",
  getSessionId: () => "guidance-test",
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  openPreview: () => false,
  spawnAgent: () => null,
  readAgentOutput: () => null,
  readCache: new Map(),
};
const pool: ToolSet = {
  ...buildFsTools(context),
  ...buildEditTools(context),
  ...buildShellTools(context),
};
const namedTools = Object.keys(pool).filter((name) => name.includes("_"));
const noUnavailableNames = (text: string, selected: readonly string[]) => {
  for (const name of namedTools)
    if (!selected.includes(name))
      expect(text).not.toMatch(new RegExp(`\\b${name}\\b`));
};
beforeEach(() => {
  clearExposureCache();
  usePreferencesStore.setState({
    agentPermissionProfiles: {
      "builtin:coder": { mode: "trusted-workspace", categories: {} },
    },
  });
});
afterEach(() => {
  usePreferencesStore.setState(originalPreferences, true);
  vi.restoreAllMocks();
});

describe.each([
  "gpt-5.4-mini",
  "openrouter-custom",
  'self-hosted:["local","qwen3-coder:30b",null]',
])("selected capability guidance for %s", (model) => {
  it.each([
    ["file creation", ["write_file", "list_directory"]],
    ["native shell creation without a writer", ["bash_run"]],
    ["edit only", ["edit"]],
    ["atomic existing-file edit only", ["multi_edit"]],
    ["read only", ["read_file", "list_directory"]],
    ["no tools", []],
    ["existing-file edit and shell", ["edit", "read_file", "bash_run"]],
    [
      "background handles without foreground creation",
      ["bash_background", "bash_logs", "bash_kill"],
    ],
  ] as const)("does not advertise missing executable capabilities: %s", async (_label, names) => {
    const activeNames: readonly string[] = names;
    const selected = Object.fromEntries(
      names.map((name) => [name, pool[name]]),
    );
    const system = buildStableSystem(model, null, undefined, null);
    noUnavailableNames(system, []);
    const schemas = await serializedToolSchemas(selected);
    noUnavailableNames(`${system}\n${JSON.stringify(schemas)}`, names);
    if (activeNames.includes("write_file"))
      expect(selected.write_file.description).toContain("brand-new");
    if (activeNames.includes("bash_run")) {
      expect(selected.bash_run.description).toContain(
        "creating new workspace files",
      );
      expect(selected.bash_run.description).toContain("shell_syntax");
      expect(selected.bash_run.description).not.toContain("PowerShell");
    }
    for (const name of ["edit", "multi_edit"])
      if (name in selected)
        expect(selected[name].description).toContain(
          "cannot create unread or nonexistent files",
        );
  });
});

it("keeps full, lite and plan-mode system guidance capability-neutral", () => {
  for (const system of [
    CORE_SYSTEM_PROMPT,
    DEFAULT_CLACK_BEHAVIOR,
    SYSTEM_PROMPT_LITE,
    planModeSystemText(true),
  ])
    noUnavailableNames(system, []);
  expect(planModeSystemText(true)).toContain(
    "Do NOT execute foreground or background commands",
  );
  expect(CORE_SYSTEM_PROMPT).toContain(
    "It cannot create unread or nonexistent files",
  );
});

it("carries only the selected tool's creation contract through F1 and the SDK", async () => {
  const system = buildStableSystem("ollama-local", null, undefined, null);
  const selection = await prepareToolExposure(pool, {
    context,
    target: "native-local-test",
    query: "bash_run",
    messages: [{ role: "user", content: "bash_run" }],
    system,
    limits: { deployed: 32768, maxOutput: 2048 },
  });
  expect(selection.names).toContain("bash_run");
  expect(selection.names).not.toContain("write_file");
  expect(selection.names.length).toBeLessThan(Object.keys(pool).length);
  let requests = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      requests++;
      const names = (options.tools ?? []).map((tool) => tool.name);
      expect([...names].sort()).toEqual([...selection.names].sort());
      noUnavailableNames(JSON.stringify(options.prompt), []);
      noUnavailableNames(JSON.stringify(options.tools), names);
      expect(JSON.stringify(options.tools)).toContain(
        "creating new workspace files",
      );
      return {
        content: [{ type: "text", text: "Selected capabilities checked." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  await generateText({
    model,
    system,
    prompt: "Inspect available capabilities.",
    tools: pool,
    activeTools: selection.names,
  });
  expect(requests).toBe(1);
});
