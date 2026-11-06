import test from 'node:test'
import assert from 'node:assert/strict'
import pg from '../server/node_modules/pg/lib/index.js'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createApp } from '../server/src/app.js'
import { createState, step } from '../shared/game.js'
import { databaseConfig } from './database-config.mjs'

test('PostgreSQL API: auth, level locks, validated results, retry, ranking, adaptation', async () => {
  const pool = new pg.Pool(databaseConfig())
  const schema = 'test_' + randomUUID().replaceAll('-','')
  await pool.query(`CREATE SCHEMA ${schema}`)
  const isolated = new pg.Pool({ ...databaseConfig(), options: `-c search_path=${schema}`, max: 5 })
  let server
  try {
    await isolated.query(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'))
    const app = createApp({ pool: isolated, jwtSecret: 'test-only-random-secret-that-is-long-enough' })
    server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',() => resolve(s)) })
    const base = `http://127.0.0.1:${server.address().port}/api`
    let token
    async function request(path, body, status=200) {
      const response = await fetch(base+path,{ method: body ? 'POST':'GET',headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) })
      const data = await response.json()
      assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`)
      return data
    }
    await request('/me',null,401)
    await request('/auth/register',{username:'Test',password:'x'},400)
    const account = await request('/auth/register',{username:'测试玩家',password:'test-secret'},201)
    await request('/auth/register',{username:'测试玩家',password:'test-secret'},409)
    await request('/auth/login',{username:'测试玩家',password:'wrong-password'},401)
    token = (await request('/auth/login',{username:'测试玩家',password:'test-secret'})).token
    assert.equal((await request('/ranking/me')).ranking,null)
    await request('/attempts',{level:2},403)
    const attempt = await request('/attempts',{level:1},201)
    const state = createState(1,attempt.config)
    while (!state.won) step(state,2)
    const replay = {attemptId:attempt.id,ticks:state.tick,inputs:[[0,2]]}
    await request('/results',{level:12,timeMs:1},400)
    await request('/results',{attemptId:attempt.id,ticks:100,inputs:[[0,0]]},400)
    await request('/results',replay,400) // unrealistically early submission
    await isolated.query("UPDATE attempts SET started_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[attempt.id])
    const saved = await request('/results',replay,201)
    assert.ok(saved.isBest)
    const retried = await request('/results',replay)
    assert.equal(retried.result.id,saved.result.id)
    assert.equal((await request('/results/me')).results.length,1)
    const progress = await request('/progress')
    assert.equal(progress.completed_levels,1)
    assert.equal(progress.nextLevel,2)
    const ranking = (await request('/ranking/me')).ranking
    assert.equal(ranking.rank,1)
    assert.equal(ranking.total_time_ms,saved.result.time_ms)
    const next = await request('/attempts',{level:2},201)
    await isolated.query("UPDATE attempts SET started_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[next.id])
    const before = (await request('/me')).user.skillRating
    const abandoned = await request(`/attempts/${next.id}/abandon`,{})
    assert.ok(abandoned.skillRating < before)
    const after = await request(`/attempts/${next.id}/abandon`,{})
    assert.equal(after.skillRating,abandoned.skillRating)
    await request('/results',{...replay,attemptId:next.id},409)
    // Repeat a level: distinct progress remains one and slower scores do not replace its best.
    const repeat = await request('/attempts',{level:1},201)
    const repeatState = createState(1,repeat.config)
    for (let i=0;i<120;i++) step(repeatState,0)
    while (!repeatState.won) step(repeatState,2)
    await isolated.query("UPDATE attempts SET started_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[repeat.id])
    await request('/results',{attemptId:repeat.id,ticks:repeatState.tick,inputs:[[0,0],[120,2]]},201)
    assert.equal((await request('/progress')).completed_levels,1)
    assert.equal((await request('/ranking/me')).ranking.total_time_ms,saved.result.time_ms)
    // Rank is computed across all players, even when this user falls outside the displayed top 100.
    for (let i=0;i<101;i++) {
      const other = await isolated.query('INSERT INTO users(username,password_hash) VALUES($1,$2) RETURNING id',[`rank${i}`,'fixture-only'])
      const id=randomUUID(), uid=other.rows[0].id
      await isolated.query("INSERT INTO attempts(id,user_id,level,config,status) VALUES($1,$2,1,'{}','completed')",[id,uid])
      await isolated.query("INSERT INTO game_results(attempt_id,user_id,level,time_ms,difficulty) VALUES($1,$2,1,1000,'balanced')",[id,uid])
    }
    assert.equal((await request('/leaderboard')).leaderboard.length,100)
    assert.equal((await request('/ranking/me')).ranking.rank,102)
    const passwords = await isolated.query('SELECT password_hash FROM users WHERE id=$1',[account.user.id])
    assert.ok(passwords.rows[0].password_hash.startsWith('$2'))
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    await isolated.end()
    await pool.query(`DROP SCHEMA ${schema} CASCADE`)
    await pool.end()
  }
})
