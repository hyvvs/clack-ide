import { useEffect, useId, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
  RefreshIcon,
  Delete02Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import { ProviderIcon } from "@/settings/components/ProviderIcon";
import { CalibrationControls } from "@/settings/components/CalibrationControls";
import { describeConnectionAddress } from "@/modules/ai/lib/connectionPresentation";
import { ServerDiscovery } from "@/settings/components/ServerDiscovery";
import { selfHostedHealth } from "@/modules/ai/lib/selfHostedHealth";
import {
  deleteSelfHostedEndpoint,
  type SelfHostedEndpoint,
  type SelfHostedBackend,
  endpointBackend,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  SELF_HOSTED_BACKENDS,
  endpointAllowsPrivate,
  endpointProvider,
  saveSelfHostedModel,
  savedSelfHostedModelInfos,
} from "@/modules/ai/lib/selfHostedModels";
import {
  createSelfHostedProbeClient,
  normalizeProbeError,
  type ProbeSnapshot,
} from "@/modules/ai/lib/selfHostedProbe";
import {
  saveServerConfiguration,
  serverConnectionStatus,
  retainServerInventory,
} from "@/modules/ai/lib/selfHostedSetup";
import { serverModelDetails } from "@/modules/ai/lib/selfHostedCapabilities";
import { useSelfHostedInventory } from "@/modules/ai/hooks/useSelfHostedInventory";
import { modelOnboarding } from "@/modules/ai/lib/modelOnboarding";
import { ModelOnboardingDetails } from "@/settings/components/ModelOnboardingDetails";
import { remoteSsh, remoteSshMessage, remoteSshUrl, type RemoteSshConfig, type RemoteSshStatus } from "@/modules/ai/lib/remoteSsh";
import { RemoteSshFields } from "@/settings/components/RemoteSshFields";
import "@/settings/components/SelfHostedServers.css";

const probeClient = createSelfHostedProbeClient();
const options = (server: SelfHostedEndpoint, model?: string) => ({
  endpointId: server.id,
  selectedModelId: model,
  allowPrivateNetwork: endpointAllowsPrivate(server),
});

export function SelfHostedServers({ addRequest = 0 }: { addRequest?: number }) {
  useSelfHostedInventory();
  const state = usePreferencesStore((s) => s.selfHostedInference);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (addRequest) setEditing("new");
  }, [addRequest]);
  const endpoints = state.endpoints.filter((e) => e.deletedAt === undefined);
  const edit = endpoints.find((e) => e.id === editing);
  return (
    <section className="self-hosted-servers" aria-label="Self-hosted servers">
      <div className="server-heading">
        <h3>Self-hosted servers</h3>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <HugeiconsIcon icon={Add01Icon} size={14} />
          Add self-hosted server
        </Button>
      </div>
      {editing !== null ? (
        <ServerEditor
          key={editing}
          endpoint={edit}
          onClose={() => setEditing(null)}
          onCreated={setEditing}
        />
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {endpoints.map((endpoint) => {
        const models = savedSelfHostedModelInfos({ ...state, endpoints: [endpoint] });
        return (
          <div className="server-row focus-visible:outline focus-visible:outline-1" key={endpoint.id} data-settings-connection={endpoint.id} tabIndex={-1}>
            <ProviderIcon provider={endpointProvider(endpoint)} size={17} />
            <button
              type="button"
              className="server-identity"
              onClick={() => setEditing(endpoint.id)}
              aria-label={`Manage ${endpoint.alias}`}
            >
              <strong>{endpoint.alias}</strong>
              <span>
                {models.length} {models.length === 1 ? "model" : "models"}
              </span>
              {models.length ? (
                <small>
                  {models
                    .slice(0, 3)
                    .map((p) => p.label)
                    .join(" / ")}
                  {models.length > 3 ? " ..." : ""}
                </small>
              ) : null}
            </button>
            <Button
              size="icon-sm"
              variant="ghost"
              title={`Delete ${endpoint.alias}`}
              aria-label={`Delete ${endpoint.alias}`}
              onClick={() => {
                if (
                  !window.confirm(
                    `Delete ${endpoint.alias}? Its chats will show Model unavailable. Running requests keep their captured settings.`,
                  )
                )
                  return;
                void updateSelfHostedProfiles((s) =>
                  deleteSelfHostedEndpoint(s, endpoint.id),
                )
                  .then(() => {
                    if (editing === endpoint.id) setEditing(null);
                  })
                  .catch(() => setError("Could not delete server. Try again."));
              }}
            >
              <HugeiconsIcon icon={Delete02Icon} size={15} />
            </Button>
          </div>
        );
      })}
    </section>
  );
}

function ServerEditor({
  endpoint,
  onClose,
  onCreated,
}: {
  endpoint?: SelfHostedEndpoint;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const formId = useId();
  const [draftId] = useState(() => `sh-${crypto.randomUUID()}`);
  const [alias, setAlias] = useState(endpoint?.alias ?? "AI Server");
  const [baseURL, setBaseURL] = useState(endpoint?.baseURL ?? "");
  const [mode, setMode] = useState(endpoint?.ssh ? "ssh" : endpoint ? "direct" : "local");
  const [ssh, setSsh] = useState<RemoteSshConfig>(endpoint?.ssh ?? { host: "", username: "", port: 22, keyPath: null, remoteHost: "127.0.0.1", remotePort: 11434 });
  const [transport, setTransport] = useState<RemoteSshStatus | null>(null);
  const remote = mode === "ssh";
  const address = remote ? remoteSshUrl(endpoint?.id ?? draftId) : baseURL;
  const [backend, setBackend] = useState<SelfHostedBackend | "">(
    endpoint?.backendHint ?? "",
  );
  const [privateNetwork, setPrivateNetwork] = useState(
    endpoint ? endpointAllowsPrivate(endpoint) : false,
  );
  const [password, setPassword] = useState("");
  const [removeCredential, setRemoveCredential] = useState(false);
  const [snapshot, setSnapshot] = useState<ProbeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [manual, setManual] = useState("");
  const [detailModel, setDetailModel] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const epoch = useRef(0);
  const persisted = useRef(endpoint);
  const searchRef = useRef<HTMLInputElement>(null);
  const state = usePreferencesStore((s) => s.selfHostedInference);
  const current =
    state.endpoints.find((e) => e.id === (endpoint?.id ?? draftId)) ??
    persisted.current;
  const changed =
    !current ||
    alias.trim() !== current.alias ||
    address.trim() !== current.baseURL ||
    JSON.stringify(remote ? ssh : null) !== JSON.stringify(current.ssh ?? null) ||
    backend !== (current.backendHint ?? "") ||
    privateNetwork !== endpointAllowsPrivate(current) ||
    !!password ||
    removeCredential;
  const visibleSnapshot =
    snapshot?.configurationRevision === current?.configurationRevision
      ? snapshot
      : null;
  const [evidenceClock, setEvidenceClock] = useState(0);
  useEffect(() => {
    if (!visibleSnapshot) return;
    const now = Math.max(evidenceClock, Date.now());
    const expiries = [
      visibleSnapshot.observedAt + visibleSnapshot.inventoryTtlMs,
      ...visibleSnapshot.models.flatMap((model) =>
        model.evidence.flatMap((e) =>
          e.observedAt == null
            ? []
            : [
                e.observedAt + visibleSnapshot.instanceTtlMs,
                e.observedAt + visibleSnapshot.inventoryTtlMs,
              ],
        ),
      ),
    ].filter((time) => time > now);
    if (!expiries.length) return;
    const timer = setTimeout(
      () => setEvidenceClock(Date.now()),
      expiries.reduce((earliest, time) => Math.min(earliest, time), Infinity) -
        now +
        1,
    );
    return () => clearTimeout(timer);
  }, [visibleSnapshot, evidenceClock]);

  useEffect(() => {
    if (!endpoint) return;
    let alive = true;
    const token = epoch.current;
    void probeClient
      .inspect(options(endpoint))
      .then(async ({ cached, refresh }) => {
        if (alive && epoch.current === token) setSnapshot(cached);
        const value = await refresh;
        if (value && alive && epoch.current === token) setSnapshot(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [endpoint]);
  const remoteId = remote ? current?.id : undefined;
  useEffect(() => {
    if (!remoteId) return;
    let alive = true;
    const poll = () => void remoteSsh.status(remoteId).then(status => { if (alive) setTransport(status); }).catch(() => {});
    poll();
    const timer = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [remoteId]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );

  const connect = async (model?: string, approveFingerprint?: string) => {
    if (busy) return;
    const token = ++epoch.current;
    setBusy(true);
    setError("");
    setSaved(false);
    const secret = password;
    setPassword("");
    try {
      if (
        persisted.current &&
        current &&
        (persisted.current.configurationRevision !==
          current.configurationRevision ||
          persisted.current.revision !== current.revision)
      )
        throw new Error("Server settings changed. Reopen this server.");
      const server = changed
        ? await saveServerConfiguration(
            current,
            {
              alias,
              baseURL: address.trim(),
              ssh: remote ? ssh : null,
              backendHint: backend || undefined,
              allowPrivateNetwork: privateNetwork,
              removeCredential,
            },
            secret,
            draftId,
          )
        : current;
      if (!server) throw new Error("Server unavailable");
      persisted.current = server;
      if (epoch.current !== token) return;
      setBaseURL(server.baseURL);
      setRemoveCredential(false);
      if (server.ssh) {
        const status = await remoteSsh.connect(server.id, approveFingerprint);
        if (epoch.current !== token) return;
        setTransport(status);
        if (status.state !== "connected") return;
      }
      const result = await probeClient.refresh(options(server, model));
      if (epoch.current !== token) return;
      setSnapshot((previous) => retainServerInventory(previous, result));
      setDetailModel(model);
      if (server.ssh && !result.connected) setError("Connected to the computer, but the provider is unavailable or incompatible on the configured loopback port.");
      searchRef.current?.focus();
      if (!model && result.connected && result.backend === "ollama") {
        const started = Date.now();
        for (const candidate of result.models.slice(0, 12)) {
          if (epoch.current !== token || Date.now() - started >= 20_000) break;
          const profile = usePreferencesStore.getState().selfHostedInference.profiles.find(p => p.endpointId === server.id && p.transportModelId === candidate.id && p.deploymentId === null);
          if (profile && modelOnboarding(usePreferencesStore.getState().selfHostedInference, profile)?.evidence.some(e => e.metric === "probe.runtimeContext")) continue;
          const metadata = await probeClient.refresh(options(server, candidate.id));
          if (epoch.current !== token) return;
          setSnapshot(previous => retainServerInventory(previous, metadata));
          if (!metadata.connected) break;
        }
      }
    } catch {
      if (epoch.current === token)
        setError(
          "Could not save or connect to this server. Check the address, credential storage and network access.",
        );
    } finally {
      if (epoch.current === token) setBusy(false);
    }
  };
  const rows = useMemo(
    () =>
      (visibleSnapshot?.models ?? []).filter((m) =>
        `${m.name ?? ""} ${m.id}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    [visibleSnapshot, search],
  );
  const details =
    current && detailModel
      ? serverModelDetails(current, detailModel, visibleSnapshot)
      : null;
  const connectionHealth = current ? selfHostedHealth({ endpoint: current, snapshot: visibleSnapshot, checking: busy }).label : serverConnectionStatus(visibleSnapshot, busy);
  const save = async () => {
    if (!current || changed || busy) return;
    setSaving(true);
    setError("");
    try {
      const ids = manual.trim() ? [manual.trim()] : [];
      await updateSelfHostedProfiles((state) => {
        const latest = state.endpoints.find((e) => e.id === current.id);
        if (
          latest?.configurationRevision !== current.configurationRevision ||
          latest.deletedAt !== undefined
        )
          throw new Error("Server changed");
        return ids.reduce(
          (next, id) =>
            saveSelfHostedModel(
              next,
              current.id,
              id,
              visibleSnapshot?.models.find((m) => m.id === id)?.name ??
                undefined,
            ),
          state,
        );
      });
      setSaved(true);
      setManual("");
      if (!endpoint) onCreated(current.id);
    } catch {
      setError(
        "Could not save models. Check the model IDs and reopen the server if its settings changed.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="server-editor">
      <div className="server-heading">
        <h4>{endpoint ? endpoint.alias : "Add self-hosted server"}</h4>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Close server setup"
          title="Close server setup"
          disabled={busy || saving}
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={15} />
        </Button>
      </div>
      {!endpoint && !current && !remote && (
        <ServerDiscovery
          endpoints={state.endpoints}
          onSelect={(candidate) => {
            setBaseURL(candidate.baseURL);
            setBackend(candidate.backendHint ?? "");
            setPrivateNetwork(false);
            setPassword("");
            setSnapshot(null);
            setError("");
            requestAnimationFrame(() =>
              document.getElementById(`${formId}-address`)?.focus(),
            );
          }}
        />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void connect(detailModel);
        }}
      >
        <fieldset disabled={busy || saving} className="server-fields">
          {!endpoint && <label>Location
            <select aria-label="Server location" value={mode} onChange={e => {
              setMode(e.target.value); setTransport(null);
              if (e.target.value === "local") setBaseURL("http://127.0.0.1:11434/");
              else if (e.target.value === "direct") setBaseURL("");
              setPassword(""); setRemoveCredential(remote); setSnapshot(null);
            }}>
              <option value="local">On this computer</option>
              <option value="ssh">Another computer (SSH)</option>
              <option value="direct">Advanced HTTP / HTTPS endpoint</option>
            </select>
          </label>}
          <label htmlFor={`${formId}-name`}>
            Name
            <Input
              id={`${formId}-name`}
              autoFocus
              value={alias}
              maxLength={128}
              onChange={(e) => setAlias(e.target.value)}
              required
            />
          </label>
          {remote ? <RemoteSshFields value={ssh} onChange={value => { setSsh(value); setTransport(null); }} /> : <label htmlFor={`${formId}-address`}>
            Address
            <Input
              id={`${formId}-address`}
              type="url"
              value={baseURL}
              maxLength={4096}
              placeholder="http://192.168.1.50:11434"
              onChange={(e) => setBaseURL(e.target.value)}
              required
            />
          </label>}
          <details className="server-details">
          <summary>Advanced connection settings</summary>
          <label>
            Server type
            <select
              value={backend}
              onChange={(e) =>
                setBackend(e.target.value as SelfHostedBackend | "")
              }
            >
              <option value="">Automatic</option>
              {Object.entries(SELF_HOSTED_BACKENDS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          </details>
          {!remote && <label htmlFor={`${formId}-credential`}>
            {current?.credentialRef
              ? "Replace credential (optional)"
              : "Credential (optional)"}
            <Input
              id={`${formId}-credential`}
              type="password"
              autoComplete="new-password"
              maxLength={16384}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>}
          {current?.credentialRef ? (
            <label className="server-check">
              <input
                type="checkbox"
                checked={removeCredential}
                onChange={(e) => setRemoveCredential(e.target.checked)}
              />
              Use without authentication
            </label>
          ) : null}
          <label className="server-check">
            <input
              type="checkbox"
              checked={privateNetwork}
              onChange={(e) => setPrivateNetwork(e.target.checked)}
            />
            Allow localhost and private-network access for this server
          </label>
        </fieldset>
        <p className="text-xs [overflow-wrap:anywhere]">Destination: {remote ? `${ssh.username}@${ssh.host} (SSH)` : `${describeConnectionAddress(baseURL).label}${describeConnectionAddress(baseURL).address ? ` - ${describeConnectionAddress(baseURL).address}` : ""}`}</p>
        <div className="server-heading">
          <span className="server-status" role="status">
            {remote && transport ? remoteSshMessage(transport.state) : connectionHealth === "Ready" ? "Connected" : connectionHealth}
          </span>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy || saving || !alias.trim() || (remote ? !ssh.host || !ssh.username : !baseURL.trim())}
          >
            <HugeiconsIcon icon={RefreshIcon} size={14} />
            {changed || !visibleSnapshot ? "Connect" : "Refresh"}
          </Button>
        </div>
      </form>
      {remote && <div className="server-heading">
        <Button size="sm" variant="outline" onClick={() => {
          ++epoch.current; setBusy(false); setTransport(null);
          void remoteSsh.disconnect(current?.id ?? draftId);
        }}>{busy ? "Cancel connection" : "Disconnect"}</Button>
      </div>}
      {remote && transport?.state === "verification-required" && <section aria-label="Verify this computer" className="server-warning">
        <h4>Verify this computer</h4>
        <p>Confirm this fingerprint with the computer's owner before trusting it.</p>
        <code className="[overflow-wrap:anywhere]">{transport.fingerprint}</code>
        <Button size="sm" disabled={busy} onClick={() => void connect(undefined, transport.fingerprint ?? undefined)}>Trust &amp; connect</Button>
      </section>}
      {remote && transport?.fingerprint && transport.state !== "verification-required" && <details className="server-details"><summary>Host verification</summary><p className="[overflow-wrap:anywhere]">{transport.fingerprint}</p><p>{transport.trustSource}</p></details>}
      {!remote && baseURL.startsWith("http:") ? (
        <p className="server-warning">
          HTTP is unencrypted. Use HTTPS and authentication on untrusted
          networks. Private-network access is not a local-only guarantee.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="server-warning">
          {error}
        </p>
      ) : null}
      {visibleSnapshot?.errors.length ? (
        <p className="server-warning" role="status">
          {
            normalizeProbeError(
              visibleSnapshot.errors[visibleSnapshot.errors.length - 1].error,
            ).message
          }
        </p>
      ) : null}
      {current ? (
        <>
          <div className="server-heading">
            <h4>Models on {current.alias}</h4>
            <span>
              {endpointBackend(current)
                ? SELF_HOSTED_BACKENDS[endpointBackend(current) as SelfHostedBackend]
                : "Backend could not be confirmed"}
            </span>
          </div>
          <Input
            ref={searchRef}
            aria-label="Search server models"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setSearch(""); } }}
          />
          <section
            className="server-models"
            aria-label="Discovered server models"
          >
            {rows.slice(0, 60).map((model) => {
              const profile = state.profiles.find(p => p.endpointId === current.id && p.transportModelId === model.id && p.deploymentId === null);
              const view = profile ? modelOnboarding(state, profile) : null;
              return (
              <div className="server-model" key={model.id}>
                <div>
                  <span>
                    <strong>{model.name ?? model.id}</strong>
                    <small>
                      {view?.status ?? "Unverified"} / {current.alias}
                      {model.chat === "unsupported"
                        ? " / Not a chat model"
                        : ""}
                    </small>
                    <small>Tools: {view?.tools ?? "Unverified"} / Reasoning: {view?.reasoning.recommended ?? "Unknown"} / Vision: {view?.vision ?? "Unverified"}</small>
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy || changed}
                  onClick={() => {
                    setDetailModel(model.id);
                    void connect(model.id);
                  }}
                >
                Settings
                </button>
              </div>
            );})}
            {!rows.length ? (
              <p>
                {visibleSnapshot?.models.length
                  ? "No matching models."
                  : "No model list available. Enter a model ID manually."}
              </p>
            ) : null}
          </section>
          {rows.length > 60 ? (
            <p>Showing 60 of {rows.length}. Refine search for more results.</p>
          ) : null}
          {detailModel && state.profiles.filter(p => p.endpointId === current.id && p.transportModelId === detailModel && p.deploymentId === null).map(p => <ModelOnboardingDetails key={p.id} state={state} profile={p} disabled={changed || busy || saving} />)}
          <details className="server-details"><summary>Advanced</summary>
          <CalibrationControls endpointId={current.id} disabled={changed || busy || saving} snapshot={visibleSnapshot} />
          <label className="server-manual" htmlFor={`${formId}-manual`}>
            Manual model ID
            <Input
              id={`${formId}-manual`}
              aria-label="Manual model ID"
              value={manual}
              maxLength={2048}
              onChange={(e) => {
                setManual(e.target.value);
                setSaved(false);
              }}
              placeholder="Model ID"
            />
            <small>Unverified / Model metadata unavailable</small>
          </label>
          {details ? (
            <details className="server-details" open>
              <summary>{detailModel}</summary>
              <dl>
                <dt>Server context</dt>
                <dd>{details.serverContext}</dd>
                <dt>Advertised maximum</dt>
                <dd>{details.advertisedContext}</dd>
                <dt>Capabilities</dt>
                <dd>
                  Text {details.capabilities.text} / Tools{" "}
                  {details.capabilities.tools} / Vision{" "}
                  {details.capabilities.image}
                </dd>
                <dt>Metadata</dt>
                <dd>
                  {details.verified
                    ? "Recent server metadata"
                    : "Unverified or expired"}
                </dd>
                <dt>Loaded state</dt>
                <dd>
                  {details.loaded === true
                    ? "Loaded (recent server report)"
                    : details.loaded === false
                      ? "Not loaded (recent server report)"
                      : "Unknown"}
                </dd>
                <dt>Authentication</dt>
                <dd>
                  {current.credentialRef ? "Configured" : "Not configured"}
                </dd>
                <dt>Last successful probe</dt>
                <dd>
                  {visibleSnapshot?.observedAt && visibleSnapshot.models.length
                    ? new Date(visibleSnapshot.observedAt).toLocaleString()
                    : "Unknown"}
                </dd>
              </dl>
            </details>
          ) : null}
          <div className="server-heading">
            <span role="status">
              {saved ? "Manual model saved" : ""}
            </span>
            <Button
              size="sm"
              disabled={
                changed ||
                busy ||
                saving ||
                !manual.trim()
              }
              onClick={() => void save()}
            >
              <HugeiconsIcon icon={Tick01Icon} size={14} />
              Add manual model
            </Button>
          </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
