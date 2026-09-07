import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { tool } from "ai";
import { z } from "zod";
const toolFixture = vi.hoisted(() => ({ tools: {} as import("ai").ToolSet }));

vi.mock("@/modules/settings/store", async (original) => ({
  ...(await original<typeof import("@/modules/settings/store")>()),
  setLastUsedAiSelection: vi.fn(),
  setRecentModelIds: vi.fn(),
}));
vi.mock("@/modules/ai/lib/sessions", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/sessions")>()),
  saveSessionsList: vi.fn(),
  saveActiveId: vi.fn().mockResolvedValue(undefined),
  deleteSessionData: vi.fn().mockResolvedValue(undefined),
  loadMessages: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/modules/ai/lib/todos", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/todos")>()),
  loadTodos: vi.fn().mockResolvedValue([]),
  saveTodos: vi.fn(),
}));
vi.mock("@/modules/ai/tools/tools", () => ({
  buildTools: () => toolFixture.tools,
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(),
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  deleteSelfHostedEndpoint,
  editSelfHostedEndpoint,
  emptySelfHostedState,
  profileEvidence,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  saveSelfHostedModel,
  selfHostedSelectionId,
} from "@/modules/ai/lib/selfHostedModels";
import {
  createSavedProviderModel,
  savedProviderModelSelectionId,
} from "@/modules/ai/lib/savedProviderModels";
import {
  capturedSelfHostedRuns,
  chats,
  seedMessages,
  useChatStore,
  hasKeyForModel,
  cancelRun,
  isModelSelectionLocked,
  inferenceScopeForSession,
} from "@/modules/ai/store/chatStore";
import {
  getOrCreateChat,
  sendMessageToSession,
  shouldAutomaticallySendSession,
} from "@/modules/ai/store/chatRuntime";
import { prepareModelSwitch } from "@/modules/ai/store/modelSwitch";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import * as attachmentStore from "@/modules/ai/lib/attachmentStore";
import { toAttachmentMessagePart } from "@/modules/ai/lib/attachmentMessages";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import {
  beginInference,
  sessionInference,
} from "@/modules/ai/lib/inferenceLifecycle";

const initialChat = useChatStore.getState();
const initialPrefs = usePreferencesStore.getState();
const cloud = createSavedProviderModel(
  { providerId: "openrouter", transportModelId: "author/cloud" },
  "router",
);
const cloudId = savedProviderModelSelectionId(cloud.id);
const endpointA = createSelfHostedEndpoint(
  {
    alias: "Private PC",
    backendHint: "ollama",
    baseURL: "http://100.64.1.2:11434/proxy",
    allowPrivateNetwork: true,
    credentialRef: { kind: "custom-endpoint", endpointId: "a" },
  },
  "a",
);
const endpointB = createSelfHostedEndpoint(
  {
    alias: "Public PC",
    backendHint: "vllm",
    baseURL: "https://example.test/team/v1",
    allowPrivateNetwork: false,
    credentialRef: { kind: "custom-endpoint", endpointId: "b" },
  },
  "b",
);
let hosted = addSelfHostedEndpoint(
  addSelfHostedEndpoint(emptySelfHostedState(), endpointA),
  endpointB,
);
hosted = saveSelfHostedModel(
  saveSelfHostedModel(hosted, "a", "shared-model"),
  "b",
  "shared-model",
);
const idA = selfHostedSelectionId(hosted.profiles[0]);
const idB = selfHostedSelectionId(hosted.profiles[1]);
type Outgoing = {
  url: string;
  model: string;
  headers: Headers;
  messages: unknown[];
  private?: boolean;
};
const requests: Outgoing[] = [];
let snapshot: ProbeSnapshot | null = null;
let firstReply: string | null = null;

function response(model: string) {
  return `data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: { role: "assistant", content: `Reply from ${model}` }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
}

beforeEach(() => {
  vi.stubGlobal(
    "FileReader",
    class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onloadend: (() => void) | null = null;
      readAsDataURL(blob: Blob) {
        void blob.arrayBuffer().then((bytes) => {
          this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
          this.onload?.();
          this.onloadend?.();
        });
      }
    },
  );
  vi.clearAllMocks();
  chats.clear();
  seedMessages.clear();
  capturedSelfHostedRuns.clear();
  requests.length = 0;
  snapshot = null;
  firstReply = null;
  toolFixture.tools = {};
  usePreferencesStore.setState({
    ...initialPrefs,
    selfHostedInference: hosted,
    savedProviderModels: [cloud],
    customInstructions: "Preserve the project requirements.",
  });
  useChatStore.setState({
    ...initialChat,
    activeSessionId: "a-chat",
    selectedModelId: cloudId,
    apiKeys: {
      ...EMPTY_PROVIDER_KEYS,
      openrouter: "router-key",
      "openai-compatible": "never-leak-this-key",
    },
    customEndpointKeys: { a: "a-key", b: "b-key" },
    runtimeBySession: {},
    sessions: ["a-chat", "b-chat"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
      profile: {
        agentId: "builtin:coder",
        modelId: cloudId,
        workspaceRoot: null,
        workspaceId: null,
      },
    })),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push({
        url: String(url),
        model: body.model,
        messages: body.messages,
        headers: new Headers(init?.headers),
      });
      return new Response(response(body.model), {
        headers: { "content-type": "text/event-stream" },
      });
    }),
  );
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "self_hosted_probe_cache") return snapshot;
    if (command === "ai_http_open") return crypto.randomUUID();
    if (command !== "ai_http_stream") return null;
    const a = args as {
      requestId: string;
      url: string;
      body: number[];
      headers: Record<string, string>;
      allowPrivateNetwork: boolean;
      onEvent: { onmessage: (e: unknown) => void };
    };
    const body = JSON.parse(new TextDecoder().decode(Uint8Array.from(a.body)));
    requests.push({
      url: a.url,
      model: body.model,
      messages: body.messages,
      headers: new Headers(a.headers),
      private: a.allowPrivateNetwork,
    });
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "headers",
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "chunk",
      bytes: [
        ...new TextEncoder().encode(
          requests.length === 1 && firstReply
            ? firstReply
            : response(body.model),
        ),
      ],
    });
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "settled",
      phase: "completed",
    });
    return null;
  });
});
afterEach(() => {
  chats.clear();
  seedMessages.clear();
  capturedSelfHostedRuns.clear();
  useChatStore.setState(initialChat);
  usePreferencesStore.setState(initialPrefs);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("self-hosted actual chat routing", () => {
  it("a settled Stop cannot overwrite a newer logical run's status", async () => {
    useChatStore.getState().beginRun("a-chat");
    const attempt = beginInference(inferenceScopeForSession("a-chat"), vi.fn());
    const stopping = cancelRun("a-chat");
    expect(useChatStore.getState().beginRun("a-chat").ok).toBe(false);
    attempt.settle();
    expect(useChatStore.getState().beginRun("a-chat").ok).toBe(true);
    await stopping;
    expect(useChatStore.getState().sessions[0].run?.state).toBe("running");
    expect(useChatStore.getState().runtimeBySession["a-chat"].status).toBe(
      "thinking",
    );
  });
  it("Stop drains only its native attempt, keeps model switching locked, and blocks automatic continuation", async () => {
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    expect(useChatStore.getState().beginRun("a-chat").ok).toBe(true);
    const scope = inferenceScopeForSession("a-chat");
    const abort = vi.fn();
    const attempt = beginInference(scope, abort);
    attempt.update("generating", "native-a");
    const stopping = cancelRun("a-chat");
    expect(abort).toHaveBeenCalledOnce();
    expect(sessionInference("a-chat")?.phase).toBe("stopping");
    expect(isModelSelectionLocked("a-chat")).toBe(true);
    expect(isModelSelectionLocked("b-chat")).toBe(false);
    expect((await prepareModelSwitch("a-chat", idB)).commit(true).ok).toBe(
      false,
    );
    expect((await prepareModelSwitch("b-chat", idB)).commit(true).ok).toBe(
      true,
    );
    expect(scope?.isCurrent()).toBe(false);
    const approval: UIMessage[] = [
      {
        id: "approval",
        role: "assistant",
        parts: [
          {
            type: "tool-read_file",
            toolCallId: "read",
            state: "approval-responded",
            input: {},
            approval: { id: "approval-id", approved: false },
          },
        ],
      },
    ];
    expect(shouldAutomaticallySendSession("a-chat", approval)).toBe(false);
    attempt.settle();
    await stopping;
    expect(isModelSelectionLocked("a-chat")).toBe(false);
    expect((await prepareModelSwitch("a-chat", idB)).commit(true).ok).toBe(
      true,
    );
  });
  it("pane close and minimize leave background attempt ownership intact", async () => {
    useChatStore.getState().beginRun("a-chat");
    const abort = vi.fn();
    const attempt = beginInference(inferenceScopeForSession("a-chat"), abort);
    useChatStore.getState().closeMini();
    useChatStore.getState().closePanel();
    expect(abort).not.toHaveBeenCalled();
    expect(sessionInference("a-chat")?.scope?.sessionId).toBe("a-chat");
    expect(sessionInference("b-chat")).toBeNull();
    attempt.settle();
    expect(useChatStore.getState().sessions[0].run?.state).toBe("running");
  });
  it.each([
    false,
    true,
  ])("releases the actual request before local tool/approval wait (approval=%s)", async (approval) => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async () => {
      await waiting;
      return "local result";
    });
    toolFixture.tools = {
      read_file: tool({
        inputSchema: z.object({}),
        needsApproval: approval,
        execute,
      }),
    };
    firstReply = `data: ${JSON.stringify({ id: "tool-reply", object: "chat.completion.chunk", created: 1, model: "shared-model", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "read", type: "function", function: { name: "read_file", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`;
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    const sending = sendMessageToSession("a-chat", { text: "Read a file" });
    if (approval) {
      await vi.waitFor(() =>
        expect(JSON.stringify(getOrCreateChat("a-chat").messages)).toContain(
          "approval-requested",
        ),
      );
      expect(execute).not.toHaveBeenCalled();
    } else await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(sessionInference("a-chat")).toBeNull();
    expect(useChatStore.getState().sessions[0].run?.state).toBe("running");
    expect(isModelSelectionLocked("a-chat")).toBe(true);
    if (approval) await cancelRun("a-chat");
    release();
    await sending;
    expect(sessionInference("a-chat")).toBeNull();
  });
  it("switches cloud -> private server A -> server B -> cloud with the same chat and intact history", async () => {
    const original: UIMessage[] = [
      {
        id: "old",
        role: "user",
        parts: [{ type: "text", text: "Keep my original instructions." }],
      },
      {
        id: "tool",
        role: "assistant",
        parts: [
          {
            type: "tool-read_file",
            toolCallId: "read-1",
            state: "output-available",
            input: { path: "a.ts" },
            output: { content: "important code" },
          },
        ],
      },
    ];
    seedMessages.set("a-chat", original);
    const chat = getOrCreateChat("a-chat");
    await sendMessageToSession("a-chat", { text: "Start in cloud" });
    expect(chat.error).toBeUndefined();
    for (const selection of [idA, idB, cloudId]) {
      useChatStore.getState().finishRun("a-chat", "completed");
      const change = await prepareModelSwitch("a-chat", selection);
      expect(change.assessment.status).not.toBe("blocked");
      expect(change.commit(true)).toEqual({ ok: true });
      await sendMessageToSession("a-chat", { text: "Continue the task" });
      expect(chat.error).toBeUndefined();
    }
    expect(getOrCreateChat("a-chat")).toBe(chat);
    expect(chat.messages.slice(0, 2)).toEqual(original);
    expect(
      requests.map((r) => [
        r.url,
        r.model,
        r.headers.get("authorization"),
        r.private,
      ]),
    ).toEqual([
      [
        "https://openrouter.ai/api/v1/chat/completions",
        "author/cloud",
        "Bearer router-key",
        undefined,
      ],
      [
        "http://100.64.1.2:11434/proxy/v1/chat/completions",
        "shared-model",
        "Bearer a-key",
        true,
      ],
      [
        "https://example.test/team/v1/chat/completions",
        "shared-model",
        "Bearer b-key",
        false,
      ],
      [
        "https://openrouter.ai/api/v1/chat/completions",
        "author/cloud",
        "Bearer router-key",
        undefined,
      ],
    ]);
    for (const r of requests) {
      expect(JSON.stringify(r.messages)).toContain("important code");
      expect(JSON.stringify(r.messages)).toContain(
        "Keep my original instructions",
      );
      expect(JSON.stringify(r.messages)).toContain(
        "Preserve the project requirements",
      );
      expect(r.headers.get("authorization")).not.toContain("never-leak");
    }
  });
  it("locks active runs and retains captured address/auth when another chat or settings change", async () => {
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    expect(useChatStore.getState().beginRun("a-chat")).toEqual({ ok: true });
    const capturedRun = useChatStore.getState().sessions[0].run;
    const credentials = capturedSelfHostedRuns.get("a-chat");
    expect((await prepareModelSwitch("a-chat", idB)).commit(true).ok).toBe(
      false,
    );
    expect((await prepareModelSwitch("b-chat", idB)).commit(true).ok).toBe(
      true,
    );
    usePreferencesStore.setState({
      selfHostedInference: deleteSelfHostedEndpoint(
        editSelfHostedEndpoint(hosted, "a", {
          baseURL: "https://changed.test/v1",
        }),
        "a",
      ),
    });
    useChatStore.getState().setCustomEndpointKeys({ a: "rotated", b: "b-key" });
    expect(useChatStore.getState().sessions[0].run).toBe(capturedRun);
    expect(credentials?.endpointKeys.a).toBe("a-key");
    const chat = getOrCreateChat("a-chat");
    await chat.sendMessage({ text: "Captured request" });
    expect(chat.error).toBeUndefined();
    expect(requests[0]).toMatchObject({
      url: "http://100.64.1.2:11434/proxy/v1/chat/completions",
      model: "shared-model",
      private: true,
    });
    expect(requests[0].headers.get("authorization")).toBe("Bearer a-key");
    expect(JSON.stringify(useChatStore.getState().sessions)).not.toContain(
      "a-key",
    );
    useChatStore.getState().finishRun("a-chat", "completed");
    expect(capturedSelfHostedRuns.has("a-chat")).toBe(false);
    expect(hasKeyForModel(idA)).toBe(false);
    expect(() =>
      buildConfiguredLanguageModel(idA, EMPTY_PROVIDER_KEYS, {
        selfHostedInference: usePreferencesStore.getState().selfHostedInference,
      }),
    ).toThrow("unavailable");
  });
  it("releases captured credentials when a chat is deleted", () => {
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    expect(useChatStore.getState().beginRun("a-chat")).toEqual({ ok: true });
    expect(capturedSelfHostedRuns.has("a-chat")).toBe(true);
    useChatStore.getState().deleteSession("a-chat");
    expect(capturedSelfHostedRuns.has("a-chat")).toBe(false);
  });
  it("sends normalized stored images through the actual compatible image payload only with confirmed vision", async () => {
    const now = Date.now();
    snapshot = {
      endpointId: "a",
      configurationRevision: 1,
      selectedModelId: "shared-model",
      observedAt: now,
      connected: true,
      reachable: true,
      credentialUsed: true,
      stale: false,
      refreshing: false,
      inventoryTtlMs: 300000,
      instanceTtlMs: 30000,
      errors: [],
      models: [
        {
          id: "shared-model",
          name: null,
          chat: "supported",
          evidence: [
            profileEvidence(
              hosted,
              hosted.profiles[0].id,
              "probe.vision",
              true,
              "advertised",
              now,
              "reported",
            ),
          ],
        },
      ],
    };
    const bytes = new Uint8Array([137, 80, 78, 71]);
    vi.spyOn(attachmentStore, "loadAttachmentContent").mockResolvedValue(bytes);
    const hash = "a".repeat(64);
    const part = toAttachmentMessagePart({
      id: "image",
      source: { kind: "picker", token: "image" },
      displayName: "image.png",
      detectedMediaType: "image/png",
      contentKind: "image",
      byteSize: bytes.length,
      processingState: "ready",
      contentRef: { id: hash, contentHash: hash, byteSize: bytes.length },
      security: {
        secretPathCheck: "passed",
        workspaceScopeCheck: "not-applicable",
        mimeSniffed: true,
      },
      createdAt: 1,
    });
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    await sendMessageToSession("a-chat", {
      parts: [{ type: "text", text: "Describe it" }, part],
    });
    expect(getOrCreateChat("a-chat").error).toBeUndefined();
    expect(JSON.stringify(requests[0].messages)).toContain("image_url");
    expect(JSON.stringify(requests[0].messages)).toContain(
      "data:image/png;base64,",
    );
    expect(JSON.stringify(requests[0].messages)).not.toContain(
      "data-clack-attachment",
    );
    useChatStore.getState().finishRun("a-chat", "completed");
    snapshot = null;
    await sendMessageToSession("a-chat", { text: "No fresh evidence" });
    expect(requests).toHaveLength(1);
    expect(getOrCreateChat("a-chat").error).toBeDefined();
  });
});
