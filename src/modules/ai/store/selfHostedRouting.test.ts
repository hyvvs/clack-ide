import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { runSubagent } from "@/modules/ai/agents/runSubagent";
import { requestCompletion } from "@/modules/editor/lib/autocomplete/provider";
import type { InferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
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
vi.mock("@/modules/ai/lib/peerTasks", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/peerTasks")>()),
  savePeerTasks: vi.fn().mockResolvedValue(undefined),
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
  setProfileOverride,
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
  { providerId: "openrouter", transportModelId: "openai/gpt-oss-20b" },
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
for (const profile of hosted.profiles)
  hosted = setProfileOverride(hosted, profile.id, "configuredContext", 32768);
const idA = selfHostedSelectionId(hosted.profiles[0]);
const idB = selfHostedSelectionId(hosted.profiles[1]);
type Outgoing = {
  admission?: InferenceAdmission;
  url: string;
  model: string;
  headers: Headers;
  messages: unknown[];
  private?: boolean;
};
const requests: Outgoing[] = [];
const approvals = new Map<string, (approved: boolean) => void>();
let snapshot: ProbeSnapshot | null = null;
let firstReply: string | null = null;
let beforeNativeSettlement: (() => Promise<void>) | undefined;
let beforeNativeReply:
  | ((args: {
      requestId: string;
      admission?: InferenceAdmission;
      onEvent: { onmessage: (e: unknown) => void };
    }) => Promise<void>)
  | undefined;

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
  approvals.clear();
  snapshot = null;
  firstReply = null;
  beforeNativeSettlement = undefined;
  beforeNativeReply = undefined;
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
    if (command === "self_hosted_profiles_snapshot")
      return [
        [
          "selfHostedInference",
          usePreferencesStore.getState().selfHostedInference,
        ],
      ];
    if (command === "ai_http_preflight") {
      const a = args as { requestId: string; approved: boolean };
      approvals.get(a.requestId)?.(a.approved);
      return null;
    }
    if (command === "ai_http_open") return crypto.randomUUID();
    if (command !== "ai_http_stream") return null;
    const a = args as {
      admission?: InferenceAdmission;
      requirePreflight?: boolean;
      requestId: string;
      url: string;
      body: number[];
      headers: Record<string, string>;
      allowPrivateNetwork: boolean;
      onEvent: { onmessage: (e: unknown) => void };
    };
    const body = JSON.parse(new TextDecoder().decode(Uint8Array.from(a.body)));
    await beforeNativeReply?.(a);
    if (a.requirePreflight) {
      const approved = await new Promise<boolean>((resolve) => {
        approvals.set(a.requestId, resolve);
        a.onEvent.onmessage({ requestId: a.requestId, kind: "preflight" });
      });
      approvals.delete(a.requestId);
      if (!approved) {
        a.onEvent.onmessage({
          requestId: a.requestId,
          kind: "settled",
          phase: "failed",
          error: { code: "context-preflight-rejected" },
        });
        return null;
      }
    }
    requests.push({
      admission: a.admission,
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
      headers: {
        "content-type": body.stream ? "text/event-stream" : "application/json",
      },
    });
    a.onEvent.onmessage({
      requestId: a.requestId,
      kind: "chunk",
      bytes: [
        ...new TextEncoder().encode(
          !body.stream
            ? JSON.stringify({
                id: "child",
                object: "chat.completion",
                created: 1,
                model: body.model,
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "child complete" },
                    finish_reason: "stop",
                  },
                ],
              })
            : requests.length === 1 && firstReply
              ? firstReply
              : response(body.model),
        ),
      ],
    });
    await beforeNativeSettlement?.();
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
  it("actual PeerTask dispatch budgets only delivered target context and refuses overflow before HTTP", async () => {
    const { usePeerTaskStore } = await import(
      "@/modules/ai/store/peerTaskStore"
    );
    const { dispatchPeerTask } = await import(
      "@/modules/ai/lib/peerTaskCoordinator"
    );
    const { PEER_TASK_SCHEMA_VERSION } = await import(
      "@/modules/ai/lib/peerTasks"
    );
    const initialPeers = usePeerTaskStore.getState();
    try {
      useChatStore.setState((s) => ({
        sessionsHydrated: true,
        sessions: s.sessions.map((session) => ({
          ...session,
          profile: {
            ...session.profile,
            agentId: session.profile?.agentId ?? "builtin:coder",
            modelId: idA,
            workspaceId: "local:c:/workspace",
            workspaceRoot: "C:/workspace",
          },
        })),
      }));
      usePreferencesStore.setState({
        selfHostedInference: setProfileOverride(
          hosted,
          hosted.profiles[0].id,
          "configuredContext",
          8192,
        ),
      });
      seedMessages.set("a-chat", [
        {
          id: "source-only",
          role: "user",
          parts: [
            {
              type: "text",
              text: "never implicitly deliver source transcript",
            },
          ],
        },
      ]);
      usePeerTaskStore.setState({
        hydrated: true,
        recoveryReady: true,
        tasks: [
          {
            schemaVersion: PEER_TASK_SCHEMA_VERSION,
            id: "budget-peer",
            sourceSessionId: "a-chat",
            targetSessionId: "b-chat",
            sourceAgentId: "builtin:coder",
            targetAgentId: "builtin:coder",
            sourceModelId: idA,
            targetModelId: idA,
            workspaceId: "local:c:/workspace",
            workspaceRoot: "C:/workspace",
            workspaceEnvironment: { kind: "local" },
            kind: "review",
            executionMode: "read-only",
            prompt: "x".repeat(16000),
            artifactRefs: [],
            parentTaskId: null,
            rootTaskId: "budget-peer",
            hopCount: 0,
            dependsOn: [],
            status: "queued",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });
      await dispatchPeerTask("budget-peer");
      expect(requests).toHaveLength(0);
      expect(usePeerTaskStore.getState().tasks[0].status).toBe("failed");
      expect(getOrCreateChat("b-chat").error?.message).toContain("exceeds");
      expect(JSON.stringify(getOrCreateChat("b-chat").messages)).not.toContain(
        "never implicitly deliver source transcript",
      );
    } finally {
      usePeerTaskStore.setState(initialPeers);
    }
  });
  it("oversized chat sends zero inference requests while an independent fitting chat sends once", async () => {
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    useChatStore.getState().setSessionModelId("b-chat", idA, false);
    const text = "x".repeat(120000);
    await sendMessageToSession("a-chat", { text });
    expect(requests).toHaveLength(0);
    expect(getOrCreateChat("a-chat").error?.message).toContain("exceeds");
    expect(JSON.stringify(getOrCreateChat("a-chat").messages)).toContain(text);
    await sendMessageToSession("b-chat", { text: "Small independent request" });
    expect(requests).toHaveLength(1);
    expect(getOrCreateChat("b-chat").error).toBeUndefined();
  });
  it("rechecks a subsequent SDK tool step and blocks its oversized result before a second HTTP call", async () => {
    toolFixture.tools = {
      read_file: tool({
        inputSchema: z.object({}),
        execute: async () => "x".repeat(120000),
      }),
    };
    firstReply = `data: ${JSON.stringify({ id: "parent", object: "chat.completion.chunk", created: 1, model: "shared-model", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "read", type: "function", function: { name: "read_file", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`;
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    await sendMessageToSession("a-chat", { text: "Read file" });
    expect(requests).toHaveLength(1);
    expect(getOrCreateChat("a-chat").error?.message).toContain("exceeds");
    expect(sessionInference("a-chat")).toBeNull();
  });
  it("rejects a changed profile after E1 queue wait without spending a model step or HTTP call", async () => {
    beforeNativeReply = async (args) => {
      args.onEvent.onmessage({
        requestId: args.requestId,
        kind: "phase",
        phase: "queued",
      });
      expect(useChatStore.getState().sessions[0].run?.budget?.totalSteps).toBe(
        0,
      );
      usePreferencesStore.setState({
        selfHostedInference: setProfileOverride(
          hosted,
          hosted.profiles[0].id,
          "workingContext",
          1000,
        ),
      });
    };
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    await sendMessageToSession("a-chat", {
      text: "Prepared before the change",
    });
    expect(requests).toHaveLength(0);
    expect(getOrCreateChat("a-chat").error?.message).toContain(
      "settings changed",
    );
    expect(sessionInference("a-chat")).toBeNull();
  });
  it("subagent generateText cannot bypass the context preflight", async () => {
    const { sessionToolContext } = await import(
      "@/modules/ai/store/chatRuntime"
    );
    await expect(
      runSubagent({
        type: "explore",
        prompt: "x".repeat(120000),
        modelId: idA,
        keys: useChatStore.getState().apiKeys,
        toolContext: sessionToolContext("a-chat").toolContext,
        providerConfig: {
          selfHostedInference: hosted,
          customEndpointKeys: { a: "a-key" },
        },
      }),
    ).rejects.toThrow("exceeds");
    expect(requests).toHaveLength(0);
  });
  it.each([
    false,
    true,
  ])("actual streamed tools wait for delayed native settlement (approval=%s)", async (approval) => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reachedSettlement = false;
    beforeNativeSettlement = async () => {
      reachedSettlement = true;
      await waiting;
    };
    const execute = vi.fn(async () => "file read");
    toolFixture.tools = {
      read_file: tool({
        inputSchema: z.object({}),
        needsApproval: approval,
        execute,
      }),
    };
    firstReply = `data: ${JSON.stringify({ id: "tool", object: "chat.completion.chunk", created: 1, model: "shared-model", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "read", type: "function", function: { name: "read_file", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`;
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    const sending = sendMessageToSession("a-chat", { text: "Read" });
    await vi.waitFor(() => expect(reachedSettlement).toBe(true));
    expect(sessionInference("a-chat")).not.toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(getOrCreateChat("a-chat").messages)).not.toContain(
      "approval-requested",
    );
    release();
    await sending;
    if (approval) {
      expect(JSON.stringify(getOrCreateChat("a-chat").messages)).toContain(
        "approval-requested",
      );
      expect(execute).not.toHaveBeenCalled();
    } else expect(execute).toHaveBeenCalledOnce();
    expect(sessionInference("a-chat")).toBeNull();
  });
  it("two chats send one stable pool identity and queue without spending model steps", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ids: string[] = [];
    beforeNativeReply = async (args) => {
      expect(args.admission).toMatchObject({ endpointId: "a", capacity: 1 });
      ids.push(args.requestId);
      args.onEvent.onmessage({
        requestId: args.requestId,
        kind: "phase",
        phase: "queued",
      });
      await waiting;
    };
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    useChatStore.getState().setSessionModelId("b-chat", idA, false);
    const first = sendMessageToSession("a-chat", { text: "First task" });
    const second = sendMessageToSession("b-chat", { text: "Second task" });
    await vi.waitFor(() => expect(ids).toHaveLength(2));
    expect(new Set(ids).size).toBe(2);
    for (const session of useChatStore.getState().sessions) {
      expect(sessionInference(session.id)?.phase).toBe("queued");
      expect(session.run?.budget?.totalSteps).toBe(0);
      expect(session.run?.budget?.continuationCount).toBe(0);
      expect(isModelSelectionLocked(session.id)).toBe(true);
    }
    useChatStore.getState().closePanel();
    expect(sessionInference("a-chat")?.phase).toBe("queued");
    release();
    await Promise.all([first, second]);
    expect(requests).toHaveLength(2);
    expect(sessionInference("a-chat")).toBeNull();
    expect(sessionInference("b-chat")).toBeNull();
  });
  it("actual streamText parent / generateText subagent / next step each enroll once after settlement", async () => {
    const child = vi.fn(async () => {
      expect(sessionInference("a-chat")).toBeNull();
      return runSubagent({
        type: "explore",
        prompt: "Inspect",
        keys: useChatStore.getState().apiKeys,
        modelId: idA,
        providerConfig: {
          selfHostedInference: hosted,
          customEndpointKeys: { a: "a-key" },
          inferenceScope: inferenceScopeForSession("a-chat"),
        },
        toolContext: {
          getCwd: () => null,
          getWorkspaceRoot: () => null,
          getTerminalContext: () => null,
          isActiveTerminalPrivate: () => true,
          injectIntoActivePty: () => false,
          openPreview: () => false,
          spawnAgent: () => null,
          readAgentOutput: () => null,
          readCache: new Map(),
          getSessionId: () => "a-chat",
          getAgentId: () => "builtin:coder",
        },
      });
    });
    toolFixture.tools = {
      run_subagent: tool({ inputSchema: z.object({}), execute: child }),
    };
    firstReply = `data: ${JSON.stringify({ id: "parent", object: "chat.completion.chunk", created: 1, model: "shared-model", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "child", type: "function", function: { name: "run_subagent", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`;
    useChatStore.getState().setSessionModelId("a-chat", idA, false);
    await sendMessageToSession("a-chat", { text: "Ask the explorer" });
    expect(getOrCreateChat("a-chat").error).toBeUndefined();
    expect(child).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(3);
    for (const request of requests)
      expect(request.admission).toEqual({
        endpointId: "a",
        profileId: hosted.profiles[0].id,
        capacity: 1,
      });
    expect(sessionInference("a-chat")).toBeNull();
  });
  it("autocomplete's generateText helper shares the legacy endpoint identity", async () => {
    const result = await requestCompletion(
      {
        prefix: "const x =",
        suffix: ";",
        language: "typescript",
        filename: "a.ts",
      },
      {
        provider: "lmstudio",
        modelId: "coder",
        apiKey: null,
        lmstudioBaseURL: "http://localhost:1234/v1",
      },
      new AbortController().signal,
    );
    expect(result).toBe("child complete");
    expect(requests[0].admission).toEqual({
      endpointId: "legacy:lmstudio",
      profileId: "coder",
      capacity: 1,
    });
  });
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
        "openai/gpt-oss-20b",
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
        "openai/gpt-oss-20b",
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
  it("locks active runs, retains captured identity, and blocks deleted/edited endpoints before HTTP", async () => {
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
    expect(chat.error?.message).toContain("settings changed");
    expect(requests).toHaveLength(0);
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
  it("blocks normalized stored images with unknown token cost even with confirmed vision", async () => {
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
    expect(getOrCreateChat("a-chat").error?.message).toContain(
      "unknown token cost",
    );
    expect(requests).toHaveLength(0);
    expect(getOrCreateChat("a-chat").messages[0].parts).toContainEqual(part);
    useChatStore.getState().finishRun("a-chat", "completed");
    snapshot = null;
    await sendMessageToSession("a-chat", { text: "No fresh evidence" });
    expect(requests).toHaveLength(0);
    expect(getOrCreateChat("a-chat").error).toBeDefined();
  });
});
