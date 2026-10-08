// Isolated browser UI fixture; no real settings, credentials or servers are used.
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.SELF_HOSTED_SCREENSHOTS;
if (output) await mkdir(output, { recursive: true });
const mocks = new Map([
  ["discovery-ipc", `
    export async function invoke(command, args) {
      window.discoveryCalls.push({command, args});
      if (command === "ai_http_open") return "discovery-" + (++window.discoverySequence);
      if (command === "ai_http_cancel") return;
      if (command !== "self_hosted_discover") throw new Error("Unexpected fixture IPC");
      const result = structuredClone(window.discoveryResult);
      await new Promise(resolve => setTimeout(resolve, window.discoveryDelay));
      return result;
    }
  `],
  ["src/modules/settings/preferences", `
    import { create } from "zustand";
    export const usePreferencesStore = create(() => ({ selfHostedInference: { version:1, revision:0, endpoints:[], profiles:[] }, customEndpoints:[], savedProviderModels:[], favoriteModelIds:[], recentModelIds:[] }));
    window.prefs = usePreferencesStore;
  `],
  ["src/modules/settings/store", `
    export async function updateSelfHostedProfiles(change) {
      const next = change(window.prefs.getState().selfHostedInference);
      next.revision++;
      window.prefs.setState({ selfHostedInference: next });
      return next;
    }
    export async function emitKeysChanged() {}
    export async function setFavoriteModelIds(ids) { window.prefs.setState({ favoriteModelIds: ids }); }
    export async function setRecentModelIds(ids) { window.prefs.setState({ recentModelIds: ids }); }
    export async function loadPreferences() { return window.prefs.getState(); }
  `],
  ["src/modules/ai/lib/keyring", `
    export async function setCustomEndpointKey(id, key) { window.keys[id] = key; }
  `],
  ["src/modules/ai/store/chatStore", `
    import { create } from "zustand";
    export const useChatStore = create(() => ({ activeSessionId:null, selectedModelId:"gpt-5.4-mini", apiKeys:{ openai:"API_KEY_DISCOVERY_CANARY", openrouter:"test" }, sessions:[] }));
    export function hasKeyForModel() { return true; }
    window.chatStore = useChatStore;
  `],
  ["src/modules/ai/lib/composer", `export const ACCEPTED_FILES = ""; export const useComposer = () => ({});`],
  ["src/modules/ai/hooks/useModelSelectionLock", `export function useModelSelectionLock() { return false; }`],
  ["src/modules/ai/store/reasoningEffort", `export function sessionEffort() { throw new Error("No active conversation in setup fixture"); } export async function setSessionEffort() { throw new Error("No active conversation in setup fixture"); }`],
  ["src/modules/ai/hooks/useModelSwitch", `
    export function useModelSwitch() { return { reset: () => {}, request: async id => { window.chatStore.setState({ selectedModelId:id }); return true; }, confirm: () => true, checking:false, review:null, failure:null }; }
  `],
  ["src/modules/ai/lib/selfHostedProbe", `
    export function normalizeProbeError(e) { return { message: e.code === "authentication-failed" ? "Authentication failed" : "Server unreachable", title: "Metadata", kind:"network" }; }
    export function probeEvidenceIsFresh(e, endpoint, snapshot) { return !!snapshot?.connected && !snapshot.stale && e.scope.configurationRevision === endpoint.configurationRevision; }
    export function createSelfHostedProbeClient() { return {
      read: async options => window.cache[options.endpointId] ?? null,
      refresh: async options => {
        window.probes.push(options);
        await new Promise(resolve => setTimeout(resolve, window.delay));
        const old = window.cache[options.endpointId];
        const server = window.prefs.getState().selfHostedInference.endpoints.find(e => e.id === options.endpointId);
        const snapshot = { endpointId:server.id, configurationRevision:server.configurationRevision, selectedModelId:options.selectedModelId ?? null, observedAt:Date.now(), connected:!window.fail, reachable:true, stale:!!window.fail, refreshing:false, credentialUsed:!!window.keys[server.id], inventoryTtlMs:300000, instanceTtlMs:30000,
          models:window.fail ? old?.models ?? [] : Array.from({ length:1500 }, (_, i) => ({ id:"author/model-"+i, name:"Model "+i, chat:"supported", evidence:[] })),
          errors:window.fail ? [{ route:null, error:{ code:window.fail } }] : [] };
        window.cache[server.id] = snapshot;
        return snapshot;
      }, cancel: async () => {},
    }; }
  `],
]);
const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { SelfHostedServers } from "/src/settings/components/SelfHostedServers.tsx";
  import { ModelDropdown } from "/src/modules/ai/components/AiStatusBarControls.tsx";
  import "/src/styles/globals.css";
  window.keys = {}; window.cache = {}; window.probes = []; window.delay = 5; window.fail = null;
  window.discoveryCalls = []; window.discoverySequence = 0; window.discoveryDelay = 5;
  window.discoveryResult = {candidates:[], issues:[], timedOut:false};
  const root = createRoot(document.getElementById("root"));
  root.render(React.createElement("main", {style:{maxWidth:700,padding:16,margin:"auto"}}, React.createElement(SelfHostedServers), React.createElement("div", {style:{display:"flex",justifyContent:"end",marginTop:20}}, React.createElement(ModelDropdown))));
`;
const server = await createServer({
  root, configFile: false, logLevel: "warn", optimizeDeps: { entries: [], noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime", "zustand", "zod", "@hugeicons/react", "@hugeicons/core-free-icons", "class-variance-authority", "radix-ui", "clsx", "tailwind-merge"] },
  resolve: { alias: { "@": path.join(root, "src") } },
  plugins: [{ name: "isolated-self-hosted-fixture", enforce: "pre",
    resolveId(source, importer) {
      if (source === "@tauri-apps/api/core") return "\0mock:discovery-ipc";
      if (source === "/self-hosted-entry.jsx") return "\0self-hosted-entry.jsx";
      const absolute = source.startsWith(".") && importer ? path.resolve(path.dirname(importer), source) : source;
      const relative = path.relative(root, absolute).replaceAll("\\", "/").replace(/\.[jt]sx?$/, "");
      return mocks.has(relative) ? `\0mock:${relative}` : null;
    },
    load(id) { if (id === "\0self-hosted-entry.jsx") return entry; if (id.startsWith("\0mock:")) return mocks.get(id.slice(6)); },
    configureServer(vite) { vite.middlewares.use("/self-hosted-fixture", async (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(await vite.transformIndexHtml("/self-hosted-fixture", `<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><div id="root"></div><script type="module" src="/self-hosted-entry.jsx"></script></body></html>`));
    }); },
  }, react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error); });
  await page.goto(`${server.resolvedUrls.local[0]}self-hosted-fixture`, { waitUntil: "networkidle", timeout: 120000 });
  assert.equal(await page.evaluate(() => window.discoveryCalls.length), 0, "Opening settings must be idle");
  await page.getByRole("button", { name: "Add self-hosted server", exact: true }).click();
  assert.equal(await page.evaluate(() => window.discoveryCalls.length), 0, "Opening Add Server must be idle");
  const discovery = page.locator(".server-discovery");
  await discovery.locator("summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => window.discoveryCalls.length), 0, "Opening discovery details must be idle");
  await page.getByLabel("Candidate addresses").fill("http://localhost:11434");
  await page.getByLabel("Credential (optional)", {exact:true}).fill("DISCOVERY_SECRET_CANARY");
  await page.getByLabel("Allow localhost/private addresses for this discovery only").check();
  await page.getByLabel("Allow localhost and private-network access for this server", {exact:true}).check();
  await page.evaluate(() => { window.discoveryResult = {candidates:[{baseURL:"http://localhost:11434/v1", backendHint:"ollama", source:"user-address/ollama-inventory"}], issues:[], timedOut:false}; });
  await page.getByRole("button", {name:"Discover servers", exact:true}).focus();
  await page.keyboard.press("Enter");
  await discovery.getByText("1 untrusted candidates found.", {exact:true}).waitFor();
  assert.equal(await page.evaluate(() => window.prefs.getState().selfHostedInference.endpoints.length), 0);
  assert.equal(await page.evaluate(() => window.probes.length), 0);
  assert.equal(await page.evaluate(() => JSON.stringify(window.discoveryCalls).includes("DISCOVERY_SECRET_CANARY")), false);
  assert.equal(await page.evaluate(() => JSON.stringify(window.discoveryCalls).includes("API_KEY_DISCOVERY_CANARY")), false);
  assert.deepEqual(await page.evaluate(() => window.discoveryCalls.find(c => c.command === "self_hosted_discover").args.options), {addresses:["http://localhost:11434"], allowPrivateNetwork:true});
  await discovery.getByRole("button", {name:"Use address", exact:true}).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByLabel("Address", {exact:true}).inputValue(), "http://localhost:11434/v1");
  assert.equal(await page.getByLabel("Server type").inputValue(), "ollama");
  assert.equal(await page.getByLabel("Credential (optional)", {exact:true}).inputValue(), "");
  assert.equal(await page.getByLabel("Allow localhost and private-network access for this server", {exact:true}).isChecked(), false, "Discovery opt-in must not become endpoint trust");
  await page.waitForFunction(() => document.activeElement?.id?.endsWith("-address"));
  assert.equal(await page.evaluate(() => window.prefs.getState().selfHostedInference.endpoints.length), 0);
  await page.evaluate(() => { window.discoveryDelay = 250; window.discoveryResult.candidates[0].baseURL = "http://stale.invalid/v1"; });
  await discovery.getByRole("button", {name:"Discover servers", exact:true}).click();
  await page.waitForFunction(() => window.discoveryCalls.filter(c => c.command === "self_hosted_discover").length === 2);
  await discovery.getByRole("button", {name:"Cancel discovery", exact:true}).click();
  await page.evaluate(() => { window.discoveryDelay = 5; window.discoveryResult = {candidates:[], issues:[], timedOut:false}; });
  await discovery.getByRole("button", {name:"Discover servers", exact:true}).click();
  await discovery.getByText("No discoverable servers found. You can still add one manually.", {exact:true}).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await discovery.locator("li").count(), 0, "Stale result cannot replace a newer run");
  await page.evaluate(() => {
    window.discoveryResult = {candidates:Array.from({length:8}, (_, i) => ({baseURL:"https://example.test/" + "long-proxy-path/".repeat(40) + i + "/v1", backendHint:null, source:"user-address/compatible-inventory"})), issues:[{index:7, code:"unsafe-endpoint"}], timedOut:true};
  });
  await discovery.getByRole("button", {name:"Discover servers", exact:true}).click();
  await discovery.getByText("Discovery timed out; only completed candidates are shown.", {exact:true}).waitFor();
  for (const width of [1100, 390, 320, 280]) {
    await page.setViewportSize({width, height:700});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Discovery overflow at ${width}`);
    assert.equal(await discovery.locator("ul").evaluate(el => el.clientHeight <= 240 && el.scrollHeight > el.clientHeight), true);
    if (output) await page.screenshot({path:path.join(output, `discovery-${width}.png`), fullPage:true});
  }
  await page.setViewportSize({width:1100, height:950});
  await page.evaluate(() => { window.discoveryDelay = 250; });
  await discovery.getByRole("button", {name:"Discover servers", exact:true}).click();
  await page.waitForFunction(() => window.discoveryCalls.filter(c => c.command === "self_hosted_discover").length === 5);
  await page.getByRole("button", {name:"Close server setup"}).click();
  const callsOnClose = await page.evaluate(() => window.discoveryCalls.length);
  await page.getByRole("button", {name:"Add self-hosted server", exact:true}).click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.discoveryCalls.filter(c => c.command === "self_hosted_discover").length), 5, "Reopen must not resume discovery");
  assert.ok(await page.evaluate(() => window.discoveryCalls.some(c => c.command === "ai_http_cancel")));
  assert.equal(await discovery.locator("li").count(), 0);
  assert.ok(callsOnClose > 0);
  await discovery.locator("summary").click();
  await page.getByLabel("Candidate addresses").fill("http://localhost:11434");
  await page.clock.install();
  await page.evaluate(() => { window.discoveryDelay = 60000; });
  await discovery.getByRole("button", {name:"Discover servers", exact:true}).click();
  await page.waitForFunction(() => window.discoveryCalls.filter(c => c.command === "self_hosted_discover").length === 6);
  await page.clock.runFor(17001);
  await discovery.getByText("Discovery timed out. Manual entry remains available.", {exact:true}).waitFor();
  await page.evaluate(() => { window.discoveryDelay = 5; window.discoveryResult = {candidates:[], issues:[], timedOut:false}; });
  await discovery.getByRole("button", {name:"Discover servers", exact:true}).click();
  await page.clock.runFor(100);
  await discovery.getByText("No discoverable servers found. You can still add one manually.", {exact:true}).waitFor();
  await page.clock.runFor(43001);
  assert.equal(await discovery.locator("li").count(), 0, "Expired IPC result must stay ignored");
  await page.getByLabel("Name", { exact: true }).fill("AI Server");
  await page.getByLabel("Address", { exact: true }).fill("http://192.168.1.50:11434");
  await page.getByLabel("Server type").selectOption("ollama");
  await page.getByLabel("Credential (optional)", { exact: true }).fill("fixture-secret");
  await page.getByLabel("Allow localhost and private-network access for this server", {exact:true}).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.locator(".server-status").getByText("Ready", { exact: true }).waitFor();
  assert.equal(await page.locator(".server-model").count(), 60);
  assert.equal(await page.getByLabel("Replace credential (optional)").inputValue(), "");
  assert.equal(await page.evaluate(() => JSON.stringify(window.prefs.getState()).includes("fixture-secret")), false);
  assert.equal(await page.evaluate(() => window.probes[0].allowPrivateNetwork), true);
  await page.getByRole("textbox", { name: "Search server models" }).fill("model-1499");
  assert.equal(await page.locator(".server-model").count(), 1);
  await page.locator(".server-model input").check();
  await page.getByRole("button", { name: "Save models", exact: true }).click();
  await page.getByRole("button", { name: "Manage AI Server" }).waitFor();
  await page.getByRole("textbox", { name: "Search server models" }).fill("model-1498");
  await page.locator(".server-model input").check();
  await page.getByRole("button", { name: "Save models", exact: true }).click();
  await page.getByText("2 saved models", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.prefs.getState().selfHostedInference.endpoints.length), 1);
  await page.getByRole("textbox", { name: "Search server models" }).fill("");
  await page.evaluate(() => { window.delay = 500; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.locator(".server-status").getByText("Checking", { exact: true }).waitFor();
  assert.equal(await page.locator(".server-model").count(), 60);
  await page.locator(".server-status").getByText("Ready", { exact: true }).waitFor();
  await page.evaluate(() => { window.fail = "unreachable"; window.delay = 5; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.locator(".server-status").getByText("Offline", { exact: true }).waitFor();
  assert.equal(await page.locator(".server-model").count(), 60);
  await page.getByLabel("Manual model ID", { exact: true }).fill("manual/model");
  await page.getByRole("button", { name: "Save models", exact: true }).click();
  await page.getByText("3 saved models", { exact: true }).waitFor();

  for (const viewport of [{width:1100,height:950}, {width:390,height:700}, {width:320,height:480}, {width:640,height:320}]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Page has horizontal overflow");
    assert.equal(await page.locator(".server-models").evaluate(el => el.clientHeight <= 240 && el.scrollHeight > el.clientHeight), true);
    await page.getByLabel("Search server models").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.type), "checkbox");
    if (output) await page.screenshot({ path:path.join(output, `server-${viewport.width}x${viewport.height}.png`), fullPage:true });
  }
  await page.setViewportSize({width:1100,height:950});
  await page.getByRole("button", { name: "Close server setup" }).click();
  const configured = await page.evaluate(() => JSON.stringify(window.prefs.getState().selfHostedInference));
  await page.getByRole("button", {name:"Add self-hosted server", exact:true}).click();
  await discovery.locator("summary").click();
  await page.getByLabel("Candidate addresses").fill("http://192.168.1.50:11434");
  await page.evaluate(() => { window.discoveryDelay = 5; window.discoveryResult = {candidates:[{baseURL:"http://192.168.1.50:11434/v1", backendHint:null, source:"user-address/authentication-required"}], issues:[], timedOut:false}; });
  await discovery.getByRole("button", {name:"Discover servers", exact:true}).click();
  await discovery.getByText(/Already configured/).waitFor();
  await discovery.getByRole("button", {name:"Use address", exact:true}).click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.prefs.getState().selfHostedInference)), configured, "Existing profiles must remain untouched");
  await page.getByRole("button", {name:"Close server setup"}).click();
  await page.getByRole("button", { name: /^Change model:/ }).click();
  const search = page.getByPlaceholder("Search models, providers, capabilities");
  await search.fill("AI Server");
  assert.equal(await page.getByRole("menuitem").count(), 3);
  await search.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "menuitem");
  await page.keyboard.press("Enter");
  await page.getByRole("menu").waitFor({state:"hidden"});
  assert.ok((await page.evaluate(() => window.chatStore.getState().selectedModelId)).startsWith("self-hosted:"));
  assert.ok((await page.getByRole("button", { name: /^Change model:/ }).getAttribute("title")).includes("AI Server"));
  await page.getByRole("button", { name: /^Change model:/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({state:"hidden"});
  const selected = await page.evaluate(() => window.chatStore.getState().selectedModelId);
  for (const [address, privateNetwork, backend] of [
    ["http://localhost:1234/v1", true, "lmstudio"],
    ["http://10.2.3.4:8000/v1", true, "vllm"],
    ["https://inference.example.test/proxy/v1", false, ""],
    ["https://generic.example.test/v1", false, "openai-compatible"],
  ]) {
    await page.getByRole("button", {name:"Add self-hosted server", exact:true}).click();
    await page.getByLabel("Name", {exact:true}).fill("Manual " + address);
    await page.getByLabel("Address", {exact:true}).fill(address);
    await page.getByLabel("Server type").selectOption(backend);
    if (privateNetwork) await page.getByLabel("Allow localhost and private-network access for this server", {exact:true}).check();
    await page.evaluate(() => { window.fail = null; window.delay = 5; });
    await page.getByRole("button", {name:"Connect", exact:true}).click();
    await page.locator(".server-status").getByText("Ready", {exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.probes.at(-1).allowPrivateNetwork), privateNetwork);
    assert.equal(await page.evaluate(() => window.chatStore.getState().selectedModelId), selected, "Manual setup must not change selected model");
    await page.getByRole("button", {name:"Close server setup"}).click();
  }
  assert.deepEqual(errors, []);
  console.log("PASS: G2 idle opt-in, credential exclusion, selection without persistence/trust, cancel/stale replacement/reopen, native timeout result + 17s browser watchdog, bounded long results at 1100/390/320/280px, keyboard focus, existing endpoint preservation; A3 add/auth/private access, 1500-model search, bindings, stale/manual fallback, picker, manual localhost/LAN/HTTPS/generic setup. Mocked browser only.");
} finally {
  await browser?.close();
  await server.close();
}
