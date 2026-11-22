import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { updateSelfHostedProfiles } from "@/modules/settings/store";
import {
  attachManagedLocalGguf,
  attachManagedCudaVariant,
  attachManagedExecutionPolicyVariant,
  managedLocalModelInfos,
  resolveManagedLocalSelection,
  MANAGED_LOCAL_HOST_ID,
  type ManagedLocalMaterial,
} from "@/modules/ai/lib/managedLocalModels";
import type { ManagedCudaVariantStatus, ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import {nativeHardwareObservationSchema,type NativeHardwareObservation} from "@/modules/ai/lib/hardwareProfile";
import { deploymentRequestedExecution, observedActualExecution } from "@/modules/ai/lib/executionBackendSelection";
import { requestedExecutionSchema, type ActualExecution, type RequestedExecution } from "@/modules/ai/lib/localComputeFabric";
import type { SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";

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

type ManagedPolicyBackend = "cpu" | "cuda";
type ManagedPolicyDevice = { id: string; label: string; free: number | null };

export type ManagedExecutionPolicyDraft = {
  preferredBackend: ManagedPolicyBackend;
  cudaDeviceId: string;
  allowFallback: boolean;
  gpuLayers: string;
  cpuThreads: string;
  contextLength: string;
  maxHostMiB: string;
  maxDeviceMiB: string;
  reserveHostMiB: string;
  reserveDeviceMiB: string;
};

const MANAGED_POLICY_BACKENDS = ["cpu", "cuda"] as const;

/** The two native managed implementations are CPU and CUDA. Other Fabric
 * backend names remain representable in the domain, but cannot execute here. */
export function initialManagedExecutionPolicyDraft(
  request: RequestedExecution | null,
  defaultContext: number,
  devices: ManagedPolicyDevice[],
): ManagedExecutionPolicyDraft {
  const candidate = request?.candidates?.[0];
  const preferredBackend = MANAGED_POLICY_BACKENDS.find(backend =>
    backend === (candidate?.backend ?? request?.backend)) ?? "cpu";
  const cuda = request?.candidates?.find(row => row.backend === "cuda");
  const previousDevice = cuda?.deviceIds[0] ?? request?.deviceIds.find(id => id.includes(":accelerator:")) ??
    request?.deviceStrategy?.primaryDeviceId;
  const budget = request?.memoryBudget;
  const toMiB = (bytes?: number) => bytes === undefined ? "" : String(bytes / (1024 ** 2));
  return {
    preferredBackend,
    cudaDeviceId: previousDevice ?? devices[0]?.id ?? "",
    allowFallback: (request?.candidates?.length ?? 0) > 1 ||
      (preferredBackend === "cuda" && request?.fallback.policy === "allow-compatible"),
    gpuLayers: String(cuda?.gpuLayers ?? (preferredBackend === "cuda" ? request?.gpuLayers : undefined) ?? 40),
    cpuThreads: request?.cpuThreads === undefined ? "" : String(request.cpuThreads),
    contextLength: String(request?.contextLength ?? defaultContext),
    maxHostMiB: toMiB(budget?.maxHostBytes),
    maxDeviceMiB: toMiB(budget?.maxDeviceBytes),
    reserveHostMiB: toMiB(budget?.reserveHostBytes),
    reserveDeviceMiB: toMiB(budget?.reserveDeviceBytes),
  };
}

function positiveInteger(input: string, label: string, min: number, max: number): number {
  const value = Number(input);
  if (!input.trim() || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}

function optionalInteger(input: string, label: string, max: number): number | undefined {
  return input.trim() ? positiveInteger(input, label, 1, max) : undefined;
}

function budgetMiB(input: string, label: string, allowZero: boolean): number | undefined {
  if (!input.trim()) return undefined;
  const value = Number(input);
  const bytes = value * (1024 ** 2);
  if (!Number.isInteger(value) || !Number.isSafeInteger(bytes) ||
      value < (allowZero ? 0 : 1) || value > 8_589_934_591)
    throw new Error(`${label} must be a nonnegative whole MiB value within safe limits.`);
  return bytes;
}

/** Builds an exact, validated persisted request; this is policy intent, never
 * a native Ready claim or permission to execute another backend. */
export function buildManagedExecutionPolicyRequest(draft: ManagedExecutionPolicyDraft): RequestedExecution {
  const contextLength = positiveInteger(draft.contextLength, "Context", 512, 131_072);
  const cpuThreads = optionalInteger(draft.cpuThreads, "CPU threads", 65_536);
  const hasCuda = draft.preferredBackend === "cuda" || draft.allowFallback;
  const gpuLayers = hasCuda ? positiveInteger(draft.gpuLayers, "GPU layers", 1, 999) : 0;
  if (hasCuda && !/^clack-this-pc:accelerator:GPU-[0-9a-fA-F-]{12,96}$/.test(draft.cudaDeviceId))
    throw new Error("Select a discovered NVIDIA GPU for the CUDA candidate.");
  const order: ManagedPolicyBackend[] = [draft.preferredBackend];
  if (draft.allowFallback) order.push(draft.preferredBackend === "cuda" ? "cpu" : "cuda");
  const candidates = order.map(backend => ({
    backend,
    deviceIds: backend === "cuda" ? [draft.cudaDeviceId] : ["clack-this-pc:cpu:0"],
    gpuLayers: backend === "cuda" ? gpuLayers : 0,
    runtimeVariantId: backend === "cuda" ? "b12248/cuda" : "b12248/cpu",
  }));
  const maxHostBytes = budgetMiB(draft.maxHostMiB, "Host RAM budget", false);
  const maxDeviceBytes = budgetMiB(draft.maxDeviceMiB, "GPU VRAM budget", false);
  const reserveHostBytes = budgetMiB(draft.reserveHostMiB, "Host RAM reserve", true);
  const reserveDeviceBytes = budgetMiB(draft.reserveDeviceMiB, "GPU VRAM reserve", true);
  const hasBudget = [maxHostBytes, maxDeviceBytes, reserveHostBytes, reserveDeviceBytes]
    .some(value => value !== undefined);
  return requestedExecutionSchema.parse({
    backend: draft.preferredBackend,
    deviceIds: draft.preferredBackend === "cuda" ? [draft.cudaDeviceId] : ["clack-this-pc:cpu:0"],
    gpuLayers: draft.preferredBackend === "cuda" ? gpuLayers : 0,
    ...(cpuThreads !== undefined ? { cpuThreads } : {}),
    contextLength,
    fallback: draft.allowFallback
      ? { policy: "explicit-order", order: order.slice(1) }
      : { policy: "disabled" },
    candidates,
    deviceStrategy: {
      kind: "single",
      primaryDeviceId: draft.preferredBackend === "cuda" ? draft.cudaDeviceId : "clack-this-pc:cpu:0",
    },
    ...(hasBudget ? { memoryBudget: {
      ...(maxHostBytes !== undefined ? { maxHostBytes } : {}),
      ...(maxDeviceBytes !== undefined ? { maxDeviceBytes } : {}),
      ...(reserveHostBytes !== undefined ? { reserveHostBytes } : {}),
      ...(reserveDeviceBytes !== undefined ? { reserveDeviceBytes } : {}),
    } } : {}),
  });
}

/** CAS may replay the updater on a conflict. Keep its transition pure and
 * validate the exact returned selection only after the write completes. */
export async function saveManagedExecutionPolicyVariant(
  sourceSelectionId: string,
  requested: RequestedExecution,
  update: typeof updateSelfHostedProfiles = updateSelfHostedProfiles,
): Promise<string> {
  let selectionId = "";
  const persisted = await update((current: SelfHostedState) => {
    const result = attachManagedExecutionPolicyVariant(current, sourceSelectionId, requested);
    selectionId = result.selectionId;
    return result.state;
  });
  const resolved = resolveManagedLocalSelection(persisted, selectionId);
  if (resolved.status !== "available" && resolved.status !== "unavailable")
    throw new Error("The saved policy selection could not be verified in persisted settings.");
  return selectionId;
}

export function ManagedExecutionPolicyEditor({
  sourceSelectionId, request, contextLength, devices, disabled, onSave,
}: {
  sourceSelectionId: string;
  request: RequestedExecution | null;
  contextLength: number;
  devices: ManagedPolicyDevice[];
  disabled: boolean;
  onSave: (sourceSelectionId: string, request: RequestedExecution) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() =>
    initialManagedExecutionPolicyDraft(request, contextLength, devices));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasCuda = draft.preferredBackend === "cuda" || draft.allowFallback;
  // The native device observation arrives after the Settings page renders.
  // Resolve a newly observed default without silently editing persisted intent.
  const effectiveCudaDeviceId = draft.cudaDeviceId || devices[0]?.id || "";
  const selectedDeviceKnown = devices.some(device => device.id === effectiveCudaDeviceId);
  const change = <K extends keyof ManagedExecutionPolicyDraft>(key: K, value: ManagedExecutionPolicyDraft[K]) => {
    setSaved(false);
    setDraft(previous => ({ ...previous, [key]: value }));
  };
  const fieldClass = "w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-xs";
  const save = async () => {
    if (disabled || saving) return;
    setError("");
    setSaved(false);
    let requested: RequestedExecution;
    try { requested = buildManagedExecutionPolicyRequest({
      ...draft, cudaDeviceId: effectiveCudaDeviceId,
    }); }
    catch (cause) { setError(safeError(cause)); return; }
    setSaving(true);
    try {
      await onSave(sourceSelectionId, requested);
      setSaved(true);
    }
    catch (cause) { setError(safeError(cause)); }
    finally { setSaving(false); }
  };
  return (
    <details className="rounded-md border border-border/60 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">Create execution policy variant</summary>
      <div className="space-y-2 pt-3">
        <p className="text-muted-foreground">
          Save a separate exact deployment with its own model selection. Existing deployments and qualification evidence stay intact.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1"><span className="block">Preferred backend</span>
            <select aria-label="Policy preferred backend" className={fieldClass}
              value={draft.preferredBackend} disabled={disabled || saving}
              onChange={event => change("preferredBackend", event.target.value as ManagedPolicyBackend)}>
              <option value="cpu">CPU · managed b12248</option>
              <option value="cuda">CUDA · managed b12248</option>
            </select>
          </label>
          <label className="space-y-1"><span className="block">Fallback order</span>
            <select aria-label="Policy fallback order" className={fieldClass}
              value={draft.allowFallback ? "other" : "disabled"} disabled={disabled || saving}
              onChange={event => change("allowFallback", event.target.value === "other")}>
              <option value="disabled">None · exact backend only</option>
              <option value="other">Try {draft.preferredBackend === "cuda" ? "CPU after CUDA" : "CUDA after CPU"}</option>
            </select>
          </label>
        </div>
        <p className="text-muted-foreground">
          Candidate order: {draft.preferredBackend.toUpperCase()}
          {draft.allowFallback ? ` → ${draft.preferredBackend === "cuda" ? "CPU" : "CUDA"}` : " only"}.
          Fallback is explicitly authorized by this policy; actual execution still requires native proof.
        </p>
        {hasCuda && <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1"><span className="block">Preferred CUDA device</span>
            <select aria-label="Policy CUDA device" className={fieldClass}
              value={effectiveCudaDeviceId} disabled={disabled || saving || (!devices.length && !effectiveCudaDeviceId)}
              onChange={event => change("cudaDeviceId", event.target.value)}>
              {!effectiveCudaDeviceId && <option value="">No verified GPU detected</option>}
              {!selectedDeviceKnown && effectiveCudaDeviceId && <option value={effectiveCudaDeviceId}>Previously selected · not currently observed</option>}
              {devices.map(device => <option key={device.id} value={device.id}>
                {device.label} · {device.free === null ? "free VRAM unknown" : `${Math.round(device.free / 1024 ** 2)} MiB free`}
              </option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="block">GPU offload layers</span>
            <input aria-label="Policy GPU layers" className={fieldClass} type="number" min={1} max={999}
              value={draft.gpuLayers} disabled={disabled || saving}
              onChange={event => change("gpuLayers", event.target.value)} />
          </label>
        </div>}
        {hasCuda && !effectiveCudaDeviceId && <p role="status" className="text-muted-foreground">
          CUDA policy requires an observed NVIDIA GPU. Refresh native hardware status before saving.
        </p>}
        <details className="space-y-2 border-t border-border/60 pt-2">
          <summary className="cursor-pointer font-medium">Advanced · CPU, context and memory budgets</summary>
          <div className="grid gap-2 pt-2 sm:grid-cols-2">
            {([
              ["cpuThreads", "CPU threads", "1", "65536"],
              ["contextLength", "Context tokens", "512", "131072"],
              ["maxHostMiB", "Maximum host RAM (MiB)", "1", ""],
              ["maxDeviceMiB", "Maximum device VRAM (MiB)", "1", ""],
              ["reserveHostMiB", "Reserve host RAM (MiB)", "0", ""],
              ["reserveDeviceMiB", "Reserve device VRAM (MiB)", "0", ""],
            ] as const).map(([key, label, min, max]) =>
              <label key={key} className="space-y-1"><span className="block">{label}</span>
                <input aria-label={`Policy ${label}`} className={fieldClass} type="number"
                  min={min} max={max || undefined} step="1" placeholder={key === "contextLength" ? undefined : "Automatic"}
                  value={draft[key]} disabled={disabled || saving}
                  onChange={event => change(key, event.target.value)} />
              </label>)}
          </div>
          <p className="text-muted-foreground">Empty budgets and CPU threads leave native defaults unchanged. Limits are admission policy, not verified capacity.</p>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={disabled || saving || (hasCuda && !effectiveCudaDeviceId)}
            onClick={() => void save()}>
            {saving ? "Saving policy…" : "Save new policy variant"}
          </Button>
          <span className="text-muted-foreground">Registration only · no model launch</span>
        </div>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {saved && <p role="status" className="text-muted-foreground">
          Policy variant saved with a new exact selection. Choose it in the model picker to use it.
        </p>}
      </div>
    </details>
  );
}

function safeError(error: unknown): string {
  const message = typeof error === "string"
    ? error : error instanceof Error ? error.message : "";
  return message && message.length < 350
    ? message : "The managed local runtime operation failed. No external model was selected.";
}

/** Saved placement, native choice and verified execution have different authority. */
export function ManagedExecutionReadout({
  request, native, actual, loaded, installed, fileMissing,
}: {
  request: RequestedExecution | null;
  native: ManagedLocalNativeStatus | null;
  actual: ActualExecution | null;
  loaded: boolean;
  installed: boolean;
  fileMissing: boolean;
}) {
  const owner = loaded ? native : null;
  const selected = owner?.selectedBackend
    ? `${owner.selectedBackend.toUpperCase()} · ${owner.selectedGpuLayers ?? "unknown"} GPU layers${owner.selectedDeviceId ? ` · ${owner.selectedDeviceId}` : ""}`
    : "No matching native selection";
  const readiness = fileMissing ? "Model file missing · restore the imported GGUF before starting"
    : !installed ? "Runtime not installed"
    : !native ? "Native status unavailable · refresh to check"
    : !loaded ? "Stopped · no matching native launch"
    : owner?.state === "Ready" ? actual
      ? "Ready · native execution verified (Chat only; Agent qualification separate)"
      : "Native Ready · execution proof unavailable"
    : owner?.state === "Recovering" ? "Recovering · native CPU fallback has not become Ready"
    : owner?.state === "Failed" ? "Failed · check native error before retrying Start"
    : `${owner?.state ?? "Unknown"} · awaiting current native Ready and execution proof`;
  return (
    <section className="space-y-1 text-[11px] text-muted-foreground" aria-label="Managed requested selected actual execution">
      <div className="grid gap-1 sm:grid-cols-3">
        <p className="min-w-0 break-words"><strong className="text-foreground">Requested:</strong>{" "}
          {request ? `${request.backend.toUpperCase()} · ${request.gpuLayers ?? "unknown"} GPU layers · ${request.fallback.policy} fallback` : "Unknown"}
        </p>
        <p className="min-w-0 break-words"><strong className="text-foreground">Selected:</strong> {selected}</p>
        <p className="min-w-0 break-words"><strong className="text-foreground">Actual:</strong>{" "}
          {actual ? `${actual.backend.toUpperCase()} · ${actual.gpuLayers} GPU layers · ${actual.runtimeVariantId}` : "Not verified"}
        </p>
      </div>
      <p><strong className="text-foreground">Readiness:</strong> {readiness}</p>
      <details className="space-y-1">
        <summary className="cursor-pointer text-foreground">Device, fallback and recovery details</summary>
        <div className="space-y-1 break-all pl-2">
          <p>Requested device: {request?.deviceIds.length ? request.deviceIds.join(", ") : "Unspecified"}</p>
          {request?.candidates?.length ? <p>Saved candidate order: {request.candidates.map(
            candidate => `${candidate.backend.toUpperCase()} / ${candidate.runtimeVariantId ?? "variant unspecified"}`,
          ).join(" → ")}</p> : null}
          {request?.cpuThreads !== undefined && <p>Requested CPU threads: {request.cpuThreads}</p>}
          {request?.contextLength !== undefined && <p>Requested context: {request.contextLength.toLocaleString()} tokens</p>}
          {request?.memoryBudget && <p>Requested memory budgets: host {request.memoryBudget.maxHostBytes === undefined
            ? "native default" : `${Math.round(request.memoryBudget.maxHostBytes / 1024 ** 2)} MiB`}
            {" · "}device {request.memoryBudget.maxDeviceBytes === undefined
              ? "native default" : `${Math.round(request.memoryBudget.maxDeviceBytes / 1024 ** 2)} MiB`}</p>}
          <p>Selected device: {owner?.selectedDeviceId ?? "Not reported"}</p>
          <p>Actual device: {actual?.deviceIds.length ? actual.deviceIds.join(", ") : "Not verified"}</p>
          <p>Runtime variant: {actual?.runtimeVariantId ?? "Not verified"}</p>
          <p>Native fallback: {owner?.fallbackUsed
            ? `${owner.fallbackAuthorized ? "Authorized" : "Not authorized"} · ${owner.fallbackReason ?? "Reason unavailable"}`
            : "None reported"}</p>
          <p>Native recovery: {owner?.recoveryState === "pending-cpu-recovery"
            ? "CPU recovery pending; no Ready proof yet"
            : owner?.recoveryState === "cpu-fallback-launched"
              ? "CPU fallback launched; awaiting verified Ready"
              : owner?.recoveryState === "failed"
                ? "Recovery failed; manual action required"
                : "None reported"}</p>
          {owner?.failureKind && <p>Failure category: {owner.failureKind}</p>}
          {owner?.candidateEvaluations?.length ? (
            <div className="space-y-1" role="group" aria-label="Native persisted policy candidate evaluations">
              <p className="font-medium text-foreground">Native candidate admission (ordered)</p>
              {owner.candidateEvaluations.map(candidate => (
                <p key={`${candidate.policyPosition}:${candidate.backend}`} className="min-w-0 break-words">
                  #{candidate.policyPosition + 1} {candidate.backend.toUpperCase()}
                  {candidate.runtimeVariantId ? ` · ${candidate.runtimeVariantId}` : ""}
                  {` · ${candidate.state} · manifest ${candidate.verified ? "verified" : "unverified"}`}
                  {` · memory ${candidate.memoryAdmissible ? "admitted" : "not admitted"}`}
                  {candidate.reasons.length ? ` · ${candidate.reasons.join("; ")}` : ""}
                </p>
              ))}
            </div>
          ) : null}
          {owner?.inferenceRouteIssued && <p>Inference route was issued; startup recovery is no longer eligible.</p>}
          {owner?.error && <p role="alert">Native error: {owner.error}</p>}
          <p>Recovery: {fileMissing ? "Restore the imported model file."
            : !installed ? "Install the approved runtime."
            : owner?.state === "Recovering" ? "Native startup recovery is in progress. Await current Ready or Failed status."
            : owner?.state === "Failed" ? "Review the native failure, then retry Start. Existing registration is preserved."
            : owner?.state === "Starting" || owner?.state === "Loading"
              ? "Wait for a matching native Ready observation."
              : owner?.state === "Ready" && !actual
                ? "Refresh native status; do not treat an unverified launch as ready for Agent work."
                : "Start or refresh this exact deployment to obtain current native proof."}</p>
        </div>
      </details>
    </section>
  );
}

export function ClackManagedModels() {
  const state = usePreferencesStore(s => s.selfHostedInference);
  const registered = useMemo(() => managedLocalModelInfos(state), [state]);
  const [runtime, setRuntime] = useState<ManagedLocalNativeStatus | null>(null);
  const [cudaVariant, setCudaVariant] = useState<ManagedCudaVariantStatus | null>(null);
  const [hardware, setHardware] = useState<NativeHardwareObservation | null>(null);
  const [cudaDeviceId, setCudaDeviceId] = useState("");
  const [cudaLayers, setCudaLayers] = useState(40);
  const [cudaFallback, setCudaFallback] = useState<"disabled"|"allow-compatible">("disabled");
  const [runtimeBySelection, setRuntimeBySelection] =
    useState<Record<string, ManagedLocalNativeStatus | null>>({});
  const [modelPresence, setModelPresence] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [inspection, setInspection] = useState<InspectedGguf | null>(null);
  const [context, setContext] = useState(4096);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [rawCuda,rawHost] = await Promise.all([
        invoke<ManagedCudaVariantStatus>("managed_local_runtime_cuda_variant_status").catch(()=>null),
        invoke<unknown>("local_hardware_observation").catch(()=>null),
      ]);
      setCudaVariant(rawCuda?.runtimeVariantId==="b12248/cuda"?rawCuda:null);
      const parsed=nativeHardwareObservationSchema.safeParse(rawHost);
      setHardware(parsed.success?parsed.data:null);
      if (registered.length === 0) {
        // Preserve old no-deployment installation UX. Only this truly empty
        // case may issue unscoped native status, which cannot select A/B/C.
        const value = await invoke<ManagedLocalNativeStatus>("managed_local_runtime_status");
        setRuntime(value);
        setRuntimeBySelection({});
        return;
      }
      const observations = await Promise.all(registered.map(async info => {
        const found = resolveManagedLocalSelection(state, info.id);
        if (found.status !== "available" && found.status !== "unavailable")
          return [info.id, null] as const;
        const value = await invoke<ManagedLocalNativeStatus>("managed_local_runtime_status", {
          deploymentId: found.deployment.id,
          deploymentIdentity: found.identity,
        }).catch(() => null);
        return [info.id, value] as const;
      }));
      const statuses = Object.fromEntries(observations);
      setRuntimeBySelection(statuses);
      // A single registered deployment retains its historical header/status.
      // With multiple registered deployments there is no implicit first one.
      setRuntime(registered.length === 1 ? statuses[registered[0].id] : null);
    } catch {
      // No native adapter is not an installed engine.
      setRuntime(null);
      setRuntimeBySelection({});
    }
  }, [registered, state]);
  useEffect(() => {
    void refresh();
    // Do not continuously SHA-256 a release binary while Settings is idle.
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    let active = true;
    const check = async () => {
      const presence = await Promise.all(registered.map(async info => {
        const found = resolveManagedLocalSelection(state, info.id);
        if (found.status !== "available" && found.status !== "unavailable") return null;
        const digest = found.artifact.digest;
        if (!digest) return null;
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

  async function installCudaBundle() {
    setError("");setMessage("");
    const engine = await open({multiple:false,directory:false,
      filters:[{name:"Official llama.cpp b12248 Windows x64 CUDA 13.5 engine ZIP",extensions:["zip"]}]});
    if (!engine || typeof engine!=="string") return;
    const libraries = await open({multiple:false,directory:false,
      filters:[{name:"Official b12248 CUDA 13.5 cuBLAS/cudart dependency ZIP",extensions:["zip"]}]});
    if (!libraries || typeof libraries!=="string") return;
    setBusy(true);
    try {
      await invoke("managed_local_runtime_install_cuda_bundles",{
        engineZipPath:engine,cudaDllZipPath:libraries,
      });
      setMessage("Verified official CUDA 13.5 engine and dependency manifests were installed under b12248/cuda. CPU engine was preserved.");
      await refresh();
    }catch(cause){setError(safeError(cause));}
    finally{setBusy(false);}
  }

  async function addCudaDeployment(selectionId:string, deviceId:string) {
    if(busy)return;
    setBusy(true);setError("");
    try {
      await updateSelfHostedProfiles(current=>attachManagedCudaVariant(current,selectionId,{
        deviceId,gpuLayers:cudaLayers,fallback:cudaFallback,
      }).state);
      setMessage("Separate CUDA deployment registered. Its backend and GPU layers are part of its canonical identity; existing CPU Qwen remains unchanged.");
      await refresh();
    }catch(cause){setError(safeError(cause));}
    finally{setBusy(false);}
  }

  async function addPolicyDeployment(selectionId: string, requested: RequestedExecution) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await saveManagedExecutionPolicyVariant(selectionId, requested);
      const order = requested.candidates?.map(candidate => candidate.backend.toUpperCase()).join(" → ");
      setMessage(`New exact execution policy saved (${order ?? requested.backend.toUpperCase()}, ${requested.contextLength ?? "unknown"} context). Choose it from the model picker; native readiness and Agent qualification remain separate.`);
      await refresh();
    } catch (cause) {
      setError(safeError(cause));
      throw cause;
    }
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
      const started=await invoke<ManagedLocalNativeStatus>("managed_local_runtime_start", {
        deploymentId: resolved.deployment.id,
        deploymentIdentity: resolved.identity,
      });
      setMessage(started.fallbackUsed
        ? `Authorized CUDA→CPU fallback: ${started.fallbackReason ?? "CUDA admission was rejected"}. Native CPU execution must still become Ready.`
        : `Starting ${started.selectedBackend?.toUpperCase() ?? "managed"} GGUF deployment. Native health and backend/offload proof must become Ready.`);
      await refresh();
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(false); }
  }

  async function stop(selectionId: string) {
    const found = resolveManagedLocalSelection(state, selectionId);
    if (found.status !== "available" && found.status !== "unavailable") {
      setError("Cannot stop an unregistered or changed managed deployment.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await invoke("managed_local_runtime_stop", {
        deploymentId: found.deployment.id,
        deploymentIdentity: found.identity,
      });
      setMessage("The selected managed deployment stopped. Other deployments, registered models and evidence were preserved.");
      await refresh();
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(false); }
  }

  const installed = runtime?.installed === true ||
    Object.values(runtimeBySelection).some(value => value?.installed === true);
  const liveCount = Object.values(runtimeBySelection)
    .filter(value => value?.processId && value.state === "Ready").length;
  const cudaDevices=(hardware?.gpus??[]).filter(gpu=>
    gpu.vendor?.value==="NVIDIA" && gpu.cudaHardwareCapable?.value===true &&
    gpu.deviceId?.value?.startsWith("GPU-"))
    .flatMap(gpu=>gpu.deviceId?.value ? [{
      id:`${MANAGED_LOCAL_HOST_ID}:accelerator:${gpu.deviceId.value}`,
      label:gpu.model?.value??"NVIDIA GPU",free:gpu.availableVramBytes?.value??null,
    }] : []);
  const chosenCudaDevice=cudaDevices.find(d=>d.id===cudaDeviceId)??cudaDevices[0];
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
          {registered.length > 1
            ? `${liveCount} Ready of ${registered.length} managed deployments`
            : runtime?.state ?? "Unavailable"}
          {installed ? ` · ${runtime?.version ?? "b12248"}` : ""}
        </span>
      </div>
      {installed && runtime?.epoch && (
        <p role="status" aria-label="Managed runtime process identity" className="break-all font-mono text-[10px] text-muted-foreground">
          Runtime epoch {runtime.epoch}
          {runtime.processId ? ` · Native PID ${runtime.processId}` : ""}
          {runtime.port ? ` · 127.0.0.1:${runtime.port}` : ""}
        </p>
      )}
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
      </div>
      <section className="space-y-2 border-t border-border/60 pt-3 text-xs" aria-label="Managed CUDA runtime variant">
        <p className="font-medium">llama.cpp b12248 / CUDA 13.5 · {cudaVariant?.installed ? "Verified installed" : "Not installed or unverified"}</p>
        <p className="text-muted-foreground">
          CUDA bundle: {cudaVariant?.source??"Native status unavailable"}
          {cudaVariant?.installed ? ` · Engine release SHA-256 ${cudaVariant.engineArchiveSha256.slice(0,16)}… · CUDA DLL release SHA-256 ${cudaVariant.dependencyArchiveSha256.slice(0,16)}…` :
            cudaVariant?.error ? ` · ${cudaVariant.error}` : ""}
        </p>
        <p>Devices: {cudaDevices.length?cudaDevices.map(d=>`${d.label} (${d.free===null?"free VRAM unknown":`${Math.round(d.free/1024**2)} MiB free`})`).join(" · "):"No verified CUDA device (UNKNOWN or unavailable)"}</p>
        <Button size="sm" variant="outline" onClick={()=>void installCudaBundle()} disabled={busy||cudaVariant?.installed===true}>
          Install verified CUDA engine + DLL ZIPs
        </Button>
        <p className="text-muted-foreground">Use official b12248 Windows x64 CUDA 13.5 engine and cudart ZIPs; hashes are pinned in Clack. This does not overwrite or replace the CPU runtime.</p>
        {cudaDevices.length>0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <label>GPU <select aria-label="Managed CUDA device" value={chosenCudaDevice?.id??""}
              onChange={e=>setCudaDeviceId(e.target.value)} className="rounded border border-border bg-background px-1 py-0.5">
              {cudaDevices.map(d=><option key={d.id} value={d.id}>{d.label} · {d.id.slice(-12)}</option>)}
            </select></label>
            <label>GPU layers <select aria-label="Managed CUDA layers" value={cudaLayers} onChange={e=>setCudaLayers(Number(e.target.value))}
              className="rounded border border-border bg-background px-1 py-0.5">
              {[10,20,40,99].map(n=><option key={n} value={n}>{n}</option>)}
            </select></label>
            <label>Fallback <select aria-label="Managed CUDA fallback policy" value={cudaFallback}
              onChange={e=>setCudaFallback(e.target.value as "disabled"|"allow-compatible")}
              className="rounded border border-border bg-background px-1 py-0.5">
              <option value="disabled">Disabled</option><option value="allow-compatible">Allow explicit CPU</option>
            </select></label>
          </div>
        )}
      </section>
      {inspection && (
        <section className="rounded-md border border-border/70 p-3 space-y-2" aria-label="GGUF inspection">
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
        </section>
      )}
      {registered.length === 0 && <p className="text-xs text-muted-foreground">No managed GGUF deployments registered.</p>}
      {registered.map(model => {
        const found = resolveManagedLocalSelection(state, model.id);
        if (found.status !== "available" && found.status !== "unavailable") return null;
        const owner = runtimeBySelection[model.id] ?? null;
        const loaded = owner?.deploymentId === found.deployment.id &&
          owner?.modelDigest === found.artifact.digest;
        const fileMissing = found.artifact.digest !== undefined &&
          modelPresence[found.artifact.digest] === false;
        const requested = deploymentRequestedExecution(found.deployment, found.runtime);
        const isPolicy = !!requested?.candidates?.length;
        const isCuda = requested?.backend === "cuda";
        const isLegacyCpu = !isCuda && !found.deployment.requestedExecution;
        const actual = loaded ? observedActualExecution(found.runtime, found.deployment, owner) : null;
        return (
          <div key={model.id} className="space-y-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{model.label}</p>
                <p className="text-[11px] text-muted-foreground">
                  {isPolicy ? "Policy variant · " : ""}
                  {isCuda?`CUDA · ${requested?.gpuLayers} GPU layers`
                    :"CPU · 0 GPU layers"}
                  {" · "}{found.deployment.configurationIdentity
                    ? `${JSON.parse(found.deployment.configurationIdentity).context} context` : "Context unknown"} · {found.artifact.digest?.slice(7, 19)} ·
                  {" "}{fileMissing ? "Model file missing" :
                    loaded ? owner?.state : installed ? "Stopped / unverified" : "Runtime not installed"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {isLegacyCpu&&chosenCudaDevice&&(
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={()=>void addCudaDeployment(model.id,chosenCudaDevice.id)}>
                    Add CUDA variant
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={busy || !installed || fileMissing}
                  onClick={() => void start(model.id)}>
                  {loaded ? "Load status" : "Start"}
                </Button>
                {loaded && owner?.processId ? (
                  <Button size="sm" variant="outline" disabled={busy}
                    onClick={() => void stop(model.id)}>
                    Stop
                  </Button>
                ) : null}
              </div>
            </div>
            <ManagedExecutionReadout request={requested} native={owner} actual={actual}
              loaded={loaded} installed={installed} fileMissing={fileMissing} />
            <ManagedExecutionPolicyEditor key={model.id} sourceSelectionId={model.id}
              request={requested}
              contextLength={requested?.contextLength ?? 4096}
              devices={cudaDevices} disabled={busy}
              onSave={addPolicyDeployment} />
          </div>
        );
      })}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
