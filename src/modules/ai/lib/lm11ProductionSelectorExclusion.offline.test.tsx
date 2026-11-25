/**
 * LM11 T01: five ordinary production model-selection exclusion tests in memory,
 * plus one separately evidence-bound historical assertion.
 *
 * This uses the real, non-feature TypeScript registry/selection functions and
 * the real ModelDropdown renderer. The only mocks adapt Zustand hooks to SSR
 * and expose the normally closed dropdown contents. Ordinary tests contact no
 * acceptance fixture, Tauri host, native command, provider, Store, AppData or network.
 * A deliberately attached in-memory model is a POSITIVE DETECTION CONTROL,
 * never a claim that it was present in normal production preferences.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/store/chatStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai/store/chatStore")>();
  return {
    ...actual,
    useChatStore: Object.assign(
      <T,>(selector: (s: ReturnType<typeof actual.useChatStore.getState>) => T) =>
        selector(actual.useChatStore.getState()),
      actual.useChatStore,
    ),
  };
});
vi.mock("@/modules/settings/preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/settings/preferences")>();
  return {
    ...actual,
    usePreferencesStore: Object.assign(
      <T,>(selector: (s: ReturnType<typeof actual.usePreferencesStore.getState>) => T) =>
        selector(actual.usePreferencesStore.getState()),
      actual.usePreferencesStore,
    ),
  };
});
// Only Radix dropdown visibility is adapted: the actual ModelDropdown list
// assembly, filtering, model statuses and grouping are not mocked.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Box,
    DropdownMenuContent: Box,
    DropdownMenuTrigger: Box,
    DropdownMenuItem: Box,
  };
});

import {
  MODELS, PROVIDERS, compatModelIdForEndpoint,
  getCompatModelInfo, resolveModel,
} from "@/modules/ai/config";
import {
  attachManagedLocalGguf,
  isManagedLocalSelectionId,
  managedLocalModelInfos,
  managedLocalSelectionStatus,
  managedLocalTransportIdentity,
  resolveManagedLocalSelection,
  savedManagedLocalModelInfos,
} from "@/modules/ai/lib/managedLocalModels";
import {
  emptySelfHostedState,
  readSelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  savedSelfHostedModelInfos,
  selfHostedModelInfo,
  selfHostedPickerStatus,
} from "@/modules/ai/lib/selfHostedModels";
import {
  getEnabledSavedProviderModelInfos,
  normalizeSavedProviderModels,
  resolveModelSelectionInfo,
  resolveModelTransportIdentity,
} from "@/modules/ai/lib/savedProviderModels";
import { reconcileLocalComputeFabric } from "@/modules/ai/lib/localComputeFabric";
import { resolveRestoredModel } from "@/modules/ai/lib/providerRestore";
import { groupFabricPickerModels, ModelDropdown } from "@/modules/ai/components/AiStatusBarControls";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useChatStore } from "@/modules/ai/store/chatStore";

// Ordinary CI does not possess the original Windows Stores. The existing
// scripts/lm11-production-selector-exclusion.mjs harness supplies the exact
// BEFORE path; the ordered historical runners do likewise. For a standalone
// evidence-only Vitest invocation, set CLACK_LM11_T01_EVIDENCE=1 and
// CLACK_LM11_T01_BEFORE_PATH to the authorized original absolute inventory,
// then run this file with -t "enumerates REAL production and legacy".
// Explicit evidence mode without its input MUST fail, never report a skip.
const historicalEvidenceRequested = process.env.CLACK_LM11_T01_EVIDENCE !== undefined ||
  process.env.CLACK_LM11_T01_BEFORE_PATH !== undefined;

const fixtureDigest = `sha256:${createHash("sha256")
  .update("CLACK-LM11-SYNTHETIC-NO-MODEL-20261119-v1")
  .digest("hex")}`;
const fixtureLabel = "CLACK-LM11-SYNTHETIC-NO-MODEL-20261119-v1";
const originalPreferences = usePreferencesStore.getState();
const originalChat = useChatStore.getState();
const untouched = emptySelfHostedState();
const control = attachManagedLocalGguf(untouched, {
  digest: fixtureDigest,
  displayName: fixtureLabel,
  material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
});

function productionStoresWithVerifiedBeforeHashes() {
  const beforePath = process.env.CLACK_LM11_T01_BEFORE_PATH;
  if (!beforePath) throw new Error("T01 blocked: prime's exact T15 BEFORE hash inventory required");
  const cases = path.resolve("src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases");
  if (process.platform !== "win32" || !path.isAbsolute(beforePath) ||
      path.basename(beforePath) !== "production-before.json" ||
      !/^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$/.test(path.basename(path.dirname(beforePath))) ||
      path.dirname(path.dirname(beforePath)).toLowerCase() !== cases.toLowerCase()) {
    throw new Error("T01 blocked: exact owned Windows T15 BEFORE inventory required");
  }
  const inventory = lstatSync(beforePath);
  if (!inventory.isFile() || inventory.isSymbolicLink() || inventory.size === 0 ||
      realpathSync(beforePath).toLowerCase() !== path.resolve(beforePath).toLowerCase()) {
    throw new Error("T01 blocked: original BEFORE inventory missing or redirected");
  }
  const source = JSON.parse(readFileSync(beforePath, "utf8")) as {
    phase?: string;
    source?: string;
    appId?: string;
    fileOrRegistryEntries?: {
      key: string;
      kind: string;
      sha256: string;
      size: number;
    }[];
    errors?: unknown[];
  };
  if (source.phase !== "Before" ||
      source.source !== "independent-read-only-production-state-observer" ||
      source.appId !== "app.clack.dev" ||
      source.errors?.length !== 0 ||
      !Array.isArray(source.fileOrRegistryEntries)) {
    throw new Error("T01 blocked: independent BEFORE snapshot invalid");
  }
  const roaming = process.env.APPDATA;
  if (!roaming || !path.isAbsolute(roaming)) {
    throw new Error("T01 blocked: Windows Roaming AppData unavailable");
  }
  const roots = [
    { key: "roaming-production", directory: path.join(roaming, "app.clack.dev") },
    { key: "roaming-legacy", directory: path.join(roaming, "app.crynta.terax") },
  ];
  return roots.map(({ key, directory }) => {
    const file = path.join(directory, "terax-settings.json");
    const records = source.fileOrRegistryEntries?.filter((row) =>
      row.kind === "file" && row.key === `${key}/terax-settings.json`);
    const record = records?.length === 1 ? records[0] : undefined;
    if (!record || !/^[0-9a-f]{64}$/.test(record.sha256) ||
        !Number.isSafeInteger(record.size) || record.size < 0) {
      throw new Error("T01 blocked: exact unique production/legacy Store hash required");
    }
    const leaf = lstatSync(file);
    if (!leaf.isFile() || leaf.isSymbolicLink() ||
        realpathSync(file).toLowerCase() !== path.resolve(file).toLowerCase() ||
        leaf.size !== record.size) {
      throw new Error("T01 blocked: exact production/legacy Store is changed or redirected");
    }
    // No selector test may inspect the JSON object until exact BEFORE hash
    // equality has been established. Read-only, no plugin Store or native API.
    const bytes = readFileSync(file);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== record.size || digest !== record.sha256) {
      throw new Error("T01 blocked: production Store does not match T15 BEFORE");
    }
    return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  });
}

function containsFixture(value: unknown): boolean {
  return typeof value === "string" && (
    value.includes(fixtureDigest) ||
    value.includes(fixtureLabel) ||
    value.includes(`clack-${fixtureDigest.slice(7, 23)}`)
  );
}

function normalSelectionState() {
  // No production AppData or persisted Store hydration. This is a new,
  // independent normal-production default/preference shape in memory only.
  return {
    selfHostedInference: readSelfHostedState(untouched),
    customEndpoints: [],
    savedProviderModels: [],
    favoriteModelIds: [],
    recentModelIds: [],
  };
}

beforeEach(() => {
  usePreferencesStore.setState({ ...originalPreferences, ...normalSelectionState() });
  useChatStore.setState({
    ...originalChat,
    activeSessionId: null,
    sessions: [],
    selectedModelId: "gpt-5.4-mini",
  });
});
afterEach(() => {
  usePreferencesStore.setState(originalPreferences);
  useChatStore.setState(originalChat);
});

describe("LM11 T01: ordinary, non-feature production selector exclusion", () => {
  it("has no synthetic model in normal built-in, custom, saved-provider, self-hosted or managed registries", () => {
    const prefs = usePreferencesStore.getState();
    const state = prefs.selfHostedInference;
    expect(state.endpoints).toEqual([]);
    expect(state.profiles).toEqual([]);
    expect(state.fabric?.deployments ?? []).toEqual([]);
    expect(MODELS.some((model) => model.id.includes(fixtureDigest) ||
      model.label.includes(fixtureLabel))).toBe(false);
    expect(PROVIDERS.some((provider) => provider.id.includes("lm11-acceptance"))).toBe(false);
    expect(getEnabledSavedProviderModelInfos(prefs.savedProviderModels)).toEqual([]);
    expect(savedSelfHostedModelInfos(state)).toEqual([]);
    expect(savedManagedLocalModelInfos(state)).toEqual([]);
    expect(managedLocalModelInfos(state)).toEqual([]);
    const fabric = reconcileLocalComputeFabric(state);
    expect(fabric.deployments).toEqual([]);
    expect(fabric.artifacts).toEqual([]);
    expect(fabric.runtimes).toEqual([]);
    expect(fabric.hosts).toEqual([]);
  });

  it("never manufactures a model/deployment/route from the fixture ID without persisted registration", () => {
    const state = usePreferencesStore.getState().selfHostedInference;
    const candidateId = control.selectionId;
    expect(isManagedLocalSelectionId(candidateId)).toBe(true);
    expect(resolveManagedLocalSelection(state, candidateId).status).toBe("missing");
    expect(managedLocalSelectionStatus(state, candidateId)).toEqual({
      label: "Unavailable", disabled: true,
    });
    expect(() => selfHostedModelInfo(candidateId, state)).toThrow();
    expect(() => resolveModelSelectionInfo(candidateId, [], [], state)).toThrow();
    expect(() => managedLocalTransportIdentity(candidateId, state)).toThrow();
    expect(() => resolveModelTransportIdentity(candidateId, {
      selfHostedInference: state, customEndpoints: [], savedProviderModels: [],
    })).toThrow();
    expect(() => resolveModel(candidateId, [])).toThrow();
    // Self-hosted picker correctly delegates managed-local IDs to its separate
    // managed picker (which was checked above), rather than inventing an entry.
    expect(selfHostedPickerStatus(candidateId, state)).toBeUndefined();
  });

  it("ordinary ModelDropdown, host/runtime/artifact grouping, favorites and recents have no synthetic row", () => {
    const state = usePreferencesStore.getState().selfHostedInference;
    const grouped = groupFabricPickerModels(MODELS, state);
    expect(grouped.hostGroups).toEqual([]);
    expect(grouped.otherModels).toHaveLength(MODELS.length);
    usePreferencesStore.setState({
      favoriteModelIds: [control.selectionId],
      recentModelIds: [control.selectionId],
    });
    const html = renderToStaticMarkup(<ModelDropdown />);
    expect(html).toContain("Change model");
    expect(html).not.toContain(control.selectionId);
    expect(html).not.toContain(fixtureDigest);
    expect(html).not.toContain(fixtureLabel);
    expect(html).not.toContain('aria-label="Runtime Clack Managed on This PC"');
  });

  it("normal model restoration and fallback candidates do not discover fixture from an unregistered last-used ID", () => {
    const prefs = usePreferencesStore.getState();
    const state = prefs.selfHostedInference;
    const restored = resolveRestoredModel({
      selfHostedInference: state,
      apiKeys: {} as Parameters<typeof resolveRestoredModel>[0]["apiKeys"],
      defaultModelId: "gpt-5.4-mini",
      lastUsedModelId: control.selectionId,
      lastUsedProviderId: "openai-compatible",
      lmstudioBaseURL: "", lmstudioModelId: "",
      mlxBaseURL: "", mlxModelId: "",
      ollamaBaseURL: "", ollamaModelId: "",
      openaiCompatibleBaseURL: "", openaiCompatibleModelId: "",
      openrouterModelId: "",
      customEndpoints: [], savedProviderModels: [],
    });
    expect(restored).not.toBe(control.selectionId);
    // Mirrors ChatFallbackControl's actual inventory inputs (not its UI state):
    const fallbackCandidates = [
      ...MODELS,
      ...getEnabledSavedProviderModelInfos(prefs.savedProviderModels),
      ...savedSelfHostedModelInfos(state),
    ];
    expect(fallbackCandidates.some((model) => model.id === control.selectionId ||
      model.label.includes(fixtureLabel))).toBe(false);
  });

  it("positive detection control: the SAME normal selector and picker expose it only after an explicit in-memory attachment", () => {
    const hosted = control.state;
    expect(savedManagedLocalModelInfos(hosted).map((model) => model.id)).toContain(control.selectionId);
    expect(resolveManagedLocalSelection(hosted, control.selectionId).status).not.toBe("missing");
    usePreferencesStore.setState({
      selfHostedInference: hosted,
      favoriteModelIds: [],
      recentModelIds: [],
    });
    const html = renderToStaticMarkup(<ModelDropdown />);
    expect(html).toContain(fixtureDigest);
    expect(html).toContain(fixtureLabel);
    expect(html).toContain('aria-label="Runtime Clack Managed on This PC"');
    // The test never invokes updateSelfHostedProfiles or any disk persistence.
  });

});

if (historicalEvidenceRequested) {
  describe("LM11 T01: historical evidence-bound selector exclusion", () => {
  it("enumerates REAL production and legacy persisted IDs through normal selectors without ever registering synthetic fixture", () => {
    // The parent CLI already verified both hash-bound Stores; independently
    // reverify before the offline test reads each original JSON registration.
    // No raw IDs, URLs, settings objects or credentials appear in assertions.
    const production = productionStoresWithVerifiedBeforeHashes();
    let checked = 0;
    let rawIdsObserved = 0;
    for (const store of production) {
      const state = readSelfHostedState(store.selfHostedInference);
      const savedModels = normalizeSavedProviderModels(store.savedProviderModels);
      const endpoints = Array.isArray(store.customEndpoints)
        ? store.customEndpoints.filter((row) => row && typeof row === "object" &&
            typeof (row as { id?: unknown }).id === "string")
        : [];
      // The normal dropdown enumerates the ORIGINAL persisted self-hosted and
      // managed state, original saved-provider IDs, and custom endpoint IDs.
      const hosted = savedSelfHostedModelInfos(state);
      const managed = savedManagedLocalModelInfos(state);
      const providerModels = getEnabledSavedProviderModelInfos(savedModels);
      const compat = endpoints.map((row) => {
        const ep = row as { id: string };
        return getCompatModelInfo(compatModelIdForEndpoint(ep.id), endpoints as Parameters<typeof getCompatModelInfo>[1]);
      });
      const picker = [...MODELS, ...providerModels, ...compat, ...hosted, ...managed];
      const fabric = reconcileLocalComputeFabric(state);
      const originalIds: unknown[] = [
        store.defaultModelId, store.lastUsedModelId,
        ...(Array.isArray(store.favoriteModelIds) ? store.favoriteModelIds : []),
        ...(Array.isArray(store.recentModelIds) ? store.recentModelIds : []),
        ...picker.flatMap((m) => [m.id, m.label]),
        ...fabric.hosts.flatMap((host) => [host.id, ...host.runtimeIds]),
        ...fabric.runtimes.flatMap((runtime) => [runtime.id, runtime.type]),
        ...fabric.artifacts.flatMap((artifact) => [artifact.id, artifact.digest]),
        ...fabric.deployments.flatMap((deployment) => [
          deployment.id, deployment.runtimeId, deployment.artifactId,
          deployment.runtimeModelName, deployment.configurationIdentity,
        ]),
      ];
      rawIdsObserved += originalIds.length;
      expect(originalIds.some(containsFixture)).toBe(false);
      expect(picker.some((m) => containsFixture(m.id) ||
        containsFixture(m.label) || containsFixture(m.description))).toBe(false);
      expect(managed.some((m) => m.id === control.selectionId)).toBe(false);
      expect(resolveManagedLocalSelection(state, control.selectionId).status).toBe("missing");
      // Exercise the actual normal resolver on every available real ID. A
      // stale saved route is allowed to reject; it must never turn into this
      // synthetic managed identity.
      for (const model of picker) {
        let info: ReturnType<typeof resolveModelSelectionInfo> | undefined;
        try {
          info = resolveModelSelectionInfo(
            model.id, endpoints as Parameters<typeof resolveModelSelectionInfo>[1],
            savedModels, state,
          );
        } catch { /* stale legacy IDs are allowed to fail closed */ }
        if (info) {
          expect(containsFixture(info.id) || containsFixture(info.label)).toBe(false);
        }
        let target: ReturnType<typeof resolveModelTransportIdentity> | undefined;
        try {
          target = resolveModelTransportIdentity(model.id, {
            customEndpoints: endpoints as Parameters<typeof resolveModelSelectionInfo>[1],
            savedProviderModels: savedModels,
            selfHostedInference: state,
          });
        } catch { /* missing provider settings are not a synthetic route */ }
        if (target) {
          expect(containsFixture(target.transportModelId) ||
            containsFixture(target.managedLocal?.deploymentId)).toBe(false);
        }
      }
      // Render the actual normal picker over EXACT persisted registrations;
      // the only mocked layer is the Radix portal and SSR Zustand hook adapter.
      usePreferencesStore.setState({
        selfHostedInference: state,
        savedProviderModels: savedModels,
        customEndpoints: endpoints as ReturnType<typeof usePreferencesStore.getState>["customEndpoints"],
        favoriteModelIds: Array.isArray(store.favoriteModelIds)
          ? store.favoriteModelIds.filter((v): v is string => typeof v === "string") : [],
        recentModelIds: Array.isArray(store.recentModelIds)
          ? store.recentModelIds.filter((v): v is string => typeof v === "string") : [],
      });
      const html = renderToStaticMarkup(<ModelDropdown />);
      expect(containsFixture(html)).toBe(false);
      checked += 1;
    }
    // Assert counts only: no production IDs or URLs in failure output.
    expect(checked === 2 && rawIdsObserved >= 0).toBe(true);
  });
  });
} else {
  console.info("LM11 T01 HISTORICAL_ACCEPTANCE=NOT_RUN (requires authorized original Windows T15 BEFORE inventory and matching Stores; run the evidence harness separately)");
}
