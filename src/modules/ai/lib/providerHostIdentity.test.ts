import { describe, expect, it } from "vitest";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  deleteSelfHostedEndpoint,
  editSelfHostedEndpoint,
  emptySelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  assertCurrentOllamaHostIdentity,
  saveSelfHostedModel,
  selfHostedSelectionId,
  selfHostedTransportIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import type { ModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { migrateSelfHostedProfiles } from "@/modules/ai/lib/selfHostedMigration";

function connectedHost(id: string, baseURL: string) {
  const endpoint = createSelfHostedEndpoint(
    { alias: "Selected host", baseURL, backendHint: "ollama" },
    id,
    100,
  );
  const state = saveSelfHostedModel(
    addSelfHostedEndpoint(emptySelfHostedState(), endpoint),
    id,
    "same-model:latest",
  );
  const selection = selfHostedSelectionId(state.profiles[0]);
  const captured = selfHostedTransportIdentity(selection, state);
  if (!captured) throw new Error("Fixture route missing");
  return { endpoint, state, selection, captured };
}

describe("captured Ollama route is bound to the current selected host and model", () => {
  it("enforces host identity in the actual configured provider construction before dispatch", () => {
    const a = connectedHost("host-a", "https://a.example/prefix");
    const b = connectedHost("host-b", "https://b.example/prefix");
    const state = {
      ...a.state,
      endpoints: [...a.state.endpoints, ...b.state.endpoints],
      profiles: [...a.state.profiles, ...b.state.profiles],
    };
    expect(() => buildConfiguredLanguageModel(b.selection, EMPTY_PROVIDER_KEYS, {
      capturedModelIdentity: a.captured,
      selfHostedInference: state,
    })).toThrow(/identity changed/);
    expect(() => buildConfiguredLanguageModel(a.selection, EMPTY_PROVIDER_KEYS, {
      capturedModelIdentity: a.captured,
      selfHostedInference: editSelfHostedEndpoint(state, "host-a",
        { baseURL: "https://changed.example/prefix" }),
    })).toThrow(/identity changed/);
    expect(() => buildConfiguredLanguageModel("ollama-local", EMPTY_PROVIDER_KEYS, {
      selfHostedInference: state,
      ollamaBaseURL: "http://127.0.0.1:11434/v1",
      ollamaModelId: "same-model:latest",
    })).toThrow(/no bound host/);
  });
  it("accepts exactly the selected endpoint, model, revision and URL", () => {
    const fixture = connectedHost("host-a", "https://a.example/prefix");
    expect(() =>
      assertCurrentOllamaHostIdentity(
        fixture.captured,
        fixture.selection,
        fixture.state,
      ),
    ).not.toThrow();
  });

  it("rejects a captured route from a second host using the same model tag", () => {
    const a = connectedHost("host-a", "https://a.example/prefix");
    const b = connectedHost("host-b", "https://b.example/prefix");
    const combined = {
      ...b.state,
      endpoints: [...a.state.endpoints, ...b.state.endpoints],
      profiles: [...a.state.profiles, ...b.state.profiles],
    };
    expect(() =>
      assertCurrentOllamaHostIdentity(a.captured, b.selection, combined),
    ).toThrow(/identity changed/);
    expect(() =>
      assertCurrentOllamaHostIdentity(b.captured, b.selection, combined),
    ).not.toThrow();
  });

  it("rejects old captured URL after endpoint edit even when the endpoint ID and model are unchanged", () => {
    const a = connectedHost("host-a", "https://a.example/prefix");
    const edited = editSelfHostedEndpoint(a.state, "host-a", {
      baseURL: "https://replacement.example/prefix",
    });
    expect(edited.endpoints[0].configurationRevision).toBe(2);
    expect(() =>
      assertCurrentOllamaHostIdentity(a.captured, a.selection, edited),
    ).toThrow(/identity changed/);
    const fresh = selfHostedTransportIdentity(a.selection, edited);
    if (!fresh) throw new Error("Updated fixture route missing");
    expect(() =>
      assertCurrentOllamaHostIdentity(fresh, a.selection, edited),
    ).not.toThrow();
  });

  it("rejects changed host URL even when a stale store preserves the old configuration revision", () => {
    const a = connectedHost("host-a", "https://a.example/prefix");
    const staleRevision = {
      ...a.state,
      endpoints: [{
        ...a.state.endpoints[0],
        baseURL: "https://replacement.example/prefix",
      }],
    };
    expect(staleRevision.endpoints[0].configurationRevision).toBe(
      a.endpoint.configurationRevision,
    );
    expect(() =>
      assertCurrentOllamaHostIdentity(
        a.captured,
        a.selection,
        staleRevision,
      ),
    ).toThrow(/identity changed/);
  });

  it("rejects forged captured URL and credentials even if the IDs and revisions match", () => {
    const a = connectedHost("host-a", "https://a.example/prefix");
    expect(() =>
      assertCurrentOllamaHostIdentity(
        { ...a.captured, endpointBaseURL: "https://different.example/v1" },
        a.selection,
        a.state,
      ),
    ).toThrow(/identity changed/);
    expect(() =>
      assertCurrentOllamaHostIdentity(
        {
          ...a.captured,
          selfHosted: {
            ...a.captured.selfHosted!,
            credentialRef: { kind: "custom-endpoint", endpointId: "other" },
          },
        },
        a.selection,
        a.state,
      ),
    ).toThrow(/identity changed/);
  });

  it("rejects deleted or missing selected profiles rather than substituting any other route", () => {
    const a = connectedHost("host-a", "https://a.example/prefix");
    const deleted = deleteSelfHostedEndpoint(a.state, "host-a");
    expect(() =>
      assertCurrentOllamaHostIdentity(a.captured, a.selection, deleted),
    ).toThrow(/unavailable|identity changed/i);
    expect(() =>
      assertCurrentOllamaHostIdentity(
        a.captured,
        'self-hosted:["host-a","missing",null]',
        a.state,
      ),
    ).toThrow(/unavailable|identity changed/i);
  });

  it("never treats an unbound legacy Ollama model tag as a route to a managed host", () => {
    const a = connectedHost("host-a", "https://a.example/prefix");
    const legacy: ModelTransportIdentity = {
      providerId: "ollama",
      transportModelId: "same-model:latest",
    };
    expect(() =>
      assertCurrentOllamaHostIdentity(legacy, "ollama-local", a.state),
    ).toThrow(/identity changed/);
    expect(() =>
      assertCurrentOllamaHostIdentity(legacy, "ollama-local", emptySelfHostedState()),
    ).not.toThrow();
  });

  it("preserves an explicitly migrated legacy Ollama binding to its owning endpoint", () => {
    const migrated = migrateSelfHostedProfiles(
      null,
      new Map<string, unknown>([
        ["ollamaBaseURL", "http://127.0.0.1:11435"],
        ["ollamaModelId", "same-model:latest"],
      ]),
      100,
    );
    const captured = selfHostedTransportIdentity("ollama-local", migrated);
    if (!captured) throw new Error("Migrated binding missing");
    expect(() =>
      assertCurrentOllamaHostIdentity(captured, "ollama-local", migrated),
    ).not.toThrow();
  });

  it("leaves unrelated unmanaged cloud routes unaffected", () => {
    const a = connectedHost("host-a", "https://a.example/prefix");
    const cloud: ModelTransportIdentity = {
      providerId: "openrouter",
      transportModelId: "vendor/model",
    };
    expect(() =>
      assertCurrentOllamaHostIdentity(cloud, "saved-provider:cloud", a.state),
    ).not.toThrow();
  });
});
