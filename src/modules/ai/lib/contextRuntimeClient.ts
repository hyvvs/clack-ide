import { invoke } from "@tauri-apps/api/core";
import { CONTEXT_CALIBRATION } from "@/modules/ai/lib/contextCalibrationSchema";
import {
  contextRuntime,
  rememberContextRuntime,
  forgetContextRuntime,
} from "@/modules/ai/lib/contextCalibrationTrust";
import type { SelfHostedEndpoint } from "@/modules/ai/lib/selfHostedProfiles";
import { endpointAllowsPrivate } from "@/modules/ai/lib/selfHostedModels";

const pending = new Map<string, Promise<void>>();
export async function inspectContextRuntime(
  endpoint: SelfHostedEndpoint,
  force = false,
) {
  const cached = contextRuntime(endpoint.id);
  if (
    !force &&
    cached?.configurationRevision === endpoint.configurationRevision &&
    cached.at <= Date.now() &&
    Date.now() - cached.at < CONTEXT_CALIBRATION.runtimeMs
  )
    return;
  const key = JSON.stringify([endpoint.id, endpoint.configurationRevision]);
  const existing = pending.get(key);
  if (existing) return existing;
  const work = invoke<{
    epoch: string;
    version: string;
    configurationRevision: number;
    at: number;
  }>("self_hosted_context_runtime", {
    endpointId: endpoint.id,
    allowPrivateNetwork: endpointAllowsPrivate(endpoint),
  })
    .then((runtime) => {
      if (
        !runtime ||
        typeof runtime.epoch !== "string" ||
        !runtime.epoch ||
        runtime.epoch.length > 128 ||
        typeof runtime.version !== "string" ||
        !runtime.version ||
        runtime.version.length > 64 ||
        runtime.configurationRevision !== endpoint.configurationRevision ||
        !Number.isSafeInteger(runtime.at)
      )
        throw new Error("Runtime verification unavailable");
      rememberContextRuntime(endpoint.id, runtime);
    })
    .catch((error) => {
      forgetContextRuntime(endpoint.id);
      throw error;
    })
    .finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
