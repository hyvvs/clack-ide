import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { targetContextFixture } from "@/modules/ai/store/targetContext.fixture";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../lib/sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/sessions")>()),
  loadMessages: vi.fn().mockResolvedValue([]),
  saveSessionsList: vi.fn(),
}));
vi.mock("@/modules/settings/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/settings/store")>()),
  setLastUsedAiSelection: vi.fn(),
  setRecentModelIds: vi.fn(),
}));
vi.mock("../lib/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/transport")>()),
  readProjectMemory: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/ai/tools/customExecution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai/tools/customExecution")>();
  return { ...actual, buildRuntimeTools: vi.fn(actual.buildRuntimeTools) };
});

import { usePreferencesStore } from "@/modules/settings/preferences";
import { EMPTY_PROVIDER_KEYS } from "../lib/keyring";
import { loadMessages } from "../lib/sessions";
import { readProjectMemory } from "../lib/transport";
import { buildRuntimeTools } from "@/modules/ai/tools/customExecution";
import {
  createSavedProviderModel,
  savedProviderModelSelectionId,
} from "../lib/savedProviderModels";
import { attachManagedLocalGguf } from "../lib/managedLocalModels";
import { createSelfHostedEndpoint, emptySelfHostedState } from "../lib/selfHostedProfiles";
import { saveSelfHostedModel, selfHostedSelectionId } from "../lib/selfHostedModels";
import { chats, seedMessages, useChatStore } from "./chatStore";
import { prepareModelSwitch } from "./modelSwitch";

const original = useChatStore.getState();
const preferences = usePreferencesStore.getState();
const saved = createSavedProviderModel(
  { providerId: "openrouter", transportModelId: "custom/unknown" },
  "unknown",
  1,
);
const history: UIMessage[] = [
  {
    id: "old",
    role: "user",
    parts: [{ type: "text", text: "Keep this context." }],
  },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response('{"data":[]}', {
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(targetContextFixture);
  chats.clear();
  seedMessages.clear();
  seedMessages.set("chat-a", structuredClone(history));
  seedMessages.set("chat-b", []);
  usePreferencesStore.setState({
    savedProviderModels: [saved],
    customInstructions: "",
  });
  useChatStore.setState({
    activeSessionId: "chat-a",
    selectedModelId: "gpt-5.4-mini",
    apiKeys: {
      ...EMPTY_PROVIDER_KEYS,
      anthropic: "test",
      openrouter: "test",
      deepseek: "test",
    },
    sessions: ["chat-a", "chat-b"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
      profile: {
        agentId: "builtin:coder",
        modelId: "gpt-5.4-mini",
        workspaceId: null,
        workspaceRoot: null,
      },
    })),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  chats.clear();
  seedMessages.clear();
  useChatStore.setState(original);
  usePreferencesStore.setState(preferences);
});

it("prepares oversized tool history even when target tool support is unknown", async () => {
  usePreferencesStore.setState({
    customEndpoints: [
      {
        id: "small",
        name: "Small",
        modelId: "small",
        baseURL: "http://localhost:1234/v1",
        contextLimit: 20000,
      },
    ],
  });
  useChatStore.setState({ customEndpointKeys: { small: "test" } });
  seedMessages.set("chat-a", [
    history[0],
    ...Array.from(
      { length: 8 },
      (_, i): UIMessage => ({
        id: `old-${i}`,
        role: "assistant",
        parts: [{ type: "text", text: "observation ".repeat(10000) }],
      }),
    ),
    {
      id: "tool",
      role: "assistant",
      parts: [
        {
          type: "tool-read_file",
          toolCallId: "call",
          state: "output-available",
          input: { path: "README.md" },
          output: "Read successfully",
        },
      ],
    },
    {
      id: "current",
      role: "user",
      parts: [{ type: "text", text: "Continue." }],
    },
  ]);
  const result = await prepareModelSwitch("chat-a", "compat-small");
  expect(result.assessment.status, result.assessment.reasons.join(" ")).toBe(
    "warning",
  );
  expect(result.assessment.reasons.join(" ")).toContain(
    "bounded evidence preparation",
  );
  expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
  result.dispose?.();
});

describe.each([
  false,
  true,
])("shared model switch gate (follows active: %s)", (followActive) => {
  it("commits a compatible idle switch without confirmation or transcript changes", async () => {
    const messages = seedMessages.get("chat-a");
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      followActive,
    );
    expect(result.assessment.status).toBe("compatible");
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    expect(await result.commit()).toEqual({ ok: true });
    expect(useChatStore.getState().sessions[0].profile?.modelId).toBe(
      "claude-sonnet-4-6",
    );
    expect(seedMessages.get("chat-a")).toBe(messages);
  });
  it("does not override B1 when unknown capacity cannot fit mandatory context", async () => {
    // This boundary must be oversized regardless of wording-only reductions
    // to the stable system prompt. Preserve a genuinely required user
    // instruction rather than relying on obsolete prompt padding.
    usePreferencesStore.setState({
      customInstructions: "Preserve the complete required task constraint. ".repeat(800),
    });
    const result = await prepareModelSwitch(
      "chat-a",
      savedProviderModelSelectionId(saved.id),
      followActive,
    );
    expect(result.assessment.status).toBe("blocked");
    expect((await result.commit()).ok).toBe(false);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    expect((await result.commit(true)).ok).toBe(false);
  });
  it("blocks incompatible historical images before any selection is committed", async () => {
    const messages: UIMessage[] = [
      {
        id: "image",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,AA==",
          },
        ],
      },
      ...history,
    ];
    seedMessages.set("chat-a", messages);
    const result = await prepareModelSwitch(
      "chat-a",
      "deepseek-v4-flash",
      followActive,
    );
    expect(result.assessment.status).toBe("blocked");
    expect((await result.commit(true)).ok).toBe(false);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    expect(seedMessages.get("chat-a")).toEqual(messages);
  });
  it("blocks context overflow before switching without compacting stored messages", async () => {
    const messages: UIMessage[] = [
      {
        id: "large",
        role: "user",
        parts: [{ type: "text", text: "x".repeat(900_000) }],
      },
    ];
    seedMessages.set("chat-a", messages);
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      followActive,
    );
    expect(result.assessment.status).toBe("blocked");
    expect((await result.commit(true)).ok).toBe(false);
    expect(seedMessages.get("chat-a")).toBe(messages);
  });
  it("rechecks run safety before committing an earlier confirmation", async () => {
    const result = await prepareModelSwitch(
      "chat-a",
      savedProviderModelSelectionId(saved.id),
      followActive,
    );
    useChatStore.setState((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === "chat-a"
          ? {
              ...session,
              run: { state: "running", startedAt: 1, modelId: "gpt-5.4-mini" },
            }
          : session,
      ),
    }));
    expect((await result.commit(true)).ok).toBe(false);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
  });
});

describe("pre-switch race and history loading", () => {
  it("locks both selectors during preparation and cancels before a late source reply", async () => {
    const controller = new AbortController();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const reply = await targetContextFixture(command, args);
      if (command === "target_context_begin") {
        expect(
          (await prepareModelSwitch("chat-a", "claude-opus-4-7")).assessment
            .status,
        ).toBe("blocked");
        controller.abort();
      }
      return reply;
    });
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      false,
      controller.signal,
    );
    expect(result.assessment.status).toBe("blocked");
    expect((await result.commit(true)).ok).toBe(false);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "target_context_cancel"),
    ).toBe(true);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "target_context_commit"),
    ).toBe(false);
  });
  it.each([
    "credentials",
    "permission",
    "cancel",
    "native CAS",
  ])("leaves selection and memory unchanged on %s invalidation", async (cause) => {
    const controller = new AbortController();
    const before = JSON.stringify(useChatStore.getState().sessions);
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      false,
      controller.signal,
    );
    expect(result.assessment.status).toBe("compatible");
    if (cause === "credentials")
      useChatStore.setState({
        apiKeys: { ...useChatStore.getState().apiKeys, anthropic: "changed" },
      });
    if (cause === "permission")
      usePreferencesStore.setState({ agentPermissionProfiles: {} });
    if (cause === "cancel") controller.abort();
    if (cause === "native CAS")
      vi.mocked(invoke).mockImplementation(async (command, args) => {
        if (command === "target_context_commit")
          throw new Error("target_context_stale_session");
        return targetContextFixture(command, args);
      });
    expect((await result.commit(true)).ok).toBe(false);
    expect(JSON.stringify(useChatStore.getState().sessions)).toBe(before);
    result.dispose?.();
  });
  it("expires an old confirmation instead of relying on stale project context", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const result = await prepareModelSwitch("chat-a", "claude-sonnet-4-6");
    clock.mockReturnValue(now + 30_000);
    expect(await result.commit(true)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("expired"),
    });
  });
  it("rejects a context check overtaken by a new request while loading history", async () => {
    seedMessages.delete("chat-a");
    let resolveHistory: (messages: UIMessage[]) => void = () => {};
    vi.mocked(loadMessages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );
    const preparing = prepareModelSwitch("chat-a", "claude-sonnet-4-6");
    useChatStore.setState((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === "chat-a"
          ? {
              ...session,
              run: { state: "running", startedAt: 1, modelId: "gpt-5.4-mini" },
            }
          : session,
      ),
    }));
    resolveHistory(history);
    const result = await preparing;
    expect(result.assessment.status).toBe("blocked");
    expect((await result.commit(true)).ok).toBe(false);
  });
  it("loads an evicted conversation before assessing it", async () => {
    seedMessages.delete("chat-a");
    vi.mocked(loadMessages).mockResolvedValueOnce([
      {
        id: "old-image",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,AA==",
          },
        ],
      },
    ]);
    const result = await prepareModelSwitch("chat-a", "deepseek-v4-flash");
    expect(loadMessages).toHaveBeenCalledWith("chat-a");
    expect(result.assessment.status).toBe("blocked");
  });
  it("fails closed when history cannot be inspected", async () => {
    seedMessages.delete("chat-a");
    vi.mocked(loadMessages).mockRejectedValueOnce(new Error("private detail"));
    const result = await prepareModelSwitch("chat-a", "claude-sonnet-4-6");
    expect(result.assessment.status).toBe("blocked");
    expect(result.assessment.reasons.join(" ")).not.toContain("private detail");
  });
  it("includes project memory and custom instructions in the same budget", async () => {
    usePreferencesStore.setState({ customInstructions: "x".repeat(400_000) });
    vi.mocked(readProjectMemory).mockResolvedValueOnce("x".repeat(400_000));
    const result = await prepareModelSwitch("chat-a", "claude-sonnet-4-6");
    expect(result.assessment.status).toBe("blocked");
    expect(result.assessment.estimatedTokens).toBeGreaterThan(200_000);
  });
  it.each([
    "history",
    "model metadata",
    "instructions",
    "session deletion",
  ])("invalidates a confirmation after %s changes", async (change) => {
    const result = await prepareModelSwitch(
      "chat-a",
      savedProviderModelSelectionId(saved.id),
    );
    if (change === "history")
      seedMessages.set("chat-a", [
        ...history,
        {
          id: "new",
          role: "user",
          parts: [{ type: "text", text: "new message" }],
        },
      ]);
    if (change === "model metadata")
      usePreferencesStore.setState({ savedProviderModels: [] });
    if (change === "instructions")
      usePreferencesStore.setState({ customInstructions: "Changed" });
    if (change === "session deletion") useChatStore.setState({ sessions: [] });
    expect((await result.commit(true)).ok).toBe(false);
  });
  it("does not apply a delayed bottom-picker check to a different active chat", async () => {
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      true,
    );
    useChatStore.setState({ activeSessionId: "chat-b" });
    expect((await result.commit()).ok).toBe(false);
    expect(useChatStore.getState().sessions[1].profile?.modelId).toBe(
      "gpt-5.4-mini",
    );
  });
  it("keeps an explicit idle pane's selection scoped even when another pane becomes active", async () => {
    const result = await prepareModelSwitch(
      "chat-a",
      "claude-sonnet-4-6",
      false,
    );
    useChatStore.setState({ activeSessionId: "chat-b" });
    expect((await result.commit()).ok).toBe(true);
    expect(useChatStore.getState().sessions[1].profile?.modelId).toBe(
      "gpt-5.4-mini",
    );
  });
  it("does not gate a no-chat default on another conversation's history", async () => {
    useChatStore.setState({ activeSessionId: null });
    const result = await prepareModelSwitch(
      null,
      savedProviderModelSelectionId(saved.id),
      true,
    );
    expect(result.assessment.status).toBe("compatible");
    expect((await result.commit()).ok).toBe(true);
    expect(useChatStore.getState().sessions[0].profile?.modelId).toBe(
      "gpt-5.4-mini",
    );
  });
});

describe("managed GGUF model-switch native Ready commit revalidation", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const anotherDigest = `sha256:${"b".repeat(64)}`;
  const epoch = "e".repeat(64);
  const differentEpoch = "d".repeat(64);
  const material = { version: 1 as const, context: 4096,
    gpu: 0 as const, tool: false as const, grammar: false as const };

  function fixture() {
    const first = attachManagedLocalGguf(emptySelfHostedState(), {
      digest, displayName: "Same name", material,
    });
    const second = attachManagedLocalGguf(first.state, {
      digest: anotherDigest, displayName: "Same name", material,
    });
    const deploymentId = first.state.fabric!.deployments[0].id;
    usePreferencesStore.setState({ selfHostedInference: second.state });
    // A new-chat switch avoids transcript rewriting; it must still recheck
    // readiness before committing the selected model preference.
    useChatStore.setState({ activeSessionId: null });
    // The managed Chat-only target cannot claim Agent-native tools. For this
    // fixture, model preparation has no required tool schemas.
    vi.mocked(buildRuntimeTools).mockResolvedValueOnce({});
    let status = {
      installed: true, state: "Ready", epoch,
      deploymentId, modelDigest: digest, processId: 3601,
    };
    let present = true;
    let failure: string | null = null;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "managed_local_runtime_status") {
        if (failure === "status") throw new Error("Native runtime unavailable");
        return { ...status };
      }
      if (command === "managed_local_runtime_model_present") {
        expect(args).toEqual({ digest });
        if (failure === "presence") throw new Error("Native model lookup unavailable");
        return present;
      }
      if (command === "managed_local_runtime_route") {
        if (failure === "route") throw new Error("Native route unavailable");
        expect(args).toEqual({
          deploymentId,
          deploymentIdentity: JSON.parse(first.selectionId.slice("managed-local:".length))[1],
        });
        return {
          baseUrl: "http://127.0.0.1:51419/v1", apiKey: "f".repeat(64),
          epoch: status.epoch,
          modelAlias: `clack-${digest.slice(7, 23)}`,
          processId: status.processId,
        };
      }
      return targetContextFixture(command, args);
    });
    return {
      first, second,
      setStatus: (patch: Partial<typeof status>) => { status = { ...status, ...patch }; },
      setPresent: (value: boolean) => { present = value; },
      setFailure: (value: string) => { failure = value; },
    };
  }

  it("commits only a fresh exact same-epoch native Ready GGUF without Ollama fallback", async () => {
    const { first } = fixture();
    const result = await prepareModelSwitch(null, first.selectionId);
    expect(result.assessment.status, result.assessment.reasons.join(" ")).not.toBe("blocked");
    expect(await result.commit(true)).toEqual({ ok: true });
    expect(useChatStore.getState().selectedModelId).toBe(first.selectionId);
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "managed_local_runtime_status")).toHaveLength(2);
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "managed_local_runtime_model_present")).toHaveLength(2);
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "managed_local_runtime_route").length).toBeGreaterThanOrEqual(2);
  });

  it.each(["Stopped", "Loading", "Failed", "Not Installed"])(
    "refuses an in-flight managed deployment becoming %s after preparation", async (phase) => {
      const { first, setStatus } = fixture();
      const result = await prepareModelSwitch(null, first.selectionId);
      expect(result.assessment.status).not.toBe("blocked");
      setStatus({ state: phase });
      expect(await result.commit(true)).toMatchObject({ ok: false,
        reason: expect.stringContaining("managed GGUF deployment") });
      expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    },
  );

  it.each([
    "epoch", "process", "deployment", "digest", "missing file",
    "not installed", "missing epoch", "missing process",
    "native error", "file lookup error", "route failure",
  ])(
    "refuses a stale %s and preserves the original selection", async (change) => {
      const { first, second, setStatus, setPresent, setFailure } = fixture();
      const result = await prepareModelSwitch(null, first.selectionId);
      expect(result.assessment.status).not.toBe("blocked");
      if (change === "epoch") setStatus({ epoch: differentEpoch });
      if (change === "process") setStatus({ processId: 3602 });
      if (change === "deployment") setStatus({ deploymentId: second.state.fabric!.deployments[1].id });
      if (change === "digest") setStatus({ modelDigest: anotherDigest });
      if (change === "missing file") setPresent(false);
      if (change === "not installed") setStatus({ installed: false });
      if (change === "missing epoch") setStatus({ epoch: "" });
      if (change === "missing process") setStatus({ processId: 0 });
      if (change === "native error") setFailure("status");
      if (change === "file lookup error") setFailure("presence");
      if (change === "route failure") setFailure("route");
      expect(await result.commit(true)).toMatchObject({ ok: false,
        reason: expect.stringContaining("managed GGUF deployment") });
      expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
    },
  );

  it("rejects changed managed settings before querying native Ready again", async () => {
    const { first, second } = fixture();
    const result = await prepareModelSwitch(null, first.selectionId);
    expect(result.assessment.status).not.toBe("blocked");
    const before = vi.mocked(invoke).mock.calls.length;
    usePreferencesStore.setState({
      selfHostedInference: { ...second.state, fabric: {
        ...second.state.fabric!,
        deployments: second.state.fabric!.deployments.filter(row => row.id !== first.state.fabric!.deployments[0].id),
      } },
    });
    expect(await result.commit(true)).toMatchObject({ ok: false,
      reason: expect.stringContaining("settings changed") });
    expect(vi.mocked(invoke).mock.calls).toHaveLength(before);
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.4-mini");
  });

  it("leaves a normal Ollama selection free of managed runtime IPC checks", async () => {
    const endpoint = createSelfHostedEndpoint({
      alias: "Local Ollama", backendHint: "ollama",
      baseURL: "http://127.0.0.1:11434/",
    }, "local-ollama-switch", 1);
    const state = saveSelfHostedModel({ ...emptySelfHostedState(), endpoints: [endpoint] }, endpoint.id, "same-name:latest");
    const selection = selfHostedSelectionId(state.profiles[0]);
    usePreferencesStore.setState({ selfHostedInference: state });
    useChatStore.setState({ activeSessionId: null });
    const result = await prepareModelSwitch(null, selection);
    expect(result.targetLabel).not.toBe("Model change");
    expect(result.assessment.status, result.assessment.reasons.join(" ")).not.toBe("blocked");
    expect(await result.commit(true)).toEqual({ ok: true });
    expect(useChatStore.getState().selectedModelId).toBe(selection);
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command.startsWith("managed_local_runtime_"))).toBe(false);
    result.dispose?.();
  });
});
