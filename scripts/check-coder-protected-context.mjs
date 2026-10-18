import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createServer } from "vite";
import { convertToModelMessages } from "ai";

const source = path.resolve("src-tauri/target/real-qwen-product/forgeboard-qwen3coder-20261018-02");
const destination = path.resolve("src-tauri/target/protected-context-20261018");
const attempt = process.argv[2] ?? "analysis-2";
assert(/^[a-z0-9-]+$/.test(attempt));
await mkdir(destination, { recursive: true });
const read = async name => JSON.parse(await readFile(path.join(source, name), "utf8"));
const report = await read("mission-a-1.json");
const requests = (await readFile(path.join(source, "mission-a-1.requests.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
assert.equal(requests.length, 17);
const body17 = requests.at(-1).body;
const conversation = report.conversations.find(item => item.id === "real-mission-a");
const assistant = conversation.messages.find(message => message.role === "assistant");
const converted = await convertToModelMessages([assistant]);
const user = { role: "user", content: [{ type: "text", text: body17.messages.find(message => message.role === "user").content }] };
const system = body17.messages.filter(message => message.role === "system");
const limits = { deployed: 32768, maxOutput: 2048, outputReserve: 2048 };
const params = prompt => ({ prompt, maxOutputTokens: 2048, providerOptions: { ollama: { numCtx: 32768, think: false } }, tools: body17.tools.map(tool => ({ type: "function", name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters })) });
const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: "custom" });
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Network requests are forbidden in this offline investigation"); };
try {
  const { measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
  const { ollamaBody } = await vite.ssrLoadModule("/src/modules/ai/lib/ollamaModel.ts");
  const { planCompaction, groupCompactionUnits } = await vite.ssrLoadModule("/src/modules/ai/lib/compactionPlan.ts");
  const { compactVerifiedWrites, confirmWriteSources, verifiedWriteCandidates } = await vite.ssrLoadModule("/src/modules/ai/lib/verifiedWriteHistory.ts");
  const { contextDigest } = await vite.ssrLoadModule("/src/modules/ai/lib/targetContext.ts");
  const latestCall = assistant.parts.filter(part => part.type.startsWith("tool-")).at(-1).toolCallId;
  const extra17 = converted.filter(message => !Array.isArray(message.content) || !message.content.some(part => part.toolCallId === latestCall));
  const model17 = [...system, user, ...extra17];
  const model18 = [...system, user, ...converted];
  const reconstructed17 = ollamaBody(body17.model, params(model17), true);
  const lastPair = structuredClone(converted.slice(-2));
  const resultValue = lastPair[1].content[0].output.value;
  lastPair[1].content[0].output.value = { path: resultValue.path, bytesWritten: resultValue.bytesWritten, ok: resultValue.ok, clackWorkspaceWrite: resultValue.clackWorkspaceWrite };
  const body18 = { ...body17, messages: [...body17.messages, ...ollamaBody(body17.model, params(lastPair), true).messages] };
  const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const normalized = body => ({ ...body, messages: body.messages.map(message => message.role === "tool" ? { ...message, content: canonical(JSON.parse(message.content)) } : message) });
  const same17 = canonical(normalized(reconstructed17)) === canonical(normalized(body17));
  const budget = messages => resolveContextBudget(limits, measureRequest({ messages, tools: body17.tools }));
  const units = [{ messageId: conversation.messages[0].id, role: "user", messages: [user], hasContentReferences: false }];
  let plan;
  try { const result = planCompaction({ units, system, tools: body17.tools, extra: converted, limits }); plan = { needed: result.needed, tailStart: result.tailStart, groups: result.groups, budget: result.budget }; }
  catch (error) { plan = { code: error.code, message: error.message, budget: error.budget, groups: groupCompactionUnits(units) }; }
  const cost = messages => measureRequest({ messages }).conversation;
  const successfulWrites = assistant.parts.filter(part => part.type === "tool-write_file" && part.output?.ok === true);
  const pairs = assistant.parts.filter(part => part.type.startsWith("tool-")).map(part => {
    const call = converted.find(message => message.role === "assistant" && message.content.some(item => item.toolCallId === part.toolCallId));
    const result = converted.find(message => message.role === "tool" && message.content.some(item => item.toolCallId === part.toolCallId));
    const callPart = call.content.find(item => item.toolCallId === part.toolCallId);
    const resultPart = result.content.find(item => item.toolCallId === part.toolCallId);
    const empty = role => cost([{ role, content: [] }]);
    const callCost = cost([{ role: "assistant", content: [callPart] }]);
    const resultCost = cost([{ role: "tool", content: [resultPart] }]);
    return { id: part.toolCallId, name: part.type.slice(5), path: part.input?.path, confirmed: part.output?.ok === true && part.output?.clackWorkspaceWrite === true,
      failed: !!part.output?.error, callCost, resultCost, pairCost: callCost + resultCost,
      bodyTokens: typeof part.input?.content === "string" ? measureRequest({ messages: [{ role: "assistant", content: part.input.content }] }).conversation - measureRequest({ messages: [{ role: "assistant", content: "" }] }).conversation : 0,
      framing: empty("assistant") + empty("tool"), output: part.output };
  });
  const textCost = text => cost([{ role: "assistant", content: text }]) - cost([{ role: "assistant", content: "" }]);
  const prose = converted.flatMap(message => message.role === "assistant" ? message.content.filter(part => part.type === "text") : []);
  const proseCost = prose.reduce((sum, part) => sum + cost([{ role: "assistant", content: [part] }]) - cost([{ role: "assistant", content: [] }]), 0);
  const pairCost = pairs.reduce((sum, pair) => sum + pair.pairCost, 0);
  const accounting = {
    originalSpecification: textCost(conversation.messages[0].parts[0].text),
    userEnvironmentAndFraming: cost([user]) - textCost(conversation.messages[0].parts[0].text),
    userTotal: cost([user]),
    assistantProseText: prose.reduce((sum, part) => sum + textCost(part.text), 0),
    assistantProseWithMetadata: proseCost,
    toolCallsWithFraming: pairs.reduce((sum, pair) => sum + pair.callCost, 0),
    toolResultsWithFraming: pairs.reduce((sum, pair) => sum + pair.resultCost, 0),
    toolPairFraming: pairs.reduce((sum, pair) => sum + pair.framing, 0),
    extraTotal: cost(converted),
    extraProseMetadataAndSharedFraming: cost(converted) - pairCost,
    sharedFramingOutsidePairsAndProse: cost(converted) - pairCost - proseCost,
  };
  const providerFrames = (await readFile(path.join(source, "mission-a-1.jsonl"), "utf8")).trim().split("\n").map(JSON.parse).filter(event => event.kind === "engine-finish");
  const calibration = requests.map(request => {
    const wire = resolveContextBudget(limits, measureRequest(request.body));
    const actual = providerFrames.find(frame => frame.requestId === request.requestId).metrics.prompt_eval_count;
    const input = wire.cost.system + wire.cost.tools + wire.cost.conversation;
    return { requestId: request.requestId, estimatedInput: input, nativeBytes: Buffer.byteLength(JSON.stringify(request.body)), actualInput: actual, ratio: input / actual };
  });
  const storedBytes = await readFile(path.join(source, "data/terax-ai-sessions.json"));
  assert.equal(createHash("sha256").update(storedBytes).digest("hex"), "cb72a3400ccaa9b4f05f57bf1e3546421d742e3caeb54125e7d8b765e5a7b80d");
  const stored = JSON.parse(storedBytes)["messages:real-mission-a"];
  assert.equal(canonical(stored), canonical(conversation.messages));
  const verifiedSources = await confirmWriteSources({ candidates: verifiedWriteCandidates(converted), messages: conversation.messages, workspaceRoot: report.root, sessionId: "real-mission-a",
    check: () => {}, persist: async snapshot => { assert.equal(canonical(snapshot), canonical(stored)); },
    inspect: async locators => Promise.all(locators.map(async locator => {
      assert.equal(locator.kind, "part");
      const part = stored.find(message => message.id === locator.messageId).parts[locator.partIndex];
      return { id: `offline:${locator.partIndex}`, sourceRevision: 32, locator, digest: await contextDigest(part), contentIds: [], relatedSessions: ["real-mission-a"] };
    })),
  });
  const optimized = planCompaction({ units, system, tools: body17.tools, extra: converted, limits, verifiedWriteSources: verifiedSources });
  const optimizedBody = ollamaBody(body17.model, params(optimized.messages), true);
  const restoredProjection = compactVerifiedWrites(converted, verifiedSources, [optimized.toolReceipts[0].toolCallId]);
  const originalCallId = optimized.toolReceipts[0].toolCallId;
  for (const message of converted.filter(message => message.content.some(part => part.toolCallId === originalCallId)))
    assert(restoredProjection.messages.some(restored => canonical(restored) === canonical(message)));
  const files = await Promise.all(successfulWrites.map(async part => {
    const current = await readFile(part.input.path);
    const sha = bytes => createHash("sha256").update(bytes).digest("hex");
    const relative = path.relative(report.root, part.input.path).replaceAll("\\", "/");
    const git = spawnSync("git", ["--no-optional-locks", "-C", report.root, "status", "--porcelain", "--untracked-files=all", "--", relative], { encoding: "utf8" });
    assert.equal(git.status, 0, git.stderr);
    return { toolCallId: part.toolCallId, path: part.input.path, bytes: current.length, sha256: sha(current), intendedContentSha256: sha(part.input.content), matchesHistoricalWrite: sha(current) === sha(part.input.content), gitStatus: git.stdout.trim(), historicalResult: part.output };
  }));
  const output = { source, latestCall, same17, serializedToolResultOrderingPreservedByCaptureOnly: true, model17: budget(model17), model18: budget(model18), wire17: resolveContextBudget(limits, measureRequest(body17)), wire18: resolveContextBudget(limits, measureRequest(body18)), wire17Bytes: Buffer.byteLength(JSON.stringify(body17)), wire18Bytes: Buffer.byteLength(JSON.stringify(body18)), accounting, modelMessages: converted, pairs, successfulWrites: successfulWrites.length, files, calibration, plan,
    optimized: { budget: optimized.budget, needed: optimized.needed, tailStart: optimized.tailStart, receipts: optimized.toolReceipts, wireBudget: resolveContextBudget(limits, measureRequest(optimizedBody)), wireBytes: Buffer.byteLength(JSON.stringify(optimizedBody)), exactSourceRestoration: true },
    sourceVerification: "offline replay of native part-digest semantics against the preserved, SHA256-validated session snapshot; no live IPC", inferenceRequests: 0, toolsExecuted: 0 };
  await writeFile(path.join(destination, `${attempt}.json`), JSON.stringify(output, null, 2), { flag: "wx" });
  await writeFile(path.join(destination, `${attempt}-request-18.native.json`), JSON.stringify(body18, null, 2), { flag: "wx" });
  await writeFile(path.join(destination, `${attempt}-request-18.optimized.json`), JSON.stringify(optimizedBody, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ ...output, modelMessages: undefined, pairs: undefined, files: undefined, optimized: { ...output.optimized, receipts: output.optimized.receipts.map(receipt => ({ toolCallId: receipt.toolCallId, sourceBytes: receipt.sourceBytes })) }, calibration: [calibration[0],calibration[8],calibration[16]] }, null, 2));
  assert(same17, "Reconstruction must match the captured native request 17 before drawing conclusions");
  assert.equal(output.model18.cost.system + output.model18.cost.tools + output.model18.cost.conversation + output.model18.margin + output.model18.reserve, 33900);
} finally {
  globalThis.fetch = previousFetch;
  await vite.close();
}
