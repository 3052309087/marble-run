import test from 'node:test'
import assert from 'node:assert/strict'
import { LEVELS, difficultyFor, createState, step, validateReplay, evaluateRating, STEP_MS } from '../shared/game.js'

test('first level can be completed and replay produces the same time', () => {
  const config = difficultyFor(1,1000), state = createState(1,config)
  while (!state.won && state.tick < 10000) step(state,2)
  assert.ok(state.won)
  assert.equal(state.moves,0)
  assert.deepEqual(validateReplay(1,config,state.tick,[[0,2]]), { timeMs: Math.round(state.tick*STEP_MS), moves: 0 })
  assert.throws(() => validateReplay(1,config,100,[[0,0]]), /尚未抵达/)
  assert.throws(() => validateReplay(1,config,100,[[0,2],[0,4]]), /不合法/)
})

test('solid walls bounce the marble without tunneling', () => {
  const state = createState(1,difficultyFor(1,1400))
  state.marble.y = 70
  for (let i=0;i<1000;i++) step(state,2)
  assert.ok(state.moves > 0)
  assert.ok(state.marble.x < 190)
  assert.ok(!state.won)
})

test('fast clears raise the rating; slow clears and abandoned runs lower it', () => {
  assert.ok(evaluateRating(1000,1,8000,0,true) > 1000)
  assert.ok(evaluateRating(1000,1,120000,40,true) < 950)
  assert.ok(evaluateRating(1000,1,0,0,false) < 950)
  assert.equal(difficultyFor(1,850).tier,'assist')
  assert.equal(difficultyFor(1,1300).tier,'challenge')
  assert.ok(difficultyFor(12,1000).maxSpeed > difficultyFor(1,1000).maxSpeed)
})

test('all twelve layouts have a connected route for every difficulty', () => {
  // Flood-fill free positions with a margin at least as wide as the marble.
  for (const rating of [800,1000,1400]) for (let level=1;level<=LEVELS.length;level++) {
    const state = createState(level,difficultyFor(level,rating)), radius = state.marble.radius + 2
    const free = (x,y) => x>=radius && y>=radius && x<=760-radius && y<=480-radius && state.walls.every(w => Math.hypot(x-Math.max(w.x,Math.min(x,w.x+w.width)),y-Math.max(w.y,Math.min(y,w.y+w.height))) > radius)
    const queue = [[50,240]], seen = new Set(['50,240']); let reached = false
    for (let i=0;i<queue.length;i++) {
      const [x,y] = queue[i]
      if (Math.hypot(x-717,y-240)<21) { reached = true; break }
      for (const [dx,dy] of [[10,0],[-10,0],[0,10],[0,-10]]) {
        const nx=x+dx,ny=y+dy,key=`${nx},${ny}`
        if (!seen.has(key) && free(nx,ny)) { seen.add(key); queue.push([nx,ny]) }
      }
    }
    assert.ok(reached, `level ${level}, rating ${rating} is unreachable`)
  }
})
