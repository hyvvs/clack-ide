# Pinned bpftool JSON writer imbalance: source-only investigation

This is **offline-only**. No BPF attachment, live collector, inference,
Ollama HTTP, Muse, ForgeBoard, coordinator, root installation or readiness
change occurred. The last authorized live capture is not repeated here.

## Verified source and build provenance

| Component | Identity |
| --- | --- |
| Original bpftool mirror source commit | 678d538a85e6960f84e443695eebb13f66f89981 |
| Source tree | ea10f8aa913190295735df488ea3069ab72401ae |
| Original source tar SHA-256 | 63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362 |
| Pinned libbpf gitlink | 872299d94e27d2fa9f119667c7e52268698dc760 |
| Original libbpf tar SHA-256 | 66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74 |
| Original src/link.c Git blob | 5cffa2d283b47327b8611b4d85b1d70821f40964 |
| Root-installed original private bpftool SHA-256 | ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d |

These exact original archives, the root installation and the previous live
audit are preserved. The new correction is an overlay patch, **not** a
new upstream Git commit or a change to the original tar.

## Exact assertion and control-flow trace

src/json_writer.c:107 asserts **self->depth == 0** inside jsonw_destroy.
Every jsonw_start_array or jsonw_start_object increments this depth;
each matching end decrements it.

The source path for bpftool -j link show is:

    src/main.c main:498 creates json_wtr
      -> cmd_select(link) -> do_link -> do_show (src/link.c:1293)
      -> jsonw_start_array (outer links, line 1321)
      -> bpf_link_get_next_id -> bpf_link_get_fd_by_id
      -> do_show_link (line 1140) -> bpf_link_get_info_by_fd
      -> show_link_close_json (line 582)
      -> jsonw_start_object (link, line 588)
      -> BPF_LINK_TYPE_KPROBE_MULTI -> show_kprobe_multi_json (line 326)
      -> jsonw_name("funcs"); jsonw_start_array (line 337)
      -> helper early exit OR symbol loop -> jsonw_end_array (line 370)
      -> emit_obj_refs_json (PID/owner metadata)
      -> jsonw_end_object (link, line 696)
      -> jsonw_end_array (outer links, line 1346)
      -> src/main.c main:578 -> jsonw_destroy -> depth assertion

### JSON begin/end balance map

| Scope | Begin | Normal end | Exception |
| --- | --- | --- | --- |
| Outer link list | link.c:1321 array | :1346 array | Loop errors break but still close |
| Individual link | link.c:588 object | :696 object | TRACING get_prog_info error at :600-601 returns with object open; **not patched** here |
| Kprobe_multi funcs | link.c:337 array | :370 array | **Two missing-close exits** at :341-342 and :347-348 |
| Matched function | link.c:355 object | :366 object | Conditional module null/string remains balanced |
| Uprobe_multi funcs | link.c:410 array | :422 array | Balanced |
| Tracing_multi funcs | link.c:441 array | :468 array | Balanced |
| Optional pinned paths | link.c:688 array | :691 array | Balanced |
| PID/owner refs | pids.c:221 array, :225 object | :228 object, :230 array | Balanced and untouched |

In show_kprobe_multi_json the code opens funcs **before** calling
get_addr_cookie_array. If its calloc fails (link.c:266-282, :338-342),
the renderer returns without closing funcs. If kernel_syms_load leaves
dd.sym_count zero (link.c:344-348), control jumps to error **after**
jsonw_end_array; the array is still open. xlated_dumper.c:26-70 can
leave symbols empty when /proc/kallsyms is unavailable or unusable.
Both paths leave depth one too high at the eventual destructor.

The live evidence established SIGABRT at json_writer.c:107 in
jsonw_destroy with an immediate caller inside the bpftool ELF.
**It did not record the link type or whether calloc failed or
dd.sym_count remained zero.** Active kprobe_multi metadata can enter
this renderer, while idle enumeration without those links cannot.
This is a proven source defect, **not yet proof of which live branch
triggered the previous crash**. A separate TRACING lookup error is
another static unbalanced path and is out of scope for this narrow fix.

## Correction and synthetic proof

Patch: scripts/clack-bpftool-json-balance.patch

Patch SHA-256: 3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d

Only show_kprobe_multi_json changes: both early exits become goto out,
and the single jsonw_end_array is moved to the common out label
before free(data). The array closes **exactly once** on success,
NULL allocation and absent symbols. No assertion is suppressed, no
link is omitted, no errors are ignored, and no ownership/session,
libbpf or Clack readiness code changes.

scripts/clack-bpftool-json-balance.test.py SHA-verifies the pinned
source and libbpf archives, compiles the **actual archived**
json_writer.c and exact extracted renderer and helper source, with
only synthetic symbol loading and controlled calloc failure. It
does not load BPF or run the private bpftool. Synthetic children
inherit RLIMIT_CORE=0.

| Synthetic case | Original code | Corrected code |
| --- | --- | --- |
| Empty symbols | **SIGABRT** at real jsonw_destroy depth assertion | Clean, valid JSON with funcs empty |
| Allocation returns NULL | **SIGABRT** at same assertion | Clean, valid JSON with funcs empty |
| Normal two functions | Valid JSON | Byte-identical valid JSON, same functions/cookies |
| Idle enumeration | Empty JSON array | Byte-identical empty JSON array |
| Synthetic PID/owner fields | Rendered on normal path | Preserved in corrected paths |

Additional tests verify exact source lines, checked patch application,
the prior ++j fix, mandatory build skeletons and binary provenance.
**7/7 offline Linux tests passed.** This supports **A4 (synthetic
reproduction confirms a source defect)** and also directly establishes
two precise missing closes. It does not prove the actual live branch.

## Upstream history

Upstream kernel change 0d5e3fc78a6f2522e6339743b8e5ecc02351a9dd
(mirrored in pinned 678d538...) changes the kprobe_multi loop
postincrement j++ to preincrement ++j to prevent an out-of-bounds
read. That fix is **already present** and does not address the JSON
begin/end imbalance. Public 2026 source mirrors still show the
two early exits. No later commit SHA fixing this exact imbalance
was verified, so **no matching upstream fix is claimed**.

## Separate offline build (not installed or executed)

scripts/clack-build-json-balance-offline.sh accepts only exact
source/libbpf/patch hashes in a fresh hylab-owned 0700 directory.
The pinned archived link.c retains CRLF, so checked Git patch
application uses --ignore-whitespace for context matching. The
previous ++j correction and mandatory owner-PID skeleton support
remain enabled; compilation disables optional disassembler backends
only. Neither this script nor its produced binary was run against
kernel links. The **built binary itself was not executed**.

| Artifact | Value |
| --- | --- |
| Source base | 678d538a85e6960f84e443695eebb13f66f89981 plus reviewed overlay patch |
| libbpf | 872299d94e27d2fa9f119667c7e52268698dc760 |
| Built binary SHA-256 | **0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0** |
| ELF Build ID | **7f530859f49ede16767f9f4eb8551a6ac85aa25d** |
| Size | 2,479,576 bytes |
| Version | 7.8.1 (source Makefile), libbpf 1.9.0 pinned |
| pids.o and pid_iter.skel.h | PASS |
| New binary executed | 0 |
| Unprivileged remote build-stage cleanup | PASS |

The downloaded binary and 616-byte normalized receipt are retained
only in ignored src-tauri/target/clack-bpftool-json-balance/.
The downloaded SHA was independently recomputed and ELF build ID
independently read using readelf. **The root-installed binary, its
root-controlled pin and the crash observer remain unchanged.**

## Future boundary

A separately authorized root replacement and **one** investigative,
short kernel-only validation are technically justified to test the
candidate. The original root installer is exclusive-create and
SHA-pinned to the old binary; it must NOT be reused to overwrite the
installation. Any future attempt needs new root provenance,
human-admin authorization, independent verification and a fresh
live-run authorization. No such run or deployment occurs here.
An investigative result must still keep TCPARMED=FAIL and readiness
false regardless of JSON rendering success.
