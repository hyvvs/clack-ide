# Muse unprivileged parallel Ollama TRACE feasibility — safe server, no inference

**Starting HEAD:** `95492ca94aedfc7b50b210bb9bec47f8b7fb989a`.

**Local acceptance remains:** `LOCAL ACCEPTANCE BLOCKED BY RUNTIME RELIABILITY`.

**Diagnostic classification:** `LOCAL OLLAMA FAILURE STILL UNRESOLVED` (**no inference or verifier was run**).

**Separate-server feasibility:** **PASS** for unprivileged daemon startup, read-only shared Muse model access, dedicated loopback port, process-scoped TRACE and preservation of the existing system daemon. **Synchronized-resource evidence gate:** **BLOCKED** — an attempt to install the bounded remote sampler was rejected by the execution tool's safety check. Do not interpret this as an Ollama, Clack, scheduler or model failure.

## Original, verified production environment

| Protected fact | Entry | Exit |
| --- | --- | --- |
| Existing Ollama 0.40.11 system service | active, PID **1558** | active, **same PID 1558** |
| Existing system Ollama endpoint | lab `127.0.0.1:11434` | same, listening |
| Windows original pinned SSH forward | `127.0.0.1:11435`, PID **3240** | same, healthy |
| Version, installed models | **0.40.11**, **15** | same |
| Muse model | `muse-glimmer:30b` | same |
| Muse SHA-256 digest | `de878ce33ad81d060001db1469a02eebe4d86f0ad58cfe52dc062fdcbe4464c1` | same |
| Loaded system model | **0** | **0** |
| Model store | `/var/lib/ollama` | same |
| System service `OLLAMA_DEBUG` | unset | unset |
| Unit SHA-256 | `e65cda8b2426dc30e876899dce98ac4cf6d7ff138c529ef19692f39692142e06` | unchanged |
| Existing drop-in SHA-256 | `813fb1433d898cf01162e6b70ec8f10beb1e02575761737283b021bf0220a80a` | unchanged |

The original unit, drop-in, systemd environment, service process, model store configuration, SSH identity, host-key pin and existing port were not modified.

## Read/use safety audit (before launching)

Approved SSH user `hylab` could execute the installed `/usr/local/bin/ollama` binary and `ollama --version` reported **0.40.11**. The actual configured model store is **`/var/lib/ollama` itself**, with `blobs/` and `manifests/` directly below it (not `/var/lib/ollama/models`).

The user's Unix access checks showed:

- Muse manifest readable; each of its **5** referenced blobs exists and is readable.
- **0** user-writable files and **0** user-writable directories anywhere under `/var/lib/ollama`.
- **9** model-store symlinks, **all** resolving inside that store, none broken.
- The `hylab` process could not write any referenced Muse blob, model manifest, model-store file or directory. No chmod, chown, ACL, copy, model download, pruning or service mutation was performed.
- The alternate lab listener `127.0.0.1:11436` was vacant before launch. No existing runner was loaded.

This proves a file-permission barrier against **this user-owned process writing to the shared model store**. It does not independently exclude unrelated system-service modifications at arbitrary times, nor establish whether Ollama would attempt and fail a store write during a future model load (no model was loaded).

## Temporary process-scoped TRACE (without inference)

Started **one** user-owned `ollama serve` as **PID 5833**, with only these three added environment variables scoped to this process:

```text
OLLAMA_HOST=127.0.0.1:11436
OLLAMA_MODELS=/var/lib/ollama
OLLAMA_DEBUG=2
```

The service was bound exclusively to the lab loopback `127.0.0.1:11436`. Its stdout/stderr was redirected into an exclusive, owner-only (`0700` directory, `0600` file) diagnostic root `/tmp/clack-muse-parallel-trace-20261029-01/`. Startup captured **7 TRACE** and **72 DEBUG** messages (counts at observation); this demonstrates that TRACE verbosity can be enabled **without privileges** and without touching systemd. A scheduler *incoming-request* marker was **not expected or observed**, because no inference request was sent.

The diagnostic daemon's `GET /api/version` and `GET /api/tags` independently reported **0.40.11**, **15** models and the identical full Muse digest. The original service remained active at PID 1558 and its unit and drop-in hashes matched.

Added one **separate** strict, pinned Windows SSH loopback forward **PID 42656**: local `127.0.0.1:11436` → lab `127.0.0.1:11436`; never changed the original `11435` forward.

The temporary diagnostic log SHA-256 before cleanup was `fc1e2900f5eb2739320981194e414de6dc6ecb2d6fae7d1066df0562594e2519`. Raw logs were not copied to the repository (they can contain sensitive internal content if inference occurs).

## Isolated normal Clack verifier preparation — never executed

Inspected the existing test-only `r5dh` harness and verifier. Its production route invokes the normal `calibrateModelContext` and `verifyModelTools`; the Tauri native acceptance host enforces at most **7** normal calibration requests (`num_predict=32`, tier ladder through **73,728**), followed by **one** genuine `get_probe_value` request exactly at **`num_ctx=73728` / `num_predict=512`**, using Automatic reasoning with omitted `think` and normal native inference IPC. It rejects a second verifier, Agent-shaped requests, other models and altered output controls.

A **task-owned, test-only** copy of the existing JS harness was created for an exclusive root `museparalleltrace-20261029-01`. It retained the protected original source-settings SHA assertion and added a guarded step that **would have derived** an isolated settings copy with the **only semantic difference being the existing endpoint URL** `http://127.0.0.1:11435/` → `http://127.0.0.1:11436/`. That script was **never executed**, so no such modified settings copy was actually written. The operator's saved profile and all production files were untouched. The test-only script passed `node --check`; an empty, isolated Git-only workspace was created.

**STOP before the first calibration:** a synchronized, bounded lab-side sampler for GPU/VRAM, `/proc/meminfo`, swap paging, system and diagnostic PIDs, runner PIDs and read-only `/api/ps` was not installed because its remote execution request was **blocked by safety checks**. There was no attempt to bypass that block. Without the resource timeline and joined scheduler/runner stages required by the user's five-way classification, firing the authorized verifier would risk producing another uninterpretable observation.

**Actual dispatch counts:** calibration **0**, verifier **0**, Agent **0**, notes **0**; **no** HTTP `POST /api/chat` or `POST /api/generate`. Thus there is no target request ID, Clack dispatch/`reqwest.send()` interval, scheduler admission, runner start, first output, done/EOF, cancellation or GPU/RAM *during-inference* timeline for this task. No successful diagnostic or newly established runtime defect is claimed.

## Mandatory cleanup: completed

1. Verified PID **5833** belonged to `hylab` and was `ollama`; sent **SIGTERM** to this temporary server only.
2. Verified PID 5833 no longer exists; alternate lab port **11436** no longer listens and no diagnostic runner remains.
3. Verified Windows SSH PID **42656** matched the exact diagnostic `11436 → 11436` forward; terminated **only** that process. Local diagnostic port 11436 closed.
4. Removed the three precisely identified owner-only temporary files and the now-empty task-owned remote diagnostic directory. No generic directory cleaning or system-service operation was performed.
5. Deleted only the unexecuted test-only harness clone and its exclusive Git-only scratch workspace, after verifying no unexpected files existed. The original harness SHA-256 is unchanged: `8660fe6390ebc331f6bb50bcf7f7090680472a9eb6eebc4d1ed5e1897c25aef5`.
6. Post-cleanup live service is **active at original PID 1558**, original unit/drop-in hashes match, `OLLAMA_DEBUG` remains unset, `OLLAMA_MODELS=/var/lib/ollama`, system port 11434 listens, Ollama **0.40.11**, **15** models, exact original Muse digest, **0** loaded models, **0** runner processes, and the approved original forwarding **PID 3240** remains healthy.

**Final assessment:** unprivileged parallel TRACE daemon infrastructure is *feasible*; fully correlated inference is **not yet established**. The frozen Muse `inference-30` 120-second no-header root cause remains unknown. `LOCAL OLLAMA FAILURE STILL UNRESOLVED` (diagnostic not executed). This does **not** change the pre-existing acceptance classification or authorize another model, full notes mission, ForgeBoard, or hosted control.
