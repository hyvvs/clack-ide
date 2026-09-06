import type { ModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";
import {
  resolveSelfHostedSelection,
  type SelfHostedEndpoint,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  createSelfHostedProbeClient,
  probeEvidenceIsFresh,
  type ProbeSnapshot,
  type ProbeOptions,
} from "@/modules/ai/lib/selfHostedProbe";
import { endpointAllowsPrivate } from "@/modules/ai/lib/selfHostedModels";

export function selfHostedProbeOptions(
  state: SelfHostedState,
  selectionId: string,
): ProbeOptions | null {
  const target = resolveSelfHostedSelection(state, selectionId);
  return target.status === "available"
    ? {
        endpointId: target.endpoint.id,
        selectedModelId: target.profile.transportModelId,
        allowPrivateNetwork: endpointAllowsPrivate(target.endpoint),
      }
    : null;
}

export async function readSelfHostedSnapshot(
  state: SelfHostedState,
  selectionId: string,
): Promise<ProbeSnapshot | null> {
  const options = selfHostedProbeOptions(state, selectionId);
  if (!options) return null;
  try {
    return await createSelfHostedProbeClient().read(options);
  } catch {
    return null;
  }
}

export function selfHostedCapabilities(
  endpoint: SelfHostedEndpoint,
  modelId: string,
  snapshot: ProbeSnapshot | null,
  now = Date.now(),
): ModelInputCapabilities {
  const model = snapshot?.models.find((m) => m.id === modelId);
  const evidence =
    model?.evidence.filter((e) =>
      probeEvidenceIsFresh(e, endpoint, snapshot, now),
    ) ?? [];
  const vision = evidence.find((e) => e.metric === "probe.vision")?.value;
  const tools = evidence.find(
    (e) => e.metric === "probe.trainedForTools",
  )?.value;
  // The compatible chat adapter serializes image_url and tool messages. Training
  // metadata cannot certify the deployed tool parser, so positive tools stay unknown.
  return {
    text:
      evidence.length && model?.chat === "unsupported"
        ? "unsupported"
        : "supported",
    image:
      vision === true
        ? "supported"
        : vision === false
          ? "unsupported"
          : "unknown",
    tools: tools === false ? "unsupported" : "unknown",
    document: "unsupported",
    audio: "unsupported",
    evidence: "server",
  };
}

export function serverModelDetails(
  endpoint: SelfHostedEndpoint,
  modelId: string,
  snapshot: ProbeSnapshot | null,
  now = Date.now(),
) {
  const model = snapshot?.models.find((m) => m.id === modelId);
  const evidence =
    model?.evidence.filter((e) =>
      probeEvidenceIsFresh(e, endpoint, snapshot, now),
    ) ?? [];
  const number = (metric: string) =>
    evidence
      .filter((e) => e.metric === metric && typeof e.value === "number")
      .map((e) => e.value as number);
  const loaded = number("probe.loadedContext");
  const configured = number("probe.configuredContext");
  const advertised = number("probe.advertisedContext");
  const format = (values: number[]) =>
    [...new Set(values)].map((v) => v.toLocaleString("en-US")).join(" / ");
  return {
    serverContext: loaded.length
      ? `${format(loaded)} tokens (loaded)`
      : configured.length
        ? `${format(configured)} tokens (reported)`
        : "Unknown",
    advertisedContext: advertised.length
      ? `${format(advertised)} tokens (model maximum, not current server context)`
      : "Unknown",
    loaded: evidence.find((e) => e.metric === "probe.loaded")?.value,
    verified: evidence.length > 0,
    capabilities: selfHostedCapabilities(endpoint, modelId, snapshot, now),
  };
}
