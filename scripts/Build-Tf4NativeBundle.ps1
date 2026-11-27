# Explicit Windows-only build of the TF4 confined read-only browser host and
# main Clack app. This does NOT approve model browser interactions, pass native
# acceptance gates, install software, deploy a release or mark PR #46 Ready.
#
# The trusted build computes the host digest from the actual exact staged
# resource and embeds it in the *application* compile. User/model/runtime
# settings never supply the digest or browser executable path.
#
# PowerShell 5.1:
# powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build-Tf4NativeBundle.ps1

[CmdletBinding()]
param(
    # NSIS is the supported per-user Windows acceptance installer. MSI
    # remains explicitly selectable for separate WiX qualification.
    [ValidateSet('nsis', 'msi', 'all')]
    [string]$Bundles = 'nsis'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifest = Join-Path $root 'src-tauri\Cargo.toml'
$cargoTarget = Join-Path $root 'src-tauri\target'
$stage = Join-Path $cargoTarget 'tf4-native-stage'
$source = Join-Path $cargoTarget 'release\clack-browser-host.exe'
$staged = Join-Path $stage 'clack-browser-host.exe'
$config = Join-Path $root 'src-tauri\tauri.tf4-native.conf.json'
$originalCwd = (Get-Location).Path
$previousPin = [Environment]::GetEnvironmentVariable('CLACK_TF4_NATIVE_HOST_SHA256', 'Process')

function Assert-PlainWorkspacePath([string]$path) {
    $absolute = [IO.Path]::GetFullPath($path)
    if (-not $absolute.StartsWith(
        ($root + [IO.Path]::DirectorySeparatorChar),
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Refusing external TF4 build path: $path"
    }
    if (Test-Path -LiteralPath $absolute) {
        $item = Get-Item -LiteralPath $absolute -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing reparse-point TF4 build path: $path"
        }
    }
}

try {
    if ($env:OS -ne 'Windows_NT') {
        throw 'The real TF4 AppContainer browser host can be bundled only on Windows.'
    }
    foreach ($path in @($manifest, $cargoTarget, $stage, $source, $staged, $config)) {
        Assert-PlainWorkspacePath $path
    }
    Push-Location -LiteralPath $root
    try {
        # Do not package a moving or unreviewed tracked source tree.
        $dirty = @(git status --porcelain=v1 --untracked-files=no)
        if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) {
            throw 'TF4 native bundle requires a clean tracked Git worktree.'
        }
        & cargo.exe build --manifest-path $manifest --locked --release --features tf-browser-native-runtime --bin clack-browser-host
        if ($LASTEXITCODE -ne 0) { throw 'TF4 production host optimized build failed.' }
        Assert-PlainWorkspacePath $source
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw 'The required native host release executable is absent.'
        }
        if (-not (Test-Path -LiteralPath $stage -PathType Container)) {
            New-Item -ItemType Directory -Path $stage -ErrorAction Stop | Out-Null
        }
        Assert-PlainWorkspacePath $stage
        Assert-PlainWorkspacePath $staged
        Copy-Item -LiteralPath $source -Destination $staged -Force -ErrorAction Stop
        $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
        $stagedHash = (Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($sourceHash -ne $stagedHash -or $stagedHash -notmatch '^[0-9a-f]{64}$') {
            throw 'TF4 native staged host differs from the exact built executable.'
        }
        $env:CLACK_TF4_NATIVE_HOST_SHA256 = $stagedHash
        & npm.cmd run tauri -- build --features tf-browser-native-runtime --config $config --bundles $Bundles
        if ($LASTEXITCODE -ne 0) { throw 'TF4 native main application bundle failed.' }
        $finalHash = (Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($finalHash -ne $stagedHash) {
            throw 'TF4 native staged host mutated during application bundling.'
        }
        Write-Output "TF4_NATIVE_BUNDLE_BUILD=PASS host_sha256=$stagedHash"
        Write-Output 'TF4_INTERACTIVE_ACCEPTANCE=NOT_PROVEN; NO_INSTALL_OR_DEPLOYMENT_PERFORMED'
    } finally {
        Pop-Location
    }
} finally {
    [Environment]::SetEnvironmentVariable('CLACK_TF4_NATIVE_HOST_SHA256', $previousPin, 'Process')
    Set-Location -LiteralPath $originalCwd
}
