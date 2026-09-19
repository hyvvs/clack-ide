import { invoke } from "@tauri-apps/api/core";
import {
  asSchema,
  wrapLanguageModel,
  type LanguageModel,
  type ToolSet,
} from "ai";
import { MODEL_CONTEXT_LIMITS } from "@/modules/ai/config";
import {
  assertRequestBudget,
  assertMeasuredRequestBudget,
  ContextBudgetError,
  resolveContextBudget,
  type BudgetLimits,
} from "@/modules/ai/lib/contextBudget";
import {
  budgetIdentity,
  profileBudgetLimits,
} from "@/modules/ai/lib/contextBudgetProfile";
import {
  createSelfHostedProbeClient,
  PROBE_INSTANCE_TTL_MS,
  type ProbeSnapshot,
} from "@/modules/ai/lib/selfHostedProbe";
import {
  readSelfHostedState,
  type SelfHostedState,
} from "@/modules/ai/lib/selfHostedProfiles";
import type { InferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
import { endpointAllowsPrivate } from "@/modules/ai/lib/selfHostedModels";

const modelBudgets = new WeakMap<object, () => Promise<BudgetLimits>>();
export function knownTransportContextLimit(
  modelId: string,
): number | undefined {
  if (
    [
      "openrouter-custom",
      "openai-compatible-custom",
      "lmstudio-local",
      "mlx-local",
      "ollama-local",
    ].includes(modelId)
  )
    return undefined;
  return MODEL_CONTEXT_LIMITS[modelId];
}
export async function modelBudgetLimits(
  model: LanguageModel,
): Promise<BudgetLimits> {
  return typeof model === "object"
    ? ((await modelBudgets.get(model)?.()) ?? {})
    : {};
}
export async function serializedToolSchemas(tools: ToolSet) {
  return Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      type: "function",
      function: {
        name,
        description: tool.description,
        parameters: await asSchema(tool.inputSchema).jsonSchema,
      },
    })),
  );
}

export function createRequestPreflight(options: {
  modelId: string;
  local: boolean;
  state?: SelfHostedState;
  admission?: InferenceAdmission;
  assertedContext?: number;
}) {
  const state = options.state;
  const profile =
    state?.profiles.find((p) => p.id === options.admission?.profileId) ??
    state?.profiles.find(
      (p) =>
        p.endpointId === options.admission?.endpointId &&
        p.transportModelId === options.modelId,
    );
  const endpoint = state?.endpoints.find((e) => e.id === profile?.endpointId);
  const identity =
    state && profile ? budgetIdentity(state, profile.id) : undefined;
  let snapshot: ProbeSnapshot | null = null;
  let refreshAttemptedAt = 0;
  const limits = (): BudgetLimits =>
    profile && state
      ? profileBudgetLimits(state, profile.id, snapshot)
      : options.local
        ? { asserted: options.assertedContext }
        : { reported: knownTransportContextLimit(options.modelId) };
  const refresh = async () => {
    if (!endpoint || !profile) return;
    const client = createSelfHostedProbeClient();
    const probeOptions = {
      endpointId: endpoint.id,
      selectedModelId: profile.transportModelId,
      allowPrivateNetwork: endpointAllowsPrivate(endpoint),
    };
    try {
      snapshot = await client.read(probeOptions);
      if (
        (!snapshot ||
          snapshot.stale ||
          !snapshot.connected ||
          snapshot.configurationRevision !== endpoint.configurationRevision ||
          snapshot.endpointId !== endpoint.id ||
          Date.now() - snapshot.observedAt >= PROBE_INSTANCE_TTL_MS) &&
        Date.now() - refreshAttemptedAt >= PROBE_INSTANCE_TTL_MS
      ) {
        refreshAttemptedAt = Date.now();
        snapshot = await client.refresh(probeOptions);
      }
    } catch {
      /* Optional metadata failure retains only evidence still fresh under A2. */
    }
  };
  const checkIdentity = async () => {
    if (!profile || !identity) return;
    const entries = await invoke<[string, unknown][]>(
      "self_hosted_profiles_snapshot",
    ).catch(() => {
      throw new ContextBudgetError(
        "context-settings-unavailable",
        "Current endpoint settings could not be revalidated. No inference was sent; retry once settings are available.",
      );
    });
    const current = readSelfHostedState(
      new Map(entries).get("selfHostedInference"),
    );
    if (budgetIdentity(current, profile.id) !== identity)
      throw new ContextBudgetError(
        "context-settings-changed",
        "Endpoint/model/profile settings changed while this request was waiting. Start a new request with the current settings.",
      );
  };
  return {
    wrap(model: LanguageModel): LanguageModel {
      if (typeof model === "string" || model.specificationVersion !== "v3")
        throw new ContextBudgetError(
          "context-adapter-unsupported",
          "This adapter has no shared context preflight.",
        );
      const wrapped = wrapLanguageModel({
        model,
        middleware: {
          specificationVersion: "v3",
          async transformParams({ params }) {
            await refresh();
            return {
              ...params,
              maxOutputTokens: resolveContextBudget(
                limits(),
                undefined,
                params.maxOutputTokens,
              ).output,
            };
          },
        },
      });
      modelBudgets.set(wrapped, async () => {
        await refresh();
        return limits();
      });
      return wrapped;
    },
    async prepare(body: Record<string, unknown>) {
      await refresh();
      const measured = assertRequestBudget(limits(), body);
      return async () => {
        await checkIdentity();
        // Admission revalidation is bounded/local only. Never hold capacity for metadata HTTP.
        if (endpoint && profile) {
          try {
            snapshot = await createSelfHostedProbeClient().read({
              endpointId: endpoint.id,
              selectedModelId: profile.transportModelId,
            });
          } catch {
            snapshot = null;
          }
        }
        assertMeasuredRequestBudget(limits(), measured.cost, measured.output);
      };
    },
  };
}

export function preflightFetch(
  fetcher: typeof fetch,
  preflight: ReturnType<typeof createRequestPreflight>,
): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string")
      throw new ContextBudgetError(
        "context-body-unsupported",
        "Cannot account for this request body before inference.",
      );
    const body = JSON.parse(init.body) as Record<string, unknown>;
    await preflight.prepare(body);
    return fetcher(input, init);
  };
}
