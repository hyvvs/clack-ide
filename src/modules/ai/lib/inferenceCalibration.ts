import {
  CALIBRATION_LIMITS as L,
  calibrationSampleSchema,
  type CalibrationSample,
  type ProfileCalibration,
} from "@/modules/ai/lib/calibrationSchema";
import {
  profileEvidence,
  setProfileRecommendation,
  type SelfHostedState,
  type SelfHostedProfile,
} from "@/modules/ai/lib/selfHostedProfiles";

export type ScopedCalibrationSample = {
  profileId: string;
  sample: CalibrationSample;
};

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function currentSamples(
  profile: SelfHostedProfile,
  revision: number,
  now: number,
) {
  return (profile.calibration?.samples ?? []).filter(
    (s) =>
      s.configurationRevision === revision &&
      s.observedAt <= now &&
      now - s.observedAt < L.ageMs,
  );
}

export function calibrationSummary(
  profile: SelfHostedProfile,
  revision: number,
  now = Date.now(),
) {
  const samples = currentSamples(profile, revision, now);
  const successes = samples.filter(
    (s) => s.outcome === "success" && s.thermal !== "cold",
  );
  // Compare similar input sizes, concurrency and request classes, not tiny optimization
  // probes with full-context tasks. Unknown usage is its own latency-only cohort.
  const groups = new Map<string, CalibrationSample[]>();
  for (const s of successes) {
    const key = JSON.stringify([
      s.requestClass,
      s.concurrency,
      s.inputTokens === null
        ? null
        : Math.floor(Math.log2(Math.max(1, s.inputTokens))),
    ]);
    const group = groups.get(key) ?? [];
    group.push(s);
    groups.set(key, group);
  }
  const comparable = (
    [...groups.values()].sort(
      (a, b) =>
        b.length - a.length ||
        b[b.length - 1].observedAt - a[a.length - 1].observedAt,
    )[0] ?? []
  ).slice(-20);
  const speeds = comparable.flatMap((s) =>
    s.outputTokens !== null &&
    s.outputTokens >= 32 &&
    s.generationMs !== null &&
    s.generationMs >= 250 &&
    s.outputKind !== "tool"
      ? [(s.outputTokens * 1000) / s.generationMs]
      : [],
  );
  return {
    count: samples.length,
    comparable,
    confidence: comparable.length >= L.comparable ? "observed" : "insufficient",
    ttftMs: median(
      comparable.flatMap((s) => (s.ttftMs === null ? [] : [s.ttftMs])),
    ),
    ttftSamples: comparable.filter((s) => s.ttftMs !== null).length,
    tokensPerSecond: speeds.length >= L.comparable ? median(speeds) : null,
    coldCount: samples.filter(
      (s) => s.thermal === "cold" || s.outcome === "loading",
    ).length,
    windowStart: samples[0]?.observedAt ?? null,
    windowEnd: samples[samples.length - 1]?.observedAt ?? null,
  };
}

function tune(
  state: SelfHostedState,
  profileId: string,
  revision: number,
  now: number,
) {
  const profile = state.profiles.find((p) => p.id === profileId);
  if (!profile?.calibration) return state;
  const samples = currentSamples(profile, revision, now);
  const calibration = profile.calibration;
  const used = new Set(
    Object.values(calibration.tuning).flatMap((t) => t?.sampleIds ?? []),
  );
  const current = (
    name: "concurrentGenerations" | "prefillTimeoutMs" | "idleTimeoutMs",
    fallback: number,
  ) => {
    const e = profile.recommendations[name];
    return e?.scope.configurationRevision === revision &&
      (e.expiresAt ?? Infinity) > now &&
      typeof e.value === "number"
      ? e.value
      : fallback;
  };
  const capacity = current("concurrentGenerations", 1);
  const last = samples[samples.length - 1];
  const severe =
    last?.outcome === "resource" &&
    last.thermal !== "cold" &&
    !used.has(last.id);
  const overload =
    samples.slice(-3).length === 3 &&
    samples
      .slice(-3)
      .every(
        (s) =>
          (s.concurrency ?? 1) > 1 &&
          ["resource", "rate-limit", "timeout"].includes(s.outcome) &&
          s.thermal !== "cold",
      );
  const summary = calibrationSummary(profile, revision, now);
  const intervalReady =
    calibration.lastTunedAt === null ||
    now - calibration.lastTunedAt >= L.intervalMs ||
    Object.values(calibration.tuning).some(
      (t) => t?.configurationRevision !== revision,
    );
  if (!severe && !intervalReady) return state;
  const candidates = new Map<
    "concurrentGenerations" | "prefillTimeoutMs" | "idleTimeoutMs",
    number
  >();
  if (severe || overload)
    candidates.set("concurrentGenerations", Math.max(1, capacity - 1));
  else if (
    summary.confidence === "observed" &&
    summary.comparable.filter((s) => !used.has(s.id)).length >= L.comparable &&
    summary.comparable.every(
      (s) =>
        (s.concurrency ?? 1) > capacity &&
        s.outputKind !== "none" &&
        s.outputKind !== "tool" &&
        (s.latencyMs ?? 0) >= 250 &&
        (s.outputTokens === null || s.outputTokens >= 32),
    )
  )
    candidates.set("concurrentGenerations", Math.min(8, capacity + 1));
  const freshSuccesses = summary.comparable.filter((s) => !used.has(s.id));
  if (
    intervalReady &&
    summary.confidence === "observed" &&
    freshSuccesses.length >= L.comparable
  ) {
    if (summary.ttftMs !== null && summary.ttftSamples >= L.comparable) {
      const previous = current("prefillTimeoutMs", 120_000);
      const target = Math.max(10_000, Math.min(600_000, summary.ttftMs * 2));
      candidates.set(
        "prefillTimeoutMs",
        Math.round(Math.max(previous * 0.9, Math.min(previous * 1.1, target))),
      );
    }
    const gaps = summary.comparable.flatMap((s) =>
      s.maxGapMs === null ? [] : [s.maxGapMs],
    );
    if (gaps.length >= L.comparable) {
      const previous = current("idleTimeoutMs", 60_000);
      const target = Math.max(
        5_000,
        Math.min(600_000, (median(gaps) ?? 0) * 2),
      );
      candidates.set(
        "idleTimeoutMs",
        Math.round(Math.max(previous * 0.9, Math.min(previous * 1.1, target))),
      );
    }
  }
  if (!candidates.size) return state;
  for (const [field, value] of candidates) {
    const e = profileEvidence(
      state,
      profileId,
      field,
      value,
      "recommendation",
      now,
      "observed",
    );
    state = setProfileRecommendation(
      state,
      profileId,
      field,
      { ...e, expiresAt: now + L.ageMs },
      now,
    );
  }
  return {
    ...state,
    profiles: state.profiles.map((p) =>
      p.id !== profileId
        ? p
        : {
            ...p,
            calibration: {
              ...calibration,
              lastTunedAt: now,
              tuning: {
                ...calibration.tuning,
                ...Object.fromEntries(
                  [...candidates.keys()].map((field) => [
                    field,
                    {
                      sampleIds: (field === "concurrentGenerations" &&
                      (severe || overload)
                        ? severe
                          ? samples.slice(-1)
                          : samples.slice(-3)
                        : summary.comparable
                      ).map((s) => s.id),
                      configurationRevision: revision,
                      updatedAt: now,
                    },
                  ]),
                ),
              },
            },
          },
    ),
  };
}

export function appendCalibrationSamples(
  state: SelfHostedState,
  batch: ScopedCalibrationSample[],
  now = Date.now(),
): SelfHostedState {
  const touched = new Map<string, number>();
  let next = state;
  for (const { profileId, sample: raw } of batch.slice(0, L.pending)) {
    const parsed = calibrationSampleSchema.safeParse(raw);
    const profile = next.profiles.find((p) => p.id === profileId);
    const endpoint = next.endpoints.find(
      (e) => e.id === profile?.endpointId && e.deletedAt === undefined,
    );
    if (!parsed.success || !profile || !endpoint) continue;
    const s = parsed.data;
    if (
      s.configurationRevision !== endpoint.configurationRevision ||
      s.observedAt > now ||
      now - s.observedAt >= L.ageMs ||
      profile.calibration?.samples.some((existing) => existing.id === s.id)
    )
      continue;
    const calibration: ProfileCalibration = profile.calibration ?? {
      version: 1,
      samples: [],
      lastTunedAt: null,
      tuning: {},
    };
    const samples = [
      ...currentSamples(profile, endpoint.configurationRevision, now),
      s,
    ]
      .sort((a, b) => a.observedAt - b.observedAt || a.id.localeCompare(b.id))
      .slice(-L.samples);
    next = {
      ...next,
      profiles: next.profiles.map((p) =>
        p.id !== profileId
          ? p
          : {
              ...p,
              updatedAt: Math.max(p.updatedAt, s.observedAt),
              calibration: { ...calibration, samples },
            },
      ),
    };
    touched.set(profileId, endpoint.configurationRevision);
  }
  if (next === state) return state;
  for (const [profileId, revision] of touched)
    next = tune(next, profileId, revision, now);
  const retained = next.profiles
    .flatMap((p) =>
      (p.calibration?.samples ?? [])
        .filter((s) => s.observedAt <= now && now - s.observedAt < L.ageMs)
        .map((s) => ({ profileId: p.id, id: s.id, at: s.observedAt })),
    )
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    .slice(0, L.globalSamples);
  const keep = new Set(
    retained.map((s) => JSON.stringify([s.profileId, s.id])),
  );
  return {
    ...next,
    profiles: next.profiles.map((p) => {
      if (!p.calibration) return p;
      const samples = p.calibration.samples.filter((s) =>
        keep.has(JSON.stringify([p.id, s.id])),
      );
      const ids = new Set(samples.map((s) => s.id));
      const recommendations = { ...p.recommendations };
      for (const [field, tuning] of Object.entries(p.calibration.tuning)) {
        if (tuning?.sampleIds.some((id) => !ids.has(id))) {
          const name = field as keyof typeof p.calibration.tuning;
          const previous = recommendations[name];
          if (previous)
            recommendations[name] = {
              ...previous,
              expiresAt: Math.min(previous.expiresAt ?? now, now),
            };
        }
      }
      return {
        ...p,
        recommendations,
        calibration: { ...p.calibration, samples },
      };
    }),
  };
}

export function createCalibrationBatcher(
  update: (
    change: (state: SelfHostedState) => SelfHostedState,
  ) => Promise<unknown>,
) {
  const pending: ScopedCalibrationSample[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> | undefined;
  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (writing) return writing.then(flush);
    const batch = pending.splice(0, L.pending);
    if (!batch.length) return Promise.resolve();
    writing = update((state) => appendCalibrationSamples(state, batch))
      .then(() => undefined)
      .catch(() => {
        /* Optional metrics never fail inference or overwrite invalid settings. */
      })
      .finally(() => {
        writing = undefined;
      });
    return writing;
  };
  return {
    record(sample: ScopedCalibrationSample) {
      pending.push(sample);
      if (pending.length > L.pending) pending.shift();
      if (pending.length >= L.batch) void flush();
      else if (!timer) timer = setTimeout(() => void flush(), L.batchMs);
    },
    flush,
  };
}

const passive = createCalibrationBatcher(async (change) =>
  (await import("@/modules/settings/store")).updateSelfHostedProfiles(change),
);
export const recordPassiveCalibration = passive.record;
