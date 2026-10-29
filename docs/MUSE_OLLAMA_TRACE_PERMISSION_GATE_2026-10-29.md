# Muse local Ollama v0.40.11 TRACE diagnostic — blocked before service change

**Starting Clack HEAD:** `f70bbc0e5860231325344cedb7250d86b4e5f905`.

**Preserved local acceptance classification:** `LOCAL ACCEPTANCE BLOCKED BY RUNTIME RELIABILITY`.

**Diagnostic classification:** `LOCAL OLLAMA FAILURE STILL UNRESOLVED` — **no target diagnostic was run**. The prerequisite for safe temporary systemd TRACE enablement was missing.

**No hosted model, local calibration/verification inference, full notes acceptance, ForgeBoard, service restart, systemd edit, firewall/proxy edit, source-policy modification, settings write, reset/clean or push occurred.**

## Live starting environment (independently verified)

| Item | Actual read-only observation |
| --- | --- |
| Approved SSH forwarding | `127.0.0.1:11435` to the original lab `127.0.0.1:11434`, original pinned host/identity |
| Windows tunnel process | `ssh.exe` **PID 3240**, sole approved loopback listener, observed alive |
| Ollama `GET /api/version` | **0.40.11** |
| Ollama `GET /api/tags` | **15** models |
| `muse-glimmer:30b` | Exact installed digest **`de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1`** |
| Ollama `GET /api/ps` | **0** loaded models |
| systemd service | `ollama.service`, active, user `ollama`, PID **1558** |
| Original ExecStart | `/usr/local/bin/ollama serve` |
| systemd fragment | `/etc/systemd/system/ollama.service` |
| systemd drop-in | `/etc/systemd/system/ollama.service.d/override.conf` |
| Configured environment variable names | **`PATH`**, **`OLLAMA_MODELS`** |
| `OLLAMA_MODELS` | **`/var/lib/ollama`** |
| `OLLAMA_HOST` | **Not explicitly set** in service environment; observed listening `127.0.0.1:11434` |
| `OLLAMA_DEBUG` | **Not explicitly set** in service environment |
| Other keep-alive, KV, GPU, context, flash attention, parallelism or loaded-model overrides | **Not explicitly set** in systemd service environment; runtime defaults not changed |

**Pre-change, byte-level file fingerprints:**

- Unit SHA-256: `e65cda8b2426dc30e876899dce98ac4cf6d7ff138c529ef19692f39692142e06`
- Drop-in SHA-256: `813fb1433d898cf01162e6b70ec8f10beb1e02575761737283b021bf0220a80a`

The installed Ollama CLI also self-identified as version `0.40.11`. These fingerprints and sanitized environment-name checks were gathered before **any** attempted service mutation. They are evidence for future rollback comparison, not evidence that a changed service was later restored; the service was **never changed**. The process-private `/proc/<pid>/environ` was not dumped or disclosed, and the systemd fields do not prove the entirety of the private process environment. No secret material was printed.

## Exact debug setting (verified without model inference)

The **tagged Ollama v0.40.11** `envconfig.LogLevel()` documentation specifies:

- unset / `0`: **INFO**
- `OLLAMA_DEBUG=1`: **DEBUG**
- `OLLAMA_DEBUG=2`: **TRACE**, required for `logutil.Trace` scheduler markers such as `processing incoming request`.

Primary versioned sources:

- https://pkg.go.dev/github.com/ollama/ollama@v0.40.11/envconfig#LogLevel
- https://pkg.go.dev/github.com/ollama/ollama@v0.40.11/logutil
- Scheduler trace marker: https://github.com/ollama/ollama/blob/main/server/sched.go (source at `main` is contextual; it is not a substitute for live 0.40.11 trace proof).

`OLLAMA_DEBUG_LOG_REQUESTS` is a **different** opt-in setting that logs inference bodies/replay commands; it was not enabled and must remain disabled. Caution: TRACE may include decoded token content or other sensitive internal material; any future TRACE session needs appropriate log handling, bounded retention, and content-safe evidence extraction. The current task did not generate any TRACE logs or prompts.

## Privilege/rollback blocker

The approved lab SSH identity is sufficient for read-only `systemctl show`, `journalctl`, Ollama metadata, `nvidia-smi` and system resource checks, but **`sudo -n true` did not succeed**. No noninteractive privileged systemd edit/restart and **no guaranteed byte-identical or semantically exact rollback** could be established for this account. An additional privileged-policy inspection was blocked; it was not bypassed or retried.

Because this was an explicit **rollback-required** temporary logging experiment, the correct hard-stop point was **before writing any override**. In particular:

1. `OLLAMA_DEBUG=2` was **not set**.
2. The daemon was **not restarted** or reconfigured.
3. **No** TRACE scheduler-entry marker was observed or asserted.
4. **Zero** prerequisite calibration requests and **zero** target `get_probe_value` verifier requests were made.
5. No Clack native request ID, generation ID, HTTP dispatch, headers/chunk/done/EOF, provider cancellation, GPU/VRAM timeline, RAM/swap timeline or verdict from a new inference exists.
6. No restoration was required, since the service configuration was never changed. Post-audit hashes and normal settings/service state should remain at the baseline.

The last **historical** 120-second `inference-30` no-header stall therefore remains unattributed: transport versus scheduler versus runner versus resource pressure cannot be localized from this task.

## Exact next operator prerequisite

Have an authorized lab administrator arrange a **narrowly scoped, noninteractive, auditable systemd logging-only change and reversal**, with original unit/drop-in content safeguarded, and verify that TRACE is both visible and content-safe **without** sending any model generation. Only then obtain authorization for one normal Clack local Muse verification (calibration only as required), observing provider scheduler/runner request stages and synchronized GPU/RAM. Use the original pinned SSH forwarding path and unchanged inference parameters. Never request a root password or user credential through Clack or this report.

**Outcome:** `LOCAL OLLAMA FAILURE STILL UNRESOLVED`. This is an **unexecuted diagnostic due to a service-privilege prerequisite**, not a model/Agent failure, missing TRACE implementation, or failed test request. No stronger claim is supported.
