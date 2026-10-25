/** One isolated read-only GLM Agent production-path tier probe, not acceptance. */
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
  root: string; report: string; model: string; digest: string;
};
const abort = new AbortController();
const cutoff = setTimeout(() => abort.abort(), 540_000);
const profileRead = async () =>
  readSelfHostedState(new Map(await invoke<[string, unknown][]>("self_hosted_profiles_snapshot")).get("selfHostedInference"));
const output: Record<string, unknown> = {
  mode: "read-only-single-Agent-step", allowedTools: ["list_directory"],
  modelMatches: false, calibrationTiers: [], defaultProofContext: null,
  selectedTierProof: null, result: "not-started",
};
try {
  if (config.model !== "glm-4.7-flash:q4_K_M" ||
      config.digest !== "4475827791a269b02c8ec49b1c3bc1abb5846bacf3fae015b75d33986322d8f6")
    throw new Error("GLM-only exact model identity mismatch");
  await usePreferencesStore.getState().init();
  const client = createSelfHostedProbeClient();
  const snapshot = await client.refresh({
    endpointId: "real-qwen", selectedModelId: config.model, allowPrivateNetwork: true,
  });
  if (!snapshot.connected || snapshot.models.find(m => m.id === config.model)?.digest !== config.digest)
    throw new Error("Live Ollama digest did not match the approved candidate");
  output.modelMatches = true;
  await updateSelfHostedProfiles(state => saveSelfHostedModel(state, "real-qwen", config.model));
  let state = await profileRead();
  const profile = state.profiles.find(p => p.endpointId === "real-qwen" && p.transportModelId === config.model);
  if (!profile || profile.modelRevision !== config.digest || Object.keys(profile.overrides).length)
    throw new Error("A normal Automatic GLM profile with empty overrides is required");
  const calibrated = await calibrateModelContext({ state, profileId: profile.id, signal: abort.signal });
  output.calibrationStatus = calibrated?.status ?? "missing";
  state = await profileRead();
  const current = state.profiles.find(p => p.id === profile.id);
  if (!current) throw new Error("Qualified profile disappeared");
  const probed = await client.refresh({
    endpointId: profile.endpointId, selectedModelId: profile.transportModelId, allowPrivateNetwork: true,
  });
  const tiers = freshVerifiedContextTiers(state, current, probed);
  output.calibrationTiers = tiers;
  if (!tiers.includes(32768) || !tiers.includes(65536)) throw new Error("32K/65K fresh calibration unavailable");
  state = await ensureSelectedTools(state, selfHostedSelectionId(current), abort.signal);
  const ready = state.profiles.find(p => p.id === profile.id);
  if (!ready || !automaticAgentRecommendation(state, ready, 65536))
    throw new Error("Normal high-context native verification unavailable");
  output.defaultProofContext = 65536;
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
    },
  });
  let events = 0;
  for await (const part of result.fullStream) {
    if (++events > 400) throw new Error("Bounded probe exceeded streaming event limit");
    if (part.type === "error") throw part.error;
  }
  output.result = "completed";
  output.finishReason = await result.finishReason;
  output.streamEvents = events;
  const final = await profileRead();
  const finalProfile = final.profiles.find(p => p.id === profile.id);
  output.persistedTierProof = finalProfile?.agentToolTierProofs?.find(r =>
    r.context === 32768 && r.status === "verified") ? "verified:32768" : "absent";
  output.actualRemainingTiers = finalProfile
    ? freshVerifiedContextTiers(final, finalProfile, profileSnapshot(final, finalProfile)) : [];
} catch (error) {
  output.result = "blocked";
  output.errorKind = error instanceof Error ? error.name : "unknown";
  output.errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : null;
  output.errorMessage = error instanceof Error ? error.message.slice(0, 240) : "unknown";
} finally {
  clearTimeout(cutoff);
  const delivered = await fetch(config.report, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(output), signal: AbortSignal.timeout(7000),
  }).catch(() => null);
  if (!delivered?.ok) console.error("Probe result could not be persisted");
  await invoke("coworking_exit");
}
