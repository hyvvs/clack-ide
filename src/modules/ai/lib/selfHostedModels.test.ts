import { describe, expect, it } from "vitest";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  deleteSelfHostedEndpoint,
  editSelfHostedEndpoint,
  emptySelfHostedState,
  readSelfHostedState,
  resolveSelfHostedSelection,
  profileEvidence,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  SELF_HOSTED_BACKENDS,
  compatibleServerBaseURL,
  endpointAllowsPrivate,
  saveSelfHostedModel,
  savedSelfHostedModelInfos,
  selfHostedCredential,
  selfHostedSelectionId,
  selfHostedTransportIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import { migrateSelfHostedProfiles } from "@/modules/ai/lib/selfHostedMigration";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import {
  createSavedProviderModel,
  resolveModelSelectionInfo,
  resolveModelTransportIdentity,
  savedProviderModelSelectionId,
} from "@/modules/ai/lib/savedProviderModels";
import {
  resolveModelInputCapabilities,
  attachmentCapabilityStatus,
} from "@/modules/ai/lib/modelCapabilities";
import { serverModelDetails } from "@/modules/ai/lib/selfHostedCapabilities";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import type { SelfHostedBackend } from "@/modules/ai/lib/selfHostedProfiles";
import type { AttachmentRecord } from "@/modules/ai/lib/attachments";

function fixture(backendHint: SelfHostedBackend = "ollama") {
  const endpoint = createSelfHostedEndpoint(
    { alias: "AI Server", baseURL: "http://localhost:11434", backendHint },
    "server-a",
    1,
  );
  const state = saveSelfHostedModel(
    addSelfHostedEndpoint(emptySelfHostedState(), endpoint),
    endpoint.id,
    "model-a",
    "Friendly model",
  );
  const profile = state.profiles[0];
  return {
    endpoint,
    state,
    profile,
    selection: selfHostedSelectionId(profile),
  };
}

describe("self-hosted saved model bindings", () => {
  it.each(
    Object.keys(SELF_HOSTED_BACKENDS) as SelfHostedBackend[],
  )("adds %s without another provider store", (backend) => {
    const { state, selection, endpoint } = fixture(backend);
    expect(
      resolveSelfHostedSelection(readSelfHostedState(state), selection),
    ).toMatchObject({ status: "available", endpoint });
    expect(savedSelfHostedModelInfos(state)).toMatchObject([
      { id: selection, label: "Friendly model", hint: "AI Server" },
    ]);
  });
  it("saves multiple models on one endpoint without duplicate credentials", () => {
    const { state, endpoint } = fixture();
    const next = saveSelfHostedModel(state, endpoint.id, "another");
    expect(next.endpoints).toEqual([endpoint]);
    expect(savedSelfHostedModelInfos(next)).toHaveLength(2);
    expect(
      saveSelfHostedModel(next, endpoint.id, "another").profiles,
    ).toHaveLength(2);
  });
  it("keeps identical models and aliases on different servers distinct", () => {
    const { state, selection } = fixture();
    const other = createSelfHostedEndpoint(
      { alias: "AI Server", baseURL: "https://other.example/v1" },
      "server-b",
      1,
    );
    const next = saveSelfHostedModel(
      addSelfHostedEndpoint(state, other),
      other.id,
      "model-a",
    );
    const choices = savedSelfHostedModelInfos(next);
    expect(choices.map((m) => m.id)).toHaveLength(2);
    expect(choices[1].id).not.toBe(selection);
    expect(
      selfHostedTransportIdentity(choices[1].id, next)?.endpointBaseURL,
    ).toBe("https://other.example/v1");
  });
  it("renames without changing binding identity or configuration revision", () => {
    const { state, selection, endpoint } = fixture();
    const next = editSelfHostedEndpoint(state, endpoint.id, {
      alias: "Gaming PC",
    });
    expect(next.endpoints[0].configurationRevision).toBe(
      endpoint.configurationRevision,
    );
    expect(resolveModelSelectionInfo(selection, [], [], next).hint).toBe(
      "Gaming PC",
    );
    expect(savedSelfHostedModelInfos(next)[0].id).toBe(selection);
  });
  it.each([
    { baseURL: "https://other.example/v1" },
    { backendHint: "vllm" as const },
    {
      credentialRef: {
        kind: "custom-endpoint" as const,
        endpointId: "server-a",
      },
    },
    { allowPrivateNetwork: true },
  ])("invalidates changed server configuration: %j", (patch) => {
    const { state, endpoint } = fixture();
    expect(
      editSelfHostedEndpoint(state, endpoint.id, patch).endpoints[0]
        .configurationRevision,
    ).toBe(2);
  });
  it("deletion keeps profiles and produces missing rather than cloud fallback", () => {
    const { state, endpoint, selection } = fixture();
    const captured = resolveModelTransportIdentity(selection, {
      selfHostedInference: state,
    });
    const next = deleteSelfHostedEndpoint(state, endpoint.id);
    expect(next.profiles).toEqual(state.profiles);
    expect(savedSelfHostedModelInfos(next)).toEqual([]);
    expect(() =>
      resolveModelTransportIdentity(selection, { selfHostedInference: next }),
    ).toThrow("unavailable");
    expect(captured.endpointBaseURL).toBe("http://localhost:11434/v1");
  });
  it("does not silently resolve missing profile selections through the static catalog", () => {
    expect(() => resolveModelSelectionInfo("self-hosted:missing")).toThrow(
      "unavailable",
    );
  });
  it.each([
    "ollama",
    "lmstudio",
    "mlx",
  ])("surfaces migrated %s without re-adding it", (provider) => {
    const state = migrateSelfHostedProfiles(
      null,
      new Map([[`${provider}ModelId`, "original"]]),
    );
    expect(savedSelfHostedModelInfos(state)).toMatchObject([
      { id: `${provider}-local`, label: "original" },
    ]);
    expect(
      selfHostedTransportIdentity(`${provider}-local`, state)?.transportModelId,
    ).toBe("original");
    expect(endpointAllowsPrivate(state.endpoints[0])).toBe(true);
  });
  it("preserves compat selection identity and existing credential reference", () => {
    const state = migrateSelfHostedProfiles(
      null,
      new Map([
        [
          "customEndpoints",
          [
            {
              id: "old",
              name: "Old server",
              baseURL: "https://old.example/v1",
              modelId: "original",
            },
          ],
        ],
      ]),
    );
    const identity = selfHostedTransportIdentity("compat-old", state);
    expect(identity).toMatchObject({
      transportModelId: "original",
      selfHosted: {
        credentialRef: { kind: "custom-endpoint", endpointId: "old" },
      },
    });
    expect(savedSelfHostedModelInfos(state)[0].id).toBe("compat-old");
  });
  it("leaves cloud and saved OpenRouter selection behavior unchanged", () => {
    const { state } = fixture();
    const saved = createSavedProviderModel(
      {
        providerId: "openrouter",
        transportModelId: "author/id",
        displayName: "Saved",
      },
      "router",
    );
    expect(resolveModelSelectionInfo("gpt-5.4-mini", [], [], state)).toEqual(
      resolveModelSelectionInfo("gpt-5.4-mini"),
    );
    expect(
      resolveModelTransportIdentity(savedProviderModelSelectionId(saved.id), {
        selfHostedInference: state,
        savedProviderModels: [saved],
      }),
    ).toEqual({ providerId: "openrouter", transportModelId: "author/id" });
  });
  it.each([
    ["ollama", "http://host:11434/proxy", "http://host:11434/proxy/v1"],
    ["lmstudio", "https://host/prefix/v1/", "https://host/prefix/v1"],
    ["vllm", "https://host/", "https://host/v1"],
    ["mlx", "https://host/prefix/v1", "https://host/prefix/v1"],
    ["openai-compatible", "https://host/custom/api", "https://host/custom/api"],
  ] as const)("preserves %s reverse-proxy address %s", (backendHint, baseURL, expected) => {
    expect(
      compatibleServerBaseURL(
        createSelfHostedEndpoint({ alias: "Server", baseURL, backendHint }),
      ),
    ).toBe(expected);
  });
  it("requires explicit private access on new servers and no unrelated cloud key", () => {
    const { state, selection, endpoint } = fixture();
    expect(endpointAllowsPrivate(endpoint)).toBe(false);
    const identity = selfHostedTransportIdentity(selection, state);
    if (!identity) throw new Error("Missing test identity");
    expect(
      selfHostedCredential(
        identity,
        { ...EMPTY_PROVIDER_KEYS, "openai-compatible": "unrelated" },
        {},
      ),
    ).toBeUndefined();
  });
  it("reads only the referenced endpoint key and never falls back on missing auth", () => {
    const { state, endpoint, selection } = fixture();
    const next = editSelfHostedEndpoint(state, endpoint.id, {
      credentialRef: { kind: "custom-endpoint", endpointId: endpoint.id },
    });
    const identity = selfHostedTransportIdentity(selection, next);
    if (!identity) throw new Error("Missing test identity");
    expect(
      selfHostedCredential(identity, EMPTY_PROVIDER_KEYS, {
        [endpoint.id]: "correct",
        other: "wrong",
      }),
    ).toBe("correct");
    expect(() =>
      selfHostedCredential(
        identity,
        { ...EMPTY_PROVIDER_KEYS, "openai-compatible": "wrong" },
        {},
      ),
    ).toThrow("Authentication required");
    expect(JSON.stringify(next)).not.toContain("correct");
  });
});

describe("truthful server capabilities", () => {
  function evidenceFixture(values: Record<string, number | boolean>) {
    const f = fixture();
    const now = Date.now();
    const evidence = Object.entries(values).map(([metric, value]) =>
      profileEvidence(
        f.state,
        f.profile.id,
        `probe.${metric}`,
        value,
        "advertised",
        now,
        "reported",
      ),
    );
    const snapshot: ProbeSnapshot = {
      endpointId: f.endpoint.id,
      configurationRevision: 1,
      selectedModelId: "model-a",
      observedAt: now,
      connected: true,
      reachable: true,
      credentialUsed: false,
      stale: false,
      refreshing: false,
      inventoryTtlMs: 300000,
      instanceTtlMs: 30000,
      models: [{ id: "model-a", name: null, chat: "supported", evidence }],
      errors: [],
    };
    return { ...f, snapshot, now };
  }
  it.each([
    [true, "supported"],
    [false, "unsupported"],
    [undefined, "unknown"],
  ] as const)("maps vision evidence %s to %s", (vision, expected) => {
    const f = evidenceFixture(vision === undefined ? {} : { vision });
    const caps = resolveModelInputCapabilities(
      f.selection,
      f.state,
      f.snapshot,
    );
    expect(caps.image).toBe(expected);
    expect(
      attachmentCapabilityStatus(
        {
          contentKind: "image",
          detectedMediaType: "image/png",
        } as AttachmentRecord,
        caps,
      ).state,
    ).toBe(expected === "supported" ? "ready" : "blocked");
  });
  it("does not trust persisted evidence without the native cache", () => {
    const f = evidenceFixture({ vision: true });
    f.state.profiles[0].evidence = f.snapshot.models[0].evidence;
    expect(resolveModelInputCapabilities(f.selection, f.state).image).toBe(
      "unknown",
    );
  });
  it.each([
    "stale",
    "expired",
    "changed",
    "different-model",
  ])("blocks stale/mismatched positive evidence: %s", (kind) => {
    const f = evidenceFixture({ vision: true });
    if (kind === "stale") f.snapshot.stale = true;
    if (kind === "expired")
      f.snapshot.models[0].evidence[0].observedAt = f.now - 300001;
    if (kind === "changed") f.state.endpoints[0].configurationRevision++;
    if (kind === "different-model") f.snapshot.models[0].id = "other";
    expect(
      resolveModelInputCapabilities(f.selection, f.state, f.snapshot).image,
    ).toBe("unknown");
  });
  it("keeps cached evidence usable while updating but not after failed refresh", () => {
    const f = evidenceFixture({ vision: true });
    f.snapshot.refreshing = true;
    expect(
      resolveModelInputCapabilities(f.selection, f.state, f.snapshot).image,
    ).toBe("supported");
    f.snapshot.stale = true;
    f.snapshot.connected = false;
    expect(
      resolveModelInputCapabilities(f.selection, f.state, f.snapshot).image,
    ).toBe("unknown");
  });
  it.each([
    [true, "unknown"],
    [false, "unsupported"],
  ] as const)("does not equate tool training %s with parser reliability", (trainedForTools, expected) => {
    const f = evidenceFixture({ trainedForTools });
    expect(
      resolveModelInputCapabilities(f.selection, f.state, f.snapshot).tools,
    ).toBe(expected);
  });
  it("separates loaded server context from theoretical maximum", () => {
    const f = evidenceFixture({
      loadedContext: 32768,
      advertisedContext: 131072,
    });
    expect(serverModelDetails(f.endpoint, "model-a", f.snapshot)).toMatchObject(
      {
        serverContext: "32,768 tokens (loaded)",
        advertisedContext:
          "131,072 tokens (model maximum, not current server context)",
      },
    );
    expect(
      serverModelDetails(f.endpoint, "model-a", f.snapshot, f.now + 30001)
        .serverContext,
    ).toBe("Unknown");
  });
  it("does not promote theoretical context or manual IDs to current capacity", () => {
    const f = evidenceFixture({ advertisedContext: 131072 });
    expect(
      serverModelDetails(f.endpoint, "model-a", f.snapshot).serverContext,
    ).toBe("Unknown");
    expect(serverModelDetails(f.endpoint, "manual", f.snapshot)).toMatchObject({
      serverContext: "Unknown",
      verified: false,
    });
  });
});
