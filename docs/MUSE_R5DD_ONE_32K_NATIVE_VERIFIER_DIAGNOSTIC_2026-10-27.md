# R5dd: exactly one instrumented 32K native-tool verifier — PASS, no cancellation

**Starting HEAD:** `6b531e17adb393faf8b7cf41e1146db4d427cdf8`. **Date:** October 27, 2026 (Europe/Madrid). **Scope:** one specifically authorized, isolated production-path Muse diagnostic only. **No Agent, no notes app, no ForgeBoard, no alternate model, no second verifier, no live retry.** No production or provider behavior/policy/settings changes. R5db `inference-9` remains historically inconclusive; this is not a replay of its missing source data.

## Readiness and protected operator state

- Initial HEAD was exact and the six original modified tracked files, both stashes, seven saved protected SHA-256 checks and tracker were unchanged. Prior evidence and operator settings were read without modification.
- The previously recorded tunnel **PID 27688 was absent**, with no listener or running `ssh.exe`. Before any inference, reestablished its *identical* pinned-key, strict-host-key loopback forwarding `127.0.0.1:11435 -> 127.0.0.1:11434` to the same approved endpoint. New tunnel PID: **34280**. No SSH host-key, provider daemon, identity or system configuration was modified. Read-only live `/api/version` and `/api/tags` then confirmed Ollama **0.40.11**, **15** installed models and the one selected model **`muse-glimmer:30b`** with digest **`de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`**.
- New exclusive ignored evidence/workspace root: `src-tauri/target/real-qwen-product/museglimmer-r5dd-verifier-20261027-01/`; workspace initially and finally contained only `.git`. Saved source settings were copied into this **isolated** Tauri host, not written back to the operator configuration.

## Precisely bounded production path

The exclusive harness `scripts/r5dd-muse-verifier.mjs`, WebView `src/test/r5ddMuseVerifier.tsx`, and separate native host example `src-tauri/examples/r5dd_verifier.rs` use **production** `calibrateModelContext`, `verifyModelTools`, Rust `ai_http_stream`, the real native probe tool schema, and the R5dc committed cancellation-provenance settlement. The production `ceiling` option **32768** obtains only needed numeric trust; it does not lower production context defaults or override settings. Acceptance-only Rust IPC interception is fail-closed **before dispatch**: at most four calibration requests (4K, 8K, 16K, 32K at `num_predict=32`, no tools), then at most **one** `32768` / `num_predict=512` / `get_probe_value` verification request. It rejects any Agent-shaped, repeated, wrong-model, wrong-reasoning or additional tool-bearing inference. No Agent-run code was invoked. The unchanged Automatic control omits `think` on the wire for every request. A separate ten-minute **runner** safety bound is not the production HTTP/verification timeout policy; it never fired.

The WebView observes native per-request stream boundaries and the new structured `settled.cancellation` field without modifying received data. The Rust acceptance host captures passive native body/IPC event stamps, request wire metadata (tool **name only**, no arguments/prompt) and cancellation command enum if received. A one-time **offline, no-provider** independent audit cross-reconciles five request records, five native traces, SDK/verifier settlement and the saved native persisted profile; receipt SHA-256 hashes are preserved in the isolated audit summary.

## Five actual native requests and successful trust

| Request ID | Actual `num_ctx` | `num_predict` | Genuine native schemas | Native finish | Numeric proof |
|---|---:|---:|---:|---|---|
| `inference-1` | 4,096 | 32 | 0 | completed | requested = loaded = 4,096 |
| `inference-2` | 8,192 | 32 | 0 | completed | requested = loaded = 8,192 |
| `inference-3` | 16,384 | 32 | 0 | completed | requested = loaded = 16,384 |
| `inference-4` | 32,768 | 32 | 0 | completed | requested = loaded = 32,768 |
| **`inference-5`** | **32,768** | **512** | **1** (`get_probe_value`) | **provider-done, EOF, completed** | **exact-tier native tool call verified** |

The production calibration persisted **verified** with `highest=32768`, four successful loaded-context attempts, a fresh epoch-bound measurement and current expiry. Both direct and snapshot trust and the production budget target independently reported **32768**. Tool verifier persisted separately as `agentToolTierProofs[32768]` with ID `9ae08699-a1a5-41d7-b279-29ddd0a444d5`, **status `verified`**, **outcome `native-call`**, **calls `1`**, **validArguments `true`**, **finish `tool-calls`**, output **512**, proof at epoch `33364:1793059306462691300`, digest/version identical to live provider. Proof persisted at epoch ms `1793059395214`; it expires at `1793145795214` in that host's evidence context. Do not reuse this proof as authorization in a fresh host/epoch.

## Exact verifier timeline

All times are **October 27, 2026, CET (UTC+01)**. Native transport timestamps are preferred to WebView approximations.

| Event | CET | Epoch milliseconds |
|---|---|---:|
| Request wire recorded | 01:02:28.808 | `1793059348808` |
| Native HTTP dispatch | 01:02:28.829 | `1793059348829` |
| First native HTTP body / first WebView chunk | 01:02:30.010 / 01:02:30.011 | `1793059350010` / `1793059350011` |
| Last native chunk forwarded | 01:03:14.813 | `1793059394813` |
| Provider completion detected and native EOF | 01:03:14.813 | `1793059394813` |
| Native request settled completed / SDK tool call parsed | 01:03:14.814 | `1793059394814` |
| SDK verifier observation completed | 01:03:14.950 | `1793059394950` |
| Valid exact-tier proof persisted | 01:03:15.214 | `1793059395214` |
| Host exited normally *after reporting* | 01:03:15.330 | `1793059395330` |

**HTTP dispatch-to-completed duration: 45,985 ms.** **364** genuine native body chunks (**55,173 bytes**), **0** trace drops, maximum adjacent native forwarded gap **6,953 ms** (WebView observation: 6,952 ms). Exactly one `provider-done`, one EOF, one `completed`, **zero `cancellation-observed`, zero `ipc-rejected`, zero native `ai_http_cancel` IPC**, and no `settled.cancellation` object. The native Rust trace proves provider completion through the Ollama stream's terminal done marker; no Ollama-side cancel/error was observed. No new daemon/runner journal was required to establish success, and per-runner token counters were not independently collected.

The accepted final report explicitly says `missionStarted=false`, `missionRequests=0`, `cloudInference=0`; no session/Agent generation, no application or tool execution outside the harmless *native verification schema call*. The acceptance child exited `0`; the runner returned `0`. Separate offline audit `node scripts/r5dd-muse-verifier-audit.mjs` **PASS** without model/provider contact and wrote `qualification-1.offline-audit.json` once. Primary historical receipts remain untouched.

## Decision

- **Current 32K native-tool verification: PASS**, no cancellation, full provider and SDK settlement, fresh persisted proof. The R5dc first-cause instrumentation was present but appropriately recorded **no cancellation provenance**, because none fired. The 493-chunk R5db failure **did not reproduce** in this one narrow control.
- The original `inference-9` initiator **remains unknown**. This diagnostic provides evidence for a **transient/unreproduced interruption**, but cannot distinguish an earlier one-off WebView/Clack, harness/environment, provider or network cause. **No generic Clack defect proven; no production fix authorized or made.** It would be false to reinterpret historical `native-transport` as a model failure or to claim infrastructure was proven guilty.
- **Recommendation: authorize ONE replacement full Muse notes-app acceptance only in a *separate explicit future task***, contingent on the then-live digest/Automatic identity and fully fresh calibration + exact-tier verification under its **new** runtime epoch, while retaining R5dc provenance capture. That authorization has not been used here. A successful verifier alone does **not** establish notes-app quality or validate Agent logical continuation.

## Evidence

Exclusive root contains `qualification-1.requests.jsonl`, `qualification-1.receive.jsonl`, `qualification-1.native-inspection.jsonl`, `qualification-1.verifier.json`, `qualification-1.native-report.json`, `qualification-1.json`, `qualification-1.offline-audit.json`, the untouched local isolated `data` and empty Git-only workspace. No original protected/tracked/operator evidence was replaced. Source and report committed only after offline verification; no Git push, reset, clean or destructive cleanup.
