import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  assertWritableSelfHostedState,
  readSelfHostedState,
  SELF_HOSTED_SETTINGS_KEY,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { ensureDefaultOllamaHost, migrateSelfHostedProfiles } from "@/modules/ai/lib/selfHostedMigration";
import { withLocalComputeFabric } from "@/modules/ai/lib/localComputeFabric";
import { lm11AcceptanceBarrier } from "@/modules/ai/lib/lm11AcceptanceBarrier";
import type { QualificationOperationDeadline } from "@/modules/ai/lib/deploymentQualificationFlight";

// The runner assigns its existing operation only during its own native CAS
// sequence. Ordinary settings and LM6 qualification have no LM11 hook.
let qualificationCasAcceptanceContext: {
  operation: QualificationOperationDeadline;
  sessionId: string;
} | undefined;
export function setLm11QualificationCasAcceptanceOperation(
  operation: QualificationOperationDeadline | undefined,
  sessionId?: string,
): void {
  if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE !== "1") return;
  if (!operation) {
    qualificationCasAcceptanceContext = undefined;
    return;
  }
  if (!sessionId?.trim())
    throw new Error("LM11 acceptance CAS requires the original qualification session ID");
  qualificationCasAcceptanceContext = { operation, sessionId };
}

/** Narrow read-only probe for offline acceptance ownership regression tests. */
export function lm11QualificationCasAcceptanceOperationIsClear(): boolean {
  return qualificationCasAcceptanceContext === undefined;
}

/** Isolate the runner's existing operation to its exact CAS invocation. Even
 * a rejected native prepare/ACK/readback clears the acceptance-only pointer. */
export async function withLm11QualificationCasAcceptanceOperation<T>(
  operation: QualificationOperationDeadline,
  sessionId: string,
  work: () => Promise<T>,
): Promise<T> {
  if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE !== "1") return work();
  setLm11QualificationCasAcceptanceOperation(operation, sessionId);
  try {
    return await work();
  } finally {
    setLm11QualificationCasAcceptanceOperation(undefined);
  }
}

/** An ephemeral, native-created operation/epoch ticket. This is not a new
 * persistence record or durable qualification authority. Reconcile reads the
 * same existing selfHostedInference value after an acknowledgement loss. */
export type NativeQualificationCasTicket = {
  operationId: string;
  nativeEpoch: string;
};
export type NativeQualificationCasRequest = {
  kind: "lm2f" | "lm6";
  deploymentId: string;
  runtimeEpoch: string;
  processId: number | null;
  remainingMs: number;
};
export type NativeQualificationCasOutcome =
  "prepared" | "acknowledged" | "rejected" | "conflict" | "failed-before-commit" |
  "ambiguous" | "committed-unacknowledged" | "recovery-required";
export type NativeQualificationReconciliation =
  "committed" | "not-committed" | "pending-reconciliation";

export async function beginNativeQualificationCas(
  request: NativeQualificationCasRequest,
): Promise<NativeQualificationCasTicket> {
  if (!Number.isSafeInteger(request.remainingMs) || request.remainingMs < 1)
    throw new Error("No qualification aggregate wall budget remains");
  return invoke("self_hosted_profiles_qualification_begin", {
    ...request, deadlineUnixMs: Date.now() + request.remainingMs,
  });
}
export async function cancelNativeQualificationCas(
  ticket: NativeQualificationCasTicket,
): Promise<void> {
  await invoke("self_hosted_profiles_qualification_cancel", { ticket });
}
export function reconcileNativeQualificationCas(
  ticket: NativeQualificationCasTicket,
): Promise<NativeQualificationReconciliation> {
  // This is deliberately NOT a path to retry or promote a prior Unknown.
  return invoke("self_hosted_profiles_qualification_reconcile", { ticket });
}

export type SelfHostedStorage = {
  entries: () => Promise<[string, unknown][]>;
  compareAndSwap: (
    expected: unknown,
    value: SelfHostedState,
  ) => Promise<boolean>;
  prepareQualification?: (
    expected: unknown, value: SelfHostedState, ticket: NativeQualificationCasTicket,
  ) => Promise<NativeQualificationCasOutcome>;
  acknowledgeQualification?: (
    ticket: NativeQualificationCasTicket, value: SelfHostedState,
  ) => Promise<NativeQualificationCasOutcome>;
  notifyQualified?: (value: SelfHostedState) => void;
};

// Native changes only the newly committed receipt rows by adding its ticket
// marker. Compare the entire persisted value (not a renderer proposal), while
// ignoring JSON object insertion order across the Rust/JS serialization edge.
function canonicalJson(value: unknown): string {
  const ordered = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === "object") return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, ordered(entry)]));
    return item;
  };
  return JSON.stringify(ordered(value));
}

function assertAcknowledgedNativeSnapshot(
  value: SelfHostedState, proposed: SelfHostedState,
  ticket: NativeQualificationCasTicket,
): void {
  const withoutNewMarkers = structuredClone(value);
  let acknowledged = 0;
  for (const field of ["qualificationReceipts", "measurementRuns"] as const) {
    const rows = withoutNewMarkers.fabric?.[field];
    if (!rows) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) ||
          !("qualificationCas" in row)) continue;
      const candidate = row as Record<string, unknown>;
      const marker = candidate.qualificationCas as Record<string, unknown> | null;
      if (marker?.operationId !== ticket.operationId || marker.nativeEpoch !== ticket.nativeEpoch)
        continue; // Previously acknowledged receipts are left unchanged.
      if (marker.phase !== "acknowledged")
        throw new Error("Native qualification receipt is not durably acknowledged");
      delete candidate.qualificationCas;
      acknowledged++;
    }
  }
  if (!acknowledged || canonicalJson(withoutNewMarkers) !== canonicalJson(proposed))
    throw new Error("Native qualification snapshot does not prove the exact CAS effect");
}

export function createSelfHostedPersistence(storage: SelfHostedStorage) {
  /** Qualifying CAS is deliberately a single attempt, not the ordinary eight
   * CAS retries: a lost acknowledgement must never replay new evidence. */
  async function updateQualification(
    change: (state: SelfHostedState) => SelfHostedState,
    ticket: NativeQualificationCasTicket,
    assertCurrent: () => void,
  ): Promise<SelfHostedState> {
    if (!storage.prepareQualification || !storage.acknowledgeQualification)
      throw new Error("Native qualification CAS is unavailable");
    assertCurrent();
    const entries = new Map(await storage.entries());
    assertCurrent();
    const raw = entries.get(SELF_HOSTED_SETTINGS_KEY) ?? null;
    assertWritableSelfHostedState(raw);
    const migrated = ensureDefaultOllamaHost(migrateSelfHostedProfiles(raw, entries), entries);
    const changed = withLocalComputeFabric(change(migrated));
    assertCurrent();
    assertWritableSelfHostedState(changed);
    const next = readSelfHostedState(changed);
    if (JSON.stringify(next) === JSON.stringify(raw))
      throw new Error("No qualifying native CAS effect was recorded");
    next.revision = migrated.revision + 1;
    if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE === "1")
      await lm11AcceptanceBarrier("b03-before-prepare",
        qualificationCasAcceptanceContext?.operation, qualificationCasAcceptanceContext?.sessionId);
    assertCurrent();
    const prepared = await storage.prepareQualification(raw, next, ticket);
    assertCurrent();
    if (prepared === "conflict")
      throw new Error("Self-hosted settings changed in another window. Try again.");
    if (prepared !== "prepared")
      throw new Error("Qualifying CAS did not attain a native prepared outcome: " + prepared);
    if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE === "1")
      await lm11AcceptanceBarrier("b03-before-acknowledge",
        qualificationCasAcceptanceContext?.operation, qualificationCasAcceptanceContext?.sessionId);
    assertCurrent();
    const acknowledged = await storage.acknowledgeQualification(ticket, next);
    assertCurrent();
    if (acknowledged !== "acknowledged")
      throw new Error("Qualifying CAS native acknowledgement is " + acknowledged);
    if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE === "1")
      await lm11AcceptanceBarrier("b03-before-readback",
        qualificationCasAcceptanceContext?.operation, qualificationCasAcceptanceContext?.sessionId);
    assertCurrent();
    // A stale local proposal is NOT a native success receipt. A missing or
    // delayed acknowledgement, or a changed persisted revision, is Unknown.
    const verifiedEntries = new Map(await storage.entries());
    assertCurrent();
    const verifiedRaw = verifiedEntries.get(SELF_HOSTED_SETTINGS_KEY);
    assertWritableSelfHostedState(verifiedRaw);
    const verified = readSelfHostedState(verifiedRaw);
    assertAcknowledgedNativeSnapshot(verified, next, ticket);
    assertCurrent();
    storage.notifyQualified?.(verified);
    return verified;
  }
  async function update(
    change: (state: SelfHostedState) => SelfHostedState,
  ): Promise<SelfHostedState> {
    // A native compare-and-swap serializes only this key across all webviews.
    for (let attempt = 0; attempt < 8; attempt++) {
      const entries = new Map(await storage.entries());
      const raw = entries.get(SELF_HOSTED_SETTINGS_KEY) ?? null;
      assertWritableSelfHostedState(raw);
      const migrated = ensureDefaultOllamaHost(migrateSelfHostedProfiles(raw, entries), entries);
      const changed = withLocalComputeFabric(change(migrated));
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
    updateQualification,
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
    prepareQualification: (expected, value, ticket) =>
      invoke("self_hosted_profiles_qualification_prepare", { expected, value, ticket }),
    acknowledgeQualification: async (ticket) =>
      invoke<NativeQualificationCasOutcome>(
        "self_hosted_profiles_qualification_acknowledge", { ticket },
      ),
    notifyQualified: value => {
      // Notification failure AFTER a verified native read is never a second
      // persistence failure; it also must never publish an unmarked proposal.
      void emit("terax://prefs-changed", { key: SELF_HOSTED_SETTINGS_KEY, value })
        .catch(() => undefined);
    },
  };
}
