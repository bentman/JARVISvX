# Dot-source from PowerShell:
# . .\scripts\use-jarvis.ps1

$JarvisRepoRoot = (Resolve-Path (Join-Path "$PSScriptRoot" "..")).Path

function jarvis {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Error "node was not found. Install Node.js, then try again."
        return
    }

    $cliPath = Join-Path $JarvisRepoRoot "bin\jarvis.mjs"
    if (-not (Test-Path -LiteralPath $cliPath)) {
        Write-Error "JARVIS CLI entrypoint not found at '$cliPath'."
        return
    }

    & node $cliPath @args
}

Write-Host "JARVIS CLI loaded for this session: jarvis"
