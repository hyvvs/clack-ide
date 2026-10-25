# Single authorized GLM 73,728 live validation — runtime allocation succeeds, native persistence gate rejects

**Starting HEAD:** `da5d914edb2243ed7ef54e69b74a76077f841129` (2026-10-25). This investigation used **exactly one** new isolated WebView diagnostic with real production calibration, not the original notes acceptance mission. It did not test another model, start ForgeBoard, change provider settings or timeouts, or rerun an inference after discovering the failed gate. A successful 73,728 Agent/native-tool proof is **not established**.

## Frozen live identity and exclusive source evidence

- Ollama loopback `127.0.0.1:11435`, existing original SSH tunnel, model `glm-4.7-flash:q4_K_M`.
- Live `/api/version`: `0.40.11`; `/api/tags`: **15** installed models, exact GLM digest `4475827791a269b02c8ec49b1c3bc1abb5846bacf3fae015b75d33986322d8f6`.
- New exclusive root `src-tauri/target/glm47flash-73728-live-20261025-01/`; script `scripts/r5bc-glm-73728-live.mjs`; WebView source `src/test/r5bcGlm73728Live.ts`. Both used a **new copy** of the SHA-256-protected original Automatic settings and a separate empty Git workspace. Prior diagnostics and frozen notes evidence were not changed.
- Preserved native request metadata in `stream-diagnostic-tier-73k.requests.jsonl`, native receive/settlement in `stream-diagnostic-tier-73k.receive.jsonl`, WebView stages in `timeline.jsonl`, hardware samples in `hardware-observations.jsonl`, and stop outcome in `browser-report.json` / `final-evidence.json`. Logs contain redacted request shape, not the prompts or tool arguments. Read-only remote `journalctl` confirms the runner's actual allocations.

## Seven requests, actual allocation, and fail-closed boundary

| Native request | Requested `num_ctx` | `num_predict` | Native schemas | Observed result |
| --- | ---: | ---: | ---: | --- |
| `inference-1` | 4,096 | 32 | 0 | exact requested/loaded, persisted success, `finish=length` |
| `inference-2` | 8,192 | 32 | 0 | exact requested/loaded, persisted success, `finish=length` |
| `inference-3` | 16,384 | 32 | 0 | exact requested/loaded, persisted success, `finish=length` |
| `inference-4` | 32,768 | 32 | 0 | exact requested/loaded, persisted success, `finish=length` |
| `inference-5` | 49,152 | 32 | 0 | exact requested/loaded, persisted success, `finish=length` |
| `inference-6` | 65,536 | 32 | 0 | exact requested/loaded, persisted success, `finish=length` |
| **`inference-7`** | **73,728** | **32** | **0** | **actual Ollama allocation + completed native transport, but Clack rejected persistence of the 73K calibration record** |

For `inference-7`, the native trace records `provider-done`, forwarded completion, `eof`, `completed`; SDK `sdk-consume-end`, `sdk-finish-end`, metadata refresh, and runtime inspection also completed. The separate live probe evidence saved in the isolated settings shows `probe.requestedContext=73728` **measured/observed**, `probe.loadedContext=73728` **backend-reported**, and fresh `probe.runtimeAllocation` tied to the correct digest. Ollama `/api/ps` independently reports `context_length=73728`. The WebView had not yet published a final `calibration-commit-and-progress` for this tier when native Tauri persistence rejected it. Its saved calibration record remains at `status=verifying`, `highest=65536`, **six** successful attempts. The fallback diagnostic report says `blocked`; its caught Tauri IPC rejection was a non-`Error` and the harness reported `errorKind=unknown`, not a completed calibrated 73K outcome.

**Root cause (verified source invariant):** `src-tauri/src/modules/self_hosted_profiles.rs:validate()` still enforced a **65,536** maximum for every persisted calibration `highest`, `failedNext`, and `attempt.context`, and separately allowed at most **seven** attempts. The previous TypeScript production change had raised its matching policy to **73,728** and **eight** (seven upward candidates plus one possible restore). Thus the genuine, exact 73K measurement passed frontend calibration acquisition but failed the native compare-and-swap settings validation; the sixth saved record survived unchanged. This is a generic native/TypeScript policy mismatch, **not** an Ollama capacity failure or an unsupported allocation. The seven-attempt Rust guard did not cause the seventh probe to fail, but would incorrectly reject the eighth bounded restore opportunity.

The scope's native runtime epoch was `8096:1792955037136333700`, provider version `0.40.11`, and digest exactly as above. No runtime timeout, capacity allocation failure, transport EOF failure, or cancellation explains this stop.

## Actual hardware allocation at 73,728

Read-only Ollama `/api/ps`, NVIDIA, Linux `/proc/vmstat`/`free -m`, and `journalctl` gathered during the **same single run**:

| Observation | At loaded 73,728 |
| --- | --- |
| Device | RTX 4060 Ti, NVIDIA reported total **16,380 MiB** |
| `/api/ps` size | **15,671,031,232 bytes** |
| `/api/ps` size_vram | **15,399,701,708 bytes** (difference ~259 MiB of reported non-VRAM size) |
| NVIDIA physical VRAM | **14,980 MiB used, ~1,030 MiB free** at the terminal observation; GPU process ~14,840 MiB |
| Model-layer offload | **48/48 layers to GPU**, including output layer; no model layers left to CPU processing per runner log; CPU-mapped model buffers do exist |
| CUDA0 model buffer | **10,591.79 MiB** |
| CUDA0 f16 KV buffer | **3,807.00 MiB**, **73,728 cells**, 47 layers, 1 slot; llama.cpp reports K (f16) 3,807 MiB, V (f16) 0 MiB |
| CUDA0 compute buffer | **287.51 MiB**; CUDA host compute buffer **88.01 MiB**, output buffer ~0.59 MiB |
| Runner fit | `common_params_fit_impl: context size set by user to 73728 -> no change`; `n_ctx=73728`, one slot, 48/48 GPU offload |
| System RAM | 31,696 MiB total, 28,850 MiB available at terminal sample (28,810 immediately after), with 2,845–2,885 MiB shown used |
| Swap | 939 MiB used **already before the run** and unchanged in samples; `pswpin=37596`, `pswpout=318748` unchanged, **zero sampled new swap paging** |

These measurements establish physical runtime allocation for a **tiny calibration prompt**, not full 55,496-token history prefill, sustained 73K Agent context, native tool performance, or guaranteed room for other simultaneous GPU processes. Measured KV agrees with the offline +423 MiB estimate over 65K. No speed penalty or full-context throughput can be inferred from these tiny 32-token-output probes.

## Follow-on gates — deliberately not attempted

- Trusted production 73,728 calibration: **FAIL** (native persisted-settings validator, despite the successful runtime allocation).
- Genuine exact-tier native-tool verification at 73,728: **NOT ATTEMPTED**. Zero verifier tool schemas on all seven requests; there is no valid 73,728 proof, and no 65K proof was inherited.
- One read-only 73,728 Agent request: **NOT ATTEMPTED**. No selected tier, `num_predict`, or Agent result exists for this run. No notes app, other model, or ForgeBoard inference.
- Production status: **73,728 still UNTRUSTED / NOT LIVE VERIFIED**. A separate later authorization would be needed to attempt post-fix qualification and exact-tier tools.

## Independently justified generic fix and offline regressions

`src-tauri/src/modules/self_hosted_profiles.rs` now validates bounded calibration tokens through **73,728** and up to **eight** attempt records, retaining full record ownership, loaded=requested checks, exact source identity, all other limits and persisted-state CAS. Added Rust test confirms all seven exact successful candidates round-trip, the eighth bounded restore is allowed, a ninth attempt is rejected, 81,920 is rejected, false loaded context is rejected, and legacy <=65K records still pass. No code altered context trust, native tool proof, permissions, compaction, output reserve/margin, inference timing or provider settings.

Validation: focused Rust self-hosted settings **13/13 PASS**, Rust inference/transport **55/55 PASS**, and four focused TypeScript calibration/preflight suites **88/88 PASS**; JS harness syntax and TypeScript check PASS. An optional repository-wide `cargo fmt --all -- --check` reported formatting differences in untouched historical acceptance examples (including `src-tauri/examples/r5ah_acceptance.rs`); no files were formatted and those unrelated examples were not changed. The known unrelated cloud model-switch target-context key assertion from the previous audit was not modified or retried as part of the focused patch.

## Preservation

Only new diagnostic sources, this document, and the scoped generic Rust persistence guard/test belong to the present change. Confirm at task close: six original dirty tracked files and seven protected SHA256 hashes unchanged, empty staged index after commit, both stashes, tracker, original saved settings/profiles, 15 model tags, three old proof roots and original notes-evidence root intact, the original pinned SSH tunnel unchanged, and no inference beyond the seven calibration calls in this single authorized run.
