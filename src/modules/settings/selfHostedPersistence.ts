import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  assertWritableSelfHostedState,
  readSelfHostedState,
  SELF_HOSTED_SETTINGS_KEY,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { migrateSelfHostedProfiles } from "@/modules/ai/lib/selfHostedMigration";

export type SelfHostedStorage = {
  entries: () => Promise<[string, unknown][]>;
  compareAndSwap: (
    expected: unknown,
    value: SelfHostedState,
  ) => Promise<boolean>;
};

export function createSelfHostedPersistence(storage: SelfHostedStorage) {
  async function update(
    change: (state: SelfHostedState) => SelfHostedState,
  ): Promise<SelfHostedState> {
    // A native compare-and-swap serializes only this key across all webviews.
    for (let attempt = 0; attempt < 8; attempt++) {
      const entries = new Map(await storage.entries());
      const raw = entries.get(SELF_HOSTED_SETTINGS_KEY) ?? null;
      assertWritableSelfHostedState(raw);
      const migrated = migrateSelfHostedProfiles(raw, entries);
      const changed = change(migrated);
      assertWritableSelfHostedState(changed);
      const next = readSelfHostedState(changed);
      if (JSON.stringify(next) === JSON.stringify(raw)) return next;
      next.revision = migrated.revision + 1;
      if (await storage.compareAndSwap(raw, next)) return next;
    }
    throw new Error(
      "Self-hosted settings changed in another window. Try again.",
    );
  }
  return {
    update,
    async load(): Promise<SelfHostedState> {
      const entries = new Map(await storage.entries());
      const raw = entries.get(SELF_HOSTED_SETTINGS_KEY);
      // Do not rewrite unknown future/corrupt envelopes during startup.
      try {
        assertWritableSelfHostedState(raw);
      } catch {
        return readSelfHostedState(raw);
      }
      return update((state) => state);
    },
  };
}

export function nativeSelfHostedStorage(): SelfHostedStorage {
  return {
    entries: () => invoke<[string, unknown][]>("self_hosted_profiles_snapshot"),
    compareAndSwap: async (expected, value) => {
      const changed = await invoke<boolean>(
        "self_hosted_profiles_compare_and_swap",
        { expected, value },
      );
      if (changed)
        await emit("terax://prefs-changed", {
          key: SELF_HOSTED_SETTINGS_KEY,
          value,
        });
      return changed;
    },
  };
}
