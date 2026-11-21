# ONE human-operated, bounded tracefs capability campaign, no production BPF.
# Exactly one interactive sudo session; <=48 disabled registrations, <=60 sec.
# Do not rerun automatically. The helper never changes tracing configuration.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$helper = Join-Path $repo 'scripts\local-muse-tracefs-capability-matrix.py'
$key = Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf) -or
    -not (Test-Path -LiteralPath $key -PathType Leaf)) {
    throw 'MATRIX_HELPER_OR_PINNED_KEY_UNAVAILABLE'
}
$nonce = [Guid]::NewGuid().ToString('N').Substring(0, 24)
$scope = 'muse-one-' + $nonce
$stage = '/home/hylab/.cache/clack-tracefs-matrix-' + $nonce
$hostName = 'hylab@192.168.1.44'
$common = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'ConnectTimeout=4', '-o', 'ConnectionAttempts=1',
            '-i', $key)
$stageOwned = $false
$campaignStatus = 1
$cleanupStatus = 1
try {
    & ssh.exe -T @common $hostName (
        '/usr/bin/test ! -e ' + $stage +
        ' && /usr/bin/mkdir -m 700 -- ' + $stage)
    if ($LASTEXITCODE -ne 0) { throw 'MATRIX_STAGE_CREATE_FAILED' }
    $stageOwned = $true
    & scp.exe -q @common $helper ($hostName + ':' + $stage + '/matrix.py')
    if ($LASTEXITCODE -ne 0) { throw 'MATRIX_STAGE_COPY_FAILED' }
    $localHash = (Get-FileHash -LiteralPath $helper -Algorithm SHA256).Hash.ToLowerInvariant()
    $remoteHashOutput = & ssh.exe -T @common $hostName (
        '/usr/bin/sha256sum -- ' + $stage + '/matrix.py')
    if ($LASTEXITCODE -ne 0) { throw 'MATRIX_STAGE_HASH_UNAVAILABLE' }
    $remoteHash = (($remoteHashOutput -split '[ ]+')[0]).ToLowerInvariant()
    if ($localHash -ne $remoteHash) { throw 'MATRIX_STAGE_HASH_MISMATCH' }
    Write-Output 'ONE tracefs capability campaign: 40 disabled registration cases; no BPF object creation.'
    Write-Output 'Enter the remote sudo password once, only at its interactive prompt.'
    & ssh.exe -tt @common $hostName (
        '/usr/bin/sudo /usr/bin/timeout --signal=TERM --kill-after=2s 60s ' +
        '/usr/bin/python3 -B ' + $stage +
        '/matrix.py --campaign ' + $scope)
    $campaignStatus = $LASTEXITCODE
    Write-Output ('TRACEFS_MATRIX_OPERATOR_EXIT=' + $campaignStatus)
}
finally {
    if ($stageOwned) {
        & ssh.exe -T @common $hostName (
            '/usr/bin/rm -f -- ' + $stage + '/matrix.py' +
            ' && /usr/bin/rmdir -- ' + $stage +
            ' && /usr/bin/test ! -e ' + $stage)
        $cleanupStatus = $LASTEXITCODE
        Write-Output ('TRACEFS_STAGE_CLEANUP=' +
            $(if ($cleanupStatus -eq 0) { 'PASS' } else { 'FAIL' }))
    }
}
if ($campaignStatus -ne 0) {
    throw 'TRACEFS_CAPABILITY_MATRIX_NOT_QUALIFIED_NO_AUTO_RETRY'
}
if ($cleanupStatus -ne 0) {
    throw 'MATRIX_STAGE_CLEANUP_FAILED'
}
