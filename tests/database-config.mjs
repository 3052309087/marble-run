import dotenv from '../server/node_modules/dotenv/lib/main.js'
import { existsSync, readFileSync } from 'node:fs'

// The same tests can target either the Docker database or the legacy local mode.
export function databaseConfig() {
  if (process.env.TEST_DATABASE_URL) return { connectionString: process.env.TEST_DATABASE_URL }
  const file = new URL('../.env', import.meta.url)
  if (existsSync(file)) {
    const env = dotenv.parse(readFileSync(file))
    return { host: '127.0.0.1', port: Number(env.DB_PORT || 5432), database: 'marble_game', user: 'marble', password: env.POSTGRES_PASSWORD }
  }
  return { connectionString: 'postgres://marble:marble_dev_password@127.0.0.1:5432/marble_game' }
}
