import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  useChatStore,
  pendingEffortWrites,
  isModelSelectionLocked,
  chats,
} from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  sessionEffort,
  setSessionEffort,
} from "@/modules/ai/store/reasoningEffort";
import { applyCommittedModelSwitch } from "@/modules/ai/store/modelSwitchSync";
import {
  createConversationProfile,
  type SessionMeta,
} from "@/modules/ai/lib/sessions";
import { targetContextKey } from "@/modules/ai/lib/targetContext";
import { captureEffort, effortProviderOptions } from "@/modules/ai/lib/reasoningEffort";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { ollamaBody } from "@/modules/ai/lib/ollamaModel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock("@/modules/ai/lib/sessions", async (original) => ({
  ...(await original<typeof import("@/modules/ai/lib/sessions")>()),
  saveSessionsList: vi.fn().mockResolvedValue(undefined),
}));
const baseline = useChatStore.getState();
const preferences = usePreferencesStore.getState();
const session = (id: string): SessionMeta => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  profileVersion: 1,
  profile: createConversationProfile({
    agentId: "builtin:coder",
    modelId: "gpt-5.4-mini",
    workspaceRoot: null,
  }),
});
let disk: SessionMeta[];
beforeEach(() => {
  disk = [session("a"), session("b")];
  useChatStore.setState({
    sessions: structuredClone(disk),
    activeSessionId: "a",
    selectedModelId: "gpt-5.4-mini",
    live: { ...baseline.live, getWorkspaceRoot: () => null },
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "conversation_effort_set") return undefined;
    const { update: u } = args as {
      update: {
        owner: { sessionId: string };
        expectedSession: SessionMeta;
        key: string;
        choice: string;
        revision: string;
      };
    };
    const current = disk.find((s) => s.id === u.owner.sessionId);
    if (!current) throw Error("Missing fixture session");
    if (JSON.stringify(current) !== JSON.stringify(u.expectedSession))
      throw Error("reasoning_effort_stale_session");
    const next: SessionMeta = {
      ...current,
      targetContext: undefined,
      modelRevision: (current.modelRevision ?? 0) + 1,
      effortPreferences: {
        version: 1,
        choices: [
          ...(current.effortPreferences?.choices ?? []).filter(
            (e) => e.key !== u.key,
          ),
          ...(u.choice === "automatic"
            ? []
            : [{ key: u.key, choice: u.choice, revision: u.revision }]),
        ],
      },
    };
    disk = disk.map((s) => (s.id === next.id ? next : s));
    return structuredClone(next);
  });
});
afterEach(() => {
  useChatStore.setState(baseline);
  usePreferencesStore.setState(preferences);
  pendingEffortWrites.clear();
  chats.clear();
  vi.clearAllMocks();
});
describe("session-owned reasoning effort", () => {
  it.each(["none", "low", "medium", "high", "max", "automatic"])("accepts Muse %s through normal session persistence without inference", async choice => {
    const fixture = ollamaEffortFixture();
    const selection = selfHostedSelectionId(fixture.profile);
    disk[0].profile = createConversationProfile({ agentId: "builtin:coder", modelId: selection, workspaceRoot: null });
    useChatStore.setState({ sessions: structuredClone(disk) });
    usePreferencesStore.setState({ selfHostedInference: fixture.state });
    await setSessionEffort("a", choice);
    expect(sessionEffort(disk[0]).choice).toBe(choice);
    expect(sessionEffort(disk[0]).capability.levels).toEqual(["none", "low", "medium", "high", "max"]);
    const options = effortProviderOptions(sessionEffort(disk[0]));
    const body = ollamaBody(fixture.profile.transportModelId, { prompt: [], maxOutputTokens: 2048, providerOptions: { ...options, ollama: { ...options.ollama, numCtx: 32768 } } }, true);
    expect(body.options).toEqual({ num_ctx: 32768, num_predict: 2048 });
    if (choice === "automatic") expect(body).not.toHaveProperty("think");
    else expect(body.think).toBe(choice === "none" ? false : choice);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["conversation_effort_set"]);
  });
  it.each(["future_level", "on", "LOW"])("rejects unadvertised Muse choice %s before native persistence", async choice => {
    const fixture = ollamaEffortFixture();
    disk[0].profile = createConversationProfile({ agentId: "builtin:coder", modelId: selfHostedSelectionId(fixture.profile), workspaceRoot: null });
    useChatStore.setState({ sessions: structuredClone(disk) });
    usePreferencesStore.setState({ selfHostedInference: fixture.state });
    await expect(setSessionEffort("a", choice)).rejects.toThrow("not supported");
    expect(invoke).not.toHaveBeenCalled();
    expect(pendingEffortWrites.size).toBe(0);
  });
  it("persists boolean true as On without calling it High", async () => {
    const fixture = ollamaEffortFixture([true]);
    disk[0].profile = createConversationProfile({ agentId: "builtin:coder", modelId: selfHostedSelectionId(fixture.profile), workspaceRoot: null });
    useChatStore.setState({ sessions: structuredClone(disk) });
    usePreferencesStore.setState({ selfHostedInference: fixture.state });
    await setSessionEffort("a", "on");
    expect(sessionEffort(disk[0]).choice).toBe("on");
    expect(effortProviderOptions(sessionEffort(disk[0]))).toEqual({ ollama: { think: true } });
  });
  it("persists isolated chat choices and restores them after hydration", async () => {
    await setSessionEffort("a", "high");
    await setSessionEffort("b", "low");
    const saved = JSON.parse(JSON.stringify(disk));
    useChatStore.setState({ sessions: saved });
    expect(sessionEffort(saved[0]).choice).toBe("high");
    expect(sessionEffort(saved[1]).choice).toBe("low");
    expect(saved[0].profile).toEqual(session("a").profile);
  });
  it("unsupported/model change cannot borrow old effort; returning restores valid choice", async () => {
    await setSessionEffort("a", "high");
    const a = useChatStore.getState().sessions[0];
    if (!a.profile) throw Error("Missing fixture profile");
    const switched = {
      ...a,
      profile: { ...a.profile, modelId: "gpt-4.1-mini" },
    };
    expect(sessionEffort(switched).choice).toBe("automatic");
    expect(
      sessionEffort({
        ...a,
        title: "Renamed",
        profile: { ...a.profile, agentId: "builtin:reviewer" },
      }).choice,
    ).toBe("high");
    expect(sessionEffort(a).choice).toBe("high");
  });
  it("captures immutable run effort and keeps locks across retries/tool batches", async () => {
    await setSessionEffort("a", "high");
    expect(useChatStore.getState().beginRun("a")).toEqual({ ok: true });
    const run = useChatStore.getState().sessions[0].run;
    if (!run) throw Error("Missing fixture run");
    await setSessionEffort("b", "low");
    await expect(setSessionEffort("a", "low")).rejects.toThrow("locked");
    useChatStore.getState().startRunBatch("a");
    expect(useChatStore.getState().sessions[0].run?.reasoning).toEqual(
      run.reasoning,
    );
    expect(run.reasoning?.choice).toBe("high");
  });
  it("pending persistence prevents starting inference or another configuration write", async () => {
    let resolve!: (value: SessionMeta) => void;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const update = setSessionEffort("a", "high");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(isModelSelectionLocked("a")).toBe(true);
    expect(useChatStore.getState().beginRun("a").ok).toBe(false);
    await expect(setSessionEffort("a", "low")).rejects.toThrow("locked");
    resolve({ ...disk[0], modelRevision: 1 });
    await update;
    expect(isModelSelectionLocked("a")).toBe(false);
  });
  it("stale native writes preserve previous state and release the lock", async () => {
    const old = useChatStore.getState().sessions[0];
    disk[0] = { ...disk[0], modelRevision: 9 };
    await expect(setSessionEffort("a", "high")).rejects.toThrow("stale");
    expect(useChatStore.getState().sessions[0]).toBe(old);
    expect(isModelSelectionLocked("a")).toBe(false);
  });
  it("cross-window events converge monotonically including effort and invalidation", async () => {
    await setSessionEffort("a", "high");
    const newer = {
      ...disk[0],
      modelRevision: 3,
      effortPreferences: { version: 1 as const, choices: [] },
    };
    applyCommittedModelSwitch(newer);
    applyCommittedModelSwitch(disk[0]);
    expect(useChatStore.getState().sessions[0]).toBe(newer);
    expect(sessionEffort(newer).choice).toBe("automatic");
  });
  it("changing effort invalidates C2 reuse even when qualitative reserve is identical", async () => {
    const effort = captureEffort("gpt-5.4-mini", {
      providerId: "openai",
      transportModelId: "gpt-5.4-mini",
    });
    const base = {
      modelId: "gpt-5.4-mini",
      configuration: { reasoning: effort },
      system: [],
      tools: [],
      limits: {},
      capabilities: {
        text: "supported" as const,
        image: "unknown" as const,
        tools: "unknown" as const,
        document: "unknown" as const,
        audio: "unknown" as const,
        evidence: "unknown-model" as const,
      },
      permissions: [],
      workspace: [],
      credentials: [],
    };
    const automatic = await targetContextKey(base);
    const high = await targetContextKey({
      ...base,
      configuration: { reasoning: { ...effort, choice: "high" } },
    });
    expect(high).not.toBe(automatic);
  });
});
