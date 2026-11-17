import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { contextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { deploymentMeasurementPanel, type Lm6Run } from "@/modules/ai/lib/deploymentMeasurement";
import { observedManagedFabric } from "@/modules/ai/lib/deploymentQualificationView";
import { unknown, type EvidenceValue } from "@/modules/ai/lib/hardwareProfile";
import {
  reconcileLocalComputeFabric,
  resolveModelDeployment,
  type DeploymentRuntimeObservation,
} from "@/modules/ai/lib/localComputeFabric";
import { isManagedLocalSelectionId } from "@/modules/ai/lib/managedLocalModels";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import { projectModelResourceProfile } from "@/modules/ai/lib/modelResourceProfile";
import { resolveSelfHostedSelection, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";

type MeasurementSelection = {
  state: SelfHostedState;
  deploymentId: string;
  observation?: DeploymentRuntimeObservation;
  contextTokens: number | null;
  backend: Lm6Run["backend"];
  label: string;
  ready: boolean;
};

type NativeRead = {
  selectionId: string;
  settings: SelfHostedState;
  observedAt: number;
  status: ManagedLocalNativeStatus | null;
};

function selectedForSession(sessionId: string): string | null | undefined {
  const session = useChatStore.getState().sessions.find(item => item.id === sessionId);
  return session?.run?.state === "running"
    ? session.run.modelId : session?.profile?.modelId;
}

function validNativeStatus(value: unknown): ManagedLocalNativeStatus | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.installed !== "boolean" ||
      !["Not Installed", "Stopped", "Starting", "Loading", "Ready", "Stopping", "Failed"].includes(String(item.state)) ||
      typeof item.version !== "string" || typeof item.epoch !== "string" ||
      ["deploymentId", "modelDigest", "error"].some(key =>
        item[key] !== undefined && item[key] !== null && typeof item[key] !== "string") ||
      ["processId", "port"].some(key =>
        item[key] !== undefined && item[key] !== null &&
        (!Number.isSafeInteger(item[key]) || (item[key] as number) < 1))) return null;
  return item as ManagedLocalNativeStatus;
}

/** Resolve display identity from the same saved registry as routing. A fresh
 * native status is read only when the user opens the managed popover. */
function resolveMeasurementSelection(
  settings: SelfHostedState,
  selectionId: string,
  status: ManagedLocalNativeStatus | null,
  now: number,
): MeasurementSelection | null {
  if (isManagedLocalSelectionId(selectionId)) {
    const observed = observedManagedFabric(settings, selectionId, status, now);
    if (!observed) return null;
    const deployment = observed.fabric.deployments.find(row => row.id === observed.deploymentId);
    const runtime = observed.fabric.runtimes.find(row => row.id === deployment?.runtimeId);
    const artifact = observed.fabric.artifacts.find(row => row.id === deployment?.artifactId);
    if (!deployment || !runtime || !artifact) return null;
    const resource = projectModelResourceProfile(artifact, runtime, deployment);
    return {
      // The native Ready projection is ephemeral. Passing it to the read-only
      // panel preserves the actual PID/epoch scope without writing fake Ready
      // state into preferences or transferring a historical run to this epoch.
      state: { ...settings, fabric: observed.fabric },
      deploymentId: deployment.id,
      observation: observed.observation,
      contextTokens: resource.configuredContext.value,
      backend: resource.executionPlacement.value ?? "Unknown",
      label: artifact.displayName,
      ready: !!observed.observation,
    };
  }
  const target = resolveSelfHostedSelection(settings, selectionId);
  if (target.status !== "available") return null;
  const deployment = resolveModelDeployment(settings, target.profile);
  if (!deployment) return null;
  const resource = projectModelResourceProfile(deployment.artifact, deployment.runtime, deployment.deployment);
  const runtime = contextRuntime(target.endpoint.id);
  const observation = runtime && runtime.configurationRevision === target.endpoint.configurationRevision &&
    runtime.at <= now && now - runtime.at < 30_000
    ? {
        runtimeId: deployment.runtime.id,
        version: runtime.version,
        configurationRevision: runtime.configurationRevision,
        epoch: runtime.epoch,
        observedAt: runtime.at,
      }
    : undefined;
  return {
    state: { ...settings, fabric: reconcileLocalComputeFabric(settings) },
    deploymentId: deployment.deployment.id,
    observation,
    contextTokens: resource.configuredContext.value,
    backend: resource.executionPlacement.value ?? "Unknown",
    label: deployment.artifact.displayName,
    // Saved endpoint registration is NOT live provider availability. Without
    // a fresh existing runtime observation, do not offer inference or probe.
    ready: !!observation,
  };
}

function metricValue(metric: EvidenceValue<number>): string {
  if (metric.value === null) return "Unknown";
  if (metric.unit === "bytes") return `${(metric.value / 1024 ** 2).toFixed(1)} MiB`;
  if (metric.unit === "tokens") return `${metric.value.toLocaleString()} tokens`;
  if (metric.unit === "ms") return `${metric.value.toFixed(1)} ms`;
  if (metric.unit === "tokens/s") return `${metric.value.toFixed(2)} tokens/s`;
  return `${metric.value.toLocaleString()} ${metric.unit}`;
}

function MetricLine({ label, metric }: { label: string; metric: EvidenceValue<number> }) {
  return (
    <p className="break-words">
      <strong>{label}:</strong> {metricValue(metric)} · {metric.provenance}
      <span className="block pl-2 text-muted-foreground">
        {metric.source}
        {metric.observedAt !== null ? ` · ${new Date(metric.observedAt).toLocaleString()}` : ""}
      </span>
    </p>
  );
}

function reliabilityLabel(run: Lm6Run): string {
  const value = run.reliability;
  return `${value.completed}/${value.requested} completed · ${value.failed} failed · ${value.cancelled} cancelled · ${value.unavailable} unavailable`;
}

function RunMetrics({ run }: { run: Lm6Run }) {
  const cold = run.attempts.find(attempt => attempt.thermal === "cold" && attempt.outputObserved);
  const warm = run.attempts.find(attempt => attempt.thermal === "warm" && attempt.outputObserved);
  const throughput = run.attempts.find(attempt => attempt.usage.generationTokensPerSecond.value !== null);
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground">{reliabilityLabel(run)}</p>
      <p className="text-muted-foreground">Completion counts require strict single-request evidence. An incomplete correlation is not proof that the model failed to respond.</p>
      {cold && <MetricLine label="Cold first meaningful output" metric={cold.timings.firstMeaningfulOutputMs} />}
      {warm && <MetricLine label="Warm first meaningful output" metric={warm.timings.firstMeaningfulOutputMs} />}
      {throughput && <MetricLine label="Generation throughput" metric={throughput.usage.generationTokensPerSecond} />}
      <details className="pt-1">
        <summary className="cursor-pointer">Attempt timings, tokens and resource observations</summary>
        <div className="space-y-3 pt-2">
          {run.attempts.map(attempt => (
            <div key={attempt.attemptId} className="space-y-1 border-t pt-2">
              <p className="font-medium">{attempt.workload} · {attempt.thermal} · {attempt.result}</p>
              <p className="text-muted-foreground">{attempt.failure === "none" ? "No recorded failure" : `Failure: ${attempt.failure}`}</p>
              {attempt.workload === "instruction-adherence" && (
                <p className="text-muted-foreground">Instruction adherence: {
                  attempt.capabilityCheck === "failed" && !attempt.requestId
                    ? "Incomplete (legacy attempt lacked independently correlated Chat evidence)"
                    : attempt.capabilityCheck
                }</p>
              )}
              <MetricLine label="First provider protocol frame" metric={
                attempt.timings.firstNativeChunkMs
                  ? attempt.timings.firstFrameMs
                  : unknown("ms", "Legacy transport chunk is not proof of a parsed provider frame")
              } />
              <MetricLine label="First native response chunk" metric={
                attempt.timings.firstNativeChunkMs ??
                attempt.timings.firstFrameMs
              } />
              <MetricLine label="First meaningful output" metric={attempt.timings.firstMeaningfulOutputMs} />
              <MetricLine label="First visible output" metric={attempt.timings.firstVisibleOutputMs} />
              <MetricLine label="Terminal duration" metric={attempt.timings.terminalMs} />
              <MetricLine label="Prompt evaluation time" metric={attempt.timings.promptEvaluationMs} />
              <MetricLine label="Generation time" metric={attempt.timings.generationMs} />
              <MetricLine label="Prompt tokens" metric={attempt.usage.promptTokens} />
              <MetricLine label="Generated tokens" metric={attempt.usage.generatedTokens} />
              <MetricLine label="Prompt throughput" metric={attempt.usage.promptTokensPerSecond} />
              <MetricLine label="Generation throughput" metric={attempt.usage.generationTokensPerSecond} />
              <MetricLine label="Host free RAM before" metric={attempt.resources.ramBeforeBytes} />
              <MetricLine label="Host free RAM during" metric={attempt.resources.ramDuringBytes} />
              <MetricLine label="Host free RAM after" metric={attempt.resources.ramAfterBytes} />
              <MetricLine label="GPU free VRAM before" metric={attempt.resources.vramBeforeBytes} />
              <MetricLine label="GPU free VRAM during" metric={attempt.resources.vramDuringBytes} />
              <MetricLine label="GPU free VRAM after" metric={attempt.resources.vramAfterBytes} />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/** LM6 observations are informational. Opening the panel never invokes a
 * benchmark, changes settings, or grants tool/Agent authorization. */
export function DeploymentMeasurementControl({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<NativeRead | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState(Date.now());
  const request = useRef(0);
  const runInFlight = useRef(false);
  const settings = usePreferencesStore(state => state.selfHostedInference);
  const selectionId = useChatStore(state => {
    const session = state.sessions.find(item => item.id === sessionId);
    return session?.run?.state === "running"
      ? session.run.modelId : session?.profile?.modelId;
  });
  const managed = !!selectionId && isManagedLocalSelectionId(selectionId);
  const eligibleSelection = managed || !!selectionId?.startsWith("self-hosted:");

  useEffect(() => {
    // A previous model's native status cannot survive a model or settings edit.
    request.current++;
    setRead(null);
    setChecking(false);
    setOpen(false);
  }, [sessionId, selectionId, settings]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [open]);

  const refreshStatus = () => {
    const token = ++request.current;
    setRead(null);
    setNow(Date.now());
    setChecking(false);
    if (!selectionId || !isManagedLocalSelectionId(selectionId)) return;
    setChecking(true);
    // Native authenticated status is read-only; the runner is never invoked
    // during open/refresh, rendering or a provider/session selection change.
    void invoke<unknown>("managed_local_runtime_status")
      .then(raw => {
        if (token !== request.current ||
            usePreferencesStore.getState().selfHostedInference !== settings ||
            selectedForSession(sessionId) !== selectionId) return;
        setRead({ selectionId, settings, observedAt: Date.now(), status: validNativeStatus(raw) });
      })
      .catch(() => {
        if (token === request.current) setRead({ selectionId, settings, observedAt: Date.now(), status: null });
      })
      .finally(() => { if (token === request.current) setChecking(false); });
  };

  if (!eligibleSelection || !selectionId) return null;
  const matchingRead = read?.selectionId === selectionId && read.settings === settings ? read : null;
  const native = open && matchingRead && now >= matchingRead.observedAt &&
    now - matchingRead.observedAt < 30_000 ? matchingRead.status : null;
  let selection: MeasurementSelection | null = null;
  try {
    if (open) selection = resolveMeasurementSelection(settings, selectionId, native, now);
  } catch {
    // Malformed or ambiguous saved deployment identities stay unavailable.
  }
  const panel = selection
    ? deploymentMeasurementPanel(selection.state, selection.deploymentId,
        selection.observation, selection.contextTokens, selection.backend, now)
    : null;
  const historical = panel?.history.filter(row => row.runId !== panel.current?.runId) ?? [];
  const startableManaged = managed && native?.installed === true && native.state === "Stopped";
  const canRun = !!selection && (selection.ready || startableManaged) &&
    !running && !runInFlight.current;

  const runMeasurement = () => {
    if (!selectionId || !selection || !(selection.ready || startableManaged) ||
        runInFlight.current) return;
    runInFlight.current = true;
    setRunning(true);
    // Separate explicit opt-in procedure; its runtime revalidates the exact
    // deployment and owns all scheduling, limits and durable evidence writes.
    void import("@/modules/ai/lib/deploymentMeasurementRuntime")
      .then(module => module.runBoundedDeploymentMeasurement(selectionId))
      .then(() => {
        toast.success("Measurement procedure finished. Review its scoped results in history.");
      })
      .catch(() => {
        toast.warning("Measurement could not finish or persist its evidence. No capability or permission was granted.");
      })
      .finally(() => {
        runInFlight.current = false;
        setRunning(false);
        if (open) refreshStatus();
      });
  };

  return (
    <Popover open={open} onOpenChange={next => {
      setOpen(next);
      if (next) refreshStatus();
      else { request.current++; setChecking(false); setRead(null); }
    }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs"
          aria-label="Deployment measurement details">Measurement</Button>
      </PopoverTrigger>
      <PopoverContent align="start"
        className="w-[26rem] max-w-[calc(100vw-16px)] max-h-[72dvh] overflow-y-auto text-xs space-y-3">
        <div className="space-y-1">
          <h3 className="font-medium">Deployment measurements</h3>
          <p className="text-muted-foreground">Measured timings and reliability belong to an exact deployment, context and runtime epoch. They never authorize tools, Agent or permissions.</p>
          {selection && <p className="truncate" title={selection.label}>{selection.label} · {selection.backend} · {selection.contextTokens?.toLocaleString() ?? "Unknown"} context tokens</p>}
        </div>
        {checking && <p role="status">Checking native runtime status…</p>}
        {!selection ? (
          <p role="status">Exact deployment identity unavailable. No measurement is current.</p>
        ) : (
          <>
            <p className="text-muted-foreground" role="status">
              {selection.observation ? "Current runtime observation available" : "No matching fresh runtime observation; previously saved measurements are historical only."}
            </p>
            {panel?.current ? (
              <div className="space-y-1 border-t pt-2">
                <p className="font-medium">Current scoped run · {new Date(panel.current.endedAt).toLocaleString()}</p>
                <p className="text-muted-foreground">Run {panel.current.runId} · epoch {panel.current.scope.runtimeEpoch}</p>
                <MetricLine label="Cold first meaningful output" metric={panel.coldFirstOutput} />
                <MetricLine label="Warm first meaningful output" metric={panel.warmFirstOutput} />
                <MetricLine label="Generation throughput" metric={panel.generation} />
                <RunMetrics run={panel.current} />
              </div>
            ) : (
              <p className="border-t pt-2" role="status">No current exact-scope measured run. Latency, throughput and reliability are Unknown.</p>
            )}
            <details className="border-t pt-2">
              <summary className="cursor-pointer font-medium">Historical runs ({historical.length})</summary>
              {historical.length === 0 ? (
                <p className="pt-2 text-muted-foreground">No saved historical measurements for this deployment.</p>
              ) : (
                <div className="space-y-3 pt-2">
                  {historical.map(run => (
                    <div key={run.runId} className="space-y-1 border-t pt-2">
                      <p className="font-medium">{new Date(run.endedAt).toLocaleString()} · {run.backend} · {run.configuredContextTokens?.toLocaleString() ?? "Unknown"} tokens</p>
                      <p className="break-all text-muted-foreground">Historical only · {run.runId} · epoch {run.scope.runtimeEpoch}</p>
                      <RunMetrics run={run} />
                    </div>
                  ))}
                </div>
              )}
            </details>
          </>
        )}
        <div className="space-y-2 border-t pt-2">
          <p className="text-muted-foreground">An explicit run may generate model text. No benchmark starts when this panel opens, and a completed request alone is not qualification evidence.</p>
          <Button size="sm" variant="outline" onClick={runMeasurement} disabled={!canRun}>
            {running ? "Measuring…" : "Run bounded measurement"}
          </Button>
          {managed && startableManaged &&
            <p className="text-muted-foreground">This exact managed deployment is Stopped. A user-initiated bounded run may start it once for a cold observation; opening this panel does not start it.</p>}
          {managed && !selection?.ready && !startableManaged &&
            <p className="text-muted-foreground">The current native state does not permit a safe bounded start. No measurement will run.</p>}
          {!managed && !selection?.ready &&
            <p className="text-muted-foreground">Secondary runtime availability is unverified. No SSH, provider probe or inference is initiated by this panel.</p>}
          <Button size="sm" variant="ghost" onClick={refreshStatus}>Refresh status</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
