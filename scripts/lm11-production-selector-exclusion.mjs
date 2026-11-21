/**
 * LM11 T01 — independent ordinary-production selector exclusion.
 *
 * This script is deliberately NOT the authenticated synthetic acceptance
 * harness. It compiles the ordinary Rust library with NO default/test feature,
 * exercises original TypeScript selector/picker code in a readonly offline
 * Vitest test, and audits the exact production selector source graph.
 *
 * No actual Tauri application, imported model, inference server, provider,
 * HTTP endpoint, keychain or registry API is opened. After prime's T15 baseline
 * gate, EXACTLY TWO allowlisted production/legacy Roaming Store files are read
 * once with verified BEFORE SHA256 and checked for model/runtime/deployment
 * registration IDs in memory. No raw Store JSON, names, URLs or secrets escape.
 * Only SHA256 ID hashes, counts, a small result report and Cargo build output
 * are intentionally written under the fixed LM11 acceptance target.
 *
 * The T15 *before* inventory must first be independently recorded by prime.
 * Fail CLOSED when the gate or owned inventory file is absent.
 *
 * Invocation AFTER prime authorizes the T15 baseline:
 *   node scripts/lm11-production-selector-exclusion.mjs --prime-confirms-t15-before
 */
import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync,
  statSync, writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const owner = path.join(
  root, "src-tauri", "target", "lm11-b01-b03-authenticated-webview-20261119",
);
const cases = path.join(owner, "cases");
// Prime-confirmed independent 19 Nov T15 BEFORE snapshot. Only its file
// integrity hashes and pseudonymous root keys may be read; never raw values.
const before = path.join(
  cases, "fidelity-audit-20261119164558080-66e12c0fff93", "production-before.json",
);
const testFile = "src/modules/ai/lib/lm11ProductionSelectorExclusion.offline.test.tsx";
const forbiddenProductionMarker = "CLACK-LM11-SYNTHETIC-NO-MODEL-20261119-v1";
const feature = "lm11-authenticated-webview-acceptance";
const fixtureDigest = `sha256:${createHash("sha256")
  .update(forbiddenProductionMarker).digest("hex")}`;
const fixtureAlias = `clack-${fixtureDigest.slice(7, 23)}`;

function sameCanonicalPath(a, b) {
  const canonical = (v) => process.platform === "win32"
    ? path.normalize(v).toLowerCase() : path.normalize(v);
  return canonical(a) === canonical(b);
}

function assertRealDirectory(p) {
  if (!existsSync(p) || !lstatSync(p).isDirectory() ||
      lstatSync(p).isSymbolicLink() ||
      !sameCanonicalPath(realpathSync(p), path.resolve(p))) {
    throw new Error("BLOCKED: expected owned canonical directory is absent or redirected");
  }
}

function relativeSource(file) {
  const absolute = path.resolve(root, file);
  if (path.relative(root, absolute).startsWith("..") ||
      !sameCanonicalPath(path.resolve(root, file), absolute) ||
      !existsSync(absolute) || !lstatSync(absolute).isFile() ||
      lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`BLOCKED: unavailable/redirection in enumerated source: ${file}`);
  }
  return readFileSync(absolute, "utf8");
}

/** Enumerated normal model/selection API and UI callers, source checked.
 * This is a fail-closed list: if any caller stops delegating to the audited
 * selector/registry, the evidence goes red rather than silently shrinking. */
const productionPaths = [
  ["src/modules/ai/config.ts", [/export const MODELS\s*=/, /export function resolveModel\(/]],
  ["src/modules/ai/lib/savedProviderModels.ts", [/getEnabledSavedProviderModelInfos\(/, /resolveModelSelectionInfo\(/, /resolveModelTransportIdentity\(/]],
  ["src/modules/ai/lib/selfHostedModels.ts", [/savedSelfHostedModelInfos\(/, /selfHostedModelInfo\(/, /selfHostedPickerStatus\(/]],
  ["src/modules/ai/lib/managedLocalModels.ts", [/savedManagedLocalModelInfos\(/, /resolveManagedLocalSelection\(/, /managedLocalTransportIdentity\(/]],
  ["src/modules/ai/lib/localComputeFabric.ts", [/reconcileLocalComputeFabric\(/, /resolveModelDeployment\(/]],
  ["src/modules/ai/lib/selfHostedProfiles.ts", [/emptySelfHostedState\(/, /readSelfHostedState\(/, /resolveSelfHostedSelection\(/]],
  ["src/modules/ai/lib/providerRestore.ts", [/resolveRestoredModel\(/, /savedSelfHostedModelInfos\(/]],
  ["src/modules/ai/lib/managedLocalRuntime.ts", [/managed_local_runtime_route/, /assertCurrentManagedLocalRoute\(/]],
  ["src/modules/ai/lib/localRuntimeAdapters.ts", [/assertManagedLocalNativeRoute/, /resolveRuntimeProviderTransport/]],
  ["src/modules/ai/hooks/useAiBootstrap.ts", [/savedSelfHostedModelInfos\(/, /resolveRestoredModel\(/]],
  ["src/modules/ai/components/AiStatusBarControls.tsx", [/export function ModelDropdown\(/, /savedManagedLocalModelInfos\(selfHosted\)/, /savedSelfHostedModelInfos\(selfHosted\)/, /getEnabledSavedProviderModelInfos\(savedProviderModels\)/, /groupFabricPickerModels\(/]],
  ["src/modules/ai/components/AiMiniWindow.tsx", [/<ModelDropdown sessionId=/]],
  ["src/modules/ai/components/ChatFallbackControl.tsx", [/savedSelfHostedModelInfos\(settings\.selfHostedInference\)/, /getEnabledSavedProviderModelInfos\(settings\.savedProviderModels\)/]],
  ["src/modules/ai/store/modelSwitch.ts", [/resolveModelSelectionInfo\(/, /managed_local_runtime_status/]],
  ["src/modules/ai/store/chatStore.ts", [/resolveManagedLocalSelection\(/, /isManagedLocalSelectionId\(/]],
  ["src/modules/ai/store/inferenceFallback.ts", [/selfHostedInference/]],
  ["src/modules/ai/lib/inferenceFallback.ts", [/export function effectiveFallback\(/]],
  ["src/settings/sections/ModelsSection.tsx", [/MODELS\.filter/, /selfHostedInference/]],
  ["src/settings/components/SelfHostedServers.tsx", [/savedSelfHostedModelInfos\(/, /selfHostedInference/]],
  ["src/modules/settings/store.ts", [/selfHostedInference:\s*emptySelfHostedState\(\)/, /savedProviderModels:\s*\[\]/, /customEndpoints:\s*\[\]/]],
  ["src-tauri/src/lib.rs", [/managed_local_runtime_status/, /managed_local_runtime_route/]],
];

function readOnlyProductionSourceChecks() {
  const checked = [];
  for (const [file, anchors] of productionPaths) {
    const text = relativeSource(file);
    if (text.includes(forbiddenProductionMarker)) {
      throw new Error(`BLOCKED: synthetic fixture marker leaked into ordinary selector source: ${file}`);
    }
    for (const anchor of anchors) {
      if (!anchor.test(text)) {
        throw new Error(`BLOCKED: normal selector graph changed; review required in ${file} (${anchor})`);
      }
    }
    checked.push(file);
  }
  const manifest = relativeSource("src-tauri/Cargo.toml");
  const featureSection = manifest.match(/^\[features\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? "";
  if (!new RegExp(`^${feature}\\s*=\\s*\\[\\s*\\]\\s*$`, "m").test(featureSection) ||
      /^default\s*=.*lm11-authenticated-webview-acceptance/m.test(featureSection)) {
    throw new Error("BLOCKED: LM11 synthetic feature must be separately named and non-default");
  }
  const nativeLib = relativeSource("src-tauri/src/lib.rs");
  if (/\blm11_acceptance_(?:bind|rotate_epoch|counts|stop_service)\b/.test(nativeLib)) {
    throw new Error("BLOCKED: acceptance-only native commands exposed in normal library registry");
  }
  const nativeOwner = relativeSource("src-tauri/src/modules/managed_local_runtime.rs");
  if (!nativeOwner.includes(`#[cfg(all(windows, feature = "${feature}"))]`) ||
      !nativeOwner.includes(`#[cfg(not(all(windows, feature = "${feature}")))]`)) {
    throw new Error("BLOCKED: synthetic owner is not visibly gated from production");
  }
  return {
    passed: true,
    readOnlyProductionSourcePaths: checked,
    nativeManifestAndOwnerSource: [
      "src-tauri/Cargo.toml", "src-tauri/src/lib.rs",
      "src-tauri/src/modules/managed_local_runtime.rs",
    ],
    featureEnabled: false,
    fixtureMarkerInNormalSources: false,
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function collectIdentities(store) {
  const ids = new Set();
  const add = (v) => {
    if (typeof v === "string" && v && v.length <= 8192) ids.add(v);
  };
  const rows = (value) => Array.isArray(value) ? value : [];
  // Explicit allowlist of registration/selection fields ONLY; no raw secrets,
  // provider keys, messages or URLs enter the derived evidence.
  for (const key of [
    "defaultModelId", "lastUsedModelId", "lmstudioModelId", "mlxModelId",
    "ollamaModelId", "openaiCompatibleModelId", "openrouterModelId",
  ]) add(store?.[key]);
  for (const key of ["favoriteModelIds", "recentModelIds"]) {
    for (const value of rows(store?.[key])) add(value);
  }
  for (const model of rows(store?.savedProviderModels)) {
    for (const key of ["id", "transportModelId", "displayName", "providerId"]) add(model?.[key]);
  }
  for (const endpoint of rows(store?.customEndpoints)) {
    for (const key of ["id", "modelId", "name"]) add(endpoint?.[key]);
  }
  const hosted = store?.selfHostedInference ?? {};
  for (const endpoint of rows(hosted.endpoints)) {
    for (const key of ["id", "alias", "backendHint", "detectedBackend"]) add(endpoint?.[key]);
    add(endpoint?.legacy?.selectionId);
  }
  for (const profile of rows(hosted.profiles)) {
    for (const key of ["id", "endpointId", "transportModelId", "deploymentId", "modelRevision"]) {
      add(profile?.[key]);
    }
    add(profile?.saved?.label);
  }
  for (const inventory of rows(hosted.inventories)) {
    add(inventory?.endpointId);
    for (const model of rows(inventory?.models)) {
      for (const key of ["id", "name", "digest"]) add(model?.[key]);
    }
  }
  const fabric = hosted.fabric ?? {};
  for (const host of rows(fabric.hosts)) {
    for (const key of ["id", "displayName"]) add(host?.[key]);
    for (const id of rows(host?.runtimeIds)) add(id);
  }
  for (const runtime of rows(fabric.runtimes)) {
    for (const key of ["id", "hostId", "type", "version", "legacyEndpointId"]) add(runtime?.[key]);
  }
  for (const artifact of rows(fabric.artifacts)) {
    for (const key of ["id", "digest", "displayName", "format"]) add(artifact?.[key]);
  }
  for (const deployment of rows(fabric.deployments)) {
    for (const key of [
      "id", "hostId", "runtimeId", "artifactId", "profileId",
      "runtimeModelName", "configurationIdentity",
    ]) add(deployment?.[key]);
  }
  return ids;
}

/** The ONLY authorized production AppData reads: exactly the two Store leaves
 * already enumerated by the independent T15 BEFORE inventory. Hash full bytes
 * and demand equality BEFORE parsing IDs; never persist raw content. */
function readOnlyProductionRegistrations() {
  const baseline = JSON.parse(readFileSync(before, "utf8"));
  if (baseline.phase !== "Before" ||
      baseline.source !== "independent-read-only-production-state-observer" ||
      baseline.appId !== "app.clack.dev" ||
      !Array.isArray(baseline.errors) || baseline.errors.length !== 0 ||
      !Array.isArray(baseline.fileOrRegistryEntries)) {
    throw new Error("BLOCKED: independent T15 BEFORE inventory invalid or incomplete");
  }
  const rootId = "roaming-production";
  const roots = [
    { id: rootId, dir: path.join(process.env.APPDATA ?? "", "app.clack.dev") },
    { id: "roaming-legacy", dir: path.join(process.env.APPDATA ?? "", "app.crynta.terax") },
  ];
  if (!process.env.APPDATA || !path.isAbsolute(process.env.APPDATA)) {
    throw new Error("BLOCKED: Windows Roaming AppData reference unavailable");
  }
  const hashed = new Set();
  const files = [];
  let count = 0;
  let fixtureRegistrationFound = false;
  for (const target of roots) {
    const key = `${target.id}/terax-settings.json`;
    const entry = baseline.fileOrRegistryEntries.find((row) =>
      row.kind === "file" && row.key === key);
    if (!entry || !/^[0-9a-f]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size)) {
      throw new Error(`BLOCKED: T15 BEFORE missing exact Store hash for ${target.id}`);
    }
    assertRealDirectory(target.dir);
    const file = path.join(target.dir, "terax-settings.json");
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() ||
        !sameCanonicalPath(realpathSync(file), path.resolve(file)) ||
        info.size !== entry.size) {
      throw new Error(`BLOCKED: changed or redirected production Store at ${target.id}`);
    }
    const bytes = readFileSync(file);
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
      throw new Error(`BLOCKED: production Store differs from T15 BEFORE at ${target.id}`);
    }
    // Raw Store object remains an ephemeral local variable, not evidence.
    const store = JSON.parse(bytes.toString("utf8"));
    const ids = collectIdentities(store);
    count += ids.size;
    for (const id of ids) {
      if (id.includes(fixtureDigest) || id.includes(fixtureAlias) ||
          id.includes(forbiddenProductionMarker)) fixtureRegistrationFound = true;
      hashed.add(sha256(Buffer.from(id, "utf8")));
    }
    files.push({
      rootId: target.id, basename: "terax-settings.json",
      size: entry.size, sha256: entry.sha256,
      modelRuntimeDeploymentIdentifiers: ids.size,
      beforeHashMatched: true,
    });
  }
  if (fixtureRegistrationFound) {
    throw new Error("BLOCKED: synthetic fixture identity discovered in actual production registration IDs");
  }
  return {
    source: "exact T15 BEFORE hash-bound, read-only production/legacy Store enumeration",
    files, identifierHashes: [...hashed].sort(),
    totalRegistrationFields: count,
    uniqueIdentifierHashCount: hashed.size,
    syntheticIdentityPresent: false,
    productionAppDataWrites: 0,
  };
}

function command(exe, args, cwd, timeoutMs, env = process.env) {
  const started = Date.now();
  const result = spawnSync(exe, args, {
    cwd, env: { ...env, CARGO_NET_OFFLINE: "true", NO_COLOR: "1" },
    shell: false, windowsHide: true, timeout: timeoutMs,
    encoding: "utf8", maxBuffer: 512 * 1024,
  });
  return {
    pass: result.status === 0 && !result.error && !result.signal,
    exitCode: result.status,
    timedOutOrSpawnError: !!result.error || !!result.signal,
    durationMs: Date.now() - started,
    // Deliberately no stdout/stderr/env: never include accidental credentials,
    // user paths or unexpected diagnostic content in immutable evidence.
  };
}

function assertNormalCargoMetadata() {
  const result = spawnSync("cargo", [
    "metadata", "--no-deps", "--offline", "--locked", "--format-version", "1",
    "--manifest-path", path.join(root, "src-tauri", "Cargo.toml"),
  ], {
    cwd: path.join(root, "src-tauri"),
    shell: false, windowsHide: true, timeout: 30_000,
    encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, CARGO_NET_OFFLINE: "true" },
  });
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error("BLOCKED: ordinary offline Cargo metadata unavailable");
  }
  const metadata = JSON.parse(result.stdout);
  const crate = metadata.packages?.find((p) => p.name === "clack");
  const declared = crate?.features?.[feature];
  const defaults = crate?.features?.default ?? [];
  if (!Array.isArray(declared) || defaults.includes(feature)) {
    throw new Error("BLOCKED: Cargo default feature graph includes synthetic test binding");
  }
  return {
    passed: true,
    cargoFeatureDeclaredButNonDefault: true,
    defaultFeaturesIncludeSynthetic: false,
    testFeatureRequestedForNormalBuild: false,
  };
}

async function run() {
  let caseDir = null;
  let report = {
    version: 1,
    objective: "T01 ordinary production model/deployment selector exclusion",
    beforeInventoryRecordedByPrime: true,
    productionAppDataRead: false,
    productionAppDataWritten: false,
    syntheticServiceStarted: false,
    nativeManagedRuntimeStarted: false,
    realModelInferenceCount: 0,
    featureEnabled: false,
    selectionBoundary: "normal clean in-memory preference shape and real non-feature selector/picker functions",
    doesNotAuditActualProductionPersistedSettings: true,
    doesNotRunInteractiveProductionTauriApplication: true,
    selectorSources: null,
    cargoMetadata: null,
    typescriptOfflineSelectors: null,
    normalNonFeatureNativeBuild: null,
    passed: false,
  };
  try {
    assertRealDirectory(owner);
    assertRealDirectory(cases);
    const baselineDir = path.dirname(before);
    assertRealDirectory(baselineDir);
    const baselineStat = statSync(before);
    if (!baselineStat.isFile() || lstatSync(before).isSymbolicLink() ||
        baselineStat.size < 2 ||
        !sameCanonicalPath(realpathSync(before), path.resolve(before))) {
      throw new Error("BLOCKED: independent T15 baseline record missing/redirected/empty");
    }
    // We intentionally do NOT read the potentially sensitive inventory.
    report.beforeInventoryFile = path.relative(root, before).replaceAll("\\", "/");
    report.beforeInventoryPresent = true;
    report.selectorSources = readOnlyProductionSourceChecks();
    report.cargoMetadata = assertNormalCargoMetadata();
    const registrations = readOnlyProductionRegistrations();
    report.productionAppDataRead = true;
    report.doesNotAuditActualProductionPersistedSettings = false;
    report.readOnlyProductionRegistrations = {
      source: registrations.source,
      files: registrations.files,
      totalRegistrationFields: registrations.totalRegistrationFields,
      uniqueIdentifierHashCount: registrations.uniqueIdentifierHashCount,
      syntheticIdentityPresent: registrations.syntheticIdentityPresent,
      productionAppDataWrites: 0,
    };
    const testSource = relativeSource(testFile);
    if (!testSource.includes("LM11 T01") || !testSource.includes("renderToStaticMarkup")) {
      throw new Error("BLOCKED: independent selector/picker offline test absent");
    }
    const vitestCli = path.join(root, "node_modules", "vitest", "vitest.mjs");
    if (!existsSync(vitestCli)) {
      throw new Error("BLOCKED: local Vitest missing; network installation prohibited");
    }
    const id = `t01-selector-${new Date().toISOString().replace(/[^0-9]/g, "")}-${randomBytes(6).toString("hex")}`;
    caseDir = path.join(cases, id);
    mkdirSync(caseDir, { recursive: false, mode: 0o700 });
    assertRealDirectory(caseDir);
    const hashedCensusPath = path.join(caseDir, "production-registration-id-hashes.json");
    writeFileSync(hashedCensusPath, JSON.stringify({
      version: 1,
      source: registrations.source,
      baselineMetadataOnly: true,
      sourceFiles: registrations.files,
      hashedIdentifiersOnly: registrations.identifierHashes,
      syntheticIdentityPresent: registrations.syntheticIdentityPresent,
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    // No native/browser application or user settings opened by this JS runner.
    // Capture T01 tests FIRST so a failed UI selector leaves a diagnostic red
    // report without invoking a relatively expensive normal Rust compilation.
    report.typescriptOfflineSelectors = command(
      process.execPath, [
        vitestCli, "run", testFile, "--maxWorkers=1",
        "--no-file-parallelism", "--reporter=dot",
      ], root, 180_000, {
        ...process.env,
        CLACK_LM11_T01_PRODUCTION_HASH_CENSUS: hashedCensusPath,
        CLACK_LM11_T01_BEFORE_PATH: before,
      },
    );
    if (report.typescriptOfflineSelectors.pass) {
      // Prime specifically authorized the EXISTING cached default-feature
      // target to avoid Windows link.exe LNK1104 on a deeply nested cold
      // per-case path. The evidence/report is STILL only written to owner.
      const nativeTarget = path.join(root, "src-tauri", "target", "codex-checkpoint6");
      const cargoArgs = [
        "check", "--offline", "--locked",
        "--lib", "--target-dir", nativeTarget,
      ];
      report.normalNonFeatureNativeBuild = command(
        "cargo", cargoArgs, path.join(root, "src-tauri"), 600_000,
      );
      report.normalNonFeatureNativeBuild.featureArgs =
        "ordinary Cargo default build (NO --features; metadata verifies synthetic is non-default)";
      report.normalNonFeatureNativeBuild.existingCacheTargetOnly = true;
    }
    report.passed = report.selectorSources.passed &&
      report.typescriptOfflineSelectors?.pass === true &&
      report.normalNonFeatureNativeBuild?.pass === true;
  } catch (error) {
    report.passed = false;
    report.blocked = error instanceof Error && error.message.startsWith("BLOCKED");
    report.errorClass = report.blocked ? "precondition-or-source-graph" : "execution";
    // Our own BLOCKED messages are static, contain only source-relative paths
    // and regex contract labels, and are safe for an internal diagnostic.
    if (report.blocked) report.blockedReason = error.message.slice(0, 240);
    // Avoid serializing exception messages/stacks, which can contain local
    // paths, tokens or arbitrary runtime input.
  } finally {
    if (caseDir) {
      report.evidenceDir = path.relative(root, caseDir).replaceAll("\\", "/");
      writeFileSync(
        path.join(caseDir, "t01-production-selector-exclusion.json"),
        JSON.stringify(report, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    }
    console.log(JSON.stringify({
      outcome: report.passed ? "T01 ordinary non-feature selector exclusion observed" : "T01 NOT ACCEPTED",
      evidenceDir: report.evidenceDir ?? null,
      sourcePaths: report.selectorSources?.readOnlyProductionSourcePaths?.length ?? 0,
      blockedReason: report.blockedReason ?? null,
      offlineSelectors: report.typescriptOfflineSelectors,
      normalNonFeatureNativeBuild: report.normalNonFeatureNativeBuild,
      featureEnabled: false,
      readonlyProductionStoreEnumeration: report.productionAppDataRead,
      productionAppDataWrites: 0,
    }, null, 2));
    if (!report.passed) process.exitCode = 1;
  }
}

// Invoke only AFTER initializing all selector contracts. In particular, never
// run the source audit in the temporal dead zone of productionPaths.
if (
  process.argv.length !== 3 ||
  process.argv[2] !== "--prime-confirms-t15-before"
) {
  console.error(
    "BLOCKED: prime must first seal the independent T15 production BEFORE baseline. " +
    "No T01 acceptance test/build/evidence was run. Then pass --prime-confirms-t15-before.",
  );
  process.exitCode = 3;
} else {
  await run();
}
