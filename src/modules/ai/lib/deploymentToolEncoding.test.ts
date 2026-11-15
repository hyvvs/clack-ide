import { afterEach, expect, it } from "vitest";
import { ollamaEffortFixture } from "@/modules/ai/lib/reasoningEffort.fixture";
import { deploymentToolEncoding } from "@/modules/ai/lib/deploymentToolEncoding";
import { rememberContextRuntime, forgetContextRuntime } from "@/modules/ai/lib/contextCalibrationTrust";
import { toolScope } from "@/modules/ai/lib/toolVerification";
import { toolVerificationSchema } from "@/modules/ai/lib/toolVerificationSchema";
import { withLocalComputeFabric } from "@/modules/ai/lib/localComputeFabric";

afterEach(() => forgetContextRuntime("server"));

it("needs genuine deployment-specific native tool verification, not Ollama runtime declarations", () => {
  const f = ollamaEffortFixture();
  f.profile.modelRevision = "digest";
  let state = withLocalComputeFabric(f.state);
  expect(deploymentToolEncoding(state, f.profile)).toMatchObject({
    encoding: "unavailable",
    qualification: "required",
    reason: "native-model-qualification-required",
  });
  const now = Date.now();
  rememberContextRuntime("server", { epoch: "epoch-one", version: "0.40.11",
    configurationRevision: 1, at: now });
  const scope = toolScope(f.profile, f.endpoint, now);
  if (!scope) throw Error("Missing runtime scope");
  const record = toolVerificationSchema.parse({
    version: 1, id: "proof", scope,
    status: "verified", outcome: "native-call",
    context: 4096, output: 512, attempts: [],
    startedAt: now - 10, completedAt: now,
    firstBodyAt: now, callAt: now, calls: 1,
    validArguments: true, textualIntent: false,
    textChars: 0, finish: "tool-calls",
    proof: { at: now, expiresAt: now + 86400_000 }, retryAfter: 0,
  });
  f.profile.toolVerification = record;
  state = withLocalComputeFabric(f.state);
  expect(deploymentToolEncoding(state, f.profile, now)).toMatchObject({
    encoding: "native", qualification: "verified", reason: "native-verified",
  });
  const denied = { ...state, fabric: { ...state.fabric!,
    runtimes: state.fabric!.runtimes.map(runtime => ({
      ...runtime, capabilities: { ...runtime.capabilities,
        "native-tools": { status: "unsupported", source: "verified" },
        "json-schema": { status: "supported", source: "declared" },
        grammar: { status: "supported", source: "declared" },
      },
    })) } };
  expect(deploymentToolEncoding(denied, f.profile, now)).toMatchObject({
    encoding: "unavailable", qualification: "unsupported",
    reason: "runtime-tools-unsupported",
  }); // No fake JSON/grammar executor.
  rememberContextRuntime("server", { epoch: "epoch-two", version: "0.40.11",
    configurationRevision: 1, at: now });
  expect(deploymentToolEncoding(state, f.profile, now)).toMatchObject({
    encoding: "unavailable", qualification: "required",
  });
  const differentDigest = { ...state, profiles: state.profiles.map(p =>
    ({ ...p, modelRevision: "new-digest" })) };
  expect(deploymentToolEncoding(differentDigest, differentDigest.profiles[0], now))
    .toMatchObject({ encoding: "unavailable" });
});
