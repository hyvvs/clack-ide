/** One and only one Clack-native Muse sustained-stream diagnostic.
 * The source path, API parser and native 180s guard are production originals.
 * Strict test-only native host permits seven genuine calibrations and exactly
 * ONE diagnostic 32768/8192 request. No Agent, ForgeBoard or notes acceptance.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, readdir, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer as createViteServer } from "vite";
import { productionBuiltinToolNames } from "./r5u-acceptance-wire-source.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const runId = "musestreambyte-20261104-01";
const owned = path.join(repo, "src-tauri/target/real-qwen-product", runId);
const workspace = path.join(owned, "workspace");
const endpoint = "http://127.0.0.1:11438";
const digest = "de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1";
assert.deepEqual(process.argv.slice(2), ["one"], "One exclusive long-stream diagnostic, never replay");
assert.equal(process.env.CLACK_BYTE_DIAGNOSTIC_RUN_ID, runId);
assert.deepEqual((await readdir(owned)).sort(), ["diagnostic-tunnel.json", "workspace"], "Owned evidence root must be fresh, except the pinned SSH receipt and Git workspace");
assert((await readdir(workspace)).includes(".git"));

let local, vite, child, server, childExit = null, reportReceived = false;
const targetFile = path.join(owned, "stream-diagnostic-1");
let finish;
const resultPromise = new Promise(resolve => { finish = resolve; });
const startedAt = Date.now();
let eventCount = 0;
server = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  const json = value => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); };
  try {
    if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
    if (request.url === "/configuration") return json({
      report: `${local}/report`, server: endpoint,
      realProduct: { phase: "stream-diagnostic", modelId: "muse-glimmer:30b", reasoningChoice: "automatic" },
    });
    if (request.method !== "POST" || !["/report", "/evidence"].includes(request.url)) { response.statusCode = 404; return json({ error:"unknown" }); }
    let source = "";
    for await (const chunk of request) { source += chunk; assert(source.length < 128000); }
    const value = JSON.parse(source);
    if (request.url === "/evidence") {
      assert(++eventCount <= 20);
      assert(["calibration-result", "target-start", "target-finish"].includes(value.kind));
      if (value.kind === "target-start") {
        assert.equal(value.details?.context, 32768);
        assert.equal(value.details?.output, 8192);
        assert.equal(value.details?.tools, 0);
        assert.equal(value.details?.thinkKind, "absent");
        // Durable singleton dispatch marker BEFORE confirming any target start.
        await writeFile(path.join(owned, "target-started.json"), JSON.stringify({ at:value.at, ...value.details }), { flag: "wx" });
      }
      if (value.kind === "target-finish") {
        assert(typeof value.details?.outcome === "string");
        await writeFile(path.join(owned, "target-finished.json"), JSON.stringify(value.details, null, 2), { flag: "wx" });
      }
      await writeFile(`${targetFile}.event-${eventCount}.json`, JSON.stringify(value), { flag: "wx" });
      return json({ok:true});
    }
    assert(value.kind === "stream-byte-diagnostic" && value.ok === true && value.cloudInference === 0);
    assert(!reportReceived, "Report already received");
    reportReceived = true;
    await writeFile(`${targetFile}.native-report.json`, JSON.stringify(value, null, 2), { flag: "wx" });
    finish(value);
    return json({ok:true});
  } catch (error) { response.statusCode = 400; json({ error: String(error) }); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
local = `http://127.0.0.1:${server.address().port}`;
let caught;
try {
  const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(6000) });
  assert(response.ok, "Diagnostic forward not available");
  const tags = await response.json();
  assert.equal(tags.models?.find(m => m.name === "muse-glimmer:30b")?.digest, digest, "Exact Muse digest mismatch");
  assert.equal(tags.models.length, 15, "Unchanged model inventory required");
  const version = await (await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(6000) })).json();
  assert.equal(version.version, "0.40.11", "Incorrect temporary Ollama version");

  vite = await createViteServer({ root: repo, plugins: [{ name: "one-native-muse-long-stream", configureServer(s) {
    s.middlewares.use("/coworking-acceptance.html", async (_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(await s.transformIndexHtml("/coworking-acceptance.html",
        '<html><body><div id="root"></div><script type="module" src="/src/test/museStreamByteDiagnostic20261104.tsx"></script></body></html>'));
    });
  }}], server: { host:"127.0.0.1", port:0, strictPort:true, hmr:false, watch:null, forwardConsole:false } });
  await vite.listen();
  const { productionAcceptanceWireContract } = await vite.ssrLoadModule("/src/test/r5uAcceptanceWireContract.ts");
  const { r5deAcceptanceOutputContract } = await vite.ssrLoadModule("/src/test/r5deAcceptanceOutputContract.ts");
  const { CONTEXT_CALIBRATION } = await vite.ssrLoadModule("/src/modules/ai/lib/contextCalibrationSchema.ts");
  const policy = r5deAcceptanceOutputContract(CONTEXT_CALIBRATION.candidates, 73728);
  assert.equal(policy.originalOutput, 8192);
  const contract = productionAcceptanceWireContract(policy.originalOutput, 73728, await productionBuiltinToolNames(repo));
  contract.agent.continuationOutputs = policy.continuationOutputs;
  contract.agent.continuationMarker = policy.continuationMarker;

  const data = path.join(owned,"data"); await mkdir(data);
  const sourceSettings = await readFile(path.join(repo, "src-tauri/target/real-qwen-product/qwen-smoke-r5af-20261024-01/data/terax-settings.json"));
  assert.equal(createHash("sha256").update(sourceSettings).digest("hex"),
    "2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb");
  const isolated = JSON.parse(sourceSettings.toString("utf8"));
  assert.equal(isolated.selfHostedInference.endpoints.length, 1);
  assert.equal(isolated.selfHostedInference.endpoints[0].baseURL, "http://127.0.0.1:11435/");
  isolated.selfHostedInference.endpoints[0].baseURL = `${endpoint}/`;
  await writeFile(path.join(data,"terax-settings.json"), JSON.stringify(isolated,null,2), {flag:"wx"});
  await cp(data, `${targetFile}.data-before`, {recursive:true,errorOnExist:true,force:false});

  const env = Object.fromEntries(["PATH","PATHEXT","SystemRoot","WINDIR","COMSPEC","HOME","LANG"].flatMap(k => process.env[k] ? [[k,process.env[k]]] : []));
  Object.assign(env,{ APPDATA:data,LOCALAPPDATA:data,TEMP:owned,TMP:owned,
    CLACK_ACCEPTANCE_ROOT:owned,CLACK_REAL_PRODUCT_PHASE:"stream-diagnostic-1",
    CLACK_ACCEPTANCE_MODEL:"muse-glimmer:30b",CLACK_ACCEPTANCE_OLLAMA_URL:`${endpoint}/api/chat`,
    CLACK_ACCEPTANCE_EXPECTED_THINK:"omitted",CLACK_ACCEPTANCE_WIRE_CONTRACT:JSON.stringify(contract),
    CLACK_ACCEPTANCE_RECEIVE_TRACE:"1",
    CLACK_ACCEPTANCE_URL:`${vite.resolvedUrls.local[0]}coworking-acceptance.html?configuration=${encodeURIComponent(`${local}/configuration`)}`,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:"--disable-gpu --disable-gpu-compositing",
  });
  child = spawn(path.join(repo,"src-tauri/target/codex-test/debug/examples/muse_stream_byte_diagnostic_20261104.exe"), [],
    {cwd:workspace,env,windowsHide:true});
  child.once("exit", (code,signal)=>{childExit={code,signal,pid:child.pid,at:Date.now()};});
  child.stdout.on("data", b => process.stdout.write(String(b).slice(-1000)));
  child.stderr.on("data", b => {
    const value=String(b);
    if (value.includes("CLACK_ACCEPTANCE_INFERENCE")) console.log("NATIVE_INFERENCE_REQUEST");
  });
  console.log(JSON.stringify({event:"one-native-host-start",pid:child.pid,at:Date.now()}));
  let timer;
  const result = await Promise.race([resultPromise,
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Diagnostic host 15min bound")),15*60*1000);}),
    new Promise((_,reject)=>child.once("exit",code=>reject(new Error(`Host exited before persisted report: ${code}`))))
  ]).finally(()=>clearTimeout(timer));
  await new Promise(resolve => setTimeout(resolve, 700));
  const requests = (await readFile(`${targetFile}.requests.jsonl`,"utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  const countTarget = requests.filter(r => r.numPredict === 8192 && r.numCtx === 32768 && r.toolSchemas === 0);
  assert.equal(countTarget.length, result.targetStarted ? 1 : 0, "Exactly one target request permitted");
  assert(requests.every(r => r.modelMatches && r.thinkKind === "absent"));
  assert(requests.filter(r=>r.numPredict===32).length <= 7);
  await writeFile(`${targetFile}.summary.json`,JSON.stringify({
    runId,model:"muse-glimmer:30b",digest,startedAt,endedAt:Date.now(),
    calibrationRequests:result.calibrationRequests,targetRequests:countTarget.length,
    targetRequestId:countTarget[0]?.requestId ?? null, response:result,
    childExit, nativeRequests:requests.map(({requestId,numCtx,numPredict,toolSchemas})=>({requestId,numCtx,numPredict,toolSchemas})),
  },null,2),{flag:"wx"});
  console.log(JSON.stringify({event:"one-diagnostic-completed",count:requests.length,targetRequestId:countTarget[0]?.requestId,
    outcome:result.outcome,calibrationRequests:result.calibrationRequests}));
} catch(error) {
  caught=error;
  await writeFile(`${targetFile}.failure.json`,JSON.stringify({kind:error?.name??"Error",startedAt,endedAt:Date.now(),childExit},null,2),{flag:"wx"}).catch(()=>{});
  throw error;
} finally {
  if (child?.exitCode===null) {
    if(process.platform==="win32") spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
    else child.kill();
    if(child.exitCode===null) await new Promise(resolve=>child.once("exit",resolve));
  }
  await vite?.close();
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  // Remote TRACE/relay/SSH/telemetry are stopped by separate guarded cleanup.
}
