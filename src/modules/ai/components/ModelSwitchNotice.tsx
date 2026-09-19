import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { ModelSwitchAssessment } from "../lib/modelSwitchEligibility";

export function ModelSwitchNotice({
  targetLabel,
  assessment,
  onConfirm,
  onBack,
}: {
  targetLabel: string;
  assessment: ModelSwitchAssessment;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, []);
  const onActionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    const next =
      event.currentTarget === backRef.current
        ? confirmRef.current
        : backRef.current;
    (next ?? backRef.current)?.focus();
  };
  const blocked = assessment.status === "blocked";
  return (
    <div role="alert" className="space-y-3 p-3 text-xs outline-none">
      <div>
        <p className="font-medium break-words">
          {blocked ? "Cannot switch model" : "Check before switching"}
        </p>
        <p className="mt-1 text-muted-foreground break-words">{targetLabel}</p>
      </div>
      <ul className="max-h-48 space-y-2 overflow-y-auto text-muted-foreground">
        {assessment.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      {assessment.contextLimit !== null && (
        <p className="text-muted-foreground tabular-nums">
          Estimated text/tool context:{" "}
          {assessment.estimatedTokens.toLocaleString()} tokens /{" "}
          {assessment.contextLimit.toLocaleString()} ceiling
          {assessment.workingBudget !== undefined &&
            ` (${assessment.workingBudget.toLocaleString()} working)`}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          ref={backRef}
          size="sm"
          variant="outline"
          onClick={onBack}
          onKeyDown={onActionKeyDown}
        >
          Choose another model
        </Button>
        {!blocked && (
          <Button
            ref={confirmRef}
            size="sm"
            onClick={onConfirm}
            onKeyDown={onActionKeyDown}
          >
            Switch anyway
          </Button>
        )}
      </div>
    </div>
  );
}
