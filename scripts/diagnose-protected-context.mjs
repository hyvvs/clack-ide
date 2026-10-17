import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { convertToModelMessages, streamText, tool, jsonSchema, stepCountIs } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

const directory = process.argv[2];
assert(directory && path.isAbsolute(directory), "Supply a preserved acceptance directory");
const read = async name => {
  const file = path.join(directory, name);
  assert((await stat(file)).size < 4 * 1024 * 1024, "Evidence exceeds diagnostic bound");
  const text = await readFile(file, "utf8");
  assert(Buffer.byteLength(text) < 4 * 1024 * 1024, "Evidence exceeds diagnostic bound");
  return text;
};
const report = JSON.parse(await read("mission-a-1.json"));
const requests = (await read("mission-a-1.requests.jsonl")).trim().split("\n").map(line => JSON.parse(line));
assert.equal(requests.length, 18);
const body = requests.at(-1).body;
assert.equal(body.model, "qwen38-uncensored:latest");
assert.deepEqual(body.options, { num_ctx: 32768, num_predict: 2048 });
assert.equal(body.think, false);
const conversation = report.conversations.find(c => c.id === "real-mission-a");
assert(conversation && conversation.messages.length === 2 && !conversation.memory.revision);
const converted = await convertToModelMessages([conversation.messages[1]]);
const lastId = conversation.messages[1].parts.at(-1).toolCallId;
const lastStart = converted.findIndex(message => message.role === "assistant" && message.content.some(part => part.type === "tool-call" && part.toolCallId === lastId));
assert(lastStart >= 0);
const system = body.messages.filter(message => message.role === "system");
const users = body.messages.filter(message => message.role === "user");
assert.equal(users.length, 1);
const extra = [];
for (const message of body.messages.filter(message => !["system", "user"].includes(message.role))) {
  if (message.role === "assistant") {
    extra.push({ role: "assistant", content: [
      ...(message.content ? [{ type: "text", text: message.content }] : []),
      ...(message.tool_calls ?? []).map(call => ({ type: "tool-call", toolCallId: call.id, toolName: call.function.name, input: call.function.arguments })),
    ] });
  } else {
    let output;
    try { output = { type: "json", value: JSON.parse(message.content) }; }
    catch { output = { type: "error-text", value: message.content }; }
    if (extra.at(-1)?.role !== "tool") extra.push({ role: "tool", content: [] });
    extra.at(-1).content.push({ type: "tool-result", toolCallId: message.tool_call_id, toolName: message.tool_name, output });
  }
}
extra.push(...converted.slice(lastStart));
const wireCalls = new Map(extra.flatMap(message => message.content.filter(part => part.type === "tool-call").map(part => [part.toolCallId, part])));
const wireResults = new Map(extra.flatMap(message => message.content.filter(part => part.type === "tool-result").map(part => [part.toolCallId, part])));
// UI text parts preserve boundaries that the native adapter joins. Restore the
// invalid tool input/result from wire evidence, not its later generic UI error.
extra.splice(0, extra.length, ...converted.map(message => ({ ...message, content: message.content.map(part =>
  part.type === "tool-call" ? { ...part, input: wireCalls.get(part.toolCallId).input }
    : part.type === "tool-result" ? { ...part, output: wireResults.get(part.toolCallId).output } : part) })));
// SDK toResponseMessages includes these optional own-properties even when unset;
// native JSON audits cannot retain them. Reconstruct the installed SDK shape.
for (const message of extra) if (message.role === "assistant") {
  for (const part of message.content) {
    part.providerOptions = undefined;
    if (part.type === "tool-call") part.providerExecuted = undefined;
  }
}
const units = [{ messageId: conversation.messages[0].id, role: "user", hasContentReferences: false,
  messages: [{ role: "user", content: [{ type: "text", text: users[0].content }] }] }];
const limits = { deployed: 32768, outputReserve: 2048, maxOutput: 2048 };
const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), server: { watch: null, hmr: false }, logLevel: "error" });
try {
  const { measureRequest, resolveContextBudget } = await vite.ssrLoadModule("/src/modules/ai/lib/contextBudget.ts");
  const { planCompaction } = await vite.ssrLoadModule("/src/modules/ai/lib/compactionPlan.ts");
  const measure = messages => measureRequest({ messages }).conversation;
  let step = 0;
  let sdkFrame;
  let sdkFailure;
  let sdkPrepared;
  const assistant = extra.filter(message => message.role === "assistant");
  const replayTools = Object.fromEntries(body.tools.map(schema => [schema.function.name, tool({
    description: schema.function.description,
    inputSchema: schema.function.name === "bash_run" ? z.object({ command: z.string(), timeout_secs: z.number().int().min(1).max(300).optional() }) : jsonSchema(schema.function.parameters),
    execute: async (_input, { toolCallId }) => {
      const output = wireResults.get(toolCallId).output;
      assert.equal(output.type, "json", "Only observed JSON successes/refusals may be replayed");
      return output.value;
    },
  })]));
  const model = new MockLanguageModelV3({
    doStream: async () => {
      const current = assistant[step++];
      assert(current, "No extra inference is allowed");
      const parts = current.content.flatMap((part, index) => part.type === "text" ? [
        { type: "text-start", id: `text-${index}` }, { type: "text-delta", id: `text-${index}`, delta: part.text }, { type: "text-end", id: `text-${index}` },
      ] : [{ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input: JSON.stringify(part.input) }]);
      return { stream: new ReadableStream({ start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "stop" }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } } });
        controller.close();
      } }) };
    },
  });
  const stream = streamText({ model, messages: [...system, ...units[0].messages], tools: replayTools, maxOutputTokens: 2048, onError: () => {},
    stopWhen: stepCountIs(19), maxRetries: 0,
    prepareStep: async ({ messages: current, stepNumber }) => {
      if (stepNumber !== 18) return;
      sdkFrame = { messages: current, tools: body.tools };
      try { sdkPrepared = planCompaction({ units, limits, system, tools: body.tools, extra: current.slice(system.length + 1) }); }
      catch (error) { sdkFailure = { code: error.code, budget: error.budget }; }
      throw new Error("Offline diagnostic boundary; no request 19");
    },
  });
  for await (const _part of stream.fullStream) { /* Never execute real tools or inference. */ }
  assert.equal(step, 18);
  const sdkReplay = { steps: step, failure: sdkFailure ?? null, budget: resolveContextBudget(limits, measureRequest(sdkFrame)),
    preparedBudget: sdkPrepared?.budget, jsonBudget: resolveContextBudget(limits, measureRequest(JSON.parse(JSON.stringify(sdkFrame)))) };
  const messages = [...system, ...units[0].messages, ...extra];
  let failure;
  try { planCompaction({ units, limits, system, tools: body.tools, extra }); }
  catch (error) { failure = { code: error.code, budget: error.budget }; }
  const calls = extra.flatMap(message => message.content.filter(part => part.type === "tool-call"));
  const results = extra.flatMap(message => message.content.filter(part => part.type === "tool-result"));
  const plans = calls.filter(call => call.toolName === "todo_write").map(call => {
    const result = results.find(result => result.toolCallId === call.toolCallId);
    return { id: call.toolCallId, todos: call.input.todos.length, inputChars: JSON.stringify(call.input).length,
      cost: measure([{ role: "assistant", content: [call] }, { role: "tool", content: [result] }]) };
  });
  const superseded = new Set(plans.slice(0, -1).map(plan => plan.id));
  const withoutOldPlan = extra.map(message => ({ ...message, content: message.content.filter(part => !superseded.has(part.toolCallId)) })).filter(message => message.content.length);
  console.log(JSON.stringify({ diagnosticOnly: true, inference: 0, sdkReplay,
    recordedError: report.sessions.find(session => session.id === "real-mission-a").run.error,
    failure: failure ?? null, budget: resolveContextBudget(limits, measureRequest({ messages, tools: body.tools })),
    user: { id: units[0].messageId, chars: users[0].content.length, cost: measure(units[0].messages) },
    liveTail: { messages: extra.length, cost: measure(extra), calls: calls.length, results: results.length,
      text: measure(extra.filter(message => message.role === "assistant").map(message => ({ ...message, content: message.content.filter(part => part.type === "text") })).filter(message => message.content.length)),
      toolInputs: measure(extra.filter(message => message.role === "assistant").map(message => ({ ...message, content: message.content.filter(part => part.type === "tool-call") })).filter(message => message.content.length)),
      toolResults: measure(extra.filter(message => message.role === "tool")) }, plans,
    groups: calls.map(call => {
      const result = results.find(part => part.toolCallId === call.toolCallId);
      const pair = [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }];
      return { id: call.toolCallId, tool: call.toolName, characters: JSON.stringify(pair).length, cost: measure(pair),
        status: result.output.type.startsWith("error") ? "error" : result.output.value?.error ? "refused" : result.output.value?.exit_code === 1 ? "exit-1" : "returned" };
    }),
    counterfactualWithoutSupersededPlan: resolveContextBudget(limits, measureRequest({ messages: [...system, ...units[0].messages, ...withoutOldPlan], tools: body.tools })),
    afterJsonSerialization: resolveContextBudget(limits, measureRequest(JSON.parse(JSON.stringify({ messages, tools: body.tools })))),
    tools: body.tools.map(tool => ({ name: tool.function.name, cost: measureRequest({ tools: [tool] }).tools })),
  }, null, 2));
} finally { await vite.close(); }
