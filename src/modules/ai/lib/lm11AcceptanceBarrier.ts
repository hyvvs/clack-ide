import { invoke } from "@tauri-apps/api/core";
import type { QualificationOperationDeadline } from "./deploymentQualificationFlight";

/** Only the native acceptance host may arm one stage for the canonical case
 * root and exact bound child PID. Renderer stages grant no new authority. */
export type Lm11AcceptanceStage =
  | "before-native-admission" | "native-admission-response"
  | "prepare-chat-promise-settlement" | "native-open-response"
  | "before-preparation" | "during-preparation" | "before-ai-http-open"
  | "during-streaming" | "during-quiescence"
  | "preparation-complete" | "predispatch" | "after-ai-http-open"
  | "first-output" | "terminal-delivery" | "quiescence-complete"
  | "before-evidence-acceptance" | "b03-before-prepare"
  | "b03-before-acknowledge" | "b03-before-readback";

export async function lm11AcceptanceBarrier(
  stage: Lm11AcceptanceStage,
  operation: QualificationOperationDeadline | undefined,
  sessionId?: string,
): Promise<void> {
  if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE !== "1" || !operation) return;
  await operation.within(() => invoke<void>("lm11_acceptance_barrier", {
    stage, ...(sessionId ? { sessionId } : {}),
  }));
}
