import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderKeys } from "@/modules/ai/lib/keyring";
import {
  createManagedDeployment,
  type ManagedLocalMaterial,
} from "@/modules/ai/lib/managedLocalModels";
import { emptySelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import {
  admittedManagedLocalRoute,
  assertManagedLocalNativeRoute,
  assertCurrentManagedLocalRoute,
  type ManagedLocalNativeRoute,
} from "@/modules/ai/lib/managedLocalRuntime";
import {
  buildConfiguredLanguageModel,
  managedLocalRequiresAgentQualification,
} from "@/modules/ai/lib/agent";
import { ManagedLlamaRuntimeAdapter } from "@/modules/ai/lib/localRuntimeAdapters";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const digest = `sha256:${"a".repeat(64)}`;
const material: ManagedLocalMaterial = {
  version: 1, context: 4096, gpu: 0, tool: false, grammar: false,
};
const route: ManagedLocalNativeRoute = {
  baseUrl: "http://127.0.0.1:50891/v1",
  apiKey: "f".repeat(64),
  epoch: "e".repeat(64),
  modelAlias: "clack-" + "a".repeat(16),
  processId: 2100,
};
const registered = createManagedDeployment(emptySelfHostedState(), {
  digest, displayName: "GGUF", material,
});
const identity = resolveModelTransportIdentity(registered.selectionId, {
  selfHostedInference: registered.state,
});
const deployment = identity.managedLocal!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue({ ...route });
});

describe("LM2D trusted native managed inference admission", () => {
  it("requires an explicit managed runtime adapter and exact GGUF-native model alias", () => {
    expect(ManagedLlamaRuntimeAdapter.type).toBe("clack-managed-llama.cpp");
    expect(ManagedLlamaRuntimeAdapter.resolve(deployment, route)).toEqual({
      providerId: "openai-compatible",
      modelName: route.modelAlias,
      baseURL: route.baseUrl,
    });
    expect(() => ManagedLlamaRuntimeAdapter.resolve(deployment, {
      ...route, modelAlias: `clack-${"b".repeat(16)}`,
    })).toThrow(/does not match/);
    expect(() => ManagedLlamaRuntimeAdapter.resolve({
      ...deployment, artifactDigest: `sha256:${"b".repeat(64)}`,
    }, route)).toThrow(/does not match/);
  });

  it("permits ordinary Chat but fails closed for Automatic Agent or mandatory tools", () => {
    expect(managedLocalRequiresAgentQualification(registered.selectionId, "chat-only", false, false)).toBe(false);
    expect(managedLocalRequiresAgentQualification(registered.selectionId, "default-policy", false, false)).toBe(true);
    expect(managedLocalRequiresAgentQualification(registered.selectionId, "agent-profile", false, false)).toBe(true);
    expect(managedLocalRequiresAgentQualification(registered.selectionId, "chat-only", true, false)).toBe(true);
    expect(managedLocalRequiresAgentQualification(registered.selectionId, "default-policy", false, true)).toBe(false);
    expect(managedLocalRequiresAgentQualification("ollama-local", "agent-profile", true, false)).toBe(false);
  });

  it("accepts only loopback authenticated version-agnostic native routes", async () => {
    expect(() => assertManagedLocalNativeRoute(route)).not.toThrow();
    expect(await admittedManagedLocalRoute(deployment)).toEqual(route);
    expect(invoke).toHaveBeenCalledWith("managed_local_runtime_route", {
      deploymentId: deployment.deploymentId,
      deploymentIdentity: deployment.deploymentIdentity,
    });
    for (const bad of [
      { baseUrl: "http://localhost:50891/v1" },
      { baseUrl: "http://10.0.0.1:50891/v1" },
      { baseUrl: "https://127.0.0.1:50891/v1" },
      { baseUrl: "http://127.0.0.1:50891/v1/other" },
      { baseUrl: "http://127.0.0.1:50891/v1?redirect=1" },
      { baseUrl: "http://127.0.0.1:50891/v1#secret" },
      { apiKey: "provider-secret" },
      { epoch: "" },
      { modelAlias: "ollama:latest" },
      { processId: 0 },
    ]) {
      expect(() => assertManagedLocalNativeRoute({ ...route, ...bad })).toThrow(
        /untrusted|invalid loopback/,
      );
    }
  });

  it("checks same process identity and epoch on every provider request", async () => {
    await expect(assertCurrentManagedLocalRoute(deployment, route)).resolves.toBeUndefined();
    for (const bad of [
      { epoch: "0".repeat(64) },
      { processId: route.processId + 1 },
      { baseUrl: "http://127.0.0.1:50001/v1" },
      { modelAlias: "clack-" + "b".repeat(16) },
      { apiKey: "c".repeat(64) },
    ]) {
      vi.mocked(invoke).mockResolvedValueOnce({ ...route, ...bad });
      await expect(assertCurrentManagedLocalRoute(deployment, route)).rejects.toThrow(
        /restarted or changed/,
      );
    }
  });

  it("builds Chat only from exact native Ready route, without an Ollama fallback", async () => {
    const model = await buildConfiguredLanguageModel(
      registered.selectionId,
      {} as ProviderKeys,
      {
        selfHostedInference: registered.state,
        // Normal composer captures the digest-based selection, whereas the
        // native adapter's live HTTP alias is process-scoped. Automatic
        // reasoning must not cause a false model-identity mismatch.
        reasoning: captureEffort(registered.selectionId, identity),
      },
    );
    expect(model).toBeDefined();
    expect(invoke).toHaveBeenCalledWith("managed_local_runtime_route", {
      deploymentId: deployment.deploymentId,
      deploymentIdentity: deployment.deploymentIdentity,
    });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("No managed runtime installed"));
    await expect(buildConfiguredLanguageModel(
      registered.selectionId, {} as ProviderKeys,
      { selfHostedInference: registered.state },
    )).rejects.toThrow(/No managed runtime installed/);
    expect(() => buildConfiguredLanguageModel(
      registered.selectionId, {} as ProviderKeys,
      { selfHostedInference: registered.state,
        capturedModelIdentity: { ...identity, managedLocal: {
          ...deployment, artifactDigest: `sha256:${"b".repeat(64)}`,
        } },
      },
    )).toThrow(/managed model deployment changed/);
    const badState = structuredClone(registered.state);
    badState.fabric!.runtimes[0].type = "ollama";
    expect(() => buildConfiguredLanguageModel(
      registered.selectionId, {} as ProviderKeys,
      { selfHostedInference: badState },
    )).toThrow(/managed GGUF selection changed/i);
  });

  it("rejects malformed native route responses before SDK creation", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...route, baseUrl: "http://10.1.2.3:8080/v1" });
    await expect(buildConfiguredLanguageModel(
      registered.selectionId, {} as ProviderKeys,
      { selfHostedInference: registered.state },
    )).rejects.toThrow(/untrusted/);
  });
});
