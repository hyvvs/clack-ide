# R5i — Repaired WebView reporting gate before conditional local-Agent acceptance

**Terminal classification: GATE 1 FAILED ON SYNTHETIC FAILURE-OWNER ASSERTION; HARD STOP BEFORE INFERENCE.** Started at precisely `ac782d01ac60fd2573a3baff2e5597d3c2e3fa35`. The user authorized one fresh real-Tauri synthetic receipt gate, then normal context requalification and one ForgeBoard mission **only if all earlier gates pass**. This checkpoint launched exactly **one** fresh WebView smoke, preserved its failed assertion, made a narrowly evidenced classifier correction, and **did not rerun any WebView smoke, send inference, or start ForgeBoard**.

## Gate 1 — actual native Tauri WebView, one fresh exclusive run

Reused the already committed `scripts/r5h-webview-report-smoke.mjs`, `src/test/r5hSafeFailureWebview.ts`, `scripts/r5h-safe-report.mjs` and original compiled `hardened_agent_acceptance.exe` (no new harness). Added a bounded, explicitly named **R5i** exclusive ignored root and two strict synthetic `/events` receipts to the existing test before the final `/report`, including disk-before-HTTP-ack verification. This is frontend browser `fetch`, CORS-preflight and collector traffic only; **no AI SDK, inference, Ollama, tools or model request**.

Observed ignored evidence root `src-tauri/target/r5i-webview-failure-smoke-20261023-01/`:

| Observation | Verified result |
| --- | --- |
| Native Tauri WebView entry loading/browser-safe classifier | **PASS** — actual native host exit code 0; no Node-import failure |
| Cross-origin browser CORS and collector | **PASS** — OPTIONS for both `/events` and `/report` (2); valid POSTs (3), same expected browser origin |
| Incremental receipt persistence and acknowledgment | **PASS** — `calibration-start` ordinal 1 and `calibration-failed` ordinal 2, both exact allowlisted JSONL entries |
| Durable final report before success acknowledgment | **PASS** — persistent `durable-final-report.json` with explicit `ok:false`, stage/code/class/owner and zero dispatch |
| Private error text, arbitrary extra fields | **EXCLUDED** — no `PRIVATE_PROMPT`/credentials in any persisted audit/event/final record |
| Exact expected synthetic error classification | **FAIL** — assertion expected `failureOwner:native-ipc`, actual persisted `failureOwner:calibration` |
| Gate 1 as a whole | **FAIL**, not promoted to pass or qualifying Gate 2 |

The synthetic failure was a deliberately raised `Error` with an error `code:"settings-unavailable"` but unrelated/private exception message. The browser-safe classifier at committed R5h based owner attribution on matching a substring of the message; it recognized the error **code** but did not associate the recognized native settings error with the **native IPC** owner. The exact persisted report was:

```json
{
  "ok": false,
  "kind": "r5h-synthetic-failure",
  "missionStarted": false,
  "calibrationRequests": 0,
  "missionRequests": 0,
  "lastDurableStage": "calibration-start-ack",
  "nativeDispatchAttempted": false,
  "failureStage": "calibration-invocation",
  "failureCode": "settings-unavailable",
  "failureClass": "Error",
  "failureOwner": "calibration"
}
```

This is a **demonstrated acceptance classifier attribution defect**, **not** a native transport failure: the WebView page, real CORS, incremental records, final persisted report and host cleanup all worked. The authoritative smoke result `passed:false`, `failureCode:AssertionError`, `hostExit.code:0` must not be reinterpreted as Gate 1 success. It proves nothing about the previously unknown R5g calibration startup failure.

**Narrow, post-failure owner-only fix:** `scripts/r5h-failure-classify.mjs` now assigns native ownership for known safe/native stable codes (`context-lease-held`, `settings-unavailable`, `server-unavailable`, `runtime-unavailable`) independent of private exception-message phrasing. `scripts/r5h-safe-report.test.mjs` adds an explicit synthetic code/owner regression and updates the previous expectation consistently. **4/4 deterministic Node tests PASS; TypeScript `npm.cmd run check-types` PASS**; script syntax check PASS. The corrected classifier **has not been retested in an actual WebView**, because user-authorized Gate 1 is one-and-done and failed. No second smoke or calibration was attempted.

### Frozen ignored artifact digests

- `smoke-result.json`: `5adae4a71902f8a398815929b4022f3667bec3b2c82ca66e83dd29676c084897`
- `origin-audit.jsonl`: `926177914e0c1f7f710a6b553cc93b6cbd3b24f2715937f04a0440b839ff9048`
- `durable-incremental-events.jsonl`: `76e6844ebe2d64829467e3084b03ec6a2027cc985945c13c89292b9b1ce497ad`
- `durable-final-report.json`: `29d87a5154990a8ed107c4f0eba558862d55ebdefd8f5b36d2020c45da6f142d`

## Conditional Gates 2 and 3 — NOT EXECUTED

| Requested acceptance | R5i classification |
| --- | --- |
| Existing tunnel/model/digest/Automatic readiness for calibration | **NOT EXECUTED** after Gate 1 failure; original SSH PID 19164 was preserved/observed for cleanup |
| Production context calibration attempts/provider inference | **NOT EXECUTED — 0 requests** |
| Fresh 65,536-token calibration, matching runtime epoch and loaded allocation | **NOT ESTABLISHED** |
| Actual trusted numeric target and serialized mission `num_ctx` operands | **NOT OBSERVED / NOT SENT** |
| ForgeBoard Agent mission, continuations, real native tools, verified writes | **NOT EXECUTED — 0 requests/0 tools/0 writes** |
| Conditional page-size correction 50 → 25 | **NOT ELIGIBLE / NOT SENT** |
| Context pressure/checkpoint/live savings | **NOT EXECUTED / NONE OBSERVED** |
| Generated application build/tests/API/CRUD/filtering/validation/pagination/persistence/SSE/frontend | **NOT EXECUTED** — no R5i application workspace |
| Generic Clack defect or model/tool-format limitation | **NONE NEW DEMONSTRATED**; only synthetic-harness owner-classification mismatch |
| R3d full packaged desktop GUI/approval/restart qualification | **REMAINS BLOCKED** |

The historical R5 calibration/context guard and R5e short live response remain distinct: a successful synthetic receipt neither certifies 65,536 runtime trust nor local-Agent application delivery. **Local-model Agent application reliability remains UNACCEPTED**. All mandatory Chat On Steroids P2–P19 roadmap requirements remain preserved/deferred, with real-Agent, security, integration, cross-platform and end-to-end tests still required.

## Preservation and decision

Confirmed exact initial Git commit, empty initial index, original six dirty user-owned file SHA-256 hashes, both stashes and `autonomous_tracker/`. Preserved operator-owned manual SSH process **PID 19164** and loopback tunnel, old model configuration/settings and all historical R5/R5e/R5g/R5h artifacts. No provider endpoint changes, model downloads, cloud fallback, file resets/cleans, old-root replay or Git push. Commit only the scoped existing harness alterations, regression test, this R5i report and the engineering-state index.

**Exactly one highest-value next action, separately authorized:** test the corrected stable-code-to-native-owner classifier through **one new exclusive actual-Tauri WebView synthetic reporting gate**, then—only on total Gate 1 PASS—proceed immediately to production context requalification and the single authorized ForgeBoard application mission. The R5i WebView root is frozen and must not be replayed. **STOP R5i.**
