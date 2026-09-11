$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
Set-Location -LiteralPath $projectPath
$nodePath = (Get-Command node -ErrorAction Stop).Source
$npmCliPath = Join-Path (Split-Path $nodePath) 'node_modules/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCliPath)) { throw 'Install Node.js LTS with npm and retry.' }
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & $nodePath $npmCliPath ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& $nodePath 'scripts/prepare-ai.mjs'
if ($LASTEXITCODE -ne 0) { throw 'AI worker preparation failed.' }
& $nodePath $npmCliPath run setup:login
if ($LASTEXITCODE -ne 0) { throw 'Login setup failed.' }
& $nodePath $npmCliPath run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
& $nodePath 'scripts/init-local-db.mjs'
if ($LASTEXITCODE -ne 0) { throw 'Local database initialization failed.' }
Write-Host 'Open http://localhost:5173. Press Ctrl+C to stop.'
& $nodePath $npmCliPath run dev
