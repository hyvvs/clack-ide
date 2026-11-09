# Read-only local tunnel endpoint state sampler for a *separately authorized*
# diagnostic run. No payload, packet capture, credentials or process arguments.
# Windows Get-NetTCPConnection exposes state/ports/process ID but NO per-socket
# successful-write, payload-delivery, ACK or retransmission counters.
param([int]$Samples = 20, [int]$IntervalMilliseconds = 500)
if ($Samples -lt 1 -or $Samples -gt 2000 -or $IntervalMilliseconds -lt 100 -or $IntervalMilliseconds -gt 60000) {
  throw 'Bounded sampling arguments required'
}
$clock = [System.Diagnostics.Stopwatch]::StartNew()
for ($sample = 0; $sample -lt $Samples; $sample++) {
  $connections = @(Get-NetTCPConnection -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(11435,22) -or $_.RemotePort -in @(11435,22) })
  foreach ($connection in $connections) {
    if ($connection.State -notin @('Established','Listen','TimeWait','CloseWait')) { continue }
    $pidValue = [int]$connection.OwningProcess
    $localPort = [int]$connection.LocalPort
    $remotePort = [int]$connection.RemotePort
    Write-Output "WINMETA $pidValue $localPort $remotePort $($connection.State)"
  }
  if ($sample + 1 -lt $Samples) { Start-Sleep -Milliseconds $IntervalMilliseconds }
}
