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
  const detailsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, []);
  const onActionKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    const actions = [
      detailsRef.current,
      backRef.current,
      confirmRef.current,
    ].filter((element): element is HTMLElement => element !== null);
    const index = actions.indexOf(event.currentTarget);
    actions[
      (index + (event.shiftKey ? -1 : 1) + actions.length) % actions.length
    ]?.focus();
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
      {assessment.details && (
        <details className="text-muted-foreground">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Native summary is interactive; Tab joins the notice focus loop. */}
          <summary
            ref={detailsRef}
            onKeyDown={onActionKeyDown}
            className="cursor-pointer"
          >
            Preparation details
          </summary>
          <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto break-words [overflow-wrap:anywhere]">
            {assessment.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        </details>
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
            Optimize and switch
          </Button>
        )}
      </div>
    </div>
  );
}
