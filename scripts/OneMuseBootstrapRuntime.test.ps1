# Offline synthetic tests: NO SSH, sudo, kernel, model, or root file writes.
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'OneMuseBootstrapRuntime.psm1') -Force

function Assert-Check([bool]$Yes,[string]$Reason) {
  if (-not $Yes) { throw ('SYNTHETIC_TEST_FAILURE=' + $Reason) }
}

function Test-BootstrapScenario([string]$Case,[string]$Expected) {
  $state = [pscustomobject]@{
    Scenario = $Case
    Calls = [System.Collections.Generic.List[object]]::new()
    Messages = [System.Collections.Generic.List[string]]::new()
    Stage = '/home/hylab/.cache/clack-muse-narrow-install.Abcdef12'
    CleanupCount = 0
    RootPrompt = $false
    BootstrapControl = ''
    Install = $false
    SelfCheck = $false
  }
  $fake = {
    param([string]$Tool,[string[]]$Arguments,[string]$Stage,
      [int]$DeadlineSeconds,[switch]$Interactive)
    [void]$state.Calls.Add([pscustomobject]@{
      Tool=$Tool; Stage=$Stage; Args=($Arguments -join ' ')
      Interactive=[bool]$Interactive; Deadline=$DeadlineSeconds
    })
    if ($DeadlineSeconds -lt 1 -or $DeadlineSeconds -gt 160) {
      throw 'SYNTHETIC_TEST_FAILURE=unbounded_command'
    }
    if ($Stage -eq 'cleanup') {
      $state.CleanupCount++
      return [pscustomobject]@{ExitCode=0;Stdout='';Stderr=''}
    }
    if ($Stage -eq '2') {
      if ($state.Scenario -eq 'ssh-unreachable') {
        return [pscustomobject]@{ExitCode=255;Stdout='';Stderr='Connection refused'}
      }
      if ($state.Scenario -eq 'host-key-failure') {
        return [pscustomobject]@{ExitCode=255;Stdout='';Stderr='Host key verification failed.'}
      }
    }
    if ($Stage -eq '3' -and $Arguments[-1] -match 'mktemp -d') {
      return [pscustomobject]@{ExitCode=0;Stdout=($state.Stage + "`n");Stderr=''}
    }
    if ($Stage -eq '4') {
      $state.RootPrompt = [bool]$Interactive
      Assert-Check ([bool]$Interactive) 'stage_four_did_not_inherit_stdio'
      Assert-Check ($Tool -eq 'ssh') 'sudo_not_via_ssh'
      Assert-Check ($Arguments -contains '-tt') 'ssh_pty_not_forced'
      Assert-Check ($Arguments -notcontains '-T') 'sudo_tty_disabled'
      Assert-Check ($Arguments[-1] -match '/usr/bin/base64 -d \| /usr/bin/bash -s') 'non_fixed_remote_control'
      $state.BootstrapControl = $Arguments[-1]
      if ($state.Scenario -eq 'auth-timeout') {
        return [pscustomobject]@{ExitCode=74;Stdout='';Stderr=''}
      }
      if ($state.Scenario -eq 'local-ssh-timeout') {
        throw 'BOOTSTRAP_FAILED_STAGE=4 REASON=timeout'
      }
      if ($state.Scenario -eq 'auth-failure') {
        return [pscustomobject]@{ExitCode=1;Stdout='';Stderr=''}
      }
      if ($state.Scenario -eq 'installer-failure') {
        return [pscustomobject]@{ExitCode=72;Stdout='';Stderr=''}
      }
      if ($state.Scenario -eq 'sudoers-failure') {
        return [pscustomobject]@{ExitCode=73;Stdout='';Stderr=''}
      }
      if ($state.Scenario -eq 'installer-timeout') {
        return [pscustomobject]@{ExitCode=75;Stdout='';Stderr=''}
      }
      $state.Install=$true
    }
    if ($Stage -eq '6') {
      if ($state.Scenario -eq 'self-check-failure') {
        return [pscustomobject]@{ExitCode=1;Stdout='';Stderr=''}
      }
      $state.SelfCheck=$true
      return [pscustomobject]@{ExitCode=0;Stdout="CLACK_NARROW_SUDO_SELF_CHECK=PASS`n";Stderr=''}
    }
    return [pscustomobject]@{ExitCode=0;Stdout='';Stderr=''}
  }.GetNewClosure()
  $report = { param([string]$Row) [void]$state.Messages.Add($Row) }.GetNewClosure()
  $temporaryKey = Join-Path $PSScriptRoot 'OneMuseBootstrapRuntime.psm1'
  $failed = $null; $success=$false
  try {
    $success = Invoke-OneMuseBootstrap -ScriptsRoot $PSScriptRoot -Key $temporaryKey `
      -RunCommand $fake -Report $report -SyntheticNoConsole
  } catch {
    $failed = [string]$_.Exception.Message
  }
  if ($Expected -eq 'PASS') {
    Assert-Check ($null -eq $failed -and $success -eq $true) "${Case}_should_pass_$failed"
    Assert-Check $state.SelfCheck 'self_check_missing'
    Assert-Check ($state.Messages -contains 'CLACK_NARROW_SUDO_INSTALL=PASS') 'success_not_reported'
    foreach ($marker in @('[1/6]','[2/6]','[3/6]','[4/6]','[6/6]')) {
      Assert-Check ([bool]@($state.Messages | Where-Object { $_.StartsWith($marker) }).Count) "missing_progress_$marker"
    }
  } else {
    Assert-Check ($null -ne $failed -and $failed.Contains($Expected)) "${Case}_wrong_failure_$failed"
    Assert-Check ($state.Messages -contains 'CLACK_NARROW_SUDO_INSTALL=NOT_VERIFIED') "${Case}_missing_failed_receipt"
  }
  if ($Case -in @('ssh-unreachable','host-key-failure')) {
    Assert-Check ($state.CleanupCount -eq 0) "${Case}_cleanup_without_stage"
    Assert-Check (-not $state.RootPrompt) "${Case}_unexpected_auth_prompt"
  } else {
    Assert-Check ($state.CleanupCount -eq 1) "${Case}_missing_owned_stage_cleanup"
    Assert-Check (@($state.Calls | Where-Object {$_.Stage -eq 'cleanup'}).Count -eq 1) "${Case}_cleanup_not_attempted"
  }
  Assert-Check (@($state.Calls | Where-Object {$_.Stage -eq '4'}).Count -le 1) "${Case}_sudo_retried"
  Assert-Check (@($state.Calls | Where-Object {$_.Stage -eq '6'}).Count -le 1) "${Case}_self_check_retried"
  [Console]::Out.WriteLine('SYNTHETIC=' + $Case + ' PASS')
  return $state
}

Test-BootstrapScenario 'ssh-unreachable' 'BOOTSTRAP_FAILED_STAGE=2 REASON=ssh_unreachable_or_authentication_failed' | Out-Null
Test-BootstrapScenario 'host-key-failure' 'BOOTSTRAP_FAILED_STAGE=2 REASON=ssh_host_key_failure' | Out-Null
$visible = Test-BootstrapScenario 'visible-sudo-prompt' 'PASS'
Assert-Check $visible.RootPrompt 'auth_not_console_attached'
Assert-Check ($visible.BootstrapControl.Length -le 30000) 'Windows_ShellExecute_argument_length_exceeded'
$b64 = [regex]::Match($visible.BootstrapControl, 'printf %s ([A-Za-z0-9+/=]+) \| /usr/bin/base64 -d').Groups[1].Value
Assert-Check ($b64.Length -gt 1000) 'static_remote_control_not_encoded'
$decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
Assert-Check (-not $decoded.Contains("`r")) 'Linux_remote_control_contains_CRLF'
Assert-Check ($decoded.Contains('timeout --foreground --signal=TERM --kill-after=2s 90s /usr/bin/sudo -v')) 'bounded_foreground_sudo_authentication_missing'
Assert-Check ($decoded.Contains('60s /usr/bin/sudo -n /usr/bin/bash -s')) 'bounded_post_auth_installation_missing'
Test-BootstrapScenario 'auth-failure' 'BOOTSTRAP_FAILED_STAGE=4 REASON=sudo_authentication_failed' | Out-Null
Test-BootstrapScenario 'auth-timeout' 'BOOTSTRAP_FAILED_STAGE=4 REASON=sudo_authentication_timeout' | Out-Null
Test-BootstrapScenario 'local-ssh-timeout' 'BOOTSTRAP_FAILED_STAGE=4 REASON=timeout' | Out-Null
Test-BootstrapScenario 'installer-failure' 'BOOTSTRAP_FAILED_STAGE=5 REASON=remote_installer_failure' | Out-Null
Test-BootstrapScenario 'installer-timeout' 'BOOTSTRAP_FAILED_STAGE=5 REASON=remote_installer_timeout' | Out-Null
Test-BootstrapScenario 'sudoers-failure' 'BOOTSTRAP_FAILED_STAGE=5 REASON=sudoers_validation_failed' | Out-Null
Test-BootstrapScenario 'successful-install' 'PASS' | Out-Null
Test-BootstrapScenario 'successful-sudo-n-self-check' 'PASS' | Out-Null
Test-BootstrapScenario 'self-check-failure' 'BOOTSTRAP_FAILED_STAGE=6 REASON=narrow_sudo_self_check_failed' | Out-Null

# The production bootstrap MUST use a separate, visible, OS-managed console.
# An unredirected inherited handle under UseShellExecute=false DID NOT transmit
# a harmless marker to the remote pseudo-terminal in the previously attempted
# live handoff. Windows ShellExecute gives the child its own console keyboard.
$runtime = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'OneMuseBootstrapRuntime.psm1'))
$rootShell = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'install-one-muse-narrow-root.sh'))
Assert-Check ($runtime.Contains('$psi.RedirectStandardInput = -not $Interactive')) 'interact_stdin_redirected'
Assert-Check ($runtime.Contains('$psi.RedirectStandardOutput = -not $Interactive')) 'interact_stdout_redirected'
Assert-Check ($runtime.Contains('$psi.RedirectStandardError = -not $Interactive')) 'interact_stderr_redirected'
Assert-Check ($runtime.Contains('$psi.UseShellExecute = [bool]$Interactive')) 'missing_separate_console_shell_execute'
Assert-Check ($runtime.Contains('$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal')) 'console_not_guaranteed_visible'
Assert-Check ($runtime.Contains('OpenSSH')) 'pinned_OpenSSH_executable_missing'
Assert-Check ($runtime.Contains('[4/6] waiting for dedicated SSH window')) 'silent_interactive_wait'
Assert-Check ($runtime.Contains('type the password ONLY in the separate SSH console window')) 'misleading_terminal_instructions'
Assert-Check ($runtime.Contains('Stop-OneMuseOwnedProcess $child')) 'native_timeout_tree_cleanup_missing'
Assert-Check ($runtime.Contains("'/F /T /PID '")) 'descendant_process_cleanup_missing'
Assert-Check ($runtime.Contains("printf '[5/6] installing narrow wrapper and sudoers policy")) 'no_after_auth_install_progress'
Assert-Check ($runtime.Contains('/usr/bin/sudo -v')) 'interactive_root_authentication_missing'
Assert-Check ($runtime.Contains('--foreground --signal=TERM --kill-after=2s 90s /usr/bin/sudo -v')) 'interactive_sudo_requires_foreground_process_group'
Assert-Check ($runtime.Contains('/usr/bin/sudo -n /usr/bin/bash -s')) 'noninteractive_install_after_authentication_missing'
Assert-Check (-not $runtime.Contains('sudo -S')) 'stdin_password_forbidden'
Assert-Check (-not $runtime.Contains('Start-Process')) 'detached_prompt_forbidden'
[Console]::Out.WriteLine('SYNTHETIC_NATIVE_STDIO_AND_TREE_CLEANUP=PASS')

# Execute one innocuous local sleeper to validate that the same production
# taskkill /T path actually terminates an owned child on Windows. No SSH,
# sudo, credential, remote access or model call is involved.
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = Join-Path $PSHOME 'powershell.exe'
$start.Arguments = '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 45"'
$start.CreateNoWindow = $true
$start.UseShellExecute = $false
$sleeping = [System.Diagnostics.Process]::Start($start)
try {
  Assert-Check ($null -ne $sleeping) 'local_synthetic_process_not_started'
  Stop-OneMuseOwnedProcess $sleeping
  Assert-Check ($sleeping.WaitForExit(3000)) 'owned_process_tree_not_stopped'
  [Console]::Out.WriteLine('SYNTHETIC_REAL_WINDOWS_PROCESS_TERMINATION=PASS')
} finally {
  if ($sleeping -and -not $sleeping.HasExited) {
    try { $sleeping.Kill() } catch { }
  }
  if ($sleeping) { $sleeping.Dispose() }
}
