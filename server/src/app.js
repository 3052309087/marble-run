import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { difficultyFor, evaluateRating, validateReplay, STEP_MS } from '../../shared/game.js'

const usernamePattern = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const publicUser = row => ({ id: row.id, username: row.username, skillRating: row.skill_rating, createdAt: row.created_at })
const fail = (status, message) => Object.assign(new Error(message), { status })
const route = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

const RANKING = `WITH personal_best AS (
  SELECT user_id, level, MIN(time_ms) AS time_ms FROM game_results GROUP BY user_id, level
), totals AS (
  SELECT user_id, COUNT(*)::int AS completed_levels, SUM(time_ms)::int AS total_time_ms,
    MIN(time_ms)::int AS best_time_ms FROM personal_best GROUP BY user_id
), ranked AS (
  SELECT u.id, u.username, u.skill_rating, t.completed_levels, t.total_time_ms, t.best_time_ms,
    RANK() OVER (ORDER BY t.completed_levels DESC, t.total_time_ms ASC)::int AS rank
  FROM totals t JOIN users u ON u.id = t.user_id
)
SELECT * FROM ranked`

export function createApp({ pool, jwtSecret, clientOrigin = 'http://localhost:5173' }) {
  const app = express()
  app.disable('x-powered-by')
  app.use(cors({ origin: clientOrigin }))
  app.use(express.json({ limit: '512kb' }))
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  const signToken = user => jwt.sign({ sub: String(user.id) }, jwtSecret, { expiresIn: '7d' })
  const auth = route(async (req, _res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    let payload
    try { payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) }
    catch { throw fail(401, '登录已失效，请重新登录') }
    const { rows } = await pool.query('SELECT id, username, skill_rating, created_at FROM users WHERE id = $1', [payload.sub])
    if (!rows[0]) throw fail(401, '登录已失效，请重新登录')
    req.user = rows[0]
    next()
  })

  // Bound both brute-force work and replay validation cost per client address.
  const limits = new Map()
  function limit(bucket, maximum) {
    return (req, _res, next) => {
      const now = Date.now()
      for (const [key, item] of limits) if (item.until <= now) limits.delete(key)
      const key = `${bucket}:${req.ip}`
      const item = limits.get(key) || { count: 0, until: now + 60_000 }
      item.count++
      limits.set(key, item)
      next(item.count > maximum ? fail(429, '操作频繁，请一分钟后再试') : undefined)
    }
  }
  app.use('/api/auth', limit('auth', 30))

  app.get('/api/health', route(async (_req, res) => {
    await pool.query('SELECT 1')
    res.json({ ok: true, database: 'connected' })
  }))

  function credentials(body) {
    if (typeof body?.username !== 'string' || typeof body?.password !== 'string') throw fail(400, '请填写用户名和密码')
    const username = body.username.trim(), password = body.password
    if (!usernamePattern.test(username)) throw fail(400, '用户名需为 2-24 位中文、字母、数字或下划线')
    if (password.length < 6 || Buffer.byteLength(password, 'utf8') > 72) throw fail(400, '密码至少 6 位，UTF-8 长度最多 72 字节')
    return { username, password }
  }

  app.post('/api/auth/register', route(async (req, res) => {
    const { username, password } = credentials(req.body)
    const hash = await bcrypt.hash(password, 12)
    try {
      const { rows } = await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *', [username, hash])
      res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) })
    } catch (error) {
      if (error.code === '23505') throw fail(409, '这个用户名已经被注册')
      throw error
    }
  }))
  const dummyHash = bcrypt.hashSync(randomUUID(), 12)
  app.post('/api/auth/login', route(async (req, res) => {
    const { username, password } = credentials(req.body)
    const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username])
    const valid = await bcrypt.compare(password, rows[0]?.password_hash || dummyHash)
    if (!rows[0] || !valid) throw fail(401, '用户名或密码不正确')
    res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) })
  }))
  app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }))

  app.get('/api/progress', auth, route(async (req, res) => {
    const { rows } = await pool.query(`SELECT level, MIN(time_ms)::int AS best_time_ms FROM game_results
      WHERE user_id = $1 GROUP BY level ORDER BY level`, [req.user.id])
    const completed = rows.map(row => row.level)
    const nextLevel = Math.min(12, completed.length + 1)
    res.json({ completed, completed_levels: completed.length, nextLevel,
      best_time_ms: rows.length ? Math.min(...rows.map(r => r.best_time_ms)) : 0,
      total_time_ms: rows.reduce((total, r) => total + r.best_time_ms, 0),
      skillRating: req.user.skill_rating, recommended: difficultyFor(nextLevel, req.user.skill_rating) })
  }))
  app.get('/api/results/me', auth, route(async (req, res) => {
    const { rows } = await pool.query('SELECT id, level, time_ms, moves, difficulty, completed_at FROM game_results WHERE user_id = $1 ORDER BY completed_at DESC, id DESC LIMIT 50', [req.user.id])
    res.json({ results: rows })
  }))
  app.get('/api/leaderboard', route(async (_req, res) => {
    const { rows } = await pool.query(`${RANKING} ORDER BY rank, id LIMIT 100`)
    res.json({ leaderboard: rows })
  }))
  app.get('/api/ranking/me', auth, route(async (req, res) => {
    const { rows } = await pool.query(`${RANKING} WHERE id = $1`, [req.user.id])
    res.json({ ranking: rows[0] || null })
  }))

  async function transaction(fn) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }

  app.post('/api/attempts', auth, limit('start', 30), route(async (req, res) => {
    const level = req.body?.level
    if (!Number.isInteger(level) || level < 1 || level > 12) throw fail(400, '关卡不存在')
    const result = await transaction(async client => {
      const { rows: users } = await client.query('SELECT skill_rating FROM users WHERE id = $1 FOR UPDATE', [req.user.id])
      const { rows } = await client.query('SELECT COALESCE(MAX(level),0)::int AS highest FROM game_results WHERE user_id = $1', [req.user.id])
      if (level > rows[0].highest + 1) throw fail(403, '请先完成前面的关卡')
      // One active attempt per player. A second tab invalidates the previous run.
      const previous = await client.query(`UPDATE attempts SET status = 'abandoned', ended_at = NOW()
        WHERE user_id = $1 AND status = 'active' RETURNING level, started_at`, [req.user.id])
      let rating = users[0].skill_rating
      if (previous.rows.some(row => Date.now() - new Date(row.started_at).getTime() > 10_000)) rating = evaluateRating(rating, level, 0, 0, false)
      await client.query('UPDATE users SET skill_rating = $1 WHERE id = $2', [rating, req.user.id])
      const config = difficultyFor(level, rating)
      const id = randomUUID()
      await client.query('INSERT INTO attempts (id,user_id,level,config) VALUES ($1,$2,$3,$4)', [id,req.user.id,level,config])
      return { id, level, config, skillRating: rating }
    })
    res.status(201).json(result)
  }))

  app.post('/api/attempts/:id/abandon', auth, route(async (req, res) => {
    if (!uuidPattern.test(req.params.id)) throw fail(400, '无效的挑战编号')
    const rating = await transaction(async client => {
      const { rows: users } = await client.query('SELECT skill_rating FROM users WHERE id = $1 FOR UPDATE', [req.user.id])
      const { rows } = await client.query(`UPDATE attempts SET status = 'abandoned', ended_at = NOW()
        WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING *`, [req.params.id,req.user.id])
      let next = users[0].skill_rating
      if (rows[0] && Date.now() - new Date(rows[0].started_at).getTime() > 10_000) {
        next = evaluateRating(next, rows[0].level, 0, 0, false)
        await client.query('UPDATE users SET skill_rating = $1 WHERE id = $2', [next, req.user.id])
      }
      return next
    })
    res.json({ skillRating: rating })
  }))

  app.post('/api/results', auth, limit('results', 20), route(async (req, res) => {
    const { attemptId, ticks, inputs } = req.body || {}
    if (!uuidPattern.test(attemptId || '')) throw fail(400, '请先开始本关')
    const data = await transaction(async client => {
      const { rows: users } = await client.query('SELECT skill_rating FROM users WHERE id = $1 FOR UPDATE', [req.user.id])
      const { rows } = await client.query('SELECT * FROM attempts WHERE id = $1 AND user_id = $2 FOR UPDATE', [attemptId,req.user.id])
      const attempt = rows[0]
      if (!attempt) throw fail(404, '挑战记录不存在')
      // A retry after a lost response returns the saved result without double counting.
      if (attempt.status === 'completed') {
        const saved = await client.query('SELECT * FROM game_results WHERE attempt_id = $1', [attemptId])
        return { result: saved.rows[0], skillRating: users[0].skill_rating, alreadySaved: true }
      }
      if (attempt.status !== 'active') throw fail(409, '本次挑战已结束，请重新开始')
      const age = Date.now() - new Date(attempt.started_at).getTime()
      if (age > 24 * 60 * 60 * 1000) throw fail(410, '挑战记录已过期，请重新开始')
      let verified
      try { verified = validateReplay(attempt.level, attempt.config, ticks, inputs) }
      catch (error) { throw fail(400, error.message) }
      if (ticks * STEP_MS > age + 750) throw fail(400, '计时与服务端记录不符')
      const prior = await client.query('SELECT MIN(time_ms)::int AS best FROM game_results WHERE user_id = $1 AND level = $2', [req.user.id,attempt.level])
      const saved = await client.query(`INSERT INTO game_results (attempt_id,user_id,level,time_ms,moves,difficulty)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [attemptId,req.user.id,attempt.level,verified.timeMs,verified.moves,attempt.config.tier])
      const rating = evaluateRating(users[0].skill_rating, attempt.level, verified.timeMs, verified.moves, true)
      await client.query('UPDATE users SET skill_rating = $1 WHERE id = $2', [rating,req.user.id])
      await client.query("UPDATE attempts SET status = 'completed', ended_at = NOW() WHERE id = $1", [attemptId])
      return { result: saved.rows[0], isBest: !prior.rows[0].best || verified.timeMs < prior.rows[0].best, skillRating: rating }
    })
    res.status(data.alreadySaved ? 200 : 201).json(data)
  }))
  app.use((_req, res) => res.status(404).json({ message: '接口不存在' }))
  app.use((error, _req, res, _next) => {
    if (!error.status) console.error(error)
    res.status(error.status || 500).json({ message: error.status ? error.message : '服务暂不可用，请稍后重试' })
  })
  return app
}
