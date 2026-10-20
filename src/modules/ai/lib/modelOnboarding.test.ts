import { afterEach, describe, expect, it, vi } from "vitest";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import {
  modelOnboarding,
  profileSnapshot,
} from "@/modules/ai/lib/modelOnboarding";
import {
  profileEvidence,
  readSelfHostedState,
  setProfileOverride,
  setProfileRecommendation,
} from "@/modules/ai/lib/selfHostedProfiles";
import {
  captureEffort,
  effortProviderOptions,
} from "@/modules/ai/lib/reasoningEffort";
import {
  selfHostedPickerStatus,
  selfHostedSelectionId,
  selfHostedTransportIdentity,
} from "@/modules/ai/lib/selfHostedModels";
import { effectiveFallback } from "@/modules/ai/lib/inferenceFallback";

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Fixture value missing");
  return value;
}
function onboardingFixture(values: unknown = [false, true, "medium"]) {
  const f = ollamaEffortFixture(values, "unrelated-tag");
  f.profile.modelRevision = "digest-1";
  f.profile.backend = "ollama";
  f.profile.evidence = f.profile.evidence.map((e) => ({
    ...e,
    scope: { ...e.scope, modelRevision: "digest-1" },
  }));
  f.state.inventories = [
    {
      endpointId: f.endpoint.id,
      configurationRevision: 1,
      observedAt: Date.now(),
      connected: true,
      backend: "ollama",
      models: [
        {
          id: f.profile.transportModelId,
          name: null,
          chat: "supported",
          digest: "digest-1",
        },
      ],
    },
  ];
  const add = (
    metric: string,
    value: string | boolean | number,
    measured = false,
  ) => {
    const evidence = profileEvidence(
      f.state,
      f.profile.id,
      metric,
      value,
      measured ? "measured" : "backend-reported",
      Date.now(),
      measured ? "observed" : "reported",
    );
    f.profile.evidence = [
      ...f.profile.evidence.filter((e) => e.metric !== metric),
      evidence,
    ];
    return evidence;
  };
  add("probe.runtimeContext", "per-request");
  add("probe.advertisedContext", 1_048_576);
  add("probe.trainedForTools", true);
  add("probe.vision", false);
  return {
    ...f,
    add,
    view: () => required(modelOnboarding(f.state, f.profile)),
  };
}
afterEach(() => vi.restoreAllMocks());

describe("revision-aware onboarding recommendations", () => {
  it("inventory and advertised tools never certify readiness or tool parser verification", () => {
    const f = onboardingFixture();
    expect(f.view()).toMatchObject({
      status: "Unverified",
      tools: "Advertised / unverified",
      vision: "Unsupported",
      structuredOutput: "Unverified",
    });
    expect(
      selfHostedPickerStatus(selfHostedSelectionId(f.profile), f.state),
    ).toEqual({ label: "Unverified", disabled: false });
  });
  it.each([
    "tools",
    "vision",
    "structuredOutput",
  ])("keeps %s measured verification distinct from advertisement", (name) => {
    const f = onboardingFixture();
    f.add(`verification.${name}.v1`, true, true);
    expect(f.view()[name as "tools" | "vision" | "structuredOutput"]).toBe(
      "Verified",
    );
    required(
      f.profile.evidence.find((e) => e.metric.startsWith("verification.")),
    ).source = "advertised";
    expect(f.view()[name as "tools" | "vision" | "structuredOutput"]).not.toBe(
      "Verified",
    );
  });
  it("unsupported tools remain unsupported, not falsely verified", () => {
    const f = onboardingFixture();
    f.add("probe.trainedForTools", false);
    expect(f.view().tools).toBe("Unsupported");
  });
  it.each([
    {
      values: [false, "low", "medium", "high", "max"],
      default: "medium",
      recommendation: "Medium",
      levels: ["none", "low", "medium", "high", "max"],
    },
    {
      values: [false, true],
      default: true,
      recommendation: "On",
      levels: ["none", "on"],
    },
    {
      values: [false, true, "medium"],
      default: false,
      recommendation: "None",
      levels: ["none", "on", "medium"],
    },
    {
      values: [false, "future-level"],
      default: "future-level",
      recommendation: "Provider default",
      levels: ["none"],
    },
  ])("normalizes legal controls generically and prefers provider default: $values", ({
    values,
    default: value,
    recommendation,
    levels,
  }) => {
    const f = onboardingFixture(values);
    f.add("probe.thinkingDefault", value);
    expect(f.view().reasoning.recommended).toBe(recommendation);
    expect(f.view().reasoning.capability.levels).toEqual(levels);
    expect(
      effortProviderOptions(
        captureEffort("selection", f.identity, undefined, f.state),
      ),
    ).toEqual({});
  });
  it("provider omission remains Automatic when no default is reported", () => {
    expect(onboardingFixture().view().reasoning).toMatchObject({
      recommended: "Provider default",
      wire: "omit",
      provenance: "provider-default-omission",
    });
  });
  it("an explicit reasoning override survives a changed recommendation and serializes only its legal wire value", () => {
    const f = onboardingFixture();
    f.add("probe.thinkingDefault", true);
    const before = captureEffort("selection", f.identity, undefined, f.state);
    const preferences = {
      version: 1 as const,
      choices: [
        {
          key: before.key,
          revision: before.capability.revision,
          choice: "none",
        },
      ],
    };
    f.add("probe.thinkingDefault", "medium");
    expect(f.view().reasoning.recommended).toBe("Medium");
    const after = captureEffort("selection", f.identity, preferences, f.state);
    expect(after.choice).toBe("none");
    expect(effortProviderOptions(after)).toEqual({ ollama: { think: false } });
  });
  it("huge advertised maxima never select 500K/1M or manufacture practical calibration", () => {
    const f = onboardingFixture();
    expect(f.view().context).toMatchObject({
      recommended: 4096,
      advertised: 1048576,
      verified: undefined,
      provenance: "conservative-policy",
    });
    expect(f.view().output).toMatchObject({
      recommended: 614,
      provenance: "existing-budget-policy",
    });
  });
  it("consumes existing valid measured working-context recommendations through B1, not model maxima", () => {
    const f = onboardingFixture();
    const measurement = profileEvidence(
      f.state,
      f.profile.id,
      "workingContext",
      32768,
      "measured",
      Date.now(),
      "observed",
    );
    f.state = setProfileRecommendation(
      f.state,
      f.profile.id,
      "workingContext",
      measurement,
    );
    f.profile = f.state.profiles[0];
    expect(modelOnboarding(f.state, f.profile)?.context).toMatchObject({
      recommended: 32768,
      verified: 32768,
    });
    expect(modelOnboarding(f.state, f.profile)?.status).toBe("Unverified");
  });
  it("Ready requires current practical context plus measured tools and reasoning, not enumeration", () => {
    const f = onboardingFixture();
    f.add("verification.tools.v1", true, true);
    f.add("verification.reasoning.v1", true, true);
    const state = setProfileRecommendation(
      f.state,
      f.profile.id,
      "workingContext",
      profileEvidence(
        f.state,
        f.profile.id,
        "workingContext",
        32768,
        "measured",
        Date.now(),
        "observed",
      ),
    );
    expect(modelOnboarding(state, state.profiles[0])?.status).toBe("Ready");
  });
  it("manual context/output remain active independently of Automatic recommendations", () => {
    const f = onboardingFixture();
    let state = setProfileOverride(
      f.state,
      f.profile.id,
      "workingContext",
      16384,
    );
    state = setProfileOverride(state, f.profile.id, "maxOutput", 2048);
    const view = required(modelOnboarding(state, state.profiles[0]));
    expect(view.context).toMatchObject({ override: 16384, recommended: 4096 });
    expect(view.output.override).toBe(2048);
    expect(state.profiles[0].overrides.workingContext?.evidence.source).toBe(
      "user-assertion",
    );
  });
  it("stale capability, digest and connection evidence cannot certify verification", () => {
    const f = onboardingFixture();
    f.add("verification.tools.v1", true, true);
    const original = JSON.stringify(f.state);
    for (const mutate of [
      () => {
        f.profile.modelRevision = "digest-2";
      },
      () => {
        f.endpoint.configurationRevision++;
      },
      () => {
        f.profile.evidence.forEach((e) => {
          e.observedAt = 1;
        });
      },
    ]) {
      mutate();
      expect(f.view().tools).toBe("Unverified");
    }
    expect(original).not.toBe(JSON.stringify(f.state));
  });
  it("known verification failure blocks use without any cloud reroute", () => {
    const f = onboardingFixture();
    f.add("verification.tools.v1", false, true);
    expect(f.view().status).toBe("Incompatible");
    expect(() =>
      selfHostedTransportIdentity(selfHostedSelectionId(f.profile), f.state),
    ).toThrow(/Incompatible/);
    expect(effectiveFallback(undefined)).toBeNull();
  });
  it("expired inventory cannot erase a still-current failed compatibility verification", () => {
    const f = onboardingFixture();
    f.add("verification.reasoning.v1", false, true);
    required(f.state.inventories)[0].observedAt = Date.now() - 300_001;
    expect(selfHostedPickerStatus(selfHostedSelectionId(f.profile), f.state)).toEqual({ label: "Incompatible", disabled: true });
    expect(() => selfHostedTransportIdentity(selfHostedSelectionId(f.profile), f.state)).toThrow(/Incompatible/);
  });
  it("offline and return propagate without changing model identity or explicit pins", () => {
    const f = onboardingFixture();
    const id = selfHostedSelectionId(f.profile);
    required(f.state.inventories)[0].connected = false;
    expect(f.view().status).toBe("Offline");
    required(f.state.inventories)[0].connected = true;
    expect(f.view().status).toBe("Unverified");
    expect(selfHostedSelectionId(f.profile)).toBe(id);
  });
  it("generic/ambiguous provider remains unknown, never inferring Ollama from a model name", () => {
    const f = onboardingFixture();
    f.endpoint.backendHint = undefined;
    expect(f.view().reasoning.capability.status).toBe("unknown");
    expect(f.view().identity[0]).toBeUndefined();
  });
  it("profile state round-trips without a second database or secret/raw transcript copies", () => {
    const f = onboardingFixture();
    const restored = readSelfHostedState(JSON.parse(JSON.stringify(f.state)));
    expect(modelOnboarding(restored, restored.profiles[0])).toEqual(f.view());
    expect(
      profileSnapshot(restored, restored.profiles[0])?.models,
    ).toHaveLength(1);
  });
  it("duplicate model tags on other connections do not inherit profile verification", () => {
    const a = onboardingFixture(),
      b = onboardingFixture();
    a.add("verification.tools.v1", true, true);
    b.endpoint.id = "server-b";
    b.profile.endpointId = "server-b";
    expect(b.view().tools).toBe("Unverified");
    expect(a.view().tools).toBe("Verified");
  });
});
