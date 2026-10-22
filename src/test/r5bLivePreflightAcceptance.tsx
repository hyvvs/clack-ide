/** R5b: only the existing production SDK -> preflight -> Tauri -> Ollama route. */
import { invoke } from "@tauri-apps/api/core";
import { generateText } from "ai";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { captureEffort } from "@/modules/ai/lib/reasoningEffort";
import {
  selfHostedSelectionId,
  selfHostedTransportIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { readToolProfiles } from "@/modules/ai/lib/toolVerificationRuntime";
import type { OllamaRouteDecision } from "@/modules/ai/lib/requestPreflight";

const url = new URL(location.href).searchParams.get("configuration");
if (!url) throw new Error("R5b isolated configuration missing");
const config = await (await fetch(url)).json() as {
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
    const response = await fetch(config.events, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
    if (!response.ok) throw new Error("R5b incremental evidence not persisted");
  });
};
let submitted = 0;
const evidence: Record<string, unknown> = { kind: "r5b-result", preflight: receipts, inferenceAttempts: 0, cloudInference: 0, fallback: "never", responses: [] };
try {
  const initial = await readToolProfiles();
  const endpoint = initial.endpoints.find(e => e.id === "real-qwen" &&
    new URL(e.baseURL).href === new URL(config.endpoint).href &&
    !e.ssh && !e.credentialRef && (e.backendHint ?? e.detectedBackend) === "ollama" && e.deletedAt == null);
  if (!endpoint) throw new Error("Saved local endpoint identity unavailable");
  const probe = await createSelfHostedProbeClient().refresh({ endpointId: endpoint.id, selectedModelId: config.model, allowPrivateNetwork: true });
  if (!probe.connected || probe.models.find(m => m.id === config.model)?.digest !== config.digest)
    throw new Error("Live model identity or connection changed");
  const state = await readToolProfiles();
  const profile = state.profiles.find(p => p.endpointId === endpoint.id && p.transportModelId === config.model &&
    p.modelRevision === config.digest && Object.keys(p.overrides).length === 0);
  if (!profile) throw new Error("Original saved Automatic profile unavailable");
  const selection = selfHostedSelectionId(profile);
  const identity = selfHostedTransportIdentity(selection, state);
  if (!identity || identity.transportModelId !== config.model) throw new Error("Model-picker binding unavailable");
  const reasoning = captureEffort(selection, identity, undefined, state);
  if (reasoning.choice !== "automatic") throw new Error("Reasoning setting is not Automatic");
  const model = await buildConfiguredLanguageModel(selection, EMPTY_PROVIDER_KEYS, {
    selfHostedInference: state,
    capturedModelIdentity: identity,
    reasoning,
    onOllamaRouteDecision: (decision) => {
      receipts.push(decision);
      saveEvent({ kind: "preflight-decision", ...decision });
    },
    inferenceScope: { sessionId: "r5b-observation", runId: "r5b-one-run", isCurrent: () => true },
  });
  Object.assign(evidence, {
    endpointConfigurationRevision: endpoint.configurationRevision,
    stateRevision: state.revision,
    modelDigestMatches: true,
    reasoningChoice: reasoning.choice,
    requestCap: 2,
  });
  const responses = evidence.responses as Record<string, unknown>[];
  for (let i = 0; i < 2; i++) {
    // Native IPC records the actual dispatch separately; no tools, source writes,
    // application task, continuation, fallback or cloud destination.
    submitted++;
    saveEvent({ kind: "request-started", ordinal: i + 1 });
    try {
      const result = await generateText({ model, prompt: "Reply with the single word OK.", maxOutputTokens: 64, maxRetries: 0, abortSignal: AbortSignal.timeout(30000) });
      responses.push({ number: i + 1, outcome: "provider-completed", finishReason: result.finishReason, responseTokens: result.usage?.outputTokens ?? null });
      saveEvent({ kind: "request-completed", ordinal: i + 1, finishReason: result.finishReason });
    } catch (error) {
      responses.push({ number: i + 1, outcome: "rejected-or-failed", code: error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null, type: error instanceof Error ? error.name : "unknown" });
      saveEvent({ kind: "request-failed", ordinal: i + 1 });
      break; // Do not retry any failed request or obscure its original cause.
    }
  }
  evidence.ok = responses.length > 0 && responses.every(r => r.outcome === "provider-completed");
} catch (error) {
  evidence.ok = false;
  evidence.setupErrorType = error instanceof Error ? error.name : "unknown";
  evidence.setupErrorCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
} finally {
  evidence.inferenceAttempts = submitted;
  await eventWrites.catch(() => undefined);
  await fetch(config.report, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(evidence) });
  await invoke("coworking_exit");
}
