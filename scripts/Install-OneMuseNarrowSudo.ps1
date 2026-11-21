# ONE-TIME privileged bootstrap. This entry point cannot accept credentials,
# commands, paths, durations, or test/runner override parameters.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
try {
  Import-Module (Join-Path $PSScriptRoot 'OneMuseBootstrapRuntime.psm1') -Force -ErrorAction Stop
  $key = Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
  $done = Invoke-OneMuseBootstrap -ScriptsRoot $PSScriptRoot -Key $key
  if ($done -ne $true) { throw 'BOOTSTRAP_FAILED_STAGE=6 REASON=unverified_result' }
  exit 0
} catch {
  $message = [string]$_.Exception.Message
  if ($message -notmatch '^BOOTSTRAP_FAILED_STAGE=[A-Za-z0-9_-]+ REASON=[A-Za-z0-9_-]+') {
    $message = 'BOOTSTRAP_FAILED_STAGE=entry REASON=unexpected_bootstrap_error'
  }
  [Console]::Error.WriteLine($message)
  [Console]::Error.Flush()
  exit 1
}
