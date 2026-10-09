import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowReloadHorizontalIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useChatStore, hasKeyForModel } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { MODELS } from "@/modules/ai/config";
import { describeConnectionAddress } from "@/modules/ai/lib/connectionPresentation";
import { getEnabledSavedProviderModelInfos } from "@/modules/ai/lib/savedProviderModels";
import { savedSelfHostedModelInfos } from "@/modules/ai/lib/selfHostedModels";
import {
  effectiveFallback,
  sameDestination,
  FALLBACK_CATEGORIES,
  type FallbackDestination,
} from "@/modules/ai/lib/inferenceFallback";
import {
  describeFallbackDestination,
  resolveFallbackProposal,
  setFallbackPolicy,
  useFallbackProposals,
} from "@/modules/ai/store/inferenceFallback";

function Destination({ destination }: { destination: FallbackDestination }) {
  return (
    <div className="min-w-0 space-y-1 text-xs [overflow-wrap:anywhere]">
      <p className="font-medium">
        {destination.identity.providerId} /{" "}
        {destination.identity.transportModelId}
      </p>
      <p>{destination.baseUrl}</p>
      <p>{describeConnectionAddress(destination.baseUrl).label}</p>
      <p className="text-muted-foreground">{destination.modelId}</p>
      {destination.baseUrl.startsWith("http:") && (
        <p className="text-destructive">
          HTTP: data is not encrypted in transit.
        </p>
      )}
    </div>
  );
}

export function ChatFallbackControl({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"never" | "ask" | "trusted">("never");
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<FallbackDestination | null>(null);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const session = useChatStore((s) =>
    s.sessions.find((item) => item.id === sessionId),
  );
  const settings = usePreferencesStore((state) => (open ? state : null));
  const proposal = useFallbackProposals((s) => s.proposals[sessionId]);
  const policy = effectiveFallback(session?.fallback);
  const models =
    settings && !proposal
      ? [
          ...MODELS,
          ...getEnabledSavedProviderModelInfos(settings.savedProviderModels),
          ...savedSelfHostedModelInfos(settings.selfHostedInference),
        ].filter(
          (m, i, all) =>
            m.id !== session?.profile?.modelId &&
            hasKeyForModel(m.id) &&
            all.findIndex((other) => other.id === m.id) === i,
        )
      : [];
  const busy = session?.run?.state === "running";
  useEffect(() => {
    if (
      !open ||
      proposal ||
      !policy ||
      policy.mode === "never" ||
      !policy.primary ||
      !policy.destination
    )
      return;
    const storedPrimary = policy.primary;
    const storedDestination = policy.destination;
    let current = true;
    const validate = async () => {
      try {
        if (
          policy.agentId !== session?.profile?.agentId ||
          policy.workspaceId !== session?.profile?.workspaceId ||
          policy.primary?.modelId !== session?.profile?.modelId
        )
          throw new Error(
            "Fallback consent belongs to a different agent, workspace or primary route. Grant new consent for this chat.",
          );
        const primary = await describeFallbackDestination(
          storedPrimary.modelId,
        );
        const destination = await describeFallbackDestination(
          storedDestination.modelId,
        );
        if (
          !sameDestination(primary, storedPrimary) ||
          !sameDestination(destination, storedDestination)
        )
          throw new Error(
            "Fallback configuration changed. Existing consent is inactive; review the destination and grant new consent.",
          );
      } catch (e) {
        if (current)
          setError(
            e instanceof Error
              ? e.message
              : "Fallback destination unavailable.",
          );
      }
    };
    void validate();
    return () => {
      current = false;
    };
  }, [
    open,
    proposal,
    policy,
    session?.profile?.agentId,
    session?.profile?.workspaceId,
    session?.profile?.modelId,
  ]);
  const save = async (selected: "never" | "ask" | "trusted") => {
    setSaving(true);
    setError("");
    try {
      await setFallbackPolicy(sessionId, selected, target, preview);
      setConsent(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Fallback policy could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  const changeTarget = async (value: string) => {
    setTarget(value);
    setPreview(null);
    setConsent(false);
    setError("");
    try {
      const next = await describeFallbackDestination(value);
      setPreview((current) => (current?.modelId === value ? current : next));
    } catch {
      setError(
        "Destination unavailable. Restore its configuration before granting consent.",
      );
    }
  };
  return (
    <Dialog
      open={open || !!proposal}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value && proposal)
          resolveFallbackProposal(sessionId, false, proposal.id);
        if (value) {
          setMode(policy?.mode ?? "never");
          setTarget(policy?.destination?.modelId ?? "");
          setPreview(policy?.destination ?? null);
          setConsent(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label={`Fallback policy: ${policy?.mode ?? "never"}`}
          title={`Fallback: ${policy?.mode ?? "never"}`}
        >
          <HugeiconsIcon
            icon={ArrowReloadHorizontalIcon}
            size={13}
            strokeWidth={1.7}
          />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-24px)] max-w-md flex-col overflow-hidden p-4">
        <DialogHeader className="min-w-0 pr-7 [overflow-wrap:anywhere]">
          <DialogTitle>
            {proposal ? "Approve fallback once?" : "Inference fallback"}
          </DialogTitle>
          <DialogDescription>{session?.title ?? "This chat"}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto [overflow-wrap:anywhere]">
          {proposal ? (
            <>
              <p className="text-xs">Primary failed: {proposal.reason}</p>
              <Destination destination={proposal.primary} />
              <p className="text-xs font-medium">Proposed destination</p>
              <Destination destination={proposal.destination} />
              <p className="text-xs">
                Data shared: {FALLBACK_CATEGORIES.join(", ")}. Target
                compatibility and context limits must still pass.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    resolveFallbackProposal(sessionId, true, proposal.id)
                  }
                >
                  Approve once
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    resolveFallbackProposal(sessionId, false, proposal.id)
                  }
                >
                  Decline
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs">
                Current policy: {policy?.mode ?? "never"}
              </p>
              {policy?.destination && policy.mode !== "never" && (
                <Destination destination={policy.destination} />
              )}
              <label className="block space-y-1 text-xs">
                Fallback
                <select
                  aria-label="Fallback mode"
                  className="block w-full min-w-0 rounded border bg-background p-2"
                  value={mode}
                  disabled={busy || saving}
                  onChange={(e) => {
                    setMode(e.target.value as typeof mode);
                    setConsent(false);
                  }}
                >
                  <option value="never">Never</option>
                  <option value="ask">Ask me</option>
                  <option value="trusted">Trusted destination</option>
                </select>
              </label>
              {mode !== "never" && (
                <>
                  <label className="block space-y-1 text-xs">
                    Configured destination
                    <select
                      aria-label="Fallback destination"
                      className="block w-full min-w-0 rounded border bg-background p-2"
                      value={target}
                      disabled={busy || saving}
                      onChange={(e) => void changeTarget(e.target.value)}
                    >
                      <option value="">Select destination</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.provider})
                        </option>
                      ))}
                    </select>
                  </label>
                  {preview && <Destination destination={preview} />}
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={consent}
                      disabled={busy || saving || !preview}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    <FallbackConsentCopy mode={mode} />
                  </label>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    saving ||
                    busy ||
                    (mode !== "never" &&
                      (!consent || !preview || preview.modelId !== target))
                  }
                  onClick={() => void save(mode)}
                >
                  Save policy
                </Button>
                <Button
                  variant="outline"
                  disabled={saving || !policy || policy.mode === "never"}
                  onClick={() => void save("never")}
                >
                  Revoke fallback
                </Button>
              </div>
              {busy && (
                <p className="text-xs text-muted-foreground">
                  New consent is locked during a run. Revocation remains
                  available.
                </p>
              )}
              {!!policy?.history.length && (
                <details className="text-xs">
                  <summary>Routing and consent history</summary>
                  <ul className="mt-2 space-y-2">
                    {policy.history.map((entry) => (
                      <li key={entry.id ?? JSON.stringify(entry)}>
                        {entry.kind} {entry.mode ?? ""} /{" "}
                        {new Date(entry.at).toLocaleString()}
                        {entry.destination && (
                          <Destination destination={entry.destination} />
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FallbackConsentCopy({ mode }: { mode: "ask" | "trusted" }) {
  return <span>
    {mode === "trusted"
      ? "I authorize automatic transmission"
      : "I understand that approving fallback allows transmission"}{" "}
    to this exact destination of: {FALLBACK_CATEGORIES.join(", ")}.
  </span>;
}
