/**
 * LM2E offline acceptance matrix (18 cases).
 *
 * Uses the real settings/fabric projection, canonical saved-model selectors,
 * transport capture and per-deployment qualification gates. The sole native
 * mock is the route-epoch response in the recovery case: no GUI, engine,
 * filesystem, HTTP server, or cloud provider is invoked.
 *
 * The full context-CAS/commit and request-dispatch paths are covered by
 * modelSwitch.test.ts, managedLocalRouting.test.ts and managedLocalAcceptance.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  acceptsLegacyDeploymentQualification,
  capabilityStatus,
  deploymentCapabilityQualified,
  deploymentIdentity,
  deploymentQualificationScope,
  deploymentQualificationState,
  reconcileLocalComputeFabric,
  resolveModelDeployment,
  runtimeCapabilityAllows,
  withLocalComputeFabric,
  type DeploymentQualificationReceipt,
  type DeploymentRuntimeObservation,
} from "./localComputeFabric";
import {
  attachManagedLocalGguf,
  MANAGED_LOCAL_HOST_ID,
  MANAGED_LOCAL_RUNTIME_ID,
  managedLocalSelectionId,
  resolveManagedLocalSelection,
  savedManagedLocalModelInfos,
} from "./managedLocalModels";
import {
  assertCurrentOllamaHostIdentity,
  canonicalSelfHostedSelectionId,
  savedSelfHostedModelInfos,
  saveSelfHostedModel,
  selfHostedPickerStatus,
  selfHostedSelectionId,
} from "./selfHostedModels";
import {
  addSelfHostedEndpoint,
  assertWritableSelfHostedState,
  createSelfHostedEndpoint,
  deleteSelfHostedEndpoint,
  editSelfHostedEndpoint,
  emptySelfHostedState,
  readSelfHostedState,
  type SelfHostedState,
} from "./selfHostedProfiles";
import { migrateSelfHostedProfiles } from "./selfHostedMigration";
import {
  resolveModelSelectionInfo,
  resolveModelTransportIdentity,
  type ModelTransportIdentity,
} from "./savedProviderModels";
import { resolveModelInputCapabilities } from "./modelCapabilities";
import { managedLocalRequiresAgentQualification } from "./agent";
import { assertCurrentManagedLocalRoute, type ManagedLocalNativeRoute } from "./managedLocalRuntime";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const modelName = "same:latest";
const label = "Identical model label";
const material = {
  version: 1 as const, context: 4096, gpu: 0 as const,
  tool: false as const, grammar: false as const,
};

function register(
  state: SelfHostedState,
  id: string,
  backend: "ollama" | "lmstudio",
  baseURL: string,
  alias = "Twin workstation",
): SelfHostedState {
  const endpoint = createSelfHostedEndpoint({
    alias, baseURL, backendHint: backend, allowPrivateNetwork: true,
  }, id, 100);
  return saveSelfHostedModel(addSelfHostedEndpoint(state, endpoint), id, modelName, label);
}

function dualOllama(): SelfHostedState {
  const local = register(emptySelfHostedState(), "host-a", "ollama",
    "http://127.0.0.1:11434/");
  const remote = register(local, "host-b", "ollama",
    "http://192.168.1.45:11434/");
  return withLocalComputeFabric(remote);
}

function mixed() {
  const ollama = register(emptySelfHostedState(), "ollama-pc", "ollama",
    "http://127.0.0.1:11434/", "This PC");
  const first = attachManagedLocalGguf(ollama, {
    digest: digestA, displayName: label, material,
  });
  return {
    state: first.state,
    ollamaId: selfHostedSelectionId(first.state.profiles[0]),
    managedId: first.selectionId,
  };
}

function route(modelId: string, state: SelfHostedState): ModelTransportIdentity {
  return resolveModelTransportIdentity(modelId, { selfHostedInference: state });
}

function qualifyingManaged(state: SelfHostedState) {
  const live = structuredClone(state);
  const runtime = live.fabric!.runtimes.find(row => row.id === MANAGED_LOCAL_RUNTIME_ID)!;
  runtime.health = "online";
  runtime.processIdentity = "pid-fixture-41";
  runtime.runtimeEpoch = "boot-41";
  const now = 1_800_000_000_000;
  const fabric = reconcileLocalComputeFabric(live);
  const deployment = fabric.deployments.find(row => row.runtimeId === MANAGED_LOCAL_RUNTIME_ID)!;
  const observed: DeploymentRuntimeObservation = {
    runtimeId: runtime.id,
    configurationRevision: runtime.configurationRevision,
    version: runtime.version!,
    epoch: "boot-41",
    observedAt: now - 100,
  };
  const scope = deploymentQualificationScope(fabric, deployment.id, observed, now)!;
  const receipt: DeploymentQualificationReceipt = {
    version: 2, scope: { ...scope, deploymentId: deployment.id },
    capability: "context-configuration",
    status: "verified", verifiedAt: now - 90, expiresAt: now + 10_000,
    context: { contextTokens: 2048 },
    procedure: { id: "clack-context-qualification", version: 1 },
    evidence: { source: "native-observation", reference: "context-1",
      digest: `sha256:${"e".repeat(64)}`,
      checks: [{ id: "allocated-context", result: "pass" }] },
  };
  return { live, fabric, deployment, observed, receipt, now };
}

afterEach(() => vi.clearAllMocks());

describe("LM2E unified Host → Runtime → Artifact → Deployment selection: 18 offline acceptance cases", () => {
  it("01 duplicate labels on two Ollama hosts retain distinct endpoints and captured routes", () => {
    const state = dualOllama();
    const [a, b] = state.profiles.map(selfHostedSelectionId);
    const fabric = reconcileLocalComputeFabric(state);
    expect(savedSelfHostedModelInfos(state).map(row => row.label)).toEqual([label, label]);
    expect(fabric.hosts.map(row => row.id)).toEqual(["host-a", "host-b"]);
    expect(a).not.toBe(b);
    expect(route(a, state).endpointBaseURL).toBe("http://127.0.0.1:11434/v1");
    expect(route(b, state).endpointBaseURL).toBe("http://192.168.1.45:11434/v1");
    expect(() => assertCurrentOllamaHostIdentity(route(a, state), b, state))
      .toThrow(/identity changed/);
  });

  it("02 same-host duplicate labels across Ollama and LM Studio remain runtime-specific", () => {
    let state = register(emptySelfHostedState(), "same-machine-ollama", "ollama",
      "http://127.0.0.1:11434/");
    state = register(state, "same-machine-studio", "lmstudio",
      "http://127.0.0.1:1234/");
    const persisted = withLocalComputeFabric(state);
    const fabric = structuredClone(persisted.fabric!);
    const studio = fabric.runtimes.find(row => row.legacyEndpointId === "same-machine-studio")!;
    studio.hostId = "same-machine-ollama";
    fabric.hosts = fabric.hosts.filter(row => row.id !== "same-machine-studio");
    fabric.hosts[0].runtimeIds.push(studio.id);
    const shared = { ...persisted, fabric };
    const combined = reconcileLocalComputeFabric(shared);
    const [ollamaId, studioId] = shared.profiles.map(selfHostedSelectionId);
    expect(combined.hosts).toHaveLength(1);
    expect(combined.hosts[0].runtimeIds).toHaveLength(2);
    expect(combined.deployments.map(row => row.hostId)).toEqual([
      "same-machine-ollama", "same-machine-ollama",
    ]);
    expect(ollamaId).not.toBe(studioId);
    expect(route(ollamaId, shared).providerId).toBe("ollama");
    expect(route(studioId, shared).providerId).toBe("openai-compatible");
    expect(route(studioId, shared).endpointBaseURL).toBe("http://127.0.0.1:1234/v1");
  });

  it("03 switching Ollama → managed GGUF resolves the chosen exact deployment, not Ollama URL", () => {
    const { state, ollamaId, managedId } = mixed();
    const source = route(ollamaId, state);
    const target = route(managedId, state);
    expect(source.selfHosted?.endpointId).toBe("ollama-pc");
    expect(source.managedLocal).toBeUndefined();
    expect(target.managedLocal?.artifactDigest).toBe(digestA);
    expect(target.managedLocal?.deploymentId)
      .toBe(state.fabric!.deployments.find(row => row.runtimeId === MANAGED_LOCAL_RUNTIME_ID)!.id);
    expect(target.endpointBaseURL).toBeUndefined();
    expect(resolveModelSelectionInfo(managedId, [], [], state).id).toBe(managedId);
    expect(route(ollamaId, state)).toEqual(source);
  });

  it("04 switching managed GGUF → Ollama restores only the saved Ollama transport", () => {
    const { state, ollamaId, managedId } = mixed();
    const before = route(managedId, state);
    const selected = route(ollamaId, state);
    expect(selected.providerId).toBe("ollama");
    expect(selected.transportModelId).toBe(modelName);
    expect(selected.endpointBaseURL).toBe("http://127.0.0.1:11434/v1");
    expect(selected.managedLocal).toBeUndefined();
    expect(route(managedId, state)).toEqual(before);
    expect(() => assertCurrentOllamaHostIdentity(selected, ollamaId, state)).not.toThrow();
  });

  it("05 persisted settings round-trip retains the exact Host/Runtime/Artifact/Deployment IDs", () => {
    const { state, ollamaId, managedId } = mixed();
    assertWritableSelfHostedState(state);
    const reloaded = readSelfHostedState(JSON.parse(JSON.stringify(state)));
    const persisted = withLocalComputeFabric(reloaded);
    expect(persisted).toEqual(reloaded);
    expect(route(ollamaId, persisted)).toEqual(route(ollamaId, state));
    expect(route(managedId, persisted)).toEqual(route(managedId, state));
    expect(reconcileLocalComputeFabric(persisted).deployments).toHaveLength(2);
    expect(reconcileLocalComputeFabric(persisted).artifacts).toHaveLength(2);
  });

  it("06 pre-fabric legacy Ollama migration preserves ollama-local alongside managed GGUF", () => {
    const legacy = new Map<string, unknown>([
      ["ollamaBaseURL", "http://127.0.0.1:11434/"],
      ["ollamaModelId", modelName],
    ]);
    const migrated = migrateSelfHostedProfiles(null, legacy, 100);
    const withManaged = attachManagedLocalGguf(migrated, { digest: digestA, material });
    expect(withManaged.state.endpoints.map(row => row.id)).toEqual(["legacy:ollama"]);
    expect(route("ollama-local", withManaged.state)).toMatchObject({
      providerId: "ollama", transportModelId: modelName,
      selfHosted: { endpointId: "legacy:ollama" },
    });
    expect(route(withManaged.selectionId, withManaged.state).managedLocal?.artifactDigest)
      .toBe(digestA);
  });

  it("07 an offline Ollama retains its registered selection while rejecting stale execution", () => {
    const state = dualOllama();
    const selected = selfHostedSelectionId(state.profiles[0]);
    const offline: SelfHostedState = {
      ...state, inventories: [{
        endpointId: "host-a", configurationRevision: 1,
        observedAt: Date.now(), connected: false, models: [],
      }],
    };
    expect(savedSelfHostedModelInfos(offline).some(row => row.id === selected)).toBe(true);
    expect(selfHostedPickerStatus(selected, offline)?.disabled).toBe(true);
    expect(() => route(selected, offline)).toThrow(/Offline/);
    expect(route(selfHostedSelectionId(state.profiles[1]), offline).selfHosted?.endpointId)
      .toBe("host-b");
  });

  it("08 disabling or deleting a host invalidates only its route, never its sibling", () => {
    const state = dualOllama();
    const [first, second] = state.profiles.map(selfHostedSelectionId);
    const disabled = editSelfHostedEndpoint(state, "host-a", { enabled: false }, 200);
    const deleted = deleteSelfHostedEndpoint(state, "host-a", [], 201);
    for (const next of [disabled, deleted]) {
      expect(resolveModelDeployment(next, next.profiles[0])).toBeUndefined();
      expect(() => route(first, next)).toThrow();
      expect(route(second, next).selfHosted?.endpointId).toBe("host-b");
    }
  });

  it("09 changed endpoint revision refuses a captured route without rebinding its model tag", () => {
    const state = dualOllama();
    const chosen = selfHostedSelectionId(state.profiles[0]);
    const captured = route(chosen, state);
    const changed = editSelfHostedEndpoint(state, "host-a", {
      baseURL: "http://127.0.0.1:11435/",
    }, 210);
    expect(route(chosen, changed).selfHosted?.configurationRevision)
      .toBe((captured.selfHosted?.configurationRevision ?? 0) + 1);
    expect(() => assertCurrentOllamaHostIdentity(captured, chosen, changed))
      .toThrow(/identity changed/);
    expect(captured.endpointBaseURL).toBe("http://127.0.0.1:11434/v1");
  });

  it("10 changed pinned Ollama digest blocks a same-tag replacement", () => {
    const state = dualOllama();
    const selected = selfHostedSelectionId(state.profiles[0]);
    const pinned = structuredClone(state);
    pinned.profiles[0].modelRevision = "a".repeat(64);
    pinned.inventories = [{
      endpointId: "host-a", configurationRevision: 1,
      observedAt: Date.now(), connected: true, models: [{
        id: modelName, name: label, chat: "supported", digest: "b".repeat(64),
      }],
    }];
    expect(selfHostedPickerStatus(selected, pinned)?.label).toBe("Model changed · reselect");
    expect(() => route(selected, pinned)).toThrow(/Model changed/);
  });

  it("11 distinct same-named managed digests cannot inherit one another's selection", () => {
    const first = attachManagedLocalGguf(emptySelfHostedState(), {
      digest: digestA, displayName: label, material,
    });
    const second = attachManagedLocalGguf(first.state, {
      digest: digestB, displayName: label, material,
    });
    expect(savedManagedLocalModelInfos(second.state).map(row => row.label)).toEqual([label, label]);
    expect(new Set([first.selectionId, second.selectionId]).size).toBe(2);
    const tampered = structuredClone(second.state);
    const original = tampered.fabric!.artifacts.find(row => row.digest === digestA)!;
    original.digest = digestB;
    expect(resolveManagedLocalSelection(tampered, first.selectionId).status).toBe("missing");
    expect(() => route(first.selectionId, tampered)).toThrow(/selection changed or is missing/);
    expect(route(second.selectionId, second.state).managedLocal?.artifactDigest).toBe(digestB);
  });

  it("12 a managed runtime epoch change invalidates per-deployment context qualification", () => {
    const { state } = mixed();
    const { fabric, deployment, observed, receipt, now } = qualifyingManaged(state);
    expect(receipt.scope.deploymentIdentity).toBe(deploymentIdentity(deployment));
    expect(deploymentCapabilityQualified(fabric, deployment.id, "context-configuration",
      observed, receipt, now, receipt.version === 2 ? receipt.context : {})).toBe(true);
    const restarted = { ...observed, epoch: "boot-42" };
    expect(deploymentQualificationState(fabric, deployment.id, "context-configuration",
      restarted, receipt, now, receipt.version === 2 ? receipt.context : {})).toBe("Stale");
    expect(deploymentCapabilityQualified(fabric, deployment.id, "context-configuration",
      restarted, receipt, now, receipt.version === 2 ? receipt.context : {})).toBe(false);
  });

  it("13 removing one deployment never routes its historical selection to another", () => {
    const first = attachManagedLocalGguf(emptySelfHostedState(), {
      digest: digestA, displayName: label, material,
    });
    const second = attachManagedLocalGguf(first.state, {
      digest: digestB, displayName: label, material,
    });
    const removed: SelfHostedState = {
      ...second.state,
      fabric: {
        ...second.state.fabric!,
        deployments: second.state.fabric!.deployments.filter(row =>
          managedLocalSelectionId(row) !== first.selectionId),
      },
    };
    expect(savedManagedLocalModelInfos(removed).map(row => row.id)).toEqual([second.selectionId]);
    expect(resolveManagedLocalSelection(removed, first.selectionId).status).toBe("missing");
    expect(() => route(first.selectionId, removed)).toThrow(/selection changed or is missing/);
    expect(resolveModelInputCapabilities(first.selectionId, removed).text).toBe("unsupported");
  });

  it("14 conversation-captured Ollama and GGUF route identities do not follow current selection", () => {
    const { state, ollamaId, managedId } = mixed();
    const runOllama = structuredClone(route(ollamaId, state));
    const runManaged = structuredClone(route(managedId, state));
    const switchedSelection = managedId;
    expect(switchedSelection).not.toBe(ollamaId);
    expect(runOllama.selfHosted?.endpointId).toBe("ollama-pc");
    expect(runManaged.managedLocal?.artifactDigest).toBe(digestA);
    expect(runManaged.endpointBaseURL).toBeUndefined();
    expect(() => assertCurrentOllamaHostIdentity(runOllama, ollamaId, state)).not.toThrow();
    expect(() => assertCurrentOllamaHostIdentity(runOllama, switchedSelection, state))
      .toThrow(/identity changed/);
  });

  it("15 recovered or cancelled managed route cannot continue on a new native process epoch", async () => {
    const { state, managedId } = mixed();
    const identity = route(managedId, state).managedLocal!;
    const original: ManagedLocalNativeRoute = {
      baseUrl: "http://127.0.0.1:50491/v1",
      apiKey: "f".repeat(64), epoch: "e".repeat(64),
      modelAlias: `clack-${digestA.slice(7, 23)}`, processId: 4100,
    };
    vi.mocked(invoke).mockResolvedValueOnce({ ...original });
    await expect(assertCurrentManagedLocalRoute(identity, original)).resolves.toBeUndefined();
    // A stopped/cancelled run never carries process authority into recovery:
    // the runtime owns the epoch, and a fresh IPC answer replaces it.
    vi.mocked(invoke).mockResolvedValueOnce({
      ...original, epoch: "d".repeat(64), processId: 4101,
    });
    await expect(assertCurrentManagedLocalRoute(identity, original))
      .rejects.toThrow(/restarted or changed/);
    expect(vi.mocked(invoke).mock.calls.every(([name]) =>
      name === "managed_local_runtime_route")).toBe(true);
  });

  it("16 malformed managed selection never silently falls back to matching Ollama", () => {
    const { state, ollamaId, managedId } = mixed();
    const invalid = managedId.replace(digestA, digestB);
    expect(invalid).not.toBe(managedId);
    expect(resolveManagedLocalSelection(state, invalid).status).toBe("missing");
    expect(() => route(invalid, state)).toThrow(/selection changed or is missing/);
    expect(() => route("managed-local:[\"same:latest\",\"same:latest\"]", state))
      .toThrow(/selection changed or is missing/);
    expect(route(ollamaId, state).providerId).toBe("ollama");
  });

  it("17 Chat-only GGUF permits text but denies Agent-native tool qualifications", () => {
    const { state, managedId } = mixed();
    const capabilities = resolveModelInputCapabilities(managedId, state);
    expect(capabilities).toMatchObject({ text: "supported", tools: "unsupported" });
    expect(managedLocalRequiresAgentQualification(managedId, "chat-only", false, false))
      .toBe(false);
    expect(managedLocalRequiresAgentQualification(managedId, "agent-profile", false, false))
      .toBe(true);
    expect(managedLocalRequiresAgentQualification(managedId, "chat-only", true, false))
      .toBe(true);
    const { fabric, deployment, observed, now } = qualifyingManaged(state);
    expect(capabilityStatus(fabric.runtimes.find(row => row.id === MANAGED_LOCAL_RUNTIME_ID)!,
      "native-tools")).toBe("unsupported");
    expect(deploymentCapabilityQualified(fabric, deployment.id, "native-tools",
      observed, undefined, now)).toBe(false);
  });

  it("18 unknown capabilities and offline inventory refresh preserve saved legacy Ollama and GGUF", () => {
    const legacy = new Map<string, unknown>([
      ["ollamaBaseURL", "http://127.0.0.1:11434/"],
      ["ollamaModelId", modelName],
    ]);
    const managed = attachManagedLocalGguf(
      migrateSelfHostedProfiles(null, legacy, 100),
      { digest: digestA, displayName: label, material },
    );
    const refresh: SelfHostedState = {
      ...managed.state, inventories: [{
        endpointId: "legacy:ollama", configurationRevision: 1,
        observedAt: Date.now(), connected: false, models: [],
      }],
    };
    const reload = readSelfHostedState(JSON.parse(JSON.stringify(refresh)));
    expect(savedSelfHostedModelInfos(reload).map(row => row.id)).toContain("ollama-local");
    expect(savedManagedLocalModelInfos(reload).map(row => row.id)).toContain(managed.selectionId);
    expect(selfHostedPickerStatus("ollama-local", reload)?.disabled).toBe(true);
    expect(resolveManagedLocalSelection(reload, managed.selectionId).status).toBe("unavailable");
    expect(route(managed.selectionId, reload).endpointBaseURL).toBeUndefined();
    const runtime = reconcileLocalComputeFabric(reload).runtimes
      .find(row => row.id === MANAGED_LOCAL_RUNTIME_ID)!;
    expect(capabilityStatus(runtime, "future-vision-special")).toBe("unknown");
    expect(runtimeCapabilityAllows(runtime, "future-vision-special", true)).toBe(false);
    expect(resolveModelInputCapabilities(managed.selectionId, reload).image).toBe("unknown");
    expect(canonicalSelfHostedSelectionId("ollama-local", reload)).toBe("ollama-local");
    expect(reconcileLocalComputeFabric(reload).hosts.some(row => row.id === MANAGED_LOCAL_HOST_ID))
      .toBe(true);
    expect(acceptsLegacyDeploymentQualification(reload, reload.profiles[0])).toBe(true);
  });
});
