import type { EvidenceCandidate } from "./deploymentEvidenceDecisions";
import type { LocalComputeFabric } from "./localComputeFabric";

/** Public-facing labels. Readiness, qualification and historical freshness are
 * independent axes; callers must not use one to imply another. */
export type DeploymentProductState =
  "Ready" | "Stopped" | "Offline" | "Missing" | "Unqualified" |
  "Qualified" | "Qualification Failed" | "Stale" | "Unsupported" | "Unknown";
export type DeploymentProductSummary = {
  readiness: DeploymentProductState;
  qualification: DeploymentProductState;
  instruction: DeploymentProductState;
  nativeTools: DeploymentProductState;
  reason: string;
};

export function deploymentProductSummary(
  candidate: EvidenceCandidate, fabric: LocalComputeFabric,
): DeploymentProductSummary {
  const deployment = fabric.deployments.find(row => row.id === candidate.deploymentId);
  const host = fabric.hosts.find(row => row.id === candidate.hostId);
  const runtime = fabric.runtimes.find(row => row.id === candidate.runtimeId);
  const artifact = fabric.artifacts.find(row => row.id === deployment?.artifactId);
  const readiness: DeploymentProductState = !deployment || !runtime || !host || !artifact
    ? "Missing" : !host.enabled || host.reachability === "offline" ||
      !runtime.enabled || runtime.health === "offline"
      ? "Offline" : candidate.ready ? "Ready" :
        candidate.readiness === "Stopped" ? "Stopped" : "Unknown";
  const map = (state: EvidenceCandidate["qualification"]["chat"]["state"]): DeploymentProductState => {
    switch (state) {
      case "Qualified": return "Qualified";
      case "Qualification Failed": return "Qualification Failed";
      case "Qualification Stale": return "Stale";
      case "Unsupported": return "Unsupported";
      case "Requires Qualification": return "Unqualified";
      default: return "Unknown";
    }
  };
  return {
    readiness,
    qualification: map(candidate.qualification.chat.state),
    instruction: map(candidate.qualification.instruction.state),
    nativeTools: map(candidate.qualification.nativeTools.state),
    reason: readiness === "Ready" ? candidate.qualification.chat.reason :
      readiness === "Stopped" ? "Native runtime stopped. Start it explicitly before qualification."
        : readiness === "Offline" ? "Host or runtime offline. Check its connection or service."
          : readiness === "Missing" ? "Registered model or runtime missing. Recheck its installation."
            : "Hardware/runtime identity cannot be independently verified.",
  };
}

/** Never expose raw native/provider errors, secrets, file paths or response
 * bodies in ordinary UI. Detailed receipts remain available in Advanced. */
export function actionableQualificationError(error: unknown): string {
  const raw = error instanceof Error ? error.message.toLowerCase() : "";
  if (raw.includes("already active") || raw.includes("already preparing"))
    return "Another qualification is running. Finish or cancel that run before starting another.";
  if (raw.includes("permission") || raw.includes("chat only") || raw.includes("chat-only"))
    return "Qualification needs an existing Chat-only Coder permission profile. It will not change permissions.";
  if (raw.includes("missing") || raw.includes("not installed") || raw.includes("unavailable deployment"))
    return "Model or runtime missing. Check the registered artifact and installation.";
  if (raw.includes("epoch") || raw.includes("changed") || raw.includes("stale"))
    return "Qualification stale after a runtime or deployment change. Recheck the exact deployment.";
  if (raw.includes("not ready") || raw.includes("stopped"))
    return "Runtime is not Ready. Start the exact deployment explicitly before qualification.";
  if (raw.includes("native tools") || raw.includes("native-tools"))
    return "Native tools are not qualified for this deployment.";
  if (raw.includes("hardware") || raw.includes("telemetry"))
    return "Hardware telemetry unavailable; resource fit cannot be confirmed.";
  if (raw.includes("time") || raw.includes("timeout"))
    return "Qualification timed out. The incomplete attempt remains evidence; no capability was granted.";
  return "Qualification could not complete with independently verifiable evidence. No capability was granted.";
}
