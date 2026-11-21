param([Parameter(Mandatory=$true)][string]$CaseDir)

# Read-only OS-wide process, listener and registration residue check for LM11.
# This complements, but does not claim to replace, the AppData/HKCU/WinCred
# before/after content-hash comparison. No commands mutate OS state.
$ErrorActionPreference='Stop'
$repo=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$cases=(Resolve-Path -LiteralPath (Join-Path $repo 'src-tauri\target\lm11-b01-b03-authenticated-webview-20261119\cases')).ProviderPath
$CaseDir=(Resolve-Path -LiteralPath $CaseDir).ProviderPath
if ((Split-Path -Parent $CaseDir) -ne $cases -or
    (Split-Path -Leaf $CaseDir) -notmatch '^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$' -or
    ((Get-Item -LiteralPath $CaseDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'OS isolation audit output must stay in an exact canonical acceptance audit case'
}

$ports=New-Object System.Collections.Generic.HashSet[int]
$caseCount=0
foreach($d in @(Get-ChildItem -LiteralPath $cases -Directory -Filter 'wry-*')) {
  if ($d.Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'Reparse acceptance case encountered'}
  $caseCount++
  foreach($leaf in @('service-ready.json','service-ready-b.json')) {
    $f=Join-Path $d.FullName $leaf
    if(-not (Test-Path -LiteralPath $f -PathType Leaf)) {continue}
    if((Get-Item -LiteralPath $f -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'Reparse acceptance ready file encountered'
    }
    $v=Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
    if($v.syntheticOnly -ne $true -or $v.port -notmatch '^\d{1,5}$') {throw 'Non-synthetic or invalid ready record'}
    if([int]$v.port -lt 1 -or [int]$v.port -gt 65535) {throw 'Invalid recorded loopback port'}
    [void]$ports.Add([int]$v.port)
  }
}

$processes=@(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
$owned=@($processes | Where-Object {
  $_.Name -ieq 'lm11_authenticated_webview_acceptance.exe' -or
  ($_.Name -ieq 'node.exe' -and $_.CommandLine -match 'lm11-authenticated-webview-acceptance\.mjs') -or
  ($_.Name -ieq 'msedgewebview2.exe' -and $_.CommandLine -match 'lm11-b01-b03-authenticated-webview-20261119')
})
$listen=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {
  $_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::') -and $ports.Contains([int]$_.LocalPort)
})
$registeredServices=@(Get-CimInstance -ClassName Win32_Service -ErrorAction Stop | Where-Object {
  $_.Name -match '(?i)lm11[_-]authenticated[_-]webview|lm11-b01-b03-authenticated-webview' -or
  $_.PathName -match '(?i)lm11_authenticated_webview_acceptance'
})
$scheduled=@(Get-ScheduledTask -ErrorAction Stop | Where-Object {
  $_.TaskName -match '(?i)lm11[_-]authenticated[_-]webview|lm11-b01-b03-authenticated-webview'
})
$envNames=@()
foreach($kind in @('User','Machine')) {
  $envNames+=@([Environment]::GetEnvironmentVariables($kind).Keys | Where-Object {
    [string]$_ -match '(?i)^CLACK_LM11_|^LM11_AUTHENTICATED_'
  })
}

$result=[pscustomobject]@{
  observedAtUtc=(Get-Date).ToUniversalTime().ToString('o')
  source='read-only OS-wide Win32_Process, Win32_Service, scheduled tasks, TCP listener, persisted environment'
  caseCount=$caseCount;uniqueSyntheticCasePorts=$ports.Count
  acceptanceProcessCount=$owned.Count;recordedCaseListeningPortCount=$listen.Count
  acceptanceServiceRegistrationCount=$registeredServices.Count
  acceptanceScheduledTaskCount=$scheduled.Count;persistedAcceptanceEnvironmentNameCount=$envNames.Count
  noOwnedRuntimeOrListenerOrRegistration=($owned.Count -eq 0 -and $listen.Count -eq 0 -and
    $registeredServices.Count -eq 0 -and $scheduled.Count -eq 0 -and $envNames.Count -eq 0)
  limitation='Does not enumerate every filesystem/registry location or guarantee the absence of unlabelled processes'
}
$json=ConvertTo-Json -InputObject $result -Depth 6
$path=Join-Path $CaseDir 'os-post-run-isolation.json'
$bytes=(New-Object System.Text.UTF8Encoding($false)).GetBytes($json)
$handle=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try {$handle.Write($bytes,0,$bytes.Length);$handle.Flush($true)}finally{$handle.Dispose()}
Write-Output ('OS_ISOLATION_NO_RESIDUE='+$result.noOwnedRuntimeOrListenerOrRegistration)
Write-Output ('ACCEPTANCE_CASES='+$caseCount+' RECORDED_PORTS='+$ports.Count+
  ' LIVE_PROCESSES='+$owned.Count+' LIVE_LISTENERS='+$listen.Count)
if(-not $result.noOwnedRuntimeOrListenerOrRegistration) {exit 3}
