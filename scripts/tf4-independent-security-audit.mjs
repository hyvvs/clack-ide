/**
 * Read-only TF4 executable provenance triage. Never executes, installs,
 * extracts, uploads, repairs, signs or modifies binaries or Defender.
 *
 * An internally consistent hash report is NOT a signature, an authenticated
 * CI result, a malware adjudication or a distribution permission.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FLAGGED_APP_SHA256 =
  "b7102a8d6afa43172de5ca7df3aac8840e0e2dbf977beb027bb2f8b517b012aa";

function isDigest(value) {
  return typeof value === "string" && SHA256.test(value);
}

function atLeast466(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor, patch] = version.split(".").map(Number);
  return major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6)));
}

export function assessTf4BuildEvidence({
  sourceSha, report, packageJson, packageLock, trustedBlobs,
  defenderReport, ciRunVerified = false,
}) {
  const findings = [];
  const blockers = [];
  const checked = (id, ok, detail) => {
    findings.push({ id, passed: Boolean(ok), detail });
    if (!ok) blockers.push(id);
  };
  const rec = report ?? {};
  const a = rec.artifacts ?? {};

  checked("exact-source-identity",
    SHA40.test(sourceSha) && rec.repository === "hyvvs/clack-ide" &&
      rec.requestedSource === sourceSha && rec.verifiedSource === sourceSha,
    "Exact expected SHA, authorized repository and reported checkout must agree");
  checked("independently-authenticated-ci",
    ciRunVerified === true && /^\d+$/.test(String(rec.workflowRun ?? "")),
    "An offline JSON file alone cannot authenticate GitHub workflow provenance");
  checked("locked-input-provenance",
    rec.lockedNpmInstall === true && rec.lockedCargoBuild === true &&
      SHA40.test(trustedBlobs?.npmLock ?? "") &&
      SHA40.test(trustedBlobs?.cargoLock ?? "") &&
      SHA40.test(trustedBlobs?.bundleScript ?? "") &&
      rec.npmLockBlob === trustedBlobs.npmLock &&
      rec.cargoLockBlob === trustedBlobs.cargoLock &&
      rec.bundleScriptBlob === trustedBlobs.bundleScript,
    "Independently derived source-commit blobs and locked installs/builds must match");

  const declared = packageJson?.dependencies?.zod;
  const installed = packageLock?.packages?.["node_modules/zod"]?.version;
  checked("zod-minimum-security-fix",
    atLeast466(installed) && declared === installed &&
      packageLock?.packages?.[""]?.dependencies?.zod === declared,
    "Source and npm lock must all pin Zod >=4.6.6, not a vulnerable semver range");

  const validArtifact = (kind) =>
    isDigest(a[kind]?.sha256) && Number.isSafeInteger(a[kind]?.bytes) &&
    a[kind].bytes > 0;
  for (const kind of ["compiledApp", "stagedHost", "extractedHost", "installer", "extractedApp"]) {
    checked("artifact-" + kind, validArtifact(kind),
      "Record exact full SHA-256 and positive byte length");
  }
  checked("packaged-native-host-identity",
    validArtifact("stagedHost") && validArtifact("extractedHost") &&
      a.stagedHost.sha256 === a.extractedHost.sha256 &&
      a.stagedHost.bytes === a.extractedHost.bytes,
    "Compare the host actually staged for packaging with independently extracted NSIS host");
  checked("pre-stage-native-host-identity",
    isDigest(rec.preStageCompiledHostSha256) &&
      validArtifact("stagedHost") &&
      rec.preStageCompiledHostSha256 === a.stagedHost.sha256,
    "A pre-staging hash from the same fresh build is required; mutable post-bundle output cannot replace it");

  const documentedCompiledHostDrift = validArtifact("compiledHost") &&
    validArtifact("stagedHost") &&
    a.compiledHost.sha256 !== a.stagedHost.sha256;
  // The production Tauri bundler can rebuild the mutable target/release path.
  // Drift is recorded, NOT silently equated with corrupt staged package bytes.
  findings.push({
    id: "mutable-post-package-host-output",
    passed: null,
    detail: documentedCompiledHostDrift
      ? "Different from staged host; investigate independent build phases, not installer mutation"
      : "No post-package host difference observed or insufficient evidence",
  });

  checked("known-quarantined-application-excluded",
    validArtifact("extractedApp") &&
      a.extractedApp.sha256 !== FLAGGED_APP_SHA256,
    "Never reuse the exact Defender-remediated application digest");
  checked("no-execution-or-binary-upload",
    rec.appExecuted === false && rec.binariesUploaded === false,
    "The source/build-provenance qualification must not run or distribute executables");
  checked("active-real-time-av-observed",
    rec.avRealTimeEnabled === true &&
      defenderReport?.defenderRealtime === true &&
      defenderReport?.defenderAvailable === true,
    "Real-time protection must be independently observed active, not merely AV installed");
  checked("no-build-time-av-detection",
    Array.isArray(defenderReport?.matchingDefenderEvents) &&
      defenderReport.matchingDefenderEvents.length === 0 &&
      defenderReport?.zeroMatchingEventsDoesNotProveSafety === true,
    "No recorded build-time detections; absence is never proof of malware absence");

  return {
    classification: blockers.length
      ? "INDEPENDENT_EXECUTABLE_SECURITY_NOT_QUALIFIED"
      : "STATIC_PROVENANCE_REVIEW_ONLY_NO_EXECUTABLE_CLEARANCE",
    sourceSha,
    blockers,
    findings,
    signedForDistribution: false,
    malwareAbsenceProven: false,
    historicalDefenderDetectionAdjudicated: false,
    installedAcceptanceGranted: false,
    statement:
      "No Microsoft correspondence is required for continued engineering. " +
      "No hash/AV non-detection alone grants execution, signing, distribution, TF4 physical or release acceptance.",
  };
}

function gitAt(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitContent(root, sha, name) {
  return execFileSync("git", ["-C", root, "show", sha + ":" + name], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
}

export function assessFromSourceTree({ root, sourceSha, report, defenderReport, ciRunVerified = false }) {
  if (!SHA40.test(sourceSha) || gitAt(root, "rev-parse", sourceSha + "^{commit}") !== sourceSha) {
    throw new Error("Exact locally available source commit required");
  }
  const files = {
    npmLock: "package-lock.json",
    cargoLock: "src-tauri/Cargo.lock",
    bundleScript: "scripts/Build-Tf4NativeBundle.ps1",
  };
  const trustedBlobs = Object.fromEntries(
    Object.entries(files).map(([key, value]) => [key, gitAt(root, "rev-parse", sourceSha + ":" + value)]),
  );
  return assessTf4BuildEvidence({
    sourceSha, report, defenderReport, ciRunVerified, trustedBlobs,
    packageJson: JSON.parse(gitContent(root, sourceSha, "package.json")),
    packageLock: JSON.parse(gitContent(root, sourceSha, "package-lock.json")),
  });
}

export function parseJsonEvidence(bytes) {
  // Windows PowerShell 5.1 and some hosted collectors emit a UTF-8 BOM.
  // Strip only the legitimate leading UTF-8 signature, not interior data.
  const text = typeof bytes === "string" ? bytes : bytes.toString("utf8");
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

if (process.argv[1] &&
    fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i === -1 || !args[i + 1]) throw new Error("Missing " + name);
    return args[i + 1];
  };
  try {
    const report = parseJsonEvidence(readFileSync(flag("--report")));
    const defenderReport = parseJsonEvidence(readFileSync(flag("--defender")));
    const result = assessFromSourceTree({
      root: resolve(flag("--root")),
      sourceSha: flag("--source"),
      report, defenderReport,
      // Local evidence is NOT a fresh authenticated GitHub run assertion.
      ciRunVerified: false,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.blockers.length) process.exitCode = 2;
  } catch (error) {
    process.stderr.write("TF4 independent security triage failed closed: " + error.message + "\n");
    process.exitCode = 2;
  }
}
