# One Muse native-stream byte-boundary diagnostic — 2026-11-04

**Final classification: `LOCAL STREAM DELIVERY FAILURE UNRESOLVED`.**

The one authorized isolated Clack session **did not dispatch the target sustained-response request**: genuine production calibration stopped before that dispatch. All five calibration inferences themselves had real HTTP 200, parsed provider `done`, and HTTP EOF; the fifth calibration was marked `transient` by the subsequent production metadata/trust stage. Offline relay inspection established a concrete test-instrumentation defect: the temporary relay reached its **48-connection cap**, then rejected four metadata-era connections immediately before the qualification gate failed. No retry, alternative target, second model, ForgeBoard, notes acceptance, hosted inference, timeout increase or production modification occurred. The former ForgeBoard `inference-25` **remains** a runtime/stream-delivery interruption, not a fair Muse capability failure.

## Starting state, scope and protected evidence

- Starting HEAD **`425e0d9e58160d32a1bb8a3a009a30dcf02c27bc`**. The previous accepted Muse notes/calibration-renewal and interrupted ForgeBoard evidence are immutable and remain valid. Six user-dirty tracked paths, two Git stashes, `autonomous_tracker`, user settings and the original SSH tunnel were present at intake. No reset/clean/push.
- Exactly one model: **`muse-glimmer:30b`**, SHA digest **`de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`**, Ollama **0.40.11**. Original remote system daemon PID **974**, port **11434**, and approved SSH forward Windows PID **32868**, local port **11435**, were not modified or restarted.
- The full native transport implementation remained unchanged. All source changes in this task are separately named diagnostic-only scripts, one test-only WebView and a new `src-tauri/examples/muse_stream_byte_diagnostic_20261104.rs` acceptance-host clone. `npm run check-types` **PASS**, `cargo build --example muse_stream_byte_diagnostic_20261104 --locked --target-dir target/codex-test` **PASS**, Node/Python script syntax **PASS**. These offline checks did not generate model responses.
- No exposed HTTP bodies, prompts, tool output, credentials or JSON frames were logged by the relay. The transient Ollama TRACE log and raw telemetry remain **ignored and private**, not committed. No systemd changes, no Ollama global setting edits, no special model runtime behavior.

## Exact stream transport and instrumentation

Actual original Clack path:

`production Ollama serializer + verifiedProviderFetch → proxyFetch → native Tauri ai_http_stream → Rust reqwest → local 127.0.0.1:11435 → original SSH → remote 127.0.0.1:11434 Ollama HTTP server → Ollama runner`.

The diagnostic alone used:

`identical Clack serializer/proxyFetch/reqwest → local 127.0.0.1:11438 → separate pinned SSH forward → remote 127.0.0.1:11437 Python TCP byte relay → remote 127.0.0.1:11436 unprivileged Ollama TRACE server → same Muse model-store blobs/runner`.

The original service remained on remote **11434** throughout. The extra remote Ollama had `OLLAMA_HOST=127.0.0.1:11436`, `OLLAMA_MODELS=/var/lib/ollama` (same shared, non-writable store), and **process-scoped** `OLLAMA_DEBUG=2`. Dedicated Python relay and telemetry were user `hylab` processes with loopback-only listeners and bounded lifetime. The relay used `recv(16,384)`, immediate socket `send` loops and `TCP_NODELAY` both ways, logging `time.monotonic_ns()`, UTC nanoseconds, connection ID, direction, `read` byte length, every **successful forward** byte length, EOF, half-close, socket error and rejection. It did not inspect, rewrite, accumulate or intentionally defer HTTP bodies, JSON or headers. A multi-thread relay was needed because `socat` was not installed. **Known instrumentation limit:** `MAX_CONNECTIONS = 48` was too small for production calibration metadata chatter; this contaminated the final qualification stage.

Layer observations and their boundaries:

| Point | Existing or diagnostic timestamp | Precise limitation |
|---|---|---|
| Clack native dispatch / `reqwest.send()` | `dispatch` and `send-await-start` from the Rust native receiver trace | Marks the Rust await boundary, **not** proof of TCP connect or write completion |
| Clack native response headers | `headers` / status | After `reqwest` provides response headers |
| Each received body chunk | Native `body`, first/last timestamps, size and sequence | At **reqwest HTTP body delivery**, not at physical socket receive |
| Native progress/parser | `meaningful-progress`/`provider-done`, plus WebView native IPC and normal SDK parsing | `provider-done` is an interpretation of a complete received final frame |
| Native EOF / interruption | `eof`, `deadline-observed`, Settled | Native transport terminal result, not remote writer syscall |
| Relay remote upstream | Each `ollama-to-client` **read** and **forward** with monotonic timestamps | Byte delivery from local loopback socket to user-space relay, **not Ollama writer `write()` syscall** |
| Relay remote downstream | Each `client-to-ollama` read/forward; reverse half-close/error | No TCP packet or Windows SSH internal buffer timestamps |
| Ollama TRACE, runner and HTTP | Scheduler processing/finished, runner activity, HTTP handler completion/200, warnings | Internal model token generation is not proof of emitted HTTP response bytes |
| Resources | Approx. 1.4-second GPU, host memory, vmstat and process sampling | Operational context, not proof of network delivery |

The **historically unobserved boundary** is still whether Ollama emits sustained response bytes that arrive at the relay's **upstream read** during an actual long-generation stall. A read there would establish successful upstream delivery; read+forward without Clack body data would instead implicate the downstream SSH/TCP/native delivery interval. This task did **not** recreate that long interval.

## Single session and actual native request inventory

One invocation: `node scripts/muse-stream-byte-one-20261104.mjs one` with exclusive `CLACK_BYTE_DIAGNOSTIC_RUN_ID=musestreambyte-20261104-01`. Test-only native host PID **43128**; independent disposable Git workspace and app settings under ignored `src-tauri/target/real-qwen-product/musestreambyte-20261104-01/`. Only the endpoint URL differs in the isolated settings. The one-target acceptance guard allows exactly **one** predetermined, long non-application technical prompt at **32,768 context / 8,192 output**, `stream:true`, zero tools, **Automatic (`think` absent)** after production numerical calibration; it is not a production permission/timeout bypass. The prompt requests a long generic explanation of HTTP streaming and timing, **not ForgeBoard or notes work**.

**Long-stream target ID:** N/A, **target requests = 0**. Model was never given the long technical prompt. Actual genuine native calibration requests (each `num_predict=32`, zero tools, `think` omitted):

| Native request | Context | Send-await→headers | Send-await→first body | Last body after native request start | Body chunks / bytes | HTTP and parser terminal | Production calibration |
|---|---:|---:|---:|---:|---:|---|---|
| `inference-1` | 4,096 | 5,414 ms | 5,415 ms | 8,025 ms | 30 / 4,690 | HTTP 200, provider done, EOF | SUCCESS |
| `inference-2` | 8,192 | 5,431 ms | 5,432 ms | 8,108 ms | 30 / 4,700 | HTTP 200, provider done, EOF | SUCCESS |
| `inference-3` | 16,384 | 5,472 ms | 5,473 ms | 8,161 ms | 30 / 4,703 | HTTP 200, provider done, EOF | SUCCESS |
| `inference-4` | 32,768 | 5,453 ms | 5,454 ms | 8,237 ms | 30 / 4,689 | HTTP 200, provider done, EOF | SUCCESS |
| `inference-5` | 49,152 | 5,554 ms | 5,555 ms | 8,404 ms | 30 / 4,693 | HTTP 200, provider done, EOF | `transient` **after** stream settlement |

Native `body` trace had **zero dropped events** and normal EOF for all five. The fifth inference's **engine finish was `length`** and **loadedContext=49,152**, but calibration's subsequent metadata verification did not establish a matching qualified runtime/epoch. Production therefore saved status `incomplete`, highest *previous successful* tier **32,768**, and final failure `offline` after the metadata health refresh. `trustMatches=false`, `runtimeEpochMatches=false` at terminal. It correctly did **not** dispatch a long target.

## Byte relay: precise evidence and diagnostic-cap failure

Across all traffic: **52 TCP connection attempts**, **48 accepted** and served, **four explicitly rejected**, **zero logged socket errors**. For served sockets, successful forward byte totals matched read byte totals in **both directions**: **7,204 client→Ollama bytes** and **178,588 Ollama→client bytes**. These are TCP-level lengths across calibration **and** metadata requests; they include HTTP framing/headers and must **not** be compared directly with reqwest's decoded body-byte totals. Socket read and forward timestamps differed by less than the interval represented by one relay receive/forward cycle, without any documented accumulating backlog.

Correlation of the five actual calibration response connections, using approximate wall-clock alignment and native request time (no common cross-host request ID):

| Native request | Relay connection | O→relay read/forward bytes | Max upstream read gap | Max successful forward gap |
|---|---:|---:|---:|---:|
| inference-1 | 11 | 4,996 / 4,996 | 94.236 ms | 94.284 ms |
| inference-2 | 19 | 5,006 / 5,006 | 95.404 ms | 95.526 ms |
| inference-3 | 27 | 5,009 / 5,009 | 95.366 ms | 95.521 ms |
| inference-4 | 35 | 4,995 / 4,995 | 99.754 ms | 99.699 ms |
| inference-5 | 43 | 4,999 / 4,999 | **100.024 ms** | **100.197 ms** |

**Largest calibration-specific Clack native body-read gap: 210.898 ms** (inference-4). The largest gap across **all** relay connections, including small metadata requests, was 604.094 ms upstream / 604.104 ms forwarded, still far below 180 seconds. There are **no target-stream read/forward/body gaps** because no target request was sent.

The diagnostic relay's **own** `MAX_CONNECTIONS=48` guard accepted its last connection (#48) and then refused **connections #49–#52**, without forwarding them to Ollama. Their UTC timestamps were **779, 830, 837 and 920 ms after native `inference-5` HTTP EOF** and **615, 564, 557 and 474 ms before calibration reported its final gate**. The timing and expected post-stream metadata sequence support a causal relay-limit explanation for the `transient`/`offline` qualification result. The relay did not inspect methods/URLs, so the exact endpoint for each refused socket is **not independently observed**. This is a **task-owned instrumentation flaw**, not evidence of an original-production Ollama or Clack defect. It is not classified as case C (backpressure) because the four disallowed connections were never accepted for forwarding and belonged to post-inference metadata, not a stalled long response.

## Provider TRACE and resource summary

- Five Ollama HTTP `POST /api/chat` responses completed with **200** and five TRACE `sched.go:455` scheduler-finished records. Runner/model acquisition and context load activities were present in the debug log. No WARN/ERROR in the captured TRACE. The short 32-output calibrations did not produce a comparable sustained `n_gen` per-three-second runner timeline. **Long-stream runner timeline: N/A**.
- Dedicated resource sample retained **176 valid samples**, covering setup, calibration and cleanup (not just an isolated long target): **max GPU utilization 100%**, **max used VRAM 15,181 MiB**, **min free VRAM 828 MiB**, **min host MemAvailable 26,795,524 KiB**, **max observed swap used 446,560 KiB**, **`pswpin` +632, `pswpout` +0**. This does not establish OOM or a stalled runner, and the nonzero swap-in must not be misreported as zero swap activity. Process list and TRACE evidence do not establish any long-generation target because none was sent.
- Previous ForgeBoard runner log (preserved, not regenerated here) remains independent: its `inference-25` runner generated 1,724 tokens at ~9.56 tokens/sec but Clack received no later bytes after its first 449. **Do not conflate runner-token log activity with delivered HTTP bytes.**

## Offline independent idle reset audit

`src-tauri/src/modules/net/inference/mod.rs:328-374` records every `reqwest` `bytes_stream()` yield as `Kind::Body`, **then** calls `progress.feed(&bytes)`. Only when `feed` returns **true** does it set a fresh `Instant::now() + 180s` deadline. `progress.rs:69-131` returns true for a **complete parseable NDJSON/SSE frame with non-whitespace semantic `content`/`thinking`/tool data**. It does **not** reset on raw TCP/HTTP bytes alone, incomplete NDJSON, whitespace, empty frames or some metadata. The source's offline tests (`tests.rs:208` and `:1207-1249`) explicitly enforce that byte-only/whitespace activity does not extend idle. The unchanged generic 120s first-response and 600s overall bounds still apply.

**This distinguishes received bytes from "meaningful" progress; it is a real policy property deserving separate scrutiny, but not a proven cause of ForgeBoard**: the previous frozen `inference-25` reqwest trace showed **no additional body bytes whatsoever** during its 180-second silent interval, so those bytes could not have been ignored by `Progress::feed`. No production patch or speculative 300/600s idle increase was made.

Two directly executed, existing **offline Rust tests** passed under the unchanged production implementation: `cargo test --lib parser_is_chunk_boundary_safe_and_does_not_count_metadata_or_whitespace --locked --target-dir target/codex-test` (**1 passed / 0 failed**) and `cargo test --lib acceptance_body_and_ipc_sequences_track_real_delivery_not_whitespace_progress --locked --target-dir target/codex-test` (**1 passed / 0 failed**). Both are non-inference unit tests; neither changed timeout policy.

## Cleanup and evidence preservation

Temporary remote processes **OLLAMA PID 52901**, **relay PID 53063**, and **telemetry PID 53064** stopped with recorded exact-PID, process-identity-checked signals. Diagnostic Windows SSH tunnel PID **21036** was similarly stopped. Remote listeners **11436/11437**, Windows local listener **11438**, and the task-only native host **43128** were verified absent. Remote process enumeration found no task-owned runner left. The original remote system Ollama **active, PID 974** remained on original port **11434**; original service SHA-256 **`e65cda8b2426dc30e876899dce98ac4cf6d7ff138c529ef19692f39692142e06`** and drop-in **`813fb1433d898cf01162e6b70ec8f10beb1e02575761737283b021bf0220a80a`** matched preserved baselines; system environment had `OLLAMA_MODELS=/var/lib/ollama` and **no** debug override. Original pinned SSH PID **32868** on **11435** still worked. Original version **0.40.11**, **15** installed models, exact Muse digest and **zero** loaded models reverified after cleanup.

Ignored local evidence root: `src-tauri/target/real-qwen-product/musestreambyte-20261104-01/`; private stopped remote scratch `/tmp/clack-muse-streambyte-20261104-01` (user-owned, mode 0700) remains for forensics; **it is not an active daemon** and was not deleted because evidence preservation was required. The native per-event and aggregate reqwest traces, `targetStarted:false` receipt, persisted isolated calibration, 855-line raw relay timing, 176 telemetry samples, original TRACE, read-only `byte-boundary-audit.json` and `relay-cap-supplement.json` remain in the ignored local run directory. Raw log file SHA-256s:

- `relay-bytes.jsonl`: `05d5c58adb3d7524ba28c094efcc11b4c9791d9a405902d91a270497f45ed6e7`
- `resources.jsonl`: `14257098f72f46f0d6c792f06a60e3ef5fa555fdd4ef555225f9b3c599212741`
- `ollama-trace.log`: `69807f804e437e3bc414328b08e4629ae1f3d2754cce9ebfa8fbf043641093d5`
- `byte-boundary-audit.json`: `7a21f74df3d36bb40cb067b3523da8f849c08ee52c22c19261b37c876981ae3f`
- `relay-cap-supplement.json`: `8deee233352bb46c4c21f87c355bbbdec32784ef0da666bc8746ca68ffbe7933`

## Final decision

**`LOCAL STREAM DELIVERY FAILURE UNRESOLVED`** — no sustained target was dispatched, and therefore A (upstream HTTP emission), B (SSH/TCP delivery), C (response forwarding/backpressure), D (Clack stream-consumption) cannot be assigned from a reproduced long-stream stall. For **the five shorter calibration responses only**, the byte relay proved full upstream reads and successful forwards and native reqwest proved body delivery, provider done and EOF. The later qualification failure was caused or strongly explained by a distinct **test-relay 48-connection admission limit**, not by a model timeout.

**Would a subsequent single ForgeBoard retry be justified by this diagnostic? NO.** No full long-stream byte boundary was localized. A separate explicit authorization would be required to repeat a narrower diagnostic with sufficient metadata connection allowance and normal qualification; this task performs **no retry and no ForgeBoard**. The accepted Muse notes baseline and interrupted ForgeBoard classification remain as previously established.

The post-commit exact protected-state and final HEAD checks are recorded separately in the final response; no commit is claimed before it is actually created.
