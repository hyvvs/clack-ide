param(
  [Parameter(Mandatory=$true)][string]$ClosureAuditDir,
  [Parameter(Mandatory=$true)][string]$T15BeforePath
)

# Ordered, acceptance-only regression audit. No production authority, Git
# mutation, real model inference, GPU workload, or Lab Run enablement.
$ErrorActionPreference='Stop'
$repo=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$cases=(Resolve-Path -LiteralPath (Join-Path $repo 'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases')).ProviderPath
$audit=(Resolve-Path -LiteralPath $ClosureAuditDir).ProviderPath
$before=(Resolve-Path -LiteralPath $T15BeforePath).ProviderPath
if ((Split-Path -Parent $audit) -ine $cases -or
    (Split-Path -Leaf $audit) -notmatch '^closure-audit-[0-9]{17}-[a-f0-9]{12}$' -or
    (Split-Path -Leaf $before) -ne 'production-before.json' -or
    (Split-Path -Leaf (Split-Path -Parent $before)) -notmatch '^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$' -or
    (Split-Path -Parent (Split-Path -Parent $before)) -ine $cases) {
  throw 'Closure regressions require exact owned audit and fresh closure T15 BEFORE'
}
if (Test-Path -LiteralPath (Join-Path $audit 'regression-results.json')) {
  throw 'Refusing to overwrite existing closure regression result'
}
$env:CLACK_LM11_T01_BEFORE_PATH=$before
$rows=New-Object System.Collections.ArrayList
$owner=Split-Path -Leaf $audit
function WriteOnce([string]$file,[string]$value) {
  $bytes=[Text.Encoding]::UTF8.GetBytes($value)
  $stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)} finally {$stream.Dispose()}
}
function KnownMemorySignature([string]$file,[int]$expected) {
  if($expected -notin @(3,5)){return $false}
  $value=Get-Content -LiteralPath $file -Raw
  if($value -notmatch ('Tests\s+'+$expected+' failed\s*\|')){return $false}
  $failures=@([regex]::Matches($value,'(?m)^\s*FAIL\s+[^\r\n]+') |ForEach-Object {$_.Value})
  if($failures.Count -ne $expected){return $false}
  if(@($failures|Where-Object {$_ -match 'src/modules/ai/quality/memory\.quality\.test\.ts'}).Count -ne 3){return $false}
  if(@($failures|Where-Object {$_ -match 'src/test/preparationPhaseCapture\.integration\.test\.ts'}).Count -ne ($expected - 3)){return $false}
  return $true
}
function Run([string]$name,[int]$ordinal,[scriptblock]$body,[int]$knownFailures=0) {
  $leaf=('regression-{0:D2}.log' -f $ordinal)
  $file=Join-Path $audit $leaf
  WriteOnce $file ('LM11 B02/B03 closure regression '+$ordinal+'/19: '+$name+"`n"+(Get-Date).ToUniversalTime().ToString('o')+"`n")
  $start=(Get-Date).ToUniversalTime().ToString('o')
  $exit=0
  $previous=$ErrorActionPreference
  try {
    $ErrorActionPreference='Continue'
    & $body *>> $file
    $exit=$LASTEXITCODE
    if($null -eq $exit){$exit=0}
  } catch {
    $exit=1
    Add-Content -LiteralPath $file -Value ('REGRESSION HARNESS ERROR: '+$_.Exception.GetType().Name)
  } finally {
    $ErrorActionPreference=$previous
  }
  $status=if($exit -eq 0){'PASS'}elseif($knownFailures -gt 0 -and (KnownMemorySignature $file $knownFailures)){'KNOWN-FAIL'}else{'FAIL'}
  [void]$rows.Add([ordered]@{ordinal=$ordinal;name=$name;status=$status;exitCode=[int]$exit;
    evidenceFile=$owner+'/'+$leaf;startedAtUtc=$start;
    finishedAtUtc=(Get-Date).ToUniversalTime().ToString('o');
    scope='Regression only; passing does not upgrade an unexecuted closure requirement'})
  Write-Output ('GROUP='+$ordinal+' NAME='+$name+' STATUS='+$status+' EXIT='+$exit)
}

Run 'New B02 cancellation fence contracts' 1 {
  & node --test scripts/lm11-full-matrix-cancel-contract.test.mjs
}
Run 'New B03 CAS authority contracts' 2 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/settings/selfHostedQualificationCas.test.ts
}
Run 'Failure semantic closure contracts' 3 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/ai/lib/deploymentQualificationRuntime.test.ts
}
Run 'Concurrent authority original flight gates' 4 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/ai/lib/deploymentQualificationFlightSafety.test.ts
}
Run 'Acceptance-only feature hook safety and selector exclusion' 5 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/ai/lib/lm11AcceptanceBarrier.test.ts src/modules/ai/lib/lm11SyntheticAcceptanceContract.test.ts src/modules/ai/lib/lm11ProductionSelectorExclusion.offline.test.tsx
}
Run 'Focused accepted B01 deadline preservation subset' 6 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/ai/lib/deploymentQualificationRuntime.test.ts src/modules/ai/lib/deploymentQualificationNativeSafety.test.ts
}
Run 'Focused B01 B02 B03 original path and transport safety' 7 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/ai/lib/managedLocalRouting.test.ts src/modules/ai/lib/managedLocalAcceptance.test.ts src/modules/ai/lib/deploymentQualificationFlightSafety.test.ts src/modules/ai/lib/deploymentQualificationRuntime.test.ts src/modules/ai/lib/proxyFetch.test.ts src/modules/ai/lib/lm11AcceptanceBarrier.test.ts src/modules/settings/selfHostedQualificationCas.test.ts src/test/acceptanceComparison.test.ts src/modules/ai/lib/deploymentEvidenceHistory.test.ts src/modules/ai/lib/deploymentQualificationNativeSafety.test.ts
}
Run 'B03 persistence and atomic settings bridge' 8 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/settings/selfHostedPersistence.test.ts src/modules/settings/selfHostedQualificationCas.test.ts src/modules/settings/selfHostedAtomicSettingsBridge.test.ts
}
Run 'T10 genuine A to B stale Channel restart' 9 {
  & node scripts/lm11-authenticated-webview-acceptance.mjs --no-build --scenario stale-original-qualification-child-restart
}
Run 'T13 genuine original late Channel callback' 10 {
  & node scripts/lm11-authenticated-webview-acceptance.mjs --no-build --scenario post-cancel-original-lm2f-channel
}
Run 'Exact native request ID cancellation' 11 {
  & node scripts/lm11-authenticated-webview-acceptance.mjs --no-build --scenario cancel-exact-id
}
Run 'Positive original synthetic qualification and readback' 12 {
  & node scripts/lm11-authenticated-webview-acceptance.mjs --no-build --scenario normal
}
Run 'Affected AI settings TypeScript (three known memory failures)' 13 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/ai src/modules/settings
} 3
Run 'Feature-enabled native Rust library offline locked' 14 {
  & cargo test --offline --locked --lib --manifest-path src-tauri/Cargo.toml --features lm11-authenticated-webview-acceptance --target-dir src-tauri/target/codex-checkpoint6
}
Run 'Ordinary native Rust library offline locked' 15 {
  & cargo test --offline --locked --lib --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target/codex-checkpoint6
}
Run 'Wider bounded TypeScript (five known unrelated memory fixtures)' 16 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' --exclude 'scripts/**' --maxWorkers 4
} 5
Run 'Direct installed TypeScript noEmit' 17 {
  & node node_modules/typescript/bin/tsc --noEmit --pretty false
}
Run 'Added JS and PowerShell syntax' 18 {
  foreach($js in @('scripts/lm11-authenticated-webview-acceptance.mjs','scripts/lm11-b02-b03-closure-index.mjs','scripts/lm11-full-matrix-cancel-contract.mjs')) {
    if(-not (Test-Path -LiteralPath $js)){continue}
    & node --check $js
    if($LASTEXITCODE -ne 0){throw ('JS parser failed: '+$js)}
  }
  foreach($ps in @('scripts/lm11-b02-b03-closure-regressions.ps1','scripts/lm11-production-state-inventory.ps1','scripts/lm11-production-secret-fingerprint.ps1')) {
    $tokens=$null;$errors=$null
    [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $ps).ProviderPath,[ref]$tokens,[ref]$errors)|Out-Null
    if(@($errors).Count -gt 0){throw ('PowerShell parser failed: '+$ps)}
  }
  & node -e 'process.exit(0)'
}
Run 'Git diff whitespace safety' 19 {
  & git diff --check
}

$result=[ordered]@{schema=1;kind='LM11 B02/B03 Final Acceptance Closure ordered 19 regressions';
  freshT15BeforePath=$before;frozenSourceRequired=$true;
  allNineteenExecuted=($rows.Count -eq 19);
  regressions=@($rows.ToArray());
  unrelatedMemoryFailuresNeverReclassified=$true;
  observedAtUtc=(Get-Date).ToUniversalTime().ToString('o')}
$out=Join-Path $audit 'regression-results.json'
WriteOnce $out (($result|ConvertTo-Json -Depth 10)+"`n")
Write-Output ('REGRESSION_RECORD='+$out)
Write-Output ('TOTAL_GROUPS='+$rows.Count)
Write-Output ('NEW_FAIL='+@($rows|Where-Object {$_.status -eq 'FAIL'}).Count)
if(@($rows|Where-Object {$_.status -eq 'FAIL'}).Count -gt 0){exit 1}
