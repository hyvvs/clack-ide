import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useToolVerificationJobs } from "@/modules/ai/store/toolVerificationJobs";
import type {
  SelfHostedProfile,
  SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { toolVerificationState } from "@/modules/ai/lib/toolVerification";
import {automaticAgentRecommendation} from "@/modules/ai/lib/agentConfiguration";

export function ToolVerificationControl({
  state,
  profile,
  disabled,
  now,
  context,
}: {
  state: SelfHostedState;
  profile: SelfHostedProfile;
  disabled?: boolean;
  now: number;
  context?: number;
}) {
  const jobs = useToolVerificationJobs((s) => s.jobs),
    serverJob = jobs[profile.endpointId],
    job = serverJob?.profileId === profile.id ? serverJob : undefined;
  const [error, setError] = useState("");
  const endpoint = state.endpoints.find((e) => e.id === profile.endpointId);
  const supported =
    (endpoint?.backendHint ?? endpoint?.detectedBackend) === "ollama";
  const recommendation = automaticAgentRecommendation(state, profile, context, now);
  const record = recommendation?.record ?? profile.toolVerification,
    verdict = recommendation ? "Verified" : toolVerificationState(state, profile, now, context);
  return (
    <section className="model-onboarding" aria-label="Tool verification">
      <div className="server-heading">
        <span role="status">Tools: {job ? "Verifying" : verdict}</span>
        {job ? (
          <Button
            size="icon-sm"
            variant="ghost"
            title="Cancel tool verification"
            aria-label="Cancel tool verification"
            onClick={() => job.controller.abort()}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={
              disabled || !supported || !!serverJob || verdict === "Unsupported"
            }
            title={
              !supported
                ? "Verification unavailable for this provider"
                : undefined
            }
            onClick={() => {
              setError("");
              void import("@/modules/ai/lib/toolVerificationRuntime")
                .then(({ verifyModelTools }) =>
                  verifyModelTools({
                    state,
                    profileId: profile.id,
                    signal: new AbortController().signal,
                    force: true,
                    resolveAutomatic: true,
                  }),
                )
                .catch((error) =>
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Tool verification unavailable",
                  ),
                );
            }}
          >
            <HugeiconsIcon icon={RefreshIcon} size={14} />
            Verify tools
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="server-warning">
          {error}
        </p>
      )}
      {verdict === "Needs attention" && (
        <p role="alert" className="server-warning">
          A verification did not return the required native call. This does not prove
          tools are unsupported. Agent tools remain blocked; Chat Only is available.
          Conflicting evidence stays under review until its 24-hour expiry or a
          configuration change, even if a recheck succeeds.
        </p>
      )}
      {record && (
        <details className="server-details">
          <summary>Tool verification details</summary>
          <dl>
            <dt>Outcome</dt>
            <dd>{record.outcome}</dd>
            <dt>Native capability proof</dt>
            <dd>{record.proof ? `Observed ${new Date(record.proof.at).toLocaleString()}` : "Not established"}</dd>
            {record.failure && <>
              <dt>Failed verification</dt>
              <dd>{record.failure.outcome} / {new Date(record.failure.at).toLocaleString()}</dd>
            </>}
            <dt>Observed</dt>
            <dd>
              {record.completedAt
                ? new Date(record.completedAt).toLocaleString()
                : "Interrupted or verifying"}
            </dd>
            <dt>Reasoning</dt>
            <dd>{recommendation?.configuration ? "Automatic / confirmed Agent recommendation" : "Automatic / provider default"}</dd>
            <dt>Context tested</dt>
            <dd>{record.context.toLocaleString("en-US")}</dd>
            <dt>Runtime</dt>
            <dd>{record.scope.providerVersion}</dd>
            <dt>Protocol</dt>
            <dd>{record.scope.protocol}</dd>
            <dt>Probe calls executed</dt>
            <dd>0</dd>
          </dl>
        </details>
      )}
    </section>
  );
}
