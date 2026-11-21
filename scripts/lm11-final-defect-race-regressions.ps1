param(
  [Parameter(Mandatory=$true)][string]$AuditDir,
  [Parameter(Mandatory=$true)][string]$PostDeadlineCase,
  [Parameter(Mandatory=$true)][string]$T15BeforePath
)
# Write-once ordered results for the FINAL bounded LM11 defect/race cohort.
# No real inference, GPU, production state modification or Git mutation.
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath
$cases=(Resolve-Path (Join-Path $repo 'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases')).ProviderPath
$audit=(Resolve-Path -LiteralPath $AuditDir).ProviderPath
$late=(Resolve-Path -LiteralPath $PostDeadlineCase).ProviderPath
$before=(Resolve-Path -LiteralPath $T15BeforePath).ProviderPath
if ((Split-Path -Parent $audit) -ine $cases -or
    (Split-Path -Leaf $audit) -notmatch '^final-defect-audit-[0-9]{17}-[a-f0-9]{12}$' -or
    (Split-Path -Parent $late) -ine $cases -or
    (Split-Path -Leaf $late) -notmatch '^wry-[0-9]{17}-[a-f0-9]{12}$' -or
    (Split-Path -Leaf $before) -ne 'production-before.json' -or
    (Split-Path -Parent (Split-Path -Parent $before)) -ine $cases -or
    (Test-Path (Join-Path $audit 'regression-results.json'))) {
  throw 'Final regression evidence must use new canonical immutable owners and fresh T15 BEFORE'
}
Set-Location -LiteralPath $repo
$results=New-Object System.Collections.ArrayList
function WriteOnce([string]$file,[string]$value) {
  $bytes=[Text.Encoding]::UTF8.GetBytes($value)
  $stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Case([string[]]$arguments) {
  & node scripts/lm11-authenticated-webview-acceptance.mjs --no-build @arguments
  if($LASTEXITCODE -ne 0) {throw ('Original physical case failed: '+($arguments -join ' '))}
}
function KnownMemorySignature([string]$file) {
  $value=Get-Content -LiteralPath $file -Raw
  $lines=@([regex]::Matches($value,'(?m)^\s*FAIL\s+[^\r\n]+')|ForEach-Object{$_.Value})
  return $lines.Count -in @(3,5) -and
    @($lines|Where-Object{$_ -match 'src/modules/ai/quality/memory\.quality\.test\.ts'}).Count -eq 3 -and
    @($lines|Where-Object{$_ -match 'src/test/preparationPhaseCapture\.integration\.test\.ts'}).Count -eq ($lines.Count-3)
}
function Run([int]$number,[string]$name,[scriptblock]$body,[bool]$knownMemory=$false) {
  $leaf='regression-{0:D2}.log' -f $number
  $file=Join-Path $audit $leaf
  WriteOnce $file ('LM11 Final B02/B03 defect and race closure - '+$number+'/23 '+$name+"`n")
  $started=(Get-Date).ToUniversalTime().ToString('o')
  $code=0
  try {
    $previous=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    & $body *>> $file
    $code=$LASTEXITCODE
    if($null -eq $code){$code=0}
  } catch {
    $code=1
    Add-Content -LiteralPath $file -Value ('HARNESS_ERROR='+$_.Exception.Message)
  } finally {$ErrorActionPreference=$previous}
  $status=if($code -eq 0){'PASS'}elseif($knownMemory -and (KnownMemorySignature $file)){'KNOWN-FAIL'}else{'FAIL'}
  [void]$results.Add([ordered]@{
    ordinal=$number;name=$name;status=$status;exitCode=[int]$code;
    evidenceLeaf=$leaf;startedUtc=$started;completedUtc=(Get-Date).ToUniversalTime().ToString('o')
  })
  Write-Output ('FINAL_REGRESSION='+$number+' STATUS='+$status+' NAME='+$name)
}
Run 1 'B03 five corruption modes, normal exit and separate restart, plus abnormal exit/restart' {
  foreach($mode in @('malformed-main','inconsistent-marker','missing-insufficient','corrupt-recovery','restart-ambiguity')) {
    Case @('--scenario','stage-corrupt','--barrier-stage','b03-before-acknowledge','--corruption-mode',$mode)
  }
  Case @('--scenario','stage-corrupt','--barrier-stage','b03-before-acknowledge',
    '--corruption-mode','malformed-main','--abnormal-corrupt-exit')
}
Run 2 'Historical A persisted ACK readback under genuine new B PID and epoch' {
  Case @('--scenario','stage-stale-epoch','--barrier-stage','b03-before-readback')
}
Run 3 'Late native exact-ID cancellation ACK after original caller terminal' {
  Case @('--scenario','original-late-cancel-ack')
}
Run 4 'Original 120-second post-deadline upstream stream AND terminal physical evidence' {
  $invariants=Get-Content (Join-Path $late 'acceptance-invariants.json') -Raw|ConvertFrom-Json
  $report=Get-Content (Join-Path $late 'renderer-report.json') -Raw|ConvertFrom-Json
  $attempt=Get-Content (Join-Path $late 'postdeadline-upstream-emission.json') -Raw|ConvertFrom-Json
  if($invariants.allPassed -ne $true -or
     $report.renderer.native.originalPostDeadline.originalAggregateBudgetMs -ne 120000 -or
     $report.renderer.native.originalPostDeadline.noB03ReceiptsOrAck -ne $true -or
     $attempt.lateContentFrameAttempted -ne $true -or
     $attempt.lateTerminalFrameAttempted -ne $true) {throw 'Postdeadline original physical case not accepted'}
  Write-Output ('PHYSICAL_CASE='+$late)
  Write-Output ('UPSTREAM_ATTEMPT_SHA256='+((Get-FileHash (Join-Path $late 'postdeadline-upstream-emission.json') -Algorithm SHA256).Hash))
}
Run 5 'Old A native request ID, stale cancellation, and stale qualification completion after B' {
  Case @('--scenario','stage-stale-epoch','--barrier-stage','b03-before-readback','--stale-id-cancel')
}
Run 6 'Original production Channel duplicate completion attempt' {
  Case @('--scenario','original-duplicate-terminal')
}
Run 7 'Original exact-ID cancellation wins and original terminal wins' {
  Case @('--scenario','stage-cancel','--barrier-stage','terminal-delivery')
  Case @('--scenario','stage-reachability','--barrier-stage','terminal-delivery','--terminal-wins-race')
}
Run 8 'Three genuinely concurrent native A/B/C requests, structural deployment constraint' {
  Case @('--scenario','original-abc-native-isolation')
}
Run 9 'Actual registered native quiescence failure and eventual lease cleanup' {
  Case @('--scenario','original-native-quiescence-failure')
}
Run 10 'Original T13 post-cancel callback/Channel lifecycle' {
  Case @('--scenario','post-cancel-original-lm2f-channel')
}
Run 11 'Unchanged delayed admission/preparation/postcancel-registration offline fence regressions' {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' --maxWorkers 4 `
    src/modules/ai/lib/deploymentQualificationFlightSafety.test.ts `
    src/modules/ai/lib/deploymentQualificationNativeSafety.test.ts `
    src/modules/ai/lib/proxyFetch.test.ts
  if($LASTEXITCODE -ne 0){throw 'Already-passing asynchronous fences regressed'}
}
Run 12 'Acceptance-hook safety and selector exclusion' {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' --maxWorkers 4 `
    src/modules/ai/lib/lm11AcceptanceBarrier.test.ts `
    src/modules/ai/lib/lm11SyntheticAcceptanceContract.test.ts `
    src/modules/ai/lib/lm11ProductionSelectorExclusion.offline.test.tsx
  if($LASTEXITCODE -ne 0){throw 'Acceptance hook regressions'}
}
Run 13 'B01 preservation subset; NOT full ten-stage 120-second matrix' {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' --maxWorkers 4 `
    src/modules/ai/lib/deploymentQualificationRuntime.test.ts `
    src/modules/ai/lib/deploymentQualificationNativeSafety.test.ts
  if($LASTEXITCODE -ne 0){throw 'Focused B01 suite regressed'}
}
Run 14 'Focused B01/B02/B03 native/renderer original-path safety' {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' --maxWorkers 4 `
    src/modules/ai/lib/managedLocalRouting.test.ts `
    src/modules/ai/lib/deploymentQualificationFlightSafety.test.ts `
    src/modules/ai/lib/deploymentQualificationRuntime.test.ts `
    src/modules/ai/lib/proxyFetch.test.ts `
    src/modules/settings/selfHostedQualificationCas.test.ts `
    src/modules/ai/lib/deploymentQualificationNativeSafety.test.ts
  if($LASTEXITCODE -ne 0){throw 'Focused B01/B02/B03 safety failed'}
}
Run 15 'Existing B03 persistence/atomic-store regressions' {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' --maxWorkers 4 `
    src/modules/settings/selfHostedPersistence.test.ts `
    src/modules/settings/selfHostedQualificationCas.test.ts `
    src/modules/settings/selfHostedAtomicSettingsBridge.test.ts
  if($LASTEXITCODE -ne 0){throw 'B03 authority regression failed'}
}
Run 16 'Real original positive synthetic qualification regression' {
  Case @('--scenario','normal')
}
Run 17 'Affected AI and settings TypeScript' {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' --maxWorkers 4 src/modules/ai src/modules/settings
  if($LASTEXITCODE -ne 0){throw 'Affected AI/settings test suite failed: retain exact failures'}
} $true
Run 18 'Feature-enabled Rust library: existing authority and native safety tests' {
  & cargo test --offline --locked --lib --manifest-path src-tauri/Cargo.toml --features lm11-authenticated-webview-acceptance --target-dir src-tauri/target/codex-checkpoint6
  if($LASTEXITCODE -ne 0){throw 'Feature Rust failed'}
}
Run 19 'Ordinary Rust library without acceptance feature' {
  & cargo test --offline --locked --lib --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target/codex-checkpoint6
  if($LASTEXITCODE -ne 0){throw 'Ordinary Rust failed'}
}
Run 20 'Wider TypeScript regression, known unrelated structured-memory fixtures not hidden' {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/**' --exclude 'scripts/**' --silent --maxWorkers 4
  if($LASTEXITCODE -ne 0){throw 'Wider repository tests returned nonzero; classify exact failures'}
} $true
Run 21 'TypeScript noEmit' {
  & node node_modules/typescript/bin/tsc --noEmit --pretty false
  if($LASTEXITCODE -ne 0){throw 'TypeScript noEmit failed'}
}
Run 22 'JS and PowerShell parser syntax' {
  foreach($js in @('scripts/lm11-authenticated-webview-acceptance.mjs',
      'scripts/lm11-final-defect-race-regressions.ps1',
      'scripts/lm11-full-matrix-cancel-contract.mjs')) {
    if($js -like '*.mjs') { & node --check $js; if($LASTEXITCODE -ne 0){throw 'JS syntax failed'} }
    else {
      $tokens=$null;$errors=$null
      [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $js).ProviderPath,[ref]$tokens,[ref]$errors)|Out-Null
      if(@($errors).Count -ne 0){throw 'PowerShell parser failed'}
    }
  }
  foreach($ps in @('scripts/lm11-production-state-inventory.ps1',
      'scripts/lm11-production-secret-fingerprint.ps1')) {
    $tokens=$null;$errors=$null
    [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $ps).ProviderPath,[ref]$tokens,[ref]$errors)|Out-Null
    if(@($errors).Count -ne 0){throw 'PowerShell parser failed'}
  }
  & node -e 'process.exit(0)'
}
Run 23 'Git diff whitespace check; no stage/commit/reset or cleanup' {
  & git diff --check
  if($LASTEXITCODE -ne 0){throw 'git diff --check failed'}
}
$summary=[ordered]@{
  schema=1;kind='LM11 Final B02/B03 Defect and Race Closure';
  t15Before=$before;postDeadlinePhysicalCase=$late;
  totalOrderedGroups=$results.Count;
  passed=@($results|Where-Object{$_.status -eq 'PASS'}).Count;
  knownUnrelatedFailures=@($results|Where-Object{$_.status -eq 'KNOWN-FAIL'}).Count;
  failed=@($results|Where-Object{$_.status -eq 'FAIL'}).Count;
  allGroupsExecuted=$results.Count -eq 23;
  results=@($results.ToArray());
  observedAtUtc=(Get-Date).ToUniversalTime().ToString('o')
}
$out=Join-Path $audit 'regression-results.json'
WriteOnce $out (($summary|ConvertTo-Json -Depth 12)+"`n")
Write-Output ('FINAL_GROUPS='+$summary.totalOrderedGroups+' PASS='+$summary.passed+
  ' KNOWN='+$summary.knownUnrelatedFailures+' FAIL='+$summary.failed)
Write-Output ('RESULT='+$out)
if($summary.failed -ne 0){exit 1}
