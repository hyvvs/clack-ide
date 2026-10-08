import { useEffect, useId, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  RefreshIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { calibrationSummary } from "@/modules/ai/lib/inferenceCalibration";
import { endpointInferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
import {
  effectiveProfileValue,
  resetProfileOverride,
  setProfileOverride,
} from "@/modules/ai/lib/selfHostedProfiles";
import { selfHostedHealth, HEALTH_RECENCY_MS } from "@/modules/ai/lib/selfHostedHealth";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import { ProfileAdvancedControls } from "@/settings/components/ProfileAdvancedControls";

export function CalibrationControls({
  endpointId,
  disabled,
  snapshot,
}: {
  endpointId: string;
  disabled?: boolean;
  snapshot?: ProbeSnapshot | null;
}) {
  const manualId = useId();
  const state = usePreferencesStore((s) => s.selfHostedInference);
  const endpoint = state.endpoints.find(
    (e) => e.id === endpointId && e.deletedAt === undefined,
  );
  const profiles = state.profiles.filter(
    (p) =>
      p.endpointId === endpointId &&
      (p.saved || endpoint?.legacy?.profileId === p.id),
  );
  const [selected, setSelected] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const now = Math.max(clock, Date.now());
    const expiries = state.profiles.filter(p => p.endpointId === endpointId).flatMap(p => [
      ...(p.calibration?.samples ?? []).map(s => s.observedAt + HEALTH_RECENCY_MS),
      ...Object.values(p.recommendations).flatMap(e => e?.expiresAt === undefined ? [] : [e.expiresAt]),
    ]).filter(time => time > now);
    if (!expiries.length) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(1, Math.min(2_147_483_647, Math.min(...expiries) - now + 1)));
    return () => clearTimeout(timer);
  }, [state, clock, endpointId]);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const profile = profiles.find((p) => p.id === selected) ?? profiles[0];
  if (!endpoint || !profile) return null;
  const summary = calibrationSummary(profile, endpoint.configurationRevision);
  const health = selfHostedHealth({ endpoint, profile, snapshot, calibrating: progress !== null });
  const capacity = effectiveProfileValue(
    state,
    profile.id,
    "concurrentGenerations",
  );
  const recommendation = profile.recommendations.concurrentGenerations;
  let sharedCapacity: number | null = null;
  try {
    sharedCapacity = endpointInferenceAdmission(
      endpointId,
      profile.id,
      state,
    ).capacity;
  } catch {
    /* Invalid legacy pins stay visible, never become a usable capacity. */
  }
  const warning =
    capacity.mode === "manual" &&
    recommendation?.scope.configurationRevision ===
      endpoint.configurationRevision &&
    (recommendation.expiresAt ?? Infinity) > Date.now() &&
    typeof capacity.value === "number" &&
    typeof recommendation.value === "number" &&
    capacity.value > recommendation.value;
  const optimize = async () => {
    if (controller.current) return;
    if (
      !window.confirm(
        `Optimize ${profile.saved?.label ?? profile.transportModelId} on ${endpoint.alias}? Up to 3 synthetic requests, 512 output tokens and 60 seconds. No tools or conversation content are sent.`,
      )
    )
      return;
    const abort = new AbortController();
    controller.current = abort;
    setProgress(0);
    setStatus("");
    try {
      const { optimizeInferenceProfile } = await import(
        "@/modules/ai/lib/calibrationOptimization"
      );
      await optimizeInferenceProfile({
        state,
        profileId: profile.id,
        signal: abort.signal,
        onProgress: setProgress,
      });
      if (!abort.signal.aborted)
        setStatus(
          "Measurements saved. Automatic settings remain conservative until enough comparable evidence is available.",
        );
    } catch (error) {
      const { sanitizeAiErrorText } = await import("@/modules/ai/lib/errors");
      setStatus(
        abort.signal.aborted
          ? "Optimization cancelled"
          : error instanceof Error
            ? sanitizeAiErrorText(error.message)
            : "Optimization failed. Existing settings were preserved.",
      );
    } finally {
      controller.current = null;
      setProgress(null);
    }
  };
  const update = async (reset: boolean) => {
    try {
      await updateSelfHostedProfiles((s) => {
        if (
          s.endpoints.find(
            (e) => e.id === endpointId && e.deletedAt === undefined,
          )?.configurationRevision !== endpoint.configurationRevision
        )
          throw new Error("Server settings changed. Reopen this server.");
        return reset
          ? resetProfileOverride(s, profile.id, "concurrentGenerations")
          : setProfileOverride(
              s,
              profile.id,
              "concurrentGenerations",
              Number(manual ?? capacity.value ?? 1),
            );
      });
      setStatus("");
      setManual(null);
    } catch {
      setStatus(
        "Could not save capacity. Use a whole number from 1 to 8 and reopen changed server settings.",
      );
    }
  };
  const metric = (value: number | null, unit: string) =>
    value === null ? "Unknown" : `${Math.round(value * 10) / 10} ${unit}`;
  return (
    <section className="server-calibration" aria-label="Inference calibration">
      <div className="server-heading">
        <h4>Inference settings</h4>
        <span>
          {capacity.mode === "manual"
            ? "Manual"
            : summary.count && summary.confidence === "observed"
              ? "Recent usage"
              : "Automatic"}
        </span>
      </div>
      <label className="server-manual">
        Model
        <select
          aria-label="Calibration model"
          value={profile.id}
          disabled={disabled || progress !== null}
          onChange={(e) => {
            setSelected(e.target.value);
            setManual(null);
            setStatus("");
          }}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.saved?.label ?? p.transportModelId}
            </option>
          ))}
        </select>
      </label>
      <p className="server-health" role="status" title={health.detail}>{health.label}<small>{health.detail}</small></p>
      <div className="server-heading">
        <span>
          Concurrent generations: {String(capacity.value ?? 1)} ({capacity.mode}
          )
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || progress !== null}
          onClick={() => void optimize()}
        >
          <HugeiconsIcon icon={RefreshIcon} size={14} />
          Optimize
        </Button>
        {progress !== null ? (
          <Button
            size="icon-sm"
            variant="ghost"
            title="Cancel optimization"
            aria-label="Cancel optimization"
            onClick={() => controller.current?.abort()}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </Button>
        ) : null}
      </div>
      {warning ? (
        <p className="server-warning" role="status">
          Manual capacity exceeds recent automatic guidance. Your manual setting
          remains active.
        </p>
      ) : null}
      {progress !== null ? (
        <progress aria-label="Optimization progress" max={3} value={progress} />
      ) : null}
      <details className="server-details">
        <summary>Calibration details</summary>
        <dl>
          <dt>Evidence</dt>
          <dd>
            {summary.count} samples / {summary.comparable.length} comparable /{" "}
            {summary.confidence}
          </dd>
          <dt>First output (median)</dt>
          <dd>{metric(summary.ttftMs, "ms")}</dd>
          <dt>Output speed (median)</dt>
          <dd>{metric(summary.tokensPerSecond, "tokens/s")}</dd>
          <dt>Cold / loading evidence</dt>
          <dd>{summary.coldCount || "Unknown"}</dd>
          <dt>Window</dt>
          <dd>
            {summary.windowStart !== null && summary.windowEnd !== null
              ? `${new Date(summary.windowStart).toLocaleString()} to ${new Date(summary.windowEnd).toLocaleString()}`
              : "Unknown"}
          </dd>
          <dt>Last tuning</dt>
          <dd>
            {profile.calibration?.lastTunedAt != null
              ? new Date(profile.calibration.lastTunedAt).toLocaleString()
              : "Not calibrated"}
          </dd>
          <dt>Profile revision</dt>
          <dd>
            {endpoint.configurationRevision} /{" "}
            {profile.deploymentId ?? "Deployment unspecified"}
          </dd>
          <dt>Shared endpoint capacity</dt>
          <dd>{sharedCapacity ?? "Invalid manual capacity"}</dd>
          <dt>First-output guidance</dt>
          <dd>
            {String(
              effectiveProfileValue(state, profile.id, "prefillTimeoutMs")
                .value ?? "Unknown",
            )}{" "}
            ms
          </dd>
          <dt>Idle guidance</dt>
          <dd>
            {String(
              effectiveProfileValue(state, profile.id, "idleTimeoutMs").value ??
                "Unknown",
            )}{" "}
            ms
          </dd>
          <dt>Source</dt>
          <dd>
            Local inference metadata; timings exclude queue delay. Timeout
            values are guidance.
          </dd>
        </dl>
        <div className="server-heading">
          <label className="server-manual" htmlFor={manualId}>
            Manual capacity
            <Input
              id={manualId}
              aria-label="Manual inference capacity"
              type="number"
              min={1}
              max={8}
              step={1}
              value={manual ?? String(capacity.value ?? 1)}
              disabled={disabled || progress !== null}
              onChange={(e) => setManual(e.target.value)}
            />
          </label>
          <Button
            size="icon-sm"
            variant="outline"
            title="Save manual capacity"
            aria-label="Save manual capacity"
            disabled={disabled || progress !== null}
            onClick={() => void update(false)}
          >
            <HugeiconsIcon icon={Tick01Icon} size={14} />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            title="Reset capacity to Automatic"
            aria-label="Reset capacity to Automatic"
            disabled={
              disabled || progress !== null || capacity.mode !== "manual"
            }
            onClick={() => void update(true)}
          >
            <HugeiconsIcon icon={RefreshIcon} size={14} />
          </Button>
        </div>
      </details>
      <ProfileAdvancedControls key={profile.id} profileId={profile.id} snapshot={snapshot} disabled={disabled || progress !== null} />
      {status ? (
        <p className="server-warning" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
