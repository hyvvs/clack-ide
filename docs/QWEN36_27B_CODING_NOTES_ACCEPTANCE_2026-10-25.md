# Qwen3.6 27B coding: live qualification and single notes Agent acceptance

**Date:** 2026-10-25. **Baseline HEAD:** `22682ece62b62ffcbb7fbbc5594f9b1859ff66fa`. **Candidate:** `qwen3.6:27b-coding` only. **Live full digest:** `8bdf0bc645c4de0a5025639b1e9a4ccc7fbcbb306a5ff04bc766e39d1db50d4d` (prior `8bdf0bc645c4` was its prefix). **Live Ollama:** `0.40.11`, existing SSH tunnel `127.0.0.1:11435`. No model download, other model inference, unrelated R5 work, production overrides or ForgeBoard run.

## Preserved state and original acceptance scope

Baseline Git index empty; original six dirty paths retained byte-for-byte, both historical stashes retained, `autonomous_tracker/`, historical profiles and all evidence retained. Protected original settings checksum `2d39dcfdd946acc733ba77ac1c8e68a226aeb46f013e68902a71002bd54592bb`. Fifteen existing tags; initial `/api/ps` empty. `/api/show` reports GGUF, Q4_K_M, `qwen35` family, 27.3B parameters, advertised context 262144, capabilities completion/vision/tools/thinking. An advertised context is **not** accepted as loaded context.

The original `r5ap` notes target was reused without editing: the new `src/test/r5auSmokeAgentAcceptance.tsx` contains the **exact same 1081-character mission**. `scripts/r5ap-independent-notes.mjs` is unchanged. The production normal self-hosted metadata onboarding, context calibration and native-tool verification were called from isolated test-only `r5au` files. The proven WebView2 software-rendering mitigation (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--disable-gpu --disable-gpu-compositing"`) is **only in the new acceptance-host child environment**, never in global settings or production Clack. Automatic Ollama reasoning leaves `think` omitted, persisted `overrides={}`, and no manual output cap; the generic `3f5b333` Agent output-budget policy remains authoritative.

## Qualification: PASS

Exclusive new workspace `src-tauri/target/qwen36-r5au-qualification-20261025-01/` and durable evidence `src-tauri/target/real-qwen-product/qwen36-r5au-qualification-20261025-01/`.

Fresh live runtime allocations were verified at **4096, 8192, 16384, 32768, 49152 and 65536**. Every `num_ctx` was matched by actual loaded context, each request used `num_predict=32` and omitted `think`, each calibration response completed. Verified target `65536` agrees across current runtime epoch `7196:1792892620450467900`, digest, Ollama `0.40.11`, snapshot, direct context trust and production budget limits. The seventh real `/api/chat` request used `num_ctx=65536`, `num_predict=512` and exposed only `get_probe_value`; **one true native structured tool call**, `finish=tool-calls`, `validArguments=true`, `textualIntent=false`, `outcome=native-call`, `status=verified`. This verification is **not** an Agent coding tool execution and was not borrowed from another model. Zero acceptance WebView crash dumps.

## Exactly one unchanged notes Agent mission: FAIL

Exclusive new notes workspace `src-tauri/target/qwen36-r5au-notes-20261025-01/` and evidence `src-tauri/target/real-qwen-product/qwen36-r5au-notes-20261025-01/`. The normal unchanged Agent mission ran, freshly recalibrated contexts and verified one native probe in its own runtime. All **six real Coder generations** (`inference-8` through `inference-13`) sent `num_ctx=65536`, **`num_predict=8192`**, 18 production native tool schemas, Automatic `think` omitted. Total **13** native inference attempts = six calibration + one verifier + six Agent generations.

Exactly **nine genuinely executed structured Agent tool calls**, all `output-available`: `todo_write` ×2, `list_directory` ×1, `write_file` ×3, `bash_run` ×1 (`npm install`, exit 0), `create_directory` ×2. **Zero** denied, unknown/nonexistent, `output-error` or textual pseudo-tools counted. They authored **four** project/source files: `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`; `src/` and `tests/` directories were created but **no source or tests** written.

Final generation **`inference-13`** produced eight native response chunks (**1227 total bytes**, zero diagnostic drops) over the first ~5.67 seconds; then it emitted no further provider body progress for ~60 seconds. Native Rust recorded `deadline-observed`, Tauri/Clack emitted `phase=timed-out`, and the Agent stopped naturally `state=failed`, `errorCode=stream-idle-timeout`, message "Timed out waiting for generation progress." **No provider-done/SDK finish** on that request; **no WebView crash dump** and native channel traffic was received before the idle period. This is a **PROVIDER/GENERATION stream-stall** with no independently proven source inside Ollama vs model; for the one-shot app acceptance the **MODEL failed to finish the work**. Clack's existing fail-closed progress timeout worked as designed: **no generic production Clack defect**, no production patch and no mission retry.

The independent original notes evaluator ran **once after the Agent stopped**, against frozen source without edits (`sourceUntouched=true`, `afterFileCount=4`, `passed=false`). Its results:

- **TypeScript FAIL**, `TS18003` (no `src/**/*` inputs); **production build FAIL** for the same reason.
- **Authored automated tests FAIL** (none); **test execution FAIL**, missing `tests/api.test.ts`.
- **Server startup FAIL** (no healthy backend). All health, list/get/create/patch/delete notes, missing note, malformed input, empty/long title validation and **persistence after restart BLOCKED**.
- **README FAIL** (missing); **runtime/generated-data `.gitignore` PASS**.

Acceptance **ACTUAL FAIL**; no truthful completed notes API, no ForgeBoard. The independent evaluator's internal historical `runId` label remains unchanged; the actual evidence/workspace locations above are the Qwen3.6 `-01` run. All original user work and provider data protected, no alternate model run and no retry.

## Scoped checks and code

Committed test harness (not production) `scripts/r5au-smoke-agent.mjs`, `src/test/r5auSmokeCalibrationAgent.tsx`, `src/test/r5auSmokeAgentAcceptance.tsx`, `src-tauri/examples/r5au_acceptance.rs`, `src/test/qwen36AcceptanceEnvironment.test.ts`. **Harness commit:** `080c05da058e98635640e3fc320a7f00064257d9`. `npm.cmd run check-types` **PASS**; `npm.cmd run build` for **Clack** **PASS** (existing Vite dynamic-import warnings); focused Vitest **11/11 PASS** (candidate identity, acceptance isolation, original mission equality, calibration/Channel and production Agent budget); Rust acceptance-host tests **6/6 PASS** (existing Rust dead-code warnings). These Clack checks are separate from the failed authored notes application tests/build. No generic Clack source defect or fix.

**STOP:** Qualification PASS, notes Agent mission FAIL (provider stream idle and unfinished application), no model-failure retry and no other model/ForgeBoard. R3d OPEN; P2–P19 mandatory/deferred.
