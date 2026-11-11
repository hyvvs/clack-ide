#!/usr/bin/env bash
# Strictly unprivileged, offline source-only build. NEVER install or attach BPF.
# Only run in a fresh user-owned stage, never execute any newly built bpftool.
set -Eeuo pipefail
umask 077

[[ $# == 1 && $(/usr/bin/id -un) == hylab ]] || exit 2
stage=$1
[[ $stage =~ ^/home/hylab/\.cache/clack-bpftool-json-fix\.[A-Za-z0-9]{8}$ &&
   -d $stage && ! -L $stage &&
   $(/usr/bin/stat -c '%U:%a' -- "$stage") == hylab:700 ]] || exit 2
source_tar="$stage/bpftool-678d538a-source.tar"
libbpf_tar="$stage/libbpf-872299d9-source.tar"
patch="$stage/clack-bpftool-json-balance.patch"
for file in "$source_tar" "$libbpf_tar" "$patch"; do
  [[ -f $file && ! -L $file && $(/usr/bin/stat -c '%U' -- "$file") == hylab ]] || exit 2
done
printf '%s  %s\n' \
  63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362 "$source_tar" \
  66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74 "$libbpf_tar" \
  3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d "$patch" |
  /usr/bin/sha256sum --check --status
for file in "$stage/source" "$stage/out" "$stage/build-summary.numeric" "$stage/.build-started"; do
  [[ ! -e $file && ! -L $file ]] || exit 2
done
for exe in /usr/bin/gcc /usr/bin/make /usr/bin/clang /usr/bin/llvm-strip \
           /usr/bin/git /usr/bin/tar /usr/bin/readelf /usr/bin/sha256sum; do
  [[ -x $exe ]] || { printf 'OFFLINE_JSON_BUILD=TOOLCHAIN_UNAVAILABLE\n' >&2; exit 2; }
done
for file in /usr/include/elf.h /usr/include/openssl/ssl.h /usr/include/zlib.h \
            /sys/kernel/btf/vmlinux; do
  [[ -s $file ]] || { printf 'OFFLINE_JSON_BUILD=HEADERS_UNAVAILABLE\n' >&2; exit 2; }
done

printf 'started\n' >"$stage/.build-started"
/usr/bin/mkdir -m 0700 -- "$stage/source" "$stage/out"
/usr/bin/tar -xf "$source_tar" -C "$stage/source" \
  --no-same-owner --no-same-permissions
if [[ -e $stage/source/libbpf ]]; then
  [[ -d $stage/source/libbpf && ! -L $stage/source/libbpf &&
     -z $(/usr/bin/find "$stage/source/libbpf" -mindepth 1 -print -quit) ]] || exit 2
else
  /usr/bin/mkdir -m 0700 -- "$stage/source/libbpf"
fi
/usr/bin/tar -xf "$libbpf_tar" -C "$stage/source/libbpf" \
  --no-same-owner --no-same-permissions

# Patch the verified, extracted source only; preserve both pinned archives.
# Original git-archive src/link.c has CRLF while the reviewed unified diff
# uses LF. Ignore whitespace only for matching patch context; preserve the
# underlying source archive and reject fuzzy/multiple applications.
/usr/bin/git -C "$stage/source" apply --check --ignore-whitespace -- "$patch"
/usr/bin/git -C "$stage/source" apply --ignore-whitespace -- "$patch"
link="$stage/source/src/link.c"
[[ $(/usr/bin/grep -Fc 'if (++j == info->kprobe_multi.count)' -- "$link") == 2 &&
   $(/usr/bin/grep -Fc 'goto out;' -- "$link") -ge 2 &&
   $(/usr/bin/grep -Fc 'jsonw_end_array(json_wtr);' -- "$link") -ge 1 &&
   -s $stage/source/src/skeleton/pid_iter.bpf.c ]] || exit 2

export LC_ALL=C SOURCE_DATE_EPOCH=1793705106
# Preserve mandatory owner-PID skeleton; SKIP_LLVM and SKIP_LIBBFD disable
# optional disassembly only, NOT BTF or skeleton generation. NO make install.
/usr/bin/make -C "$stage/source/src" \
  "OUTPUT=$stage/out/" V=1 SKIP_LLVM=1 SKIP_LIBBFD=1 -j2 \
  >"$stage/build.log" 2>&1 || {
    printf 'OFFLINE_JSON_BUILD=COMPILE_FAILED\n' >&2
    exit 1
  }
binary="$stage/out/bpftool"
for file in "$binary" "$stage/out/pids.o" "$stage/out/pid_iter.skel.h"; do
  [[ -s $file && ! -L $file ]] || exit 1
done
[[ $(/usr/bin/grep -Fc 'BPFTOOL_VERSION := 7.8.1' \
      "$stage/source/src/Makefile") == 1 ]] || exit 1
/usr/bin/chmod 0700 -- "$binary"
binary_sha=$(/usr/bin/sha256sum -- "$binary" | /usr/bin/cut -d' ' -f1)
readelf_id=$(/usr/bin/readelf -n "$binary" |
             /usr/bin/sed -n 's/^[[:space:]]*Build ID: \([a-f0-9]*\).*/\1/p' |
             /usr/bin/head -1)
[[ $binary_sha =~ ^[a-f0-9]{64}$ && $readelf_id =~ ^[a-f0-9]{40}$ ]] || exit 1
{
  printf 'OFFLINE_JSON_BUILD=PASS\n'
  printf 'SOURCE_COMMIT=678d538a85e6960f84e443695eebb13f66f89981\n'
  printf 'SOURCE_TAR_SHA256=63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362\n'
  printf 'LIBBPF_COMMIT=872299d94e27d2fa9f119667c7e52268698dc760\n'
  printf 'LIBBPF_TAR_SHA256=66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74\n'
  printf 'PATCH_SHA256=3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d\n'
  printf 'BINARY_SHA256=%s\n' "$binary_sha"
  printf 'BINARY_BYTES=%s\n' "$(/usr/bin/stat -c '%s' -- "$binary")"
  printf 'BINARY_BUILD_ID=%s\n' "$readelf_id"
  printf 'VERSION_FROM_PINNED_SOURCE=7.8.1\n'
  printf 'OWNER_PID_SKELETON=PASS\n'
  printf 'BUILT_BINARY_EXECUTED=0\n'
} >"$stage/build-summary.numeric"
printf 'complete\n' >"$stage/.build-complete"
/usr/bin/cat -- "$stage/build-summary.numeric"
