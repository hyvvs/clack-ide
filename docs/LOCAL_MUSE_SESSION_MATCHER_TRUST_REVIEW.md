# Clack kernel-session matcher: source-backed trust review

**Decision: C. ADDITIONAL_HOST_METADATA_REQUIRED.** Reviewed offline against
`eb06530db944dbafe662320d1a639a3e243eff27`, with **no new kernel
attachment, bpftool execution, SSH, root action, Ollama HTTP, Muse, inference,
ForgeBoard or coordinator**. No admission/readiness predicate was relaxed.

## Authoritative evidence and limits

- Consumed run: `muse-one-310ce7c211dd41d6e279625b`; saved
  `kernel-operator-inventory.jsonl`: 68,684 bytes, SHA-256
  `ed96c7b7d28b7e9e154c0ef4172871f3878256b1a0c86c0c06ee48c36963bec6`.
  All 30 baseline/live bpftool inventory invocations passed; no SIGABRT.
- Thirteen **complete, untruncated** active matcher records each show
  45 baseline / 49 live programs, with four fresh programs; three baseline /
  five live links, with two fresh links. Program 157: new, `kprobe`,
  `nameClass=OTHER` (not the exact short name **or** the previously coded
  unindexed `kprobe_tcp_sendmsg` hypothesis). Link 11: new
  `kprobe_multi`, `prog_id=157`, `retprobe=false`, `func_cnt=1`,
  `missed=0`, `funcs=[]`, `pids` absent.
- The **raw displayed program name was intentionally never saved**. It
  cannot be reconstructed from the `OTHER` classification. In particular,
  no claim that the exact observed name was `kprobe_tcp_sendmsg_1` or any
  other specific suffix is supported. Offline fixtures using indexed names
  are source-consistent *hypotheses*, not transcriptions of that run.
- The previous protected inventory
  `muse-one-34daa85460392166c3378222` remains unchanged at SHA-256
  `108142dc250e9fcc9f846eb75e9630b61c7393043aca51876731dbf98e9dee23`.

## Exact source paths and representation guarantees

### bpftrace 0.27: program naming and kprobe session

The immutable upstream **v0.27.0** source was inspected via its Git tag:

- `src/ast/passes/codegen_llvm.cpp`:
  `generateProbe()` calls
  `util::get_function_name_for_probe(name, probe.index())` and sets
  section `s_<generated-function-name>`.
- `src/util/bpf_names.h`: that generated function name is the sanitized
  probe name **plus `_` and a decimal probe index**. The exact index for
  this consumed session was not persisted.
- `src/bpftrace.cpp`: `Probe.is_session` is set from
  `ast::ExpansionType::SESSION`.
- `src/bpfprogram.cpp`: with nonempty functions, no module and a
  supported session feature, libbpf expected attach type is set to
  `BPF_TRACE_KPROBE_SESSION`; otherwise the available multi mode may be used.
- `src/attached_probe.cpp`: `AttachedMultiKprobeProbe::make()` passes the
  literal probe function symbol(s) via `opts.kprobe_multi.syms`, their count,
  and `BPF_TRACE_KPROBE_SESSION` **only if** `probe.is_session`; otherwise
  `BPF_TRACE_KPROBE_MULTI`. The ordinary `kprobe` branch passes zero
  `BPF_F_KPROBE_MULTI_RETURN`.
- `tests/runtime/probe` contains `kprobe_session` and
  `kprobe_session_exact` cases verifying one program, one link and paired
  entry/return behavior under `REQUIRES_FEATURE kprobe_session`.

The kernel `BPF_OBJ_NAME_LEN` limits the stored program name to 15 visible
characters; the expected kernel truncation of a generated
`kprobe_tcp_sendmsg_<index>` begins `kprobe_tcp_send`. **But that is not
what bpftool necessarily serializes.** The exact rendered-name mismatch
stems from an unstable equality assumption, not from an independently
recovered observed literal. Source evidence is consistent with BTF
expansion to an indexed name, but does not prove which name was observed.

Upstream source identity:
`https://github.com/bpftrace/bpftrace/tree/v0.27.0`.
Reviewed Git blob SHA: `src/attached_probe.cpp`
`1c5b5343e73660861513df8b0fd02c226053219e`;
`src/bpfprogram.cpp` `f6557c28660ec364988a0ab9afe17fbf06c81966`;
`src/util/bpf_names.h` and
`src/ast/passes/codegen_llvm.cpp` reviewed at that same tag.

### Installed pinned bpftool 7.8.1 and libbpf 1.9

Reviewed the local pinned source tree at
`src-tauri/target/clack-bpftool-fixed-source`; bpftool source archive
SHA-256 `63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362`
and libbpf source archive SHA-256
`66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74`.
This tree contains the existing reviewed kprobe_multi JSON fix; no binary
or installed observer was invoked or changed in this task.

- `src/prog.c:414-431` emits `type` and calls
  `get_prog_full_name()` for nonempty `name`.
  `src/common.c:414-455` retains the kernel name when it is shorter than
  15 characters, or when BTF/function info lookup fails. Otherwise it can
  replace the kernel-truncated name with the **first BTF function's name**.
  The v0.27-generated indexed function name therefore need not equal
  either `kprobe_tcp_send` or unindexed `kprobe_tcp_sendmsg`.
  Program ID/type plus verified link association are stronger kernel
  object identity than this rendered label, **but not proof of target or
  tracer ownership in isolation**.
- `src/link.c:326-373` emits `retprobe`, `func_cnt`, and `missed`
  directly from kernel `bpf_link_info.kprobe_multi`, then creates
  `funcs` from addresses matched against the independently loaded
  kernel-symbol table. It can legitimately emit an **empty array**
  if no symbols were loaded or the returned target addresses cannot be
  matched (including possible architecture/IBT offset mismatches).
  `src/link.c:1174-1194` obtains count, allocates address/cookie buffers,
  and refetches kernel link information. The saved `funcs=[]` does **not**
  identify which symbol-resolution condition occurred.
- `src/link.c:128-140` prints kernel-supplied link ID/type/program ID.
  `src/link.c:651-653` invokes the kprobe_multi formatter. The JSON
  representation has **no exposed `BPF_TRACE_KPROBE_SESSION` vs
  `BPF_TRACE_KPROBE_MULTI` attach subtype**: `retprobe=false` does not
  distinguish a session from an ordinary entry-only multi-probe.
- `src/pids.c:100-181` tries an optional task-file PID iterator BPF
  skeleton; an unsupported load deliberately returns success with no
  collected references. `src/pids.c:202-233` emits a `pids` array
  **only if** its table contains nonempty references to that particular ID.
  `src/skeleton/pid_iter.bpf.c:66-120` enumerates task file references
  and identifies BPF link files by kernel file-operations type, then
  reports the task's TGID and comm. Thus `pids` omission is legitimate
  with a real live link; build-time skeleton support and successful
  `bpftool -j link show` do not guarantee this optional table.
- The pinned `libbpf/src/bpf.c:791-854` carries both session and multi
  attach types through `BPF_LINK_CREATE` with the same
  `link_create.kprobe_multi` symbol/count/flag fields. The pinned
  `libbpf/include/uapi/linux/bpf.h:6905-6910,6969-6975`
  kernel link-info ABI supplies ID, program join, count, flags, missed and
  **numeric attachment addresses**. It does not itself supply names or
  process owners. `bpf_prog_info` also does **not** expose its program
  load-time `expected_attach_type` in the inspected UAPI; it is a
  `BPF_PROG_LOAD` input, not an observable output of this info struct.

Hence **`func_cnt=1` alone is NOT a replacement** for the
`tcp_sendmsg` target check; it only establishes the number of attached
addresses. **New link ID, program ID/type and PID timing alone are NOT an
ownership or session-mode proof.**

## Current predicate trust matrix

Classification names refer to the **actual field currently checked**, not
to permission to delete its underlying security requirement.

| Current predicate | Classification | Security meaning / source-backed boundary |
| --- | --- | --- |
| Fresh program ID relative to pre-attach baseline | `SECURITY_REQUIRED_AND_STABLE` | Distinguishes new objects, but requires attribution to this tracer |
| Positive, unique program ID | `SECURITY_REQUIRED_AND_STABLE` | Kernel object identity, needed for joins |
| Program type exactly `kprobe` | `SECURITY_REQUIRED_AND_STABLE` | Kernel program type, not a target-function name |
| Program name exactly `kprobe_tcp_send` | `REPRESENTATION_ONLY` | bpftool may prefer indexed BTF name; neither label alone authenticates attachment |
| Fresh link ID relative to baseline | `SECURITY_REQUIRED_AND_STABLE` | New kernel attachment object, not alone tracer ownership |
| Positive, unique link ID | `SECURITY_REQUIRED_AND_STABLE` | Kernel link identity |
| Link type exactly `kprobe_multi` | `SECURITY_REQUIRED_AND_STABLE` | Stable type; subtype session vs multi is **not** exposed by this string |
| Exact link `prog_id` → candidate program ID | `SECURITY_REQUIRED_AND_STABLE` | Kernel object relationship |
| `retprobe` exactly false | `SECURITY_REQUIRED_AND_STABLE` | Stable kernel flag; does not alone imply entry+return session |
| `func_cnt` exactly integer 1 | `SECURITY_REQUIRED_AND_STABLE` | Kernel cardinality; says nothing about which function |
| `missed` exactly integer 0 | `SECURITY_REQUIRED_AND_STABLE` | Kernel missed counter at snapshot; separate event-loss/terminal gates remain |
| `funcs` shape and exact `tcp_sendmsg` name | `CONDITIONAL_METADATA` | Optional userspace symbolization; **unique target trust role still required** |
| `pids[]` owner PID equals live tracer PID | `CONDITIONAL_METADATA` | Optional PID-iterator output; **kernel FD owner proof still required** |
| `pids[]` owner `comm=bpftrace` | `REDUNDANT_WITH_STRONGER_PROOF` | Mutable task label; only supporting context, never a substitute for verified PID/start time + owned kernel FD |
| No separately named return program | `REPRESENTATION_ONLY` | Name-based exclusion is non-exhaustive when bpftool BTF expands names |
| Exactly one qualifying target program and link | `SECURITY_REQUIRED_AND_STABLE` | Reject ambiguity; should remain mandatory |
| Exact kernel **session** attach subtype | `UNRESOLVED` | **Not currently exposed/checked** by pinned bpftool kprobe_multi JSON; type + `retprobe=false` cannot prove it |

## Replacement proof candidates and required next evidence

1. **Target identity:** An independent, bounded, root-local
   `BPF_OBJ_GET_INFO_BY_FD` inspection of the exact candidate link can
   return kernel `addrs[0]` with `count==1`. To prove
   `tcp_sendmsg`, compare that address with the exact, **same-boot**
   trusted kernel symbol identity (handle platform-specific entry/IBT
   offsets and aliases explicitly). Never persist or export raw kernel
   addresses. If canonical symbol/address verification is unavailable or
   ambiguous, fail closed. **Not yet implemented or host-qualified.**
2. **Owner and lifetime:** Inspect the **verified live bpftrace PID's**
   `/proc/<pid>/fd` and `fdinfo` (or obtain/pin the original link FD
   safely through verified pidfd semantics) and require a kernel-supplied
   `link_id=11` and `prog_id=157` joined to the exact candidate.
   Recheck PID start time, executable identity and FD stability. Linux's
   `bpf_link_show_fdinfo` is known to expose link and program IDs, but
   actual kernel/permissions/namespace behavior and an FD join on this
   host have **not been verified**. Merely finding a running `bpftrace`
   or matching timestamps is not proof.
3. **Session entry+return:** The pinned v0.27 source and its runtime
   tests document `BPF_TRACE_KPROBE_SESSION` for paired
   kprobe/kretprobe when the feature is supported. The current
   `kprobe_multi` link-info JSON only establishes an entry-type link.
   A separately qualified independent attach-subtype attestation or a
   sufficiently pinned/verified tracer launch-to-owned-FD chain is
   needed before replacing that guarantee. Do **not** claim that the
   `bpf_prog_info` struct exposes `expected_attach_type`.
4. Keep kernel missed=0, valid target service identity, no separate
   conflicting probe, pre-arm source notices, authenticated STOP,
   terminal accounting and all importer/cleanup gates mandatory.

The three replacements above must be reviewed and offline tested
**together**. A textual-name relaxation while target/owner/subtype
attestation is missing creates no meaningful verified readiness.
Therefore **production `new_kprobes()`, `session_link_ids()`,
`source_arm_evidence()` and all readiness gates remain unchanged**.
Current result: `TCPARMED=FAIL`,
`KERNEL_GATE_READY_FOR_COORDINATED_DIAGNOSTIC=false`.

## Offline tests and qualification boundary

`python -B scripts/local-muse-inventory-predicates.test.py -v`
includes a **synthetic representation** of the consumed run's counts,
program/link IDs, indexed-name hypothesis, `funcs=[]`, absent
`pids`, wrong targets/owners, stale objects, unrelated fresh kprobes,
ambiguous target programs and duplicate links. These fixtures never
assert acceptance for missing trust evidence. They are **not** proof that
the unimplemented replacement pathways work on this kernel.

**Final decision: C. ADDITIONAL_HOST_METADATA_REQUIRED.** An additional
live kernel-only readiness qualification is **not yet justified**:
before considering it, an approved **read-only** host capability/identity
inspection, implemented bounded verifier, and adversarial offline
qualification must establish equivalent kernel-target, FD-owner, and
entry+return session proof. The consumed authorization does not
authorize another run.

## 2026-11-11 controlled-launch replacement, provisional until live qualification

The subsequent autonomous authorization supersedes the old consumed-run
restriction. The tracefs registrations failed even for symbol-only targets and
were cleaned up; the target symbols are not ftrace-eligible on this host, so
tracefs attestation is not a production dependency.

The collector now has a **provisional, fail-closed** alternative, with separate
offline regression coverage in `local-muse-controlled-launch.test.py`:

1. The sole permitted bpftrace executable is `/usr/bin/bpftrace`, version
   `v0.27.0-872e7a56a`, SHA-256
   `a2208280ef0f694e8f4d3f81fe100bc2d3e4668d745a3b8c6510bf0d5f0a240c`.
   Root-owned path components, executable bytes, version, and reviewed kernel
   release `7.3.1-1-cachyos` are checked. A root-context `--info` invocation
   must independently return **exactly one positive** `kprobe_multi` and
   `kprobe_session` feature each; no missing/no/ambiguous feature can arm.
   The same fixed environment is supplied to `--info` and the actual tracer.
2. The exact root-owned probe has the pre-existing SHA pin
   `e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0`,
   containing only the approved paired `kprobe:tcp_sendmsg` and
   `kretprobe:tcp_sendmsg` TCP hooks plus BEGIN/END/interval.
   The spawned command is exactly
   `/usr/bin/bpftrace -B line <root-owned-probe> <verified-Ollama-PID> 11434`,
   with no arbitrary inherited bpftrace environment overrides.
3. The launched tracer's live `/proc/PID` root UID, executable inode and
   bytes, exact argument vector, PID birth tick, and probe checksum are
   checked before READY and periodically. Its kernel-generated BPF link
   `fdinfo` must contain the **unique fresh** link ID/program ID pair
   matching independently inventoried kernel BPF objects. This replaces
   optional `bpftool pids[]` and mutable rendered owner comm.
4. The only new kprobe program and only new kprobe_multi link must be
   fresh and exactly joined, with `retprobe=false`, `func_cnt=1`,
   `missed=0`. Contradictory optional symbols or PID metadata still fail.
   Pinned target input + pinned source-reviewed session lowering + affirmative
   kernel feature check replace unreliable program-name and
   userspace-symbolization strings. The link subtype is **not** inferred from
   `retprobe=false`, `func_cnt=1`, or link type alone.
5. Native Attached/BEGIN, FIFO arm, authenticated STOP, importer EOF,
   normalized terminal accounting, bounded kill, and post-exit kernel object
   cleanup are retained. The parent verifies link ownership again immediately
   before attempting READY and during live monitoring.

Source review: bpftrace 0.27 `src/bpftrace.cpp`, `src/bpfprogram.cpp`,
`src/attached_probe.cpp` and session runtime tests; Linux v7.3
`kernel/trace/bpf_trace.c` and `kernel/bpf/syscall.c`. In particular the
`has_kprobe_session` branch is **conditional**; this is why a positive
`--info` feature proof is mandatory and why one ordinary kprobe_multi link
is insufficient. No private addresses, symbols, process commands or TCP
contents are exported in new audit metadata.

**Still unqualified:** This host's **root-context** `--info` result and
whether its actual running pinned bpftrace process exposes the expected
`/proc/PID/fdinfo` link identity. The saved historical BPF objects cannot
retroactively provide these facts. No readiness or streaming pass is asserted
from offline tests. The root sudo ticket expired before a new session was
attempted. The final kernel-only qualification and all Muse/ForgeBoard work
remain gated on a real pass; no frozen evaluator has run.

## 2026-11-12 two authorized final kernel-only qualifications

The autonomous terminal used the user's ephemeral sudo authentication only at
the real remote prompt. Neither session made an Ollama HTTP request, Muse
inference or ForgeBoard call. Both were exactly-once, 20-second kernel-only
qualifications, with no additional probe campaign. Both returned
`KERNEL_ONLY_RESULT=blocked`, `FAILED_STAGE=kernel`,
`KERNEL_GATE_READY_FOR_COORDINATED_DIAGNOSTIC=false`,
`KERNEL_ONLY_EVIDENCE=partial-unsealed`, and
`TASK_OWNED_CLEANUP=pass`. Both root and user-stage cleanup receipts passed.
Independent read-only remote checks after both runs found no live bpftrace and
no `/run/local-muse-ebpf` parent.

1. Run `muse-one-58c4539b9083cb6581aaf499`: fresh kernel BPF program and
   kprobe_multi link existed and were inventoried; native Attached/BEGIN/END
   marker counts were each 1, without unrecognized stderr. No owned fdinfo
   join was accepted. Source review identified a concrete implementation defect:
   the verifier initially allowed `anon_inode:bpf-link` but not the **link-primer variant**
   `anon_inode:bpf_link`. Linux's `bpf_link_prime()` uses
   `anon_inode_getfile("bpf_link")`, unlike `bpf_link_new_fd()` which
   uses `"bpf-link"`. The actual raw symlink target was not retained, so this
   is a source-backed defect and plausible cause, not a direct observation.
   The fix added only these known
   underscore and hyphenated anon-inode variants, still requiring exact
   kernel ID and type joins; adversarial offline tests passed.
2. Concrete-defect permitted final retry,
   `muse-one-7a75a6bf8b207a20581e5c10`: kernel inventory calls passed,
   the tracer/target identity stayed stable, but controlled-launch fdinfo
   inspection raised `ValueError` before READY. Kernel source review then
   established another exact parser mismatch: Linux `bpf_kprobe_multi_show_fdinfo()`
   appends a header `cookie  func` and symbol rows **without** colons.
   The verifier was guaranteed to reject those colon-free rows. The raw
   fdinfo was not exported, so the exact failing line was not observed.
   It now parses only the exact kernel identity/shape keys
   `link_type`, `link_id`, `prog_id`, `kprobe_cnt`, `missed`;
   rejects duplicates, missing IDs, wrong count/loss; ignores non-keyed
   optional address/symbol rows without retaining or exporting them.
   Adversarial offline regression and the collector/bridge suites passed.

**Qualification limit consumed: 2/2.** The final fdinfo parsing correction
was made and tested **offline only**. There is **no** asserted live
`TCPARMED=PASS`, joined tracer FD, authenticated STOP for an armed session,
or accepted kernel readiness. No third BPF qualification is authorized under
the latest quantitative run limit. The one-request Muse diagnostic is not
started, has no A–G byte-delivery classification, and no ForgeBoard Agent
mission or frozen evaluator was run. Further live validation needs a new
authorization changing the exhausted run limit; do not silently restart.

## 2026-11-12 additional expressly authorized final qualification

After the explicit new authorization for **exactly one** further kernel-only
qualification, run `muse-one-cc906e5f03958f17e864f0fa` completed with:
`TCPARMED=pass`, `KERNEL_GATE_READY_FOR_COORDINATED_DIAGNOSTIC=true`,
`KERNEL_TERMINAL=pass`, `KERNEL_ONLY_EVIDENCE=collector-flush-only`,
`TASK_OWNED_CLEANUP=pass`, and `KERNEL_QUALIFICATION=PASS`.
Root audit records new target program count 1, new valid session link count 1,
separate return program count 0, target identity stable, one authenticated
STOP, zero source-invalid flags, zero unrecognized stderr, and clean tracer
exit. No inference was made during this qualification. The **standalone
kernel/instrumentation qualification phase is CLOSED**; do not add any more
qualification runs, tracefs probes or matcher/bpftool work.

Following the pass, an **existing nine-source coordinator** was started once
under `muse-one-37fc3b9a5e591b34839be6fc`. Identity, tunnel, mapping and
clock gates each recorded `ready` in its run-owned session ledger. The
production kernel operator launched and reached the sudo challenge, but the
terminal tool's safety check **rejected the attempt to forward the already
operator-supplied ephemeral credential**. This blocked privileged
authentication before any coordinated kernel attachment or inference. The
incomplete coordinator was stopped, its user staging cleanup was reported
`PASS`, and independent read-only remote checks confirmed no bpftrace
process and no `/run/local-muse-ebpf`. No `/api/chat` request was sent or
claimed, and no A–G transport layer can be classified from this attempt.
Do not mistake it for a downstream streaming failure or for a failed
standalone kernel qualification. No frozen evaluator was invoked.

## 2026-11-12 narrow sudo automation installation and coordinated admission

The one-time user-authorized root bootstrap initially hung at the genuine
remote sudo prompt because GNU `timeout` launched `sudo -v` into a background
process group on the SSH PTY. A read-only remote process snapshot showed
`sudo` in process state `T` beneath `timeout`; two safe, non-credential
terminal tests verified that `timeout --foreground` permits the remote TTY
reader to receive a harmless input marker. The authenticated bootstrap
was changed to use that foreground option, while preserving its separate
visible SSH console, strict timeouts, fixed source hashes and fail-closed
sudoers rule. The root bootstrap then completed with
`CLACK_NARROW_SUDO_INSTALL=PASS` and `BOOTSTRAP_CLEANUP=PASS`, including its
actual post-install `sudo -n` self-check. No stored, proxied, scripted or
replayed password was used. The standalone kernel qualification remains
CLOSED.

The existing coordinated nine-gate Clack session was then started ONCE,
with newly installed narrow noninteractive sudo, under
`muse-one-dc2b2ba79d266e6aa84b6b1b`. The run-owned
`session-lifecycle.jsonl` records `identity`, `tunnel`, `mapping`,
and `clocks` ready. Its `kernel` admission source failed at Unix ms
`1794446274271`; terminal recorded `kernel=missing`, other earlier
sources terminal observed, and session completion `partial`.
Read-only remote sudo journal confirms the exact installed wrapper command
`/usr/local/libexec/clack-one-muse-root --run` was admitted as root and its
sudo session later closed, rather than failing password authentication.
The run-owned root stage and local port 11435 were absent after teardown.
**No coordinator request permit was claimed and no Muse inference POST was
sent**. Therefore no A–F delivery classification is defensible. Exact
remaining boundary: `G=coordinated-root-collector-exited-before-fresh-ready-ACK`.
The original offline and standalone kernel-readiness evidence remains
accepted, not reopened. No extra standalone qualification, ForgeBoard
mission, or frozen evaluator occurred.
