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
    export const useChatStore = create(() => ({ activeSessionId:null, selectedModelId:"gpt-5.4-mini", apiKeys:{ openai:"test", openrouter:"test" }, sessions:[] }));
    export function hasKeyForModel() { return true; }
    window.chatStore = useChatStore;
  `],
  ["src/modules/ai/lib/composer", `export const ACCEPTED_FILES = ""; export const useComposer = () => ({});`],
  ["src/modules/ai/hooks/useModelSelectionLock", `export function useModelSelectionLock() { return false; }`],
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
  const root = createRoot(document.getElementById("root"));
  root.render(React.createElement("main", {style:{maxWidth:700,padding:16,margin:"auto"}}, React.createElement(SelfHostedServers), React.createElement("div", {style:{display:"flex",justifyContent:"end",marginTop:20}}, React.createElement(ModelDropdown))));
`;
const server = await createServer({
  root, configFile: false, logLevel: "warn", optimizeDeps: { entries: [] },
  resolve: { alias: { "@": path.join(root, "src") } },
  plugins: [{ name: "isolated-self-hosted-fixture", enforce: "pre",
    resolveId(source, importer) {
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
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error); });
  await page.goto(`${server.resolvedUrls.local[0]}self-hosted-fixture`, { waitUntil: "networkidle", timeout: 120000 });
  await page.getByRole("button", { name: "Add self-hosted server", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("AI Server");
  await page.getByLabel("Address", { exact: true }).fill("http://192.168.1.50:11434");
  await page.getByLabel("Server type").selectOption("ollama");
  await page.getByLabel("Credential (optional)", { exact: true }).fill("fixture-secret");
  await page.getByLabel("Allow localhost").check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByText("Connected", { exact: true }).waitFor();
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
  await page.getByText("Updating", { exact: true }).waitFor();
  assert.equal(await page.locator(".server-model").count(), 60);
  await page.getByText("Connected", { exact: true }).waitFor();
  await page.evaluate(() => { window.fail = "unreachable"; window.delay = 5; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("Cached / refresh failed", { exact: true }).waitFor();
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
  assert.deepEqual(errors, []);
  console.log("PASS: add/auth/private access, 1500-model bounded search, multiple bindings, stale refresh, manual fallback, keyboard picker and four responsive viewports. Mocked browser only.");
} finally {
  await browser?.close();
  await server.close();
}
