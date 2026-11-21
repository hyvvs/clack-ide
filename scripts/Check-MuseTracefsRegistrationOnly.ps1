# ONE interactive, bounded registration-only root capability check.
# Does not start bpftrace, create BPF programs/links or change sysctls.
# Copies the reviewed helper into a fresh user-owned staging directory;
# sudo runs only --registration-only and removes four tracefs probes itself.
$ErrorActionPreference = 'Stop'
$base = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $base 'scripts\local-muse-tracefs-attestor.py'
$key = Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
if (-not (Test-Path -LiteralPath $source -PathType Leaf) -or
    -not (Test-Path -LiteralPath $key -PathType Leaf)) {
    throw 'Pinned helper or SSH key not available'
}
$nonce = [Guid]::NewGuid().ToString('N').Substring(0, 24)
$scope = 'muse-one-' + $nonce
$stage = '/home/hylab/.cache/clack-tracefs-register-' + $nonce
$hostName = 'hylab@192.168.1.44'
$common = @('-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes',
            '-o', 'ConnectTimeout=4',
            '-o', 'ConnectionAttempts=1',
            '-i', $key)
$stageOwned = $false
try {
    & ssh.exe -T @common $hostName (('/usr/bin/test ! -e {0} && /usr/bin/mkdir -m 700 -- {0}' -f $stage))
    if ($LASTEXITCODE -ne 0) { throw 'REGISTRATION_STAGE_CREATE_FAILED' }
    $stageOwned = $true
    & scp.exe -q @common -o 'BatchMode=yes' $source ($hostName + ':' + $stage + '/attestor.py')
    if ($LASTEXITCODE -ne 0) { throw 'REGISTRATION_HELPER_STAGE_FAILED' }
    $localSha = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    $remoteHashOutput = & ssh.exe -T @common $hostName ('/usr/bin/sha256sum -- ' + $stage + '/attestor.py')
    if ($LASTEXITCODE -ne 0) { throw 'REGISTRATION_HELPER_DIGEST_UNAVAILABLE' }
    $remoteSha = ($remoteHashOutput -split '[ ]+')[0].ToLowerInvariant()
    if ($localSha -ne $remoteSha) { throw 'REGISTRATION_HELPER_DIGEST_MISMATCH' }

    Write-Output 'One registration-only tracefs check on pinned host; no BPF session.'
    Write-Output 'Type the sudo password only at the interactive remote prompt.'
    # Deliberately no -n: sudo may require the human operator's password.
    & ssh.exe -tt @common $hostName ('/usr/bin/sudo /usr/bin/python3 -B ' +
        $stage + '/attestor.py --registration-only --scope ' + $scope)
    $operatorExit = $LASTEXITCODE
    if ($operatorExit -ne 0) {
        throw 'TRACEFS_REGISTRATION_NOT_QUALIFIED'
    }
    Write-Output 'REGISTRATION_ONLY_OPERATOR=PASS'
}
finally {
    if ($stageOwned) {
        & ssh.exe -T @common $hostName (
            '/usr/bin/rm -f -- ' + $stage + '/attestor.py && /usr/bin/rmdir -- ' + $stage)
        if ($LASTEXITCODE -ne 0) {
            Write-Error 'REGISTRATION_STAGE_CLEANUP_FAILED'
        }
    }
}
