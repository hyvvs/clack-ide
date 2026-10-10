import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlugIcon } from "@hugeicons/core-free-icons";
import { chatConnectionSummary } from "@/modules/ai/lib/chatConnectionSummary";
import {
  useChatStore,
  capturedProviderModelEvidence,
} from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { useSelfHostedSnapshot } from "@/modules/ai/hooks/useSelfHostedSnapshot";
import { resolveSelfHostedSelection } from "@/modules/ai/lib/selfHostedProfiles";
import { selfHostedHealth } from "@/modules/ai/lib/selfHostedHealth";

export function ChatConnectionControl({ sessionId }: { sessionId: string }) {
  const session = useChatStore((s) =>
    s.sessions.find((item) => item.id === sessionId),
  );
  const settings = usePreferencesStore((s) => s);
  const {
    identity,
    selection,
    destination,
    connectionId,
    running,
    capabilities,
    evidence,
  } = chatConnectionSummary(
    session,
    settings,
    capturedProviderModelEvidence.get(sessionId),
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-1.5 text-xs"
          aria-label="Connection details for this chat"
        >
          <HugeiconsIcon icon={PlugIcon} size={13} />
          Connection
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-16px)] max-h-[70dvh] overflow-y-auto space-y-2 text-xs [overflow-wrap:anywhere]"
      >
        <h3 className="font-medium">Current model connection</h3>
        <dl className="space-y-1">
          <dt>Exact model</dt>
          <dd>{identity?.transportModelId ?? "Unavailable"}</dd>
          <dt>Provider</dt>
          <dd>{identity?.providerId ?? "Unknown"}</dd>
          <dt>Destination</dt>
          <dd>{destination}</dd>
          <dt>Selection</dt>
          <dd>{selection ?? "None"}</dd>
        </dl>
        {!identity && (
          <p role="status">
            Configuration unavailable; no substitute destination selected.
          </p>
        )}
        <p>
          Tool support: {capabilities?.tools ?? "unknown"}. Images:{" "}
          {capabilities?.image ?? "unknown"}.
        </p>
        <p>
          Provider context metadata:{" "}
          {evidence?.context
            ? `${evidence.context.toLocaleString()} tokens`
            : "Not verified here"}
          .
        </p>
        {running && (
          <p className="text-muted-foreground">
            Captured run destination. Saved connection changes apply to later
            runs.
          </p>
        )}
        {identity?.endpointBaseURL?.startsWith("http:") && (
          <p className="text-destructive">
            HTTP: data is not encrypted in transit.
          </p>
        )}
        {selection?.startsWith("self-hosted:") && (
          <ConnectionHealth
            selection={selection}
            revision={
              running ? identity?.selfHosted?.configurationRevision : undefined
            }
          />
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void openSettingsWindow("models", { connectionId })}
        >
          Manage connection in Settings
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function ConnectionHealth({
  selection,
  revision,
}: {
  selection: string;
  revision?: number;
}) {
  const { state, snapshot } = useSelfHostedSnapshot(selection);
  const target = resolveSelfHostedSelection(state, selection);
  if (target.status !== "available") return <p>Endpoint health unavailable.</p>;
  if (
    revision !== undefined &&
    target.endpoint.configurationRevision !== revision
  )
    return <p>Saved connection changed; captured-run health unavailable.</p>;
  const health = selfHostedHealth({
    endpoint: target.endpoint,
    profile: target.profile,
    snapshot,
  });
  return (
    <p>
      Endpoint: {health.label}. {health.detail}
    </p>
  );
}
