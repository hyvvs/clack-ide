# GLM minimum-safe exact-tier probe: final one-run evidence

**2026-10-25.** Started from `649e146baf65301239ccdffc9150c97295b247da`. One additionally authorized, GLM-only, bounded production-path diagnostic; no notes acceptance, other model, ForgeBoard, application work, provider tuning, or second diagnostic.

## Identity, environment and evidence

* Model: `glm-4.7-flash:q4_K_M`, digest `4475827791a269b02c8ec49b1c3bc1abb5846bacf3fae015b75d33986322d8f6`, Ollama `0.40.11`; 15 installed tags; existing operator SSH tunnel on `127.0.0.1:11435` (PID 32620).
* Exclusive isolated root: `src-tauri/target/glm47flash-tier-proof-20261025-02/`. The previous `-01` diagnostic remains unchanged. The runner created its own empty Git workspace and isolated copy of the hash-checked saved settings, and retained the software-rendered WebView. The only exposed Agent tool was the read-only `list_directory`, enforced by `mandatoryTools` and the production exposure filter; no application-building prompt or native write-capable schema was allowed.
* Native serialized metadata: `stream-diagnostic-tier-02.requests.jsonl`. Each native received body/forwarding stage and request ID: `stream-diagnostic-tier-02.native-events.jsonl`. Completed native receive snapshots: `stream-diagnostic-tier-02.receive.jsonl`. Frontend/SDK calibration stages and process observations: `timeline.jsonl`. User-facing result: `browser-report.json`; bounded runner summary: `final-evidence.json`. Logs exclude prompt, credentials, native tool arguments and model response contents.

## Actual wire observations

| Native request | Context | `num_predict` | Schemas | Observed result |
| --- | ---: | ---: | --- | --- |
| `inference-1` through `inference-6` | 4096, 8192, 16384, 32768, 49152, 65536 | 32 each | none | All six fresh calibration attempts succeeded and persisted, requested=loaded; calibration status **verified** and highest=65536. The former ambiguous 4K settlement failure did **not** reproduce. |
| `inference-7` | 65536 | 512 | `get_probe_value` | Primary native-tool record **verified**, `outcome=native-call`, `calls=1`. This proof was **not** reused for 32K. |
| `inference-8` | **32768** | 512 | `get_probe_value` | Actual structured call observed, one call, valid arguments, SDK finish `tool-calls`, attempt `outcome=native-call`; **final tier verification failed** with `status=incomplete`, `outcome=transport`, no proof. |

For `inference-8`, native transport recorded response **headers** at epoch-ms `1792915149785`; **121** received body chunks and **121** successful IPC forwards; provider-done `1792915152368`; EOF `1792915152370`; native execution completed `1792915152371`. The persisted tool-verification attempt recorded `native-call` and `finish=tool-calls`, but the final record was downgraded to `incomplete/transport` by `1792915152837`. The client reported an `AI_APICallError`, code `native-transport`, and stopped fail-closed. The model did not fail to produce output; provider and native body delivery were successful. The precise exception in the post-call SDK/verification/native-settlement boundary is **not** captured, so no narrower generic production cause is proven. The first required but absent successful stage was **post-observation verification settlement/revalidation and a valid persisted exact-tier proof**.

## Exact requested result: not LIVE VERIFIED

| Required observation | Actual |
| --- | --- |
| Selected smallest safe context | **32768**: production preflight requested real exact-tier verification at 32768, while the prepared request retained the generic 8192 output reserve |
| Genuine native verification at that tier | **Attempted at 32768** and one real valid structured native call observed; final verification **failed** |
| Scoped proof stored | **No valid 32768 proof**. Persisted `agentToolTierProofs` contains `context=32768`, `status=incomplete`, `outcome=transport`, `proof=null`, scope full digest and runtime epoch `34820:1792915102905574200`, provider version `0.40.11`. Primary independent 65536 proof remains verified. |
| Agent `num_ctx` | **Not observed**; no Agent inference dispatched |
| Agent `num_predict` | **Not observed on Agent wire**. Normal prepared output allowance was **8192**, without dispatch |
| Agent native execution result | **None**; no `list_directory` execution because the Agent was blocked first |
| Overall live exact-tier 32K verification | **FAIL / INCOMPLETE**, fail-closed as required; no unverified Agent request |

The task-owned host PID `34820` remained alive while the eight native requests executed, and WebView child processes were observed without a recorded crash. It exited only after the report and owned-runner stop. There was **exactly one** new run and no retry. This evidence demonstrates successful calibration and a real 32K native call, **not** successful 32K native-tool proof or 32K Agent request. The existing production proof, permission, margin, continuation and timeout policy were not weakened or retuned. No generic defect was conclusively localized, so no inference-path production fix was attempted.

The diagnostic includes new isolated JS/WebView files and a debug-only acceptance-native incremental receive observer that exists only when a Tauri acceptance host explicitly installs it. Temporary opt-in listener boundaries in `proxyFetch.ts` were returned to the unchanged production source after observation. The read-only WebView and one-shot ownership requirements remain intact. Preserve all original dirty files, settings, both stashes, tracker, historical evidence, model inventory and tunnel.
