/**
 * Acceptance-only *offline* contract checks. These never replace the required
 * actual Windows/Tauri child, authentication, dispatch, or CAS integration.
 */
import { describe, expect, it } from "vitest";
import {
  createManagedDeployment, managedLocalSelectionStatus,
  resolveManagedLocalSelection,
} from "./managedLocalModels";
import { assertManagedLocalNativeRoute } from "./managedLocalRuntime";
import { observedManagedFabric } from "./deploymentQualificationView";
import { emptySelfHostedState } from "./selfHostedProfiles";

const digest = `sha256:${"ab".repeat(32)}`;
const attachment = createManagedDeployment(emptySelfHostedState(), {
  digest,
  displayName: "SYNTHETIC ACCEPTANCE ONLY — NO MODEL",
  material: { version: 1, context: 2048, gpu: 0, tool: false, grammar: false },
});
const route = {
  baseUrl: "http://127.0.0.1:48171/v1",
  apiKey: "a".repeat(64), epoch: "b".repeat(64),
  modelAlias: `clack-${"ab".repeat(8)}`, processId: 24680,
};

describe("LM11 synthetic-runner conceptual isolation (offline supplement)", () => {
  it("does not appear in the ordinary empty Fabric and is inert until native Ready", () => {
    const productionBlank = emptySelfHostedState();
    expect(resolveManagedLocalSelection(productionBlank, attachment.selectionId).status)
      .toBe("missing");
    expect(resolveManagedLocalSelection(attachment.state, attachment.selectionId).status)
      .toBe("unavailable");
    expect(managedLocalSelectionStatus(attachment.state, attachment.selectionId)?.disabled)
      .toBe(true);
    expect(observedManagedFabric(attachment.state, attachment.selectionId, null, Date.now())?.observation)
      .toBeUndefined();
  });

  it("persists a canonical four-node Fabric graph, never a credential or endpoint", () => {
    const fabric = attachment.state.fabric!;
    expect(fabric.hosts).toHaveLength(1);
    expect(fabric.runtimes).toHaveLength(1);
    expect(fabric.artifacts).toHaveLength(1);
    expect(fabric.deployments).toHaveLength(1);
    expect(fabric.artifacts[0].displayName).toContain("SYNTHETIC ACCEPTANCE ONLY");
    expect(attachment.state.endpoints).toEqual([]);
    expect(attachment.state.profiles).toEqual([]);
    const serialized = JSON.stringify(attachment.state);
    expect(serialized).not.toContain(route.apiKey);
    expect(serialized).not.toContain(route.baseUrl);
    expect(serialized).not.toContain("modelPath");
  });

  it("accepts a well-shaped ephemeral loopback native route but rejects malformed identity", () => {
    expect(() => assertManagedLocalNativeRoute(route)).not.toThrow();
    expect(() => assertManagedLocalNativeRoute({ ...route, baseUrl: "https://example.org/v1" }))
      .toThrow(/untrusted/);
    expect(() => assertManagedLocalNativeRoute({ ...route, apiKey: "not-a-token" }))
      .toThrow(/untrusted/);
    expect(() => assertManagedLocalNativeRoute({ ...route, epoch: "old" }))
      .toThrow(/untrusted/);
    expect(() => assertManagedLocalNativeRoute({ ...route, modelAlias: "other-model" }))
      .toThrow(/untrusted/);
    expect(() => assertManagedLocalNativeRoute({ ...route, processId: 0 }))
      .toThrow(/untrusted/);
  });

  it("does not infer native Ready from an installed flag, stale identity or missing PID", () => {
    const base = {
      installed: true, state: "Ready" as const, version: "b12248",
      epoch: "b".repeat(64), deploymentId: attachment.state.fabric!.deployments[0].id,
      modelDigest: digest, processId: 24680,
    };
    for (const status of [
      { ...base, state: "Stopped" as const },
      { ...base, epoch: "" },
      { ...base, modelDigest: `sha256:${"c".repeat(64)}` },
      { ...base, processId: null },
      { ...base, installed: false },
    ]) {
      expect(observedManagedFabric(attachment.state, attachment.selectionId, status, Date.now())?.observation)
        .toBeUndefined();
    }
  });
});
