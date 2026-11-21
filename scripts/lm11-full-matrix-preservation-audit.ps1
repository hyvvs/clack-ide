param(
  [Parameter(Mandatory=$true)][string]$MatrixAuditDir,
  [Parameter(Mandatory=$true)][string]$FreshT15Dir
)

# A read-only independent final preservation audit. The *only* output is one
# write-once evidence leaf inside the selected canonical matrix audit folder.
# No staging, cache cleanup, registry access, secret enumeration or mutation.
$ErrorActionPreference='Stop'
$repo=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$cases=(Resolve-Path -LiteralPath (Join-Path $repo 'src-tauri\target\lm11-b01-b03-authenticated-webview-20261119\cases')).ProviderPath
$audit=(Resolve-Path -LiteralPath $MatrixAuditDir).ProviderPath
$t15=(Resolve-Path -LiteralPath $FreshT15Dir).ProviderPath
if ((Split-Path -Parent $audit) -ine $cases -or
    (Split-Path -Leaf $audit) -notmatch '^matrix-audit-[0-9]{17}-[a-f0-9]{12}$' -or
    (Split-Path -Parent $t15) -ine $cases -or
    (Split-Path -Leaf $t15) -notmatch '^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$' -or
    ((Get-Item -LiteralPath $audit).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    ((Get-Item -LiteralPath $t15).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Refusing any noncanonical or redirected preservation evidence owner'
}
$osPath=Join-Path $t15 'os-post-run-isolation.json'
$scopePath=Join-Path $t15 'scoped-t15-final-comparison.json'
if (-not (Test-Path -LiteralPath $osPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $scopePath -PathType Leaf)) {
  throw 'Fresh matched T15 AFTER and OS isolation must be completed before preservation seal'
}
$os=Get-Content -LiteralPath $osPath -Raw | ConvertFrom-Json
$scope=Get-Content -LiteralPath $scopePath -Raw | ConvertFrom-Json
$branch=(& git branch --show-current).Trim()
$head=(& git rev-parse HEAD).Trim()
$indexSha=(Get-FileHash -LiteralPath (Join-Path $repo '.git\index') -Algorithm SHA256).Hash.ToLowerInvariant()
$staged=@(& git diff --cached --name-only)
$stashes=@(& git stash list --format='%H')
$tracked=@(& git status --short -- autonomous_tracker)
$oldIndexes=@(
  @('src-tauri/target/lm11-b03-native-acceptance-20261119-real-host/native-acceptance-85-invocations-20261119.json',
    'c329ae36ad8255150ff0a46f71a03a64d0a6dec8283db392c6861668ddeef1a7'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261119080122842-cf1e7d43238c/authenticated-webview-evidence-index.json',
    'f8f7f1effc0681530941e3f2926248d65b642ef4db81618bf8a1d948adbcd74e'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120000845246-05cea9a2820e/lm11-fidelity-closure-evidence-index.json',
    'cd5e2529b39acc542bc49b324decccf931b791dc31f4ed727bd29ea82c7507d1'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120030346856-e7fecf53ae5b/lm11-final-blocker-closure-evidence-index.json',
    '8aa9c994fbea5355cf50e4bedf420e60cf60c2f2b477d8d3e5c85f28ea5cd8ee')
)
$oldIndexResults=@()
foreach($item in $oldIndexes) {
  $filename=Join-Path $repo $item[0]
  $actual=if(Test-Path -LiteralPath $filename -PathType Leaf) {
    (Get-FileHash -LiteralPath $filename -Algorithm SHA256).Hash.ToLowerInvariant()
  } else { 'MISSING' }
  $oldIndexResults+=@([ordered]@{relativePath=$item[0];sha256=$actual;matches=$actual -eq $item[1]})
}
$manifest=Join-Path $repo 'src-tauri\target\lm2f-validation-20261117\reconstructed-protected-81.tsv'
$protected=@(Get-Content -LiteralPath $manifest)
$mismatches=@()
foreach($line in $protected) {
  $fields=$line -split "`t",2
  if($fields.Count -ne 2 -or $fields[0] -match '(^/|\.\.|^[a-zA-Z]:)' -or
      $fields[1] -notmatch '^[0-9a-f]{64}$') {
    throw 'Invalid sealed protected-file manifest row'
  }
  $file=Join-Path $repo $fields[0]
  if(-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    $mismatches+=@($fields[0]); continue
  }
  $actual=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if($actual -ne $fields[1]) {$mismatches+=@($fields[0])}
}
$running=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
  $_.Name -ieq 'lm11_authenticated_webview_acceptance.exe' -or
  ($_.Name -ieq 'node.exe' -and $_.CommandLine -match 'lm11-authenticated-webview-acceptance\.mjs')
})
& git diff --check 2>$null | Out-Null
$diffCheckExit=$LASTEXITCODE
$debugAbsent=-not(Test-Path -LiteralPath (Join-Path $repo 'src-tauri\target\debug'))
$codexTestAbsent=-not(Test-Path -LiteralPath (Join-Path $repo 'src-tauri\target\codex-test'))
$expectedStashes=@(
  '6a7bc6beef913a323052b277f766ae32be11bae1',
  'b96fc46d783f1635acec2278deed7b43479f5f9a'
)
$preserved=$branch -eq 'main' -and
  $head -eq '50fca4689692bc1e85f9ffd4ae644ff528cc056e' -and
  $indexSha -eq '5cd3574caaa8fc3ec4d01e79cbd8f6edb90573600df927e068a3d1b1c144f211' -and
  $staged.Count -eq 0 -and $stashes.Count -eq 2 -and
  $stashes[0] -eq $expectedStashes[0] -and $stashes[1] -eq $expectedStashes[1] -and
  $protected.Count -eq 81 -and $mismatches.Count -eq 0 -and
  @($oldIndexResults|Where-Object {-not $_.matches}).Count -eq 0 -and
  $tracked.Count -eq 0 -and $debugAbsent -and $codexTestAbsent -and
  $running.Count -eq 0 -and $diffCheckExit -eq 0 -and
  $os.noOwnedRuntimeOrListenerOrRegistration -eq $true -and
  $os.acceptanceProcessCount -eq 0 -and
  $scope.authoritativeT15Pass -eq $true
$result=[ordered]@{
  schema=1; kind='LM11 B01-B03 independent final preservation';
  observedAtUtc=(Get-Date).ToUniversalTime().ToString('o');
  preserved=[bool]$preserved; branch=$branch; head=$head;
  rawGitIndexSha256=$indexSha; stagedPaths=$staged.Count; originalStashes=$stashes;
  protectedFileCount=$protected.Count; protectedFileHashMismatches=@($mismatches);
  oldImmutableIndexes=$oldIndexResults; autonomousTrackerStatusCount=$tracked.Count;
  acceptanceProcessCount=$running.Count; noOwnedListenersOrRegistrations=[bool]$os.noOwnedRuntimeOrListenerOrRegistration;
  debugTargetAbsent=[bool]$debugAbsent; codexTestTargetAbsent=[bool]$codexTestAbsent;
  gitDiffCheckExitCode=$diffCheckExit; freshMatchedT15=[bool]$scope.authoritativeT15Pass;
  noRawCredentialsOrUnrelatedTargetsSerialized=$true
}
$output=Join-Path $audit 'final-preservation-audit.json'
$bytes=[Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json -Depth 12)+"`n")
$handle=[IO.File]::Open($output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{$handle.Write($bytes,0,$bytes.Length);$handle.Flush($true)}finally{$handle.Dispose()}
Write-Output ('PRESERVED='+$preserved)
Write-Output ('FILE='+$output)
Write-Output ('SHA256='+((Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()))
if(-not $preserved){exit 1}
