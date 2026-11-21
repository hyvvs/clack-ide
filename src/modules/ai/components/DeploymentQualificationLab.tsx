import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildDeploymentEvidenceCatalog, type EvidenceCandidate } from "@/modules/ai/lib/deploymentEvidenceDecisions";
import { agentAcceptancePrerequisites, profileCandidateDeployment,
  selectAgentAcceptanceCandidates } from "@/modules/ai/lib/candidateQualification";
import { actionableQualificationError, deploymentProductSummary } from "@/modules/ai/lib/deploymentProductStates";
import { nativeHardwareObservationSchema, type NativeHardwareObservation } from "@/modules/ai/lib/hardwareProfile";
import { reconcileLocalComputeFabric, resolveModelDeployment } from "@/modules/ai/lib/localComputeFabric";
import { isManagedLocalSelectionId, MANAGED_LOCAL_HOST_ID, resolveManagedLocalSelection } from "@/modules/ai/lib/managedLocalModels";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import { nativeGgufResourceSchema, type NativeGgufResource } from "@/modules/ai/lib/modelResourceProfile";
import { QUALIFICATION_LAB_PROCEDURES, buildQualificationLabPlan,
  type QualificationLabProcedureId } from "@/modules/ai/lib/qualificationLabPlan";
import { resolveSelfHostedSelection, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";

type NativeRead = {
  selectionId: string;
  state: SelfHostedState;
  observedAt: number;
  status: ManagedLocalNativeStatus | null;
  hardware: NativeHardwareObservation | null;
  metadata: NativeGgufResource | null;
};

function selectedForSession(sessionId: string): string | null | undefined {
  const session = useChatStore.getState().sessions.find(item => item.id === sessionId);
  return session?.run?.state === "running"
    ? session.run.modelId : session?.profile?.modelId;
}

function currentDeploymentId(state: SelfHostedState, selectionId: string): string | null {
  if (isManagedLocalSelectionId(selectionId)) {
    const selected = resolveManagedLocalSelection(state, selectionId);
    return selected.status === "available" || selected.status === "unavailable"
      ? selected.deployment.id : null;
  }
  const selected = resolveSelfHostedSelection(state, selectionId);
  if (selected.status !== "available") return null;
  return resolveModelDeployment(state, selected.profile)?.deployment.id ?? null;
}

function validStatus(value: unknown): ManagedLocalNativeStatus | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.installed !== "boolean" ||
      !["Not Installed", "Stopped", "Starting", "Loading", "Ready", "Stopping", "Failed"]
        .includes(String(row.state)) ||
      typeof row.version !== "string" || typeof row.epoch !== "string" ||
      ["deploymentId", "modelDigest", "error"].some(key => row[key] !== undefined &&
        row[key] !== null && typeof row[key] !== "string") ||
      ["processId", "port"].some(key => row[key] !== undefined && row[key] !== null &&
        (!Number.isSafeInteger(row[key]) || (row[key] as number) < 1))) return null;
  return row as ManagedLocalNativeStatus;
}

/** Display-only timeout for read-only native commands. A late response is
 * never accepted or interpreted as fresh deployment authority. */
function observedNativeRead(command: string, args?: Record<string, unknown>): Promise<unknown> {
  return Promise.race([
    invoke<unknown>(command, args).catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 4_000)),
  ]);
}

/** The Lab is a bounded-procedure *orchestrator*, not an alternate LM2F/LM6
 * engine. Simply opening it never dispatches inference or alters settings.
 * Unknown remote process/model residency is never promoted to fresh Ready. */
export function DeploymentQualificationLab({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [nativeRead, setNativeRead] = useState<NativeRead | null>(null);
  const [now, setNow] = useState(Date.now());
  const [deploymentId, setDeploymentId] = useState("");
  const [procedureId, setProcedureId] = useState<QualificationLabProcedureId>("chat-and-adherence");
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const seq = useRef(0);
  const activeRun = useRef(false);
  const settings = usePreferencesStore(s => s.selfHostedInference);
  const coderPermission = usePreferencesStore(s => s.agentPermissionProfiles["builtin:coder"]?.mode);
  const selectionId = useChatStore(s => {
    const session = s.sessions.find(item => item.id === sessionId);
    return session?.run?.state === "running"
      ? session.run.modelId : session?.profile?.modelId;
  });
  const eligible = !!selectionId &&
    (isManagedLocalSelectionId(selectionId) || selectionId.startsWith("self-hosted:"));

  // Invalidate any pending native observation on identity/permission changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit security invalidation boundary
  useEffect(() => {
    ++seq.current;
    setOpen(false);
    setChecking(false);
    setNativeRead(null);
    setDeploymentId("");
    setProcedureId("chat-and-adherence");
    setRunMessage("");
  }, [sessionId, selectionId, settings, coderPermission]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  const openChanged = (next: boolean) => {
    setOpen(next);
    const token = ++seq.current;
    setChecking(false);
    setNativeRead(null);
    setNow(Date.now());
    setRunMessage("");
    if (!next || !selectionId || !isManagedLocalSelectionId(selectionId)) return;
    const exact = resolveManagedLocalSelection(settings, selectionId);
    if ((exact.status !== "available" && exact.status !== "unavailable") ||
        exact.host.id !== MANAGED_LOCAL_HOST_ID || !exact.artifact.digest) return;
    setChecking(true);
    const digest = exact.artifact.digest;
    // Three read-only observations, gated by explicit Lab opening. Native
    // status is requested last, after metadata/hardware reads, for freshness.
    void (async () => {
      const [hardwareRaw, metadataRaw] = await Promise.allSettled([
        observedNativeRead("local_hardware_observation"),
        observedNativeRead("managed_local_runtime_model_metadata", { digest }),
      ]);
      if (seq.current !== token) return;
      const statusRaw = await observedNativeRead("managed_local_runtime_status", {
        deploymentId: exact.deployment.id,
        deploymentIdentity: exact.identity,
      });
      const observedAt = Date.now();
      if (seq.current !== token || selectedForSession(sessionId) !== selectionId ||
          usePreferencesStore.getState().selfHostedInference !== settings ||
          usePreferencesStore.getState().agentPermissionProfiles["builtin:coder"]?.mode !== coderPermission)
        return;
      const hardware = hardwareRaw.status === "fulfilled"
        ? nativeHardwareObservationSchema.safeParse(hardwareRaw.value) : null;
      const metadata = metadataRaw.status === "fulfilled"
        ? nativeGgufResourceSchema.safeParse(metadataRaw.value) : null;
      setNativeRead({
        selectionId, state: settings, observedAt, status: validStatus(statusRaw),
        hardware: hardware?.success ? hardware.data : null,
        metadata: metadata?.success && metadata.data.digest === digest ? metadata.data : null,
      });
      setNow(observedAt);
      setChecking(false);
    })().catch(() => { if (seq.current === token) setChecking(false); });
  };

  if (!eligible || !selectionId) return null;
  const read = open && nativeRead?.selectionId === selectionId &&
    nativeRead.state === settings && nativeRead.observedAt <= now &&
    now - nativeRead.observedAt < 30_000 ? nativeRead : null;
  let candidates: EvidenceCandidate[] = [];
  let selectedId: string | null = null;
  try {
    if (open) {
      selectedId = currentDeploymentId(settings, selectionId);
      candidates = buildDeploymentEvidenceCatalog(settings, {
        now, managedStatus: read?.status, managedObservedAt: read?.observedAt,
        localHardware: read?.hardware, localMetadata: read?.metadata,
      });
    }
  } catch { /* Broken registries must remain inert, not runnable. */ }
  const chosen = candidates.find(c => c.deploymentId === deploymentId) ??
    candidates.find(c => c.deploymentId === selectedId) ?? candidates[0];
  const plan = chosen ? buildQualificationLabPlan(chosen, procedureId, {
    state: settings, now, managedStatus: read?.status, managedObservedAt: read?.observedAt,
    chatOnlyCoderConfirmed: coderPermission === "chat-only",
  }) : null;
  const status = chosen ? deploymentProductSummary(chosen, reconcileLocalComputeFabric(settings)) : null;
  const candidateProfile = chosen ? profileCandidateDeployment(chosen) : null;
  const agentShortlist = selectAgentAcceptanceCandidates(candidates);
  const exactCurrentSelection = !!chosen && chosen.deploymentId === selectedId;
  // An advertised plan does NOT license a runner whose aggregate wall bound
  // is not yet enforced. The gate stays closed until the existing runner can
  // prove end-to-end bounded cancellation and durable quiescence.
  const canRun = !!plan?.enabled && plan.aggregateWallDeadlineEnforced &&
    !!plan.scope.exactObservedScope && exactCurrentSelection && !running && !activeRun.current;

  const execute = () => {
    if (!canRun || !plan || !chosen || !selectionId || activeRun.current) return;
    activeRun.current = true;
    setRunning(true);
    setRunMessage("");
    const selectedScope = JSON.stringify(plan.scope.exactObservedScope);
    const token = seq.current;
    const requestedPlan = plan;
    void (async () => {
      // Separate request-time native preflight. No cached Ready state, changed
      // artifact, permissions, session or epoch can authorize a dispatch.
      const exact = resolveManagedLocalSelection(settings, selectionId);
      if (exact.status === "missing" || exact.status === "not-managed")
        throw new Error("Exact managed deployment unavailable before qualification dispatch");
      const statusRaw = await invoke<unknown>("managed_local_runtime_status", {
        deploymentId: exact.deployment.id,
        deploymentIdentity: exact.identity,
      });
      const checkedAt = Date.now();
      const checked = validStatus(statusRaw);
      if (checked?.state !== "Ready" || token !== seq.current ||
          selectedForSession(sessionId) !== selectionId ||
          usePreferencesStore.getState().selfHostedInference !== settings ||
          usePreferencesStore.getState().agentPermissionProfiles["builtin:coder"]?.mode !== "chat-only")
        throw new Error("Runtime changed before qualification dispatch");
      const updated = buildDeploymentEvidenceCatalog(settings, {
        now: checkedAt, managedStatus: checked, managedObservedAt: checkedAt,
        localHardware: read?.hardware, localMetadata: read?.metadata,
      }).find(row => row.deploymentId === chosen.deploymentId);
      if (!updated) throw new Error("Deployment identity changed");
      const current = buildQualificationLabPlan(updated, procedureId, {
        state: settings, now: checkedAt, managedStatus: checked,
        managedObservedAt: checkedAt, chatOnlyCoderConfirmed: true,
      });
      if (!current.enabled || !current.aggregateWallDeadlineEnforced ||
          JSON.stringify(current.scope.exactObservedScope) !== selectedScope ||
          current.runner !== requestedPlan.runner || current.runnerMode !== requestedPlan.runnerMode)
        throw new Error("Qualification stale after runtime change");
      if (current.runner === "managed-chat-qualification") {
        const runner = await import("@/modules/ai/lib/deploymentQualificationRuntime");
        const result = await runner.runManagedChatQualification(selectionId);
        return `LM2F saved ${result.receiptCount} exact-scope receipts. Chat ${result.chat}; instruction ${result.instructionAdherence}.`;
      }
      if (current.runner === "bounded-deployment-measurement" && current.runnerMode === "standard") {
        const runner = await import("@/modules/ai/lib/deploymentMeasurementRuntime");
        const result = await runner.runBoundedDeploymentMeasurement(selectionId, "standard");
        if (result.status !== "recorded") throw new Error("Measurement incomplete or unavailable");
        return `LM6 stored ${result.attempted} attempts. Review each original result in History.`;
      }
      throw new Error("Unsupported procedure executor");
    })().then(message => {
      if (token === seq.current) setRunMessage(message);
      toast.success(message);
    }).catch(error => {
      const message = actionableQualificationError(error);
      if (token === seq.current) setRunMessage(message);
      toast.warning(message);
    }).finally(() => {
      activeRun.current = false;
      setRunning(false);
      // Keep the result visible; a subsequent explicit opening refreshes
      // the read-only native observation without silently mutating state.
    });
  };

  return (
    <Popover open={open} onOpenChange={openChanged}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-xs"
          aria-label="Qualification Lab details">Qualification Lab</Button>
      </PopoverTrigger>
      <PopoverContent align="start"
        className="w-[43rem] max-w-[calc(100vw-16px)] max-h-[75dvh] overflow-y-auto text-xs space-y-3">
        <header className="space-y-1">
          <h3 className="font-medium">Qualification Lab</h3>
          <p className="text-muted-foreground">
            Preview exact deployment, bounded requests and evidence before any run.
            Merely opening the Lab never starts a model, sends inference or modifies settings.
          </p>
        </header>
        {checking && <p role="status">Reading current native runtime and hardware evidence…</p>}
        {candidates.length === 0 || !chosen ? (
          <p role="status">No registered exact deployment can be evaluated. Import or select a model explicitly.</p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="font-medium">Exact deployment</span>
              <select aria-label="Qualification Lab deployment" value={chosen.deploymentId}
                onChange={event => { setDeploymentId(event.target.value); setRunMessage(""); }}
                className="block w-full min-w-0 rounded border border-border bg-background p-1">
                {candidates.map(candidate => <option key={candidate.deploymentId} value={candidate.deploymentId}>
                  {candidate.displayName} · {candidate.hostName} · {candidate.runtimeName} · {candidate.deploymentId}
                </option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="font-medium">Bounded procedure</span>
              <select aria-label="Qualification Lab procedure" value={procedureId}
                onChange={event => { setProcedureId(event.target.value as QualificationLabProcedureId); setRunMessage(""); }}
                className="block w-full min-w-0 rounded border border-border bg-background p-1">
                {QUALIFICATION_LAB_PROCEDURES.map(proc =>
                  <option key={proc.id} value={proc.id}>{proc.title}</option>)}
              </select>
            </label>
            <section aria-label="Qualification Lab plan" className="space-y-2 rounded-md border p-2">
              <h4 className="font-medium">Deterministic run plan · {plan?.procedure.title}</h4>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div><dt className="text-muted-foreground">Readiness</dt><dd>{status?.readiness ?? "Unknown"}</dd></div>
                <div><dt className="text-muted-foreground">Current Chat proof</dt><dd>{status?.qualification ?? "Unknown"}</dd></div>
                <div><dt className="text-muted-foreground">Host / runtime</dt><dd className="break-all">{plan?.scope.hostId} / {plan?.scope.runtimeId}</dd></div>
                <div><dt className="text-muted-foreground">Runtime version / epoch</dt><dd className="break-all">{plan?.scope.runtimeVersion ?? "Unknown"} / {plan?.scope.runtimeEpoch ?? "Unknown"}</dd></div>
                <div><dt className="text-muted-foreground">Artifact / digest</dt><dd className="break-all">{plan?.scope.artifactId ?? "Unknown"} / {plan?.scope.artifactDigest ?? "Unknown"}</dd></div>
                <div><dt className="text-muted-foreground">Backend / context</dt><dd>{plan?.scope.backend ?? "Unknown"} / {plan?.scope.contextTokens?.toLocaleString() ?? "Unknown"}</dd></div>
                <div><dt className="text-muted-foreground">Requests / hard output cap</dt><dd>{plan?.procedure.limits.maxAttempts} / {plan?.procedure.limits.maxOutputTokensPerAttempt} tokens each</dd></div>
                <div><dt className="text-muted-foreground">Planned wall ceiling</dt><dd>{plan?.procedure.limits.maxWallTimeMs.toLocaleString() ?? "Unknown"} ms</dd></div>
                <div><dt className="text-muted-foreground">Retries / continuations</dt><dd>{plan?.procedure.limits.maxRetries} / {plan?.procedure.limits.maxAutomaticContinuations}</dd></div>
                <div><dt className="text-muted-foreground">Effects / tools</dt><dd>{plan?.procedure.limits.sideEffectClass} / none allowed</dd></div>
              </dl>
              <p className="text-muted-foreground">
                Cancellation: {plan?.procedure.limits.cancelPolicy ?? "Unknown"}.
                {" "}Evidence ledger: {plan?.procedure.expectedAuthority ?? "none"}.
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                {plan?.procedure.steps.map(step =>
                  <li key={step.id}>
                    <strong>{step.title}</strong> · {step.maxDispatches} request
                    <span className="block text-muted-foreground">{step.expectedEvidence.join("; ")}</span>
                  </li>)}
              </ol>
              <p role="status" className="text-muted-foreground">
                {plan?.enabled && plan.aggregateWallDeadlineEnforced && exactCurrentSelection
                  ? "Procedure eligible after a separate native preflight."
                  : `Unavailable: ${plan?.unavailableReason ?? "No current exact deployment"}${
                    plan && !plan.aggregateWallDeadlineEnforced
                      ? "; existing runners lack a verified aggregate wall deadline" : ""}.`}
              </p>
              {plan?.gates.some(gate => !gate.allowed) && (
                <details><summary className="cursor-pointer">Admission details</summary>
                  <ul className="list-disc space-y-1 pl-5 pt-1 text-muted-foreground">
                    {plan.gates.filter(gate => !gate.allowed).map(gate =>
                      <li key={`${gate.id}:${gate.reason}`}>{gate.id}: {gate.reason}</li>)}
                  </ul>
                </details>
              )}
              <Button type="button" size="sm" variant="outline" disabled={!canRun} onClick={execute}>
                {running ? "Running bounded qualification…" : "Run this exact bounded procedure"}
              </Button>
              {runMessage && <p role="status">{runMessage}</p>}
            </section>
            <details className="border-t pt-2">
              <summary className="cursor-pointer font-medium">Candidate evidence and Agent acceptance</summary>
              <div className="space-y-1 pt-2">
                {candidateProfile?.workloads.map(workload =>
                  <p key={workload.workload} className="text-muted-foreground">
                    <strong>{workload.workload}:</strong> {workload.verdict} · {workload.reason}
                  </p>)}
                <p className="font-medium">Agent acceptance shortlist: {agentShortlist.length}/2</p>
                {agentShortlist.length === 0 ? (
                  <p role="status">No Agent candidate. No Agent task or ForgeBoard campaign will start.</p>
                ) : agentShortlist.map(item => <p key={item.deploymentId}>
                  {item.displayName} · {item.deploymentId} · current prerequisites available.
                  Bounded Agent acceptance still requires an independently verified task runner.
                </p>)}
                {agentShortlist.length === 0 && chosen && (
                  <p className="text-muted-foreground">
                    Missing for this deployment: {agentAcceptancePrerequisites(chosen).join("; ") || "Unknown"}.
                  </p>)}
                <p className="text-muted-foreground">No model download, backend switch, Agent tool permission or automatic ForgeBoard launch occurs here.</p>
              </div>
            </details>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
