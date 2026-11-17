import { describe, expect, it } from "vitest";
import {
  addSelfHostedEndpoint,
  assertWritableSelfHostedState,
  createSelfHostedEndpoint,
  emptySelfHostedState,
  readSelfHostedState,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  capabilityStatus,
  runtimeCapabilityAllows,
  withLocalComputeFabric,
  deploymentIdentity,
} from "@/modules/ai/lib/localComputeFabric";
import {
  attachManagedLocalGguf,
  createManagedDeployment,
  isManagedLocalSelectionId,
  managedLocalArtifactId,
  managedLocalChatDeclared,
  managedLocalConfigurationIdentity,
  managedLocalDeploymentId,
  managedLocalModelInfos,
  managedLocalSelectionId,
  managedLocalSelectionStatus,
  managedLocalTransportIdentity,
  resolveManagedLocalSelection,
  MANAGED_LOCAL_HOST_ID,
  MANAGED_LOCAL_RUNTIME_ID,
  MANAGED_LOCAL_RUNTIME_TYPE,
  type ManagedLocalMaterial,
} from "@/modules/ai/lib/managedLocalModels";
import {
  resolveModelSelectionInfo,
  resolveModelTransportIdentity,
} from "@/modules/ai/lib/savedProviderModels";
import { selfHostedModelInfo } from "@/modules/ai/lib/selfHostedModels";
import { saveSelfHostedModel, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { resolveModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";

const digest = `sha256:${"a".repeat(64)}`;
const otherDigest = `sha256:${"b".repeat(64)}`;
const material: ManagedLocalMaterial = {
  version: 1, context: 4096, gpu: 0, tool: false, grammar: false,
};
function add(state = emptySelfHostedState(), modelDigest = digest, config = material) {
  return createManagedDeployment(state, {
    digest: modelDigest, displayName: "Local Test GGUF", material: config,
  });
}
function runtimeOnline(state: SelfHostedState) {
  return {
    ...state,
    fabric: { ...state.fabric!,
      runtimes: state.fabric!.runtimes.map(runtime => runtime.id === MANAGED_LOCAL_RUNTIME_ID ?
        { ...runtime, health: "online" as const } : runtime),
    },
  };
}

describe("LM2D conceptual managed GGUF identity and selection", () => {
  it("persists native-inspected size, file identity and reliable metadata without trusting a filename", () => {
    const inspected = createManagedDeployment(emptySelfHostedState(), {
      digest,
      displayName: "Llama from GGUF header",
      size: 80,
      fileIdentity: `${digest.slice(7)}:80`,
      family: "llama",
      declaredContext: 8192,
      material,
    });
    expect(inspected.state.fabric!.artifacts[0]).toMatchObject({
      id: managedLocalArtifactId(digest), digest, format: "gguf",
      fileIdentity: `${digest.slice(7)}:80`, size: 80,
      family: "llama", declaredContext: 8192,
    });
    expect(inspected.state.fabric!.artifacts[0].quantization).toBeUndefined();
    expect(() => createManagedDeployment(emptySelfHostedState(), {
      digest, size: 80, fileIdentity: `${digest.slice(7)}:81`, material,
    })).toThrow(/file identity disagrees/);
  });

  it("projects one fixed This PC host and managed runtime in the existing fabric without an endpoint or model path", () => {
    const initial = emptySelfHostedState();
    const result = add(initial);
    const state = result.state;
    expect(initial.fabric).toBeUndefined();
    expect(state.endpoints).toEqual([]);
    expect(state.profiles).toEqual([]);
    expect(state.fabric?.hosts).toEqual([expect.objectContaining({
      id: MANAGED_LOCAL_HOST_ID, location: "local", runtimeIds: [MANAGED_LOCAL_RUNTIME_ID],
    })]);
    expect(state.fabric?.runtimes).toEqual([expect.objectContaining({
      id: MANAGED_LOCAL_RUNTIME_ID, type: MANAGED_LOCAL_RUNTIME_TYPE,
      health: "unknown", enabled: true,
    })]);
    expect(state.fabric?.artifacts).toEqual([expect.objectContaining({
      id: JSON.stringify(["digest", digest]), digest,
      format: "gguf", provenance: "user-supplied",
    })]);
    const deployment = state.fabric!.deployments[0];
    expect(deployment).toMatchObject({
      id: managedLocalDeploymentId(digest, material),
      hostId: MANAGED_LOCAL_HOST_ID, runtimeId: MANAGED_LOCAL_RUNTIME_ID,
      artifactId: managedLocalArtifactId(digest),
      runtimeModelName: `managed-gguf:${digest}`,
      configurationRevision: 1,
      configurationIdentity: JSON.stringify(material),
    });
    expect(JSON.stringify(state.fabric)).not.toContain("C:\\");
    expect(JSON.stringify(state.fabric)).not.toContain("modelPath");
    expect(result.selectionId).toBe(managedLocalSelectionId(deployment));
    expect(JSON.parse(result.selectionId.slice("managed-local:".length)))
      .toEqual([deployment.id, deploymentIdentity(deployment)]);
    const runtime = state.fabric!.runtimes[0];
    expect(runtime.capabilities).toEqual({
      chat: { status: "supported", source: "declared" },
      completions: { status: "supported", source: "declared" },
      streaming: { status: "supported", source: "declared" },
      cancellation: { status: "supported", source: "declared" },
      "terminal-completion": { status: "requires-qualification", source: "declared" },
      "instruction-adherence": { status: "requires-qualification", source: "declared" },
      "context-configuration": { status: "requires-qualification", source: "declared" },
      "json-schema": { status: "requires-qualification", source: "declared" },
      grammar: { status: "requires-qualification", source: "declared" },
      "native-tools": { status: "unsupported", source: "declared" },
      "parallel-tools": { status: "unknown", source: "declared" },
    });
    for (const capability of ["chat", "completions", "streaming", "cancellation"] as const) {
      expect(capabilityStatus(runtime, capability)).toBe("supported");
    }
    for (const capability of ["context-configuration", "json-schema", "grammar",
      "terminal-completion", "instruction-adherence"] as const) {
      expect(capabilityStatus(runtime, capability)).toBe("requires-qualification");
      expect(runtimeCapabilityAllows(runtime, capability)).toBe(false);
    }
    // Even an unrelated positive qualification must not promote native tools.
    expect(runtimeCapabilityAllows(runtime, "native-tools", true)).toBe(false);
    expect(runtimeCapabilityAllows(runtime, "parallel-tools", true)).toBe(false);
    assertWritableSelfHostedState(state);
    expect(withLocalComputeFabric(readSelfHostedState(JSON.parse(JSON.stringify(state))))).toEqual(state);
  });

  it("uses material key order and digest to create unique stable immutable selections", () => {
    const alternate: ManagedLocalMaterial = { ...material, context: 8192 };
    const first = add();
    const same = add(first.state);
    expect(same.selectionId).toBe(first.selectionId);
    expect(same.state).toEqual(first.state);
    const second = add(first.state, digest, alternate);
    const third = add(second.state, otherDigest, material);
    expect(new Set([first.selectionId, second.selectionId, third.selectionId]).size).toBe(3);
    expect(third.state.fabric!.hosts).toHaveLength(1);
    expect(third.state.fabric!.runtimes).toHaveLength(1);
    expect(third.state.fabric!.artifacts).toHaveLength(2);
    expect(third.state.fabric!.deployments).toHaveLength(3);
    expect(managedLocalConfigurationIdentity({
      grammar: false, tool: false, gpu: 0, context: 4096, version: 1,
    })).toBe(JSON.stringify(material));
    expect(resolveManagedLocalSelection(third.state, first.selectionId).status).toBe("unavailable");
  });

  it("deduplicates the exact createManagedDeployment material and isolates changed material", () => {
    const initial = add();
    const reordered: ManagedLocalMaterial = {
      grammar: false, tool: false, gpu: 0, context: 4096, version: 1,
    };
    const duplicate = createManagedDeployment(initial.state, {
      digest, material: reordered, displayName: "Different label, same GGUF",
    });
    expect(duplicate.selectionId).toBe(initial.selectionId);
    expect(duplicate.state.fabric!.deployments).toEqual(initial.state.fabric!.deployments);
    expect(duplicate.state.fabric!.artifacts).toEqual(initial.state.fabric!.artifacts);
    expect(duplicate.state.fabric!.runtimes).toEqual(initial.state.fabric!.runtimes);
    const deployment = duplicate.state.fabric!.deployments[0];
    expect(deployment.id).toBe(JSON.stringify([
      "managed-gguf", digest, JSON.stringify(material),
    ]));
    expect(deployment.configurationIdentity).toBe(JSON.stringify(material));
    const otherMaterial = { ...material, context: 8192 };
    const distinct = createManagedDeployment(duplicate.state, {
      digest, material: otherMaterial, displayName: "Same file, other context",
    });
    expect(distinct.selectionId).not.toBe(initial.selectionId);
    expect(distinct.state.fabric!.deployments).toHaveLength(2);
    expect(distinct.state.fabric!.artifacts).toHaveLength(1);
    expect(distinct.state.fabric!.deployments[1].configurationIdentity)
      .toBe(managedLocalConfigurationIdentity(otherMaterial));
    expect(resolveManagedLocalSelection(distinct.state, initial.selectionId).status)
      .toBe("unavailable");
  });

  it("coexists with old Ollama profiles and their independent fabric projection", () => {
    const endpoint = createSelfHostedEndpoint({
      alias: "Lab Ollama", baseURL: "http://127.0.0.1:11434",
      backendHint: "ollama",
    }, "legacy-ollama-endpoint");
    const hosted = saveSelfHostedModel(addSelfHostedEndpoint(emptySelfHostedState(), endpoint),
      endpoint.id, "llama3.2:latest");
    const oldId = selfHostedSelectionId(hosted.profiles[0]);
    const result = add(withLocalComputeFabric(hosted));
    const deployed = result.state.fabric!.deployments[0];
    expect(deployed.id).toBe(managedLocalDeploymentId(digest, material));
    expect(result.state.fabric!.hosts.map(h => h.id)).toEqual([
      endpoint.id, MANAGED_LOCAL_HOST_ID,
    ]);
    expect(result.state.fabric!.runtimes).toHaveLength(2);
    expect(result.state.profiles).toEqual(hosted.profiles);
    expect(resolveModelTransportIdentity(oldId, { selfHostedInference: result.state }).providerId)
      .toBe("ollama");
    expect(resolveModelTransportIdentity(result.selectionId, { selfHostedInference: result.state }).providerId)
      .toBe("openai-compatible");
    expect(withLocalComputeFabric(result.state)).toEqual(result.state);
  });

  it("keeps exact transport/model metadata while offline and never provides a fake HTTP route", () => {
    const { state, selectionId } = add();
    expect(isManagedLocalSelectionId(selectionId)).toBe(true);
    expect(resolveManagedLocalSelection(state, selectionId).status).toBe("unavailable");
    expect(managedLocalSelectionStatus(state, selectionId)).toEqual({
      label: "Runtime unavailable", disabled: true,
    });
    expect(managedLocalModelInfos(state).map(info => info.id)).toEqual([selectionId]);
    expect(selfHostedModelInfo(selectionId, state)).toMatchObject({
      id: selectionId, provider: "openai-compatible", label: "Local Test GGUF", hint: "This PC",
    });
    expect(resolveModelSelectionInfo(selectionId, [], [], state).id).toBe(selectionId);
    const identity = resolveModelTransportIdentity(selectionId, { selfHostedInference: state });
    expect(identity).toEqual({
      providerId: "openai-compatible",
      transportModelId: `managed-gguf:${digest}`,
      managedLocal: {
        deploymentId: state.fabric!.deployments[0].id,
        deploymentIdentity: deploymentIdentity(state.fabric!.deployments[0]),
        artifactDigest: digest,
        configurationRevision: 1,
      },
    });
    expect(identity.endpointBaseURL).toBeUndefined();
    expect(identity.selfHosted).toBeUndefined();
    expect(managedLocalTransportIdentity(selectionId, state)).toEqual(identity);
    expect(resolveModelInputCapabilities(selectionId, state)).toMatchObject({
      text: "supported", tools: "unsupported",
    });
    expect(managedLocalChatDeclared(resolveManagedLocalSelection(state, selectionId))).toBe(true);
    const online = runtimeOnline(state);
    expect(resolveManagedLocalSelection(online, selectionId).status).toBe("available");
    expect(managedLocalSelectionStatus(online, selectionId)).toMatchObject({
      label: "Runtime verification required", disabled: false,
    });
    expect(managedLocalChatDeclared(resolveManagedLocalSelection(online, selectionId))).toBe(true);
    expect(resolveModelInputCapabilities(selectionId, online)).toMatchObject({
      text: "supported", tools: "unsupported",
    });
  });

  it.each([
    ["model digest", (s: SelfHostedState) => { s.fabric!.artifacts[0].digest = otherDigest; }],
    ["artifact format", (s: SelfHostedState) => { s.fabric!.artifacts[0].format = "opaque"; }],
    ["artifact ID", (s: SelfHostedState) => { s.fabric!.artifacts[0].id = "different"; }],
    ["host ID", (s: SelfHostedState) => { s.fabric!.deployments[0].hostId = "other-pc"; }],
    ["runtime ID", (s: SelfHostedState) => { s.fabric!.deployments[0].runtimeId = "other-runtime"; }],
    ["runtime type", (s: SelfHostedState) => { s.fabric!.runtimes[0].type = "ollama"; }],
    ["runtime version", (s: SelfHostedState) => { s.fabric!.runtimes[0].version = "b12249"; }],
    ["runtime revision", (s: SelfHostedState) => { s.fabric!.runtimes[0].configurationRevision++; }],
    ["deployment name", (s: SelfHostedState) => { s.fabric!.deployments[0].runtimeModelName = "other.gguf"; }],
    ["material configuration", (s: SelfHostedState) => { s.fabric!.deployments[0].configurationIdentity = JSON.stringify({ ...material, context: 8192 }); }],
    ["deployment ID", (s: SelfHostedState) => { s.fabric!.deployments[0].id = "replaced"; }],
  ] as const)("refuses old exact selection after %s changes", (_name, mutation) => {
    const { state, selectionId } = add();
    const modified = structuredClone(state);
    mutation(modified);
    expect(resolveManagedLocalSelection(modified, selectionId).status).toBe("missing");
    expect(resolveModelInputCapabilities(selectionId, modified)).toMatchObject({
      text: "unsupported", tools: "unsupported",
    });
    expect(() => resolveModelTransportIdentity(selectionId, { selfHostedInference: modified }))
      .toThrow(/selection changed or is missing/);
  });

  it("rejects malformed selectors, missing state, unsupported material and digest without name fallback", () => {
    const { state, selectionId } = add();
    const strings = [
      "managed-local:", "managed-local:{}", "managed-local:[1,2]",
      "managed-local:[\"same\",\"same\"]", selectionId + " ",
      "managed-local:[\"model.gguf\",\"same\"]",
    ];
    for (const id of strings) {
      expect(resolveManagedLocalSelection(state, id).status).toBe("missing");
      expect(resolveModelInputCapabilities(id, state)).toMatchObject({
        text: "unsupported", tools: "unsupported",
      });
      expect(() => resolveModelTransportIdentity(id, { selfHostedInference: state }))
        .toThrow(/selection changed or is missing/);
    }
    expect(() => resolveModelTransportIdentity(selectionId)).toThrow(/selection changed or is missing/);
    expect(resolveModelInputCapabilities(selectionId)).toMatchObject({
      text: "unsupported", tools: "unsupported",
    });
    expect(resolveManagedLocalSelection(state, "self-hosted:unknown").status).toBe("not-managed");
    expect(() => add(state, "SHA256:" + "A".repeat(64))).toThrow();
    expect(() => add(state, `sha256:${"x".repeat(64)}`)).toThrow();
    expect(() => add(state, digest, { ...material, tool: true } as unknown as ManagedLocalMaterial)).toThrow();
    expect(() => add(state, digest, { ...material, context: 262144 } as unknown as ManagedLocalMaterial)).toThrow();
    expect(() => add(state, digest, { ...material, gpu: 4 } as unknown as ManagedLocalMaterial)).toThrow();
  });

  it("detects conflicting managed host/runtime and deployment mutation without rewriting them", () => {
    const first = add();
    const hostConflict = structuredClone(first.state);
    hostConflict.fabric!.hosts[0].location = "remote";
    expect(() => add(hostConflict)).toThrow(/runtime identity conflict/);
    const runtimeConflict = structuredClone(first.state);
    runtimeConflict.fabric!.runtimes[0].type = "foreign-backend";
    expect(() => add(runtimeConflict)).toThrow(/runtime identity conflict/);
    const deploymentConflict = structuredClone(first.state);
    deploymentConflict.fabric!.deployments[0].runtimeModelName = "old-name";
    expect(() => attachManagedLocalGguf(deploymentConflict, {
      digest, displayName: "New label", material,
    })).toThrow(/deployment identity conflict/);
  });

  it("does not treat ambiguous saved fabric IDs as an exact managed selection", () => {
    const { state, selectionId } = add();
    for (const group of ["hosts", "runtimes", "artifacts", "deployments"] as const) {
      const corrupted = structuredClone(state);
      const rows = corrupted.fabric![group];
      // The schema permits structurally valid duplicate IDs; never inherit
      // trust from whichever row a generic reconciliation would keep.
      if (group === "hosts") corrupted.fabric!.hosts.push({ ...corrupted.fabric!.hosts[0] });
      if (group === "runtimes") corrupted.fabric!.runtimes.push({ ...corrupted.fabric!.runtimes[0] });
      if (group === "artifacts") corrupted.fabric!.artifacts.push({ ...corrupted.fabric!.artifacts[0] });
      if (group === "deployments") corrupted.fabric!.deployments.push({ ...corrupted.fabric!.deployments[0] });
      expect(rows.length).toBe(2);
      expect(resolveManagedLocalSelection(corrupted, selectionId).status).toBe("missing");
      expect(managedLocalModelInfos(corrupted)).toEqual([]);
      expect(() => add(corrupted)).toThrow(/Ambiguous managed fabric identity/);
    }
  });
});
