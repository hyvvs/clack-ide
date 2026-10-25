/** Second and final authorized isolated GLM trace; diagnostic only, never acceptance. */
import { invoke } from "@tauri-apps/api/core";
import { calibrateModelContext } from "@/modules/ai/lib/contextCalibrationRuntime";
import { freshVerifiedContextTiers } from "@/modules/ai/lib/minimumSafeContext";
import { createSelfHostedProbeClient } from "@/modules/ai/lib/selfHostedProbe";
import { readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { saveSelfHostedModel, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { ensureSelectedTools } from "@/modules/ai/lib/toolVerificationRuntime";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { runAgentStream } from "@/modules/ai/lib/agent";
import { automaticAgentRecommendation } from "@/modules/ai/lib/agentConfiguration";
import { profileSnapshot } from "@/modules/ai/lib/modelOnboarding";
import type { ToolContext } from "@/modules/ai/tools/context";

const url = new URL(location.href).searchParams.get("configuration");
if (!url) throw new Error("Tier probe configuration missing");
const config = await (await fetch(url)).json() as {
  root: string; report: string; stage: string; model: string; digest: string;
};
let traceQueue = Promise.resolve();
const mark = (stage: string, details: Record<string, unknown> = {}) => {
  const row = { at: Date.now(), stage, ...details };
  traceQueue = traceQueue.then(async () => {
    await fetch(config.stage, {method: "POST", headers: {"content-type":"application/json"},
      body: JSON.stringify(row), signal: AbortSignal.timeout(5000)});
  }).catch(() => {});
};
mark("webview-module-loaded");
const abort = new AbortController();
const cutoff = setTimeout(() => { mark("webview-deadline-abort"); abort.abort(); }, 540_000);
const profileRead = async () =>
  readSelfHostedState(new Map(await invoke<[string, unknown][]>("self_hosted_profiles_snapshot")).get("selfHostedInference"));
const output: Record<string, unknown> = {
  mode: "read-only-single-Agent-step", allowedTools: ["list_directory"],
  modelMatches: false, calibrationTiers: [], defaultProofContext: null,
  selectedTierProof: null, result: "not-started",
};
try {
  mark("profile-init-start");
  if (config.model !== "glm-4.7-flash:q4_K_M" ||
      config.digest !== "4475827791a269b02c8ec49b1c3bc1abb5846bacf3fae015b75d33986322d8f6")
    throw new Error("GLM-only exact model identity mismatch");
  await usePreferencesStore.getState().init();
  mark("profile-init-end");
  const client = createSelfHostedProbeClient();
  const snapshot = await client.refresh({
    endpointId: "real-qwen", selectedModelId: config.model, allowPrivateNetwork: true,
  });
  if (!snapshot.connected || snapshot.models.find(m => m.id === config.model)?.digest !== config.digest)
    throw new Error("Live Ollama digest did not match the approved candidate");
  output.modelMatches = true;
  mark("live-model-identity-confirmed");
  await updateSelfHostedProfiles(state => saveSelfHostedModel(state, "real-qwen", config.model));
  let state = await profileRead();
  const profile = state.profiles.find(p => p.endpointId === "real-qwen" && p.transportModelId === config.model);
  if (!profile || profile.modelRevision !== config.digest || Object.keys(profile.overrides).length)
    throw new Error("A normal Automatic GLM profile with empty overrides is required");
  mark("calibration-start", {profileId: profile.id});
  const calibrated = await calibrateModelContext({
    state, profileId: profile.id, signal: abort.signal,
    onBoundary: stage => mark("calibration-boundary", {boundary: stage}),
    onProgress: record => mark("calibration-commit-and-progress", {
      status: record.status, highest: record.highest, epoch: record.scope.runtimeEpoch,
      providerVersion: record.scope.providerVersion,
      attempts: record.attempts.map(a => ({context:a.context, outcome:a.outcome, loaded:a.loaded, finish:a.finish})),
    }),
  });
  mark("calibration-returned", {status:calibrated?.status ?? "missing"});
  output.calibrationStatus = calibrated?.status ?? "missing";
  state = await profileRead();
  const current = state.profiles.find(p => p.id === profile.id);
  if (!current) throw new Error("Qualified profile disappeared");
  const probed = await client.refresh({
    endpointId: profile.endpointId, selectedModelId: profile.transportModelId, allowPrivateNetwork: true,
  });
  const tiers = freshVerifiedContextTiers(state, current, probed);
  output.calibrationTiers = tiers;
  mark("fresh-calibration-tiers", {tiers});
  if (!tiers.includes(32768) || !tiers.includes(65536)) throw new Error("32K/65K fresh calibration unavailable");
  mark("normal-native-verification-start");
  state = await ensureSelectedTools(state, selfHostedSelectionId(current), abort.signal);
  const ready = state.profiles.find(p => p.id === profile.id);
  if (!ready || !automaticAgentRecommendation(state, ready, 65536))
    throw new Error("Normal high-context native verification unavailable");
  output.defaultProofContext = 65536;
  mark("normal-native-verification-returned", {context:65536, proofId: ready.toolVerification?.id ?? null});
  const readonlyContext: ToolContext = {
    getCwd: () => config.root, getWorkspaceRoot: () => config.root,
    getWorkspaceId: () => "local:" + config.root,
    getSessionId: () => "glm-tier-probe",
    getAgentId: () => "builtin:coder",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => true,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    peerRemainingSteps: () => 1,
    readCache: new Map(),
  };
  const user = "Use only the read-only list_directory native tool to inspect the empty probe workspace. Do not write, install, build, edit or delete anything. Execute at most one read-only tool call and then stop. " +
    "Existing read-only context: " + "previous state retained. ".repeat(400);
  mark("agent-setup-start");
  const result = await runAgentStream({
    modelId: selfHostedSelectionId(ready),
    keys: EMPTY_PROVIDER_KEYS,
    selfHostedInference: state,
    toolContext: readonlyContext,
    mandatoryTools: ["list_directory"],
    abortSignal: abort.signal,
    inferenceScope: {
      sessionId: "glm-tier-probe", runId: crypto.randomUUID(),
      isCurrent: () => !abort.signal.aborted,
    },
    agentPersona: { name: "Read-only context probe",
      instructions: "This is a bounded read-only native-tool probe. Never write project files or build an application." },
    uiMessages: [{ id: "probe-user", role: "user", parts: [{ type: "text", text: user }] }],
    onSelfHostedPrepared: (captured, proofId) => {
      const p = captured.profiles.find(p => p.id === profile.id);
      const primary = p?.toolVerification;
      const primaryContext = primary ? (primary.id === proofId ? primary.context : null) : null;
      output.selectedTierProof = p?.agentToolTierProofs?.find(r => r.id === proofId)?.context ??
        primaryContext;
      output.selectedProofIdPresent = !!proofId;
      const proof = p?.agentToolTierProofs?.find(r => r.id === proofId);
      output.selectedProofScope = proof ? {
        context: proof.context, scope: proof.scope, status: proof.status, outcome:proof.outcome,
      } : null;
      mark("agent-tier-proof-selected", {context:output.selectedTierProof, proofId:proofId ?? null,
        scope:proof?.scope ?? null});
    },
    onRequestPrepared: request => {
      output.preparedAgentRequest = {tools:request.tools, output:request.output};
      mark("agent-request-prepared", {tools:request.tools, output:request.output});
      if (request.tools.some(name => name !== "list_directory") || !request.tools.includes("list_directory"))
        abort.abort(new Error("Read-only Agent exposure guard"));
    },
  });
  mark("agent-stream-returned");
  let events = 0;
  for await (const part of result.fullStream) {
    if (++events > 400) throw new Error("Bounded probe exceeded streaming event limit");
    if (part.type === "error") throw part.error;
    if (part.type === "tool-call") {
      output.agentStructuredToolCall = {name:part.toolName, id:part.toolCallId};
      mark("agent-structured-tool-call", {toolName:part.toolName, id:part.toolCallId});
      if (part.toolName !== "list_directory") throw new Error("Unexpected native Agent tool");
    }
    if (part.type === "tool-result") {
      const matching = part.toolName === "list_directory" &&
        part.toolCallId === (output.agentStructuredToolCall as {id?:string}|undefined)?.id;
      const resultValue = part.output as unknown;
      const isError = resultValue !== null && typeof resultValue === "object" &&
        ("error" in resultValue || ("success" in resultValue && resultValue.success === false));
      output.agentToolResult = {name:part.toolName, matching, isError, outputKind:typeof resultValue};
      mark("agent-native-tool-result", {name:part.toolName, matching, isError});
      if (!matching || isError) throw new Error("Read-only Agent tool result invalid");
      output.result = "native-tool-observed";
      abort.abort(new Error("Authorized one-tool observation completed"));
      break;
    }
  }
  if (output.result !== "native-tool-observed") {
    output.result = "completed-without-tool";
    output.finishReason = await result.finishReason;
  }
  output.streamEvents = events;
  const final = await profileRead();
  const finalProfile = final.profiles.find(p => p.id === profile.id);
  output.persistedTierProof = finalProfile?.agentToolTierProofs?.find(r =>
    r.context === 32768 && r.status === "verified") ? "verified:32768" : "absent";
  const proof = finalProfile?.agentToolTierProofs?.find(r => r.context === 32768);
  output.persistedTierScope = proof?.scope ?? null;
  output.persistedTierNativeOutcome = proof?.outcome ?? null;
  mark("persisted-exact-tier-proof-read", {context:proof?.context ?? null,
    status:proof?.status ?? null, scope:proof?.scope ?? null});
  output.actualRemainingTiers = finalProfile
    ? freshVerifiedContextTiers(final, finalProfile, profileSnapshot(final, finalProfile)) : [];
} catch (error) {
  mark("webview-probe-blocked", {errorKind:error instanceof Error ? error.name : "unknown"});
  output.result = "blocked";
  output.errorKind = error instanceof Error ? error.name : "unknown";
  output.errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : null;
  output.errorMessage = error instanceof Error ? error.message.slice(0, 240) : "unknown";
} finally {
  clearTimeout(cutoff);
  mark("webview-report-start", {result: output.result});
  await traceQueue;
  const delivered = await fetch(config.report, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(output), signal: AbortSignal.timeout(7000),
  }).catch(() => null);
  if (!delivered?.ok) console.error("Probe result could not be persisted");
  mark("webview-exit-invoke", {delivered:!!delivered?.ok});
  await traceQueue;
  await invoke("coworking_exit");
}
