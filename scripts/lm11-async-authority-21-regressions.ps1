param([Parameter(Mandatory=$true)][string]$AuditDir,
      [Parameter(Mandatory=$true)][string]$T15BeforePath)

# New LM11 B02/B03 asynchronous and persistence authority cohort. Never
# modifies earlier indexed cases, Git, the native registry or production data.
# An unproved physical group is a FAIL, not an inferred acceptance success.
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath
$root=(Resolve-Path (Join-Path $repo 'src-tauri/target/lm11-b01-b03-authenticated-webview-20261119/cases')).ProviderPath
$dir=(Resolve-Path -LiteralPath $AuditDir).ProviderPath
$before=(Resolve-Path -LiteralPath $T15BeforePath).ProviderPath
if((Split-Path -Leaf $before) -ne 'production-before.json' -or
  (Split-Path -Parent (Split-Path -Parent $before)) -ine $root -or
  (Split-Path -Leaf (Split-Path -Parent $before)) -notmatch '^fidelity-audit-[0-9]{17}-[a-f0-9]{12}$') {
  throw 'Exact new attributable production BEFORE audit required'
}
$env:CLACK_LM11_T01_BEFORE_PATH=$before
if ((Split-Path -Parent $dir) -ine $root -or
    (Split-Path -Leaf $dir) -notmatch '^async-authority-audit-[0-9]{17}-[a-f0-9]{12}$' -or
    ((Get-Item -LiteralPath $dir).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Exact new canonical asynchronous authority audit directory required'
}
if (Test-Path -LiteralPath (Join-Path $dir 'regression-results.json')) {
  throw 'Refusing to overwrite ordered regression audit'
}
$rows=New-Object System.Collections.ArrayList
function WriteOnce([string]$path,[string]$value) {
  $bytes=[Text.Encoding]::UTF8.GetBytes($value)
  $f=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$f.Write($bytes,0,$bytes.Length);$f.Flush($true)} finally {$f.Dispose()}
}
function Run([int]$number,[string]$name,[scriptblock]$body) {
  $file=Join-Path $dir ('regression-{0:D2}.log' -f $number)
  WriteOnce $file ("GROUP=$number/21 NAME=$name`nSTART=$((Get-Date).ToUniversalTime().ToString('o'))`n")
  $start=(Get-Date).ToUniversalTime().ToString('o')
  $errorCode=0
  $prev=$ErrorActionPreference
  try {
    $ErrorActionPreference='Continue'
    & $body *>> $file
    $errorCode=$LASTEXITCODE
    if ($null -eq $errorCode) {$errorCode=0}
  } catch {
    $errorCode=1
    Add-Content -LiteralPath $file -Value ('HARNESS FAILURE: '+$_.Exception.GetType().Name+': '+$_.Exception.Message)
  } finally {$ErrorActionPreference=$prev}
  $status=if($errorCode -eq 0){'PASS'}else{'FAIL'}
  [void]$rows.Add([ordered]@{ordinal=$number;name=$name;status=$status;exitCode=[int]$errorCode;
    log=('regression-{0:D2}.log' -f $number);startedAtUtc=$start;
    finishedAtUtc=(Get-Date).ToUniversalTime().ToString('o');
    passingGroupDoesNotUpgradeMissingPhysicalCases=$true})
  Write-Output "GROUP=$number STATUS=$status EXIT=$errorCode NAME=$name"
}
function Physical([string[]]$arguments) {
  & node scripts/lm11-authenticated-webview-acceptance.mjs --no-build @arguments
  if ($LASTEXITCODE -ne 0) {throw ('Physical case failed: '+($arguments -join ' '))}
}
function Vitest([string[]]$files) {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' @files
  if ($LASTEXITCODE -ne 0) {throw ('Focused Vitest returned '+$LASTEXITCODE)}
}

# The user-prescribed physical dependency order is deliberate.
Run 1 'Fresh T13 original late Channel' {Physical @('--scenario','post-cancel-original-lm2f-channel')}
Run 2 'Actual native-admission response after terminal cancellation' {
  Physical @('--scenario','stage-cancel','--barrier-stage','native-admission-response','--cancel-settle-before-release')
}
Run 3 'Actual preparation promise settles after terminal cancellation' {
  Physical @('--scenario','stage-cancel','--barrier-stage','prepare-chat-promise-settlement','--cancel-settle-before-release')
}
Run 4 'Actual native open registration returned after cancellation' {
  Physical @('--scenario','stage-cancel','--barrier-stage','native-open-response','--cancel-settle-before-release')
}
Run 5 'Remaining eleven original late and race callbacks' {
  Physical @('--scenario','post-cancel-original-lm2f-channel')
  Physical @('--scenario','stale-original-qualification-child-restart')
  Physical @('--scenario','post-terminal-channel-callback')
  # This is only a bounded subset; seven independently owned callback
  # orderings still lack original-path physical observation. Do not pass.
  throw 'BLOCKED: complete set of eleven independently observable original owner races unproved'
}
Run 6 'Original B03 old runtime epoch A to B prepare and ACK' {
  Physical @('--scenario','stage-stale-epoch','--barrier-stage','b03-native-prepare')
  Physical @('--scenario','stage-stale-epoch','--barrier-stage','b03-before-acknowledge')
}
Run 7 'Original B03 five corrupt/recovery-required conditions' {
  $failures=@()
  foreach($mode in @('malformed-main','inconsistent-marker','missing-insufficient','corrupt-recovery','restart-ambiguity')) {
    try {Physical @('--scenario','stage-corrupt','--barrier-stage','b03-before-acknowledge','--corruption-mode',$mode)}
    catch {$failures+=@($mode);Write-Output ('PHYSICAL_CORRUPTION_NOT_ACCEPTED='+$mode)}
  }
  if($failures.Count){throw ('Persisted corruption survival unproved in '+($failures -join ','))}
}
Run 8 'Contention and concurrent A B C isolation' {
  Physical @('--scenario','stage-concurrent','--barrier-stage','preparation-complete')
  throw 'BLOCKED: concurrent A/B/C original-path cross-deployment cancellation and corruption isolation unproved'
}
Run 9 'Original lifecycle negative and recovery semantics' {
  $failures=@()
  Physical @('--scenario','original-runtime-fault','--runtime-scenario','authenticated-model-identity-failure')
  try {Physical @('--scenario','original-runtime-fault','--runtime-scenario','request-admission-failure')}
  catch {$failures+=@('request-admission-failure')}
  Physical @('--scenario','original-runtime-fault','--runtime-scenario','connection-close-without-terminal')
  if($failures.Count){throw ('Negative cases failed '+($failures -join ','))}
  throw 'BLOCKED: independent original caller post-settlement late native cancellation ACK not proven'
}
Run 10 'Feature-only hook safety and production selector exclusion' {
  Vitest @('src/modules/ai/lib/lm11AcceptanceBarrier.test.ts',
    'src/modules/ai/lib/lm11SyntheticAcceptanceContract.test.ts',
    'src/modules/ai/lib/lm11ProductionSelectorExclusion.offline.test.tsx')
}
Run 11 'Focused B01 preservation without ten 120s tests' {
  Vitest @('src/modules/ai/lib/deploymentQualificationRuntime.test.ts',
    'src/modules/ai/lib/deploymentQualificationNativeSafety.test.ts')
}
Run 12 'Focused B01/B02/B03 original path safety' {
  Vitest @('src/modules/ai/lib/managedLocalRouting.test.ts',
    'src/modules/ai/lib/managedLocalAcceptance.test.ts',
    'src/modules/ai/lib/deploymentQualificationFlightSafety.test.ts',
    'src/modules/ai/lib/deploymentQualificationRuntime.test.ts',
    'src/modules/ai/lib/proxyFetch.test.ts',
    'src/modules/settings/selfHostedQualificationCas.test.ts',
    'src/test/acceptanceComparison.test.ts',
    'src/modules/ai/lib/deploymentQualificationNativeSafety.test.ts')
}
Run 13 'B03 persistence regressions' {
  Vitest @('src/modules/settings/selfHostedPersistence.test.ts',
    'src/modules/settings/selfHostedQualificationCas.test.ts',
    'src/modules/settings/selfHostedAtomicSettingsBridge.test.ts')
}
Run 14 'Positive genuine original synthetic qualification' {Physical @('--scenario','normal')}
Run 15 'Affected AI/settings TypeScript' {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' src/modules/ai src/modules/settings
  if($LASTEXITCODE -ne 0){throw 'Affected AI/settings suite has failures: raw signature preserved'}
}
Run 16 'Feature-enabled Rust offline library' {
  & cargo test --offline --locked --lib --manifest-path src-tauri/Cargo.toml --features lm11-authenticated-webview-acceptance --target-dir src-tauri/target/codex-checkpoint6
  if($LASTEXITCODE -ne 0){throw 'Feature Rust failure'}
}
Run 17 'Ordinary Rust offline library' {
  & cargo test --offline --locked --lib --manifest-path src-tauri/Cargo.toml --target-dir src-tauri/target/codex-checkpoint6
  if($LASTEXITCODE -ne 0){throw 'Ordinary Rust failure'}
}
Run 18 'Wider TypeScript raw failures preserved' {
  & node node_modules/vitest/vitest.mjs run --exclude 'src-tauri/target/**' --exclude 'scripts/**' --maxWorkers 4
  if($LASTEXITCODE -ne 0){throw 'Wider TypeScript has raw failures; do not reclassify'}
}
Run 19 'tsc --noEmit' {
  & node node_modules/typescript/bin/tsc --noEmit --pretty false
  if($LASTEXITCODE -ne 0){throw 'TypeScript compile failure'}
}
Run 20 'New and affected JS/PowerShell syntax' {
  foreach($js in @('scripts/lm11-authenticated-webview-acceptance.mjs',
    'scripts/lm11-async-authority-21-regressions.ps1',
    'scripts/lm11-b02-b03-closure-index.mjs')) {
    if($js.EndsWith('.mjs')) {
      & node --check $js
      if($LASTEXITCODE -ne 0){throw ('JS syntax error '+$js)}
    } else {
      $tokens=$null;$errors=$null
      [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $js).ProviderPath,[ref]$tokens,[ref]$errors)|Out-Null
      if(@($errors).Count){throw ('PowerShell syntax error '+$js)}
    }
  }
}
Run 21 'Git diff --check' {
  & git diff --check
  if($LASTEXITCODE -ne 0){throw 'Git whitespace failure'}
}
$result=[ordered]@{schema=1;kind='LM11 B02/B03 Asynchronous + Persistence Authority Closure';
  exactlyTwentyOneOrderedGroups=($rows.Count -eq 21);
  unprovenPhysicalGroupsNeverUpgraded=$true;
  groups=@($rows.ToArray());observedAtUtc=(Get-Date).ToUniversalTime().ToString('o')}
WriteOnce (Join-Path $dir 'regression-results.json') (($result|ConvertTo-Json -Depth 10)+"`n")
Write-Output ('ORDERED_21_COMPLETE='+($rows.Count -eq 21))
Write-Output ('GROUP_FAILURES='+@($rows|Where-Object {$_.status -eq 'FAIL'}).Count)
if(@($rows|Where-Object {$_.status -eq 'FAIL'}).Count){exit 1}
