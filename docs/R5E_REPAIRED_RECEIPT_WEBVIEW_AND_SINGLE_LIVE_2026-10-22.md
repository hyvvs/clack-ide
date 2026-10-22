# R5e — repaired collector WebView qualification and ONE production live receipt (2026-10-22)

**Classification: LIVE RECEIPT CLOSURE PASS for ONE short production-path request. R5 local-model application acceptance remains LIMITED / NOT READY; historical R5 `ollama-context-route` failure remains unresolved; R3d packaged desktop approval/restart remains BLOCKED; all mandatory P2–P19 work remains deferred, not cancelled.** This checkpoint starts from `22de1ab5965f2e9c88e88972dece26ad6590586d`, and did not rerun or rewrite the earlier R5b/R5d observations. No production provider/preflight/native/frontend SDK implementation, permissions, limits, model/profile, tunnel or remote service was changed.

## 1. First hard gate — actual native Tauri WebView, NO inference

The new disposable `scripts/r5e-receipt-webview-smoke.mjs` runner used the existing compiled `hardened_agent_acceptance.exe`, an actual Vite `http://127.0.0.1:<ephemeral>` page loaded inside its hidden Tauri WebView, and an independently killable instance of the **repaired** `createR5bReceiptHandler`. The frontend `src/test/r5eReceiptWebviewSmoke.ts` imports only Tauri `invoke`, not AI SDK/providers; the collector exposes synthetic-only metadata. Its requests were browser `fetch`, not Node `fetch` or a mocked browser.

**PASS:** the collector's persisted HTTP method/origin audit records **two** genuine JSON `OPTIONS` CORS preflights (one for each endpoint, correctly marked `Origin` equal to the Vite frontend) and cross-origin browser JSON POST traffic to both `/events` and `/report`. Four `/events` POSTs: **three** redacted events acknowledged after their append, **one** sensitive-field event rejected with 400. Two `/report` POSTs: **one** sensitive-field report rejected with 400, **one** strictly allowlisted final report persisted before successful HTTP acknowledgment. The page required successful JSON acknowledgments and both privacy rejections before its clean Tauri `coworking_exit` (native exit **0**).

The runner then **killed only its owned collector process without graceful collector shutdown**, and read from disk all **three** acknowledged event records and the accepted final report. No sensitive marker appears in these retained receipts. The original SSH process was not touched. Zero provider requests or inference occurred in this gate. Ignored, exclusive evidence: `src-tauri/target/r5e-webview-smoke-20261022-01/` and `src-tauri/target/r5e-webview-smoke-20261022-01-result.json` (SHA-256 `209873f24055eab82b8ae53d0e130c184ccf4e30274fe5d980f98ecf5357bfda`).

## 2. Second hard gate — intact saved settings and existing Ollama tunnel

The independently restored `ssh.exe` PID **19164** and `127.0.0.1:11435` listener remained present. Read-only `/api/version` gave Ollama **0.40.5**, `/api/tags` confirmed the installed Nemotron digest equals the saved profile, and the saved settings SHA-256 was still `b6b48848b5144e7ec1205f3633974aad15c627fd54b5a645ee637ca369e4cca2`. Endpoint configuration revision **1**, loopback URL and manually managed `ssh:null`/`credentialRef:null` were unchanged; the saved profile still had `overrides:{}` (Automatic). Read-only `/api/ps` did **not** show the model already loaded at that snapshot; this is not an installed-model readiness failure, and no warm-up inference was performed.

Both hard gates passed **before** the one authorized production request. No SSH restoration, remote configuration, provider downloads or Automatic/context setting changes occurred.

## 3. ONE and ONLY ONE production request, fresh exclusive workspace

The runner `scripts/r5e-live-receipt.mjs` owns a new `src-tauri/target/r5e-native-one-shot-20261022-01/` and separate ignored result file. Its script checks version/digest/original saved-profile bytes before exclusively creating the workspace (`mkdir` and `wx` persistence), and cannot reuse the R5b/R5d roots. It launches the real Tauri native acceptance host with the copied original saved profile, and uses `src/test/r5eLiveReceiptAcceptance.tsx`: genuine `buildConfiguredLanguageModel`, existing `requestPreflight.prepare`, Tauri/Rust native `ai_http_stream`, actual Ollama HTTP, AI SDK `generateText()` and the Ollama **nonstreaming `doGenerate()` complete-JSON parser**, not `streamText()`/NDJSON. The harmless one-sentence response request had **no tools or application mission**. Exactly one loop iteration, `maxRetries:0`, 64 output tokens, original **30-second abort**, **90-second overall host bound**, no fallback or continuation.

**PASS — one native request `inference-1`, one SDK result, no repeat:**

| Boundary | Durable redacted observation |
| --- | --- |
| Saved Automatic profile and live identity | Original bytes/digest/revision matched; browser `reasoningChoice:automatic`, cloud inference 0 |
| Production preflight decision | `modelMatches:true`, `admittedByRoute:true`; `serializedContext:null`, `trustedTarget:null` in redacted receipt |
| Native HTTP dispatch | **2026-10-22T18:34:21.843Z**; 7,336 microseconds elapsed in native diagnostic |
| First response headers | **2026-10-22T18:34:31.653Z**; 9,817,867 microseconds elapsed |
| Rust response body / IPC | **one 626-byte chunk**, native `body → ipc-attempt → ipc-forwarded`, no dropped native events |
| Native EOF / completion | **2026-10-22T18:34:31.664Z**, **9,828,145 microseconds** elapsed; no native cancellation |
| Browser frontend IPC consumer | Durable `headers`, `chunk:626`, `settled` receipts, in order |
| SDK `generateText()` / `doGenerate()` | **Resolved**, `provider-completed`, finish reason **`length`**, **64** output tokens; no response text retained |
| Incremental collector receipt persistence | **six** accepted JSONL records; bounded flush **`flushed`** |
| Final report persistence | Exclusive redacted report file exists, asynchronously written before collector HTTP success response |
| Native host / runner | Native exit **0**, signal null; runner exit **0**, `completed:true`, `durableFinalReport:true`, 90-second host deadline **not reached** |

The redacted preflight observer recorded a real **absence** of numeric context operands: both serialized `options.num_ctx` and trusted `runtimeTarget()` were omitted/undefined (represented as null in the receipt), so the existing strict equality comparison admitted this particular request. The receipt also shows `calibrationStatus:verified` but `calibrationExpired:true`, `runtimeEpochMatches:false`, and `loadedContextMatchesCalibration:false`. **Do not claim a verified 65,536 outgoing context or that this proves historical R5 rejection repaired.** This observation is not, by itself, proof of a production defect: a successful omitted-context comparison and an actual provider roundtrip occurred. Why the prior mission's later guard rejected remains **unknown**. The new R5e request returned HTTP headers within its deadline; this does **not** establish what caused the earlier R5d 29.94-second no-header cancellation.

The SDK's `length` finish reason records completed parsing/return, **not** semantic compliance with the requested one-word answer or broader inference quality. The final report was durably persisted by the actual WebView POST route and server acknowledged only after writing; an **independent additional browser-side final-ack marker** was not recorded on this live request. The synthetic WebView gate directly verified browser response acknowledgment. No prompt, generated text, raw payload/body, raw HTTP headers, full model label, credential, tool content or unbounded event body was stored in the redacted receipts.

### Frozen evidence (ignored; do not rerun these paths)

- WebView result: `src-tauri/target/r5e-webview-smoke-20261022-01-result.json`, SHA-256 `209873f24055eab82b8ae53d0e130c184ccf4e30274fe5d980f98ecf5357bfda`.
- Live runner result: `src-tauri/target/r5e-native-one-shot-20261022-01-result.json`, SHA-256 `1db61a0ad2835818557f26cb2f9b1e2971bbf64ea1e00f1695c5d75386b3a8ef`.
- Native redacted boundary summary: `src-tauri/target/r5e-native-one-shot-20261022-01/redacted-native-summary.json`, SHA-256 `7393cb5d98a4b1f469e912af8b94597e933f3afcedec5eccfb419f565455dae5`.
- Redacted incremental receipts: `src-tauri/target/r5e-native-one-shot-20261022-01/redacted-preflight-events.jsonl`, SHA-256 `c3fbde5cc5e82c36314266b0d979a4bd3d9d2f3b829e5eb1ca8e105ca82e18e7`.
- Redacted durable final report: `src-tauri/target/r5e-native-one-shot-20261022-01/redacted-final-report.json`, SHA-256 `a86eeded0fa17153b1de1239b7ffb143e22d66d9815bd9856017256a308981fc`.

## 4. Focused validation, preservation, closeout

- Real Tauri WebView smoke **PASS** (2 OPTIONS, 4 event POSTs, 2 report POSTs, 3 acknowledged events, durable report, privacy rejection and post-collector-kill durability).
- `node --test scripts/r5c-receipt-boundary.test.mjs`: **4/4 PASS**.
- `npx vitest run src/test/r5cReceiptFlush.test.ts src/modules/ai/lib/requestPreflight.test.ts src/modules/ai/lib/ollamaModel.test.ts src/modules/ai/lib/ollamaRouting.test.ts`: **106/106 PASS** across four suites.
- `npm.cmd run check-types`: **PASS**; focused Biome on both new TypeScript entries **PASS**; Node syntax checks on all three new scripts **PASS**; `npm.cmd run build`: **PASS**, existing bundler dynamic-import/plugin timing advisories.
- Preserve the original six dirty protected files by byte hash, both stashes, `autonomous_tracker/`, all old R5b/R5d artifacts, original operator-owned SSH, and the full P2–P19 roadmap. Commit only R5e-owned runner/browser files and engineering evidence, with **no push**. No production code or provider setting repairs were made or needed for this narrow receipt gate.

**Exactly one next action, subject to separate authorization:** return directly to **genuine real local-model Agent application acceptance**, with independently verified application build, tests, functional runtime and persistence, rather than another receipt infrastructure audit. **STOP this R5e observation.**
