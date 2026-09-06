import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/settings/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/settings/store")>()),
  setLastUsedAiSelection: vi.fn(),
  setRecentModelIds: vi.fn(),
}));

vi.mock("@/modules/ai/lib/sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/ai/lib/sessions")>()),
  saveSessionsList: vi.fn(),
}));

vi.mock("@/modules/ai/lib/todos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/ai/lib/todos")>()),
  loadTodos: vi.fn().mockResolvedValue([]),
  saveTodos: vi.fn(),
}));

vi.mock("@/modules/ai/tools/tools", () => ({ buildTools: () => ({}) }));

import { usePreferencesStore } from "@/modules/settings/preferences";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import {
  createSavedProviderModel,
  savedProviderModelSelectionId,
} from "@/modules/ai/lib/savedProviderModels";
import type { SessionMeta, SessionRunState } from "@/modules/ai/lib/sessions";
import { getOrCreateChat, sendMessageToSession } from "./chatRuntime";
import {
  cancelRun,
  chats,
  isModelSelectionLocked,
  seedMessages,
  useChatStore,
} from "./chatStore";
import {
  createRunBudget,
  type RunBudgetPhase,
} from "@/modules/ai/lib/runBudget";
import type { AgentRunStatus } from "./chatStore";
import { prepareModelSwitch } from "./modelSwitch";
import * as attachmentStore from "../lib/attachmentStore";
import { toAttachmentMessagePart } from "../lib/attachmentMessages";
import type { AttachmentRecord } from "../lib/attachments";

const originalChatState = useChatStore.getState();
const originalPreferences = usePreferencesStore.getState();
const selectionA = savedProviderModelSelectionId("switch-a");
const selectionB = savedProviderModelSelectionId("switch-b");
const models = [
  createSavedProviderModel(
    { providerId: "openrouter", transportModelId: "test-author/model-a" },
    "switch-a",
    1,
  ),
  createSavedProviderModel(
    { providerId: "openrouter", transportModelId: "test-author/model-b" },
    "switch-b",
    1,
  ),
];

type RequestBody = {
  model: string;
  system?: unknown;
  messages: Array<{ role: string; content: unknown }>;
};
const requests: RequestBody[] = [];

function storedAttachment(kind: "text" | "image", byteSize: number) {
  const hash = "a".repeat(64);
  return toAttachmentMessagePart({
    id: "historical-file",
    source: { kind: "picker", token: "old-file" },
    displayName: kind === "text" ? "notes.txt" : "screen.png",
    detectedMediaType: kind === "text" ? "text/plain" : "image/png",
    contentKind: kind,
    byteSize,
    processingState: "ready",
    contentRef: { id: hash, contentHash: hash, byteSize },
    security: {
      secretPathCheck: "passed",
      workspaceScopeCheck: "not-applicable",
      mimeSniffed: true,
    },
    createdAt: 1,
  } satisfies AttachmentRecord);
}

function anthropicResponse(model: string) {
  const events = [
    {
      type: "message_start",
      message: {
        id: "anthropic-reply",
        role: "assistant",
        model,
        usage: { input_tokens: 20 },
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
      delta: { type: "text_delta", text: "Reply from Anthropic" },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5 },
    },
    { type: "message_stop" },
  ];
  return new Response(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function session(id: string, modelId: string): SessionMeta {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    profile: {
      agentId: "builtin:coder",
      modelId,
      workspaceRoot: null,
      workspaceId: null,
    },
  };
}

beforeEach(() => {
  chats.clear();
  seedMessages.clear();
  requests.length = 0;
  usePreferencesStore.setState({ savedProviderModels: models });
  useChatStore.setState({
    sessions: [session("chat-a", selectionA), session("chat-b", selectionB)],
    activeSessionId: "chat-a",
    selectedModelId: selectionA,
    apiKeys: { ...EMPTY_PROVIDER_KEYS, openrouter: "test-key-model-switch" },
    runtimeBySession: {},
    live: {
      ...originalChatState.live,
      getCwd: () => null,
      getWorkspaceRoot: () => null,
      getActiveFile: () => null,
    },
  });
  // Exercise the real Chat, transport, agent and provider adapter, stopping at HTTP.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as RequestBody;
      requests.push(body);
      const chunk = {
        id: `response-${requests.length}`,
        object: "chat.completion.chunk",
        created: 1,
        model: body.model,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: `Reply from ${body.model}` },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      };
      return new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    }),
  );
});

afterEach(() => {
  chats.clear();
  seedMessages.clear();
  useChatStore.setState(originalChatState);
  usePreferencesStore.setState(originalPreferences);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("model switching in an existing chat", () => {
  it("switches real provider requests while retaining text, tool history and instructions", async () => {
    const openrouterFetch = vi.mocked(fetch).getMockImplementation();
    if (!openrouterFetch) throw new Error("Missing OpenRouter test transport");
    const outgoing: Array<{
      url: string;
      body: RequestBody;
      headers: Headers;
    }> = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      outgoing.push({
        url: String(url),
        body,
        headers: new Headers(init?.headers),
      });
      if (String(url) !== "https://api.anthropic.com/v1/messages") {
        return openrouterFetch(url, init);
      }
      return anthropicResponse(body.model);
    });
    useChatStore.getState().setApiKey("anthropic", "test-anthropic-key");
    const customInstructions = "Keep the existing project test conventions.";
    usePreferencesStore.setState({ customInstructions });
    const toolInput = { path: "src/example.ts" };
    const toolOutput = { content: "export const answer = 42;" };
    const attachmentText = "Historical attachment context stays available.";
    const attachmentBytes = new TextEncoder().encode(attachmentText);
    vi.spyOn(attachmentStore, "loadAttachmentContent").mockResolvedValue(
      attachmentBytes,
    );
    const priorMessages: UIMessage[] = [
      {
        id: "prior-question",
        role: "user",
        parts: [
          { type: "text", text: "Read the example before continuing." },
          storedAttachment("text", attachmentBytes.byteLength),
        ],
      },
      {
        id: "prior-read",
        role: "assistant",
        parts: [
          {
            type: "tool-read_file",
            toolCallId: "read-before-switch",
            state: "output-available",
            input: toolInput,
            output: toolOutput,
          },
          { type: "text", text: "The example exports the answer." },
        ],
      },
    ];
    const originalMessages = structuredClone(priorMessages);
    seedMessages.set("chat-a", priorMessages);
    const chat = getOrCreateChat("chat-a");

    await sendMessageToSession("chat-a", { text: "First message" });
    expect(chat.error).toBeUndefined();
    useChatStore.getState().finishRun("chat-a", "completed");
    const toAnthropic = await prepareModelSwitch("chat-a", "claude-sonnet-4-6");
    expect(toAnthropic.assessment.status).toBe("compatible");
    expect(toAnthropic.commit()).toEqual({ ok: true });
    await sendMessageToSession("chat-a", { text: "Continue with Anthropic" });
    expect(chat.error).toBeUndefined();
    expect(useChatStore.getState().sessions[0].run).toMatchObject({
      providerId: "anthropic",
      transportModelId: "claude-sonnet-4-6",
    });
    useChatStore.getState().finishRun("chat-a", "completed");
    const toOpenRouter = await prepareModelSwitch("chat-a", selectionB);
    expect(toOpenRouter.assessment.status).toBe("warning");
    expect(toOpenRouter.commit(true)).toEqual({ ok: true });
    await sendMessageToSession("chat-a", { text: "Return to OpenRouter" });
    expect(chat.error).toBeUndefined();

    expect(getOrCreateChat("chat-a")).toBe(chat);
    expect(outgoing.map(({ url, body }) => [url, body.model])).toEqual([
      ["https://openrouter.ai/api/v1/chat/completions", "test-author/model-a"],
      ["https://api.anthropic.com/v1/messages", "claude-sonnet-4-6"],
      ["https://openrouter.ai/api/v1/chat/completions", "test-author/model-b"],
    ]);
    expect(outgoing[0].headers.get("authorization")).toBe(
      "Bearer test-key-model-switch",
    );
    expect(outgoing[1].headers.get("x-api-key")).toBe("test-anthropic-key");
    expect(outgoing[1].headers.has("authorization")).toBe(false);
    expect(outgoing[2].headers.get("authorization")).toBe(
      "Bearer test-key-model-switch",
    );
    expect(outgoing[2].headers.has("x-api-key")).toBe(false);
    for (const { body } of outgoing) {
      expect(JSON.stringify(body.messages)).toContain(attachmentText);
      expect(JSON.stringify(body.messages)).not.toContain(
        "data-clack-attachment",
      );
      const system =
        body.system ?? body.messages.filter((m) => m.role === "system");
      expect(JSON.stringify(system)).toContain(customInstructions);
      expect(JSON.stringify(system)).toContain("ACTIVE AGENT");
    }
    expect(outgoing[1].body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_use",
              id: "read-before-switch",
              name: "read_file",
              input: toolInput,
            }),
          ]),
        }),
        expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_result",
              tool_use_id: "read-before-switch",
              content: JSON.stringify(toolOutput),
            }),
          ]),
        }),
      ]),
    );
    for (const request of [outgoing[0], outgoing[2]]) {
      expect(request.body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            tool_calls: expect.arrayContaining([
              expect.objectContaining({
                id: "read-before-switch",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify(toolInput),
                },
              }),
            ]),
          }),
          expect.objectContaining({
            role: "tool",
            tool_call_id: "read-before-switch",
            content: JSON.stringify(toolOutput),
          }),
        ]),
      );
    }
    expect(priorMessages).toEqual(originalMessages);
    expect(chat.messages.slice(0, 2)).toEqual(originalMessages);
    expect(outgoing[1].body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([
            { type: "text", text: "First message" },
          ]),
        }),
        expect.objectContaining({
          role: "assistant",
          content: expect.arrayContaining([
            { type: "text", text: "Reply from test-author/model-a" },
          ]),
        }),
      ]),
    );
    expect(outgoing[2].body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "First message" }),
        expect.objectContaining({
          role: "user",
          content: "Continue with Anthropic",
        }),
        expect.objectContaining({
          role: "assistant",
          content: "Reply from Anthropic",
        }),
        expect.objectContaining({
          role: "user",
          content: "Return to OpenRouter",
        }),
      ]),
    );
  });

  it("retains compatible historical image input through a confirmed model switch", async () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFf8AAAAASUVORK5CYII=";
    const bytes = new Uint8Array(Buffer.from(png, "base64"));
    vi.spyOn(attachmentStore, "loadAttachmentContent").mockResolvedValue(bytes);
    vi.spyOn(attachmentStore, "attachmentBytesToDataUrl").mockResolvedValue(
      `data:image/png;base64,${png}`,
    );
    useChatStore.getState().setApiKey("anthropic", "test-anthropic-key");
    useChatStore.getState().setSessionModelId("chat-a", "claude-sonnet-4-6");
    const imageHistory: UIMessage[] = [
      {
        id: "prior-image",
        role: "user",
        parts: [storedAttachment("image", bytes.byteLength)],
      },
    ];
    const original = structuredClone(imageHistory);
    seedMessages.set("chat-a", imageHistory);
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      const body = JSON.parse(String(init?.body)) as RequestBody;
      requests.push(body);
      return anthropicResponse(body.model);
    });
    const chat = getOrCreateChat("chat-a");
    await sendMessageToSession("chat-a", { text: "Inspect the earlier image" });
    expect(chat.error).toBeUndefined();
    useChatStore.getState().finishRun("chat-a", "completed");
    const change = await prepareModelSwitch("chat-a", "claude-opus-4-7");
    expect(change.assessment.status).toBe("warning");
    expect(change.commit(true)).toEqual({ ok: true });
    await sendMessageToSession("chat-a", { text: "Continue inspecting it" });
    expect(chat.error).toBeUndefined();
    expect(requests.map((r) => r.model)).toEqual([
      "claude-sonnet-4-6",
      "claude-opus-4-7",
    ]);
    for (const request of requests) {
      expect(request.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image",
                source: { type: "base64", media_type: "image/png", data: png },
              }),
            ]),
          }),
        ]),
      );
    }
    expect(chat.messages[0]).toEqual(original[0]);
    expect(imageHistory).toEqual(original);
  });

  it.each<{ status: AgentRunStatus; phase: RunBudgetPhase }>([
    { status: "thinking", phase: "running" },
    { status: "streaming", phase: "running" },
    { status: "retrying", phase: "running" },
    { status: "awaiting-approval", phase: "running" },
    { status: "idle", phase: "soft-limit" },
    { status: "idle", phase: "hard-limit" },
    { status: "idle", phase: "auto-continue-pending" },
    { status: "idle", phase: "complete" },
  ])("rejects both selection routes during $status / $phase", ({
    status,
    phase,
  }) => {
    useChatStore.getState().beginRun("chat-a");
    useChatStore.setState((state) => ({
      sessions: state.sessions.map((item) =>
        item.id === "chat-a" && item.run
          ? {
              ...item,
              run: {
                ...item.run,
                budget: { ...createRunBudget("ask"), phase },
              },
            }
          : item,
      ),
    }));
    useChatStore.getState().patchAgentMeta("chat-a", { status });
    const before = useChatStore.getState().sessions[0];

    expect(isModelSelectionLocked("chat-a")).toBe(true);
    useChatStore.getState().setSelectedModelId(selectionB);
    expect(
      useChatStore.getState().setSessionModelId("chat-a", selectionB),
    ).toBe(false);
    expect(useChatStore.getState().sessions[0]).toBe(before);
    expect(useChatStore.getState().selectedModelId).toBe(selectionA);
    expect(isModelSelectionLocked("chat-b")).toBe(false);
    expect(
      useChatStore.getState().setSessionModelId("chat-b", selectionA),
    ).toBe(true);
  });

  it("keeps selection locked after Stop until the actual request settles", async () => {
    let rejectRequest!: (error: Error) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((_, reject) => {
          rejectRequest = reject;
        }),
    );
    const sending = sendMessageToSession("chat-a", { text: "Slow request" });
    await vi.waitFor(() => expect(rejectRequest).toBeTypeOf("function"));
    const chat = getOrCreateChat("chat-a");
    const statuses: string[] = [];
    const unsubscribe = chat["~registerStatusCallback"](() =>
      statuses.push(chat.status),
    );
    try {
      await cancelRun("chat-a");
      expect(useChatStore.getState().sessions[0].run?.state).toBe("cancelled");
      expect(chat.status).toBe("submitted");
      useChatStore.setState({ activeSessionId: "chat-b" });
      for (let i = 0; i < 10; i++) {
        const id = `idle-${i}`;
        useChatStore.setState((state) => ({
          sessions: [...state.sessions, session(id, selectionA)],
        }));
        getOrCreateChat(id);
      }
      expect(chats.get("chat-a")).toBe(chat);
      useChatStore.setState({ activeSessionId: "chat-a" });
      expect(isModelSelectionLocked("chat-a")).toBe(true);
      expect(
        useChatStore.getState().setSessionModelId("chat-a", selectionB),
      ).toBe(false);
      useChatStore.getState().setSelectedModelId(selectionB);
      expect(useChatStore.getState().selectedModelId).toBe(selectionA);
      expect(useChatStore.getState().beginRun("chat-a").ok).toBe(false);
    } finally {
      rejectRequest(new DOMException("Stopped", "AbortError"));
      await sending;
      unsubscribe();
    }

    expect(statuses).toContain("ready");
    expect(isModelSelectionLocked("chat-a")).toBe(false);
    expect(
      useChatStore.getState().setSessionModelId("chat-a", selectionB),
    ).toBe(true);
    await sendMessageToSession("chat-a", { text: "Use the new model" });
    expect(requests[requests.length - 1]?.model).toBe("test-author/model-b");
  });

  it.each<Exclude<SessionRunState, "running">>([
    "completed",
    "cancelled",
    "failed",
    "interrupted",
  ])("uses the new OpenRouter model after a %s run, retaining the transcript", async (state) => {
    const chat = getOrCreateChat("chat-a");
    await sendMessageToSession("chat-a", { text: "First message" });
    expect(chat.error).toBeUndefined();
    useChatStore.getState().finishRun("chat-a", state);

    expect(
      useChatStore.getState().setSessionModelId("chat-a", selectionB),
    ).toBe(true);
    await sendMessageToSession("chat-a", { text: "Follow-up message" });

    expect(chat.error).toBeUndefined();
    expect(getOrCreateChat("chat-a")).toBe(chat);
    expect(requests.map((request) => request.model)).toEqual([
      "test-author/model-a",
      "test-author/model-b",
    ]);
    expect(requests[1].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "First message" }),
        expect.objectContaining({
          role: "assistant",
          content: "Reply from test-author/model-a",
        }),
        expect.objectContaining({ role: "user", content: "Follow-up message" }),
      ]),
    );

    useChatStore.getState().finishRun("chat-a", "completed");
    useChatStore.getState().setSessionModelId("chat-a", selectionA);
    await sendMessageToSession("chat-a", { text: "Back to the first model" });
    expect(requests[2].model).toBe("test-author/model-a");
  });

  it("uses a background pane's new model instead of the foreground selection", async () => {
    await sendMessageToSession("chat-a", { text: "First message" });
    useChatStore.getState().finishRun("chat-a", "completed");
    useChatStore.setState({
      activeSessionId: "chat-b",
      selectedModelId: selectionA,
    });
    useChatStore.getState().setSessionModelId("chat-a", selectionB);

    await sendMessageToSession("chat-a", { text: "Reply to pane A" });

    expect(requests[1].model).toBe("test-author/model-b");
    expect(useChatStore.getState().selectedModelId).toBe(selectionA);
  });

  it("keeps an active run pinned through continuation and settings changes", async () => {
    await sendMessageToSession("chat-a", { text: "First message" });
    expect(
      useChatStore.getState().setSessionModelId("chat-a", selectionB),
    ).toBe(false);
    useChatStore.setState({
      activeSessionId: "chat-b",
      selectedModelId: selectionB,
    });
    usePreferencesStore.setState({
      savedProviderModels: [
        { ...models[0], transportModelId: "test-author/changed" },
        models[1],
      ],
    });

    await getOrCreateChat("chat-a").sendMessage();

    expect(requests.map((request) => request.model)).toEqual([
      "test-author/model-a",
      "test-author/model-a",
    ]);
  });
});
