import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { invoke } from "@tauri-apps/api/core";
import {
  createContextAwareTransport,
  formatEnvBlock,
} from "@/modules/ai/lib/transport";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { buildStableSystem, runAgentStream } from "@/modules/ai/lib/agent";
import { normalizeAiError } from "@/modules/ai/lib/errors";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";
import { prepareToolExposure } from "@/modules/ai/lib/toolExposure";
import { buildRuntimeTools } from "@/modules/ai/tools/customExecution";
import type { ToolContext } from "@/modules/ai/tools/context";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { parseProviderContextCatalog } from "@/modules/ai/lib/providerModelEvidence";
import { createSavedProviderModel, savedProviderModelSelectionId } from "@/modules/ai/lib/savedProviderModels";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  emptySelfHostedState,
  profileEvidence,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  saveSelfHostedModel,
  selfHostedSelectionId,
} from "@/modules/ai/lib/selfHostedModels";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import { CORE_SYSTEM_PROMPT, DEFAULT_CLACK_BEHAVIOR } from "@/modules/ai/config";
import { SYSTEM_PROMPT_LITE } from "@/modules/ai/config";
import { buildShellTools } from "@/modules/ai/tools/shell";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
const project = readFileSync("CLACK.md", "utf8");
const persona = {
  name: "Fixture coder",
  instructions: "Preserve the user's existing work.",
};
const live = {
  workspaceRoot: "/fixture",
  cwd: "/fixture",
  activeFile: null,
  terminalPrivate: true,
};
const preferences = usePreferencesStore.getState();
const bodies: Record<string, unknown>[] = [];
const errors: ReturnType<typeof normalizeAiError>[] = [];
const context: ToolContext = {
  getCwd: () => live.cwd,
  getWorkspaceRoot: () => live.workspaceRoot,
  getWorkspaceId: () => "local:/fixture",
  getSessionId: () => "preflight-fixture",
  getAgentId: () => "builtin:coder",
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => true,
  injectIntoActivePty: () => false,
  openPreview: () => false,
  spawnAgent: () => null,
  readAgentOutput: () => null,
  readCache: new Map(),
};
beforeEach(() => {
  bodies.length = 0;
  errors.length = 0;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) => {
      if (command === "fs_read_file") return { kind: "text", content: project };
      return null;
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const chunk = {
        id: "r",
        created: 1,
        model: "fixture",
        choices: [
          { index: 0, delta: { content: "Hello!" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      };
      return new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  usePreferencesStore.setState(preferences);
});
async function hello(
  modelId = "openrouter-custom",
  model = "anthropic/claude-sonnet-4.6",
  overrides: Partial<Parameters<typeof createContextAwareTransport>[0]> = {},
  prompt = "Hello",
) {
  const originals: UIMessage[] = [
    { id: "u", role: "user", parts: [{ type: "text", text: prompt }] },
  ];
  const before = structuredClone(originals);
  const transport = createContextAwareTransport({
    getKeys: () => ({
      ...EMPTY_PROVIDER_KEYS,
      openrouter: "fixture-key",
      anthropic: "fixture-key",
    }),
    toolContext: context,
    getModelId: () => modelId,
    getOpenrouterModelId: () => model,
    getCustomInstructions: () => "Never remove required safety instructions.",
    getAgentPersona: () => persona,
    getLive: () => live,
    getShellIdentity: () => ({
      name: "Windows PowerShell (powershell.exe)",
      syntax: "PowerShell; not POSIX Bash",
    }),
    onError: (error) => {
      errors.push(normalizeAiError(error));
      return "blocked fixture";
    },
    ...overrides,
  });
  const stream = await transport.sendMessages({ messages: originals });
  const reader = stream.getReader();
  while (!(await reader.read()).done) {}
  expect(originals).toEqual(before);
}

it("promotes a tool-exposed hosted Agent through normal transport without an effort-control field", async () => {
  const transportModelId = "fixture/default-reasoning-native-tools:free";
  const providerEvidence = parseProviderContextCatalog({ data: [{
    id: transportModelId,
    context_length: 262144,
    top_provider: { max_completion_tokens: 32768 },
    reasoning: { default_enabled: true },
    supported_parameters: ["tools", "max_tokens", "reasoning"],
  }] }).get(transportModelId);
  if (!providerEvidence) throw new Error("Missing offline capability fixture");
  const saved = createSavedProviderModel({
    providerId: "openrouter", transportModelId, providerEvidence,
  }, "native-agent-fixture");
  const selection = savedProviderModelSelectionId(saved.id);
  const reasoning = captureEffort(selection, { providerId: "openrouter", transportModelId });
  expect(reasoning.capability.status).toBe("unknown");
  await hello(selection, "", {
    getSavedProviderModels: () => [saved],
    getReasoning: () => reasoning,
  }, "Inspect the contents of the workspace directory using native list_directory and report what you find.");
  expect(errors).toEqual([]);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ model: transportModelId, max_tokens: 8192 });
  expect((bodies[0].tools as unknown[]).length).toBeGreaterThan(0);
  expect(bodies[0]).not.toHaveProperty("reasoning_effort");
  expect(bodies[0]).not.toHaveProperty("reasoning");
  expect(bodies[0]).not.toHaveProperty("max_completion_tokens");
});

it.each([
  [
    { name: "Windows PowerShell (powershell.exe)", syntax: "PowerShell; not POSIX Bash" },
    "shell: Windows PowerShell (powershell.exe)",
    "shell_syntax: PowerShell; not POSIX Bash",
  ],
  [
    { name: "/bin/sh", syntax: "POSIX sh" },
    "shell: /bin/sh",
    "shell_syntax: POSIX sh",
  ],
  [
    { name: "WSL /bin/sh", syntax: "POSIX sh" },
    "shell: WSL /bin/sh",
    "shell_syntax: POSIX sh",
  ],
])("formats the native shell contract before tool use", (identity, name, syntax) => {
  const block = formatEnvBlock(live, identity);
  expect(block).toContain(name);
  expect(block).toContain(syntax);
});

it("keeps native-shell syntax explicit in core/lite prompts and both shell tool contracts", () => {
  for (const prompt of [CORE_SYSTEM_PROMPT, SYSTEM_PROMPT_LITE]) {
    expect(prompt).toMatch(/(?:does|do) not imply Bash/);
    expect(prompt).toContain("shell");
  }
  const tools = buildShellTools(context);
  expect(tools.bash_run.description).toContain("NOT necessarily Bash");
  expect(tools.bash_run.description).toContain("shell_syntax");
  expect(tools.bash_background.description).toContain("do not assume POSIX Bash syntax");
});

it("records the production schema overhead caused by using environment metadata as task relevance", async () => {
  const tools = await buildRuntimeTools(context);
  const system = buildStableSystem(
    "openrouter-custom",
    persona,
    undefined,
    project,
  );
  const env = `${formatEnvBlock(live)}\n\nHello`;
  const old = await prepareToolExposure(tools, {
    context,
    target: "fixture",
    system,
    messages: [{ role: "user", content: env }],
  });
  const intended = await prepareToolExposure(tools, {
    context,
    target: "fixture",
    system,
    messages: [{ role: "user", content: "Hello" }],
  });
  expect(old.names.length).toBeGreaterThan(intended.names.length);
  expect(intended.names).toEqual([]);
  process.stdout.write(
    `Hello production schema reproduction ${JSON.stringify({ before: old.metrics, after: intended.metrics, cost: old.budget.cost })}\n`,
  );
});

it("sends a fresh cloud Hello through the real transport, selector, adapter and final B1", async () => {
  await hello();
  expect(errors).toEqual([]);
  expect(bodies).toHaveLength(1);
  const body = bodies[0];
  expect(body.model).toBe("anthropic/claude-sonnet-4.6");
  expect(body.tools ?? []).toEqual([]);
  const serialized = JSON.stringify(body);
  expect(serialized.match(/## PROJECT MEMORY/g)).toHaveLength(1);
  expect(serialized.match(/## ACTIVE AGENT/g)).toHaveLength(1);
  expect(serialized.match(/workspace_root:/g)).toHaveLength(1);
  expect(serialized.match(/shell: Windows PowerShell/g)).toHaveLength(1);
  expect(serialized.match(/shell_syntax: PowerShell; not POSIX Bash/g)).toHaveLength(1);
  expect(serialized).toContain("Never remove required safety instructions.");
  const messages = body.messages as { role: string; content: string }[];
  expect(messages.filter((m) => m.role === "system")).toHaveLength(1);
  for (const block of [CORE_SYSTEM_PROMPT, DEFAULT_CLACK_BEHAVIOR])
    expect(messages.map((m) => m.content).join("\n").split(block)).toHaveLength(2);
  const cost = measureRequest(body);
  expect(
    resolveContextBudget({ reported: 1000000 }, cost, Number(body.max_tokens))
      .fits,
  ).toBe(true);
  expect(
    Object.values(cost.breakdown ?? {}).reduce((sum, n) => sum + (n ?? 0), 0),
  ).toBe(cost.system + cost.tools + cost.conversation);
  for (const section of [
    "builtin",
    "memory",
    "retrieval",
    "attachments",
  ] as const)
    expect(cost.breakdown?.[section]).toBeUndefined();
  expect(cost.breakdown?.core).toBeGreaterThan(1000);
  expect(cost.breakdown?.project).toBeGreaterThan(1000);
  expect(cost.breakdown?.agent).toBeGreaterThan(0);
  expect(cost.breakdown?.environment).toBeGreaterThan(0);
  process.stdout.write(`Hello final wire accounting ${JSON.stringify(cost)}\n`);
});

it("saved cloud identity and alias changes retain the same provider evidence", async () => {
  const saved = {
    id: "saved",
    providerId: "openrouter" as const,
    transportModelId: "anthropic/claude-sonnet-4.6",
    displayName: "Personal alias",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
  await hello("saved-provider:saved", "", {
    getSavedProviderModels: () => [saved],
  });
  expect(errors).toEqual([]);
  saved.displayName = "Renamed alias";
  await hello("saved-provider:saved", "", {
    getSavedProviderModels: () => [saved],
  });
  expect(errors).toEqual([]);
  expect(bodies).toHaveLength(2);
  expect(bodies[0].model).toBe(bodies[1].model);
  expect(bodies[0].max_tokens).toBe(bodies[1].max_tokens);
});

it("a genuinely unknown target remains conservative even after optional exposure is corrected", async () => {
  await hello("openrouter-custom", "unknown/private-model");
  expect(bodies).toHaveLength(0);
  expect(errors[0]).toMatchObject({
    title: "Clack couldn't verify this model's context capacity.",
    retryable: false,
  });
  expect(errors[0].details).toContain("Effective ceiling: 4096");
  expect(errors[0].details).toContain("Schemas exposed on wire: 0");
  expect(errors[0].message).not.toContain("reduce the new request");
});

it("a verified deployed 4K target still blocks complete mandatory context before native HTTP", async () => {
  const endpoint = createSelfHostedEndpoint(
    {
      alias: "Small server",
      baseURL: "http://localhost:1234/v1",
      backendHint: "lmstudio",
    },
    "small",
  );
  const state = saveSelfHostedModel(
    addSelfHostedEndpoint(emptySelfHostedState(), endpoint),
    endpoint.id,
    "small-model",
  );
  const profile = state.profiles[0];
  const snapshot: ProbeSnapshot = {
    endpointId: endpoint.id,
    configurationRevision: endpoint.configurationRevision,
    selectedModelId: "small-model",
    observedAt: Date.now(),
    connected: true,
    reachable: true,
    credentialUsed: false,
    stale: false,
    refreshing: false,
    inventoryTtlMs: 300000,
    instanceTtlMs: 30000,
    errors: [],
    models: [
      {
        id: "small-model",
        name: null,
        chat: "supported",
        evidence: [
          profileEvidence(
            state,
            profile.id,
            "probe.loadedContext",
            4096,
            "backend-reported",
            Date.now(),
            "reported",
          ),
        ],
      },
    ],
  };
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "self_hosted_probe_cache" ? snapshot : null,
  );
  const result = await runAgentStream({
    keys: EMPTY_PROVIDER_KEYS,
    modelId: selfHostedSelectionId(profile),
    selfHostedInference: state,
    toolContext: context,
    projectMemory: project,
    agentPersona: persona,
    uiMessages: [
      { id: "u", role: "user", parts: [{ type: "text", text: "Hello" }] },
    ],
  });
  const failures: unknown[] = [];
  for await (const chunk of result.fullStream)
    if (chunk.type === "error") failures.push(chunk.error);
  expect(failures).toHaveLength(1);
  const error = normalizeAiError(failures[0]);
  expect(error).toMatchObject({
    title: "This model can't fit the required context.",
    retryable: false,
  });
  expect(error.details).toContain("Verified deployed/server evidence");
  expect(error.details).toContain("Effective ceiling: 4096");
  expect(error.details).toContain("Schemas exposed on wire: 0");
  expect(bodies).toHaveLength(0);
  expect(
    vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "ai_http_open"),
  ).toBe(false);
});
