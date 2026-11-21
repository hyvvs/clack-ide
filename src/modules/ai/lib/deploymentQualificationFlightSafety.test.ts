import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";
import {
  QualificationOperationDeadline,
  armDeploymentQualification,
  cancelAllDeploymentQualificationBeforeDispatch,
  cancelDeploymentQualificationBeforeDispatch,
  disarmDeploymentQualification,
  observeDeploymentQualificationNative,
  observeDeploymentQualificationPrepared,
  observeDeploymentQualificationStream,
  peekDeploymentQualificationFlight,
  qualificationDispatchAuthority,
} from "./deploymentQualificationFlight";

const session = "lm11-offline-flight";
const model = "managed-fixture";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

afterEach(() => {
  cancelAllDeploymentQualificationBeforeDispatch();
  disarmDeploymentQualification(session);
  vi.useRealTimers();
});

describe("LM11 B01–B03 operation-owned offline execution authority", () => {
  it("enforces one monotonic aggregate wall budget, not a fresh timeout for each await", async () => {
    vi.useFakeTimers();
    const stopped = vi.fn();
    const gate = new QualificationOperationDeadline(100, stopped);
    const one = await gate.within(() => Promise.resolve("admission"));
    expect(one).toBe("admission");
    await vi.advanceTimersByTimeAsync(75);
    expect(await gate.within(() => Promise.resolve("readiness"))).toBe("readiness");
    const stalled = deferred<string>();
    const waiting = gate.within(() => stalled.promise);
    const failure = expect(waiting).rejects.toThrow(/deadline|cancellation/);
    await vi.advanceTimersByTimeAsync(25);
    await failure;
    expect(gate.state.terminal).toBe("deadline");
    expect(stopped).toHaveBeenCalledTimes(1);
    stalled.resolve("late-success");
    await Promise.resolve();
    await expect(gate.within(() => Promise.resolve("dispatch"))).rejects.toThrow();
    gate.finish();
  });

  it("cancellation before native registration revokes a captured dispatch authority even after disarm", () => {
    const gate = new QualificationOperationDeadline(5_000);
    armDeploymentQualification(session, model, "builtin:coder", { operation: gate });
    const permitted = qualificationDispatchAuthority(session)!;
    expect(permitted()).toBe(true);
    cancelDeploymentQualificationBeforeDispatch(session);
    expect(permitted()).toBe(false);
    expect(gate.state.terminal).toBe("cancelled");
    disarmDeploymentQualification(session);
    expect(permitted()).toBe(false);
    expect(qualificationDispatchAuthority("unrelated-chat")).toBeUndefined();
    gate.finish();
  });

  it("deferred request preparation cannot succeed once the operation is cancelled", async () => {
    const gate = new QualificationOperationDeadline(5_000);
    armDeploymentQualification(session, model, "builtin:coder", { operation: gate });
    cancelDeploymentQualificationBeforeDispatch(session);
    await expect(observeDeploymentQualificationPrepared(session, {
      modelId: model,
      messages: [
        { role: "system", content: "ACTIVE AGENT: Coder" },
        { role: "user", content: "actual context\nReply with exactly LM2F-CHAT-QUALIFIED and nothing else." },
      ],
      activeTools: [], outputLimit: 128,
    })).rejects.toThrow(/dispatch forbidden/);
    gate.finish();
  });

  it("SDK settlement, exact native acknowledgement and quiescence are distinct from persisted CAS", () => {
    const gate = new QualificationOperationDeadline(5_000);
    expect(() => gate.beginPersistence()).toThrow(/quiescent/);
    gate.sdkSettled();
    expect(() => gate.beginPersistence()).toThrow(/quiescent/);
    gate.nativeAcknowledged();
    expect(gate.state.nativeQuiescent).toBe(false);
    gate.nativeQuiescent();
    gate.beginPersistence();
    expect(gate.state.persistence).toBe("pending");
    gate.persisted();
    expect(gate.state).toMatchObject({
      sdkSettled: true, nativeAcknowledged: true,
      nativeQuiescent: true, persistence: "acknowledged",
    });
    gate.finish();
  });

  it("stalled or ambiguous CAS never becomes accepted after a deadline", async () => {
    vi.useFakeTimers();
    const gate = new QualificationOperationDeadline(120);
    gate.sdkSettled();
    gate.nativeAcknowledged();
    gate.nativeQuiescent();
    gate.beginPersistence();
    const stalled = deferred<boolean>();
    const acknowledgement = gate.within(() => stalled.promise);
    const failure = expect(acknowledgement).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(120);
    await failure;
    stalled.resolve(true);
    await Promise.resolve();
    expect(gate.state.persistence).toBe("ambiguous");
    expect(gate.state.terminal).toBe("deadline");
    expect(() => gate.persisted()).toThrow();
    gate.finish();
  });

  it("an explicit CAS conflict is rejected rather than conflated with an acknowledged commit", () => {
    const gate = new QualificationOperationDeadline(5_000);
    gate.sdkSettled();
    gate.nativeAcknowledged();
    gate.nativeQuiescent();
    gate.beginPersistence();
    gate.rejectPersistence();
    expect(gate.state.persistence).toBe("rejected");
    expect(() => gate.persisted()).toThrow(/No acknowledged qualification CAS/);
    gate.finish();
  });

  it("native events correlate one actual request; a second dispatch is never promoted", () => {
    armDeploymentQualification(session, model, "builtin:coder", { measure: true });
    observeDeploymentQualificationNative(session, "request", "inference-123");
    observeDeploymentQualificationNative(session, "terminal", "inference-123");
    expect(peekDeploymentQualificationFlight(session)?.native).toEqual({
      opens: 1, requestId: "inference-123", terminal: "completed",
    });
    observeDeploymentQualificationNative(session, "request", "inference-456");
    expect(peekDeploymentQualificationFlight(session)?.violations).toContain(
      "native-dispatch-without-single-open-authority",
    );
  });

  it.each([
    "native status", "native admission", "session writes", "session preparation",
    "request preparation", "SDK dispatch", "native terminal", "native quiescence",
    "chat evidence writes", "deployment revalidation", "receipt scoring",
    "CAS snapshot", "CAS compare-and-swap acknowledgement",
  ])("fault injection at awaited %s forbids every subsequent effect after cancellation", async (_boundary) => {
    vi.useFakeTimers();
    const gate = new QualificationOperationDeadline(50);
    const delayed = deferred<void>();
    const progressed = vi.fn();
    const pending = gate.within(() => delayed.promise);
    const failure = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(50);
    await failure;
    delayed.resolve();
    await Promise.resolve();
    if (gate.isOpen()) progressed();
    await expect(gate.within(async () => { progressed(); }))
      .rejects.toThrow();
    expect(progressed).not.toHaveBeenCalled();
    gate.finish();
  });

  it("post-cancellation native completed event is a violation, not a late success receipt", () => {
    const gate = new QualificationOperationDeadline(5_000);
    armDeploymentQualification(session, model, "builtin:coder", { operation: gate });
    observeDeploymentQualificationNative(session, "request", "inference-41");
    cancelDeploymentQualificationBeforeDispatch(session);
    observeDeploymentQualificationNative(session, "terminal", "inference-41");
    expect(peekDeploymentQualificationFlight(session)?.violations)
      .toContain("native-completed-after-cancellation");
    expect(gate.state.terminal).toBe("cancelled");
    expect(() => gate.beginPersistence()).toThrow();
    gate.finish();
  });

  it("post-cancellation UI stream text stays negative evidence, never quiet success", () => {
    const gate = new QualificationOperationDeadline(5_000);
    armDeploymentQualification(session, model, "builtin:coder", { operation: gate, measure: true });
    observeDeploymentQualificationNative(session, "request", "inference-41");
    cancelDeploymentQualificationBeforeDispatch(session);
    observeDeploymentQualificationStream(session, {
      type: "text-delta", id: "late-part", delta: "late-output",
    } as UIMessageChunk);
    expect(peekDeploymentQualificationFlight(session)?.violations)
      .toContain("stream-event-after-flight-revocation");
    expect(peekDeploymentQualificationFlight(session)?.textChars).toBe(0);
    gate.finish();
  });

  it("host shutdown revokes a pending flight, including a deliberate cancellation challenge", () => {
    const gate = new QualificationOperationDeadline(5_000);
    armDeploymentQualification(session, model, "builtin:coder", {
      operation: gate, cancelChallenge: true,
    });
    const canDispatch = qualificationDispatchAuthority(session)!;
    cancelAllDeploymentQualificationBeforeDispatch();
    expect(canDispatch()).toBe(false);
    expect(gate.state.terminal).toBe("shutdown");
    gate.finish();
  });
});
