# Single-run Clack session matcher: offline investigation

**Scope:** no new BPF session, root, SSH, bpftool execution, GDB, Muse,
inference, Ollama HTTP, ForgeBoard, or coordinator work. The sole previously
approved live kernel-only validation, muse-one-34daa85460392166c3378222,
has already been consumed. No new run is authorized.

## Preserved evidence

Starting HEAD: 10dab2c25cc66f878cf6e16223d50d51d0aabedc.
The existing kernel-operator-inventory.jsonl contains exactly **30 records**
and **32,475 bytes**, with SHA-256
108142dc250e9fcc9f846eb75e9630b61c7393043aca51876731dbf98e9dee23.
There are two baseline records (one program, one link) and 14 successful live
program/link pairs. Every inventory subprocess exited 0, parsed JSON, had
zero stderr bytes and reported PASS; the patched private bpftool did not
SIGABRT and no GDB fallback ran.

| Phase and kind | Records | Raw stdout bytes | SHA-256 prefix |
| --- | ---: | ---: | --- |
| Baseline program | 1 | 10,705 | f945098410fc |
| Baseline link | 1 | 308 | 9f4608cfa4b9 |
| First live program | 1 | 10,705 | f945098410fc |
| Other live program | 13 | 11,774 | 63eb3f3075bb |
| All live links | 14 | 493 | 161da40c9e85 |

Thus the serialized program inventory changed after the first live sample;
the link inventory changed from the baseline and was byte-identical for all
14 live inspections. These fingerprints **do not** establish new IDs, an
increase in raw object counts, a particular program/link join, or the
absence of any object. The reported zero NEW_TARGET_PROGRAM_COUNT and zero
NEW_VALID_SESSION_LINK_COUNT are strict *matcher* results, not raw counts.
No parsed IDs, names, object types, fields, owners, baseline ID sets,
per-predicate statuses or object counts survived in the original audit.

## Program predicates, consumed run

PASS applies to the parsing invariant across the complete inventory, not
to an identified target candidate. NOT_RETAINED means a specific object's
field or verdict was not preserved. FAIL applies only where the aggregate
matcher outcome was demonstrably false.

| Program condition | Outcome |
| --- | --- |
| Top-level JSON was a list; entries were dictionaries | PASS |
| Every parsed ID a unique, strict positive integer | PASS |
| Every parsed program type was a string | PASS |
| Every optional program name was a string | PASS |
| Specific candidate program ID fresh relative to baseline | NOT_RETAINED |
| Specific candidate type exactly kprobe | NOT_RETAINED |
| Specific candidate name exactly kprobe_tcp_send | NOT_RETAINED |
| Exactly one new program satisfied all target predicates | FAIL |
| No new matching separate kretprobe_tcp_s return program | PASS (matching count zero; unrelated new IDs unknown) |

The collector has **no** program tag, load-time, UID or owner-PID matcher.
Program ID is used for freshness and the link join; program name is exact,
not a prefix match. Program parsing rejects malformed IDs/types/names.

## Link predicates, consumed run

| Link condition | Outcome |
| --- | --- |
| Top-level JSON was a list; entries were dictionaries | PASS |
| Every parsed ID a unique, strict positive integer | PASS |
| Every parsed link type was a string | PASS |
| Every parsed kprobe_multi link had a positive integer prog_id, and every optional prog_id was valid | PASS |
| Live tracer PID passed strict integer greater-than-one check | NOT_RETAINED |
| Exactly one matching new target program available for join | FAIL |
| Candidate link ID fresh relative to baseline | NOT_RETAINED |
| Candidate linked prog_id was the matching target program ID | NOT_RETAINED |
| Candidate link type exactly kprobe_multi | NOT_RETAINED |
| Candidate retprobe exactly boolean false | NOT_RETAINED |
| Candidate func_cnt strictly integer 1 | NOT_RETAINED |
| Candidate missed strictly integer 0 | NOT_RETAINED |
| Candidate funcs was a list | NOT_RETAINED |
| Exactly one funcs entry | NOT_RETAINED |
| That entry was a dictionary | NOT_RETAINED |
| That entry had func exactly tcp_sendmsg | NOT_RETAINED |
| Candidate pids was a list | NOT_RETAINED |
| Candidate pids was nonempty | NOT_RETAINED |
| An owner entry matched both live tracer PID and comm bpftrace | NOT_RETAINED |
| Exactly one qualifying fresh session link | FAIL |

The first four link rows are parser invariants inferred from all 14
successfully parsed link inventories. The collector requires *all* the
per-candidate predicates jointly, then rejects ambiguity (more than one
qualifying link). It never treats a program alone as attachment proof.

## Expected representation versus demonstrated representation

The pinned probe source contains both entry kprobe:tcp_sendmsg and return
kretprobe:tcp_sendmsg, plus other probe clauses. The existing
historical bpftrace 0.27 runtime-test analysis and earlier one-program
observation support the **session-aware expectation** on a compatible
kernel: **one target** BPF_PROG_TYPE_KPROBE program for both logical entry
and return clauses, with BPF_TRACE_KPROBE_SESSION attach behavior, through
**one target** BPF_LINK_TYPE_KPROBE_MULTI link. Other bpftrace objects may
coexist; the old demand for at least two target programs is obsolete.

The expected kernel-limited program name is kprobe_tcp_send; the separate
return name kretprobe_tcp_s would indicate the non-collapsed branch. Pinned
bpftool emits program ID, program type and optionally name (src/prog.c).
Crucially, its src/common.c get_prog_full_name() may replace a 15-character
kernel program name with a *longer BTF function name* if available. The
strict short-name comparison is therefore a testable source-level
assumption, **not a proven cause** of the consumed live failure.

The same pinned source emits link ID, type and prog_id (src/link.c), and for
the kprobe_multi branch emits boolean retprobe (RETURN flag), numeric
func_cnt and missed, plus funcs entries when kernel symbols resolve.
src/pids.c emits pids entries containing numeric pid and string comm **only
when object ownership references are available**. Skeleton support is
installed but does not guarantee positive PID entries for every snapshot.
The strict expected values are: link type kprobe_multi, joined prog_id,
retprobe=false, func_cnt=1, missed=0, a single resolved tcp_sendmsg function,
and an owner whose PID equals the live bpftrace PID and comm is bpftrace.
The link type alone cannot prove the kernel attach subtype.

This workspace has the pinned private bpftool source and documentation of
bpftrace 0.27's session optimization; it does **not** preserve a bpftrace
0.27 source checkout or the live per-object metadata from this particular
run. Therefore its exact observed program name, actual program/link
cardinality, session link subtype, resolved target and PID owner cannot be
verified offline. Do not reinterpret a possible BTF name or missing PID
field as an identified representation mismatch.

## Future-only bounded, content-free diagnostics

After a successful live program/link pair **only with a pinned short-mode
diagnostic identity**, a new normalized matcher record is appended to the
original SHA/length-only JSONL. It has kind=matcher, result=normalized,
and repeats the preceding inventory invocation ordinal without incrementing
the underlying inventory call count. It records baseline/live raw counts,
fresh raw ID counts, strict match counts, positive numeric candidate IDs,
linked program IDs, the numeric tracer PID, and per-candidate PASS/FAIL
predicates. A capped candidate list and explicit truncation flags avoid
presenting truncated evidence as complete.

Only fixed program-type classes, three session-name classes (including
the *possible*, not admitted, full-BTF spelling), recognized link-type
classes and a tcp_sendmsg target class are retained. Other names, kernel
symbols, raw owners/comm, paths, cookies, addresses, socket pointers,
payloads, raw kernel JSON, unknown object fields and stderr are not written.
Unknown or missing fields give failed admission predicates rather than a
weakly inferred pass.

Limits: **20 matcher samples**, **16 candidates per object kind per
sample**, **32,768 bytes per matcher record**, and the existing **2 MiB
combined inventory audit** ceiling. The strict program/link matcher,
TCPARMED/FIFO gate, STOP authentication, terminal evidence, event-loss
requirements and cleanup rules are unmodified. Diagnostic capacity failures
abort the source rather than bypassing the gate.

Offline synthetic cases cover one valid session program/link, wrong program
name, wrong program type, wrong link type, wrong linked program ID, missing
tcp_sendmsg metadata, wrong owner PID/comm, the old separate two-program
case, no new object, and schema variation; additional tests cover strict
flags/counts, duplicates, redaction, limits, and invocation numbering.
These tests verify collector behavior, **not** the consumed run's missing
object content.

## Disposition

**D. CURRENT_EVIDENCE_INSUFFICIENT — ONE MORE INSTRUMENTED KERNEL RUN REQUIRED**

One separately authorized, bounded, kernel-only diagnostic capture would
be justified to distinguish object absence, matcher rejection and a real
schema/representation mismatch. This task **does not authorize or execute
that run**. Until positive proof and the other independent readiness gates
pass, TCPARMED=FAIL and
KERNEL_GATE_READY_FOR_COORDINATED_DIAGNOSTIC=false.
