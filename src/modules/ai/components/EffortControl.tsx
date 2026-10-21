import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useModelSelectionLock } from "@/modules/ai/hooks/useModelSelectionLock";
import {
  sessionEffort,
  setSessionEffort,
} from "@/modules/ai/store/reasoningEffort";
import {
  effortLabel,
  effortProviderOptions,
} from "@/modules/ai/lib/reasoningEffort";
import { resolveSelfHostedSelection } from "@/modules/ai/lib/selfHostedProfiles";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";

export function EffortControl({ sessionId }: { sessionId?: string }) {
  const id = useChatStore((s) => sessionId ?? s.activeSessionId);
  return id ? <SessionEffortControl key={id} sessionId={id} /> : null;
}

function SessionEffortControl({ sessionId: id }: { sessionId: string }) {
  const session = useChatStore((s) =>
    s.sessions.find((entry) => entry.id === id),
  );
  const preferences = usePreferencesStore();
  const locked = useModelSelectionLock(id);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();
  if (!session) return null;
  let effort: ReturnType<typeof sessionEffort>;
  try {
    effort =
      locked && session.run?.reasoning
        ? session.run.reasoning
        : sessionEffort(session);
  } catch {
    return null;
  }
  const capability = effort.capability;
  const displayChoice = effort.unresolvedExplicitChoice ?? effort.choice;
  const target = resolveSelfHostedSelection(preferences.selfHostedInference, session.profile?.modelId ?? "");
  const onboarding = target.status === "available" ? modelOnboarding(preferences.selfHostedInference, target.profile) : null;
  if (capability.status === "unsupported") return null;
  let effective: string;
  try {
    effective = effort.unresolvedExplicitChoice
      ? `Explicit ${effortLabel(effort.unresolvedExplicitChoice)} requires revalidation; no Automatic substitution`
      : effort.choice === "automatic"
        ? onboarding?.reasoning.agentRecommendation?.configuration
          ? `Automatic Agent: confirmed ${onboarding.reasoning.recommended}; Chat Only: provider default`
          : "Provider default; no effort override"
        : JSON.stringify(effortProviderOptions(effort));
  } catch {
    effective = "Evidence expired; start a new request.";
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 max-w-36 shrink-0 px-1.5 text-[11px]"
          title="Reasoning effort"
          aria-label={`Reasoning effort: ${effortLabel(displayChoice)}`}
        >
          <span className="truncate">Effort: {effortLabel(displayChoice)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 max-w-[calc(100vw-24px)] max-h-[min(480px,70vh)] overflow-y-auto gap-3 p-3"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span>Reasoning effort</span>
          <select
            aria-label="Reasoning effort"
            className="h-8 w-full min-w-0 rounded border border-border bg-background px-2"
            value={displayChoice}
            disabled={locked || saving || capability.status !== "supported"}
            onChange={(event) => {
              const choice = event.target.value;
              setSaving(true);
              setFailure(undefined);
              void setSessionEffort(session.id, choice)
                .catch((error) => setFailure(String(error)))
                .finally(() => setSaving(false));
            }}
          >
            <option value="automatic">{onboarding?.reasoning.agentRecommendation ? "Automatic (Recommended)" : onboarding ? `Automatic (${onboarding.reasoning.recommended})` : "Automatic"}</option>
            {effort.unresolvedExplicitChoice && !capability.levels.includes(displayChoice) &&
              <option value={displayChoice}>{effortLabel(displayChoice)} (Needs revalidation)</option>}
            {capability.levels.map((level) => (
              <option key={level} value={level}>
                {effortLabel(level)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">Effort does not control reasoning visibility.</p>
        {capability.status === "unknown" && (
          <p className="text-xs text-muted-foreground">
            Effort support is unverified for this model and API.
          </p>
        )}
        {locked && (
          <p className="text-xs text-muted-foreground">
            Locked until the current run stops completely.
          </p>
        )}
        {failure && (
          <p role="alert" className="break-words text-xs text-destructive">
            {failure}
          </p>
        )}
        <details className="min-w-0 text-xs">
          <summary className="cursor-pointer">Advanced</summary>
          <dl className="mt-2 space-y-1 break-words [overflow-wrap:anywhere]">
            <dt>Effective request</dt>
            <dd>{effective}</dd>
            {onboarding && <>
              <dt>Provider-default behavior</dt>
              <dd>Automatic / provider-managed</dd>
              <dt>Agent tools</dt>
              <dd>{onboarding.tools}</dd>
            </>}
            <dt>Capability</dt>
            <dd>{capability.status}</dd>
            <dt>Evidence</dt>
            <dd>{capability.evidence}</dd>
            <dt>Accounting</dt>
            <dd>
              {capability.status === "supported"
                ? "Reasoning shares the total output allowance; exact use is unknown. Numeric budgets reserve room before inference."
                : "Reasoning accounting is unverified. The normal B1 output reserve still applies."}
            </dd>
          </dl>
        </details>
      </PopoverContent>
    </Popover>
  );
}
