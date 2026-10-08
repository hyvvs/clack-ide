import { describe, expect, it } from "vitest";
import {
  selfHostedHealth,
  HEALTH_RECENCY_MS,
} from "@/modules/ai/lib/selfHostedHealth";
import {
  calibrationFixture,
  calibrationSample,
} from "@/modules/ai/lib/calibration.fixtures";
import type { ProbeSnapshot } from "@/modules/ai/lib/selfHostedProbe";
import { profileEvidence } from "@/modules/ai/lib/selfHostedProfiles";

function fixture() {
  const state = calibrationFixture(),
    endpoint = state.endpoints[0],
    profile = state.profiles[0];
  const snapshot: ProbeSnapshot = {
    endpointId: endpoint.id,
    configurationRevision: 1,
    selectedModelId: "coder",
    observedAt: 1000000,
    connected: true,
    reachable: true,
    credentialUsed: false,
    stale: false,
    refreshing: false,
    inventoryTtlMs: 300000,
    instanceTtlMs: 30000,
    models: [{ id: "coder", name: null, chat: "supported", evidence: [] }],
    errors: [],
  };
  return { state, endpoint, profile, snapshot };
}
describe("F2 truthful bounded self-hosted health", () => {
  it("uses fresh connection evidence for Ready and expires it to Unverified", () => {
    const f = fixture();
    expect(selfHostedHealth(f, 1000000).label).toBe("Ready");
    expect(selfHostedHealth(f, 1300000).label).toBe("Unverified");
    expect(
      selfHostedHealth(
        { ...f, snapshot: { ...f.snapshot, stale: true } },
        1000000,
      ).label,
    ).toBe("Unverified");
  });
  it("does not reuse another endpoint or configuration revision's evidence", () => {
    const f = fixture();
    for (const patch of [
      { endpointId: "b" },
      { configurationRevision: 2 },
      { observedAt: 1000001 },
    ])
      expect(
        selfHostedHealth(
          { ...f, snapshot: { ...f.snapshot, ...patch } },
          1000000,
        ).label,
      ).toBe("Unverified");
  });
  it.each([
    "unreachable",
    "dns-failure",
    "authentication-failed",
  ] as const)("shows %s even when old model inventory is retained", (code) => {
    const f = fixture();
    f.snapshot.errors.push({
      route: "/models",
      error: { code, statusCode: null, reachable: false },
    });
    expect(selfHostedHealth(f, 1000000).label).toBe(
      code === "authentication-failed" ? "Authentication required" : "Offline",
    );
  });
  it("shows Rate limited from an actual 429 probe result", () => {
    const f = fixture();
    f.snapshot.errors.push({
      route: "/models",
      error: {
        code: "invalid-server-response",
        statusCode: 429,
        reachable: true,
      },
    });
    expect(selfHostedHealth(f, 1000000).label).toBe("Rate limited");
  });
  it.each([
    ["auth", "Authentication required"],
    ["rate-limit", "Rate limited"],
    ["offline", "Offline"],
    ["loading", "Loading"],
    ["resource", "Limited"],
    ["success", "Ready"],
  ] as const)("shows %s only from recent owned inference metadata", (outcome, label) => {
    const f = fixture();
    f.profile.calibration = {
      version: 1,
      samples: [calibrationSample(1, { observedAt: 1000000, outcome })],
      lastTunedAt: null,
      tuning: {},
    };
    expect(selfHostedHealth({ ...f, snapshot: null }, 1000000).label).toBe(
      label,
    );
    expect(
      selfHostedHealth({ ...f, snapshot: null }, 1000000 + HEALTH_RECENCY_MS)
        .label,
    ).toBe("Unverified");
    f.endpoint.configurationRevision = 2;
    expect(selfHostedHealth({ ...f, snapshot: null }, 1000000).label).toBe(
      "Unverified",
    );
  });
  it("does not claim Loading merely because a model is not loaded", () => {
    const f = fixture();
    f.snapshot.models[0].evidence.push(
      profileEvidence(
        f.state,
        f.profile.id,
        "probe.loaded",
        false,
        "backend-reported",
        1000000,
        "reported",
      ),
    );
    expect(selfHostedHealth(f, 1000000)).toMatchObject({
      label: "Limited",
      detail: "Model reported as not loaded",
    });
  });
  it("shows unsupported chat and explicit optimization/checking without fake Ready", () => {
    const f = fixture();
    f.snapshot.models[0].chat = "unsupported";
    expect(selfHostedHealth(f, 1000000).label).toBe("Limited");
    expect(selfHostedHealth({ ...f, calibrating: true }, 1000000).label).toBe(
      "Calibrating",
    );
    expect(selfHostedHealth({ ...f, checking: true }, 1000000).label).toBe(
      "Checking",
    );
  });
  it("shows real admission pressure without applying another endpoint's state", () => {
    const f = fixture();
    const inference = {
      id: "a",
      phase: "queued" as const,
      admission: {
        endpointId: "a",
        profileId: f.profile.id,
        capacity: 1,
        queueEnteredAt: 1,
        admittedAt: null,
        attemptStartedAt: null,
        settledAt: null,
      },
    };
    expect(selfHostedHealth({ ...f, inference }, 1000000).label).toBe(
      "Limited",
    );
    expect(
      selfHostedHealth(
        {
          ...f,
          inference: {
            ...inference,
            admission: { ...inference.admission, endpointId: "b" },
          },
        },
        1000000,
      ).label,
    ).toBe("Ready");
  });
});
