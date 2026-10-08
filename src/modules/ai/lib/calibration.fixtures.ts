import {
  addSelfHostedEndpoint,
  createSelfHostedEndpoint,
  emptySelfHostedState,
  ensureSelfHostedProfile,
} from "@/modules/ai/lib/selfHostedProfiles";
import type { CalibrationSample } from "@/modules/ai/lib/calibrationSchema";

export function calibrationFixture() {
  let state = emptySelfHostedState();
  for (const id of ["a", "b"])
    state = addSelfHostedEndpoint(
      state,
      createSelfHostedEndpoint(
        { alias: id, baseURL: `http://${id}/v1` },
        id,
        1,
      ),
    );
  for (const [endpoint, model, deployment] of [
    ["a", "coder", null],
    ["a", "other", null],
    ["b", "coder", null],
    ["a", "coder", "v2"],
  ] as const)
    state = ensureSelfHostedProfile(
      state,
      endpoint,
      model,
      deployment,
      1,
    ).state;
  return state;
}
export function calibrationSample(
  index = 0,
  patch: Partial<CalibrationSample> = {},
): CalibrationSample {
  return {
    id: `s-${index}`,
    configurationRevision: 1,
    observedAt: 1_000_000 + index,
    requestClass: "generation",
    outcome: "success",
    thermal: "unknown",
    queueMs: 50,
    ttftMs: 1000,
    latencyMs: 5000,
    generationMs: 4000,
    maxGapMs: 500,
    inputTokens: 100,
    outputTokens: 100,
    concurrency: 1,
    outputKind: "text",
    ...patch,
  };
}
