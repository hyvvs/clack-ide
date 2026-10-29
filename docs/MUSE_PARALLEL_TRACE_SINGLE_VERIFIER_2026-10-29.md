# Muse 73K single verifier: isolated unprivileged Ollama TRACE correlation

**Starting HEAD:** `2ead9deb29d7138d220d3dc2346aefc365e07849`.

**Diagnostic verdict:** `LOCAL OLLAMA PARALLEL-TRACE DIAGNOSTIC HEALTHY` — one genuine native-tool verifier completed normally with the live alternate TRACE daemon and synchronized system/resource evidence. **Do not reclassify the previous full local notes acceptance**: `LOCAL ACCEPTANCE BLOCKED BY RUNTIME RELIABILITY` remains, because the historical 18-tool Agent request that stalled for 120 seconds has not been replayed or localized.

**Scope:** local Muse only; **seven** normal production context calibration calls and **one** verifier request. No full notes app, Agent mission, ForgeBoard, hosted provider, production Clack behavior changes, system Ollama service changes, timeout/policy changes or retry of the target verifier.

## Starting system and parallel isolation

| Item | Live observed |
| --- | --- |
| System Ollama | **0.40.11**, PID **1558**, `ollama.service` active, lab `127.0.0.1:11434` |
| Original pinned forwarding | Windows `127.0.0.1:11435` → lab `127.0.0.1:11434`; SSH PID **3240** |
| Installed models / loaded system models | **15 / 0** at entry and exit |
| Muse | `muse-glimmer:30b`; digest `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1` |
| Shared store | `/var/lib/ollama`; readable Muse manifest and **five** referenced blobs; **zero** files or directories writable by diagnostic user `hylab` |
| Original main unit SHA-256 | `e65cda8b2426dc30e876899dce98ac4cf6d7ff138c529ef19692f39692142e06` |
| Original drop-in SHA-256 | `813fb1433d898cf01162e6b70ec8f10beb1e02575761737283b021bf0220a80a` |
| System service environment | `OLLAMA_MODELS=/var/lib/ollama`, no configured `OLLAMA_DEBUG` |

The test-owned parallel Ollama **PID 11167** ran the same installed **0.40.11** binary as user `hylab`, with only process-scoped values:

```text
OLLAMA_HOST=127.0.0.1:11436
OLLAMA_MODELS=/var/lib/ollama
OLLAMA_DEBUG=2
```

Its separate, strictly host-pinned Windows SSH forward was **PID 34076**, local `127.0.0.1:11436` → lab `127.0.0.1:11436`. This forwarded endpoint independently returned version **0.40.11**, all **15** installed tags and exact Muse digest. Startup emitted **7 TRACE** and **72 DEBUG** lines before inference; the only local port change was the separately owned `11436`.

## Existing production semantics, isolated evidence

An exclusive isolated Git workspace and disposable acceptance data copy were used under `src-tauri/target/real-qwen-product/museparalleltrace-20261029-03/`. The original protected settings file was checked against its known SHA-256 before copying; **the only semantic change in the copied profile** was existing endpoint `http://127.0.0.1:11435/` → `http://127.0.0.1:11436/`. Operator settings remain unchanged.

The task-owned copy of `scripts/r5dh-muse-verifier.mjs` preserved the original source harness's normal `calibrateModelContext` and `verifyModelTools` calls, native `ai_http_stream` IPC and strict Rust acceptance barrier; it changed only the exclusive run ID, alternate URL, and isolated settings copy. Original harness SHA-256 remains `8660fe6390ebc331f6bb50bcf7f7090680472a9eb6eebc4d1ed5e1897c25aef5`. Test-only copy archived in the ignored evidence root with SHA-256 `4765e423e9af20112384f90209ab64d5eb30222812177b204ca317a274fcacf2`.

One initial invocation **stopped before host/inference launch** at its untouched exclusive-root guard: the telemetry evidence files were in its root rather than a separate sibling. No request was sent in that invocation. The verifier was then retargeted to a fresh separate exclusive root `...-03` while the read-only telemetry continued in sibling `...-02`. This did **not** consume or retry a target inference.

The successful verifier invocation used **Automatic** reasoning (`think` omitted), the normal production calibration ladder to **73,728**, then exactly **one** genuine `get_probe_value` native-tool schema at `num_ctx=73728`, `num_predict=512`. The native acceptance guard rejected any second verifier, Agent-shaped request, unknown model, or changed context/output. The selected `muse-glimmer:30b` revision, store, model version, binary, trust semantics and output policy were unchanged.

## Actual request inventory and native phase timings

All native requests have **provider done**, **HTTP EOF**, **completed** settlement and **zero** native cancellation. The seven calibration attempts had exactly **0 tools** and **32** output tokens allowed. Times are relative to each request's native `send-await-start` and derived from persisted content-free Clack receipts:

| Request | Context | Output | Tools | Headers after send | Done / EOF after send |
| --- | ---: | ---: | ---: | ---: | ---: |
| `inference-1` | 4,096 | 32 | 0 | 38,719 ms | 41,383 / 41,384 ms |
| `inference-2` | 8,192 | 32 | 0 | 5,430 ms | 8,200 / 8,201 ms |
| `inference-3` | 16,384 | 32 | 0 | 5,455 ms | 8,226 / 8,227 ms |
| `inference-4` | 32,768 | 32 | 0 | 5,489 ms | 8,432 / 8,433 ms |
| `inference-5` | 49,152 | 32 | 0 | 5,660 ms | 8,687 / 8,688 ms |
| `inference-6` | 65,536 | 32 | 0 | 5,539 ms | 8,520 / 8,521 ms |
| `inference-7` | 73,728 | 32 | 0 | 5,520 ms | 8,500 / 8,500 ms |
| **`inference-8`** | **73,728** | **512** | **1** | **1,351 ms** | **46,725 / 46,726 ms** |

Fresh calibration/trust gate **verified** at 73,728, with runtime epoch `18112:1793256678754913500`; no prior host proof was reused. Exact native verifier proof in the normal report: **status=verified**, **outcome=native-call**, **calls=1**, **validArguments=true**, correct digest/0.40.11/runtime epoch. Harness `resultOk=true`, **8 native dispatches**, `missionStarted=false`, `cloudInference=0`, native host exit **0**. Parser failure observer installed, **0** failures.

### Target `inference-8` Clack timeline

Native timestamps are Unix milliseconds (independently preserved in `qualification-1.receive.jsonl`). Lab log timestamps are CET with `+01:00`. Clocks were not formally NTP-offset calibrated; independently logged phases support **ordering/approximate seconds**, not a claim of millisecond-accurate cross-host time alignment.

| Phase | Native Unix ms | Detail |
| --- | ---: | --- |
| Native IPC ready | `1793256787598` | Native request ID attached |
| Resolve/client/request prepared | `1793256787614` | `resolve-start`, `resolve-end`, client ready, request-built |
| Dispatch / `reqwest.send().await` entered | `1793256787614` | Normal Clack transport |
| HTTP headers | `1793256788965` | 1,351 ms after send |
| First body chunk | `1793256788966` | 150 bytes in first native chunk |
| Provider `done` | `1793256834339` | Native progress completion |
| HTTP EOF / native completed | `1793256834340` | Total 46,726 ms from send, **353** body chunks, **53,556** body bytes |
| WebView settled completed | `1793256834344` | No cancellation |

### Ollama TRACE, scheduler and runner correlation

The dedicated server's private, in-process TRACE log shows exactly **8** completed HTTP `POST /api/chat` requests, all **200**. It contains **8** `sched.go:455` DEBUG `after processing request finished event` markers. The target's terminal Ollama markers were:

- HTTP completion: **2026-10-29 07:53:55 CET**, **200**, provider duration **46.54 s**;
- Scheduler finished: **07:53:55.704 CET**, `runner.parallel=1`, runner memory about **16.4 GiB** and GPU runner allocation **12.2 GiB**;
- Existing real llama runner task **34** entered `slot launch_slot_` processing and was released with **898** tokens in the runner task log. No fake tool event.
- The actual **73,728-context** runner was visible during the target interval as **PID 14848** and `/api/ps` showed **`muse-glimmer:30b` at context 73,728** throughout all valid target samples.

**Crucial limitation:** the TRACE log has **seven** explicit `sched.go:284` `processing incoming request` events, and these align with the seven context-changing calibration loads. The target verifier **does not have its own explicit incoming-request TRACE marker**. Its successful HTTP 200, scheduler-finished event, runner task activity and provider done/EOF **prove that Ollama handled and completed it**, but must **not** be misreported as an eighth TRACE incoming marker. A warm loaded-runner fast path may account for the distinction; its exact implementation-path explanation is **not proven** here.

Thus target HTTP receipt **YES** (indirectly/proven by successful completed request), explicit incoming-request TRACE **NO**, scheduler processed/finished **YES**, acquired/reused runner **YES**, runner executing **YES**, first output **YES**, provider completed/EOF **YES**, cancellation **NO**. TRACE and native request IDs are not directly joined inside Ollama; correlation uses the isolated, sequential eight-request server, time window and constrained wire guard.

## Read-only synchronized GPU/RAM/process telemetry

No service/monitor installed. A dedicated, bounded user-owned SSH process **PID 20820** ran repeated **read-only** lab commands at approximately **1.04-second intervals**: `date -u`, `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.free,temperature.gpu`, `/proc/meminfo`, `/proc/vmstat`, `ps -eo pid,ppid,comm,pcpu,rss,stat`, and `GET 127.0.0.1:11436/api/ps`. Output was redirected to the ignored diagnostic evidence root, **not to a system service**. A separate three-sample idle proof showed timestamps advancing and all required counters before inference.

**259** recorded timestamped samples in the main collector; **44 valid samples** overlap the exact target native send→EOF interval:

| Target interval measurement | Observed value |
| --- | ---: |
| Peak NVIDIA GPU utilization | **49%** |
| Peak VRAM used | **15,133 MiB** |
| Minimum VRAM free | **877 MiB** |
| Minimum host MemAvailable | **27,743,716 KiB** (~26.46 GiB) |
| Minimum swap free | **32,456,136 KiB** |
| Maximum observed swap used | **564 KiB** |
| `pswpin` / `pswpout` deltas | **0 / 0** |
| Runner | **PID 14848**, observed throughout all 44 target samples |
| Runner peak RSS | **5,202,548 KiB** (RSS, not exclusive physical memory) |
| Loaded target model/context | `muse-glimmer:30b`, **73,728**, in **all 44** target samples |
| System daemon PID 1558 | Remained present, not the target's endpoint |
| Diagnostic Ollama PID 11167 | Present in all target samples |

No observed OOM, allocation-failure, runner crash, swap-out or cancellation message in the reduced TRACE sample. These GPU/RAM measurements do **not** prove that an unrelated historical Agent stall cannot occur at a different prompt size, tool count, runtime epoch, load state or concurrent workload.

## Evidence and mandatory cleanup

- Private ignored telemetry: `src-tauri/target/real-qwen-product/museparalleltrace-20261029-02/resource-samples.txt`, `resource-summary.json` and `analyze-resources.mjs`.
- Ignored verifier receipts: `src-tauri/target/real-qwen-product/museparalleltrace-20261029-03/qualification-1.*`, `trace-redacted.txt`, and archived test-only harness copy. Content-free TRACE reduction includes scheduler receipt/finish markers, runner starts/task metadata and HTTP 200 finishes; raw prompts and tokens were not committed.
- Raw transient daemon log SHA-256: `562dfbe873cc982ad644d7cc59fb4a0265a4491cc6e98607ad76574f60e0e600`.

**Operational cleanup PASS:** read-only SSH collector PID **20820** terminated; only diagnostic Ollama PID **11167** sent SIGTERM (confirmed process gone); target diagnostic runner PID **14848** gone; only diagnostic SSH forward PID **34076** terminated; local/remote diagnostic port **11436** closed. System daemon remained **active as original PID 1558**, original service unit/drop-in SHA-256 both unchanged, `OLLAMA_DEBUG` unset, `OLLAMA_MODELS=/var/lib/ollama`, version **0.40.11**, model inventory **15**, exact Muse digest, loaded models **0**, original pinned SSH forward **PID 3240** healthy. Original test-only harness source unchanged.

**One cleanup limitation, disclosed:** an attempt to delete the exact task-owned raw TRACE scratch directory was **blocked by the execution tool's safety check**. No alternate/bypass deletion was attempted. The directory `/tmp/clack-muse-parallel-trace-20261029-02` remains under `hylab` ownership, permission **0700**, containing the stopped process's raw log and PID file. It contains **no running daemon**, open port or inference process. An authorized operator can remove that exact directory after reviewing log retention/security. Do not report full scratch-file cleanup as completed.

**Verdict:** `LOCAL OLLAMA PARALLEL-TRACE DIAGNOSTIC HEALTHY` for **this single 73K/512 verifier**. No concrete Ollama, Clack, transport or resource defect was found during it; the historical long-form Agent failure **remains unresolved** and the frozen local notes acceptance classification stays **`LOCAL ACCEPTANCE BLOCKED BY RUNTIME RELIABILITY`**. Do not run another verifier, full notes app, other model, hosted control or ForgeBoard automatically.
