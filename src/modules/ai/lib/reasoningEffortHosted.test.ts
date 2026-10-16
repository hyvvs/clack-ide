import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { hostedEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import { createRequestPreflight } from "@/modules/ai/lib/requestPreflight";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("R2 self-hosted actual requests and admission revalidation", () => {
  it.each([
    "low",
    "high",
    "automatic",
    "unsupported",
    "unknown",
  ])("%s sends only evidenced parameters through the native proxy", async (choice) => {
    const fixture = hostedEffortFixture(
      choice === "unsupported" ? "unsupported" : "supported",
    );
    if (choice === "unknown") fixture.profile.evidence = [];
    const reasoning = captureEffort(
      "local",
      fixture.identity,
      undefined,
      fixture.state,
    );
    if (["low", "high"].includes(choice)) reasoning.choice = choice;
    const requests: Record<string, unknown>[] = [];
    const approvals = new Map<string, (approved: boolean) => void>();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "self_hosted_profiles_snapshot")
        return [["selfHostedInference", fixture.state]];
      if (command === "ai_http_open") return crypto.randomUUID();
      if (command === "ai_http_preflight") {
        const a = args as { requestId: string; approved: boolean };
        approvals.get(a.requestId)?.(a.approved);
      }
      if (command !== "ai_http_stream") return null;
      const a = args as {
        requestId: string;
        body: number[];
        onEvent: { onmessage: (event: unknown) => void };
        admission: { capacity: number };
      };
      expect(a.admission.capacity).toBe(1);
      const approved = await new Promise<boolean>((resolve) => {
        approvals.set(a.requestId, resolve);
        a.onEvent.onmessage({ requestId: a.requestId, kind: "preflight" });
      });
      expect(approved).toBe(true);
      requests.push(
        JSON.parse(new TextDecoder().decode(Uint8Array.from(a.body))),
      );
      a.onEvent.onmessage({
        requestId: a.requestId,
        kind: "headers",
        status: 400,
        headers: {},
      });
      a.onEvent.onmessage({
        requestId: a.requestId,
        kind: "chunk",
        bytes: [...new TextEncoder().encode('{"error":{"message":"fixture"}}')],
      });
      a.onEvent.onmessage({
        requestId: a.requestId,
        kind: "settled",
        phase: "failed",
        error: { code: "provider-error" },
      });
      return null;
    });
    const model = await buildLanguageModel(
      "openai-compatible",
      EMPTY_PROVIDER_KEYS,
      fixture.profile.transportModelId,
      {
        reasoning,
        selfHosted: true,
        selfHostedInference: fixture.state,
        openaiCompatibleBaseURL: fixture.endpoint.baseURL,
        admission: {
          endpointId: fixture.endpoint.id,
          profileId: fixture.profile.id,
          capacity: 1,
        },
        inferenceScope: {
          sessionId: "a",
          runId: crypto.randomUUID(),
          isCurrent: () => true,
        },
      },
    );
    if (typeof model === "string" || model.specificationVersion !== "v3")
      throw Error("adapter");
    await Promise.resolve(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      }),
    ).catch(() => undefined);
    expect(requests).toHaveLength(1);
    expect(requests[0].reasoning_effort).toBe(
      ["low", "high"].includes(choice) ? choice : undefined,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    "revoked",
    "expired",
    "configuration",
  ])("%s evidence fails safely after waiting when fresh proof is unavailable", async (failure) => {
    const fixture = hostedEffortFixture();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const reasoning = {
      ...captureEffort("local", fixture.identity, undefined, fixture.state),
      choice: "high",
    };
    const current = structuredClone(fixture.state);
    const snapshot: ProbeSnapshot = {
      endpointId: fixture.endpoint.id,
      configurationRevision: fixture.endpoint.configurationRevision,
      selectedModelId: fixture.profile.transportModelId,
      observedAt: now,
      connected: true, reachable: true, credentialUsed: false,
      stale: false, refreshing: false, errors: [],
      inventoryTtlMs: 300_000, instanceTtlMs: 30_000,
      models: [{ id: fixture.profile.transportModelId, name: null,
        chat: "supported", evidence: fixture.profile.evidence }],
    };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "self_hosted_profiles_snapshot")
        return [["selfHostedInference", current]];
      if (command === "self_hosted_probe_cache") return snapshot;
      if (command === "self_hosted_probe") throw new Error("Metadata unavailable");
      throw new Error(`Unexpected IPC: ${command}`);
    });
    const preflight = createRequestPreflight({
      modelId: reasoning.model,
      local: true,
      state: fixture.state,
      reasoning,
      admission: {
        endpointId: fixture.endpoint.id,
        profileId: fixture.profile.id,
        capacity: 1,
      },
    });
    const revalidate = await preflight.prepare({
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 256,
    });
    vi.mocked(invoke).mockClear();
    if (failure === "expired")
      vi.mocked(Date.now).mockReturnValue(now + 31_000);
    if (failure === "revoked") current.profiles[0].evidence = [];
    if (failure === "configuration")
      current.endpoints[0].configurationRevision++;
    await expect(revalidate()).rejects.toThrow(failure === "configuration"
      ? /settings changed/ : /could not be revalidated/);
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls.filter(([command]) => command === "self_hosted_probe"))
      .toHaveLength(failure === "configuration" ? 0 : 1);
    expect(calls.every(([command]) => ["self_hosted_profiles_snapshot",
      "self_hosted_probe_cache", "self_hosted_probe"].includes(command))).toBe(true);
  });
});
