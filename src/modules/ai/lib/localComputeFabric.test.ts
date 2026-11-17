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
  deploymentQualificationReceiptSchema, deploymentQualificationEvidenceReceiptSchema, deploymentQualificationScope,
  deploymentQualificationState as evaluateQualificationState, deploymentCapabilityQualified as assessQualifiedCapability,
  ollamaRuntimeCapabilities, reconcileLocalComputeFabric,
  resolveModelDeployment, runtimeCapabilityAllows, runtimeIdForEndpoint,
  withLocalComputeFabric, type LocalRuntime, type ModelArtifact,
  type ModelDeployment, type DeploymentQualificationReceipt,
  type DeploymentRuntimeObservation, type LocalComputeFabric,
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

  it("fails closed on ambiguous persisted host, runtime, artifact or deployment identity", () => {
    const state = withLocalComputeFabric(prepared());
    const profile = state.profiles[0];
    const original = resolveModelDeployment(state, profile)!;
    const fabric = reconcileLocalComputeFabric(state);
    // Explicit stale or tampered cache rows must not be normalized into a
    // second host/model authority, even if projection would pick one row.
    for (const collection of ["hosts", "runtimes", "artifacts", "deployments"] as const) {
      const nextFabric = structuredClone(fabric);
      nextFabric[collection].push(structuredClone(nextFabric[collection][0]) as never);
      const altered = { ...state, fabric: nextFabric };
      expect(resolveModelDeployment(altered, profile)).toBeUndefined();
      expect(() => selfHostedTransportIdentity(selfHostedSelectionId(profile), altered))
        .toThrow(/deployment changed or disabled/);
    }
    expect(resolveModelDeployment(state, profile)!.identity).toBe(original.identity);
    expect(resolveModelDeployment({ ...state, profiles: [...state.profiles, profile] }, profile))
      .toBeUndefined();
    expect(resolveModelDeployment({ ...state, endpoints: [...state.endpoints, state.endpoints[0]] }, profile))
      .toBeUndefined();
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

describe("LM2F per-deployment, cross-runtime qualification isolation", () => {
  const at = 1_800_000_000_000;
  const managedId = "managed:qualified-gguf";
  const sha = `sha256:${"a".repeat(64)}`;
  // Test fixtures explicitly supply the scope of the tool protocol they
  // are examining; production call sites must supply their actual context.
  const deploymentQualificationState = (
    ...args: Parameters<typeof evaluateQualificationState>
  ) => evaluateQualificationState(
    args[0], args[1], args[2], args[3], args[4], args[5],
    args[4]?.version === 2 ? args[4].context : {},
  );
  const deploymentCapabilityQualified = (
    ...args: Parameters<typeof assessQualifiedCapability>
  ) => assessQualifiedCapability(
    args[0], args[1], args[2], args[3], args[4], args[5],
    args[4]?.version === 2 ? args[4].context : {},
  );
  const observed = (
    runtimeId = "managed-runtime", version = "1.2.3", epoch = "boot-a",
  ): DeploymentRuntimeObservation => ({
    runtimeId, version, epoch, configurationRevision: 1, observedAt: at - 100,
  });
  function setup() {
    const original = withLocalComputeFabric(verified(prepared()));
    const legacy = resolveModelDeployment(original, original.profiles[0])!;
    const runtime: LocalRuntime = {
      id: "managed-runtime", hostId: legacy.host.id, type: "clack-llama-cpp",
      displayName: "Managed GGUF", enabled: true, health: "online",
      configurationRevision: 1, version: "1.2.3", runtimeEpoch: "boot-a",
      processIdentity: "process-42", capabilities: {
        "native-tools": { status: "requires-qualification", source: "declared" },
        chat: { status: "supported", source: "declared" },
      },
    };
    const deployment: ModelDeployment = {
      id: managedId, hostId: legacy.host.id, runtimeId: runtime.id,
      artifactId: legacy.artifact.id, runtimeModelName: "devstral.gguf",
      configurationRevision: 1, variantId: "q4",
      configurationIdentity: '{"context":4096,"reasoning":false}',
    };
    const state = addConceptualRuntime(original, runtime, legacy.host, legacy.artifact, deployment);
    const fabric = reconcileLocalComputeFabric(state);
    const observation = observed();
    const scope = deploymentQualificationScope(fabric, managedId, observation, at)!;
    const receipt: DeploymentQualificationReceipt = {
      version: 2, scope: { ...scope, deploymentId: managedId }, capability: "native-tools",
      status: "verified", verifiedAt: at - 5_000, expiresAt: at + 60_000,
      context: { toolProtocol: "ollama-native-v1", toolSchemaDigest: sha },
      procedure: { id: "clack-native-tools-qualification", version: 1 },
      evidence: { source: "native-observation", reference: "probe-1", digest: sha,
        checks: [{ id: "arguments", result: "pass" }] },
    };
    return { state, fabric, observation, receipt };
  }

  it("accepts only an explicitly scoped, fresh deployment receipt while retaining proven legacy Ollama", () => {
    const { state, fabric, observation, receipt } = setup();
    expect(deploymentQualificationEvidenceReceiptSchema.safeParse(receipt).success).toBe(true);
    // The pre-LM2F receipt lacks evidence and can be preserved but not promoted.
    const historical = { version: 1 as const, scope: deploymentQualificationScope(fabric, managedId, observation, at)!,
      capability: "native-tools" as const, status: "verified" as const,
      verifiedAt: at - 100, expiresAt: at + 1_000 };
    expect(deploymentQualificationReceiptSchema.safeParse(historical).success).toBe(true);
    expect(deploymentQualificationState(fabric, managedId, "native-tools", observation, historical, at)).toBe("Stale");
    expect(deploymentQualificationState(fabric, managedId, "native-tools", observation, undefined, at))
      .toBe("Unverified");
    expect(deploymentCapabilityQualified(fabric, managedId, "native-tools", observation, undefined, at))
      .toBe(false);
    expect(deploymentQualificationState(fabric, managedId, "native-tools", observation, receipt, at))
      .toBe("Verified");
    expect(deploymentCapabilityQualified(fabric, managedId, "native-tools", observation, receipt, at))
      .toBe(true);
    expect(toolVerificationState(state, state.profiles[0])).toBe("Verified");
    expect(acceptsLegacyDeploymentQualification(state, state.profiles[0])).toBe(true);
    // A migrated Ollama tool receipt does not become a managed-runtime receipt.
    expect(deploymentQualificationState(fabric, managedId, "native-tools",
      observation, state.profiles[0].toolVerification as unknown as DeploymentQualificationReceipt, at))
      .toBe("Stale");
  });

  it.each([
    ["host", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      const hostId = "replaced-host";
      f.hosts.find(h => h.id === secondaryId)!.id = hostId;
      f.runtimes.find(r => r.id === o.runtimeId)!.hostId = hostId;
      f.deployments.find(d => d.id === managedId)!.hostId = hostId;
    }],
    ["runtime", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      const id = "replacement-managed-runtime";
      f.runtimes.find(r => r.id === o.runtimeId)!.id = id;
      f.hosts.find(h => h.id === secondaryId)!.runtimeIds =
        f.hosts.find(h => h.id === secondaryId)!.runtimeIds.map(v => v === o.runtimeId ? id : v);
      f.deployments.find(d => d.id === managedId)!.runtimeId = id;
      o.runtimeId = id;
    }],
    ["runtime type", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      f.runtimes.find(r => r.id === o.runtimeId)!.type = "new-engine";
    }],
    ["runtime configuration", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      f.runtimes.find(r => r.id === o.runtimeId)!.configurationRevision = 2;
      f.deployments.find(d => d.id === managedId)!.configurationRevision = 2;
      o.configurationRevision = 2;
    }],
    ["artifact", (f: LocalComputeFabric) => {
      f.artifacts.find(a => a.digest === digest)!.digest = "new-artifact-digest";
    }],
    ["artifact identifier", (f: LocalComputeFabric) => {
      const artifact = f.artifacts.find(a => a.digest === digest)!;
      artifact.id = "replacement-artifact";
      f.deployments.find(d => d.id === managedId)!.artifactId = artifact.id;
    }],
    ["runtime version", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      f.runtimes.find(r => r.id === o.runtimeId)!.version = "2.0.0";
      o.version = "2.0.0";
    }],
    ["runtime epoch", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      f.runtimes.find(r => r.id === o.runtimeId)!.runtimeEpoch = "boot-b";
      o.epoch = "boot-b";
    }],
    ["process identity", (f: LocalComputeFabric, o: DeploymentRuntimeObservation) => {
      f.runtimes.find(r => r.id === o.runtimeId)!.processIdentity = "process-43";
    }],
    ["configured behavior", (f: LocalComputeFabric) => {
      f.deployments.find(d => d.id === managedId)!.configurationIdentity = '{"context":8192,"reasoning":true}';
    }],
    ["model name", (f: LocalComputeFabric) => {
      f.deployments.find(d => d.id === managedId)!.runtimeModelName = "other.gguf";
    }],
    ["variant", (f: LocalComputeFabric) => {
      f.deployments.find(d => d.id === managedId)!.variantId = "q8";
    }],
  ] as const)("withdraws a previous receipt on %s change", (_kind, mutate) => {
    const { fabric, observation, receipt } = setup();
    mutate(fabric, observation);
    expect(deploymentQualificationState(fabric, managedId, "native-tools", observation, receipt, at))
      .toBe("Stale");
    expect(deploymentCapabilityQualified(fabric, managedId, "native-tools", observation, receipt, at))
      .toBe(false);
  });

  it("never transfers a digest-identical receipt to a second deployment, runtime or host", () => {
    const { fabric, observation, receipt } = setup();
    const runtime = fabric.runtimes.find(r => r.id === observation.runtimeId)!;
    const deployment = fabric.deployments.find(d => d.id === managedId)!;
    const alternate = structuredClone(fabric);
    alternate.runtimes.push({ ...runtime, id: "another-runtime" });
    alternate.hosts.find(h => h.id === secondaryId)!.runtimeIds.push("another-runtime");
    alternate.deployments.push({ ...deployment, id: "another-deployment", runtimeId: "another-runtime" });
    const otherObservation = observed("another-runtime");
    expect(deploymentQualificationState(alternate, "another-deployment", "native-tools",
      otherObservation, receipt, at)).toBe("Stale");
    const crossHost = structuredClone(fabric);
    crossHost.hosts.push({
      ...crossHost.hosts[0], id: "another-host", runtimeIds: ["remote-managed"],
    });
    crossHost.runtimes.push({ ...runtime, id: "remote-managed", hostId: "another-host" });
    crossHost.deployments.push({ ...deployment, id: "remote-deployment",
      hostId: "another-host", runtimeId: "remote-managed" });
    expect(deploymentQualificationState(crossHost, "remote-deployment", "native-tools",
      observed("remote-managed"), receipt, at)).toBe("Stale");
  });

  it("requires an online host/runtime, a current observation, fingerprinted artifact and explicit behavior", () => {
    const { fabric, observation, receipt } = setup();
    expect(deploymentQualificationState(fabric, managedId, "native-tools",
      { ...observation, observedAt: at - 30_000 }, receipt, at)).toBe("Stale");
    expect(deploymentQualificationState(fabric, managedId, "native-tools",
      { ...observation, observedAt: at + 1 }, receipt, at)).toBe("Stale");
    expect(deploymentQualificationState(fabric, managedId, "native-tools",
      { ...observation, epoch: "surprise-restart" }, receipt, at)).toBe("Stale");
    for (const mutate of [
      (f: LocalComputeFabric) => { f.hosts[0].enabled = false; },
      (f: LocalComputeFabric) => { f.runtimes.find(r => r.id === observation.runtimeId)!.health = "offline"; },
      (f: LocalComputeFabric) => { delete f.artifacts.find(a => a.digest === digest)!.digest; },
      (f: LocalComputeFabric) => { delete f.deployments.find(d => d.id === managedId)!.configurationIdentity; },
      (f: LocalComputeFabric) => { f.deployments.find(d => d.id === managedId)!.configurationIdentity = " "; },
    ]) {
      const modified = structuredClone(fabric);
      mutate(modified);
      expect(deploymentQualificationState(modified, managedId, "native-tools", observation, receipt, at))
        .toBe("Stale");
    }
  });

  it("fails closed when persisted conceptual IDs are ambiguous", () => {
    const { fabric, observation, receipt } = setup();
    for (const duplicate of [
      (f: LocalComputeFabric) => f.hosts.push({ ...f.hosts[0] }),
      (f: LocalComputeFabric) => f.runtimes.push({ ...f.runtimes.find(r => r.id === observation.runtimeId)! }),
      (f: LocalComputeFabric) => f.artifacts.push({ ...f.artifacts.find(a => a.digest === digest)! }),
      (f: LocalComputeFabric) => f.deployments.push({ ...f.deployments.find(d => d.id === managedId)! }),
    ]) {
      const modified = structuredClone(fabric);
      duplicate(modified);
      expect(deploymentQualificationState(modified, managedId, "native-tools", observation, receipt, at))
        .toBe("Stale");
    }
  });

  it("rejects expired, malformed and capability-mismatched receipts, and respects runtime denial", () => {
    const { fabric, observation, receipt } = setup();
    expect(deploymentQualificationState(fabric, managedId, "native-tools",
      observation, receipt, at + 60_001)).toBe("Stale");
    expect(deploymentQualificationState(fabric, managedId, "chat", observation, receipt, at))
      .toBe("Stale");
    expect(deploymentQualificationState(fabric, managedId, "native-tools", observation,
      { ...receipt, expiresAt: receipt.verifiedAt + 7 * 86_400_000 + 1 }, at)).toBe("Stale");
    expect(deploymentQualificationState(fabric, managedId, "native-tools", observation,
      { ...receipt, status: "incomplete", evidence: {
        ...receipt.evidence, checks: [{ id: "arguments", result: "incomplete" }],
      } }, at)).toBe("Incomplete");
    expect(deploymentQualificationState(fabric, managedId, "native-tools", observation,
      { ...receipt, status: "unsupported", evidence: {
        ...receipt.evidence, checks: [{ id: "arguments", result: "fail" }],
      } }, at)).toBe("Unsupported");
    const denied = structuredClone(fabric);
    denied.runtimes.find(r => r.id === observation.runtimeId)!.capabilities["native-tools"] =
      { status: "unsupported", source: "observed" };
    expect(deploymentQualificationState(denied, managedId, "native-tools", observation, receipt, at))
      .toBe("Unsupported");
    expect(deploymentCapabilityQualified(denied, managedId, "native-tools", observation, receipt, at))
      .toBe(false);
  });
});
