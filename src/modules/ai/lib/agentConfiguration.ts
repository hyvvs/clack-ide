import {
  captureEffort,
  effortProviderOptions,
  type EffortCapture,
} from "@/modules/ai/lib/reasoningEffort";
import { contextMetadata } from "@/modules/ai/lib/contextCalibrationTrust";
import {
  configuredToolState,
  verificationRecord,
  sameToolScope,
  toolScope,
} from "@/modules/ai/lib/toolVerification";
import { createToolRequestBudget, TOOL_VERIFICATION, type ToolConfiguration, type ToolRequestBudget } from "@/modules/ai/lib/toolVerificationSchema";
import type {
  SelfHostedProfile,
  SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";

const order = [
  "none",
  "minimal",
  "low",
  "medium",
  "on",
  "high",
  "xhigh",
  "max",
];
export function toolEffortCapture(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  configuration?: ToolConfiguration,
): EffortCapture {
  const endpoint = state.endpoints.find(
    (e) => e.id === profile.endpointId && e.deletedAt == null,
  );
  if (!endpoint) throw new Error("Model unavailable");
  const capture = captureEffort(
    profile.id,
    {
      providerId: "ollama",
      transportModelId: profile.transportModelId,
      selfHosted: {
        endpointId: endpoint.id,
        profileId: profile.id,
        configurationRevision: endpoint.configurationRevision,
        allowPrivateNetwork: !!endpoint.allowPrivateNetwork,
        credentialRequired: !!endpoint.credentialRef,
        credentialRef: endpoint.credentialRef,
      },
    },
    undefined,
    state,
  );
  if (!configuration) return capture;
  const explicit = { ...capture, choice: configuration.choice };
  const wire = effortProviderOptions(explicit).ollama?.think;
  if (wire !== configuration.wire)
    throw new Error("Agent reasoning configuration changed");
  return explicit;
}

// Provider omission is candidate zero. Only advertised, wire-distinct alternatives follow.
export function agentToolCandidates(
  state: SelfHostedState,
  profile: SelfHostedProfile,
): ToolConfiguration[] {
  const endpoint = state.endpoints.find(
    (e) => e.id === profile.endpointId && e.deletedAt == null,
  );
  if (
    !endpoint ||
    (endpoint.backendHint ?? endpoint.detectedBackend) !== "ollama"
  )
    return [];
  const capture = toolEffortCapture(state, profile);
  if (capture.capability.status !== "supported") return [];
  const defaultWire = contextMetadata(
    profile,
    endpoint,
    "thinkingDefault",
    Date.now(),
    300_000,
  );
  let candidates: ToolConfiguration[];
  try {
    candidates = order
      .filter((choice) => capture.capability.levels.includes(choice))
      .map((choice) => {
        const wire = effortProviderOptions({ ...capture, choice }).ollama?.think;
        if (typeof wire !== "boolean" && typeof wire !== "string")
          throw new Error("Invalid native reasoning control");
        return { choice, wire };
      });
  } catch {
    return [];
  }
  return candidates
    .sort(
      (a, b) => Number(b.wire === defaultWire) - Number(a.wire === defaultWire),
    )
    .slice(0, 2);
}

export function automaticAgentRecommendation(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  context?: number,
  now = Date.now(),
) {
  if (
    profile.toolVerification &&
    configuredToolState(state, profile, undefined, now, context) === "Verified"
  )
    return {
      record: profile.toolVerification,
      configuration: undefined,
      choice: "automatic",
    };
  for (const configuration of agentToolCandidates(state, profile)) {
    const record = verificationRecord(profile, configuration);
    if (
      record?.confirmation &&
      record.confirmation.at <= now &&
      record.confirmation.expiresAt > now &&
      configuredToolState(state, profile, configuration, now, context) ===
        "Verified"
    )
      return { record, configuration, choice: configuration.choice };
  }
}

export function applyAgentRecommendation(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  context?: number,
  captured?: EffortCapture,
) {
  if (captured?.unresolvedExplicitChoice)
    throw new Error("The saved explicit reasoning choice needs revalidation; Automatic recovery cannot replace it.");
  if (captured && captured.choice !== "automatic") return captured;
  const selected = automaticAgentRecommendation(state, profile, context);
  if (!selected)
    throw new Error(
      "Automatic Agent configuration is not verified. Use Chat Only or verify tools in model settings.",
    );
  if (!selected.configuration)
    return captured ?? toolEffortCapture(state, profile);
  const effective = toolEffortCapture(state, profile, selected.configuration);
  return {
    ...effective,
    key: captured?.key ?? effective.key,
    automaticAgentRecommendation: selected.record.id,
  };
}

export async function resolveAutomaticAgentTools(
  options: { profileId: string; signal: AbortSignal; force?: boolean },
  deps: {
    refresh: () => Promise<SelfHostedState>;
    inspect: () => Promise<void>;
    context: (state: SelfHostedState, profile: SelfHostedProfile) => number;
    verify: (
      configuration?: ToolConfiguration,
      force?: boolean,
      requestBudget?: ToolRequestBudget,
    ) => Promise<unknown>;
  },
) {
  options.signal.throwIfAborted();
  let state = await deps.refresh();
  await deps.inspect();
  const get = () => {
    const p = state.profiles.find((p) => p.id === options.profileId);
    if (!p) throw new Error("Model unavailable");
    return p;
  };
  let profile = get();
  const endpoint = state.endpoints.find(
    (e) => e.id === profile.endpointId && e.deletedAt == null,
  );
  if (
    !endpoint ||
    !state.inventories?.some(
      (i) =>
        i.endpointId === endpoint.id &&
        i.configurationRevision === endpoint.configurationRevision &&
        i.connected,
    )
  )
    return;
  const scope = toolScope(profile, endpoint),
    context = deps.context(state, profile);
  if (!scope) return;
  const selected = automaticAgentRecommendation(state, profile, context);
  const candidates = agentToolCandidates(state, profile);
  let requests = 0;
  const requestBudget = createToolRequestBudget();
  const verify = async (configuration?: ToolConfiguration, force?: boolean) => {
    if (++requests > TOOL_VERIFICATION.maxRequests)
      throw new Error("Automatic Agent verification bound exceeded");
    options.signal.throwIfAborted();
    await deps.verify(configuration, force, requestBudget);
    options.signal.throwIfAborted();
    state = await deps.refresh();
    await deps.inspect();
    profile = get();
    const currentEndpoint = state.endpoints.find(
      (e) => e.id === profile.endpointId,
    );
    if (
      !currentEndpoint ||
      !sameToolScope(scope, toolScope(profile, currentEndpoint)) ||
      deps.context(state, profile) !== context
    )
      throw new Error("Automatic Agent settings changed during verification");
  };
  if (selected) {
    if (options.force) await verify(selected.configuration, true);
    return;
  }
  await verify(
    undefined,
    options.force &&
      configuredToolState(state, profile, undefined, Date.now(), context) !==
        "Needs attention",
  );
  if (automaticAgentRecommendation(state, profile, context)) return;
  if (
    configuredToolState(state, profile, undefined, Date.now(), context) !==
    "Needs attention"
  )
    return;
  for (const configuration of candidates) {
    const verdict = configuredToolState(
      state,
      profile,
      configuration,
      Date.now(),
      context,
    );
    if (
      verdict === "Needs attention" ||
      verdict === "Unsupported" ||
      verdict === "Incompatible"
    )
      continue;
    const previous = verificationRecord(profile, configuration);
    if (previous?.status === "incomplete" && previous.retryAfter > Date.now())
      return;
    await verify(configuration);
    if (automaticAgentRecommendation(state, profile, context)) return;
    const current = configuredToolState(
      state,
      profile,
      configuration,
      Date.now(),
      context,
    );
    if (current === "Verified") {
      await verify(configuration, true);
      if (automaticAgentRecommendation(state, profile, context)) return;
      if (
        configuredToolState(
          state,
          profile,
          configuration,
          Date.now(),
          context,
        ) !== "Needs attention"
      )
        return;
    } else if (current !== "Needs attention") return;
  }
}
