import { afterEach, describe, expect, it } from "vitest";
import {
  addSelfHostedEndpoint, createSelfHostedEndpoint, editSelfHostedEndpoint,
  emptySelfHostedState, readSelfHostedState, assertWritableSelfHostedState,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  saveSelfHostedModel, selfHostedSelectionId, selfHostedTransportIdentity,
  assertCurrentOllamaHostIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import {
  acceptsLegacyDeploymentQualification, addConceptualRuntime, artifactIdFor,
  capabilityStatus, deploymentIdentity, localComputeFabricSchema,
  ollamaRuntimeCapabilities, reconcileLocalComputeFabric,
  resolveModelDeployment, runtimeCapabilityAllows, runtimeIdForEndpoint,
  withLocalComputeFabric, type LocalRuntime, type ModelArtifact,
  type ModelDeployment,
} from "@/modules/ai/lib/localComputeFabric";
import { OllamaRuntimeAdapter, resolveRuntimeProviderTransport } from "@/modules/ai/lib/localRuntimeAdapters";
import { ensureDefaultOllamaHost, migrateSelfHostedProfiles } from "@/modules/ai/lib/selfHostedMigration";
import { rememberContextRuntime, forgetContextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { toolScope, toolVerificationState } from "@/modules/ai/lib/toolVerification";
import { toolVerificationSchema } from "@/modules/ai/lib/toolVerificationSchema";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";

const secondaryId = "sh-906dc712-b5bb-445a-9a88-ca71865f4d9e";
const digest = "24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8";
function host(id: string, url: string, alias: string) {
  return createSelfHostedEndpoint({
    alias, baseURL: url, backendHint: "ollama", allowPrivateNetwork: true,
  }, id, 100);
}
function prepared(hostId = secondaryId, modelDigest: string | undefined = digest): SelfHostedState {
  const endpoint = host(hostId, "http://192.168.1.44:11434/", "Secondary PC");
  const state = saveSelfHostedModel(
    addSelfHostedEndpoint(emptySelfHostedState(), endpoint),
    endpoint.id, "devstral-small-2:24b",
  );
  return {
    ...state,
    profiles: state.profiles.map(p => ({ ...p,
      ...(modelDigest ? { modelRevision: modelDigest } : {}) })),
    inventories: [{
      endpointId: endpoint.id, configurationRevision: 1,
      observedAt: 100, connected: true, backend: "ollama", version: "0.40.11",
      models: [{
        id: "devstral-small-2:24b", name: "Devstral Small 2",
        chat: "supported", ...(modelDigest ? { digest: modelDigest } : {}),
        size: 25_000, family: "devstral", parameterSize: "24B",
        quantizationLevel: "Q4_K_M",
      }],
    }],
  };
}
function verified(state: SelfHostedState) {
  const now = Date.now();
  const profile = state.profiles[0];
  const endpoint = state.endpoints[0];
  rememberContextRuntime(endpoint.id, {
    epoch: "epoch-one", version: "0.40.11",
    configurationRevision: endpoint.configurationRevision, at: now,
  });
  const scope = toolScope(profile, endpoint, now);
  if (!scope) throw new Error("missing tool scope");
  const record = toolVerificationSchema.parse({
    version: 1, id: "verified-tools", scope,
    status: "verified", outcome: "native-call",
    context: 4096, output: 512, attempts: [],
    startedAt: now - 10, completedAt: now, firstBodyAt: now,
    callAt: now, calls: 1, validArguments: true,
    textualIntent: false, textChars: 0, finish: "tool-calls",
    proof: { at: now, expiresAt: now + 86400_000 }, retryAfter: 0,
  });
  return { ...state, profiles: [{ ...profile, toolVerification: record }] };
}
afterEach(() => {
  forgetContextRuntime(secondaryId);
  forgetContextRuntime("other-host");
  forgetContextRuntime("local");
});

describe("LM2B compute fabric: durable identity and reversible migration", () => {
  it("maps the LM2A accepted .44 endpoint to one host, one Ollama runtime, artifact and deployment", () => {
    const state = withLocalComputeFabric(prepared());
    expect(state.version).toBe(1); // No breaking native CAS / LM2A envelope migration.
    const fabric = state.fabric!;
    expect(fabric.version).toBe(1);
    expect(fabric.hosts).toMatchObject([{
      id: secondaryId, displayName: "Secondary PC", location: "remote",
      enabled: true, runtimeIds: [runtimeIdForEndpoint(secondaryId)],
    }]);
    expect(fabric.runtimes).toMatchObject([{
      id: runtimeIdForEndpoint(secondaryId), hostId: secondaryId,
      legacyEndpointId: secondaryId, type: "ollama", version: "0.40.11",
      configurationRevision: 1,
    }]);
    // Model data is a projection of the original LM2A profile/inventory,
    // not a second persisted model registry.
    expect(fabric.artifacts).toHaveLength(0);
    expect(fabric.deployments).toHaveLength(0);
    expect(reconcileLocalComputeFabric(state).artifacts[0]).toMatchObject({
      digest, format: "ollama-manifest", family: "devstral",
      parameterSize: "24B", quantization: "Q4_K_M",
    });
    const deployed = resolveModelDeployment(state, state.profiles[0])!;
    expect(deployed.deployment.id).toBe(state.profiles[0].id);
    expect(deployed.deployment.runtimeModelName).toBe("devstral-small-2:24b");
    expect(deployed.identity).toBe(deploymentIdentity(deployed.deployment));
    expect(OllamaRuntimeAdapter.nativePaths).toMatchObject({
      models: "/api/tags", metadata: "/api/show", version: "/api/version",
    });
    expect(resolveRuntimeProviderTransport(deployed)).toEqual({
      providerId: "ollama", modelName: "devstral-small-2:24b",
      baseURL: "http://192.168.1.44:11434/v1",
    });
    const selected = selfHostedSelectionId(state.profiles[0]);
    expect(selfHostedTransportIdentity(selected, state)).toMatchObject({
      providerId: "ollama", endpointBaseURL: "http://192.168.1.44:11434/v1",
      selfHosted: { endpointId: secondaryId, deploymentIdentity: deployed.identity },
    });
    assertWritableSelfHostedState(state);
    expect(withLocalComputeFabric(readSelfHostedState(JSON.parse(JSON.stringify(state))))).toEqual(state);
    expect(withLocalComputeFabric(state)).toBe(state); // Idempotent, not an infinite CAS edit.
  });

  it("migrates pre-LM local settings, LM0-LM2 envelopes and an unknown-digest deployment without made-up hashes", () => {
    const legacy = new Map<string, unknown>([
      ["ollamaBaseURL", "http://127.0.0.1:11434/"],
      ["ollamaModelId", "qwen:latest"],
    ]);
    const migrated = withLocalComputeFabric(
      ensureDefaultOllamaHost(migrateSelfHostedProfiles(null, legacy, 1), legacy),
    );
    expect(migrated.endpoints[0].id).toBe("legacy:ollama");
    expect(migrated.fabric?.hosts[0]).toMatchObject({ id: "legacy:ollama", location: "local" });
    expect(migrated.fabric?.runtimes[0]).toMatchObject({ type: "ollama", legacyEndpointId: "legacy:ollama" });
    expect(reconcileLocalComputeFabric(migrated).artifacts[0]).toMatchObject({ format: "opaque", provenance: "unknown" });
    expect(reconcileLocalComputeFabric(migrated).artifacts[0].digest).toBeUndefined();
    expect(selfHostedTransportIdentity("ollama-local", migrated)?.transportModelId).toBe("qwen:latest");
    const lm2 = withLocalComputeFabric(prepared(secondaryId, ""));
    expect(reconcileLocalComputeFabric(lm2).artifacts[0].digest).toBeUndefined();
    expect(reconcileLocalComputeFabric(lm2).artifacts[0].id).toContain("opaque");
  });

  it("keeps a shared digest across hosts but never shares deployment identities or captured routes", () => {
    const first = prepared();
    const other = prepared("other-host");
    const state = withLocalComputeFabric({
      ...first, endpoints: [...first.endpoints, ...other.endpoints],
      profiles: [...first.profiles, ...other.profiles],
      inventories: [...first.inventories!, ...other.inventories!],
    });
    expect(state.fabric?.hosts).toHaveLength(2);
    expect(state.fabric?.runtimes).toHaveLength(2);
    expect(state.fabric?.artifacts).toHaveLength(0);
    expect(state.fabric?.deployments).toHaveLength(0);
    expect(reconcileLocalComputeFabric(state).artifacts).toHaveLength(1);
    expect(reconcileLocalComputeFabric(state).deployments).toHaveLength(2);
    const [a, b] = state.profiles.map(p => resolveModelDeployment(state, p)!);
    expect(a.artifact.id).toBe(b.artifact.id);
    expect(a.identity).not.toBe(b.identity);
    const capturedA = selfHostedTransportIdentity(selfHostedSelectionId(state.profiles[0]), state)!;
    const selectedB = selfHostedSelectionId(state.profiles[1]);
    expect(() => assertCurrentOllamaHostIdentity(capturedA, selectedB, state))
      .toThrow(/identity changed/);
  });

  it("does not invalidate an unrelated host's native-tool receipt when the other host is reconfigured", () => {
    const a = verified(prepared());
    const b = verified(prepared("other-host"));
    const combined = withLocalComputeFabric({
      ...a,
      endpoints: [...a.endpoints, ...b.endpoints],
      profiles: [...a.profiles, ...b.profiles],
      inventories: [...a.inventories!, ...b.inventories!],
    });
    expect(toolVerificationState(combined, combined.profiles[0])).toBe("Verified");
    expect(toolVerificationState(combined, combined.profiles[1])).toBe("Verified");
    const beforeOther = resolveModelDeployment(combined, combined.profiles[1])!.identity;
    const changed = withLocalComputeFabric(editSelfHostedEndpoint(
      combined, secondaryId, { baseURL: "http://192.168.1.45:11434" }, 201,
    ));
    expect(toolVerificationState(changed, changed.profiles[0])).toBe("Stale");
    expect(toolVerificationState(changed, changed.profiles[1])).toBe("Verified");
    expect(resolveModelDeployment(changed, changed.profiles[1])!.identity).toBe(beforeOther);
  });

  it("does not transfer historical trust to another runtime on the same host, even for the same artifact", () => {
    let state = withLocalComputeFabric(verified(prepared()));
    expect(toolVerificationState(state, state.profiles[0])).toBe("Verified");
    const original = resolveModelDeployment(state, state.profiles[0])!;
    const runtime: LocalRuntime = {
      id: "clack-managed-runtime", hostId: secondaryId, type: "clack-llama-cpp",
      displayName: "Clack Managed Runtime", enabled: false,
      configurationRevision: 1, health: "unknown", capabilities: {},
    };
    const deployment: ModelDeployment = {
      id: "future:gguf-deployment", hostId: secondaryId,
      runtimeId: runtime.id, artifactId: original.artifact.id,
      runtimeModelName: "future.gguf", configurationRevision: 1,
    };
    state = addConceptualRuntime(state, runtime, original.host, original.artifact, deployment);
    expect(state.fabric?.hosts).toHaveLength(1);
    expect(reconcileLocalComputeFabric(state).hosts[0].runtimeIds).toHaveLength(2);
    expect(state.fabric?.deployments.find(d => d.id === deployment.id)).toMatchObject(deployment);
    expect(runtimeCapabilityAllows(runtime, "native-tools", true)).toBe(false);
    // Conceptual adapter is intentionally not installed.
    expect(() => resolveRuntimeProviderTransport({
      ...original, runtime: { ...runtime, enabled: true }, deployment,
    })).toThrow(/adapter is installed/);
    // Altering the *legacy* runtime identity does not promote the old proof.
    const mutated = { ...state, fabric: {
      ...state.fabric!, runtimes: state.fabric!.runtimes.map(row =>
        row.legacyEndpointId === secondaryId ? { ...row, id: "replacement-runtime" } : row),
    } };
    expect(toolVerificationState(mutated, mutated.profiles[0])).toBe("Stale");
    expect(acceptsLegacyDeploymentQualification(mutated, mutated.profiles[0])).toBe(false);
  });

  it("rejects digest, runtime-revision, runtime-epoch, disabled-host and disabled-runtime transitions", () => {
    let state = withLocalComputeFabric(verified(prepared()));
    const selected = selfHostedSelectionId(state.profiles[0]);
    const route = selfHostedTransportIdentity(selected, state)!;
    const oldArtifact = artifactIdFor(state.fabric!.runtimes[0], state.profiles[0]);
    const revised = withLocalComputeFabric({
      ...state, profiles: state.profiles.map(p => ({ ...p, modelRevision: "different-digest" })),
    });
    expect(reconcileLocalComputeFabric(revised).artifacts.map(a => a.id))
      .not.toContain(oldArtifact);
    expect(reconcileLocalComputeFabric(revised).deployments[0].artifactId)
      .not.toBe(oldArtifact);
    expect(() => assertCurrentOllamaHostIdentity(route, selected, revised)).toThrow();
    state = withLocalComputeFabric(editSelfHostedEndpoint(state, secondaryId,
      { baseURL: "http://192.168.1.45:11434" }, 200));
    expect(toolVerificationState(state, state.profiles[0])).toBe("Stale");
    expect(() => assertCurrentOllamaHostIdentity(route, selected, state)).toThrow();
    const fresh = withLocalComputeFabric(verified(prepared()));
    expect(toolVerificationState(fresh, fresh.profiles[0])).toBe("Verified");
    rememberContextRuntime(secondaryId, {
      epoch: "epoch-two", version: "0.40.11", configurationRevision: 1, at: Date.now(),
    });
    expect(toolVerificationState(fresh, fresh.profiles[0])).toBe("Stale");
    const disabledHost = { ...fresh, fabric: { ...fresh.fabric!,
      hosts: fresh.fabric!.hosts.map(h => ({ ...h, enabled: false })) } };
    expect(resolveModelDeployment(disabledHost, disabledHost.profiles[0])).toBeUndefined();
    expect(() => selfHostedTransportIdentity(selected, disabledHost)).toThrow(/unavailable/);
    const disabledRuntime = editSelfHostedEndpoint(fresh, secondaryId, { enabled: false }, 201);
    expect(resolveModelDeployment(disabledRuntime, disabledRuntime.profiles[0])).toBeUndefined();
    const missingRuntime = { ...fresh, fabric: { ...fresh.fabric!,
      runtimes: fresh.fabric!.runtimes.map(r => ({ ...r, type: "uninstalled-future-runtime" })) } };
    expect(resolveModelDeployment(missingRuntime, missingRuntime.profiles[0])).toBeUndefined();
  });
});

describe("LM2C runtime declarations remain separate from deployment qualification", () => {
  it("distinguishes supported, unsupported, unknown and requires qualification", () => {
    const runtime = reconcileLocalComputeFabric(prepared()).runtimes[0];
    expect(capabilityStatus(runtime, "chat")).toBe("supported");
    expect(capabilityStatus(runtime, "native-tools")).toBe("requires-qualification");
    expect(runtimeCapabilityAllows(runtime, "native-tools")).toBe(false);
    expect(runtimeCapabilityAllows(runtime, "native-tools", true)).toBe(true);
    expect(capabilityStatus(runtime, "hardware-telemetry")).toBe("unknown");
    const withoutTelemetry = { ...runtime, capabilities: {
      ...runtime.capabilities,
      "hardware-telemetry": { status: "unsupported", source: "observed" },
    } };
    expect(runtimeCapabilityAllows(withoutTelemetry, "hardware-telemetry")).toBe(false);
    expect(runtimeCapabilityAllows(withoutTelemetry, "chat")).toBe(true);
    expect(capabilityStatus(runtime, "nonexistent-feature")).toBe("unknown");
    const noTools = { ...runtime, capabilities: { ...runtime.capabilities,
      "native-tools": { status: "unsupported", source: "verified" } } };
    expect(capabilityStatus(noTools, "native-tools")).toBe("unsupported");
    expect(runtimeCapabilityAllows(noTools, "native-tools", true)).toBe(false);
    expect(ollamaRuntimeCapabilities(true, "0.40.11")["runtime-version"]).toMatchObject({
      status: "supported", source: "observed",
    });
  });

  it("supports Chat while unsupported native tools block automatic Agent qualification", () => {
    const state = withLocalComputeFabric(verified(prepared()));
    expect(toolVerificationState(state, state.profiles[0])).toBe("Verified");
    const noTools = { ...state, fabric: { ...state.fabric!,
      runtimes: state.fabric!.runtimes.map(runtime => ({ ...runtime,
        capabilities: { ...runtime.capabilities, "native-tools":
          { status: "unsupported", source: "observed" } },
      })) } };
    const view = modelOnboarding(noTools, noTools.profiles[0])!;
    expect(toolVerificationState(noTools, noTools.profiles[0])).toBe("Unsupported");
    expect(view.tools).toBe("Unsupported");
    expect(view.status).toBe("Chat only");
    expect(view.reasoning.agentRecommendation).toBeUndefined();
    expect(selfHostedTransportIdentity(selfHostedSelectionId(noTools.profiles[0]), noTools)?.providerId)
      .toBe("ollama");
  });

  it("preserves unknown future capability status without treating it as supported", () => {
    const state = withLocalComputeFabric(prepared());
    const future = { ...state, fabric: {
      ...state.fabric!, runtimes: state.fabric!.runtimes.map(runtime => ({
        ...runtime, capabilities: {
          ...runtime.capabilities,
          "gpu-future": { status: "quantum-ready", source: "future-probe" },
        },
      })),
    } };
    expect(localComputeFabricSchema.safeParse(future.fabric).success).toBe(true);
    assertWritableSelfHostedState(future);
    const loaded = readSelfHostedState(JSON.parse(JSON.stringify(future)));
    expect(loaded.fabric!.runtimes[0].capabilities["gpu-future"].status).toBe("quantum-ready");
    expect(capabilityStatus(loaded.fabric!.runtimes[0], "gpu-future")).toBe("unknown");
    expect(runtimeCapabilityAllows(loaded.fabric!.runtimes[0], "gpu-future", true)).toBe(false);
    expect(() => assertWritableSelfHostedState({
      ...state, fabric: { ...state.fabric!, version: 2 },
    })).toThrow(/unsupported schema/);
  });

  it("can represent a This PC managed-GGUF attachment without loading a model or enabling a provider", () => {
    const state = withLocalComputeFabric(ensureDefaultOllamaHost(
      emptySelfHostedState(), new Map(), 10));
    const host = state.fabric!.hosts[0];
    const runtime: LocalRuntime = {
      id: "managed-local-runtime", hostId: host.id,
      type: "clack-llama-cpp", displayName: "Clack Managed Runtime",
      enabled: false, health: "unknown", configurationRevision: 1, capabilities: {},
    };
    const artifact: ModelArtifact = {
      id: "local-gguf:file-a", displayName: "model.gguf",
      format: "gguf", provenance: "user-supplied",
    };
    const deployment: ModelDeployment = {
      id: "managed:deployment-a", runtimeId: runtime.id,
      hostId: host.id, artifactId: artifact.id,
      runtimeModelName: "model.gguf", configurationRevision: 1,
    };
    const expanded = addConceptualRuntime(state, runtime, host, artifact, deployment);
    expect(expanded.fabric?.hosts).toHaveLength(1);
    expect(expanded.fabric?.runtimes.map(r => r.type)).toEqual(["ollama", "clack-llama-cpp"]);
    expect(expanded.fabric?.artifacts).toContainEqual(artifact);
    expect(expanded.fabric?.deployments).toContainEqual(deployment);
    expect(withLocalComputeFabric(readSelfHostedState(expanded)).fabric?.deployments)
      .toContainEqual(deployment);
    expect(expanded.profiles).toHaveLength(0);
  });
});
