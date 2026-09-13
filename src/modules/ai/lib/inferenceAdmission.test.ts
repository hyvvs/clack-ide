import { describe, expect, it } from "vitest";
import {
  endpointInferenceAdmission,
  validateInferenceCapacity,
} from "@/modules/ai/lib/inferenceAdmission";
import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  editSelfHostedEndpoint,
  emptySelfHostedState,
  ensureSelfHostedProfile,
  profileEvidence,
  setProfileOverride,
  setProfileRecommendation,
  resetProfileOverride,
} from "@/modules/ai/lib/selfHostedProfiles";

function fixture() {
  let state = addSelfHostedEndpoint(
    emptySelfHostedState(),
    createSelfHostedEndpoint(
      { alias: "AI Server", baseURL: "http://localhost:1234/v1" },
      "a",
    ),
  );
  state = addSelfHostedEndpoint(
    state,
    createSelfHostedEndpoint(
      { alias: "Other", baseURL: "http://localhost:1234/v1" },
      "b",
    ),
  );
  state = ensureSelfHostedProfile(state, "a", "coder").state;
  state = ensureSelfHostedProfile(state, "a", "reviewer").state;
  state = ensureSelfHostedProfile(state, "b", "coder").state;
  return state;
}

describe("endpoint admission policy", () => {
  it.each([
    0,
    -1,
    NaN,
    Infinity,
    1.5,
    9,
    Number.MAX_SAFE_INTEGER,
    "2",
    null,
  ])("rejects invalid capacity %s", (value) => {
    expect(() => validateInferenceCapacity(value)).toThrow();
  });
  it.each([1, 2, 8])("accepts bounded capacity %s", (value) => {
    expect(validateInferenceCapacity(value)).toBe(value);
  });
  it("defaults to one and does not group identical URLs or model names", () => {
    const state = fixture();
    expect(endpointInferenceAdmission("a", "coder", state)).toEqual({
      endpointId: "a",
      profileId: "coder",
      capacity: 1,
    });
    expect(endpointInferenceAdmission("b", "coder", state).endpointId).toBe(
      "b",
    );
    expect(endpointInferenceAdmission("legacy:ollama", "coder").capacity).toBe(
      1,
    );
  });
  it("uses a valid recommendation and shares the ceiling with all endpoint models", () => {
    let state = fixture();
    const id = state.profiles[0].id;
    state = setProfileRecommendation(
      state,
      id,
      "concurrentGenerations",
      profileEvidence(state, id, "concurrentGenerations", 2, "recommendation"),
    );
    expect(endpointInferenceAdmission("a", "reviewer", state).capacity).toBe(2);
    expect(endpointInferenceAdmission("b", "coder", state).capacity).toBe(1);
  });
  it("manual pins win over recommendations; conflicting pins use the lower ceiling", () => {
    let state = fixture();
    const [a, b] = state.profiles;
    state = setProfileRecommendation(
      state,
      a.id,
      "concurrentGenerations",
      profileEvidence(
        state,
        a.id,
        "concurrentGenerations",
        1,
        "recommendation",
      ),
    );
    state = setProfileOverride(state, b.id, "concurrentGenerations", 4);
    expect(endpointInferenceAdmission("a", a.id, state).capacity).toBe(4);
    state = setProfileOverride(state, a.id, "concurrentGenerations", 2);
    expect(endpointInferenceAdmission("a", b.id, state).capacity).toBe(2);
    state = resetProfileOverride(state, a.id, "concurrentGenerations");
    state = resetProfileOverride(state, b.id, "concurrentGenerations");
    expect(endpointInferenceAdmission("a", a.id, state).capacity).toBe(1);
  });
  it("renaming preserves pool and recommendations; address edits invalidate only recommendations", () => {
    let state = fixture();
    const id = state.profiles[0].id;
    state = setProfileRecommendation(
      state,
      id,
      "concurrentGenerations",
      profileEvidence(state, id, "concurrentGenerations", 2, "recommendation"),
    );
    const before = endpointInferenceAdmission("a", id, state);
    state = editSelfHostedEndpoint(state, "a", { alias: "Gaming PC" });
    expect(endpointInferenceAdmission("a", id, state)).toEqual(before);
    state = editSelfHostedEndpoint(state, "a", {
      baseURL: "http://localhost:5678/v1",
    });
    expect(endpointInferenceAdmission("a", id, state)).toEqual({
      ...before,
      capacity: 1,
    });
    state = setProfileOverride(state, id, "concurrentGenerations", 2);
    state = editSelfHostedEndpoint(state, "a", {
      baseURL: "http://localhost:6789/v1",
    });
    expect(endpointInferenceAdmission("a", id, state)).toEqual(before);
  });
  it("refuses new oversized pins and preserves old stored pins while refusing to use them", () => {
    const state = fixture();
    const profile = state.profiles[0];
    expect(() =>
      setProfileOverride(state, profile.id, "concurrentGenerations", 9),
    ).toThrow();
    profile.overrides.concurrentGenerations = {
      mode: "manual",
      evidence: profileEvidence(
        state,
        profile.id,
        "concurrentGenerations",
        99,
        "user-assertion",
      ),
    };
    expect(() => endpointInferenceAdmission("a", profile.id, state)).toThrow();
    expect(profile.overrides.concurrentGenerations.evidence.value).toBe(99);
  });
});
