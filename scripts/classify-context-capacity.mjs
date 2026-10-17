import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertToModelMessages, pruneMessages } from "ai";
import { createServer } from "vite";
import ts from "typescript";

const directory = process.argv[2];
assert(directory && path.isAbsolute(directory), "Supply the preserved absolute evidence directory");
const hashes = {};
async function read(name) {
  const file = path.join(directory, name);
  assert((await stat(file)).size < 4 * 1024 * 1024, "Evidence exceeds diagnostic bound");
  const text = await readFile(file, "utf8");
  assert(Buffer.byteLength(text) < 4 * 1024 * 1024, "Evidence exceeds diagnostic bound");
  hashes[name] = createHash("sha256").update(text).digest("hex");
  return text;
}
const report = JSON.parse(await read("mission-a-1.json"));
const requests = (await read("mission-a-1.requests.jsonl")).trim().split("\n").map(JSON.parse);
assert.deepEqual(hashes, {
  "mission-a-1.json": "79d81c1b791101c4184a03139949c00b5ed3892de14fb8d2e4f05d17126fb364",
  "mission-a-1.requests.jsonl": "9df05301f9e8c03dfe419b9259d9478707189d135396d739ea7d8b2f3c11be4c",
});
assert.equal(report.runId, "forgeboard-none-20261017-05");
assert.equal(requests.length, 23);
const session = report.sessions.find(s => s.id === "real-mission-a");
assert.equal(session.run.error.errorCode, "compaction-protected-budget");
const conversation = report.conversations.find(c => c.id === session.id);
const original = conversation.messages;
assert.equal(original.length, 2);
const ui = structuredClone(original);
ui[0].parts[0].text = requests[0].body.messages.find(m => m.role === "user").content;
const history = pruneMessages({ messages: await convertToModelMessages(ui), reasoning: "before-last-message", emptyMessages: "remove" });
const units = [{ messageId: original[0].id, role: "user", messages: history.slice(0, 1), hasContentReferences: false }];
let extra = history.slice(1);
const system = requests[0].body.messages.filter(m => m.role === "system");
const schemas = requests.at(-1).body.tools;
for (const request of requests) assert.deepEqual(request.body.tools, schemas);
const limits = { ...report.limits, deployed: 32768 };
const repository = fileURLToPath(new URL("../", import.meta.url));
const historicalSource = execFileSync("git", ["show", "7d1cf23:src/modules/ai/lib/contextBudget.ts"], { cwd: repository, encoding: "utf8", maxBuffer: 256 * 1024 });
const historicalModule = ts.transpileModule(historicalSource, { fileName: "contextBudget.ts", compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const historicalId = "\0clack-historical-budget";
const vite = await createServer({ root: repository, server: { watch: null, hmr: false }, logLevel: "error",
  plugins: [{ name: "offline-historical-budget", resolveId: id => id === "clack-historical-budget" ? historicalId : undefined,
    load: id => id === historicalId ? historicalModule : undefined }],
});
try {
  const { toResponseMessages } = await vite.ssrLoadModule("/node_modules/ai/src/generate-text/to-response-messages.ts");
  const steps = [];
  let block;
  for (const part of ui[1].parts) {
    if (part.type === "step-start") { block = []; steps.push(block); }
    else if (block) block.push(part);
  }
  extra = [];
  for (const parts of steps) {
    const content = parts.flatMap(part => {
      if (part.type === "text") return [{ type: "text", text: part.text, providerMetadata: part.providerMetadata }];
      if (!part.type.startsWith("tool-")) return [];
      assert.equal(part.state, "output-available");
      return [{ type: "tool-call", toolCallId: part.toolCallId, toolName: part.type.slice(5), input: part.input, providerExecuted: part.providerExecuted, providerMetadata: part.callProviderMetadata },
        { type: "tool-result", toolCallId: part.toolCallId, toolName: part.type.slice(5), input: part.input, output: part.output, providerExecuted: part.providerExecuted, providerMetadata: part.resultProviderMetadata }];
    });
    extra.push(...await toResponseMessages({ content, tools: undefined }));
  }
  const { planCompaction } = await vite.ssrLoadModule("/src/modules/ai/lib/compactionPlan.ts");
  const { measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
  const historical = await vite.ssrLoadModule("clack-historical-budget");
  // Inspect the public history projection without fixed system/schema cost. This
  // is cost decomposition only, not a provider request or tool selection override.
  const projection = planCompaction({ units, extra, limits, system: [], tools: [] });
  let failure;
  try { planCompaction({ units, extra, limits, system, tools: schemas }); }
  catch (error) { failure = error; }
  const measured = resolveContextBudget(limits, measureRequest({ messages: [...system, ...projection.messages], tools: schemas }));
  const body = { messages: [...system, ...projection.messages], tools: schemas };
  const before = historical.resolveContextBudget(limits, historical.measureRequest(body));
  assert.deepEqual([before.cost.system, before.cost.tools, before.cost.conversation, before.reserve, before.margin], [3617, 7250, 17816, 2048, 2869]);
  const total = b => b.cost.system + b.cost.tools + b.cost.conversation + b.reserve + b.margin;
  assert.equal(total(before), 33600);
  const serialized = historical.resolveContextBudget(limits, historical.measureRequest(JSON.parse(JSON.stringify(body))));
  assert.equal(total(serialized), 33171);
  assert.deepEqual(measured.cost, serialized.cost);
  assert.equal(total(measured), 33171);
  assert.equal(measured.fits, false);
  assert.equal(failure?.code, "compaction-protected-budget");
  assert.deepEqual(failure.budget, measured);
  const ghostFields = {};
  const visit = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) {
        const record = ghostFields[key] ??= { count: 0, tokens: 0 };
        record.count++;
        record.tokens += historical.estimateTextTokens(key) + 2;
      } else visit(item);
    }
  };
  visit(body);
  assert.deepEqual(ghostFields, { providerExecuted: { count: 26, tokens: 208 }, providerOptions: { count: 26, tokens: 182 } });
  const oldCost = messages => historical.measureRequest({ messages }).conversation;
  const newCost = messages => measureRequest({ messages }).conversation;
  const pairs = new Map();
  const narrative = [];
  let frames = 0;
  for (const [index, message] of projection.messages.slice(1).entries()) {
    assert(Array.isArray(message.content));
    const empty = { ...message, content: [] };
    frames += oldCost([empty]);
    const contribution = (part, measure = oldCost) => measure([{ ...message, content: [part] }]) - measure([empty]);
    for (const part of message.content) {
      const tokens = contribution(part);
      if (part.type === "text") { narrative.push({ source: `${original[1].id}:sdk-message-${index}`, tokens, current: "Historical narrative, not independently revalidated", authoritative: false, effect: false }); continue; }
      assert(["tool-call", "tool-result"].includes(part.type));
      const pair = pairs.get(part.toolCallId) ?? { id: part.toolCallId, name: part.toolName, callTokens: 0, resultTokens: 0, currentTokens: 0, messages: [] };
      pair.messages.push(index);
      pair.currentTokens += contribution(part, newCost);
      if (part.type === "tool-call") { pair.callTokens += tokens; pair.input = part.input; }
      else { pair.resultTokens += tokens; pair.output = part.output.value; pair.outputType = part.output.type;
        const removeField = field => {
          if (!pair.output || !Object.hasOwn(pair.output, field)) return 0;
          const reduced = structuredClone(part); delete reduced.output.value[field];
          return tokens - contribution(reduced);
        };
        pair.stdoutTokens = removeField("stdout"); pair.stderrTokens = removeField("stderr");
        pair.commandEchoTokens = removeField("command"); pair.refusalTokens = removeField("error");
      }
      pairs.set(part.toolCallId, pair);
    }
  }
  const authoredWrites = new Set(["ckhIS2eXV78KC510QtJMtQvVKtrPqrri", "yf2BXLHp22TUoCGnvYgBccl92U7aIITD", "7nYLfcQfIpVHCBij2vFh5Clvc4ugDmAJ", "rAwxIn13d5pu5SzyjUNBEhnpkldjGs8T", "nsNLCEAgIZAqUaEraag7pUnmCgWieaV7", "cfF5BncPwxmizjvv4130OfbqhAJDKLf9", "v9kXiVa8Q3hNU40xlm1iHVUvPxKQN5l4", "zbdzhdwwbrWbzoZYksRge8O30KmvViM4", "rzbgLuzy7F9GSfd3TP4bfqg6bcWrfdRi", "mwmwTwcfwuJC5YqzCDgOkDUupHjorpZD"]);
  const correctedScaffoldFailures = new Set(["ajNM3cn3nrW5FRNTmZmBm2770JZgWdrT", "qYt5bF8eEHLfOjVXw759WAytT2c2fU9x", "tePJmQfuLtuxUS04NbOoWy2bND6idHMM"]);
  const scaffoldWrites = new Set(["ckhIS2eXV78KC510QtJMtQvVKtrPqrri", "yf2BXLHp22TUoCGnvYgBccl92U7aIITD", "7nYLfcQfIpVHCBij2vFh5Clvc4ugDmAJ", "rAwxIn13d5pu5SzyjUNBEhnpkldjGs8T"]);
  const overwrittenContent = new Set(["nsNLCEAgIZAqUaEraag7pUnmCgWieaV7", "cfF5BncPwxmizjvv4130OfbqhAJDKLf9"]);
  const historicalOnly = new Set([...correctedScaffoldFailures, ...overwrittenContent, "rj1gPQ5EkrbzlcdXerlQ8gfbGOVhwNLt", "PxYjsOYpciTDo0sY7dGVFMViWrJhBa61"]);
  const pairRows = [...pairs.values()].map(pair => {
    const failure = pair.output?.error ? "multiline-refusal" : pair.output?.exit_code > 0 ? "quoting-failure" : null;
    return { id: pair.id, name: pair.name, source: `${original[1].id}:${pair.id}`, sdkMessages: pair.messages,
      tokens: pair.callTokens + pair.resultTokens, correctedAccountingTokens: pair.currentTokens,
      callTokens: pair.callTokens, resultTokens: pair.resultTokens, commandEchoTokens: pair.commandEchoTokens,
      stdoutTokens: pair.stdoutTokens, stderrTokens: pair.stderrTokens, refusalTokens: pair.refusalTokens,
      effect: authoredWrites.has(pair.id) ? "authored-write/probe" : pair.input?.command?.startsWith("npm install") ? "dependency-install" : pair.input?.command?.startsWith("git init") ? "local-git-config" : pair.name === "create_directory" ? "directory-write" : pair.name === "todo_write" ? "accepted-plan" : failure ? "refused-or-failed-command" : "inspection/probe",
      failure, unresolved: failure !== null && !correctedScaffoldFailures.has(pair.id),
      current: !historicalOnly.has(pair.id), superseded: false, contentOverwritten: overwrittenContent.has(pair.id), pendingProtocolCall: false,
      reason: "Unchanged current SDK step-history tail; no prior-batch source coverage/extraction boundary. Calls and results remain paired, not replayed.",
      safety: "Effect/debug provenance and original tool-result integrity; no automatic failure-supersession authority.",
      authoritativeRequirements: false,
      laterScaffoldWrite: correctedScaffoldFailures.has(pair.id),
    };
  }).sort((a,b) => b.tokens-a.tokens || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sum = (rows, key = "tokens") => rows.reduce((n,row) => n+(row[key]??0), 0);
  const userCost = historical.measureRequest({ messages: units[0].messages });
  const userTokens = userCost.conversation;
  assert.equal(userTokens + sum(pairRows) + sum(narrative) + frames, 17816);
  assert.equal(pairRows.length, 26);
  const rawPlans = extra.flatMap(m => m.content.filter(p => p.type === "tool-call" && p.toolName === "todo_write"));
  const hotIds = new Set(pairRows.map(p => p.id));
  const planRows = rawPlans.map(p => ({ id: p.toolCallId, hot: hotIds.has(p.toolCallId), durable: true, authoritativeObjective: false,
    states: p.input.todos.reduce((a,t) => (a[t.status]=(a[t.status]??0)+1,a),{}),
    tokens: pairs.get(p.toolCallId)?.callTokens + pairs.get(p.toolCallId)?.resultTokens || 0,
    items: p.input.todos.map(t => ({ title: t.title, status: t.status })) }));
  assert.deepEqual(planRows.map(p=>p.hot), [false,true]);
  const { selectToolSchemas, uiExposureQuery } = await vite.ssrLoadModule("/src/modules/ai/lib/toolExposure.ts");
  const query = uiExposureQuery(original);
  const initial = selectToolSchemas({ schemas, query, system: system[0].content, messages: units[0].messages, limits });
  assert.deepEqual(initial.names, schemas.map(s=>s.function.name).sort());
  const terminal = selectToolSchemas({ schemas, query, system, messages: [...units[0].messages,...extra], limits, mandatory: initial.names });
  assert.deepEqual(terminal.names, initial.names);
  const uses = original[1].parts.filter(p=>p.type.startsWith("tool-")).reduce((a,p)=>(a[p.type.slice(5)]=(a[p.type.slice(5)]??0)+1,a),{});
  const schemaRows = schemas.map(s=>({ name:s.function.name, tokens:historical.measureRequest({tools:[s]}).tools-3,
    recentUses:uses[s.function.name]??0, selectionReason:"Production initial relevance selection, then documented SDK-run pin; revision/permission still checked each step",
    usedThisRun:(uses[s.function.name]??0)>0 })).sort((a,b)=>b.tokens-a.tokens || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  assert.equal(sum(schemaRows)+2+schemas.length,7250);
  const shell = pairRows.filter(p=>p.name==="bash_run"), successfulShell=shell.filter(p=>!p.failure), failures=shell.filter(p=>p.failure);
  console.log(JSON.stringify({ baseline:"7d1cf23", hashes, historicalBudget:before, historicalRequired:total(before),
    jsonEquivalentBudget:serialized, jsonEquivalentRequired:total(serialized), currentBudget:measured, currentRequired:total(measured),
    ghostFields, currentFailure:{code:failure?.code,budget:failure?.budget},
    formalGroups:projection.groups.map(g=>({...g,sourceIds:units.slice(g.start,g.end).map(u=>u.messageId),tokens:oldCost(units.slice(g.start,g.end).flatMap(u=>u.messages)),reason:"Original authoritative user requirements and workspace envelope",current:true,superseded:false,effect:false,unresolved:false,integrity:true,safety:true,authoritativeRequirements:true})),
    activeTail:{sourceId:original[1].id,sdkMessages:extra.length,hotMessages:projection.messages.length-1,tokens:17816-userTokens,frames,narrativeTokens:sum(narrative),pairs:pairRows,narrative},
    decomposition:{userObjectiveEnvelope:userTokens,environment:userCost.breakdown.environment??0,rawObjectiveText:historical.estimateTextTokens(original[0].parts[0].text),
      allToolPairs:sum(pairRows),calls:sum(pairRows,"callTokens"),results:sum(pairRows,"resultTokens"),successfulShell:sum(successfulShell),
      successfulShellInputs:sum(successfulShell,"callTokens"),successfulShellOutputs:sum(successfulShell,"resultTokens"),
      refusals:sum(failures.filter(p=>p.failure==="multiline-refusal")),quotingFailure:sum(failures.filter(p=>p.failure==="quoting-failure")),
      failureOutputOnly:sum(failures,"resultTokens"),writePairs:sum(pairRows.filter(p=>authoredWrites.has(p.id))),
      scaffoldWritePairs:sum(pairRows.filter(p=>scaffoldWrites.has(p.id))),
      probeWritePairs:sum(pairRows.filter(p=>authoredWrites.has(p.id)&&!scaffoldWrites.has(p.id))),
      commandEcho:sum(shell,"commandEchoTokens"),stdout:sum(shell,"stdoutTokens"),stderr:sum(shell,"stderrTokens"),
      narrative:sum(narrative),messageFrames:frames},
    plans:planRows,toolSelection:{initial:initial.names,initialMetrics:initial.metrics,terminalMetrics:terminal.metrics,
      schemas:schemaRows,outerArray:18},
    projectTaskEvidence:0,retrievalEvidence:0,memory:0,extraction:0,objectiveCarry:0,
    newInference:0,nativeEffects:0 },null,2));
} finally { await vite.close(); }
