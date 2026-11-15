import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { jsonSchema, streamText, tool } from "ai";
import evidence from "@/test/fixtures/qwen-tool-mismatch-20261021.json";
import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import { TOOL_PROBE_NAME } from "@/modules/ai/lib/toolVerificationSchema";
import { classifyToolObservation } from "@/modules/ai/lib/toolVerification";

it("preserves the four bounded wire comparisons without inferring a cause or importing explicit None proof into Automatic", () => {
  const [a, b, repeatedA, repeatedB] = evidence.runs;
  expect(evidence.runs).toHaveLength(4);
  expect(a.request.body).toEqual(repeatedA.request.body);
  expect(b.request.body).toEqual(repeatedB.request.body);
  expect(b.request.body).toEqual({...a.request.body, think: false});
  expect(a.request.body).not.toHaveProperty("think");
  expect(a.request.body.options).toEqual({num_predict: 512});
  for (const run of evidence.runs) {
    expect(run.digest).toBe(evidence.historical.digest);
    expect(run.versionBefore).toEqual(run.versionAfter);
    expect(run.versionBefore).toEqual(evidence.historical.version);
    expect(run.thinking).toEqual({values: [false], default: false});
    expect(run.final.done_reason).toBe("stop");
    expect(run.final.eval_count).toBeLessThan(512);
    expect(createHash("sha256").update(run.rawResponse).digest("hex")).toBe(run.responseSha256);
  }
  expect(evidence.cloudInference).toBe(0);
  expect(evidence.toolExecutions).toBe(0);
});

it.each(evidence.runs)("replays captured $phase native bytes under their ORIGINAL recorded request contract, without tool execution", async run => {
  let requests = 0;
  // This is an archive replay, not a new verification probe. The historical
  // prompt and draft-07 schema predate today's improved probe prompt / Zod
  // schema generator. Never silently rewrite the sealed native response nor
  // claim the current request is byte-identical to its older predecessor.
  const originalPrompt = run.request.body.messages[0].content;
  const originalTool = run.request.body.tools[0].function;
  const archivedSchema = jsonSchema(
    originalTool.parameters as Parameters<typeof jsonSchema>[0],
  );
  const model = createOllamaModel({
    modelId: run.request.body.model,
    baseURL: "http://localhost:11435",
    fetch: async (_url, options) => {
      requests++;
      expect(JSON.parse(String(options?.body))).toEqual(run.request.body);
      return new Response(run.rawResponse, {headers: {"Content-Type": "application/x-ndjson"}});
    },
  });
  const tools = {[TOOL_PROBE_NAME]: tool({
    description: originalTool.description,
    inputSchema: archivedSchema,
  })};
  const explicit = run.phase.startsWith("b");
  const result = streamText({model, prompt: originalPrompt, tools, maxOutputTokens: 512, maxRetries: 0,
    providerOptions: explicit ? {ollama: {think: false}} : undefined});
  await result.consumeStream();
  const calls = await result.toolCalls;
  const text = await result.text;
  expect(text).toBe(run.text);
  expect(calls).toHaveLength(explicit ? 1 : 0);
  if (explicit) expect(calls[0]).toMatchObject({toolName: TOOL_PROBE_NAME, input: {key: "clack-probe-v1", count: 1}});
  expect(classifyToolObservation({calls: calls.map(c => ({name: c.toolName, input: c.input})), text,
    finish: await result.finishReason, firstBodyAt: 1, callAt: explicit ? 1 : null})).toBe(explicit ? "native-call" : "text-only");
  expect(await result.toolResults).toEqual([]);
  expect(tools[TOOL_PROBE_NAME]).not.toHaveProperty("execute");
  expect(requests).toBe(1);
});
