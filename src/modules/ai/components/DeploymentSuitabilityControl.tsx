import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  deploymentQualificationView,
  observedManagedFabric,
} from "@/modules/ai/lib/deploymentQualificationView";
import {
  assessDeploymentSuitability,
  contextTargets,
  WORKLOADS,
  type ScopedMeasuredPerformance,
  type Workload,
} from "@/modules/ai/lib/deploymentSuitability";
import { deploymentMeasurementPanel } from "@/modules/ai/lib/deploymentMeasurement";
import {
  type EvidenceValue,
  type GpuHardware,
  type NativeHardwareObservation,
  nativeHardwareObservationSchema,
  projectHardwareProfile,
} from "@/modules/ai/lib/hardwareProfile";
import {
  type DeploymentRuntimeObservation,
  type LocalComputeFabric,
  reconcileLocalComputeFabric,
  resolveModelDeployment,
} from "@/modules/ai/lib/localComputeFabric";
import {
  isManagedLocalSelectionId,
  MANAGED_LOCAL_HOST_ID,
  resolveManagedLocalSelection,
} from "@/modules/ai/lib/managedLocalModels";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import {
  type NativeGgufResource,
  nativeGgufResourceSchema,
  projectModelResourceProfile,
} from "@/modules/ai/lib/modelResourceProfile";
import {
  resolveSelfHostedSelection,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

type LocalRead = {
  selection: string;
  state: SelfHostedState;
  readAt: number;
  hardware: NativeHardwareObservation | null;
  metadata: NativeGgufResource | null;
  runtime: ManagedLocalNativeStatus | null;
};

function nativeRuntimeStatus(value: unknown): ManagedLocalNativeStatus | null {
  if (!value || typeof value !== "object") return null;
  const status = value as Record<string, unknown>;
  if (
    typeof status.installed !== "boolean" ||
    ![
      "Not Installed",
      "Stopped",
      "Starting",
      "Loading",
      "Ready",
      "Stopping",
      "Failed",
    ].includes(String(status.state)) ||
    typeof status.version !== "string" ||
    typeof status.epoch !== "string" ||
    ["deploymentId", "modelDigest", "error"].some(
      (key) =>
        status[key] !== undefined &&
        status[key] !== null &&
        typeof status[key] !== "string",
    ) ||
    ["processId", "port"].some(
      (key) =>
        status[key] !== undefined &&
        status[key] !== null &&
        (!Number.isSafeInteger(status[key]) || (status[key] as number) < 1),
    )
  )
    return null;
  return status as ManagedLocalNativeStatus;
}

function selectedForSession(sessionId: string): string | null | undefined {
  const session = useChatStore
    .getState()
    .sessions.find((row) => row.id === sessionId);
  return session?.run?.state === "running"
    ? session.run.modelId
    : session?.profile?.modelId;
}

type Resolved = {
  fabric: LocalComputeFabric;
  deploymentId: string;
  observation?: DeploymentRuntimeObservation;
};

function resolveSelection(
  state: SelfHostedState,
  selection: string,
  native: ManagedLocalNativeStatus | null,
  now: number,
): Resolved | null {
  if (isManagedLocalSelectionId(selection))
    return observedManagedFabric(state, selection, native, now) ?? null;
  const selected = resolveSelfHostedSelection(state, selection);
  if (selected.status !== "available") return null;
  const resolved = resolveModelDeployment(state, selected.profile);
  if (!resolved) return null;
  // The profile ID is a selection key, not the authority to evaluate fit.
  // Consume only the exact deployment resolved against the current fabric.
  return {
    fabric: reconcileLocalComputeFabric(state),
    deploymentId: resolved.deployment.id,
  };
}

const SIZE = 1024 ** 3;
function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unknown";
  if (value === 0) return "0";
  return Math.abs(value) >= SIZE
    ? `${(value / SIZE).toFixed(2)} GiB`
    : `${(value / 1024 ** 2).toFixed(0)} MiB`;
}

function EvidenceLine({
  label,
  datum,
}: {
  label: string;
  datum: EvidenceValue<number>;
}) {
  return (
    <p className="break-words">
      <strong>{label}:</strong> {formatBytes(datum.value)} · {datum.provenance}
      <span className="block pl-2 text-muted-foreground">
        {datum.source}
        {datum.observedAt !== null
          ? ` · ${new Date(datum.observedAt).toLocaleString()}`
          : ""}
      </span>
      {datum.assumptions.map((reason) => (
        <span key={reason} className="block pl-2 text-muted-foreground">
          {reason}
        </span>
      ))}
    </p>
  );
}

/** Renderer shared by the live popover and provenance regression tests.
 * Never substitutes display AdapterRAM for vendor-reported usable VRAM. */
export function GpuTelemetryLine({
  gpu,
  index,
}: {
  gpu: GpuHardware;
  index: number;
}) {
  return (
    <p>
      GPU adapter {index + 1}: {gpu.model.value ?? "Unknown"}
      {" · "}
      {gpu.vendor.value ?? "Vendor unknown"}
      {" · "}
      {gpu.model.provenance}
      <span className="block pl-2">
        Total VRAM: {formatBytes(gpu.totalVramBytes.value)}
        {" · "}
        {gpu.totalVramBytes.provenance}
        {" · "}Free VRAM: {formatBytes(gpu.availableVramBytes.value)}
        {" · "}
        {gpu.availableVramBytes.provenance}
      </span>
      <span className="block pl-2">
        Driver: {gpu.driverVersion.value ?? "Unknown"}
        {" · "}
        {gpu.driverVersion.provenance}
        {" · "}Compute: {gpu.computeArchitecture.value ?? "Unknown"}
        {" · "}
        {gpu.computeArchitecture.provenance}
      </span>
    </p>
  );
}

/** Read-only LM3–LM5 planning estimates; all routing and LM2F admission remain independent. */
export function DeploymentSuitabilityControl({
  sessionId,
}: {
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [read, setRead] = useState<LocalRead | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [workload, setWorkload] = useState<Workload>("Chat");
  const [context, setContext] = useState<number | null>(null);
  const request = useRef(0);
  const state = usePreferencesStore((s) => s.selfHostedInference);
  const selection = useChatStore((s) => {
    const session = s.sessions.find((row) => row.id === sessionId);
    return session?.run?.state === "running"
      ? session.run.modelId
      : session?.profile?.modelId;
  });
  const managed = !!selection && isManagedLocalSelectionId(selection);
  const localOrHosted = managed || !!selection?.startsWith("self-hosted:");

  useEffect(() => {
    if (
      selectedForSession(sessionId) !== selection ||
      usePreferencesStore.getState().selfHostedInference !== state
    )
      return;
    request.current++;
    setRead(null);
    setOpen(false);
    setLoading(false);
    setContext(null);
    setWorkload("Chat");
  }, [selection, state, sessionId]);
  useEffect(() => {
    if (!open) return;
    // Check TTL continuously while the popover remains open; stale host RAM
    // and native Ready must age to Unknown without another user interaction.
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [open]);

  const openChanged = (next: boolean) => {
    setOpen(next);
    const token = ++request.current;
    setRead(null);
    setClock(Date.now());
    setLoading(false);
    if (!next || !selection || !isManagedLocalSelectionId(selection)) return;
    const exact = resolveManagedLocalSelection(state, selection);
    if (exact.status !== "available" && exact.status !== "unavailable") return;
    if (
      exact.host.id !== MANAGED_LOCAL_HOST_ID ||
      exact.host.location !== "local"
    )
      return;
    const digest = exact.artifact.digest;
    if (!digest) return;
    setLoading(true);
    // Explicit popover open is the sole trigger. These three native commands
    // read host RAM, imported GGUF metadata and runtime status; none runs inference.
    void (async () => {
      const [rawHardware, rawMetadata] = await Promise.allSettled([
        invoke<unknown>("local_hardware_observation"),
        invoke<unknown>("managed_local_runtime_model_metadata", { digest }),
      ]);
      if (request.current !== token) return;
      // Read status last so an expensive digest check cannot make an earlier
      // Ready observation appear fresh after the model metadata arrives.
      const statusRequestedAt = Date.now();
      const rawRuntime = await invoke<unknown>(
        "managed_local_runtime_status",
      ).catch(() => null);
      const hardware =
        rawHardware.status === "fulfilled"
          ? nativeHardwareObservationSchema.safeParse(rawHardware.value)
          : null;
      const metadata =
        rawMetadata.status === "fulfilled"
          ? nativeGgufResourceSchema.safeParse(rawMetadata.value)
          : null;
      if (
        request.current !== token ||
        selectedForSession(sessionId) !== selection ||
        usePreferencesStore.getState().selfHostedInference !== state
      )
        return;
      setRead({
        selection,
        state,
        readAt: statusRequestedAt,
        hardware: hardware?.success ? hardware.data : null,
        metadata:
          metadata?.success && metadata.data.digest === digest
            ? metadata.data
            : null,
        runtime: nativeRuntimeStatus(rawRuntime),
      });
      setLoading(false);
    })().catch(() => {
      if (request.current === token) setLoading(false);
    });
  };

  if (!localOrHosted || !selection) return null;

  const now = clock;
  const currentRead =
    read?.selection === selection && read.state === state ? read : null;
  const freshNative =
    currentRead &&
    currentRead.readAt <= now &&
    now - currentRead.readAt < 30_000
      ? currentRead.runtime
      : null;
  let resolved: Resolved | null = null;
  try {
    if (open) resolved = resolveSelection(state, selection, freshNative, now);
  } catch {
    /* Missing or ambiguous saved identity remains unknown. */
  }
  const deployment = resolved?.fabric.deployments.find(
    (row) => row.id === resolved.deploymentId,
  );
  const host = resolved?.fabric.hosts.find(
    (row) => row.id === deployment?.hostId,
  );
  const runtime = resolved?.fabric.runtimes.find(
    (row) => row.id === deployment?.runtimeId,
  );
  const artifact = resolved?.fabric.artifacts.find(
    (row) => row.id === deployment?.artifactId,
  );
  const hardware =
    host && runtime
      ? projectHardwareProfile(
          host,
          runtime,
          managed ? (currentRead?.hardware ?? null) : null,
          now,
        )
      : null;
  const resource =
    artifact && runtime && deployment
      ? projectModelResourceProfile(
          artifact,
          runtime,
          deployment,
          managed ? (currentRead?.metadata ?? null) : null,
        )
      : null;
  const tiers = resource ? contextTargets(resource) : [];
  // LM6 current-scope matching checks the FULL procedure, epoch, artifact,
  // host, runtime, context and backend before showing a measured claim.
  // Historic data is left to the Measurement panel, never promoted here.
  const measured = resolved && resource
    ? deploymentMeasurementPanel(
        { ...state, fabric: resolved.fabric }, resolved.deploymentId,
        resolved.observation, resource.configuredContext.value,
        resource.executionPlacement.value ?? "Unknown", now)
    : null;
  const currentLm6 = measured?.current;
  const measuredAttempts = currentLm6?.attempts.filter(a =>
    !!a.requestId && a.terminalObserved && a.result === "passed") ?? [];
  const speedEvidence = measuredAttempts.find(a =>
    a.usage.generationTokensPerSecond.value !== null)?.usage.generationTokensPerSecond;
  const perf: ScopedMeasuredPerformance | undefined =
    currentLm6 && resolved?.observation && resource && measuredAttempts.length
      ? {
          source: "clack-native-measured",
          deploymentId: resolved.deploymentId,
          runtimeId: resource.runtimeId,
          runtimeEpoch: resolved.observation.epoch,
          configurationRevision: resolved.observation.configurationRevision,
          artifactDigest: resource.artifactDigest,
          configuredContext: resource.configuredContext.value,
          placement: resource.executionPlacement.value,
          observedAt: currentLm6.endedAt,
          sampleCount: measuredAttempts.length,
          reliabilityFraction: currentLm6.reliability.completionFraction,
          ...(speedEvidence?.value !== null && speedEvidence?.value !== undefined
            ? { generationTokensPerSecond: speedEvidence.value } : {}),
        }
      : undefined;
  const selectedContext =
    tiers.find((row) => row.tokens === context)?.tokens ?? tiers[0]?.tokens;
  const calculate = (targetWorkload: Workload, tokens: number) =>
    resolved && hardware && resource
      ? assessDeploymentSuitability({
          fabric: resolved.fabric,
          hardware,
          resource,
          deploymentId: resolved.deploymentId,
          workload: targetWorkload,
          context: tokens,
          observation: resolved.observation,
          measuredPerformance: perf,
          // Native Ready is not transferable to an Ollama host, another
          // deployment/digest/epoch or a hypothetical context configuration.
          observedLoaded:
            managed &&
            resolved.observation !== undefined &&
            freshNative?.state === "Ready",
          now,
        })
      : null;
  const assessment = selectedContext
    ? calculate(workload, selectedContext)
    : null;
  const nativeTools = selectedContext
    ? calculate("Native Tools", selectedContext)
    : null;
  const agent = selectedContext
    ? calculate("Automatic Agent", selectedContext)
    : null;
  const qualification = resolved
    ? deploymentQualificationView(
        state,
        selection,
        managed ? freshNative : null,
        now,
      )
    : null;

  return (
    <Popover open={open} onOpenChange={openChanged}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-1.5 text-xs"
          aria-label="Deployment hardware suitability details"
        >
          Suitability
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[25rem] max-w-[calc(100vw-16px)] max-h-[72dvh] overflow-y-auto text-xs gap-3"
      >
        <div className="space-y-1">
          <h3 className="font-medium">Deployment suitability</h3>
          <p className="text-muted-foreground">
            Read-only resource estimates for this model and host. They do not
            qualify model behavior or authorize Agent tools.
          </p>
          <p className="truncate text-[11px]" title={artifact?.displayName}>
            {host?.displayName ?? "Host unknown"} ·{" "}
            {runtime?.displayName ?? "Runtime unknown"}
            {artifact ? ` · ${artifact.displayName}` : ""}
          </p>
        </div>
        {loading && (
          <p role="status" className="text-muted-foreground">
            Checking current local RAM, imported model metadata and native
            runtime…
          </p>
        )}
        {managed && !loading && !currentRead && (
          <p className="text-muted-foreground" role="status">
            Native observations unavailable. Reopen to check; unknown values
            remain unknown.
          </p>
        )}
        {!managed && (
          <p className="text-muted-foreground">
            Self-hosted host hardware is unknown. No local machine or remote SSH
            probe was made. Model metadata comes only from the saved provider
            inventory.
          </p>
        )}
        {!resolved || !hardware || !resource ? (
          <p role="status">
            Exact deployment unavailable. Hardware suitability: Unknown.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="font-medium">Workload</span>
                <select
                  aria-label="Suitability workload"
                  value={workload}
                  onChange={(event) =>
                    setWorkload(event.target.value as Workload)
                  }
                  className="w-full rounded border border-border bg-background px-2 py-1"
                >
                  {WORKLOADS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-medium">Context tier</span>
                <select
                  aria-label="Suitability context tier"
                  value={selectedContext ?? ""}
                  disabled={!tiers.length}
                  onChange={(event) => setContext(Number(event.target.value))}
                  className="w-full rounded border border-border bg-background px-2 py-1"
                >
                  {!tiers.length && <option value="">Unknown</option>}
                  {tiers.map((row) => (
                    <option value={row.tokens} key={row.tokens}>
                      {row.label} · {row.tokens.toLocaleString()} tokens
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {assessment ? (
              <div className="space-y-2">
                <p role="status" className="font-medium">
                  Hardware/resource rating: {assessment.resourceRating}
                  {" · "}
                  {assessment.confidence} confidence
                </p>
                <p className="text-muted-foreground">
                  Load: {assessment.canLoad} · Memory fit:{" "}
                  {assessment.capacity.fit}
                  {" · "}Placement: {assessment.placement}
                  {" · "}Limiting factor: {assessment.capacity.limitingFactor}
                </p>
                <p className="border-t pt-2">
                  <strong>{workload} suitability:</strong> {assessment.rating}
                  {" · "}Qualification: {assessment.qualificationState}
                </p>
                <p className="text-muted-foreground">
                  {assessment.workloadAuthorized
                    ? "Separate exact-scope qualification evidence is available; suitability does not grant permission."
                    : "Not qualified for this workload. Hardware fit does not grant permission."}
                </p>
              </div>
            ) : (
              <p role="status">
                Hardware/resource rating: Unknown · Low confidence
                {" · "}Model context unknown; fit cannot be estimated. Existing
                artifact metadata does not establish host memory or useful
                latency.
              </p>
            )}
            <p className="text-muted-foreground">
              Instruction adherence:{" "}
              {qualification?.instruction.state ?? "Unknown"}
              {qualification?.instruction.lastResult
                ? ` · Last recorded ${qualification.instruction.lastResult}`
                : ""}
              {" · "}Behavioral qualification is independent of hardware
              suitability.
            </p>
            {currentLm6 && (
              <div className="border-t pt-2 space-y-1">
                <p className="font-medium">LM6 · Current exact-scope measured run</p>
                <p>Reliability: {currentLm6.reliability.completed}/{currentLm6.reliability.requested} completed
                  {" · "}{currentLm6.reliability.failed} failed
                  {" · "}{currentLm6.reliability.cancelled} cancelled</p>
                <p>Generation: {speedEvidence?.value === null || speedEvidence === undefined
                  ? "Unknown" : `${speedEvidence.value?.toFixed(2)} tokens/s · ${speedEvidence.provenance}`}</p>
                <p className="text-muted-foreground">Measured timings do not grant instruction adherence, native tools or Agent eligibility.</p>
              </div>
            )}
            <div className="space-y-1 border-t pt-2">
              <p className="font-medium">Host and model resources</p>
              <p>
                Configured context:{" "}
                {resource.configuredContext.value === null
                  ? "Unknown"
                  : `${resource.configuredContext.value.toLocaleString()} tokens`}
                {" · "}
                {resource.configuredContext.provenance}
                {" · "}Execution backend:{" "}
                {resource.executionPlacement.value ?? "Unknown"}
                {" · "}
                {resource.executionPlacement.provenance}
              </p>
              <p>
                CPU manufacturer: {hardware.cpu.manufacturer.value ?? "Unknown"}
                {" · "}
                {hardware.cpu.manufacturer.provenance}
              </p>
              <p>
                CPU: {hardware.cpu.model.value ?? "Model unknown"}
                {" · "}
                {hardware.cpu.architecture.value ?? "Architecture unknown"}
                {hardware.cpu.logicalProcessors.value !== null
                  ? ` · ${hardware.cpu.logicalProcessors.value} logical processors`
                  : ""}
                {" · "}
                {hardware.cpu.model.value !== null
                  ? hardware.cpu.model.provenance
                  : hardware.cpu.architecture.provenance}
              </p>
              <p>
                Physical cores: {hardware.cpu.physicalCores.value ?? "Unknown"}
                {" · "}
                {hardware.cpu.physicalCores.provenance}
                {" · "}Logical processors:{" "}
                {hardware.cpu.logicalProcessors.value ?? "Unknown"}
                {" · "}
                {hardware.cpu.logicalProcessors.provenance}
              </p>
              <p>
                Host RAM: {formatBytes(hardware.memory.totalRamBytes.value)}
                {" · "}Available:{" "}
                {formatBytes(hardware.memory.availableRamBytes.value)}
                {" · "}
                {hardware.memory.availableRamBytes.provenance}
              </p>
              {hardware.gpus.map((gpu, index) => (
                <GpuTelemetryLine
                  key={gpu.deviceId.value ?? index}
                  gpu={gpu}
                  index={index}
                />
              ))}
              <p>
                GPU inventory:{" "}
                {hardware.gpuInventoryComplete
                  ? "OS display inventory collected"
                  : "Incomplete / Unknown"}
                {" · "}CUDA hardware:{" "}
                {hardware.backends.cuda.hardwareSupports.value === null
                  ? "Unknown"
                  : hardware.backends.cuda.hardwareSupports.value
                    ? "Detected"
                    : "Not detected"}
                {" · "}Installed CUDA runtime:{" "}
                {hardware.backends.cuda.installedRuntimeExecutes.value === null
                  ? "Unknown"
                  : hardware.backends.cuda.installedRuntimeExecutes.value
                    ? "Available"
                    : "Unavailable"}
              </p>
              <p>
                Disk artifact: {formatBytes(resource.artifactSizeBytes.value)}
                {" · "}
                {resource.artifactSizeBytes.provenance}
              </p>
              <p>
                Estimated resident weights:{" "}
                {formatBytes(resource.weightMemoryBytes.value)}
                {" · "}
                {resource.weightMemoryBytes.provenance}
              </p>
            </div>
            {assessment && (
              <div className="space-y-1">
                <p>
                  Estimated KV cache:{" "}
                  {formatBytes(assessment.capacity.estimatedKvBytes.value)}
                </p>
                <p>
                  Estimated RAM demand:{" "}
                  {formatBytes(assessment.capacity.estimatedRamBytes.value)}
                  {" · "}RAM fit: {assessment.capacity.ramFit}
                </p>
                <p>
                  Estimated VRAM demand:{" "}
                  {formatBytes(assessment.capacity.estimatedVramBytes.value)}
                  {" · "}VRAM fit: {assessment.capacity.vramFit}
                </p>
              </div>
            )}
            {tiers.length > 1 && (
              <div className="space-y-1 border-t pt-2">
                <p className="font-medium">Context comparison</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="pb-1 pr-2 font-normal">Tokens</th>
                        <th className="pb-1 pr-2 font-normal">KV est.</th>
                        <th className="pb-1 pr-2 font-normal">RAM est.</th>
                        <th className="pb-1 font-normal">Fit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tiers.map((tier) => {
                        const estimate = calculate(workload, tier.tokens);
                        return (
                          <tr
                            key={tier.tokens}
                            className="border-t border-border/50"
                          >
                            <td className="py-1 pr-2" title={tier.label}>
                              {tier.tokens.toLocaleString()}
                            </td>
                            <td className="py-1 pr-2">
                              {formatBytes(
                                estimate?.capacity.estimatedKvBytes.value ??
                                  null,
                              )}
                            </td>
                            <td className="py-1 pr-2">
                              {formatBytes(
                                estimate?.capacity.estimatedRamBytes.value ??
                                  null,
                              )}
                            </td>
                            <td className="py-1">
                              {estimate?.capacity.fit ?? "Unknown"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-muted-foreground">
                  Other tiers are hypothetical and require explicit
                  configuration changes and new qualification. No settings were
                  changed.
                </p>
              </div>
            )}
            <div className="space-y-1 border-t pt-2">
              <p className="font-medium">Tool safety</p>
              <p>
                Native tools: {nativeTools?.qualificationState ?? "Unknown"}
                {" · "}
                {nativeTools?.workloadAuthorized ? "Qualified" : "Unavailable"}
              </p>
              <p>
                Automatic Agent: {agent?.qualificationState ?? "Unknown"}
                {" · "}
                {agent?.workloadAuthorized ? "Qualified" : "Unavailable"}
              </p>
              <p className="text-muted-foreground">
                Hardware fit never grants tools, instruction adherence or Agent
                permission.
              </p>
            </div>
            {assessment?.recommendations.length ? (
              <div className="space-y-1 border-t pt-2">
                <p className="font-medium">Suggestions (manual changes only)</p>
                {assessment.recommendations.slice(0, 3).map((row) => (
                  <p key={row.code} className="text-muted-foreground">
                    {row.text}
                  </p>
                ))}
              </div>
            ) : null}
            <details className="space-y-2 border-t pt-2">
              <summary className="cursor-pointer font-medium">
                Sources, assumptions and limits
              </summary>
              <div className="space-y-2 pt-2">
                <EvidenceLine
                  label="Total physical RAM"
                  datum={hardware.memory.totalRamBytes}
                />
                <EvidenceLine
                  label="Available RAM"
                  datum={hardware.memory.availableRamBytes}
                />
                <p className="text-muted-foreground">
                  CPU model: {hardware.cpu.model.value ?? "Unknown"}
                  {" · "}
                  {hardware.cpu.model.provenance} · {hardware.cpu.model.source}
                </p>
                <p className="text-muted-foreground">
                  CPU manufacturer:{" "}
                  {hardware.cpu.manufacturer.value ?? "Unknown"}
                  {" · "}
                  {hardware.cpu.manufacturer.provenance} ·{" "}
                  {hardware.cpu.manufacturer.source}
                </p>
                <p className="text-muted-foreground">
                  Physical core count:{" "}
                  {hardware.cpu.physicalCores.value ?? "Unknown"}
                  {" · "}
                  {hardware.cpu.physicalCores.provenance} ·{" "}
                  {hardware.cpu.physicalCores.source}
                </p>
                <p className="text-muted-foreground">
                  Logical processor count:{" "}
                  {hardware.cpu.logicalProcessors.value ?? "Unknown"}
                  {" · "}
                  {hardware.cpu.logicalProcessors.provenance} ·{" "}
                  {hardware.cpu.logicalProcessors.source}
                </p>
                {hardware.gpus.map((gpu, index) => (
                  <p
                    key={gpu.deviceId.value ?? index}
                    className="text-muted-foreground"
                  >
                    GPU adapter {index + 1}: {gpu.model.value ?? "Unknown"} ·{" "}
                    {gpu.model.provenance} · {gpu.model.source}. Identity:{" "}
                    {gpu.deviceId.value ?? "Unknown"} ({gpu.deviceId.provenance}
                    ). Total VRAM: {formatBytes(gpu.totalVramBytes.value)}{" "}
                    {gpu.totalVramBytes.provenance} ·{" "}
                    {gpu.totalVramBytes.source}. Free VRAM:{" "}
                    {formatBytes(gpu.availableVramBytes.value)}{" "}
                    {gpu.availableVramBytes.provenance} ·{" "}
                    {gpu.availableVramBytes.source}. Driver:{" "}
                    {gpu.driverVersion.value ?? "Unknown"} (
                    {gpu.driverVersion.source}). CUDA compute architecture:{" "}
                    {gpu.computeArchitecture.value ?? "Unknown"} (
                    {gpu.computeArchitecture.source}). No inference backend is
                    granted by display/vendor detection.
                  </p>
                ))}
                <EvidenceLine
                  label="Artifact bytes on disk"
                  datum={resource.artifactSizeBytes}
                />
                <EvidenceLine
                  label="Resident weight estimate"
                  datum={resource.weightMemoryBytes}
                />
                {assessment && (
                  <>
                    <EvidenceLine
                      label="KV estimate"
                      datum={assessment.capacity.estimatedKvBytes}
                    />
                    <EvidenceLine
                      label="RAM estimate"
                      datum={assessment.capacity.estimatedRamBytes}
                    />
                    <EvidenceLine
                      label="VRAM estimate"
                      datum={assessment.capacity.estimatedVramBytes}
                    />
                    {assessment.confidenceReasons.map((reason) => (
                      <p key={reason} className="text-muted-foreground">
                        {reason}
                      </p>
                    ))}
                    {[...new Set(assessment.reasons)].map((reason) => (
                      <p key={reason} className="text-muted-foreground">
                        {reason}
                      </p>
                    ))}
                    {[...new Set(assessment.warnings)].map((reason) => (
                      <p key={reason} className="text-muted-foreground">
                        {reason}
                      </p>
                    ))}
                  </>
                )}
              </div>
            </details>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
