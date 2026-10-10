import type { SessionMeta } from "@/modules/ai/lib/sessions";
import {
  describeConnectionAddress,
  modelConnectionLabel,
} from "@/modules/ai/lib/connectionPresentation";
import { resolveModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import {
  freshProviderModelEvidence,
  type ProviderModelEvidence,
} from "@/modules/ai/lib/providerModelEvidence";
import { resolveModelInputCapabilities } from "@/modules/ai/lib/modelCapabilities";

export function chatConnectionSummary(
  session: SessionMeta | undefined,
  settings: Parameters<typeof modelConnectionLabel>[1],
  capturedEvidence?: ProviderModelEvidence,
) {
  const running = session?.run?.state === "running";
  const selection = running ? session.run?.modelId : session?.profile?.modelId;
  let identity: ReturnType<typeof resolveModelTransportIdentity> | null = null;
  try {
    if (running) {
      const run = session.run;
      if (run?.providerId && run.transportModelId)
        identity = {
          providerId: run.providerId,
          transportModelId: run.transportModelId,
          endpointBaseURL: run.endpointBaseURL,
          customEndpointId: run.customEndpointId,
          selfHosted: run.selfHosted,
        };
    } else if (selection)
      identity = resolveModelTransportIdentity(selection, settings);
  } catch {
    /* Unknown configuration never substitutes another route. */
  }
  const cloud =
    identity &&
    [
      "openai",
      "anthropic",
      "google",
      "xai",
      "cerebras",
      "groq",
      "deepseek",
      "mistral",
      "openrouter",
    ].includes(identity.providerId);
  const destination = running
    ? identity?.endpointBaseURL
      ? `${describeConnectionAddress(identity.endpointBaseURL).label}: ${describeConnectionAddress(identity.endpointBaseURL).address}`
      : cloud
        ? "Cloud connection"
        : "Destination unknown"
    : selection
      ? modelConnectionLabel(selection, settings)
      : "Destination unknown";
  const evidence = identity
    ? (freshProviderModelEvidence(
        running ? capturedEvidence : identity.providerEvidence,
        identity.providerId,
        identity.transportModelId,
      ) ?? undefined)
    : undefined;
  const capabilities =
    selection && identity
      ? resolveModelInputCapabilities(
          selection,
          running ? undefined : settings.selfHostedInference,
          null,
          { identity, evidence },
        )
      : null;
  return {
    identity,
    selection,
    destination,
    running,
    evidence,
    capabilities,
    connectionId:
      identity?.selfHosted?.endpointId ??
      identity?.customEndpointId ??
      identity?.providerId,
  };
}
