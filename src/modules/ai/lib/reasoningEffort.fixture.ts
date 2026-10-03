import type { ModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  emptySelfHostedState,
  ensureSelfHostedProfile,
  profileEvidence,
} from "@/modules/ai/lib/selfHostedProfiles";

export function hostedEffortFixture(
  status: "supported" | "unsupported" = "supported",
) {
  const endpoint = createSelfHostedEndpoint(
    {
      alias: "Local",
      baseURL: "http://localhost:9999/v1",
      backendHint: "ollama",
    },
    "server",
  );
  const { state, profile } = ensureSelfHostedProfile(
    addSelfHostedEndpoint(emptySelfHostedState(), endpoint),
    endpoint.id,
    "gpt-5.4-mini",
  );
  const evidence = profileEvidence(
    state,
    profile.id,
    "reasoning.effort",
    JSON.stringify({
      status,
      wire: "reasoning_effort",
      accounting: "shared-output",
      levels: status === "supported" ? ["low", "high"] : [],
    }),
    "backend-reported",
    Date.now(),
    "reported",
  );
  profile.evidence.push(evidence);
  const identity: ModelTransportIdentity = {
    providerId: "ollama",
    transportModelId: profile.transportModelId,
    endpointBaseURL: endpoint.baseURL,
    selfHosted: {
      endpointId: endpoint.id,
      profileId: profile.id,
      configurationRevision: 1,
      allowPrivateNetwork: false,
      credentialRef: null,
      credentialRequired: false,
    },
  };
  return { state, profile, endpoint: state.endpoints[0], evidence, identity };
}
