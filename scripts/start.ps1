$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (!(Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install and start Docker Desktop first.' }
& docker info --format '{{.ServerVersion}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running.' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-docker.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Docker environment setup failed.' }
& docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Docker configuration is invalid. Check .env.' }
& docker compose up -d --build --wait --wait-timeout 120
if ($LASTEXITCODE -ne 0) { throw 'Startup failed. Run docker compose logs --tail=80. If a port is occupied by the old local mode, stop it with scripts/stop-local.ps1 first.' }
$webPort = '5173'
$portMatch = [regex]::Match([System.IO.File]::ReadAllText((Join-Path $projectRoot '.env')), '(?m)^WEB_PORT=(\d+)\s*$')
if ($portMatch.Success) { $webPort = $portMatch.Groups[1].Value }
$health = Invoke-RestMethod ("http://localhost:$webPort/api/health") -TimeoutSec 10
if (!$health.ok) { throw 'Web-to-API health check failed.' }
& docker compose ps
Write-Output "Ready: http://localhost:$webPort"
Write-Output 'Vue (Nginx), API and PostgreSQL are all running in Docker.'
Write-Output 'Double-click stop.bat to stop. The database volume is retained.'
