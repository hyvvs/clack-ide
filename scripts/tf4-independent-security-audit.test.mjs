import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTf4BuildEvidence, parseJsonEvidence } from "./tf4-independent-security-audit.mjs";

const SOURCE = "a".repeat(40);
const digest = (letter) => letter.repeat(64);

function fixture() {
  const stagedHost = { sha256: digest("b"), bytes: 3974656 };
  const artifacts = {
    compiledApp: { sha256: digest("c"), bytes: 20434944 },
    compiledHost: { sha256: digest("d"), bytes: 6097408 },
    stagedHost,
    extractedHost: { ...stagedHost },
    installer: { sha256: digest("e"), bytes: 12337261 },
    extractedApp: { sha256: digest("f"), bytes: 20434944 },
  };
  const packageJson = { dependencies: { zod: "4.6.6" } };
  const packageLock = {
    packages: {
      "": { dependencies: { zod: "4.6.6" } },
      "node_modules/zod": { version: "4.6.6" },
    },
  };
  const trustedBlobs = {
    npmLock: "1".repeat(40), cargoLock: "2".repeat(40), bundleScript: "3".repeat(40),
  };
  return {
    sourceSha: SOURCE,
    ciRunVerified: true,
    report: {
      repository: "hyvvs/clack-ide",
      workflowRun: "123456",
      requestedSource: SOURCE, verifiedSource: SOURCE,
      lockedNpmInstall: true, lockedCargoBuild: true,
      npmLockBlob: trustedBlobs.npmLock,
      cargoLockBlob: trustedBlobs.cargoLock,
      bundleScriptBlob: trustedBlobs.bundleScript,
      artifacts, preStageCompiledHostSha256: stagedHost.sha256,
      avRealTimeEnabled: true, appExecuted: false, binariesUploaded: false,
    },
    trustedBlobs, packageJson, packageLock,
    defenderReport: {
      defenderAvailable: true, defenderRealtime: true,
      matchingDefenderEvents: [], zeroMatchingEventsDoesNotProveSafety: true,
    },
  };
}

const check = (o) => assessTf4BuildEvidence(o);
const blocked = (o, code) => {
  const result = check(o);
  assert.ok(result.blockers.includes(code), result.blockers.join(", "));
  assert.equal(result.classification, "INDEPENDENT_EXECUTABLE_SECURITY_NOT_QUALIFIED");
};

test("synthetic complete static provenance still is NEVER executable clearance", () => {
  const result = check(fixture());
  assert.deepEqual(result.blockers, []);
  assert.equal(result.classification, "STATIC_PROVENANCE_REVIEW_ONLY_NO_EXECUTABLE_CLEARANCE");
  assert.equal(result.malwareAbsenceProven, false);
  assert.equal(result.signedForDistribution, false);
  assert.equal(result.installedAcceptanceGranted, false);
  assert.equal(result.historicalDefenderDetectionAdjudicated, false);
});

test("post-bundle compiled output can differ without mislabeling exact staged/packaged host", () => {
  const f = fixture();
  assert.notEqual(f.report.artifacts.compiledHost.sha256, f.report.artifacts.stagedHost.sha256);
  const result = check(f);
  assert.ok(!result.blockers.includes("packaged-native-host-identity"));
  assert.match(result.findings.find((x) => x.id === "mutable-post-package-host-output").detail,
    /Different from staged/);
});

test("staged/packaged host mismatch is fatal, not masked by matching compiled host", () => {
  const f = fixture();
  f.report.artifacts.compiledHost = { ...f.report.artifacts.stagedHost };
  f.report.artifacts.extractedHost.sha256 = digest("9");
  blocked(f, "packaged-native-host-identity");
});

test("missing pre-stage host identity rejects an otherwise consistent package", () => {
  const f = fixture();
  delete f.report.preStageCompiledHostSha256;
  blocked(f, "pre-stage-native-host-identity");
});

test("mismatched pre-stage identity rejects replacement after compilation", () => {
  const f = fixture();
  f.report.preStageCompiledHostSha256 = digest("9");
  blocked(f, "pre-stage-native-host-identity");
});

test("wrong repository or wrong source SHA is rejected", () => {
  for (const change of [
    (f) => { f.report.repository = "attacker/clack-ide"; },
    (f) => { f.report.verifiedSource = "f".repeat(40); },
    (f) => { f.report.requestedSource = "f".repeat(40); },
  ]) {
    const f = fixture();
    change(f);
    blocked(f, "exact-source-identity");
  }
});

test("unverified GitHub run id cannot be authenticated from a caller-supplied report", () => {
  const f = fixture();
  f.ciRunVerified = false;
  blocked(f, "independently-authenticated-ci");
});

test("lock sources and reported source commit blobs must match independent Git tree", () => {
  for (const change of [
    (f) => { f.report.npmLockBlob = "f".repeat(40); },
    (f) => { f.report.cargoLockBlob = "f".repeat(40); },
    (f) => { f.report.bundleScriptBlob = "f".repeat(40); },
    (f) => { f.report.lockedNpmInstall = false; },
    (f) => { f.report.lockedCargoBuild = false; },
  ]) {
    const f = fixture();
    change(f);
    blocked(f, "locked-input-provenance");
  }
});

test("Zod 4.4.3 and semver range are not silently marked remediated", () => {
  for (const change of [
    (f) => { f.packageJson.dependencies.zod = "^4.4.3"; f.packageLock.packages[""].dependencies.zod = "^4.4.3"; f.packageLock.packages["node_modules/zod"].version = "4.4.3"; },
    (f) => { f.packageJson.dependencies.zod = "^4.6.6"; f.packageLock.packages[""].dependencies.zod = "^4.6.6"; },
    (f) => { f.packageLock.packages["node_modules/zod"].version = "4.4.3"; },
    (f) => { f.packageJson.dependencies.zod = "4.7.0"; },
  ]) {
    const f = fixture();
    change(f);
    blocked(f, "zod-minimum-security-fix");
  }
});

test("zero-byte output and malformed artifact hash are never accepted", () => {
  const f = fixture();
  f.report.artifacts.installer.bytes = 0;
  f.report.artifacts.extractedApp.sha256 = "0xFAKE";
  blocked(f, "artifact-installer");
  blocked(f, "artifact-extractedApp");
});

test("previously quarantined application digest remains blocked even with new installer hash", () => {
  const f = fixture();
  f.report.artifacts.extractedApp.sha256 =
    "b7102a8d6afa43172de5ca7df3aac8840e0e2dbf977beb027bb2f8b517b012aa";
  blocked(f, "known-quarantined-application-excluded");
});

test("a built executable that was run or uploaded invalidates this isolated qualification", () => {
  const f = fixture();
  f.report.appExecuted = true;
  blocked(f, "no-execution-or-binary-upload");
  f.report.appExecuted = false;
  f.report.binariesUploaded = true;
  blocked(f, "no-execution-or-binary-upload");
});

test("hosted real-time Defender disabled invalidates endpoint non-detection proof", () => {
  const f = fixture();
  f.report.avRealTimeEnabled = false;
  f.defenderReport.defenderRealtime = false;
  blocked(f, "active-real-time-av-observed");
});

test("reported build-time Defender detection always fails even with active real-time protection", () => {
  const f = fixture();
  f.defenderReport.matchingDefenderEvents = [{ ThreatID: 2147731250 }];
  blocked(f, "no-build-time-av-detection");
});

test("no Defender telemetry is not the same as negative detections", () => {
  const f = fixture();
  f.defenderReport = null;
  blocked(f, "no-build-time-av-detection");
  blocked(f, "active-real-time-av-observed");
});

test("genuine Windows UTF-8 BOM JSON report is readable without weakening schema checks", () => {
  const v = parseJsonEvidence(Buffer.from("\ufeff" + JSON.stringify({ source: SOURCE }), "utf8"));
  assert.equal(v.source, SOURCE);
  assert.throws(() => parseJsonEvidence("{}\ufeff"), SyntaxError);
});
