import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useContextCalibrationJobs } from "@/modules/ai/store/contextCalibrationJobs";
import {
  endpointBackend,
  type SelfHostedState,
  type SelfHostedProfile,
} from "@/modules/ai/lib/selfHostedProfiles";
import { trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";

export function ContextCalibrationControl({
  state,
  profile,
  disabled,
  now,
}: {
  state: SelfHostedState;
  profile: SelfHostedProfile;
  disabled?: boolean;
  now: number;
}) {
  const jobs = useContextCalibrationJobs((s) => s.jobs);
  const serverJob = jobs[profile.endpointId];
  const job = serverJob?.profileId === profile.id ? serverJob : undefined;
  const endpoint = state.endpoints.find((e) => e.id === profile.endpointId);
  const [error, setError] = useState("");
  const value = trustedContext(state, profile, now);
  const supported = endpoint && endpointBackend(endpoint) === "ollama";
  const record = profile.contextCalibration;
  const status =
    job?.profileId === profile.id
      ? "Verifying"
      : value
        ? "Verified on this server"
        : !supported
          ? "Calibration unsupported"
          : record?.status === "incomplete" || record?.status === "cancelled"
            ? "Incomplete"
            : record
              ? "Stale / conservative"
              : "Conservative";
  return (
    <section className="model-onboarding" aria-label="Context verification">
      <div className="server-heading">
        <span role="status">
          Context: {status}
          {value ? ` / ${value.toLocaleString("en-US")} recommended` : ""}
          {job?.context ? ` / ${job.context.toLocaleString("en-US")}` : ""}
        </span>
        {job ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel context verification"
            title="Cancel context verification"
            onClick={() => job.controller.abort()}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !supported || !!serverJob}
            title={serverJob ? "Another model on this server is being verified" : undefined}
            onClick={() => {
              setError("");
              void import("@/modules/ai/lib/contextCalibrationRuntime")
                .then(({ calibrateModelContext }) =>
                  calibrateModelContext({
                    state,
                    profileId: profile.id,
                    force: true,
                    signal: new AbortController().signal,
                  }),
                )
                .catch((error) =>
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Context verification failed",
                  ),
                );
            }}
          >
            <HugeiconsIcon icon={RefreshIcon} size={14} />
            Verify context
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="server-warning">
          {error}
        </p>
      )}
      {record && (
        <details className="server-details">
          <summary>Context verification details</summary>
          <dl>
            <dt>Highest verified allocation</dt>
            <dd>{record.highest?.toLocaleString("en-US") ?? "Unknown"}</dd>
            <dt>Last verification</dt>
            <dd>{new Date(record.updatedAt).toLocaleString()}</dd>
            <dt>Outcome</dt>
            <dd>{record.failure ?? record.status}</dd>
            <dt>Next failed allocation</dt>
            <dd>{record.failedNext?.toLocaleString("en-US") ?? "None"}</dd>
            <dt>Runtime</dt>
            <dd>{record.scope.providerVersion}</dd>
          </dl>
        </details>
      )}
    </section>
  );
}
