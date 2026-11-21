import { afterAll, describe, expect, it, vi } from "vitest";

const { nativeInvoke, nativeEmit } = vi.hoisted(() => ({
  nativeInvoke: vi.fn(async (command: string) => {
    if (command === "self_hosted_settings_entries") return [];
    if (command === "self_hosted_profiles_snapshot") return [];
    if (command === "self_hosted_profiles_compare_and_swap") return true;
    return undefined;
  }),
  nativeEmit: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: nativeInvoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: nativeEmit, listen: vi.fn(async () => () => undefined),
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    constructor() { throw new Error("Desktop settings must never use plugin fs::write"); }
  },
}));
vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
afterAll(() => { vi.unstubAllGlobals(); });

describe("LM11 B03 physical settings authority bridge (offline)", () => {
  it("an unrelated preference setter uses the native atomic file command, never LazyStore", async () => {
    const { setEditorTheme } = await import("./store");
    await setEditorTheme("auto");
    expect(nativeInvoke).toHaveBeenCalledWith("self_hosted_settings_set", {
      key: "editorTheme", value: "auto",
    });
    expect(nativeEmit).toHaveBeenCalled();
  });
  it("preferences load uses native authoritative entries, never plugin store readback", async () => {
    const { loadPreferences } = await import("./store");
    await loadPreferences();
    expect(nativeInvoke).toHaveBeenCalledWith("self_hosted_settings_entries");
  });
  it("paired ordinary preferences commit together through one native replacement", async () => {
    nativeInvoke.mockClear();
    const { setLastUsedAiSelection } = await import("./store");
    await setLastUsedAiSelection("ollama", "offline-test-model");
    expect(nativeInvoke).toHaveBeenCalledTimes(1);
    expect(nativeInvoke).toHaveBeenCalledWith("self_hosted_settings_set_many", {
      changes: [
        ["lastUsedProviderId", "ollama"],
        ["lastUsedModelId", "offline-test-model"],
      ],
    });
  });
});
