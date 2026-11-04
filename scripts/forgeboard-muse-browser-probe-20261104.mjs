/** One headless LOCAL browser session for the single frozen ForgeBoard evaluator.
 * No browser downloads, hosted services, model calls, or app source edits.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export async function evaluateFrontend({ url, owned, apiProjects, apiTasks }) {
  const result = { url, browserWorkflows: { passed: false }, baseline: { passed: false }, errors: [], evidence: {} };
  let browser, socket;
  try {
    const profile = path.join(owned, "evaluation-browser-profile");
    await mkdir(profile, { recursive: false });
    browser = spawn(chrome, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
      "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    let port;
    for (let i = 0; i < 60; i++) {
      const content = await readFile(path.join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
      if (/^\d+\r?\n/.test(content)) { port = Number(content.split(/\r?\n/)[0]); break; }
      if (browser.exitCode !== null) break;
      await pause(250);
    }
    if (!port) throw new Error("Chrome headless DevTools endpoint unavailable");
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) });
    if (!targetResponse.ok) throw new Error("Local browser page unavailable");
    const target = await targetResponse.json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const pending = new Map();
    let nextId = 0;
    socket.addEventListener("message", event => {
      const msg = JSON.parse(String(event.data));
      const wait = pending.get(msg.id);
      if (!wait) return;
      pending.delete(msg.id);
      clearTimeout(wait.timeout);
      if (msg.error) wait.reject(new Error(msg.error.message));
      else wait.resolve(msg.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Browser ${method} timeout`)); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? "Browser JS exception");
      return response.result?.value;
    };
    await send("Page.enable"); await send("Runtime.enable");
    await send("Page.navigate", { url });
    let loaded = false;
    for (let i = 0; i < 50; i++) {
      loaded = await evaluate("document.readyState === 'complete' && !!document.querySelector('#root,main,body')").catch(() => false);
      if (loaded) break;
      await pause(250);
    }
    if (!loaded) throw new Error("Frontend did not load a browser document");
    await pause(1500);

    const inspection = `(() => {
      const root = document.body;
      const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const label = el => [el.getAttribute('aria-label'), el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent,
        el.labels && Array.from(el.labels).map(l => l.textContent).join(' '), el.title].find(x => x && x.trim());
      const controls = Array.from(root.querySelectorAll('input,select,textarea')).filter(visible);
      const buttons = Array.from(root.querySelectorAll('button,[role=button]')).filter(visible);
      return {
        url: location.href, title: document.title, body: root.innerText.slice(0,5000),
        controls: controls.map(el => ({ tag:el.tagName, type:el.type||'', name:el.name||'', placeholder:el.placeholder||'', label:label(el)||'', value:el.value||'' })).slice(0,150),
        buttons: buttons.map(el => ({ name:el.getAttribute('aria-label')||el.innerText||'', disabled:!!el.disabled, tabIndex:el.tabIndex })).slice(0,150),
        headings: Array.from(root.querySelectorAll('h1,h2,h3')).map(el=>el.innerText).slice(0,50),
        unlabeledControls: controls.filter(el => el.type !== 'hidden' && !label(el)).map(el=>el.outerHTML.slice(0,200)).slice(0,20),
        unnamedButtons: buttons.filter(el => !(el.getAttribute('aria-label')||el.innerText||'').trim()).map(el=>el.outerHTML.slice(0,200)).slice(0,20),
        badRoles: Array.from(root.querySelectorAll('[role=button]')).filter(el=>visible(el) && el.tabIndex<0).map(el=>el.outerHTML.slice(0,200)).slice(0,20),
        imagesWithoutAlt: Array.from(root.querySelectorAll('img')).filter(el=>!el.hasAttribute('alt')).map(el=>el.outerHTML.slice(0,200)).slice(0,20),
        liveRegions: root.querySelectorAll('[role=alert],[role=status],[aria-live]').length,
        projectWord: /projects?/i.test(root.innerText), taskWord: /tasks?/i.test(root.innerText),
        statusWord: /Backlog|Todo|In Progress|Blocked|Done/.test(root.innerText),
        priorityWord: /Low|Medium|High|Urgent/.test(root.innerText),
      };
    })()`;
    result.evidence.initial = await evaluate(inspection);

    // Keyboard-only Tab focus movement on the actual rendered application.
    const before = await evaluate("document.activeElement?.outerHTML.slice(0,200) ?? null");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    const after = await evaluate("document.activeElement?.outerHTML.slice(0,200) ?? null");
    result.evidence.keyboard = { before, after, moved: before !== after && !!after && !after.startsWith("<body") };

    // Live project flow: open an actual creation form, populate its text input,
    // submit through the UI, and independently corroborate the resulting API.
    const projectName = "Browser Acceptance Project 20261104";
    const taskTitle = "Browser Acceptance Task 20261104";
    const press = async re => evaluate(`(() => { const re=${re}; const found=Array.from(document.querySelectorAll('button,[role=button],a')).find(el => re.test((el.getAttribute('aria-label')||'')+' '+(el.innerText||''))); if(found){found.click();return (found.innerText||found.getAttribute('aria-label')||'').slice(0,120)}return null })()`);
    const fill = async (field, text) => evaluate(`(() => {
      const candidates=Array.from(document.querySelectorAll('input:not([type=hidden]),textarea'));
      const el=candidates.find(el => ${field}.test([el.name,el.placeholder,el.id,el.getAttribute('aria-label'),el.labels?.[0]?.textContent].join(' '))) || candidates.find(el=>!el.value);
      if(!el)return null;
      el.focus(); const desc=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value');
      desc.set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
      return {tag:el.tagName,name:el.name,placeholder:el.placeholder,value:el.value};
    })()`);
    result.evidence.openProject = await press("/new project|add project|create project/i");
    await pause(450);
    result.evidence.projectInput = await fill("/project|name/i", projectName);
    result.evidence.submitProject = await press("/^\\s*(create project|save project|create|add|save)\\s*$/i");
    await pause(1500);
    result.evidence.afterProject = await evaluate(inspection);
    const projectItems = await apiProjects();
    result.evidence.projectCreated = JSON.stringify(projectItems).includes(projectName);
    result.evidence.openTask = await press("/new task|add task|create task/i");
    await pause(450);
    result.evidence.taskInput = await fill("/task|title/i", taskTitle);
    result.evidence.submitTask = await press("/^\\s*(create task|save task|create|add|save)\\s*$/i");
    await pause(1500);
    result.evidence.afterTask = await evaluate(inspection);
    const taskItems = await apiTasks();
    result.evidence.taskCreated = JSON.stringify(taskItems).includes(taskTitle);
    result.browserWorkflows.passed = !!(result.evidence.projectCreated && result.evidence.taskCreated &&
      result.evidence.projectInput && result.evidence.taskInput && result.evidence.keyboard.moved);
    const i = result.evidence.afterTask;
    result.baseline.passed = !!(result.browserWorkflows.passed && i?.projectWord && i?.taskWord &&
      i?.statusWord && i?.priorityWord && i.unlabeledControls?.length === 0 && i.unnamedButtons?.length === 0 &&
      i.badRoles?.length === 0 && i.imagesWithoutAlt?.length === 0 && i.liveRegions > 0);
  } catch (error) {
    result.errors.push(error?.stack?.slice(0,1000) ?? String(error));
  } finally {
    try { socket?.close(); } catch { /* no-op */ }
    if (browser?.pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10000 });
      else browser.kill();
    }
  }
  return result;
}
