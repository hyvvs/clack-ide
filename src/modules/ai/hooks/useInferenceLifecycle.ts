import { useCallback, useSyncExternalStore } from "react";
import {
  sessionInference,
  subscribeInference,
} from "@/modules/ai/lib/inferenceLifecycle";
export function useInferenceLifecycle(sessionId?: string | null) {
  const snapshot = useCallback(() => sessionInference(sessionId), [sessionId]);
  return useSyncExternalStore(subscribeInference, snapshot, snapshot);
}
