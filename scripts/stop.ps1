$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& docker compose down
if ($LASTEXITCODE -ne 0) { throw 'Docker shutdown failed. Check Docker Desktop.' }
Write-Output 'Containers stopped. Accounts and scores are retained in the Docker volume.'
