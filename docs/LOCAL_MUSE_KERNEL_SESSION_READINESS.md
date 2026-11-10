# One-Muse kernel collector: session-aware readiness

This note concerns only the separate, no-inference kernel-only diagnostic.
It does **not** establish the historical `inference-27` stream-delivery cause
or authorize Muse, ForgeBoard, Ollama traffic, or the nine-gate coordinator.

## Proven false negative

The administrator-operated 20-second run
`muse-one-d020190810f27c1933e3f30c` emitted one native
`Attached 4 probes` notice and one matching `TCPREADY`, retained stable
PID/socket/executable identity and no unrecognized stderr, but saw exactly
**one** new matching BPF program ID. The old collector and bridge demanded
**two** program IDs, never attempted a FIFO write, and failed closed.
Classification: **KERNEL READINESS FALSE NEGATIVE — BPFTRACE SESSION PROGRAM
CARDINALITY ASSUMPTION**. This diagnosis belongs to orchestration/readiness,
not to the historical `inference-27` failure.

## Why one program can implement both hooks

The exact pinned `scripts/local-muse-tcp.bt` includes
`kprobe:tcp_sendmsg` (entry) and `kretprobe:tcp_sendmsg` (return). For
supported kernels, bpftrace's `kprobe_session` optimization pairs these
logical probes in **one** `BPF_TRACE_KPROBE_SESSION` program, installed
through **one** `BPF_LINK_TYPE_KPROBE_MULTI` link. Its BPF code distinguishes
entry from return and the kernel session link registers both entry and exit
handlers. The bpftrace upstream runtime test explicitly asserts one BPF
program, one link, and execution of both hooks:

- https://github.com/bpftrace/bpftrace/blob/master/tests/runtime/probe
- https://github.com/bpftrace/bpftrace/blob/master/src/bpfprogram.cpp
- https://github.com/bpftrace/bpftrace/blob/master/src/attached_probe.cpp
- https://github.com/torvalds/linux/blob/master/kernel/trace/bpf_trace.c

Consequently, the number of program IDs cannot be interpreted as the
number of logical probe clauses. The archived independent 20.650-second
validator also required a **nonempty** set of new matching IDs, not two.
Its optional link inspection was *not* a mandatory or sufficient independent
session proof, and this implementation does not treat it as one.

## Required positive runtime evidence

The root collector must verify the pinned source/supervisor SHA256; exact
Ollama PID, executable, UID, start ticks and listener inode; unchanged
`bpftrace -B line` argv; live tracer PID; one completed native
`Attached 4 probes`; one complete, correct `TCPREADY PID 11434`; strict
pre-arm `TCPMETA` if present; and absence of loss or unknown diagnostics.

Additionally, it takes **before/after** read-only
`bpftool -j prog show` and `bpftool -j link show` snapshots, and demands:

1. Exactly one *new* kprobe program ID with the exact kernel-truncated
   `name=kprobe_tcp_send` (Linux's 15-character BPF object name limit).
   Prefix matches, stale IDs, and unrelated types/names are rejected. A new
   separate `kretprobe_tcp_s` return program is not represented as this
   *single collapsed session* and cannot satisfy this branch of admission.
2. Exactly one *new* `type=kprobe_multi` BPF link pointing to that exact
   program ID, `func_cnt=1`, resolved `func=tcp_sendmsg`,
   `retprobe=false`, and `missed=0`.
3. Positive `pids[].pid` and `pids[].comm` evidence that the link is
   held by the specific live `bpftrace` process just spawned by this root
   collector. No missing/empty/foreign owner metadata is promoted to proof.
4. The exact newly loaded program **and linked attachment** remain
   present while armed, and are both absent after tracer exit.

These link attributes corroborate the session implementation **in
combination** with the pinned paired-hook source, bpftrace's reviewed
session compilation behavior, the native completed four-probe attachment
notice and the correct BEGIN. A standalone kprobe program, generic
non-session link, or unowned tcp_sendmsg hook is never sufficient. The
kernel's `kprobe_multi` link type alone does not prove its session attach
type; the session interpretation relies on this combined independent
evidence, not a fabricated bpftool `expected_attach_type` field.

The exact link/owner fields are platform dependent. When bpftool cannot
reliably expose the required live program→link→function→owner join, the
collector deliberately **fails closed** with no `TCPARMED`; it does not
fall back to `program_count >= 1`.

The private `TCPARMED PID 11434 4 1 0` line now denotes **one validated
session program**, not one logical entry hook. The actual coordinator
bridge accepts this exact cardinality only from the already trusted,
run-scoped root FIFO. Its strict reader-close/exit and importer receipts,
authenticated `STOP`, terminal `TCPSUMMARY`, zero-loss accounting,
bounded shutdown and all cleanup gates remain mandatory. Neither the
syntax change nor offline tests claim a successful live arm.
