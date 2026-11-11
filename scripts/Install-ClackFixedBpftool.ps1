# Human-only interactive sudo for PRIVATE fixed bpftool install and IDLE queries.
# Never replaces /usr/bin/bpftool, installs packages, starts tracing or infers.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^[a-f0-9]{8}$')][string]$AttemptId
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$base = Join-Path $repo 'src-tauri\target\clack-bpftool-fixed-build'
$evidence = Join-Path $base ('attempt-' + $AttemptId)
$stageFile = Join-Path $evidence 'remote-stage.txt'
$summary = Join-Path $evidence 'build-summary.numeric'
$binary = Join-Path $evidence 'bpftool-678d538a-linux-x86_64'
$versionFile = Join-Path $evidence 'bpftool-version.json'
$receipt = Join-Path $evidence 'root-idle-summary.numeric'
$sourceScript = Join-Path $PSScriptRoot 'clack-install-fixed-bpftool.sh'
$localScript = Join-Path $evidence 'clack-install-fixed-bpftool.sh'
$remote = 'hylab@192.168.1.44'
$key = Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
foreach ($file in @($stageFile,$summary,$binary,$versionFile,$sourceScript,$key)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw ('Private build not complete, missing: ' + (Split-Path -Leaf $file))
  }
}
if (Test-Path -LiteralPath $receipt) { throw 'Root idle qualification already exists' }
$stage = (Get-Content -LiteralPath $stageFile -Raw).Trim()
if ($stage -cnotmatch '^/home/hylab/\.cache/clack-bpftool-fixed\.[A-Za-z0-9]{8}$') {
  throw 'Untrusted remote build stage'
}
$fields = @{}
foreach ($line in (Get-Content -LiteralPath $summary)) {
  if ($line -cmatch '^([A-Z0-9_]+)=([A-Za-z0-9_.-]+)$') {
    $fields[$Matches[1]] = $Matches[2]
  } else { throw 'Unexpected build-summary content' }
}
$expectedSha = $fields['CLACK_BPFT_BINARY_SHA256']
if ($expectedSha -cnotmatch '^[a-f0-9]{64}$' -or
    $fields['CLACK_BPFT_BUILD'] -cne 'PASS' -or
    $fields['CLACK_BPFT_SOURCE_COMMIT'] -cne '678d538a85e6960f84e443695eebb13f66f89981' -or
    $fields['CLACK_BPFT_LIBBPF_COMMIT'] -cne '872299d94e27d2fa9f119667c7e52268698dc760' -or
    $fields['CLACK_BPFT_LINK_BLOB'] -cne '5cffa2d283b47327b8611b4d85b1d70821f40964' -or
    (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expectedSha) {
  throw 'Unqualified private binary or unexpected build provenance'
}
$version = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json
if ($version.version -cne '7.8.1' -or $version.libbpf_version -cne '1.9' -or
    $version.features.skeletons -cne $true) {
  throw 'Fixed binary lacks correct version or PID owner skeletons'
}
if (Test-Path -LiteralPath $localScript) { throw 'Reviewed install script already staged' }
$raw = [IO.File]::ReadAllText($sourceScript)
if ($raw -match '\r(?!\n)') { throw 'Unexpected install-script line ending' }
[IO.File]::WriteAllText($localScript,$raw.Replace("`r`n","`n"),
  [Text.UTF8Encoding]::new($false))
$scriptSha = (Get-FileHash -LiteralPath $localScript -Algorithm SHA256).Hash.ToLowerInvariant()
$ssh = @('-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ConnectTimeout=5',
  '-o','ServerAliveInterval=5','-o','ServerAliveCountMax=4','-i',$key)
$scp = @('-q','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ConnectTimeout=5',
  '-o','ServerAliveInterval=5','-o','ServerAliveCountMax=4','-i',$key)
& scp.exe @scp '--' $localScript ("${remote}:${stage}/clack-install-fixed-bpftool.sh")
if ($LASTEXITCODE -ne 0) { throw 'Reviewed root-idle installer transfer failed' }

# Root shell is delivered as base64 and copied to a fresh root-owned
# private script BEFORE its hash is checked and it runs.
$bootstrap = @'
set -Eeuo pipefail
umask 077
stage='__STAGE__'
expected='__SHA__'
script_sha='__SCRIPT_SHA__'
test "$(id -u)" -eq 0
test -d "$stage" && test ! -L "$stage"
test "$(stat -c '%U:%a' -- "$stage")" = hylab:700
test -f "$stage/clack-install-fixed-bpftool.sh"
test ! -L "$stage/clack-install-fixed-bpftool.sh"
tmp="$(/usr/bin/mktemp -d -p /run clack-bpftool-qualification.XXXXXXXX)"
release() {
  /usr/bin/rm -f -- "$tmp/install.sh" 2>/dev/null || true
  /usr/bin/rmdir -- "$tmp" 2>/dev/null || true
}
trap release EXIT
/usr/bin/install -o root -g root -m 0600 -- "$stage/clack-install-fixed-bpftool.sh" "$tmp/install.sh"
printf '%s  %s\n' "$script_sha" "$tmp/install.sh" | /usr/bin/sha256sum --check --status
/usr/bin/bash "$tmp/install.sh" "$stage" "$expected"
'@
$bootstrap = $bootstrap.Replace('__STAGE__',$stage).
  Replace('__SHA__',$expectedSha).Replace('__SCRIPT_SHA__',$scriptSha)
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bootstrap))
if ($encoded.Length -gt 16000) { throw 'Unbounded root bootstrap' }
$shell = "/usr/bin/bash -lc 'printf %s $encoded | /usr/bin/base64 -d | /usr/bin/sudo /usr/bin/bash -s'"
Write-Output 'ONE root-owned private tool install + idle-only program/link comparison.'
Write-Output 'No BPF attachment, no package upgrades, no inference.'
Write-Output 'Enter sudo password ONLY at the remote interactive terminal prompt.'
& ssh.exe @ssh '-tt' $remote $shell
if ($LASTEXITCODE -ne 0) {
  throw 'Root-only bpftool idle qualification failed; never run a live diagnostic'
}
& scp.exe @scp '--' ("${remote}:${stage}/root-idle-summary.numeric") $receipt
if ($LASTEXITCODE -ne 0) { throw 'Root idle audit receipt unavailable' }
$values=@{}
foreach ($line in (Get-Content -LiteralPath $receipt)) {
  if ($line -cmatch '^([A-Z0-9_]+)=([A-Za-z0-9_-]+)$') {
    $values[$Matches[1]]=$Matches[2]
  } else { throw 'Unrecognized root idle audit row' }
}
if ($values['CLACK_BPFT_ROOT_QUALIFICATION'] -cne 'PASS' -or
    $values['CLACK_BPFT_PRIVATE_BINARY_SHA256'] -cne $expectedSha -or
    $values['CLACK_BPFT_IDLE_PROG_COMPARE'] -cne 'PASS' -or
    $values['CLACK_BPFT_IDLE_LINK_COMPARE'] -cne 'PASS' -or
    $values['CLACK_BPFT_SYSTEM_PACKAGE_UNCHANGED'] -cne '1') {
  throw 'Private root idle bpftool validation was not sealed'
}
Write-Output ('CLACK_BPFT_ROOT_IDLE=PASS SHA256=' + $expectedSha)
Write-Output 'Private diagnostic binary now root-pinned. NO live validation authorized.'
