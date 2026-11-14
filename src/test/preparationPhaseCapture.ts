/** An explicit, acceptance-only subscription. Nothing is captured by default.
 * The caller supplies a durable, acknowledged receipt endpoint for a NEW run.
 * This does not start inference or alter Agent/transport timeout behavior. */
import {
  installPreparationObserver,
  type PreparationObservation,
} from "@/modules/ai/lib/preparationLifecycle";

export type PreparationEvidenceRow = Readonly<PreparationObservation & {
  schemaVersion: 1;
  sequence: number;
}>;

export type PreparationCaptureReceipt = Readonly<{
  emitted: number;
  acknowledged: number;
  overflow: number;
  deliveryFailed: boolean;
}>;

export function startPreparationPhaseCapture(
  persist: (record: PreparationEvidenceRow) => Promise<void>,
  maxRecords = 2048,
) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 4096)
    throw new Error("Invalid preparation capture record bound");
  let emitted = 0;
  let acknowledged = 0;
  let overflow = 0;
  let deliveryFailed = false;
  let stopped = false;
  let pending: Promise<void> = Promise.resolve();
  const unsubscribe = installPreparationObserver((observation) => {
    if (stopped) return;
    if (emitted >= maxRecords) { overflow++; return; }
    const sequence = ++emitted;
    // Explicit scalar copy; future additions to the in-process observation
    // must NOT automatically become external evidence fields.
    const record: PreparationEvidenceRow = Object.freeze({
      schemaVersion: 1, sequence,
      at: observation.at, sessionId: observation.sessionId,
      runId: observation.runId, phase: observation.phase,
      ...(observation.nativeRequestId ? { nativeRequestId: observation.nativeRequestId } : {}),
      ...(observation.attempt ? { attempt: {
        preparationId: observation.attempt.preparationId,
        attempt: observation.attempt.attempt,
        reason: observation.attempt.reason,
        sourceCount: observation.attempt.sourceCount,
        protectedCount: observation.attempt.protectedCount,
        estimatedInputTokens: observation.attempt.estimatedInputTokens,
        deadlineMs: observation.attempt.deadlineMs,
        startedAt: observation.attempt.startedAt,
        ...(observation.attempt.finishedAt !== undefined ? { finishedAt: observation.attempt.finishedAt } : {}),
        ...(observation.attempt.settlement ? { settlement: observation.attempt.settlement } : {}),
        ...(observation.attempt.validation ? { validation: observation.attempt.validation } : {}),
        ...(observation.attempt.outcome ? { outcome: observation.attempt.outcome } : {}),
        ...(observation.attempt.validationReason ? { validationReason: observation.attempt.validationReason } : {}),
        ...(observation.attempt.committed !== undefined ? { committed: observation.attempt.committed } : {}),
      } } : {}),
    });
    pending = pending.then(async () => {
      if (deliveryFailed) return;
      try { await persist(record); acknowledged++; }
      catch { deliveryFailed = true; /* Only the receipt fails; not inference. */ }
    });
  });
  const snapshot = (): PreparationCaptureReceipt => Object.freeze({
    emitted, acknowledged, overflow, deliveryFailed,
  });
  return {
    snapshot,
    async flush(): Promise<PreparationCaptureReceipt> { await pending; return snapshot(); },
    async stop(): Promise<PreparationCaptureReceipt> {
      if (!stopped) { stopped = true; unsubscribe(); }
      await pending;
      return snapshot();
    },
  };
}
