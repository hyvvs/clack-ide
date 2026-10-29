# Muse Glimmer local Ollama reliability: provider-side correlation gate

**Baseline HEAD:** `cf749d119b1ebcecc9de3ad32e9dbcac1c2c34f3`.
**Local acceptance:** `LOCAL ACCEPTANCE BLOCKED BY RUNTIME RELIABILITY`.
**Single next recommendation:** `LOCAL OLLAMA PROVIDER TELEMETRY STILL INSUFFICIENT`.

**Scope:** read-only source/receipts, operating-system and upstream diagnostics audit; one approved SSH-forward restoration *attempt*, no model inference, no notes acceptance, no ForgeBoard, no hosted provider, no Ollama daemon configuration changes, and no production instrumentation changes.

## Actual local environment and reachability

- Local Clack is on the expected baseline. The original six protected dirty tracked files, two Git stashes, `autonomous_tracker`, settings, and frozen evidence are outside this report's changes.
- **No current Ollama version or model inventory was retrieved.** This Windows workstation has no `ollama` CLI in PATH; the Ollama provider is the **separate Linux lab machine**, previously reached by a Windows SSH forward.
- **Last verified, historical:** Ollama `0.40.11`, **15 installed tags**, `muse-glimmer:30b` digest `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`. Source: `docs/MUSE_R5DI_FINAL_NOTES_ACCEPTANCE_2026-10-28.md`. These are **not** newly confirmed runtime facts.
- The previously approved strict, pinned SSH forward is `127.0.0.1:11435 -> remote 127.0.0.1:11434` to the original known-host/identity pair. At entry: **no `ssh.exe` process**, **no listener** at `127.0.0.1:11435`. Existing original identity file and known-host entry were verified without alteration.
- **One** attempted restoration used the exact documented original `-N -T`, `-L`, identity, `UserKnownHostsFile`, `BatchMode`, `StrictHostKeyChecking`, `ExitOnForwardFailure`, connect-attempt, and keepalive settings. Spawned transient Windows **PID 22556**; the process exited **without a listener**, therefore **no working tunnel/PID exists**. Independently, read-only TCP/22 reachability to the approved lab host returned **false**. No alternate address, tunnel, host-key policy, remote shell/service or network setting was tried or changed.
- Consequently `GET /api/version`, `GET /api/tags`, `GET /api/ps` cannot be honestly reported as fresh successful queries and no provider-side daemon/runner snapshots were collected in this audit.

## Frozen decisive evidence, no attribution beyond evidence

The R5di frozen control made thirty native Ollama requests: seven context calibrations, three genuine verifier requests and twenty Agent generations; nineteen Agent generations completed. The successful immediately preceding request `inference-29` (same Muse identity, 49,152 context / 8,192 output, 18 tools) had headers about **1.019 s** after native dispatch and completed with `done`/EOF about **32.773 s** later.

`inference-30` passed Clack admission and entered native `reqwest.send().await` at **2026-10-28 02:00:06.012 UTC**, with no observed headers, body, `done`, or EOF. The outer Agent provider-recovery 120-second first-meaningful-output deadline fired at **02:02:05.932 UTC** and issued the parent abort. Native cancellation was observed **119,926 ms** after dispatch. This is **not** evidence that TCP successfully connected or that Ollama had admitted the HTTP request. Its exact origin remains unknown. The historical parser observer recorded **zero parser failures**. Sources: `docs/MUSE_R5DJ_OFFLINE_INFERENCE30_RUNTIME_STALL_2026-10-28.md` and R5di frozen receipts. Do **not** increase timeouts, context, or output allowances.

## Observable Clack boundary (already implemented)

| Boundary | Existing read-only/opt-in measurement |
| --- | --- |
| Agent generation and logical retry | In-memory `generationId`, attempt, phase and provider identity in `providerRetry.ts` / `inferenceDiagnosticCorrelation.ts`; optional observed events `deadline-start`, `attempt-start`, `retry-scheduled`, `retry-ready`, `first-meaningful-output`, `deadline-fire`, `settled` |
| Native request identity | `nativeRequestId` linked through the same abort signal to the generation; numeric `num_ctx`, `num_predict`, tool schema count; native IPC start |
| Native preparation | `resolve-start`, `resolve-end`, HTTP client build, `request-built`, `dispatch`, `send-await-start`; stages before/at `.send().await` |
| Response progression | HTTP status/headers, first body chunk, subsequent byte counts, meaningful progress, `provider-done`, EOF, IPC-forwarded and terminal settlement |
| Errors and provenance | Parent/cancel-IPC, native cancellation origin, provider-retry timeout, SDK parser-failure observer and final parser-failure count |

**Not measured by Clack:** actual TCP SYN/connect completion, forwarded SSH write, HTTP request receipt inside Ollama, scheduler queue entry/exit, warm-runner acquisition, per-request runner execution start or first internally produced token, GPU/host-memory pressure at dispatch. A UI phase named `connecting` or `waiting-first-output` is **not** a physical socket/HTTP milestone.

## Provider/system telemetry available if original lab access returns

Historical verified lab host: Linux `systemd` `ollama.service` running `/usr/local/bin/ollama serve` as the `ollama` user, NVIDIA RTX 4060 Ti 16 GB, ~31 GiB RAM, zram swap, llama.cpp/CUDA runner. No privilege escalation, environment edit or Ollama restart is authorized.

| Question | Existing read-only source / realistic limit |
| --- | --- |
| HTTP receipt, cancellation, errors | Timestamp-bounded `journalctl -u ollama --since ... --until ... --no-pager` and `systemctl status ollama`; if accessible, daemon route/access logs. HTTP **completion logs are not reliable proof of receipt at entry**; missing logs alone are not proof of transport failure. |
| Scheduler, queued request, model load/eviction | Existing journal messages about loading, runners, queue-limit errors, unload, readiness, scheduler. Detailed decisions in Ollama source use debug/trace logging and **may not appear at current service log level**. No publicly exposed per-request queue state is established. |
| Runner execution/cancel/restart | Existing daemon + llama-server messages, runner PID/uptime and CPU process sampling. A loaded runner or high GPU utilization is not itself proof this **particular request** started generating. |
| Current model/runtime | Read-only local `GET /api/version`, `GET /api/tags` (digest/inventory), `GET /api/ps` (loaded model, context length and memory footprint); never `/api/chat` during preparation. |
| GPU memory/utilization/OOM | `nvidia-smi --query-gpu=timestamp,memory.used,memory.free,utilization.gpu,utilization.memory --format=csv,noheader,nounits`; journal/kernel existing errors. |
| RAM/swap/paging | `free -b`, `vmstat 1`, `/proc/vmstat` `pswpin/pswpout`, `/proc/meminfo` and `/proc/<pid>/status`; sample before/during/after. |
| Daemon/runner state and sockets | `ps`/ `/proc` PID, RSS, elapsed, CPU, command identity; `ss -tinp` for local loopback TCP if the operator's ordinary permissions permit. No packet payloads or credentials collected. |

Official logs documentation: https://github.com/ollama/ollama/blob/main/docs/troubleshooting.mdx . Ollama implementation documents scheduler queue/runner handling: https://github.com/ollama/ollama/blob/main/server/sched.go . **These describe potential facilities, not proof they were enabled on the observed 0.40.11 daemon.** Historical lab diagnostics: `docs/GLM_QWEN_OLLAMA_CLACK_RUNTIME_AUDIT_2026-10-25.md`.

The standard public Ollama API does **not** provide a verified end-to-end per-request ingress → scheduler acquisition → runner first-token timeline. Reading existing journal and GPU metrics is worthwhile, but **cannot automatically separate A from B or B from C** if receipt/scheduler/runner entry events are not actually logged. Turning on `OLLAMA_DEBUG` requires service-level configuration/restart and is **not** authorized by this task. Packet capture, eBPF tracing or privileged runner introspection likewise require separate operator access/authorization, strict non-content/nonce handling and privacy review; do not assume they are deployed.

## ONE proposed local diagnostic (NOT EXECUTED)

**Preflight hard gate**: operator restores reachability of the **original** lab SSH host on the existing path; confirm approved single `127.0.0.1:11435` listener, `/api/version=0.40.11` (or explicitly requalify if changed), `/api/tags` exact Muse digest, and Ollama `/api/ps`. Verify read-only server journals, runner state, network ingress observation and GPU/RAM sampling are all actually accessible. **Do not launch if provider-side receipt and warm-runner execution markers cannot be captured.**

Then run **one** test-only Clack native Ollama **verifier-style** request on `muse-glimmer:30b`, using the existing ordinary self-hosted profile, production preflight/SSH forwarding/reqwest/SDK bridge, Automatic reasoning, genuine `get_probe_value` tool schema and unchanged timeouts. Prefer historical verified **49,152 context / 512 output** for bounded minimal tool verification; do not run the notes mission or artificially simulate model output. This tests the full local transport and real runner/tool stream, but **does not replay the large 18-tool/8,192-token Agent request** and a success cannot prove that the former high-load stall is fixed.

Coordinate a shared **monotonic/UTC timestamp window** (record host clock offsets), Clack `generationId` ↔ `nativeRequestId`, and precisely one active diagnostic HTTP `POST /api/chat` during an isolated interval. Collect only content-free stage/timestamp, PID/state, byte counters, numeric limits, finish/cancel and resource samples. Do not archive prompts, tool arguments, body, auth material or raw packets. Without a positive joined per-request Ollama receipt *and* execution-start marker, classify any stall as unlocalized, not as a proven transport or model defect.

| Outcome | Minimum independent proof needed |
| --- | --- |
| **A — no Ollama receipt** | Clack native send attempt **plus independently observed transport failure/absence with reliable complete ingress monitoring**. Mere lack of journal line is insufficient. |
| **B — received but scheduler/queue stall** | Positive Ollama handler receipt, accepted/queued marker, **no runner allocation/start**, matching scheduler queue/blocked events. |
| **C — runner started, no response** | Positive request receipt and runner-specific start marker, no internal completion/stream event before Clack deadline; correlate PID and absence of resource failure. |
| **D — resource pressure** | Positive host and runner resource observations **contemporaneous** with request plus associated OOM, allocation/eviction, extreme paging or GPU errors. Utilization alone indicates pressure but does not establish sole causation. |
| **E — completed normally** | Ollama execution progress/completion, Clack HTTP headers/first chunk/`done`/EOF, verified native tool call and normal SDK settlement. |

**Stop instead of running** if the tunnel remains down, current digest differs, no independent ingress/admission/runner marker exists or sampling cannot be obtained. No generic Clack instrumentation or Ollama configuration change is justified until the exact missing server-side proof is obtained.

## Conclusion

Current missing measurements are: **live lab access**, **positive HTTP ingress receipt**, **scheduler queue/admission**, **warm-runner execution start/progress**, and **concurrent resource samples**. The historical evidence does not prove a concrete Clack defect, Ollama defect, SSH/TCP failure or hardware pressure. The next useful operator action is restoring the pinned lab link and establishing content-safe Ollama-side ingress/runner markers before authorizing one correlated local diagnostic.

**Recommendation: `LOCAL OLLAMA PROVIDER TELEMETRY STILL INSUFFICIENT`.** Muse's local acceptance remains blocked; no other model, full notes acceptance, ForgeBoard or hosted fallback is authorized.
