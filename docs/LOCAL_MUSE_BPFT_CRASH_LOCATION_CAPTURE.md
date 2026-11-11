# Private fixed bpftool: bounded SIGABRT location capture

**2026-11-11 status: prepared and offline-tested; not installed on the root host, and not used with a live BPF link.** No new attachment, Muse, Ollama request, inference, ForgeBoard, coordinator, package change or readiness gate modification is authorized by this document.

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

Never exported: registers, addresses, raw debugger transcript, process arguments unrelated to the fixed command, arbitrary stderr, stack values, memory, prompts, credentials, generated text, HTTP bodies or raw core bytes. Unknown/malformed output is rejected. Function/module/source fields pass narrow syntax checks; directory paths are discarded.

## Explicit future integration: **diagnostic only, unarmed**

The collector source scripts/local-muse-one-ebpf.py recognizes an additional --capture-live-link-abort flag **only** with --fixed-diagnostic-bpftool and a maximum-20-second session. It verifies the root-owned wrapper path and exact script SHA **before** bpftrace starts; if missing or modified, the setup fails. The short root shell and interactive operator expose the switch only via the optional -CrashCapture parameter; the production default and original four-file staged source set remain unchanged.

The first LIVE link enumeration is observed under GDB **instead of** normal bpftool JSON link inspection. All baseline program/link and live program inventories retain their original direct bpftool path. The observer record goes through a second strict closed-vocabulary validator into the root inventory audit. A closed-vocabulary KERNEL_AUDIT_CRASH_CAPTURE=PASS/FAIL/TIMEOUT status is also emitted. GDB stdout is never parsed as link JSON, and the debugger's exit status is never translated into a native -6 status. The collector deliberately raises a diagnostic-only error afterward, regardless of observer success or normal child exit; this leaves SOURCE_INVALID true, READY FIFO unwritten, and the importer unarmed. No link owner, hook or terminal readiness proof is weakened. Existing STOP/terminal/cleanup paths remain fail closed.

This mode cannot produce TCPARMED=PASS or KERNEL_GATE_READY_FOR_COORDINATED_DIAGNOSTIC=true. Its purpose is to identify the aborting **function and library**, not to substitute for live session-link proof.

## Validated offline

The standalone fixture suite tests normal exit, actual Python SIGABRT, synthetic named stack, stderr-only static assertion, timeout and watchdog cleanup, debugger failure, oversized output, bounded redaction, no raw core, and cleanup after outcomes. All tests pass under Ubuntu WSL using a fake debugger.

An unprivileged fresh-stage host run of the same suite on **GDB 18.1** also passed, including a real compiled -g -O0 C abort fixture whose recovered frame name was **captured_marker**. The private temporary fixture directory was removed. That test did not execute bpftool, attach BPF, use sudo, or access inference. Separate synthetic collector tests assert that diagnostic PASS can never arm readiness, that malformed/secret metadata fails closed, and that wrapper permission/hash checks precede attachment.

## Future deployment and authorization boundary

The independent installation script scripts/Install-ClackBpftoolCrashCapture.ps1 is prepared **but not run**. When separately authorized, it first snapshots the unprivileged upload into a task-exclusive root-owned /run directory, rehashes those immutable-to-user bytes, then copies the SHA-reviewed Python observer into the root-owned diagnostic tools directory (mode 0600) after checking GDB 18.1, the fixed bpftool SHA-256 and destination ownership. It refuses overwrites and cleans up that root snapshot. It does **not** run the observer or attach any probe.

Only after this root-only deployment and a fresh explicit authorization could an operator start **one** new kernel-only no-traffic listener and invoke the existing short operator with its new -CrashCapture switch, at most 20 seconds, using a fresh run ID. Do not reuse a previous listener or run ID. This documentation creates no authorization, starts no process, and does not change READINESS or TCPARMED.

**Remaining validation:** the wrapper has not been exercised as root during a real active link inspection. That one future capture would be investigative and deliberately fail closed, even if it records a complete symbolic stack. The causal classification stays **G** until that evidence is obtained.
