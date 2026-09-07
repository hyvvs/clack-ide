import { Channel, invoke } from "@tauri-apps/api/core";
import {
  beginInference,
  type InferencePhase,
  type InferenceScope,
} from "@/modules/ai/lib/inferenceLifecycle";
import { InferenceTransportError } from "@/modules/ai/lib/inferenceErrors";

/** Streaming events emitted by the Rust `ai_http_stream` command. */
type AiStreamEvent = { requestId: string } & (
  | { kind: "headers"; status: number; headers: Record<string, string> }
  | { kind: "chunk"; bytes: number[] }
  | { kind: "phase"; phase: InferencePhase }
  | { kind: "settled"; phase: InferencePhase; error?: { code: string } }
);

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
  allowPrivateNetwork?: boolean;
  selfHosted?: boolean;
  scope?: InferenceScope;
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
  if (signal?.aborted || (opts.scope && !opts.scope.isCurrent()))
    throw new InferenceTransportError("cancelled");
  let nativeId: string | undefined;
  let nativeSettled = false;
  let aborted = false;
  let cancelPromise: Promise<unknown> | undefined;
  let attempt: ReturnType<typeof beginInference> | undefined;
  const cancel = () => {
    aborted = true;
    attempt?.update("stopping");
    if (nativeId && !cancelPromise)
      cancelPromise = invoke("ai_http_cancel", { requestId: nativeId }).catch(
        () => undefined,
      );
  };
  attempt = beginInference(opts.scope, cancel);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    const url =
      request?.url ?? (input instanceof URL ? input.toString() : String(input));
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = headerInitToRecord(init?.headers ?? request?.headers);
    const body = await bodyToBytes(
      init?.body ?? (request ? await request.arrayBuffer() : undefined),
    );
    if (aborted) throw new InferenceTransportError("cancelled");
    nativeId = await invoke<string>("ai_http_open");
    if (!nativeId) throw new InferenceTransportError("native-transport");
    attempt.update(aborted ? "stopping" : "connecting", nativeId);
    if (aborted || (opts.scope && !opts.scope.isCurrent())) {
      cancel();
      await cancelPromise;
      throw new InferenceTransportError("cancelled", nativeId);
    }
    return await new Promise<Response>((resolve, reject) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let terminal: Extract<AiStreamEvent, { kind: "settled" }> | undefined;
      let status = 0;
      let finished = false;
      let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
      const channel = new Channel<AiStreamEvent>();
      channel.onmessage = (event) => {
        if (finished || terminal || event.requestId !== nativeId) return;
        if (event.kind === "settled") {
          terminal = event;
          if (nativeSettled) settle();
          return;
        }
        if (aborted || (opts.scope && !opts.scope.isCurrent())) {
          cancel();
          return;
        }
        switch (event.kind) {
          case "phase":
            attempt?.update(event.phase, nativeId);
            break;
          case "headers": {
            if (status) return;
            status = event.status;
            const stream = new ReadableStream<Uint8Array>({
              start(c) {
                controller = c;
              },
              cancel() {
                cancel();
                return cancelPromise?.then(() => undefined);
              },
            });
            try {
              resolve(
                new Response([204, 205, 304].includes(status) ? null : stream, {
                  status,
                  headers: event.headers,
                }),
              );
            } catch {
              cancel();
            }
            break;
          }
          case "chunk":
            controller?.enqueue(Uint8Array.from(event.bytes));
            break;
        }
      };
      const settle = (failure?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(deliveryTimer);
        channel.onmessage = () => {};
        const code = aborted
          ? "cancelled"
          : (terminal?.error?.code ??
            (failure || !terminal ? "native-transport" : undefined));
        // Keep non-2xx bodies intact for the SDK's existing provider diagnostics.
        const error =
          code && !(code === "provider-error" && status >= 400)
            ? new InferenceTransportError(code, nativeId)
            : undefined;
        attempt?.update(terminal?.phase ?? (aborted ? "cancelled" : "failed"));
        attempt?.settle();
        signal?.removeEventListener("abort", cancel);
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
          } catch {
            /* consumer already closed */
          }
        } else
          reject(new InferenceTransportError("native-transport", nativeId));
      };
      void invoke("ai_http_stream", {
        requestId: nativeId,
        url,
        method,
        headers,
        body,
        allowPrivateNetwork: opts.allowPrivateNetwork === true,
        timeoutPolicy: opts.selfHosted ? "self-hosted" : "legacy",
        onEvent: channel,
      }).then(
        () => {
          nativeSettled = true;
          if (terminal) settle();
          else
            deliveryTimer = setTimeout(
              () => settle(new Error("Missing terminal event")),
              5000,
            );
        },
        async (error) => {
          // Invocation failure is not proof of a drained native request.
          if (!cancelPromise)
            cancelPromise = invoke("ai_http_cancel", {
              requestId: nativeId,
            }).catch(() => undefined);
          await cancelPromise;
          nativeSettled = true;
          settle(error);
        },
      );
    });
  } catch (error) {
    if (nativeId && !nativeSettled) {
      cancel();
      await cancelPromise;
    }
    attempt.settle();
    signal?.removeEventListener("abort", cancel);
    throw error instanceof InferenceTransportError
      ? error
      : new InferenceTransportError("native-transport", nativeId);
  }
}
