/** Synthetic diagnostic only: real Tauri fetch, no Ollama, SDK or AI imports. */
import { invoke } from "@tauri-apps/api/core";
import { classifyR5hFailure } from "../../scripts/r5h-failure-classify.mjs";

const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Missing safe receipt configuration");
try {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Not a native Tauri WebView");
  const metadata = await (await fetch(configuration)).json() as { report: string, syntheticOnly: boolean };
  if (!metadata.syntheticOnly || new URL(metadata.report).origin === location.origin)
    throw new Error("Not a cross-origin synthetic collector");
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
  const response = await fetch(metadata.report, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(report), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || (await response.json()).ok !== true) throw new Error("Final acknowledgment failed");
} finally {
  await invoke("coworking_exit");
}
