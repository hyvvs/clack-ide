param(
  [Parameter(Mandatory=$true)][string]$AuditDir,
  [Parameter(Mandatory=$true)][string]$FreshT15Dir
)
# Independent, read-only preservation proof. This script never stages, cleans,
# resets, stashes, commits or touches a production model or credential.
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath
$cases=(Resolve-Path (Join-Path $repo 'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases')).ProviderPath
$audit=(Resolve-Path -LiteralPath $AuditDir).ProviderPath
$t15=(Resolve-Path -LiteralPath $FreshT15Dir).ProviderPath
if((Split-Path -Parent $audit) -ine $cases -or
   (Split-Path -Leaf $audit) -notmatch '^final-defect-audit-[0-9]{17}-[a-f0-9]{12}$' -or
   (Split-Path -Parent $t15) -ine $cases -or
   (Split-Path -Leaf $t15) -notmatch '^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$' -or
   (Test-Path (Join-Path $audit 'final-preservation-audit.json'))){
  throw 'Refusing noncanonical or existing immutable preservation owner'
}
Set-Location $repo
$os=Get-Content (Join-Path $t15 'os-post-run-isolation.json') -Raw|ConvertFrom-Json
$scope=Get-Content (Join-Path $t15 'scoped-t15-final-comparison.json') -Raw|ConvertFrom-Json
$branch=(& git branch --show-current).Trim()
$head=(& git rev-parse HEAD).Trim()
$index=(Get-FileHash -LiteralPath (Join-Path $repo '.git/index') -Algorithm SHA256).Hash.ToLowerInvariant()
$staged=@(& git diff --cached --name-only)
$stashes=@(& git stash list --format='%H')
$tracker=@(& git status --short -- autonomous_tracker)
$expectedStashes=@(
  '6a7bc6beef913a323052b277f766ae32be11bae1',
  'b96fc46d783f1635acec2278deed7b43479f5f9a'
)
$indexes=@(
  @('src-tauri/target/lm11-b03-native-acceptance-20261119-real-host/native-acceptance-85-invocations-20261119.json',
    'c329ae36ad8255150ff0a46f71a03a64d0a6dec8283db392c6861668ddeef1a7'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261119075756557-9b24605b769a/authenticated-webview-evidence-index.json',
    '2270907c399a1ae3e1baeead8f2e3a20af8c528489d7ad0790b60985c39d2d9f'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261119080105156-e767cf9bebf3/authenticated-webview-evidence-index.json',
    '590776a8ba0d26c41524ab7ac0220e946c83c2c575d3413dd6d3dd32602309f0'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261119080122842-cf1e7d43238c/authenticated-webview-evidence-index.json',
    'f8f7f1effc0681530941e3f2926248d65b642ef4db81618bf8a1d948adbcd74e'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261119173207362-4b68c506cad7/authenticated-webview-evidence-index.json',
    '5eb803ebcbcd369eb50ca112282a57ffc35d7d8b3c8e7870e8415f5a7dc578a6'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120000845246-05cea9a2820e/lm11-fidelity-closure-evidence-index.json',
    'cd5e2529b39acc542bc49b324decccf931b791dc31f4ed727bd29ea82c7507d1'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120030346856-e7fecf53ae5b/lm11-final-blocker-closure-evidence-index.json',
    '8aa9c994fbea5355cf50e4bedf420e60cf60c2f2b477d8d3e5c85f28ea5cd8ee'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120061805173-887efb038e68/lm11-b01-b03-full-matrix-evidence-index.json',
    '1de726b770192ba4b5f761a02a04283207b05e349e0a4efe8f3c51d5ecc304d4'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/index-20261120075123305-aee54834a57c/lm11-b02-b03-final-acceptance-closure-evidence-index.json',
    '7cb28af7338ea0d7cc6aeaccfb4cfe8d0105f6fcb515cadc46f6431f7c64be0b'),
  @('src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases/async-authority-audit-20261120111631274-e0edf6a279b2/lm11-b02-b03-asynchronous-persistence-authority-closure-evidence-index.json',
    'a35c7c552bb2e37da1af8df4e80fccb2e5f28fe9d11ea826f25c1094c4a7bb2d')
)
$indexResults=@()
foreach($pair in $indexes){
  $path=Join-Path $repo $pair[0]
  $actual=if(Test-Path -LiteralPath $path -PathType Leaf){
    (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  }else{'MISSING'}
  $indexResults+=@([ordered]@{relativePath=$pair[0];sha256=$actual;unchanged=$actual -eq $pair[1]})
}
$manifest=Join-Path $repo 'src-tauri/target/lm2f-validation-20261117/reconstructed-protected-81.tsv'
$protected=@(Get-Content -LiteralPath $manifest)
$mismatches=@()
foreach($row in $protected){
  $fields=$row -split "`t",2
  if($fields.Count -ne 2 -or $fields[0] -match '(^/|\.\.|^[a-zA-Z]:)' -or
      $fields[1] -notmatch '^[a-f0-9]{64}$'){throw 'Malformed baseline protected manifest'}
  $filename=Join-Path $repo $fields[0]
  if(-not(Test-Path -LiteralPath $filename -PathType Leaf)){$mismatches+=@($fields[0]);continue}
  $hash=(Get-FileHash -LiteralPath $filename -Algorithm SHA256).Hash.ToLowerInvariant()
  if($hash -ne $fields[1]){$mismatches+=@($fields[0])}
}
$running=@(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -ieq 'lm11_authenticated_webview_acceptance.exe' -or
  ($_.Name -ieq 'node.exe' -and $_.CommandLine -match 'lm11-authenticated-webview-acceptance\.mjs')
})
# Windows PowerShell 5.1 promotes benign Git CRLF warnings on stderr to
# NativeCommandError under Stop. Preserve the real Git exit status instead.
$previousErrorActionPreference=$ErrorActionPreference
$ErrorActionPreference='Continue'
try {
  & git diff --check 2>&1|Out-Null
  $gitDiffExit=$LASTEXITCODE
} finally {$ErrorActionPreference=$previousErrorActionPreference}
$debugAbsent=-not(Test-Path (Join-Path $repo 'src-tauri/target/debug'))
$codexTestAbsent=-not(Test-Path (Join-Path $repo 'src-tauri/target/codex-test'))
$preserved=$branch -eq 'main' -and
  $head -eq '50fca4689692bc1e85f9ffd4ae644ff528cc056e' -and
  $index -eq '5cd3574caaa8fc3ec4d01e79cbd8f6edb90573600df927e068a3d1b1c144f211' -and
  $staged.Count -eq 0 -and $stashes.Count -eq 2 -and
  $stashes[0] -eq $expectedStashes[0] -and $stashes[1] -eq $expectedStashes[1] -and
  $protected.Count -eq 81 -and $mismatches.Count -eq 0 -and
  @($indexResults|Where-Object{-not $_.unchanged}).Count -eq 0 -and
  $tracker.Count -eq 0 -and $running.Count -eq 0 -and
  $debugAbsent -and $codexTestAbsent -and $gitDiffExit -eq 0 -and
  $os.noOwnedRuntimeOrListenerOrRegistration -eq $true -and
  $os.acceptanceProcessCount -eq 0 -and
  $scope.authoritativeT15Pass -eq $true
$result=[ordered]@{
  schema=1;kind='LM11 Final B02/B03 Defect and Race Closure preservation';
  observedAtUtc=(Get-Date).ToUniversalTime().ToString('o');preserved=[bool]$preserved;
  branch=$branch;head=$head;rawGitIndexSha256=$index;
  stagedPaths=$staged.Count;originalStashes=$stashes;
  protectedFileCount=$protected.Count;protectedFileMismatches=@($mismatches);
  historicalIndexes=@($indexResults);autonomousTrackerStatusCount=$tracker.Count;
  acceptanceProcessCount=$running.Count;
  noAcceptanceListenersServicesTasksEnvironment=[bool]$os.noOwnedRuntimeOrListenerOrRegistration;
  targetDebugAbsent=[bool]$debugAbsent;targetCodexTestAbsent=[bool]$codexTestAbsent;
  gitDiffCheckExitCode=$gitDiffExit;
  freshT15=[bool]$scope.authoritativeT15Pass;
  scopedObjectsBefore=$scope.beforeObjects;scopedObjectsAfter=$scope.afterObjects;
  scopedCredentialCount=$scope.scopedCredentialsAfter;
  scopedV3SecretCount=$scope.scopedV3CountAfter;
  noProductionCredentialsOrModelWeightsModified=[bool]$scope.authoritativeT15Pass
}
$destination=Join-Path $audit 'final-preservation-audit.json'
$bytes=([Text.UTF8Encoding]::new($false)).GetBytes(($result|ConvertTo-Json -Depth 12)+"`n")
$stream=[IO.File]::Open($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try {$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
Write-Output ('PRESERVED='+$preserved)
Write-Output ('PATH='+$destination)
Write-Output ('SHA256='+((Get-FileHash $destination -Algorithm SHA256).Hash.ToLowerInvariant()))
if(-not $preserved){exit 1}
