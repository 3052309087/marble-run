$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodeExecutable = (Get-Command node.exe).Source
if (!(Test-Path node_modules) -or !(Test-Path server/node_modules) -or !(Test-Path client/node_modules)) {
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw 'Root dependency installation failed.' }
  & npm.cmd run install:all
  if ($LASTEXITCODE -ne 0) { throw 'App dependency installation failed.' }
}
& node scripts/setup.mjs
if ($LASTEXITCODE -ne 0) { throw 'Environment setup failed.' }
& node scripts/database.mjs start
if ($LASTEXITCODE -ne 0) { throw 'Database startup failed.' }
$processes = @{}
$services = @(
  @{ Name = 'api'; Port = 3000; Script = (Join-Path $projectRoot 'server\src\index.js'); Arguments = '' },
  @{ Name = 'web'; Port = 5173; Script = (Join-Path $projectRoot 'client\node_modules\vite\bin\vite.js'); Arguments = (' --config "' + (Join-Path $projectRoot 'client\vite.config.js') + '" "' + (Join-Path $projectRoot 'client') + '"') }
)
foreach ($service in $services) {
  $listener = Get-NetTCPConnection -LocalPort $service.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $existing = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
    if (!$existing -or !$existing.CommandLine -or !$existing.CommandLine.Contains($service.Script)) { throw ('Port ' + $service.Port + ' is occupied by another process.') }
    $processes[$service.Name] = $listener.OwningProcess
    continue
  }
  $arguments = '"' + $service.Script + '"' + $service.Arguments
  $process = Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot ('.local\' + $service.Name + '.log')) -RedirectStandardError (Join-Path $projectRoot ('.local\' + $service.Name + '-error.log')) -PassThru
  $processes[$service.Name] = $process.Id
}
$processes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.local\processes.json')
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 2
    $web = Invoke-WebRequest 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 2
    if ($health.ok -and $web.StatusCode -eq 200) { $ready = $true; break }
  } catch { Start-Sleep -Milliseconds 500 }
}
if (!$ready) { throw 'Startup timed out. Check .local/api-error.log and .local/web-error.log.' }
Write-Output 'Ready: http://localhost:5173'
Write-Output 'API: http://localhost:3000/api/health'
Write-Output 'To stop: powershell -ExecutionPolicy Bypass -File scripts/stop-local.ps1'
