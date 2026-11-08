# ForgeBoard / Muse — one authorized live acceptance and frozen verdict (2026-11-08)

**Final classification: `FORGEBOARD INVALIDATED BY CLACK DEFECT`.** The single live Agent mission ended in a concrete, terminal Clack context-preparation **`compaction-timeout`**, rather than completing a fair uninterrupted application exercise. The subsequent **one** independent frozen evaluation produced **`FORGEBOARD_FAIL`** for the unfinished generated application. That independent product result is not a fair Muse/Agent execution failure, and it is not acceptance. **No second mission or evaluation is authorized or performed.**

## Run identity, qualification and isolation

- Starting HEAD: `7ad49499ca8bde760c22d6cf44515f381af27d0c` (`fix: align ForgeBoard acceptance harness with production contracts`).
- Exactly one new mission: `forgeboardmuse-20261108-01`, `mission-a 1`. Run window UTC: **2026-11-08 08:46:12–09:08:52**, about **22m40s**. Original ForgeBoard mission/correction text was unchanged.
- Only model: `muse-glimmer:30b`, exact digest `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`; Ollama **0.40.11**, reused approved local-only SSH forward at `127.0.0.1:11435` → `hylab@192.168.1.44:127.0.0.1:11434`. The previous approved tunnel was unavailable before launch and was restored using the existing strict-known-host, pinned identity. Operator settings/Ollama service and configuration were not changed.
- No hosted inference: **0**. Normal Automatic reasoning selection preserved the absent `think` field on native requests; no provider-control override or stream-idle timeout change.
- Initial production calibration **verified**, ID `763e6e8c-322b-4217-9638-c6d6a49a503c`. Actual requested/loaded successes at **4,096; 8,192; 16,384; 32,768; 49,152; 65,536; 73,728**. Highest initial trusted context **73,728**; current calibration, runtime epoch, loaded allocation and capacity/budget target checks passed.
- Genuine native tool proof **verified** at **73,728**, **32,768**, and **49,152**, all with the exact authorized digest. Initial/final runtime epoch `38896:1794127610123609500` matched; no untrusted 4K fallback. Agent native requests actually used **32,768** and **49,152** contexts.
- One safe-boundary calibration renewal completed: ID `d3844494-0010-489d-80c7-b3d9edfb85bd`, **verified**, highest **49,152**, same logical run and runtime epoch. Trace recorded **8** metadata-refresh start/end pairs and **8** runtime-inspection pairs; the count of *expiry-specific requested-context refreshes* cannot be independently isolated from these generic observations. Fresh verification and exact-tier pre-dispatch guards remained enabled.
- Acceptance-only WebView child inherited its established process-local graphics isolation. Production Clack, Muse, Ollama/model, host wiring and ordinary timeout policies were not altered.

## Agent execution and native provenance

| Metric | Observed result |
|---|---|
| Mission launches | **1**; host process exited **0**, but this only means durable report persistence |
| Agent terminal state | **failed**; run error is terminal `compaction-timeout` |
| Agent run budget | **28** total steps; **27** persisted `step-start` parts; **1** logical continuation |
| Native inference requests | **39**, unique IDs, native receive/settlement receipts **39/39 HTTP 200**, no receive failure code |
| Request phases | **12** not-Agent calibration/proof/renewal; **24** initial-batch; **3** logical-continuation |
| Request modes | **38** `stream=true`; **1** legitimate `stream=false` extraction |
| Genuine SDK-native tool calls | **27/27** unique IDs with persisted output-available results |
| Tool distribution | `write_file` **17**, `create_directory` **5**, `todo_write` **3**, `list_directory` **1**, `edit` **1** |
| Agent build/test execution | **0** shell/build/test invocations; no `bash_run` tool results; **1** authenticated `edit` tool call |
| Parser/transport | Parser observer installed, **0** parser failures; **39** client-stream completed receipts; no observed transport cancellation, HTTP failure or native retry |
| Cloud/hosted inference | **0** |

The native IPC requests and their real tool-result parts are preserved in the private run root; tool results are not inferred from Agent prose. There is no observed duplicated side-effect execution or orphaned tool-result ID in the persisted 27 results. The last Agent request was interrupted by Clack *after* a valid native extraction response, rather than by a speculative Ollama/transport fault.

## Corrected compaction wire path and terminal Clack defect

The committed host now preserves the actual serialized request mode. **`inference-39`** carried `muse-glimmer:30b`, `stream=false`, `num_ctx=49152`, `num_predict=1024`, absent `think` and **0** tool schemas. It passed the acceptance host, reached actual native HTTP, and returned **HTTP 200**, **2** receive chunks, **5,073** bytes and an `eof` receipt. The previous harness-only blanket-streaming rejection did **not** recur. No arbitrary unauthorized non-streaming tool request was admitted.

However the persisted original session `real-mission-a` is **`failed`** with:

- `error.errorCode = compaction-timeout`
- `error.title = Context preflight`
- `error.disposition = terminal`, `error.retryable = false`, `error.kind = bad_request`
- Exact user-facing error: **“Conversation preparation exceeded 120 seconds. Retry a bounded preparation batch. Original conversation history is unchanged.”**

This error originates in generic `src/modules/ai/lib/compactionExtraction.ts`'s per-preparation-batch timeout/check (not the native stream-idle transport timeout). The native response completed; the logical preparation did **not** commit a successful compacted memory revision or resume the Agent. **Completed compactions: 0; terminal attempted extraction: 1.** An on-wire completed HTTP request is not proof that extraction parsing, memory revision, target-context staging or continuation succeeded.

No persisted live compaction receipt establishes the exact current history-group count, protected/compactable groups, selected prefix, extracted claims, memory-revision identifier, target-context snapshot/key or post-compaction Agent continuation. Record these as **not established**; do not substitute earlier offline synthetic values. Persisted tool outputs and original source history remain for inspection, and the terminal error explicitly says the original conversation history is unchanged. Do not loosen protected-history rules, lengthen/change the runtime timeout, manually repair Clack, or replay this mission.

## 50 → 25 correction observer

The live correction observer was **enabled** (`CLACK_PRODUCT_SINGLE_SPEC` unset) and its durable checkpoint is present. It independently confirmed **18** accepted authored writes, above the threshold of three, but did **not** confirm a current active page-size-50 authored implementation or qualifying active plan. Hence the combined eligibility boundary is **false**; observer status remains **`pending`**, with **no correction dispatch** or message ID. This is correct non-dispatch under the original exact conjunctive rule, **not** a forcibly skipped correction. The generated app ended before a qualifying boundary emerged.

## Exactly one independent frozen evaluation

- Post-termination marker `independent-evaluation.started`: present once. Raw Agent workspace was frozen before testing. **15/15** ordinary generated file SHA-256 values match both the untouched source workspace and `evaluation-snapshot`. Installs, compilation and tests ran in independent `evaluation-working`, not in the original authored source.
- Evaluator verdict: **`FORGEBOARD_FAIL`**; **41** mandatory checks, **3** true (`stackReact`, `stackNodeTypeScript`, `noExternalModel`) and **38** false/unverified. A `false` functional check can mean *not exercised* because the runtime/build/route gate stopped; it is not evidence of a successful semantic probe with a failing HTTP assertion.
- Authored tests **0**, discovered tests **0**, passed **0**, failed assertions **0**; root, server and web test commands each exited **1** with **“No test files found”**. **Zero tests is FAIL.**
- Frontend TypeScript / production build **FAIL**, exit **2**: `web/src/main.tsx` imports nonexistent `./App` (`TS2307`). Backend TypeScript / production build **FAIL**, exit **2**: missing `cors` declarations (`TS7016`). Root build exit **2**. No completed frontend or backend production build, no verified backend startup, no usable frontend application runtime.
- Route discovery used actual authored route declarations, **not a hard-coded assumed prefix**. Detected project collection `/api/projects`, item `/api/projects/:id`, and task collection `/api/tasks`, item `/api/tasks/:id`, each with declared GET/POST/PATCH/DELETE CRUD shape. However required validation, association/filter semantics were not verified; complete contract **FAIL**. No qualified SSE endpoint was discovered (`events=null`), and persisted source did not satisfy evaluator persistence semantics. Names/method declarations alone are **not** accepted CRUD.
- Project create/list/read/update/delete **not verified**; task create/list/read/update/delete/association **not verified**. Validation, deterministic JSON errors, missing IDs, status, priority, tags, search, independent and combined filters, pagination/default size, restart persistence, SSE connection/event delivery **not verified** because the compiled backend/API gate did not pass. No claim of working behavior is made from source snippets.
- Frontend project/task/create/edit/search/filter/pagination/loading/error/empty-state workflows and accessibility baseline **FAIL / not verifiable** due missing React `App` and failed build. Required `README.md` and `.gitignore` both **absent**.
- The single evaluation was **not** rerun or supplemented with an improvised API probe. The generated source was **not** edited or repaired after mission termination.

## Evidence inventory (SHA-256)

All raw tool/model/native telemetry, isolated settings, original authored files, frozen snapshot and evaluator working copy remain **private and ignored** under `src-tauri/target/real-qwen-product/forgeboardmuse-20261108-01/`; only the report and run-scoped launcher/evaluator source are committed. Evidence paths below are relative to that private run root.

| Evidence | SHA-256 |
|---|---|
| `mission-a-1.json` | `811ba075deeb20299d4245da47160c042d2c021f89b8b7a51b9535752836b4d0` |
| `mission-a-1.native-report.json` | `85714f3dfd76620b3d405aebfdb0353bd79358b4c4c9f1940b49750952784156` |
| `mission-a-1.jsonl` | `550b844c77664bcc66ad940a7d36f59dd6408ae768bff02d363e3147a41d7993` |
| `mission-a-1.requests.jsonl` | `735138b15d123dc8078ba730b4609ca75fe1eacb5f761cc27206fd8517bbadf7` |
| `mission-a-1.receive.jsonl` | `9e5d83e7b523b421dbf02e060231eb664eec019cf941a1ab36c22b6c06ede701` |
| `mission-a-1.native-events.jsonl` | `fa8b3731539a2bc13a9a5e4d78504544c827b880f7260c2304e4994361cc7951` |
| `mission-a-1.native-inspection.jsonl` | `233457bb8d4446424a41864d1b688a83396cea39850b776d7417248a2c650824` |
| `mission-a-1.client-stream.jsonl` | `03852dff78ecc34520df18c0104df31008d2dd5f58b3d44c3d4c49a78341e3ea` |
| `mission-a-1.trust-timeline.jsonl` | `81f7d78b8a5193588a1131daeee276189261bed0f168c4cbb0bfcf6a09aa0b82` |
| `mission-a-1.parser-final.json` | `8eb0042056bba933210025d167c4908cbbad2a47de7b659160861239c131ec52` |
| `correction-state.json` | `98639502f2f18512c30cc32b1644ba6d9bb9f8e83a55310ccaf012b3af6be992` |
| `data/terax-ai-sessions.json` | `83c9682d19f4cb105420811541c932a2addf231438cec4732007918baaa8f8f5` |
| `independent-evaluation.started` | `d9aaf982a0a1d333001a2cacf9e28de1ab03ee7a4d635cff6d93d13433769e9f` |
| `independent-evaluation.json` | `57998730cfba6221f751013a0efafa60384b91738557b9b6058ddae3d632c562` |
| `diagnostic-tunnel.json` | `98bfce89097d0d233eb3adadc153524345f74f11eaea49a0c73e4afb6b282d1a` |

## Baseline preservation and stop rule

Six original protected dirty tracked files remain untouched, unstaged and byte-identical to the durable source hashes in `docs/CLACK_FORGEBOARD_MUSE_SINGLE_RUN_2026-11-06.md`: `docs/REAL_LOCAL_MODEL_ACCEPTANCE.md`, `scripts/acceptance-approval.mjs`, `scripts/check-real-local-product.mjs`, `src-tauri/examples/coworking_acceptance.rs`, `src/test/acceptanceComparison.test.ts`, `src/test/realLocalProductAcceptance.tsx`. Both preexisting stashes, `autonomous_tracker`, operator settings (SHA-256 `E66F05DB23AD21ADC7F48E18228A50AA8C32D1C0AC6715FEE1BDDDAF784D3EEC`), and historical Muse/ForgeBoard evidence are preserved. Historical 2026-11-06 and 2026-11-07 reported archive checksums were independently rechecked with **19/19** matches. No reset, clean, stash, amend, push, notes acceptance, alternate model, hosted fallback, second ForgeBoard mission, second evaluation, timeout change, source repair or P2–P19.

**Final verdict: `FORGEBOARD INVALIDATED BY CLACK DEFECT`.** Freeze and stop. The sealed corrections successfully allowed native non-streaming extraction but did **not** establish an end-to-end successful compaction, memory revision or Agent continuation. The unfinished frozen product separately fails mandatory application gates. The two new `scripts/forgeboard-muse-instrumented-{one,freeze}-20261108.mjs` run-scoped copies preserve reproducible harness provenance; their presence does **not** authorize replay.
