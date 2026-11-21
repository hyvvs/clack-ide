# Internal, non-privileged Windows bootstrap process runner.
# Production entry point supplies no mocks. Tests inject a runner ONLY into
# Invoke-OneMuseBootstrap; the remote installer still hashes every root asset.
Set-StrictMode -Version Latest

$script:FixedRemote = 'hylab@192.168.1.44'
$script:FixedFiles = [ordered]@{
  'one-muse-narrow-root.py' = '551de3b1b2895b06f5bafd19b569fb41ab2170990bbb74a39d41014532ab223b'
  'one-muse-narrow-sudoers' = '5c009fffbfe7c2ebb5cf720a0cd31e44f46559477af0f1b5c0b6f7646e096268'
  'local-muse-one-root.sh' = '69ad979c5f5cd73cdc3ba5e4e29bafea4dbd278055e27dc6028b2d36fd682137'
  'local-muse-one-ebpf.py' = 'eed450245218a9cbf02bacdbe4d08c5dc071636e5ca61904aac5f7a4e72c24df'
  'local-muse-tcp-session.py' = 'd22c0994402744a6a978d4a8d53b140d9d6c0780a316e54f9d8c7c7c85e014cf'
  'local-muse-tcp.bt' = 'e21b5348e78820b432cdaec9dbf30ffaf4b68a22034f54f960d9d9d152d649f0'
}
$script:InstallerHash = '3be5aa5ec224ea7df7f7f131701e9eb1ec756c3db8f808971782e8e2d43e2747'
$script:StagePattern = '^/home/hylab/\.cache/clack-muse-narrow-install\.[A-Za-z0-9]{8}$'

function Write-OneMuseStage([string]$Message) {
  [Console]::Out.WriteLine($Message)
  [Console]::Out.Flush()
}

function Stop-OneMuseOwnedProcess([System.Diagnostics.Process]$Process) {
  if ($null -eq $Process -or $Process.HasExited) { return }
  # Windows PowerShell 5.1 has no Process.Kill(entireProcessTree). The native
  # taskkill /T termination covers ssh.exe and its task-owned child tree.
  $killer = Join-Path $env:SystemRoot 'System32\taskkill.exe'
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $killer
    $psi.Arguments = '/F /T /PID ' + $Process.Id
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $task = [System.Diagnostics.Process]::Start($psi)
    try { if (-not $task.WaitForExit(3000)) { $task.Kill() } }
    finally { $task.Dispose() }
  } catch { }
  if (-not $Process.HasExited) {
    try { $Process.Kill() } catch { }
  }
  try { [void]$Process.WaitForExit(2000) } catch { }
}

function ConvertTo-OneMuseWindowsArgument([string]$Value) {
  # CRT quoting, preserving an SSH remote shell command as ONE argv item.
  $buf = New-Object System.Text.StringBuilder
  [void]$buf.Append('"')
  $slashes = 0
  foreach ($char in $Value.ToCharArray()) {
    if ($char -eq [char]92) { $slashes++; continue }
    if ($char -eq [char]34) {
      [void]$buf.Append(('\' * (2 * $slashes + 1)))
    } else {
      [void]$buf.Append(('\' * $slashes))
    }
    $slashes = 0
    [void]$buf.Append($char)
  }
  [void]$buf.Append(('\' * (2 * $slashes)))
  [void]$buf.Append('"')
  return $buf.ToString()
}

function Invoke-OneMuseNativeChild {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][ValidateSet('ssh','scp')][string]$Tool,
    [Parameter(Mandatory=$true)][string[]]$Arguments,
    [Parameter(Mandatory=$true)][string]$Stage,
    [Parameter(Mandatory=$true)][ValidateRange(1,180)][int]$DeadlineSeconds,
    [switch]$Interactive
  )
  if ($Interactive -and ($Tool -ne 'ssh' -or
      -not [Environment]::UserInteractive)) {
    throw "BOOTSTRAP_FAILED_STAGE=$Stage REASON=interactive_desktop_required"
  }
  $binary = Join-Path $env:SystemRoot ('System32\OpenSSH\' + $Tool + '.exe')
  if (-not [IO.File]::Exists($binary)) {
    throw "BOOTSTRAP_FAILED_STAGE=$Stage REASON=openssh_executable_missing"
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $binary
  $psi.Arguments = (($Arguments | ForEach-Object {ConvertTo-OneMuseWindowsArgument $_}) -join ' ')
  # On Windows, inheriting three unredirected standard handles with
  # UseShellExecute=false does NOT prove SSH receives console keyboard input:
  # an actual -tt remote cat received no operator-supplied test marker. For
  # the ONE genuine sudo bootstrap only, ShellExecute opens a separate native
  # visible console with its OWN keyboard and SSH PTY. Never try to read
  # passwords from the caller's PowerShell console or from a pipe.
  $psi.UseShellExecute = [bool]$Interactive
  $psi.CreateNoWindow = -not $Interactive
  if ($Interactive) { $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal }
  $psi.RedirectStandardInput = -not $Interactive
  $psi.RedirectStandardOutput = -not $Interactive
  $psi.RedirectStandardError = -not $Interactive
  $child = New-Object System.Diagnostics.Process
  $child.StartInfo = $psi
  try {
    if (-not $child.Start()) { throw 'process_start_returned_false' }
    $stdoutTask = $null
    $stderrTask = $null
    if (-not $Interactive) {
      $child.StandardInput.Close()
      $stdoutTask = $child.StandardOutput.ReadToEndAsync()
      $stderrTask = $child.StandardError.ReadToEndAsync()
    }
    $deadline = [DateTime]::UtcNow.AddSeconds($DeadlineSeconds)
    $nextProgress = [DateTime]::UtcNow.AddSeconds(12)
    while (-not $child.WaitForExit(200)) {
      if ($Interactive -and [DateTime]::UtcNow -ge $nextProgress) {
        Write-OneMuseStage "[4/6] waiting for dedicated SSH window; authentication/installation still bounded"
        $nextProgress = [DateTime]::UtcNow.AddSeconds(12)
      }
      if ([DateTime]::UtcNow -ge $deadline) {
        Stop-OneMuseOwnedProcess $child
        throw "BOOTSTRAP_FAILED_STAGE=$Stage REASON=timeout"
      }
    }
    $stdout = ''
    $stderr = ''
    if (-not $Interactive) {
      if (-not $stdoutTask.Wait(3000) -or -not $stderrTask.Wait(3000)) {
        throw "BOOTSTRAP_FAILED_STAGE=$Stage REASON=output_drain_timeout"
      }
      $stdout = [string]$stdoutTask.Result
      $stderr = [string]$stderrTask.Result
      if ($stdout.Length -gt 8192 -or $stderr.Length -gt 8192) {
        throw "BOOTSTRAP_FAILED_STAGE=$Stage REASON=unexpected_output_size"
      }
    }
    return [pscustomobject]@{ ExitCode = [int]$child.ExitCode; Stdout = $stdout; Stderr = $stderr }
  } catch {
    Stop-OneMuseOwnedProcess $child
    if ($_.Exception.Message -match '^BOOTSTRAP_FAILED_STAGE=') { throw }
    throw "BOOTSTRAP_FAILED_STAGE=$Stage REASON=process_error"
  } finally { $child.Dispose() }
}

function Get-OneMuseSha256([byte[]]$Bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function New-OneMuseRemoteOptions([string]$Key) {
  return @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
    '-o','NumberOfPasswordPrompts=0', '-o','ConnectTimeout=5',
    '-o','ConnectionAttempts=1','-o','ServerAliveInterval=5',
    '-o','ServerAliveCountMax=2','-i',$Key)
}

function Confirm-OneMuseChildResult($Result,[string]$Stage,[string]$Context) {
  if ($Result.ExitCode -eq 0) { return }
  $reason = 'remote_command_failed'
  if ($Result.ExitCode -eq 255 -and $Result.Stderr -match
      'Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|host key is not cached|Host key mismatch') {
    $reason = 'ssh_host_key_failure'
  } elseif ($Result.ExitCode -eq 255) { $reason = 'ssh_unreachable_or_authentication_failed' }
  elseif ($Context -eq 'bootstrap') {
    if ($Result.ExitCode -eq 72) { $reason = 'remote_installer_failure'; $Stage = '5' }
    elseif ($Result.ExitCode -eq 73) { $reason = 'sudoers_validation_failed'; $Stage = '5' }
    elseif ($Result.ExitCode -eq 74) { $reason = 'sudo_authentication_timeout' }
    elseif ($Result.ExitCode -eq 75) { $reason = 'remote_installer_timeout'; $Stage = '5' }
    elseif ($Result.ExitCode -eq 1) { $reason = 'sudo_authentication_failed' }
    else { $reason = 'sudo_or_remote_bootstrap_failure' }
  } elseif ($Context -eq 'sudoers') { $reason = 'sudoers_validation_failed' }
  elseif ($Context -eq 'self-check') { $reason = 'narrow_sudo_self_check_failed' }
  throw "BOOTSTRAP_FAILED_STAGE=$Stage REASON=$reason EXIT=$($Result.ExitCode)"
}

function Invoke-OneMuseBootstrap {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$ScriptsRoot,
    [Parameter(Mandatory=$true)][string]$Key,
    [scriptblock]$RunCommand = ${function:Invoke-OneMuseNativeChild},
    [scriptblock]$Report = ${function:Write-OneMuseStage},
    [switch]$SyntheticNoConsole
  )
  $stage = $null
  $installed = $false
  $localFiles = $script:FixedFiles
  $options = New-OneMuseRemoteOptions $Key
  $invoke = {
    param($tool,$argv,$phase,$limit,$interactive)
    & $RunCommand -Tool $tool -Arguments $argv -Stage $phase -DeadlineSeconds $limit -Interactive:$interactive
  }
  try {
    & $Report '[1/6] validating local files'
    if (-not [IO.File]::Exists($Key)) { throw 'BOOTSTRAP_FAILED_STAGE=1 REASON=pinned_ssh_key_missing' }
    $bootstrap = Join-Path $ScriptsRoot 'install-one-muse-narrow-root.sh'
    if (-not [IO.File]::Exists($bootstrap)) { throw 'BOOTSTRAP_FAILED_STAGE=1 REASON=bootstrap_source_missing' }
    $installerBytes = [IO.File]::ReadAllBytes($bootstrap)
    if ((Get-OneMuseSha256 $installerBytes) -cne $script:InstallerHash) {
      throw 'BOOTSTRAP_FAILED_STAGE=1 REASON=installer_hash_mismatch'
    }
    foreach($name in $localFiles.Keys) {
      $source = Join-Path $ScriptsRoot $name
      if (-not [IO.File]::Exists($source)) { throw 'BOOTSTRAP_FAILED_STAGE=1 REASON=source_missing' }
      if ((Get-OneMuseSha256 ([IO.File]::ReadAllBytes($source))) -cne $localFiles[$name]) {
        throw 'BOOTSTRAP_FAILED_STAGE=1 REASON=source_hash_mismatch'
      }
    }
    $encoded = [Convert]::ToBase64String($installerBytes)
    if ($encoded.Length -gt 20000) { throw 'BOOTSTRAP_FAILED_STAGE=1 REASON=installer_outside_bound' }
    if (-not $SyntheticNoConsole -and
        ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or [Console]::IsErrorRedirected)) {
      throw 'BOOTSTRAP_FAILED_STAGE=1 REASON=visible_terminal_required'
    }
    & $Report '[2/6] checking SSH connectivity'
    $result = & $invoke ssh ($options + @('-T',$script:FixedRemote,'/usr/bin/true')) '2' 12 $false
    Confirm-OneMuseChildResult $result '2' 'ssh'
    & $Report '[3/6] staging pinned installer'
    $created = & $invoke ssh ($options + @('-T',$script:FixedRemote,
      '/usr/bin/mktemp -d -p /home/hylab/.cache clack-muse-narrow-install.XXXXXXXX')) '3' 12 $false
    Confirm-OneMuseChildResult $created '3' 'stage'
    $stage = $created.Stdout.Trim()
    if ($stage -cnotmatch $script:StagePattern) {
      throw 'BOOTSTRAP_FAILED_STAGE=3 REASON=invalid_remote_stage_path'
    }
    foreach($name in $localFiles.Keys) {
      & $Report ('[3/6] staging pinned installer: ' + $name)
      $copy = & $invoke scp ($options + @('--',(Join-Path $ScriptsRoot $name),
        ($script:FixedRemote + ':' + $stage + '/' + $name))) '3' 25 $false
      Confirm-OneMuseChildResult $copy '3' 'transfer'
      $chmod = & $invoke ssh ($options + @('-T',$script:FixedRemote,
        ('/usr/bin/chmod 0600 -- ' + $stage + '/' + $name))) '3' 12 $false
      Confirm-OneMuseChildResult $chmod '3' 'chmod'
    }
    & $Report '[4/6] opening a NEW visible SSH console for the genuine sudo prompt'
    & $Report '[4/6] type the password ONLY in the separate SSH console window, not here'
    # ssh -tt allocates a remote PTY; Windows ShellExecute gives ssh.exe its
    # OWN visible local terminal, independent of the calling PowerShell handles.
    # The first sudo reads its password directly from its remote /dev/tty.
    # The next sudo -n is in the SAME remote TTY/parent session, so no second
    # authentication challenge or password pipe can occur. Both phases have
    # independent server-side deadlines and distinct failure codes.
    $control = @'
set -Eeuo pipefail
set +e
# GNU timeout normally starts sudo in a separate process group. With a
# foreground SSH PTY, sudo's /dev/tty read then gets SIGTTIN and STOPs.
# --foreground is REQUIRED for this one genuine interactive sudo step.
/usr/bin/timeout --foreground --signal=TERM --kill-after=2s 90s /usr/bin/sudo -v
status=$?
set -e
if ((status == 124 || status == 137)); then exit 74; fi
if ((status != 0)); then exit 1; fi
printf '[5/6] installing narrow wrapper and sudoers policy\n'
set +e
printf %s __INSTALLER__ | /usr/bin/base64 -d | /usr/bin/timeout --signal=TERM --kill-after=2s 60s /usr/bin/sudo -n /usr/bin/bash -s -- __STAGE__
status=$?
set -e
if ((status == 124 || status == 137)); then exit 75; fi
exit "$status"
'@
    $control = $control.Replace('__INSTALLER__',$encoded).Replace('__STAGE__',$stage)
    # A Windows PowerShell .psm1 may be stored with CRLF; the decoded control
    # is executed by Linux bash and must have LF-only line terminators.
    $control = $control.Replace("`r`n", "`n")
    $encodedControl = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($control))
    if ($encodedControl.Length -gt 22000) {
      throw 'BOOTSTRAP_FAILED_STAGE=4 REASON=bounded_remote_control_exceeded'
    }
    $remoteBootstrap = "/usr/bin/bash -lc 'printf %s $encodedControl | /usr/bin/base64 -d | /usr/bin/bash -s'"
    $root = & $invoke ssh ($options + @('-tt',$script:FixedRemote,$remoteBootstrap)) '4' 160 $true
    Confirm-OneMuseChildResult $root '4' 'bootstrap'
    & $Report '[5/6] narrow root installation finished; verifying installed policy'
    & $Report '[6/6] validating sudo -n self-check'
    $checked = & $invoke ssh ($options + @('-T',$script:FixedRemote,
      '/usr/bin/sudo -n /usr/local/libexec/clack-one-muse-root --self-check')) '6' 12 $false
    Confirm-OneMuseChildResult $checked '6' 'self-check'
    if ($checked.Stdout.Trim() -cne 'CLACK_NARROW_SUDO_SELF_CHECK=PASS') {
      throw 'BOOTSTRAP_FAILED_STAGE=6 REASON=narrow_sudo_self_check_wrong_receipt'
    }
    $installed = $true
    & $Report 'CLACK_NARROW_SUDO_INSTALL=PASS'
    return $true
  } finally {
    if ($stage -and $stage -cmatch $script:StagePattern) {
      # Independently bounded cleanup, only exact six owned files and stage.
      # Never recursively remove anything and never mask a primary failure.
      $cleanupBody = @'
set -Eeuo pipefail
stage='__STAGE__'
test -d "$stage" && test ! -L "$stage"
test "$(/usr/bin/stat -c '%u:%a' -- "$stage")" = "$(/usr/bin/id -u):700"
for name in one-muse-narrow-root.py one-muse-narrow-sudoers local-muse-one-root.sh local-muse-one-ebpf.py local-muse-tcp-session.py local-muse-tcp.bt; do
  if [[ -e $stage/$name || -L $stage/$name ]]; then
    test -f "$stage/$name" && test ! -L "$stage/$name"
    /usr/bin/rm -f -- "$stage/$name"
  fi
done
/usr/bin/rmdir -- "$stage"
'@
      $cleanupBody = $cleanupBody.Replace('__STAGE__',$stage)
      $cleanupBody = $cleanupBody.Replace("`r`n", "`n")
      $cleanupBytes = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cleanupBody))
      $command = "/usr/bin/bash -lc 'printf %s $cleanupBytes | /usr/bin/base64 -d | /usr/bin/timeout --signal=TERM --kill-after=2s 8s /usr/bin/bash -s'"
      try {
        $cleaned = & $invoke ssh ($options + @('-T',$script:FixedRemote,$command)) 'cleanup' 12 $false
        if ($cleaned.ExitCode -ne 0) { & $Report 'BOOTSTRAP_CLEANUP=INCOMPLETE' }
        else { & $Report 'BOOTSTRAP_CLEANUP=PASS' }
      } catch { & $Report 'BOOTSTRAP_CLEANUP=FAILED_OR_TIMED_OUT' }
    }
    if (-not $installed) { & $Report 'CLACK_NARROW_SUDO_INSTALL=NOT_VERIFIED' }
  }
}

Export-ModuleMember -Function Invoke-OneMuseBootstrap,Invoke-OneMuseNativeChild,Stop-OneMuseOwnedProcess,Confirm-OneMuseChildResult
