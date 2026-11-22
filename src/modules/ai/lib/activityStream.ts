import type { UIMessage, UIMessageChunk } from "ai";
import {
  createActivityRecorder,
  readActivity,
  type ActivityOwner,
} from "@/modules/ai/lib/activity";
import {
  inferenceLabel,
  type InferenceScope,
} from "@/modules/ai/lib/inferenceLifecycle";
import type { ProviderRetryEvent } from "@/modules/ai/lib/providerRetry";
import type { ManagedExecutionIdentity } from "@/modules/ai/lib/managedExecutionEvidence";
import type { ManagedActivityExecution } from "@/modules/ai/lib/activityRecord";

export type ActivityStreamContext = {
  customTool: (id: string, state: string, effect: string) => void;
  scope?: InferenceScope;
  retry: (event: ProviderRetryEvent) => void;
  recovered: () => void;
};

/** Only the source's native authenticated Ready receipt may provide this
 * evidence. SDK stream termination and Rust inference-N terminal are distinct.
 * A failed readback becomes Unknown, not a guessed CPU/CUDA trace. */
function managedActivityTrace(
  original: ManagedExecutionIdentity,
  terminal: "completed" | "failed" | "cancelled" | "unknown",
  current: ManagedExecutionIdentity | null,
): ManagedActivityExecution {
  const stillCurrent=!!current &&
    current.stableExecutionIdentity===original.stableExecutionIdentity &&
    current.runtime.epoch===original.runtime.epoch &&
    current.runtime.processId===original.runtime.processId &&
    current.runtime.route?.baseUrl===original.runtime.route?.baseUrl &&
    current.runtime.route?.alias===original.runtime.route?.alias;
  return {
    version:1,
    stableExecutionIdentity:original.stableExecutionIdentity,
    deploymentId:original.deployment.deploymentId,
    requestedBackendOrder:original.requested.candidates?.map(row=>row.backend) ??
      [original.requested.backend,...(original.requested.fallback.order??[])],
    selectedBackend:original.selected.backend,
    actualBackend:original.actual.backend,
    deviceIds:[...original.actual.deviceIds],
    runtimeVariantId:original.actual.runtimeVariantId,
    runtimeBuildDigest:original.runtime.runtimeBuildDigest,
    actualGpuLayers:original.actual.gpuLayers,
    requestedGpuLayers:original.selected.requestedGpuLayers,
    cpuThreads:original.selected.cpuThreads,
    processId:original.runtime.processId,
    runtimeEpoch:original.runtime.epoch,
    routeBaseUrl:original.runtime.route?.baseUrl??null,
    fallbackUsed:original.selected.fallbackUsed,
    fallbackReason:original.selected.fallbackReason?.slice(0,1024)??null,
    nativeHostAvailableBytes:original.memory.hostAvailableBeforeBytes,
    nativeDeviceAvailableBytes:original.memory.deviceAvailableBeforeBytes,
    estimatedDeviceRequirementBytes:original.memory.estimatedDeviceRequiredBytes,
    observedAt:original.observedAt,
    sdkTerminalOutcome:terminal,
    nativeRequestTerminal:"Unknown",
    processStillCurrentAtTerminal:stillCurrent,
  };
}

export function activityStream(
  messages: UIMessage[],
  owner: ActivityOwner,
  scope: InferenceScope | undefined,
  execute: (
    context: ActivityStreamContext,
  ) => Promise<ReadableStream<UIMessageChunk>>,
  onError: (error: unknown) => string,
  captureManagedExecution?: () => Promise<ManagedExecutionIdentity | null>,
): ReadableStream<UIMessageChunk> {
  const last = messages[messages.length - 1];
  const previous =
    last?.role === "assistant"
      ? readActivity(last, owner.sessionId, owner.workspaceId)
      : null;
  const recorder = createActivityRecorder(
    owner,
    previous ?? undefined,
    last?.role === "assistant" ? last.parts : [],
  );
  let active = true;
  let reader: ReadableStreamDefaultReader<UIMessageChunk> | undefined;
  return new ReadableStream<UIMessageChunk>({
    cancel(reason) {
      active = false;
      return reader?.cancel(reason);
    },
    async start(controller) {
      const before=await captureManagedExecution?.().catch(()=>null) ?? null;
      let terminalTraced=false;
      const recordNativeExecution = async (
        terminal:"completed"|"failed"|"cancelled"|"unknown",
      ) => {
        if (!before || !active || terminalTraced) return;
        terminalTraced=true;
        const after=await captureManagedExecution?.().catch(()=>null)??null;
        recorder.add({
          id:`managed-execution:${owner.runId}:${crypto.randomUUID()}`,
          kind:"request",
          label:"Managed execution receipt (SDK terminal; native inference terminal unverified)",
          managedExecution:managedActivityTrace(before,terminal,after),
        });
      };
      const writer = {
        write: (chunk: UIMessageChunk) => {
          if (active) controller.enqueue(chunk);
        },
      };
      let started = false;
      const metadata = () => {
        if (started)
          writer.write({
            type: "message-metadata",
            messageMetadata: { clackActivity: recorder.snapshot() },
          });
      };
      const add = (
        id: string,
        kind: "request" | "retry" | "recovered" | "tool",
        label: string,
      ) => {
        if (!active || (scope && !scope.isCurrent())) return;
        if (recorder.add({ id, kind, label })) metadata();
      };
      try {
        const stream = await execute({
          customTool: (id, state, effect) => {
            const labels: Record<string, string> = {
              "awaiting-approval": "Custom tool: approval required",
              approved: "Custom tool: approved",
              running: "Custom tool: running",
              succeeded: "Custom tool: succeeded",
              failed: "Custom tool: failed",
              denied: "Custom tool: denied",
              cancelled: "Custom tool: cancelled",
              "timed-out": "Custom tool: timed out",
              interrupted: "Custom tool: interrupted",
            };
            if (labels[state])
              add(
                `custom-tool:${id}:${state}:${effect}`,
                "tool",
                `${labels[state]}${effect === "unknown" ? "; effect unknown" : ""}`,
              );
          },
          scope: scope
            ? {
                ...scope,
                onPhase: (snapshot) => {
                  scope.onPhase?.(snapshot);
                  add(
                    `request:${snapshot.id}:${snapshot.phase}`,
                    "request",
                    inferenceLabel({ ...snapshot, scope: undefined }),
                  );
                },
              }
            : undefined,
          retry: (event) =>
            add(
              `retry:${owner.runId}:${crypto.randomUUID()}`,
              "retry",
              `Provider retry ${event.retryNumber}/${event.maxRetries}`,
            ),
          recovered: () =>
            add(
              `recovered:${crypto.randomUUID()}`,
              "recovered",
              "Provider request recovered",
            ),
        });
        if (!active) {
          await stream.cancel();
          return;
        }
        reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const changed = recorder.observe(value);
            // Metadata must not turn a submitted request into streaming before
            // the SDK receives actual output. Preserve its original start/id.
            if (value.type !== "start" && value.type !== "start-step")
              started = true;
            if (
              value.type === "error" ||
              value.type === "abort" ||
              value.type === "finish"
            ) {
              await recordNativeExecution(
                value.type==="finish"?"completed":
                  value.type==="abort"?"cancelled":"failed");
              metadata();
            }
            writer.write(value);
            if (
              changed &&
              value.type !== "error" &&
              value.type !== "abort" &&
              value.type !== "finish"
            )
              metadata();
          }
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        if (!active) return;
        await recordNativeExecution("failed");
        recorder.add({
          id: `error:${crypto.randomUUID()}`,
          kind: "error",
          label: "Request did not complete",
        });
        started = true;
        metadata();
        writer.write({ type: "error", errorText: onError(error) });
      } finally {
        if (active) controller.close();
        active = false;
      }
    },
  });
}
