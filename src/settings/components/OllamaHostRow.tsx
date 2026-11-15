import { Button } from "@/components/ui/button";

export type OllamaHostConnection = "online" | "offline" | "unknown";

/** Presentation only. Connection evidence is not an Agent/tool-readiness proof. */
export function ollamaHostStatus(
  enabled: boolean,
  connection: OllamaHostConnection,
): string {
  if (!enabled) return "Disabled";
  if (connection === "online") return "Online (last check)";
  if (connection === "offline") return "Offline (last check)";
  return "Unknown — refresh to check";
}

/** Only stable, content-free probe codes are surfaced; never display raw failure text. */
export function ollamaProbeIssue(code?: string): string | null {
  if (!code) return null;
  if (code === "authentication-failed") return "Authentication required";
  if (code === "unreachable" || code === "dns-failure" || code === "timeout")
    return "Server could not be reached";
  if (code === "unsupported-probe-route") return "Model inventory unavailable";
  return "Metadata check failed";
}

export function OllamaHostRow({
  alias,
  address,
  location,
  enabled,
  connection,
  modelCount,
  version,
  lastCheckedAt,
  lastSuccessAt,
  lastErrorCode,
  busy = false,
  refreshing = false,
  onToggle,
  onRefresh,
  onEdit,
  onRemove,
}: {
  alias: string;
  address: string;
  location: "This PC" | "Other computer";
  enabled: boolean;
  connection: OllamaHostConnection;
  modelCount?: number;
  version?: string;
  lastCheckedAt?: number;
  lastSuccessAt?: number;
  lastErrorCode?: string | null;
  busy?: boolean;
  refreshing?: boolean;
  onToggle: (enabled: boolean) => void;
  onRefresh: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card/60 p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="text-sm">{alias}</strong>
          <span className="text-xs text-muted-foreground">{location}</span>
          <span role="status" className="text-xs text-muted-foreground">
            {ollamaHostStatus(enabled, connection)}
          </span>
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground">{address}</p>
        <p className="text-xs text-muted-foreground">
          {modelCount === undefined ? "Model inventory unknown" :
            `${modelCount} ${modelCount === 1 ? "discovered model" : "discovered models"}`}
          {version ? ` · Last reported Ollama ${version}` : " · Ollama version unknown"}
        </p>
        <p className="text-xs text-muted-foreground">
          {lastCheckedAt ? `Last check: ${new Date(lastCheckedAt).toLocaleString()}` : "Not checked"}
          {` · ${connection === "online" ? "Previously reachable" :
            connection === "offline" ? "Previously offline" : "Connection unknown"}`}
        </p>
        {lastSuccessAt ? (
          <p className="text-xs text-muted-foreground">
            Last successful check: {new Date(lastSuccessAt).toLocaleString()}
          </p>
        ) : null}
        {ollamaProbeIssue(lastErrorCode ?? undefined) ? (
          <p role="status" className="text-xs text-muted-foreground">
            Last probe: {ollamaProbeIssue(lastErrorCode ?? undefined)}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Connection does not establish model context or native tool readiness.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || refreshing || !enabled}
          title={!enabled ? "Enable this Ollama host before refreshing" : "Refresh Ollama model inventory"}
          onClick={onRefresh}
        >
          {refreshing ? "Checking…" : "Refresh"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onToggle(!enabled)}
          aria-label={`${enabled ? "Disable" : "Enable"} Ollama host ${alias}`}
        >
          {enabled ? "Disable" : "Enable"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onEdit}>
          Manage
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove Ollama host ${alias}`}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}
