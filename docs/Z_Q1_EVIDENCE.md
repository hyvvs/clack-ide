# Clack Q1 Evidence

Fixture: `clack-q1-v1`. Tested base: `60720f2ed0553e62204f78d5ffc0327db1ba0451`. Host: win32/x64.

Deterministic status: **passed**. Frontend: 969 passed (54 files); Rust: 637 passed.

Native GUI: **Not performed - explicitly deferred by user**. Real provider/server: **Not tested - real provider/server evidence deferred to Z**. No Computer Use, paid calls or public-network dependencies.

| Scenario | Owners | Deterministic Status | Frontend Assertions | Native Automated Cases |
| --- | --- | --- | --- | --- |
| A | C1a/C1b/G1a/B1 | passed | 123 | 55 |
| B | C1b/G1a | passed | 98 | 11 |
| C | C2/B1/R2 | passed | 123 | 9 |
| D | M1/M2/G1b | passed | 42 | 51 |
| E | H1/H2/M2 | passed | 67 | 3 |
| F | H2/G1b/F1/B1 | passed | 104 | 19 |
| G | H1/H2/D1 | passed | 74 | 4 |
| H | M2/H2/write safety | passed | 47 | 8 |
| I | R1/R2/F2 | passed | 75 | 55 |
| J | R2/B1/D2 | passed | 174 | 6 |
| K | T1/T2/T3a/T3b/T3c/F1 | passed | 103 | 106 |
| L | C1a/C2/H1/T2/T3/D3/G3 | passed | 168 | 63 |

Counts overlap where scenarios reuse owner suites. Exact files, native case names, coverage, layers, measurements, failures and limitations are in [Z_Q1_EVIDENCE.json](Z_Q1_EVIDENCE.json). Critical gates are assertions in those suites, not universal product guarantees: 100% retained or explicitly blocked; valid authorized sources; zero orphan pairs, unauthorized data/tools or known completed effect replays; stale critical evidence reconciled or blocked.

## Original-Source Measurements

A compares actual original-source requirements against prepared context. Full/B1-elided history does not fit the 6000 working target; prepared history does. Originals remain hash-identical; 10 authorized source references resolve; 4 extraction calls.

| A Baseline | Critical | Noncritical Recall | Estimated Conversation Tokens | Fits 6000 Working | Fits 128K Full |
| --- | --- | --- | --- | --- | --- |
| original | 4/4 | 4/4 | 16426 | false | true |
| b1Elided | 4/4 | 4/4 | 16426 | false | true |
| prepared | 4/4 | 4/4 | 5758 | true | true |

B: ten distinct compaction revisions, original-source lineage validated after each cycle. Latest working noncritical recall: 1/4; omitted originals retrieved: 3/3, source accuracy 3/3. Preparation calls: 20. This is bounded retrieval recovery, not perfect compacted recall.

| B Cycle | Revision | Critical | Noncritical Recall | Valid References | Coverage End (Exclusive) | Estimated Conversation Tokens | Fits 8192 Working |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 3 | 4/4 | 4/4 | 10 | 10 | 6175 | true |
| 2 | 4 | 4/4 | 4/4 | 14 | 14 | 7836 | true |
| 3 | 6 | 4/4 | 1/4 | 20 | 20 | 6493 | true |
| 4 | 8 | 4/4 | 1/4 | 25 | 25 | 7330 | true |
| 5 | 10 | 4/4 | 1/4 | 30 | 30 | 8167 | true |
| 6 | 12 | 4/4 | 1/4 | 35 | 35 | 7036 | true |
| 7 | 14 | 4/4 | 1/4 | 40 | 40 | 7873 | true |
| 8 | 16 | 4/4 | 1/4 | 45 | 45 | 6765 | true |
| 9 | 18 | 4/4 | 1/4 | 50 | 50 | 7602 | true |
| 10 | 20 | 4/4 | 1/4 | 55 | 55 | 8166 | true |

E: deterministic investigation/implementation/review/correction completion 4/4; source accuracy 1/1; useful required handoff evidence 1/1. Stale review blocks; corrected review validates. This is a coordinator fixture, not an autonomous model task score.

F: mission retained, 1 required evidence included, 1 irrelevant source omitted; 724 estimated conversation tokens. F1 schema cost 226 -> 151 estimated tokens (483 -> 318 bytes); current request fits the 4096 deployed fixture allowance. Cross-workspace evidence and mandatory overflow block.

No unsafe-delivery/effect violations observed in enumerated canary/permission/recovery assertions. No historical per-model quality baseline exists; no invented intelligence or timing regression delta.

## Concrete Regression Fixed

G1a: optional retrieval could add an empty or enlarged final evidence envelope that exceeded B1 after a fitting trial. Final envelope is rechecked, optional groups are omitted atomically without orphaning tools, an empty optional envelope cannot block fitting existing context, and required sources still fail closed. Notice sources/omission counts match what is actually delivered. The owner regression suite passes.

## Limits and Remaining Z Evidence

Synthetic data, fixed clocks/IDs, deterministic extraction, intercepted installed SDKs and native test fixtures. Unit/IPC mocks are separate from native automated storage/process/network tests. E/G native evidence covers provenance and receipt persistence, not a native GUI or end-to-end model collaboration run. No browser tests were rerun for Q1. Quality scores measure deterministic preparation/retrieval/handoff, not LLM answers.

B uses a 32768 deployed/extraction fixture allowance and 8192 compacted working target. Historical retrieval uses an explicitly larger 16384 working allowance; success is not claimed at 8192. Fixed-clock milliseconds are not performance benchmarks; test wall time is recorded separately in JSON. Tool/permission versions and supported effort mappings are asserted in owner suites.

Z retains A-L and S1-S13 native Tauri split panes, Stop/minimize/restore/restart/dialogs, real small-model and LAN/provider tests, capacity/effort/collaboration measurements, Windows packaging and Linux/Arch/NVIDIA/macOS native/packaging gates. Only Windows native automated tests ran here. No deployment/push/release.

Rollback retains this corpus/report. A failing optimization must be disabled/fixed at its named owner; never erase originals or relax critical assertions.
