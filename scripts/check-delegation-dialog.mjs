// Run with PLAYWRIGHT_MODULE pointing to an installed playwright package.
// Mounts the real dialog/CSS with isolated stores; never sends an agent task.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.DELEGATION_SCREENSHOTS;
if (output) await mkdir(output, { recursive: true });
const mocks = new Map([
  ["src/modules/ai/store/chatStore", `
    export const useChatStore = selector => selector(window.fixture);
    export const getChat = () => ({ messages: window.fixture.messages });
  `],
  ["src/modules/ai/store/agentsStore", `
    export const useAgentsStore = selector => selector({ customAgents: [] });
  `],
  ["src/modules/ai/store/peerTaskStore", `
    export const usePeerTaskStore = selector => selector({ tasks: [] });
  `],
  ["src/modules/settings/preferences", `
    export const usePreferencesStore = selector => selector({ customEndpoints: [], savedProviderModels: [] });
  `],
  ["src/modules/ai/lib/peerTaskCoordinator", `
    export async function requestPeerTask(request) {
      window.sent.push(request);
      if (window.fixture.throwError) throw new Error("Fixture failure");
      await new Promise(resolve => setTimeout(resolve, window.fixture.delay ?? 0));
      return window.fixture.error ? { ok: false, message: window.fixture.error } : { ok: true };
    }
  `],
]);
const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { PeerTaskDialog } from "/src/modules/ai/components/PeerTaskDialog.tsx";
  import "/src/styles/globals.css";
  const root = createRoot(document.getElementById("root"));
  window.sent = [];
  window.renderFixture = (fixture) => {
    window.fixture = fixture;
    root.render(React.createElement(PeerTaskDialog, {
      key: fixture.key, sourceSessionId: "source", open: fixture.open !== false,
      onOpenChange: open => { window.renderFixture({ ...window.fixture, open }); },
    }));
  };
`;
const server = await createServer({
  root,
  configFile: false,
  logLevel: "warn",
  optimizeDeps: { entries: [] },
  resolve: { alias: { "@": path.join(root, "src") } },
  plugins: [
    {
      name: "isolated-delegation-fixture",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "/delegation-entry.jsx") return "\0delegation-entry.jsx";
        const absolute = source.startsWith(".") && importer
          ? path.resolve(path.dirname(importer), source) : source;
        const relative = path.relative(root, absolute).replaceAll("\\", "/").replace(/\.[jt]sx?$/, "");
        return mocks.has(relative) ? `\0mock:${relative}` : null;
      },
      load(id) {
        if (id === "\0delegation-entry.jsx") return entry;
        if (id.startsWith("\0mock:")) return mocks.get(id.slice(6));
      },
      configureServer(vite) {
        vite.middlewares.use("/delegation-fixture", async (_req, res) => {
          res.setHeader("Content-Type", "text/html");
          res.end(await vite.transformIndexHtml("/delegation-fixture", `<!doctype html>
            <html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="margin:0;background:var(--clack-bg-root)"><div id="root"></div>
            <script type="module" src="/delegation-entry.jsx"></script></body></html>`));
        });
      },
    },
    react(),
    tailwindcss(),
  ],
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  console.log("Loading isolated dialog fixture...");
  await page.goto(`${server.resolvedUrls.local[0]}delegation-fixture`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => typeof window.renderFixture === "function", null, { timeout: 120000 });
  console.log("Dialog fixture loaded.");
  let key = 0;
  const session = (id, title, busy = false, modelId = "gpt-5.5") => ({
    id, title, createdAt: 1, updatedAt: 1,
    profile: { agentId: "builtin:reviewer", modelId, workspaceId: "local:c:/fixture" },
    run: { state: busy ? "running" : "idle" },
  });
  const attachments = Array.from({ length: 45 }, (_, index) => ({
    type: "data-clack-attachment",
    data: {
      attachmentId: `attachment-${index}`,
      contentId: index.toString(16).padStart(64, "0"),
      contentHash: index.toString(16).padStart(64, "0"),
      displayName: `spec-${index}-${"very-long-file-name-".repeat(12)}.md`,
      mediaType: "text/markdown", contentKind: "text", byteSize: 12,
    },
  }));
  const base = {
    sessions: [session("source", "Implementation"), session("target", "Review the attachment pipeline"), session("busy", "Second agent", true)],
    messages: [{ id: "message", role: "user", parts: attachments }],
  };
  async function render(fixture = base) {
    await page.evaluate(value => { window.sent = []; window.renderFixture(value); }, { ...fixture, key: ++key });
    await page.getByRole("dialog").waitFor();
    await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA");
    await page.getByRole("dialog").evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
  }
  async function geometry() {
    const result = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const body = dialog.querySelector(".clack-delegation-body");
      const footer = dialog.querySelector(".clack-delegation-actions");
      const d = dialog.getBoundingClientRect(), f = footer.getBoundingClientRect(), b = body.getBoundingClientRect();
      return {
        inside: d.top >= 0 && d.left >= 0 && d.right <= innerWidth + 1 && d.bottom <= innerHeight + 1,
        footerVisible: f.top >= d.top && f.bottom <= innerHeight && b.bottom <= f.top + 1,
        horizontalOverflow: body.scrollWidth > body.clientWidth + 1,
        dialogScrolls: dialog.scrollHeight > dialog.clientHeight + 1,
      };
    });
    if (!result.inside || !result.footerVisible || result.horizontalOverflow || result.dialogScrolls) {
      console.log(await page.getByRole("dialog").evaluate(el => ({ viewport: [innerWidth, innerHeight], height: el.clientHeight, scroll: el.scrollHeight, scrollTop: el.scrollTop, html: el.outerHTML.slice(0, 200) })));
      if (output) await page.screenshot({ path: path.join(output, "delegation-failure.png") });
    }
    assert.deepEqual(result, { inside: true, footerVisible: true, horizontalOverflow: false, dialogScrolls: false });
  }

  for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 450 }, { width: 390, height: 600 }, { width: 320, height: 480 }, { width: 640, height: 320 }]) {
    await page.setViewportSize(viewport);
    await render({ ...base, sessions: [base.sessions[0], session("target", "LongChatTitle".repeat(40), false, "unknown/model-".repeat(50)), base.sessions[2]] });
    await page.getByRole("textbox", { name: "Task", exact: true }).fill("A long prompt. ".repeat(1000));
    await geometry();
    const prompt = page.getByRole("textbox", { name: "Task", exact: true });
    assert.equal(await prompt.evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).fieldSizing === "fixed"), true);
    await page.getByRole("combobox", { name: "To", exact: true }).click();
    const list = page.getByRole("listbox");
    await list.waitFor();
    await list.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
    const menuBounds = await list.evaluate(el => ({ width: el.getBoundingClientRect().width, viewport: innerWidth, scroll: el.scrollWidth, client: el.clientWidth }));
    if (output) await page.screenshot({ path: path.join(output, `delegation-menu-${viewport.width}x${viewport.height}.png`) });
    assert.ok(menuBounds.width <= menuBounds.viewport && menuBounds.scroll <= menuBounds.client + 1, JSON.stringify(menuBounds));
    await page.keyboard.press("Escape");
    await list.waitFor({ state: "hidden" });
    if (output) await page.screenshot({ path: path.join(output, `delegation-${viewport.width}x${viewport.height}.png`) });
  }

  await page.setViewportSize({ width: 1100, height: 900 });
  await render();
  await page.getByRole("textbox", { name: "Task", exact: true }).fill("Review only the selected file.");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Review", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("checkbox").first().click();
  if (output) await page.screenshot({ path: path.join(output, "delegation-desktop.png") });
  await page.getByRole("button", { name: "Send task", exact: true }).click();
  await page.waitForFunction(() => window.sent.length === 1);
  assert.deepEqual(await page.evaluate(() => ({ target: window.sent[0].targetSessionId, kind: window.sent[0].kind, access: window.sent[0].executionMode, files: window.sent[0].attachmentReferences.length })), { target: "target", kind: "review", access: "read-only", files: 1 });
  await page.getByRole("dialog").waitFor({ state: "hidden" });

  await render({ ...base, delay: 300 });
  await page.getByRole("combobox", { name: "To", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.textContent?.includes("Second agent"));
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Task", exact: true }).fill("A queued task");
  assert.equal(await page.getByRole("button", { name: "Queue task", exact: true }).isEnabled(), true);
  await page.getByRole("textbox", { name: "Task", exact: true }).press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.sent.length), 1);
  assert.equal(await page.evaluate(() => window.sent[0].targetSessionId), "busy");

  await render();
  await page.getByRole("combobox", { name: "Workspace access", exact: true }).click();
  await page.getByRole("option", { name: "Edit workspace", exact: true }).click();
  await page.getByRole("textbox", { name: "Task", exact: true }).fill("An editing task");
  await page.getByRole("button", { name: "Send task", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.sent[0].executionMode), "shared-write");

  await render({ ...base, sessions: base.sessions.map(value => ({ ...value, profile: { ...value.profile, workspaceId: "wsl:Ubuntu:/fixture" } })) });
  await page.getByRole("combobox", { name: "Workspace access", exact: true }).click();
  assert.equal(await page.getByRole("option", { name: "Isolated changes", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape");

  await render({
    ...base,
    sessions: [base.sessions[0], session("vision", "Vision agent"), session("text", "Text agent", false, "gpt-5.4-nano")],
    messages: [{ id: "image", role: "user", parts: [{ ...attachments[0], data: { ...attachments[0].data, displayName: "screenshot.png", mediaType: "image/png", contentKind: "image" } }] }],
  });
  await page.getByRole("textbox", { name: "Task", exact: true }).fill("Inspect this image");
  await page.getByRole("checkbox").click();
  await page.getByRole("combobox", { name: "To", exact: true }).click();
  await page.getByRole("option", { name: /Text agent/ }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "Send task", exact: true }).isDisabled(), true);
  await page.getByRole("checkbox").click();
  assert.equal(await page.getByRole("checkbox").isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Send task", exact: true }).isEnabled(), true);

  await render({ ...base, throwError: true });
  await page.getByRole("textbox", { name: "Task", exact: true }).fill("Failure case");
  await page.getByRole("button", { name: "Send task", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent(), /Could not send/);
  assert.equal(await page.getByRole("button", { name: "Send task", exact: true }).isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 400 });
  await render({ ...base, error: "LongErrorWithoutBreaks".repeat(250) });
  await page.getByRole("textbox", { name: "Task", exact: true }).fill("Failure case");
  await page.getByRole("button", { name: "Send task", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await geometry();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });

  await render({ ...base, sessions: [base.sessions[0]], messages: [] });
  assert.match(await page.getByRole("status").textContent(), /No other configured chats/);
  assert.equal(await page.getByRole("button", { name: "Send task", exact: true }).isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: /Context/ }).getAttribute("aria-expanded"), "false");
  await geometry();
  assert.deepEqual(errors, []);
  console.log("PASS: five viewports, long names/prompts, popup bounds, selection/payload, queue/keyboard, duplicate guard, access modes, attachment compatibility, failure recovery, error bounds and empty state.");
  if (output) console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
