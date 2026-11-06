$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envFile) {
  Write-Output 'Keeping existing Docker .env.'
  exit 0
}
function New-RandomSecret {
  $bytes = New-Object byte[] 48
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($bytes) } finally { $random.Dispose() }
  return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}
$databasePassword = New-RandomSecret
$jwtSecret = New-RandomSecret
# Preserve valid local logins when moving the existing database into Docker.
$localEnv = Join-Path $projectRoot 'server\.env'
if (Test-Path -LiteralPath $localEnv) {
  $match = [regex]::Match([System.IO.File]::ReadAllText($localEnv), '(?m)^JWT_SECRET=([a-zA-Z0-9_-]{32,})\s*$')
  if ($match.Success) { $jwtSecret = $match.Groups[1].Value }
}
$lines = @("POSTGRES_PASSWORD=$databasePassword", "JWT_SECRET=$jwtSecret", 'WEB_PORT=5173', 'API_PORT=3000', 'DB_PORT=5432')
[System.IO.File]::WriteAllText($envFile, (($lines -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Output 'Created Docker .env with generated secrets.'
