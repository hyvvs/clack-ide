import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptySelfHostedState, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { appendNativeSafeHistory, withLocalComputeFabric } from "@/modules/ai/lib/localComputeFabric";
import {
  beginNativeQualificationCas, cancelNativeQualificationCas,
  createSelfHostedPersistence, nativeSelfHostedStorage,
  reconcileNativeQualificationCas,
  type NativeQualificationCasTicket,
  type NativeQualificationCasOutcome,
  type SelfHostedStorage,
} from "./selfHostedPersistence";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(async () => undefined) }));
import { invoke } from "@tauri-apps/api/core";

const ticket: NativeQualificationCasTicket = {
  operationId: "offline-operation-uuid",
  nativeEpoch: "offline-native-epoch",
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function startingState() {
  return withLocalComputeFabric(emptySelfHostedState());
}
function qualifyingChange(current: SelfHostedState): SelfHostedState {
  const state = withLocalComputeFabric(current);
  return {
    ...state,
    fabric: {
      ...state.fabric!,
      qualificationReceipts: [
        ...(state.fabric?.qualificationReceipts ?? []),
        { version: 2, scope: { deploymentId: "deployment-a", runtimeEpoch: "epoch-a" },
          evidence: "offline fixture" },
      ],
    },
  };
}
function storage(
  options: {
    prepare?: (expected: unknown, next: SelfHostedState) => Promise<NativeQualificationCasOutcome>;
    acknowledge?: () => Promise<NativeQualificationCasOutcome>;
    entries?: () => Promise<[string, unknown][]>;
  } = {},
) {
  let persisted = startingState();
  let prepares = 0;
  let acknowledges = 0;
  const configured: SelfHostedStorage = {
    entries: options.entries ?? (async () => [["selfHostedInference", structuredClone(persisted)]]),
    compareAndSwap: async () => { throw new Error("Qualification cannot use generic CAS"); },
    prepareQualification: async (expected, value) => {
      prepares++;
      if (options.prepare) return options.prepare(expected, value);
      persisted = structuredClone(value);
      return "prepared";
    },
    acknowledgeQualification: async (ticket) => {
      acknowledges++;
      if (options.acknowledge) return options.acknowledge();
      const latest = persisted.fabric?.qualificationReceipts ?? [];
      persisted.fabric!.qualificationReceipts = latest.map(row => ({
        ...(row as Record<string, unknown>),
        qualificationCas: { operationId: ticket.operationId,
          nativeEpoch: ticket.nativeEpoch, phase: "acknowledged" },
      }));
      return "acknowledged";
    },
  };
  return { configured, stats: () => ({ prepares, acknowledges, persisted }) };
}

beforeEach(() => { vi.mocked(invoke).mockReset(); });

describe("LM11 B03 one native-owned qualification CAS (offline)", () => {
  it("executes one prepared/acknowledged native effect; generic 8-retry CAS is not used", async () => {
    const fixture = storage();
    const repo = createSelfHostedPersistence(fixture.configured);
    const result = await repo.updateQualification(qualifyingChange, ticket, () => undefined);
    expect(result.fabric?.qualificationReceipts).toHaveLength(1);
    expect((result.fabric?.qualificationReceipts?.[0] as { qualificationCas?: { phase: string } })
      .qualificationCas?.phase).toBe("acknowledged");
    expect(fixture.stats()).toMatchObject({ prepares: 1, acknowledges: 1 });
    expect(fixture.stats().persisted.revision).toBe(1);
  });

  it("an acknowledged IPC with an unmarked or stale native snapshot never becomes PASS", async () => {
    const fixture = storage({ acknowledge: async () => "acknowledged" });
    await expect(createSelfHostedPersistence(fixture.configured)
      .updateQualification(qualifyingChange, ticket, () => undefined))
      .rejects.toThrow("does not prove the exact CAS effect");
    expect(fixture.stats()).toMatchObject({ prepares: 1, acknowledges: 1 });
  });

  it("bounded history cannot evict any pending or acknowledged native ticket", () => {
    const marked = { version: 0, qualificationCas: {
      operationId: "previous", nativeEpoch: "native", phase: "pending" } };
    expect(() => appendNativeSafeHistory([marked, ...Array(127).fill({ version: 1 })],
      [{ version: 2 }], 128)).toThrow("cannot evict");
    const unmarked = Array(127).fill({ version: 1 });
    expect(appendNativeSafeHistory([...unmarked, marked], [{ version: 2 }], 128))
      .toEqual([...unmarked.slice(1), marked, { version: 2 }]);
    expect(appendNativeSafeHistory([marked], [{ version: 1 }], 48)).toHaveLength(2);
  });

  it.each(["rejected", "conflict", "failed-before-commit", "ambiguous"] as const)(
    "native preparation %s cannot be retried, acknowledged or made PASS", async outcome => {
      const fixture = storage({ prepare: async () => outcome });
      await expect(createSelfHostedPersistence(fixture.configured)
        .updateQualification(qualifyingChange, ticket, () => undefined)).rejects.toThrow();
      expect(fixture.stats()).toMatchObject({ prepares: 1, acknowledges: 0 });
    },
  );

  it.each(["rejected", "conflict", "ambiguous", "failed-before-commit",
    "committed-unacknowledged", "recovery-required"] as const)(
    "native acknowledgement %s cannot be accepted as a qualifying result", async outcome => {
      const fixture = storage({ acknowledge: async () => outcome });
      await expect(createSelfHostedPersistence(fixture.configured)
        .updateQualification(qualifyingChange, ticket, () => undefined)).rejects.toThrow();
      expect(fixture.stats()).toMatchObject({ prepares: 1, acknowledges: 1 });
    },
  );

  it("expiry before snapshot is a no-op and never reaches a native writer", async () => {
    const fixture = storage();
    await expect(createSelfHostedPersistence(fixture.configured)
      .updateQualification(qualifyingChange, ticket, () => {
        throw new Error("aggregate deadline expired");
      })).rejects.toThrow("expired");
    expect(fixture.stats()).toMatchObject({ prepares: 0, acknowledges: 0 });
  });

  it("cancellation while the native snapshot is awaited forbids later prepare", async () => {
    const waiting = deferred<[string, unknown][]>();
    let current = true;
    const fixture = storage({ entries: () => waiting.promise });
    const pending = createSelfHostedPersistence(fixture.configured)
      .updateQualification(qualifyingChange, ticket, () => {
        if (!current) throw new Error("cancelled");
      });
    current = false;
    waiting.resolve([["selfHostedInference", startingState()]]);
    await expect(pending).rejects.toThrow("cancelled");
    expect(fixture.stats().prepares).toBe(0);
  });

  it("late native preparation response after cancellation cannot enter acknowledge", async () => {
    const waiting = deferred<NativeQualificationCasOutcome>();
    const entered = deferred<void>();
    let current = true;
    const fixture = storage({ prepare: () => { entered.resolve(); return waiting.promise; } });
    const pending = createSelfHostedPersistence(fixture.configured)
      .updateQualification(qualifyingChange, ticket, () => {
        if (!current) throw new Error("cancelled");
      });
    await entered.promise;
    current = false;
    waiting.resolve("prepared");
    await expect(pending).rejects.toThrow("cancelled");
    expect(fixture.stats()).toMatchObject({ prepares: 1, acknowledges: 0 });
  });

  it("late successful native acknowledgement after cancellation remains unknown to caller", async () => {
    const waiting = deferred<NativeQualificationCasOutcome>();
    const entered = deferred<void>();
    let current = true;
    const fixture = storage({ acknowledge: () => { entered.resolve(); return waiting.promise; } });
    const pending = createSelfHostedPersistence(fixture.configured)
      .updateQualification(qualifyingChange, ticket, () => {
        if (!current) throw new Error("cancelled");
      });
    await entered.promise;
    current = false;
    waiting.resolve("acknowledged");
    await expect(pending).rejects.toThrow("cancelled");
    expect(fixture.stats()).toMatchObject({ prepares: 1, acknowledges: 1 });
    // A late result cannot cause a second attempt or success receipt.
    expect(fixture.stats().persisted.fabric?.qualificationReceipts).toHaveLength(1);
  });

  it("a stalled native acknowledgement never starts a duplicate qualifying CAS", async () => {
    const waiting = deferred<NativeQualificationCasOutcome>();
    const entered = deferred<void>();
    const fixture = storage({ acknowledge: () => { entered.resolve(); return waiting.promise; } });
    let current = true;
    const pending = createSelfHostedPersistence(fixture.configured)
      .updateQualification(qualifyingChange, ticket, () => {
        if (!current) throw new Error("deadline");
      });
    await entered.promise;
    current = false;
    waiting.resolve("ambiguous");
    await expect(pending).rejects.toThrow("deadline");
    expect(fixture.stats()).toMatchObject({ prepares: 1, acknowledges: 1 });
  });

  it("native begin, cancel and read-only restart reconciliation use exact ticket identity", async () => {
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === "self_hosted_profiles_qualification_begin") return ticket;
      if (command === "self_hosted_profiles_qualification_cancel") return undefined;
      if (command === "self_hosted_profiles_qualification_reconcile") return "not-committed";
      throw new Error("Unexpected command: " + command);
    });
    const request = {
      kind: "lm2f" as const, deploymentId: "deployment-a",
      runtimeEpoch: "epoch-a", processId: 141, remainingMs: 250,
    };
    expect(await beginNativeQualificationCas(request)).toEqual(ticket);
    await cancelNativeQualificationCas(ticket);
    expect(await reconcileNativeQualificationCas(ticket)).toBe("not-committed");
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["self_hosted_profiles_qualification_begin", { ...request,
        deadlineUnixMs: expect.any(Number) }],
      ["self_hosted_profiles_qualification_cancel", { ticket }],
      ["self_hosted_profiles_qualification_reconcile", { ticket }],
    ]);
    await expect(beginNativeQualificationCas({ ...request, remainingMs: 0 }))
      .rejects.toThrow("budget");
  });

  it("an unrelated generic CAS retains its eight-conflict bound", async () => {
    let writes = 0;
    const fixture = createSelfHostedPersistence({
      entries: async () => [],
      compareAndSwap: async () => { writes++; return false; },
    });
    await expect(fixture.update(state => ({
      ...state, revision: 2,
    }))).rejects.toThrow("another window");
    expect(writes).toBe(8);
  });

  it("the existing unrelated native storage adapter still uses generic CAS", async () => {
    const state = startingState();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "self_hosted_profiles_snapshot") return [["selfHostedInference", state]];
      if (command === "self_hosted_profiles_compare_and_swap") return true;
      throw new Error("Unexpected native operation " + command);
    });
    const repo = createSelfHostedPersistence(nativeSelfHostedStorage());
    await repo.update(current => ({ ...current, revision: current.revision + 1 }));
    expect(vi.mocked(invoke).mock.calls.some(([name]) =>
      name === "self_hosted_profiles_compare_and_swap")).toBe(true);
    expect(vi.mocked(invoke).mock.calls.some(([name]) =>
      String(name).includes("qualification_prepare"))).toBe(false);
  });
});
