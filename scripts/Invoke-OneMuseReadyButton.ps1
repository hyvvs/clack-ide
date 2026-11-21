# UI Automation activates EXACTLY ONE already-enabled button of the owned
# isolated Clack diagnostic WebView; no HTTP request, model call or fallback.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateRange(2,2147483647)][int]$HostPid,
  [Parameter(Mandatory=$true)][string]$RunId
)
$ErrorActionPreference = 'Stop'
if ($RunId -cnotmatch '^muse-one-[a-f0-9]{24}$') {
  throw 'Unrecognized exclusive diagnostic run'
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$condition = New-Object -TypeName System.Windows.Automation.PropertyCondition -ArgumentList @(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$HostPid)
$window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
  [System.Windows.Automation.TreeScope]::Children, $condition)
$expectedWindowTitle = 'Clack One-Muse Diagnostic ' + [char]0x00B7 + ' Manual Dispatch'
if (-not $window -or
    $window.Current.Name -cne $expectedWindowTitle) {
  throw 'Reviewed owned Clack WebView not found'
}
$buttonName = New-Object -TypeName System.Windows.Automation.PropertyCondition -ArgumentList @(
  [System.Windows.Automation.AutomationElement]::NameProperty,
  'Dispatch one instrumented Muse request')
$buttonType = New-Object -TypeName System.Windows.Automation.PropertyCondition -ArgumentList @(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button)
$predicate = New-Object -TypeName System.Windows.Automation.AndCondition -ArgumentList @(
  $buttonName, $buttonType)
$deadline = [DateTime]::UtcNow.AddSeconds(20)
while ([DateTime]::UtcNow -lt $deadline) {
  $matches = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $predicate)
  if ($matches.Count -gt 1) { throw 'Ambiguous one-Muse dispatch control' }
  if ($matches.Count -eq 1 -and $matches[0].Current.IsEnabled) {
    $pattern = $matches[0].GetCurrentPattern(
      [System.Windows.Automation.InvokePattern]::Pattern)
    if (-not $pattern) { throw 'Native accessibility invoke unavailable' }
    $pattern.Invoke()
    Write-Output 'ONE_MUSE_AUTHORIZED_BUTTON_INVOKED=1'
    exit 0
  }
  Start-Sleep -Milliseconds 500
}
throw 'Nine-gate-authorized dispatch button was never enabled'
