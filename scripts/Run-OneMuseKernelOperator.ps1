# FUTURE, SEPARATELY AUTHORIZED HUMAN STEP ONLY.
# In the operator's interactive PowerShell: enter any remote sudo password
# at the real SSH terminal prompt, never in chat, a file or a command argument.
# This script starts ONE bounded root kernel-only capture; NO model request.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$RunId,
  [Parameter(Mandatory=$true)][ValidateRange(2,2147483647)][int]$ExpectedPid,
  [Parameter(Mandatory=$false)][ValidateRange(1,1800)][int]$Seconds=1800
)
$ErrorActionPreference = 'Stop'
if ($RunId -cnotmatch '^muse-one-[a-f0-9]{24}$') {
  throw 'Fresh exclusive diagnostic run ID is required'
}
$remote = 'hylab@192.168.1.44'
$key = Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
  throw 'Pinned SSH identity unavailable'
}
$repo = Split-Path -Parent $PSScriptRoot
$kernelOnlyEvidence = $null
if ($Seconds -ne 1800) {
  if ($Seconds -gt 20) { throw 'No-traffic validation kernel capture must be at most 20 seconds' }
  $kernelOnlyEvidence = Join-Path (Join-Path $repo 'src-tauri\target\local-muse-one-evidence') $RunId
  if (-not (Test-Path -LiteralPath $kernelOnlyEvidence -PathType Container)) {
    throw 'Existing exclusive kernel-only evidence root required'
  }
  # Refuse an old displayed command after the one-shot SSH FIFO readers or
  # importer have already exited. An evidence directory alone is not authority
  # to begin a privileged probe later, even with the same RunId.
  $life = Join-Path $kernelOnlyEvidence 'kernel-only-lifecycle.jsonl'
  if (-not (Test-Path -LiteralPath $life -PathType Leaf) -or
      (Select-String -LiteralPath $life -Pattern '"kind":"kernel_only_result"' -SimpleMatch -Quiet)) {
    throw 'Kernel-only listener already closed or lacks live lifecycle evidence'
  }
  $readers = @(Get-CimInstance Win32_Process -Filter 'name = "ssh.exe"' -ErrorAction Stop |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($RunId) -and
      $_.CommandLine.Contains('ready.fifo') })
  if ($readers.Count -ne 1) {
    throw 'Kernel-only readiness reader is not exclusively live; stale command refused'
  }
}
$files = @(
  'scripts/local-muse-one-root.sh',
  'scripts/local-muse-one-ebpf.py',
  'scripts/local-muse-tcp-session.py',
  'scripts/local-muse-tcp.bt'
)
$approvedHashes = @{
  'local-muse-tcp.bt'='e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0'
  'local-muse-tcp-session.py'='d22c0994402744a6a978d4a8d53b140d9d6c0780a316e54f9d8c7c7c85e014cf'
}
$stagedHashes = @{}
foreach ($relative in $files) {
  $file = Join-Path $repo $relative
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw ('Reviewed source missing: ' + $relative)
  }
  $name = Split-Path -Leaf $file
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
  if ($approvedHashes.ContainsKey($name) -and $hash -cne $approvedHashes[$name]) {
    throw ('Immutable hardened source changed: ' + $name)
  }
  $stagedHashes[$name] = $hash
}
$sshOptions = @('-o','StrictHostKeyChecking=yes','-o','BatchMode=yes',
  '-o','ConnectTimeout=5','-o','ServerAliveInterval=5',
  '-o','ServerAliveCountMax=4','-i',$key)
$scpOptions = @('-q','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes',
  '-o','ConnectTimeout=5','-o','ServerAliveInterval=5',
  '-o','ServerAliveCountMax=4','-i',$key)
$stage = $null
$operatorExit = 'unobserved'
$auditCopied = $false
$cleanupOk = $false
try {
  $created = & ssh.exe @sshOptions '-T' $remote '/usr/bin/timeout --signal=TERM --kill-after=2s 8s /usr/bin/mktemp -d -p /home/hylab/.cache clack-muse-one-stage.XXXXXXXX'
  if ($LASTEXITCODE -ne 0) { throw 'Exclusive user staging failed' }
  $stage = (($created | Out-String).Trim())
  if ($stage -cnotmatch '^/home/hylab/\.cache/clack-muse-one-stage\.[A-Za-z0-9]{8}$') {
    throw 'Unrecognized remote stage; refusing any remote cleanup'
  }
  foreach ($relative in $files) {
    $local = Join-Path $repo $relative
    & scp.exe @scpOptions '--' $local ("${remote}:${stage}/" + (Split-Path -Leaf $relative))
    if ($LASTEXITCODE -ne 0) { throw 'Reviewed source transfer failed' }
  }
  # Root shell is delivered as UTF-8 base64 (no secret/credential within).
  # It installs a fresh private root copy BEFORE verifying/executing anything;
  # the uploaded hylab-owned shell is never directly executed as root.
  $bootstrap = @'
set -Eeuo pipefail
umask 077
stage='__STAGE__'
run='__RUN__'
pid='__PID__'
seconds='__SECONDS__'
dest="/run/local-muse-ebpf/$run"
created=0
release() {
  if ((created)); then
    /usr/bin/rm -f -- "$dest/local-muse-one-root.sh" "$dest/local-muse-one-ebpf.py" "$dest/local-muse-tcp-session.py" "$dest/local-muse-tcp.bt" "$dest/kernel-audit.stderr" "$dest/kernel-audit.numeric" || true
    /usr/bin/rmdir -- "$dest" 2>/dev/null || true
    /usr/bin/rmdir -- /run/local-muse-ebpf 2>/dev/null || true
  fi
}
trap release EXIT
test "$(id -u)" -eq 0
test ! -e /run/local-muse-ebpf
test ! -L /run/local-muse-ebpf
test -d "$stage" && test ! -L "$stage"
test "$(/usr/bin/stat -c '%u:%a' -- "$stage")" = "$(id -u hylab):700"
test "$(/usr/bin/find "$stage" -mindepth 1 -maxdepth 1 -printf x | /usr/bin/wc -c)" -eq 4
/usr/bin/install -d -o root -g hylab -m 0710 /run/local-muse-ebpf
/usr/bin/install -d -o root -g hylab -m 0710 "$dest"
created=1
for name in local-muse-one-root.sh local-muse-one-ebpf.py local-muse-tcp-session.py local-muse-tcp.bt; do
  test -f "$stage/$name" && test ! -L "$stage/$name"
  /usr/bin/install -o root -g root -m 0600 "$stage/$name" "$dest/$name"
done
for pair in '__HROOT__ local-muse-one-root.sh' '__HEBPF__ local-muse-one-ebpf.py' '__HSUP__ local-muse-tcp-session.py' '__HBPF__ local-muse-tcp.bt'; do
  printf '%s  %s\n' "${pair%% *}" "$dest/${pair#* }" | /usr/bin/sha256sum --check --status
done
# Keep the bootstrap EXIT trap armed across early root.sh validation errors.
# A child exit retains its exact status; the trap removes any remaining owned
# bootstrap files if root.sh itself fails before declaring its own ownership.
status=0
/usr/bin/bash "$dest/local-muse-one-root.sh" "$run" "$pid" "$seconds" "$stage" || status=$?
exit "$status"
'@
  $bootstrap = $bootstrap.Replace('__STAGE__',$stage).Replace('__RUN__',$RunId).Replace('__PID__',[string]$ExpectedPid)
  $bootstrap = $bootstrap.Replace('__SECONDS__',[string]$Seconds)
  $bootstrap = $bootstrap.Replace('__HROOT__',$stagedHashes['local-muse-one-root.sh'])
  $bootstrap = $bootstrap.Replace('__HEBPF__',$stagedHashes['local-muse-one-ebpf.py'])
  $bootstrap = $bootstrap.Replace('__HSUP__',$stagedHashes['local-muse-tcp-session.py'])
  $bootstrap = $bootstrap.Replace('__HBPF__',$stagedHashes['local-muse-tcp.bt'])
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bootstrap))
  if ($encoded.Length -gt 16000) { throw 'Bounded root bootstrap exceeded reviewed limit' }
  $shell = "/usr/bin/bash -lc 'printf %s $encoded | /usr/bin/base64 -d | /usr/bin/sudo /usr/bin/bash -s'"
  Write-Output 'ONE bounded kernel-only root session; no inference or Ollama request.'
  Write-Output 'Enter sudo password only at the remote interactive terminal prompt.'
  # SSH BatchMode covers key authentication only. The separately approved
  # interactive sudo password prompt remains on the remote -tt terminal.
  & ssh.exe @sshOptions '-tt' $remote $shell
  $status = $LASTEXITCODE
  $operatorExit = [string]$status
  Write-Output ('KERNEL_OPERATOR_SSH_EXIT=' + $status)
  if ($kernelOnlyEvidence) {
    $localAudit = Join-Path $kernelOnlyEvidence 'kernel-operator-audit.numeric'
    if (Test-Path -LiteralPath $localAudit) { throw 'Exclusive kernel operator audit already exists' }
    & scp.exe @scpOptions '--' ("${remote}:${stage}/operator-audit.numeric") $localAudit
    $auditCopied = ($LASTEXITCODE -eq 0)
    Write-Output ('KERNEL_OPERATOR_AUDIT=' + $(if ($auditCopied) { 'PASS' } else { 'MISSING' }))
  }
  if ($status -ne 0) { throw 'Kernel operator session incomplete or cleanup failed' }
}
finally {
  if ($stage -and $stage -cmatch '^/home/hylab/\.cache/clack-muse-one-stage\.[A-Za-z0-9]{8}$') {
    # Only the exact mktemp-owned directory and four reviewed regular files
    # may be removed. Refuse symlinks, ownership/mode changes and extra files.
    $cleanupScript = @'
set -Eeuo pipefail
stage='__STAGE__'
if [[ ! -e "$stage" && ! -L "$stage" ]]; then exit 0; fi
test -d "$stage" && test ! -L "$stage"
test "$(/usr/bin/stat -c '%u:%a' -- "$stage")" = "$(id -u):700"
for name in local-muse-one-root.sh local-muse-one-ebpf.py local-muse-tcp-session.py local-muse-tcp.bt; do
  file="$stage/$name"
  if [[ -e $file || -L $file ]]; then
    test -f "$file" && test ! -L "$file"
    /usr/bin/rm -f -- "$file"
  fi
done
if [[ -e "$stage/operator-audit.numeric" || -L "$stage/operator-audit.numeric" ]]; then
  test -f "$stage/operator-audit.numeric" && test ! -L "$stage/operator-audit.numeric"
  /usr/bin/rm -f -- "$stage/operator-audit.numeric"
fi
/usr/bin/rmdir -- "$stage"
'@
    $cleanupScript = $cleanupScript.Replace('__STAGE__',$stage)
    $cleanupEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cleanupScript))
    $cleanup = "/usr/bin/bash -lc 'printf %s $cleanupEncoded | /usr/bin/base64 -d | /usr/bin/timeout --signal=TERM --kill-after=2s 8s /usr/bin/bash -s'"
    $cleanupOk = $false
    try {
      & ssh.exe @sshOptions '-T' $remote $cleanup 2>$null
      $cleanupOk = ($LASTEXITCODE -eq 0)
    } catch { $cleanupOk = $false }
    if ($cleanupOk) { Write-Output 'USER_STAGE_CLEANUP=PASS' }
    else { Write-Output 'USER_STAGE_CLEANUP=FAIL' }
  }
  if ($kernelOnlyEvidence) {
    $path = Join-Path $kernelOnlyEvidence 'kernel-operator-exit.numeric'
    if (-not (Test-Path -LiteralPath $path)) {
      $record = @('KERNEL_OPERATOR_SSH_EXIT=' + $operatorExit,
        'KERNEL_OPERATOR_AUDIT=' + $(if ($auditCopied) { 'PASS' } else { 'MISSING' }),
        'USER_STAGE_CLEANUP=' + $(if ($cleanupOk) { 'PASS' } else { 'FAIL' }))
      [IO.File]::WriteAllLines($path,[string[]]$record,[Text.Encoding]::ASCII)
    }
  }
}
