import { useEffect, useId, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Cancel01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  candidateIdentity,
  createServerDiscoveryClient,
  discoveryAddresses,
  DISCOVERY_LIMITS,
  type DiscoveryResult,
  type ServerCandidate,
} from "@/modules/ai/lib/serverDiscovery";
import type { SelfHostedEndpoint } from "@/modules/ai/lib/selfHostedProfiles";

const client = createServerDiscoveryClient();
const SOURCES: Record<ServerCandidate["source"], string> = {
  "user-address/compatible-inventory":
    "Compatible model inventory; backend unspecified",
  "user-address/ollama-inventory":
    "Ollama-shaped inventory; unverified backend hint",
  "user-address/authentication-required":
    "Authentication required; backend unspecified",
};

export function ServerDiscovery({
  endpoints,
  onSelect,
}: {
  endpoints: readonly SelfHostedEndpoint[];
  onSelect: (candidate: ServerCandidate) => void;
}) {
  const id = useId();
  const [addresses, setAddresses] = useState("");
  const [privateNetwork, setPrivateNetwork] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
    },
    [],
  );
  const cancel = () => {
    epoch.current++;
    controller.current?.abort();
    setBusy(false);
    setResult(null);
    setStatus("Discovery cancelled. Manual entry remains available.");
  };
  const discover = async () => {
    controller.current?.abort();
    const token = ++epoch.current;
    const run = new AbortController();
    controller.current = run;
    setResult(null);
    setBusy(true);
    setStatus("Checking candidate addresses...");
    const deadline = setTimeout(() => {
      if (token !== epoch.current) return;
      epoch.current++;
      run.abort();
      setBusy(false);
      setStatus("Discovery timed out. Manual entry remains available.");
    }, DISCOVERY_LIMITS.uiDeadlineMs);
    try {
      const found = await client.discover(
        discoveryAddresses(addresses),
        privateNetwork,
        run.signal,
      );
      if (token !== epoch.current) return;
      setResult(found);
      setStatus(
        found.timedOut
          ? "Discovery timed out; only completed candidates are shown."
          : found.candidates.length
            ? `${found.candidates.length} untrusted candidates found.`
            : "No discoverable servers found. You can still add one manually.",
      );
    } catch (error) {
      if (token === epoch.current)
        setStatus(
          error instanceof Error &&
            error.message.startsWith("Enter one to eight")
            ? error.message
            : "Discovery unavailable. Check addresses and network access, or add a server manually.",
        );
    } finally {
      clearTimeout(deadline);
      if (token === epoch.current) setBusy(false);
    }
  };
  return (
    <details className="server-discovery">
      <summary>Discover servers</summary>
      <div className="server-discovery-body">
        <label htmlFor={`${id}-addresses`}>
          Candidate addresses (one per line)
        </label>
        <textarea
          id={`${id}-addresses`}
          rows={3}
          maxLength={DISCOVERY_LIMITS.inputBytes}
          value={addresses}
          onChange={(e) => setAddresses(e.target.value)}
          placeholder="http://localhost:11434"
          disabled={busy}
        />
        <label className="server-check">
          <input
            type="checkbox"
            checked={privateNetwork}
            onChange={(e) => setPrivateNetwork(e.target.checked)}
            disabled={busy}
          />
          Allow localhost/private addresses for this discovery only
        </label>
        <p className="server-warning">
          User-supplied addresses only. Up to 8 addresses, 2 metadata GETs each,
          64 KiB per response, 15 seconds. No credentials. Results are not
          trusted or configured.
        </p>
        <div className="server-heading">
          {busy ? (
            <Button type="button" size="sm" variant="outline" onClick={cancel}>
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
              Cancel discovery
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void discover()}
            >
              <HugeiconsIcon icon={Search01Icon} size={14} />
              Discover servers
            </Button>
          )}
          <span role="status">{status}</span>
        </div>
        {result?.issues.map((issue) => (
          <p key={issue.index} className="server-warning">
            Address {issue.index + 1}: {issue.code.replace(/-/g, " ")}. No
            candidate retained.
          </p>
        ))}
        <ul className="server-discovery-results">
          {result?.candidates.map((item) => {
            const url = new URL(item.baseURL);
            const existing = endpoints.some((endpoint) => {
              try {
                return (
                  endpoint.deletedAt === undefined &&
                  candidateIdentity(endpoint.baseURL) ===
                    candidateIdentity(item.baseURL)
                );
              } catch {
                return false;
              }
            });
            return (
              <li key={candidateIdentity(item.baseURL)}>
                <strong>
                  {url.hostname}:
                  {url.port || (url.protocol === "https:" ? "443" : "80")}
                </strong>
                <span>{item.baseURL}</span>
                <small>
                  Source: user-provided address / {SOURCES[item.source]}
                  {existing ? " / Already configured" : ""}
                </small>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onSelect(item)}
                >
                  <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
                  Use address
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
