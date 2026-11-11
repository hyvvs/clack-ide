# Local Muse: bounded bpftool inventory diagnostics (no inference)

## Confirmed historical boundary

Committed starting point: `d2994d2cf4dc06e3da985790dd163baa7979f9a4`.
The last administrator-owned, no-traffic run was
`muse-one-8dfd06a51ecd3b11abc40893`. Its native audit reported one
completed four-probe attachment, one matching `TCPREADY`, stable Ollama
identity and zero unrecognized bpftrace stderr. It separately reported:

- `KERNEL_AUDIT_SESSION_LINK_INVENTORY_ERROR=CalledProcessError`
- `KERNEL_AUDIT_KERNEL_INVENTORY_ERROR=CalledProcessError`
- `KERNEL_AUDIT_NEW_VALID_SESSION_LINK_COUNT=0`
- `KERNEL_AUDIT_READY_FIFO_WRITE_ATTEMPTED=0`
- `KERNEL_AUDIT_CONTROL_STOP_RECEIVED=0`
- Root, user-stage, and task-owned cleanup: PASS.

The **precise** nonzero exit status and error message of the old live
`bpftool` invocation were **not saved**, so its specific kernel error
cannot be reconstructed from that run. `NEW_TARGET_PROGRAM_COUNT=0` is
an incomplete snapshot and does **not** prove that no program was loaded.
The previous readiness false-negative caused by incorrectly requiring two
distinct BPF program IDs is a separate, already documented issue. Neither
observation proves the historical `inference-27` delivery cause.

## Host facts verified without privilege or probe attachment

On kernel `7.3.1-1-cachyos`, the installed
`bpftool v7.8.0` uses `libbpf v1.8`. Its unprivileged
`bpftool link help` exposes `link show` and `-j|--json`.
Unprivileged `bpftool -j link show` and `bpftool -j prog show`
both return `Operation not permitted` (SSH exit status 255).
This **does not** establish a root permission error: the old root
collector successfully completed both baseline snapshots and started
bpftrace before the later link inspection failed.

Within the old root collector, both link inventories used exactly:

```
/usr/bin/bpftool -j link show
```

The difference was the inventory **phase**, not argv or effective
collector UID: baseline before spawning bpftrace versus live after
spawning it. The program snapshot used
`/usr/bin/bpftool -j prog show`, also unchanged between phases.

Consequences for the plausible causes:

| Hypothesis | What the saved evidence can establish |
| --- | --- |
| Unsupported `-j link show` syntax | Excluded for the baseline; CLI supports it. |
| Permanent inability to run as root | Excluded for the successful root baseline, not for any transient condition. |
| Unprivileged `Operation not permitted` | Observed but not the same privilege context as the failed root invocation. |
| Unknown/new BPF link type, old bpftool/kernel metadata mismatch | Possible, **not proven**. |
| Link object disappeared during iteration | Possible, **not proven**. |
| Kernel link-info/lookup error | Possible, **not proven**. |
| Invalid/missing JSON alone | Insufficient to explain the old `CalledProcessError`: old `subprocess.run(check=True)` raised before `json.loads`. |
| Python-level timeout | Not the recorded exception class (would be `TimeoutExpired`). |
| Tracer exited before inventory | Timing was not preserved; neither proved nor excluded. |
| Different baseline/live command | Excluded by the committed source. |

This is intentionally **not** a readiness redesign. There is no relaxed
`>=1` fallback, no weakened link/owner predicate, no model request,
and no newly authorized eBPF attachment.

## Collector-side per-invocation audit contract

`scripts/local-muse-one-ebpf.py` now executes the same pinned
`-j prog show` / `-j link show` argv with a `check=False` capture
wrapper so nonzero exits retain metadata **before** failure propagation.
Every baseline, live, and terminal invocation writes a bounded record
to a dedicated root-owned, mode-0600 JSONL file. A short human-operated
run will copy it to its exclusive local evidence root as
`kernel-operator-inventory.jsonl` before owned remote cleanup.

Each record has a sequential invocation number, exact argv, monotonic
start/end nanoseconds, phase, inventory kind, tracer running state at
start/end, result/exception class, exit code or timeout, exact raw
stdout/stderr byte lengths and SHA-256 hashes, JSON-attempted and
JSON-result classifications, plus bounded tool-only diagnostics if safe.
If an error is encoded as an ordinary bpftool JSON error object on
stdout, a short allowlisted diagnostic is also recorded even on
nonzero exit. Raw BPF program/link JSON, socket pointers, payloads,
arbitrary stderr, paths and sensitive text are never copied.

The file is limited to 2 MiB, and an inability to record an invocation
fails closed. The legacy content-free `KERNEL_AUDIT_*` operator
summary remains independent. Syntax, authenticated STOP, terminal
`TCPSUMMARY`, importer and cleanup requirements are unchanged.

## What can be concluded about reliable link metadata

The host demonstrably exposes **baseline** root link inventory and
program inventory through bpftool. A **live** root link enumeration
failed. No saved raw link rows establish that this host reliably
exposes the required `prog_id`, `funcs[].func`, `retprobe`,
`missed`, or `pids[].pid/comm` fields on the session link.
The existence of kprobe session attachment does not prove that this
bpftool build can enumerate all live links. The program snapshot and
the native bpftrace notice remain useful **partial** observations, not
a substitute for the mandatory, correctly joined session evidence.

The next safe host check is a separately human-operated, **read-only**
root `bpftool -j link show` (idle, no attachment), to determine
whether the root enumeration interface is available when the tracer
is absent. Even a successful idle result cannot by itself prove why
the prior **live** enumeration failed. Another active-kernel validation
would require a new, explicit authorization **after** inspecting the
diagnostic evidence and compatibility assumptions.
