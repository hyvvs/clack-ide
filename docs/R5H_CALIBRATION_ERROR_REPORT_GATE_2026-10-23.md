# R5h — calibration-error reporting repair and hard-stop WebView observation

**Classification: HARNESS GATE FAILED — NO CALIBRATION OR FORGEBOARD INFERENCE.** Continues from `5940568deeba276db7659412bb2ffa501a5c8025` (R5g). The required synthetic actual-Tauri-WebView receipt gate failed before it could POST `/report`. Under the explicit instruction to repair only the owning harness layer and **STOP if this gate fails**, no second smoke run, live calibration, model inference, native Agent tools, correction or ForgeBoard mission was launched.

## Confirmed R5g defect and R5h scope

R5g's frontend attempted a negative final report after recording `r5g-calibration-start`. Its owned collector received that report but dropped the safe `failureStage` and `failureClass` keys when writing `mission-a-1.native-report.json`. This is a **confirmed acceptance-only sanitizer omission**; the actual R5g failure cause remains unknown and cannot be retroactively reconstructed.

R5h created an isolated allowlist-only report contract in `scripts/r5h-safe-report.mjs`, a browser-side safe classifier, and a disposable synthetic native acceptance page and collector. The contract retains only stable enumerated `failureStage`, `failureCode`, `failureClass`, `failureOwner`, `nativeDispatchAttempted`, `lastDurableStage`, request counts and a bounded success gate. It never persists exception message text, raw model/provider responses, prompts, full URLs or credentials. Node's report persistence uses exclusive `wx` writing **before** JSON `ok:true` acknowledgment. `scripts/r5h-forgeboard.mjs` is an owned fresh-path copy of R5g's one-shot runner, wired to use that same durable sanitizer if a separately authorized future application run occurs; the original R5g and R5e roots are untouched.

## Synthetic real Tauri WebView gate — FAILED

The exclusive `scripts/r5h-webview-report-smoke.mjs` created ignored `src-tauri/target/r5h-webview-failure-smoke-20261023-01/`, served a synthetic no-inference Vite page and launched the existing native Tauri `hardened_agent_acceptance.exe`. The page's initial import **failed**: Vite emitted

`Module "node:fs/promises" has been externalized for browser compatibility. Cannot access "node:fs/promises.writeFile" in client code.`

The cause was that the page imported the initial shared helper which imported Node `fs/promises` and `assert` alongside the pure error classifier. **No cross-origin browser `OPTIONS` or `POST /report` occurred**, and there is **no durable failure report** from this smoke. The owned native host PID 31980 was stopped; smoke runner ended with failure and no live inference. Exclusive ignored `smoke-result.json` SHA-256:
`7573b3ca4604e9ddf59c8c1ea542414cb382878c1e8538a4e200df1ea25de32d`. Its recorded synthetic-only result is `passed:false`, `inferenceRequests:0`, native host `4294967295` after the owned host was terminated, `failureCode:Error`. This is an **acceptance harness browser-import defect**, not provider/model/native inference evidence.

**Narrow repair after the failed smoke:** extracted `scripts/r5h-failure-classify.mjs` (pure browser-compatible functions, no Node imports) from the Node-only persistence module. Both synthetic frontend `src/test/r5hSafeFailureWebview.ts` and conditional calibration frontend `src/test/r5hCalibrateAndForgeboard.tsx` now import the pure module. The server-only collector continues to use `scripts/r5h-safe-report.mjs`. Stable codes for known native verification lease/settings errors are selected without writing or returning the underlying exception message.

**Verification after narrow repair:** `node --test scripts/r5h-safe-report.test.mjs` **3/3 PASS** (exclusive report persistence, safe allowlists, sensitive input excluded, deliberate native-lease code); `npm.cmd run check-types` **PASS**; `npm.cmd run build` **PASS** with existing build advisories. **No second actual WebView request was sent.** Therefore the repaired browser→collector path is **NOT YET WEBVIEW-QUALIFIED**, and must not be described as passing the user's first gate. This is the explicit hard-stop outcome.

## Production acceptance and preservation

| Required stage | Actual R5h status |
| --- | --- |
| Reporter omission repaired in owned source / deterministic tests | **PASS, offline** |
| Real Tauri WebView synthetic report persistence/acknowledgment | **FAIL before POST**; post-repair live WebView gate **NOT EXECUTED** |
| Saved model/tunnel freshness gate after WebView success | **NOT EXECUTED** by hard stop |
| Normal Clack context calibration / provider HTTP inference | **NOT EXECUTED — 0 requests** |
| Fresh 65,536 numeric trust, runtime epoch, `num_ctx` | **NOT ESTABLISHED** |
| ForgeBoard Agent / native tools / verified writes / continuations | **NOT EXECUTED — 0 requests, 0 calls, 0 writes** |
| Page-size correction 50 → 25 / context savings | **NOT EXECUTED / not eligible / none measured** |
| Generated app API, build/tests, persistence, SSE, frontend | **NOT EXECUTED** (no generated source) |
| Model capability / generic Clack runtime defect | **NOT EVALUATED / NONE CONFIRMED** |
| Full packaged Clack R3d approval/restart/GUI | **BLOCKED historically, not promoted** |

Preservation gate: six originally dirty user-owned files matched their recorded SHA-256 values, two Git stashes and `autonomous_tracker/` intact, original user-restored SSH process and `127.0.0.1:11435` unchanged, saved Nemotron digest/profile/Automatic settings and earlier evidence roots not mutated. Original full mandatory P2–P19 roadmap preserved and **deferred, not cancelled**. No Git push or unrelated edits. This R5h checkpoint touches only separately owned acceptance harness/report files and engineering documentation.

**Exactly one next action, separately authorized:** Run one **fresh, exclusive synthetic real-Tauri-WebView report gate** using the repaired browser-safe classifier, and only if it passes proceed directly to the normal context-calibration → one ForgeBoard acceptance sequence under the existing limits. Do not reuse the failed R5h smoke root or make an unobserved assumption that the repair passed the live WebView. **STOP R5h.**
