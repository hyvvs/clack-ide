import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import type { UIMessage } from "ai";
import { attachManagedLocalGguf, resolveManagedLocalSelection } from "./managedLocalModels";
import { emptySelfHostedState, readSelfHostedState } from "./selfHostedProfiles";
import { observedManagedFabric } from "./deploymentQualificationView";
import {
  MANAGED_QUALIFICATION_EXPECTED,
  MANAGED_QUALIFICATION_PROMPT,
  QualificationOperationDeadline,
  armDeploymentQualification,
  disarmDeploymentQualification,
  observeDeploymentQualificationNative,
  type QualificationFlightSnapshot,
} from "./deploymentQualificationFlight";
import {
  appendManagedObservedQualification,
  awaitNativeQualificationQuiescence,
  boundedChatReceipts,
  inspectBoundedChat,
} from "./deploymentQualificationRuntime";
import { assessDeploymentCapability } from "./deploymentQualificationPolicy";

const at = 1_800_000_000_000;
const hash = `sha256:${"f".repeat(64)}` as const;
const requestId = "05deba77-6a5a-450f-b554-682c883ef8f5";
const create = () => {
  const original = attachManagedLocalGguf(emptySelfHostedState(), {
    digest: `sha256:${"a".repeat(64)}`, displayName: "Qwen",
    material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
  });
  const resolved = resolveManagedLocalSelection(original.state, original.selectionId);
  if (resolved.status === "missing" || resolved.status === "not-managed")
    throw new Error("Invalid test deployment");
  const native = {
    installed: true, state: "Ready" as const, version: "b12248",
    epoch: "verified-epoch-a", processId: 7001, port: 62723,
    deploymentId: resolved.deployment.id,
    modelDigest: resolved.artifact.digest,
  };
  const observation = observedManagedFabric(original.state, original.selectionId, native, at);
  if (!observation?.observation) throw new Error("No native observation");
  return { ...original, resolved, native, observation };
};

function flight(text = MANAGED_QUALIFICATION_EXPECTED): QualificationFlightSnapshot {
  return {
    prepared: 1, systemContextDigest: hash, modelMessagesDigest: hash,
    textStarts: 1, textDeltas: 2, textEnds: 1, textChars: text.length,
    finishes: 1, metadataCount: 1, violations: [],
    native: { opens: 1, requestId: "inference-1", terminal: "completed" },
  };
}

function messages(sessionId: string, modelId: string, text: string): UIMessage[] {
  return [
    { id: "user-1", role: "user", parts: [{ type: "text", text: MANAGED_QUALIFICATION_PROMPT }] },
    {
      id: "assistant-1", role: "assistant",
      parts: [{ type: "step-start" }, { type: "text", text }],
      metadata: {
        clackActivity: {
          version: 1, omitted: 0,
          owner: { sessionId, runId: `${sessionId}:1`,
            workspaceId: null, agentId: "builtin:coder",
            modelId, providerId: "openai-compatible" },
          receipts: [
            { id: `request:${requestId}:awaiting-admission`,
              kind: "request", label: "Waiting for server...", at: at - 100 },
            { id: `request:${requestId}:generating`,
              kind: "request", label: "Generating...", at: at - 50 },
            { id: `request:${requestId}:completed`,
              kind: "request", label: "Request completed", at: at },
            { id: "answer:finish", kind: "response", label: "Response ended: stop", at },
          ],
        },
        clackAnswer: {
          version: 1, runId: `${sessionId}:1`, state: "complete",
          continuations: 0, repairs: 0,
          segments: [{
            id: "segment-1", previous: null, provider: "openai-compatible",
            model: modelId, startedAt: at - 200, endedAt: at,
            finish: "stop", inputTokens: 0, outputTokens: 0, pending: [],
          }],
        },
      },
    },
  ];
}

describe("LM2F bounded Clack Chat qualification: actual stream evidence", () => {
  it("only structured Clack-owned Chat activity/answer and parsed text can qualify", () => {
    const { selectionId } = create();
    const msgs = messages("qualify-s", selectionId, MANAGED_QUALIFICATION_EXPECTED);
    const inspected = inspectBoundedChat(msgs, "qualify-s", null, selectionId, flight());
    expect(inspected).toMatchObject({
      requestId, assistantText: MANAGED_QUALIFICATION_EXPECTED,
      chat: true, streaming: true, terminalCompletion: true, finish: "stop",
    });
    expect(inspectBoundedChat(msgs, "other-session", null, selectionId, flight())).toBeNull();
    const altered = structuredClone(msgs);
    (altered[1].metadata as any).clackActivity.owner.modelId = "other-deployment";
    expect(inspectBoundedChat(altered, "qualify-s", null, selectionId, flight())).toBeNull();
  });

  it("wrong generated text retains Chat/stream/completion evidence, but fails independent adherence", async () => {
    const v = create(), wrong = "A generated unrelated task.";
    const inspected = inspectBoundedChat(
      messages("qualify-s", v.selectionId, wrong), "qualify-s", null, v.selectionId, flight(wrong),
    );
    expect(inspected).toMatchObject({ chat: true, streaming: true, terminalCompletion: true });
    const receipts = await boundedChatReceipts(v.observation.fabric,
      v.resolved.deployment.id, v.observation.observation!, inspected!, flight(wrong), at);
    expect(receipts.map(r => r.capability)).toEqual([
      "chat", "streaming", "terminal-completion", "instruction-adherence",
    ]);
    expect(receipts.map(r => r.status)).toEqual(["verified", "verified", "verified", "failed"]);
    expect(JSON.stringify(receipts)).not.toContain(wrong);
    expect(JSON.stringify(receipts)).not.toContain(MANAGED_QUALIFICATION_PROMPT);
  });

  it("a completed Chat with no observed stream deltas remains Chat-qualified but NOT streaming-qualified", () => {
    const v = create(), snap = flight();
    snap.textDeltas = 0;
    const result = inspectBoundedChat(
      messages("qualify-s", v.selectionId, MANAGED_QUALIFICATION_EXPECTED),
      "qualify-s", null, v.selectionId, snap,
    );
    expect(result).toMatchObject({
      chat: true, streaming: false, terminalCompletion: true,
    });
  });

  it("extra provider requests, continuation, tool effects or system mismatch fail closed", () => {
    const v = create(), msgs = messages("qualify-s", v.selectionId, MANAGED_QUALIFICATION_EXPECTED);
    const extra = structuredClone(msgs);
    (extra[1].metadata as any).clackActivity.receipts.push({
      id: "request:19deba77-6a5a-450f-b554-682c883ef8f5:completed",
      kind: "request", label: "Request completed", at,
    });
    expect(inspectBoundedChat(extra, "qualify-s", null, v.selectionId, flight())).toBeNull();
    const badFlight = flight();badFlight.prepared = 2;
    expect(inspectBoundedChat(msgs, "qualify-s", null, v.selectionId, badFlight)).toBeNull();
    const tool = structuredClone(msgs);
    tool[1].parts.push({ type: "dynamic-tool", toolName: "write_file" } as any);
    expect(inspectBoundedChat(tool, "qualify-s", null, v.selectionId, flight())).toBeNull();
  });

  it("native CAS commit writes only receipts, never simulated process Ready/epoch", async () => {
    const v = create();
    const result = inspectBoundedChat(
      messages("qualify-s", v.selectionId, MANAGED_QUALIFICATION_EXPECTED),
      "qualify-s", null, v.selectionId, flight(),
    );
    const receipts = await boundedChatReceipts(
      v.observation.fabric, v.resolved.deployment.id, v.observation.observation!, result!, flight(), at);
    const originalRuntime = structuredClone(v.state.fabric!.runtimes);
    const originalHost = structuredClone(v.state.fabric!.hosts);
    const added = appendManagedObservedQualification(
      v.state, v.selectionId, v.resolved.identity, v.native, receipts, at,
    );
    expect(added.fabric!.runtimes).toEqual(originalRuntime);
    expect(added.fabric!.hosts).toEqual(originalHost);
    expect(added.fabric!.qualificationReceipts).toHaveLength(4);
    const current = observedManagedFabric(added, v.selectionId, v.native, at)!;
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "chat", current.observation, {}, at).state).toBe("Qualified");
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "instruction-adherence", current.observation,
      { personaId: "builtin:coder", systemContextDigest: hash }, at).state).toBe("Qualified");
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "native-tools", current.observation, {}, at).state).toBe("Unsupported");
  });

  it("new runtime epoch invalidates old receipts; original history is still saved", async () => {
    const v = create();
    const result = inspectBoundedChat(
      messages("qualify-s", v.selectionId, MANAGED_QUALIFICATION_EXPECTED),
      "qualify-s", null, v.selectionId, flight(),
    );
    const receipts = await boundedChatReceipts(v.observation.fabric,
      v.resolved.deployment.id, v.observation.observation!, result!, flight(), at);
    const saved = appendManagedObservedQualification(
      v.state, v.selectionId, v.resolved.identity, v.native, receipts, at);
    const newRuntime = { ...v.native, epoch: "new-epoch", processId: 7002 };
    const current = observedManagedFabric(saved, v.selectionId, newRuntime, at)!;
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "chat", current.observation, {}, at).state).toBe("Qualification Stale");
    expect(saved.fabric!.qualificationReceipts).toHaveLength(4);
    expect(() => appendManagedObservedQualification(
      v.state, v.selectionId, v.resolved.identity, newRuntime, receipts, at))
      .toThrow(/current execution identity/);
  });

  it("old on-disk managed runtime without terminal/adherence declarations can persist NEGATIVE evidence without fabric mutation", async () => {
    const v = create(), wrong = "<env>an unrelated environment echo</env>";
    const original = structuredClone(v.state);
    const savedRuntime = original.fabric!.runtimes.find(r => r.id === v.resolved.runtime.id)!;
    delete savedRuntime.capabilities["terminal-completion"];
    delete savedRuntime.capabilities["instruction-adherence"];
    const unchanged = structuredClone(original);
    const projection = observedManagedFabric(original, v.selectionId, v.native, at)!;
    expect(projection.observation).toBeDefined();
    expect(original).toEqual(unchanged);
    expect(assessDeploymentCapability(projection.fabric, projection.deploymentId,
      "terminal-completion", projection.observation, {}, at).state).toBe("Requires Qualification");
    const flightRecord = flight(wrong);
    const inspected = inspectBoundedChat(
      messages("qualify-s", v.selectionId, wrong), "qualify-s", null, v.selectionId, flightRecord,
    )!;
    const receipts = await boundedChatReceipts(projection.fabric,
      projection.deploymentId, projection.observation!, inspected, flightRecord, at);
    expect(receipts.map(r => r.status)).toEqual(["verified", "verified", "verified", "failed"]);
    const next = appendManagedObservedQualification(
      original, v.selectionId, v.resolved.identity, v.native, receipts, at,
    );
    expect(next.fabric?.qualificationReceipts).toHaveLength(4);
    expect(next.fabric?.runtimes).toEqual(unchanged.fabric?.runtimes);
    // All four PASS/PASS/PASS/FAIL receipts survive a real state envelope
    // round trip; the optional adherence failure must not roll back or erase
    // independently observed Chat, streaming and terminal completion.
    const reloaded = readSelfHostedState(JSON.parse(JSON.stringify(next)));
    expect(reloaded.fabric?.qualificationReceipts?.map(r =>
      r && typeof r === "object" && "status" in r ? r.status : null,
    )).toEqual(["verified", "verified", "verified", "failed"]);
    const current = observedManagedFabric(reloaded, v.selectionId, v.native, at)!;
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "chat", current.observation, {}, at).state).toBe("Qualified");
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "streaming", current.observation, {}, at).state).toBe("Qualified");
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "terminal-completion", current.observation, {}, at).state).toBe("Qualified");
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "instruction-adherence", current.observation,
      { personaId: "builtin:coder", systemContextDigest: hash }, at).state)
      .toBe("Qualification Failed");
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "json-schema", current.observation, {}, at).available).toBe(false);
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "grammar", current.observation, {}, at).available).toBe(false);
    expect(assessDeploymentCapability(current.fabric, current.deploymentId,
      "native-tools", current.observation, {}, at).state).toBe("Unsupported");

    // Never override explicit denial, even when the runtime matches by ID.
    const denied = structuredClone(original);
    denied.fabric!.runtimes.find(r => r.id === v.resolved.runtime.id)!
      .capabilities["terminal-completion"] = { status: "unsupported", source: "declared" };
    const deniedView = observedManagedFabric(denied, v.selectionId, v.native, at)!;
    expect(assessDeploymentCapability(deniedView.fabric, deniedView.deploymentId,
      "terminal-completion", deniedView.observation, {}, at).state).toBe("Unsupported");
    expect(() => appendManagedObservedQualification(
      denied, v.selectionId, v.resolved.identity, v.native, receipts, at,
    )).toThrow();
  });
});

describe("LM11 B03 independent native terminal/quiescence observation (offline)", () => {
  beforeEach(() => {
    // Model the SAME read-only native registry authority, never a separate
    // renderer boolean. A default positive test requires two native reads.
    vi.mocked(invoke).mockReset().mockResolvedValue(true);
  });
  it("requires one exact native terminal and stable drained session before CAS may start", async () => {
    const sessionId = "lm11-native-quiescence";
    const budget = new QualificationOperationDeadline(2_000);
    try {
      armDeploymentQualification(sessionId, "managed-scope", "builtin:coder", { operation: budget });
      observeDeploymentQualificationNative(sessionId, "request", "inference-31");
      observeDeploymentQualificationNative(sessionId, "terminal", "inference-31");
      budget.sdkSettled();
      expect(budget.state.nativeAcknowledged).toBe(false);
      await awaitNativeQualificationQuiescence(sessionId, budget);
      expect(budget.state).toMatchObject({
        sdkSettled: true, nativeAcknowledged: true, nativeQuiescent: true,
        persistence: "not-started",
      });
      budget.beginPersistence();
      expect(budget.state.persistence).toBe("pending");
    } finally {
      disarmDeploymentQualification(sessionId);
      budget.finish();
    }
  });

  it("native cancellation cannot be promoted into completed quiescence or a receipt", async () => {
    const sessionId = "lm11-native-cancelled";
    const budget = new QualificationOperationDeadline(2_000);
    try {
      armDeploymentQualification(sessionId, "managed-scope", "builtin:coder", { operation: budget });
      observeDeploymentQualificationNative(sessionId, "request", "inference-32");
      observeDeploymentQualificationNative(sessionId, "cancelled", "inference-32");
      budget.sdkSettled();
      await expect(awaitNativeQualificationQuiescence(sessionId, budget))
        .rejects.toThrow(/terminal|identity/);
      expect(() => budget.beginPersistence()).toThrow(/quiescent/);
    } finally {
      disarmDeploymentQualification(sessionId);
      budget.finish();
    }
  });
  it("a late native registry lease denies receipt promotion even after SDK and Channel complete", async () => {
    const sessionId = "lm11-native-unresolved-registry";
    const budget = new QualificationOperationDeadline(2_000);
    // The first actual native check passes; the second catches an unresolved
    // lease. Neither a terminal event nor the 50ms observation grants PASS.
    vi.mocked(invoke).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    try {
      armDeploymentQualification(sessionId, "managed-scope", "builtin:coder", { operation:budget });
      observeDeploymentQualificationNative(sessionId, "request", "inference-37");
      observeDeploymentQualificationNative(sessionId, "terminal", "inference-37");
      budget.sdkSettled();
      await expect(awaitNativeQualificationQuiescence(sessionId,budget))
        .rejects.toThrow(/Native registry still owned/);
      expect(budget.state.nativeQuiescent).toBe(false);
      expect(() => budget.beginPersistence()).toThrow(/quiescent/);
      expect(vi.mocked(invoke).mock.calls.map(([command])=>command))
        .toEqual(["ai_http_request_quiescent","ai_http_request_quiescent"]);
    } finally {
      disarmDeploymentQualification(sessionId);
      budget.finish();
    }
  });
});
