export const handoffStaleReasons = [
  "task_changed", "recovery_required", "source_run_changed", "source_cancelled",
  "target_identity_changed", "policy_changed", "endpoint_changed", "history_changed",
  "dependency_changed", "project_changed", "tools_changed", "capability_changed", "expired",
] as const;
export type HandoffStaleReason = typeof handoffStaleReasons[number];

export class PeerHandoffPreparationError extends Error {
  constructor(
    readonly reason: HandoffStaleReason,
    readonly code = "peer_handoff_preparation_stale",
  ) {
    super(code);
    this.name = "PeerHandoffPreparationError";
  }
}
