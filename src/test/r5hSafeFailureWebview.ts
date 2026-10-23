/** Synthetic diagnostic only: real Tauri fetch, no Ollama, SDK or AI imports. */
import { invoke } from "@tauri-apps/api/core";
import { classifyR5hFailure } from "../../scripts/r5h-failure-classify.mjs";

const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Missing safe receipt configuration");
try {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Not a native Tauri WebView");
  const metadata = await (await fetch(configuration)).json() as { report: string, events: string, syntheticOnly: boolean };
  if (!metadata.syntheticOnly || new URL(metadata.report).origin === location.origin ||
    new URL(metadata.events).origin === location.origin)
    throw new Error("Not a cross-origin synthetic collector");
  const post = async (url: string, body: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || (await response.json()).ok !== true) throw new Error("Durable receipt acknowledgment failed");
  };
  await post(metadata.events, { kind: "calibration-start", ordinal: 1 });
  let failure: unknown;
  try {
    throw Object.assign(new Error("PRIVATE_PROMPT SECRET_URL credentials"), { code: "settings-unavailable" });
  } catch (error) { failure = error; }
  const report = {
    kind: "r5h-synthetic-failure", ok: false, missionStarted: false,
    calibrationRequests: 0, missionRequests: 0,
    ...classifyR5hFailure(failure, "calibration-invocation", "calibration-start-ack", false),
    unsafe: "PRIVATE_PROMPT SECRET_URL credentials",
  };
  await post(metadata.events, { kind: "calibration-failed", ordinal: 2 });
  await post(metadata.report, report);
} finally {
  await invoke("coworking_exit");
}
