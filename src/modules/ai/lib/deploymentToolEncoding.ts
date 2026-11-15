import type { SelfHostedProfile, SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import {
  capabilityStatus, resolveModelDeployment,
} from "@/modules/ai/lib/localComputeFabric";
import { toolVerificationState } from "@/modules/ai/lib/toolVerification";

/**
 * TF11: protocol selection is separate from logical tool identity and from
 * runtime *declarations*. Only a model-specific, runtime-scoped qualification
 * may authorize an encoding for Automatic Agent use.
 *
 * JSON-Schema/grammar fallback is NOT installed merely because a future
 * runtime can describe one. LM2A's native Ollama tool path stays intact for
 * existing explicitly user-approved nonautomatic requests.
 */
export type DeploymentToolEncoding = {
  encoding: "native" | "unavailable";
  qualification: "verified" | "required" | "unsupported" | "unknown";
  reason:
    | "native-verified"
    | "deployment-unavailable"
    | "runtime-tools-unsupported"
    | "runtime-tools-unknown"
    | "native-model-qualification-required"
    | "runtime-adapter-not-installed";
};

export function deploymentToolEncoding(
  state: SelfHostedState,
  profile: SelfHostedProfile,
  now = Date.now(),
): DeploymentToolEncoding {
  const target = resolveModelDeployment(state, profile);
  if (!target) return {
    encoding: "unavailable", qualification: "unknown",
    reason: "deployment-unavailable",
  };
  if (target.runtime.type !== "ollama") return {
    encoding: "unavailable", qualification: "unknown",
    reason: "runtime-adapter-not-installed",
  };
  const native = capabilityStatus(target.runtime, "native-tools");
  if (native === "unsupported") return {
    encoding: "unavailable", qualification: "unsupported",
    reason: "runtime-tools-unsupported",
  };
  if (native === "unknown") return {
    encoding: "unavailable", qualification: "unknown",
    reason: "runtime-tools-unknown",
  };
  const verified = toolVerificationState(state, profile, now) === "Verified";
  return verified ? {
    encoding: "native", qualification: "verified",
    reason: "native-verified",
  } : {
    encoding: "unavailable", qualification: "required",
    reason: "native-model-qualification-required",
  };
}
