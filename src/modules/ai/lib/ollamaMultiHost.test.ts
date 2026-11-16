import { describe, expect, it } from "vitest";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  deleteSelfHostedEndpoint,
  editSelfHostedEndpoint,
  emptySelfHostedState,
  readSelfHostedState,
  resolveSelfHostedSelection,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  ensureDefaultOllamaHost,
  migrateSelfHostedProfiles,
} from "@/modules/ai/lib/selfHostedMigration";
import {
  saveSelfHostedModel,
  savedSelfHostedModelInfos,
  selfHostedSelectionId,
  selfHostedTransportIdentity,
  assertCurrentOllamaHostIdentity,
} from "@/modules/ai/lib/selfHostedModels";

const host = (id: string, alias: string, url: string) =>
  createSelfHostedEndpoint(
    { alias, baseURL: url, backendHint: "ollama", allowPrivateNetwork: true },
    id,
    5,
  );

describe("LM0/LM1/LM2 Ollama host identity and migration", () => {
  it("creates a durable This PC default with no legacy model, without modifying legacy preferences", () => {
    const legacy = new Map<string, unknown>();
    const state = ensureDefaultOllamaHost(migrateSelfHostedProfiles(null, legacy), legacy, 1);
    expect(state.endpoints).toHaveLength(1);
    expect(state.endpoints[0]).toMatchObject({
      id: "legacy:ollama",
      alias: "This PC",
      enabled: true,
      location: "local",
      backendHint: "ollama",
      legacy: { selectionId: "ollama-local", profileId: null },
    });
    expect(state.profiles).toHaveLength(0);
    expect(legacy.size).toBe(0);
    expect(
      ensureDefaultOllamaHost(readSelfHostedState(JSON.parse(JSON.stringify(state))), legacy),
    ).toEqual(state);
  });

  it("keeps the legacy model and endpoint binding when supplied by old settings", () => {
    const settings = new Map<string, unknown>([
      ["ollamaBaseURL", "http://127.0.0.1:11435/v1"],
      ["ollamaModelId", "existing:model"],
    ]);
    const migrated = ensureDefaultOllamaHost(migrateSelfHostedProfiles(null, settings, 5), settings);
    const selected = resolveSelfHostedSelection(migrated, "ollama-local");
    expect(selected.status).toBe("available");
    if (selected.status !== "available") throw Error("missing migration");
    expect(selected.profile.transportModelId).toBe("existing:model");
    expect(selected.endpoint.baseURL).toBe("http://127.0.0.1:11435/v1");
    expect(selected.endpoint.alias).toBe("This PC");
  });

  it("adopts a model chosen through the legacy local setting after first boot", () => {
    const initial = ensureDefaultOllamaHost(emptySelfHostedState(), new Map(), 1);
    const settings = new Map<string, unknown>([["ollamaModelId", "new:model"]]);
    const after = migrateSelfHostedProfiles(initial, settings, 2);
    const selected = resolveSelfHostedSelection(after, "ollama-local");
    expect(selected.status).toBe("available");
    if (selected.status !== "available") throw Error("legacy selection unavailable");
    expect(selected.endpoint.id).toBe("legacy:ollama");
    expect(selected.profile.transportModelId).toBe("new:model");
    expect(after.endpoints[0].alias).toBe("This PC");
    expect(after.endpoints).toHaveLength(1);
  });

  it("keeps identical model names distinct on two hosts and routes by selected host", () => {
    let state = emptySelfHostedState();
    state = addSelfHostedEndpoint(state, host("pc", "This PC", "http://127.0.0.1:11434"));
    state = addSelfHostedEndpoint(state, host("gpu", "Gaming PC", "http://192.168.2.8:11434"));
    expect(state.endpoints.map((e) => e.location)).toEqual(["local", "remote"]);
    state = saveSelfHostedModel(state, "pc", "same:model");
    state = saveSelfHostedModel(state, "gpu", "same:model");
    const [local, remote] = state.profiles;
    expect(local.id).not.toBe(remote.id);
    const a = selfHostedSelectionId(local), b = selfHostedSelectionId(remote);
    expect(a).not.toBe(b);
    expect(savedSelfHostedModelInfos(state).map(m => m.hint)).toEqual(["This PC", "Gaming PC"]);
    const routeA = selfHostedTransportIdentity(a, state)!;
    const routeB = selfHostedTransportIdentity(b, state)!;
    expect(routeA.endpointBaseURL).toBe("http://127.0.0.1:11434/v1");
    expect(routeB.endpointBaseURL).toBe("http://192.168.2.8:11434/v1");
    expect(routeB.transportModelId).toBe("same:model");
    const restarted = readSelfHostedState(JSON.parse(JSON.stringify(state)));
    expect(selfHostedTransportIdentity(b, restarted)?.endpointBaseURL)
      .toBe("http://192.168.2.8:11434/v1");
    expect(() => assertCurrentOllamaHostIdentity(routeA, b, state)).toThrow(/identity changed/);
  });

  it("retains disabled and offline hosts/configuration without routing or losing other models", () => {
    let state = emptySelfHostedState();
    state = addSelfHostedEndpoint(state, host("local", "This PC", "http://127.0.0.1:11434"));
    state = addSelfHostedEndpoint(state, host("remote", "Gaming PC", "http://192.168.2.8:11434"));
    state = saveSelfHostedModel(state, "local", "qwen");
    state = saveSelfHostedModel(state, "remote", "qwen");
    const remoteSelected = selfHostedSelectionId(state.profiles[1]);
    const localSelected = selfHostedSelectionId(state.profiles[0]);
    const capturedBeforeDisable = selfHostedTransportIdentity(remoteSelected, state)!;
    const oldRevision = state.endpoints[1].configurationRevision;
    state = editSelfHostedEndpoint(state, "remote", { enabled: false }, 10);
    expect(state.endpoints[1].configurationRevision).toBe(oldRevision);
    expect(resolveSelfHostedSelection(state, remoteSelected).status).toBe("missing");
    expect(() => selfHostedTransportIdentity(remoteSelected, state)).toThrow(/unavailable/);
    // LM2E retains the disabled deployment in the user's picker so it can
    // be restored without rebuilding the host; route admission above still
    // refuses to send inference to it.
    expect(savedSelfHostedModelInfos(state).map(m => m.id)).toEqual([
      localSelected, remoteSelected,
    ]);
    expect(selfHostedTransportIdentity(localSelected, state)?.selfHosted?.endpointId).toBe("local");
    const restarted = readSelfHostedState(JSON.parse(JSON.stringify(state)));
    expect(restarted.endpoints[1].enabled).toBe(false);
    state = editSelfHostedEndpoint(restarted, "remote", { enabled: true }, 11);
    expect(state.endpoints[1].configurationRevision).toBe(oldRevision + 1);
    expect(state.endpoints[0].configurationRevision).toBe(1);
    expect(resolveSelfHostedSelection(state, remoteSelected).status).toBe("available");
    // Old provider/qualification routes must be requalified after a re-enable,
    // even though the model tag and endpoint address are unchanged.
    expect(() => assertCurrentOllamaHostIdentity(
      capturedBeforeDisable, remoteSelected, state,
    )).toThrow(/identity changed/);
    expect(() => assertCurrentOllamaHostIdentity(
      selfHostedTransportIdentity(remoteSelected, state)!, remoteSelected, state,
    )).not.toThrow();
    state = deleteSelfHostedEndpoint(state, "remote", [], 12);
    expect(state.endpoints).toHaveLength(2);
    expect(state.endpoints[1].deletedAt).toBe(12);
    expect(resolveSelfHostedSelection(state, remoteSelected).status).toBe("missing");
  });

  it("changing host address invalidates old captured routes despite unchanged model tag/digest", () => {
    let state = saveSelfHostedModel(
      addSelfHostedEndpoint(emptySelfHostedState(), host("a", "Home", "http://127.0.0.1:11434")),
      "a",
      "same:model",
    );
    state = { ...state, profiles: state.profiles.map(p => ({ ...p, modelRevision: "same-digest" })) };
    const selected = selfHostedSelectionId(state.profiles[0]);
    const captured = selfHostedTransportIdentity(selected, state)!;
    const edited = editSelfHostedEndpoint(state, "a", { baseURL: "http://192.168.2.8:11434" }, 22);
    expect(edited.profiles[0].modelRevision).toBe("same-digest");
    expect(edited.endpoints[0].configurationRevision).toBe(2);
    expect(edited.endpoints[0].location).toBe("remote");
    expect(() => assertCurrentOllamaHostIdentity(captured, selected, edited)).toThrow(/identity changed/);
    expect(selfHostedTransportIdentity(selected, edited)?.endpointBaseURL)
      .toBe("http://192.168.2.8:11434/v1");
  });

  it("does not permit unsafe URLs and never recreates a deliberately deleted default", () => {
    for (const address of [
      "file:///tmp/ollama",
      "http://user:password@192.168.1.5:11434",
      "https://computer.example/ollama?token=secret",
      "https://computer.example/ollama#fragment",
    ]) {
      expect(() => host("invalid", "Unsafe", address)).toThrow();
    }
    const state = ensureDefaultOllamaHost(emptySelfHostedState(), new Map(), 1);
    const deleted = deleteSelfHostedEndpoint(state, "legacy:ollama", [], 2);
    expect(ensureDefaultOllamaHost(deleted, new Map(), 3)).toEqual(deleted);
  });
});
