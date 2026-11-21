import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (value: unknown) => void = () => undefined;
  },
}));

import { invoke } from "@tauri-apps/api/core";
import {
  armDeploymentQualification, disarmDeploymentQualification,
  QualificationOperationDeadline, qualificationDispatchAuthority,
} from "./deploymentQualificationFlight";
import { cancelSessionInference } from "./inferenceLifecycle";
import { createProxyFetch } from "./proxyFetch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const session = "offline-qualification-native";
const other = "unrelated-consumer";
const scope = (sessionId: string, current: () => boolean) => ({
  sessionId, runId: sessionId + ":1", isCurrent: current,
});
const invokeCalls = (name: string) =>
  vi.mocked(invoke).mock.calls.filter(([command]) => command === name);

beforeEach(() => { vi.mocked(invoke).mockReset(); });
afterEach(() => {
  disarmDeploymentQualification(session);
  vi.mocked(invoke).mockReset();
});

describe("LM11 flight cancellation at the real native dispatch boundary (offline)", () => {
  it("a late native ID is cancelled by exact ID, never streamed after the session was stopped", async () => {
    const opened = deferred<string>();
    vi.mocked(invoke).mockImplementation(command => {
      if (command === "ai_http_open") return opened.promise as never;
      if (command === "ai_http_cancel") return Promise.resolve() as never;
      throw new Error("No native streaming is authorized: " + command);
    });
    const budget = new QualificationOperationDeadline(5_000);
    armDeploymentQualification(session, "exact-deployment", "builtin:coder", { operation: budget });
    const admitted = qualificationDispatchAuthority(session)!;
    const pending = createProxyFetch({
      scope: scope(session, admitted), selfHosted: true, allowPrivateNetwork: true,
    })("http://localhost/v1/chat/completions").catch(error => error);
    await vi.waitFor(() => expect(invokeCalls("ai_http_open")).toHaveLength(1));
    const draining = cancelSessionInference(session);
    expect(admitted()).toBe(false);
    opened.resolve("inference-391");
    await draining;
    expect(await pending).toMatchObject({ code: "cancelled" });
    expect(invokeCalls("ai_http_stream")).toHaveLength(0);
    expect(invokeCalls("ai_http_cancel")).toEqual([
      ["ai_http_cancel", { requestId: "inference-391", cancellationOrigin: "parent-signal" }],
    ]);
    budget.finish();
  });

  it("cancellation during asynchronous native preflight prevents opening or streaming", async () => {
    const prepared = deferred<() => Promise<void>>();
    const began = vi.fn();
    vi.mocked(invoke).mockImplementation(command => {
      throw new Error("No native IPC is authorized after cancellation: " + command);
    });
    const budget = new QualificationOperationDeadline(5_000);
    armDeploymentQualification(session, "exact-deployment", "builtin:coder", { operation: budget });
    const pending = createProxyFetch({
      scope: scope(session, qualificationDispatchAuthority(session)!),
      selfHosted: true, allowPrivateNetwork: true,
      preflight: { prepare: () => { began(); return prepared.promise; } } as never,
    })("http://localhost/v1/chat/completions", {
      method: "POST", body: JSON.stringify({ model: "offline-fixture" }),
    }).catch(error => error);
    await vi.waitFor(() => expect(began).toHaveBeenCalledOnce());
    const draining = cancelSessionInference(session);
    prepared.resolve(async () => undefined);
    await draining;
    expect(await pending).toMatchObject({ code: "cancelled" });
    expect(invokeCalls("ai_http_open")).toHaveLength(0);
    expect(invokeCalls("ai_http_stream")).toHaveLength(0);
    budget.finish();
  });

  it("a disarmed flight cannot authorize a late queued callback; other sessions retain their authority", () => {
    const budget = new QualificationOperationDeadline(5_000);
    armDeploymentQualification(session, "exact-deployment", "builtin:coder", { operation: budget });
    const original = qualificationDispatchAuthority(session)!;
    disarmDeploymentQualification(session);
    expect(original()).toBe(false);
    expect(qualificationDispatchAuthority(session)?.()).toBe(false);
    expect(qualificationDispatchAuthority(other)).toBeUndefined();
    armDeploymentQualification(session, "exact-deployment", "builtin:coder", { operation: budget });
    expect(original()).toBe(false);
    expect(qualificationDispatchAuthority(session)?.()).toBe(true);
    budget.finish();
  });
});
