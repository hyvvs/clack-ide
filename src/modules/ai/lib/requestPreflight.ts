import { invoke } from "@tauri-apps/api/core";
import {
  asSchema,
  wrapLanguageModel,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { ProviderId } from "@/modules/ai/config";
export { knownTransportContextLimit } from "@/modules/ai/config";
import { resolveProviderContext } from "@/modules/ai/lib/providerContext";
import {
  assertRequestBudget,
  assertMeasuredRequestBudget,
  ContextBudgetError,
  resolveContextBudget,
  type BudgetLimits,
  type SchemaKind,
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
import { probeEvidenceIsFresh } from "@/modules/ai/lib/selfHostedProbe";
import type { InferenceAdmission } from "@/modules/ai/lib/inferenceAdmission";
import { endpointAllowsPrivate } from "@/modules/ai/lib/selfHostedModels";
import {
  effortBudget,
  effortProviderOptions,
  type EffortCapture,
} from "@/modules/ai/lib/reasoningEffort";

const modelBudgets = new WeakMap<object, () => Promise<BudgetLimits>>();
const modelDiagnostics = new WeakMap<
  object,
  (kinds: Record<string, SchemaKind>, available: number) => void
>();
export function setModelSchemaDiagnostics(
  model: LanguageModel,
  kinds: Record<string, SchemaKind>,
  available: number,
) {
  if (typeof model === "object") modelDiagnostics.get(model)?.(kinds, available);
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
  validateRouting?: () => Promise<void>;
  requireRequestedOutput?: boolean;
  cachedMetadataOnly?: boolean;
  modelId: string;
  providerId?: ProviderId;
  local: boolean;
  state?: SelfHostedState;
  admission?: InferenceAdmission;
  assertedContext?: number;
  reasoning?: EffortCapture;
  optimization?: boolean;
  validateEvidence?: () => Promise<void>;
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
  let schemaKinds: Record<string, SchemaKind> = {};
  let availableSchemas: number | undefined;
  let providerLimits: BudgetLimits = {};
  const limits = (): BudgetLimits => ({
    ...(options.optimization ? { inputCap: 1365, outputCap: 170 } : {}),
    ...(profile && state
      ? profileBudgetLimits(state, profile.id, snapshot)
      : options.local
        ? { asserted: options.assertedContext }
        : {
            ...providerLimits,
            asserted: options.assertedContext,
          }),
    ...(effortBudget(options.reasoning)
      ? { reasoningBudget: effortBudget(options.reasoning) }
      : {}),
  });
  const refresh = async () => {
    await options.validateRouting?.();
    if (!options.local && !profile)
      providerLimits = await resolveProviderContext(
        options.modelId,
        options.providerId,
        options.cachedMetadataOnly,
      );
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
        !options.cachedMetadataOnly &&
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
    if (
      budgetIdentity(current, profile.id) !== identity ||
      (options.reasoning?.choice !== "automatic" &&
        options.reasoning?.capability.expiresAt !== undefined &&
        JSON.stringify(
          current.profiles
            .find((p) => p.id === profile.id)
            ?.evidence.filter((e) => e.metric === "reasoning.effort"),
        ) !==
          JSON.stringify(
            profile.evidence.filter((e) => e.metric === "reasoning.effort"),
          ))
    )
      throw new ContextBudgetError(
        "context-settings-changed",
        "Endpoint/model/profile settings changed while this request was waiting. Start a new request with the current settings.",
      );
  };
  return {
    thermal(): "cold" | "warm" | "unknown" {
      if (!endpoint || !profile) return "unknown";
      const loaded = snapshot?.models.find(m => m.id === profile.transportModelId)?.evidence.find(e =>
        e.metric === "probe.loaded" && typeof e.value === "boolean" &&
        (profile.deploymentId === null || e.scope.deploymentId === profile.deploymentId) &&
        probeEvidenceIsFresh(e, endpoint, snapshot),
      );
      return loaded?.value === true ? "warm" : loaded?.value === false ? "cold" : "unknown";
    },
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
            const output = resolveContextBudget(limits(), undefined, params.maxOutputTokens).output;
            if (options.requireRequestedOutput && params.maxOutputTokens !== undefined && output < params.maxOutputTokens)
              throw new ContextBudgetError("fallback-output", "Fallback cannot preserve the requested output allowance.");
            const providerOptions = { ...params.providerOptions };
            for (const [provider, settings] of Object.entries(
              options.reasoning ? effortProviderOptions(options.reasoning) : {},
            )) {
              providerOptions[provider] = {
                ...providerOptions[provider],
                ...settings,
              };
            }
            return {
              ...params,
              providerOptions,
              maxOutputTokens: output,
            };
          },
        },
      });
      modelBudgets.set(wrapped, async () => {
        await refresh();
        return limits();
      });
      modelDiagnostics.set(wrapped, (kinds, available) => {
        schemaKinds = { ...kinds };
        availableSchemas = available;
      });
      return wrapped;
    },
    async prepare(body: Record<string, unknown>) {
      if (options.reasoning) effortProviderOptions(options.reasoning);
      await refresh();
      const measured = assertRequestBudget(limits(), body, schemaKinds, availableSchemas);
      return async () => {
        if (options.reasoning) effortProviderOptions(options.reasoning);
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
        if (!options.local && !profile)
          providerLimits = await resolveProviderContext(
            options.modelId,
            options.providerId,
            true,
          );
        assertMeasuredRequestBudget(limits(), measured.cost, measured.output);
        await options.validateEvidence?.();
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
    await (await preflight.prepare(body))();
    return fetcher(input, init);
  };
}
