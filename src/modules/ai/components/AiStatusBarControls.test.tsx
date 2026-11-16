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

import { ModelDropdown, groupFabricPickerModels, modelPickerHostAvailability } from "@/modules/ai/components/AiStatusBarControls";
import { ModelSwitchNotice } from "./ModelSwitchNotice";
import { AI_CHAT_TOOLTIP, AiChatButton } from "./AiChatButton";
import type { SessionRunState } from "@/modules/ai/lib/sessions";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { createSavedProviderModel, resolveModelTransportIdentity, savedProviderModelSelectionId } from "@/modules/ai/lib/savedProviderModels";
import { parseProviderContextCatalog } from "@/modules/ai/lib/providerModelEvidence";
import { minimaxFreeCatalogRecord } from "@/modules/ai/lib/openrouterCatalog.fixture";
import { createSelfHostedEndpoint, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { saveSelfHostedModel, savedSelfHostedModelInfos, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { migrateSelfHostedProfiles } from "@/modules/ai/lib/selfHostedMigration";
import { resolveModel } from "@/modules/ai/config";
import { addConceptualRuntime, reconcileLocalComputeFabric, withLocalComputeFabric, type LocalRuntime, type ModelArtifact, type ModelDeployment } from "@/modules/ai/lib/localComputeFabric";
import { remoteSshUrl } from "@/modules/ai/lib/remoteSsh";
import { attachManagedLocalGguf, savedManagedLocalModelInfos } from "@/modules/ai/lib/managedLocalModels";

const original = useChatStore.getState();

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
    expect(groups.hostGroups[0].runtimes[0].models[0].id).toBe("ollama-local");
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
    expect(groups.hostGroups.flatMap(group => group.runtimes.flatMap(runtime => runtime.models.map(model => model.label))))
      .toEqual(["Same name", "Same name"]);
    expect(groups.hostGroups[0].runtimes[0].models[0].id).not.toBe(groups.hostGroups[1].runtimes[0].models[0].id);
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
    expect(groups.hostGroups[0].runtimes.map(runtime => runtime.models[0].id))
      .toEqual(savedSelfHostedModelInfos(combined).map(model => model.id));
    expect(new Set(groups.hostGroups[0].runtimes.map(runtime => runtime.models[0].id)).size).toBe(2);
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
    expect(groups.hostGroups.flatMap(host => host.runtimes.flatMap(runtime => runtime.models.map(model => model.id))))
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
    expect(groups.hostGroups[0].runtimes[0].models.map(model => model.id)).toEqual(models.map(model => model.id));
    expect(groups.hostGroups[0].runtimes[0].models.some(model => model.label === "future.gguf")).toBe(false);
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
    const managedModels = groups.hostGroups.find(host => host.hostId === "clack-this-pc")!.runtimes[0].models;
    expect(managedModels.map(model => model.id)).toEqual([first.selectionId, second.selectionId]);
    expect(managedModels.map(model => model.label)).toEqual(["Shared display name", "Shared display name"]);
    expect(new Set(managedModels.map(model => model.id)).size).toBe(2);
    expect(groups.hostGroups.find(host => host.hostId === ollamaId)!.runtimes[0].models)
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
