import { z } from "zod";

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
  backendHint: backend.optional(),
  credentialRef: credentialReference.nullable(),
  allowPrivateNetwork: z.boolean().optional(),
  transportSecurity: z.enum(["http-unencrypted", "https-unverified"]),
  revision: z.number().int().positive(),
  configurationRevision: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.optional(),
  legacy: legacyBinding.optional(),
});
export type SelfHostedEndpoint = z.infer<typeof endpointSchema>;

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
  confidence: z.enum(["unverified", "reported", "observed"]),
  scope: z.object({
    endpointId: id,
    transportModelId: id,
    deploymentId: id.nullable(),
    configurationRevision: z.number().int().positive(),
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
  saved: z
    .object({ label: z.string().trim().min(1).max(1024).optional() })
    .optional(),
});
export type SelfHostedProfile = z.infer<typeof profileSchema>;
export type SelfHostedState = {
  version: 1;
  revision: number;
  endpoints: SelfHostedEndpoint[];
  profiles: SelfHostedProfile[];
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
    const parsed = profileSchema.safeParse(entry);
    if (!parsed.success) continue;
    const profile = parsed.data;
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
    }
    profiles.push(profile);
  }
  return { version: 1, revision: envelope.data.revision, endpoints, profiles };
}

export function assertWritableSelfHostedState(raw: unknown): void {
  if (raw == null) return;
  const parsed = z
    .object({
      version: z.literal(1),
      revision: z.number().int().nonnegative(),
      endpoints: z.array(endpointSchema).max(256),
      profiles: z.array(profileSchema).max(2048),
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
    JSON.stringify(normalized.profiles) !== JSON.stringify(parsed.data.profiles)
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
  },
  endpointId = `sh-${crypto.randomUUID()}`,
  now = Date.now(),
): SelfHostedEndpoint {
  const baseURL = normalizeEndpointUrl(input.baseURL);
  return endpointSchema.parse({
    id: endpointId,
    alias: input.alias,
    baseURL,
    backendHint: input.backendHint,
    credentialRef: input.credentialRef ?? null,
    allowPrivateNetwork: input.allowPrivateNetwork,
    transportSecurity: transportSecurity(baseURL),
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
    backendHint?: SelfHostedBackend;
    credentialRef?: EndpointCredentialReference | null;
    allowPrivateNetwork?: boolean;
  },
  now = Date.now(),
): SelfHostedState {
  const previous = requireEndpoint(state, endpointId);
  const next = endpointSchema.parse({ ...previous, ...patch });
  const configChanged =
    next.baseURL !== previous.baseURL ||
    next.backendHint !== previous.backendHint ||
    next.allowPrivateNetwork !== previous.allowPrivateNetwork ||
    JSON.stringify(next.credentialRef) !==
      JSON.stringify(previous.credentialRef);
  next.revision = previous.revision + 1;
  next.configurationRevision =
    previous.configurationRevision + (configChanged ? 1 : 0);
  next.updatedAt = now;
  next.transportSecurity = transportSecurity(next.baseURL);
  return {
    ...state,
    endpoints: state.endpoints.map((e) => (e.id === endpointId ? next : e)),
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
  if (!validSetting(name, value)) throw new Error("Invalid profile setting");
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
  const stale =
    !!evidence &&
    evidence.scope.configurationRevision !== endpoint.configurationRevision;
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
    const profileId = selectionId.slice("self-hosted:".length);
    const profile = state.profiles.find((p) => p.id === profileId && p.saved);
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
  if (!endpoint || endpoint.deletedAt !== undefined || !profile)
    return {
      status: "missing",
      endpointId,
      message:
        "Self-hosted endpoint or model is unavailable. Restore it or explicitly choose a model in Models & Providers.",
    };
  return { status: "available", endpoint, profile };
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
