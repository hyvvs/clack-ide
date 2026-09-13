import {
  effectiveProfileValue,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";

export const MAX_INFERENCE_CAPACITY = 8;
export type InferenceAdmission = {
  endpointId: string;
  profileId: string;
  capacity: number;
};
export type AdmissionObservation = InferenceAdmission & {
  queueEnteredAt: number;
  admittedAt: number | null;
  attemptStartedAt: number | null;
  settledAt: number | null;
};

export function validateInferenceCapacity(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_INFERENCE_CAPACITY
  )
    throw new Error(
      `Inference capacity must be an integer from 1 to ${MAX_INFERENCE_CAPACITY}.`,
    );
  return value;
}

export function endpointInferenceAdmission(
  endpointId: string,
  profileId: string,
  state?: SelfHostedState,
): InferenceAdmission {
  const endpoint = state?.endpoints.find((e) => e.id === endpointId);
  const values =
    state && endpoint && endpoint.deletedAt === undefined
      ? state.profiles
          .filter((p) => p.endpointId === endpointId)
          .map((p) =>
            effectiveProfileValue(state, p.id, "concurrentGenerations"),
          )
          .filter((v) => v.value !== undefined)
      : [];
  const manual = values.filter((v) => v.mode === "manual");
  const selected = manual.length ? manual : values;
  return {
    endpointId,
    profileId,
    capacity: selected.length
      ? Math.min(...selected.map((v) => validateInferenceCapacity(v.value)))
      : 1,
  };
}
