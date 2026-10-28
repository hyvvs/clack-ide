# R5dh — exactly one live 73K Muse verifier and dual-parser failure observer

**Starting HEAD:** `aae7a6f9ee72b4e3cfd837ac20ca760a9f50ac0d`. **Live diagnostic:** `node scripts/r5dh-muse-verifier.mjs qualification 1` **once**. **Classification:** **73K VERIFIER PASS — PRIOR PARSER FAILURE UNREPRODUCED**. No Agent, notes app, alternate model, ForgeBoard, second verifier, retry, production parser fix or policy change.

## Preservation / identity

- Exact live `muse-glimmer:30b` digest `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`; Ollama version `0.40.11`, model inventory **15**, read via existing pinned localhost SSH tunnel **PID 12932**. No SSH restoration or changes required.
- Original seven protected SHA-256 hashes matched; six original dirty tracked files, both stashes, tracker, settings/profiles and R5db/R5dd/R5de/R5df evidence preserved. Separate exclusive ignored evidence root: `src-tauri/target/real-qwen-product/museglimmer-r5dh-verifier-20261028-01/` with empty Git-only workspace.
- Original production calibration, exact-tier `verifyModelTools`, `get_probe_value` schema, 512 output allowance, Automatic reasoning (`think` absent), trust, timeout, permission and retry behavior untouched. Isolated WebView2 software rendering retained. Native host hard-limited **exactly seven calibration requests and one 73728/512 `get_probe_value`**, rejecting second-verifier and Agent-shaped requests.
- Opt-in failure-only observer from the previously committed `ollamaParserFailureDiagnostics.ts` was enabled in the isolated WebView across **both** `verifiedProviderFetch` and `createOllamaModel` stages. It was explicitly uninstalled after the verifier and had a bounded dedicated `/evidence` receiver; no full provider stream or prompt persisted.

## Fresh calibration and native verifier

Seven production calibration requests `inference-1` through `inference-7` requested **4096, 8192, 16384, 32768, 49152, 65536, 73728**, each `num_predict=32`. Every requested context equaled measured loaded allocation, and every native calibration stream had provider `done` and HTTP EOF. Persisted gate `verified`, `calibrationFresh=true`, `runtimeEpochMatches=true`, `loadedContextMatches=true`, `numericalRouteQualified=true`, all trusted targets **73728**. No inherited proof accepted.

`inference-8` was the **one** genuine native verifier, **73728 / 512**, 1 genuine `get_probe_value` tool schema, Automatic reasoning unchanged. Its HTTP response and the SDK completed normally. Final native trace:

| Event / metric | Evidence |
|---|---:|
| Native request dispatch (Unix ms) | `1793148627285` |
| First response body (Unix ms) | `1793148628588` |
| Last native body + provider done | `1793148669844` |
| Native HTTP EOF and completed | `1793148669845` |
| Dispatch→completed | **42,560 ms** |
| Native body chunks / bytes | **330 / 50,056** |
| Dropped native events | **0** |
| Max native adjacent forwarded chunk gap | **6,935 ms** |
| Max measured WebView callback chunk-to-chunk gap | **6,935 ms** |
| Cancellation | **none**; native cancellation IPC file absent |

Persisted exact-tier native tool proof: ID **`8ff5b020-fbbe-4ef4-bbe5-8aad0132f9e8`**, `verified`, `native-call`, `calls=1`, `validArguments=true`, `finish=tool-calls`, `context=73728`, `output=512`, digest/version matching live provider, `proofExpiresAt=1793235070528`. Fresh isolated runtime epoch **`10792:1793148562758806200`**. This host terminated normally and its runtime-bound proof is **not reusable** in a future host.

## Dual parser-stage finding

Durably persisted `qualification-1.parser-failures.json` contains `installed: true` and **`failures: []`**. Therefore **zero observed exceptions** from either the completion scanner or native Ollama adapter. The genuine SDK tool-call proof and provider-done/EOF establish end-to-end successful parsing, including the terminal Ollama response. Separate success counters for each stage were **not instrumented** (the observer is intentionally failure-only); stage success is inferred from the valid native proof and the lack of exceptions, not directly measured from per-stage success logs.

No failing JSON frame, raw fault bytes, malformed UTF-8, schema rejection, or truncated provider completion exists in this **successful** request. The earlier R5df `inference-8` exception and its exact bytes remain unavailable; this R5dh success does not retroactively determine whether historical provider output was valid. **Generic Clack defect proven: NO.** Earlier `sdk-stream-parser-failed` remains an unreproduced, unresolved historical incident, not a justified parser fix.

## Verification and follow-up boundary

Before live dispatch: `npm.cmd run check-types` PASS, acceptance-only Rust verifier host **7/7 tests PASS**, `cargo build --locked --example r5dh_verifier --target-dir target/codex-test` PASS. After host termination: **one offline audit** `node scripts/r5dh-muse-verifier-audit.mjs` verified 8 request controls, all 8 native provider-done/EOF traces, accurate loaded tiers, scoped proof, opt-in empty parser-failure receipt, zero cancellations/Agent/app files and saved SHA-256 receipts in `qualification-1.offline-audit.json`.

Given the completed 73K qualification and valid exact-tier native-tool proof in a non-retry one-shot run, **one separately authorized replacement Muse notes-app acceptance is technically justified** under its own fresh host/runtime/context calibration/proof and corrected acceptance harness. This verifier diagnostic does not authorize that replacement, cannot establish `MUSE ACCEPTED`, and does not permit a ForgeBoard run. No further inference was dispatched in this task.
