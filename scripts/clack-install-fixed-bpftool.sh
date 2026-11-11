#!/usr/bin/env bash
# Human-triggered ROOT IDLE-ONLY qualification. Never attach BPF programs.
# No system package changes, no /usr/bin writes, no PATH changes, no inference.
set -Eeuo pipefail
umask 077

if [[ $# != 2 || $(/usr/bin/id -u) != 0 ||
      ! $1 =~ ^/home/hylab/\.cache/clack-bpftool-fixed\.[A-Za-z0-9]{8}$ ||
      ! $2 =~ ^[a-f0-9]{64}$ ]]; then
  printf 'CLACK_BPFT_ROOT_QUALIFICATION=INVALID_ARGS\n' >&2
  exit 1
fi
stage=$1
expected_sha=$2
if [[ $expected_sha != ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d ]]; then
  printf 'CLACK_BPFT_ROOT_QUALIFICATION=UNREVIEWED_BINARY_HASH\n' >&2
  exit 1
fi
target=/opt/clack/diagnostic-tools/bpftool-678d538
pin=$target.pin.json
packaged=/usr/bin/bpftool
created_binary=0
created_pin=0
snapshot=
cleanup_on_failure() {
  local code=$?
  trap - EXIT
  # Never execute the unprivileged operator's mutable build output as root.
  # Only the reviewed names under our *exclusive* private snapshot are ours.
  if [[ -n $snapshot && -d $snapshot && ! -L $snapshot &&
        $(/usr/bin/stat -c '%U:%a' -- "$snapshot") == root:700 ]]; then
    /usr/bin/rm -f -- "$snapshot/bpftool" "$snapshot/bpftool-source.tar" \
      "$snapshot/libbpf-source.tar" "$snapshot/link.c" \
      "$snapshot/pids.o" "$snapshot/pid_iter.skel.h" || code=1
    /usr/bin/rmdir -- "$snapshot" || code=1
  fi
  if ((code != 0)); then
    if ((created_pin)); then /usr/bin/rm -f -- "$pin"; fi
    if ((created_binary)); then /usr/bin/rm -f -- "$target"; fi
  fi
  exit "$code"
}
trap cleanup_on_failure EXIT

if [[ ! -d $stage || -L $stage ||
      $(/usr/bin/stat -c '%U:%a' -- "$stage") != hylab:700 ||
      ! -f $stage/build-summary.numeric ||
      ! -f $stage/.build-complete ||
      -e $stage/root-idle-summary.numeric ||
      -L $stage/root-idle-summary.numeric ||
      ! -f $stage/out/bpftool || -L $stage/out/bpftool ||
      ! -f $stage/out/pids.o ||
      ! -f $stage/out/pid_iter.skel.h ||
      ! -f $stage/source/src/link.c ]]; then
  printf 'CLACK_BPFT_ROOT_QUALIFICATION=INVALID_STAGE\n' >&2
  exit 1
fi
# Snapshot all inputs to a fresh root-owned, 0700 /run directory. The
# hylab-owned stage is allowed to disappear or mutate after this point.
# A digest checked on a user-owned file before execution is NOT a pin.
snapshot=$(/usr/bin/mktemp -d -p /run clack-bpftool-idle.XXXXXXXX)
if [[ ! -d $snapshot || -L $snapshot ||
      $(/usr/bin/stat -c '%U:%a' -- "$snapshot") != root:700 ]]; then
  printf 'CLACK_BPFT_ROOT_QUALIFICATION=SNAPSHOT_UNTRUSTED\n' >&2
  exit 1
fi
for pair in \
  "$stage/out/bpftool bpftool" \
  "$stage/bpftool-678d538a-source.tar bpftool-source.tar" \
  "$stage/libbpf-872299d9-source.tar libbpf-source.tar" \
  "$stage/source/src/link.c link.c" \
  "$stage/out/pids.o pids.o" \
  "$stage/out/pid_iter.skel.h pid_iter.skel.h"; do
  source=${pair%% *}
  dest=$snapshot/${pair#* }
  if [[ ! -f $source || -L $source ]]; then
    printf 'CLACK_BPFT_ROOT_QUALIFICATION=SOURCE_SWAP_OR_SYMLINK\n' >&2
    exit 1
  fi
  /usr/bin/install -o root -g root -m 0600 -- "$source" "$dest"
done
binary=$snapshot/bpftool
for pair in \
  "63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362 $snapshot/bpftool-source.tar" \
  "66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74 $snapshot/libbpf-source.tar" \
  "$expected_sha $binary"; do
  printf '%s\n' "$pair" | /usr/bin/sha256sum --check --status
done
if [[ $(/usr/bin/grep -Fc 'if (++j == info->kprobe_multi.count)' -- "$snapshot/link.c") != 2 ||
      $(/usr/bin/grep -Fc 'if (j++ == info->kprobe_multi.count)' -- "$snapshot/link.c") != 0 ||
      ! -s $snapshot/pids.o || ! -s $snapshot/pid_iter.skel.h ]]; then
  printf 'CLACK_BPFT_ROOT_QUALIFICATION=RENDERER_NOT_FIXED\n' >&2
  exit 1
fi
if [[ -e $target || -L $target || -e $pin || -L $pin ]]; then
  printf 'CLACK_BPFT_ROOT_QUALIFICATION=ALREADY_INSTALLED\n' >&2
  exit 1
fi

# The two programs are compared ONLY while idle; no probes/commands that
# attach a BPF program are invoked. No raw BPF rows or stderr are exported.
/usr/bin/chmod 0700 -- "$binary"
idle_summary=$(/usr/bin/python3 - "$binary" "$packaged" <<'PY'
import hashlib
import json
import subprocess
import sys

fixed, packaged = sys.argv[1:]
def snapshot(path, kind):
    argv = [path, "-j", kind, "show"]
    process = subprocess.run(
        argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, timeout=3, check=False)
    if process.returncode != 0 or process.stderr or not 0 < len(process.stdout) < 4_194_304:
        raise SystemExit("CLACK_BPFT_ROOT_QUALIFICATION=IDLE_ENUMERATION_FAILED")
    try:
        rows = json.loads(process.stdout)
    except (ValueError, UnicodeError):
        raise SystemExit("CLACK_BPFT_ROOT_QUALIFICATION=IDLE_JSON_INVALID")
    if not isinstance(rows, list) or not all(
            isinstance(row, dict) and
            type(row.get("id")) is int and row["id"] > 0 and
            isinstance(row.get("type"), str) for row in rows):
        raise SystemExit("CLACK_BPFT_ROOT_QUALIFICATION=IDLE_SCHEMA_INVALID")
    keys = ("id", "type", "prog_id") if kind == "link" else ("id", "type", "name")
    summary = sorted(tuple(row.get(key) for key in keys) for row in rows)
    canonical = json.dumps(summary, separators=(",", ":")).encode("ascii")
    return len(rows), hashlib.sha256(canonical).hexdigest()

version = subprocess.run(
    [fixed, "-j", "version"], stdin=subprocess.DEVNULL,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=3, check=False)
if version.returncode != 0 or version.stderr or not 0 < len(version.stdout) < 2048:
    raise SystemExit("CLACK_BPFT_ROOT_QUALIFICATION=VERSION_FAILED")
try:
    identity = json.loads(version.stdout)
except (ValueError, UnicodeError):
    raise SystemExit("CLACK_BPFT_ROOT_QUALIFICATION=VERSION_JSON_INVALID")
if not isinstance(identity, dict) or identity.get("version") != "7.8.1" or \
        identity.get("libbpf_version") != "1.9" or \
        not isinstance(identity.get("features"), dict) or \
        identity["features"].get("skeletons") is not True:
    raise SystemExit("CLACK_BPFT_ROOT_QUALIFICATION=VERSION_OR_SKELETON_MISMATCH")
for kind in ("prog", "link"):
    fixed_result = snapshot(fixed, kind)
    packaged_result = snapshot(packaged, kind)
    if fixed_result != packaged_result:
        raise SystemExit("CLACK_BPFT_ROOT_QUALIFICATION=IDLE_SEMANTICS_MISMATCH")
    print(f"CLACK_BPFT_IDLE_{kind.upper()}_COUNT={fixed_result[0]}")
    print(f"CLACK_BPFT_IDLE_{kind.upper()}_SEMANTICS_SHA256={fixed_result[1]}")
    print(f"CLACK_BPFT_IDLE_{kind.upper()}_COMPARE=PASS")
print("CLACK_BPFT_IDLE_VERSION=7_8_1")
print("CLACK_BPFT_IDLE_LIBBPF=1_9")
PY
)

# Make no changes outside this explicitly named diagnostic directory.
for dir in /opt /opt/clack /opt/clack/diagnostic-tools; do
  if [[ -e $dir || -L $dir ]]; then
    if [[ ! -d $dir || -L $dir ||
          $(/usr/bin/stat -c '%u' -- "$dir") != 0 ||
          $((0$(/usr/bin/stat -c '%a' -- "$dir") & 022)) != 0 ]]; then
      printf 'CLACK_BPFT_ROOT_QUALIFICATION=UNTRUSTED_DESTINATION\n' >&2
      exit 1
    fi
  else
    /usr/bin/install -d -o root -g root -m 0755 -- "$dir"
  fi
done
/usr/bin/install -o root -g root -m 0755 -- "$binary" "$target"
created_binary=1
printf '%s  %s\n' "$expected_sha" "$target" | /usr/bin/sha256sum --check --status

# Persist an exact root-controlled digest/provenance pin. A loose env var
# or caller-supplied hash cannot authorize a later Clack diagnostic.
created_pin=1
/usr/bin/python3 - "$pin" "$expected_sha" <<'PY'
import json
import os
import sys

path, digest = sys.argv[1:]
row = {
    "schemaVersion": 1,
    "binaryPath": "/opt/clack/diagnostic-tools/bpftool-678d538",
    "binarySha256": digest,
    "version": "7.8.1",
    "libbpfVersion": "1.9",
    "sourceCommit": "678d538a85e6960f84e443695eebb13f66f89981",
    "libbpfCommit": "872299d94e27d2fa9f119667c7e52268698dc760",
    "linkBlob": "5cffa2d283b47327b8611b4d85b1d70821f40964",
    "sourceArchiveSha256": "63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362",
    "libbpfArchiveSha256": "66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74",
}
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
try:
    with os.fdopen(fd, "w", encoding="ascii") as output:
        json.dump(row, output, sort_keys=True, separators=(",", ":"))
        output.write("\n")
finally:
    os.chmod(path, 0o644)
PY
printf '%s  %s\n' "$expected_sha" "$target" | /usr/bin/sha256sum --check --status
if [[ ! -s $pin || -L $pin || $(/usr/bin/stat -c '%U:%a' -- "$pin") != root:644 ||
      $(/usr/bin/stat -c '%U:%a' -- "$target") != root:755 ]]; then
  printf 'CLACK_BPFT_ROOT_QUALIFICATION=PIN_OR_MODE_FAILURE\n' >&2
  exit 1
fi
{
  printf '%s\n' "$idle_summary"
  printf 'CLACK_BPFT_ROOT_QUALIFICATION=PASS\n'
  printf 'CLACK_BPFT_PRIVATE_BINARY_SHA256=%s\n' "$expected_sha"
  printf 'CLACK_BPFT_PATH_CLASS=opt_clack_diagnostic_678d538\n'
  printf 'CLACK_BPFT_SYSTEM_PACKAGE_UNCHANGED=1\n'
} > "$stage/root-idle-summary.numeric"
/usr/bin/chown hylab:hylab -- "$stage/root-idle-summary.numeric"
/usr/bin/chmod 0600 -- "$stage/root-idle-summary.numeric"
printf 'CLACK_BPFT_ROOT_QUALIFICATION=PASS\n'
printf 'CLACK_BPFT_PRIVATE_BINARY_SHA256=%s\n' "$expected_sha"
printf 'CLACK_BPFT_PATH_CLASS=opt_clack_diagnostic_678d538\n'
printf 'CLACK_BPFT_SYSTEM_PACKAGE_UNCHANGED=1\n'
printf '%s\n' "$idle_summary"
