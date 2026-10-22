// Isolated real Tauri IPC + production Todo Store/WebView roundtrip.
// This does not replace normal Clack chat approval or packaged-GUI acceptance.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { createServer } from "vite";

assert.equal(process.env.CLACK_R3C_NATIVE_ACCEPTANCE, "1", "R3c authorization required");
assert.equal(process.platform, "win32", "Windows-only native test; other platforms unqualified");
const root = process.cwd();
const runId = `r3c-native-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const owned = path.join(root, "src-tauri/target/r3c-native", runId);
const workspace = path.join(owned, "workspace");
await mkdir(workspace, { recursive: true });
await writeFile(path.join(workspace, "source.txt"), "revision-A\n");

const results = new Map();
const waiters = new Map();
const server = createHttpServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/report") { res.writeHead(404).end(); return; }
  let body = "";
  for await (const chunk of req) { body += chunk; if (body.length > 256 * 1024) { res.writeHead(413).end(); return; } }
  const record = JSON.parse(body);
  if (!["initial", "reopened"].includes(record.phase) || results.has(record.phase)) {
    res.writeHead(409).end(); return;
  }
  results.set(record.phase, record);
  await writeFile(path.join(owned, `${record.phase}.json`), JSON.stringify(record, null, 2));
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end("ok");
  waiters.get(record.phase)?.(record);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const reportUrl = `http://127.0.0.1:${server.address().port}/report`;
const entry = `
import React from "react";
import {createRoot} from "react-dom/client";
import {invoke} from "@tauri-apps/api/core";
import {native} from "/src/modules/ai/lib/native.ts";
import {workspacePermissionKey} from "/src/modules/ai/lib/permissions.ts";
import {buildShellTools} from "/src/modules/ai/tools/shell.ts";
import {useTodosStore,flushTodoPersistence} from "/src/modules/ai/store/todoStore.ts";
import {RunObligationStatus} from "/src/modules/ai/components/RunObligationStatus.tsx";
import {inspectRunObligations} from "/src/modules/ai/lib/runObligations.ts";

const phase = new URLSearchParams(location.search).get("phase");
const workspaceRoot = ${JSON.stringify(workspace)};
const sessionId = "r3c-temporary-conversation";
const workspaceId = workspacePermissionKey(workspaceRoot, "local");
const run = {state:"completed",startedAt:123,workspaceId,workspaceRoot};
const messages=[{id:"user-1",role:"user",parts:[{type:"text",text:"Run the harmless test and keep its evidence."}]}];
const ctx = {
 getSessionId:()=>sessionId,getRunId:()=>123,getUserTurnCount:()=>1,
 getWorkspaceRoot:()=>workspaceRoot,getWorkspaceId:()=>workspaceId,
 getCwd:()=>workspaceRoot,getWorkspaceEnv:()=>({kind:"local"}),
 getAgentId:()=>"builtin:coder",getTerminalContext:()=>null,
 isActiveTerminalPrivate:()=>false,injectIntoActivePty:()=>false,
 openPreview:()=>false,spawnAgent:()=>null,readAgentOutput:()=>null,
 readCache:new Map()
};
const mount=document.getElementById("app");
const root=createRoot(mount);
const render=async(key)=>{
 root.render(React.createElement(RunObligationStatus,{key,sessionId,workspaceId,workspaceRoot,run,messages,continuation:"new-instruction"}));
 await new Promise(resolve=>setTimeout(resolve,700));
 return mount.innerText;
};
const call=async()=>{
 const execute=buildShellTools(ctx).bash_run.execute;
 const output=await execute({command:"echo r3c-native-pass",verify_todo_id:"check",verification_purpose:"Harmless native shell echo"},{toolCallId:"r3c",messages:[]});
 if(output.exit_code!==0||output.timed_out!==false||!output.nativeCheckEvidenceId) throw new Error("Native result/receipt not recorded: "+JSON.stringify(output));
 await flushTodoPersistence();
 return output;
};
const result={phase,workspaceId,startedAt:Date.now(),nativeCalls:0};
try {
 if(phase==="initial"){
  useTodosStore.getState().setTodos(sessionId,[{id:"check",title:"Run harmless native check",status:"completed"},{id:"api",title:"Unfinished unrelated work",status:"pending"}]);
  await flushTodoPersistence();
  result.output=await call();result.nativeCalls++;
  result.nativeCheck=useTodosStore.getState().bySession[sessionId][0].nativeChecks?.[0];
  const current=await native.agentWorkspaceFingerprint(workspaceRoot,{kind:"local"});
  result.sourceWitness=current;
  result.report=inspectRunObligations({sessionId,workspaceId,run,todos:useTodosStore.getState().bySession[sessionId],messages,currentRevision:current.revision});
  result.uiText=await render("initial");
  if(result.report.nativeChecks[0].freshness!=="current-source-check"||!result.uiText.includes("current source check"))throw new Error("Current native check not rendered as sampled current");
 } else if(phase==="reopened"){
  await useTodosStore.getState().hydrate(sessionId);
  const restored=useTodosStore.getState().bySession[sessionId];
  if(restored?.length!==2||restored[0]?.nativeChecks?.length!==1)throw new Error("Actual plugin-store restart recovery missing receipt");
  result.restoredCheck=restored[0].nativeChecks[0];
  const before=await native.agentWorkspaceFingerprint(workspaceRoot,{kind:"local"});
  result.changedWitness=before;
  result.staleReport=inspectRunObligations({sessionId,workspaceId,run,todos:restored,messages,currentRevision:before.revision});
  result.staleUi=await render("reopened-stale");
  if(result.staleReport.nativeChecks[0].freshness!=="stale"||!result.staleUi.includes("stale"))throw new Error("Source change not shown as stale");
  result.output=await call();result.nativeCalls++;
  const next=useTodosStore.getState().bySession[sessionId];
  const after=await native.agentWorkspaceFingerprint(workspaceRoot,{kind:"local"});
  result.recheckedWitness=after;
  result.recheckReport=inspectRunObligations({sessionId,workspaceId,run,todos:next,messages,currentRevision:after.revision});
  result.newUi=await render("reopened-rechecked");
  if(JSON.stringify(result.recheckReport.nativeChecks.map(c=>c.freshness))!==JSON.stringify(["stale","current-source-check"]))throw new Error("Revalidated revision did not replace stale check");
  if(!result.newUi.includes("current source check")||!result.newUi.includes("stale"))throw new Error("User-facing WebView check states not rendered");
 }else throw new Error("Invalid phase");
 result.ok=true;
} catch(error){result.ok=false;result.error=String(error);result.stack=error?.stack;}
finally {
 result.endedAt=Date.now();
 await fetch(${JSON.stringify(reportUrl)},{method:"POST",body:JSON.stringify(result)});
 await invoke("r3c_exit");
}
`;

let vite, child, hostLog = "";
try {
  const build = spawnSync("cargo", ["build", "--locked", "--example", "r3c_native_roundtrip", "--target-dir", "target/codex-test"], {
    cwd: path.join(root, "src-tauri"), windowsHide: true, encoding: "utf8", timeout: 300000,
  });
  await writeFile(path.join(owned, "build.log"), `${build.stdout ?? ""}${build.stderr ?? ""}`);
  assert.equal(build.status, 0, `Native Tauri host compilation failed: ${build.stderr}`);
  vite = await createServer({ root, configFile: false, logLevel: "warn", resolve: { alias: { "@": path.join(root, "src") } },
    server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
    plugins: [{
      name: "r3c-native-fixture",
      resolveId(source) { if(source === "/r3c-native-entry.js") return "\0r3c-native-entry.js"; },
      load(id) { if(id === "\0r3c-native-entry.js") return entry; },
      configureServer(server) { server.middlewares.use("/r3c-native-acceptance.html", async (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml("/r3c-native-acceptance.html", '<!doctype html><html><body><div id="app"></div><script type="module" src="/r3c-native-entry.js"></script></body></html>'));
      }); }
    }]
  });
  await vite.listen();
  const url = `${vite.resolvedUrls.local[0]}r3c-native-acceptance.html`;
  const hostBin = path.join(root, "src-tauri/target/codex-test/debug/examples", "r3c_native_roundtrip.exe");
  await writeFile(path.join(owned, "run.json"), JSON.stringify({ runId, owned, hostBin, url, at: Date.now() }, null, 2));
  for(const phase of ["initial", "reopened"]) {
    const phaseReport = new Promise(resolve => waiters.set(phase, resolve));
    const phaseUrl = `${url}?phase=${phase}`;
    child = spawn(hostBin, [], {cwd: root, windowsHide: true,
      env: {...process.env, CLACK_R3C_OWNED_ROOT: owned, CLACK_R3C_ENTRY_URL: phaseUrl},
    });
    child.stdout.on("data", b => { hostLog = (hostLog + b).slice(-262144); });
    child.stderr.on("data", b => { hostLog = (hostLog + b).slice(-262144); });
    const timer = setTimeout(() => {
      if(child?.exitCode === null) child.kill();
    }, 90000);
    try {
      const result = await Promise.race([phaseReport, new Promise((_, reject) => child.once("exit", (code, signal) => reject(new Error(`Host exited before ${phase} report: ${code}/${signal}; log ${hostLog.slice(-2000)}`))))]);
      assert(result.ok, `Native ${phase} error: ${result.error ?? "unknown"}`);
      assert.equal(result.nativeCalls, 1);
      console.log(JSON.stringify({phase, ok: result.ok, nativeCalls: result.nativeCalls,
        sampledStates: phase === "initial" ? result.report.nativeChecks.map(c => c.freshness) : result.recheckReport.nativeChecks.map(c => c.freshness)}));
    } finally {
      clearTimeout(timer);
      await new Promise(resolve => setTimeout(resolve, 700));
      if(child?.exitCode === null) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide:true});
      }
    }
    if(phase === "initial") await writeFile(path.join(workspace, "source.txt"), "revision-B\n");
  }
  const initial = results.get("initial"), reopened = results.get("reopened");
  assert.equal(initial.nativeCheck?.id, reopened.restoredCheck?.id);
  assert.notEqual(initial.sourceWitness?.revision, reopened.changedWitness?.revision);
  assert.equal(reopened.recheckedWitness?.revision, reopened.changedWitness?.revision);
  console.log(JSON.stringify({runId, qualification:"native-Tauri-WebView-fixture-not-packaged-Clack", actualShellCalls: 2,
    recoveredReceipt: true, staleAfterExternalEdit: true, revalidatedOnB: true, evidence: owned}));
} finally {
  await writeFile(path.join(owned, "host.log"), hostLog);
  if(child?.exitCode === null) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide:true});
  await vite?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
