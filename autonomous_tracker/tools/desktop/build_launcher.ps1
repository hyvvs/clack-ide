$ErrorActionPreference = 'Stop'
$rescueWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$rescueCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $rescueCompiler -PathType Leaf)) {
    throw 'The .NET Framework C# compiler is not installed on this Windows system.'
}
$rescueSource = Join-Path $PSScriptRoot 'RescueStudioLauncher.cs'
$rescueExecutable = Join-Path $rescueWorkspace 'Rescue Studio.exe'
& $rescueCompiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll "/out:$rescueExecutable" $rescueSource
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Write-Output "Built $rescueExecutable"
