# FUTURE SEPARATE HUMAN sudo STEP ONLY. Install offline-reviewed observer into
# root-owned diagnostic tools, NEVER execute it or attach a BPF program.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$local = Join-Path $PSScriptRoot 'clack-bpftool-abort-capture.py'
$key = Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
$remote = 'hylab@192.168.1.44'
$expected = 'c5002328d5563c6af32559c4809940d9f89bfc78f330fe9e2022805bca4ac126'
$fixed = 'ff08d9fe9a545f488f4ecc7145f491027704a2139987f08432c1f9265be70e3d'
if (-not(Test-Path -LiteralPath $local -PathType Leaf) -or
    -not(Test-Path -LiteralPath $key -PathType Leaf) -or
    (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected) {
  throw 'Unreviewed observer file/key; fail closed before sudo'
}
$ssh = @('-o','StrictHostKeyChecking=yes','-o','BatchMode=yes',
  '-o','ConnectTimeout=5','-o','ServerAliveInterval=5',
  '-o','ServerAliveCountMax=4','-i',$key)
$scp = @('-q','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes',
  '-o','ConnectTimeout=5','-i',$key)
$stage = $null
try {
  $result = & ssh.exe @ssh '-T' $remote '/usr/bin/mktemp -d -p /home/hylab/.cache clack-crash-install.XXXXXXXX'
  if ($LASTEXITCODE -ne 0) { throw 'Exclusive private install stage unavailable' }
  $stage = ($result | Out-String).Trim()
  if ($stage -cnotmatch '^/home/hylab/\.cache/clack-crash-install\.[A-Za-z0-9]{8}$') {
    throw 'Unapproved private stage'
  }
  & scp.exe @scp '--' $local ($remote+':'+$stage+'/clack-bpftool-abort-capture.py')
  if ($LASTEXITCODE -ne 0) { throw 'Private observer upload failed' }

  $bootstrap = @'
set -Eeuo pipefail
umask 077
stage='__STAGE__'
source="$stage/clack-bpftool-abort-capture.py"
dest=/opt/clack/diagnostic-tools/clack-bpftool-abort-capture.py
target=/opt/clack/diagnostic-tools/bpftool-678d538
test "$(/usr/bin/id -u)" = 0
test -d "$stage" && test ! -L "$stage"
test "$(/usr/bin/stat -c '%U:%a' -- "$stage")" = hylab:700
test -f "$source" && test ! -L "$source"
test ! -e "$dest" && test ! -L "$dest"
test "$(/usr/bin/sha256sum -- "$target" | /usr/bin/cut -d' ' -f1)" = __FIXED__
test "$(/usr/bin/gdb --version | /usr/bin/head -n 1)" = 'GNU gdb (GDB) 18.1'
for dir in /opt /opt/clack /opt/clack/diagnostic-tools; do
  test -d "$dir" && test ! -L "$dir"
  test "$(/usr/bin/stat -c '%u' -- "$dir")" = 0
  mode=$(/usr/bin/stat -c '%a' -- "$dir")
  (( (8#$mode & 022) == 0 ))
done
tmp=$(/usr/bin/mktemp -d -p /run clack-crash-install-snapshot.XXXXXXXX)
dest_created=0
cleanup() {
  local code=$?
  trap - EXIT
  if [[ -d $tmp && ! -L $tmp ]]; then
    /usr/bin/rm -f -- "$tmp/observer.py" || code=1
    /usr/bin/rmdir -- "$tmp" || code=1
  else
    code=1
  fi
  if ((code != 0 && dest_created)); then /usr/bin/rm -f -- "$dest" || true; fi
  exit "$code"
}
trap cleanup EXIT
test "$(/usr/bin/stat -c '%U:%a' -- "$tmp")" = root:700
# The unprivileged stage remains mutable. Verify bytes only after making
# an exclusive, root-owned copy so a user swap cannot race verification.
/usr/bin/install -o root -g root -m 0600 -- "$source" "$tmp/observer.py"
test "$(/usr/bin/sha256sum -- "$tmp/observer.py" | /usr/bin/cut -d' ' -f1)" = __OBSERVER__
/usr/bin/install -o root -g root -m 0600 -- "$tmp/observer.py" "$dest"
dest_created=1
if [[ "$(/usr/bin/sha256sum -- "$dest" | /usr/bin/cut -d' ' -f1)" != __OBSERVER__ ||
      "$(/usr/bin/stat -c '%U:%a' -- "$dest")" != root:600 ]]; then
  exit 1
fi
printf 'CLACK_CRASH_OBSERVER_INSTALL=PASS\n'
printf 'CLACK_CRASH_OBSERVER_SHA256=__OBSERVER__\n'
printf 'CLACK_CRASH_OBSERVER_EXECUTED=0\n'
'@
  $bootstrap = $bootstrap.Replace('__STAGE__',$stage).
    Replace('__OBSERVER__',$expected).Replace('__FIXED__',$fixed)
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bootstrap))
  if ($encoded.Length -gt 16000) { throw 'Root bootstrap unexpectedly large' }
  $command = "/usr/bin/bash -lc 'printf %s $encoded | /usr/bin/base64 -d | /usr/bin/sudo /usr/bin/bash -s'"
  Write-Output 'Root install only; GDB and bpftool are NOT run with active links.'
  Write-Output 'Enter sudo password only in the interactive terminal.'
  & ssh.exe @ssh '-tt' $remote $command
  if ($LASTEXITCODE -ne 0) { throw 'Private diagnostic wrapper installation failed' }
}
finally {
  if ($stage -and $stage -cmatch '^/home/hylab/\.cache/clack-crash-install\.[A-Za-z0-9]{8}$') {
    $cleanup = "/usr/bin/rm -f -- '"+$stage+
      "/clack-bpftool-abort-capture.py'; /usr/bin/rmdir -- '"+$stage+"'"
    & ssh.exe @ssh '-T' $remote $cleanup
    if ($LASTEXITCODE -ne 0) { throw 'Private observer installer stage cleanup failed' }
  }
}
