import {
  modelOnboarding,
  profileSnapshot,
} from "@/modules/ai/lib/modelOnboarding";
import type {
  SelfHostedProfile,
  SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { ProfileAdvancedControls } from "@/settings/components/ProfileAdvancedControls";

export function ModelOnboardingDetails({
  state,
  profile,
  disabled,
}: {
  state: SelfHostedState;
  profile: SelfHostedProfile;
  disabled?: boolean;
}) {
  const view = modelOnboarding(state, profile);
  if (!view) return null;
  const tokens = (value: unknown) =>
    typeof value === "number"
      ? `${value.toLocaleString("en-US")} tokens`
      : "Unknown";
  return (
    <section
      className="model-onboarding"
      aria-label={`Model settings for ${profile.transportModelId}`}
    >
      <div className="server-heading">
        <h4>{profile.saved?.label ?? profile.transportModelId}</h4>
        <span role="status">{view.status}</span>
      </div>
      {view.problem && (
        <p role="alert" className="server-warning">
          {view.problem}
        </p>
      )}
      <dl className="model-onboarding-summary">
        <dt>Reasoning</dt>
        <dd>Automatic ({view.reasoning.recommended})</dd>
        <dt>Context</dt>
        <dd>
          {view.context.override !== undefined
            ? `Custom: ${tokens(view.context.override)}`
            : `Automatic (${tokens(view.context.recommended)})`}
          {view.context.verified !== undefined && view.context.verified === (view.context.override ?? view.context.recommended) ? " / Verified" : " / Unverified"}
        </dd>
        <dt>Output</dt>
        <dd>
          {view.output.override !== undefined
            ? `Custom: ${tokens(view.output.override)}`
            : `Automatic (${tokens(view.output.recommended)})`}
        </dd>
        <dt>Tools</dt>
        <dd>{view.tools}</dd>
        <dt>Vision</dt>
        <dd>{view.vision}</dd>
      </dl>
      <details className="server-details">
        <summary>Capability details</summary>
        <dl>
          <dt>Advertised maximum</dt>
          <dd>{tokens(view.context.advertised)}</dd>
          <dt>Recommended context</dt>
          <dd>
            {tokens(view.context.recommended)} ({view.context.provenance})
          </dd>
          <dt>Verified practical context</dt>
          <dd>{tokens(view.context.verified)}</dd>
          <dt>Loaded context</dt>
          <dd>{tokens(view.context.loaded)}</dd>
          <dt>Provider reasoning default</dt>
          <dd>
            {view.reasoning.providerDefault === undefined
              ? "Not reported"
              : view.reasoning.providerDefault === false
                ? "None"
                : view.reasoning.providerDefault === true
                  ? "On"
                  : String(view.reasoning.providerDefault)}
          </dd>
          <dt>Reasoning verification</dt>
          <dd>
            {view.reasoning.verified === undefined
              ? "Unverified"
              : view.reasoning.verified
                ? "Verified"
                : "Incompatible"}
          </dd>
          <dt>Structured output</dt>
          <dd>{view.structuredOutput}</dd>
          <dt>Fallback</dt>
          <dd>{view.fallback}</dd>
          <dt>Model revision</dt>
          <dd>{profile.modelRevision ?? "Unknown"}</dd>
          <dt>Metadata observed</dt>
          <dd>
            {view.evidence.length
              ? new Date(
                  Math.max(...view.evidence.map((e) => e.observedAt ?? 0)),
                ).toLocaleString()
              : "Unknown"}
          </dd>
        </dl>
      </details>
      <ProfileAdvancedControls
        profileId={profile.id}
        snapshot={profileSnapshot(state, profile)}
        disabled={disabled}
      />
    </section>
  );
}
