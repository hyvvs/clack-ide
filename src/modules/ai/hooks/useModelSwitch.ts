import { useCallback, useEffect, useRef, useState } from "react";
import {
  prepareModelSwitch,
  type PreparedModelSwitch,
} from "../store/modelSwitch";

export function useModelSwitch(
  sessionId: string | null,
  followActiveSession: boolean,
) {
  const generation = useRef(0);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<PreparedModelSwitch | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const reset = useCallback(() => {
    generation.current += 1;
    setChecking(false);
    setReview(null);
    setFailure(null);
  }, []);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const request = async (modelId: string): Promise<boolean> => {
    const current = ++generation.current;
    setChecking(true);
    setReview(null);
    setFailure(null);
    const prepared = await prepareModelSwitch(
      sessionId,
      modelId,
      followActiveSession,
    );
    if (current !== generation.current) return false;
    setChecking(false);
    if (prepared.assessment.status !== "compatible") {
      setReview(prepared);
      return false;
    }
    const result = prepared.commit();
    if (!result.ok) setFailure(result.reason);
    return result.ok;
  };
  const confirm = () => {
    if (review?.assessment.status !== "warning") return false;
    const result = review.commit(true);
    if (!result.ok) {
      setReview(null);
      setFailure(result.reason);
    }
    return result.ok;
  };
  return { checking, review, failure, request, confirm, reset };
}
