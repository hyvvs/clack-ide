import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = [
  "check-product-ux.mjs",
  "check-chat-controls.mjs",
  "check-first-use-ai-workflows.mjs",
  "check-collaboration-ux.mjs",
  "check-peer-communication.mjs",
  "check-self-hosted-setup.mjs",
  "check-custom-tool-execution.mjs",
  "check-model-switch.mjs",
  "check-inference-fallback.mjs",
  "check-calibration.mjs",
  "check-watchdog-controls.mjs",
];
const requested = process.argv.slice(2);
if (requested.some((name) => !fixtures.includes(name))) throw new Error("Unknown acceptance browser fixture");
const selected = requested.length ? fixtures.filter((name) => requested.includes(name)) : fixtures;
for (const fixture of selected) {
  console.log(`Acceptance browser fixture: ${fixture}`);
  const result = spawnSync(process.execPath, [`scripts/${fixture}`], {
    cwd: root, env: process.env, stdio: "inherit", timeout: 300000, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? `${fixture} failed (${result.status})`);
    process.exit(result.status || 1);
  }
}
console.log(`PASS: ${selected.length} bounded headless browser fixture scripts. Native GUI and live-provider evidence not implied.`);
