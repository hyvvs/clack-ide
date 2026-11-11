# SEPARATE HUMAN-OPERATED ROOT REPLACEMENT. Not the original create-only install.
# No GDB, bpftool execution, BPF attachment, inference, or service mutation.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$local = Join-Path $PSScriptRoot 'clack-bpftool-abort-capture.py'
$key = Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
$remote = 'hylab@192.168.1.44'
$old = 'c5002328d5563c6af32559c4809940d9f89bfc78f330fe9e2022805bca4ac126'
$new = '143c040fe9db82e23f722f77704841f1ac5bc12fbb21c8d0646169f2c01a15fe'
$fixed = 'ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d'
if (-not(Test-Path -LiteralPath $local -PathType Leaf) -or
    -not(Test-Path -LiteralPath $key -PathType Leaf) -or
    (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash.ToLowerInvariant() -cne $new) {
  throw 'Unreviewed enhanced observer or missing SSH identity; no remote changes'
}
$ssh = @('-o','StrictHostKeyChecking=yes','-o','BatchMode=yes',
  '-o','ConnectTimeout=5','-o','ServerAliveInterval=5',
  '-o','ServerAliveCountMax=4','-i',$key)
$scp = @('-q','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes',
  '-o','ConnectTimeout=5','-i',$key)
$stage = $null
try {
  $created = & ssh.exe @ssh '-T' $remote '/usr/bin/mktemp -d -p /home/hylab/.cache clack-crash-replace-upload.XXXXXXXX'
  if ($LASTEXITCODE -ne 0) { throw 'Exclusive private upload stage unavailable' }
  $stage = ($created | Out-String).Trim()
  if ($stage -cnotmatch '^/home/hylab/\.cache/clack-crash-replace-upload\.[A-Za-z0-9]{8}$') {
    throw 'Unapproved upload stage'
  }
  & scp.exe @scp '--' $local ($remote+':'+$stage+'/observer.py')
  if ($LASTEXITCODE -ne 0) { throw 'Private observer upload failed' }

  $bootstrap = @'
set -Eeuo pipefail
umask 077
stage='__STAGE__'
incoming="$stage/observer.py"
parent=/opt/clack/diagnostic-tools
dest="$parent/clack-bpftool-abort-capture.py"
target="$parent/bpftool-678d538"
old='__OLD__'
new='__NEW__'
fixed='__FIXED__'
tmp=''
swapped=0
verified=0
sha() { /usr/bin/sha256sum -- "$1" | /usr/bin/cut -d' ' -f1; }
root_file() {
  [[ -f $1 && ! -L $1 && $(/usr/bin/stat -c '%u:%g:%a:%h' -- "$1") == 0:0:600:1 ]]
}
cleanup() {
  local code=$? clean=PASS rollback=NOT_REQUIRED
  trap - EXIT INT TERM HUP
  if [[ -n $tmp ]]; then
    if [[ ! $tmp =~ ^/opt/clack/diagnostic-tools/\.clack-crash-replace\.[A-Za-z0-9]{8}$ ||
          ! -d $tmp || -L $tmp ||
          $(/usr/bin/stat -c '%u:%g:%a' -- "$tmp") != 0:0:700 ]]; then
      clean=FAIL
    else
      if ((swapped && !verified)); then
        rollback=FAIL
        # Never consume the last verified backup to attempt rollback.
        if root_file "$tmp/previous.py" && [[ $(sha "$tmp/previous.py") == "$old" ]] &&
           /usr/bin/install -o root -g root -m 0600 -- "$tmp/previous.py" "$tmp/revert.py" &&
           root_file "$tmp/revert.py" && [[ $(sha "$tmp/revert.py") == "$old" ]] &&
           /usr/bin/mv -T -- "$tmp/revert.py" "$dest" &&
           root_file "$dest" && [[ $(sha "$dest") == "$old" ]]; then
          rollback=PASS
        fi
      fi
      if [[ $rollback != FAIL ]]; then
        /usr/bin/rm -f -- "$tmp/previous.py" "$tmp/replacement.py" "$tmp/revert.py" || clean=FAIL
        /usr/bin/rmdir -- "$tmp" || clean=FAIL
      else
        # A rollback failure preserves the private root-owned old backup for
        # administrator-only recovery; never silently remove it.
        clean=FAIL
        printf 'CLACK_CRASH_REPLACE_ROLLBACK=FAIL_BACKUP_RETAINED\n' >&2
        printf 'CLACK_CRASH_REPLACE_RECOVERY_STAGE=%s\n' "$tmp" >&2
      fi
    fi
  fi
  if [[ $rollback == PASS ]]; then
    printf 'CLACK_CRASH_REPLACE_ROLLBACK=PASS\n' >&2
  fi
  if [[ $clean != PASS ]]; then code=1; fi
  if ((code != 0)); then
    printf 'CLACK_CRASH_REPLACE=FAIL\n' >&2
    printf 'CLACK_CRASH_REPLACE_STAGE_CLEANUP=%s\n' "$clean" >&2
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
[[ $(/usr/bin/id -u) == 0 ]]
[[ -d $stage && ! -L $stage &&
   $(/usr/bin/stat -c '%U:%a' -- "$stage") == hylab:700 ]]
[[ -f $incoming && ! -L $incoming &&
   $(/usr/bin/stat -c '%U' -- "$incoming") == hylab ]]
[[ $(/usr/bin/stat -c '%s' -- "$incoming") -gt 0 &&
   $(/usr/bin/stat -c '%s' -- "$incoming") -le 32768 ]]
for dir in /opt /opt/clack "$parent"; do
  [[ -d $dir && ! -L $dir && $(/usr/bin/stat -c '%u' -- "$dir") == 0 ]]
  mode=$(/usr/bin/stat -c '%a' -- "$dir")
  (( (8#$mode & 022) == 0 ))
done
# Never replace a changed, foreign, symlinked, or in-use installation.
root_file "$dest"
[[ $(sha "$dest") == "$old" ]]
[[ -f $target && ! -L $target &&
   $(/usr/bin/stat -c '%u:%g:%a:%h' -- "$target") == 0:0:755:1 ]]
[[ $(sha "$target") == "$fixed" ]]
[[ ! -e /run/local-muse-ebpf && ! -L /run/local-muse-ebpf ]]
# pgrep error/unavailability must NOT be mistaken for an idle system.
if /usr/bin/pgrep -x bpftrace >/dev/null; then
  exit 1
else
  status=$?
  [[ $status == 1 ]]
fi
if /usr/bin/pgrep -x gdb >/dev/null; then
  exit 1
else
  status=$?
  [[ $status == 1 ]]
fi
# Stage on the SAME filesystem as the destination: mv -T is an atomic rename.
tmp=$(/usr/bin/mktemp -d -p "$parent" .clack-crash-replace.XXXXXXXX)
[[ $tmp =~ ^/opt/clack/diagnostic-tools/\.clack-crash-replace\.[A-Za-z0-9]{8}$ &&
   ! -L $tmp && $(/usr/bin/stat -c '%u:%g:%a' -- "$tmp") == 0:0:700 ]]
# The user-owned upload can change. Only these root-owned, byte-verified
# snapshots are subsequently installed; the old backup is kept until verified.
/usr/bin/install -o root -g root -m 0600 -- "$incoming" "$tmp/replacement.py"
root_file "$tmp/replacement.py"
[[ $(sha "$tmp/replacement.py") == "$new" ]]
/usr/bin/install -o root -g root -m 0600 -- "$dest" "$tmp/previous.py"
root_file "$tmp/previous.py"
[[ $(sha "$tmp/previous.py") == "$old" ]]
root_file "$dest"
[[ $(sha "$dest") == "$old" ]]
# Set rollback intent BEFORE the rename so any post-rename error restores old.
swapped=1
/usr/bin/mv -T -- "$tmp/replacement.py" "$dest"
root_file "$dest"
[[ $(sha "$dest") == "$new" ]]
verified=1
# Delete ONLY this exclusive stage and its reviewed old backup, after success.
/usr/bin/rm -f -- "$tmp/previous.py"
/usr/bin/rmdir -- "$tmp"
tmp=''
printf 'CLACK_CRASH_REPLACE=PASS\n'
printf 'CLACK_CRASH_REPLACE_PATH=%s\n' "$dest"
printf 'CLACK_CRASH_REPLACE_SHA256=%s\n' "$new"
printf 'CLACK_CRASH_REPLACE_PREVIOUS_SHA256=%s\n' "$old"
printf 'CLACK_CRASH_REPLACE_OWNER=root:root\n'
printf 'CLACK_CRASH_REPLACE_MODE=0600\n'
printf 'CLACK_CRASH_REPLACE_ROOT_STAGE_CLEANUP=PASS\n'
printf 'CLACK_CRASH_REPLACE_EXECUTED=0\n'
'@
  $bootstrap = $bootstrap.Replace('__STAGE__',$stage).
    Replace('__OLD__',$old).Replace('__NEW__',$new).Replace('__FIXED__',$fixed)
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bootstrap))
  if ($encoded.Length -gt 24000) { throw 'Unexpectedly large root replacement command' }
  $command = "/usr/bin/bash -lc 'printf %s $encoded | /usr/bin/base64 -d | /usr/bin/sudo /usr/bin/bash -s'"
  Write-Output 'Root-only atomic crash-observer replacement; no GDB, bpftool, BPF or inference.'
  Write-Output 'Enter sudo password only at the interactive remote terminal prompt.'
  & ssh.exe @ssh '-tt' $remote $command
  if ($LASTEXITCODE -ne 0) { throw 'Atomic crash-observer replacement failed' }
}
finally {
  if ($stage -and $stage -cmatch '^/home/hylab/\.cache/clack-crash-replace-upload\.[A-Za-z0-9]{8}$') {
    $cleanup = "/usr/bin/rm -f -- '"+$stage+"/observer.py'; /usr/bin/rmdir -- '"+$stage+"'"
    & ssh.exe @ssh '-T' $remote $cleanup
    if ($LASTEXITCODE -ne 0) { throw 'Private upload stage cleanup failed' }
    Write-Output 'CLACK_CRASH_REPLACE_USER_STAGE_CLEANUP=PASS'
  }
}
