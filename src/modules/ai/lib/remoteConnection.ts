import { invoke } from "@tauri-apps/api/core";
import { remoteSshMessage, type RemoteSshStatus } from "@/modules/ai/lib/remoteSsh";
import { resolveSelfHostedSelection, type SelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { beginInference, type InferenceScope } from "@/modules/ai/lib/inferenceLifecycle";

export class RemoteConnectionError extends Error {
  readonly remoteConnectionFailure = true;
  constructor(readonly code: string) { super(remoteSshMessage(code)); this.name="RemoteConnectionError"; }
}
export function remoteEndpointFromUrl(raw: string): string | undefined {
  const url=new URL(raw);
  if (url.hostname!=="clack-ssh.invalid") return undefined;
  const hex=url.pathname.split("/")[1];
  if (!hex || hex.length>4096 || hex.length%2 || !/^[a-f0-9]+$/.test(hex)) throw new RemoteConnectionError("invalid-ssh-configuration");
  return new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(hex.match(/../g) ?? [],byte=>Number.parseInt(byte,16)));
}
export function remoteEndpointForModel(modelId: string,state?: SelfHostedState): string | undefined {
  if (!state) return undefined;
  const target=resolveSelfHostedSelection(state,modelId);
  return target.status==="available" && target.endpoint.ssh ? target.endpoint.id : undefined;
}
export async function acquireRemoteConnection(endpointId: string | undefined, signal?: AbortSignal | null, scope?: InferenceScope): Promise<() => void> {
  if (!endpointId) return () => {};
  const consumer=crypto.randomUUID();
  const controller=new AbortController();
  const aborted=()=>controller.abort();
  signal?.addEventListener("abort",aborted,{once:true});
  if(signal?.aborted) controller.abort();
  let released=false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const release=()=>{
    if(released)return;released=true;clearInterval(heartbeat);
    signal?.removeEventListener("abort",aborted);
    void invoke("remote_ssh_release",{endpointId,consumer}).catch(()=>{});
  };
  const lifecycle=beginInference(scope,()=>controller.abort(),"connecting");
  const onAbort=()=>release();
  controller.signal.addEventListener("abort",onAbort,{once:true});
  try {
    controller.signal.throwIfAborted();
    const result=await Promise.race([
      invoke<RemoteSshStatus>("remote_ssh_acquire",{endpointId,consumer}),
      new Promise<never>((_,reject)=>controller.signal.addEventListener("abort",()=>reject(new DOMException("Connection cancelled","AbortError")),{once:true})),
    ]);
    controller.signal.throwIfAborted();
    if(scope && !scope.isCurrent())throw new DOMException("Superseded connection","AbortError");
    if(result.state!=="connected")throw new RemoteConnectionError(result.state);
    heartbeat=setInterval(()=>{void invoke("remote_ssh_heartbeat",{endpointId,consumer}).catch(()=>release());},20_000);
    lifecycle.update("completed");
    return release;
  } catch(error) {
    release();lifecycle.update(controller.signal.aborted?"cancelled":"failed");
    throw error instanceof RemoteConnectionError || (error instanceof DOMException && error.name==="AbortError") ? error : new RemoteConnectionError(typeof error==="string"?error:"ssh-error");
  } finally { lifecycle.settle(); }
}

export function holdRemoteStream<T>(stream: ReadableStream<T>, release: () => void): ReadableStream<T> {
  const reader=stream.getReader();let done=false;
  const finish=()=>{if(!done){done=true;release();reader.releaseLock();}};
  return new ReadableStream<T>({
    async pull(controller){try{const next=await reader.read();if(next.done){finish();controller.close();}else controller.enqueue(next.value);}catch(error){finish();controller.error(error);}},
    async cancel(reason){try{await reader.cancel(reason);}finally{finish();}},
  });
}
