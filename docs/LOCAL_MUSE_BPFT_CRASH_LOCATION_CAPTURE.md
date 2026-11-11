# Private fixed bpftool: bounded SIGABRT location capture

**2026-11-11 status:** The prior observer (SHA-256 c5002328d5563c6af32559c4809940d9f89bfc78f330fe9e2022805bca4ac126) was installed and used in exactly one previously authorized kernel-only crash capture. That run reproduced SIGABRT through libc __assert_fail to an unknown immediate bpftool frame; it was intentionally unarmed, cleaned up and remains causally unresolved (G). A **new assertion-location enhancement is offline-only and NOT root-installed**. No new attachment, Muse, inference, Ollama HTTP, coordinator or readiness gate changes are authorized by this document.

## Evidence and available symbols

Both the packaged bpftool (PID 14356, 03:39:50 CET) and the privately fixed bpftool (PID 39679, 06:10:47 CET) aborted during live JSON link enumeration with SIGABRT / SI_TKILL. Their original 80-byte and 88-byte stderr messages were redacted. Systemd-coredump saved no core, no stack and no assertion; COREDUMP_RLIMIT was zero. The cause remains **G: unresolved**.

Read-only host inspection confirms:

| Item | Verified |
| --- | --- |
| Debugger | GNU GDB 18.1, /usr/bin/gdb, packaged 18.1-1.1 |
| Fixed bpftool | root:root 0755, 2,479,568-byte PIE, not stripped |
| SHA-256 | ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d |
| ELF Build ID | 8faee6f37ed17666af07f7d8f671bf40a9fd38e5 |
| Main ELF symbols | .symtab, .debug_info, .debug_line, other embedded DWARF present |
| Main functions | do_show_link and show_link_ifindex_json/plain; specialized kprobe-multi functions not separately visible, possibly inlined |
| libc | glibc 2.44, stripped; Build ID 141aba5f5a65e949c59aedb6fd3b267fcad54abf |
| libelf | elfutils 0.197, stripped; Build ID 109e9d93d05e231840c57131daa30b9bae3ef2e8 |
| Separate debug packages | No /usr/lib/debug directory; libc/libelf full source symbols unavailable |

Embedded bpftool DWARF can yield main executable function names and source lines. Exported libc/libelf symbols may still identify the module or abort function, without private memory.

## Capture design and strict export boundary

The only production command supported by scripts/clack-bpftool-abort-capture.py is the SHA-pinned **/opt/clack/diagnostic-tools/bpftool-678d538 -j link show**. The wrapper accepts no arbitrary CLI paths or arguments, checks root control and all path ancestors, the literal executable SHA-256, its exact GNU Build ID and GDB version before starting the inferior. There is no system bpftool or PATH fallback.

GDB is invoked with init-file loading, automatic scripts and debuginfod disabled. A task-private mode-0700 directory under /run holds a minimal GDB Python command file; both are cleaned after observation. The inferior uses a dedicated raw PTY, separated from GDB console output. Neither stream is copied verbatim to a file or exported.

GDB catches SIGABRT, traverses up to **12 symbolic frames** using the GDB frame API (never argument values), collects module and source metadata, forwards SIGABRT and observes the inferior-exited event. The debugger exit and GDB-observed inferior signal are recorded separately. GDB exit status is **not** treated as the native bpftool subprocess negative exit code.

Limits: **4-second** debugger/inferior watchdog; **8-second** outer collector watchdog; 32 KiB each for GDB stdout/stderr; 64 KiB for inferior PTY; 6,144 bytes maximum normalized JSON record. Only that GDB process group inherits **RLIMIT_CORE=0**. On timeout or overflow, the entire debugger group is killed, reaped and its temporary script removed. No global coredump setting or raw core is created.

Only these bounded fields are exported: capture state PASS / FAIL / TIMEOUT; executable SHA-256, ELF Build ID and GDB version; signal and GDB forwarding/exit evidence; debugger and ordinary child exit status; optional strictly allowlisted libc error or redacted C assertion category; up to 12 frame indices, sanitized function names, module basenames, optional module build IDs and source basenames/lines; bounded stream byte counts and hashes; timeout and cleanup status.

**Offline assertion-location enhancement (not deployed).** On GDB's immediate non-libc caller below __assert_fail, the observer calculates a strictly bounded numeric module-relative program counter using only the inferior executable's entries in its own /proc/PID/maps metadata. The saved caller PC is adjusted back one byte for the call site. A nearest safe symbol and function offset may be recovered from GDB symbol metadata; DWARF can supply source basename and line, and up to four GDB inline frames may be retained. Unknown symbols/offsets remain unresolved. Raw absolute addresses, memory, map lines, register contents, locals, arguments and raw debugger commands are never exported.

A strict single-line ASCII assertion parser now optionally exports **assertionLocation** (executable module, source basename ending .c or .h, positive line number and C function) only when the diagnostic matches the approved bpftool libc assertion envelope. The **assertion expression is always redacted**, even if it contains a plausible symbol or a private path. No raw stderr is exported. The collector separately revalidates the new closed-vocabulary fields; the former 4-second watchdog, maximum 12 stack frames, RLIMIT_CORE=0 and fail-closed link/readiness behavior are unchanged.

Never exported: registers, addresses, raw debugger transcript, process arguments unrelated to the fixed command, arbitrary stderr, stack values, memory, prompts, credentials, generated text, HTTP bodies or raw core bytes. Unknown/malformed output is rejected. Function/module/source fields pass narrow syntax checks; directory paths are discarded.

## Explicit future integration: **diagnostic only, unarmed**

The collector source scripts/local-muse-one-ebpf.py recognizes an additional --capture-live-link-abort flag **only** with --fixed-diagnostic-bpftool and a maximum-20-second session. It verifies the root-owned wrapper path and exact script SHA **before** bpftrace starts; if missing or modified, the setup fails. The short root shell and interactive operator expose the switch only via the optional -CrashCapture parameter; the production default and original four-file staged source set remain unchanged.

The first LIVE link enumeration is observed under GDB **instead of** normal bpftool JSON link inspection. All baseline program/link and live program inventories retain their original direct bpftool path. The observer record goes through a second strict closed-vocabulary validator into the root inventory audit. A closed-vocabulary KERNEL_AUDIT_CRASH_CAPTURE=PASS/FAIL/TIMEOUT status is also emitted. GDB stdout is never parsed as link JSON, and the debugger's exit status is never translated into a native -6 status. The collector deliberately raises a diagnostic-only error afterward, regardless of observer success or normal child exit; this leaves SOURCE_INVALID true, READY FIFO unwritten, and the importer unarmed. No link owner, hook or terminal readiness proof is weakened. Existing STOP/terminal/cleanup paths remain fail closed.

This mode cannot produce TCPARMED=PASS or KERNEL_GATE_READY_FOR_COORDINATED_DIAGNOSTIC=true. Its purpose is to identify the aborting **function and library**, not to substitute for live session-link proof.

## Validated offline

The standalone fixture suite tests normal exit, actual Python SIGABRT, synthetic named stack, stderr-only static assertion, timeout and watchdog cleanup, debugger failure, oversized output, bounded redaction, no raw core, and cleanup after outcomes. All tests pass under Ubuntu WSL using a fake debugger.

An unprivileged fresh-stage host run of the same suite on **GDB 18.1** also passed, including a real compiled -g -O0 C abort fixture whose recovered frame name was **captured_marker**. The private temporary fixture directory was removed. That test did not execute bpftool, attach BPF, use sudo, or access inference. Separate synthetic collector tests assert that diagnostic PASS can never arm readiness, that malformed/secret metadata fails closed, and that wrapper permission/hash checks precede attachment.

## Request-free investigative listener

The original kernel-only listener uses the normal host-source mapping preflight, which sends GET /api/tags to Ollama. That metadata request is NOT permitted by the current no-Ollama-request investigative task. Do not start that original listener for this task, even though the endpoint does not perform inference.

A separate standalone scripts/local-muse-crash-only-check.mjs entrypoint requires --operator-authorized-no-http-crash-only. It uses the unchanged kernel bridge, strict FIFO, real import-kernel delivery path and original root collector. Its narrowly scoped scripts/local-muse-crash-only-host-sources.mjs variant deliberately rejects all Ollama HTTP, verifies historical manifest identity without claiming a live model inventory, and queries the fresh service PID, /proc comm and bound loopback socket using read-only SSH commands. The existing root collector still independently checks exact executable identity, PID, start time, service account and owned listener inode. The separate command printed for the human operator requires -CrashCapture and -Seconds 20. No connection is made through the SSH forward.

This entrypoint never prints a readiness PASS, never calls the normal successful bridge drain path, and always records TCPARMED=FAIL and the coordinated kernel gate as false. An unsuccessful journal/arm exit is EXPECTED: it is investigative, not readiness evidence. The default production and original kernel-only readiness listeners remain untouched. Synthetic offline tests verify the fail-closed HTTP and source identity boundaries.

## Future deployment and authorization boundary

The human operator has now run scripts/Install-ClackBpftoolCrashCapture.ps1 once. Its root stage first copied the unprivileged upload into a task-exclusive root-owned /run snapshot, rehashed the root-owned bytes, installed only the SHA-reviewed Python observer into the root diagnostic tools directory (mode 0600), checked GDB 18.1 and the fixed bpftool SHA, and refused overwrite. The observed receipt reported CLACK_CRASH_OBSERVER_INSTALL=PASS, the exact expected wrapper hash and CLACK_CRASH_OBSERVER_EXECUTED=0. Remote stat independently confirmed the installed root:root regular file with mode 0600. It did not invoke the observer or attach BPF.

The single prior authorized live session is exhausted. The old installer is pinned to the old installed wrapper and refuses an existing destination. It must **not** be reused as an update procedure. The enhanced local wrapper has a new hash and the root collector deliberately rejects the *old installed script* with a SHA mismatch before attachment. A future separately authorized root-only, safe atomic replacement with exact new hash/ownership checks is a hard prerequisite for any further capture, as is a separate authorization for the proposed new <=20-second session. Neither deployment nor live capture is performed as part of this offline refinement.

**Prepared replacement handoff (not executed at authoring time):** scripts/Replace-ClackBpftoolCrashCapture.ps1 is separate from the create-only installer and explicitly pins the enhanced source SHA-256 143c040fe9db82e23f722f77704841f1ac5bc12fbb21c8d0646169f2c01a15fe, the previous installed SHA-256 c5002328d5563c6af32559c4809940d9f89bfc78f330fe9e2022805bca4ac126 and the unchanged private bpftool SHA. It requires a human-entered interactive SSH sudo password. It copies the source into an exclusive root-owned stage in the destination directory, checks staged/new and backup/old hashes before an atomic same-filesystem rename, then verifies root:root, mode 0600 and the installed new hash. On failure after rename, it attempts a verified rollback using the root-only backup, retaining that backup for administrator recovery if rollback cannot be confirmed. After successful verification it deletes only the exclusive task stage. It never executes GDB or bpftool or changes readiness. Offline tests use unprivileged synthetic copies of the Bash logic; the real installed file is never replaced as part of testing. **Do not start a new kernel session until the operator has run the handoff and the independent installation verification passes.**

**Remaining validation:** The refined observer has not been used as root against a real live link. The earlier root capture did reproduce SIGABRT but did not resolve the immediate bpftool symbol. A future single investigative capture could seek that location after separate authorization, but can never qualify readiness. Causal classification stays **G** until evidence supports a specific originating defect.
