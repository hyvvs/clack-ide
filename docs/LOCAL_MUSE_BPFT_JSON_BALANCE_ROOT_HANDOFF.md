# Private bpftool JSON writer fix: administrator replacement handoff

**Not executed at authoring time.** Phase 1 requires a person at the
interactive sudo prompt. No BPF attachment, kernel collector, importer,
Ollama HTTP, Muse, inference, ForgeBoard or coordinator is run during
preparation. All six protected modified files, stashes and historical
evidence remain outside the commit.

From the approved Windows /clack checkout, run exactly once:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Replace-ClackBpftoolJsonBalance.ps1

This is **not** the old exclusive-create installer. The reviewed entry
point only replaces these existing root-owned files:

* /opt/clack/diagnostic-tools/bpftool-678d538
* /opt/clack/diagnostic-tools/bpftool-678d538.pin.json

It never changes /usr/bin/bpftool, packages, PATH, BPF attachments,
services, or readiness logic. The executable's mode remains 0755 and
the root-owned provenance manifest remains mode 0644.

The Windows operator verifies the downloaded binary SHA, original
bpftool and pinned libbpf archive hashes, reviewed overlay patch SHA,
complete 12-field build receipt, and exact reviewed root/idle-helper
script hashes before any upload. Its temporary hylab-owned upload is
exclusive, sanitized, and cleaned after the root command.

The root bootstrap verifies an exclusive root-owned 0700 stage on the
same filesystem as the existing private binary. It copies every
uploaded file to this stage and verifies SHA-256 **before executing
either root script or inspector**.

The root script then checks the installed old binary and exact
schema-v1 manifest; refuses changed, symlinked or in-use private
files; proves the patched source by applying the reviewed patch to
the SHA-pinned original source archive; compares the resulting
SHA-256 and Git blob; verifies the binary Build ID using readelf; and
checks the owner-PID skeleton claim against the sealed build receipt.

After backing up both original files, it replaces the executable and
new schema-v2 provenance manifest via separate same-directory atomic
renames. Because two renames cannot form a filesystem transaction,
**the collector independently rejects any mismatched intermediate
pair**. No tracer may be active during replacement. A failure before
final qualification attempts to restore both verified backups; a
rollback failure retains them in the private root stage for
administrator recovery. The exact stage is deleted only after
verified success or confirmed rollback.

## Required root qualification

The root-controlled helper executes only the two literal paths
/opt/clack/diagnostic-tools/bpftool-678d538 and /usr/bin/bpftool.
With RLIMIT_CORE=0, its only commands are:

* Patched private tool: -j version
* Patched private tool: -j prog show and -j link show
* Packaged tool: -j prog show and -j link show

Each must exit 0 without stderr and produce bounded parseable JSON.
The fixed-tool version must report 7.8.1, libbpf 1.9, and skeleton
support. For each idle collection, the normalized ID/type/name or
ID/type/prog_id semantics must exactly match the packaged tool.
Only aggregate counts, comparison hashes and PASS/FAIL may escape.
No BPF is loaded or attached. The root procedure re-hashes both the
installed patched binary and packaged /usr/bin/bpftool at the end and
verifies the ELF Build ID and final owner/modes.

Expected installed private binary:

    SHA256=0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0
    BUILD_ID=7f530859f49ede16767f9f4eb8551a6ac85aa25d
    VERSION=7.8.1
    SOURCE_COMMIT=678d538a85e6960f84e443695eebb13f66f89981
    PATCH_SHA256=3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d
    LIBBPF_COMMIT=872299d94e27d2fa9f119667c7e52268698dc760
    BINARY_MODE=0755
    PIN_MODE=0644
    OWNER=root:root

Only a root PASS receipt plus independent read-only postinstallation
verification can qualify Phase 1. If any comparison fails or the
operator reports cleanup uncertainty, **do not start a live session**.

## Phase 2 boundary and crash-observer compatibility

The new schema-2 collector pin changes **only** which diagnostic
binary is trusted. All positive session program/link proof, event-loss,
FIFO, importer acceptance, authenticated STOP, terminal accounting and
cleanup conditions are unchanged. The six user-edited acceptance files
remain untouched.

The **existing root crash observer** was pinned to the previous
private binary SHA-256 and ELF Build ID. Consequently, it is **not
currently compatible** with the patched binary. A separate reviewed
observer-pin upgrade would be required before an ordinary-live
SIGABRT fallback could use GDB on the new binary. Do **not** launch a
live session assuming that fallback already works, and do not use a
second session to recover from an abort. This Phase 1 handoff does
not replace or execute the crash observer.

Phase 2 is not launched or authorized by this preparation. The
existing kernel readiness conditions have not been relaxed, and
TCPARMED=FAIL and kernel readiness=false remain mandatory until all
proofs pass in a separately authorized single run. Even if they pass,
do not start Muse or ForgeBoard.
