# One corrected Muse stream-byte boundary diagnostic — 2026-11-04

**Final classification: `LOCAL STREAM DELIVERY STALL NOT REPRODUCED`.**

**`ONE INSTRUMENTED FORGEBOARD RETRY JUSTIFIED: YES`** under the user's stated rule for a fully completed target with healthy instrumentation. This does **not** establish that the previous ForgeBoard `inference-25` stall is fixed. A separate, explicit authorization would be required to run ForgeBoard: **none was run here**.

## Exact provenance and scope

- Starting Git HEAD: **`ab2cba76d4c9dd8dd9e4256dbe8f030022508558`**. This was an interrupted chat turn: when execution resumed, one native diagnostic host and the exact one-shot runner were **already active**, and their durable one-target result later completed. The existing session was polled until completion; **the diagnostic was not launched a second time**.
- Exclusive run ID: `musestreambyte-20261104-02`. Ignored/private evidence directory: `src-tauri/target/real-qwen-product/musestreambyte-20261104-02/`. Same single local model `muse-glimmer:30b`, digest **`de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`**, provider Ollama **0.40.11**. Zero hosted inference and zero alternate-model, ForgeBoard, or notes-acceptance requests.
- The approved original SSH loopback forward **had been absent at intake** and was restored in this task with original pinned identity/strict host-key options as Windows SSH **PID 41860**, forwarding only `127.0.0.1:11435` to remote `127.0.0.1:11434`. This remains active after cleanup. Original remote system Ollama remained active as **PID 2016**, unmodified; its unit and drop-in SHA-256s were preserved. No systemd edits.
- Diagnostic-only topology: normal Clack serializer + native Tauri `ai_http_stream`/Rust `reqwest`/SDK parser → local `127.0.0.1:11438` (**diagnostic SSH PID 39980**) → remote `127.0.0.1:11437` (**user-owned transparent relay PID 21796**) → remote `127.0.0.1:11436` (**unprivileged temporary Ollama TRACE PID 21616**, `OLLAMA_DEBUG=2` process-scoped) → Muse runner with the same `/var/lib/ollama` model store (non-writable to the user). Read-only telemetry PID **21797**. Native test-only host PID **29304**. **None** of these debug processes altered the original service, normal Ollama parameters or production Clack code.
- Relay policy **1,024 accepted connections**, hard process lifetime **1,800 seconds**, loopback-only, `TCP_NODELAY`, immediate `recv`→`send`, timestamp+direction+byte count per read and successful forward, socket close/errors recorded, **no application-body capture or HTTP/JSON parsing/rewrite**. The previously blocked synthetic 80-connection preflight was **not run**; as newly authorized, genuine production qualification through the relay served as the health proof.

## Qualification and exactly one sustained target

The strict normal Clack qualification completed before target dispatch:

| Request | Production purpose | Context | Output allowance | Result |
|---|---|---:|---:|---|
| `inference-1`–`inference-7` | Fresh genuine context calibrations | 4,096, 8,192, 16,384, 32,768, 49,152, 65,536, 73,728 | 32 each | **7/7 success**, loaded allocation matched; numerically trusted 73,728, fresh matching runtime epoch |
| `inference-8` | Exact-tier **native tool** verifier | 73,728 | 512 | **Verified**, one real native call, valid arguments, fresh matching digest/version/runtime epoch |
| `inference-9` | **ONE** long, generic HTTP-streaming explanatory response, no application task | **32,768** | **8,192** | HTTP 200, real final provider `done`, HTTP EOF, SDK `finish`, **completed** |

Automatic reasoning was left as normal (`think` omitted) for **all nine** requests. No tool schemas were used by the long target. No target retry, logical continuation, renewed calibration, application-building, or secondary inference was triggered. The one-shot runner finished with exit code **0** and reported `targetRequests=1`, `targetRequestId=inference-9`, `targetEnded=true`, `finishObserved=true` and `outcome=completed`.

**At qualification completion (before the target): 81 accepted relay connections**, **0 rejected**. The relay remained alive throughout the target and ended having **86 accepted, 0 rejected**, 0 logged socket errors, with **all reads fully forwarded in both directions on all served sockets**. The target was relay connection **#86**. Its endpoint remained within the 1,024-connection policy; the original 48-connection failure did not recur.

## Four observable layers — the exact one target

The full content-free, per-byte-event **monotonic timeline** is preserved in ignored evidence files, not committed to the Git worktree:

- `remote-evidence/relay-bytes.jsonl` — upstream socket **read** and downstream **successful send** events, each with `mono_ns`, `utc_ns`, direction, connection ID and length.
- `stream-diagnostic-1.native-events.jsonl` — Clack `reqwest` `body`, `meaningful-progress`, `provider-done`, EOF and terminal phases with request ID and sequence.
- `target-relay-two-direction-timeline.jsonl` — selected **relay connection #86** only, unchanged read/forward count and times, no HTTP body content.
- `target-native-four-layer-timeline.jsonl` — **all 5,587** native raw-body sequences, each with receive timestamp/length, `Progress::feed(bytes)` **true/false**, idle-reset **true/false**, and effective renewed `+180s` deadline when true.

| Layer / metric | One target observation |
|---|---:|
| Target request, serialized | `inference-9`, ctx 32,768, `num_predict=8192`, `think` absent |
| `reqwest.send()` entry → HTTP headers | **5,859.972 ms** |
| `reqwest.send()` entry → first received body | **5,860.626 ms** |
| A: Ollama→relay raw TCP response | **5,588 read events**, **808,391 bytes** |
| A: largest upstream socket read-to-read gap | **728.060 ms** |
| B: relay forward toward SSH/Clack | **5,588 successful forward events**, **808,391 bytes** |
| B: largest forward-to-forward gap | **728.100 ms** |
| C: Clack `reqwest` native HTTP body | **5,587 chunks**, **774,743 body bytes** |
| C: largest raw HTTP body-read gap | **727.432 ms** |
| D: raw body chunks with semantic progress & idle reset | **5,283** |
| D: raw body chunks without semantic progress/reset | **304** |
| D: largest semantic-progress/reset gap | **727.446 ms** |
| Native provider `done` | **599,055.812 ms** since request trace start |
| Native HTTP EOF | **599,083.570 ms** since request trace start |
| SDK target duration | **599,115 ms** |
| Native `stream-idle-timeout` / `overall-deadline` | **Neither observed** |
| Native terminal | **`completed`**, zero failure code |

Layer A/B raw TCP byte totals include HTTP framing/headers and therefore must **not** equal Layer C's decoded `reqwest` body-byte count. Critically, the relay's A/B read and successful forward totals **do** match exactly; there is no recorded backpressure or successful-read/failed-forward discrepancy. The matching native semantic completion and EOF independently demonstrate delivery for this entire target. TCP socket read timestamps are **not** equivalent to Ollama HTTP writer syscall timestamps, but a fully flowing target did not require further localization.

The unchanged native implementation records each `Body` before calling `Progress::feed(&bytes)`. It records `MeaningfulProgress` (same chunk sequence) only on a true return, and **in that same branch** updates the 180-second idle deadline to `Instant::now() + 180s`. The post-run offline correlator joins all `Body` and `MeaningfulProgress` events by `(request ID, sequence)`, producing **each true/false and reset timestamp** in `target-native-four-layer-timeline.jsonl`. For 304 body reads, raw HTTP bytes still arrived but no idle reset occurred; however, the maximal semantic gap was only **0.727 seconds**, nowhere near 180 seconds. **No Clack semantic-idle accounting defect was triggered. No timeout policy was changed.**

The terminal `stream-diagnostic-1.receive.jsonl` snapshot uses a bounded **8,192-entry ring** and reports **13,865 evicted historical entries**, as expected from over 24,000 live native events. This does **not** represent lost transport bytes or lost live evidence: `stream-diagnostic-1.native-events.jsonl` contains the complete, consecutive raw `Body` sequence **1 through 5,587**, and its sums exactly agree with the native terminal `bodyChunks`/`bodyBytes` totals. Full timeline calculation uses the live event file, **not** the truncated terminal ring.

## Ollama runner/scheduler/HTTP and resources

- Temporary Ollama TRACE showed model acquisition/loading and generation on the **same Muse digest**. **192 `task 0` generation-timing observations** during the long target, ranging from `n_gen=100, tg=9.75 tokens/sec` to **`n_gen=5,591, tg=9.43 tokens/sec`**. In the entire diagnostic TRACE, there were **204** `n_gen` timing lines (other qualification requests included). The runner was actively generating while the relay and Clack consistently received response bytes.
- **9 HTTP `/api/chat` completions** and **9 scheduler-finished events** for the 7 calibration + 1 verifier + 1 target requests. Target Ollama HTTP `200` completed at **2026-11-04 23:26:07 Europe/Madrid**, elapsed **9m50s** in the HTTP handler, followed by a `sched.go:455` scheduler-finished record with `refCount=0`. Provider TRACE **0 WARN/ERROR**. No request cancellation on the target.
- **600 valid resource samples** during setup, qualification and target: peak GPU utilization **98%**; peak VRAM used **15,156 MiB**; minimum VRAM free **853 MiB**; minimum `MemAvailable` **27,313,744 KiB**; maximum swap used **5,576 KiB**; `pswpin` delta **+40 pages** and `pswpout` delta **+252 pages**. These are whole-observation maxima/minima, not necessarily concurrent. No reported OOM/runner crash. The simple telemetry process-list strings were truncated and contained **zero independently matched runner-process samples**; runner execution and completion are established by the native/Ollama TRACE and scheduler events instead. Final remote `ps` inspection found no diagnostic runner remaining.

## Final causal boundary and disposition

**No stream stall reproduced** across A (upstream relay reads), B (successful forwards), C (`reqwest` raw body) or D (semantic progress / idle reset). With 81 accepted before target and 86 accepted overall, 0 rejected, matched read/forward totals, 5,587 native body chunks and completed provider/SDK events, the corrected relay successfully measured an uninterrupted **approximately 10-minute** local stream. Thus neither an Ollama HTTP emission stall, SSH/TCP delivery stall, relay forwarding failure, Clack body consumption failure nor Clack semantic-idle accounting failure is established **by this diagnostic**.

**`LOCAL STREAM DELIVERY STALL NOT REPRODUCED`.** The original ForgeBoard runtime interruption remains a real, independently preserved, **unlocalized historical event**: its `inference-25` stopped receiving raw bytes after the first 449 despite remote runner generation. A successful controlled response does **not** retroactively prove ForgeBoard fixed or demonstrate a generic Clack/model defect.

**`ONE INSTRUMENTED FORGEBOARD RETRY JUSTIFIED: YES`**, solely under the explicit qualification rule for this task, because the corrected relay and normal native streaming were healthy throughout the sustained target. This is a readiness judgement **not** permission to run ForgeBoard now. A later application acceptance would require an explicit separate authorization and must use independently preserved evidence.

## Cleanup and immutable evidence

The completed one-shot runner exited normally, and the same task-owned session **was not rerun**. Strict task-owned cleanup stopped telemetry **21797**, corrected relay **21796**, and temporary TRACE Ollama **21616**; diagnostic Windows SSH **39980** was stopped; native host **29304** and runner process exited. Remote listeners **11436/11437** and local **11438** are closed; a final remote `ps` check found **no diagnostic runner, relay or sampler**.

Original remote system Ollama remained **active PID 2016** on **11434**, with unit SHA256 `e65cda8b2426dc30e876899dce98ac4cf6d7ff138c529ef19692f39692142e06` and drop-in SHA256 `813fb1433d898cf01162e6b70ec8f10beb1e02575761737283b021bf0220a80a`. It is Ollama **0.40.11** with **15 models**, the unchanged exact Muse digest, and **zero loaded models** after cleanup. The restored approved strict pinned SSH forward **41860** on local **11435** remains alive. No system or production code/settings modification, timeout change, reset/clean/push.

All historical Muse notes/renewal acceptance and both previous ForgeBoard/byte-boundary evidence sets were preserved. The original six pre-existing dirty tracked files, both stashes, `autonomous_tracker` and operator settings were checked against their original values, not staged or altered. The **new** task-owned changes comprise the exclusive-run receipt allowance in `scripts/muse-stream-byte-retry-20261104.mjs`, a new offline analysis script `scripts/muse-stream-corrected-boundary-analyze-20261104.mjs`, and this report. Raw logs and full per-event outputs remain in **ignored private** evidence, not the commit.

Private raw evidence hashes (SHA-256):

| Evidence file under run root | SHA-256 |
|---|---|
| `remote-evidence/relay-bytes.jsonl` | `96750257216fb91461c5ced1a26fd089481dde34cf1a06e67d47ba48c636df9c` |
| `remote-evidence/resources.jsonl` | `afc88c69cac745853519a55fb3843c74570b2d782243c2d33905132f3bf675ba` |
| `remote-evidence/ollama-trace.log` | `ec26cbb423b0ba73152c8c3cff7b7f9db28247d3c51a1bb048a7ba3ab5c0dd3e` |
| `corrected-byte-boundary-summary.json` | `3f079a6d97476098cec4386af25e97e87b3b0e8462a55d0754bae5c32abdcd3f` |
| `target-native-four-layer-timeline.jsonl` | `df6b9398f600ded04737132b619070fa888a9a7a4977db3ddc6d6ab7d9a8f99d` |
| `target-relay-two-direction-timeline.jsonl` | `4456f34b306187a4f39d885bdc1d9b5faa3b804a7a30d793d6a669d6d84a1b0a` |

This report's Git evidence commit and final HEAD are verified separately after commit creation, never invented beforehand.
