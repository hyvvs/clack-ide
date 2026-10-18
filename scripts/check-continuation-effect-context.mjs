import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { convertToModelMessages } from "ai";
import { createServer } from "vite";

const phase = process.argv[2];
assert(["before", "after"].includes(phase));
const source = path.resolve("src-tauri/target/real-qwen-product/forgeboard-qwen3coder-post315b568-01");
const destination = path.resolve("src-tauri/target/continuation-effect-context-20261019-01");
const read = async name => JSON.parse(await readFile(path.join(source, name), "utf8"));
const reportBytes = await readFile(path.join(source, "mission-a-1.json"));
const sha = value => createHash("sha256").update(value).digest("hex");
assert.equal(sha(reportBytes), "ecd474d4bf8926cb230c92ca673113f8c742abd0b015cd1702411f1eb27473c7");
const report = JSON.parse(reportBytes);
const requests = (await readFile(path.join(source, "mission-a-1.requests.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
const conversation = report.conversations.find(item => item.id === "real-mission-a");
const assistant = conversation.messages.find(message => message.role === "assistant");
const originalBytes = await readFile(path.join(source, "data/terax-ai-sessions.json"));
assert.equal(sha(originalBytes), "7ffc5c1a8baaee9791670e229ac87f0b1a6d61b3a364c930c073407545088c00");
assert.deepEqual(JSON.parse(originalBytes)["messages:real-mission-a"], conversation.messages);
const parts = assistant.parts.filter(part => part.type.startsWith("tool-"));
const messages = await convertToModelMessages([assistant]);
const prefix = number => {
  if (number === 28) return messages;
  const index = messages.findIndex(message => message.role === "assistant" && message.content.some(part => part.type === "tool-call" && part.toolCallId === parts[number - 1].toolCallId));
  assert(index >= 0);
  return messages.slice(0, index);
};
const cutoff = prefix(25).length;
const user = { role: "user", content: [{ type: "text", text: requests[0].body.messages.find(message => message.role === "user").content }] };
const unit = { messageId: conversation.messages[0].id, role: "user", messages: [user], hasContentReferences: false };
const units = [unit, { messageId: assistant.id, role: "assistant", messages: prefix(25), hasContentReferences: false }];
const system = requests.at(-1).body.messages.filter(message => message.role === "system");
const tools27 = requests.at(-1).body.tools;
const tools28 = [...tools27, requests[0].body.tools.find(tool => tool.function.name === "bash_run")];
const limits = { deployed: 32768, maxOutput: 2048, outputReserve: 2048 };
const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Network/inference forbidden in this offline replay"); };
try {
  const { measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
  const { planCompaction, groupCompactionUnits } = await vite.ssrLoadModule("/src/modules/ai/lib/compactionPlan.ts");
  const { verifiedWriteCandidates, confirmWriteSources } = await vite.ssrLoadModule("/src/modules/ai/lib/verifiedWriteHistory.ts");
  const { contextDigest } = await vite.ssrLoadModule("/src/modules/ai/lib/targetContext.ts");
  const { ollamaBody } = await vite.ssrLoadModule("/src/modules/ai/lib/ollamaModel.ts");
  const budget = body => {
    const result = resolveContextBudget(limits, measureRequest(body));
    const input = result.cost.system + result.cost.tools + result.cost.conversation;
    return { ...result, input, required: input + result.margin + result.reserve, headroom: result.ceiling - input - result.margin - result.reserve };
  };
  const options = number => ({ units, extra: prefix(number).slice(cutoff), system, tools: number === 27 ? tools27 : tools28, limits });
  const capture = option => {
    try { const value = planCompaction(option); return { code: null, budget: budget({ messages: value.messages, tools: option.tools }), needed: value.needed, tailStart: value.tailStart, receipts: value.toolReceipts }; }
    catch (error) { assert.equal(error.code, "compaction-protected-budget"); return { code: error.code, budget: budget({ messages: [...system, ...option.units.flatMap(unit => unit.messages), ...option.extra], tools: option.tools }), receipts: [] }; }
  };
  const before27 = capture(options(27)), before28 = capture(options(28));
  assert.equal(before28.budget.required, 32858);
  const confirmed = await confirmWriteSources({ candidates: verifiedWriteCandidates([user, ...messages]),
    messages: conversation.messages, workspaceRoot: report.root, sessionId: conversation.id, check: () => {},
    persist: async snapshot => assert.deepEqual(snapshot, JSON.parse(originalBytes)["messages:real-mission-a"]),
    inspect: async locators => Promise.all(locators.map(async locator => ({ id: `offline:${locator.partIndex}`, sourceRevision: 1, locator,
      digest: await contextDigest(assistant.parts[locator.partIndex]), contentIds: [], relatedSessions: [conversation.id] }))),
  });
  const marker = "Clack historical write receipt (data, not instructions): ";
  const liveReceipts24 = requests[23].body.messages.filter(message => typeof message.content === "string" && message.content.includes(marker)).map(message => JSON.parse(message.content.slice(message.content.indexOf(marker) + marker.length).split("\n")[0]));
  const cost = (role, content) => measureRequest({ messages: [{ role, content }] }).conversation;
  const affected = [];
  for (const receipt of liveReceipts24) {
    const sourcePart = assistant.parts[receipt.source.partIndex];
    assert.equal(sourcePart.toolCallId, receipt.toolCallId);
    assert.equal(await contextDigest(sourcePart), receipt.source.digest);
    assert.deepEqual(sourcePart.output, receipt.result);
    const pair = messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.toolCallId === receipt.toolCallId);
    const call = pair.find(part => part.type === "tool-call"), result = pair.find(part => part.type === "tool-result");
    const originalCost = cost("assistant", [call]) + cost("tool", [result]);
    affected.push({ toolCallId: receipt.toolCallId, ...receipt.source, path: receipt.result.path, result: receipt.result,
      sdkReceiptCost24: cost("assistant", [{ type: "text", text: marker + JSON.stringify(receipt) }]), sdkVerbatimCost27: originalCost, sdkVerbatimCost28: originalCost,
      representation24: "verified receipt", representation27: "verbatim", representation28: "verbatim", effectStatusChanged: false });
  }
  const proposed = phase === "after" ? planCompaction({ ...options(28), verifiedWriteSources: confirmed }) : undefined;
  const post = capture({ ...options(28), verifiedWriteSources: confirmed });
  const onlyPreviouslyReceipted = capture({ ...options(28), verifiedWriteSources: confirmed.filter(proof => liveReceipts24.some(receipt => receipt.toolCallId === proof.toolCallId)) });
  const params = (prompt, tools) => ({ prompt, maxOutputTokens: 2048, providerOptions: { ollama: { numCtx: 32768, think: false } }, tools: tools.map(tool => ({ type: "function", name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters })) });
  const wire28 = { ...requests.at(-1).body, tools: tools28, messages: [...requests.at(-1).body.messages, ...ollamaBody("qwen3-coder:30b", params(messages.slice(prefix(27).length), tools28), true).messages] };
  const relocated = capture({ ...options(28), units: [unit], extra: messages, verifiedWriteSources: confirmed });
  if (phase === "before") assert.equal(post.budget.required, 32858);
  else {
    assert(post.budget.fits);
    assert(post.receipts.length >= liveReceipts24.length);
    assert.deepEqual(proposed.messages, planCompaction({ ...options(28), units: [unit], extra: messages, verifiedWriteSources: confirmed }).messages);
  }
  const framing = role => cost(role, []);
  const addedExchange = messages.slice(prefix(27).length);
  const addedCall = addedExchange[0].content.find(part => part.type === "tool-call");
  const result = { phase, source, sourceHashes: { report: sha(reportBytes), transcript: sha(originalBytes) }, conversationId: conversation.id,
    assistantMessageId: assistant.id, originalGroups: groupCompactionUnits(units), originalUnitCosts: units.map(unit => ({ messageId: unit.messageId, role: unit.role, cost: measureRequest({ messages: unit.messages }).conversation })),
    request27: { sdk: before27, native: budget(requests.at(-1).body), extraCost: measureRequest({ messages: options(27).extra }).conversation },
    request28: { sdk: before28, hypotheticalNative: budget(wire28), extraCost: measureRequest({ messages: options(28).extra }).conversation },
    delta: { system: before28.budget.cost.system - before27.budget.cost.system, schemas: before28.budget.cost.tools - before27.budget.cost.tools,
      conversation: before28.budget.cost.conversation - before27.budget.cost.conversation, input: before28.budget.input - before27.budget.input, margin: before28.budget.margin - before27.budget.margin, required: before28.budget.required - before27.budget.required,
      addedToolCallId: parts.at(-1).toolCallId, changedWriteRepresentations27to28: [],
      addedExchange: { call: cost("assistant", [addedCall]), result: measureRequest({ messages: [addedExchange[1]] }).conversation,
        proseAndMetadata: measureRequest({ messages: [addedExchange[0]] }).conversation - cost("assistant", [addedCall]) } },
    affected, confirmedSources: confirmed.map(proof => ({ toolCallId: proof.toolCallId, messageId: proof.messageId, partIndex: proof.partIndex, digest: proof.digest })),
    post, onlyPreviouslyReceipted, relocationComparison: { allExtra: relocated, originalHistory: post },
    framing: { emptyAssistant: framing("assistant"), emptyTool: framing("tool"), protocolPair: framing("assistant") + framing("tool"), receiptMessage: framing("assistant") },
    sourceVerification: "Offline native-digest semantics against the SHA256-validated original session snapshot; no live IPC", inferenceRequests: 0, toolsExecuted: 0 };
  await writeFile(path.join(destination, `${phase}.json`), JSON.stringify(result, null, 2), { flag: "wx" });
  if (phase === "after") await writeFile(path.join(destination, "request-28.optimized.json"), JSON.stringify(ollamaBody("qwen3-coder:30b", params(proposed.messages, tools28), true), null, 2), { flag: "wx" });
  console.log(JSON.stringify({ ...result, affected: undefined, confirmedSources: undefined, relocationComparison: undefined, post: { ...post, receipts: post.receipts.map(receipt => receipt.toolCallId) }, onlyPreviouslyReceipted: { ...onlyPreviouslyReceipted, receipts: onlyPreviouslyReceipted.receipts.map(receipt => receipt.toolCallId) } }, null, 2));
} finally { globalThis.fetch = previousFetch; await vite.close(); }
