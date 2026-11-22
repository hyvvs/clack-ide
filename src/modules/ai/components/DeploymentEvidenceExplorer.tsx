import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  buildDeploymentEvidenceCatalog,
  compareDeploymentEvidence,
  recommendAllDeployments,
  EVIDENCE_RECOMMENDATION_CATEGORIES,
  type EvidenceCandidate,
  type EvidenceRecommendationCategory,
} from "@/modules/ai/lib/deploymentEvidenceDecisions";
import { buildDeploymentEvidenceHistory } from "@/modules/ai/lib/deploymentEvidenceHistory";
import { profileCandidateDeployment } from "@/modules/ai/lib/candidateQualification";
import { deploymentProductSummary, type DeploymentProductSummary } from "@/modules/ai/lib/deploymentProductStates";
import { observedManagedFabric } from "@/modules/ai/lib/deploymentQualificationView";
import { nativeHardwareObservationSchema, type NativeHardwareObservation } from "@/modules/ai/lib/hardwareProfile";
import { reconcileLocalComputeFabric, resolveModelDeployment } from "@/modules/ai/lib/localComputeFabric";
import {
  isManagedLocalSelectionId,
  MANAGED_LOCAL_HOST_ID,
  resolveManagedLocalSelection,
} from "@/modules/ai/lib/managedLocalModels";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import { nativeGgufResourceSchema, type NativeGgufResource } from "@/modules/ai/lib/modelResourceProfile";
import { resolveSelfHostedSelection, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";

type NativeRead = {
  selectionId: string;
  settings: SelfHostedState;
  observedAt: number;
  status: ManagedLocalNativeStatus | null;
  hardware: NativeHardwareObservation | null;
  metadata: NativeGgufResource | null;
};

function selectedForSession(sessionId: string): string | null | undefined {
  const session = useChatStore.getState().sessions.find(row => row.id === sessionId);
  return session?.run?.state === "running"
    ? session.run.modelId : session?.profile?.modelId;
}

function validNativeStatus(value: unknown): ManagedLocalNativeStatus | null {
  if (!value || typeof value !== "object") return null;
  const status = value as Record<string, unknown>;
  if (typeof status.installed !== "boolean" ||
      !["Not Installed", "Stopped", "Starting", "Loading", "Ready", "Stopping", "Failed"]
        .includes(String(status.state)) ||
      typeof status.version !== "string" || typeof status.epoch !== "string" ||
      ["deploymentId", "modelDigest", "error"].some(key =>
        status[key] !== undefined && status[key] !== null && typeof status[key] !== "string") ||
      ["processId", "port"].some(key =>
        status[key] !== undefined && status[key] !== null &&
        (!Number.isSafeInteger(status[key]) || (status[key] as number) < 1)))
    return null;
  return status as ManagedLocalNativeStatus;
}

/** Read-only IPC may stall under host pressure. Bound waiting for display;
 * an unfinished read never becomes readiness or measurement authority. */
function observedNativeRead(command: string, args?: Record<string, unknown>): Promise<unknown> {
  return Promise.race([
    invoke<unknown>(command, args).catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 4_000)),
  ]);
}

/** Resolve the exact conversation selection. Display labels and model tags
 * are never used as lookup keys or evidence authority. */
function selectedDeploymentId(state: SelfHostedState, selectionId: string): string | null {
  if (isManagedLocalSelectionId(selectionId)) {
    const exact = resolveManagedLocalSelection(state, selectionId);
    return exact.status === "available" || exact.status === "unavailable"
      ? exact.deployment.id : null;
  }
  const exact = resolveSelfHostedSelection(state, selectionId);
  if (exact.status !== "available") return null;
  return resolveModelDeployment(state, exact.profile)?.deployment.id ?? null;
}

function evidenceMetric(value: { value: number | null; provenance: string; unit: string }): string {
  if (value.value === null) return "Unknown";
  if (value.unit === "ms") return `${value.value.toFixed(0)} ms · ${value.provenance}`;
  if (value.unit === "tokens/s") return `${value.value.toFixed(2)} tokens/s · ${value.provenance}`;
  return `${value.value.toLocaleString()} ${value.unit} · ${value.provenance}`;
}

function Overview({ candidate, product, historyCount, instructionHistory }: {
  candidate: EvidenceCandidate;
  product: DeploymentProductSummary;
  historyCount: number;
  instructionHistory: { verdict: string; status: string; at: number } | undefined;
}) {
  return (
    <section aria-label="Selected deployment overview" className="space-y-2">
      <div className="space-y-1">
        <p className="break-words font-medium">{candidate.displayName}</p>
        <p className="text-muted-foreground">
          {candidate.hostName} · {candidate.runtimeName} · {candidate.backend} ·
          {" "}{candidate.contextTokens?.toLocaleString() ?? "Unknown"} context tokens
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border p-2 sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Readiness</dt><dd className="font-medium">{product.readiness}</dd></div>
        <div><dt className="text-muted-foreground">Chat qualification</dt><dd>{product.qualification}</dd></div>
        <div><dt className="text-muted-foreground">Hardware fit</dt><dd>{candidate.hardwareFit} · {candidate.confidence} confidence</dd></div>
        <div><dt className="text-muted-foreground">Main limiting factor</dt><dd>{candidate.limitingFactor}</dd></div>
        <div><dt className="text-muted-foreground">Current warm first output</dt><dd>{evidenceMetric(candidate.warmFirstOutput)}</dd></div>
        <div><dt className="text-muted-foreground">Instruction adherence</dt><dd>{product.instruction}</dd></div>
        <div><dt className="text-muted-foreground">Native tools</dt><dd>{product.nativeTools}</dd></div>
        <div><dt className="text-muted-foreground">Automatic Agent</dt><dd>{candidate.qualification.agent.eligible ? "Qualified" : "Unavailable"}</dd></div>
        <div><dt className="text-muted-foreground">Evidence history</dt><dd>{historyCount} records</dd></div>
        <div><dt className="text-muted-foreground">LM6 saved runs</dt><dd>{candidate.historyRunCount}</dd></div>
        <div><dt className="text-muted-foreground">Measured Chat samples</dt><dd>{candidate.measuredChatSamples}</dd></div>
        <div><dt className="text-muted-foreground">Generation</dt><dd>{evidenceMetric(candidate.generationThroughput)}</dd></div>
        {candidate.backendEvidence && (
          <div><dt className="text-muted-foreground">Execution backend evidence</dt>
            <dd>{candidate.observedBackend ? `${candidate.observedBackend.toUpperCase()} · Native verified` :
              `${candidate.backend} · ${candidate.backendEvidence.provenance}`}</dd></div>
        )}
        {candidate.requestedGpuLayers && (
          <div><dt className="text-muted-foreground">Requested GPU layer cap</dt>
            <dd>{evidenceMetric(candidate.requestedGpuLayers)}</dd></div>
        )}
        {candidate.gpuLayers && (
          <div><dt className="text-muted-foreground">Observed GPU offload</dt>
            <dd>{evidenceMetric(candidate.gpuLayers)}</dd></div>
        )}
      </dl>
      {product.readiness !== "Ready" && <p className="text-muted-foreground">{product.reason}</p>}
      {instructionHistory && (
        <p className="text-muted-foreground">
          Last recorded instruction evidence: {instructionHistory.verdict} · {instructionHistory.status}
          {" · "}{new Date(instructionHistory.at).toLocaleString()}.
          Historical or stale results do not grant current capability.
        </p>
      )}
      <p className="text-muted-foreground">
        Requested layers are a cap, not observed offload. Hardware fit is an estimate;
        native backend observations do not measure full GPU memory residency.
        Measurements and history never grant tools, Agent access,
        or permission to switch models. See adjacent Suitability for detailed host, RAM,
        VRAM and context capacity evidence.
      </p>
    </section>
  );
}

/** Passive LM8–LM10 explorer. The only optional native reads happen on an
 * explicit opening for an exact registered This PC GGUF selection. */
export function DeploymentEvidenceExplorer({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [read, setRead] = useState<NativeRead | null>(null);
  const [now, setNow] = useState(Date.now());
  const [comparisonId, setComparisonId] = useState("");
  const [category, setCategory] = useState<EvidenceRecommendationCategory>("Chat");
  const request = useRef(0);
  const settings = usePreferencesStore(state => state.selfHostedInference);
  const selectionId = useChatStore(state => {
    const session = state.sessions.find(row => row.id === sessionId);
    return session?.run?.state === "running"
      ? session.run.modelId : session?.profile?.modelId;
  });
  const eligibleSelection = !!selectionId &&
    (isManagedLocalSelectionId(selectionId) || selectionId.startsWith("self-hosted:"));

  // Model/settings identity changes must revoke an open native snapshot.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity dependencies are intentional invalidation boundaries
  useEffect(() => {
    request.current++;
    setOpen(false);
    setRead(null);
    setChecking(false);
    setComparisonId("");
    setCategory("Chat");
  }, [sessionId, selectionId, settings]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [open]);

  const openChanged = (next: boolean) => {
    setOpen(next);
    const token = ++request.current;
    setRead(null);
    setChecking(false);
    setNow(Date.now());
    if (!next || !selectionId || !isManagedLocalSelectionId(selectionId)) return;
    const exact = resolveManagedLocalSelection(settings, selectionId);
    if ((exact.status !== "available" && exact.status !== "unavailable") ||
        exact.host.id !== MANAGED_LOCAL_HOST_ID || exact.host.location !== "local" ||
        !exact.artifact.digest) return;
    setChecking(true);
    const digest = exact.artifact.digest;
    // Read only: native digest-checked metadata, host observation, then a fresh
    // runtime status. Reading does not load/start a model or write settings.
    void (async () => {
      const [hardwareResult, metadataResult] = await Promise.allSettled([
        observedNativeRead("local_hardware_observation"),
        observedNativeRead("managed_local_runtime_model_metadata", { digest }),
      ]);
      if (token !== request.current) return;
      const rawStatus = await observedNativeRead("managed_local_runtime_status", {
        deploymentId: exact.deployment.id,
        deploymentIdentity: exact.identity,
      });
      const observedAt = Date.now();
      if (token !== request.current ||
          selectedForSession(sessionId) !== selectionId ||
          usePreferencesStore.getState().selfHostedInference !== settings) return;
      const hardware = hardwareResult.status === "fulfilled"
        ? nativeHardwareObservationSchema.safeParse(hardwareResult.value) : null;
      const metadata = metadataResult.status === "fulfilled"
        ? nativeGgufResourceSchema.safeParse(metadataResult.value) : null;
      setRead({
        selectionId, settings, observedAt, status: validNativeStatus(rawStatus),
        hardware: hardware?.success ? hardware.data : null,
        metadata: metadata?.success && metadata.data.digest === digest ? metadata.data : null,
      });
      setNow(observedAt);
      setChecking(false);
    })().catch(() => {
      if (token === request.current) setChecking(false);
    });
  };

  if (!eligibleSelection || !selectionId) return null;

  const activeRead = open && read?.selectionId === selectionId && read.settings === settings &&
    read.observedAt <= now && now - read.observedAt < 30_000 ? read : null;
  let candidates: EvidenceCandidate[] = [];
  let candidate: EvidenceCandidate | undefined;
  let history: ReturnType<typeof buildDeploymentEvidenceHistory> | null = null;
  let selectedId: string | null = null;
  if (open) {
    try {
      selectedId = selectedDeploymentId(settings, selectionId);
      candidates = buildDeploymentEvidenceCatalog(settings, {
        now,
        managedStatus: activeRead?.status,
        managedObservedAt: activeRead?.observedAt,
        localHardware: activeRead?.hardware,
        localMetadata: activeRead?.metadata,
      });
      candidate = candidates.find(row => row.deploymentId === selectedId);
      if (candidate) {
        const observed = isManagedLocalSelectionId(selectionId)
          ? observedManagedFabric(settings, selectionId, activeRead?.status ?? null, now)
          : undefined;
        history = buildDeploymentEvidenceHistory(
          observed ? { ...settings, fabric: observed.fabric } : settings,
          candidate.deploymentId, candidate.observation,
          candidate.contextTokens, candidate.backend, now,
        );
      }
    } catch {
      // A malformed/stale registry remains unavailable, never rankable.
      candidates = [];
      candidate = undefined;
      history = null;
    }
  }
  const otherCandidates = candidates.filter(row => row.deploymentId !== candidate?.deploymentId);
  const compared = otherCandidates.find(row => row.deploymentId === comparisonId)
    ?? otherCandidates[0];
  const comparison = candidate && compared ? compareDeploymentEvidence(candidate, compared) : null;
  const product = candidate ? deploymentProductSummary(candidate,
    reconcileLocalComputeFabric(settings)) : undefined;
  const candidateProfile = candidate ? profileCandidateDeployment(candidate) : null;
  const recommendations = recommendAllDeployments(candidates);
  const recommendation = recommendations.find(row => row.category === category);
  // LM6 pre-fix uncorrelated adherence attempts are informational, not an
  // authoritative behavioral verdict. Prefer the verifier-owned LM2F receipt
  // even when the LM6 attempt has a newer timestamp.
  const lastInstruction = history?.rows.find(row =>
    row.source === "LM2F" && row.capability === "instruction-adherence") ??
    history?.rows.find(row => row.capability === "instruction-adherence");

  return (
    <Popover open={open} onOpenChange={openChanged}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-xs"
          aria-label="Deployment guide details">Deployment guide</Button>
      </PopoverTrigger>
      <PopoverContent align="start"
        className="w-[44rem] max-w-[calc(100vw-16px)] max-h-[75dvh] overflow-y-auto text-xs space-y-3">
        <header className="space-y-1">
          <h3 className="font-medium">Deployment guide</h3>
          <p className="text-muted-foreground">
            Read-only LM2F qualification, LM6 measurements, and deployment-scoped recommendations.
            Unknown and historical evidence remain separate from current proof.
          </p>
        </header>
        {checking && <p role="status">Checking local deployment observations…</p>}
        {!candidate ? (
          <p role="status">Exact selected deployment unavailable. Readiness, fit, and recommendations are Unknown.</p>
        ) : (
          <>
            <Overview candidate={candidate} product={product ?? {
              readiness: "Unknown", qualification: "Unknown", instruction: "Unknown",
              nativeTools: "Unknown", reason: "Current deployment observation unavailable.",
            }} historyCount={history?.total ?? 0}
              instructionHistory={lastInstruction && {
                verdict: lastInstruction.verdict, status: lastInstruction.status, at: lastInstruction.at,
              }} />
            {candidateProfile && (
              <details className="border-t pt-2">
                <summary className="cursor-pointer font-medium">Candidate workload profile (current evidence only)</summary>
                <div className="space-y-2 pt-2">
                  <p className="text-muted-foreground">
                    Workload-specific evidence, not a model reputation score. Coding and long-context
                    results require independent deterministic tasks before they can be called qualified.
                  </p>
                  <dl className="space-y-1">
                    {candidateProfile.workloads.map(item => (
                      <div key={item.workload}>
                        <dt className="inline font-medium">{item.workload}: </dt>
                        <dd className="inline text-muted-foreground">{item.verdict} · {item.reason}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-muted-foreground">Measured warm generation: {
                    candidateProfile.generationTokensPerSecond === null ? "Unknown"
                      : `${candidateProfile.generationTokensPerSecond.toFixed(2)} tokens/s`
                  }. Agent acceptance is unavailable until independent current prerequisites pass.</p>
                </div>
              </details>
            )}
            <details className="border-t pt-2">
              <summary className="cursor-pointer font-medium">Advanced evidence history ({history?.total ?? 0})</summary>
              <div className="space-y-2 pt-2">
                <p className="text-muted-foreground">
                  Cold samples: {history?.coldSamples.length ?? 0} · Warm samples: {history?.warmSamples.length ?? 0}.
                  Records retain the original verdict and whether that evidence is current, stale, or historical.
                </p>
                {!!history && (history.coldSamples.length > 0 || history.warmSamples.length > 0) && (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">Cold/warm output observations over time (small samples, not a benchmark)</summary>
                    <div className="max-w-full overflow-x-auto pt-1">
                      <table className="w-full min-w-[30rem] text-left text-[11px]">
                        <thead><tr className="border-b text-muted-foreground">
                          <th scope="col" className="py-1 pr-2">Observed</th>
                          <th scope="col" className="py-1 pr-2">Condition</th>
                          <th scope="col" className="py-1 pr-2">First meaningful output</th>
                          <th scope="col" className="py-1">Evidence scope</th>
                        </tr></thead>
                        <tbody>{[
                          ...history.coldSamples.map(sample => ({ ...sample, condition: "Cold" })),
                          ...history.warmSamples.map(sample => ({ ...sample, condition: "Warm" })),
                        ].sort((a, b) => b.at - a.at || a.rowId.localeCompare(b.rowId))
                          .slice(0, 12).map(sample => (
                            <tr className="border-b" key={sample.rowId}>
                              <td className="py-1 pr-2 whitespace-nowrap">{new Date(sample.at).toLocaleString()}</td>
                              <td className="py-1 pr-2">{sample.condition}</td>
                              <td className="py-1 pr-2">{sample.valueMs === null ? "Unknown" : `${sample.valueMs.toFixed(0)} ms`} · {sample.provenance}</td>
                              <td className="py-1">{sample.verdict} · {sample.status} · {sample.runId}</td>
                            </tr>
                          ))}</tbody>
                      </table>
                    </div>
                  </details>
                )}
                {history?.rows.length ? (
                  <div className="max-w-full overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-left text-[11px]">
                      <thead><tr className="border-b text-muted-foreground">
                        <th scope="col" className="py-1 pr-2">Observed</th>
                        <th scope="col" className="py-1 pr-2">Source / capability</th>
                        <th scope="col" className="py-1 pr-2">Verdict</th>
                        <th scope="col" className="py-1 pr-2">Status</th>
                        <th scope="col" className="py-1">Reference / provenance</th>
                      </tr></thead>
                      <tbody>{history.rows.slice(0, 40).map(row => (
                        <tr key={row.id} className="border-b align-top">
                          <td className="py-1 pr-2 whitespace-nowrap">{new Date(row.at).toLocaleString()}</td>
                          <td className="py-1 pr-2">{row.source} · {row.capability}</td>
                          <td className="py-1 pr-2">{row.verdict}</td>
                          <td className="py-1 pr-2">{row.status}</td>
                          <td className="py-1 break-all">
                            {row.reference ?? "No reference"} · {row.provenance}
                            <details><summary className="cursor-pointer text-muted-foreground">Exact scope</summary>
                              <span className="block">Record: {row.id}</span>
                              <span className="block">Host / runtime: {row.hostId} / {row.runtimeId}</span>
                              <span className="block">Artifact: {row.artifactDigest}</span>
                              <span className="block">Epoch: {row.runtimeEpoch}</span>
                              <span className="block">Context: {row.contextTokens?.toLocaleString() ?? "Unknown"} · Backend: {row.backend ?? "Unknown"}</span>
                              <span className="block">Procedure: {row.procedure ? `${row.procedure.id} v${row.procedure.version}` : "Legacy / Unknown"}</span>
                              {row.failure && row.failure !== "none" && <span className="block">Failure: {row.failure}</span>}
                            </details>
                          </td>
                        </tr>
                      ))}</tbody>
                    </table>
                    {history.rows.length > 40 && (
                      <p className="pt-1 text-muted-foreground">Showing 40 newest of {history.total} records.</p>
                    )}
                  </div>
                ) : <p className="text-muted-foreground">No saved LM2F or LM6 evidence for this exact deployment.</p>}
              </div>
            </details>
            <details className="border-t pt-2">
              <summary className="cursor-pointer font-medium">Compare two deployments</summary>
              <div className="space-y-2 pt-2">
                {compared && comparison ? (
                  <>
                    <label className="block space-y-1">
                      <span className="font-medium">Compare with</span>
                      <select aria-label="Compare deployment" className="block w-full min-w-0 rounded border border-border bg-background p-1"
                        value={compared.deploymentId} onChange={event => setComparisonId(event.target.value)}>
                        {otherCandidates.map(row => (
                          <option value={row.deploymentId} key={row.deploymentId}>
                            {row.displayName} · {row.hostName} · {row.runtimeName} · {row.deploymentId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p role="status" className="text-muted-foreground">
                      Timing comparison: {comparison.comparableTiming ? "Same verified scope" : "Not like-for-like; no speed winner inferred"}.
                    </p>
                    {comparison.warnings.map(warning => <p key={warning} className="text-muted-foreground">{warning}</p>)}
                    <div className="max-w-full overflow-x-auto">
                      <table className="w-full min-w-[32rem] text-left text-[11px]">
                        <thead><tr className="border-b">
                          <th scope="col" className="py-1 pr-2">Evidence</th>
                          <th scope="col" className="py-1 pr-2">{candidate.displayName} · selected</th>
                          <th scope="col" className="py-1">{compared.displayName} · comparison</th>
                        </tr></thead>
                        <tbody>{comparison.fields.map(row => (
                          <tr className="border-b align-top" key={row.label}>
                            <th scope="row" className="py-1 pr-2 font-normal text-muted-foreground">{row.label}</th>
                            <td className="py-1 pr-2 break-all">{row.left}
                              {row.provenance && <span className="block text-muted-foreground">{row.provenance.left}</span>}
                            </td>
                            <td className="py-1 break-all">{row.right}
                              {row.provenance && <span className="block text-muted-foreground">{row.provenance.right}</span>}
                            </td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </>
                ) : <p className="text-muted-foreground">A second registered deployment is required for comparison.</p>}
              </div>
            </details>
          </>
        )}
        <section className="space-y-2 border-t pt-2" aria-label="Deployment recommendations">
          <label className="block space-y-1">
            <span className="font-medium">Recommendation category</span>
            <select aria-label="Recommendation category" value={category}
              onChange={event => setCategory(event.target.value as EvidenceRecommendationCategory)}
              className="block w-full min-w-0 rounded border border-border bg-background p-1">
              {EVIDENCE_RECOMMENDATION_CATEGORIES.map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          {recommendation && (
            <div className="space-y-1">
              <p role="status" className="font-medium">
                {recommendation.deploymentId
                  ? `${recommendation.deploymentName} · ${recommendation.confidence} confidence`
                  : "No currently qualified recommendation"}
              </p>
              {recommendation.deploymentId &&
                <p className="break-all text-muted-foreground">Exact deployment: {recommendation.deploymentId}</p>}
              {recommendation.reasons.map(reason => <p key={reason} className="text-muted-foreground">{reason}</p>)}
              {recommendation.limitingFactors.length > 0 && (
                <p className="text-muted-foreground">Limits: {recommendation.limitingFactors.join("; ")}</p>
              )}
              {recommendation.evidenceReferences.length > 0 && (
                <p className="break-all text-muted-foreground">Evidence: {recommendation.evidenceReferences.join(", ")}</p>
              )}
              {recommendation.alternatives.length > 0 && (
                <p className="text-muted-foreground">Other candidates: {recommendation.alternatives.map(row =>
                  row.deploymentName).join(", ")}</p>
              )}
            </div>
          )}
          <p className="text-muted-foreground">
            Recommendations are deterministic, conservative, and informational.
            No model switching, setting changes, qualification, or inference is initiated here.
          </p>
        </section>
      </PopoverContent>
    </Popover>
  );
}
