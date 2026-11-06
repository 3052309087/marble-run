import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, unlinkSync, openSync, closeSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from '../server/node_modules/pg/lib/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const dataDir = path.join(root, '.local', 'postgres')
const bin = path.join(root, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin')
const command = process.argv[2] || 'start'
if (process.platform !== 'win32') throw new Error('Use docker compose up -d for non-Windows systems.')
function run(exe, args, quiet = false) {
  // pg_ctl's server inherits pipe handles on Windows; use a real log file so the launcher can exit.
  const log = path.join(root, '.local', 'database-launch.log')
  const offset = existsSync(log) ? statSync(log).size : 0
  const fd = openSync(log, 'a')
  const result = spawnSync(path.join(bin, exe + '.exe'), args, { windowsHide: true, stdio: ['ignore',fd,fd] })
  closeSync(fd)
  if (!quiet) process.stdout.write(readFileSync(log).subarray(offset))
  if (result.error) throw result.error
  return result.status
}
mkdirSync(path.join(root, '.local'), { recursive: true })
if (command === 'stop') {
  if (existsSync(path.join(dataDir, 'PG_VERSION')) && run('pg_ctl', ['-D', dataDir, 'status'], true) === 0) {
    if (run('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']) !== 0) process.exitCode = 1
  } else console.log('Project database is already stopped.')
} else {
  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    const passwordFile = path.join(root, '.local', 'init-password.tmp')
    writeFileSync(passwordFile, 'marble_dev_password', { mode: 0o600 })
    try {
      if (run('initdb', ['-D',dataDir,'-U','marble','--pwfile='+passwordFile,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']) !== 0) throw new Error('PostgreSQL initialization failed.')
    } finally { unlinkSync(passwordFile) }
  }
  if (run('pg_ctl', ['-D',dataDir,'status'], true) !== 0) {
    if (run('pg_ctl', ['-D',dataDir,'-l',path.join(root,'.local','postgres.log'),'-o','-h 127.0.0.1 -p 5432','-w','start']) !== 0) throw new Error('PostgreSQL start failed. See .local/postgres.log; port 5432 must be free.')
  }
  const client = new pg.Client({ connectionString: 'postgres://marble:marble_dev_password@127.0.0.1:5432/postgres' })
  try {
    await client.connect()
    const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = 'marble_game'")
    if (!rows.length) await client.query('CREATE DATABASE marble_game')
    console.log('PostgreSQL is ready on 127.0.0.1:5432. Data: .local/postgres')
  } finally { await client.end() }
}
