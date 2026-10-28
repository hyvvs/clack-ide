import { describe, expect, it, vi } from "vitest";
import {
  attachNativeDiagnosticSignal, detachNativeDiagnosticSignal,
  emitSelfHostedInferencePhase, installSelfHostedInferencePhaseObserver,
  observeNativeDiagnostic, selfHostedInferencePhaseObserved,
  safeInferenceControls,
} from "./inferenceDiagnosticCorrelation";

describe("opt-in correlated self-hosted diagnostic observations", () => {
  it("does not publish or persist anything when disabled", () => {
    expect(selfHostedInferencePhaseObserved()).toBe(false);
    const signal = new AbortController().signal;
    expect(() => observeNativeDiagnostic(signal, "native-id-linked", "inference-7")).not.toThrow();
    expect(() => emitSelfHostedInferencePhase({
      sessionId: "session", runId: "run", provider: "ollama", modelRef: "fixture",
      event: { stage: "deadline-start", at: 1, attempt: 0, generationId: "generation" },
    })).not.toThrow();
  });
  it("joins only the same signal, detaches and tolerates observer exceptions", () => {
    const first = new AbortController().signal;
    const second = new AbortController().signal;
    const observed = vi.fn();
    attachNativeDiagnosticSignal(first, observed);
    observeNativeDiagnostic(second, "native-id-linked", "inference-13");
    observeNativeDiagnostic(first, "native-id-linked", "inference-14");
    expect(observed).toHaveBeenCalledExactlyOnceWith("native-id-linked", "inference-14", undefined);
    detachNativeDiagnosticSignal(first);
    observeNativeDiagnostic(first, "native-settled", "inference-14");
    expect(observed).toHaveBeenCalledTimes(1);
    const records: unknown[] = [];
    const throwing = installSelfHostedInferencePhaseObserver(() => { throw new Error("observer failure"); });
    const unsubscribe = installSelfHostedInferencePhaseObserver(record => records.push(record));
    try {
      const record = {
        sessionId: "s", runId: "r", provider: "ollama", modelRef: "m",
        digestRef: "model-digest", runtimeEpochRef: "epoch",
        event: { stage: "native-id-linked" as const, at: 5,
          attempt: 0, generationId: "generation", nativeRequestId: "inference-14" },
      };
      emitSelfHostedInferencePhase(record);
      expect(records).toEqual([record]);
      expect(selfHostedInferencePhaseObserved()).toBe(true);
    } finally { throwing(); unsubscribe(); }
    expect(selfHostedInferencePhaseObserved()).toBe(false);
  });
  it("extracts only finite numeric controls from parsed preflight, never sensitive content", () => {
    const input = { model: "PRIVATE_MODEL_URL", messages: [{ content: "PRIVATE_PROMPT" }],
      options: { num_ctx: 49152, num_predict: 8192, secret: "PRIVATE_CREDENTIAL" },
      tools: [{ function: { arguments: "PRIVATE_TOOL_ARGUMENTS" } }],
    };
    expect(safeInferenceControls(input)).toEqual({
      contextTokens: 49152, outputTokens: 8192, toolSchemas: 1,
    });
    expect(JSON.stringify(safeInferenceControls(input))).not.toContain("PRIVATE_");
    expect(safeInferenceControls({ options: { num_ctx: -1, num_predict: "8192" },
      tools: Array.from({ length: 1025 }) })).toEqual({});
    expect(safeInferenceControls("private content")).toEqual({});
  });
});
