import type { ReactNode, AriaAttributes } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelDropdown } from "@/modules/ai/components/AiStatusBarControls";
import { chats, useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  emptySelfHostedState,
  ensureSelfHostedProfile,
  readSelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  saveSelfHostedModel,
  savedSelfHostedModelInfos,
  selfHostedSelectionId,
  selfHostedTransportIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import {
  createSelfHostedProbeClient,
  type ProbeSnapshot,
} from "@/modules/ai/lib/selfHostedProbe";
import { retainServerInventory } from "@/modules/ai/lib/selfHostedSetup";
import { selfHostedHealth } from "@/modules/ai/lib/selfHostedHealth";
import { selfHostedCapabilities } from "@/modules/ai/lib/selfHostedCapabilities";
import { effectiveFallback } from "@/modules/ai/lib/inferenceFallback";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";
import { ModelOnboardingDetails } from "@/settings/components/ModelOnboardingDetails";

vi.mock("@/modules/ai/store/chatStore", async (original) => {
  const actual =
    await original<typeof import("@/modules/ai/store/chatStore")>();
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
vi.mock("@/modules/settings/preferences", async (original) => {
  const actual =
    await original<typeof import("@/modules/settings/preferences")>();
  return {
    ...actual,
    usePreferencesStore: Object.assign(
      <T,>(
        selector: (
          state: ReturnType<typeof actual.usePreferencesStore.getState>,
        ) => T,
      ) => selector(actual.usePreferencesStore.getState()),
      actual.usePreferencesStore,
    ),
  };
});
// Render the real picker inventory without Radix's closed portal, not native UI interaction.
vi.mock("@/components/ui/dropdown-menu", () => {
  const container = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    DropdownMenu: container,
    DropdownMenuContent: container,
    DropdownMenuTrigger: container,
    DropdownMenuItem: ({
      children,
      "aria-label": label,
      "aria-current": current,
    }: {
      children?: ReactNode;
      "aria-label"?: string;
      "aria-current"?: AriaAttributes["aria-current"];
    }) => (
      <div role="menuitem" tabIndex={-1} aria-label={label} aria-current={current}>
        {children}
      </div>
    ),
  };
});

const originalChat = useChatStore.getState(),
  originalPreferences = usePreferencesStore.getState();
const endpoint = createSelfHostedEndpoint(
  {
    alias: "Development PC",
    baseURL: "http://localhost:11435",
    backendHint: "ollama",
    allowPrivateNetwork: true,
  },
  "server-a",
);
const inventory = (
  ids = ["discovered-alpha", "discovered-beta"],
): ProbeSnapshot => ({
  endpointId: endpoint.id,
  configurationRevision: endpoint.configurationRevision,
  selectedModelId: null,
  observedAt: Date.now(),
  connected: true,
  reachable: true,
  credentialUsed: false,
  stale: false,
  refreshing: false,
  inventoryTtlMs: 300000,
  instanceTtlMs: 30000,
  models: ids.map((id) => ({ id, name: null, chat: "unknown", evidence: [] })),
  errors: [],
});
const fresh = () => addSelfHostedEndpoint(emptySelfHostedState(), endpoint);
const saveInventory = (snapshot: ProbeSnapshot, state = fresh()) =>
  snapshot.models.reduce(
    (next, model) => saveSelfHostedModel(next, snapshot.endpointId, model.id),
    state,
  );
function picker(state = fresh(), selected?: string) {
  usePreferencesStore.setState({ selfHostedInference: state });
  if (selected)
    useChatStore.setState((s) => ({
      sessions: s.sessions.map((session) =>
        session.profile
          ? { ...session, profile: { ...session.profile, modelId: selected } }
          : session,
      ),
    }));
  return renderToStaticMarkup(<ModelDropdown sessionId="chat-a" />);
}
beforeEach(() => {
  chats.clear();
  usePreferencesStore.setState({
    ...originalPreferences,
    customEndpoints: [],
    savedProviderModels: [],
    selfHostedInference: fresh(),
  });
  useChatStore.setState({
    ...originalChat,
    activeSessionId: "chat-a",
    selectedModelId: "gpt-5.4-mini",
    apiKeys: { ...originalChat.apiKeys, openai: "fixture-only-no-network" },
    sessions: [
      {
        id: "chat-a",
        title: "Chat",
        createdAt: 1,
        updatedAt: 1,
        profile: {
          agentId: "builtin:coder",
          modelId: "gpt-5.4-mini",
          workspaceRoot: null,
          workspaceId: null,
        },
      },
    ],
  });
});
afterEach(() => {
  chats.clear();
  usePreferencesStore.setState(originalPreferences);
  useChatStore.setState(originalChat);
  vi.restoreAllMocks();
});

describe("discovery-to-normal-picker persistence boundaries", () => {
  it("renders normal Automatic settings and truthful advanced details for an unsaved discovered model", () => {
    const state = saveInventory(inventory());
    usePreferencesStore.setState({ selfHostedInference: state });
    const html = renderToStaticMarkup(<ModelOnboardingDetails state={state} profile={state.profiles[0]} />);
    expect(html).toContain("Automatic (4,096 tokens)");
    expect(html).toContain("Automatic (Recommended)");
    expect(html).toContain("Advertised maximum");
    expect(html).toContain("Verified practical context");
    expect(html).toContain("Advanced model settings");
    expect(html).not.toContain("Tools verified");
    expect(html).not.toContain('value="32768"');
    expect(picker(state)).toContain("Unverified");
  });
  it.runIf(process.env.CLACK_ONBOARDING_LIVE === "1")("uses the same four live metadata profiles in Settings and the normal picker", () => {
    const evidence = JSON.parse(readFileSync("src-tauri/target/onboarding/live.json", "utf8"));
    const state = readSelfHostedState(evidence.state);
    vi.spyOn(Date, "now").mockReturnValue(Math.max(...state.profiles.flatMap(p => p.evidence.map(e => e.observedAt ?? 0))) + 1);
    const html = picker(state);
    const profiles = state.profiles.filter(p => p.evidence.some(e => e.metric === "probe.runtimeContext"));
    expect(profiles).toHaveLength(4);
    const views = profiles.flatMap(p => { const view = modelOnboarding(state, p); return view ? [view] : []; });
    expect(views).toHaveLength(4);
    for (const [index, profile] of profiles.entries()) {
      expect(html).toContain(profile.transportModelId);
      expect(views[index].context.recommended).toBe(4096);
      expect(views[index].context.verified).toBeUndefined();
      expect(views[index].status).toBe("Unverified");
      expect(views[index].tools).toBe("Advertised / unverified");
      const details = renderToStaticMarkup(<ModelOnboardingDetails state={state} profile={profile} />);
      expect(details).toContain("Automatic (4,096 tokens)");
      expect(details).toContain("Advertised / unverified");
      expect(details).toContain("Verified practical context");
    }
    expect(views.map(v => v.reasoning.recommended).sort()).toEqual(["High", "None", "On", "On"]);
    expect(views.map(v => v.reasoning.wire)).toEqual(["omit", "omit", "omit", "omit"]);
    expect(evidence.inference).toBe(0);
    expect(evidence.cloudInference).toBe(0);
    writeFileSync("src-tauri/target/onboarding/live-ui.json", JSON.stringify({ views, html, inference: 0 }, null, 2));
  });
  it("retains the current-selection marker for legacy chat bindings without rewriting them", () => {
    const state = saveInventory(inventory(["shared-model"]));
    const legacy = selfHostedSelectionId(state.profiles[0]);
    state.profiles[0].modelRevision = "observed-revision";
    state.profiles[0].backend = "ollama";
    const html = picker(state, legacy);
    expect(html).toContain('aria-label="shared-model. Same-PC address: http://localhost:11435" aria-current="true"');
    expect(useChatStore.getState().sessions[0].profile?.modelId).toBe(legacy);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });
  it.runIf(process.env.CLACK_DISCOVERY_LIVE === "1")("publishes the real native discovery commit into the normal picker without per-model saves or inference", () => {
    const evidence = JSON.parse(readFileSync("src-tauri/target/discovery-integration/live.json", "utf8"));
    const state = readSelfHostedState(evidence.state);
    const models = savedSelfHostedModelInfos(state);
    expect(state.endpoints).toHaveLength(1);
    expect(state.profiles.every(p => !p.saved)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models).toHaveLength(evidence.snapshot.models.length);
    const html = picker(state);
    for (const model of models) {
      expect(html).toContain(model.label);
      expect(selfHostedTransportIdentity(model.id, state)).toMatchObject({ providerId: "ollama",
        endpointBaseURL: "http://127.0.0.1:11435/v1", selfHosted: { endpointId: "endpoint-a" } });
    }
    expect(html).toContain('aria-label="GPT-5.4 mini. Cloud connection"');
    expect(evidence.inference).toBe(0);
    writeFileSync("src-tauri/target/discovery-integration/live-picker.json", JSON.stringify({
      count: models.length, ids: models.map(m => m.id), html, inference: 0, perModelSaves: 0,
    }, null, 2));
  });
  it("an uncommitted probe payload or detail profile alone is not a second picker store", async () => {
    const snapshot = inventory();
    const call = vi.fn().mockResolvedValue(snapshot);
    expect(
      (
        await createSelfHostedProbeClient(call).refresh({
          endpointId: endpoint.id,
          allowPrivateNetwork: true,
        })
      ).models,
    ).toHaveLength(2);
    const unsaved = ensureSelfHostedProfile(
      fresh(),
      endpoint.id,
      snapshot.models[0].id,
    ).state;
    expect(savedSelfHostedModelInfos(unsaved)).toEqual([]);
    const html = picker(unsaved);
    expect(html).not.toContain("discovered-alpha");
    expect(html).not.toContain("discovered-beta");
  });
  it("selected inventory rows from one server become multiple real picker rows alongside cloud models, without typed model IDs", () => {
    const state = saveInventory(inventory());
    expect(state.endpoints).toHaveLength(1);
    const html = picker(state);
    expect(html).toContain(
      'aria-label="discovered-alpha. Same-PC address: http://localhost:11435"',
    );
    expect(html).toContain(
      'aria-label="discovered-beta. Same-PC address: http://localhost:11435"',
    );
    expect(html).toContain('aria-label="GPT-5.4 mini. Cloud connection"');
    expect(html).toContain("Development PC");
  });
  it("duplicate tags on distinct servers retain independent picker destinations and per-chat routes", () => {
    let state = saveInventory(inventory(["shared-model"]));
    state = addSelfHostedEndpoint(
      state,
      createSelfHostedEndpoint(
        {
          alias: "Second PC",
          baseURL: "https://second.example",
          backendHint: "ollama",
        },
        "server-b",
      ),
    );
    state = saveSelfHostedModel(state, "server-b", "shared-model");
    const choices = savedSelfHostedModelInfos(state);
    expect(new Set(choices.map((m) => m.id)).size).toBe(2);
    const html = picker(state, choices[1].id);
    expect(html).toContain("http://localhost:11435");
    expect(html).toContain("https://second.example");
    const binding = useChatStore.getState().sessions[0].profile?.modelId ?? "";
    expect(binding).toBe(choices[1].id);
    expect(
      selfHostedTransportIdentity(binding, readSelfHostedState(state)),
    ).toMatchObject({
      providerId: "ollama",
      transportModelId: "shared-model",
      endpointBaseURL: "https://second.example/v1",
      selfHosted: { endpointId: "server-b" },
    });
  });
  it("an uncommitted mock refresh cannot mutate the durable registry", async () => {
    const state = saveInventory(inventory());
    const refreshed = inventory([
      "discovered-alpha",
      "discovered-beta",
      "newly-installed",
    ]);
    const snapshot = await createSelfHostedProbeClient(
      vi.fn().mockResolvedValue(refreshed),
    ).refresh({ endpointId: endpoint.id });
    expect(snapshot.models).toHaveLength(3);
    expect(picker(state)).not.toContain("newly-installed");
    const next = saveSelfHostedModel(state, endpoint.id, snapshot.models[2].id);
    expect(next.endpoints).toEqual(state.endpoints);
    expect(picker(next)).toContain("newly-installed");
  });
  it("removed remote models retain historical identity and report unavailable health", () => {
    const state = saveInventory(inventory());
    const selection = selfHostedSelectionId(state.profiles[1]);
    const refreshed = inventory(["discovered-alpha"]);
    expect(refreshed.models.some((m) => m.id === "discovered-beta")).toBe(
      false,
    );
    const html = picker(state, selection);
    expect(html).toContain("discovered-beta");
    expect(useChatStore.getState().sessions[0].profile?.modelId).toBe(
      selection,
    );
    expect(
      selfHostedHealth({
        endpoint,
        profile: state.profiles[1],
        snapshot: refreshed,
      }).label,
    ).toBe("Unavailable");
    expect(
      selfHostedTransportIdentity(selection, state)?.transportModelId,
    ).toBe("discovered-beta");
  });
  it("offline display retention does not authorize fresh capabilities or a cloud fallback", () => {
    const state = saveInventory(inventory());
    const failed = {
      ...inventory([]),
      connected: false,
      reachable: false,
      errors: [
        {
          route: null,
          error: {
            code: "unreachable" as const,
            statusCode: null,
            reachable: false,
          },
        },
      ],
    };
    const retained = retainServerInventory(inventory(), failed);
    expect(retained.stale).toBe(true);
    expect(selfHostedHealth({ endpoint, snapshot: retained }).label).toBe(
      "Offline",
    );
    expect(
      selfHostedCapabilities(endpoint, "discovered-alpha", retained).tools,
    ).toBe("unknown");
    expect(picker(state)).toContain("discovered-alpha");
    expect(effectiveFallback(undefined)).toBeNull();
    expect(
      selfHostedTransportIdentity(
        selfHostedSelectionId(state.profiles[0]),
        state,
      )?.selfHosted?.endpointId,
    ).toBe(endpoint.id);
  });
  it("expired cached inventory remains distinct from fresh readiness and model routing", () => {
    const state = saveInventory(inventory());
    const stale = { ...inventory(), observedAt: Date.now() - 300001 };
    expect(selfHostedHealth({ endpoint, snapshot: stale }).label).toBe(
      "Unverified",
    );
    expect(
      selfHostedCapabilities(endpoint, "discovered-alpha", stale).image,
    ).toBe("unknown");
    expect(picker(state)).toContain("discovered-alpha");
    const selection = selfHostedSelectionId(state.profiles[0]);
    usePreferencesStore.setState({
      recentModelIds: [selection],
      favoriteModelIds: [selection],
    });
    expect(
      savedSelfHostedModelInfos(state).some(
        (m) => m.id === usePreferencesStore.getState().recentModelIds[0],
      ),
    ).toBe(true);
    expect(
      selfHostedTransportIdentity(selection, state)?.transportModelId,
    ).toBe("discovered-alpha");
  });
});
