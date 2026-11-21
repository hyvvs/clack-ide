import type { Chat, UIMessage } from "@ai-sdk/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/store/chatStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/ai/store/chatStore")>();
  return {
    ...actual,
    useChatStore: Object.assign(
      <T,>(
        selector: (state: ReturnType<typeof actual.useChatStore.getState>) => T,
      ) => selector(actual.useChatStore.getState()),
      actual.useChatStore,
    ),
  };
});

vi.mock("@/modules/settings/preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/settings/preferences")>();
  return { ...actual, usePreferencesStore: Object.assign(
    <T,>(selector: (state: ReturnType<typeof actual.usePreferencesStore.getState>) => T) => selector(actual.usePreferencesStore.getState()),
    actual.usePreferencesStore,
  ) };
});

import { ModelDropdown, firstEnabledPickerMenuItem, groupFabricPickerModels, modelPickerHostAvailability, pickerArtifactMetadata, pickerDeploymentAccessibleLabel, recheckManagedPickerSelection } from "@/modules/ai/components/AiStatusBarControls";
import { ModelSwitchNotice } from "./ModelSwitchNotice";
import { AI_CHAT_TOOLTIP, AiChatButton } from "./AiChatButton";
import type { SessionRunState } from "@/modules/ai/lib/sessions";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { createSavedProviderModel, resolveModelTransportIdentity, savedProviderModelSelectionId } from "@/modules/ai/lib/savedProviderModels";
import { parseProviderContextCatalog } from "@/modules/ai/lib/providerModelEvidence";
import { minimaxFreeCatalogRecord } from "@/modules/ai/lib/openrouterCatalog.fixture";
import { createSelfHostedEndpoint, ensureSelfHostedProfile, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { saveSelfHostedModel, savedSelfHostedModelInfos, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { migrateSelfHostedProfiles } from "@/modules/ai/lib/selfHostedMigration";
import { resolveModel } from "@/modules/ai/config";
import { addConceptualRuntime, reconcileLocalComputeFabric, withLocalComputeFabric, type LocalRuntime, type ModelArtifact, type ModelDeployment } from "@/modules/ai/lib/localComputeFabric";
import { remoteSshUrl } from "@/modules/ai/lib/remoteSsh";
import { attachManagedLocalGguf, savedManagedLocalModelInfos } from "@/modules/ai/lib/managedLocalModels";

const original = useChatStore.getState();

type PickerRuntime = ReturnType<typeof groupFabricPickerModels>["hostGroups"][number]["runtimes"][number];
const runtimeModels = (runtime: PickerRuntime) => runtime.artifacts.flatMap(
  artifact => artifact.deployments.map(item => item.model),
);

describe("model compatibility notice", () => {
  it("offers confirmation only for uncertain switches", () => {
    const html = renderToStaticMarkup(
      <ModelSwitchNotice
        targetLabel="Saved model"
        assessment={{
          status: "warning",
          reasons: ["Context window is unknown."],
          contextLimit: null,
          estimatedTokens: 500,
        }}
        onBack={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain("Optimize and switch");
    expect(html).toContain("Context window is unknown.");
    expect(html).not.toContain("capacity");
    expect(html).toContain('role="alert"');
  });
  it("offers no bypass for a known incompatibility", () => {
    const html = renderToStaticMarkup(
      <ModelSwitchNotice
        targetLabel="Text only"
        assessment={{
          status: "blocked",
          reasons: [
            "This chat contains images that this model cannot receive.",
          ],
          contextLimit: 8000,
          estimatedTokens: 9000,
        }}
        onBack={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).not.toContain("Optimize and switch");
    expect(html).toContain("Choose another model");
    expect(html).toContain("Cannot switch model");
  });
});

describe("exact Clack-managed picker click recheck (no generation)", () => {
  const digest = `sha256:${"c".repeat(64)}`;
  const registered = attachManagedLocalGguf({ version: 1, revision: 0, endpoints: [], profiles: [] }, {
    digest, displayName: "Qwen2.5-0.5B-Instruct", material: {
      version: 1, context: 2048, gpu: 0, tool: false, grammar: false,
    },
  });
  const deployment = registered.state.fabric!.deployments[0];
  const identity = JSON.parse(registered.selectionId.slice("managed-local:".length))[1] as string;
  const ready = { installed: true, state: "Ready", epoch: "a".repeat(64),
    deploymentId: deployment.id, modelDigest: digest, processId: 1234 };
  const status = (value = ready) => vi.fn(async () => value);
  const presence = (value = true) => vi.fn(async () => value);

  it("supplies the exact deployment ID/identity/digest to native status and accepts only fresh Ready", async () => {
    const read = status();
    const file = presence();
    expect(await recheckManagedPickerSelection(registered.selectionId, registered.state, read, file))
      .toEqual({ ok: true, observed: ready, digest });
    expect(read).toHaveBeenCalledExactlyOnceWith(deployment.id, identity);
    expect(file).toHaveBeenCalledExactlyOnceWith(digest);
    expect(useChatStore.getState().sessions[0]?.profile?.modelId).not.toBe(registered.selectionId);
  });

  it.each(["Stopped", "Loading", "Failed", "Not Installed"])(
    "rejects %s with a visible reason before any chat mutation", async (phase) => {
      const result = await recheckManagedPickerSelection(registered.selectionId, registered.state,
        status({ ...ready, state: phase }), presence());
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("Cannot select") });
      expect(result.ok === false && result.reason.toLowerCase()).toContain(phase === "Not Installed" ? "runtime unavailable" : phase.toLowerCase());
    },
  );

  it.each([
    ["other deployment", { deploymentId: "wrong-deployment" }],
    ["other digest", { modelDigest: `sha256:${"d".repeat(64)}` }],
    ["missing epoch", { epoch: "" }],
    ["not installed", { installed: false }],
  ])("rejects %s without using another deployment's native Ready", async (_, change) => {
    const result = await recheckManagedPickerSelection(registered.selectionId, registered.state,
      status({ ...ready, ...change }), presence());
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("Cannot select") });
  });

  it("rejects missing GGUF explicitly, preserving the old conversation identity", async () => {
    const before = useChatStore.getState().selectedModelId;
    expect(await recheckManagedPickerSelection(registered.selectionId, registered.state, status(), presence(false)))
      .toMatchObject({ ok: false, reason: expect.stringContaining("model file missing") });
    expect(useChatStore.getState().selectedModelId).toBe(before);
  });

  it("rejects a stale canonical deployment selection without invoking native status", async () => {
    const read = status();
    const stale = `managed-local:${JSON.stringify([deployment.id, `${identity}-stale`])}`;
    const outcome = await recheckManagedPickerSelection(stale, registered.state, read, presence());
    expect(outcome).toMatchObject({ ok: false, reason: expect.stringContaining("identity changed") });
    expect(read).not.toHaveBeenCalled();
  });

  it("explicitly rejects native read failures instead of silently ignoring the picker click", async () => {
    const result = await recheckManagedPickerSelection(registered.selectionId, registered.state,
      vi.fn(async () => { throw new Error("native unavailable"); }), presence());
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("Nothing was switched") });
  });
});

describe("AiChatButton", () => {
  it("exposes a clear label, shortcut, and closed state", () => {
    const html = renderToStaticMarkup(
      <AiChatButton open={false} onOpen={() => {}} />,
    );

    expect(AI_CHAT_TOOLTIP).toContain("Open AI Chat");
    expect(AI_CHAT_TOOLTIP).toContain("Ctrl+I");
    expect(html).toContain(`aria-label="${AI_CHAT_TOOLTIP}"`);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-state="closed"');
    expect(html).toContain("AI Chat");
  });

  it("reflects the visible transcript state", () => {
    const html = renderToStaticMarkup(
      <AiChatButton open={true} onOpen={() => {}} />,
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-state="open"');
  });
});

beforeEach(() => {
  chats.clear();
  useChatStore.setState({
    activeSessionId: "chat-a",
    selectedModelId: "gpt-5.4-mini",
    sessions: ["chat-a", "chat-b"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
      profile: {
        agentId: "builtin:coder",
        modelId: "gpt-5.4-mini",
        workspaceId: null,
        workspaceRoot: null,
      },
    })),
  });
});

afterEach(() => {
  chats.clear();
  useChatStore.setState(original);
});

function setRun(state: SessionRunState) {
  useChatStore.setState((store) => ({
    sessions: store.sessions.map((session) =>
      session.id === "chat-a"
        ? { ...session, run: { state, startedAt: 1, modelId: "gpt-5.4-mini" } }
        : session,
    ),
  }));
}

describe.each([
  undefined,
  "chat-a",
])("model picker lock (session %s)", (sessionId) => {
  it("disables the trigger and explains the lock during a logical run", () => {
    setRun("running");
    const html = renderToStaticMarkup(<ModelDropdown sessionId={sessionId} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain(
      "Locked until this run finishes or stops completely.",
    );
    expect(html).toContain('data-state="closed"');
  });

  it.each([
    "completed",
    "cancelled",
    "failed",
    "interrupted",
  ] as const)("allows selection after a %s run has settled", (state) => {
    setRun(state);
    const html = renderToStaticMarkup(<ModelDropdown sessionId={sessionId} />);
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-label="Change model: GPT-5.4 mini.');
    expect(html).toContain("Cloud connection");
  });

  it.each([
    "submitted",
    "streaming",
  ] as const)("remains locked while a cancelled request is %s", (status) => {
    setRun("cancelled");
    chats.set("chat-a", { status } as Chat<UIMessage>);
    const html = renderToStaticMarkup(<ModelDropdown sessionId={sessionId} />);
    expect(html).toContain('disabled=""');
  });
});

describe("model picker scope", () => {
  it("shows only registered artifact facts and never invents format, size, or context", () => {
    const unknown: ModelArtifact = {
      id: "unknown", displayName: "Unverified model", format: "opaque", provenance: "unknown",
    };
    expect(pickerArtifactMetadata(unknown)).toEqual([]);
    const imported: ModelArtifact = {
      id: "registered", displayName: "Known GGUF", format: "gguf", provenance: "user-supplied",
      quantization: "Q4_K_M", size: 5 * 1024 ** 3, declaredContext: 8192,
    };
    expect(pickerArtifactMetadata(imported)).toEqual([
      "Registered format · GGUF",
      "Registered quantization · Q4_K_M",
      "Registered size · 5.0 GiB",
      "Declared context · 8,192 tokens",
    ]);
    expect(pickerArtifactMetadata({ ...imported, provenance: "runtime-inventory", quantization: undefined }))
      .toContain("Runtime-reported size · 5.0 GiB");
    expect(pickerArtifactMetadata({ ...imported, size: 0, declaredContext: undefined }))
      .not.toContain("Registered size · 0.0 MiB");
  });

  it("groups two exact deployments under one shared artifact and keeps distinct accessible identities", () => {
    const endpointId = "one-artifact-two-deployments";
    const base: SelfHostedState = {
      version: 1, revision: 0, profiles: [],
      endpoints: [createSelfHostedEndpoint({
        alias: "Same PC", baseURL: "http://127.0.0.1:11434/", backendHint: "ollama",
      }, endpointId, 1)],
    };
    const withModels = saveSelfHostedModel(
      saveSelfHostedModel(base, endpointId, "tag-a:latest", "Same visible label"),
      endpointId, "tag-b:latest", "Same visible label",
    );
    const digest = `sha256:${"c".repeat(64)}`;
    const state: SelfHostedState = {
      ...withModels,
      profiles: withModels.profiles.map(profile => ({ ...profile, modelRevision: digest })),
    };
    const choices = savedSelfHostedModelInfos(state);
    expect(choices).toHaveLength(2);
    const groups = groupFabricPickerModels(choices, state);
    expect(groups.otherModels).toEqual([]);
    const host = groups.hostGroups[0];
    const runtime = host.runtimes[0];
    expect(host.runtimes).toHaveLength(1);
    expect(runtime.artifacts).toHaveLength(1);
    const { artifact, deployments } = runtime.artifacts[0];
    expect(artifact.id).toBe(JSON.stringify(["digest", digest]));
    expect(artifact.format).toBe("ollama-manifest");
    expect(pickerArtifactMetadata(artifact)).toEqual(["Recorded format · Ollama manifest"]);
    expect(deployments.map(row => row.deployment.runtimeModelName))
      .toEqual(["tag-a:latest", "tag-b:latest"]);
    expect(deployments.map(row => row.model.id)).toEqual(choices.map(model => model.id));
    const labels = deployments.map((row, index) => pickerDeploymentAccessibleLabel(
      row.model, "Same-PC address: http://127.0.0.1:11434", host, runtime,
      artifact, row.deployment, index + 1, deployments.length,
    ));
    expect(labels[0]).toContain("Deployment 1 of 2: tag-a:latest");
    expect(labels[1]).toContain("Deployment 2 of 2: tag-b:latest");
    expect(labels[0]).not.toBe(labels[1]);
    expect(labels.every(label => label.includes(digest))).toBe(true);
  });

  it("keeps a saved disabled profile grouped for display, never recovers a deleted or stale route", () => {
    const endpointId = "disabled-display-only";
    const base: SelfHostedState = {
      version: 1, revision: 0, profiles: [],
      endpoints: [createSelfHostedEndpoint({
        alias: "Offline workstation", baseURL: "http://192.0.2.20:11434/", backendHint: "ollama",
      }, endpointId, 1)],
    };
    const saved = saveSelfHostedModel(base, endpointId, "known:latest", "Known model");
    const model = savedSelfHostedModelInfos(saved)[0];
    const disabled: SelfHostedState = {
      ...saved, endpoints: saved.endpoints.map(endpoint => ({ ...endpoint, enabled: false })),
    };
    const view = groupFabricPickerModels([model], disabled);
    expect(view.otherModels).toEqual([]);
    expect(runtimeModels(view.hostGroups[0].runtimes[0]).map(row => row.id)).toEqual([model.id]);
    expect(modelPickerHostAvailability(model.id, disabled)).toEqual({
      label: "Disabled in Settings", disabled: true,
    });
    const deleted: SelfHostedState = {
      ...disabled, endpoints: disabled.endpoints.map(endpoint => ({ ...endpoint, deletedAt: 42 })),
    };
    expect(groupFabricPickerModels([model], deleted).otherModels).toEqual([model]);
    const stale: SelfHostedState = {
      ...disabled, profiles: disabled.profiles.map(profile => ({ ...profile, transportModelId: "different:latest" })),
    };
    expect(groupFabricPickerModels([model], stale).otherModels).toEqual([model]);
  });

  it("groups inventoried-only disabled deployments only with the exact current configuration", () => {
    const endpointId = "disabled-inventoried-only";
    const base: SelfHostedState = {
      version: 1, revision: 0, profiles: [],
      endpoints: [createSelfHostedEndpoint({
        alias: "Inventory host", baseURL: "http://192.0.2.40:11434/", backendHint: "ollama",
      }, endpointId, 1)],
    };
    const prepared = ensureSelfHostedProfile(base, endpointId, "reported:latest").state;
    expect(prepared.profiles[0].saved).toBeUndefined();
    const disabled: SelfHostedState = {
      ...prepared,
      endpoints: prepared.endpoints.map(endpoint => ({ ...endpoint, enabled: false })),
      inventories: [{
        endpointId,
        configurationRevision: prepared.endpoints[0].configurationRevision,
        observedAt: Date.now(),
        connected: false,
        backend: "ollama",
        models: [{ id: "reported:latest", name: "Reported model", chat: "unknown" }],
      }],
    };
    const choices = savedSelfHostedModelInfos(disabled);
    expect(choices).toHaveLength(1);
    const grouped = groupFabricPickerModels(choices, disabled);
    expect(grouped.otherModels).toEqual([]);
    expect(runtimeModels(grouped.hostGroups[0].runtimes[0]).map(row => row.id))
      .toEqual(choices.map(row => row.id));
    expect(modelPickerHostAvailability(choices[0].id, disabled)).toEqual({
      label: "Disabled in Settings", disabled: true,
    });
    const stale: SelfHostedState = {
      ...disabled,
      inventories: disabled.inventories!.map(inventory => ({
        ...inventory, configurationRevision: inventory.configurationRevision + 1,
      })),
    };
    expect(groupFabricPickerModels(choices, stale).otherModels).toEqual(choices);
  });

  it("skips disabled menu rows when entering from search via ArrowDown", () => {
    const item = { focus: vi.fn() };
    const querySelector = vi.fn(() => item);
    const menu = { querySelector } as unknown as ParentNode;
    expect(firstEnabledPickerMenuItem(menu)).toBe(item);
    expect(querySelector).toHaveBeenCalledWith(
      '[role="menuitem"]:not([data-disabled]):not([aria-disabled="true"])',
    );
    expect(firstEnabledPickerMenuItem(null)).toBeNull();
  });

  it("groups the migrated ollama-local model under This PC instead of leaving it unbound", () => {
    const state = migrateSelfHostedProfiles(null, new Map<string, unknown>([
      ["ollamaModelId", "legacy:latest"],
    ]), 1);
    const groups = groupFabricPickerModels([resolveModel("ollama-local")], state);
    expect(groups.otherModels).toHaveLength(0);
    expect(groups.hostGroups).toHaveLength(1);
    expect(groups.hostGroups[0]).toMatchObject({
      hostId: "legacy:ollama",
      alias: "This PC",
      runtimes: [{ runtimeId: "runtime:legacy:ollama", label: "Ollama" }],
    });
    expect(runtimeModels(groups.hostGroups[0].runtimes[0])[0].id).toBe("ollama-local");
  });
  it("groups identically named Ollama models under distinct host IDs without dropping cloud models", () => {
    const hosts: SelfHostedState = {
      version: 1,
      revision: 0,
      endpoints: [
        createSelfHostedEndpoint({
          alias: "This PC",
          baseURL: "http://127.0.0.1:11434/",
          backendHint: "ollama",
          allowPrivateNetwork: true,
        }, "ollama-local-pick", 1),
        createSelfHostedEndpoint({
          alias: "Workstation",
          baseURL: "http://192.0.2.20:11434/",
          backendHint: "ollama",
          allowPrivateNetwork: true,
        }, "ollama-remote-pick", 1),
      ],
      profiles: [],
    };
    const once = saveSelfHostedModel(hosts, "ollama-local-pick", "duplicate:7b", "Same name");
    const twice = saveSelfHostedModel(once, "ollama-remote-pick", "duplicate:7b", "Same name");
    const saved = savedSelfHostedModelInfos(twice);
    expect(saved).toHaveLength(2);
    const cloud = { ...saved[0], id: "cloud-record", label: "Cloud", provider: "openai" as const };
    const groups = groupFabricPickerModels([cloud, saved[1], saved[0]], twice);
    expect(groups.otherModels).toEqual([cloud]);
    expect(groups.hostGroups.map(group => [group.hostId, group.alias, group.runtimes[0].address])).toEqual([
      ["ollama-remote-pick", "Workstation", "http://192.0.2.20:11434/"],
      ["ollama-local-pick", "This PC", "http://127.0.0.1:11434/"],
    ]);
    expect(groups.hostGroups.flatMap(group => group.runtimes.flatMap(runtime => runtimeModels(runtime).map(model => model.label))))
      .toEqual(["Same name", "Same name"]);
    expect(runtimeModels(groups.hostGroups[0].runtimes[0])[0].id).not.toBe(runtimeModels(groups.hostGroups[1].runtimes[0])[0].id);
  });

  it("groups multiple runtimes under the same physical host using deployment ownership", () => {
    const localId = "picker-multi-host";
    const studioId = "picker-multi-studio";
    const base: SelfHostedState = {
      version: 1,
      revision: 0,
      endpoints: [
        createSelfHostedEndpoint({ alias: "Shared workstation", baseURL: "http://127.0.0.1:11434/", backendHint: "ollama" }, localId, 1),
        createSelfHostedEndpoint({ alias: "Studio process", baseURL: "http://127.0.0.1:1234/", backendHint: "lmstudio" }, studioId, 1),
      ],
      profiles: [],
    };
    const saved = withLocalComputeFabric(saveSelfHostedModel(
      saveSelfHostedModel(base, localId, "same:latest", "Shared label"), studioId, "same:latest", "Shared label",
    ));
    const combined: SelfHostedState = {
      ...saved,
      fabric: {
        ...saved.fabric!,
        runtimes: saved.fabric!.runtimes.map(runtime => runtime.legacyEndpointId === studioId
          ? { ...runtime, hostId: localId } : runtime),
      },
    };
    const groups = groupFabricPickerModels(savedSelfHostedModelInfos(combined), combined);
    expect(groups.otherModels).toHaveLength(0);
    expect(groups.hostGroups).toHaveLength(1);
    expect(groups.hostGroups[0]).toMatchObject({
      hostId: localId,
      alias: "Shared workstation",
      runtimes: [
        { runtimeId: `runtime:${localId}`, label: "Ollama" },
        { runtimeId: `runtime:${studioId}`, label: "Studio process" },
      ],
    });
    expect(groups.hostGroups[0].runtimes.map(runtime => runtimeModels(runtime)[0].id))
      .toEqual(savedSelfHostedModelInfos(combined).map(model => model.id));
    expect(new Set(groups.hostGroups[0].runtimes.map(runtime => runtimeModels(runtime)[0].id)).size).toBe(2);
  });

  it("keeps remote SSH Ollama and other self-hosted backends grouped without exposing synthetic URLs", () => {
    const remoteId = "picker-ssh";
    const vllmId = "picker-vllm";
    const state: SelfHostedState = {
      version: 1,
      revision: 0,
      endpoints: [
        createSelfHostedEndpoint({
          alias: "Remote GPU",
          baseURL: remoteSshUrl(remoteId),
          backendHint: "ollama",
          allowPrivateNetwork: true,
          ssh: { host: "gpu.example.test", username: "operator", port: 22,
            keyPath: null, remoteHost: "127.0.0.1", remotePort: 11434 },
        }, remoteId, 1),
        createSelfHostedEndpoint({ alias: "vLLM server", baseURL: "https://vllm.example.test/", backendHint: "vllm" }, vllmId, 1),
      ],
      profiles: [],
    };
    const saved = saveSelfHostedModel(saveSelfHostedModel(state, remoteId, "shared:1"), vllmId, "shared:1");
    const models = savedSelfHostedModelInfos(saved);
    const groups = groupFabricPickerModels([resolveModel("gpt-5.4-mini"), ...models], saved);
    expect(groups.otherModels.map(model => model.id)).toEqual(["gpt-5.4-mini"]);
    expect(groups.hostGroups.map(host => [host.alias, host.location, host.runtimes[0].label]))
      .toEqual([["Remote GPU", "remote", "Ollama"], ["vLLM server", "remote", "vLLM server"]]);
    expect(groups.hostGroups[0].runtimes[0].address).toBe("Managed SSH connection");
    expect(groups.hostGroups.flatMap(host => host.runtimes.flatMap(runtime => runtimeModels(runtime).map(model => model.id))))
      .toEqual(models.map(model => model.id));
    expect(modelPickerHostAvailability(models[0].id, saved)).toEqual({ label: "Offline / reconnect", disabled: false });
  });

  it("does not fabricate selectable models from an uninstalled conceptual runtime", () => {
    const endpointId = "picker-conceptual";
    const base: SelfHostedState = { version: 1, revision: 0, endpoints: [
      createSelfHostedEndpoint({ alias: "This PC", baseURL: "http://127.0.0.1:11434/", backendHint: "ollama" }, endpointId, 1),
    ], profiles: [] };
    const saved = withLocalComputeFabric(saveSelfHostedModel(base, endpointId, "real:latest"));
    const host = reconcileLocalComputeFabric(saved).hosts[0];
    const runtime: LocalRuntime = { id: "uninstalled-managed-runtime", hostId: host.id,
      type: "clack-llama-cpp", displayName: "Managed Runtime", enabled: false,
      health: "unknown", configurationRevision: 1, capabilities: {} };
    const artifact: ModelArtifact = { id: "gguf-file", displayName: "future.gguf", format: "gguf", provenance: "user-supplied" };
    const deployment: ModelDeployment = { id: "conceptual-only", hostId: host.id, runtimeId: runtime.id,
      artifactId: artifact.id, runtimeModelName: "future.gguf", configurationRevision: 1 };
    const expanded = addConceptualRuntime(saved, runtime, host, artifact, deployment);
    expect(reconcileLocalComputeFabric(expanded).deployments).toContainEqual(deployment);
    const models = savedSelfHostedModelInfos(expanded);
    const groups = groupFabricPickerModels(models, expanded);
    expect(groups.hostGroups[0].runtimes).toHaveLength(1);
    expect(runtimeModels(groups.hostGroups[0].runtimes[0]).map(model => model.id)).toEqual(models.map(model => model.id));
    expect(runtimeModels(groups.hostGroups[0].runtimes[0]).some(model => model.label === "future.gguf")).toBe(false);
  });

  it("renders exactly registered managed GGUF deployments under This PC → Clack Managed alongside Ollama", () => {
    const ollamaId = "picker-managed-ollama";
    const base: SelfHostedState = { version: 1, revision: 0, endpoints: [
      createSelfHostedEndpoint({ alias: "This PC", baseURL: "http://127.0.0.1:11434/", backendHint: "ollama" }, ollamaId, 1),
    ], profiles: [] };
    const ollama = saveSelfHostedModel(base, ollamaId, "duplicate:latest", "Shared display name");
    const material = { version: 1 as const, context: 8192, gpu: 0 as const, tool: false as const, grammar: false as const };
    const first = attachManagedLocalGguf(ollama, {
      digest: `sha256:${"a".repeat(64)}`,
      displayName: "Shared display name", material,
    });
    const second = attachManagedLocalGguf(first.state, {
      digest: `sha256:${"b".repeat(64)}`,
      displayName: "Shared display name", material,
    });
    const managed = savedManagedLocalModelInfos(second.state);
    expect(managed).toHaveLength(2);
    const groups = groupFabricPickerModels([...savedSelfHostedModelInfos(second.state), ...managed], second.state);
    expect(groups.otherModels).toHaveLength(0);
    expect(groups.hostGroups).toHaveLength(2);
    expect(groups.hostGroups.find(host => host.hostId === "clack-this-pc")).toMatchObject({
      alias: "This PC", location: "local", runtimes: [{
        runtimeId: "clack-managed-llama.cpp", label: "Clack Managed",
        address: "Registered local runtime",
      }],
    });
    const managedModels = runtimeModels(groups.hostGroups.find(host => host.hostId === "clack-this-pc")!.runtimes[0]);
    expect(managedModels.map(model => model.id)).toEqual([first.selectionId, second.selectionId]);
    expect(managedModels.map(model => model.label)).toEqual(["Shared display name", "Shared display name"]);
    expect(new Set(managedModels.map(model => model.id)).size).toBe(2);
    expect(runtimeModels(groups.hostGroups.find(host => host.hostId === ollamaId)!.runtimes[0]))
      .toHaveLength(1);
  });

  it("requires fresh exact native Ready evidence before enabling managed GGUF Chat selection", () => {
    const prepared = attachManagedLocalGguf({ version: 1, revision: 0, endpoints: [], profiles: [] }, {
      digest: `sha256:${"c".repeat(64)}`, material: {
        version: 1, context: 4096, gpu: 0, tool: false, grammar: false,
      },
    });
    const selected = prepared.selectionId;
    const state = prepared.state;
    const deployment = state.fabric!.deployments.find(row => !row.profileId)!;
    const digest = `sha256:${"c".repeat(64)}`;
    const ready = { installed: true, state: "Ready", epoch: "runtime-process-1",
      deploymentId: deployment.id, modelDigest: digest };
    expect(modelPickerHostAvailability(selected, state)).toEqual({
      label: "Registered · runtime status unknown", disabled: true,
    });
    expect(modelPickerHostAvailability(selected, state, { ...ready, installed: false }))
      .toEqual({ label: "Registered · not installed", disabled: true });
    expect(modelPickerHostAvailability(selected, state, { ...ready, state: "Stopped" }))
      .toEqual({ label: "Registered · stopped", disabled: true });
    expect(modelPickerHostAvailability(selected, state, { ...ready, state: "Loading" }))
      .toEqual({ label: "Registered · loading", disabled: true });
    expect(modelPickerHostAvailability(selected, state, { ...ready, state: "Failed" }))
      .toEqual({ label: "Registered · failed", disabled: true });
    expect(modelPickerHostAvailability(selected, state, { ...ready, deploymentId: "other-deployment" })?.disabled).toBe(true);
    expect(modelPickerHostAvailability(selected, state, { ...ready, modelDigest: `sha256:${"d".repeat(64)}` })?.disabled).toBe(true);
    expect(modelPickerHostAvailability(selected, state, { ...ready, epoch: null })?.disabled).toBe(true);
    expect(modelPickerHostAvailability(selected, state, ready))
      .toEqual({ label: "Ready · Chat only", disabled: false });
    const invalidated: SelfHostedState = { ...state, fabric: { ...state.fabric!,
      deployments: state.fabric!.deployments.map(row => ({ ...row, configurationRevision: row.configurationRevision + 1 })),
    } };
    expect(modelPickerHostAvailability(selected, invalidated, ready)?.disabled).toBe(true);
  });

  it("labels a disabled Ollama host without allowing an offline reconnect bypass", () => {
    const base: SelfHostedState = {
      version: 1,
      revision: 0,
      endpoints: [{
        ...createSelfHostedEndpoint({
          alias: "My PC",
          baseURL: "http://127.0.0.1:11434/",
          backendHint: "ollama",
          allowPrivateNetwork: true,
        }, "picker-disabled-ollama", 1),
        enabled: false,
      }],
      profiles: [],
    };
    const saved = saveSelfHostedModel(base, "picker-disabled-ollama", "test-model:latest");
    const selectionId = selfHostedSelectionId(saved.profiles[0]);
    expect(modelPickerHostAvailability(selectionId, saved)).toEqual({
      label: "Disabled in Settings",
      disabled: true,
    });
    expect(modelPickerHostAvailability("gpt-5.4-mini", saved)).toBeUndefined();
  });

  it("renders an exact catalog-backed saved selection without discarding its routing evidence", () => {
    const preferences = usePreferencesStore.getState();
    const model = createSavedProviderModel({ providerId: "openrouter", transportModelId: minimaxFreeCatalogRecord.id,
      providerEvidence: parseProviderContextCatalog({ data: [minimaxFreeCatalogRecord] }).get(minimaxFreeCatalogRecord.id),
    }, "minimax-picker");
    const selection = savedProviderModelSelectionId(model.id);
    try {
      usePreferencesStore.setState({ savedProviderModels: [model] });
      useChatStore.setState(state => ({ sessions: state.sessions.map(s => s.id === "chat-a" && s.profile ? { ...s, profile: { ...s.profile, modelId: selection } } : s) }));
      const html = renderToStaticMarkup(<ModelDropdown sessionId="chat-a" />);
      expect(html).toContain('aria-label="Change model: minimax/minimax-m3:free.');
      expect(html).not.toContain('disabled=""');
      const route = resolveModelTransportIdentity(selection, usePreferencesStore.getState());
      expect(route.providerEvidence).toEqual(model.providerEvidence);
      expect(route.transportModelId).toBe(minimaxFreeCatalogRecord.id);
    } finally {
      usePreferencesStore.setState(preferences);
    }
  });
  it("leaves an idle pane editable while another pane runs", () => {
    setRun("running");
    const html = renderToStaticMarkup(
      <ModelDropdown sessionId="chat-b" compact />,
    );
    expect(html).not.toContain('disabled=""');
  });

  it("uses the newly active chat's lock for the bottom picker", () => {
    setRun("running");
    useChatStore.setState({ activeSessionId: "chat-b" });
    const html = renderToStaticMarkup(<ModelDropdown />);
    expect(html).not.toContain('disabled=""');
  });

  it("blocks a deleted explicit chat instead of changing the global default", () => {
    const html = renderToStaticMarkup(
      <ModelDropdown sessionId="deleted-chat" />,
    );
    expect(html).toContain('disabled=""');
  });

  it("leaves the no-chat default editable", () => {
    useChatStore.setState({ activeSessionId: null });
    const html = renderToStaticMarkup(<ModelDropdown />);
    expect(html).not.toContain('disabled=""');
  });
});
