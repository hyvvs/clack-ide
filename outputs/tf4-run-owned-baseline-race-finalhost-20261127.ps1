# Fixed DEBUG-only baseline-capture race: one first-observation mutation and second fresh observation. The native
# COM test changes and restores an inert head attribute during capture;
# WebView2 page JS remains OFF, and the test dispatches no click.
# Rust source-only fixture; NEVER human consent.
param(
    [ValidateSet('baseline-capture')]
    [string]$MutationKind='baseline-capture',
    [ValidatePattern('^[A-Za-z0-9_-]{0,16}$')]
    [string]$TrialId='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture=(Resolve-Path (Join-Path $repo 'scripts/Run-Tf4OwnedHttpsFixture.ps1')).Path
$hostExe=(Resolve-Path (Join-Path $repo 'src-tauri/target/debug/clack-browser-host.exe')).Path
$manifest=Join-Path $repo 'src-tauri'
$folder=Join-Path $PSScriptRoot ('tf4-owned-baseline-race-finalhost-'+$MutationKind+'-20261127'+$(if($TrialId){'-'+$TrialId}else{''}))
$marker=Join-Path $manifest 'target/tf4-owned-https/active.run'
$cert=Join-Path $manifest 'target/tf4-owned-https/server.cer'
if((Test-Path $folder) -or (Test-Path $marker) -or (Test-Path $cert)) {
    throw 'Refusing to collide with existing mutation evidence or active HTTPS fixture'
}
if((Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 443 -State Listen -ErrorAction SilentlyContinue)) {
    throw 'Port 443 already in use; do not overtake unrelated listener'
}
New-Item -ItemType Directory -Path $folder -ErrorAction Stop|Out-Null
$sha=(Get-FileHash -LiteralPath $hostExe -Algorithm SHA256).Hash.ToLowerInvariant()
if($sha -cne '31ae2790eeca2f5272e7f176798a9ba0ead4b4a9c0af3317a192fb123801e0d0'){
    throw 'The corrected debug host changed; this run requires a new source-pinned fixture script'
}
$serverOut=Join-Path $folder 'fixture.stdout.log';$serverErr=Join-Path $folder 'fixture.stderr.log'
$testOut=Join-Path $folder 'test.stdout.log';$testErr=Join-Path $folder 'test.stderr.log'
$server=$null;$runId=$null;$testExit=$null;$cleanup='NOT_ATTEMPTED';$failure=$null
try{
    $args=@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$fixture+'"'),'-Action','Serve','-MinimalClickDocument','-MaxDurationSeconds','180','-MaxRequests','20')
    $server=Start-Process -FilePath powershell.exe -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr
    $deadline=[DateTime]::UtcNow.AddSeconds(22)
    while(-not(Test-Path $marker) -and [DateTime]::UtcNow -lt $deadline){
        if($server.HasExited){throw 'Fixture process exited before live active marker'}
        Start-Sleep -Milliseconds 180
    }
    if(-not(Test-Path $marker) -or -not(Test-Path $cert)){throw 'Fixture certificate or marker not published'}
    $runId=(Get-Content $marker -Raw).Trim()
    if($runId -cnotmatch '^[a-f0-9]{32}$'){throw 'Invalid fixture identity'}
    $env:CLACK_TF4_OWNED_BASELINE_CAPTURE_RACE='1'
    Remove-Item Env:CLACK_TF4_OWNED_NATIVE_DENY_SUCCESSOR -ErrorAction SilentlyContinue
    $env:CLACK_TF4_NATIVE_PROBE_HOST=$hostExe
    $env:CLACK_TF4_OWNED_HTTPS_CERT=$cert
    $cmdArgs=@('test','--locked','--features','tf-browser-native-runtime','--lib','physical_production_owned_https_baseline_capture_race','--','--ignored','--nocapture')
    $original=(Get-Location).Path
    Set-Location $manifest
    try{
        # On this Windows host, Start-Process/WaitForExit() without -Wait
        # does not populate the cargo.exe ExitCode (null) despite clean exit.
        # -Wait -PassThru does populate the authoritative OS exit status.
        $cargo=Start-Process -FilePath cargo.exe -ArgumentList $cmdArgs -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput $testOut -RedirectStandardError $testErr
        $testExit=$cargo.ExitCode
    }finally{Set-Location $original}
    if($testExit -ne 0){throw "Physical test failed exit=$testExit"}
}catch{
    $failure=$_.Exception.Message
}finally{
    Remove-Item Env:CLACK_TF4_OWNED_BASELINE_CAPTURE_RACE,Env:CLACK_TF4_NATIVE_PROBE_HOST,Env:CLACK_TF4_OWNED_HTTPS_CERT -ErrorAction SilentlyContinue
    if($runId){
        try{
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $fixture -Action Stop -RunId $runId|Out-Null
            $deadline=[DateTime]::UtcNow.AddSeconds(12)
            while((Test-Path $marker) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 150}
            if((Test-Path $marker) -or (Test-Path $cert) -or
                (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 443 -State Listen -ErrorAction SilentlyContinue)) {
                throw 'Fixture cleanup not independently observed'
            }
            $cleanup='CLEAN_CERT_MARKER_LISTENER_ABSENT'
        }catch{$cleanup='CLEANUP_UNVERIFIED: '+$_.Exception.Message}
    }
    $summary=@{classification='SOURCE_ONLY_REAL_WEBVIEW2_TEST_PARENT_NOT_HUMAN';kind=$MutationKind;runId=$runId;hostSha256=$sha;testExitCode=$testExit;fixtureCleanup=$cleanup;failure=$failure;observedAt=(Get-Date -Format o);testStdout='test.stdout.log';testStderr='test.stderr.log';serverStdout='fixture.stdout.log';serverStderr='fixture.stderr.log'}
    $json=$summary|ConvertTo-Json -Depth 4
    $file=Join-Path $folder 'result.json'
    [IO.File]::WriteAllText($file,$json,[Text.UTF8Encoding]::new($false))
    Write-Output ('TF4_BASELINE_RACE='+$MutationKind+' RUN='+$runId+' TEST_EXIT='+$testExit+' CLEANUP='+$cleanup+' FAILURE='+$failure)
    Write-Output ('RECEIPT='+$file)
}
if($testExit -ne 0 -or $cleanup -cne 'CLEAN_CERT_MARKER_LISTENER_ABSENT') {exit 1}
