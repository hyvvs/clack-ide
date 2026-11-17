import { afterEach, describe, expect, it } from "vitest";
import {
  attachManagedLocalGguf,
  resolveManagedLocalSelection,
} from "@/modules/ai/lib/managedLocalModels";
import type { ManagedLocalNativeStatus } from "@/modules/ai/lib/managedLocalRuntime";
import {
  addSelfHostedEndpoint, createSelfHostedEndpoint, emptySelfHostedState,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import { saveSelfHostedModel, selfHostedSelectionId } from "@/modules/ai/lib/selfHostedModels";
import { withLocalComputeFabric } from "@/modules/ai/lib/localComputeFabric";
import {
  forgetContextRuntime,
  rememberContextRuntime,
} from "@/modules/ai/lib/contextCalibrationTrust";
import { toolScope } from "@/modules/ai/lib/toolVerification";
import { toolVerificationSchema } from "@/modules/ai/lib/toolVerificationSchema";
import { deploymentQualificationView } from "./deploymentQualificationView";

const at = 1_800_000_000_000;
const digest = `sha256:${"a".repeat(64)}`;
const material = { version: 1 as const, context: 2048, gpu: 0 as const,
  tool: false as const, grammar: false as const };
const endpointId = "verified-ollama-host";

function managed(): { state: SelfHostedState; selectionId: string; native: ManagedLocalNativeStatus } {
  const created = attachManagedLocalGguf(emptySelfHostedState(), {
    digest, displayName: "Qwen", material,
  });
  const selected = resolveManagedLocalSelection(created.state, created.selectionId);
  if (selected.status === "missing" || selected.status === "not-managed")
    throw new Error("Managed test fixture unavailable");
  return {
    ...created,
    native: {
      installed: true, state: "Ready", version: "b12248",
      epoch: "f".repeat(64), processId: 4421, port: 61422,
      deploymentId: selected.deployment.id,
      modelDigest: selected.artifact.digest,
    },
  };
}

function ollama(): { state: SelfHostedState; selectionId: string } {
  const endpoint = createSelfHostedEndpoint({
    alias: "Existing Ollama", baseURL: "http://127.0.0.1:11434/",
    backendHint: "ollama", allowPrivateNetwork: true,
  }, endpointId, at - 4_000);
  let state = addSelfHostedEndpoint(emptySelfHostedState(), endpoint);
  state = saveSelfHostedModel(state, endpoint.id, "existing-devstral");
  state.profiles[0].modelRevision = digest;
  state.inventories = [{
    endpointId, configurationRevision: endpoint.configurationRevision,
    observedAt: at - 5, connected: true, backend: "ollama",
    version: "0.40.11", models: [{ id: "existing-devstral", name: "Devstral",
      chat: "supported", digest }],
  }];
  state = withLocalComputeFabric(state);
  rememberContextRuntime(endpointId, {
    epoch: "live-epoch", version: "0.40.11",
    configurationRevision: endpoint.configurationRevision, at: at - 10,
  });
  const scope = toolScope(state.profiles[0], endpoint, at)!;
  const proof = toolVerificationSchema.parse({
    version: 1, id: "existing-native-tool-proof", scope,
    status: "verified", outcome: "native-call", context: 4096,
    output: 512, attempts: [], startedAt: at - 300, completedAt: at - 200,
    firstBodyAt: at - 150, callAt: at - 120, calls: 1,
    validArguments: true, textualIntent: false, textChars: 0,
    finish: "tool-calls", proof: { at: at - 100, expiresAt: at + 86_400_000 },
    retryAfter: 0,
  });
  state.profiles[0].toolVerification = proof;
  return { state, selectionId: selfHostedSelectionId(state.profiles[0]) };
}
afterEach(() => forgetContextRuntime(endpointId));

describe("LM2F exact deployment view and legacy evidence", () => {
  it("native managed Ready is Chat transport readiness, NOT proof of Chat or Agent qualification", () => {
    const { state, selectionId, native } = managed();
    const unchanged = structuredClone(state);
    const view = deploymentQualificationView(state, selectionId, native, at)!;
    expect(view.readiness).toContain("Native Ready");
    expect(view.panel.chat.state).toBe("Requires Qualification");
    expect(view.panel.streaming.available).toBe(false);
    expect(view.panel.nativeTools.state).toBe("Unsupported");
    expect(view.panel.agent.eligible).toBe(false);
    expect(view.instruction.available).toBe(false);
    expect(state).toEqual(unchanged); // Read-only status never mutates persisted trust.
  });

  it.each([
    ["different digest", (s: ManagedLocalNativeStatus) => { s.modelDigest = `sha256:${"b".repeat(64)}`; }],
    ["different deployment", (s: ManagedLocalNativeStatus) => { s.deploymentId = "other"; }],
    ["different epoch", (s: ManagedLocalNativeStatus) => { s.epoch = ""; }],
    ["different version", (s: ManagedLocalNativeStatus) => { s.version = "b12247"; }],
    ["missing native process", (s: ManagedLocalNativeStatus) => { s.processId = null; }],
    ["stopped runtime", (s: ManagedLocalNativeStatus) => { s.state = "Stopped"; }],
  ])("matching runtime identity is mandatory for Ready: %s", (_reason, change) => {
    const { state, selectionId, native } = managed();
    change(native);
    const view = deploymentQualificationView(state, selectionId, native, at)!;
    expect(view.readiness).toContain("no matching current native Ready");
    expect(view.panel.chat.available).toBe(false);
  });

  it("recognizes current legacy Ollama native tool verification without inventing Agent or JSON proof", () => {
    const { state, selectionId } = ollama();
    const view = deploymentQualificationView(state, selectionId, null, at)!;
    expect(view.legacyNativeToolQualification).toBe("Verified");
    expect(view.panel.nativeTools.state).toBe("Qualified");
    expect(view.panel.nativeTools.reason).toMatch(/legacy Ollama/);
    expect(view.panel.agent.eligible).toBe(false);
    expect(view.panel.structured.available).toBe(false);
    expect(view.instruction.available).toBe(false);
  });

  it("does not reuse a historical native tool qualification after epoch change", () => {
    const { state, selectionId } = ollama();
    rememberContextRuntime(endpointId, {
      epoch: "new-epoch", version: "0.40.11",
      configurationRevision: 1, at,
    });
    const view = deploymentQualificationView(state, selectionId, null, at)!;
    expect(view.panel.nativeTools.state).not.toBe("Qualified");
    expect(view.panel.agent.eligible).toBe(false);
  });
});
