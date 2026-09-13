import { useInferenceLifecycle } from "@/modules/ai/hooks/useInferenceLifecycle";
import { inferenceLabel } from "@/modules/ai/lib/inferenceLifecycle";

export function InferenceActivityLabel({
  sessionId,
  fallback,
}: {
  sessionId: string;
  fallback: string;
}) {
  const inference = useInferenceLifecycle(sessionId);
  const label = inference ? inferenceLabel(inference) : fallback;
  return (
    <span className="block max-w-[160px] truncate" title={label}>
      {label}
    </span>
  );
}
