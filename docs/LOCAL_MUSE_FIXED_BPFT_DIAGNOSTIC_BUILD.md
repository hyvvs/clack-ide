# Private fixed-bpftool diagnostic qualification

**Scope:** offline source validation and a bounded **human-operated**
build only. No `make install`, no package upgrade, no new BPF attachment,
no Clack inference, no Ollama request, no Muse, ForgeBoard or coordinator.
The distributed `/usr/bin/bpftool` and process-wide `PATH` are unchanged.

## Source provenance (verified locally)

The official `libbpf/bpftool` mirror at
https://github.com/libbpf/bpftool was checked out **detached**, not on a
floating branch, at its first commit containing the upstream fix:

- bpftool source commit:
  `678d538a85e6960f84e443695eebb13f66f89981`
  (the mirror's 2026-11-03 synchronization of the upstream 2026-10-12
  Linux fix `0d5e3fc78a6f2522e6339743b8e5ecc02351a9dd`)
- source tree: `ea10f8aa913190295735df488ea3069ab72401ae`
- libbpf submodule (Git mode 160000):
  `872299d94e27d2fa9f119667c7e52268698dc760`
- patched `src/link.c` Git blob:
  `5cffa2d283b47327b8611b4d85b1d70821f40964`
- pinned `src/Makefile` declares `BPFTOOL_VERSION := 7.8.1`;
  pinned libbpf `src/Makefile` declares `1.9.0`.

Both `show_kprobe_multi_json` and `show_kprobe_multi_plain` contain
`if (++j == info->kprobe_multi.count)`. In the **parent** commit
`10d74da45e6f98bd103ef495102abc7dc332a169`, both were the
vulnerable `if (j++ == info->kprobe_multi.count)`. These exact two
occurrences were compared locally, and the Git object/checkout IDs
were verified. The mirror commit itself is not signed; confidence is
supported by the pinned content, Git hash, and independent upstream
kernel patch comparison, not a claim of a signed release.

Two deterministic `git archive --format=tar HEAD` inputs were created in
the **ignored** `src-tauri/target/clack-bpftool-fixed-build/` folder.
The libbpf submodule is a **separate** archive; it is never replaced by
floating main:

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| `bpftool-678d538a-source.tar` | 1,904,640 | `63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362` |
| `libbpf-872299d9-source.tar` | 4,894,720 | `66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74` |

Neither archive was committed or installed. On another checkout,
regenerate from these two exact Git objects and verify both hashes
**before** any build; do not assume GitHub-generated tarballs have
identical compression bytes.

## Isolated, no-sudo Linux build

`scripts/Build-ClackFixedBpftool.ps1` uses pinned-host SSH and SCP to
create an **exclusive** `/home/hylab/.cache/clack-bpftool-fixed.XXXXXXXX`
directory (mode 0700), transfers the two SHA-pinned tarballs and the
reviewed `scripts/clack-build-fixed-bpftool.sh`, and starts an
unprivileged, 480-second-bounded build. It does **not** invoke sudo,
modify packages, install a binary, attach a probe, change `PATH`, or
call Ollama. It never silently retries a stage.

The Linux build script verifies both SHA-256 digests again, extracts
them in a private source tree, asserts both corrected `++j` clauses,
checks GCC/Clang/LLVM-strip, libelf, OpenSSL, zlib and kernel BTF,
then uses the pinned upstream Makefile:

```sh
make -C "$stage/source/src" "OUTPUT=$stage/out/" V=1 \
  SKIP_LLVM=1 SKIP_LIBBFD=1 -j2
```

Only *optional JIT disassembler* backends are disabled. Kernel BTF,
Clang CO-RE support, and generated `pids.o` /
`pid_iter.skel.h` must remain available: the strict Clack session
proof requires `pids[]` attachment ownership. A binary built
**without** owner-PID skeleton support is not eligible.

On complete build success, the operator script checks exact source
identities, downloads the private `bpftool` bytes into the ignored
local build-evidence directory, independently recomputes SHA-256,
and records the GCC/Clang/make versions and `bpftool -j version`
JSON (expected `version=7.8.1`, `libbpf_version=1.9`).

**Current actual build status:** the first operator stage was created,
but no output binary, summary or version receipt was returned.
Offline inspection of the real source tar found that its empty
`libbpf/` gitlink directory already exists; the initial builder
incorrectly attempted an unconditional second `mkdir`. This is fixed
with an **empty-directory check before extraction** and a synthetic
tar archive regression. The operator's actual first-run error has not
been supplied, so we cannot assert that this was its sole failure.

The operator handoff accepts an explicit eight-hex-character
`-AttemptId` to create a **new** exclusive local evidence subfolder
and remote private stage. It refuses to overwrite or reuse any prior
attempt. A separately authorized corrected build attempt has been
handed off as `-AttemptId a47c6d91`. No resulting compiled SHA-256
or installed binary is certified until that attempt returns a complete
validated receipt. No toolchain version or host compiler success is
asserted before that receipt.

## Diagnostic-only Clack selector (disabled until root qualification)

The reviewed collector `scripts/local-muse-one-ebpf.py` now supports
`--fixed-diagnostic-bpftool` exclusively for **short (<=20-second)**
diagnostic sessions. The operator's short kernel-only shell passes that
switch explicitly; the normal full-duration production mode continues
using the packaged bpftool, without a global `PATH` override.

The *only accepted* diagnostic executable path is
`/opt/clack/diagnostic-tools/bpftool-678d538`. It must be a
root-owned executable with no symlinked, unowned or group/world-writable
path components. A separate root-owned, read-only
`/opt/clack/diagnostic-tools/bpftool-678d538.pin.json` must include
the exact reviewed source commit, libbpf commit, link blob, both
source-tar SHA-256s, an **actual validated binary SHA-256**,
`version=7.8.1` and `libbpfVersion=1.9`.

The collector rejects absent pins, a different absolute path,
`/usr/bin/bpftool`, incorrect SHA-256, unsafe ownership or symlinks,
missing executable permissions, mismatched `-j version` JSON,
disabled skeleton support, tool exit/timeout, and any other
qualification failure. It **never** falls back to the vulnerable
system binary. A selected path/hash/version/source identifier
is preserved as bounded content-free inventory audit metadata.

This does not change `session_link_ids`, attach ownership
requirements, readiness FIFO semantics, STOP or terminal accounting.
No inference is possible from this code or its offline tests.

## Root install and idle root validation — NOT YET COMPLETE

`scripts/Install-ClackFixedBpftool.ps1 -AttemptId <eight-hex-attempt>`
is a **separate, interactive-sudo** handoff, unavailable until the
attempt has a complete local build summary, binary and version receipt.
It checks the operator's independently exported binary digest and
reviewed source identifiers before staging a reviewed Linux installer.
The inline root bootstrap copies that installer into a fresh
root-owned `/run` directory and verifies its SHA-256 before invoking
it. No new BPF program or probe is loaded.

The bounded root installer `scripts/clack-install-fixed-bpftool.sh`
reverifies the two source archives, corrected renderer checks,
generated owner-PID skeleton, and binary SHA-256. **Before installing
anything**, it compares the privately compiled binary and the
packaged `/usr/bin/bpftool` on idle root `-j prog show` and
`-j link show`, requiring both commands to exit zero and return
valid JSON arrays with matching ID/type/program-reference semantics.
Only counts and SHA-256 of bounded canonical metadata leave root;
raw program/link details and stderr are not exported. A mismatch
stops qualification, not a reason to weaken readiness.

Only after passing those checks can it create the root-owned
`/opt/clack/diagnostic-tools/bpftool-678d538` executable and
its immutable-to-nonroot `.pin.json` provenance/digest manifest.
It refuses to overwrite either target; on installation failure it
removes only files created in that invocation. Its content-free idle
audit is copied to the attempt's ignored local evidence directory as
`root-idle-summary.numeric`. It never installs a system package,
changes `/usr/bin/bpftool` or alters `PATH`.

This installer has passed offline Bash/PowerShell syntax checks and
source-boundary review, **not** a root execution. A successful
`root-idle-summary.numeric` and a matching local binary digest are
still required before claiming a host-validated fixed bpftool.

Do not create the root pin or invoke a kernel-only listener until:

1. The private build has emitted a verified binary SHA-256 and its
   full compiler/toolchain and version receipts.
2. The binary has been separately reviewed and copied by a human
   administrator **only** to the root-owned diagnostic path, never
   `/usr/bin/bpftool`, without installing/upgrading packages.
3. Its actual root-run `-j version` agrees with the trusted pin,
   and its idle root `-j prog show` and `-j link show` both
   exit 0 and parse as JSON arrays. Record bounded size/hash,
   schema/counts and compare ID/type/program-reference semantics
   against the packaged tool; never export raw private BPF JSON.
4. Its `link show` capability exposes the required `pids[]`
   owner field in a separately authorized *future* live session;
   idle metadata alone cannot establish that.

No such root install/idle validation has been performed. There is no
approved private executable hash yet, and **no new live kernel-only
validation is justified**. Complete the build and root idle checks
first, with separately controlled sudo if necessary.
