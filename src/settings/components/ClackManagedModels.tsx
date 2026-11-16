import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import {
  attachManagedLocalGguf,
  managedLocalModelInfos,
  resolveManagedLocalSelection,
  type ManagedLocalMaterial,
} from "@/modules/ai/lib/managedLocalModels";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";

type InspectedGguf = {
  digest: string;
  fileIdentity: string;
  size: number;
  format: "gguf";
  formatVersion: number;
  displayName: string;
  family?: string | null;
  quantization?: string | null;
  declaredContext?: number | null;
};

export const DEFAULT_MANAGED_GGUF_MATERIAL: ManagedLocalMaterial = {
  version: 1, context: 4096, gpu: 0, tool: false, grammar: false,
};

function safeError(error: unknown): string {
  const message = typeof error === "string"
    ? error : error instanceof Error ? error.message : "";
  return message && message.length < 350
    ? message : "The managed local runtime operation failed. No external model was selected.";
}

export function ClackManagedModels() {
  const state = usePreferencesStore(s => s.selfHostedInference);
  const registered = useMemo(() => managedLocalModelInfos(state), [state]);
  const [runtime, setRuntime] = useState<ManagedLocalNativeStatus | null>(null);
  const [modelPresence, setModelPresence] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [inspection, setInspection] = useState<InspectedGguf | null>(null);
  const [context, setContext] = useState(4096);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = async () => {
    try {
      const value = await invoke<ManagedLocalNativeStatus>("managed_local_runtime_status");
      setRuntime(value);
    } catch {
      // No native adapter is not an installed engine.
      setRuntime(null);
    }
  };
  useEffect(() => {
    void refresh();
    // Do not continuously SHA-256 a release binary while Settings is idle.
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    const check = async () => {
      const presence = await Promise.all(registered.map(async info => {
        const found = resolveManagedLocalSelection(state, info.id);
        if (found.status !== "available" && found.status !== "unavailable") return null;
        const digest = found.artifact.digest!;
        const present = await invoke<boolean>("managed_local_runtime_model_present", { digest })
          .catch(() => false);
        return [digest, present] as const;
      }));
      if (active) setModelPresence(Object.fromEntries(presence.filter(
        (entry): entry is readonly [string, boolean] => entry !== null,
      )));
    };
    void check();
    const timer = setInterval(() => { void check(); }, 8_000);
    return () => { active = false; clearInterval(timer); };
  }, [registered, state]);

  async function chooseModel() {
    setError("");
    setMessage("");
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "GGUF local model", extensions: ["gguf"] }],
    });
    if (!path || typeof path !== "string") return;
    setBusy(true);
    setSelectedPath(null);
    setInspection(null);
    try {
      const inspected = await invoke<InspectedGguf>("managed_local_runtime_inspect", { path });
      if (inspected.format !== "gguf" || !/^sha256:[a-f0-9]{64}$/.test(inspected.digest))
        throw new Error("The selected model has no trusted GGUF identity");
      setSelectedPath(path);
      setInspection(inspected);
      setContext(4096);
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(false); }
  }

  async function importModel() {
    if (!inspection || !selectedPath || busy) return;
    setBusy(true);
    setError("");
    try {
      // Explicit copy policy: never modify the original; native import performs
      // a second digest check before atomically installing private GGUF bytes.
      const imported = await invoke<InspectedGguf>("managed_local_runtime_import", {
        path: selectedPath,
        expectedDigest: inspection.digest,
      });
      if (imported.digest !== inspection.digest)
        throw new Error("Model identity changed while importing");
      const material: ManagedLocalMaterial = {
        ...DEFAULT_MANAGED_GGUF_MATERIAL,
        context,
      };
      await updateSelfHostedProfiles(current =>
        attachManagedLocalGguf(current, {
          digest: imported.digest,
          displayName: imported.displayName,
          fileIdentity: imported.fileIdentity,
          size: imported.size,
          ...(imported.family ? { family: imported.family } : {}),
          ...(imported.quantization ? { quantization: imported.quantization } : {}),
          ...(imported.declaredContext ? { declaredContext: imported.declaredContext } : {}),
          material,
        }).state,
      );
      setInspection(null);
      setSelectedPath(null);
      setMessage("The GGUF file was copied and registered. Start its deployment when the approved runtime is installed.");
      await refresh();
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(false); }
  }

  async function installBundle() {
    setError("");
    const path = await open({
      multiple: false, directory: false,
      filters: [{ name: "Approved llama.cpp runtime archive", extensions: ["zip"] }],
    });
    if (!path || typeof path !== "string") return;
    setBusy(true);
    try {
      await invoke("managed_local_runtime_install_bundle", { path });
      setMessage("The approved Clack Managed Runtime bundle was installed.");
      await refresh();
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(false); }
  }

  async function start(selectionId: string) {
    const resolved = resolveManagedLocalSelection(state, selectionId);
    if (resolved.status !== "available" && resolved.status !== "unavailable") {
      setError("The selected managed deployment changed. Import/select it again.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await invoke("managed_local_runtime_start", {
        deploymentId: resolved.deployment.id,
        deploymentIdentity: resolved.identity,
      });
      setMessage("Starting the selected GGUF deployment. Readiness is checked by Clack's native process owner.");
      await refresh();
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    setError("");
    try {
      await invoke("managed_local_runtime_stop");
      setMessage("Managed inference process stopped. Registered models and evidence were preserved.");
      await refresh();
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(false); }
  }

  const installed = runtime?.installed === true;
  return (
    <section aria-label="Clack Managed local models" className="rounded-lg border border-border/70 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">This PC · Clack Managed</h3>
          <p className="text-xs text-muted-foreground">
            GGUF files via Clack-owned llama.cpp. Your original model file is never changed.
          </p>
        </div>
        <span className="text-xs text-muted-foreground" role="status">
          {runtime?.state ?? "Unavailable"} {runtime?.installed ? `· ${runtime.version}` : ""}
        </span>
      </div>
      {!installed && (
        <p className="text-xs text-muted-foreground">
          Not installed. Clack never runs an executable from PATH or silently downloads a model.
          Only a release-pinned archive with approved SHA-256 digests can be installed.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void chooseModel()} disabled={busy}>
          Add Local Model
        </Button>
        <Button size="sm" variant="outline" onClick={() => void installBundle()} disabled={busy || installed}>
          Install approved runtime ZIP
        </Button>
        {runtime?.processId && (
          <Button size="sm" variant="outline" onClick={() => void stop()} disabled={busy}>
            Stop runtime
          </Button>
        )}
      </div>
      {inspection && (
        <div className="rounded-md border border-border/70 p-3 space-y-2" aria-label="GGUF inspection">
          <p className="text-xs font-medium">{inspection.displayName}</p>
          <p className="text-xs text-muted-foreground">
            GGUF v{inspection.formatVersion} · {(inspection.size / 1024 ** 3).toFixed(2)} GiB
            {" · "}{inspection.family ?? "Unknown architecture"}
            {" · "}{inspection.quantization ?? "Unknown quantization"}
            {" · "}{inspection.declaredContext ? `${inspection.declaredContext} reported context` : "Unknown context"}
          </p>
          <p className="break-all font-mono text-[10px] text-muted-foreground">SHA-256 {inspection.digest}</p>
          <label className="flex items-center gap-2 text-xs">
            Context allocation
            <select aria-label="Managed model context" value={context}
              onChange={event => setContext(Number(event.target.value))}
              className="rounded border border-border bg-background px-2 py-1">
              {[2048, 4096, 8192, 16384].map(size =>
                <option key={size} value={size}>{size.toLocaleString()} tokens</option>)}
            </select>
            CPU mode
          </label>
          <p className="text-xs text-muted-foreground">
            Import copies the file into Clack private content-addressed storage and registers
            a deployment. Import does not load or run the model.
          </p>
          <Button size="sm" onClick={() => void importModel()} disabled={busy}>
            Import &amp; register
          </Button>
        </div>
      )}
      {registered.length === 0 && <p className="text-xs text-muted-foreground">No managed GGUF deployments registered.</p>}
      {registered.map(model => {
        const found = resolveManagedLocalSelection(state, model.id);
        if (found.status !== "available" && found.status !== "unavailable") return null;
        const loaded = runtime?.deploymentId === found.deployment.id &&
          runtime?.modelDigest === found.artifact.digest;
        const fileMissing = modelPresence[found.artifact.digest!] === false;
        return (
          <div key={model.id} className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{model.label}</p>
              <p className="text-[11px] text-muted-foreground">
                {found.deployment.configurationIdentity
                  ? `CPU · ${JSON.parse(found.deployment.configurationIdentity).context} context`
                  : "CPU"} · {found.artifact.digest?.slice(7, 19)} ·
                {" "}{fileMissing ? "Model file missing" :
                  loaded ? runtime?.state : installed ? "Stopped / unverified" : "Runtime not installed"}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={busy || !installed || fileMissing ||
              (Boolean(runtime?.processId) && !loaded)}
              onClick={() => void start(model.id)}>
              {loaded ? "Load status" : "Start"}
            </Button>
          </div>
        );
      })}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
