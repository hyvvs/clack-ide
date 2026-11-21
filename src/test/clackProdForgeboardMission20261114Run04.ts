/** Campaign 04 only: arm the existing bounded, scalar preparation observer
 * before importing the unchanged production ForgeBoard acceptance entrypoint.
 * This wrapper changes no model, prompt, tool, timeout, or Agent flow. */
import { startPreparationPhaseCapture } from "@/test/preparationPhaseCapture";

const configuration = new URL(location.href).searchParams.get("configuration");
if (!configuration) throw new Error("Exclusive production configuration missing");
const config = await (await fetch(configuration)).json();
if (config.realProduct?.phase !== "mission-a" ||
    config.realProduct?.modelId !== "muse-glimmer:30b")
  throw new Error("Exclusive production mission identity mismatch");

const phaseUrl = new URL("/preparation-phase", config.report);
const finalUrl = new URL("/preparation-final", config.report);
const capture = startPreparationPhaseCapture(async record => {
  const response = await fetch(phaseUrl, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ record }), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Preparation evidence was not durably acknowledged");
});

try {
  // Dynamic import executes only AFTER installation. The original spec stays
  // byte-identical and resolves the same production module instances.
  await import("./clackProdForgeboardMission20261114.tsx");
} finally {
  // Best-effort flush on normal return. Browser termination may preempt this;
  // the host then retains unsealed partial evidence rather than claiming full
  // collection or altering the Agent to keep the WebView alive.
  const receipt = await capture.stop();
  await fetch(finalUrl, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ receipt }), signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}
