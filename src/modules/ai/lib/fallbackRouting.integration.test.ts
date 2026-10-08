import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage, UIMessageChunk } from "ai";
import { invoke } from "@tauri-apps/api/core";
import { createContextAwareTransport } from "@/modules/ai/lib/transport";
import {
  prepareSessionFallback,
  describeFallbackDestination,
  requestFallbackApproval,
  resolveFallbackProposal,
  setFallbackPolicy,
  useFallbackProposals,
} from "@/modules/ai/store/inferenceFallback";
import {
  useChatStore,
  inferenceScopeForSession,
  seedMessages,
} from "@/modules/ai/store/chatStore";
import { corpus, assertPrivateAbsent } from "@/modules/ai/quality/oracle";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import {
  FALLBACK_CATEGORIES,
  type FallbackPolicy,
} from "@/modules/ai/lib/inferenceFallback";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import type { ToolContext } from "@/modules/ai/tools/tools";
import type { SessionMeta } from "@/modules/ai/lib/sessions";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_event: unknown) => {};
  },
}));
vi.mock("@/modules/ai/lib/providerRetry", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/providerRetry")>()),
  withProviderRetryTracking: (model: unknown) => model,
}));
vi.mock("@/modules/ai/tools/tools", async () => {
  const { tool } = await import("ai");
  const { z } = await import("zod");
  return {
    buildTools: () => ({
      read_fixture: tool({
        description: "Read fixture",
        inputSchema: z.object({}),
        execute: async () => ({ text: "evidence" }),
      }),
    }),
  };
});
vi.mock("@/modules/ai/lib/sessions", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/sessions")>()),
  awaitSessionWrites: vi.fn().mockResolvedValue(undefined),
}));

const PRIVATE = "PRIVATE_G3_DO_NOT_LEAK_493871";
const messages: UIMessage[] = [
  { id: "user", role: "user", parts: [{ type: "text", text: PRIVATE }] },
];
const chatState = useChatStore.getState();
const preferences = usePreferencesStore.getState();
let saved: SessionMeta;
let policy: FallbackPolicy;
let changed: boolean;
let unsafeEffect: boolean;
let fallbackFails: boolean;
let outputPartial: boolean;
let targetModel: string;
const captures: {
  url: string;
  body: Record<string, unknown>;
  token?: string;
}[] = [];
const acknowledgments = new Map<string, (approved: boolean) => void>();
const toolContext = {
  getSessionId: () => "chat",
  getAgentId: () => "agent",
  getWorkspaceId: () => "local:/fixture",
  getWorkspaceRoot: () => "/fixture",
  getCwd: () => "/fixture",
  getRunId: () => 10,
  getWorkspaceEnv: () => undefined,
} as unknown as ToolContext;
function anthropic() {
  return [
    {
      type: "message_start",
      message: {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Recovered fixture" },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 3 },
    },
    { type: "message_stop" },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}
async function collect(stream: ReadableStream<UIMessageChunk>) {
  const r = stream.getReader();
  const parts: UIMessageChunk[] = [];
  while (true) {
    const next = await r.read();
    if (next.done) break;
    parts.push(next.value);
  }
  return parts;
}
async function route(signal?: AbortSignal) {
  const transport = createContextAwareTransport({
    prepareFallback: prepareSessionFallback("chat"),
    getInferenceScope: () => inferenceScopeForSession("chat"),
    getKeys: () => useChatStore.getState().apiKeys,
    getModelId: () => "compat-primary",
    getCapturedModelIdentity: () =>
      resolveModelTransportIdentity(
        "compat-primary",
        usePreferencesStore.getState(),
      ),
    getCustomInstructions: () => "",
    getAgentPersona: () => null,
    getCustomEndpoints: () => usePreferencesStore.getState().customEndpoints,
    getSavedProviderModels: () => [],
    getSelfHostedInference: () =>
      usePreferencesStore.getState().selfHostedInference,
    getLive: () => ({
      cwd: null,
      workspaceRoot: null,
      activeFile: null,
      terminalPrivate: true,
    }),
    toolContext,
    onError: (error) =>
      error instanceof Error ? error.message : String(error),
  });
  return collect(
    await transport.sendMessages({ messages, abortSignal: signal }),
  );
}
beforeEach(async () => {
  changed = false;
  unsafeEffect = false;
  fallbackFails = false;
  outputPartial = false;
  targetModel = "claude-haiku-4-5";
  captures.length = 0;
  acknowledgments.clear();
  usePreferencesStore.setState({
    ...preferences,
    customEndpoints: [
      {
        id: "primary",
        name: "Private",
        baseURL: "http://127.0.0.1:43210/v1",
        modelId: "primary",
        contextLimit: 32768,
      },
    ],
  });
  saved = {
    id: "chat",
    title: "Private",
    createdAt: 1,
    updatedAt: 1,
    profile: {
      modelId: "compat-primary",
      agentId: "agent",
      workspaceId: "local:/fixture",
      workspaceRoot: "/fixture",
    },
    run: {
      state: "running",
      startedAt: 10,
      modelId: "compat-primary",
      agentId: "agent",
      workspaceId: "local:/fixture",
      workspaceRoot: "/fixture",
      providerId: "openai-compatible",
      transportModelId: "primary",
      endpointBaseURL: "http://127.0.0.1:43210/v1",
      customEndpointId: "primary",
    },
  };
  useChatStore.setState({
    ...chatState,
    sessions: [
      saved,
      ...corpus.canaries.map((canary, i) => ({
        id: `q1-private-${i}`,
        title: "Unrelated fixture",
        createdAt: 1,
        updatedAt: 1,
        profile: {
          agentId: `unrelated-${i}`,
          modelId: "claude-haiku-4-5",
          workspaceId: `local:/unrelated-${i}`,
          workspaceRoot: `/unrelated-${i}`,
        },
        privateFixtureCanary: canary,
      })),
    ],
    apiKeys: { ...EMPTY_PROVIDER_KEYS, anthropic: "dummy-private-fixture-key" },
  });
  for (const [i, canary] of corpus.canaries.entries())
    seedMessages.set(`q1-private-${i}`, [
      {
        id: `secret-${i}`,
        role: "user",
        parts: [{ type: "text", text: canary }],
      },
    ]);
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      const a = args as Record<string, unknown>;
      if (command === "conversation_fallback_describe")
        return {
          ...a,
          configurationHash:
            changed && a.modelId === targetModel
              ? "b".repeat(64)
              : "a".repeat(64),
        };
      if (command === "conversation_fallback_boundary") return "a".repeat(64);
      if (command === "conversation_fallback_begin") {
        const b = a.begin as { revision: number };
        if (unsafeEffect) throw new Error("fallback_unsafe_effect_or_output");
        if (b.revision !== policy.revision || policy.mode === "never")
          throw new Error("fallback_stale_policy");
        saved = {
          ...saved,
          fallback: policy,
          modelRevision: (saved.modelRevision ?? 0) + 1,
        };
        return { token: "native-fixture-grant", session: saved };
      }
      if (command === "conversation_fallback_set") {
        const update = a.update as {
          mode: FallbackPolicy["mode"];
          expectedRevision: number;
        };
        if (update.expectedRevision !== policy.revision)
          throw new Error("fallback_stale_policy");
        policy = {
          ...policy,
          mode: update.mode,
          revision: policy.revision + 1,
        };
        saved = {
          ...saved,
          fallback: policy,
          modelRevision: (saved.modelRevision ?? 0) + 1,
        };
        return saved;
      }
      if (command === "ai_http_open") return crypto.randomUUID();
      if (command === "ai_http_preflight") {
        acknowledgments.get(a.requestId as string)?.(a.approved as boolean);
        return;
      }
      if (command !== "ai_http_stream") return null;
      const request = a as unknown as {
        requestId: string;
        url: string;
        body: number[];
        fallbackToken?: string;
        onEvent: { onmessage: (event: unknown) => void };
      };
      const send = (value: Record<string, unknown>) =>
        request.onEvent.onmessage({ requestId: request.requestId, ...value });
      const approved = await new Promise<boolean>((resolve) => {
        acknowledgments.set(request.requestId, resolve);
        send({ kind: "preflight" });
      });
      if (!approved) {
        send({
          kind: "settled",
          phase: "failed",
          error: { code: "context-preflight-rejected" },
        });
        return;
      }
      const fallback = request.url.includes("anthropic");
      if (fallback) expect(request.fallbackToken).toBe("native-fixture-grant");
      captures.push({
        url: request.url,
        body: JSON.parse(
          new TextDecoder().decode(Uint8Array.from(request.body)),
        ),
        token: request.fallbackToken,
      });
      const status = fallback
        ? fallbackFails
          ? 503
          : 200
        : outputPartial
          ? 200
          : 503;
      send({
        kind: "headers",
        status,
        headers: {
          "content-type":
            status === 200 ? "text/event-stream" : "application/json",
        },
      });
      const payload =
        status !== 200
          ? JSON.stringify({ error: { message: "Unavailable" } })
          : fallback
            ? anthropic()
            : `data: ${JSON.stringify({ id: "partial", created: 1, model: "primary", choices: [{ index: 0, delta: { content: "partial primary" }, finish_reason: null }] })}\n\n`;
      send({ kind: "chunk", bytes: [...new TextEncoder().encode(payload)] });
      send({
        kind: "settled",
        phase:
          outputPartial && !fallback
            ? "disconnected"
            : status === 200
              ? "completed"
              : "failed",
        ...(outputPartial && !fallback
          ? { error: { code: "remote-disconnect" } }
          : {}),
      });
    });
  const primary = await describeFallbackDestination("compat-primary");
  const destination = await describeFallbackDestination(targetModel);
  policy = {
    version: 1,
    revision: 1,
    mode: "never",
    agentId: "agent",
    workspaceId: "local:/fixture",
    primary,
    destination,
    categories: [...FALLBACK_CATEGORIES],
    history: [],
  };
  saved = { ...saved, fallback: policy };
  useChatStore.setState({
    sessions: useChatStore
      .getState()
      .sessions.map((s) => (s.id === saved.id ? saved : s)),
  });
});
afterEach(() => {
  assertPrivateAbsent(captures);
  for (const [i] of corpus.canaries.entries())
    seedMessages.delete(`q1-private-${i}`);
  resolveFallbackProposal("chat", false);
  useChatStore.setState(chatState);
  usePreferencesStore.setState(preferences);
});
function mode(value: FallbackPolicy["mode"]) {
  policy = { ...policy, mode: value };
  saved = { ...saved, fallback: policy };
  useChatStore.setState({
    sessions: useChatStore
      .getState()
      .sessions.map((s) => (s.id === saved.id ? saved : s)),
  });
}

describe("G3 private fixture routing through SDK serialization and native preflight", () => {
  it("Never sends private data to primary only, no alternate describe/probe", async () => {
    vi.mocked(invoke).mockClear();
    const output = await route();
    expect(captures, JSON.stringify(output)).toHaveLength(1);
    expect(JSON.stringify(captures[0].body)).toContain(PRIVATE);
    expect(captures[0].url).toContain("127.0.0.1");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([command]) =>
            command === "conversation_fallback_describe" ||
            command === "ai_metadata_http_stream",
        ),
    ).toBe(false);
  });
  it("Ask waits, decline sends nothing to fallback", async () => {
    mode("ask");
    const result = route();
    await vi.waitFor(() =>
      expect(useFallbackProposals.getState().proposals.chat).toBeDefined(),
    );
    expect(captures).toHaveLength(1);
    resolveFallbackProposal("chat", false);
    await result;
    expect(captures).toHaveLength(1);
  });
  it("Ask approves one exact destination with actual target model/tool schemas and private body", async () => {
    mode("ask");
    const result = route();
    await vi.waitFor(() =>
      expect(useFallbackProposals.getState().proposals.chat).toBeDefined(),
    );
    const proposal = useFallbackProposals.getState().proposals.chat;
    if (!proposal) throw new Error("Expected owned fallback proposal");
    expect(proposal.destination.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(captures).toHaveLength(1);
    resolveFallbackProposal("chat", true, proposal.id);
    const parts = await result;
    expect(captures).toHaveLength(2);
    expect(captures[1].body.model).toBe(targetModel);
    expect(JSON.stringify(captures[1].body)).toContain(PRIVATE);
    expect(JSON.stringify(captures[1].body.tools)).toContain("read_fixture");
    expect(parts.filter((p) => p.type === "start")).toHaveLength(1);
    expect(
      parts.some(
        (p) => p.type === "text-delta" && p.delta === "Recovered fixture",
      ),
    ).toBe(true);
    expect(saved.run?.modelId).toBe("compat-primary");
    expect(saved.profile?.modelId).toBe("compat-primary");
  });
  it("trusted routes once and a failed fallback never tries a third route", async () => {
    mode("trusted");
    fallbackFails = true;
    const parts = await route();
    expect(captures).toHaveLength(2);
    expect(parts.some((p) => p.type === "error")).toBe(true);
    expect(captures.map((c) => new URL(c.url).hostname)).toEqual([
      "127.0.0.1",
      "api.anthropic.com",
    ]);
  });
  it.each([
    "revoked",
    "changed",
  ])("%s policy while Ask waits blocks all alternate transmission", async (kind) => {
    mode("ask");
    const result = route();
    await vi.waitFor(() =>
      expect(useFallbackProposals.getState().proposals.chat).toBeDefined(),
    );
    if (kind === "revoked") await setFallbackPolicy("chat", "never");
    else {
      changed = true;
      resolveFallbackProposal("chat", true);
    }
    await result;
    expect(captures).toHaveLength(1);
  });
  it("changed endpoint invalidates trusted consent without a probe", async () => {
    mode("trusted");
    changed = true;
    await route();
    expect(captures).toHaveLength(1);
  });
  it("native completed/unknown tool effects deny rerouting", async () => {
    mode("trusted");
    unsafeEffect = true;
    await route();
    expect(captures).toHaveLength(1);
  });
  it.each([
    "chat",
    "workspace",
    "agent",
  ])("%s isolation does not leak private context", async (kind) => {
    mode("trusted");
    if (kind === "chat")
      useChatStore.setState({ sessions: [{ ...saved, id: "other" }] });
    if (kind === "workspace")
      useChatStore.setState({
        sessions: [{ ...saved, fallback: { ...policy, workspaceId: "other" } }],
      });
    if (kind === "agent")
      useChatStore.setState({
        sessions: [{ ...saved, fallback: { ...policy, agentId: "other" } }],
      });
    await route();
    expect(captures).toHaveLength(1);
  });
  it("partial primary output never begins fallback", async () => {
    mode("trusted");
    outputPartial = true;
    await route();
    expect(captures).toHaveLength(1);
  });
  it("restart serialization keeps policy but never restores pending approvals", async () => {
    mode("trusted");
    const restored = JSON.parse(JSON.stringify(saved));
    expect(restored.fallback.mode).toBe("trusted");
    expect(useFallbackProposals.getState().proposals.chat).toBeUndefined();
    if (!policy.primary || !policy.destination)
      throw new Error("Expected consent destinations");
    const abort = new AbortController();
    const pending = requestFallbackApproval(
      "chat",
      {
        id: "old",
        primary: policy.primary,
        destination: policy.destination,
        reason: "offline",
      },
      abort.signal,
    );
    resolveFallbackProposal("chat", true, "wrong");
    expect(useFallbackProposals.getState().proposals.chat).toBeDefined();
    abort.abort();
    expect(await pending).toBe(false);
    await setFallbackPolicy("chat", "never");
    expect(JSON.parse(JSON.stringify(saved)).fallback.mode).toBe("never");
  });
  it("stale consent preview cannot authorize a changed destination", async () => {
    changed = true;
    await expect(
      setFallbackPolicy("chat", "trusted", targetModel, policy.destination),
    ).rejects.toThrow("changed since preview");
    expect(captures).toHaveLength(0);
  });
});
