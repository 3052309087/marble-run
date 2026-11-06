import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
mkdirSync(`${root}/.local`, { recursive: true })
if (!existsSync(`${root}/server/.env`)) {
  writeFileSync(`${root}/server/.env`, `PORT=3000\nDATABASE_URL=postgres://marble:marble_dev_password@127.0.0.1:5432/marble_game\nJWT_SECRET=${randomBytes(48).toString('hex')}\nCLIENT_ORIGIN=http://localhost:5173\n`)
  console.log('Created server/.env with a random JWT secret.')
} else console.log('Keeping existing server/.env.')
