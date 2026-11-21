param(
  [ValidateSet('Before','After')][string]$Phase = 'Before',
  [string]$CaseDir = ''
)

# Independent read-only observer for the LM11 acceptance host. No production
# content or credential value is serialized: only name, length and SHA-256.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$owner = Join-Path $project 'src-tauri\target\lm11-b01-b03-authenticated-webview-20261119'
$cases = Join-Path $owner 'cases'
$canonicalCases = (Resolve-Path -LiteralPath $cases).ProviderPath
if ((Get-Item -LiteralPath $owner -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw 'Acceptance owner is a reparse point'
}
if ((Get-Item -LiteralPath $cases -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw 'Acceptance cases directory is a reparse point'
}
if ($Phase -eq 'Before') {
  if ($CaseDir) { throw 'Before must allocate a fresh audit case automatically' }
  $id = 'fidelity-audit-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff') + '-' + [guid]::NewGuid().ToString('N').Substring(0,12)
  $CaseDir = Join-Path $canonicalCases $id
  [void][IO.Directory]::CreateDirectory($CaseDir)
} else {
  if (-not $CaseDir) { throw 'After requires the exact prior audit case path' }
}
$CaseDir = (Resolve-Path -LiteralPath $CaseDir).ProviderPath
if ((Split-Path -Parent $CaseDir) -ne $canonicalCases -or
    (Split-Path -Leaf $CaseDir) -notmatch '^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$' -or
    ((Get-Item -LiteralPath $CaseDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Audit output must remain one direct owned, canonical, non-reparse case'
}

function SHA256-Bytes([byte[]]$bytes) {
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
  finally { $hash.Dispose() }
}
function SHA256-File([string]$path) {
  $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read,
    ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  try {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $hash.Dispose() }
  } finally { $stream.Dispose() }
}
function Write-Once([string]$path, [object]$data) {
  $json = ConvertTo-Json -InputObject $data -Depth 10
  $bytes = New-Object System.Text.UTF8Encoding($false)
  $out = [IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $v = $bytes.GetBytes($json); $out.Write($v,0,$v.Length); $out.Flush($true) }
  finally { $out.Dispose() }
}

$directories = @(
  @{id='roaming-production'; path=(Join-Path $env:APPDATA 'app.clack.dev')},
  @{id='local-production'; path=(Join-Path $env:LOCALAPPDATA 'app.clack.dev')},
  @{id='roaming-legacy'; path=(Join-Path $env:APPDATA 'app.crynta.terax')},
  @{id='local-legacy'; path=(Join-Path $env:LOCALAPPDATA 'app.crynta.terax')},
  @{id='local-clack'; path=(Join-Path $env:LOCALAPPDATA 'Clack')},
  @{id='local-terax'; path=(Join-Path $env:LOCALAPPDATA 'Terax')},
  @{id='roaming-clack'; path=(Join-Path $env:APPDATA 'Clack')},
  @{id='roaming-terax'; path=(Join-Path $env:APPDATA 'Terax')}
)
$records = New-Object System.Collections.Generic.List[object]
$errors = New-Object System.Collections.Generic.List[object]
foreach ($dir in $directories) {
  $exists = Test-Path -LiteralPath $dir.path -PathType Container
  $records.Add([pscustomobject]@{key=($dir.id + '/@root'); kind='root'; sha256=([string]$exists).ToLowerInvariant(); size=0})
  if (-not $exists) { continue }
  $root = (Resolve-Path -LiteralPath $dir.path).ProviderPath
  Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue |
    Sort-Object -Property FullName | ForEach-Object {
      $relative = $_.FullName.Substring($root.Length).TrimStart('\','/') -replace '\\','/'
      $key = $dir.id + '/' + $relative
      if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        $errors.Add([pscustomobject]@{key=$key; reason='reparse-file-not-hashed'})
        return
      }
      try { $records.Add([pscustomobject]@{key=$key;kind='file';sha256=(SHA256-File $_.FullName);size=$_.Length}) }
      catch { $errors.Add([pscustomobject]@{key=$key;reason='file-not-readable'}) }
    }
}

# App-specific HKCU keys are included as value hashes, never as raw values.
$registry = @(
  'HKCU:\Software\app.clack.dev', 'HKCU:\Software\Clack',
  'HKCU:\Software\app.crynta.terax', 'HKCU:\Software\Terax'
)
foreach ($base in $registry) {
  $present = Test-Path -LiteralPath $base
  $records.Add([pscustomobject]@{key=('registry/' + $base + '/@root');kind='registry-root';sha256=([string]$present).ToLowerInvariant();size=0})
  if (-not $present) { continue }
  foreach ($key in @((Get-Item -LiteralPath $base)) + @(Get-ChildItem -LiteralPath $base -Recurse -ErrorAction SilentlyContinue)) {
    try {
      foreach ($name in $key.GetValueNames()) {
        $value = $key.GetValue($name,$null,'DoNotExpandEnvironmentNames')
        $encoded = ConvertTo-Json -InputObject @($key.GetValueKind($name).ToString(),$value) -Depth 5 -Compress
        $digest = SHA256-Bytes ([Text.Encoding]::UTF8.GetBytes($encoded))
        $records.Add([pscustomobject]@{key=('registry/' + $key.Name + '/' + $name);kind='registry-value';sha256=$digest;size=0})
      }
    } catch { $errors.Add([pscustomobject]@{key=('registry/' + $key.Name);reason='registry-not-readable'}) }
  }
}
$ordered = @($records | Sort-Object -Property key)
$rootIds = @(); foreach ($dir in $directories) { $rootIds += [string]$dir.id }
$snapshot = [pscustomobject]@{
  phase=$Phase; caseId=(Split-Path -Leaf $CaseDir)
  observedAtUtc=(Get-Date).ToUniversalTime().ToString('o')
  source='independent-read-only-production-state-observer'
  appId='app.clack.dev'; rootIds=$rootIds
  registryRoots=$registry
  fileOrRegistryEntries=$ordered; errors=$errors.ToArray()
}
$leafName = 'production-before.json'
if ($Phase -eq 'After') { $leafName = 'production-after.json' }
$out = Join-Path $CaseDir $leafName
Write-Once $out $snapshot
if ($Phase -eq 'Before') {
  Write-Output ('CASE_DIR=' + $CaseDir)
  Write-Output ('BASELINE_ENTRIES=' + $ordered.Count + ' ERRORS=' + $errors.Count)
  if ($errors.Count) { exit 3 }
} else {
  # Keep the observer exclusively read-only and immutable. The independent
  # Node comparator seals production-comparison.json after this AFTER snapshot
  # has been written. Both callers use create-new/no-overwrite semantics.
  Write-Output ('CASE_DIR=' + $CaseDir)
  Write-Output ('AFTER_ENTRIES=' + $ordered.Count + ' AFTER_ERRORS=' + $errors.Count)
  if ($errors.Count) { exit 3 }
}
