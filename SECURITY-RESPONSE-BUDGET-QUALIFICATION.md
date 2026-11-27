# Narrow security response-budget and compatibility qualification

Status: focused transport and compatibility evidence; not full CI or TF4 acceptance.

## Native transport boundary

The native inference path uses `reqwest 0.12.28`. `execute` obtains `Response::bytes_stream()` and accounts each actual body chunk with `ResponseByteBudget::account` before emitting that chunk over the native channel. There is no `Content-Length`-only enforcement path: declared length, absent length, and HTTP chunked transfer all reach the same cumulative counter. The counter uses checked addition and rejects the first byte above `16 * 1024 * 1024` without advancing its observed count.

Four production-path tests use the existing local TCP server fixture, paced separate writes, and the actual `execute_admitted`/`execute`/reqwest path:

| Test | Result | Evidence |
| --- | --- | --- |
| `native_response_budget_accepts_exact_limit_from_real_http_body` | Pass | Exactly 16 MiB is delivered and accepted |
| `native_response_budget_rejects_first_byte_over_limit_and_emits_no_overflow_chunk` | Pass | 16 MiB + 1 returns `response-too-large`; no chunk beyond the ceiling is emitted |
| `native_response_budget_applies_to_chunked_body_without_content_length` | Pass | HTTP chunked transfer, no `Content-Length`, cumulative body accounting rejects over-limit |
| `native_response_budget_also_bounds_oversized_error_bodies` | Pass | HTTP 502 body is bounded and returns `response-too-large` |
| `oversized_native_response_delivers_one_truthful_failed_terminal` | Pass | The one-shot production terminal-delivery helper emits exactly one `Settled` event with `phase=Failed` and `error.code=response-too-large` |

The fixture keeps the peer connection open with heartbeat writes. Completion of each transport test requires the fixture to observe the client-side socket close, rather than having the server close the socket first. The test also drops the native lease and asserts the request registry is empty. This verifies body-stream disposal, transport closure, and native request ownership release on both success and overflow.

`ai_http_stream` maps the returned failure through `terminal`, drops the lease, and calls the `FnOnce` terminal-delivery helper once with the original Tauri Channel sender. The helper test asserts exactly one `Payload::Settled` event with both the failed phase and truthful `response-too-large` code. The frontend regression verifies that an overflow after partial tool-input deltas emits an error, emits no completed `tool-call`, and invokes the model stream only once. The existing frontend error classifier treats `response-too-large` as non-retryable. The transport tests exercise `execute_admitted`; the sender is the actual production Tauri Channel callback, but a full Webview runtime harness was not started.

Native inference currently enables Rustls and streaming for reqwest 0.12.28, but not gzip, brotli, zstd, or deflate decompression. Consequently there is no native decoded-compressed-body path to qualify today; compressed-body support is not claimed. The JavaScript `verifiedProviderFetch` path does use the platform fetch implementation, which decompresses gzip. A new local HTTP integration regression serves a tiny gzip body that expands to 16 MiB + 1; the real fetch path rejects it as `response-too-large`, proving that decoded bytes, not compressed wire size, are counted where decompression is supported. If native decompression is enabled later, the same limit must be tested against native decoded bytes.

## Why 16 MiB; measured compatibility fixtures

The limit is a per-HTTP-response byte ceiling, not an aggregate token or memory budget. It is deliberately well above the bounded ordinary answer/tool outputs and the measured controlled fixtures below. These are deterministic representative protocol fixtures, not captured production-provider traffic:

| Supported response class | Fixture shape | Encoded response bytes | Share of 16 MiB |
| --- | --- | ---: | ---: |
| Long-context inference | OpenAI-compatible completion envelope; 65,536-character answer | 65,623 B | 0.391% |
| Reasoning stream | 16 SSE reasoning deltas totalling 65,536 characters | 66,640 B | 0.397% |
| Structured tool call | SSE function call with a 262,104-character JSON argument payload | 262,318 B | 1.564% |
| Speech transcription | Plain-text transcription, approximately 1 MiB | 1,048,580 B | 6.250% |
| Local-model JSON | Ollama-style JSON completion; 65,536-character response | 65,581 B | 0.391% |
| Local-model NDJSON | 16 newline-delimited response frames totalling 65,536 characters | 66,031 B | 0.394% |

The 16 MiB ceiling is 16 times the 1 MiB transcription fixture, about 64 times the structured-tool argument fixture, and about 256 times a 64 KiB token-bounded completion envelope. The exact-limit and first-byte-over integration tests establish the boundary itself. No authorized live provider response was available or needed for this controlled-fixture qualification; the measurements should not be described as provider telemetry.

### Distinct budgets and memory behavior

- **Per response:** 16 MiB, applied independently to each provider HTTP body in both the native bridge and `verifiedProviderFetch`.
- **Aggregate answer continuation:** separate controls are 16,384 generated tokens, at most three continuations, 120 seconds, 1,048,576 answer characters, 262,144 tool-input characters, and 256 segments. The per-response byte ceiling does not replace these limits; a continuation sequence is constrained by its aggregate token/time/character/run budgets.
- **Multi-agent:** each Agent derives its output reserve from captured model/context limits; continuation checks the shared `remaining()` run budget. Each provider response is still separately byte-bounded. The 16 MiB response limit is not a shared multi-agent aggregate quota.
- **Memory:** the native transport streams `Bytes` chunks and copies only the current chunk into the IPC payload; it does not assemble the whole response into one native buffer. The frontend limiter also streams and cancels the reader on overflow. Speech transcription calls `Response.text()`, so it may materialize the full bounded response (up to 16 MiB) in memory. The response-byte ceiling is therefore not a process-wide RAM ceiling: concurrent requests and downstream parsers add memory, and admission capacity is a separate control.

### Failure and retry behavior

Overflow fails closed as `response-too-large`. The native body stream is dropped on the early return; the fixture observes the connection close. The frontend emits a terminal error rather than treating the truncated body as a valid provider response. Partial tool arguments remain quarantined and cannot become an executable tool call. The focused continuation test asserts only one model-stream invocation after overflow; no retry or continuation is started. Oversized error bodies use the same byte boundary as success bodies.

## Streamdown 2.8.1 compatibility

The current chat `MessageResponse` and workspace preview both render through Streamdown 2.8.1. Focused regressions now cover both surfaces for GFM tables, strikethrough, fenced code, and safe external-link affordances. Workspace preview additionally verifies that a valid relative image is converted to the workspace asset URL while `../../secret.png` is blocked. Existing tests cover HTML/script/event-handler sanitization, unsafe URL rejection, and context-action URL restrictions. A streaming-mode regression keeps incomplete Markdown and an unfinished code fence readable while content is arriving.

The prior lockfile used Streamdown 2.5.0. Its README exposed Mermaid and math as opt-in plugin capabilities; the application chat and workspace components did not pass plugin activation, and the app did not depend on the math plugin. The prior presence of Mermaid as a transitive package is not evidence that the app rendered diagrams. Source inspection therefore found no active pre-upgrade diagram or math rendering on either surface. The current negative regression confirms Mermaid fences remain code and `$x^2$` remains literal text unless a plugin is deliberately enabled. No previously enabled diagram/math feature was found to remove.

## Provider runtime compatibility

The installed tree has direct `@ai-sdk/provider 3.0.10` and nested `@ai-sdk/provider 3.0.12` under `@ai-sdk/provider-utils 4.0.33`. The two provider runtime ESM files have the same SHA-256 digest and the same exported runtime symbol set. Cross-version `APICallError.isInstance`, `JSONParseError.isInstance`, and `TypeValidationError.isInstance` checks succeeded in both directions. The only declaration difference observed is the additive `VideoModelV3CallOptions.generateAudio` option in 3.0.12; provider-utils 4.0.33 does not reference it. The language-model schema, structured tool-call, error-classification, and streaming runtime contracts examined are unchanged. This supports retaining the narrow provider-utils override; it does not justify the rejected broad AI SDK upgrade.

## Baseline identity comparison

The retained candidate full-suite log reports 30 failing files / 23 failing tests (4,712 passed, 13 skipped). The retained main baseline reports 32 failing files / 26 failing tests (4,697 passed, 13 skipped). The candidate's 23 failure identities and diagnostic classes are present in the main baseline; the main baseline additionally has two `agentRequestFailureRecovery.integration` failures and one `agentCompaction.integration` timeout. The earlier broad dependency-qualification log reports 35 failing files / 31 failing tests. The shared failures include missing preserved Muse and native-report fixtures (`ENOENT`), the pinned fresh-context hash mismatch, eager-budget imports of `tfOperations.ts`, structured-memory-schema extraction failures, missing LM11 T01 before-hash input, and the four real-world acceptance cases without their required external state. These are inherited/environmental failures, not new response-budget or Markdown regression failures. The focused tests and typecheck listed below were rerun after the new regressions; the complete frontend suite was not rerun and is not green.

## Validation performed in this continuation

- Native response-budget integration: 4 passed; one-shot terminal-delivery test: 1 passed.
- Full inference transport module tests: 55 passed before the terminal-delivery helper was added; the four response-budget cases and terminal helper were also rerun individually and passed.
- Focused frontend tests: 149 passed across continuation, proxy fetch, STT, Markdown security, workspace image policy, Markdown context actions, and the real gzip-decoding fetch fixture.
- TypeScript: `npm run check-types` passed.
- Targeted Biome lint for the changed frontend test files passed.
- Rust `rustfmt --check` for the new `response_budget.rs` passed.
- Strict crate Clippy (`-D warnings`) is blocked by 23 existing diagnostics in unrelated modules (including dead code, `conversation_memory`, `hardware_profile`, `managed_local_runtime`, `self_hosted_profiles`, `shell`, `tf_command`, and `tf_operations`); no diagnostic was emitted for the changed inference transport files.
- Whole-crate `cargo fmt --check` is not clean because existing formatting drift spans unrelated and pre-existing inference files. The files were not globally reformatted to avoid unrelated churn.

This qualification does not complete the thirteen canonical TF4 gates, physical lifecycle cases 10–11, the seventeen-step installed E2E, or Product-wide UI/UX Polish & Acceptance. No merge, executable installation, Defender change, quarantine restoration, or active-TF4 source transplant was performed.

## Resumed qualification: 2026-11-27 evening

This section records **freshly executed** commands and results after the earlier qualification checkpoint. The preserved candidate remains a dirty detached worktree at `00769bf19fd7096a928cc246d8f8c9f474dbbddb`; the separate clean main baseline is `dddab1b9c4f035362c754c5111a39e3c209178a4`. No commit, branch, PR, merge, installation, or release was performed.

- Native production-source module suite: `cargo test --manifest-path src-tauri/Cargo.toml --lib modules::net::inference:: -- --nocapture` **exit 0, 82 passed, 0 failed**. This includes the four real-HTTP 16 MiB response-boundary cases, the truthful one-shot `response-too-large` settlement, and a genuine 61-second self-hosted idle/resume case. `response_budget.rs` separately passes `rustfmt --edition 2021 --check --config skip_children=true`.
- JavaScript/Markdown focused run: `npm exec -- vitest run src/modules/ai/lib/transport.errors.test.ts src/modules/ai/lib/transport.eligibility.test.ts src/modules/ai/lib/stt.test.ts src/modules/ai/lib/answerContinuation.test.ts src/modules/ai/lib/proxyFetch.test.ts src/modules/markdown/lib/markdownSecurity.test.tsx src/modules/markdown/lib/contextActions.test.ts` **exit 0, 7 files and 142/142 tests passed**. It includes real HTTP gzip decoded-byte expansion beyond 16 MiB, over-limit error/stream responses, cancellation and partial tool-call quarantine. `npm run check-types` and changed frontend Biome lint passed.
- **Additional narrowly verified STT redirect fix:** a real loopback Whisper.cpp fixture demonstrated that a 307 redirect followed by fetch could forward the audio POST to a second server (RED test). The Whisper.cpp request now uses `redirect: "error"`; real 307 and 308 two-server regressions both pass, preventing this audio-forwarding path. Existing provider response byte bounding remains in place.
- **Additional narrowly verified Markdown image fix:** before correction, user-authored `asset://localhost`, `http://asset.localhost` or `https://asset.localhost` image sources could bypass the workspace image resolver; the Tauri asset scope is broad (`**`). Three new SSR regressions failed before the correction and pass afterward. The rehype image rewrite now rejects *authored* preconverted local asset URLs before conversion while preserving workspace-relative image conversion. The application-wide asset protocol scope is not changed; no installed WebView runtime acceptance is claimed.
- Full candidate frontend suite, after corrections: `npm exec -- vitest run --exclude src-tauri/target/**` **exit 1**, logged in `security-qualification-full-vitest-20261127.log`: **24 failed / 4,721 passed / 13 skipped**, 31 failed files. The previous candidate retained `full-test-final.log` had 23 failed / 4,712 passed / 13 skipped. The one additional failure identity in the fresh run is the 15-second `agentCompaction.integration.test.ts` context-switch timeout, which also appears in clean-main baseline `../security-main-baseline-20261127/test.log` (26 failures). This is an inherited, intermittent full-suite blocker, not evidence of a new security regression; the full suite is **not green**.
- Production frontend build: `npm run build` **exit 0**, logged in `security-qualification-build-20261127.log` (`built in 22.17s`; bundler emitted nonfatal dynamic-import/plugin-timing notices).
- Exact strict native quality command: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` **exit 101**, with 22 library errors and 23 library-test errors in unchanged `conversation_memory`, `hardware_profile`, `managed_local_runtime`, `self_hosted_profiles`, `shell`, `tf_command` and `tf_operations` modules; no changed inference transport source diagnostic. These totals also agree with retained fingerprint diagnostics. Independent `--lib` strict Clippy also failed with 22 unchanged-module errors. Full strict Clippy on a freshly built *clean main* target was not executed and is not represented as an observed baseline pass or failure.
- `cargo fmt --check` (within `src-tauri`) **exit 1 on both clean main and candidate**; the same 55 file paths are flagged, with zero candidate-only paths. This path-level comparison does not prove identical formatting hunks. The new standalone response-budget file is format-clean. `git diff --check` **exit 0** (line-ending warnings only).
- Lockfile reconciliation: Streamdown `2.5.0` to exact `2.8.1` removes its former Mermaid transitive dependency; the candidate lockfile removes 108 packages, primarily the unneeded Mermaid/D3/KaTeX/DOMPurify dependency graph, and adds one nested `@ai-sdk/provider@3.0.12` under fixed `@ai-sdk/provider-utils@4.0.33`. `npm ls` confirms these runtime versions. This was inspected without reinstalling packages; lockfile regeneration/reproducibility via an install command was **not** performed.

## Separately authorized locked-install and production-audit qualification

The later approval authorized a **fresh locked dependency installation in an isolated qualification directory only**. At `outputs/security-locked-ci-20261127-qualification`, copies of the candidate `package.json` and `package-lock.json` were SHA-256 identical to the source manifests before installation (package.json `224CAED2D01639F7FBE9673946A518FF20918DA0FEB27074F21936CDDD2B9EC2`; lockfile `AB909FE1A444B666CA54DB39197156FFE4603D4E08741C87F8AD757E3AA7B24A`).

- `npm ci --ignore-scripts --no-fund --no-audit --prefer-offline` **exit 0**; 899 installed packages. Package lifecycle scripts were not executed, and neither the Clack candidate nor any executable was installed/replaced. Installation log: `npm-ci-qualified.log` in that isolated directory.
- Fresh installed dependency tree: `npm ls streamdown @ai-sdk/provider-utils @ai-sdk/provider --all --depth=2` **exit 0**. Verified Streamdown **2.8.1**, `@ai-sdk/provider-utils` **4.0.33**, direct `@ai-sdk/provider` **3.0.10**, and provider-utils-nested `@ai-sdk/provider` **3.0.12**. Lockfile contains 1,063 entries including root; the installed graph excludes Mermaid, KaTeX and DOMPurify.
- `npm audit --omit=dev --json` **exit 0**, with **0 info, 0 low, 0 moderate, 0 high, 0 critical, 0 total** vulnerabilities; production dependencies 310; total dependency metadata 1,062. The raw PowerShell redirected JSON is UTF-16LE; `audit-production-fresh-utf8-20261127.json` preserves an equivalent parsed UTF-8 audit record. The earlier `audit-production-final.json` also reported zero findings; this independent fresh locked-install audit corroborates it.
- The separate baseline/CI remediation workstream and integration ordering are documented in `docs/SECURITY_PROTECTED_MAIN_REPAIR_PLAN_2026-11-27.md`. It does not modify protected main or waive mandatory checks.

## Clean-main strict Clippy and formatting equivalence

After the explicit Draft PR preparation authorization, the clean main baseline `dddab1b9c4f035362c754c5111a39e3c209178a4` was checked with an **isolated Cargo output target**, `outputs/security-main-strict-clippy-20261127-target`, avoiding changes in its clean Git worktree. From its `src-tauri` directory, `cargo clippy --all-targets --locked --message-format=json -- -D warnings` returned **exit 101**; retained diagnostics are `outputs/security-main-strict-clippy-20261127.jsonl` and `.stderr.log`. There were **22 library and 23 test-library diagnostics** in unchanged source. The candidate's same-profile diagnostics are preserved in its `src-tauri/target/debug/.fingerprint/clack-*/output-{lib,test-lib}-terax_lib` artifacts. This is a *real fresh strict baseline execution*, not an inference from file paths or error counts.

The full per-diagnostic comparison normalized each primary error's **relative source file, exact line, lint code, and complete message**, comparing independently compiled main against candidate's actual 23:01 compiler fingerprint JSONL. **45/45 diagnostic identities matched exactly; zero candidate-only and zero main-only.** The individual inherited identities (x2 means library and library-test, x1 one target) are:

| File | Line / lint identity (target counts) |
| --- | --- |
| `conversation_memory.rs` | 517 `needless_range_loop` x2; 775 `partialeq_to_none` x2 |
| `hardware_profile.rs` | 129 `manual_is_multiple_of` x2; 168 `manual_range_contains` x2; 206 `type_complexity` x2; 553 `bool_assert_comparison` x1 |
| `managed_local_runtime.rs` | 400 `manual_range_patterns` x2; 1011, 1078, 1089 `cmp_owned` x2 each; 1979 `trim_split_whitespace` x2; 1985 `double_ended_iterator_last` x2; 3236 `field_reassign_with_default` x1 |
| `self_hosted_profiles.rs` | 40 `suspicious_open_options` x2; 124 `collapsible_if` x2; 403 `dead_code` x1; 435 and 436 `nonminimal_bool` x2 each |
| `shell/mod.rs` | 133 `dead_code` x1; 142 `dead_code` x1; 701 `format_in_format_args` x1 and `useless_format` x1 |
| `tf_command.rs` | 540 `too_many_arguments` x2; 590 `too_many_arguments` x2 |
| `tf_operations.rs` | 1115 `nonminimal_bool` x2; 1212 `too_many_arguments` x2 |

The full retained formatting output is at `outputs/security-main-fmt-check-20261127.log` and `outputs/security-candidate-fmt-check-20261127.log`. Of 1,356 full hunk bodies in each, 1,353 are byte-identical. The remaining three differences have **the same existing rustfmt correction**, differing only in adjacent/new code context and shifted line numbers. They are `inference/mod.rs` at candidate lines 1, 11, 929 corresponding to main lines 1, 11, 906. Thus **zero candidate-introduced formatting transformations** were identified. The clean-main Git worktree remained clean; no unrelated files were reformatted or changed.

Formatting was checked through whole-crate `cargo fmt --all -- --check` on clean main and candidate: both exit 1 with **1,356 formatting hunks** each. A hunk-level comparison found only three mismatched hunk contexts, all in `src/modules/net/inference/mod.rs` around imports and the pre-existing compact `else { None }` expression. The added response-budget imports, new terminal helper and shifted line positions explain context differences; there is no candidate-specific actionable formatting drift in the newly added inference Rust code. `tests.rs` existing formatting hunks match main, and the new `response_budget.rs` individually passes rustfmt. **No bulk formatting or cosmetic change was applied** to this security candidate; inherited whole-crate formatting must be repaired separately.

## Bounded application-wide Tauri asset authority audit (separate workstream)

Source-only review against both the isolated security candidate and the current TF4 checkout finds the same `src-tauri/tauri.conf.json:27-32` asset protocol scope `["**"]`, with asset/asset.localhost image, media and frame CSP allowances. `src-tauri/Cargo.toml` enables Tauri's `protocol-asset`. **The protocol scope, not `convertFileSrc`, governs native file serving; conversion alone is not access authorization.** The Markdown authored-asset bypass fixed above is one reachable rendering-path policy defect, not an application-wide asset authority repair.

- **Workspace Markdown:** `MarkdownPreviewPane.tsx` now blocks authored asset-localhost image URLs in its rehype traversal. `imagePolicy.ts` validates ordinary local Markdown image paths using lexical normalization and root-prefix checks, but does **not** canonicalize symlinks or junctions before conversion. Markdown rendering through this component requires the passed `workspaceRoot`; Markdown's HTTP(S) remote image policy is separate.
- **Editor previews:** `src/modules/editor/EditorPane.tsx` uses `convertFileSrc` for images, audio, video and PDF iframe tabs; it relies on editor/tab provenance and does not perform a separate canonical workspace-root check at the conversion point. Legitimate user-opened external files must be preserved.
- **Chat and other surfaces:** `AiChat.tsx` renders some response content through generic Streamdown/MessageResponse rather than the workspace-specific image resolver; `PreviewAddressBar.tsx` recognizes the asset scheme and `PreviewPane.tsx` uses a sandboxed URL iframe. These are separate application entry points that need their own authority evaluation. Existing attachment-chip previews generally use blob/object URLs instead of `convertFileSrc`.
- **Native authority contrast:** `src-tauri/src/modules/fs/file.rs` enforces a 10 MiB bound for the separate `fs_read_file` command, and attachment file authorization canonicalizes paths against a registry. Those are **not** controls on the global Tauri asset protocol.

**Risk boundary:** A broad asset protocol glob can make additional OS-readable paths available to application WebViews, subject to actual Tauri/platform glob, origin/CSP and OS access rules. The observed SSR Markdown bypass was real at the rendered URL level, but there is **no verified native WebView plaintext read/exfiltration exploit** in this qualification. Neither universal OS-file reachability nor an unauthenticated remote HTTP file server is claimed.

**Separate security correction proposed, not included here:** Design central native asset authority tied to canonical/symlink-safe workspace roots and explicit user-approved external file grants; use bounded lifetimes, MIME/size policies and shared source checking for Markdown, editor, chat and preview. Scope the asset protocol down only after tracing all legitimate consumers and physical cross-platform WebView tests (including link/iframe, redirects, CSP, symlinks/junctions and cancellation). Do **not** globally disable local assets or broaden this Draft PR with unqualified protocol refactoring.

**Decision:** native response-size/terminal, focused JS/Markdown transport, STT redirect and local-image hardening are qualified at the source/integration-test level. The strict baseline/adoption gate remains **closed** because whole-crate formatting, strict Clippy and the full frontend suite are not green; physical TF4/LM11 and installed E2E requirements remain separate and incomplete. PR #47 remains Zod-only; security hardening belongs in a separate gated Draft PR only after authorization and required checks. Do not transplant this candidate wholesale into the live TF4 branch.

## Source-level integration review against current TF4

The current TF4 worktree is `/clack` on `tf/browser-computer-use` at `c30531b275e8a6fa04bdb32dd4a8040b5064343a` (PR #46 head). The isolated security candidate is detached at `00769bf19fd7096a928cc246d8f8c9f474dbbddb`, which is PR #47's Zod-only head. Protected `main` and `origin/main` both remain `dddab1b9c4f035362c754c5111a39e3c209178a4`.

The source comparison found additive integration seams, but the candidate must not be copied wholesale into the TF4 worktree:

- **Native inference:** the current TF4 `mod.rs` has the same response-body loop and terminal/lease lifecycle as the candidate. The candidate's native change is the six-line `ResponseByteBudget` import/initialization/accounting insertion immediately after `bytes_stream()` is acquired and before parser/progress delivery. This can be carried as a narrow hunk while preserving TF4's acceptance-only cancellation/fault instrumentation and terminal delivery.
- **Answer continuation:** TF4 already has its completion scanner, passive answer observation, watchdog and stream-failure handling. The candidate adds a streaming byte-limiter around the provider fetch response before status/body handling. Integration should add that wrapper to the current fetch path, not replace the TF4 scanner, observer or watchdog implementation.
- **Error classification:** add the single `response-too-large` transport classification to the current TF4 error map; preserve all TF4-specific native/browser rejection and diagnostic classifications.
- **Speech transcription:** the candidate routes existing provider fetches through `verifiedProviderFetch`. Apply that wrapper to the current provider paths while preserving provider authentication, deadlines, local/loopback constraints and TF4 request ownership.
- **Workspace Markdown:** current TF4 already contains the workspace image-policy resolver, blocked-image rendering, context actions and UI. The candidate factors URL-transform and rehype-plugin construction into exported helpers and adds regression coverage. Preserve the current preview UI and context-menu behavior; do not replace the component wholesale.
- **Browser authorization and operator panel:** no candidate file modifies either surface. No source overlap was found in those areas.
- **Dependencies:** the candidate changes Streamdown to 2.8.1 and narrows the provider-utils override while inheriting Zod 4.6.6 from PR #47. It does not change the AI SDK package family to the rejected broad upgrade. The Rust manifest change in the current TF4 branch (browser-host features/dependencies) is not modified by the candidate and must remain intact.

Integration conclusion: the security changes are source-compatible in principle, but the security branch should remain based on PR #47's Zod correction and be reviewed as a separate Draft PR. Any later TF4 adoption must selectively reapply the small native/body-limit/error-map/STT/Markdown hunks against the then-current TF4 sources. No cherry-pick, rebase, merge or source transplant into TF4 was performed in this qualification.

## Post-qualification Draft PR packaging record

After the user separately authorized branch creation, focused commits, push and **Draft** PR preparation (without a mandatory CI waiver), the qualified candidate was packaged as `security/response-budget-hardening-20261127`, directly parented on the unchanged exact PR #47 head `00769bf19fd7096a928cc246d8f8c9f474dbbddb`. The focused source commit is `c484a61d66df9baf6720df87b030693330995342`; the external review artifact is **Draft PR #48**, <https://github.com/hyvvs/clack-ide/pull/48>, with base `security/zod-4.6.6-ghsa-20261127`, not `main`.

The commit adds exactly **16 whitelisted paths**, including `response_budget.rs`, `stt.test.ts`, `markdownSecurity.test.tsx`, this qualification report and the protected-main repair plan. The staging check found **0 missing and 0 unexpected paths**, and staged `git diff --check` passed. Untracked executable/PDB files, npm audit JSON snapshots and temporary test/build logs were **not committed**, and remain separately preserved in the qualification/output directories. Existing PR #46 and PR #47 remained open and Draft at remote verification; protected-main and the clean-main baseline were not changed. The historical statements above that no branch/PR had been created refer to the earlier qualification phase; this section records the subsequently authorized packaging.

**Draft is not CI clearance:** All baseline quality, TF4, installed WebView, executable adjudication and release/acceptance restrictions above remain effective. No Ready-for-Review transition, merge, installed app change, executable execution or production release occurred.
