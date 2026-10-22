/** R5e: ONE production SDK doGenerate -> preflight -> Tauri -> Ollama request. */

import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import type { OllamaRouteDecision } from "@/modules/ai/lib/requestPreflight";
import {
  selfHostedSelectionId,
  selfHostedTransportIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { readToolProfiles } from "@/modules/ai/lib/toolVerificationRuntime";
import { flushR5bReceipts } from "@/test/r5cReceiptFlush";
import { Channel, invoke } from "@tauri-apps/api/core";
import { generateText } from "ai";

const url = new URL(location.href).searchParams.get("configuration");
if (!url) throw new Error("R5e isolated configuration missing");
const config = (await (await fetch(url)).json()) as {
  report: string;
  events: string;
  digest: string;
  model: string;
  endpoint: string;
};
const receipts: OllamaRouteDecision[] = [];
let eventWrites = Promise.resolve();
const saveEvent = (event: Record<string, unknown>) => {
  eventWrites = eventWrites.then(async () => {
    const response = await fetch(config.events, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!response.ok || (await response.json()).ok !== true)
      throw new Error("R5e incremental evidence not persisted");
  });
};
// Acceptance-only observation *after* the real frontend Channel listener
// returns. Never log response content, headers, request URL, prompt or model.
const channelDescriptor = Object.getOwnPropertyDescriptor(
  Channel.prototype,
  "onmessage",
);
if (channelDescriptor?.set && channelDescriptor.get) {
  Object.defineProperty(Channel.prototype, "onmessage", {
    ...channelDescriptor,
    set(previous: (event: Record<string, unknown>) => void) {
      channelDescriptor.set?.call(this, (event: Record<string, unknown>) => {
        previous.call(this, event);
        const match =
          typeof event.requestId === "string"
            ? /^inference-(1)$/.exec(event.requestId)
            : null;
        if (
          match &&
          ["headers", "chunk", "settled"].includes(String(event.kind))
        ) {
          saveEvent({
            kind: "frontend-native-event",
            ordinal: Number(match[1]),
            phase: event.kind,
            bytes:
              event.kind === "chunk" && Array.isArray(event.bytes)
                ? event.bytes.length
                : 0,
          });
        }
      });
    },
  });
}
let submitted = 0;
const evidence: Record<string, unknown> = {
  kind: "r5e-result",
  preflight: receipts,
  inferenceAttempts: 0,
  cloudInference: 0,
  fallback: "never",
  responses: [],
};
try {
  const initial = await readToolProfiles();
  const endpoint = initial.endpoints.find(
    (e) =>
      e.id === "real-qwen" &&
      new URL(e.baseURL).href === new URL(config.endpoint).href &&
      !e.ssh &&
      !e.credentialRef &&
      (e.backendHint ?? e.detectedBackend) === "ollama" &&
      e.deletedAt == null,
  );
  if (!endpoint) throw new Error("Saved local endpoint identity unavailable");
  const probe = await createSelfHostedProbeClient().refresh({
    endpointId: endpoint.id,
    selectedModelId: config.model,
    allowPrivateNetwork: true,
  });
  if (
    !probe.connected ||
    probe.models.find((m) => m.id === config.model)?.digest !== config.digest
  )
    throw new Error("Live model identity or connection changed");
  const state = await readToolProfiles();
  const profile = state.profiles.find(
    (p) =>
      p.endpointId === endpoint.id &&
      p.transportModelId === config.model &&
      p.modelRevision === config.digest &&
      Object.keys(p.overrides).length === 0,
  );
  if (!profile) throw new Error("Original saved Automatic profile unavailable");
  const selection = selfHostedSelectionId(profile);
  const identity = selfHostedTransportIdentity(selection, state);
  if (!identity || identity.transportModelId !== config.model)
    throw new Error("Model-picker binding unavailable");
  const reasoning = captureEffort(selection, identity, undefined, state);
  if (reasoning.choice !== "automatic")
    throw new Error("Reasoning setting is not Automatic");
  const model = await buildConfiguredLanguageModel(
    selection,
    EMPTY_PROVIDER_KEYS,
    {
      selfHostedInference: state,
      capturedModelIdentity: identity,
      reasoning,
      onOllamaRouteDecision: (decision) => {
        receipts.push(decision);
        saveEvent({ kind: "preflight-decision", ...decision });
      },
      inferenceScope: {
        sessionId: "r5e-observation",
        runId: "r5e-one-run",
        isCurrent: () => true,
      },
    },
  );
  Object.assign(evidence, {
    endpointConfigurationRevision: endpoint.configurationRevision,
    stateRevision: state.revision,
    modelDigestMatches: true,
    reasoningChoice: reasoning.choice,
    requestCap: 1,
  });
  const responses = evidence.responses as Record<string, unknown>[];
  for (let i = 0; i < 1; i++) {
    // Native IPC records the actual dispatch separately; no tools, source writes,
    // application task, continuation, fallback or cloud destination.
    submitted++;
    saveEvent({ kind: "request-started", ordinal: i + 1 });
    try {
      const result = await generateText({
        model,
        prompt: "Reply with the single word OK.",
        maxOutputTokens: 64,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(30000),
      });
      responses.push({
        number: i + 1,
        outcome: "provider-completed",
        finishReason: result.finishReason,
        responseTokens: result.usage?.outputTokens ?? null,
      });
      saveEvent({
        kind: "request-completed",
        ordinal: i + 1,
        finishReason: result.finishReason,
      });
    } catch (error) {
      responses.push({
        number: i + 1,
        outcome: "rejected-or-failed",
        code:
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : null,
        type: error instanceof Error ? error.name : "unknown",
      });
      const kind =
        error instanceof Error && error.name === "TimeoutError"
          ? "request-timed-out"
          : error instanceof Error && error.name === "AbortError"
            ? "request-cancelled"
            : "request-failed";
      saveEvent({ kind, ordinal: i + 1 });
      break; // Do not retry any failed request or obscure its original cause.
    }
  }
  evidence.ok =
    responses.length > 0 &&
    responses.every((r) => r.outcome === "provider-completed");
} catch (error) {
  evidence.ok = false;
  evidence.setupErrorType = error instanceof Error ? error.name : "unknown";
  evidence.setupErrorCode =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;
} finally {
  evidence.inferenceAttempts = submitted;
  evidence.incrementalReceiptStatus = await flushR5bReceipts(eventWrites);
  try {
    // The owning runner alone decides whether a final receipt was accepted.
    // A non-2xx response cannot be promoted into a passed report.
    const response = await fetch(config.report, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(evidence),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || (await response.json()).ok !== true)
      document.body.dataset.receiptAck = "failed";
  } finally {
    await invoke("coworking_exit");
  }
}
