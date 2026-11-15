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

import { ModelDropdown, groupOllamaPickerModels, modelPickerHostAvailability } from "@/modules/ai/components/AiStatusBarControls";
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
    const groups = groupOllamaPickerModels([resolveModel("ollama-local")], state);
    expect(groups.otherModels).toHaveLength(0);
    expect(groups.hostGroups).toHaveLength(1);
    expect(groups.hostGroups[0]).toMatchObject({
      endpointId: "legacy:ollama",
      alias: "This PC",
    });
    expect(groups.hostGroups[0].models[0].id).toBe("ollama-local");
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
    const groups = groupOllamaPickerModels([cloud, saved[1], saved[0]], twice);
    expect(groups.otherModels).toEqual([cloud]);
    expect(groups.hostGroups.map(group => [group.endpointId, group.alias, group.address])).toEqual([
      ["ollama-remote-pick", "Workstation", "http://192.0.2.20:11434/"],
      ["ollama-local-pick", "This PC", "http://127.0.0.1:11434/"],
    ]);
    expect(groups.hostGroups.flatMap(group => group.models.map(model => model.label)))
      .toEqual(["Same name", "Same name"]);
    expect(groups.hostGroups[0].models[0].id).not.toBe(groups.hostGroups[1].models[0].id);
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
