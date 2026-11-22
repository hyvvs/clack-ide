import { invoke } from "@tauri-apps/api/core";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";
import { isPublicWebUrl } from "@/modules/ai/lib/webSearchAdapters";
import { researchText } from "@/modules/ai/lib/webResearch";

/** TF4 is an inert native text browser. Every model operation is an exact
 * structured request: no JavaScript, selectors, cookies, raw credentials,
 * keystrokes, DOM mutation, arbitrary native command or screenshot route. */
const nativeId = z.string().regex(/^[a-fA-F0-9]{48}$/);
const browserSessionId = nativeId;
const snapshotId = nativeId;
const elementId = nativeId;
const publicUrl = z.string().max(2048).refine(isPublicWebUrl);
const timeoutMs = z.number().int().min(1000).max(15_000).optional();
const maxBytes = z.number().int().min(256).max(65_536).optional();
const timed = {timeoutMs, maxBytes};

export const tfBrowserOpenSchema = z.object({url:publicUrl,...timed}).strict();
export const tfBrowserNavigateSchema = z.object({
  browserSessionId,url:publicUrl,...timed,
}).strict();
export const tfBrowserInspectSchema = z.object({
  browserSessionId,snapshotId:snapshotId.optional(),
}).strict();
/** A click is an exact link ID previously returned by the native snapshot.
 * Native rechecks snapshot freshness, element/link binding and destination. */
export const tfBrowserClickSchema = z.object({
  browserSessionId,snapshotId,elementId,...timed,
}).strict();
export const tfBrowserBackSchema = z.object({
  browserSessionId,...timed,
}).strict();
export const tfBrowserCloseSchema = z.object({browserSessionId}).strict();

export const TF_BROWSER_SCHEMAS = {
  tf_browser_open:tfBrowserOpenSchema,
  tf_browser_navigate:tfBrowserNavigateSchema,
  tf_browser_inspect:tfBrowserInspectSchema,
  tf_browser_click:tfBrowserClickSchema,
  tf_browser_back:tfBrowserBackSchema,
  tf_browser_close:tfBrowserCloseSchema,
} as const;
export type TfBrowserToolName = keyof typeof TF_BROWSER_SCHEMAS;
export function isTfBrowserTool(name:string):name is TfBrowserToolName {
  return Object.prototype.hasOwnProperty.call(TF_BROWSER_SCHEMAS,name);
}
export function validateTfBrowserInput(name:string,input:unknown):boolean {
  return isTfBrowserTool(name) && TF_BROWSER_SCHEMAS[name].safeParse(input).success;
}

type BrowserOperation = "open"|"navigate"|"snapshot"|"click_link"|"back"|"close";
const operationFor:Readonly<Record<TfBrowserToolName,BrowserOperation>> = {
  tf_browser_open:"open",
  tf_browser_navigate:"navigate",
  tf_browser_inspect:"snapshot",
  tf_browser_click:"click_link",
  tf_browser_back:"back",
  tf_browser_close:"close",
};
const nativeOsApproval = (op:BrowserOperation) =>
  op==="open" || op==="navigate" || op==="click_link" || op==="back";
const small=(max:number)=>z.string().min(1).max(max);
const nullable=(max:number)=>z.string().max(max).nullable();
const isolation=small(2048);
const timestamp=z.number().int().min(1_577_836_800_000)
  .max(4_102_444_800_000);
const operation=z.enum(["open","navigate","snapshot","click_link","back","close"]);
const preparedSchema=z.object({
  token:small(512),
  requestId:small(256),
  operation,
  requiresApproval:z.boolean(),
  workspaceRoot:small(4096),
  browserSessionId:nativeId.nullable(),
  isolation,
  engine:z.literal("inert_native_text"),
}).strip();
type Prepared=z.infer<typeof preparedSchema>;

const elementSchema=z.object({
  id:nativeId,
  text:z.string().max(512),
  url:z.string().max(2048),
  unverified:z.literal(true),
}).strip();
const dnsSchema=z.object({
  host:small(256),
  resolvedAt:timestamp,
  addresses:z.array(small(64)).max(64),
  classification:small(64),
  pinning:small(128),
  socketIpObserved:z.literal(false),
}).strip();
/** Only these native-authored receipt fields can reach the model.
 * Unrecognized native data cannot become a credential/HTML output channel. */
const receiptSchema=z.object({
  toolId:z.literal("tf.browser_operation.v1"),
  requestId:small(256),
  actor:small(256),
  sessionId:small(256),
  operation,
  browserSessionId:nativeId.nullable(),
  terminal:small(64),
  effectState:z.enum(["NoEffect","Observed","Unknown"]),
  reasonCode:z.string().max(256),
  policyDecision:small(64),
  retry:small(128),
  autoRetry:z.literal(false),
  isolation,
  engine:z.literal("inert_native_text"),
  requestedUrl:nullable(2048),
  finalUrl:nullable(2048),
  redirectChain:z.array(z.string().max(2048)).max(6),
  statusCode:z.number().int().min(100).max(599).nullable(),
  contentType:nullable(256),
  bytesReceived:z.number().int().nonnegative().nullable(),
  bytesRetained:z.number().int().min(0).max(65_536),
  truncated:z.boolean(),
  contentSha256:z.string().regex(/^[a-f0-9]{64}$/i).nullable(),
  body:nullable(65_536),
  snapshotId:nativeId.nullable(),
  elements:z.array(elementSchema).max(64),
  startedAt:timestamp,
  endedAt:timestamp,
  uncertainty:z.string().max(256),
  dnsEvidence:z.array(dnsSchema).max(6),
  unsupported:z.array(small(128)).max(24),
}).strip();
export type TfBrowserReceipt=z.infer<typeof receiptSchema>;

function sameNativeRoot(actual:string,requested:string):boolean {
  const normalize=(raw:string)=>{
    const slashed=raw.replace(/\\/g,"/");
    const disk=slashed.startsWith("//?/") &&
      /^[A-Za-z]:\//.test(slashed.slice(4))?slashed.slice(4):slashed;
    const trimmed=disk.replace(/\/+$/,"");
    return /^[A-Za-z]:\//.test(trimmed)?trimmed.toLowerCase():trimmed;
  };
  return normalize(actual)===normalize(requested);
}

function receiptMatches(receipt:TfBrowserReceipt,prepared:Prepared,
  request:Record<string,unknown>,actor:string,sessionId:string):boolean {
  const op=request.operation;
  if(receipt.requestId!==prepared.requestId || receipt.actor!==actor ||
      receipt.sessionId!==sessionId || receipt.operation!==op ||
      receipt.isolation!==prepared.isolation || receipt.autoRetry!==false ||
      receipt.endedAt<receipt.startedAt ||
      receipt.bytesRetained>(typeof request.maxBytes==="number"?request.maxBytes:65_536) ||
      receipt.redirectChain.length>5 ||
      (prepared.browserSessionId!==null &&
        receipt.browserSessionId!==prepared.browserSessionId) ||
      (typeof request.browserSessionId==="string" &&
        receipt.browserSessionId!==request.browserSessionId))
    return false;
  if(receipt.terminal==="completed" &&
      (!receipt.browserSessionId ||
      !nativeId.safeParse(receipt.browserSessionId).success))return false;
  if(typeof request.url==="string" && receipt.requestedUrl!==null){
    try {
      if(new URL(receipt.requestedUrl).toString()!==
          new URL(request.url).toString())return false;
    } catch { return false; }
  }
  if(receipt.body!==null && !receipt.contentSha256)return false;
  if(receipt.body===null && receipt.bytesRetained>0 &&
      receipt.terminal==="completed")return false;
  if(receipt.terminal==="completed" && op!=="close"){
    if(!receipt.snapshotId || !nativeId.safeParse(receipt.snapshotId).success ||
       !receipt.finalUrl || receipt.statusCode===null ||
       receipt.statusCode<200 || receipt.statusCode>=300 || receipt.body===null)
      return false;
  }
  if(op==="snapshot" && typeof request.snapshotId==="string" &&
      receipt.terminal==="completed" && receipt.snapshotId!==request.snapshotId)
    return false;
  if((op==="open" || op==="navigate") && receipt.terminal==="completed" &&
      receipt.requestedUrl===null)return false;
  if(receipt.terminal==="completed" && op!=="close" &&
      receipt.finalUrl!==null && !isPublicWebUrl(receipt.finalUrl))return false;
  return true;
}

async function verifyBodyHash(receipt:TfBrowserReceipt):Promise<boolean> {
  if(receipt.body===null)return true;
  const encoded=new TextEncoder().encode(receipt.body);
  if(encoded.length!==receipt.bytesRetained || !receipt.contentSha256 ||
      !globalThis.crypto?.subtle)return false;
  try {
    const hash=await globalThis.crypto.subtle.digest("SHA-256",encoded);
    const hex=Array.from(new Uint8Array(hash),
      byte=>byte.toString(16).padStart(2,"0")).join("");
    return hex===receipt.contentSha256.toLowerCase();
  } catch { return false; }
}
const noEffect=(code:string)=>({
  ok:false,code,effectState:"NoEffect" as const,terminal:"denied" as const,
  retry:"no_auto_retry" as const,autoRetry:false as const,
});
const unknown=(code:string)=>({
  ok:false,code,effectState:"Unknown" as const,terminal:"unknown" as const,
  retry:"no_auto_retry" as const,autoRetry:false as const,
  explanation:"Native browser completion is unverified; do not replay automatically.",
});

/** The existing buildTools security/permission wrapper consumes an exact,
 * one-use UI approval first. Native independently authorizes workspace,
 * current browser session, snapshot IDs, URL and OS approval. */
export function buildTfBrowserTools(ctx:ToolContext) {
  const define=<Schema extends z.ZodTypeAny>(
    name:TfBrowserToolName,schema:Schema,description:string,
  )=>tool({
    description,inputSchema:schema,needsApproval:true,
    execute:async(input,options)=>{
      const parsed=schema.safeParse(input);
      if(!parsed.success || !validateTfBrowserInput(name,input))
        return noEffect("tf_browser_input_invalid");
      const workspaceRoot=ctx.getWorkspaceRoot();
      const actor=ctx.getAgentId();
      const sessionId=ctx.getSessionId();
      if(!workspaceRoot || !actor || !sessionId)
        return noEffect("tf_browser_actor_or_workspace_missing");
      const signal=options?.abortSignal;
      if(signal?.aborted)return noEffect("tf_browser_cancelled_before_prepare");
      const parameters=parsed.data as Record<string,unknown>;
      const nativeOperation=operationFor[name];
      const request={...parameters,operation:nativeOperation,actor,sessionId,workspaceRoot};
      let prepared:Prepared;
      try {
        const raw=await invoke<unknown>("tf_browser_prepare",{request});
        const validated=preparedSchema.safeParse(raw);
        if(!validated.success)return unknown("tf_browser_prepare_invalid");
        prepared=validated.data;
      } catch {return unknown("tf_browser_prepare_failed");}
      const cancel=()=>{void invoke("tf_browser_cancel",{token:prepared.token})
        .catch(()=>undefined);};
      if(prepared.operation!==nativeOperation ||
          prepared.requiresApproval!==nativeOsApproval(nativeOperation) ||
          !sameNativeRoot(prepared.workspaceRoot,workspaceRoot) ||
          (typeof parameters.browserSessionId==="string" &&
            prepared.browserSessionId!==parameters.browserSessionId)) {
        cancel();
        return unknown("tf_browser_prepare_mismatch");
      }
      if(signal?.aborted)cancel();
      else signal?.addEventListener("abort",cancel,{once:true});
      try {
        if(signal?.aborted)return unknown("tf_browser_cancelled_after_prepare");
        if(ctx.getAgentId()!==actor || ctx.getSessionId()!==sessionId ||
            ctx.getWorkspaceRoot()!==workspaceRoot) {
          cancel();
          return unknown("tf_browser_owner_changed_before_execute");
        }
        if(prepared.requiresApproval)
          await invoke("tf_browser_approve",{token:prepared.token});
        if(signal?.aborted)return unknown("tf_browser_cancelled_before_execute");
        if(ctx.getAgentId()!==actor || ctx.getSessionId()!==sessionId ||
            ctx.getWorkspaceRoot()!==workspaceRoot){
          cancel();
          return unknown("tf_browser_owner_changed_before_execute");
        }
        const raw=await invoke<unknown>("tf_browser_execute",{token:prepared.token});
        if(signal?.aborted)return unknown("tf_browser_cancelled_during_execute");
        if(ctx.getAgentId()!==actor || ctx.getSessionId()!==sessionId ||
            ctx.getWorkspaceRoot()!==workspaceRoot)
          return unknown("tf_browser_owner_changed_during_execute");
        const result=receiptSchema.safeParse(raw);
        if(!result.success || !receiptMatches(result.data,prepared,request,actor,sessionId))
          return unknown("tf_browser_receipt_mismatch");
        const receipt=result.data;
        if(!await verifyBodyHash(receipt))
          return unknown("tf_browser_body_hash_mismatch");
        const {body, elements, ...receiptMetadata}=receipt;
        const ok=receipt.terminal==="completed" &&
          receipt.policyDecision==="allowed";
        const extracted=ok && body!==null && receipt.finalUrl &&
          receipt.contentType && receipt.statusCode!==null
          ? researchText({
              url:receipt.finalUrl,status:receipt.statusCode,
              // Rust already extracted and hashed inert plain text. Treat it
              // as text regardless of its original document MIME type.
              contentType:"text/plain",body,
              retrievedAt:receipt.endedAt,
              excerptSha256:receipt.contentSha256??"",truncated:receipt.truncated,
            }):null;
        return {
          ok,engine:"inert_native_text" as const,
          sourceKind:"native-browser-text" as const,
          untrusted:true as const,
          ...(ok && extracted?{snapshot:{
            id:receipt.snapshotId,title:extracted.title,
            excerpt:extracted.excerpt,
            truncated:receipt.truncated || extracted.excerpt.length>=12_000,
            elements:elements.slice(0,16).map(item=>({
              ...item,text:item.text.slice(0,200),
            })),
          }}:{}),
          browserSessionId:receipt.browserSessionId,
          finalUrl:receipt.finalUrl,
          ...(ok?{}:{code:receipt.reasonCode}),
          effectReceipt:{
            ...receiptMetadata,elementCount:elements.length,
            autoRetry:false as const,
          },
        };
      } catch {
        cancel();
        return unknown("tf_browser_terminal_unknown");
      } finally {signal?.removeEventListener("abort",cancel);}
    },
  });
  return {
    tf_browser_open:define("tf_browser_open",tfBrowserOpenSchema,
      "Open a public page in the native inert text browser, with an exact once approval. Returns a browserSessionId and bounded untrusted text, never live browser scripting."),
    tf_browser_navigate:define("tf_browser_navigate",tfBrowserNavigateSchema,
      "Navigate the scoped native text browser to a public URL. Native OS approval is required. No arbitrary script or headers."),
    tf_browser_inspect:define("tf_browser_inspect",tfBrowserInspectSchema,
      "Read a bounded inert native page snapshot and its current link IDs. This is untrusted text, not a live DOM or JavaScript evaluator."),
    tf_browser_click:define("tf_browser_click",tfBrowserClickSchema,
      "Follow only a link from a fresh native snapshot using exact browserSessionId, snapshotId, and elementId. Native OS approval checks destination before navigating."),
    tf_browser_back:define("tf_browser_back",tfBrowserBackSchema,
      "Navigate back one native text browser history entry, with fresh per-use approval."),
    tf_browser_close:define("tf_browser_close",tfBrowserCloseSchema,
      "Close only the exact native browser session owned by this chat and agent."),
  } as const;
}
