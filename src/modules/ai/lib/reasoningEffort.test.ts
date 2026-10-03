import { describe, expect, it } from "vitest";
import {
  captureEffort,
  effortBudget,
  effortCapability,
  effortKey,
  effortProviderOptions,
  type EffortPreferences,
} from "@/modules/ai/lib/reasoningEffort";
import type { ModelTransportIdentity } from "@/modules/ai/lib/savedProviderModels";
import { hostedEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { resolveContextBudget } from "@/modules/ai/lib/contextBudget";

const identity: ModelTransportIdentity = {
  providerId: "openai",
  transportModelId: "gpt-5.4-mini",
};
function preferences(choice = "high"): EffortPreferences {
  return {
    version: 1,
    choices: [
      {
        key: effortKey("saved", identity),
        choice,
        revision: effortCapability(identity).revision,
      },
    ],
  };
}

describe("evidenced reasoning effort", () => {
  it("distinguishes supported, unsupported and unknown without prefix guesses", () => {
    expect(effortCapability(identity).status).toBe("supported");
    expect(
      effortCapability({ ...identity, transportModelId: "gpt-4.1-mini" })
        .status,
    ).toBe("unsupported");
    expect(
      effortCapability({
        ...identity,
        transportModelId: "gpt-5.4-mini-unverified",
      }).status,
    ).toBe("unknown");
    expect(
      effortCapability({ ...identity, providerId: "openrouter" }).status,
    ).toBe("unknown");
    expect(
      effortCapability({ ...identity, endpointBaseURL: "https://proxy.test" })
        .status,
    ).toBe("unknown");
  });
  it("keeps provider-specific level sets and numeric budgets distinct", () => {
    expect(
      effortCapability({
        providerId: "anthropic",
        transportModelId: "claude-opus-4-7",
      }).levels,
    ).toContain("max");
    expect(
      effortCapability({
        providerId: "google",
        transportModelId: "gemini-3.1-pro-preview",
      }).levels,
    ).not.toContain("minimal");
    expect(
      effortCapability({
        providerId: "google",
        transportModelId: "gemini-2.5-pro",
      }).levels,
    ).toEqual(["1024", "4096", "8192"]);
  });
  it.each([
    "ultra",
    "persistent",
    "banana",
    "max",
  ])("invalid saved value %s degrades to Automatic", (choice) => {
    expect(captureEffort("saved", identity, preferences(choice)).choice).toBe(
      "automatic",
    );
  });
  it("unknown schema, stale evidence and duplicates fail safe", () => {
    expect(
      captureEffort("saved", identity, {
        ...preferences(),
        version: 2,
      } as unknown as EffortPreferences).choice,
    ).toBe("automatic");
    const stale = preferences();
    stale.choices[0].revision = "old";
    expect(captureEffort("saved", identity, stale).choice).toBe("automatic");
    const duplicate = preferences();
    duplicate.choices.push(duplicate.choices[0]);
    expect(captureEffort("saved", identity, duplicate).choice).toBe(
      "automatic",
    );
  });
  it("roundtrips per-model choices without transferring them to another route", () => {
    const saved = JSON.parse(JSON.stringify(preferences()));
    expect(captureEffort("saved", identity, saved).choice).toBe("high");
    expect(captureEffort("other-chat-model", identity, saved).choice).toBe(
      "automatic",
    );
    expect(
      captureEffort(
        "saved",
        { ...identity, transportModelId: "gpt-4.1-mini" },
        saved,
      ).choice,
    ).toBe("automatic");
    expect(captureEffort("saved", identity, saved).choice).toBe("high");
  });
  it("captures independent values and never requests visible reasoning", () => {
    const saved = preferences();
    const a = captureEffort("saved", identity, saved);
    const b = captureEffort("saved", identity);
    saved.choices[0].choice = "low";
    expect(a.choice).toBe("high");
    expect(b.choice).toBe("automatic");
    expect(effortProviderOptions(a)).toEqual({
      openai: { reasoningEffort: "high" },
    });
    expect(effortProviderOptions(b)).toEqual({});
  });
  it("accepts only scoped, fresh, nonconflicting backend effort declarations", () => {
    const f = hostedEffortFixture();
    expect(effortCapability(f.identity, f.state).levels).toEqual([
      "low",
      "high",
    ]);
    expect(effortCapability(f.identity).status).toBe("unknown");
    expect(
      effortCapability(f.identity, f.state, Date.now() + 31_000).status,
    ).toBe("unknown");
    f.profile.evidence.push({ ...f.evidence });
    expect(effortCapability(f.identity, f.state).status).toBe("unknown");
  });
  it("backend denial, revision changes, forged scopes and generic compatibility do not enable effort", () => {
    const no = hostedEffortFixture("unsupported");
    expect(effortCapability(no.identity, no.state).status).toBe("unsupported");
    const f = hostedEffortFixture();
    f.endpoint.configurationRevision++;
    expect(effortCapability(f.identity, f.state).status).toBe("unknown");
    f.endpoint.configurationRevision--;
    f.evidence.scope.transportModelId = "other";
    expect(effortCapability(f.identity, f.state).status).toBe("unknown");
    expect(
      effortCapability({
        providerId: "ollama",
        transportModelId: "gpt-5.4-mini",
      }).status,
    ).toBe("unknown");
  });
  it("reserves numeric reasoning within total output exactly once and can change admission", () => {
    const cost = {
      system: 1000,
      tools: 1000,
      conversation: 7000,
      uncertainMedia: false,
    };
    const normal = resolveContextBudget({ reported: 14000 }, cost);
    const budgeted = resolveContextBudget(
      { reported: 14000, reasoningBudget: 8192 },
      cost,
    );
    expect(normal.fits).toBe(true);
    expect(budgeted.fits).toBe(false);
    expect(budgeted.reserve).toBe(normal.reserve + 8192);
    expect(
      resolveContextBudget(
        { reported: 20000, reasoningBudget: 1024 },
        undefined,
        4096,
      ).reserve,
    ).toBe(4096);
    expect(() =>
      resolveContextBudget({
        reported: 20000,
        maxOutput: 1024,
        reasoningBudget: 1024,
      }),
    ).toThrow("leave room");
    expect(
      effortBudget(captureEffort("saved", identity, preferences())),
    ).toBeUndefined();
  });
});
