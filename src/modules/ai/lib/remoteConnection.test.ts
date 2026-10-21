import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn(),Channel:class{onmessage=()=>{};}}));
import {invoke} from "@tauri-apps/api/core";
import {acquireRemoteConnection,holdRemoteStream,remoteEndpointFromUrl,remoteEndpointForModel,RemoteConnectionError} from "@/modules/ai/lib/remoteConnection";
import {addSelfHostedEndpoint,createSelfHostedEndpoint,emptySelfHostedState,deleteSelfHostedEndpoint} from "@/modules/ai/lib/selfHostedProfiles";
import {managedReconnectAvailable,saveSelfHostedModel,selfHostedSelectionId,selfHostedTransportIdentity} from "@/modules/ai/lib/selfHostedModels";
import {remoteSshUrl} from "@/modules/ai/lib/remoteSsh";
import {normalizeAiError} from "@/modules/ai/lib/errors";
import {cancelSessionInference,sessionInference} from "@/modules/ai/lib/inferenceLifecycle";
import {createInventoryRefresh} from "@/modules/ai/lib/selfHostedInventory";
function state(){
  const endpoint=createSelfHostedEndpoint({alias:"Remote",baseURL:remoteSshUrl("remote"),allowPrivateNetwork:true,backendHint:"ollama",ssh:{host:"labpc",username:"user",port:22,keyPath:null,remoteHost:"127.0.0.1",remotePort:11434}},"remote",1);
  const state=saveSelfHostedModel(addSelfHostedEndpoint(emptySelfHostedState(),endpoint),endpoint.id,"exact:model");
  return {state,model:selfHostedSelectionId(state.profiles[0])};
}
beforeEach(()=>{vi.mocked(invoke).mockReset();vi.mocked(invoke).mockResolvedValue({state:"connected",fingerprint:"SHA256:test",trustSource:"Clack"});});
afterEach(()=>vi.useRealTimers());
describe("demand-driven remote connection prerequisites",()=>{
  it("restores saved logical identity without requiring online transport just to render history",()=>{
    const f=state(),saved=JSON.parse(JSON.stringify({profile:{modelId:f.model},messages:[{id:"old",role:"user",parts:[{type:"text",text:"Original history"}]}]}));
    expect(remoteEndpointForModel(saved.profile.modelId,f.state)).toBe("remote");
    expect(selfHostedTransportIdentity(saved.profile.modelId,f.state)?.selfHosted?.endpointId).toBe("remote");
    expect(saved.messages[0].parts[0].text).toBe("Original history");expect(invoke).not.toHaveBeenCalled();
  });
  it("startup inventory refresh never establishes all saved SSH transports",async()=>{
    const f=state(),refresh=vi.fn();await createInventoryRefresh({refresh} as never)(f.state);
    expect(refresh).not.toHaveBeenCalled();expect(invoke).not.toHaveBeenCalled();
  });
  it("allows picker reconnection but never resurrects a deleted binding",()=>{
    const f=state();expect(managedReconnectAvailable(f.model,f.state)).toBe(true);
    const deleted=deleteSelfHostedEndpoint(f.state,"remote");
    expect(remoteEndpointForModel(f.model,deleted)).toBeUndefined();expect(managedReconnectAvailable(f.model,deleted)).toBe(false);
    expect(()=>selfHostedTransportIdentity(f.model,deleted)).toThrow("unavailable");
  });
  it("private-network refusal is not presented as automatic reconnect permission",()=>{
    const f=state();f.state.endpoints[0].allowPrivateNetwork=false;
    expect(managedReconnectAvailable(f.model,f.state)).toBe(false);
    expect(()=>selfHostedTransportIdentity(f.model,f.state)).toThrow();
  });
  it.each(["http://localhost:11434/v1/chat/completions","https://server.example/api"])("direct endpoint %s uses no SSH IPC",async url=>{
    const release=await acquireRemoteConnection(remoteEndpointFromUrl(url));release();expect(invoke).not.toHaveBeenCalled();
  });
  it("logical URL decoding ignores transient ports and retains exact endpoint ownership",()=>{
    expect(remoteEndpointFromUrl(`${remoteSshUrl("remote-identity")}api/chat`)).toBe("remote-identity");
    expect(()=>remoteEndpointFromUrl("http://clack-ssh.invalid/not-hex/api/chat")).toThrow();
  });
  it("acquires before work and releases only its own consumer",async()=>{
    const a=await acquireRemoteConnection("remote"),b=await acquireRemoteConnection("remote");
    const acquisitions=vi.mocked(invoke).mock.calls.filter(([c])=>c==="remote_ssh_acquire");
    expect(acquisitions).toHaveLength(2);expect(acquisitions[0][1]).not.toEqual(acquisitions[1][1]);
    a();a();expect(vi.mocked(invoke).mock.calls.filter(([c])=>c==="remote_ssh_release")).toHaveLength(1);
    b();expect(vi.mocked(invoke).mock.calls.filter(([c])=>c==="remote_ssh_release")).toHaveLength(2);
  });
  it("cancelling one pending consumer neither disconnects nor cancels another consumer",async()=>{
    let done:((v:unknown)=>void)|undefined;
    vi.mocked(invoke).mockImplementation((command)=>command==="remote_ssh_acquire"?new Promise(resolve=>{done=resolve;}):Promise.resolve(undefined));
    const controller=new AbortController();const pending=acquireRemoteConnection("remote",controller.signal);const rejected=expect(pending).rejects.toMatchObject({name:"AbortError"});
    controller.abort();await rejected;done?.({state:"connected"});
    expect(vi.mocked(invoke).mock.calls.filter(([c])=>c==="remote_ssh_release")).toHaveLength(1);
    expect(vi.mocked(invoke).mock.calls.some(([c])=>c==="remote_ssh_disconnect")).toBe(false);
  });
  it("Stop cancels the reconnect preparation through existing inference ownership",async()=>{
    vi.mocked(invoke).mockImplementation(command=>command==="remote_ssh_acquire"?new Promise(()=>{}):Promise.resolve(undefined));
    const scope={sessionId:"saved",runId:"saved-run",isCurrent:()=>true};
    const pending=acquireRemoteConnection("remote",undefined,scope);const rejected=expect(pending).rejects.toMatchObject({name:"AbortError"});
    expect(sessionInference("saved")?.phase).toBe("connecting");await cancelSessionInference("saved");await rejected;expect(sessionInference("saved")).toBeNull();
  });
  it.each(["host-key-changed","authentication-failed","key-unreadable","verification-required","host-unreachable"])("%s produces actionable failure without retries or fallback",async code=>{
    vi.mocked(invoke).mockResolvedValue({state:code});
    const result=await acquireRemoteConnection("remote").catch(e=>e);
    expect(result).toBeInstanceOf(RemoteConnectionError);expect(normalizeAiError(result)).toMatchObject({title:"Remote connection needs attention",errorCode:code});
    expect(vi.mocked(invoke).mock.calls.filter(([c])=>c==="remote_ssh_acquire")).toHaveLength(1);
  });
  it("heartbeats an active lease and stops renewal after release",async()=>{
    vi.useFakeTimers();const release=await acquireRemoteConnection("remote");await vi.advanceTimersByTimeAsync(20_000);
    expect(invoke).toHaveBeenCalledWith("remote_ssh_heartbeat",expect.objectContaining({endpointId:"remote"}));
    release();const calls=vi.mocked(invoke).mock.calls.length;await vi.advanceTimersByTimeAsync(120_000);expect(vi.mocked(invoke).mock.calls).toHaveLength(calls);
  });
  it("holds the consumer for the full streaming lifetime, not only response headers",async()=>{
    const release=vi.fn();let finish:(()=>void)|undefined;
    const stream=holdRemoteStream(new ReadableStream<string>({start(c){c.enqueue("first");finish=()=>c.close();}}),release);
    const reader=stream.getReader();expect(await reader.read()).toEqual({done:false,value:"first"});expect(release).not.toHaveBeenCalled();
    finish?.();await reader.read();expect(release).toHaveBeenCalledOnce();
  });
  it("stream cancellation releases the lease exactly once",async()=>{
    const release=vi.fn();const stream=holdRemoteStream(new ReadableStream(),release);await stream.cancel();expect(release).toHaveBeenCalledOnce();
  });
});
