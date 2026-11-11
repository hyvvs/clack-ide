#!/usr/bin/env bash
# HUMAN ROOT ONLY. Replace only private bpftool and its root-owned manifest.
# Zero BPF attachments. Idle-only prog/link JSON queries occur after renames.
set -Eeuo pipefail
umask 077

[[ $# == 1 && $(/usr/bin/id -u) == 0 ]]
stage=$1
parent=/opt/clack/diagnostic-tools
target=$parent/bpftool-678d538
pin=$parent/bpftool-678d538.pin.json
new_sha=0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0
old_sha=ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d
build_id=7f530859f49ede16767f9f4eb8551a6ac85aa25d
source_sha=63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362
libbpf_sha=66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74
patch_sha=3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d
swapped=0
qualified=0
old_pin_sha=''
new_pin_sha=''

sha() { /usr/bin/sha256sum -- "$1" | /usr/bin/cut -d' ' -f1; }
root_file() {
  [[ -f $1 && ! -L $1 &&
     $(/usr/bin/stat -c '%u:%g:%a:%h' -- "$1") == "$2" ]]
}
old_is_installed() {
  root_file "$target" 0:0:755:1 &&
  root_file "$pin" 0:0:644:1 &&
  [[ $(sha "$target") == "$old_sha" && $(sha "$pin") == "$old_pin_sha" ]]
}
new_is_installed() {
  root_file "$target" 0:0:755:1 &&
  root_file "$pin" 0:0:644:1 &&
  [[ $(sha "$target") == "$new_sha" && $(sha "$pin") == "$new_pin_sha" ]]
}
on_exit() {
  local code=$? cleanup=PASS rollback=NOT_REQUIRED
  trap - EXIT INT TERM HUP
  if [[ ! $stage =~ ^/opt/clack/diagnostic-tools/\.clack-json-replace\.[A-Za-z0-9]{8}$ ||
        ! -d $stage || -L $stage ||
        $(/usr/bin/stat -c '%u:%g:%a' -- "$stage") != 0:0:700 ]]; then
    cleanup=FAIL
  else
    if ((swapped && !qualified)); then
      rollback=FAIL
      # Never consume the only verified old backup on a failed rollback.
      if root_file "$stage/old-bpftool" 0:0:755:1 &&
         root_file "$stage/old-pin.json" 0:0:644:1 &&
         [[ $(sha "$stage/old-bpftool") == "$old_sha" &&
            $(sha "$stage/old-pin.json") == "$old_pin_sha" ]] &&
         /usr/bin/install -o root -g root -m 0755 -- "$stage/old-bpftool" "$stage/rollback-bpftool" &&
         /usr/bin/install -o root -g root -m 0644 -- "$stage/old-pin.json" "$stage/rollback-pin.json" &&
         root_file "$stage/rollback-bpftool" 0:0:755:1 &&
         root_file "$stage/rollback-pin.json" 0:0:644:1 &&
         [[ $(sha "$stage/rollback-bpftool") == "$old_sha" &&
            $(sha "$stage/rollback-pin.json") == "$old_pin_sha" ]] &&
         /usr/bin/mv -T -- "$stage/rollback-bpftool" "$target" &&
         /usr/bin/mv -T -- "$stage/rollback-pin.json" "$pin" &&
         old_is_installed; then
        rollback=PASS
      fi
    fi
    if [[ $rollback != FAIL ]]; then
      # Exclusive root-owned directory only; no wildcard outside it.
      /usr/bin/rm -rf -- "$stage" || cleanup=FAIL
    else
      cleanup=FAIL
      printf 'CLACK_JSON_REPLACE_RECOVERY=ROOT_BACKUP_RETAINED\n' >&2
      printf 'CLACK_JSON_REPLACE_RECOVERY_STAGE=%s\n' "$stage" >&2
    fi
  fi
  if [[ $rollback == PASS ]]; then
    printf 'CLACK_JSON_REPLACE_ROLLBACK=PASS\n' >&2
  fi
  if [[ $cleanup != PASS ]]; then code=1; fi
  if ((code == 0)); then
    printf 'CLACK_JSON_REPLACE=PASS\n'
    printf 'CLACK_JSON_REPLACE_SHA256=%s\n' "$new_sha"
    printf 'CLACK_JSON_REPLACE_BUILD_ID=%s\n' "$build_id"
    printf 'CLACK_JSON_REPLACE_PIN_SCHEMA=2\n'
    printf 'CLACK_JSON_REPLACE_OWNER=root:root\n'
    printf 'CLACK_JSON_REPLACE_BINARY_MODE=0755\n'
    printf 'CLACK_JSON_REPLACE_PIN_MODE=0644\n'
    printf 'CLACK_JSON_REPLACE_ROOT_CLEANUP=PASS\n'
    printf 'CLACK_JSON_REPLACE_BPF_ATTACHMENTS=0\n'
    printf 'CLACK_JSON_REPLACE_SYSTEM_BPFT_UNCHANGED=1\n'
  else
    printf 'CLACK_JSON_REPLACE=FAIL\n' >&2
    printf 'CLACK_JSON_REPLACE_ROOT_CLEANUP=%s\n' "$cleanup" >&2
  fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

[[ $stage =~ ^/opt/clack/diagnostic-tools/\.clack-json-replace\.[A-Za-z0-9]{8}$ &&
   -d $stage && ! -L $stage &&
   $(/usr/bin/stat -c '%u:%g:%a' -- "$stage") == 0:0:700 ]]
for dir in /opt /opt/clack "$parent"; do
  [[ -d $dir && ! -L $dir && $(/usr/bin/stat -c '%u' -- "$dir") == 0 ]]
  mode=$(/usr/bin/stat -c '%a' -- "$dir")
  (( (8#$mode & 022) == 0 ))
done
root_file "$target" 0:0:755:1
root_file "$pin" 0:0:644:1
[[ $(sha "$target") == "$old_sha" ]]
old_pin_sha=$(sha "$pin")
root_file /usr/bin/bpftool 0:0:755:1
system_bpftool_sha=$(sha /usr/bin/bpftool)

# The pre-existing root pin must exactly match the previously qualified v1.
/usr/bin/python3 - "$pin" <<'PY'
import json,sys
from pathlib import Path
expected = {
  "schemaVersion":1,
  "binaryPath":"/opt/clack/diagnostic-tools/bpftool-678d538",
  "binarySha256":"ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d",
  "version":"7.8.1","libbpfVersion":"1.9",
  "sourceCommit":"678d538a85e6960f84e443695eebb13f66f89981",
  "libbpfCommit":"872299d94e27d2fa9f119667c7e52268698dc760",
  "linkBlob":"5cffa2d283b47327b8611b4d85b1d70821f40964",
  "sourceArchiveSha256":"63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362",
  "libbpfArchiveSha256":"66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74"
}
raw=Path(sys.argv[1]).read_bytes()
assert 0 < len(raw) < 2048 and json.loads(raw) == expected
PY

[[ ! -e /run/local-muse-ebpf && ! -L /run/local-muse-ebpf ]]
for process in bpftrace gdb; do
  if /usr/bin/pgrep -x "$process" >/dev/null; then
    exit 1
  else
    code=$?
    ((code == 1))
  fi
done

# Only copies already owned by root, no symlinks or hard links, can be used.
for file in source.tar libbpf.tar fix.patch build-summary.numeric idle-qualify.py; do
  root_file "$stage/$file" 0:0:600:1
done
root_file "$stage/new-bpftool" 0:0:755:1
[[ $(sha "$stage/new-bpftool") == "$new_sha" &&
   $(sha "$stage/source.tar") == "$source_sha" &&
   $(sha "$stage/libbpf.tar") == "$libbpf_sha" &&
   $(sha "$stage/fix.patch") == "$patch_sha" ]]
[[ $(/usr/bin/stat -c '%s' -- "$stage/new-bpftool") == 2479576 ]]
actual_build_id=$(/usr/bin/readelf -n "$stage/new-bpftool" |
    /usr/bin/sed -n 's/^[[:space:]]*Build ID: \([a-f0-9]*\).*/\1/p' |
    /usr/bin/head -1)
[[ $actual_build_id == "$build_id" ]]

# Verify normalized build receipt plus exact overlay against original source.
# Only hash-verified root-owned bytes are parsed, not arbitrary user assertions.
/usr/bin/python3 - "$stage" <<'PY'
import hashlib,subprocess,sys,tarfile
from pathlib import Path
folder=Path(sys.argv[1])
received={}
for row in (folder/"build-summary.numeric").read_text(encoding="ascii").splitlines():
    k,sep,v=row.partition("=")
    assert sep and k and k.replace("_","").isalnum() and k.isupper()
    assert k not in received
    received[k]=v
expected={
  "OFFLINE_JSON_BUILD":"PASS",
  "SOURCE_COMMIT":"678d538a85e6960f84e443695eebb13f66f89981",
  "SOURCE_TAR_SHA256":"63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362",
  "LIBBPF_COMMIT":"872299d94e27d2fa9f119667c7e52268698dc760",
  "LIBBPF_TAR_SHA256":"66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74",
  "PATCH_SHA256":"3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d",
  "BINARY_SHA256":"0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0",
  "BINARY_BYTES":"2479576",
  "BINARY_BUILD_ID":"7f530859f49ede16767f9f4eb8551a6ac85aa25d",
  "VERSION_FROM_PINNED_SOURCE":"7.8.1",
  "OWNER_PID_SKELETON":"PASS",
  "BUILT_BINARY_EXECUTED":"0"
}
assert received == expected
with tarfile.open(folder/"source.tar") as source:
    raw=source.extractfile("src/link.c").read()
def blob(data):
    return hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
assert blob(raw.replace(b"\r\n",b"\n"))=="5cffa2d283b47327b8611b4d85b1d70821f40964"
tree=folder/"provenance"/"src"
tree.mkdir(parents=True)
link=tree/"link.c"
link.write_bytes(raw)
for check in (True,False):
    argv=["/usr/bin/git","-C",str(tree.parent),"apply"]
    if check: argv.append("--check")
    argv.extend(("--ignore-whitespace",str(folder/"fix.patch")))
    subprocess.run(argv,check=True,stdin=subprocess.DEVNULL,
                   stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
fixed=link.read_bytes()
assert hashlib.sha256(fixed).hexdigest()=="b94fcf719e96993501d9dd1ef4be812ed250b34d92949137139944f6ec64c271"
assert blob(fixed.replace(b"\r\n",b"\n"))=="4a8747204f8e98e24ca7aa29690582b4f3eece52"
assert fixed.count(b"if (++j == info->kprobe_multi.count)")==2
print("CLACK_JSON_SOURCE_PROVENANCE=PASS")
PY

old_is_installed
# Root backup survives until the new binary, manifest and idle probes pass.
/usr/bin/install -o root -g root -m 0755 -- "$target" "$stage/old-bpftool"
/usr/bin/install -o root -g root -m 0644 -- "$pin" "$stage/old-pin.json"
root_file "$stage/old-bpftool" 0:0:755:1
root_file "$stage/old-pin.json" 0:0:644:1
[[ $(sha "$stage/old-bpftool") == "$old_sha" &&
   $(sha "$stage/old-pin.json") == "$old_pin_sha" ]]

# Version 2 identifies both original source archives and the reviewed patch.
/usr/bin/python3 - "$stage/new-pin.json" <<'PY'
import json,os,sys
row={
  "schemaVersion":2,
  "binaryPath":"/opt/clack/diagnostic-tools/bpftool-678d538",
  "binarySha256":"0e0059127c7c926fe1ee82a7804479415a19b73515b7aebc8bb59ce06de36fa0",
  "binaryBuildId":"7f530859f49ede16767f9f4eb8551a6ac85aa25d",
  "version":"7.8.1","libbpfVersion":"1.9",
  "sourceCommit":"678d538a85e6960f84e443695eebb13f66f89981",
  "libbpfCommit":"872299d94e27d2fa9f119667c7e52268698dc760",
  "linkBlob":"5cffa2d283b47327b8611b4d85b1d70821f40964",
  "sourceArchiveSha256":"63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362",
  "libbpfArchiveSha256":"66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74",
  "patchSha256":"3404f298ae9e2eaef4ef0533971667bf1a1c71b3fe4e8bc4a489cf0749384d2d",
  "patchedLinkBlob":"4a8747204f8e98e24ca7aa29690582b4f3eece52",
  "patchedLinkSha256":"b94fcf719e96993501d9dd1ef4be812ed250b34d92949137139944f6ec64c271"
}
fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
with os.fdopen(fd,"w",encoding="ascii") as handle:
    json.dump(row,handle,sort_keys=True,separators=(",",":"))
    handle.write("\n")
os.chmod(sys.argv[1],0o644)
PY
root_file "$stage/new-pin.json" 0:0:644:1
new_pin_sha=$(sha "$stage/new-pin.json")

# Each rename is atomic, even though the two files are not a transaction.
# The existing collector is independently SHA/schema fail-closed. No tracer
# is allowed to run while the pair is being changed.
swapped=1
/usr/bin/mv -T -- "$stage/new-bpftool" "$target"
/usr/bin/mv -T -- "$stage/new-pin.json" "$pin"
new_is_installed
[[ $(/usr/bin/readelf -n "$target" |
   /usr/bin/sed -n 's/^[[:space:]]*Build ID: \([a-f0-9]*\).*/\1/p' |
   /usr/bin/head -1) == "$build_id" ]]

# Real kernel enumeration, but IDLE ONLY; no attach/load and no HTTP.
/usr/bin/python3 -B "$stage/idle-qualify.py" >"$stage/idle-summary.numeric"
/usr/bin/grep -Fxq 'CLACK_JSON_IDLE=PASS' -- "$stage/idle-summary.numeric"
/usr/bin/grep -Fxq 'CLACK_JSON_IDLE_PROG_COMPARE=PASS' -- "$stage/idle-summary.numeric"
/usr/bin/grep -Fxq 'CLACK_JSON_IDLE_LINK_COMPARE=PASS' -- "$stage/idle-summary.numeric"
/usr/bin/grep -Fxq 'CLACK_JSON_IDLE_OWNER_SKELETON=PASS' -- "$stage/idle-summary.numeric"
new_is_installed
[[ $(sha /usr/bin/bpftool) == "$system_bpftool_sha" ]]
qualified=1
/usr/bin/cat -- "$stage/idle-summary.numeric"
