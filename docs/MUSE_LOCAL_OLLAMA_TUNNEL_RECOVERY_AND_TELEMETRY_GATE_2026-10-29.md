# Local Muse Ollama tunnel restored; provider correlation gate still unmet

**Starting Clack HEAD:** `9a596212e75a8798fb3f9e68a3c41983782f2513`.

**Preserved local acceptance:** `LOCAL ACCEPTANCE BLOCKED BY RUNTIME RELIABILITY`.

**Next recommendation:** `LOCAL OLLAMA PROVIDER TELEMETRY STILL INSUFFICIENT`.

This is a local-only, read-only Ollama environment and observability recheck after the operator reported that the original lab endpoint should be reachable again. No model inference, verifier request, notes acceptance, ForgeBoard, hosted access, Ollama service modification, shell write to the lab, settings modification, production code change, or alteration of frozen evidence was performed.

## Live approved tunnel and model identity

- Starting with **0** SSH processes and **0** listeners on `127.0.0.1:11435`, independently verified existing original `%USERPROFILE%/.ssh/clack_hylab_ed25519` and pinned `known_hosts` entry for the previously approved lab host.
- The previously unavailable original lab TCP/22 endpoint now passed a bounded read-only connection check.
- Restored **exactly** the documented existing SSH forward: localhost `127.0.0.1:11435` → lab `127.0.0.1:11434`; `-N -T`, original identity and `UserKnownHostsFile`, `BatchMode=yes`, `StrictHostKeyChecking=yes`, `ExitOnForwardFailure=yes`, `ConnectTimeout=8`, `ConnectionAttempts=1` and documented keepalive settings. The single, hidden Windows `ssh.exe` owns the local listener under **PID 3240**. No alternate tunnel or host network change.
- Fresh read-only requests to `GET /api/version`, `GET /api/tags`, `GET /api/ps` through this tunnel returned **Ollama `0.40.11`**, **15** installed tags, and precisely one `muse-glimmer:30b` with full digest `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`. `/api/ps`: **0** loaded models.
- These current facts agree with the historical Muse R5di provider identity. No `POST /api/chat`, `POST /api/generate`, model load or installed-model modification was performed.

## Live provider-side evidence accessibility

Read-only, strictly host-pinned SSH command diagnostics confirmed:

| Provider / OS evidence | Live result |
| --- | --- |
| `systemctl is-active ollama` | `active` |
| Ordinary-user `journalctl -u ollama` | Readable, last **1,000** service entries inspected through bounded local pattern/count analysis; raw log contents **not** copied into report |
| INFO / DEBUG / TRACE entries in sampled 1,000 lines | **36 INFO / 0 DEBUG / 0 TRACE** |
| Completed HTTP requests (`[GIN]`) | **85** historical entries in sample, including **16** lines referencing `/api/chat` |
| Runner activity | **45** `slot launch_slot_` references; `llama-server started` / `loaded runners` messages exist |
| Reliable HTTP **receipt-at-entry** event, scheduler/queue admission event | **Not observed** in sample; sampled `processing incoming request` and `llama-server completion request` counts both **0** |
| Request-to-runner correlation | No stable request identity joining a fresh Clack native request ID to an actual Ollama handler, queue and internal runner task at the current log level |
| NVIDIA GPU | RTX 4060 Ti; **16,380 MiB** reported VRAM; **430 MiB** used and **0% GPU compute utilization** in idle sample |
| Host RAM | **31,696 MiB** total; **28,075 MiB** available in idle sample |
| Swap | **31,695 MiB** total, **0 MiB** currently used; `/proc/vmstat` `pswpin=2`, `pswpout=152` cumulative at sample time |
| Ollama processes | One current `ollama` daemon (PID **1558**); **no** loaded runner at sampling |
| Lab listener | Ollama listening on lab `127.0.0.1:11434` |

Historical `[GIN]` access records represent *completed* requests, not positive real-time evidence that an uncompleted stalled request was received. `slot launch_slot_` demonstrates the runner performs work at other times but does not join a specific stalled Clack request to scheduler admission. No DEBUG/TRACE entries in the sample is evidence about current available logs, **not** proof that Ollama cannot generate additional diagnostics.

The existing Clack native trace and the opt-in generation-ID/native-request-ID correlation remain usable (request preparation, `reqwest.send().await` start, headers, chunks, provider done, EOF, cancellations, retry lifecycle, parser failures). However, the historical `inference-30` 120-second no-header gap still cannot be localized beneath `reqwest.send().await`.

## One diagnostic remains PREPARED, not executed

The prior runbook at `docs/MUSE_LOCAL_OLLAMA_PROVIDER_CORRELATION_GATE_2026-10-29.md` defines exactly one native Muse `get_probe_value` verifier request on the approved path, with **49,152 context / 512 output**, existing normal production preflight and no configuration/timeout changes. It was intentionally **not run**, because the explicit preflight requires proving the provider's HTTP request receipt, scheduling/runner start, and synchronized resource sampling can be associated with that very request.

The restored tunnel closes the earlier connectivity blocker and permits future resource and journal collection; it **does not** supply the missing ingress/admission marker. The ordinary sampled INFO logs and `/api/ps` do not reliably separate:

- **A:** request never reached Ollama;
- **B:** HTTP request reached Ollama but is queued/blocked before runner execution;
- **C:** runner accepted and started but made no progress;
- **D:** correlated CPU/GPU/RAM/swap pressure or allocation/OOM;
- **E:** normal completed body/done/EOF/native tool settlement.

Reliable stage separation requires an independently positive and per-request correlated **provider-side HTTP handler receipt + scheduler/runner task-start** signal, rather than inferring absence from no journal line. A narrowly scoped Ollama-side diagnostic/logging/trace capability and operator permissions would need explicit separate review before enabling it; **do not** change the service, start packet/ptrace monitors or adjust `OLLAMA_DEBUG` merely to force a run under this instruction. Existing renderer/Clack instrumentation need not be modified.

## Preservation and stop

No inference or acceptance result was generated, so Muse readiness stays `LOCAL ACCEPTANCE BLOCKED BY RUNTIME RELIABILITY`; no transport, scheduler, runner or resource defect has been established. The original six dirty tracked files, both Git stashes, `autonomous_tracker`, original settings, frozen 24 historical hashes, eight latest Laguna receipts and 14 R5di Muse evidence checks remain protected and unchanged.

**Only authorized environment operation:** restoration of the existing approved, strict SSH loopback forward, **PID 3240**, with no host firewall/proxy/routing or Ollama configuration changes.

**Single next recommendation:** `LOCAL OLLAMA PROVIDER TELEMETRY STILL INSUFFICIENT`.
