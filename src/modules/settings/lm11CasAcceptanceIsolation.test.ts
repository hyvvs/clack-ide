import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { QualificationOperationDeadline } from "@/modules/ai/lib/deploymentQualificationFlight";
import { emptySelfHostedState, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { withLocalComputeFabric } from "@/modules/ai/lib/localComputeFabric";
import {
  createSelfHostedPersistence,
  lm11QualificationCasAcceptanceOperationIsClear,
  setLm11QualificationCasAcceptanceOperation,
  withLm11QualificationCasAcceptanceOperation,
} from "./selfHostedPersistence";

const ticket = { operationId: "acceptance-ticket", nativeEpoch: "native-epoch" };
const sessionId = "original-qualification-session";
function qualifyingChange(current: SelfHostedState): SelfHostedState {
  const state = withLocalComputeFabric(current);
  return { ...state, fabric: {
    ...state.fabric!,
    qualificationReceipts: [...(state.fabric?.qualificationReceipts ?? []), {
      version: 2, scope: { deploymentId: "local", runtimeEpoch: "epoch" },
      evidence: "fixture",
    }],
  } };
}

function rejectedCas() {
  return createSelfHostedPersistence({
    entries: async () => [["selfHostedInference", withLocalComputeFabric(emptySelfHostedState())]],
    compareAndSwap: async () => { throw new Error("generic CAS not permitted"); },
    prepareQualification: async () => "prepared" as const,
    acknowledgeQualification: async () => "ambiguous" as const,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(invoke).mockReset();
  setLm11QualificationCasAcceptanceOperation(undefined);
});

describe("LM11 acceptance-only CAS operation ownership", () => {
  it("rejected CAS clears its bound operation before another CAS can run", async () => {
    vi.stubEnv("VITE_CLACK_LM11_ACCEPTANCE", "1");
    const original = new QualificationOperationDeadline(5_000);
    vi.mocked(invoke).mockResolvedValue(undefined as never);
    await expect(withLm11QualificationCasAcceptanceOperation(original, sessionId, async () => {
      expect(lm11QualificationCasAcceptanceOperationIsClear()).toBe(false);
      return rejectedCas().updateQualification(qualifyingChange, ticket, () => original.assertOpen());
    })).rejects.toThrow("native acknowledgement is ambiguous");
    expect(lm11QualificationCasAcceptanceOperationIsClear()).toBe(true);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["lm11_acceptance_barrier", { stage: "b03-before-prepare", sessionId }],
      ["lm11_acceptance_barrier", { stage: "b03-before-acknowledge", sessionId }],
    ]);
    // A second CAS must carry its own identity, never the failed CAS identity.
    vi.mocked(invoke).mockClear();
    const current = new QualificationOperationDeadline(5_000);
    await expect(withLm11QualificationCasAcceptanceOperation(current, "new-qualification-session",
      async () => rejectedCas().updateQualification(qualifyingChange, ticket, () => current.assertOpen()),
    )).rejects.toThrow("native acknowledgement is ambiguous");
    expect(lm11QualificationCasAcceptanceOperationIsClear()).toBe(true);
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls.every(([, args]) =>
      (args as { sessionId: string }).sessionId === "new-qualification-session")).toBe(true);
    original.finish();
    current.finish();
  });

  it("passes exact original sessionId at prepare, acknowledge, AND readback", async () => {
    vi.stubEnv("VITE_CLACK_LM11_ACCEPTANCE", "1");
    vi.mocked(invoke).mockResolvedValue(undefined as never);
    let persisted = withLocalComputeFabric(emptySelfHostedState());
    const repo = createSelfHostedPersistence({
      entries: async () => [["selfHostedInference", structuredClone(persisted)]],
      compareAndSwap: async () => { throw new Error("generic CAS not permitted"); },
      prepareQualification: async (_, value) => {
        persisted = structuredClone(value);
        return "prepared";
      },
      acknowledgeQualification: async () => {
        persisted.fabric!.qualificationReceipts =
          (persisted.fabric?.qualificationReceipts ?? []).map(row => ({
            ...(row as Record<string, unknown>),
            qualificationCas: {
              operationId: ticket.operationId, nativeEpoch: ticket.nativeEpoch,
              phase: "acknowledged",
            },
          }));
        return "acknowledged";
      },
    });
    const operation = new QualificationOperationDeadline(5_000);
    await withLm11QualificationCasAcceptanceOperation(operation, sessionId,
      () => repo.updateQualification(qualifyingChange, ticket, () => operation.assertOpen()));
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["lm11_acceptance_barrier", { stage: "b03-before-prepare", sessionId }],
      ["lm11_acceptance_barrier", { stage: "b03-before-acknowledge", sessionId }],
      ["lm11_acceptance_barrier", { stage: "b03-before-readback", sessionId }],
    ]);
    expect(lm11QualificationCasAcceptanceOperationIsClear()).toBe(true);
    operation.finish();
  });

  it("normal build never retains acceptance-only operation state", async () => {
    vi.stubEnv("VITE_CLACK_LM11_ACCEPTANCE", "0");
    const operation = new QualificationOperationDeadline(5_000);
    await expect(withLm11QualificationCasAcceptanceOperation(operation, sessionId, async () => {
      throw new Error("CAS rejected");
    })).rejects.toThrow("CAS rejected");
    expect(invoke).not.toHaveBeenCalled();
    expect(lm11QualificationCasAcceptanceOperationIsClear()).toBe(true);
    operation.finish();
  });
});
