$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pidFile = Join-Path $projectRoot '.local\processes.json'
if (Test-Path -LiteralPath $pidFile) {
  $processes = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  foreach ($name in @('api', 'web')) {
    $processId = $processes.$name
    if (!$processId) { continue }
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $processId) -ErrorAction SilentlyContinue
    if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine.Contains($projectRoot)) {
      Stop-Process -Id $processId
      Write-Output ('Stopped ' + $name)
    }
  }
}
& node scripts/database.mjs stop
if ($LASTEXITCODE -ne 0) { throw 'Database shutdown failed.' }
Write-Output 'Stopped. Accounts and scores are retained in .local/postgres.'
