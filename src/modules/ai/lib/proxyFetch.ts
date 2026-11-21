import { Channel, invoke } from "@tauri-apps/api/core";
import { acquireRemoteConnection, remoteEndpointFromUrl, RemoteConnectionError } from "@/modules/ai/lib/remoteConnection";
import {
  beginInference,
  type InferencePhase,
  type InferenceScope,
} from "@/modules/ai/lib/inferenceLifecycle";
import { InferenceTransportError, inspectNativeInvokeRejection, type NativeInvokeRejection } from "@/modules/ai/lib/inferenceErrors";
import type {
  InferenceAdmission,
  AdmissionObservation,
} from "@/modules/ai/lib/inferenceAdmission";
import { ContextBudgetError } from "@/modules/ai/lib/contextBudget";
import { associateNativeResponse } from "@/modules/ai/lib/ollamaParserFailureDiagnostics";
import { observeWebviewDelivery } from "@/modules/ai/lib/localDeliveryObserver";
import { observeDeploymentQualificationNative, qualificationAcceptanceBoundary } from "@/modules/ai/lib/deploymentQualificationFlight";
import { nativeDiagnosticSignalObserved, observeNativeDiagnostic, safeInferenceControls,
  type InferenceDiagnosticControls } from "@/modules/ai/lib/inferenceDiagnosticCorrelation";
import type { createRequestPreflight } from "@/modules/ai/lib/requestPreflight";

/** Streaming events emitted by the Rust `ai_http_stream` command. */
type AiStreamEvent = { requestId: string } & (
  | { kind: "preflight" }
  | { kind: "admission"; observation: AdmissionObservation }
  | { kind: "headers"; status: number; headers: Record<string, string> }
  | { kind: "chunk"; bytes: number[] }
  | { kind: "phase"; phase: InferencePhase }
  | { kind: "settled"; phase: InferencePhase; error?: { code: string };
      cancellation?: { requestId: string; at: number; source: string;
        initiatingLayer: string; reason: string; category: string;
        providerRequestInFlight: boolean } }
);

// Closed vocabulary sent to native cancellation provenance. Never forward
// AbortSignal.reason, provider error text, prompts, URLs or stream bytes.
type CancelOrigin =
  | "stream-consumer" | "parent-signal" | "session-stop"
  | "scope-superseded" | "preflight-failure"
  | "response-construction-failure" | "native-command-failure"
  | "fetch-preparation-failure" | "sdk-stream-error"
  | "provider-retry-error" | "provider-retry-finalizer"
  | "settled-cleanup";

type RequestHeaders = Record<string, string>;

function headerInitToRecord(
  init: HeadersInit | undefined,
): RequestHeaders | undefined {
  if (!init) return undefined;
  const out: RequestHeaders = {};
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(init)) {
    for (const [k, v] of init) out[k] = v;
  } else {
    for (const [k, v] of Object.entries(init)) out[k] = String(v);
  }
  return out;
}

async function bodyToBytes(
  body: BodyInit | null | undefined,
): Promise<number[] | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") {
    return Array.from(new TextEncoder().encode(body));
  }
  if (body instanceof ArrayBuffer) return Array.from(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return Array.from(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
  }
  if (body instanceof Blob)
    return Array.from(new Uint8Array(await body.arrayBuffer()));
  // FormData / URLSearchParams / ReadableStream — uncommon for AI SDK calls.
  const text = await new Response(body as BodyInit).text();
  return Array.from(new TextEncoder().encode(text));
}

export type ProxyOptions = {
  onLifecycleBoundary?: (stage: string) => void;
  onAdmission?: (signal: AbortSignal | null | undefined, observation: AdmissionObservation) => void;
  preflight?: ReturnType<typeof createRequestPreflight>;
  admission?: InferenceAdmission;
  allowPrivateNetwork?: boolean;
  selfHosted?: boolean;
  scope?: InferenceScope;
  /** Trusted, explicitly armed one-Muse diagnostic only; ordinary requests omit it. */
  diagnosticRunId?: string;
  /** One-use coordinator permit, sent only to the native diagnostic gate. */
  diagnosticPermit?: string;
};
export function createProxyFetch(opts: ProxyOptions = {}): typeof fetch {
  return (input, init) => proxyFetchImpl(input, init, opts);
}
export const proxyFetch: typeof fetch = createProxyFetch();

async function proxyFetchImpl(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  opts: ProxyOptions,
): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const signal = init?.signal ?? request?.signal;
  if (signal?.aborted || (opts.scope && !opts.scope.isCurrent())) {
    if (signal?.aborted) {
      try { opts.scope?.onStop?.({ source: "parent-signal", reason: "parent-abort" }); }
      catch { /* attribution cannot defeat cancellation */ }
    }
    throw new InferenceTransportError("cancelled");
  }
  let nativeId: string | undefined;
  let nativeSettled = false;
  let aborted = false;
  let cancelPromise: Promise<unknown> | undefined;
  let attempt: ReturnType<typeof beginInference> | undefined;
  let releaseRemote: (() => void) | undefined;
  const connectionAbort=new AbortController();
  const boundary = (stage: string) => {
    try { opts.onLifecycleBoundary?.(stage); } catch { /* observation only */ }
  };
  const cancel = (origin: CancelOrigin) => {
    boundary("response-cancelled");
    aborted = true;
    connectionAbort.abort();
    attempt?.update("stopping");
    if (nativeId && !cancelPromise)
      observeNativeDiagnostic(signal, "native-cancel-ipc", nativeId);
    if (nativeId && !cancelPromise)
      cancelPromise = invoke("ai_http_cancel", { requestId: nativeId, cancellationOrigin: origin }).catch(
        () => undefined,
      );
  };
  const isSettledCleanup = () =>
    signal?.reason instanceof DOMException &&
    signal.reason.name === "AbortError" &&
    signal.reason.message === "Request settled";
  const onAbort = () => {
    observeNativeDiagnostic(signal, "native-parent-abort", nativeId);
    if (!nativeSettled && !aborted && !isSettledCleanup()) {
      try { opts.scope?.onStop?.({ source: "parent-signal", reason: "parent-abort" }); }
      catch { /* attribution cannot defeat cancellation */ }
    }
    cancel(isSettledCleanup() ? "settled-cleanup" : "parent-signal");
  };
  attempt = beginInference(
    opts.scope,
    () => cancel("session-stop"),
    opts.admission ? "awaiting-admission" : "connecting",
  );
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    const url =
      request?.url ?? (input instanceof URL ? input.toString() : String(input));
    releaseRemote=await acquireRemoteConnection(remoteEndpointFromUrl(url),connectionAbort.signal,opts.scope);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = headerInitToRecord(init?.headers ?? request?.headers);
    let body = await bodyToBytes(
      init?.body ?? (request ? await request.arrayBuffer() : undefined),
    );
    let revalidate: Awaited<ReturnType<NonNullable<typeof opts.preflight>["prepare"]>> | undefined;
    let preparedControls: InferenceDiagnosticControls | undefined;
    if (opts.preflight) {
      const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(body ?? [])));
      const original = JSON.stringify(parsed);
      revalidate = await opts.preflight.prepare(parsed);
      // Preserve the original wire bytes unless the verified context changed.
      // Messages, history, native schemas, and output allowance are untouched.
      if (JSON.stringify(parsed) !== original)
        body = [...new TextEncoder().encode(JSON.stringify(parsed))];
      if (nativeDiagnosticSignalObserved(signal))
        preparedControls = safeInferenceControls(parsed);
    }
    if (aborted || (opts.scope && !opts.scope.isCurrent()))
      throw new InferenceTransportError("cancelled");
    if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE === "1" &&
        opts.scope?.sessionId)
      await qualificationAcceptanceBoundary(opts.scope.sessionId, "before-ai-http-open");
    nativeId = await invoke<string>("ai_http_open");
    if (!nativeId) throw new InferenceTransportError("native-transport");
    if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE === "1") {
      try {
        await qualificationAcceptanceBoundary(opts.scope?.sessionId, "after-ai-http-open");
      } catch (error) {
        // A released or revoked post-open hold owns exactly one native ID.
        // Register its cancellation before any possibility of HTTP dispatch.
        cancel("scope-superseded");
        await cancelPromise;
        throw error;
      }
    }
    observeNativeDiagnostic(signal, "native-id-linked", nativeId);
    if (preparedControls)
      observeNativeDiagnostic(signal, "native-controls-prepared", nativeId, preparedControls);
    attempt.update(
      aborted
        ? "stopping"
        : opts.admission
          ? "awaiting-admission"
          : "connecting",
      nativeId,
    );
    if (aborted || (opts.scope && !opts.scope.isCurrent())) {
      cancel(aborted ? "parent-signal" : "scope-superseded");
      await cancelPromise;
      throw new InferenceTransportError("cancelled", nativeId);
    }
    return await new Promise<Response>((resolve, reject) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let terminal: Extract<AiStreamEvent, { kind: "settled" }> | undefined;
      let status = 0;
      let finished = false;
      let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
      let preflightError: unknown;
      let validating = false;
      let firstChunkObserved = false;
      let nativeRejection: NativeInvokeRejection | undefined;
      let deliverySequence = 0;
      const channel = new Channel<AiStreamEvent>();
      let firstDeliveryHeld = false;
      let pendingDelivery: Promise<void> = Promise.resolve();
      const deliver = (event: AiStreamEvent) => {
        if (finished || terminal || event.requestId !== nativeId) return;
        if (event.kind === "settled") {
          if (event.phase === "completed" && !event.error) {
            observeDeploymentQualificationNative(opts.scope?.sessionId,
              "terminal", nativeId, Date.now());
          } else if (event.phase === "cancelled" || event.cancellation) {
            observeDeploymentQualificationNative(opts.scope?.sessionId,
              "cancelled", nativeId, Date.now());
          }
          observeWebviewDelivery(nativeId, "webview-settled-received", deliverySequence, 0);
          observeNativeDiagnostic(signal, "native-settled", nativeId);
          terminal = event;
          if (nativeSettled) settle();
          return;
        }
        if (aborted || (opts.scope && !opts.scope.isCurrent())) {
          cancel(aborted ? "parent-signal" : "scope-superseded");
          return;
        }
        switch (event.kind) {
          case "preflight":
            if (validating) break;
            validating = true;
            void (async () => {
              try {
                if (!revalidate)
                  throw new ContextBudgetError(
                    "context-preflight-missing",
                    "Request preflight is unavailable.",
                  );
                await revalidate();
                if (aborted || (opts.scope && !opts.scope.isCurrent()))
                  throw new InferenceTransportError("cancelled");
                await invoke("ai_http_preflight", {
                  requestId: nativeId,
                  approved: true,
                });
              } catch (error) {
                preflightError = error;
                await invoke("ai_http_preflight", {
                  requestId: nativeId,
                  approved: false,
                }).catch(() => cancel("preflight-failure"));
              }
            })();
            break;
          case "admission":
            attempt?.observe(event.observation);
            opts.onAdmission?.(signal, event.observation);
            observeDeploymentQualificationNative(opts.scope?.sessionId, "admission",
              nativeId, Date.now(), event.observation.admittedAt);
            break;
          case "phase":
            attempt?.update(event.phase, nativeId);
            break;
          case "headers": {
            if (status) return;
            observeWebviewDelivery(nativeId, "webview-headers-received", deliverySequence, 0);
            observeNativeDiagnostic(signal, "native-response-headers", nativeId);
            status = event.status;
            const stream = new ReadableStream<Uint8Array>({
              start(c) {
                controller = c;
              },
              cancel(reason) {
                cancel(reason === "ollama-sdk-stream-error" ? "sdk-stream-error"
                  : reason === "provider-retry-stream-error" ? "provider-retry-error"
                  : reason === "provider-retry-finalizer" ? "provider-retry-finalizer"
                  : "stream-consumer");
                return cancelPromise?.then(() => undefined);
              },
            });
            try {
              const response = new Response([204, 205, 304].includes(status) ? null : stream, {
                  status,
                  headers: event.headers,
                });
              associateNativeResponse(response, nativeId);
              resolve(response);
            } catch {
              cancel("response-construction-failure");
            }
            break;
          }
          case "chunk":
            deliverySequence++;
            observeWebviewDelivery(nativeId, "webview-ipc-received", deliverySequence, event.bytes.length);
            if (!firstChunkObserved && event.bytes.length) {
              firstChunkObserved = true;
              observeDeploymentQualificationNative(opts.scope?.sessionId,
                "frame", nativeId, Date.now());
              observeNativeDiagnostic(signal, "native-first-chunk", nativeId);
            }
            if (status >= 200 && status < 300 && event.bytes.length) opts.scope?.onResponseBody?.();
            controller?.enqueue(Uint8Array.from(event.bytes));
            if (controller)
              observeWebviewDelivery(nativeId, "webview-stream-enqueued", deliverySequence, event.bytes.length);
            break;
        }
      };
      channel.onmessage = event => {
        // Preserve message order while a host-controlled acceptance barrier is
        // held, including terminal after first output. Every queued callback
        // rechecks the original scope and settled fence on delivery.
        const stage = event.kind === "chunk" && event.bytes.length && !firstDeliveryHeld
          ? "first-output" : event.kind === "settled" ? "terminal-delivery" : null;
        if (stage && event.kind === "chunk") firstDeliveryHeld = true;
        if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE !== "1" ||
            !opts.scope?.sessionId) {
          deliver(event);
          return;
        }
        pendingDelivery = pendingDelivery.then(async () => {
          if (finished || aborted || (opts.scope && !opts.scope.isCurrent())) return;
          if (stage) await qualificationAcceptanceBoundary(opts.scope?.sessionId, stage);
          if (finished || aborted || (opts.scope && !opts.scope.isCurrent())) return;
          deliver(event);
          if (stage === "first-output" && !finished && !aborted)
            await qualificationAcceptanceBoundary(opts.scope?.sessionId, "during-streaming");
        }).catch(() => cancel("scope-superseded"));
      };
      const settle = (failure?: unknown) => {
        if (finished) return;
        finished = true;
        releaseRemote?.();
        clearTimeout(deliveryTimer);
        channel.onmessage = () => {};
        const code = aborted
          ? "cancelled"
          : (terminal?.error?.code ??
            (failure || !terminal ? "native-transport" : undefined));
        // Keep non-2xx bodies intact for the SDK's existing provider diagnostics.
        const error =
          preflightError ??
          (code && !(code === "provider-error" && status >= 400)
            ? new InferenceTransportError(code, nativeId, nativeRejection)
            : undefined);
        attempt?.update(terminal?.phase ?? (aborted ? "cancelled" : "failed"));
        attempt?.settle();
        signal?.removeEventListener("abort", onAbort);
        if (error) {
          reject(error);
          try {
            controller?.error(error);
          } catch {
            /* consumer already closed */
          }
        } else if (controller) {
          try {
            controller.close();
            boundary("response-body-closed");
          } catch {
            /* consumer already closed */
          }
        } else
          reject(new InferenceTransportError("native-transport", nativeId));
      };
      // Absolute last JavaScript boundary before the native stream command:
      // a session cancelled while status, body, admission or preflight awaits
      // must never send a late inference. Cancel only our exact native ID.
      const dispatchNative = (acceptanceInvalidAdmission = false) => {
        if (finished || aborted || (opts.scope && !opts.scope.isCurrent())) {
          cancel(aborted ? "parent-signal" : "scope-superseded");
          void (cancelPromise ?? Promise.resolve()).finally(() =>
            settle(new InferenceTransportError("cancelled", nativeId)));
          return;
        }
        observeNativeDiagnostic(signal, "native-ipc-start", nativeId);
        if (nativeId) observeDeploymentQualificationNative(opts.scope?.sessionId,
          "request", nativeId, Date.now());
        void invoke("ai_http_stream", {
        requestId: nativeId,
        url,
        method,
        headers,
        body,
        allowPrivateNetwork: opts.allowPrivateNetwork === true,
        timeoutPolicy: opts.selfHosted ? "self-hosted" : "legacy",
        // Only the isolated feature-only Wry owner may authorize a ONE-SHOT
        // invalid native admission envelope, after a genuine registered
        // inference-N and before the ORIGINAL ai_http_stream handler. That
        // production handler rejects capacity=0 itself. Ordinary builds
        // always pass the original admission unchanged.
        admission: acceptanceInvalidAdmission && (
          import.meta.env.VITE_CLACK_LM11_ACCEPTANCE === "1" ||
          import.meta.env.VITE_CLACK_LM11_ADMISSION_FAULT === "1")
          ? { ...opts.admission, capacity: 0 } : opts.admission,
        requirePreflight: Boolean(revalidate),
        ...(opts.scope?.fallbackToken ? { fallbackToken: opts.scope.fallbackToken } : {}),
        ...(opts.diagnosticRunId ? { diagnosticRunId: opts.diagnosticRunId } : {}),
        ...(opts.diagnosticPermit ? { diagnosticPermit: opts.diagnosticPermit } : {}),
        onEvent: channel,
      }).then(
        () => {
          boundary("native-command-ack");
          nativeSettled = true;
          const settleAfterChannelDelivery = () => {
            if (finished) return;
            if (terminal) settle();
            else deliveryTimer = setTimeout(() => {
              if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE === "1" &&
                  opts.scope?.sessionId) {
                // The native command may ACK before the original Channel
                // callback is queued. Re-evaluate that same queue at the
                // *end* of the ordinary missing-terminal grace as well:
                // the acceptance hold is not a missing native terminal.
                void pendingDelivery.then(() => {
                  if (finished) return;
                  if (terminal) settle();
                  else settle(new Error("Missing terminal event"));
                }, () => cancel("scope-superseded"));
              } else settle(new Error("Missing terminal event"));
            }, 5000);
          };
          if (import.meta.env.VITE_CLACK_LM11_ACCEPTANCE === "1" &&
              opts.scope?.sessionId) {
            // An actual native terminal may already be queued behind a held
            // acceptance-only original Channel event. Its ordinary 5s
            // missing-terminal diagnostic must not mistake *intentional
            // delivery backpressure* for a missing native terminal. Await
            // the existing event queue; the SAME qualification operation's
            // unchanged 120s deadline remains authoritative throughout.
            // Ordinary production builds compile out this acceptance branch.
            void pendingDelivery.then(settleAfterChannelDelivery,
              () => cancel("scope-superseded"));
          } else settleAfterChannelDelivery();
        },
        async (error) => {
          // Invocation failure is not proof of a drained native request.
          // Preserve the *safe, finite* Rust/host cause before asynchronous
          // cancellation drains it; never persist or expose raw invoke errors.
          nativeRejection = inspectNativeInvokeRejection(error);
          if (!cancelPromise)
              cancelPromise = invoke("ai_http_cancel", {
                requestId: nativeId, cancellationOrigin: "native-command-failure",
            }).catch(() => undefined);
          await cancelPromise;
          nativeSettled = true;
          settle(error);
        },
        );
      };
      if ((import.meta.env.VITE_CLACK_LM11_ACCEPTANCE === "1" ||
           import.meta.env.VITE_CLACK_LM11_ADMISSION_FAULT === "1") && opts.scope?.sessionId) {
        const acceptanceSessionId = opts.scope.sessionId;
        void qualificationAcceptanceBoundary(acceptanceSessionId, "predispatch").then(
          async () => {
            // The same captured authority is rechecked in dispatchNative,
            // immediately before ai_http_stream. No late barrier release can
            // grant authority to a stopped or disarmed qualification.
            let invalidAdmission = false;
            if (import.meta.env.VITE_CLACK_LM11_ADMISSION_FAULT === "1") {
              try {
                invalidAdmission = await invoke<boolean>(
                  "lm11_acceptance_original_request_admission_fault", {
                    sessionId: acceptanceSessionId, requestId: nativeId,
                  });
              } catch {
                cancel("scope-superseded");
                void (cancelPromise ?? Promise.resolve()).finally(() =>
                  settle(new InferenceTransportError("cancelled", nativeId)));
                return;
              }
            }
            dispatchNative(invalidAdmission);
          },
          () => {
            cancel("scope-superseded");
            void (cancelPromise ?? Promise.resolve()).finally(() =>
              settle(new InferenceTransportError("cancelled", nativeId)));
          },
        );
      } else dispatchNative();
    });
  } catch (error) {
    releaseRemote?.();
    if (nativeId && !nativeSettled) {
      cancel("fetch-preparation-failure");
      await cancelPromise;
    }
    attempt.settle();
    signal?.removeEventListener("abort", onAbort);
    throw error instanceof RemoteConnectionError || error instanceof InferenceTransportError ||
      error instanceof ContextBudgetError
      ? error
      : new InferenceTransportError("native-transport", nativeId);
  }
}
