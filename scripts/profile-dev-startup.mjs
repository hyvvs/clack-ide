import { Session } from "node:inspector";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";

// Point PLAYWRIGHT_MODULE at an installed Playwright package, without adding a
// production dependency. This measures frontend loading, not native Tauri IPC.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const session = new Session();
session.connect();
const post = (method) => new Promise((resolve, reject) => {
  session.post(method, (error, result) => error ? reject(error) : resolve(result));
});
await post("Profiler.enable");
await post("Profiler.start");
let server;
let browser;
// Keep dependencies under node_modules so Babel's normal exclusion still applies.
const cacheDir = await mkdtemp(join(process.cwd(), "node_modules", ".clack-profile-"));
const started = performance.now();
try {
  server = await createServer({
    cacheDir,
    server: { port: 1422, strictPort: true, host: "127.0.0.1" },
    clearScreen: false,
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const startedPage = performance.now();
  let requests = 0;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", () => requests++);
  await page.goto("http://127.0.0.1:1422", { waitUntil: "networkidle", timeout: 240_000 });
  const unexpected = errors.filter(message => !/^Cannot read properties of undefined \(reading '(metadata|invoke|transformCallback)'\)/.test(message));
  if (unexpected.length) throw new Error(unexpected.join("\n"));
  console.log(JSON.stringify({
    pageLoadMs: Math.round(performance.now() - startedPage),
    elapsedMs: Math.round(performance.now() - started),
    requests,
    dependencyCache: "cold (isolated)",
    expectedMissingNativeIpcErrors: errors.length,
  }));
} finally {
  const { profile } = await post("Profiler.stop");
  session.disconnect();
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const totals = new Map();
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const frame = nodes.get(profile.samples[i]).callFrame;
    const key = `${frame.functionName} ${frame.url}:${frame.lineNumber + 1}`;
    totals.set(key, (totals.get(key) ?? 0) + profile.timeDeltas[i]);
  }
  console.log("CPU profile, highest self-time (ms):");
  console.log([...totals].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([frame, time]) => `${Math.round(time / 1000)} ${frame}`).join("\n"));
  await browser?.close();
  await server?.close();
  await rm(cacheDir, { recursive: true, force: true });
}
