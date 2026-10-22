/** Real native Tauri WebView fetch-only smoke. Absolutely no AI imports or calls. */
import { invoke } from "@tauri-apps/api/core";

const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Isolated receipt URL missing");
const required = (value: boolean, description: string) => {
  if (!value) throw new Error(description);
};
try {
  required("__TAURI_INTERNALS__" in window, "Not a Tauri WebView");
  const metadata = (await (await fetch(configuration)).json()) as {
    events: string;
    report: string;
    syntheticOnly: boolean;
  };
  required(metadata.syntheticOnly === true, "Synthetic-only collector missing");
  required(
    new URL(metadata.events).origin !== location.origin,
    "No cross-origin test",
  );
  const post = async (url: string, body: Record<string, unknown>) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  const events = [
    { kind: "request-started", ordinal: 1 },
    { kind: "frontend-native-event", ordinal: 1, phase: "headers", bytes: 0 },
    { kind: "request-failed", ordinal: 1 },
  ];
  for (const event of events) {
    const response = await post(metadata.events, event);
    required(
      response.ok && (await response.json()).ok === true,
      "Browser event was not acknowledged",
    );
  }
  const invalidEvent = await post(metadata.events, {
    kind: "request-started",
    ordinal: 1,
    prompt: "PRIVATE_MARKER",
  });
  required(invalidEvent.status === 400, "Sensitive event not rejected");
  const invalidReport = await post(metadata.report, {
    kind: "r5e-browser-smoke",
    browser: true,
    prompt: "PRIVATE_MARKER",
  });
  required(invalidReport.status === 400, "Sensitive report not rejected");
  const report = await post(metadata.report, {
    kind: "r5e-browser-smoke",
    browser: true,
    eventAcks: events.length,
    sensitiveEventRejected: true,
    sensitiveReportRejected: true,
  });
  required(
    report.ok && (await report.json()).ok === true,
    "Browser final report was not acknowledged",
  );
} catch (error) {
  // This text is diagnostic-only in the disposable WebView, never transmitted.
  document.body.textContent =
    error instanceof Error ? error.name : "UnknownError";
} finally {
  await invoke("coworking_exit");
}
