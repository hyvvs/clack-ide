import { Channel, invoke } from "@tauri-apps/api/core";
import { runRealLocalProduct } from "@/test/realLocalProductAcceptance";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { ensureSelectedContext } from "@/modules/ai/lib/contextCalibrationRuntime";
import { ensureSelectedTools, readToolProfiles } from "@/modules/ai/lib/toolVerificationRuntime";
import { applyAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { effortProviderOptions } from "@/modules/ai/lib/reasoningEffort";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";
import { setAgentPermissionProfiles } from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useChatStore, chats } from "@/modules/ai/store/chatStore";

const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Explicit isolated configuration required");
const config = await (await fetch(configuration)).json();
const model: string = config.realProduct.modelId;
const digest: string = config.realProduct.modelDigest;
if (!["qwen3-coder:30b", "nemotron-3.5-lightning:30b-a3b-q4_K_M"].includes(model) || !/^[a-f0-9]{64}$/.test(digest) || config.realProduct.reasoningChoice !== "automatic" || config.realProduct.maxOutput !== undefined)
  throw new Error("Only the production Automatic configuration is authorized");
let pending = Promise.resolve();
const emit = (event: Record<string, unknown>) => {
  pending = pending.then(async () => {
    const response = await fetch(new URL("/evidence", config.report), { method: "POST", body: JSON.stringify(event) });
    if (!response.ok) throw new Error("Evidence persistence failed");
  });
};
const descriptor = Object.getOwnPropertyDescriptor(Channel.prototype, "onmessage");
if (!descriptor?.set || !descriptor.get) throw new Error("Native observation unavailable");
Object.defineProperty(Channel.prototype, "onmessage", { ...descriptor, set(previous: (event: Record<string, unknown>) => void) {
  descriptor.set?.call(this, (event: Record<string, unknown>) => {
    if (typeof event.requestId === "string" && event.requestId.startsWith("inference-"))
      emit({ kind: "hardened-native-event", at: Date.now(), event });
    previous.call(this, event);
  });
} });
let readiness: unknown;
let result: Record<string, unknown>;
let stage = "readiness";
try {
  const saved = await readToolProfiles();
  const endpoint = saved.endpoints.find(e => e.id === "real-qwen" && new URL(e.baseURL).href === new URL(config.server).href &&
    (e.backendHint ?? e.detectedBackend) === "ollama" && e.deletedAt == null);
  if (!endpoint) throw new Error("Existing configured acceptance connection required");
  await createSelfHostedProbeClient().refresh({ endpointId: endpoint.id, selectedModelId: model, allowPrivateNetwork: true });
  let state = await readToolProfiles();
  const initial = state.profiles.find(p => p.transportModelId === model);
  if (!initial || initial.modelRevision !== digest) throw new Error("Exact installed model digest changed");
  const before = modelOnboarding(state, initial);
  emit({ kind: "readiness-start", at: Date.now(), model, digest, before, profile: initial });
  const signal = new AbortController().signal;
  state = await ensureSelectedContext(state, selfHostedSelectionId(initial), signal);
  state = await ensureSelectedTools(state, selfHostedSelectionId(initial), signal);
  state = await readToolProfiles();
  const profile = state.profiles.find(p => p.id === initial.id);
  if (!profile || profile.modelRevision !== digest || Object.keys(profile.overrides).length)
    throw new Error("Automatic profile ownership or override invariant failed");
  const view = modelOnboarding(state, profile);
  if (view?.tools !== "Verified" || view.status !== "Ready") throw new Error("Production Automatic tool readiness unavailable");
  const effective = effortProviderOptions(applyAgentRecommendation(state, profile, view.context.recommended));
  readiness = { readyAt: Date.now(), model, digest, before, after: view, profile, effective, context: view.context,
    endpoint, cloudInference: 0, fallback: "never" };
  emit({ kind: "mission-readiness", ...(readiness as Record<string, unknown>) });
  if (config.realProduct.readinessOnly) {
    result = { ok: true, readiness, settings: state, sessions: [], conversations: [] };
  } else {
  const permissions = { "builtin:coder": { mode: "trusted-workspace" as const, categories: {} } };
  await setAgentPermissionProfiles(permissions);
  usePreferencesStore.setState({ selfHostedInference: state, agentPermissionProfiles: permissions });
  await pending;
  stage = "mission";
  const startedAt = Date.now();
  const effects = new Map<string, string>();
  const monitor = setInterval(() => {
    for (const [sessionId, chat] of chats) {
      for (const message of chat.messages) {
        for (const part of message.parts) {
          if (!part.type.startsWith("tool-") || !("toolCallId" in part)) continue;
          const key = `${sessionId}:${part.toolCallId}`;
          const value = JSON.stringify(part);
          if (effects.get(key) === value) continue;
          effects.set(key, value);
          emit({ kind: "tool-state", at: Date.now(), sessionId, messageId: message.id, part });
        }
      }
    }
  }, 250);
  try {
    result = { ok: true, ...(await runRealLocalProduct(config)), readiness, missionStartedAt: startedAt };
  } finally { clearInterval(monitor); }
  }
} catch (error) {
  result = { ok: false, stage, error: String(error), stack: error instanceof Error ? error.stack : undefined,
    readiness, sessions: useChatStore.getState().sessions, settings: await readToolProfiles(),
    conversations: [...chats].map(([id, chat]) => ({ id, messages: chat.messages })) };
}
await pending;
await fetch(config.report, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
await invoke("coworking_exit");
