<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { LEVELS as levelDefinitions, difficultyFor, createState, step, STEP_MS, MAX_TICKS } from '../../shared/game.js'

const token = ref(localStorage.getItem('marble_token') || '')
const user = ref(null)
const activeView = ref('play')
const authMode = ref('login')
const authLoading = ref(false)
const authError = ref('')
const notice = ref('')
const authForm = reactive({ username: '', password: '' })
const progress = ref({ nextLevel: 1, completed: [], completed_levels: 0, best_time_ms: 0 })
const results = ref([])
const leaderboard = ref([])
const myRanking = ref(null)
const rankingError = ref('')
const isLoadingData = ref(false)
const starting = ref(false)
const canvas = ref(null)
const selectedLevel = ref(1)
const gameStatus = ref('idle')
const gameMessage = ref('准备好挑战了吗？')
const game = reactive({ level: 1, elapsed: 0, moves: 0, running: false, completed: false, isBest: false, walls: [], marble: {}, goal: {}, config: difficultyFor(1, 1000) })
const keys = { left: false, right: false, up: false, down: false, brake: false }
let simulation, attemptId, inputs = [], lastMask = -1, raf = 0, lastFrame = 0, accumulator = 0, noticeTimer
const currentDefinition = computed(() => levelDefinitions[game.level - 1])
const unlockedLevel = computed(() => Math.min(12, Math.max(1, progress.value.nextLevel)))
const gameTime = computed(() => formatTime(game.elapsed))
const hasSession = computed(() => Boolean(user.value && token.value))
const levelProgress = computed(() => progress.value.completed_levels / 12 * 100)
const saving = computed(() => gameStatus.value === 'saving')

function formatTime(ms) { return (Number(ms || 0) / 1000).toFixed(2).padStart(5, '0') }
function formatDate(value) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function levelName(level) { return levelDefinitions[level - 1]?.name }
function showNotice(message) { notice.value = message; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.value = '' }, 6000) }
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token.value) headers.Authorization = `Bearer ${token.value}`
  let response
  try { response = await fetch(`/api${path}`, { ...options, headers, signal: AbortSignal.timeout(20000) }) }
  catch { throw new Error('无法连接服务器，请检查本地服务是否运行') }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || '请求失败')
    error.status = response.status
    if (response.status === 401 && token.value && !path.startsWith('/auth/')) clearSession()
    throw error
  }
  return data
}
async function submitAuth() {
  authError.value = ''
  authLoading.value = true
  try {
    const data = await api(`/auth/${authMode.value}`, { method: 'POST', body: JSON.stringify(authForm) })
    token.value = data.token; user.value = data.user
    localStorage.setItem('marble_token', data.token)
    authForm.password = ''
    await loadData()
    selectedLevel.value = unlockedLevel.value
    setupBoard()
  } catch (error) { authError.value = error.message }
  finally { authLoading.value = false }
}
function clearSession() {
  stopGame(); token.value = ''; user.value = null; attemptId = null
  localStorage.removeItem('marble_token'); activeView.value = 'play'
  progress.value = { nextLevel: 1, completed: [], completed_levels: 0, best_time_ms: 0 }
  results.value = []; myRanking.value = null
}
async function logout() {
  if (saving.value || starting.value) return
  await abandonAttempt()
  clearSession()
}
async function loadData() {
  if (!token.value) return
  isLoadingData.value = true
  try {
    const [me, next, mine, rank] = await Promise.all([api('/me'), api('/progress'), api('/results/me'), api('/ranking/me')])
    user.value = me.user; progress.value = next; results.value = mine.results; myRanking.value = rank.ranking
  } catch (error) { showNotice(error.message) }
  finally { isLoadingData.value = false }
}
async function loadLeaderboard() {
  rankingError.value = ''
  try {
    const [all, mine] = await Promise.all([api('/leaderboard'), api('/ranking/me')])
    leaderboard.value = all.leaderboard; myRanking.value = mine.ranking
  } catch (error) { rankingError.value = error.message }
}
function syncGame() {
  game.marble = { ...simulation.marble }; game.goal = simulation.goal
  game.walls = simulation.walls; game.moves = simulation.moves
  game.elapsed = Math.round(simulation.tick * STEP_MS)
}
function setupBoard(level = selectedLevel.value) {
  stopGame(); game.level = level; selectedLevel.value = level
  game.completed = false; game.isBest = false; attemptId = null
  game.config = difficultyFor(level, user.value?.skillRating || 1000)
  simulation = createState(level, game.config)
  inputs = []; lastMask = -1; accumulator = 0
  gameStatus.value = 'idle'; gameMessage.value = currentDefinition.value.hint
  syncGame(); nextTick(drawBoard)
}
async function abandonAttempt() {
  stopGame()
  if (!attemptId || game.completed) return
  try {
    const data = await api(`/attempts/${attemptId}/abandon`, { method: 'POST', body: '{}' })
    if (user.value) user.value.skillRating = data.skillRating
  } catch (error) { showNotice(error.message) }
  attemptId = null
}
async function chooseLevel(level) {
  if (level > unlockedLevel.value || saving.value || starting.value) return
  starting.value = true
  try { await abandonAttempt(); setupBoard(level) }
  finally { starting.value = false }
}
async function startGame() {
  if (!hasSession.value || starting.value || saving.value || game.running) return
  if (gameStatus.value === 'paused') { resumeGame(); return }
  starting.value = true
  try {
    const data = await api('/attempts', { method: 'POST', body: JSON.stringify({ level: game.level }) })
    attemptId = data.id; game.config = data.config; user.value.skillRating = data.skillRating
    simulation = createState(game.level, data.config)
    inputs = []; lastMask = -1; accumulator = 0
    game.completed = false; gameStatus.value = 'running'; game.running = true
    syncGame(); lastFrame = performance.now(); raf = requestAnimationFrame(frame)
    if (activeView.value !== 'play' || document.hidden) pauseGame()
  } catch (error) { showNotice(error.message) }
  finally { starting.value = false }
}
function stopGame() {
  game.running = false; cancelAnimationFrame(raf)
  for (const key of Object.keys(keys)) keys[key] = false
}
function pauseGame() { if (game.running) { stopGame(); gameStatus.value = 'paused'; drawBoard() } }
function resumeGame() { gameStatus.value = 'running'; game.running = true; lastFrame = performance.now(); raf = requestAnimationFrame(frame) }
function frame(now) {
  if (!game.running) return
  const delta = now - lastFrame; lastFrame = now
  if (delta > 1000) { pauseGame(); return }
  accumulator += delta
  while (accumulator >= STEP_MS && !simulation.won) {
    const mask = (keys.left ? 1 : 0) | (keys.right ? 2 : 0) | (keys.up ? 4 : 0) | (keys.down ? 8 : 0) | (keys.brake ? 16 : 0)
    if (mask !== lastMask) { inputs.push([simulation.tick, mask]); lastMask = mask }
    step(simulation, mask); accumulator -= STEP_MS
    if (simulation.tick >= MAX_TICKS && !simulation.won) {
      syncGame(); stopGame(); gameStatus.value = 'timeout'; showNotice('本次挑战达到 15 分钟，可重新挑战'); return
    }
  }
  syncGame(); drawBoard()
  if (simulation.won) { finishGame(); return }
  raf = requestAnimationFrame(frame)
}
async function finishGame() {
  stopGame(); game.completed = true; gameStatus.value = 'saving'; gameMessage.value = '正在校验并保存成绩…'
  try {
    const data = await api('/results', { method: 'POST', body: JSON.stringify({ attemptId, ticks: simulation.tick, inputs }) })
    game.isBest = data.isBest; game.elapsed = data.result.time_ms; game.moves = data.result.moves
    if (user.value) user.value.skillRating = data.skillRating
    gameStatus.value = 'success'; gameMessage.value = data.isBest ? '个人最佳成绩已更新' : '成绩已保存'
    await loadData()
    showNotice(game.level === 12 ? '恭喜完成全部关卡！可查看最终排行榜。' : '成绩已保存，下一关已解锁')
  } catch (error) { gameStatus.value = 'save-error'; gameMessage.value = error.message }
  drawBoard()
}
function nextLevel() { chooseLevel(Math.min(12, game.level + 1)) }
function handleKey(event, pressed) {
  if (!hasSession.value || activeView.value !== 'play' || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName) || event.target?.isContentEditable) return
  const key = { arrowleft:'left', arrowright:'right', arrowup:'up', arrowdown:'down', a:'left', d:'right', w:'up', s:'down', ' ':'brake' }[event.key.toLowerCase()]
  if (event.key === 'Escape' && pressed) { pauseGame(); return }
  if (!key || !game.running) return
  event.preventDefault(); keys[key] = pressed
}
const keyDown = event => handleKey(event, true)
const keyUp = event => handleKey(event, false)
const visibility = () => { if (document.hidden) pauseGame() }
function setControl(event, key, value) {
  if (value && !game.running) return
  if (value) event.currentTarget.setPointerCapture(event.pointerId)
  keys[key] = value
}
function drawBoard() {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx || !simulation) return
  ctx.clearRect(0,0,760,480)
  const gradient = ctx.createLinearGradient(0,0,760,480)
  gradient.addColorStop(0,'#101934'); gradient.addColorStop(1,'#090f26')
  ctx.fillStyle = gradient; ctx.fillRect(0,0,760,480)
  ctx.strokeStyle = 'rgba(144,177,255,.08)'; ctx.lineWidth = 1
  for (let x=25;x<760;x+=40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,480); ctx.stroke() }
  for (let y=25;y<480;y+=40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(760,y); ctx.stroke() }
  for (const wall of game.walls) {
    const fill = ctx.createLinearGradient(wall.x,wall.y,wall.x+wall.width,wall.y+wall.height)
    fill.addColorStop(0,'#5b6cff'); fill.addColorStop(1,'#965bf1')
    ctx.fillStyle = fill; ctx.shadowColor = 'rgba(100,91,255,.55)'; ctx.shadowBlur = 14
    ctx.beginPath(); ctx.roundRect(wall.x,wall.y,wall.width,wall.height,6); ctx.fill(); ctx.shadowBlur = 0
  }
  ctx.beginPath(); ctx.arc(game.goal.x,game.goal.y,game.goal.radius,0,Math.PI*2)
  ctx.fillStyle = 'rgba(81,241,193,.18)'; ctx.fill(); ctx.strokeStyle = '#51f1c1'; ctx.lineWidth = 2; ctx.stroke()
  ctx.beginPath(); ctx.arc(game.goal.x,game.goal.y,8,0,Math.PI*2); ctx.fillStyle = '#d3fff3'; ctx.shadowColor = '#51f1c1'; ctx.shadowBlur = 18; ctx.fill(); ctx.shadowBlur = 0
  const b = game.marble
  const ballFill = ctx.createRadialGradient(b.x-4,b.y-5,2,b.x,b.y,b.radius)
  ballFill.addColorStop(0,'#fff9d1'); ballFill.addColorStop(.28,'#ffc76a'); ballFill.addColorStop(1,'#ff5f7a')
  ctx.beginPath(); ctx.arc(b.x,b.y,b.radius,0,Math.PI*2); ctx.fillStyle = ballFill; ctx.shadowColor = 'rgba(255,115,122,.8)'; ctx.shadowBlur = 18; ctx.fill(); ctx.shadowBlur = 0
}
watch(activeView, async view => {
  if (view !== 'play') { pauseGame(); await loadLeaderboard() }
  else { await nextTick(); drawBoard() }
})
watch(hasSession, async value => { if (value) { await nextTick(); drawBoard() } })
onMounted(async () => {
  window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp)
  window.addEventListener('blur', pauseGame); document.addEventListener('visibilitychange', visibility)
  setupBoard(1)
  if (token.value) { await loadData(); selectedLevel.value = unlockedLevel.value; setupBoard() }
})
onBeforeUnmount(() => {
  stopGame(); clearTimeout(noticeTimer)
  window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp)
  window.removeEventListener('blur', pauseGame); document.removeEventListener('visibilitychange', visibility)
})
</script>
<template>
  <div class="app-shell">
    <div class="ambient ambient-one"></div><div class="ambient ambient-two"></div>
    <header class="topbar">
      <button class="brand" @click="activeView = 'play'" aria-label="返回闯关实验室">
        <div class="brand-mark"><span></span><span></span><span></span></div>
        <div><strong>MARBLE<span>RUN</span></strong><small>弹珠撞墙实验室</small></div>
      </button>
      <nav v-if="hasSession" class="nav-tabs" aria-label="主导航">
        <button aria-label="闯关实验室" :class="{ active: activeView === 'play' }" @click="activeView = 'play'"><span>◈</span>闯关实验室</button>
        <button aria-label="全站排行榜" :class="{ active: activeView === 'leaderboard' }" @click="activeView = 'leaderboard'"><span>♛</span>全站排行榜</button>
      </nav>
      <div v-if="hasSession" class="account-chip">
        <div class="avatar">{{ user.username.slice(0, 1).toUpperCase() }}</div>
        <div><b>{{ user.username }}</b><small>RATING · {{ user.skillRating }}</small></div>
        <button class="logout" title="退出登录" aria-label="退出登录" :disabled="saving || starting" @click="logout">↗</button>
      </div>
    </header>
    <main v-if="!hasSession" class="auth-layout">
      <section class="hero-copy">
        <div class="eyebrow"><i></i> PHYSICS / REFLEX / FLOW</div>
        <h1>让每一次<br><em>撞墙</em>都算数。</h1>
        <p>掌控弹珠的速度与方向，穿越逐步升级的空间迷宫。留下你的最快时间，登上全站榜首。</p>
        <div class="hero-metrics"><div><strong>12</strong><span>渐进关卡</span></div><div><strong>∞</strong><span>挑战次数</span></div><div><strong>1</strong><span>终极排名</span></div></div>
      </section>
      <section class="auth-card">
        <div class="auth-card-top"><span class="card-kicker">PLAYER ACCESS</span><div class="live-dot"><i></i>本地挑战</div></div>
        <h2>{{ authMode === 'login' ? '欢迎回来' : '创建挑战档案' }}</h2>
        <p class="auth-subtitle">{{ authMode === 'login' ? '登录以同步你的闯关进度' : '注册后立即开始你的第一关' }}</p>
        <form @submit.prevent="submitAuth">
          <label>用户名<div class="input-wrap"><span>@</span><input aria-label="用户名" v-model="authForm.username" autocomplete="username" placeholder="输入你的玩家名" minlength="2" maxlength="24" required /></div></label>
          <label>密码<div class="input-wrap"><span>⌁</span><input aria-label="密码" v-model="authForm.password" type="password" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" placeholder="至少 6 位字符" minlength="6" maxlength="72" required /></div></label>
          <div v-if="authError" class="form-error" role="alert">{{ authError }}</div>
          <button class="primary-button full" type="submit" :disabled="authLoading"><span>{{ authLoading ? '连接中…' : authMode === 'login' ? '进入实验室' : '创建并开始' }}</span><b>→</b></button>
        </form>
        <button class="switch-auth" :disabled="authLoading" @click="authMode = authMode === 'login' ? 'register' : 'login'; authError = ''">{{ authMode === 'login' ? '还没有档案？ 创建一个' : '已有账号？ 返回登录' }}</button>
        <div class="auth-footer"><span>密码加密</span><span>进度保存</span><span>全站排名</span></div>
      </section>
    </main>
    <main v-else class="dashboard">
      <section v-if="activeView === 'play'" class="play-view">
        <div class="page-heading"><div><div class="eyebrow"><i></i> PLAYER / {{ user.username.toUpperCase() }}</div><h1>闯关实验室</h1><p>按表现匹配节奏，逐关解锁更复杂的路线。</p></div><div class="heading-status"><span class="status-pulse"></span>{{ isLoadingData ? '同步进度中' : '进度自动保存' }}</div></div>
        <div class="stats-row">
          <div class="stat-card"><span class="stat-icon purple">◈</span><div><small>当前水平分</small><strong>{{ user.skillRating }}</strong><em>{{ difficultyFor(selectedLevel, user.skillRating).label }}</em></div></div>
          <div class="stat-card"><span class="stat-icon mint">✓</span><div><small>已完成关卡</small><strong>{{ progress.completed_levels }}<i>/12</i></strong><em>{{ progress.completed_levels === 12 ? '全部通关' : '继续突破' }}</em></div></div>
          <button class="stat-card ranking-stat" @click="activeView = 'leaderboard'"><span class="stat-icon orange">♛</span><div><small>我的全站排名</small><strong>{{ myRanking ? '#' + myRanking.rank : '--' }}</strong><em>{{ myRanking ? '查看排行榜 →' : '完成首关后上榜' }}</em></div></button>
        </div>
        <div class="game-grid">
          <section class="game-card">
            <div class="game-card-head"><div><span class="card-kicker">ACTIVE COURSE · {{ game.config.label }}</span><h2>第 {{ game.level }} 关 <small>/ {{ currentDefinition.name }}</small></h2></div><div class="timer"><span>TIME</span><strong>{{ gameTime }}</strong><i>s</i></div></div>
            <div class="canvas-frame">
              <canvas ref="canvas" width="760" height="480" aria-label="弹珠迷宫：用方向键或 WASD 移动，空格刹车，进入绿色终点"></canvas>
              <div class="canvas-label start-label">START</div><div class="canvas-label goal-label">GOAL</div>
              <div v-if="gameStatus === 'idle'" class="canvas-overlay"><span class="overlay-orb">◈</span><b>准备发射</b><small>{{ gameMessage }}</small><button class="primary-button" :disabled="starting" @click="startGame">{{ starting ? '准备中…' : '开始本关' }} <b>→</b></button></div>
              <div v-if="gameStatus === 'paused'" class="canvas-overlay"><span class="overlay-orb">Ⅱ</span><b>已暂停计时</b><small>回到游戏，继续你的路线</small><button class="primary-button" @click="resumeGame">继续挑战 →</button></div>
              <div v-if="gameStatus === 'timeout'" class="canvas-overlay"><b>本次挑战已到时</b><small>休息一下，重新挑战</small><button class="primary-button" @click="chooseLevel(game.level)">重新挑战 →</button></div>
              <div v-if="['success','saving','save-error'].includes(gameStatus)" class="canvas-overlay success-overlay" aria-live="polite">
                <span class="overlay-orb success">{{ gameStatus === 'success' ? '✓' : '◷' }}</span>
                <b>{{ saving ? '校验成绩中' : gameStatus === 'save-error' ? '成绩尚未保存' : game.level === 12 ? '全部关卡完成！' : '关卡完成' }}</b><small>{{ gameMessage }}</small>
                <button v-if="gameStatus === 'save-error'" class="primary-button" @click="finishGame">重试保存 →</button>
                <button v-if="gameStatus === 'success' && game.level < 12" class="primary-button" :disabled="starting || game.level >= unlockedLevel" @click="nextLevel">挑战下一关 →</button>
                <button v-if="gameStatus === 'success' && game.level === 12" class="primary-button" @click="activeView = 'leaderboard'">查看最终排行榜 →</button>
              </div>
            </div>
            <div class="game-controls">
              <div class="control-tip"><span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span><small>方向键移动 · 空格刹车</small></div>
              <div class="touch-controls" aria-label="触屏方向控制">
                <button v-for="control in [{key:'left',label:'←',name:'向左'},{key:'up',label:'↑',name:'向上'},{key:'down',label:'↓',name:'向下'},{key:'right',label:'→',name:'向右'},{key:'brake',label:'■',name:'刹车'}]" :key="control.key" :aria-label="control.name" @pointerdown.prevent="setControl($event, control.key, true)" @pointerup="setControl($event, control.key, false)" @pointercancel="setControl($event, control.key, false)" @lostpointercapture="setControl($event, control.key, false)">{{ control.label }}</button>
              </div>
              <span class="moves-count">碰撞 <b>{{ game.moves }}</b></span>
            </div>
            <div class="game-actions"><span>抵达绿色光圈即可过关 · 单次上限 15 分钟</span><button v-if="game.running" @click="pauseGame">暂停</button><button :disabled="saving || starting" @click="chooseLevel(game.level)">重新挑战</button></div>
          </section>
          <aside class="levels-card">
            <div class="aside-title"><div><span class="card-kicker">PROGRESSION</span><h3>关卡进度</h3></div><span class="fraction">{{ progress.completed_levels }} <i>/ 12</i></span></div>
            <div class="progress-track"><span :style="{ width: `${levelProgress}%` }"></span></div><p class="level-note">完成当前关卡即可解锁下一段路线</p>
            <div class="level-list"><button v-for="(level, index) in levelDefinitions" :key="level.name" :class="{ selected: selectedLevel === index + 1, locked: index + 1 > unlockedLevel, done: progress.completed.includes(index + 1) }" :disabled="index + 1 > unlockedLevel || saving || starting" @click="chooseLevel(index + 1)"><span class="level-number">{{ progress.completed.includes(index + 1) ? '✓' : index + 1 > unlockedLevel ? '·' : String(index + 1).padStart(2, '0') }}</span><span><b>{{ level.name }}</b><small>{{ level.hint }}</small></span><i v-if="selectedLevel === index + 1">↗</i></button></div>
          </aside>
        </div>
        <section class="recent-card">
          <div class="recent-heading"><div><span class="card-kicker">PERSONAL LOG</span><h2>最近成绩</h2></div><button @click="activeView = 'leaderboard'">查看全站排名 <b>→</b></button></div>
          <div v-if="!results.length" class="empty-state"><span>◌</span><p>完成第一关后，你的成绩会出现在这里</p></div>
          <div v-else class="results-table"><div v-for="result in results.slice(0, 8)" :key="result.id" class="result-row"><span class="result-level">{{ String(result.level).padStart(2, '0') }}</span><b>{{ levelName(result.level) }}</b><span class="result-time">{{ formatTime(result.time_ms) }}<i>s</i></span><span class="result-moves">{{ result.moves }} 次碰撞</span><span class="result-date">{{ formatDate(result.completed_at) }}</span></div></div>
        </section>
      </section>
      <section v-else class="leaderboard-view">
        <div class="page-heading"><div><div class="eyebrow"><i></i> LOCAL / TOP 100</div><h1>全站排行榜</h1><p>完成关数越多越靠前；关数相同，比较各关最佳耗时总和。</p></div><div class="ranking-mark">♛</div></div>
        <div class="personal-rank"><span>我的全站排名 <b>{{ myRanking ? '#' + myRanking.rank : '暂未上榜' }}</b></span><span>通关 {{ myRanking?.completed_levels || 0 }}/12</span><span>最佳累计 <b>{{ myRanking ? formatTime(myRanking.total_time_ms) + 's' : '--' }}</b></span><span>{{ myRanking?.completed_levels === 12 ? '已完成最终挑战' : '完成全部 12 关，争夺最终名次' }}</span></div>
        <div class="leaderboard-shell">
          <div class="leaderboard-head"><div><span class="card-kicker">LIVE RANKING</span><h2>玩家排名</h2></div><button class="refresh-button" @click="loadLeaderboard">↻ 刷新</button></div>
          <div v-if="rankingError" class="form-error" role="alert">{{ rankingError }}</div>
          <div v-else-if="!leaderboard.length" class="empty-state big"><span>◌</span><p>还没有成绩，完成第一关即可上榜。</p></div>
          <div v-else class="leaderboard-table">
            <div class="table-header"><span>排名</span><span>玩家</span><span>水平分</span><span>完成关卡</span><span>最佳累计耗时</span></div>
            <div v-for="player in leaderboard" :key="player.id" class="leader-row" :class="{ 'is-me': player.id === user.id, champion: player.rank === 1 }"><span class="rank"><b v-if="player.rank < 4">{{ ['♛', '②', '③'][player.rank - 1] }}</b><i v-else>{{ String(player.rank).padStart(2, '0') }}</i></span><span class="player-cell"><span class="mini-avatar">{{ player.username.slice(0, 1).toUpperCase() }}</span><b>{{ player.username }}</b><em v-if="player.id === user.id">YOU</em></span><span class="rating">{{ player.skill_rating }}</span><span class="levels"><b>{{ player.completed_levels }}</b><i>/12</i><span class="mini-progress"><i :style="{ width: `${player.completed_levels / 12 * 100}%` }"></i></span></span><span class="best-time">{{ formatTime(player.total_time_ms) }}<i>s</i></span></div>
          </div>
        </div>
        <p class="ranking-explainer">每关仅取个人最好成绩，重玩不会增加通关数。总耗时相同则并列排名。所有适应性难度共用总榜，难度随水平自动调整。</p>
      </section>
    </main>
    <div v-if="notice" class="toast" role="status" @click="notice = ''"><span>✦</span>{{ notice }}</div>
    <footer><span>MARBLE RUN / 2026</span><span>BUILT FOR FOCUS &amp; FLOW</span></footer>
  </div>
</template>
