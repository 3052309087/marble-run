import dotenv from 'dotenv'
import pg from 'pg'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })
const connection = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE || 'marble_game', user: process.env.PGUSER || 'marble', password: process.env.PGPASSWORD || 'marble_dev_password' }
const pool = new pg.Pool({
  ...connection,
  max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000
})
pool.on('error', error => console.error('PostgreSQL:', error.message))
try {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters. Run npm run setup.')
  await pool.query(await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8'))
  const app = createApp({ pool, jwtSecret: process.env.JWT_SECRET, clientOrigin: process.env.CLIENT_ORIGIN })
  const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('Marble Run API listening on port ' + (process.env.PORT || 3000)))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await pool.end(); process.exit(0) }))
} catch (error) {
  console.error('Startup failed:', error.message)
  await pool.end()
  process.exitCode = 1
}
