/**
 * LM2D offline acceptance boundary: real SDK model construction and request
 * serialization through the production Tauri fetch adapter, with native IPC
 * simulated. This test never starts an engine, touches Ollama, or opens a URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { invoke } from "@tauri-apps/api/core";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { createManagedDeployment } from "@/modules/ai/lib/managedLocalModels";
import { emptySelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import type { ManagedLocalNativeRoute } from "@/modules/ai/lib/managedLocalRuntime";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { hasKeyForModel, useChatStore } from "@/modules/ai/store/chatStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class { onmessage = (_event: unknown) => {}; },
}));

const digest = `sha256:${"a".repeat(64)}`;
const selection = createManagedDeployment(emptySelfHostedState(), {
  digest,
  displayName: "Small offline fixture",
  material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
});
const readyRoute: ManagedLocalNativeRoute = {
  baseUrl: "http://127.0.0.1:50891/v1",
  apiKey: "f".repeat(64),
  epoch: "e".repeat(64),
  modelAlias: `clack-${"a".repeat(16)}`,
  processId: 2100,
};

type NativeRequest = {
  url: string;
  body: number[];
  headers: Record<string, string>;
  admission: { endpointId: string; profileId: string; capacity: number };
  allowPrivateNetwork: boolean;
  requestId: string;
  onEvent: { onmessage: (event: unknown) => void };
};

const dispatched: NativeRequest[] = [];
const approvals = new Map<string, (approved: boolean) => void>();
let liveRoute = readyRoute;
let nextId = 0;

beforeEach(() => {
  vi.clearAllMocks();
  approvals.clear();
  dispatched.length = 0;
  liveRoute = readyRoute;
  nextId = 0;
  // The only allowed request destination is intercepted native IPC.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected browser/network fetch"); }));
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "managed_local_runtime_route") return { ...liveRoute };
    if (command === "ai_http_open") return `managed-${++nextId}`;
    if (command === "ai_http_preflight") {
      const { requestId, approved } = args as { requestId: string; approved: boolean };
      approvals.get(requestId)?.(approved);
      return;
    }
    if (command === "ai_http_stream") {
      const request = args as NativeRequest;
      const approved = await new Promise<boolean>(resolve => {
        approvals.set(request.requestId, resolve);
        request.onEvent.onmessage({ requestId: request.requestId, kind: "preflight" });
      });
      if (!approved) throw new Error("Production request preflight refused the fixture");
      dispatched.push(request);
      const completion = {
        id: "fixture-completion", object: "chat.completion", created: 1,
        model: readyRoute.modelAlias,
        choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      };
      request.onEvent.onmessage({
        requestId: request.requestId, kind: "headers", status: 200,
        headers: { "content-type": "application/json" },
      });
      request.onEvent.onmessage({
        requestId: request.requestId, kind: "chunk",
        bytes: [...new TextEncoder().encode(JSON.stringify(completion))],
      });
      request.onEvent.onmessage({
        requestId: request.requestId, kind: "settled", phase: "completed",
      });
      return;
    }
    if (command === "ai_http_cancel") return;
    throw new Error(`Unexpected native operation: ${command}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

const managedModel = () => buildConfiguredLanguageModel(
  selection.selectionId, EMPTY_PROVIDER_KEYS,
  { selfHostedInference: selection.state },
);

describe("LM2D ordinary Chat uses exact ready native route (offline IPC fixture)", () => {
  it("accepts exact managed deployments without a cloud credential, but rejects stale identities", () => {
    const priorPreferences = usePreferencesStore.getState().selfHostedInference;
    const priorKeys = useChatStore.getState().apiKeys;
    try {
      usePreferencesStore.setState({ selfHostedInference: selection.state });
      useChatStore.setState({ apiKeys: EMPTY_PROVIDER_KEYS });
      expect(hasKeyForModel(selection.selectionId)).toBe(true);
      expect(hasKeyForModel("managed-local:[]")).toBe(false);
      usePreferencesStore.setState({
        selfHostedInference: {
          ...selection.state,
          fabric: { ...selection.state.fabric!, deployments: [] },
        },
      });
      expect(hasKeyForModel(selection.selectionId)).toBe(false);
    } finally {
      usePreferencesStore.setState({ selfHostedInference: priorPreferences });
      useChatStore.setState({ apiKeys: priorKeys });
    }
  });

  it("serializes Chat to the native llama.cpp alias with 2048-context registration and no cloud or Ollama call", async () => {
    const model = await managedModel();
    const answer = await generateText({
      model, prompt: "Reply OK", maxOutputTokens: 32, maxRetries: 0,
    });
    expect(answer.text).toBe("OK");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].url).toBe(`${readyRoute.baseUrl}/chat/completions`);
    expect(dispatched[0].allowPrivateNetwork).toBe(true);
    expect(dispatched[0].admission).toEqual({
      endpointId: "clack-managed", profileId: selection.state.fabric?.deployments[0].id,
      capacity: 1,
    });
    const body = JSON.parse(new TextDecoder().decode(Uint8Array.from(dispatched[0].body)));
    expect(body.model).toBe(readyRoute.modelAlias);
    expect(body.messages).toEqual([{ role: "user", content: "Reply OK" }]);
    expect(new Headers(dispatched[0].headers).get("authorization"))
      .toBe(`Bearer ${readyRoute.apiKey}`);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command))
      .toEqual(["managed_local_runtime_route", "managed_local_runtime_route",
        "ai_http_open", "ai_http_stream", "ai_http_preflight"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a changed native process epoch before any provider dispatch", async () => {
    const model = await managedModel();
    liveRoute = { ...readyRoute, epoch: "0".repeat(64) };
    await expect(generateText({
      model, prompt: "Should not send", maxOutputTokens: 32, maxRetries: 0,
    })).rejects.toThrow(/restarted or changed/);
    expect(dispatched).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalledWith("ai_http_open");
    expect(invoke).not.toHaveBeenCalledWith("ai_http_stream", expect.anything());
    expect(fetch).not.toHaveBeenCalled();
  });
});
