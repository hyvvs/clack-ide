export const PROVIDER_METADATA_TTL = 15 * 60_000;

export type ProviderCapabilities = {
  inputModalities?: string[];
  outputModalities?: string[];
  supportedParameters?: string[];
  reasoning?: {
    mandatory?: boolean;
    defaultEnabled?: boolean;
    supportedEfforts?: string[];
    defaultEffort?: string;
  };
};

export type ProviderModelEvidence = {
  version: 1;
  providerId: "openrouter";
  modelId: string;
  origin: "provider-metadata";
  lookup: "catalog" | "exact-model";
  observedAt: number;
  context: number;
  output?: number;
  capabilities?: ProviderCapabilities;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function stringSet(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some(
      (v) =>
        typeof v !== "string" ||
        !v ||
        v.length > 64 ||
        !/^[a-zA-Z0-9_.-]+$/.test(v),
    )
  )
    throw new Error("Invalid provider capability metadata.");
  return [...new Set(value as string[])].sort();
}

function normalizeCapabilities(
  value: unknown,
): ProviderCapabilities | undefined {
  if (value == null) return undefined;
  const data = record(value);
  if (!data) throw new Error("Invalid provider capabilities.");
  const inputModalities = stringSet(data.inputModalities);
  const outputModalities = stringSet(data.outputModalities);
  const supportedParameters = stringSet(data.supportedParameters);
  const reasoning = record(data.reasoning);
  if (data.reasoning != null && !reasoning)
    throw new Error("Invalid reasoning metadata.");
  for (const key of ["mandatory", "defaultEnabled"])
    if (reasoning?.[key] != null && typeof reasoning[key] !== "boolean")
      throw new Error("Invalid reasoning metadata.");
  const supportedEfforts = stringSet(reasoning?.supportedEfforts);
  const defaultEffort = reasoning?.defaultEffort;
  if (
    defaultEffort != null &&
    (typeof defaultEffort !== "string" ||
      !/^[a-zA-Z0-9_.-]{1,64}$/.test(defaultEffort))
  )
    throw new Error("Invalid reasoning effort metadata.");
  if (
    !inputModalities &&
    !outputModalities &&
    !supportedParameters &&
    !reasoning
  )
    return undefined;
  return {
    ...(inputModalities ? { inputModalities } : {}),
    ...(outputModalities ? { outputModalities } : {}),
    ...(supportedParameters ? { supportedParameters } : {}),
    ...(reasoning
      ? {
          reasoning: {
            ...(typeof reasoning.mandatory === "boolean"
              ? { mandatory: reasoning.mandatory }
              : {}),
            ...(typeof reasoning.defaultEnabled === "boolean"
              ? { defaultEnabled: reasoning.defaultEnabled }
              : {}),
            ...(supportedEfforts ? { supportedEfforts } : {}),
            ...(typeof defaultEffort === "string" ? { defaultEffort } : {}),
          },
        }
      : {}),
  };
}

export function normalizeProviderModelEvidence(
  value: unknown,
  providerId: string,
  modelId: string,
): ProviderModelEvidence | undefined {
  const data = record(value);
  if (
    !data ||
    providerId !== "openrouter" ||
    data.version !== 1 ||
    data.providerId !== providerId ||
    data.modelId !== modelId ||
    data.origin !== "provider-metadata" ||
    (data.lookup !== "catalog" && data.lookup !== "exact-model") ||
    !modelId ||
    modelId.length > 256 ||
    /\s|[\x00-\x1f\x7f]/.test(modelId) ||
    !positive(data.context) ||
    !positive(data.observedAt) ||
    (data.output != null &&
      (!positive(data.output) || data.output > data.context))
  )
    return undefined;
  try {
    const capabilities = normalizeCapabilities(data.capabilities);
    return {
      version: 1,
      providerId,
      modelId,
      origin: "provider-metadata",
      lookup: data.lookup,
      observedAt: data.observedAt,
      context: data.context,
      ...(positive(data.output) ? { output: data.output } : {}),
      ...(capabilities ? { capabilities } : {}),
    };
  } catch {
    return undefined;
  }
}

export function freshProviderModelEvidence(
  value: unknown,
  providerId: string,
  modelId: string,
  now = Date.now(),
): ProviderModelEvidence | undefined {
  const evidence = normalizeProviderModelEvidence(value, providerId, modelId);
  return evidence &&
    evidence.observedAt <= now &&
    now < evidence.observedAt + PROVIDER_METADATA_TTL
    ? evidence
    : undefined;
}

export function parseProviderContextCatalog(
  value: unknown,
  observedAt = Date.now(),
): Map<string, ProviderModelEvidence> {
  const data = record(value)?.data;
  if (!Array.isArray(data) || data.length > 4096)
    throw new Error("Invalid provider context catalog.");
  const models = new Map<string, ProviderModelEvidence>();
  const seen = new Set<string>();
  for (const entry of data) {
    const model = record(entry);
    const id = model?.id;
    if (typeof id !== "string") continue;
    if (seen.has(id)) {
      models.delete(id);
      continue;
    }
    seen.add(id);
    if (!positive(model?.context_length)) continue;
    const top = record(model.top_provider);
    const architecture = record(model.architecture);
    const reasoning = record(model.reasoning);
    if (
      (model.top_provider != null && !top) ||
      (model.architecture != null && !architecture) ||
      (model.reasoning != null && !reasoning) ||
      (top?.context_length != null && !positive(top.context_length))
    )
      continue;
    const evidence = normalizeProviderModelEvidence(
      {
        version: 1,
        providerId: "openrouter",
        modelId: id,
        origin: "provider-metadata",
        lookup: "catalog",
        observedAt,
        context: Math.min(
          model.context_length,
          (top?.context_length as number) ?? Infinity,
        ),
        output: top?.max_completion_tokens,
        capabilities: {
          inputModalities: architecture?.input_modalities,
          outputModalities: architecture?.output_modalities,
          supportedParameters: model.supported_parameters,
          ...(reasoning
            ? {
                reasoning: {
                  mandatory: reasoning.mandatory,
                  defaultEnabled: reasoning.default_enabled,
                  supportedEfforts: reasoning.supported_efforts,
                  defaultEffort: reasoning.default_effort,
                },
              }
            : {}),
        },
      },
      "openrouter",
      id,
    );
    if (evidence) models.set(id, evidence);
  }
  return models;
}

export function parseExactProviderModel(
  value: unknown,
  modelId: string,
  observedAt = Date.now(),
): ProviderModelEvidence | null {
  const data = record(record(value)?.data);
  if (data?.id !== modelId) return null;
  const evidence = parseProviderContextCatalog(
    { data: [data] },
    observedAt,
  ).get(modelId);
  return evidence ? { ...evidence, lookup: "exact-model" } : null;
}
