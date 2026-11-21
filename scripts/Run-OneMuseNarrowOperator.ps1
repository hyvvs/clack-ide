# Production coordinated kernel stage ONLY; not a standalone qualification.
# No passwords, TTY, user-uploaded root scripts, arbitrary paths or durations.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$RunId,
  [Parameter(Mandatory=$true)][ValidateRange(2,2147483647)][int]$ExpectedPid
)
$ErrorActionPreference = 'Stop'
if ($RunId -cnotmatch '^muse-one-[a-f0-9]{24}$') {
  throw 'Exact coordinated run identity required'
}
$key = Join-Path $env:USERPROFILE '.ssh\clack_hylab_ed25519'
if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
  throw 'Pinned SSH identity unavailable'
}
$argv = @('-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
  '-o','ConnectTimeout=5','-o','ServerAliveInterval=5','-o',
  'ServerAliveCountMax=4','-i',$key,'hylab@192.168.1.44',
  ('/usr/bin/sudo -n /usr/local/libexec/clack-one-muse-root --run ' + $RunId + ' ' + $ExpectedPid))
# The root wrapper verifies run ID, exact current service PID, installed code
# hashes and fixed 1800s duration; the coordinator owns readiness/STOP.
& ssh.exe @argv
$code=$LASTEXITCODE
# Keep the remote collector's bounded, already-allowlisted KERNEL_AUDIT_*
# and OPERATOR_EBPF_* rows on stderr for the local closed-vocabulary audit.
# Do not coerce all distinct native errors into the same PowerShell exception.
if ($code -ne 0) {
  [Console]::Error.WriteLine('CLACK_NARROW_OPERATOR_SSH_EXIT=' + [string]$code)
}
exit $code
