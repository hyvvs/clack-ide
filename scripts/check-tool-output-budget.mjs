import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

const source = "src-tauri/target/real-qwen-product/forgeboard-nemotron-hardened-20261021-01/mission-a-1.requests.jsonl";
const directory = path.resolve(process.argv[2]);
assert.equal(path.basename(directory), "reasoning-tool-readiness-20261021-01");
await mkdir(directory, { recursive: false });
const captured = (await readFile(source, "utf8")).trim().split("\n").map(JSON.parse).find(r => r.requestId === "inference-7");
assert(captured && captured.body.options.num_predict === 512);
const model = "nemotron-3.5-lightning:30b-a3b-q4_K_M";
const digest = "e7a64ff15fb174c42b4f463e5c888c4f2c7b9cabf9e8d65a1c0874405426c1b2";
assert.equal(captured.body.model, model);
assert.equal(captured.url, "http://127.0.0.1:11435/api/chat");
assert.equal(captured.body.options.num_ctx, 65536);
assert(!Object.hasOwn(captured.body, "think"));
assert.deepEqual(captured.body.tools.map(t => t.function.name), ["get_probe_value"]);
const metadata = await (await fetch("http://127.0.0.1:11435/api/tags", { signal: AbortSignal.timeout(5000) })).json();
assert.equal(metadata.models.find(m => m.name === model)?.digest, digest);
const results = [];
for (const output of [1024, 2048]) {
  const body = structuredClone(captured.body);
  body.options.num_predict = output;
  const comparison = structuredClone(body); comparison.options.num_predict = 512;
  assert.deepEqual(comparison, captured.body, "Only the output allowance may change");
  const startedAt = Date.now(), prefix = path.join(directory, String(output));
  await writeFile(prefix + ".request.json", JSON.stringify({ at: startedAt, url: captured.url, body }, null, 2), { flag: "wx" });
  const response = await fetch(captured.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  assert(response.ok && response.body, `Provider HTTP ${response.status}`);
  let pending = "", text = "", thinking = "", final, firstOutputAt = null;
  let reasoningFrames = 0, textFrames = 0, frames = 0;
  const calls = [], decoder = new TextDecoder();
  for await (const chunk of response.body) {
    await appendFile(prefix + ".response.ndjson", chunk);
    pending += decoder.decode(chunk, { stream: true });
    const complete = pending.split("\n"); pending = complete.pop();
    for (const raw of complete.filter(Boolean)) {
      const frame = JSON.parse(raw); frames++;
      text += frame.message?.content ?? ""; thinking += frame.message?.thinking ?? "";
      if (frame.message?.thinking) reasoningFrames++;
      if (frame.message?.content) textFrames++;
      if (frame.message?.content || frame.message?.thinking || frame.message?.tool_calls?.length) firstOutputAt ??= Date.now();
      calls.push(...(frame.message?.tool_calls ?? []));
      if (frame.done) final = frame;
    }
  }
  assert(!pending.trim() && final, "A partial transport response is not a provider verdict");
  const valid = calls.length === 1 && calls[0].function.name === "get_probe_value" &&
    JSON.stringify(Object.keys(calls[0].function.arguments).sort()) === JSON.stringify(["count", "key"]) &&
    calls[0].function.arguments.key === "clack-probe-v1" && calls[0].function.arguments.count === 1;
  const hash = s => createHash("sha256").update(s).digest("hex");
  const result = { output, startedAt, endedAt: Date.now(), firstOutputAt, frames, reasoningFrames, textFrames,
    textChars: text.length, thinkingChars: thinking.length, textSha256: hash(text), thinkingSha256: hash(thinking),
    calls, validNativeCall: valid, finish: final.done_reason, inputTokens: final.prompt_eval_count, outputTokens: final.eval_count,
    bodySha256: hash(JSON.stringify(body)), textTail: text.slice(-100), lastFrame: final };
  results.push(result);
  await writeFile(prefix + ".summary.json", JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify(result));
  if (calls.length || final.done_reason !== "length") break;
}
await writeFile(path.join(directory, "differential.json"), JSON.stringify({ model, digest, source, baseline: { output: 512, finish: "length", outputTokens: 512 }, results, executedTools: 0, missionRequests: 0 }, null, 2), { flag: "wx" });
