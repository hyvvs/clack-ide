import { z } from "zod";
import { remoteSshSchema, remoteSshUrl, type RemoteSshConfig } from "@/modules/ai/lib/remoteSsh";
import { calibrationSchema, CALIBRATED_FIELDS } from "@/modules/ai/lib/calibrationSchema";
import { contextCalibrationSchema } from "@/modules/ai/lib/contextCalibrationSchema";
import { trustedContext } from "@/modules/ai/lib/contextCalibrationTrust";
import { toolVerificationSchema } from "@/modules/ai/lib/toolVerificationSchema";
import { localComputeFabricSchema, type LocalComputeFabric } from "@/modules/ai/lib/localComputeFabric";

export const SELF_HOSTED_SCHEMA_VERSION = 1;
export const SELF_HOSTED_SETTINGS_KEY = "selfHostedInference";

const id = z.string().min(1).max(2048);
// A tuple ID may contain three JSON-escaped identity strings.
const profileIdSchema = z
  .string()
  .min(1)
  .max(40 * 1024);
const timestamp = z.number().int().nonnegative().finite();
const backend = z.enum([
  "ollama",
  "lmstudio",
  "mlx",
  "vllm",
  "openai-compatible",
]);
export type SelfHostedBackend = z.infer<typeof backend>;

export function normalizeEndpointUrl(value: string): string {
  if (value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error("Endpoint URL contains whitespace or control characters");
  }
  const url = new URL(value);
  if (
    !/^https?:$/.test(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use an HTTP(S) endpoint without credentials, query or fragment",
    );
  }
  return url.href;
}

/** Ollama host location refers to the configured HTTP destination, not SSH.
 * No network lookup occurs; LAN/VPN hostnames are intentionally remote. */
export function endpointHostLocation(baseURL: string): "local" | "remote" {
  const hostname = new URL(baseURL).hostname.toLowerCase();
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    ? "local" : "remote";
}

const endpointUrl = z.string().transform((value, ctx) => {
  try {
    return normalizeEndpointUrl(value);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Invalid self-hosted endpoint URL",
    });
    return z.NEVER;
  }
});

const credentialReference = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("provider"),
    providerId: z.literal("openai-compatible"),
  }),
  z.object({ kind: z.literal("custom-endpoint"), endpointId: id }),
]);
export type EndpointCredentialReference = z.infer<typeof credentialReference>;

const legacyBinding = z.object({
  selectionId: id,
  profileId: profileIdSchema.nullable(),
  snapshot: z.string().max(16384),
});

const endpointSchema = z.object({
  id,
  alias: z.string().trim().min(1).max(128),
  baseURL: endpointUrl,
  location: z.enum(["local", "remote"]).optional(),
  // LM0 host availability is configuration, not a deletion or proof reset.
  // Absent on existing durable endpoints means enabled.
  enabled: z.boolean().optional(),
  ssh: remoteSshSchema.nullish(),
  backendHint: backend.optional(),
  detectedBackend: backend.nullish(),
  credentialRef: credentialReference.nullable(),
  allowPrivateNetwork: z.boolean().optional(),
  transportSecurity: z.enum(["http-unencrypted", "https-unverified"]),
  revision: z.number().int().positive(),
  configurationRevision: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.optional(),
  legacy: legacyBinding.optional(),
}).refine(e => e.ssh ? e.baseURL === remoteSshUrl(e.id) && e.credentialRef === null : new URL(e.baseURL).hostname !== "clack-ssh.invalid");
export type SelfHostedEndpoint = z.infer<typeof endpointSchema>;

export function endpointBackend(endpoint: SelfHostedEndpoint): SelfHostedBackend | undefined {
  return endpoint.backendHint ?? endpoint.detectedBackend ?? undefined;
}

const inventoryModelSchema = z.object({
  id: z.string().min(1).max(1024).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  name: z.string().max(1024).nullable(),
  chat: z.enum(["supported", "unsupported", "unknown"]),
  digest: z.string().min(1).max(1024).optional(),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  modifiedAt: z.string().max(1024).optional(),
  family: z.string().min(1).max(1024).optional(),
  parameterSize: z.string().min(1).max(1024).optional(),
  quantizationLevel: z.string().min(1).max(1024).optional(),
});
export const selfHostedInventorySchema = z.object({
  endpointId: id,
  configurationRevision: z.number().int().positive(),
  observedAt: timestamp,
  // The native probe writes JSON null when these optional observations are
  // unknown. Interpret that as absence so a failed offline probe cannot make
  // the entire durable host registry unwritable on the next Settings edit.
  lastSuccessAt: z.preprocess(value => value === null ? undefined : value, timestamp.optional()),
  connected: z.boolean(),
  backend: backend.nullish(),
  version: z.preprocess(value => value === null ? undefined : value, z.string().min(1).max(64).optional()),
  error: z.string().max(64).nullish(),
  models: z.array(inventoryModelSchema).max(5000).refine(rows => new Set(rows.map(m => m.id)).size === rows.length),
});
export type SelfHostedInventory = z.infer<typeof selfHostedInventorySchema>;

export const evidenceSchema = z.object({
  metric: z.string().min(1).max(64),
  value: z.union([z.number().finite(), z.boolean(), z.string().max(1024)]),
  source: z.enum([
    "backend-reported",
    "advertised",
    "user-assertion",
    "measured",
    "recommendation",
  ]),
  observedAt: timestamp.nullable(),
  expiresAt: timestamp.optional(),
  confidence: z.enum(["unverified", "reported", "observed"]),
  scope: z.object({
    endpointId: id,
    transportModelId: id,
    deploymentId: id.nullable(),
    configurationRevision: z.number().int().positive(),
    modelRevision: z.string().max(1024).optional(),
  }),
});
export type ProfileEvidence = z.infer<typeof evidenceSchema>;

export const PROFILE_FIELDS = [
  "configuredContext",
  "workingContext",
  "outputReserve",
  "maxOutput",
  "concurrentGenerations",
  "loadTimeoutMs",
  "prefillTimeoutMs",
  "idleTimeoutMs",
  "autoCompaction",
  "autoContinuation",
  "continuationCount",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
const field = z.enum(PROFILE_FIELDS);
const manual = z.object({
  mode: z.literal("manual"),
  evidence: evidenceSchema,
});
const profileSchema = z.object({
  id: profileIdSchema,
  endpointId: id,
  transportModelId: id,
  deploymentId: id.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  evidence: z.array(evidenceSchema).max(64),
  recommendations: z.partialRecord(field, evidenceSchema),
  overrides: z.partialRecord(field, manual),
  calibration: calibrationSchema.optional(),
  contextCalibration: contextCalibrationSchema.optional(),
  toolVerification: toolVerificationSchema.refine(r => !r.configuration).optional(),
  agentToolConfigurations: z.array(toolVerificationSchema).max(2).refine(records =>
    records.every(r => !!r.configuration) && new Set(records.map(r => JSON.stringify(r.configuration?.wire))).size === records.length).optional(),
  // Non-primary exact-context proofs remain independently scoped; a 65K proof
  // never authorizes native tools at 32K. Preserve legacy primary fields.
  agentToolTierProofs: z.array(toolVerificationSchema).max(18).refine(records =>
    new Set(records.map(r => JSON.stringify([r.context, r.configuration ?? null]))).size === records.length).optional(),
  saved: z
    .object({ label: z.string().trim().min(1).max(1024).optional() })
    .optional(),
  modelRevision: z.string().max(1024).optional(),
  backend: backend.optional(),
});
export type SelfHostedProfile = z.infer<typeof profileSchema>;
export type SelfHostedState = {
  version: 1;
  revision: number;
  endpoints: SelfHostedEndpoint[];
  profiles: SelfHostedProfile[];
  inventories?: SelfHostedInventory[];
  /** LM2B additive versioned fabric, inside the existing native-owned registry. */
  fabric?: LocalComputeFabric;
};

export function emptySelfHostedState(): SelfHostedState {
  return {
    version: SELF_HOSTED_SCHEMA_VERSION,
    revision: 0,
    endpoints: [],
    profiles: [],
  };
}

export function profileIdentity(
  endpointId: string,
  model: string,
  deploymentId: string | null = null,
): string {
  return JSON.stringify([endpointId, model, deploymentId]);
}

export function readSelfHostedState(raw: unknown): SelfHostedState {
  const envelope = z
    .object({
      version: z.literal(1),
      revision: z.number().int().nonnegative(),
      endpoints: z.array(z.unknown()).max(256),
      profiles: z.array(z.unknown()).max(2048),
      inventories: z.array(z.unknown()).max(256).optional(),
      fabric: z.unknown().optional(),
    })
    .safeParse(raw);
  if (!envelope.success) return emptySelfHostedState();
  const endpoints: SelfHostedEndpoint[] = [];
  const profiles: SelfHostedProfile[] = [];
  for (const entry of envelope.data.endpoints) {
    const parsed = endpointSchema.safeParse(entry);
    if (!parsed.success || endpoints.some((e) => e.id === parsed.data.id))
      continue;
    const endpoint = parsed.data;
    endpoint.transportSecurity = transportSecurity(endpoint.baseURL);
    endpoints.push(endpoint);
  }
  for (const entry of envelope.data.profiles) {
    const rawConfigurations = z.object({ agentToolConfigurations: z.unknown().optional() }).safeParse(entry);
    const invalidConfigurations = rawConfigurations.success && rawConfigurations.data.agentToolConfigurations !== undefined &&
      !profileSchema.shape.agentToolConfigurations.safeParse(rawConfigurations.data.agentToolConfigurations).success;
    const rawTiers = z.object({ agentToolTierProofs: z.unknown().optional() }).safeParse(entry);
    const invalidTiers = rawTiers.success && rawTiers.data.agentToolTierProofs !== undefined &&
      !profileSchema.shape.agentToolTierProofs.safeParse(rawTiers.data.agentToolTierProofs).success;
    const rawTool = z.object({ toolVerification: z.unknown().optional() }).safeParse(entry);
    const invalidTool = rawTool.success && rawTool.data.toolVerification !== undefined && !profileSchema.shape.toolVerification.safeParse(rawTool.data.toolVerification).success;
    const rawContext = z.object({ contextCalibration: z.unknown().optional() }).safeParse(entry);
    const invalidContext = rawContext.success && rawContext.data.contextCalibration !== undefined && !contextCalibrationSchema.safeParse(rawContext.data.contextCalibration).success;
    const rawCalibration = z.object({ calibration: z.unknown().optional() }).safeParse(entry);
    const invalidCalibration = rawCalibration.success && rawCalibration.data.calibration !== undefined &&
      !calibrationSchema.safeParse(rawCalibration.data.calibration).success;
    const parsed = profileSchema.safeParse(invalidCalibration || invalidContext || invalidTool || invalidConfigurations || invalidTiers
      ? { ...(entry as Record<string, unknown>), ...(invalidTiers ? {agentToolTierProofs: undefined} : {}), ...(invalidConfigurations ? {agentToolConfigurations: undefined} : {}), ...(invalidTool ? { toolVerification: undefined } : {}), ...(invalidCalibration ? { calibration: undefined } : {}), ...(invalidContext ? { contextCalibration: undefined } : {}) } : entry);
    if (!parsed.success) continue;
    const profile = parsed.data;
    if (invalidContext) delete profile.recommendations.workingContext;
    if (
      !endpoints.some((e) => e.id === profile.endpointId) ||
      profiles.some(
        (p) =>
          p.id === profile.id ||
          profileIdentity(p.endpointId, p.transportModelId, p.deploymentId) ===
            profileIdentity(
              profile.endpointId,
              profile.transportModelId,
              profile.deploymentId,
            ),
      )
    )
      continue;
    profile.evidence = profile.evidence.filter((e) =>
      evidenceMatchesProfile(e, profile),
    );
    for (const name of PROFILE_FIELDS) {
      const rec = profile.recommendations[name];
      const pin = profile.overrides[name];
      if (
        rec &&
        (rec.metric !== name ||
          !validSetting(name, rec.value) ||
          !evidenceMatchesProfile(rec, profile))
      )
        delete profile.recommendations[name];
      if (
        pin &&
        (pin.evidence.metric !== name ||
          !validSetting(name, pin.evidence.value) ||
          !evidenceMatchesProfile(pin.evidence, profile) ||
          pin.evidence.source !== "user-assertion")
      )
        delete profile.overrides[name];
      const calibrated = profile.recommendations[name];
      if (invalidCalibration && calibrated?.expiresAt !== undefined && CALIBRATED_FIELDS.some(field => field === name))
        profile.recommendations[name] = { ...calibrated, expiresAt: 0 };
    }
    profiles.push(profile);
  }
  const inventories = envelope.data.inventories?.flatMap(raw => {
    const parsed = selfHostedInventorySchema.safeParse(raw);
    return parsed.success && endpoints.some(e => e.id === parsed.data.endpointId &&
      e.configurationRevision === parsed.data.configurationRevision) ? [parsed.data] : [];
  }).filter((item, index, all) => all.findIndex(i => i.endpointId === item.endpointId) === index);
  const fabric = localComputeFabricSchema.safeParse(envelope.data.fabric);
  return { version: 1, revision: envelope.data.revision, endpoints, profiles,
    ...(inventories ? { inventories } : {}),
    ...(fabric.success ? { fabric: fabric.data } : {}) };
}

export function assertWritableSelfHostedState(raw: unknown): void {
  if (raw == null) return;
  const parsed = z
    .object({
      version: z.literal(1),
      revision: z.number().int().nonnegative(),
      endpoints: z.array(endpointSchema).max(256),
      profiles: z.array(profileSchema).max(2048),
      inventories: z.array(selfHostedInventorySchema).max(256).optional(),
      fabric: localComputeFabricSchema.optional(),
    })
    .safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "Self-hosted settings are invalid or use an unsupported schema; original data was preserved",
    );
  }
  const normalized = readSelfHostedState(parsed.data);
  if (
    normalized.endpoints.length !== parsed.data.endpoints.length ||
    JSON.stringify(normalized.profiles) !== JSON.stringify(parsed.data.profiles) ||
    JSON.stringify(normalized.inventories) !== JSON.stringify(parsed.data.inventories) ||
    JSON.stringify(normalized.fabric) !== JSON.stringify(parsed.data.fabric)
  )
    throw new Error(
      "Self-hosted settings contain invalid profile references or values; original data was preserved",
    );
}

export function createSelfHostedEndpoint(
  input: {
    alias: string;
    baseURL: string;
    backendHint?: SelfHostedBackend;
    credentialRef?: EndpointCredentialReference | null;
    allowPrivateNetwork?: boolean;
    enabled?: boolean;
    ssh?: RemoteSshConfig | null;
  },
  endpointId = `sh-${crypto.randomUUID()}`,
  now = Date.now(),
): SelfHostedEndpoint {
  const baseURL = normalizeEndpointUrl(input.baseURL);
  return endpointSchema.parse({
    id: endpointId,
    alias: input.alias,
    baseURL,
    ssh: input.ssh,
    backendHint: input.backendHint,
    enabled: input.enabled ?? true,
    credentialRef: input.credentialRef ?? null,
    allowPrivateNetwork: input.allowPrivateNetwork,
    transportSecurity: transportSecurity(baseURL),
    location: endpointHostLocation(baseURL),
    revision: 1,
    configurationRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
}

export function addSelfHostedEndpoint(
  state: SelfHostedState,
  endpoint: SelfHostedEndpoint,
): SelfHostedState {
  if (state.endpoints.some((e) => e.id === endpoint.id))
    throw new Error("Endpoint identity already exists");
  if (state.endpoints.length >= 256)
    throw new Error("Self-hosted endpoint limit reached");
  return {
    ...state,
    endpoints: [...state.endpoints, endpointSchema.parse(endpoint)],
  };
}

export function editSelfHostedEndpoint(
  state: SelfHostedState,
  endpointId: string,
  patch: {
    alias?: string;
    baseURL?: string;
    enabled?: boolean;
    backendHint?: SelfHostedBackend;
    credentialRef?: EndpointCredentialReference | null;
    allowPrivateNetwork?: boolean;
    ssh?: RemoteSshConfig | null;
  },
  now = Date.now(),
): SelfHostedState {
  const previous = requireEndpoint(state, endpointId);
  const next = endpointSchema.parse({ ...previous, ...patch });
  const configChanged =
    JSON.stringify(next.ssh ?? null) !== JSON.stringify(previous.ssh ?? null) ||
    next.baseURL !== previous.baseURL ||
    next.backendHint !== previous.backendHint ||
    next.allowPrivateNetwork !== previous.allowPrivateNetwork ||
    // Re-enabling may reach a restarted/replaced runtime. Do not resurrect
    // a cached inventory or native-tool/context proof without fresh evidence.
    (previous.enabled === false && next.enabled !== false) ||
    JSON.stringify(next.credentialRef) !==
      JSON.stringify(previous.credentialRef);
  next.revision = previous.revision + 1;
  next.configurationRevision =
    previous.configurationRevision + (configChanged ? 1 : 0);
  next.updatedAt = now;
  next.transportSecurity = transportSecurity(next.baseURL);
  next.location = endpointHostLocation(next.baseURL);
  if (configChanged) delete next.detectedBackend;
  return {
    ...state,
    endpoints: state.endpoints.map((e) => (e.id === endpointId ? next : e)),
    ...(state.inventories ? { inventories: state.inventories.filter(i => i.endpointId !== endpointId || !configChanged) } : {}),
  };
}

export function ensureSelfHostedProfile(
  state: SelfHostedState,
  endpointId: string,
  transportModelId: string,
  deploymentId: string | null = null,
  now = Date.now(),
): { state: SelfHostedState; profile: SelfHostedProfile } {
  requireEndpoint(state, endpointId);
  const model = id.parse(transportModelId.trim());
  const profileId = profileIdentity(endpointId, model, deploymentId);
  const existing = state.profiles.find(
    (p) =>
      profileIdentity(p.endpointId, p.transportModelId, p.deploymentId) ===
      profileId,
  );
  if (existing) return { state, profile: existing };
  if (state.profiles.length >= 2048)
    throw new Error("Self-hosted profile limit reached");
  const profile = profileSchema.parse({
    id: profileId,
    endpointId,
    transportModelId: model,
    deploymentId,
    createdAt: now,
    updatedAt: now,
    evidence: [],
    recommendations: {},
    overrides: {},
  });
  return {
    state: { ...state, profiles: [...state.profiles, profile] },
    profile,
  };
}

export function profileEvidence(
  state: SelfHostedState,
  profileId: string,
  metric: string,
  value: ProfileEvidence["value"],
  source: ProfileEvidence["source"],
  observedAt: number | null = Date.now(),
  confidence: ProfileEvidence["confidence"] = "unverified",
): ProfileEvidence {
  const profile = requireProfile(state, profileId);
  return evidenceSchema.parse({
    metric,
    value,
    source,
    observedAt,
    confidence,
    scope: {
      endpointId: profile.endpointId,
      transportModelId: profile.transportModelId,
      deploymentId: profile.deploymentId,
      configurationRevision: requireEndpoint(state, profile.endpointId)
        .configurationRevision,
      ...(profile.modelRevision ? { modelRevision: profile.modelRevision } : {}),
    },
  });
}

export function setProfileRecommendation(
  state: SelfHostedState,
  profileId: string,
  name: ProfileField,
  evidence: ProfileEvidence,
  now = Date.now(),
): SelfHostedState {
  const profile = requireProfile(state, profileId);
  const parsed = evidenceSchema.parse(evidence);
  if (
    parsed.metric !== name ||
    (name === "concurrentGenerations" && Number(parsed.value) > 8) ||
    !validSetting(name, parsed.value) ||
    !evidenceMatchesProfile(parsed, profile)
  )
    throw new Error("Invalid scoped recommendation");
  return replaceProfile(state, {
    ...profile,
    updatedAt: now,
    recommendations: { ...profile.recommendations, [name]: parsed },
  });
}

export function setProfileOverride(
  state: SelfHostedState,
  profileId: string,
  name: ProfileField,
  value: number | boolean,
  now = Date.now(),
): SelfHostedState {
  if (
    !validSetting(name, value) ||
    (name === "concurrentGenerations" && Number(value) > 8)
  )
    throw new Error("Invalid profile setting");
  const profile = requireProfile(state, profileId);
  const evidence = profileEvidence(
    state,
    profileId,
    name,
    value,
    "user-assertion",
    now,
  );
  return replaceProfile(state, {
    ...profile,
    updatedAt: now,
    overrides: {
      ...profile.overrides,
      [name]: { mode: "manual", evidence },
    },
  });
}

export function resetProfileOverride(
  state: SelfHostedState,
  profileId: string,
  name: ProfileField,
  now = Date.now(),
): SelfHostedState {
  const profile = requireProfile(state, profileId);
  const overrides = { ...profile.overrides };
  delete overrides[name];
  return replaceProfile(state, { ...profile, overrides, updatedAt: now });
}

export function effectiveProfileValue(
  state: SelfHostedState,
  profileId: string,
  name: ProfileField,
  now = Date.now(),
): {
  mode: "automatic" | "manual";
  value: ProfileEvidence["value"] | undefined;
  evidence?: ProfileEvidence;
  stale: boolean;
} {
  const profile = requireProfile(state, profileId);
  const endpoint = requireEndpoint(state, profile.endpointId);
  const pin = profile.overrides[name];
  const evidence = pin?.evidence ?? profile.recommendations[name];
  if (!pin && name === "workingContext" && profile.contextCalibration) {
    const value = trustedContext(state, profile, now);
    return { mode: "automatic", value, evidence, stale: value === undefined };
  }
  const stale =
    !!evidence &&
    (evidence.scope.configurationRevision !== endpoint.configurationRevision ||
      (evidence.expiresAt !== undefined && evidence.expiresAt <= now));
  return {
    mode: pin ? "manual" : "automatic",
    value: pin || !stale ? evidence?.value : undefined,
    evidence,
    stale,
  };
}

export function deleteSelfHostedEndpoint(
  state: SelfHostedState,
  endpointId: string,
  activeEndpointIds: readonly string[] = [],
  now = Date.now(),
): SelfHostedState {
  if (activeEndpointIds.includes(endpointId))
    throw new Error("Endpoint is in use by an active run");
  const endpoint = requireEndpoint(state, endpointId);
  return {
    ...state,
    endpoints: state.endpoints.map((e) =>
      e.id === endpointId
        ? {
            ...endpoint,
            deletedAt: now,
            updatedAt: now,
            revision: endpoint.revision + 1,
          }
        : e,
    ),
  };
}

export function resolveSelfHostedSelection(
  state: SelfHostedState,
  selectionId: string,
):
  | { status: "not-managed" }
  | { status: "missing"; endpointId: string; message: string }
  | {
      status: "available";
      endpoint: SelfHostedEndpoint;
      profile: SelfHostedProfile;
    } {
  if (selectionId.startsWith("self-hosted:")) {
    let profileId = selectionId.slice("self-hosted:".length);
    let modelRevision: string | undefined;
    let selectedBackend: SelfHostedBackend | undefined;
    try {
      const tuple: unknown = JSON.parse(profileId);
      if (Array.isArray(tuple) && (tuple.length === 4 || tuple.length === 5) &&
          (typeof tuple[3] === "string" || (tuple.length === 5 && tuple[3] === null)) &&
          (tuple.length === 4 || backend.safeParse(tuple[4]).success)) {
        profileId = JSON.stringify(tuple.slice(0, 3));
        modelRevision = typeof tuple[3] === "string" ? tuple[3] : undefined;
        selectedBackend = tuple[4] as SelfHostedBackend | undefined;
      }
    } catch { /* Legacy IDs are matched literally, never routed by model tag. */ }
    const profile = state.profiles.find((p) => p.id === profileId && (p.saved ||
      state.inventories?.some(i => i.endpointId === p.endpointId && i.models.some(m => m.id === p.transportModelId))));
    if (modelRevision && profile?.modelRevision !== modelRevision)
      return { status: "missing", endpointId: profile?.endpointId ?? "", message: "Model revision changed. Choose the current model explicitly." };
    const owner = state.endpoints.find(e => e.id === profile?.endpointId);
    if (selectedBackend && owner && endpointBackend(owner) !== selectedBackend)
      return { status: "missing", endpointId: owner.id, message: "Server provider changed. Choose the current model explicitly." };
    return resolveSelfHostedProfile(
      state,
      profile?.endpointId ?? "",
      profile?.id ?? "",
    );
  }
  const endpoint = state.endpoints.find(
    (e) => e.legacy?.selectionId === selectionId,
  );
  if (!endpoint) return { status: "not-managed" };
  return resolveSelfHostedProfile(
    state,
    endpoint.id,
    endpoint.legacy?.profileId ?? "",
  );
}

export function resolveSelfHostedProfile(
  state: SelfHostedState,
  endpointId: string,
  profileId: string,
):
  | { status: "missing"; endpointId: string; message: string }
  | {
      status: "available";
      endpoint: SelfHostedEndpoint;
      profile: SelfHostedProfile;
    } {
  const endpoint = state.endpoints.find((e) => e.id === endpointId);
  const profile = state.profiles.find(
    (p) => p.id === profileId && p.endpointId === endpointId,
  );
  if (!endpoint || endpoint.deletedAt !== undefined || endpoint.enabled === false || !profile)
    return {
      status: "missing",
      endpointId,
      message:
        "Self-hosted endpoint or model is unavailable. Restore it or explicitly choose a model in Models & Providers.",
    };
  return { status: "available", endpoint: { ...endpoint, backendHint: endpointBackend(endpoint) }, profile };
}

function transportSecurity(
  baseURL: string,
): SelfHostedEndpoint["transportSecurity"] {
  return new URL(baseURL).protocol === "https:"
    ? "https-unverified"
    : "http-unencrypted";
}

function evidenceMatchesProfile(
  evidence: ProfileEvidence,
  profile: SelfHostedProfile,
): boolean {
  return (
    evidence.scope.endpointId === profile.endpointId &&
    evidence.scope.transportModelId === profile.transportModelId &&
    evidence.scope.deploymentId === profile.deploymentId
    && (evidence.source === "user-assertion" || !profile.modelRevision || evidence.scope.modelRevision === profile.modelRevision)
  );
}

function validSetting(name: ProfileField, value: unknown): boolean {
  if (!PROFILE_FIELDS.includes(name)) return false;
  if (name === "autoCompaction" || name === "autoContinuation")
    return typeof value === "boolean";
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= (name === "outputReserve" || name === "continuationCount" ? 0 : 1)
  );
}

function requireEndpoint(
  state: SelfHostedState,
  endpointId: string,
): SelfHostedEndpoint {
  const endpoint = state.endpoints.find(
    (e) => e.id === endpointId && e.deletedAt === undefined,
  );
  if (!endpoint) throw new Error("Self-hosted endpoint is missing");
  return endpoint;
}

function requireProfile(
  state: SelfHostedState,
  profileId: string,
): SelfHostedProfile {
  const profile = state.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error("Self-hosted model profile is missing");
  requireEndpoint(state, profile.endpointId);
  return profile;
}

function replaceProfile(
  state: SelfHostedState,
  profile: SelfHostedProfile,
): SelfHostedState {
  return {
    ...state,
    profiles: state.profiles.map((p) => (p.id === profile.id ? profile : p)),
  };
}
