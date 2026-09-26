import type { InferenceScope } from "@/modules/ai/lib/inferenceLifecycle";
import type {
  ScopedRequest,
  ScopedResult,
} from "@/modules/ai/lib/scopedEvidence";

export type RetrievalAllowance = {
  bytes: number;
  chunks: number;
  elapsed: number;
  conversationRounds: number;
  scopedRounds: number;
  rounds: number;
  epoch: number;
  chargedEpoch: number;
  scopedCache?: { request: ScopedRequest; result: ScopedResult };
};
export const newRetrievalAllowance = (): RetrievalAllowance => ({
  bytes: 0,
  chunks: 0,
  elapsed: 0,
  conversationRounds: 0,
  scopedRounds: 0,
  rounds: 0,
  epoch: 0,
  chargedEpoch: -1,
});

export function claimRetrievalRound(allowance: RetrievalAllowance): void {
  if (allowance.chargedEpoch === allowance.epoch) return;
  if (allowance.rounds >= 2)
    throw new Error("The shared evidence lookup round allowance is exhausted.");
  allowance.rounds++;
  allowance.chargedEpoch = allowance.epoch;
}

const runs = new Map<
  string,
  { scope: InferenceScope; allowance: RetrievalAllowance }
>();
export function runRetrievalAllowance(
  scope: InferenceScope,
): RetrievalAllowance {
  for (const [key, entry] of runs)
    if (!entry.scope.isCurrent()) runs.delete(key);
  const key = JSON.stringify([scope.sessionId, scope.runId]);
  const prior = runs.get(key);
  if (prior) return prior.allowance;
  if (runs.size >= 128)
    throw new Error("Too many active evidence preparations.");
  const allowance = newRetrievalAllowance();
  runs.set(key, { scope, allowance });
  return allowance;
}
