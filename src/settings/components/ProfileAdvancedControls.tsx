import { useId, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import {
  effectiveProfileValue,
  resetProfileOverride,
  setProfileOverride,
} from "@/modules/ai/lib/selfHostedProfiles";
import { profileBudgetLimits } from "@/modules/ai/lib/contextBudgetProfile";
import { resolveContextBudget } from "@/modules/ai/lib/contextBudget";
import { serverModelDetails } from "@/modules/ai/lib/selfHostedCapabilities";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";

const fields = [
  ["configuredContext", "Asserted context"],
  ["workingContext", "Working context"],
  ["outputReserve", "Output reserve"],
  ["maxOutput", "Maximum output"],
] as const;
export function ProfileAdvancedControls({
  profileId,
  snapshot,
  disabled,
}: {
  profileId: string;
  snapshot?: ProbeSnapshot | null;
  disabled?: boolean;
}) {
  const id = useId();
  const state = usePreferencesStore((s) => s.selfHostedInference);
  const profile = state.profiles.find((p) => p.id === profileId);
  const endpoint = state.endpoints.find(
    (e) => e.id === profile?.endpointId && e.deletedAt === undefined,
  );
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!profile || !endpoint) return null;
  let budget: ReturnType<typeof resolveContextBudget> | null = null;
  try {
    budget = resolveContextBudget(
      profileBudgetLimits(state, profileId, snapshot ?? null),
    );
  } catch {
    /* Invalid pins remain editable; B1 still blocks requests. */
  }
  const details = serverModelDetails(
    endpoint,
    profile.transportModelId,
    snapshot ?? null,
  );
  const save = async (field: (typeof fields)[number][0], reset: boolean) => {
    setSaving(true);
    setError("");
    try {
      await updateSelfHostedProfiles((s) => {
        if (
          s.endpoints.find(
            (e) => e.id === endpoint.id && e.deletedAt === undefined,
          )?.configurationRevision !== endpoint.configurationRevision
        )
          throw new Error("Server settings changed");
        return reset
          ? resetProfileOverride(s, profileId, field)
          : setProfileOverride(s, profileId, field, Number(draft[field]));
      });
      setDraft((d) => {
        const next = { ...d };
        delete next[field];
        return next;
      });
    } catch {
      setError(
        "Could not save this field. Enter a valid whole number and reopen changed server settings.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <details
      className="server-details"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.open = false;
          e.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary>Advanced model settings</summary>
      <dl>
        <dt>Endpoint</dt>
        <dd>{endpoint.alias}</dd>
        <dt>Model / deployment</dt>
        <dd>
          {profile.transportModelId} / {profile.deploymentId ?? "Unspecified"}
        </dd>
        <dt>Effective context</dt>
        <dd>
          {budget
            ? `${budget.ceiling.toLocaleString()} tokens (${budget.source === "unknown-policy" ? "Unverified planning limit" : budget.source})`
            : "Invalid manual settings"}
        </dd>
        <dt>Effective output</dt>
        <dd>
          {budget ? `${budget.output.toLocaleString()} tokens` : "Unavailable"}
        </dd>
        <dt>Effective reserve</dt>
        <dd>
          {budget ? `${budget.reserve.toLocaleString()} tokens` : "Unavailable"}
        </dd>
        <dt>Capability evidence</dt>
        <dd>
          Text {details.capabilities.text} / Tools {details.capabilities.tools}{" "}
          / Vision {details.capabilities.image}
        </dd>
      </dl>
      {fields.map(([field, label]) => {
        const effective = effectiveProfileValue(state, profileId, field);
        const mode =
          effective.mode === "manual"
            ? `Manual${effective.stale ? " / server changed" : ""}`
            : effective.value === undefined
              ? "Automatic / Unknown"
              : "Automatic / Recommended";
        return (
          <div className="server-advanced-field" key={field}>
            <label htmlFor={`${id}-${field}`}>
              {label}
              <small>
                {mode}
                {effective.value !== undefined ? `: ${effective.value}` : ""}
              </small>
            </label>
            <Input
              id={`${id}-${field}`}
              aria-label={label}
              type="number"
              step={1}
              min={field === "outputReserve" ? 0 : 1}
              value={draft[field] ?? ""}
              placeholder={
                effective.value === undefined
                  ? "Automatic"
                  : String(effective.value)
              }
              disabled={disabled || saving}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [field]: e.target.value }))
              }
            />
            <Button
              size="icon-sm"
              variant="outline"
              title={`Save ${label}`}
              aria-label={`Save ${label}`}
              disabled={disabled || saving || !draft[field]}
              onClick={() => void save(field, false)}
            >
              <HugeiconsIcon icon={Tick01Icon} size={14} />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              title={`Reset ${label} to Automatic`}
              aria-label={`Reset ${label} to Automatic`}
              disabled={disabled || saving || effective.mode !== "manual"}
              onClick={() => void save(field, true)}
            >
              <HugeiconsIcon icon={RefreshIcon} size={14} />
            </Button>
          </div>
        );
      })}
      {error ? (
        <p className="server-warning" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
