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

export type ActivityStreamContext = {
  scope?: InferenceScope;
  retry: (event: ProviderRetryEvent) => void;
  recovered: () => void;
};

export function activityStream(
  messages: UIMessage[],
  owner: ActivityOwner,
  scope: InferenceScope | undefined,
  execute: (
    context: ActivityStreamContext,
  ) => Promise<ReadableStream<UIMessageChunk>>,
  onError: (error: unknown) => string,
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
        kind: "request" | "retry" | "recovered",
        label: string,
      ) => {
        if (!active || (scope && !scope.isCurrent())) return;
        if (recorder.add({ id, kind, label })) metadata();
      };
      try {
        const stream = await execute({
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
            )
              metadata();
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
