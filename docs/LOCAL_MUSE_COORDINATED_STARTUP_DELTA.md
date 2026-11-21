# One-Muse root startup: mechanically grounded pre-admission delta

This is **not** another standalone kernel qualification. The final kernel-only
run `muse-one-cc906e5f03958f17e864f0fa` passed
`TCPARMED=PASS` and
`KERNEL_GATE_READY_FOR_COORDINATED_DIAGNOSTIC=true`; that proof is accepted
and CLOSED. The first narrow-sudo coordinated attempt
`muse-one-dc2b2ba79d266e6aa84b6b1b` failed at **fresh source
readiness** before any HTTP/model request.

Evidence categories: **observed** is a retained contemporaneous receipt,
**source-derived** means exact local argv/config or a pinned hash, and
**unknown** means the failed run did not retain that observation.
Source-derived equivalence is deliberately not represented as live proof.

| Field | Successful kernel-only | Failed coordinated | Evidence / delta |
| --- | --- | --- | --- |
| Root wrapper | Temporary root-owned `/run/local-muse-ebpf/<run>/local-muse-one-root.sh`, installed from reviewed user stage and hash checked | `sudo -n /usr/local/libexec/clack-one-muse-root --run <run> 1658`, installed root:root mode 0755, creates root-owned temporary child script | **Observed** exact coordinated command in the lab sudo journal; different launch wrapper |
| Collector shell SHA-256 | `69ad979c5f5cd73cdc3ba5e4e29bafea4dbd278055e27dc6028b2d36fd682137` | Same pinned installed asset SHA | **Source-derived** both files pinned; coordinated execution bytes not separately retained |
| Collector Python SHA-256 | `eed450245218a9cbf02bacdbe4d08c5dc071636e5ca61904aac5f7a4e72c24df` | Same pinned installed asset SHA | **Source-derived** no source upgrade |
| Hardened support SHA-256 | `d22c0994402744a6a978d4a8d53b140d9d6c0780a316e54f9d8c7c7c85e014cf` | Same | Exact source pins |
| Probe SHA-256 | `e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0` | Same | Exact source pins |
| bpftrace executable | `/usr/bin/bpftrace`, SHA-256 `a2208280ef0f694e8f4d3f81fe100bc2d3e4668d745a3b8c6510bf0d5f0a240c`, `v0.27.0-872e7a56a` | Same pinned path/hash/version *required by source*, **not live-observed** in failed startup | Successful audit observed attach 4, BEGIN 1, tracer exit 0; failed run has no persisted tracer PID or BEGIN count |
| bpftool | Private `/opt/clack/diagnostic-tools/bpftool-678d538`, SHA-256 `0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0` | System `bpftool` via trusted root PATH (`fixed_bpftool_mode=normal`) | **Concrete mode difference** in reviewed collector startup; failed run did not preserve the actual binary path/hash or even proof inventory started |
| Ollama target | PID 1658, target identity stable per successful root audit | PID 1658 submitted to sudo wrapper; mapping ACK ready; process verified as Ollama service after run | PID same; exact process start-time at failure **not durably retained** |
| Run ID | `muse-one-cc906e5f03958f17e864f0fa` | `muse-one-dc2b2ba79d266e6aa84b6b1b` | Both match `^muse-one-[a-f0-9]{24}$` |
| Duration | 20 seconds; root watchdog 26 seconds | 1800 seconds; root watchdog 1806 seconds | Distinct fixed modes; no arbitrary duration passed to narrow wrapper |
| Collector argv | `--pid 1658 --seconds 20 --ready-fd 3 --control-fd 0 --inventory-audit-fd 4 --fixed-diagnostic-bpftool` | `--pid 1658 --seconds 1800 --ready-fd 3 --control-fd 0 --inventory-audit-fd 4` | Source-derived; the failed process argv was **not captured** |
| Environment | Original interactive SSH/sudo bootstrap environment, source supervisor enforces pinned tracer env | Root launcher clears environment to `PATH=/usr/bin:/bin`, `HOME=/nonexistent`, `LANG=C`, `LC_ALL=C`; tracer also pins its own env | Launch difference; tracer env pinned in both collectors |
| Current working directory | Original sudo/Bash working directory not persisted; root shell uses absolute collector paths | Narrow wrapper calls `os.chdir('/')` before launching root shell | Distinct source-derived cwd; original cwd is **unknown**, not assumed |
| Root stage | `/run/local-muse-ebpf/<successful-run-id>`; root:hylab 0710, files root:root 0600 | Same directory template and ownership/mode rules with failed run ID; root creates stage itself | **Source-derived** on failed run; it was absent after cleanup |
| FIFO paths | `control.fifo`, `ready.fifo`, `metadata.fifo` below owned stage | Same exact per-run FIFO names | Source-derived; failed run did not retain a FIFO-open receipt |
| Reader/importer order | Both SSH FIFO readers and Node importer start before operator handoff | Same `createOneMuseKernelBridge` source | Source-derived, but old coordinated run **did not persist reader/importer PIDs or exit status** |
| stdout/stderr | Root shell exports content-free `KERNEL_AUDIT_*` and operator audit file to the user stage; successful numeric audit retained | Original narrow PowerShell launch discarded stdout and Node deliberately discarded stderr; only overall gate failure persisted | **Demonstrated coordinator instrumentation defect** corrected by run-owned, fsynced content-free journal |
| Process group/session | Interactive SSH sudo starts root Bash; inner tracer uses `start_new_session=True` | Narrow root Python starts root Bash with `start_new_session=True`; inner tracer also requests its own session | Source-derived; missing root/collector/tracer PIDs in old failure |
| STOP | Root-created root:hylab control FIFO, mode 0620; successful STOP received 1 | Same FIFO/STOP contract; failed run never armed source, optional STOP cleanup only | Successful STOP **observed**, failed STOP channel not observed armed |
| Ready FIFO | Successful audit `READY_FIFO_WRITE_ATTEMPTED=1`, `READY_FIFO_WRITTEN=1`, `MATCHING_BEGIN_COUNT=1` | No coordinated FIFO receipt; source failed at Unix ms `1794446274271` after clocks ACK | Actual missing acknowledgment, cause not determined by old journal |
| Remote SSH bounds | Root qualification one-shot launcher, bridge ready reader 130s, metadata reader 1810s | Same bridge reader bounds; 180s coordinated arm timeout, new root session watchdog 1806s | Source-derived; failed run ended after ~3.1s from clocks ACK, **not** the 180s deadline |
| Cleanup | `OPERATOR_EBPF_CLEANUP=PASS`, `task_owned_cleanup=pass` | Session `partial`, owned stage absent and local 11435 listener absent after cleanup | Stage cleanup observed; old wrapper child exit codes were not persisted |
| Privilege boundary | One interactive sudo, freshly root-installed reviewed child scripts | Narrow hash-pinned `sudo -n` exact wrapper, zero prompt | Lab sudo journal proves the exact root command was admitted; this is not a sudo-authentication failure |

The existing standalone qualification result is not reinterpreted. The
actionable new issue was the coordinator's loss of early wrapper and FIFO
exit reasons. This is now corrected **without changing the installed
root wrapper, collector source, bpftool choice, or trust matcher**:
`coordinated-startup-audit.jsonl` is created with `wx` and fsynced for
each bounded status; it joins root-wrapper exit/closed-vocabulary stderr,
SSH FIFO reader/importer readiness and exit, optional STOP, and sampled
task-owned remote PIDs. Unobserved PID/state fields remain explicitly
unobserved; no synthetic proof is substituted.

## Two newly authorized pre-admission attempts with durable diagnostics

**Attempt 1:** `muse-one-96b2f1c24ff5565b3864c6cf`, no
request. The fsynced journal observed coordinated root shell PID 79829,
collector PID 79869 and tracer PID 79912, each with a numeric parent PID.
Its root stderr had exactly 30 safe audit lines and zero unrecognized lines.
The tracer attached four probes and emitted one matching BEGIN, but
`READY_FIFO_WRITTEN=0` and `OPERATOR_EBPF_EXIT=1`. The ready FIFO
reader received 13 bytes classified as `TCPABORT`, and the importer exited
1. This proved a further instrumentation defect: of the 30 safe root audit
rows only a subset was retained, omitting the real error classification.
The exact allowlisted scalar capture was expanded and tested offline,
without changing root assets, matcher or trust.

**Attempt 2:** `muse-one-c62da00dc9400cc57e07777b`, no
request. The full 30 closed-vocabulary root audit lines now prove:

| Exact root audit field | Observed |
| --- | --- |
| `NATIVE_ATTACHED_FOUR_COUNT` | 1 |
| `MATCHING_BEGIN_COUNT` | 1 |
| `WRONG_BEGIN_COUNT` | 0 |
| `BPF_UNRECOGNIZED_STDERR_BYTES` | 0 |
| `NEW_TARGET_PROGRAM_COUNT` | 0 |
| `NEW_VALID_SESSION_LINK_COUNT` | 0 |
| `SESSION_LINK_INVENTORY_ERROR` | `CalledProcessError` |
| `KERNEL_INVENTORY_ERROR` | `CalledProcessError` |
| `SOURCE_INVALID` | 1 |
| `READY_FIFO_WRITE_ATTEMPTED` | 0 |
| `READY_FIFO_WRITTEN` | 0 |
| `TARGET_IDENTITY_STABLE` | 1 |
| `TRACER_EXIT` | 0 |
| `OPERATOR_CHILD_EXIT` | 1 |

`inventory_snapshot()` raises `CalledProcessError` when the exact
`bpftool -j prog show` or `bpftool -j link show` command exits nonzero.
The separately observed session-link failure proves that **the live
production bpftool link-inventory call returned nonzero** while tracer
attachment and BEGIN succeeded. No invalid inventory was accepted as
readiness; `TCPABORT` and the partial unsealed session are correct
fail-closed behavior.

The concrete source/production mismatch is the root-owned, 1800-second
script's `fixed_bpftool_mode=normal` system-tool selection, whereas the
successful 20-second qualification used the privately SHA-pinned bpftool.
The installed Python source prohibits `--fixed-diagnostic-bpftool` for
sessions longer than 20 seconds. The installed assets, wrapper digest and
sudoers command are immutable by hash and ownership. The narrow permission
accepts **only** `--self-check` and `--run <run-id> <current-Ollama-PID>`;
it cannot upgrade assets, alter tool choice or invoke an installer.

The third optional pre-admission attempt is deliberately **not run** with
the unchanged, known-failing immutable production mode. Changing production
tool selection safely requires a separately reviewed and repinned root
deployment, which is outside the explicit no-bootstrap/no-operator-command
authorization. The standalone qualification stays accepted and closed.
There was no inference admission, so no A–G stream classification,
ForgeBoard Agent mission or frozen evaluator is claimed.

## Authorized production root repin and sole final coordinated attempt (2026-11-12)

The preceding restriction on root repinning was superseded by explicit
authorization for one versioned, narrowly scoped production installation.
The live lab wrapper is SHA-256
`bdba04eb0952a2cd4c1e9f77f645be716b6ef220e124045d0e0f630ddee77260`;
the selected private bpftool is
`/opt/clack/diagnostic-tools/bpftool-678d538`, SHA-256
`0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0`.
Independent noninteractive `sudo -n` self-check passed before and after
the coordinated run. The standalone sources and qualification were not changed.

**One final attempt and one admitted request:** run
`muse-one-f1d94ee5ea9bbcbc53ca94ff`, UTC
2026-11-12 02:38:35–02:49:03. The fsynced lifecycle contains nine
`gate/ready` receipts, `session/admission/ready`, and exactly one
`request/allowance/consumed`. The native/WebView path invoked one enabled
button and recorded exactly one `native-dispatch`, request
`inference-1`. There was no retry, fallback, continuation or second request.

**Root evidence:** private selection `bpft_diagnostic_selected=1` and
`bpft_binary_sha256=0e005912...`; `native_attached_four_count=1`,
`matching_begin_count=1`, `wrong_begin_count=0`, `end_count=1`,
`new_target_program_count=1`, `new_valid_session_link_count=1`,
`inventory_record_count=246`, `session_link_inventory_error=none`,
`kernel_inventory_error=none`, `source_invalid=0`,
`control_stop_received=1`, `tracer_exit=0`, `operator_child_exit=0`.
This confirms the specific system-bpftool blocker was fixed without skipping
link/program inventory.

**Request boundary observations, not aggregate inferences:**

| Boundary | Run-owned measured observation |
| --- | --- |
| Clack native dispatch / headers | Exactly 1 each, request `inference-1` |
| Clack native body read | 1,651 **recorded** chunks, 236,402 bytes; last **retained receipt** Unix ms `1794451310985` |
| Native IPC -> WebView IPC -> WebView stream enqueue | Each 1,651 observed chunks / 236,402 aggregate bytes; the unsealed journal cannot certify an exact one-to-one sequence join |
| Semantic progress | 1,585 `native-semantic-progress` receipts (zero `bytes` is by the schema's design) |
| Remote Ollama socket `11434 -> 36810` | 3,557 `socket-write-return` receipts, 517,278 returned bytes, all `result=ok`; last at Unix ms `1794451511227` |
| Socket writes after Clack's last **recorded** native read | 1,943 successful return receipts / 276,144 bytes, up to 200,242 ms after that receipt; no conclusion about later unrecorded reads |
| Terminal evidence | SDK/broker ledger records `request/terminal/completed`; journal has **no** `native-terminal`, `native-provider-done`, `native-eof` or `webview-settled-received`; lifecycle ends `session/completion/partial` |

There are also four early Ollama write returns on a **different** socket,
remote port 36804; they are not conflated with the 36810 response candidate.
The kernel-side socket capture has `confidence=unavailable` for direct
request-to-socket attribution. The run does **not** contain independently
verified local forwarded TCP byte arrivals or per-request SSH delivery proof.
Successful remote socket write returns do not themselves establish arrival
at the Windows endpoint. The collector's metadata reader exited 0, but its
importer received `stdin_error` and was terminated with `SIGTERM`, so
the strict kernel source terminal check failed; the other native/semantic/
WebView source terminal checks were also missing. The session correctly
remained **partial/unsealed** despite the SDK-level completed receipt.

**Admitted stream classification: G — evidence cutoff, no demonstrated
application/transport stall.** Offline follow-up established a decisive
observation defect. Counting only `host=clack-native` and
`host=clack-webview` in the immutable run journal gives **exactly 8,192**
rows, matching the original `installLocalDeliveryCapture(persist, 8192,
state.runId)` bound in `src/test/localMuseOneDiagnostic.tsx`. Its last
retained Clack receipt is exactly the point when the capture allowance
was exhausted. The observer intentionally drops subsequent rows and marks
its local coverage incomplete; the downstream silence is therefore
**measurement saturation, not established reqwest/WebView inactivity**.

The remote Ollama socket write evidence remains genuine, but cannot be
joined directly to later local TCP delivery or a particular unobserved
Clack read. **C, D, E and F are all unproven**; the only sound A–G
classification remains **G**, because required post-admission boundaries
were no longer observable. In particular, comparing the last **recorded**
Clack read to later root writes cannot establish C-versus-D stall, and
it was incorrect to call that difference a verified client read gap.
The missing kernel terminal is a separate strict importer/drain issue.
The installed root collector holds validated `TCPMETA` rows until after
STOP, END and terminal inventory checks (the private production collector's
single `nonblocking_write(stdout_fd, ...)` after `summarize_trace`).
This run's **7,122 socket rows** enter the durable journal starting at
sequence **8,209**, after the 8,192 recorded Clack events. The metadata
SSH reader eventually closed successfully, but the importer received
`stdin_error` and was terminated by `SIGTERM`. The bridge had only **15
seconds after STOP** to wait for that final bulk import, including the
root shutdown; no `shutdown` success marker or terminal proof can be
invented for the historical run.

**Offline correction only, after the exhausted live allowance:**
`src/modules/ai/lib/localDeliveryObserver.ts` exports a bounded,
one-Muse-specific `ONE_MUSE_CLACK_CAPTURE_LIMIT=48_000`; the isolated
diagnostic host now uses it. The global 65,536-row delivery journal
still reserves 17,536 rows for the strict kernel importer, source
receipts and shutdown, and refuses overflow or unverified terminal
capture. The normal observer's default remains 8,192; this change does
not alter inference, kernel trust, session proof, network timeouts or
production root assets. A regression emits 8,192 numeric body receipts
and then an additional terminal receipt; all 8,193 are acknowledged,
with zero loss.

The unprivileged JavaScript kernel bridge now has a **75-second bounded
post-STOP importer drain** instead of 15 seconds. Root collector runtime
(1,800 seconds), STOP authorization, kernel matcher/inventory, HTTP
timeouts, and the A–G evidence requirements are unchanged. The bridge
still fails closed unless both SSH metadata reader and importer exit 0,
the importer emits exactly one valid post-EOF terminal receipt and the
journal has exactly one verified kernel completion with zero loss. An
offline import of **3,557 synthetic send pairs** (7,114 socket rows and
one strict TCPSESSION terminal), using the real Node importer and
fsynced loopback journal, completed in **14.929 seconds** under the
75-second bound. This supports why a 15-second post-STOP allowance
was insufficient for the original batch plus root shutdown; it is
**not** a substitute for new real kernel proof.

Both offline corrections passed **14/14 Vitest tests, 36/36 Node tests**
and a TypeScript no-emit type-check. No inference, SSH capture or BPF
attachment was performed.

No replacement inference run is authorized or performed, so this
code-only fixes have **not** been validated against a new real stream.
F is not established, so **no ForgeBoard Agent mission** was run.
No frozen evaluator was run. The remaining coordinated allowance is zero.

Run-owned source records:
`src-tauri/target/local-muse-one-evidence/muse-one-f1d94ee5ea9bbcbc53ca94ff/`
(`session-lifecycle.jsonl`, `coordinated-startup-audit.jsonl`,
`delivery/local-muse-delivery-muse-one-f1d94ee5ea9bbcbc53ca94ff.jsonl`).
After teardown, the remote task-owned stage and local port 11435 listener
were absent; narrow `sudo -n --self-check` still passed.
