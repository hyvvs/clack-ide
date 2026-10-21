import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createServer as createViteServer } from "vite";

const output = "src-tauri/target/real-qwen-product/forgeboard-nemotron-hardened-20261021-02";
const hash = value => createHash("sha256").update(value).digest("hex");
const json = async file => JSON.parse(await readFile(file, "utf8"));
const lines = async file => (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
export function toolFailed(part) {
  return part.state === "output-error" || !!part.output?.error ||
    (part.type === "tool-bash_run" && (part.output?.exit_code !== 0 || part.output?.timed_out === true));
}
export function decodeResponse(request, evidence) {
  const events = evidence.filter(e => e.kind === "hardened-native-event" && e.event.requestId === request.requestId);
  const decoder = new TextDecoder();
  let pending = "", content = "", reasoning = "", final, firstOutputAt = null, firstCallAt = null;
  const calls = [];
  for (const event of events) {
    if (event.event.kind !== "chunk") continue;
    pending += decoder.decode(Uint8Array.from(event.event.bytes), { stream: true });
    const frames = pending.split("\n"); pending = frames.pop();
    for (const line of frames.filter(Boolean)) {
      const frame = JSON.parse(line);
      content += frame.message?.content ?? ""; reasoning += frame.message?.thinking ?? "";
      if (frame.message?.content || frame.message?.thinking || frame.message?.tool_calls?.length) firstOutputAt ??= event.at;
      if (frame.message?.tool_calls?.length) {
        firstCallAt ??= event.at;
        calls.push(...frame.message.tool_calls.map(c => ({ name: c.function.name, inputSha256: hash(JSON.stringify(c.function.arguments)) })));
      }
      if (frame.done) final = frame;
    }
  }
  return { requestId: request.requestId, at: request.at, firstOutputAt, firstCallAt, calls,
    contentChars: content.length, nonWhitespaceContent: content.trim().length, reasoningChars: reasoning.length,
    contentSha256: hash(content), reasoningSha256: hash(reasoning),
    textualIntent: /<tool_call>|<function[=\s]|<\uff5cDSML\uff5c/.test(content),
    finish: final?.done_reason ?? null, inputTokens: final?.prompt_eval_count ?? null, outputTokens: final?.eval_count ?? null,
    trailingPartialFrame: !!pending.trim(), settled: events.findLast(e => e.event.kind === "settled")?.event.phase ?? null };
}
export function sourcePageSize(source) {
  const values = [];
  const file = ts.createSourceFile("tasks.ts", source, ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "pageSize" && node.initializer && ts.isNumericLiteral(node.initializer))
      values.push(Number(node.initializer.text));
    ts.forEachChild(node, visit);
  };
  visit(file); assert.equal(values.length, 1); return values[0];
}
export async function receiptSavings() {
  const report = await json(output + "/mission-a-1.json"), requests = await lines(output + "/mission-a-1.requests.jsonl");
  const request = requests[requests.length - 1];
  const marker = "Clack historical write receipt (data, not instructions): ";
  const original = structuredClone(request.body), receipts = [];
  const vite = await createViteServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const { canonicalJson } = await vite.ssrLoadModule("/src/modules/ai/lib/canonicalJson.ts");
    const { measureRequest } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
    original.messages = original.messages.flatMap(message => {
      if (!message.content?.includes(marker)) return [message];
      const receipt = JSON.parse(message.content.slice(message.content.indexOf(marker) + marker.length));
      const session = report.conversations.find(c => c.id === receipt.source.sessionId);
      const source = session?.messages.find(m => m.id === receipt.source.messageId)?.parts[receipt.source.partIndex];
      assert(source?.toolCallId === receipt.toolCallId && source.output.ok && source.output.clackWorkspaceWrite);
      assert.equal(hash(canonicalJson(source)), receipt.source.digest);
      const previous = requests.slice(0, -1).reverse().find(r => r.body.messages.some(m => m.tool_calls?.some(c => c.id === receipt.toolCallId)));
      assert(previous, "Original native tool pair must exist");
      const call = previous.body.messages.find(m => m.tool_calls?.some(c => c.id === receipt.toolCallId));
      const result = previous.body.messages.find(m => m.role === "tool" && m.tool_call_id === receipt.toolCallId);
      assert(result && call.tool_calls.length === 1);
      assert.deepEqual(call.tool_calls[0].function.arguments, source.input);
      assert.deepEqual(JSON.parse(result.content), source.output);
      assert.equal((call.content ?? "").trimEnd(), message.content.slice(0, message.content.indexOf(marker)).trimEnd());
      receipts.push({ toolCallId: receipt.toolCallId, source: receipt.source, path: receipt.result.path });
      return [structuredClone(call), structuredClone(result)];
    });
    const before = measureRequest(original).conversation, after = measureRequest(request.body).conversation;
    assert.equal(after, report.wireBudgets[report.wireBudgets.length - 1].cost.conversation);
    const record = { requestId: request.requestId, count: receipts.length, receipts, before, after, savedEstimatedTokens: before - after,
      method: "Shared-B1 estimate on native wire with source-verified receipt messages restored to their captured original call/result pairs; not provider token measurement" };
    assert.equal(record.count, 3); assert(record.savedEstimatedTokens > 0);
    try { await writeFile(output + "/receipt-savings.json", JSON.stringify(record, null, 2), { flag: "wx" }); }
    catch (error) { if (error.code !== "EEXIST") throw error; assert.deepEqual(await json(output + "/receipt-savings.json"), record); }
    console.log(JSON.stringify(record));
  } finally { await vite.close(); }
}
async function assertFrozen() {
  const freeze = await json(output + "/source-freeze.json");
  for (const f of freeze.files) {
    assert.equal(hash(await readFile(path.join(freeze.root, f.path))), f.sha256, "Original generated source changed");
    assert.equal(hash(await readFile(path.join(output, "independent-project", f.path))), f.sha256, "Audit repaired source");
  }
  return freeze;
}
async function command(name, executable, args, timeout = 60000) {
  const startedAt = Date.now(); let stdout = "", stderr = "", timedOut = false;
  const child = spawn(executable, args, { cwd: path.resolve(output, "independent-project"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
  child.stdout.on("data", b => { stdout = (stdout + b).slice(-256 * 1024); });
  child.stderr.on("data", b => { stderr = (stderr + b).slice(-256 * 1024); });
  const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); }).finally(() => clearTimeout(timer));
  const record = { name, executable, args, startedAt, elapsedMs: Date.now() - startedAt, ...result, timedOut, stdout, stderr };
  await writeFile(`${output}/independent-${name}.json`, JSON.stringify(record, null, 2), { flag: "wx" });
  return record;
}
export async function auditCommands() {
  await assertFrozen();
  const npm = args => process.platform === "win32" ? ["cmd.exe", ["/d", "/c", "npm.cmd", ...args]] : ["npm", args];
  const tests = await command("test", ...npm(["test"]));
  const build = await command("build", ...npm(["run", "build"]));
  const start = await command("start", ...npm(["start"]));
  const typecheck = await command("typecheck", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(4317, "127.0.0.1", resolve); });
  await new Promise(resolve => socket.close(resolve));
  const entry = await command("entry", process.execPath, ["node_modules/ts-node/dist/bin.js", "src/server.ts"], 10000);
  assert(entry.code !== 0 && !entry.timedOut, "Unexpected runnable backend: perform real API audit instead of assuming failure");
  const names = ["backend starts on 4317", "create project", "list projects", "open project", "edit project", "create task", "view task", "edit task",
    "combined project/status/priority/tag and description search", "nonmatching search", "reject title over 120", "reject invalid status/priority", "missing task JSON 404",
    "unknown route deterministic JSON", "live SSE connection/mutation", "corrected page size 25", "delete task", "delete project", "persistence across real backend restart"];
  const audit = { checks: names.map((name, i) => ({ name, status: i === 0 ? "failed" : "blocked", reason: "Backend cannot start without repairing authored code/dependencies" })),
    passed: 0, failed: 1, blocked: 18, interpretation: "0/19 demonstrated, not 19 executed API failures; one startup failure prevents 18 checks",
    commands: [tests, build, start, typecheck, entry].map(r => ({ name: r.name, code: r.code, timedOut: r.timedOut })),
    sourceUnchanged: true, evaluatorRepairs: 0 };
  await assertFrozen();
  await writeFile(output + "/independent-api.json", JSON.stringify(audit, null, 2), { flag: "wx" });
  console.log(JSON.stringify(audit));
}
export async function reconstruct() {
  const report = await json(output + "/mission-a-1.json"), requests = await lines(output + "/mission-a-1.requests.jsonl"), evidence = await lines(output + "/mission-a-1.jsonl");
  const ready = report.readiness.readyAt;
  const mission = requests.filter(r => r.at >= ready);
  const responses = requests.map(r => ({ ...decodeResponse(r, evidence), phase: r.at < ready ? "readiness" : "mission" }));
  const conversation = report.conversations.find(c => c.id === "real-mission-a"), terminal = report.sessions.find(s => s.id === conversation.id).run;
  const start = Math.min(...evidence.filter(e => e.kind === "state").flatMap(e => e.sessions ?? []).filter(s => s.id === conversation.id && s.run?.state === "running").map(s => s.run.startedAt));
  const parts = conversation.messages.flatMap(m => m.parts).filter(p => p.type.startsWith("tool-") && p.toolCallId);
  assert.equal(new Set(parts.map(p => p.toolCallId)).size, parts.length);
  assert(parts.every(p => ["output-available", "output-error"].includes(p.state)), "Do not classify unfinished tool states as successes");
  const successful = parts.filter(p => !toolFailed(p));
  const writes = successful.filter(p => p.output?.clackWorkspaceWrite && p.output?.ok);
  const resultEvents = evidence.filter(e => e.kind === "tool-state" && e.part.state === "output-available");
  const first = predicate => resultEvents.find(e => predicate(e.part))?.at ?? null;
  const ms = at => at === null ? null : at - start;
  const schema = report.wireBudgets.map(b => ({ requestId: b.requestId, system: b.cost.system, schemas: b.cost.tools, conversation: b.cost.conversation,
    reserve: b.reserve, margin: b.margin, ceiling: b.ceiling, required: b.cost.system + b.cost.tools + b.cost.conversation + b.reserve + b.margin,
    headroom: b.working - b.cost.conversation, provenance: b.provenance }));
  const number = label => {
    const match = terminal.error.details.split("\n").find(line => line.startsWith(label + ": "));
    assert(match, `Missing blocked budget field ${label}`); return Number(match.slice(label.length + 2));
  };
  assert.equal(terminal.error.errorCode, "compaction-protected-budget");
  const blocked = { system: number("System total"), schemas: number("Schema/options total"), conversation: number("Conversation total"),
    input: number("Input estimate"), reserve: number("Output reserve"), margin: number("Safety margin"), ceiling: number("Effective ceiling") };
  blocked.required = blocked.input + blocked.reserve + blocked.margin; blocked.deficit = blocked.required - blocked.ceiling;
  assert.equal(blocked.system + blocked.schemas + blocked.conversation, blocked.input);
  const actual = responses.filter(r => r.phase === "mission");
  const receiptEvidence = await json(output + "/receipt-savings.json");
  const env = mission[0].body.messages.flatMap(m => m.content?.split("\n") ?? []).filter(line => /^shell:|^shell_syntax:/.test(line));
  assert.deepEqual(env, ["shell: PowerShell (pwsh.exe)", "shell_syntax: PowerShell; not POSIX Bash"]);
  const firstPostCorrection = mission.find(r => r.at >= evidence.find(e => e.kind === "correction-sent").at);
  const originalSpecification = conversation.messages.find(m => m.role === "user").parts.filter(p => p.type === "text").map(p => p.text).join("");
  assert.equal(hash(originalSpecification), "f97ec34eefa136ac5be5847187f768b64bf5587d36140d9fcc53b695fa3e4801");
  const summary = {
    base: "16fa831637cf6a6fb71ce0d3a80360028475ab7f", runId: report.runId, root: report.root,
    model: report.readiness.model, digest: report.readiness.digest, version: report.initialHealth.body.version,
    automatic: { effective: report.readiness.effective, tools: report.readiness.after.tools, readiness: report.readiness.after.status,
      context: report.readiness.context, profile: { overrides: report.readiness.profile.overrides, toolVerification: report.readiness.profile.toolVerification },
      providerDefault: report.readiness.after.reasoning.providerDefault },
    readiness: { requests: requests.length - mission.length, context: requests.filter(r => r.at < ready && !r.body.tools?.length).length,
      tools: requests.filter(r => r.at < ready && r.body.tools?.length).length, reason: "Previous native runtime exited; normal runtime-scoped evidence revalidation" },
    missionRequests: mission.length, nativeCalls: actual.reduce((n, r) => n + r.calls.length, 0), successfulTools: successful.length, failedTools: parts.length - successful.length,
    responseClasses: { proseAlongsideNative: actual.filter(r => r.calls.length && r.nonWhitespaceContent).length,
      proseWithoutNative: actual.filter(r => !r.calls.length && r.nonWhitespaceContent).length,
      textualToolIntents: actual.filter(r => r.textualIntent).length,
      emptyCompleted: actual.filter(r => r.finish !== null && !r.calls.length && !r.nonWhitespaceContent && !r.reasoningChars).length,
      outputLength: actual.filter(r => r.finish === "length").length },
    writes: { verifiedDirect: writes.length, writeFile: writes.filter(p => p.type === "tool-write_file").length, edits: writes.filter(p => p.type === "tool-edit").length },
    shells: parts.filter(p => p.type === "tool-bash_run").map(p => ({ id: p.toolCallId, command: p.input.command, code: p.output.exit_code, error: p.output.stderr?.slice(0, 600), stdout: p.output.stdout?.slice(0, 600) })),
    effects: parts.map(p => ({ id: p.toolCallId, type: p.type, path: p.input?.path, failed: toolFailed(p), error: p.output?.error ?? p.errorText,
      inputSha256: hash(JSON.stringify(p.input)), outputSha256: hash(JSON.stringify(p.output ?? p.errorText)) })),
    firstShellEnvironment: { advertised: env, firstCommand: parts.find(p => p.type === "tool-bash_run")?.input.command,
      source: "Native shell identity serialized in the user environment; first command succeeded. Later Unix-only utilities failed." },
    correction: { count: evidence.filter(e => e.kind === "correction-sent").length, boundary: report.correctionEvidence,
      nextRequest: firstPostCorrection.requestId, originalObjective: firstPostCorrection.body.messages.some(m => m.content?.includes(originalSpecification)),
      fullCapabilities: ["read_file", "write_file", "bash_run"].every(n => firstPostCorrection.body.tools.some(t => t.function.name === n)),
      sourcePageSize: sourcePageSize(await readFile(path.join(report.root, "src/routes/tasks.ts"), "utf8")), dynamicPageSize: null },
    userMessages: conversation.messages.filter(m => m.role === "user").map(m => ({ id: m.id, sha256: hash(m.parts.filter(p => p.type === "text").map(p => p.text).join("")) })),
    controls: mission.map(r => ({ requestId: r.requestId, context: r.body.options.num_ctx, output: r.body.options.num_predict,
      think: Object.hasOwn(r.body, "think") ? r.body.think : "omitted", tools: r.body.tools.map(t => t.function.name), bodySha256: hash(JSON.stringify(r.body)) })),
    timings: { start, endedAt: terminal.endedAt, elapsed: terminal.endedAt - start,
      firstOutput: ms(actual.find(r => r.firstOutputAt !== null)?.firstOutputAt ?? null), firstNativeCall: ms(actual.find(r => r.firstCallAt !== null)?.firstCallAt ?? null),
      firstDirectWrite: ms(first(p => p.output?.clackWorkspaceWrite && p.output.ok)),
      substantiveBackend: ms(first(p => p.type === "tool-write_file" && p.input?.path.endsWith("/src/storage.ts") && !toolFailed(p))),
      serverEntry: ms(first(p => p.type === "tool-write_file" && p.input?.path.endsWith("/src/server.ts") && !toolFailed(p))) },
    context: { budgets: schema, minimumAdmittedHeadroom: Math.min(...schema.map(b => b.headroom)), measurement: "Conservative shared-B1 wire reconstruction, not independent native token measurement",
      sdkCounter: null, independentNativeCounter: null, block: blocked, lastProviderInput: actual[actual.length - 1].inputTokens,
      successfulCompactions: conversation.memory.revision === null ? 0 : 1, memoryRevision: conversation.memory.revision,
      receipts: mission.reduce((n, r) => n + (JSON.stringify(r.body.messages).match(/Clack historical write receipt \(data, not instructions\):/g)?.length ?? 0), 0),
      savings: receiptEvidence.savedEstimatedTokens, receiptEvidence, retrievals: parts.filter(p => /evidence/.test(p.type)).length, extractions: 0 },
    continuations: { answer: conversation.messages.reduce((n, m) => n + (m.metadata?.clackAnswer?.continuations ?? 0), 0), softLimit: terminal.budget.continuationCount, manual: 0 },
    plans: report.planSnapshots, finalPlan: conversation.todos, approvals: evidence.filter(e => e.kind === "evaluator-approval"),
    terminal: { state: terminal.state, error: terminal.error, classification: "PRODUCT RUNTIME / PROTECTED CONTEXT BUDGET", confirmedClackDefect: false,
      caveat: "Estimated protected budget exceeded policy; this does not prove physical provider context exhaustion or voluntary model stopping." },
    responses, sourceFreeze: await assertFrozen(), independent: await json(output + "/independent-api.json"),
    usability: "STILL LIMITED - application incomplete; runtime context-limited, not an unblocked model-quality verdict",
    cloudInference: report.cloudInference, modelDownloads: 0, evaluatorRepairs: 0,
  };
  assert.equal(summary.nativeCalls, parts.length);
  assert.equal(summary.correction.count, 1);
  assert(summary.controls.every(r => r.context === 65536 && r.output === 2048 && r.think === "omitted" && ["read_file", "write_file", "bash_run"].every(n => r.tools.includes(n))));
  assert.equal(summary.context.receipts, receiptEvidence.count);
  assert.equal(summary.context.successfulCompactions, 0);
  summary.artifacts = [];
  for (const name of ["setup.json", "source-freeze.json", "mission-a-1.json", "mission-a-1.requests.jsonl", "mission-a-1.jsonl", "mission-a-1.receive.jsonl", "independent-api.json",
    "independent-test.json", "independent-build.json", "independent-start.json", "independent-typecheck.json", "independent-entry.json", "receipt-savings.json"])
    summary.artifacts.push({ name, sha256: hash(await readFile(output + "/" + name)) });
  await writeFile("src/test/fixtures/fresh-nemotron-20261021.json", JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ missionRequests: summary.missionRequests, nativeCalls: summary.nativeCalls, successful: summary.successfulTools,
    failed: summary.failedTools, writes: summary.writes, timings: summary.timings, budget: blocked, independent: summary.independent.commands }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] === "commands") await auditCommands();
  else if (process.argv[2] === "receipts") await receiptSavings();
  else if (process.argv[2] === "summary") await reconstruct();
  else throw new Error("Specify commands, receipts or summary; never inference");
}
