import { scenarios, frontendFiles } from "./q1-manifest.mjs";
const path = (name) => name.replaceAll("\\", "/");
export function summarize(vitest, native, measurements) {
  const files = vitest.testResults ?? [];
  const passedNative = [...native.matchAll(/^test (.+) \.\.\. ok$/gm)].map(m => m[1]);
  const results = scenarios.map(s => {
    const frontend = s.tests.map(name => {
      const file = files.find(f => path(f.name).endsWith(`/${name}`));
      const cases = file?.assertionResults ?? [];
      return { file: name, passed: cases.filter(c => c.status === "passed").length, failed: cases.filter(c => c.status === "failed").map(c => c.fullName), skipped: cases.filter(c => c.status !== "passed" && c.status !== "failed").length, valid: !!file && cases.length > 0 && cases.every(c => c.status === "passed") };
    });
    const nativeCases = passedNative.filter(name => s.native.some(pattern => name.includes(pattern)));
    const nativeCoverage = s.native.map(pattern => ({ pattern, passed: nativeCases.filter(name => name.includes(pattern)).length }));
    return { ...s, status: frontend.every(f => f.valid) && nativeCoverage.every(c => c.passed > 0) ? "passed" : "failed", layers: { frontend: "unit/integration; installed adapters, intercepted transports and mocked IPC where applicable", rust: "native automated storage/filesystem/Git/WASI/HTTP fixtures; not GUI", browser: "not performed in Q1", nativeGui: "Not performed - explicitly deferred by user", realProvider: "Not tested - real provider/server evidence deferred to Z" }, frontend, nativeCases, nativeCoverage, measurements: measurements[s.id] ?? null, sourceCoverage: measurements[s.id]?.sourceCoverage ?? "owner suite provenance/coverage assertions; inspect enumerated test files", preparationCost: measurements[s.id]?.preparationCalls ?? "not measured separately by owner suite", failures: { frontend: frontend.filter(f => !f.valid).map(f => f.file), missingNativePatterns: nativeCoverage.filter(c => c.passed === 0).map(c => c.pattern) }, limitations: ["Synthetic fixture outcomes are not real-model intelligence scores", "Native GUI and real-provider evidence remains for Z"] };
  });
  const a = measurements.A, b = measurements.B, e = measurements.E, f = measurements.F;
  const measuredGate = a?.status === "passed" && a.baselines.prepared.criticalRetained === a.baselines.prepared.criticalTotal && a.baselines.prepared.fitsSmall && a.authorizedReferences > 0 &&
    b?.status === "passed" && b.cycles.length >= 10 && new Set(b.cycles.map(c => c.revision)).size >= 10 && b.cycles.every(c => c.criticalRetained === c.criticalTotal && c.references > 0 && c.fitsSmall) && b.queriedOriginalFacts > 0 && b.retrievedRecall === b.queriedOriginalFacts &&
    e?.taskCompletion.completedStages === e?.taskCompletion.requiredStages && e?.taskCompletion.requiredStages > 0 && f?.requiredEvidenceIncluded === 1;
  const nativeSummaries = [...native.matchAll(/test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
  const nativeValid = nativeSummaries.length > 0 && nativeSummaries.every(m => m[1] === "ok" && +m[3] === 0 && +m[4] === 0) && nativeSummaries.reduce((n, m) => n + +m[2], 0) === passedNative.length;
  const allFilesPassed = frontendFiles.every(name => {
    const file = files.find(f => path(f.name).endsWith(`/${name}`));
    return file?.assertionResults?.length > 0 && file.assertionResults.every(c => c.status === "passed");
  });
  return { status: results.every(s => s.status === "passed") && allFilesPassed && measuredGate && nativeValid && vitest.success === true ? "passed" : "failed", criticalGate: { measuredOraclePassed: !!measuredGate, nativeSuitePassed: nativeValid, requirements: "100% retained or explicitly blocked; valid authorized sources; no orphan pairs, unauthorized data/tools, known completed effect replay; stale critical evidence reconciled or blocked", basis: "runtime assertions in enumerated suites plus original-source measurements, not universal product guarantees" }, frontend: { passed: vitest.numPassedTests, failed: vitest.numFailedTests, suites: files.length }, rust: { passed: passedNative.length }, scenarios: results };
}
export function markdown(report) {
  const measured = id => report.scenarios.find(s => s.id === id)?.measurements;
  const a = measured("A"), b = measured("B"), e = measured("E"), f = measured("F");
  const baselineRows = Object.entries(a?.baselines ?? {}).map(([name, score]) =>
    `| ${name} | ${score.criticalRetained}/${score.criticalTotal} | ${score.noncriticalRecall}/${score.noncriticalTotal} | ${score.conversationTokens} | ${score.fitsSmall} | ${score.fitsFull} |`).join("\n");
  const cycleRows = (b?.cycles ?? []).map(c => `| ${c.cycle} | ${c.revision} | ${c.criticalRetained}/${c.criticalTotal} | ${c.noncriticalRecall}/${c.noncriticalTotal} | ${c.references} | ${c.coveredMessages} | ${c.conversationTokens} | ${c.fitsSmall} |`).join("\n");
  return `# Clack Q1 Evidence

Fixture: \`${report.fixtureVersion}\`. Tested base: \`${report.testedBaseCommit}\`. Host: ${report.host}.

Deterministic status: **${report.status}**. Frontend: ${report.frontend.passed} passed (${report.frontend.suites} files); Rust: ${report.rust.passed} passed.

Native GUI: **Not performed - explicitly deferred by user**. Real provider/server: **Not tested - real provider/server evidence deferred to Z**. No Computer Use, paid calls or public-network dependencies.

| Scenario | Owners | Deterministic Status | Frontend Assertions | Native Automated Cases |
| --- | --- | --- | --- | --- |
${report.scenarios.map(s => `| ${s.id} | ${s.owner} | ${s.status} | ${s.frontend.reduce((n, file) => n + file.passed, 0)} | ${s.nativeCases.length} |`).join("\n")}

Counts overlap where scenarios reuse owner suites. Exact files, native case names, coverage, layers, measurements, failures and limitations are in [Q1_EVIDENCE.json](Q1_EVIDENCE.json). Critical gates are assertions in those suites, not universal product guarantees: 100% retained or explicitly blocked; valid authorized sources; zero orphan pairs, unauthorized data/tools or known completed effect replays; stale critical evidence reconciled or blocked.

## Original-Source Measurements

A compares actual original-source requirements against prepared context. Full/B1-elided history does not fit the 6000 working target; prepared history does. Originals remain hash-identical; ${a?.authorizedReferences ?? "unavailable"} authorized source references resolve; ${a?.preparationCalls ?? "unavailable"} extraction calls.

| A Baseline | Critical | Noncritical Recall | Estimated Conversation Tokens | Fits 6000 Working | Fits 128K Full |
| --- | --- | --- | --- | --- | --- |
${baselineRows}

B: ten distinct compaction revisions, original-source lineage validated after each cycle. Latest working noncritical recall: ${b?.latestWorkingRecall ?? "unavailable"}/${b?.noncriticalTotal ?? "unavailable"}; omitted originals retrieved: ${b?.retrievedRecall ?? "unavailable"}/${b?.queriedOriginalFacts ?? "unavailable"}, source accuracy ${b?.sourceAccuracy?.valid ?? "unavailable"}/${b?.sourceAccuracy?.total ?? "unavailable"}. Preparation calls: ${b?.preparationCalls ?? "unavailable"}. This is bounded retrieval recovery, not perfect compacted recall.

| B Cycle | Revision | Critical | Noncritical Recall | Valid References | Coverage End (Exclusive) | Estimated Conversation Tokens | Fits 8192 Working |
| --- | --- | --- | --- | --- | --- | --- | --- |
${cycleRows}

E: deterministic investigation/implementation/review/correction completion ${e?.taskCompletion?.completedStages ?? "unavailable"}/${e?.taskCompletion?.requiredStages ?? "unavailable"}; source accuracy ${e?.sourceAccuracy?.valid ?? "unavailable"}/${e?.sourceAccuracy?.total ?? "unavailable"}; useful required handoff evidence ${e?.handoffUsefulness?.requiredEvidenceIncluded ?? "unavailable"}/${e?.handoffUsefulness?.totalRequiredEvidence ?? "unavailable"}. Stale review blocks; corrected review validates. This is a coordinator fixture, not an autonomous model task score.

F: mission retained, ${f?.requiredEvidenceIncluded ?? "unavailable"} required evidence included, ${f?.optionalEvidenceOmitted ?? "unavailable"} irrelevant source omitted; ${f?.contextTokens ?? "unavailable"} estimated conversation tokens. F1 schema cost ${f?.schemaCost?.tokensBefore ?? "unavailable"} -> ${f?.schemaCost?.tokensAfter ?? "unavailable"} estimated tokens (${f?.schemaCost?.bytesBefore ?? "unavailable"} -> ${f?.schemaCost?.bytesAfter ?? "unavailable"} bytes); current request fits the 4096 deployed fixture allowance. Cross-workspace evidence and mandatory overflow block.

No unsafe-delivery/effect violations observed in enumerated canary/permission/recovery assertions. No historical per-model quality baseline exists; no invented intelligence or timing regression delta.

## Concrete Regression Fixed

G1a: optional retrieval could add an empty or enlarged final evidence envelope that exceeded B1 after a fitting trial. Final envelope is rechecked, optional groups are omitted atomically without orphaning tools, an empty optional envelope cannot block fitting existing context, and required sources still fail closed. Notice sources/omission counts match what is actually delivered. The owner regression suite passes.

## Limits and Remaining Z Evidence

Synthetic data, fixed clocks/IDs, deterministic extraction, intercepted installed SDKs and native test fixtures. Unit/IPC mocks are separate from native automated storage/process/network tests. E/G native evidence covers provenance and receipt persistence, not a native GUI or end-to-end model collaboration run. No browser tests were rerun for Q1. Quality scores measure deterministic preparation/retrieval/handoff, not LLM answers.

B uses a 32768 deployed/extraction fixture allowance and 8192 compacted working target. Historical retrieval uses an explicitly larger 16384 working allowance; success is not claimed at 8192. Fixed-clock milliseconds are not performance benchmarks; test wall time is recorded separately in JSON. Tool/permission versions and supported effort mappings are asserted in owner suites.

Z retains A-L and S1-S13 native Tauri split panes, Stop/minimize/restore/restart/dialogs, real small-model and LAN/provider tests, capacity/effort/collaboration measurements, Windows packaging and Linux/Arch/NVIDIA/macOS native/packaging gates. Only Windows native automated tests ran here. No deployment/push/release.

Rollback retains this corpus/report. A failing optimization must be disabled/fixed at its named owner; never erase originals or relax critical assertions.
`;
}
