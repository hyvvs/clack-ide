import { describe, expect, it } from "vitest";
import { streamText, tool, type ToolSet } from "ai";
import { z } from "zod";
import { createOllamaModel } from "@/modules/ai/lib/ollamaModel";
import { canonicalProbeTools } from "@/modules/ai/lib/toolVerificationRuntime";
import { CONTEXT_CALIBRATION } from "@/modules/ai/lib/contextCalibrationSchema";
import {
  TOOL_VERIFICATION, TOOL_PROBE_PROMPT,
} from "@/modules/ai/lib/toolVerificationSchema";
import { productionAcceptanceWireContract } from "./r5uAcceptanceWireContract";
import frozenR5t from "./fixtures/r5t-wire-shapes.json";

// No live HTTP or Tauri IPC: exercise the real SDK -> Ollama serializer against
// a deterministic successful native-stream fixture.
const fixture = {
  model: "example",
  message: { role: "assistant", content: "OK" },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 8,
  eval_count: 2,
};
async function serialized(options: {
  output: number; context: number; tools?: ToolSet; think?: boolean;
}) {
  let wire: Record<string, unknown> | undefined;
  const model = createOllamaModel({
    modelId: "example", baseURL: "http://127.0.0.1:9",
    fetch: async (_url, init) => {
      wire = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response([JSON.stringify(fixture), ""].join("\n"), {
        status: 200, headers: { "content-type": "application/x-ndjson" },
      });
    },
  });
  const result = streamText({
    model,
    prompt: options.tools ? TOOL_PROBE_PROMPT : "Reply OK.",
    tools: options.tools,
    maxOutputTokens: options.output,
    providerOptions: { ollama: { numCtx: options.context, ...(options.think === undefined ? {} : { think: options.think }) } },
    maxRetries: 0,
  });
  await result.consumeStream();
  expect(await result.finishReason).toBe("stop");
  expect(wire).toBeDefined();
  return wire as Record<string, unknown>;
}
const contract = productionAcceptanceWireContract(2048, 65536, ["bash_run", "read_file"]);

describe("R5u native acceptance contract from production serialization", () => {
  it("classifies every unchanged frozen R5t request shape against current production contracts", () => {
    expect(frozenR5t).toHaveLength(8);
    for (const [i, shape] of frozenR5t.entries()) {
      expect(shape.thinkKind).toBe("absent");
      if (i < 6) {
        expect(shape.numCtx).toBe(contract.calibration.candidates[i]);
        expect(shape.numPredict).toBe(contract.calibration.output);
        expect(shape.toolSchemas).toBe(0);
      } else {
        expect(shape.numCtx).toBe(contract.agent.context);
        expect(contract.verification.outputs).toContain(shape.numPredict);
        expect(shape.toolSchemas).toBe(1);
      }
    }
  });
  it("matches all six bounded calibration requests with no tools", async () => {
    for (const context of CONTEXT_CALIBRATION.candidates) {
      const wire = await serialized({ output: CONTEXT_CALIBRATION.output, context });
      expect(wire.options).toMatchObject({ num_ctx: context, num_predict: contract.calibration.output });
      expect(wire.tools).toBeUndefined();
      expect(wire.think).toBeUndefined();
      expect(wire.stream).toBe(true);
    }
  });
  it("matches every native verification escalation including final 2048", async () => {
    expect(contract.verification.outputs).toEqual([...TOOL_VERIFICATION.outputs]);
    for (const output of TOOL_VERIFICATION.outputs) {
      const wire = await serialized({ output, context: 65536, tools: canonicalProbeTools() });
      expect(wire.options).toMatchObject({ num_ctx: 65536, num_predict: output });
      const schemas = wire.tools as { type: string; function: { name: string; parameters: Record<string, unknown> } }[];
      expect(schemas).toHaveLength(1);
      expect(schemas[0].type).toBe("function");
      expect(schemas[0].function.name).toBe(contract.verification.name);
      const expected = { ...contract.verification.parameters } as Record<string, unknown>;
      delete expected.$schema;
      const actual = { ...schemas[0].function.parameters };
      delete actual.$schema;
      expect(actual).toEqual(expected);
      expect(wire.think).toBeUndefined();
      expect(wire.messages).toEqual([{ role: "user", content: TOOL_PROBE_PROMPT }]);
      expect(wire.options).not.toHaveProperty("temperature");
      expect(wire).not.toHaveProperty("tool_choice");
    }
  });
  it("preserves an explicit authorized boolean reasoning choice without changing prompt, schema or sampling on repeat confirmation", async () => {
    const baseline = await serialized({ output: 512, context: 65536, tools: canonicalProbeTools() });
    const alternative = await serialized({ output: 512, context: 65536, tools: canonicalProbeTools(), think: false });
    const confirmation = await serialized({ output: 512, context: 65536, tools: canonicalProbeTools(), think: false });
    expect(baseline).not.toHaveProperty("think");
    expect(alternative).toEqual({ ...baseline, think: false });
    expect(confirmation).toEqual(alternative);
    expect((alternative.tools as {function:{parameters:Record<string,unknown>}}[])[0].function.parameters)
      .toEqual((baseline.tools as {function:{parameters:Record<string,unknown>}}[])[0].function.parameters);
    expect(TOOL_PROBE_PROMPT).toContain("next response must be exactly one native function call");
    expect(TOOL_PROBE_PROMPT).toContain("Do not write an answer");
  });
  it("serializes original Agent allowance with a normal named native tool", async () => {
    const wire = await serialized({
      output: contract.agent.output, context: contract.agent.context,
      tools: { bash_run: tool({ description: "Execute allowed shell command", inputSchema: z.object({command:z.string()}) }) },
    });
    expect(wire.options).toMatchObject({ num_ctx: 65536, num_predict: 2048 });
    expect((wire.tools as {function:{name:string}}[]).map(x=>x.function.name)).toEqual(["bash_run"]);
    expect(contract.agent.toolNames).toContain("bash_run");
    expect(wire.think).toBeUndefined();
  });
  it("rejects malformed contract provenance rather than manufacturing permissions", () => {
    expect(() => productionAcceptanceWireContract(2048, 65536, [])).toThrow();
    expect(() => productionAcceptanceWireContract(2048, 65536, ["get_probe_value"])).toThrow();
    expect(() => productionAcceptanceWireContract(2048, 65536, ["bash_run", "bash_run"])).toThrow();
    expect(() => productionAcceptanceWireContract(0, 65536, ["bash_run"])).toThrow();
  });
});
