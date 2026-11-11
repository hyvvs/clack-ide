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

## Addendum: 2026-11-11 upstream kprobe_multi source comparison

The idle administrator check subsequently **passed** (three unrelated
root-enumerable links; exit 0). The later no-traffic, administrator-owned
`muse-one-c392c05fbcd7354ca7860ed2` recorded **six** bounded
program/link inventory invocations, with a verified 3,725-byte JSONL file:

- Baseline `-j prog show` and `-j link show`: exit 0.
- First live `-j prog show` and `-j link show`: exit 0; outputs unchanged.
- Second live `-j prog show`: exit 0; output grew from 10,705 to 11,753
  bytes, while bpftrace was running.
- Second live `-j link show`: subprocess return `-6` (**SIGABRT**),
  no timeout, no stdout, 80 stderr bytes with SHA-256
  `6eba2fc05d1408209b3c0b6372113bb45f691a0497206652720bafb323ad2081`.
  Its original bytes were not exported and cannot be reconstructed.

### Upstream defect and actual source blobs

Yuan Chen's October 10, 2026 patch, merged to bpf-next on October 12 as
`0d5e3fc78a6f2522e6339743b8e5ecc02351a9dd`, fixes an out-of-bounds
read in the `kprobe_multi` link-information renderer:

https://lists.openwall.net/linux-kernel/2026/10/10/363

https://lists.openwall.net/linux-kernel/2026/10/12/1019

Both `show_kprobe_multi_json()` and `show_kprobe_multi_plain()` used
`if (j++ == info->kprobe_multi.count)` **after** accessing the
`data[j]` array; the fix changes both branches to
`if (++j == info->kprobe_multi.count)`. The author demonstrated an
AddressSanitizer out-of-bounds read for **both** renderers. Thus,
switching from JSON to plain text would not avoid the known defect.

Direct read-only source fetches established identical, affected
`link.c` Git blob SHA `088d1d206065f651d5f5ba9ea49a1994b6e586ac`
in all of:

- `libbpf/bpftool` tags `v7.8.0` and `v7.8.1`, `src/link.c`;
- `gregkh/linux` stable tags `v7.3.1` and `v7.3.3`,
  `tools/bpf/bpftool/link.c`.

Upstream `libbpf/bpftool` main has **fixed** blob SHA
`5cffa2d283b47327b8611b4d85b1d70821f40964`.
Comparing the actual source is stronger than guessing from version
numbers; a distributor **could** still backport a fix, however.
The saved audit has no installed binary build ID or disassembly.
Even though an affected source revision is consistent with observed
SIGABRT, an actual matching backtrace/assert message was **not**
preserved. Do not claim the upstream bug as the uniquely proven cause.

### Package provenance and update decision boundary

Independent public Arch package metadata identifies **`bpf`**, not a
standalone `bpftool` package, as the provider of `usr/bin/bpftool`.
`extra/bpf 7.3.1-1` was built 2026-10-31 and
`extra-testing/bpf 7.3.3-1` was built 2026-11-07. Their named Linux
source tags have the same vulnerable `link.c` blob; absent downstream
patches, neither is a confirmed fixed package.

https://archlinux.org/packages/extra/x86_64/bpf/

https://archlinux.org/packages/extra-testing/x86_64/bpf/

The installed host binary self-reports `bpftool v7.8.0` and
`libbpf v1.8`, **not** the actual pacman owner/build ID. The host's
`pacman -Qo /usr/bin/bpftool`, `pacman -Qii bpf` and
`pacman -Si bpf` records are **not yet collected**. The exact installed
package owner, revision, packager/build metadata, potential patch set,
configured repository candidate, and fixed-binary status remain
unverified. Do not install or recommend a testing-branch package solely
because its version is newer. No fixed **configured** package is proven.

### Diagnostic privacy hardening

The earlier free-text `Error: ...` allowlist could leak printable
IP addresses, large decimal pointers and opaque secrets without matching
the small sensitive-keyword denylist. `safe_bpft_diagnostic` now
accepts **only exact known bpftool errno/usage messages** and static
glibc allocator/stack-protector crash messages, plus a **single static
redacted classification** for narrowly shaped bpftool C assertions.
It never exports arbitrary assertion paths, functions or expressions.
Non-allowlisted stderr remains length/SHA256 only. The historical
80-byte stderr cannot be retrospectively decoded. This changes only
diagnostic visibility; the session link/program/owner readiness gate,
importer, STOP, terminal accounting and cleanup rules are untouched.

### Alternatives (all remain fail-closed)

| Read-only method | Can establish | Does not independently establish |
| --- | --- | --- |
| **Proven fixed bpftool build** with `-j link show` | Complete fresh link list; potentially `type=kprobe_multi`, `prog_id`, function, missed events and owner fields, **if actually emitted** | Whether installed tool has fix without source/binary verification; actual owner if `pids[]` is absent |
| Plain `bpftool link show` | Kernel link presence/type in a human-readable format | Safe rendering on affected source (**same bug**); reliable machine-checked ownership and session entry+return semantics |
| `bpftool -j prog show id N` | Identity/type/name for that program ID | Link existence, `tcp_sendmsg` hook, session entry/return, tracer ownership, zero missed |
| `bpftool -j link show id N` | Link-specific metadata **once safely rendered** | Safety for a `kprobe_multi` target on affected build (**same renderer**) |
| `bpftool -j perf show` | Some perf-event FD attachment metadata | A `BPF_LINK_TYPE_KPROBE_MULTI` session link that uses different attachment representation |
| Direct libbpf/kernel `BPF_OBJ_GET_INFO_BY_FD` inspection | Potentially a safe program/link ID join and kernel kprobe_multi fields if implemented, bounded and pinned | Reliable user-space `pids[]` owner or paired-hook semantics unless separately verified; this is *not implemented or approved* |
| Pinned bpftrace runtime metadata + fresh program ID | Completed native four-probe attach, matching `TCPREADY`, stable Ollama identity and newly loaded BPF program | An independently verified owned `tcp_sendmsg` session link; **never sufficient alone** |

**Status:** no fixed repository package or safe equivalent session-proof
implementation has been established. A new attachment/revalidation is
not authorized by this source-only investigation. Do not weaken the
session-aware readiness requirement.
