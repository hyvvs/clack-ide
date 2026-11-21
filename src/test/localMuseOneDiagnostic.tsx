/** One run-bound, explicitly operated production streaming diagnostic.
 * Import/host launch registers observers and handshakes only. The SDK is never
 * invoked unless an operator calls dispatchOnce after coordinator authorization.
 */
import { invoke } from "@tauri-apps/api/core";
import { createOllamaModel, ollamaBody } from "@/modules/ai/lib/ollamaModel";
import { verifiedProviderFetch } from "@/modules/ai/lib/answerContinuation";
import { createProxyFetch } from "@/modules/ai/lib/proxyFetch";
import { installLocalDeliveryCapture, ONE_MUSE_CLACK_CAPTURE_LIMIT, type DeliveryRow } from "@/modules/ai/lib/localDeliveryObserver";

const RUN_ID = /^[a-z0-9][a-z0-9-]{7,79}$/;
const MODEL = "muse-glimmer:30b";
const ENDPOINT = "http://127.0.0.1:11435";
const PROMPT = "For one local streaming transport diagnostic, write an extended technical exposition on HTTP streaming delivery boundaries, monotonic byte timing, TCP flow control, and NDJSON framing. Write at least eighty substantive numbered sections, each with several detailed sentences and a concrete hypothetical measurement example. Discuss only generic local networking and diagnostics; do not design, implement, or discuss ForgeBoard or a notes application. Produce the full sections continuously without concluding early.";
type Source = "native" | "semantic" | "webview";
const sources: Readonly<Record<Source, string>> = Object.freeze({
  native: "reqwest-native-hook",
  semantic: "native-progress-hook",
  webview: "webview-stream-hook",
});
type RunState = { runId: string };
type BrokerRow = {
  runId: string;
  source: Source;
  identity: string;
  activeRegistration?: true;
  receiptAck?: true;
  complete?: boolean;
  loss?: number;
  pending?: number;
  nativeDispatches?: number;
  nativeTerminals?: number;
  webviewSettled?: number;
};
type Capture = Awaited<ReturnType<typeof installLocalDeliveryCapture>>;
type Ready = { runId: string; capture: Capture };
export type OneMuseResult = Readonly<{
  runId: string;
  outcome: "completed" | "stream-failed" | "admission-denied";
  sdkParts: Readonly<Record<string, number>>;
  nativeDispatches: number;
  nativeTerminals: number;
  webviewSettled: number;
  semanticProgress: number;
  deliveryComplete: boolean;
}>;

/** Consumes the local allowance synchronously, including on a failed attempt. */
export function oneMuseOnce<T>(action: () => Promise<T>): () => Promise<T> {
  let spent = false;
  return () => {
    if (spent) return Promise.reject(new Error("One-Muse dispatch already consumed"));
    spent = true;
    return action();
  };
}

export function createOneMuseBrowserDiagnostic() {
  let captured: Capture | undefined;
  let state: RunState | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatWrites: Promise<void> = Promise.resolve();
  let observerFailed = false;
  let nativeDispatches = 0, nativeTerminals = 0, webviewSettled = 0, semanticProgress = 0;
  let nativeRequestId: string | undefined;
  let started = false, stopped = false;
  const abort = new AbortController();

  const broker = (action: "ready" | "heartbeat" | "terminal", payload: BrokerRow) =>
    invoke<void>("local_muse_one_broker", { action, payload });
  const sourceReceipt = (runId: string, source: Source, kind: "source-ready" | "source-terminal",
    success: boolean) => invoke<void>("local_muse_one_source_receipt", {
      payload: { runId, source, identity: sources[source], kind, success },
    });
  const account = (row: DeliveryRow) => {
    if (row.boundary === "native-dispatch") {
      nativeDispatches++;
      if (nativeRequestId && nativeRequestId !== row.requestId) observerFailed = true;
      nativeRequestId ??= row.requestId;
    }
    if (row.boundary === "native-terminal") nativeTerminals++;
    if (row.boundary === "native-semantic-progress") semanticProgress++;
    if (row.boundary === "webview-settled-received") webviewSettled++;
  };
  const persist = async (row: DeliveryRow) => {
    // Each ACK means the separate loopback journal fsynced the exact numeric row.
    await invoke<void>("local_muse_one_observe", { row });
    account(row);
  };
  const report = async (runId: string, source: Source, complete: boolean, loss: number, pending: number) => {
    await sourceReceipt(runId, source, "source-terminal", complete);
    await broker("terminal", {
      runId, source, identity: sources[source], complete, loss, pending,
      ...(source === "native" ? { nativeDispatches, nativeTerminals } : {}),
      ...(source === "webview" ? { webviewSettled } : {}),
    });
  };
  const stopHeartbeat = async () => {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
    await heartbeatWrites.catch(() => { observerFailed = true; });
  };

  // Only observation setup runs on import. No model object or SDK request is made.
  const ready: Promise<Ready> = (async () => {
    const response = await invoke<RunState>("local_muse_one_config");
    if (!response || !RUN_ID.test(response.runId))
      throw new Error("Bound diagnostic identity is unavailable");
    state = { runId: response.runId };
    captured = await installLocalDeliveryCapture(persist, ONE_MUSE_CLACK_CAPTURE_LIMIT, state.runId);
    if (captured.readiness?.runId !== state.runId || !captured.readiness.nativeReady ||
        !captured.readiness.webviewReady) throw new Error("Delivery observer handshake failed");
    for (const source of ["native", "semantic", "webview"] as const) {
      await sourceReceipt(state.runId, source, "source-ready", true);
      await broker("ready", { runId: state.runId, source, identity: sources[source],
        activeRegistration: true, receiptAck: true, loss: 0, pending: 0 });
    }
    heartbeat = setInterval(() => {
      if (stopped) return;
      heartbeatWrites = heartbeatWrites.then(async () => {
        await Promise.all((["native", "semantic", "webview"] as const).map(source =>
          broker("heartbeat", { runId: state!.runId, source, identity: sources[source] })));
      }).catch(() => { observerFailed = true; });
    }, 1500);
    return { runId: state.runId, capture: captured };
  })();
  // Preserve the real rejection for explicit callers without an unhandled
  // top-level Promise warning when the hidden host only installs observers.
  void ready.catch(() => { observerFailed = true; });

  const dispatchOnce = oneMuseOnce(async (): Promise<OneMuseResult> => {
    let target: Ready;
    try { target = await ready; }
    catch { throw new Error("One-Muse observers were not armed"); }
    if (observerFailed || stopped) throw new Error("One-Muse observation failed");
    const runId = target.runId;
    const intent = {
      model: MODEL, stream: true, context: 32768, output: 8192,
      tools: 0, think: "omitted", requestClass: "diagnostic",
      retry: false, continuation: false, fallback: false,
    };
    let permit: string;
    try {
      permit = await invoke<string>("local_muse_one_claim", { runId, intent });
      if (!/^[a-f0-9]{64}$/.test(permit)) throw new Error("Invalid one-use permit");
    }
    catch { throw new Error("One-Muse coordinator has not authorized dispatch"); }

    started = true;
    let finish = false, ended = false;
    let outcome: OneMuseResult["outcome"] = "stream-failed";
    const sdkParts: Record<string, number> = {};
    const params = {
      prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: PROMPT }] }],
      maxOutputTokens: 8192,
      providerOptions: { ollama: { numCtx: 32768 } },
      abortSignal: abort.signal,
    };
    const body = ollamaBody(MODEL, params, true);
    if (body.model !== MODEL || body.stream !== true || body.tools !== undefined ||
        body.think !== undefined || body.options.num_ctx !== 32768 ||
        body.options.num_predict !== 8192 || body.messages.length !== 1)
      throw new Error("Production diagnostic serializer changed");
    const model = createOllamaModel({ modelId: MODEL, baseURL: ENDPOINT,
      fetch: verifiedProviderFetch(createProxyFetch({
        diagnosticRunId: runId, diagnosticPermit: permit,
        selfHosted: true, allowPrivateNetwork: true,
        admission: { endpointId: "real-qwen", profileId: "muse-one-diagnostic", capacity: 1 },
      })) });
    // Teardown is a safety ceiling; production's 180s idle/600s overall remain intact.
    const bound = setTimeout(() => abort.abort(), 630_000);
    try {
      const response = await model.doStream(params);
      const reader = response.stream.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) { ended = true; break; }
          const kind = next.value.type;
          sdkParts[kind] = (sdkParts[kind] ?? 0) + 1;
          if (kind === "finish") finish = true;
          if (kind === "error") throw next.value.error;
        }
      } finally { reader.releaseLock(); }
      outcome = finish && ended ? "completed" : "stream-failed";
    } catch {
      outcome = nativeDispatches === 0 ? "admission-denied" : "stream-failed";
    } finally {
      clearTimeout(bound);
      stopped = true;
      await stopHeartbeat();
      const summary = await target.capture.stop();
      let nativeCapture: { loss: number; pending: number; dispatches: number; terminals: number } =
        { loss: 1, pending: 1, dispatches: 0, terminals: 0 };
      try {
        nativeCapture = await invoke<typeof nativeCapture>(
          "local_muse_one_native_collector_status", { runId },
        );
        if (![nativeCapture.loss, nativeCapture.pending, nativeCapture.dispatches,
          nativeCapture.terminals].every(value =>
          Number.isSafeInteger(value) && value >= 0)) throw new Error("Invalid native collector count");
      } catch { observerFailed = true; }
      if (nativeCapture.dispatches !== nativeDispatches ||
          nativeCapture.terminals !== nativeTerminals) observerFailed = true;
      const loss = Math.max(summary.overflow, nativeCapture.loss);
      const pending = Math.max(0, summary.emitted - summary.acknowledged) + nativeCapture.pending;
      const deliveryComplete = summary.collectorCoverage === "collector-flushed" &&
        !observerFailed && loss === 0 && pending === 0 && summary.deliveryFailed === false;
      if (nativeRequestId && nativeDispatches === 1) {
        const settled = abort.signal.aborted ? "cancelled" : outcome === "completed" ? "completed" : "failed";
        try {
          await invoke<void>("local_muse_one_request_settled", {
            runId, outcome: settled, requestId: nativeRequestId,
          });
        } catch { observerFailed = true; }
      } else observerFailed = true;
      for (const source of ["native", "semantic", "webview"] as const) {
        const complete = outcome === "completed" && deliveryComplete &&
          (source === "native" ? nativeDispatches === 1 && nativeTerminals === 1 :
            source === "semantic" ? semanticProgress > 0 : webviewSettled === 1);
        try { await report(runId, source, complete, loss, pending); }
        catch { observerFailed = true; }
      }
    }
    return Object.freeze({ runId, outcome, sdkParts: Object.freeze(sdkParts), nativeDispatches,
      nativeTerminals, webviewSettled, semanticProgress,
      deliveryComplete: !observerFailed && nativeDispatches === 1 && nativeTerminals === 1 &&
        webviewSettled === 1 });
  });
  const stop = async () => {
    stopped = true;
    abort.abort();
    await stopHeartbeat();
    if (!started && captured) await captured.stop();
  };
  const operatorReady = async (): Promise<boolean> => {
    const armed = await ready;
    if (observerFailed || stopped || started) return false;
    return invoke<boolean>("local_muse_one_operator_ready", { runId: armed.runId });
  };
  return Object.freeze({ ready, operatorReady, dispatchOnce, stop });
}

declare global {
  interface Window {
    __clackOneMuseDiagnostic?: ReturnType<typeof createOneMuseBrowserDiagnostic>;
  }
}

// The isolated WebView installs observers only. The visible, keyboard-operable
// control remains disabled until the coordinator durably authorizes manual
// dispatch; the model never starts merely because the window is open.
if (typeof window !== "undefined" && import.meta.env && !window.__clackOneMuseDiagnostic) {
  const diagnostic = createOneMuseBrowserDiagnostic();
  window.__clackOneMuseDiagnostic = diagnostic;
  const button = document.getElementById("dispatch-one-muse") as HTMLButtonElement | null;
  const status = document.getElementById("diagnostic-status");
  if (button && status) {
    button.disabled = true;
    let clicked = false, checking = false;
    const check = async () => {
      if (clicked || checking) return;
      checking = true;
      try {
        const allowed = await diagnostic.operatorReady();
        button.disabled = !allowed;
        status.textContent = allowed
          ? "The coordinator has durably armed this run. One manual dispatch is available."
          : "Waiting for the coordinator's nine run-bound collector acknowledgments. No inference started.";
      } catch {
        button.disabled = true;
        status.textContent = "Diagnostic readiness unavailable. No inference permitted.";
      } finally { checking = false; }
    };
    const polling = setInterval(() => { void check(); }, 1500);
    button.addEventListener("click", () => {
      if (button.disabled || clicked) return;
      clicked = true;
      button.disabled = true;
      clearInterval(polling);
      status.textContent = "One request admitted for dispatch; awaiting original native stream.";
      void diagnostic.dispatchOnce().then(result => {
        status.textContent = `Request ${result.outcome}. Native dispatches ${result.nativeDispatches}; native terminals ${result.nativeTerminals}; WebView settlements ${result.webviewSettled}.`;
      }).catch(() => {
        status.textContent = "One request blocked or failed. The dispatch allowance cannot be replayed.";
      });
    });
    void diagnostic.ready.then(() => check()).catch(() => {
      clearInterval(polling);
      status.textContent = "Observer registration failed. No inference permitted.";
    });
  }
}
