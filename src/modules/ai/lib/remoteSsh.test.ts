import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { remoteSsh, remoteSshMessage, remoteSshSchema, remoteSshUrl } from "@/modules/ai/lib/remoteSsh";
import { addSelfHostedEndpoint, createSelfHostedEndpoint, editSelfHostedEndpoint, emptySelfHostedState, readSelfHostedState } from "@/modules/ai/lib/selfHostedProfiles";
import { compatibleServerBaseURL, saveSelfHostedModel, savedSelfHostedModelInfos, selfHostedPickerStatus, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { ollamaChatURL } from "@/modules/ai/lib/ollamaModel";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({ state: "connected" }) }));
const config = { host: "labpc.local", username: "user", port: 22, keyPath: "C:/A B/.ssh/key", remoteHost: "127.0.0.1" as const, remotePort: 11434 };
function fixture(id = "remote-a") {
  const endpoint = createSelfHostedEndpoint({ alias: "Lab", baseURL: remoteSshUrl(id), ssh: config, allowPrivateNetwork: true, backendHint: "ollama" }, id, 1);
  const state = saveSelfHostedModel(addSelfHostedEndpoint(emptySelfHostedState(), endpoint),id,"exact:variant");
  state.profiles[0].modelRevision = "digest-a";
  return { endpoint, state, selection: selfHostedSelectionId(state.profiles[0]) };
}
describe("secure remote self-hosted connections", () => {
  it.skipIf(!process.env.CLACK_REMOTE_EVIDENCE)("aggregates actual native SSH inventory through the normal model picker", () => {
    const path = process.env.CLACK_REMOTE_EVIDENCE;
    if (!path) throw new Error("Native evidence path required");
    const evidence = JSON.parse(readFileSync(path, "utf8"));
    const state = readSelfHostedState(evidence.state);
    const models = savedSelfHostedModelInfos(state);
    expect(models).toHaveLength(evidence.inventory.models.length);
    expect(models).toHaveLength(10);
    expect(models.every(m => m.hint === "labpc")).toBe(true);
    expect(new Set(models.map(m => m.id)).size).toBe(10);
    expect(evidence.firstPort).not.toBe(11435); expect(evidence.secondPort).not.toBe(evidence.firstPort);
    expect(state.profiles.every(p => !!p.modelRevision && p.endpointId === "remote-acceptance")).toBe(true);
    expect(evidence).toMatchObject({inference:0,downloads:0,cloudInference:0,firstTunnelClosed:true,removedTunnelClosed:true});
  });
  it("persists a key reference and logical endpoint, never a transient port or secret", () => {
    const {state, endpoint} = fixture(); expect(readSelfHostedState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(endpoint.ssh).toEqual(config); expect(endpoint.baseURL).toBe("http://clack-ssh.invalid/72656d6f74652d61/");
    expect(endpoint).not.toHaveProperty("pid"); expect(endpoint).not.toHaveProperty("localPort");
  });
  it.each(["http://localhost:11434", "https://private.example/proxy/v1"])("preserves direct %s", baseURL => {
    const e = createSelfHostedEndpoint({ alias:"Direct", baseURL },"direct",1);
    expect(readSelfHostedState(addSelfHostedEndpoint(emptySelfHostedState(),e)).endpoints).toEqual([e]);
  });
  it.each(["host;evil", "-oProxyCommand=evil", "a\nb", "user@host"])("rejects unsafe host %s",host => {
    expect(remoteSshSchema.safeParse({...config,host}).success).toBe(false);
  });
  it("rejects unsafe remote targets, unknown fields, ports and credential bytes", () => {
    for (const patch of [{remoteHost:"192.168.1.2"},{port:0},{remotePort:65536},{password:"secret"},{privateKey:"bytes"}])
      expect(remoteSshSchema.safeParse({...config,...patch}).success).toBe(false);
  });
  it("rejects mismatched connection URL and credentials rather than detaching ownership", () => {
    const {state} = fixture(); const raw = structuredClone(state); raw.endpoints[0].baseURL = remoteSshUrl("other");
    expect(readSelfHostedState(raw).endpoints).toHaveLength(0);
    expect(() => createSelfHostedEndpoint({alias:"bad", baseURL:remoteSshUrl("a")},"a")).toThrow();
  });
  it("preserves model, favorite, recent and chat selection identity across aliases/reconnects", () => {
    const {state, selection} = fixture(); const next = editSelfHostedEndpoint(state,"remote-a",{alias:"New label"},2);
    expect(next.endpoints[0].configurationRevision).toBe(1); expect(selfHostedSelectionId(next.profiles[0])).toBe(selection);
    expect(savedSelfHostedModelInfos(next)[0]).toMatchObject({id:selection,hint:"New label"});
    expect(next.profiles[0]).toEqual(state.profiles[0]);
  });
  it("keeps identical model tags on two remote connections distinct", () => {
    const a = fixture("a"), b = fixture("b"); expect(a.selection).not.toBe(b.selection);
    expect(a.state.profiles[0].id).not.toBe(b.state.profiles[0].id);
  });
  it("invalidates configuration evidence on host/port/auth changes but keeps profile history", () => {
    const {state} = fixture(); const next = editSelfHostedEndpoint(state,"remote-a",{ssh:{...config,host:"different"}},2);
    expect(next.endpoints[0].configurationRevision).toBe(2); expect(next.profiles).toEqual(state.profiles);
  });
  it("keeps exact native Ollama route under the stable logical connection prefix", () => {
    const {endpoint} = fixture(); const base = compatibleServerBaseURL(endpoint);
    expect(base).toBe(`${endpoint.baseURL}v1`);
    expect(ollamaChatURL(base)).toBe(`${endpoint.baseURL}api/chat`);
  });
  it("disconnected remote models are unavailable without cloud fallback or profile deletion", () => {
    const {state,selection} = fixture(); expect(selfHostedPickerStatus(selection,state)).toEqual({label:"Disconnected",disabled:true});
    expect(savedSelfHostedModelInfos(state)).toHaveLength(1);
    state.inventories=[{endpointId:"remote-a",configurationRevision:1,observedAt:Date.now(),connected:false,models:[],error:"unreachable"}];
    expect(selfHostedPickerStatus(selection,state)?.disabled).toBe(true);
  });
  it("uses bounded native commands with no private data in status/trust requests", async () => {
    const {invoke} = await import("@tauri-apps/api/core");
    await remoteSsh.connect("a","SHA256:public"); await remoteSsh.disconnect("a"); await remoteSsh.status("a");
    expect(invoke).toHaveBeenCalledWith("remote_ssh_connect",{endpointId:"a",approveFingerprint:"SHA256:public"});
    expect(invoke).toHaveBeenCalledWith("remote_ssh_disconnect",{endpointId:"a"});
  });
  it.each(["authentication-failed","host-key-changed","ssh-unavailable","host-unreachable","verification-required","key-unreadable","offline"])("presents actionable redacted %s",state => {
    expect(remoteSshMessage(state)).not.toContain("could not be established");
    expect(remoteSshMessage(state)).not.toContain(config.keyPath);
  });
});
