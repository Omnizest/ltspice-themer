$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path -LiteralPath $taskCargoBin) {
    $env:PATH = "$taskCargoBin;$env:PATH"
}
$taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (!(Get-Command link.exe -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $taskVswhere)) {
    $taskVisualStudio = & $taskVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($taskVisualStudio) {
        & (Join-Path $taskVisualStudio 'Common7\Tools\Launch-VsDevShell.ps1') -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
    }
}
Push-Location -LiteralPath $taskRoot
try {
    & npm.cmd run tauri build -- --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "Desktop build failed with exit code $LASTEXITCODE" }
    $taskExecutable = Join-Path $taskRoot 'src-tauri\target\release\lt-spice-themer.exe'
    if (!(Test-Path -LiteralPath $taskExecutable)) { throw 'Built executable not found' }
    $taskOutput = Join-Path $taskRoot 'release'
    New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
    $taskDestination = Join-Path $taskOutput 'LTspiceThemer.exe'
    try {
        Copy-Item -LiteralPath $taskExecutable -Destination $taskDestination -Force -ErrorAction Stop
    } catch [System.IO.IOException] {
        $taskDestination = Join-Path $taskOutput 'LTspiceThemer-Buck.exe'
        Copy-Item -LiteralPath $taskExecutable -Destination $taskDestination -Force -ErrorAction Stop
        Write-Host 'Existing executable is in use; wrote LTspiceThemer-Buck.exe instead.'
    }
    $taskHash = (Get-FileHash -LiteralPath $taskDestination -Algorithm SHA256).Hash.ToLowerInvariant()
    $taskFileName = Split-Path -Leaf $taskDestination
    [IO.File]::WriteAllText((Join-Path $taskOutput 'SHA256SUMS.txt'), "$taskHash  $taskFileName`n")
    Get-Item -LiteralPath $taskDestination | Select-Object FullName, Length, LastWriteTime
}
finally {
    Pop-Location
}
