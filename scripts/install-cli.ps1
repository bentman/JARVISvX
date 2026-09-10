# Installs a clean, standalone user PATH shim for JARVIS CLI without npm link or global symlinks.
param(
    [string]$TargetDirectory = "$HOME\.local\bin"
)

$ErrorActionPreference = "Stop"
$JarvisRepoRoot = (Resolve-Path (Join-Path "$PSScriptRoot" "..")).Path
$CliEntry = Join-Path $JarvisRepoRoot "bin\jarvis.mjs"

if (-not (Test-Path -LiteralPath $CliEntry)) {
    throw "JARVIS CLI entrypoint not found at '$CliEntry'."
}

if (-not (Test-Path -LiteralPath $TargetDirectory)) {
    New-Item -ItemType Directory -Force -Path $TargetDirectory | Out-Null
}

$ResolvedTarget = (Resolve-Path -LiteralPath $TargetDirectory).Path

$CmdPath = Join-Path $ResolvedTarget "jarvis.cmd"
$CmdContent = "@echo off`r`nnode `"$CliEntry`" %*`r`n"
[System.IO.File]::WriteAllText($CmdPath, $CmdContent, [System.Text.Encoding]::ASCII)

$Ps1Path = Join-Path $ResolvedTarget "jarvis.ps1"
$Ps1Content = "& node `"$CliEntry`" @args`r`n"
[System.IO.File]::WriteAllText($Ps1Path, $Ps1Content, [System.Text.Encoding]::ASCII)

Write-Host "Created standalone JARVIS CLI shims in '$ResolvedTarget':"
Write-Host "  - $CmdPath"
Write-Host "  - $Ps1Path"

$CurrentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
$PathEntries = ($CurrentPath -split ";") | Where-Object { $_ }
$OnPath = $PathEntries | Where-Object { (Resolve-Path $_ -ErrorAction SilentlyContinue)?.Path -eq $ResolvedTarget }

if (-not $OnPath) {
    Write-Host ""
    Write-Host "NOTE: '$ResolvedTarget' is not yet in your User PATH." -ForegroundColor Yellow
    Write-Host "To add it to your User PATH, run:"
    Write-Host "  [Environment]::SetEnvironmentVariable('PATH', `"$CurrentPath;$ResolvedTarget`", 'User')"
} else {
    Write-Host ""
    Write-Host "'$ResolvedTarget' is on your PATH. You can run 'jarvis' from any terminal." -ForegroundColor Green
}

$ExistingNpmShim = Join-Path $env:APPDATA "npm\jarvis.cmd"
if (Test-Path -LiteralPath $ExistingNpmShim) {
    Write-Host ""
    Write-Host "Found legacy npm link at '$ExistingNpmShim'." -ForegroundColor Yellow
    Write-Host "To prevent collisions with npm's global symlink, remove it with:"
    Write-Host "  npm uninstall -g jarvis jarvisvx"
}
