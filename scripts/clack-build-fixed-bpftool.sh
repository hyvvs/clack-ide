#!/usr/bin/env bash
# No sudo, package changes, eBPF attachment, Clack inference, or PATH edits.
# Run ONLY in a fresh user-owned stage created by Build-ClackFixedBpftool.ps1.
set -Eeuo pipefail
umask 077

if [[ $# != 1 || $(/usr/bin/id -un) != hylab ]]; then
  printf 'CLACK_BPFT_BUILD=INVALID_OPERATOR\n' >&2
  exit 1
fi
stage=$1
if [[ ! $stage =~ ^/home/hylab/\.cache/clack-bpftool-fixed\.[A-Za-z0-9]{8}$ ||
      ! -d $stage || -L $stage ||
      $(/usr/bin/stat -c '%U:%a' -- "$stage") != hylab:700 ]]; then
  printf 'CLACK_BPFT_BUILD=INVALID_STAGE\n' >&2
  exit 1
fi
source_tar=$stage/bpftool-678d538a-source.tar
libbpf_tar=$stage/libbpf-872299d9-source.tar
build_script=$stage/clack-build-fixed-bpftool.sh
for file in "$source_tar" "$libbpf_tar" "$build_script"; do
  if [[ ! -f $file || -L $file || $(/usr/bin/stat -c '%U' -- "$file") != hylab ]]; then
    printf 'CLACK_BPFT_BUILD=INVALID_INPUT\n' >&2
    exit 1
  fi
done
printf '%s  %s\n' \
  63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362 "$source_tar" \
  66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74 "$libbpf_tar" |
  /usr/bin/sha256sum --check --status

if [[ -e $stage/.build-started || -e $stage/.build-complete ||
      -e $stage/source || -e $stage/out || -e $stage/build-summary.numeric ]]; then
  printf 'CLACK_BPFT_BUILD=REPEATED_OR_UNEXPECTED\n' >&2
  exit 1
fi
for exe in /usr/bin/gcc /usr/bin/make /usr/bin/clang /usr/bin/llvm-strip \
    /usr/bin/tar /usr/bin/python3 /usr/bin/sha256sum; do
  if [[ ! -x $exe ]]; then
    printf 'CLACK_BPFT_BUILD=TOOLCHAIN_UNAVAILABLE\n' >&2
    exit 1
  fi
done
if [[ ! -s /sys/kernel/btf/vmlinux ||
      ! -f /usr/include/elf.h || ! -f /usr/include/openssl/ssl.h ||
      ! -f /usr/include/zlib.h ]]; then
  printf 'CLACK_BPFT_BUILD=REQUIRED_BTF_OR_HEADERS_UNAVAILABLE\n' >&2
  exit 1
fi
printf 'started\n' > "$stage/.build-started"
/usr/bin/mkdir -m 0700 -- "$stage/source" "$stage/out"
/usr/bin/tar -xf "$source_tar" -C "$stage/source" --no-same-owner --no-same-permissions
# The pinned Git archive already contains an empty gitlink directory.
# Its presence is expected, but NO pre-existing content is trusted.
if [[ -e $stage/source/libbpf ]]; then
  if [[ ! -d $stage/source/libbpf || -L $stage/source/libbpf ||
        -n $(/usr/bin/find "$stage/source/libbpf" -mindepth 1 -print -quit) ]]; then
    printf 'CLACK_BPFT_BUILD=UNEXPECTED_SUBMODULE_ARCHIVE_CONTENT\n' >&2
    exit 1
  fi
else
  /usr/bin/mkdir -m 0700 -- "$stage/source/libbpf"
fi
/usr/bin/tar -xf "$libbpf_tar" -C "$stage/source/libbpf" \
  --no-same-owner --no-same-permissions

link_source=$stage/source/src/link.c
if [[ $(/usr/bin/grep -Fc 'if (++j == info->kprobe_multi.count)' -- "$link_source") != 2 ||
      $(/usr/bin/grep -Fc 'if (j++ == info->kprobe_multi.count)' -- "$link_source") != 0 ||
      ! -f $stage/source/src/skeleton/pid_iter.bpf.c ]]; then
  printf 'CLACK_BPFT_BUILD=FIX_OR_PID_SKELETON_MISSING\n' >&2
  exit 1
fi

export LC_ALL=C
export SOURCE_DATE_EPOCH=1793705106
# Keep owner-PID BPF skeleton generation ON; no SKIP_CRYPTO/NO_SKELS.
# Skip only optional JIT disassembler backends. No make install.
/usr/bin/make -C "$stage/source/src" \
  "OUTPUT=$stage/out/" V=1 SKIP_LLVM=1 SKIP_LIBBFD=1 -j2 \
  >"$stage/build.log" 2>&1 || {
    printf 'CLACK_BPFT_BUILD=COMPILE_FAILED\n' >&2
    exit 1
  }
binary=$stage/out/bpftool
for file in "$binary" "$stage/out/pids.o" "$stage/out/pid_iter.skel.h"; do
  if [[ ! -s $file || -L $file ]]; then
    printf 'CLACK_BPFT_BUILD=REQUIRED_BINARY_OR_OWNER_SKELETON_MISSING\n' >&2
    exit 1
  fi
done
/usr/bin/chmod 0700 -- "$binary"
version=$("$binary" -j version) || {
  printf 'CLACK_BPFT_BUILD=VERSION_FAILED\n' >&2
  exit 1
}
# Version alone is NOT fix proof; source archive SHA and both ++j checks
# above are separately mandatory. The version's exact embedded string is
# expected to be 7.8.1 from the pinned Makefile.
/usr/bin/python3 -c 'import json,sys; j=json.load(sys.stdin); assert j["version"] == "7.8.1"; assert isinstance(j["libbpf_version"],str) and j["libbpf_version"]; assert isinstance(j["features"],dict)' <<< "$version" || {
  printf 'CLACK_BPFT_BUILD=UNEXPECTED_VERSION_JSON\n' >&2
  exit 1
}
binary_sha=$(/usr/bin/sha256sum -- "$binary" | /usr/bin/cut -d' ' -f1)
if ! [[ $binary_sha =~ ^[a-f0-9]{64}$ ]]; then
  printf 'CLACK_BPFT_BUILD=INVALID_HASH\n' >&2
  exit 1
fi

# Record version/toolchain evidence without untrusted raw build stderr.
{
  printf 'CLACK_BPFT_BUILD=PASS\n'
  printf 'CLACK_BPFT_SOURCE_COMMIT=678d538a85e6960f84e443695eebb13f66f89981\n'
  printf 'CLACK_BPFT_SOURCE_TREE=ea10f8aa913190295735df488ea3069ab72401ae\n'
  printf 'CLACK_BPFT_LIBBPF_COMMIT=872299d94e27d2fa9f119667c7e52268698dc760\n'
  printf 'CLACK_BPFT_LINK_BLOB=5cffa2d283b47327b8611b4d85b1d70821f40964\n'
  printf 'CLACK_BPFT_SOURCE_TAR_SHA256=63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362\n'
  printf 'CLACK_BPFT_LIBBPF_TAR_SHA256=66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74\n'
  printf 'CLACK_BPFT_BINARY_SHA256=%s\n' "$binary_sha"
  printf 'CLACK_BPFT_BINARY_BYTES=%s\n' "$(/usr/bin/stat -c '%s' -- "$binary")"
  printf 'CLACK_BPFT_GCC_VERSION=%s\n' "$(/usr/bin/gcc -dumpfullversion)"
  printf 'CLACK_BPFT_CLANG_MAJOR=%s\n' "$(/usr/bin/clang -dumpversion)"
  printf 'CLACK_BPFT_MAKE_VERSION=%s\n' "$(/usr/bin/make --version | /usr/bin/head -1 | /usr/bin/tr ' ' '_')"
  printf 'CLACK_BPFT_UNAME=%s\n' "$(/usr/bin/uname -m)"
  printf 'CLACK_BPFT_SKELETON_PID_OWNER=PASS\n'
  printf 'CLACK_BPFT_VERSION_JSON_SHA256=%s\n' \
    "$(printf '%s' "$version" | /usr/bin/sha256sum | /usr/bin/cut -d' ' -f1)"
} > "$stage/build-summary.numeric"
printf '%s\n' "$version" > "$stage/version.json"
printf 'completed\n' > "$stage/.build-complete"
/usr/bin/cat -- "$stage/build-summary.numeric"
