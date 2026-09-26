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
  const controller = useRef<AbortController | null>(null);
  const preparedRef = useRef<PreparedModelSwitch | null>(null);
  const [checking, setChecking] = useState(false);
  const [preparingLabel, setPreparingLabel] = useState("");
  const [review, setReview] = useState<PreparedModelSwitch | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const reset = useCallback(() => {
    controller.current?.abort();
    preparedRef.current?.dispose?.();
    generation.current += 1;
    setChecking(false);
    setReview(null);
    setFailure(null);
  }, []);
  useEffect(
    () => () => {
      controller.current?.abort();
      preparedRef.current?.dispose?.();
      generation.current += 1;
    },
    [],
  );

  const request = async (
    modelId: string,
    label = modelId,
  ): Promise<boolean> => {
    setPreparingLabel(label);
    controller.current?.abort();
    preparedRef.current?.dispose?.();
    controller.current = new AbortController();
    const current = ++generation.current;
    setChecking(true);
    setReview(null);
    setFailure(null);
    const prepared = await prepareModelSwitch(
      sessionId,
      modelId,
      followActiveSession,
      controller.current.signal,
    );
    if (current !== generation.current) {
      prepared.dispose?.();
      return false;
    }
    preparedRef.current = prepared;
    if (prepared.assessment.status !== "compatible") {
      setReview(prepared);
      setChecking(false);
      return false;
    }
    const result = await prepared.commit();
    if (current !== generation.current) return false;
    setChecking(false);
    if (!result.ok) setFailure(result.reason);
    return result.ok;
  };
  const confirm = async () => {
    if (review?.assessment.status !== "warning") return false;
    const current = generation.current;
    setChecking(true);
    const result = await review.commit(true);
    if (current !== generation.current) return false;
    setChecking(false);
    if (!result.ok) {
      setReview(null);
      setFailure(result.reason);
    }
    return result.ok;
  };
  return { checking, preparingLabel, review, failure, request, confirm, reset };
}
