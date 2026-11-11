# One-time operator-owned, NO SUDO, isolated upstream bpftool build.
# No package install, eBPF attachment, Ollama request, Clack inference or PATH change.
[CmdletBinding()]
param(
  [ValidatePattern('^[a-f0-9]{8}$')][string]$AttemptId = ''
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$sourceEvidence = Join-Path $repo 'src-tauri\target\clack-bpftool-fixed-build'
$evidence = $sourceEvidence
if ($AttemptId) {
  $evidence = Join-Path $sourceEvidence ('attempt-' + $AttemptId)
  if (Test-Path -LiteralPath $evidence) {
    throw 'Exclusive diagnostic build attempt already exists'
  }
  New-Item -ItemType Directory -Path $evidence | Out-Null
}
$source = Join-Path $sourceEvidence 'bpftool-678d538a-source.tar'
$libbpf = Join-Path $sourceEvidence 'libbpf-872299d9-source.tar'
$script = Join-Path $PSScriptRoot 'clack-build-fixed-bpftool.sh'
$remote = 'hylab@192.168.1.44'
$key = Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
$stageFile = Join-Path $evidence 'remote-stage.txt'
if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
  throw 'Pinned SSH key not found'
}
if (Test-Path -LiteralPath $stageFile) {
  throw 'This task-owned build already has a remote stage; never reuse it'
}
if ((git.exe -C $repo rev-parse HEAD).Trim() -cnotmatch '^[a-f0-9]{40}$') {
  throw 'Repository HEAD unverified'
}
$expected = @{
  'bpftool-678d538a-source.tar'='63ac89f708672bc0071f7f84bc389c51f20820e5d1bf1d45e077153edcbe6362'
  'libbpf-872299d9-source.tar'='66da46956d987ba2f15522f46810a4ce23132b01dea27452f21907a670ad2e74'
}
foreach ($path in @($source,$libbpf)) {
  $name = Split-Path -Leaf $path
  if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
      (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() -cne $expected[$name]) {
    throw ('Untrusted pinned source archive: ' + $name)
  }
}
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
  throw 'Reviewed Linux build script missing'
}
# Normalize reviewed Bash script to LF without changing the tracked file.
$stagedScript = Join-Path $evidence 'clack-build-fixed-bpftool.sh'
if (Test-Path -LiteralPath $stagedScript) {
  throw 'Staged build script already exists; never overwrite'
}
$sourceText = [IO.File]::ReadAllText($script)
if ($sourceText -match '\r(?!\n)') { throw 'Unexpected build-script line ending' }
[IO.File]::WriteAllText($stagedScript,$sourceText.Replace("`r`n","`n"),
  [Text.UTF8Encoding]::new($false))
$ssh = @('-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ConnectTimeout=5',
  '-o','ServerAliveInterval=5','-o','ServerAliveCountMax=4','-i',$key)
$scp = @('-q','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ConnectTimeout=5',
  '-o','ServerAliveInterval=5','-o','ServerAliveCountMax=4','-i',$key)
$stage = $null
try {
  $created = & ssh.exe @ssh '-T' $remote '/usr/bin/mktemp -d -p /home/hylab/.cache clack-bpftool-fixed.XXXXXXXX'
  if ($LASTEXITCODE -ne 0) { throw 'Exclusive remote user stage creation failed' }
  $stage = (($created | Out-String).Trim())
  if ($stage -cnotmatch '^/home/hylab/\.cache/clack-bpftool-fixed\.[A-Za-z0-9]{8}$') {
    throw 'Remote stage is outside approved private area'
  }
  [IO.File]::WriteAllText($stageFile,$stage + "`n",[Text.Encoding]::ASCII)
  foreach ($file in @($source,$libbpf,$stagedScript)) {
    & scp.exe @scp '--' $file ("${remote}:${stage}/" + (Split-Path -Leaf $file))
    if ($LASTEXITCODE -ne 0) { throw 'Pinned source/script transfer failed' }
  }
  Write-Output 'Building exact pinned source in user-owned Linux stage (no sudo).'
  & ssh.exe @ssh '-T' $remote ("/usr/bin/timeout --signal=TERM --kill-after=2s 480s /usr/bin/bash '${stage}/clack-build-fixed-bpftool.sh' '${stage}'")
  if ($LASTEXITCODE -ne 0) {
    throw 'Private bpftool build failed; no diagnostic binary was installed'
  }
  $summaryPath = Join-Path $evidence 'build-summary.numeric'
  $binaryPath = Join-Path $evidence 'bpftool-678d538a-linux-x86_64'
  $versionPath = Join-Path $evidence 'bpftool-version.json'
  foreach ($item in @(
    @{ Remote='build-summary.numeric'; Local=$summaryPath },
    @{ Remote='out/bpftool'; Local=$binaryPath },
    @{ Remote='version.json'; Local=$versionPath }
  )) {
    if (Test-Path -LiteralPath $item.Local) { throw 'Local build result already exists' }
    & scp.exe @scp '--' ("${remote}:${stage}/" + $item.Remote) $item.Local
    if ($LASTEXITCODE -ne 0) { throw 'Private build evidence transfer failed' }
  }
  $fields = @{}
  foreach ($line in (Get-Content -LiteralPath $summaryPath)) {
    if ($line -cmatch '^([A-Z0-9_]+)=([A-Za-z0-9_.-]+)$') {
      $fields[$Matches[1]] = $Matches[2]
    } else { throw 'Unrecognized build-summary output' }
  }
  $digest = (Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($fields['CLACK_BPFT_BUILD'] -cne 'PASS' -or
      $fields['CLACK_BPFT_SOURCE_COMMIT'] -cne '678d538a85e6960f84e443695eebb13f66f89981' -or
      $fields['CLACK_BPFT_LIBBPF_COMMIT'] -cne '872299d94e27d2fa9f119667c7e52268698dc760' -or
      $digest -cne $fields['CLACK_BPFT_BINARY_SHA256']) {
    throw 'Binary/source build evidence mismatch'
  }
  $version = Get-Content -LiteralPath $versionPath -Raw | ConvertFrom-Json
  if ($version.version -cne '7.8.1' -or
      $version.libbpf_version -cnotmatch '^1\.9(\.|$)') {
    throw 'Private build tool version/provenance mismatch'
  }
  Write-Output ('CLACK_BPFT_PRIVATE_BINARY_SHA256=' + $digest)
  Write-Output ('CLACK_BPFT_PRIVATE_VERSION=' + $version.version)
  Write-Output ('CLACK_BPFT_PRIVATE_LIBBPF=' + $version.libbpf_version)
  Write-Output ('CLACK_BPFT_PRIVATE_REMOTE_STAGE=' + $stage)
  Write-Output 'Build exported privately; not root-installed and no kernel attachment.'
} catch {
  Write-Output ('CLACK_BPFT_PRIVATE_STAGE=' + $stage)
  Write-Output 'No system package was changed; inspected build stage remains private.'
  throw
}
