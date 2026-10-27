import { describe, expect, it } from "vitest";
import { createOllamaModel } from "./ollamaModel";
import { verifiedProviderFetch } from "./answerContinuation";
import { associateNativeResponse, installOllamaParserFailureObserver,
  OllamaParserFailureState, type OllamaParserFailure } from "./ollamaParserFailureDiagnostics";

const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "probe" }] }];
const frames = [
  { message: { role: "assistant", thinking: "reasoning-π" }, done: false },
  { message: { role: "assistant", content: "wide 🌎 text" }, done: false },
  { message: { role: "assistant", tool_calls: [
    { function: { name: "get_probe_value", arguments: { value: "é🌍", count: 2 } } },
  ] }, done: false },
  { message: { role: "assistant", content: "" }, done: true,
    done_reason: "stop", prompt_eval_count: 11, eval_count: 12 },
];
const encoder = new TextEncoder();
const wire = (f: unknown[]) => encoder.encode(f.map(x=>JSON.stringify(x)).join("\n")+"\n");
function body(chunks: Uint8Array[], cancel?: () => void) {
  let i=0;
  return new ReadableStream<Uint8Array>({
    pull(c) { if(i < chunks.length) c.enqueue(chunks[i++]); else c.close(); },
    cancel() { cancel?.(); },
  });
}
const response = (chunks: Uint8Array[], cancel?: () => void) =>
  new Response(body(chunks,cancel),{headers:{"content-type":"application/x-ndjson"}});
async function consume(chunks: Uint8Array[], capture: OllamaParserFailure[],
    onCancel?: () => void, wrapped=true) {
  const model=createOllamaModel({modelId:"fixture",baseURL:"http://localhost",
    fetch: wrapped ? verifiedProviderFetch(async()=>{
      const r=response(chunks,onCancel);associateNativeResponse(r,"inference-8");return r;
    }) : async()=>{
      const r=response(chunks,onCancel);associateNativeResponse(r,"inference-8");return r;
    }});
  const unsub=installOllamaParserFailureObserver(r=>capture.push(r));
  try {
    const sdk=(await model.doStream({prompt,maxOutputTokens:512})).stream.getReader();
    const events: {type:string; delta?:unknown}[]=[];
    try {
      while(true) { const result=await sdk.read();if(result.done)break;events.push(result.value as {type:string;delta?:unknown}); }
    } finally { sdk.releaseLock(); }
    return events;
  } finally {unsub();}
}

describe("offline dual Ollama parser chunk/framing failure diagnostics",()=>{
  it("handles complete frames, arbitrary byte splits and a contiguous byte stream identically",async()=>{
    const bytes=wire(frames);
    const utf8Emoji=Array.from(bytes).findIndex((x,i)=>i>0&&x===0xf0);
    expect(utf8Emoji).toBeGreaterThan(0);
    const patterns=[
      [bytes],
      // Native bytes are not required to align to JSON/UTF-8 boundaries.
      Array.from({length:Math.ceil(bytes.length/3)},(_,i)=>bytes.slice(i*3,i*3+3)),
      [bytes.slice(0,utf8Emoji+1),bytes.slice(utf8Emoji+1,utf8Emoji+3),bytes.slice(utf8Emoji+3)],
      [bytes.slice(0,14),bytes.slice(14,85),bytes.slice(85)],
    ];
    const seen: Array<Array<[string,unknown]>>=[];
    for(const chunks of patterns){
      const errors: OllamaParserFailure[]=[];
      const result=await consume(chunks,errors);
      expect(errors).toEqual([]);
      expect(result.map(e=>e.type)).toContain("tool-call");
      expect(result.some(e=>e.type==="reasoning-delta")).toBe(true);
      expect(result.some(e=>e.type==="text-delta")).toBe(true);
      expect(result[result.length-1]?.type).toBe("finish");
      seen.push(result.map(e=>[e.type,e.delta??null]));
    }
    expect(seen.every(x=>JSON.stringify(x)===JSON.stringify(seen[0]))).toBe(true);
  });
  it("returns original adapter exception with bounded failure-only evidence and request ID",async()=>{
    const errors: OllamaParserFailure[]=[];
    const payload=wire([frames[0],frames[1]]);
    const malformed=encoder.encode('{"message":, "done": false}\n');
    await expect(consume([payload.slice(0,13),payload.slice(13),malformed],errors)).rejects.toThrow();
    expect(errors.some(e=>e.stage==="completion-scanner" || e.stage==="native-adapter")).toBe(true);
    for(const d of errors) {
      expect(d.requestId).toBe("inference-8");
      expect(d.exception.name).toMatch(/Error|Syntax/);
      expect(d.exception.message.length).toBeLessThanOrEqual(512);
      expect(d.exception.stack?.length).toBeLessThanOrEqual(2048);
      expect(d.bytesRead).toBeGreaterThan(0);
      expect(d.chunkSequence).toBeGreaterThan(0);
      expect(d.recentRawByteHex.length).toBeLessThanOrEqual(256);
      expect(JSON.stringify(d.lastParsedShape??{})).not.toContain("reasoning-π");
      expect(JSON.stringify(d.lastParsedShape??{})).not.toContain("wide 🌎");
      expect(d.decoder.encoding).toBe("utf-8");
    }
  });
  it("still rejects missing final frame, malformed UTF-8, and terminal data after completion",async()=>{
    for(const chunks of [
      [wire(frames.slice(0,2))],
      [new Uint8Array([0x7b,0x22,0x61,0x22,0x3a,0x22,0xc3,0x28,0x22,0x7d,0x0a])],
      [wire([...frames,{message:{role:"assistant",content:"extra"},done:false}])],
    ]) {
      const errors: OllamaParserFailure[]=[];
      await expect(consume(chunks,errors)).rejects.toThrow();
      expect(errors.length).toBeGreaterThan(0);
    }
  });
  it("does not allow an observer exception to replace parser failure",async()=>{
    const bad=encoder.encode('not-json\n');
    const observer=installOllamaParserFailureObserver(()=>{throw Error("observer failed")});
    try{
      await expect(consume([bad],[],undefined,false)).rejects.toThrow(/JSON|Unexpected|Syntax/i);
    }finally{observer();}
  });
  it("keeps snapshots disabled without opt-in and never records tool argument values in frame shape",()=>{
    const state=new OllamaParserFailureState();
    state.observeChunk(encoder.encode("secret-token"));
    state.parsed(frames[2]);
    expect(state.parsedFrames).toBe(1);
    expect(state.lastParsedShape).toBeNull();
  });
});
