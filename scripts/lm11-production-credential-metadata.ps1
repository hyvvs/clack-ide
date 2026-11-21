param(
  [ValidateSet('Before','After')][string]$Phase,
  [Parameter(Mandatory=$true)][string]$CaseDir
)

# Independent Credential Manager TARGET-METADATA audit. cmdkey /list exposes
# target/type/user metadata, not the credential secret. The raw output stays in
# memory; only SHA-256 digests and counts enter the owned acceptance report.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$cases = (Resolve-Path -LiteralPath (Join-Path $project 'src-tauri\target\lm11-b01-b03-authenticated-webview-20261119\cases')).ProviderPath
$CaseDir = (Resolve-Path -LiteralPath $CaseDir).ProviderPath
if ((Split-Path -Parent $CaseDir) -ne $cases -or
    (Split-Path -Leaf $CaseDir) -notmatch '^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$' -or
    ((Get-Item -LiteralPath $CaseDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Credential metadata evidence output must be under a fresh canonical owned audit case'
}
function SHA256-Text([string]$value) {
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-','').ToLowerInvariant() }
  finally { $hash.Dispose() }
}
function Write-Once([string]$path, [object]$value) {
  $json = ConvertTo-Json -InputObject $value -Depth 8
  $enc = New-Object System.Text.UTF8Encoding($false)
  $bytes = $enc.GetBytes($json)
  $file = [IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $file.Write($bytes,0,$bytes.Length);$file.Flush($true) }
  finally { $file.Dispose() }
}

$raw = @(& cmdkey.exe /list)
if ($LASTEXITCODE -ne 0 -or -not $raw) { throw 'Credential Manager read-only metadata enumeration failed' }
$blocks = New-Object System.Collections.Generic.List[object]
$current = New-Object System.Collections.Generic.List[string]
foreach ($line in @($raw) + @('')) {
  $trimmed = ([string]$line).Trim()
  if (-not $trimmed) {
    if ($current.Count) { $blocks.Add($current.ToArray());$current.Clear() }
  } else { $current.Add($trimmed) }
}
$entries = New-Object System.Collections.Generic.List[object]
$countAll = 0
foreach ($block in $blocks) {
  $head = @($block | Where-Object {$_ -match '(?i)^Target\s*:'})
  if (-not $head.Count) { continue }
  $countAll++
  $target = [string]$head[0]
  if ($target -notmatch '(?i)clack-ai|terax-ai|app\.clack\.dev|app\.crynta\.terax|\bclack\b|\bterax\b') {
    continue
  }
  $entries.Add([pscustomobject]@{
    targetHash=(SHA256-Text $target)
    metadataHash=(SHA256-Text (($block -join "`n").Trim()))
  })
}
$ordered = @($entries | Sort-Object targetHash)
$file = 'credential-manager-before.json'
if ($Phase -eq 'After') { $file = 'credential-manager-after.json' }
$report = [pscustomobject]@{
  phase=$Phase; source='Windows cmdkey /list read-only target metadata (no secret bytes read)'
  allTargetCount=$countAll; scopedTargetCount=$ordered.Count
  appServices=@('clack-ai','terax-ai'); entries=$ordered
  secretBytesRead=$false; productionCredentialsWritten=$false
}
Write-Once (Join-Path $CaseDir $file) $report
if ($Phase -eq 'After') {
  $previous = Get-Content -LiteralPath (Join-Path $CaseDir 'credential-manager-before.json') -Raw | ConvertFrom-Json
  $before = @($previous.entries | ForEach-Object {$_.targetHash+':'+$_.metadataHash} | Sort-Object)
  $after = @($ordered | ForEach-Object {$_.targetHash+':'+$_.metadataHash} | Sort-Object)
  $same = $previous.allTargetCount -eq $countAll -and $previous.scopedTargetCount -eq $ordered.Count -and
    (($before -join '|') -ceq ($after -join '|'))
  Write-Once (Join-Path $CaseDir 'credential-manager-comparison.json') ([pscustomobject]@{
    metadataUnchanged=$same; secretPayloadsNotRead=$true
    limitation='Target metadata sameness does not independently prove unchanged hidden secret bytes'
    beforeTargets=$previous.scopedTargetCount; afterTargets=$ordered.Count
  })
  Write-Output ('CREDENTIAL_METADATA_UNCHANGED='+$same)
  if (-not $same) { exit 3 }
} else { Write-Output ('CREDENTIAL_METADATA_BASELINE_SCOPED='+$ordered.Count+' TOTAL='+$countAll) }
