import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const hash = value => createHash("sha256").update(value).digest("hex");
const lines = text => text.trim().split("\n").filter(Boolean).map(JSON.parse);
export function reconstructHardenedRun(report, requests, evidence) {
  const ready = report.readiness.readyAt;
  const mission = requests.filter(r => r.at >= ready);
  const conversation = report.conversations.find(c => c.id === "real-mission-a");
  assert(conversation);
  const firstRun = evidence.filter(e => e.kind === "state").flatMap(e => e.sessions)
    .find(s => s.id === "real-mission-a" && s.run?.state === "running").run;
  const start = firstRun.startedAt;
  const responses = requests.map(request => {
    const chunks = evidence.filter(e => e.kind === "hardened-native-event" && e.event.requestId === request.requestId);
    let pending = "", text = "", thinking = "", firstOutputAt = null, firstToolAt = null, final;
    const calls = [];
    const decoder = new TextDecoder();
    for (const event of chunks) {
      if (event.event.kind !== "chunk") continue;
      pending += decoder.decode(Uint8Array.from(event.event.bytes), { stream: true });
      const frames = pending.split("\n"); pending = frames.pop();
      for (const raw of frames.filter(Boolean)) {
        const frame = JSON.parse(raw);
        text += frame.message?.content ?? "";
        thinking += frame.message?.thinking ?? "";
        if (frame.message?.content || frame.message?.thinking || frame.message?.tool_calls?.length) firstOutputAt ??= event.at;
        if (frame.message?.tool_calls?.length) {
          firstToolAt ??= event.at;
          calls.push(...frame.message.tool_calls.map(c => ({ name: c.function.name, argumentsSha256: hash(JSON.stringify(c.function.arguments)) })));
        }
        if (frame.done) final = frame;
      }
    }
    assert(!pending.trim(), "Incomplete native response frame");
    return { requestId: request.requestId, stage: request.at < ready ? "readiness" : "mission", at: request.at,
      firstOutputAt, firstToolAt, calls, textChars: text.length, thinkingChars: thinking.length,
      textualToolIntents: [...text.matchAll(/<tool_call>/g)].length,
      textualToolExcerpt: text.includes("<tool_call>") ? text.slice(text.indexOf("<tool_call>"), text.indexOf("<tool_call>") + 180) : undefined,
      finish: final?.done_reason ?? null, inputTokens: final?.prompt_eval_count ?? null, outputTokens: final?.eval_count ?? null,
      contentSha256: hash(text), settled: chunks.findLast(e => e.event.kind === "settled")?.event.phase ?? null };
  });
  const parts = conversation.messages.flatMap(m => m.parts).filter(p => p.type.startsWith("tool-") && p.toolCallId);
  assert.equal(new Set(parts.map(p => p.toolCallId)).size, parts.length);
  const success = parts.filter(p => p.state === "output-available" && !p.output?.error);
  const writes = success.filter(p => p.type === "tool-write_file" && p.output?.clackWorkspaceWrite && p.output.ok);
  const mutations = success.filter(p => p.output?.clackWorkspaceWrite && p.output.ok);
  const observed = evidence.filter(e => e.kind === "tool-state" && e.part.state === "output-available");
  const firstWriteAt = Math.min(...observed.filter(e => writes.some(p => p.toolCallId === e.part.toolCallId)).map(e => e.at));
  const ms = at => at === null || at === undefined || !Number.isFinite(at) ? null : at - start;
  const terminal = report.sessions.find(s => s.id === "real-mission-a").run;
  const budgets = report.wireBudgets.map(b => ({ requestId: b.requestId, provenance: b.provenance, system: b.cost.system, schemas: b.cost.tools,
    conversation: b.cost.conversation, input: b.cost.system + b.cost.tools + b.cost.conversation,
    reserve: b.reserve, margin: b.margin, context: b.ceiling,
    required: b.cost.system + b.cost.tools + b.cost.conversation + b.reserve + b.margin,
    headroom: b.working - b.cost.conversation }));
  const actual = responses.filter(r => r.stage === "mission");
  const text = conversation.messages.flatMap(m => m.parts.filter(p => p.type === "text").map(p => p.text)).join("");
  assert(mission.every(r => !JSON.stringify(r.body.messages).includes("Clack historical write receipt (data, not instructions):")), "Receipt savings require separate reconstruction");
  return { model: report.readiness.model, digest: report.readiness.digest, serverVersion: report.initialHealth.body.version,
    connection: { type: "existing user SSH tunnel / direct production self-hosted endpoint", endpoint: report.readiness.endpoint.baseURL,
      logicalEndpoint: report.readiness.endpoint.id, lazyReconnectRequired: false, managedPort: null, manualPort: 11435 },
    automatic: { context: report.readiness.context, providerDefault: report.readiness.after.reasoning.providerDefault,
      agentRecommendation: report.readiness.after.reasoning.agentRecommendation.configuration, effective: report.readiness.effective,
      tools: report.readiness.after.tools, calibration: report.readiness.profile.contextCalibration.attempts },
    readinessRequests: responses.filter(r => r.stage === "readiness").length, missionRequests: mission.length,
    structuredCalls: actual.reduce((n, r) => n + r.calls.length, 0), successfulTools: success.length,
    failedTools: parts.length - success.length, fileWrites: writes.length, successfulMutations: mutations.length,
    directoryCreations: success.filter(p => p.type === "tool-create_directory").length,
    shellCalls: parts.filter(p => p.type === "tool-bash_run").length,
    textualToolIntents: actual.reduce((n, r) => n + r.textualToolIntents, 0),
    userMessages: conversation.messages.filter(m => m.role === "user").map(m => ({ id: m.id, sha256: hash(m.parts.filter(p => p.type === "text").map(p => p.text).join("")) })),
    correction: { sent: evidence.filter(e => e.kind === "correction-sent").length, boundary: report.correctionEvidence },
    toolsByRequest: mission.map(r => ({ requestId: r.requestId, tools: r.body.tools?.map(t => t.function.name) ?? [],
      context: r.body.options.num_ctx, output: r.body.options.num_predict,
      think: Object.hasOwn(r.body, "think") ? r.body.think : "omitted", bodySha256: hash(JSON.stringify(r.body)) })),
    timingsMs: { missionStartedAt: start, missionEndedAt: terminal.endedAt, elapsed: terminal.endedAt - start,
      firstOutput: ms(actual.find(r => r.firstOutputAt !== null)?.firstOutputAt), firstNativeTool: ms(actual.find(r => r.firstToolAt !== null)?.firstToolAt),
      firstConfirmedMutation: ms(firstWriteAt), backendEntry: ms(observed.find(e => e.part.input?.path?.endsWith("/backend/src/server.ts"))?.at),
      datastore: ms(observed.find(e => e.part.input?.path?.endsWith("/backend/src/datastore.ts"))?.at),
      substantiveFrontend: null, modelTests: null, modelPassingTest: null, modelBuild: null },
    continuations: { answer: conversation.messages.reduce((n, m) => n + (m.metadata?.clackAnswer?.continuations ?? 0), 0), agentSoftLimit: terminal.budget.continuationCount,
      manual: 0, objectiveForgeBoardPresentInContinuation: text.includes("ForgeBoard") },
    context: { budgets, minimumReconstructedWireHeadroom: Math.min(...budgets.map(b => b.headroom)),
      directSdkHeadroom: null, directNativeAcknowledgementHeadroom: null,
      telemetryLimit: "Numeric pre-serialization SDK and native-ack budgets were not separately retained; wire budgets are shared-B1 offline reconstruction, not independent measured native counters.",
      confirmedWriteResults: writes.length, receiptSubstitutions: 0, receiptSavingsTokens: 0,
      compactions: conversation.memory.revision === null ? 0 : 1,
      retrievals: parts.filter(p => /evidence/.test(p.type)).length, extractions: 0, protectedBlock: false },
    terminal: { state: terminal.state, phase: terminal.budget.phase, rawFinish: terminal.budget.lastFinishReason, stopReason: terminal.budget.stopReason,
      classification: "MODEL-INCOMPLETE / TEXTUAL TOOL INTENT / PREMATURE STOP", providerBoundary: "Ollama returned tool markup as message.content with no native tool_calls; inner model/parser cause is not established.",
      confirmedClackDefect: false, harnessBlocked: report.harnessStop ?? null },
    responses, cloudInference: report.cloudInference, modelDownloads: 0, remoteMutations: 0 };
}

async function apiAudit(root, output) {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(4317, "127.0.0.1", resolve); });
  await new Promise(resolve => probe.close(resolve));
  const children = [];
  const checks = [];
  const call = async (route, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:4317${route}`, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = null; }
    return { status: response.status, json: data, type: response.headers.get("content-type"), body: text.slice(0, 200) };
  };
  const start = async () => {
    const child = spawn(process.execPath, ["backend/dist/server.js"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child); let log = "";
    child.stdout.on("data", b => { log += b; }); child.stderr.on("data", b => { log += b; });
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Generated entry failed: " + log);
      try { if ((await call("/health")).status === 200) return child; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Generated entry startup bound");
  };
  const stop = async child => { if (child.exitCode === null && child.signalCode === null) { const done = new Promise(resolve => child.once("exit", resolve)); child.kill(); await done; } };
  const check = (name, passed, evidence) => checks.push({ name, passed, evidence });
  try {
    const first = await start(); check("emitted backend entry starts on 4317", true, { command: "node backend/dist/server.js", builtDespiteTypeErrors: true });
    const project = await call("/projects", "POST", { name: "Independent audit", description: "Restart probe" });
    const id = project.json?.data?.id; check("create project", project.status === 201 && !!id, project);
    check("list projects", (await call("/projects")).json?.data?.some(p => p.id === id), {});
    check("open project", (await call(`/projects/${id}`)).status === 200, {});
    check("edit project", (await call(`/projects/${id}`, "PUT", { name: "Audited" })).json?.data?.name === "Audited", {});
    const task = await call("/tasks", "POST", { projectId: id, title: "Search alpha", description: "Needle", status: "Todo", priority: "High", tags: ["audit"] });
    const taskId = task.json?.data?.id; check("create task", task.status === 201 && !!taskId, task);
    check("view task", (await call(`/tasks/${taskId}`)).status === 200, {});
    check("edit task", (await call(`/tasks/${taskId}`, "PUT", { title: "Changed alpha" })).json?.data?.title === "Changed alpha", {});
    await call("/tasks", "POST", { projectId: id, title: "Other", description: "Different", status: "Done", priority: "Low", tags: ["other"] });
    const combined = await call(`/tasks?projectId=${id}&status=Todo&priority=High&tags=audit&search=Needle`);
    check("combined filters and description search", combined.json?.data?.tasks?.length === 1 && combined.json.data.tasks[0].id === taskId, combined);
    const unmatched = await call(`/tasks?projectId=${id}&search=no-match-anywhere`);
    check("nonmatching search", unmatched.json?.data?.tasks?.length === 0, unmatched);
    check("reject title over 120", (await call("/tasks", "POST", { projectId: id, title: "x".repeat(121) })).status === 400, {});
    const invalidStatus = await call("/tasks", "POST", { projectId: id, title: "Invalid enum", status: "nonsense", priority: "nonsense", tags: [] });
    check("reject invalid status/priority", invalidStatus.status === 400, invalidStatus);
    check("missing task JSON 404", (await call("/tasks/missing")).status === 404, {});
    const absent = await call("/route-not-found"); check("unknown route deterministic JSON", absent.status === 404 && absent.json !== null, absent);
    const events = await call("/events"); check("SSE endpoint", events.status === 200 && events.type?.startsWith("text/event-stream"), events);
    for (let n = 0; n < 26; n++) await call("/tasks", "POST", { projectId: id, title: `Page ${n}`, status: "Todo", priority: "Low", tags: [] });
    const page = await call(`/tasks?projectId=${id}`); check("corrected default page size 25", page.json?.data?.pageSize === 25 && page.json.data.tasks.length === 25, { pageSize: page.json?.data?.pageSize, count: page.json?.data?.tasks?.length });
    const deletable = await call("/tasks", "POST", { projectId: id, title: "Delete me", status: "Todo", priority: "Low", tags: [] });
    check("delete task", (await call(`/tasks/${deletable.json.data.id}`, "DELETE")).status === 200 && (await call(`/tasks/${deletable.json.data.id}`)).status === 404, {});
    const another = await call("/projects", "POST", { name: "Delete project" });
    check("delete project", (await call(`/projects/${another.json.data.id}`, "DELETE")).status === 200 && (await call(`/projects/${another.json.data.id}`)).status === 404, {});
    await stop(first); await start();
    const restoredProject = await call(`/projects/${id}`), restoredTask = await call(`/tasks/${taskId}`);
    check("persistence across real backend restart", restoredProject.status === 200 && restoredTask.status === 200, { project: restoredProject, task: restoredTask });
  } finally { for (const child of children) await stop(child); }
  await writeFile(path.join(output, "independent-api.json"), JSON.stringify({ checks, passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).length }, null, 2));
  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = path.resolve(process.argv[2]);
  assert.equal(path.basename(output), "forgeboard-qwen-hardened-20261021-01");
  if (process.argv[3] === "api") {
    const checks = await apiAudit(path.join(output, "independent-project"), output);
    console.log(JSON.stringify({ checks: checks.length, passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).map(c => c.name) }));
  } else {
    const report = JSON.parse(await readFile(path.join(output, "mission-a-1.json"), "utf8"));
    const summary = reconstructHardenedRun(report, lines(await readFile(path.join(output, "mission-a-1.requests.jsonl"), "utf8")), lines(await readFile(path.join(output, "mission-a-1.jsonl"), "utf8")));
    summary.sourceFreeze = JSON.parse(await readFile(path.join(output, "source-freeze.json"), "utf8"));
    for (const file of summary.sourceFreeze.files) assert.equal(hash(await readFile(path.join(summary.sourceFreeze.root, file.path))), file.sha256);
    summary.postMissionFormatting = [];
    for (const file of JSON.parse(await readFile(path.join(output, "setup.json"), "utf8")).source) {
      const bytes = await readFile(file.path);
      if (hash(bytes) !== file.sha256 && file.path === "scripts/check-hardened-local-agent.mjs" && hash(Buffer.concat([bytes, Buffer.from("\n\n")])) === file.sha256)
        summary.postMissionFormatting.push({ path: file.path, before: file.sha256, after: hash(bytes), change: "Two trailing newlines removed after terminal outcome for git diff --check; executable content identical." });
      else assert.equal(hash(bytes), file.sha256, "Frozen executable source changed");
    }
    summary.independentApi = JSON.parse(await readFile(path.join(output, "independent-api.json"), "utf8"));
    const pagination = summary.independentApi.checks.find(c => c.name === "corrected default page size 25");
    summary.correction.finalBackendPageSize = pagination.evidence.pageSize;
    summary.correction.frontendPageSize = null;
    summary.artifacts = await Promise.all(["setup.json", "source-freeze.json", "mission-a-1.json", "mission-a-1.jsonl", "mission-a-1.requests.jsonl", "mission-a-1.receive.jsonl", "independent-api.json"].map(async name => ({ name, sha256: hash(await readFile(path.join(output, name))) })));
    summary.usability = "LOCAL AGENT USABILITY STILL LIMITED";
    await writeFile("src/test/fixtures/hardened-qwen-20261021.json", JSON.stringify(summary, null, 2) + "\n");
    console.log(JSON.stringify({ missionRequests: summary.missionRequests, structuredCalls: summary.structuredCalls, tools: summary.successfulTools, writes: summary.fileWrites, mutations: summary.successfulMutations, timings: summary.timingsMs, headroom: summary.context.minimumReconstructedWireHeadroom, terminal: summary.terminal }));
  }
}
