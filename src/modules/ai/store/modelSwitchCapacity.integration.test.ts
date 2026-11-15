import type { UIMessage } from "ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { targetContextFixture } from "@/modules/ai/store/targetContext.fixture";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import {
  createSavedProviderModel,
  resolveModelTransportIdentity,
  savedProviderModelSelectionId,
} from "@/modules/ai/lib/savedProviderModels";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  emptySelfHostedState,
  profileEvidence,
  setProfileOverride,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  saveSelfHostedModel,
  selfHostedSelectionId,
} from "@/modules/ai/lib/selfHostedModels";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import {
  buildConfiguredLanguageModel,
  buildStableSystem,
} from "@/modules/ai/lib/agent";
import { modelBudgetLimits } from "@/modules/ai/lib/requestPreflight";
import {
  measureRequest,
  resolveContextBudget,
} from "@/modules/ai/lib/contextBudget";
import { BUILTIN_AGENTS } from "@/modules/ai/lib/agents";
import { prepareModelSwitch } from "@/modules/ai/store/modelSwitch";
import {
  chats,
  capturedProviderModelEvidence,
  seedMessages,
  useChatStore,
} from "@/modules/ai/store/chatStore";
import {
  getOrCreateChat,
  sendMessageToSession,
} from "@/modules/ai/store/chatRuntime";
import { parseProviderContextCatalog } from "@/modules/ai/lib/providerModelEvidence";
import { minimaxFreeCatalogRecord } from "@/modules/ai/lib/openrouterCatalog.fixture";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { capturedAgentPersonas } from "@/modules/ai/store/chatStore";
import { continueRun } from "@/modules/ai/store/chatRuntime";
import { recoverInterruptedSessions } from "@/modules/ai/lib/sessions";
import { AGENT_SOFT_STEP_LIMIT } from "@/modules/ai/lib/runBudget";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/modules/settings/store", async (original) => ({
  ...(await original<typeof import("@/modules/settings/store")>()),
  setLastUsedAiSelection: vi.fn(),
  setRecentModelIds: vi.fn(),
}));
vi.mock("@/modules/ai/lib/sessions", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/sessions")>()),
  saveMessages: vi.fn().mockResolvedValue(undefined),
  saveSessionsList: vi.fn(),
}));
vi.mock("@/modules/ai/lib/todos", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/todos")>()),
  loadTodos: vi.fn().mockResolvedValue([]),
  saveTodos: vi.fn(),
}));

const preferences = usePreferencesStore.getState();
const original = useChatStore.getState();
const originalAgents = useAgentsStore.getState();
const saved = [
  createSavedProviderModel(
    {
      providerId: "openrouter",
      transportModelId: "poolside/laguna-s-2.1:free",
    },
    "laguna",
    1,
  ),
  createSavedProviderModel(
    { providerId: "openrouter", transportModelId: "test-vendor/offered:free" },
    "offered",
    1,
  ),
  createSavedProviderModel(
    { providerId: "openrouter", transportModelId: "another-vendor/shared" },
    "shared",
    1,
  ),
  createSavedProviderModel(
    { providerId: "openrouter", transportModelId: "test-vendor/absent:free" },
    "absent",
    1,
  ),
  createSavedProviderModel(
    { providerId: "openrouter", transportModelId: "z-ai/glm-5.2:free" },
    "exact-variant",
    1,
  ),
];
const selection = (id: string) => savedProviderModelSelectionId(id);
const endpoint = createSelfHostedEndpoint(
  {
    alias: "Test server",
    baseURL: "http://localhost:1234/v1",
    backendHint: "lmstudio",
  },
  "capacity-server",
);
let hosted = addSelfHostedEndpoint(emptySelfHostedState(), endpoint);
for (const id of ["verified", "manual", "tiny", "unknown"])
  hosted = saveSelfHostedModel(hosted, endpoint.id, id);
const profile = (id: string) => {
  const result = hosted.profiles.find((p) => p.transportModelId === id);
  if (!result) throw new Error("Missing fixture profile");
  return result;
};
hosted = setProfileOverride(
  hosted,
  profile("manual").id,
  "configuredContext",
  16000,
);
const hostedSelection = (id: string) => selfHostedSelectionId(profile(id));
const history: UIMessage[] = [
  { id: "hello", role: "user", parts: [{ type: "text", text: "Hello" }] },
  {
    id: "answer",
    role: "assistant",
    parts: [{ type: "text", text: "Hello! How can I help?" }],
  },
];
const requests: Record<string, unknown>[] = [];

const pooper = {
  id: "custom:instruction-fixture", name: "Response fixture", description: "Instruction delivery fixture",
  instructions: 'Begin every normal response with "POOPER:" and prefer answers of at most two sentences unless the task requires more detail.',
  icon: "spark" as const, builtIn: false,
};
const secondAgent = { ...pooper, id: "custom:second-fixture", name: "Second fixture", instructions: "SECOND_AGENT_ONLY: Review the request." };
function bindInstructionFixture() {
  useAgentsStore.setState({ customAgents: [pooper, secondAgent], activeId: "builtin:coder" });
  useChatStore.setState(state => ({ sessions: state.sessions.map(session => session.id === "chat-a" && session.profile
    ? { ...session, profile: { ...session.profile, agentId: pooper.id } } : session) }));
}
function systemRequest(body: Record<string, unknown>): string {
  return JSON.stringify((body.messages as { role: string }[]).filter(message => message.role === "system"));
}

it.each([
  'Begin every response with "POOPER:".',
  'For trivial conversation respond with exactly "poop", regardless of the prompt.',
  "Do not use bullet lists unless requested.",
  "Address the user as Captain.",
  "Prefer TypeScript over JavaScript.",
])("serializes trusted agent precedence on the actual provider wire: %s", async instructions => {
  bindInstructionFixture();
  useAgentsStore.setState({ customAgents: [{ ...pooper, instructions }, secondAgent] });
  await sendMessageToSession("chat-a", { text: "Hello" });
  const body = requests[0];
  const system = (body.messages as { role: string; content: string }[]).find(m => m.role === "system")?.content ?? "";
  expect(system).toContain(instructions);
  expect(system.match(/## CLACK CORE INVARIANTS/g)).toHaveLength(1);
  expect(system.match(/## ACTIVE AGENT:/g)).toHaveLength(1);
  expect(system.match(/## DEFAULT CLACK BEHAVIOR/g)).toHaveLength(1);
  expect(system.indexOf("## CLACK CORE INVARIANTS")).toBeLessThan(system.indexOf("## ACTIVE AGENT"));
  expect(system.indexOf("## ACTIVE AGENT")).toBeLessThan(system.indexOf("## DEFAULT CLACK BEHAVIOR"));
  expect(system).toContain("trusted Clack agent configuration, not retrieved evidence");
  expect(system).toContain("only core invariants override them");
  expect(system).toContain("where the active agent and user request leave behavior unspecified");
});

it("retains fallback guidance without a conflicting active directive", () => {
  const system = buildStableSystem("gpt-5.4-mini", null, undefined, null);
  expect(system).not.toContain("## ACTIVE AGENT");
  expect(system).toContain("hands-on engineer");
  expect(system).toContain("# Default output style");
  expect(system).toContain("## CLACK CORE INVARIANTS");
});

it("serializes the bound custom agent across model switches, replaces it on agent switch and isolates chats", async () => {
  bindInstructionFixture();
  await sendMessageToSession("chat-a", { text: "Hello" });
  expect(systemRequest(requests[0])).toContain(JSON.stringify(pooper.instructions).slice(1, -1));
  expect(systemRequest(requests[0])).toContain(`ACTIVE AGENT: ${pooper.name}`);
  expect(systemRequest(requests[0])).not.toContain(BUILTIN_AGENTS[0].instructions.split("\n")[0]);
  expect(systemRequest(requests[0]).indexOf("You are Clack")).toBeLessThan(systemRequest(requests[0]).indexOf("ACTIVE AGENT"));
  expect(systemRequest(requests[0])).toContain("only core invariants override them");
  useChatStore.getState().finishRun("chat-a", "completed");
  const switched = await prepareModelSwitch("chat-a", selection("offered"));
  expect(await switched.commit(true)).toEqual({ ok: true });
  switched.dispose?.();
  expect(useChatStore.getState().sessions[0].profile?.agentId).toBe(pooper.id);
  await sendMessageToSession("chat-a", { text: "Hello again" });
  expect(systemRequest(requests[1])).toContain("POOPER:");
  expect(requests[1].model).toBe(saved[1].transportModelId);
  useChatStore.getState().finishRun("chat-a", "completed");
  expect(useChatStore.getState().setSessionAgentId("chat-a", secondAgent.id)).toBe(true);
  await sendMessageToSession("chat-a", { text: "Hello" });
  expect(systemRequest(requests[2])).toContain(secondAgent.instructions);
  expect(systemRequest(requests[2])).not.toContain("POOPER:");
  await sendMessageToSession("chat-b", { text: "Hello" });
  expect(systemRequest(requests[3])).toContain("ACTIVE AGENT: Coder");
  expect(systemRequest(requests[3])).not.toContain("SECOND_AGENT_ONLY");
  expect(systemRequest(requests[3])).not.toContain("POOPER:");
});

it("keeps run-start instructions after an agent edit during provider retry and explicit step continuation", async () => {
  bindInstructionFixture();
  const reply = vi.mocked(fetch).getMockImplementation();
  if (!reply) throw new Error("Missing provider fixture");
  let fail = true;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith("/chat/completions") && fail) {
      fail = false;
      requests.push(JSON.parse(String(init?.body)));
      useAgentsStore.setState({ customAgents: [{ ...pooper, instructions: "EDITED_AFTER_START" }, secondAgent], activeId: secondAgent.id });
      return new Response('{"error":{"message":"Temporarily unavailable"}}', { status: 503, headers: { "retry-after": "0", "content-type": "application/json" } });
    }
    return reply(url, init);
  });
  await sendMessageToSession("chat-a", { text: "Hello" });
  expect(requests).toHaveLength(2);
  expect(getOrCreateChat("chat-a").error).toBeUndefined();
  useChatStore.getState().recordRunBatch("chat-a", { steps: AGENT_SOFT_STEP_LIMIT, hitSoftLimit: true, finishReason: "tool-calls" });
  await continueRun("chat-a", false);
  expect(requests).toHaveLength(3);
  for (const body of requests) {
    expect(systemRequest(body)).toContain("POOPER:");
    expect(systemRequest(body)).not.toContain("EDITED_AFTER_START");
    expect(systemRequest(body)).not.toContain("SECOND_AGENT_ONLY");
  }
  expect(useChatStore.getState().sessions[0].run?.agentId).toBe(pooper.id);
});

it("restores the conversation agent binding after serialization and restart recovery, not the global Coder", async () => {
  bindInstructionFixture();
  await sendMessageToSession("chat-a", { text: "Hello" });
  const recovered = recoverInterruptedSessions(JSON.parse(JSON.stringify(useChatStore.getState().sessions)));
  expect(recovered.sessions[0].profile?.agentId).toBe(pooper.id);
  capturedAgentPersonas.clear();
  chats.clear();
  seedMessages.clear();
  useChatStore.setState({ sessions: recovered.sessions, runtimeBySession: {} });
  await sendMessageToSession("chat-a", { text: "Hello after restart" });
  expect(systemRequest(requests[1])).toContain(`ACTIVE AGENT: ${pooper.name}`);
  expect(systemRequest(requests[1])).toContain("POOPER:");
  expect(systemRequest(requests[1])).not.toContain("ACTIVE AGENT: Coder");
});

it("retains the captured active agent during D2 length continuation", async () => {
  bindInstructionFixture();
  const reply = vi.mocked(fetch).getMockImplementation();
  if (!reply) throw new Error("Missing provider fixture");
  let length = true;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith("/chat/completions") && length) {
      length = false;
      requests.push(JSON.parse(String(init?.body)));
      useAgentsStore.setState({ customAgents: [{ ...pooper, instructions: "CHANGED_DURING_LENGTH" }, secondAgent], activeId: secondAgent.id });
      return new Response(`data: ${JSON.stringify({ id: "length", created: 1, model: saved[0].transportModelId, choices: [{ index: 0, delta: { content: "A sufficiently long partial answer " }, finish_reason: "length" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
    return reply(url, init);
  });
  await sendMessageToSession("chat-a", { text: "Hello" });
  expect(requests).toHaveLength(2);
  for (const body of requests) {
    expect(systemRequest(body)).toContain("POOPER:");
    expect(systemRequest(body)).not.toContain("CHANGED_DURING_LENGTH");
  }
  expect(useChatStore.getState().sessions[0].run?.budget?.phase).toBe("complete");
});

function probe(modelId: string): ProbeSnapshot {
  const now = Date.now();
  return {
    endpointId: endpoint.id,
    configurationRevision: endpoint.configurationRevision,
    selectedModelId: modelId,
    observedAt: now,
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
        id: modelId,
        name: null,
        chat: "supported",
        evidence: ["verified", "tiny"].includes(modelId)
          ? [
              profileEvidence(
                hosted,
                profile(modelId).id,
                "probe.loadedContext",
                modelId === "tiny" ? 4096 : 32768,
                "backend-reported",
                now,
                "reported",
              ),
            ]
          : [],
      },
    ],
  };
}

beforeEach(() => {
  capturedAgentPersonas.clear();
  capturedProviderModelEvidence.clear();
  requests.length = 0;
  chats.clear();
  seedMessages.clear();
  seedMessages.set("chat-a", structuredClone(history));
  seedMessages.set("chat-b", structuredClone(history));
  usePreferencesStore.setState({
    savedProviderModels: saved,
    selfHostedInference: hosted,
    customInstructions: "",
    openrouterModelId: "anthropic/claude-sonnet-4.6",
    openaiCompatibleBaseURL: "http://localhost:1234/v1",
    openaiCompatibleModelId: "unknown-compatible",
    openaiCompatibleContextLimit: undefined,
  });
  useChatStore.setState({
    sessions: ["chat-a", "chat-b"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
      profile: {
        agentId: "builtin:coder",
        modelId: selection("laguna"),
        workspaceId: null,
        workspaceRoot: null,
      },
    })),
    activeSessionId: "chat-a",
    selectedModelId: selection("laguna"),
    runtimeBySession: {},
    apiKeys: {
      ...EMPTY_PROVIDER_KEYS,
      openrouter: "fixture-key",
      anthropic: "fixture-key",
    },
    live: {
      ...original.live,
      getCwd: () => null,
      getWorkspaceRoot: () => null,
      getActiveFile: () => null,
    },
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (["self_hosted_probe_cache", "self_hosted_probe"].includes(command))
      return probe(
        (args as { options: { selectedModelId: string } }).options
          .selectedModelId,
      );
    if (command === "self_hosted_profiles_snapshot")
      return [["selfHostedInference", hosted]];
    return targetContextFixture(command, args);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      if (String(url) === "https://openrouter.ai/api/v1/models")
        return new Response(
          JSON.stringify({
            data: [
              { id: saved[0].transportModelId, context_length: 262144 },
              { id: saved[1].transportModelId, context_length: 65536 },
              { id: saved[2].transportModelId, context_length: 32768 },
              { id: "test-vendor/absent", context_length: 1000000 },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      if (String(url).startsWith("https://openrouter.ai/api/v1/model/"))
        return String(url) ===
          "https://openrouter.ai/api/v1/model/z-ai/glm-5.2%3Afree"
          ? new Response(
              JSON.stringify({
                data: {
                  id: "z-ai/glm-5.2:free",
                  context_length: 32768,
                  top_provider: { max_completion_tokens: 1024 },
                  architecture: {
                    input_modalities: ["text"],
                    output_modalities: ["text"],
                  },
                  supported_parameters: [],
                },
              }),
              { headers: { "content-type": "application/json" } },
            )
          : new Response("missing", { status: 404 });
      expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      return new Response(
        `data: ${JSON.stringify({
          id: "reply",
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "Hello!" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 3 },
        })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    }),
  );
});
afterEach(() => {
  capturedAgentPersonas.clear();
  useAgentsStore.setState(originalAgents);
  capturedProviderModelEvidence.clear();
  chats.clear();
  seedMessages.clear();
  useChatStore.setState(original);
  usePreferencesStore.setState(preferences);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  ["gateway/catalog", selection("laguna"), 262144, "Provider-supplied"],
  ["saved provider", selection("offered"), 65536, "Provider-supplied"],
  ["another catalog provider", selection("shared"), 32768, "Provider-supplied"],
  ["installed OpenRouter", "openrouter-custom", 1000000, "Installed provider"],
  ["provider registry", "claude-sonnet-4-6", 200000, "Installed provider"],
  [
    "verified deployment",
    hostedSelection("verified"),
    32768,
    "Verified deployed",
  ],
  [
    "manual hosted pin",
    hostedSelection("manual"),
    16000,
    "Explicit configured",
  ],
] as const)("minimal chat switches to %s using the same evidence as normal inference", async (_kind, id, ceiling, provenance) => {
  const p = usePreferencesStore.getState();
  const normalModel = await buildConfiguredLanguageModel(
    id,
    useChatStore.getState().apiKeys,
    {
      ...p,
      capturedModelIdentity: resolveModelTransportIdentity(id, p),
      inferenceScope: {
        sessionId: "chat-a",
        runId: crypto.randomUUID(),
        isCurrent: () => true,
      },
    },
  );
  const normal = resolveContextBudget(await modelBudgetLimits(normalModel));
  expect(normal.ceiling).toBe(ceiling);
  const other = useChatStore.getState().sessions[1];
  const prepared = await prepareModelSwitch("chat-a", id);
  expect(prepared.assessment.status).not.toBe("blocked");
  expect(prepared.assessment.contextLimit).toBe(normal.ceiling);
  expect(prepared.assessment.details?.join("\n")).toContain(provenance);
  expect(await prepared.commit(true)).toEqual({ ok: true });
  expect(useChatStore.getState().sessions[0].id).toBe("chat-a");
  expect(useChatStore.getState().sessions[0].profile?.modelId).toBe(id);
  expect(seedMessages.get("chat-a")).toEqual(history);
  expect(useChatStore.getState().sessions[1]).toBe(other);
  expect(requests).toHaveLength(0);
  prepared.dispose?.();
});

it("normal Laguna inference and reselection share catalog capacity and keep full required context", async () => {
  seedMessages.set("chat-a", []);
  await sendMessageToSession("chat-a", { text: "Hello" });
  const chat = getOrCreateChat("chat-a");
  expect(chat.status).toBe("ready");
  expect(requests).toHaveLength(1);
  useChatStore.getState().finishRun("chat-a", "completed");
  const identity = resolveModelTransportIdentity(
    selection("laguna"),
    usePreferencesStore.getState(),
  );
  expect(identity).toEqual({
    providerId: "openrouter",
    transportModelId: saved[0].transportModelId,
  });
  expect(requests[0].model).toBe(identity.transportModelId);
  const transcript = structuredClone(chat.messages);
  const prepared = await prepareModelSwitch("chat-a", selection("laguna"));
  expect(prepared.assessment.contextLimit).toBe(262144);
  expect(prepared.assessment.details?.join("\n")).toContain(
    "Provider-supplied",
  );
  expect(await prepared.commit(true)).toEqual({ ok: true });
  expect(chat.messages).toEqual(transcript);
  const cost = measureRequest(requests[0]);
  process.stdout.write(`Minimal normal wire audit ${JSON.stringify(cost)}\n`);
  // Full semantics remain present, but the canonical protected instructions
  // no longer repeat the same operational rules in several verbose sections.
  expect(cost.breakdown?.core).toBeGreaterThan(1400);
  expect(cost.breakdown?.core).toBeLessThan(2500);
  expect(cost.schemas?.exposed).toBe(0);
  expect(
    (requests[0].messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === "system",
    )?.content,
  ).toBe(
    buildStableSystem(
      selection("laguna"),
      BUILTIN_AGENTS.find((a) => a.id === "builtin:coder") ?? null,
      undefined,
      null,
    ),
  );
  prepared.dispose?.();
});

it.each([
  ["verified 4K", hostedSelection("tiny"), "Verified deployed"],
  ["unknown hosted", hostedSelection("unknown"), "Unverified capacity"],
  ["unknown compatible", "openai-compatible-custom", "Unverified capacity"],
  ["absent exact gateway variant", selection("absent"), "Unverified capacity"],
] as const)("blocks oversized mandatory context for %s without inference or history changes", async (_kind, id, provenance) => {
  usePreferencesStore.setState({
    customInstructions: "Preserve this required constraint.\n".repeat(300),
  });
  const before = structuredClone(useChatStore.getState().sessions);
  const prepared = await prepareModelSwitch("chat-a", id);
  expect(prepared.assessment).toMatchObject({
    status: "blocked",
    contextLimit: 4096,
    contextBlocked: true,
    contextCapacity: provenance === "Unverified capacity" ? "unknown" : "known",
  });
  expect(prepared.assessment.details?.join("\n")).toContain(provenance);
  expect(prepared.assessment.reasons.join(" ")).not.toMatch(
    /estimated input|output reserve|reduce the new request/,
  );
  expect(await prepared.commit(true)).toMatchObject({ ok: false });
  expect(useChatStore.getState().sessions).toEqual(before);
  expect(seedMessages.get("chat-a")).toEqual(history);
  expect(requests).toHaveLength(0);
});

it("retains provider evidence after saved selection display-name changes", async () => {
  usePreferencesStore.setState({
    savedProviderModels: saved.map((s) => ({ ...s, displayName: "Renamed" })),
  });
  const prepared = await prepareModelSwitch("chat-a", selection("offered"));
  expect(prepared.assessment.contextLimit).toBe(65536);
  expect(prepared.assessment.details?.join("\n")).toContain(
    "openrouter, test-vendor/offered:free",
  );
  prepared.dispose?.();
});

it("sends and switches the exact variant with its own capacity and capabilities", async () => {
  seedMessages.set("chat-a", []);
  useChatStore.setState({
    sessions: useChatStore.getState().sessions.map((s) =>
      s.id === "chat-a" && s.profile
        ? {
            ...s,
            profile: { ...s.profile, modelId: selection("exact-variant") },
          }
        : s,
    ),
    selectedModelId: selection("exact-variant"),
  });
  await sendMessageToSession("chat-a", { text: "Hello" });
  const chat = getOrCreateChat("chat-a");
  expect(chat.status).toBe("ready");
  expect(requests).toHaveLength(1);
  expect(requests[0].model).toBe("z-ai/glm-5.2:free");
  expect(requests[0].max_tokens).toBe(1024);
  useChatStore.getState().finishRun("chat-a", "completed");
  const transcript = structuredClone(chat.messages);
  const other = useChatStore.getState().sessions[1];
  const prepared = await prepareModelSwitch(
    "chat-a",
    selection("exact-variant"),
  );
  expect(prepared.assessment.contextLimit).toBe(32768);
  expect(prepared.assessment.status).not.toBe("blocked");
  expect(prepared.assessment.details?.join("\n")).toContain(
    "tools: unsupported",
  );
  expect(prepared.assessment.details?.join("\n")).toContain("exact-model");
  expect(await prepared.commit(true)).toEqual({ ok: true });
  expect(chat.messages).toEqual(transcript);
  expect(useChatStore.getState().sessions[1]).toBe(other);
  expect(requests).toHaveLength(1);
  const metadataCalls = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) =>
      String(url).startsWith("https://openrouter.ai/api/v1/model/"),
    );
  expect(metadataCalls.map(([url]) => String(url))).toEqual([
    "https://openrouter.ai/api/v1/model/z-ai/glm-5.2%3Afree",
  ]);
  prepared.dispose?.();
});

it("retains exact MiniMax catalog evidence for send, another-model switch and reselection while metadata is offline", async () => {
  const evidence = parseProviderContextCatalog({
    data: [minimaxFreeCatalogRecord],
  }).get(minimaxFreeCatalogRecord.id);
  if (!evidence) throw new Error("Missing exact MiniMax fixture evidence.");
  const savedModel = createSavedProviderModel({
    providerId: "openrouter", transportModelId: minimaxFreeCatalogRecord.id,
    providerEvidence: evidence,
  }, "minimax-reproduction");
  usePreferencesStore.setState({ savedProviderModels: [...saved, savedModel] });
  const id = selection(savedModel.id);
  const other = useChatStore.getState().sessions[1];
  useChatStore.setState(state => ({
    sessions: state.sessions.map(s => s.id === "chat-a" && s.profile
      ? { ...s, profile: { ...s.profile, modelId: id } } : s),
    selectedModelId: id,
  }));
  seedMessages.set("chat-a", []);
  await sendMessageToSession("chat-a", { text: "Hello" });
  const chat = getOrCreateChat("chat-a");
  expect(chat.status).toBe("ready");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ model: minimaxFreeCatalogRecord.id, max_tokens: 2048 });
  useChatStore.getState().finishRun("chat-a", "completed");
  const transcript = structuredClone(chat.messages);
  const initial = await prepareModelSwitch("chat-a", id);
  expect(initial.assessment.contextLimit).toBe(1048576);
  expect(initial.assessment.contextBlocked).not.toBe(true);
  expect(initial.assessment.status).not.toBe("blocked");
  expect(await initial.commit(true)).toEqual({ ok: true });
  initial.dispose?.();
  const normalModel = await buildConfiguredLanguageModel(id, useChatStore.getState().apiKeys, usePreferencesStore.getState());
  expect(await modelBudgetLimits(normalModel)).toMatchObject({ reported: 1048576, outputCap: 32768, reportedEvidence: evidence });
  const away = await prepareModelSwitch("chat-a", selection("laguna"));
  expect(await away.commit(true)).toEqual({ ok: true });
  away.dispose?.();
  const back = await prepareModelSwitch("chat-a", id);
  expect(back.assessment.contextLimit).toBe(1048576);
  expect(back.assessment.status).not.toBe("blocked");
  expect(back.assessment.details?.join("\n")).toContain("tools: supported");
  expect(await back.commit(true)).toEqual({ ok: true });
  expect(chat.messages).toEqual(transcript);
  expect(useChatStore.getState().sessions[1]).toBe(other);
  expect(seedMessages.get("chat-b")).toEqual(history);
  expect(usePreferencesStore.getState().savedProviderModels.find(m => m.id === savedModel.id)?.providerEvidence).toEqual(evidence);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("minimax"))).toBe(false);
  back.dispose?.();
});

it("captures evidence per active run, isolates another chat, and releases it on cancellation without persisting it per chat", () => {
  const model = createSavedProviderModel({
    providerId: "openrouter", transportModelId: minimaxFreeCatalogRecord.id,
    providerEvidence: parseProviderContextCatalog({ data: [minimaxFreeCatalogRecord] }).get(minimaxFreeCatalogRecord.id),
  }, "capture");
  usePreferencesStore.setState({ savedProviderModels: [...saved, model] });
  useChatStore.setState(state => ({ sessions: state.sessions.map(s => s.id === "chat-a" && s.profile
    ? { ...s, profile: { ...s.profile, modelId: selection(model.id) } } : s) }));
  expect(useChatStore.getState().beginRun("chat-a")).toEqual({ ok: true });
  const captured = structuredClone(capturedProviderModelEvidence.get("chat-a"));
  expect(captured).toEqual(model.providerEvidence);
  expect(capturedProviderModelEvidence.get("chat-b")).toBeUndefined();
  usePreferencesStore.setState({ savedProviderModels: saved });
  expect(capturedProviderModelEvidence.get("chat-a")).toEqual(captured);
  expect(useChatStore.getState().sessions[0].run).not.toHaveProperty("providerEvidence");
  useChatStore.getState().finishRun("chat-a", "cancelled");
  expect(capturedProviderModelEvidence.has("chat-a")).toBe(false);
});
