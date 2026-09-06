import { describe, expect, it, vi } from "vitest";
import {
  createSelfHostedProbeClient,
  normalizeProbeError,
  probeEvidenceIsFresh,
  type ProbeSnapshot,
} from "@/modules/ai/lib/selfHostedProbe";
import {
  createSelfHostedEndpoint,
  evidenceSchema,
  type ProfileEvidence,
} from "@/modules/ai/lib/selfHostedProfiles";

const endpoint = createSelfHostedEndpoint(
  { alias: "PC", baseURL: "http://localhost/v1" },
  "e",
  1,
);
const evidence: ProfileEvidence = {
  metric: "probe.loadedContext",
  value: 4096,
  source: "backend-reported",
  observedAt: 1000,
  confidence: "reported",
  scope: {
    endpointId: "e",
    transportModelId: "m",
    deploymentId: "instance",
    configurationRevision: 1,
  },
};
function snapshot(): ProbeSnapshot {
  return {
    endpointId: "e",
    configurationRevision: 1,
    selectedModelId: "m",
    observedAt: Date.now(),
    connected: true,
    reachable: true,
    credentialUsed: true,
    stale: false,
    refreshing: false,
    inventoryTtlMs: 300000,
    instanceTtlMs: 30000,
    models: [{ id: "m", name: null, chat: "unknown", evidence: [evidence] }],
    errors: [],
  };
}

describe("self-hosted probe client", () => {
  it("returns fresh cached evidence without network refresh", async () => {
    const cached = snapshot();
    const call = vi.fn().mockResolvedValue(cached);
    const result = await createSelfHostedProbeClient(call).inspect({
      endpointId: "e",
    });
    expect(result).toEqual({ cached, refresh: null });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("self_hosted_probe_cache", {
      options: { endpointId: "e" },
    });
  });
  it("returns stale inventory immediately while native single-flight refresh continues", async () => {
    const cached = { ...snapshot(), stale: true };
    let resolve: (result: ProbeSnapshot) => void = () => {};
    const pending = new Promise<ProbeSnapshot>((done) => {
      resolve = done;
    });
    const call = vi
      .fn()
      .mockResolvedValueOnce(cached)
      .mockReturnValueOnce(pending);
    const client = createSelfHostedProbeClient(call);
    const result = await client.inspect({
      endpointId: "e",
      selectedModelId: "m",
      allowPrivateNetwork: true,
    });
    expect(result.cached?.models[0]?.id).toBe("m");
    expect(result.refresh).toBe(pending);
    resolve(snapshot());
    expect((await result.refresh)?.connected).toBe(true);
    expect(call.mock.calls[1]).toEqual([
      "self_hosted_probe",
      {
        options: {
          endpointId: "e",
          selectedModelId: "m",
          allowPrivateNetwork: true,
          force: true,
          restart: false,
        },
      },
    ]);
  });
  it("refreshes an expired cache without idle polling", async () => {
    const cached = { ...snapshot(), observedAt: Date.now() - 300001 };
    const call = vi
      .fn()
      .mockResolvedValueOnce(cached)
      .mockResolvedValue(snapshot());
    const result = await createSelfHostedProbeClient(call).inspect({
      endpointId: "e",
    });
    await result.refresh;
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("empty cache requests metadata without inventing models", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...snapshot(), connected: false, models: [] });
    const result = await createSelfHostedProbeClient(call).inspect({
      endpointId: "e",
    });
    expect(result.cached).toBeNull();
    expect((await result.refresh)?.models).toEqual([]);
  });
  it("exposes explicit supersession and native cancellation without credentials in IPC", async () => {
    const call = vi.fn().mockResolvedValue(snapshot());
    const client = createSelfHostedProbeClient(call);
    await client.refresh({ endpointId: "e" }, true);
    await client.cancel("e");
    expect(call.mock.calls).toEqual([
      [
        "self_hosted_probe",
        { options: { endpointId: "e", force: true, restart: true } },
      ],
      ["self_hosted_probe_cancel", { endpointId: "e" }],
    ]);
  });
});

describe("probe evidence and diagnostics", () => {
  it("uses the existing A1 evidence schema", () => {
    expect(evidenceSchema.parse(evidence)).toEqual(evidence);
  });
  it("expires loaded-instance context after 30 seconds", () => {
    expect(probeEvidenceIsFresh(evidence, endpoint, snapshot(), 30999)).toBe(
      true,
    );
    expect(probeEvidenceIsFresh(evidence, endpoint, snapshot(), 31000)).toBe(
      false,
    );
  });
  it("keeps advertised inventory on the five-minute TTL, without treating it as loaded", () => {
    const advertised = {
      ...evidence,
      metric: "probe.advertisedContext",
      source: "advertised" as const,
    };
    const s = snapshot();
    s.models[0].evidence = [advertised];
    expect(probeEvidenceIsFresh(advertised, endpoint, s, 100000)).toBe(true);
    expect(probeEvidenceIsFresh(advertised, endpoint, s, 301000)).toBe(false);
  });
  it("refuses stale, failed, missing and superseded evidence", () => {
    for (const s of [
      null,
      { ...snapshot(), stale: true },
      { ...snapshot(), connected: false },
      { ...snapshot(), configurationRevision: 2 },
      { ...snapshot(), models: [] },
    ]) {
      expect(probeEvidenceIsFresh(evidence, endpoint, s, 2000)).toBe(false);
    }
  });
  it("rejects old endpoint revisions and future observation timestamps", () => {
    expect(
      probeEvidenceIsFresh(
        evidence,
        { ...endpoint, configurationRevision: 2 },
        snapshot(),
        2000,
      ),
    ).toBe(false);
    expect(probeEvidenceIsFresh(evidence, endpoint, snapshot(), 999)).toBe(
      false,
    );
  });
  it("maps safe native failures to existing structured AI diagnostics", () => {
    expect(
      normalizeProbeError({
        code: "authentication-failed",
        statusCode: 401,
        reachable: true,
      }),
    ).toMatchObject({
      kind: "authentication",
      statusCode: 401,
      disposition: "recoverable",
      retryable: false,
    });
    expect(
      normalizeProbeError({
        code: "timeout",
        statusCode: null,
        reachable: false,
      }),
    ).toMatchObject({ kind: "timeout", retryable: true });
    expect(
      normalizeProbeError({
        code: "cancelled",
        statusCode: null,
        reachable: false,
      }),
    ).toMatchObject({ kind: "cancelled", disposition: "terminal" });
  });
});
