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
import {
  deleteSelfHostedEndpoint,
  type SelfHostedEndpoint,
  type SelfHostedBackend,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  SELF_HOSTED_BACKENDS,
  endpointAllowsPrivate,
  endpointProvider,
  saveSelfHostedModel,
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
import "@/settings/components/SelfHostedServers.css";

const probeClient = createSelfHostedProbeClient();
const options = (server: SelfHostedEndpoint, model?: string) => ({
  endpointId: server.id,
  selectedModelId: model,
  allowPrivateNetwork: endpointAllowsPrivate(server),
});

export function SelfHostedServers({ addRequest = 0 }: { addRequest?: number }) {
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
        const models = state.profiles.filter(
          (p) =>
            p.endpointId === endpoint.id &&
            p.deploymentId === null &&
            (p.saved || endpoint.legacy?.profileId === p.id),
        );
        return (
          <div className="server-row" key={endpoint.id}>
            <ProviderIcon provider={endpointProvider(endpoint)} size={17} />
            <button
              type="button"
              className="server-identity"
              onClick={() => setEditing(endpoint.id)}
              aria-label={`Manage ${endpoint.alias}`}
            >
              <strong>{endpoint.alias}</strong>
              <span>
                {models.length} saved {models.length === 1 ? "model" : "models"}
              </span>
              {models.length ? (
                <small>
                  {models
                    .slice(0, 3)
                    .map((p) => p.saved?.label ?? p.transportModelId)
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
  const [selected, setSelected] = useState<string[]>([]);
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
    baseURL.trim() !== current.baseURL ||
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
      .read(options(endpoint))
      .then((value) => {
        if (alive && epoch.current === token) setSnapshot(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [endpoint]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );

  const connect = async (model?: string) => {
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
              baseURL: baseURL.trim(),
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
      const result = await probeClient.refresh(options(server, model));
      if (epoch.current !== token) return;
      setSnapshot((previous) => retainServerInventory(previous, result));
      setDetailModel(model);
      searchRef.current?.focus();
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
  const save = async () => {
    if (!current || changed || busy) return;
    setSaving(true);
    setError("");
    try {
      const ids = [
        ...new Set([...selected, ...(manual.trim() ? [manual.trim()] : [])]),
      ];
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
      setSelected([]);
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void connect(detailModel);
        }}
      >
        <fieldset disabled={busy || saving} className="server-fields">
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
          <label htmlFor={`${formId}-address`}>
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
          </label>
          <label>
            Server type
            <select
              value={backend}
              onChange={(e) =>
                setBackend(e.target.value as SelfHostedBackend | "")
              }
            >
              <option value="">Not specified</option>
              {Object.entries(SELF_HOSTED_BACKENDS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${formId}-credential`}>
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
          </label>
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
        <div className="server-heading">
          <span className="server-status" role="status">
            {serverConnectionStatus(
              visibleSnapshot,
              busy,
              !!current?.credentialRef,
            )}
          </span>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy || saving || !alias.trim() || !baseURL.trim()}
          >
            <HugeiconsIcon icon={RefreshIcon} size={14} />
            {changed || !visibleSnapshot ? "Connect" : "Refresh"}
          </Button>
        </div>
      </form>
      {baseURL.startsWith("http:") ? (
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
              {current.backendHint
                ? `${SELF_HOSTED_BACKENDS[current.backendHint]} (selected type)`
                : "Backend could not be confirmed"}
            </span>
          </div>
          <Input
            ref={searchRef}
            aria-label="Search server models"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <section
            className="server-models"
            aria-label="Discovered server models"
          >
            {rows.slice(0, 60).map((model) => (
              <div className="server-model" key={model.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={model.chat === "unsupported" || changed || saving}
                    checked={selected.includes(model.id)}
                    onChange={(e) => {
                      setSaved(false);
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, model.id]
                          : ids.filter((id) => id !== model.id),
                      );
                    }}
                  />
                  <span>
                    <strong>{model.name ?? model.id}</strong>
                    <small>
                      {model.id}
                      {model.chat === "unsupported"
                        ? " / Not a chat model"
                        : ""}
                    </small>
                  </span>
                </label>
                <button
                  type="button"
                  disabled={busy || changed}
                  onClick={() => {
                    setDetailModel(model.id);
                    void connect(model.id);
                  }}
                >
                  Details
                </button>
              </div>
            ))}
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
              {saved
                ? "Models saved"
                : selected.length
                  ? `${selected.length} selected`
                  : ""}
            </span>
            <Button
              size="sm"
              disabled={
                changed ||
                busy ||
                saving ||
                (!selected.length && !manual.trim())
              }
              onClick={() => void save()}
            >
              <HugeiconsIcon icon={Tick01Icon} size={14} />
              Save models
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
