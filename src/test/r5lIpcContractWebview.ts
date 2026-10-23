/** R5l acceptance-only IPC contract check in the EXISTING native Tauri host.
 * No SDK, calibration, Agent tools, model inference, profile writes, or trust claims.
 */
import { invoke } from "@tauri-apps/api/core";
import { classifyR5hFailure } from "../../scripts/r5h-failure-classify.mjs";

const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Exclusive IPC configuration missing");
const config = await (await fetch(configuration)).json() as {
  report: string; realProduct: { phase: string, modelId: string };
};
if (config.realProduct?.phase !== "ipc-contract" ||
    config.realProduct.modelId !== "nemotron-3.5-lightning:30b-a3b-q4_K_M" ||
    !("__TAURI_INTERNALS__" in window)) throw new Error("Native IPC gate identity mismatch");

const endpointId = "real-qwen";
const owner = "r5l-gate-one";
let acquired = false;
try {
  const leaseEpoch = await invoke<string>("self_hosted_context_lease", {
    endpointId, owner, release: false,
  });
  acquired = true;
  const runtime = await invoke<{
    epoch: string; version: string; configurationRevision: number; at: number;
  }>("self_hosted_context_runtime", { endpointId, allowPrivateNetwork: true });
  const flags = {
    leaseAndRuntimeEpochMatch: typeof leaseEpoch === "string" && leaseEpoch.length > 0 &&
      runtime.epoch === leaseEpoch && Number.isSafeInteger(runtime.at) &&
      Math.abs(Date.now() - runtime.at) < 30_000,
    runtimeVersionMatches: runtime.version === "0.40.5",
    revisionMatches: runtime.configurationRevision === 1,
    leaseReleased: false,
  };
  await invoke("self_hosted_context_lease", { endpointId, owner, release: true });
  acquired = false;
  flags.leaseReleased = true;
  if (!Object.values(flags).every(x => x === true))
    throw Object.assign(new Error("Native context IPC contract mismatch"), { code: "runtime-unavailable" });
  const response = await fetch(new URL("/evidence", config.report), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "r5l-ipc-contract", at: Date.now(), details: flags }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || (await response.json()).ok !== true)
    throw Object.assign(new Error("IPC evidence was not durably acknowledged"), { code: "unclassified" });
} catch (error) {
  // A legitimate negative must be visible through the already-qualified strict collector.
  await fetch(config.report, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: false, kind: "r5h-acceptance", missionStarted: false,
      calibrationRequests: 0, missionRequests: 0,
      ...classifyR5hFailure(error, "harness", "profile-verified", false) }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
} finally {
  if (acquired)
    await invoke("self_hosted_context_lease", { endpointId, owner, release: true }).catch(() => {});
  await invoke("coworking_exit");
}
