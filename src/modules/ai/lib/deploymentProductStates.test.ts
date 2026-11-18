import { describe, expect, it } from "vitest";
import { actionableQualificationError, deploymentProductSummary } from "./deploymentProductStates";
import type { EvidenceCandidate } from "./deploymentEvidenceDecisions";
import type { LocalComputeFabric } from "./localComputeFabric";

const status = (value: string, available = false) => ({ state: value, available,
  reason: value, lastResultAt: null });
const basic = () => ({
  deploymentId: "deployment-1", hostId: "host-1", runtimeId: "runtime-1",
  ready: false, readiness: "Stopped", qualification: {
    chat: status("Qualification Stale"),
    instruction: status("Qualification Failed"),
    nativeTools: status("Unsupported"),
  },
}) as unknown as EvidenceCandidate;
const fabric = () => ({
  hosts: [{ id: "host-1", enabled: true, reachability: "online" }],
  runtimes: [{ id: "runtime-1", enabled: true, health: "online" }],
  artifacts: [{ id: "artifact-1" }],
  deployments: [{ id: "deployment-1", artifactId: "artifact-1" }],
}) as unknown as LocalComputeFabric;

describe("LM15 user-facing production states and safe error UX", () => {
  it("01 separates Stopped readiness from stale Chat and recorded failure", () => {
    expect(deploymentProductSummary(basic(), fabric())).toMatchObject({
      readiness: "Stopped", qualification: "Stale",
      instruction: "Qualification Failed", nativeTools: "Unsupported",
    });
  });
  it("02 distinguishes offline host from a stopped runtime", () => {
    const f = fabric(); f.hosts[0].reachability = "offline";
    expect(deploymentProductSummary(basic(), f).readiness).toBe("Offline");
  });
  it("03 missing model artifact has an actionable Missing state", () => {
    const f = fabric(); f.artifacts = [];
    expect(deploymentProductSummary(basic(), f).readiness).toBe("Missing");
  });
  it("04 trusted Ready and Qualified remain separate labels", () => {
    const c = basic(); c.ready = true; c.qualification.chat = status("Qualified", true) as
      EvidenceCandidate["qualification"]["chat"];
    expect(deploymentProductSummary(c, fabric())).toMatchObject({
      readiness: "Ready", qualification: "Qualified",
    });
  });
  it("05 empty unknown statuses never become positive", () => {
    const c = basic(); c.readiness = "Unverified";
    c.qualification.chat = status("Unknown") as EvidenceCandidate["qualification"]["chat"];
    expect(deploymentProductSummary(c, fabric())).toMatchObject({
      readiness: "Unknown", qualification: "Unknown",
    });
  });
  it("06 internal errors do not expose paths, tokens or provider payloads", () => {
    expect(actionableQualificationError(new Error("secret /Users/account/apiKey=xyz")))
      .not.toContain("apiKey");
  });
  it("07 expiry and runtime mutation report stale qualification", () => {
    expect(actionableQualificationError(new Error("native epoch changed"))).toContain("stale");
  });
  it("08 missing hardware data stays actionable and conservative", () => {
    expect(actionableQualificationError(new Error("hardware telemetry read failed")))
      .toContain("Hardware telemetry unavailable");
  });
  it("09 a timeout never grants capability", () => {
    expect(actionableQualificationError(new Error("stream idle timeout")))
      .toContain("no capability was granted");
  });
  it("10 permission and native tools errors are distinct", () => {
    expect(actionableQualificationError(new Error("Chat-only Coder required")))
      .toContain("will not change permissions");
    expect(actionableQualificationError(new Error("native tools unqualified")))
      .toContain("Native tools are not qualified");
  });
});
