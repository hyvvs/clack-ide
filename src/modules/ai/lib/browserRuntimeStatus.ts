import { invoke } from "@tauri-apps/api/core";

/** A runtime capability probe is not a browser authority grant. It observes
 * the Clack-owned native engine for one actor/session/authorized workspace.
 * Only the native side may resolve or enumerate browser session identities. */
export type BrowserSessionSummary = {
  browserSessionId:string;
  currentUrl:string|null;
  snapshotId:string|null;
  historyLength:number;
  expiresInSecs:number;
  engine:"inert_native_text";
  isolation:string;
};
export type BrowserRuntimeStatus = {
  available:boolean;
  engine:"inert_native_text"|"unavailable";
  reason:"native-checked"|"native-unavailable"|"no-actor-scope";
  sessions:BrowserSessionSummary[];
};
const unavailable=(reason:BrowserRuntimeStatus["reason"]):BrowserRuntimeStatus=>({
  available:false,engine:"unavailable",reason,sessions:[],
});
const bounded=(value:unknown,max:number):value is string=>
  typeof value==="string" && value.length>0 && value.length<=max;
function summary(raw:unknown):BrowserSessionSummary|null {
  if(!raw || typeof raw!=="object")return null;
  const v=raw as Record<string,unknown>;
  if(!bounded(v.browserSessionId,128) ||
    !(v.currentUrl===null || bounded(v.currentUrl,2048)) ||
    !(v.snapshotId===null || bounded(v.snapshotId,128)) ||
    !Number.isSafeInteger(v.historyLength) || Number(v.historyLength)<0 ||
    !Number.isSafeInteger(v.expiresInSecs) || Number(v.expiresInSecs)<0 ||
    v.engine!=="inert_native_text" || !bounded(v.isolation,1024))return null;
  return {
    browserSessionId:v.browserSessionId,
    currentUrl:v.currentUrl as string|null,
    snapshotId:v.snapshotId as string|null,
    historyLength:v.historyLength as number,
    expiresInSecs:v.expiresInSecs as number,
    engine:v.engine,
    isolation:v.isolation,
  };
}
const checked=new Map<string,{status:BrowserRuntimeStatus;at:number}>();
const TTL_MS=2000;
export function isTfBrowserRuntimeAvailable(actor:string,sessionId:string,workspaceRoot:string):boolean {
  const value=checked.get(JSON.stringify([actor,sessionId,workspaceRoot]));
  return !!value?.status.available && Date.now()-value.at<TTL_MS;
}
export function invalidateTfBrowserRuntimeStatus():void { checked.clear(); }
export async function refreshTfBrowserRuntimeStatus(actor:string|null,sessionId:string|null,
  workspaceRoot:string|null):Promise<BrowserRuntimeStatus> {
  if(!actor || !sessionId || !workspaceRoot)return unavailable("no-actor-scope");
  const key=JSON.stringify([actor,sessionId,workspaceRoot]);
  try {
    const raw=await invoke<unknown>("tf_browser_status",{
      actor,sessionId,workspaceRoot,browserSessionId:null,
    });
    if(!raw || typeof raw!=="object")throw Error("invalid-status");
    const v=raw as Record<string,unknown>;
    if(v.engine!=="inert_native_text" || !bounded(v.isolation,1024))
      throw Error("unverified-native-browser-engine");
    const sessions=Array.isArray(v.sessions)
      ? v.sessions.slice(0,8).map(summary).filter((s):s is BrowserSessionSummary=>!!s)
      : [];
    const status:BrowserRuntimeStatus={available:true,engine:"inert_native_text",
      reason:"native-checked",sessions};
    checked.set(key,{status,at:Date.now()});
    return status;
  }catch{
    const status=unavailable("native-unavailable");
    checked.set(key,{status,at:Date.now()});
    return status;
  }
}
