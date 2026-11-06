export const WIDTH = 760
export const HEIGHT = 480
export const STEP_MS = 1000 / 120
export const MAX_TICKS = 120 * 60 * 15
export const LEVELS = [
  { name: '晨雾走廊', hint: '熟悉方向控制', walls: [[190, 0, 18, 175], [190, 305, 18, 175], [390, 0, 18, 105], [390, 375, 18, 105]] },
  { name: '双门峡谷', hint: '留意反弹角度', walls: [[155, 0, 18, 235], [155, 325, 18, 155], [325, 0, 18, 130], [325, 250, 18, 230], [520, 0, 18, 235], [520, 325, 18, 155]] },
  { name: '折线回廊', hint: '穿过三个转角', walls: [[150, 0, 18, 145], [150, 290, 18, 190], [295, 190, 18, 290], [440, 0, 18, 290], [585, 190, 18, 290]] },
  { name: '星环阵列', hint: '控制速度，避免碰撞', walls: [[130, 125, 150, 16], [130, 340, 150, 16], [330, 0, 16, 170], [330, 310, 16, 170], [520, 125, 150, 16], [520, 340, 150, 16]] },
  { name: '回声迷宫', hint: '每次撞墙都会改变节奏', walls: [[140, 0, 16, 115], [140, 260, 16, 220], [280, 105, 16, 260], [420, 0, 16, 115], [420, 260, 16, 220], [560, 105, 16, 260]] },
  { name: '月面裂隙', hint: '保持稳定的横向速度', walls: [[115, 90, 16, 300], [230, 0, 16, 180], [230, 300, 16, 180], [370, 90, 16, 300], [510, 0, 16, 180], [510, 300, 16, 180], [650, 90, 16, 300]] },
  { name: '脉冲走廊', hint: '狭窄路线考验判断', walls: [[110, 0, 16, 170], [110, 310, 16, 170], [250, 80, 16, 320], [390, 0, 16, 170], [390, 310, 16, 170], [530, 80, 16, 320], [670, 0, 16, 170], [670, 310, 16, 170]] },
  { name: '极光之门', hint: '节奏越来越快', walls: [[130, 0, 16, 250], [130, 340, 16, 140], [290, 0, 16, 140], [290, 230, 16, 250], [450, 0, 16, 250], [450, 340, 16, 140], [610, 0, 16, 140], [610, 230, 16, 250]] },
  { name: '穿梭线', hint: '连续变向即可过关', walls: [[95, 125, 125, 16], [95, 340, 125, 16], [280, 0, 16, 270], [280, 370, 16, 110], [430, 125, 125, 16], [430, 340, 125, 16], [615, 0, 16, 270], [615, 370, 16, 110]] },
  { name: '回旋塔', hint: '用最少碰撞抵达终点', walls: [[125, 0, 16, 160], [125, 320, 16, 160], [260, 160, 16, 320], [395, 0, 16, 320], [530, 160, 16, 320], [665, 0, 16, 320]] },
  { name: '深空折返', hint: '速度上限提高', walls: [[95, 0, 16, 215], [95, 325, 16, 155], [225, 110, 16, 370], [355, 0, 16, 215], [355, 325, 16, 155], [485, 110, 16, 370], [615, 0, 16, 215], [615, 325, 16, 155]] },
  { name: '终局·无界', hint: '完成全部 12 关', walls: [[90, 105, 120, 16], [90, 360, 120, 16], [250, 0, 16, 210], [250, 270, 16, 210], [410, 105, 120, 16], [410, 360, 120, 16], [570, 0, 16, 210], [570, 270, 16, 210]] }
]
export const PAR_SECONDS = [25,40,55,55,65,80,90,85,90,105,115,100]

// Fixed-step physics are shared by the client and API replay validator.
export function difficultyFor(level, rating) {
  const tier = rating < 950 ? 'assist' : rating >= 1200 ? 'challenge' : 'balanced'
  return {
    tier,
    label: { assist: '辅助节奏', balanced: '均衡节奏', challenge: '进阶节奏' }[tier],
    acceleration: (460 + level * 20) * (tier === 'assist' ? .85 : tier === 'challenge' ? 1.08 : 1),
    maxSpeed: (240 + level * 9) * (tier === 'assist' ? .8 : tier === 'challenge' ? 1.1 : 1),
    drag: tier === 'assist' ? 2.2 : tier === 'challenge' ? .75 : 1.25,
    radius: tier === 'assist' ? 8 : 10
  }
}

export function createState(level, config) {
  return {
    level, config, tick: 0, moves: 0, won: false,
    marble: { x: 47, y: 240, vx: 0, vy: 0, radius: config.radius },
    goal: { x: 717, y: 240, radius: 21 },
    walls: LEVELS[level - 1].walls.map(([x,y,width,height]) => ({ x,y,width,height }))
  }
}

// Input mask: left=1, right=2, up=4, down=8, brake=16.
export function step(state, mask) {
  if (state.won) return
  const dt = STEP_MS / 1000
  const ball = state.marble
  const { acceleration, maxSpeed, drag } = state.config
  ball.vx += (((mask & 2) ? 1 : 0) - ((mask & 1) ? 1 : 0)) * acceleration * dt
  ball.vy += (((mask & 8) ? 1 : 0) - ((mask & 4) ? 1 : 0)) * acceleration * dt
  const friction = Math.exp(-((mask & 16) ? 12 : drag) * dt)
  ball.vx *= friction
  ball.vy *= friction
  const speed = Math.hypot(ball.vx, ball.vy)
  if (speed > maxSpeed) { ball.vx *= maxSpeed / speed; ball.vy *= maxSpeed / speed }
  ball.x += ball.vx * dt
  ball.y += ball.vy * dt
  const r = ball.radius
  if (ball.x < r) { ball.x = r; ball.vx = Math.abs(ball.vx) * .8; state.moves++ }
  if (ball.x > WIDTH-r) { ball.x = WIDTH-r; ball.vx = -Math.abs(ball.vx) * .8; state.moves++ }
  if (ball.y < r) { ball.y = r; ball.vy = Math.abs(ball.vy) * .8; state.moves++ }
  if (ball.y > HEIGHT-r) { ball.y = HEIGHT-r; ball.vy = -Math.abs(ball.vy) * .8; state.moves++ }
  for (const wall of state.walls) {
    const x = Math.max(wall.x, Math.min(ball.x, wall.x + wall.width))
    const y = Math.max(wall.y, Math.min(ball.y, wall.y + wall.height))
    const dx = ball.x - x, dy = ball.y - y
    const distance = Math.hypot(dx, dy)
    if (distance >= r) continue
    let nx, ny, depth
    if (distance > 0) { nx = dx / distance; ny = dy / distance; depth = r - distance }
    else {
      const edges = [[ball.x-wall.x,-1,0], [wall.x+wall.width-ball.x,1,0], [ball.y-wall.y,0,-1], [wall.y+wall.height-ball.y,0,1]].sort((a,b) => a[0]-b[0])
      ;[depth,nx,ny] = edges[0]; depth += r
    }
    ball.x += nx * (depth + .001); ball.y += ny * (depth + .001)
    const normalSpeed = ball.vx * nx + ball.vy * ny
    if (normalSpeed < 0) {
      ball.vx -= 1.8 * normalSpeed * nx; ball.vy -= 1.8 * normalSpeed * ny
      state.moves++
    }
  }
  state.tick++
  state.won = Math.hypot(ball.x-state.goal.x, ball.y-state.goal.y) < state.goal.radius
}

export function evaluateRating(rating, level, timeMs, moves, completed) {
  const performance = completed
    ? Math.max(650, Math.min(1750, 1100 + (1 - timeMs / (PAR_SECONDS[level - 1] * 1000)) * 350 + level * 12 - Math.min(250, moves * 3)))
    : Math.max(600, rating - 260)
  return Math.round(Math.max(600, Math.min(1800, rating * .65 + performance * .35)))
}

export function validateReplay(level, config, ticks, inputs) {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 20000) throw new Error('无效的操作记录')
  let last = -1
  for (const event of inputs) {
    if (!Array.isArray(event) || event.length !== 2 || !Number.isInteger(event[0]) || event[0] <= last || event[0] >= ticks || !Number.isInteger(event[1]) || event[1] < 0 || event[1] > 31) throw new Error('操作序列不合法')
    last = event[0]
  }
  if (inputs[0][0] !== 0) throw new Error('操作记录不完整')
  const state = createState(level, config)
  let index = 0, mask = 0
  while (state.tick < ticks) {
    if (inputs[index]?.[0] === state.tick) mask = inputs[index++][1]
    step(state, mask)
    if (state.won) {
      if (state.tick !== ticks) throw new Error('通关时间与记录不符')
      return { timeMs: Math.round(state.tick * STEP_MS), moves: state.moves }
    }
  }
  throw new Error('尚未抵达终点，不能提交成绩')
}
