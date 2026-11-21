param(
  [Parameter(Mandatory=$true)][string]$MatrixAuditDir,
  [Parameter(Mandatory=$true)][string]$T15BeforePath
)

# The acceptance source and all workers must be frozen BEFORE this runner.
# All 15 ordered groups execute exactly once; every raw log and manifest is
# created with CreateNew. A failing group never hides the remaining results.
# Model weights, GPU, Lab Run, ForgeBoard and production AppData are untouched.
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath
$cases=(Resolve-Path 'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases').ProviderPath
$audit=(Resolve-Path -LiteralPath $MatrixAuditDir).ProviderPath
$before=(Resolve-Path -LiteralPath $T15BeforePath).ProviderPath
if((Split-Path -Parent $audit) -ine $cases -or
   (Split-Path -Leaf $audit) -notmatch '^matrix-audit-[0-9]{17}-[a-f0-9]{12}$' -or
   (Split-Path -Leaf $before) -ne 'production-before.json' -or
   (Split-Path -Leaf (Split-Path -Parent $before)) -notmatch '^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$' -or
   (Split-Path -Parent (Split-Path -Parent $before)) -ine $cases) {
  throw 'Refusing unapproved evidence or T01 BEFORE path'
}
if(Test-Path (Join-Path $audit 'regression-results.json')) {
  throw 'Ordered matrix regression result already exists and is immutable'
}
$env:CLACK_LM11_T01_BEFORE_PATH=$before
$owner=(Split-Path -Leaf $audit)
$rows=New-Object System.Collections.ArrayList
function WriteNewText([string]$path,[string]$text) {
  $bytes=[Text.Encoding]::UTF8.GetBytes($text)
  $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function AssessKnownFixture([string]$log,[int]$expected) {
  if($expected -ne 3 -and $expected -ne 5){return $false}
  $content=Get-Content -LiteralPath $log -Raw
  if($content -notmatch ('Tests\s+'+$expected+' failed\s*\|')) {return $false}
  $failed=@([regex]::Matches($content,'(?m)^\s*FAIL\s+[^\r\n]+') |ForEach-Object {$_.Value})
  if($failed.Count -ne $expected){return $false}
  $memory=@($failed|Where-Object {$_ -match 'src/modules/ai/quality/memory\.quality\.test\.ts'})
  $prepare=@($failed|Where-Object {$_ -match 'src/test/preparationPhaseCapture\.integration\.test\.ts'})
  if($memory.Count -ne 3){return $false}
  if($expected -eq 5 -and $prepare.Count -ne 2){return $false}
  if($expected -eq 3 -and $prepare.Count -ne 0){return $false}
  return $true
}
function Run([string]$name,[int]$ordinal,[string]$script,[int]$knownFailures=0) {
  $leaf=('regression-{0:D2}.log' -f $ordinal)
  $file=Join-Path $audit $leaf
  if(Test-Path $file){throw 'Refusing regression log overwrite: '+$file}
  $start=(Get-Date).ToUniversalTime().ToString('o')
  $header='LM11 regression group '+$ordinal+' / 15: '+$name+"`nUTC started: "+$start+"`n"
  WriteNewText $file $header
  # This local PowerShell process only; script blocks contain fixed task
  # commands, never interpolated user-provided shell syntax.
  $previousErrorAction=$ErrorActionPreference
  $exit=0
  try {
    # Windows PowerShell 5.1 represents npm/Node stderr warnings as
    # nonterminating NativeCommandError records. Capture these verbatim;
    # the subprocess exit code, not a warning, determines its verdict.
    $ErrorActionPreference='Continue'
    & ([scriptblock]::Create($script)) *>> $file
    $exit=$LASTEXITCODE
    if($null -eq $exit){$exit=0}
  } catch {
    $exit=1
    Add-Content -LiteralPath $file -Value ('UNEXPECTED REGRESSION HARNESS ERROR: '+$_.Exception.GetType().Name)
  } finally {
    $ErrorActionPreference=$previousErrorAction
  }
  $status=if($exit -eq 0){'PASS'}elseif($knownFailures -gt 0 -and
    (AssessKnownFixture $file $knownFailures)){'KNOWN-FAIL'}else{'FAIL'}
  $reason=if($status -eq 'PASS'){
    'Frozen-source ordered regression completed successfully with exit code zero.'
  }elseif($status -eq 'KNOWN-FAIL'){
    'Only the exact existing unrelated structured-memory fixture failures were observed; none is reclassified as passing.'
  }else{
    'Regression exit code was nonzero or the failing tests differed from the sealed known unrelated fixture signature.'
  }
  $row=[ordered]@{
    ordinal=$ordinal;name=$name;status=$status;reason=$reason;
    evidenceFile=($owner+'/'+$leaf);exitCode=[int]$exit;
    startedAtUtc=$start;finishedAtUtc=(Get-Date).ToUniversalTime().ToString('o');
  }
  [void]$rows.Add($row)
  Write-Output ('GROUP='+$ordinal+' NAME='+$name+' STATUS='+$status+' EXIT='+$exit)
}

# No native acceptance launch is permitted before this script's START, and no
# acceptance worker/source editor may still be active when it is invoked.
Run 'Matrix-specific contracts and evidence compiler safety' 1 {
  & node --test scripts/lm11-full-matrix-cancel-contract.test.mjs scripts/lm11-full-matrix-summary-builder.test.mjs scripts/lm11-t15-attributable-policy.test.mjs
}
Run 'Feature-gated acceptance hook safety and T01 original selector' 2 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/ai/lib/lm11AcceptanceBarrier.test.ts src/modules/ai/lib/lm11SyntheticAcceptanceContract.test.ts src/modules/ai/lib/lm11ProductionSelectorExclusion.offline.test.tsx
}
Run 'Focused B01 B02 B03 original operation and transport safety' 3 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/ai/lib/managedLocalRouting.test.ts src/modules/ai/lib/managedLocalAcceptance.test.ts src/modules/ai/lib/deploymentQualificationFlightSafety.test.ts src/modules/ai/lib/deploymentQualificationRuntime.test.ts src/modules/ai/lib/proxyFetch.test.ts src/modules/ai/lib/lm11AcceptanceBarrier.test.ts src/modules/settings/selfHostedQualificationCas.test.ts src/test/acceptanceComparison.test.ts src/modules/ai/lib/deploymentEvidenceHistory.test.ts src/modules/ai/lib/deploymentQualificationNativeSafety.test.ts
}
Run 'Native B03 persistence TS and atomic settings CAS bridge' 4 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/settings/selfHostedPersistence.test.ts src/modules/settings/selfHostedQualificationCas.test.ts src/modules/settings/selfHostedAtomicSettingsBridge.test.ts
}
Run 'T10 original stale callback real A to B restart regression' 5 {
  & node scripts/lm11-authenticated-webview-acceptance.mjs --no-build --scenario stale-original-qualification-child-restart
}
Run 'T13 original late Channel callback after cancellation regression' 6 {
  & node scripts/lm11-authenticated-webview-acceptance.mjs --no-build --scenario post-cancel-original-lm2f-channel
}
Run 'Exact native inference ID cancellation regression' 7 {
  & node scripts/lm11-authenticated-webview-acceptance.mjs --no-build --scenario cancel-exact-id
}
Run 'Normal original synthetic full qualification and native readback' 8 {
  & node scripts/lm11-authenticated-webview-acceptance.mjs --no-build --scenario normal
}
Run 'Affected AI settings TypeScript Vitest, known memory fixtures retained' 9 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/ai src/modules/settings
} 3
Run 'Feature-enabled native Rust offline locked library' 10 {
  & cargo test --offline --locked --lib --manifest-path src-tauri/Cargo.toml --features lm11-authenticated-webview-acceptance --target-dir src-tauri/target/codex-checkpoint6
}
Run 'Ordinary native Rust offline locked library' 11 {
  & cargo test --offline --locked --lib --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target/codex-checkpoint6
}
Run 'Wider bounded TypeScript Vitest, known unrelated five fixture failures retained' 12 {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' --exclude 'scripts/**' --maxWorkers 4
} 5
Run 'Local installed TypeScript typecheck noEmit' 13 {
  & node node_modules/typescript/bin/tsc --noEmit --pretty false
}
Run 'Added JavaScript and PowerShell parser syntax checks' 14 {
  $all=@(
    'scripts/lm11-authenticated-webview-acceptance.mjs',
    'scripts/lm11-full-matrix-requirements.mjs',
    'scripts/lm11-full-matrix-summary-builder.mjs',
    'scripts/lm11-full-matrix-case-evidence.mjs',
    'scripts/lm11-full-matrix-index.mjs',
    'scripts/lm11-full-matrix-review-generator.mjs',
    'scripts/lm11-full-matrix-source-freeze.mjs'
  )
  foreach($js in $all) {
    & node --check $js
    if($LASTEXITCODE -ne 0){throw ('Node syntax check failed: '+$js)}
  }
  $scripts=@(
    'scripts/lm11-full-matrix-preservation-audit.ps1',
    'scripts/lm11-full-matrix-ordered-regressions.ps1',
    'scripts/lm11-production-state-inventory.ps1',
    'scripts/lm11-production-credential-metadata.ps1',
    'scripts/lm11-production-secret-fingerprint.ps1',
    'scripts/lm11-post-run-os-isolation.ps1'
  )
  foreach($ps in $scripts) {
    $tok=$null;$err=$null
    [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $ps).ProviderPath,[ref]$tok,[ref]$err)|Out-Null
    if(@($err).Count -gt 0){throw ('PowerShell parse failure: '+$ps)}
  }
  & node -e 'process.exit(0)'
}
Run 'Git whitespace regression diff check' 15 {
  & git diff --check
}

$out=Join-Path $audit 'regression-results.json'
$result=[ordered]@{
  schema=1;kind='LM11 B01-B03 frozen acceptance source ordered 15 regressions';
  sourceFrozenBeforeRegressions=$true;
  newFreshT01BeforePath=$before;
  regressions=@($rows.ToArray());
  allFifteenExecuted=($rows.Count -eq 15);
  unrelatedMemoryFixturesNotReclassified=$true;
  observedAtUtc=(Get-Date).ToUniversalTime().ToString('o')
}
WriteNewText $out (($result|ConvertTo-Json -Depth 10)+"`n")
Write-Output ('REGRESSION_RECORD='+$out)
Write-Output ('TOTAL_GROUPS='+$rows.Count)
Write-Output ('SAFETY_PASS='+@($rows |Where-Object {$_.status -eq 'PASS'}).Count)
Write-Output ('KNOWN_UNRELATED_FAIL='+@($rows |Where-Object {$_.status -eq 'KNOWN-FAIL'}).Count)
Write-Output ('NEW_FAIL='+@($rows |Where-Object {$_.status -eq 'FAIL'}).Count)
if(@($rows |Where-Object {$_.status -eq 'FAIL'}).Count -gt 0){exit 1}
