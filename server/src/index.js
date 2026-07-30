import express from 'express'
import {
  addMessage,
  addPlace,
  addPlayer,
  addVoter,
  addWheelPlayer,
  applyEloChanges,
  approvePlace,
  createForum,
  createRoom,
  deleteResult,
  createWheel,
  finalizeForumSpin,
  finalizeWheelSpin,
  forumExists,
  getForumAdminToken,
  getForumState,
  lockForum,
  pruneForums,
  removeMessage,
  removePlace,
  removeVoter,
  setForumSpinning,
  setVote,
  updateForumConfig,
  getAllResults,
  getLeaderboard,
  getPlayerRatingsMap,
  getResultsForRecalculation,
  getRoomState,
  getWheelState,
  pruneRooms,
  pruneWheels,
  removePlayer,
  removeWheelPlayer,
  resetElo,
  resetRoom,
  roomExists,
  saveResult,
  setSplit,
  setWheelPalette,
  setWheelSpinning,
  wheelExists,
} from './db.js'
import {
  RATING_FLOOR,
  buildMatchupHistory,
  computeEloChanges,
  computeMatchupShifts,
  decayedRating,
  graceDaysFor,
  initialRatingFor,
  predictWinProbabilities,
  resolvePlayers,
} from './elo.js'
import { computeFunFacts } from './funfacts.js'

const PORT = Number(process.env.PORT) || 8787
const MAX_NAME_LEN = 40
const MAX_PLAYERS = 64
const MAX_TEAMS = 12
const ROOM_TTL_MS = 24 * 60 * 60 * 1000 // rooms expire 24h after the last change
const SPIN_DURATION_MS = 3000 // must match the wheel's CSS transition on the client
const SPIN_GRACE_MS = 400 // small buffer before the server removes the winner

// Celebration animations the winner modal can play. The server picks one per
// spin so every connected client shows the exact same animation (kept in sync
// with CelebrationVariant in src/components/WinnerCelebration.vue).
const CELEBRATION_VARIANTS = [
  'confetti',
  'fireworks',
  'emoji-rain',
  'balloons',
  'sparkles',
  'bouncing-balls',
  'streamers',
  'bubbles',
  'shockwave',
  'laser-show',
]

const app = express()
app.use(express.json({ limit: '16kb' }))

// --- SSE fan-out --------------------------------------------------------------
// roomId -> Set of open response streams. Every mutation broadcasts fresh state
// so each connected device sees check-ins and team splits live.
const subscribers = new Map()

function broadcast(roomId) {
  const streams = subscribers.get(roomId)
  if (!streams || streams.size === 0) return
  const state = getRoomState(roomId)
  const payload = `data: ${JSON.stringify(state)}\n\n`
  for (const res of streams) res.write(payload)
}

// wheelId -> Set of open response streams (separate fan-out from matchmaking).
const wheelSubscribers = new Map()
// wheelId -> finalize timeout, so a new spin or deletion can clear a pending one.
const spinTimers = new Map()

function broadcastWheel(wheelId) {
  const streams = wheelSubscribers.get(wheelId)
  if (!streams || streams.size === 0) return
  const state = getWheelState(wheelId)
  const payload = `data: ${JSON.stringify(state)}\n\n`
  for (const res of streams) res.write(payload)
}

// forumId -> Set of open response streams (Friday Food Forum live voting).
const forumSubscribers = new Map()
// forumId -> finalize timeout for a running spin.
const forumSpinTimers = new Map()

function broadcastForum(forumId) {
  const streams = forumSubscribers.get(forumId)
  if (!streams || streams.size === 0) return
  const state = getForumState(forumId)
  const payload = `data: ${JSON.stringify(state)}\n\n`
  for (const res of streams) res.write(payload)
}

function normalizeName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
}

function shuffle(arr) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Split players into `teamCount` balanced teams (round-robin after shuffle). */
function splitIntoTeams(players, teamCount) {
  const teams = Array.from({ length: teamCount }, () => [])
  shuffle(players).forEach((player, index) => {
    teams[index % teamCount].push(player.name)
  })
  return teams
}

// --- Routes -------------------------------------------------------------------
app.post('/api/rooms', (_req, res) => {
  const id = createRoom()
  res.status(201).json({ id })
})

app.get('/api/rooms/:id', (req, res) => {
  const state = getRoomState(req.params.id)
  if (!state) return res.status(404).json({ error: 'Room not found' })
  res.json(state)
})

/**
 * Win probabilities plus the matchup history behind them, aligned to team order.
 * `teams` may be plain lineups (string[][]) or stored team objects. Every stored
 * result is replayed to build the history index, the same on-demand replay the
 * results and leaderboard endpoints already do.
 */
function predictionFor(teams) {
  const lineups = teams.map((t) => (Array.isArray(t) ? t : resolvePlayers(t)))
  const history = buildMatchupHistory(getResultsForRecalculation())
  return {
    probabilities: predictWinProbabilities(lineups, getPlayerRatingsMap(), history),
    insights: computeMatchupShifts(lineups, history),
  }
}

// Predicted win probability per team once a room has been split. Probabilities
// are aligned to the room's team order and sum to 1; empty when not yet split.
app.get('/api/rooms/:id/prediction', (req, res) => {
  const state = getRoomState(req.params.id)
  if (!state) return res.status(404).json({ error: 'Room not found' })
  if (state.status !== 'split' || !state.teams) return res.json({ probabilities: [], insights: [] })
  res.json(predictionFor(state.teams))
})

// Predicted win probability for an ad-hoc set of team lineups (no room needed),
// e.g. the home-page pair split. Body: { teams: string[][] }. Probabilities are
// aligned to the input order and sum to 1.
app.post('/api/predict', (req, res) => {
  const { teams } = req.body || {}
  if (!Array.isArray(teams) || teams.length < 2) {
    return res.status(400).json({ error: 'At least 2 teams required' })
  }
  const lineups = teams.map((t) => (Array.isArray(t) ? t.filter((n) => typeof n === 'string') : []))
  res.json(predictionFor(lineups))
})

app.get('/api/rooms/:id/events', (req, res) => {
  const { id } = req.params
  if (!roomExists(id)) return res.status(404).end()

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })
  res.write('retry: 3000\n\n')
  res.write(`data: ${JSON.stringify(getRoomState(id))}\n\n`)

  let streams = subscribers.get(id)
  if (!streams) {
    streams = new Set()
    subscribers.set(id, streams)
  }
  streams.add(res)

  // Comment ping keeps proxies from closing an idle connection.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000)

  req.on('close', () => {
    clearInterval(ping)
    streams.delete(res)
    if (streams.size === 0) subscribers.delete(id)
  })
})

app.post('/api/rooms/:id/players', (req, res) => {
  const { id } = req.params
  if (!roomExists(id)) return res.status(404).json({ error: 'Room not found' })

  const name = normalizeName(req.body?.name)
  if (!name) return res.status(400).json({ error: 'Name is required' })
  if (name.length > MAX_NAME_LEN) return res.status(400).json({ error: 'Name is too long' })

  const state = getRoomState(id)
  const existing = state.players.find((p) => p.name === name)
  if (!existing && state.players.length >= MAX_PLAYERS) {
    return res.status(409).json({ error: 'Room is full' })
  }

  const player = addPlayer(id, name)
  broadcast(id)
  res.status(201).json({ player, room: getRoomState(id) })
})

app.delete('/api/rooms/:id/players/:playerId', (req, res) => {
  const { id, playerId } = req.params
  if (!roomExists(id)) return res.status(404).json({ error: 'Room not found' })
  removePlayer(id, playerId)
  broadcast(id)
  res.json(getRoomState(id))
})

app.post('/api/rooms/:id/split', (req, res) => {
  const { id } = req.params
  const state = getRoomState(id)
  if (!state) return res.status(404).json({ error: 'Room not found' })

  const requested = Number(req.body?.teamCount) || 2
  if (state.players.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 players to split' })
  }
  // Never make more teams than players, and clamp to a sane ceiling.
  const teamCount = Math.max(2, Math.min(requested, MAX_TEAMS, state.players.length))

  const teams = splitIntoTeams(state.players, teamCount)
  setSplit(id, teamCount, teams)
  broadcast(id)
  res.json(getRoomState(id))
})

app.post('/api/rooms/:id/reset', (req, res) => {
  const { id } = req.params
  if (!roomExists(id)) return res.status(404).json({ error: 'Room not found' })
  resetRoom(id)
  broadcast(id)
  res.json(getRoomState(id))
})

// --- Spin the Wheel -----------------------------------------------------------
app.post('/api/wheels', (_req, res) => {
  const id = createWheel()
  res.status(201).json({ id })
})

app.get('/api/wheels/:id', (req, res) => {
  const state = getWheelState(req.params.id)
  if (!state) return res.status(404).json({ error: 'Wheel not found' })
  res.json(state)
})

app.get('/api/wheels/:id/events', (req, res) => {
  const { id } = req.params
  if (!wheelExists(id)) return res.status(404).end()

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })
  res.write('retry: 3000\n\n')
  res.write(`data: ${JSON.stringify(getWheelState(id))}\n\n`)

  let streams = wheelSubscribers.get(id)
  if (!streams) {
    streams = new Set()
    wheelSubscribers.set(id, streams)
  }
  streams.add(res)

  const ping = setInterval(() => res.write(': ping\n\n'), 25000)

  req.on('close', () => {
    clearInterval(ping)
    streams.delete(res)
    if (streams.size === 0) wheelSubscribers.delete(id)
  })
})

app.post('/api/wheels/:id/players', (req, res) => {
  const { id } = req.params
  if (!wheelExists(id)) return res.status(404).json({ error: 'Wheel not found' })

  const name = normalizeName(req.body?.name)
  if (!name) return res.status(400).json({ error: 'Name is required' })
  if (name.length > MAX_NAME_LEN) return res.status(400).json({ error: 'Name is too long' })

  const state = getWheelState(id)
  const existing = state.players.find((p) => p.name === name)
  if (!existing && state.players.length >= MAX_PLAYERS) {
    return res.status(409).json({ error: 'Wheel is full' })
  }

  const player = addWheelPlayer(id, name)
  broadcastWheel(id)
  res.status(201).json({ player, wheel: getWheelState(id) })
})

app.delete('/api/wheels/:id/players/:playerId', (req, res) => {
  const { id, playerId } = req.params
  if (!wheelExists(id)) return res.status(404).json({ error: 'Wheel not found' })
  removeWheelPlayer(id, playerId)
  broadcastWheel(id)
  res.json(getWheelState(id))
})

app.post('/api/wheels/:id/palette', (req, res) => {
  const { id } = req.params
  if (!wheelExists(id)) return res.status(404).json({ error: 'Wheel not found' })
  setWheelPalette(id, Boolean(req.body?.dativa))
  broadcastWheel(id)
  res.json(getWheelState(id))
})

app.post('/api/wheels/:id/spin', (req, res) => {
  const { id } = req.params
  const state = getWheelState(id)
  if (!state) return res.status(404).json({ error: 'Wheel not found' })
  if (state.status === 'spinning') {
    return res.status(409).json({ error: 'Wheel is already spinning' })
  }
  if (state.players.length < 1) {
    return res.status(400).json({ error: 'Add someone to the wheel first' })
  }

  // Server decides the winner so every client lands on the same result. The
  // rotation math mirrors the client wheel: pointer sits at 90° (3 o'clock).
  const winnerIndex = Math.floor(Math.random() * state.players.length)
  const winnerName = state.players[winnerIndex].name
  const segmentAngle = 360 / state.players.length
  const centerAngle = segmentAngle * winnerIndex + segmentAngle / 2
  const pointerAngle = 90
  const targetWithinTurn = (((pointerAngle - centerAngle - state.rotation) % 360) + 360) % 360
  const rotation = state.rotation + 360 * 6 + targetWithinTurn
  const startedAt = Date.now()
  const spinId = `${id}-${startedAt}`
  // Pick the celebration here so every client reveals the same animation.
  const celebration = CELEBRATION_VARIANTS[Math.floor(Math.random() * CELEBRATION_VARIANTS.length)]

  setWheelSpinning(id, { rotation, winnerName, winnerIndex, spinId, startedAt, celebration })
  broadcastWheel(id)

  // After the animation, remove the winner and return to idle (server-side so it
  // happens once and stays in sync regardless of which clients are connected).
  const existing = spinTimers.get(id)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    spinTimers.delete(id)
    finalizeWheelSpin(id)
    broadcastWheel(id)
  }, SPIN_DURATION_MS + SPIN_GRACE_MS)
  timer.unref?.()
  spinTimers.set(id, timer)

  res.json(getWheelState(id))
})

// --- Friday Food Forum --------------------------------------------------------
// The forum creator gets an admin token (returned once, kept in their browser).
// Admin-only actions require it; voting is open to anyone with the link.
function isForumAdmin(forumId, req) {
  const token = req.get('x-admin-token') || req.body?.adminToken
  return Boolean(token) && token === getForumAdminToken(forumId)
}

function loadForum(req, res) {
  if (!forumExists(req.params.id)) {
    res.status(404).json({ error: 'Forum not found' })
    return null
  }
  return getForumState(req.params.id)
}

function requireForumAdmin(req, res) {
  if (!isForumAdmin(req.params.id, req)) {
    res.status(403).json({ error: 'Admin token required' })
    return false
  }
  return true
}

/**
 * The places that go on the wheel, with a weight each. 'weighted' gives every
 * place with votes a slice proportional to its votes (an even split before any
 * votes); 'tied' keeps only the top-voted places at equal odds. Mirrors
 * forumWheelPool() on the client so the spin lands where the wheel shows.
 */
function forumWheelPool(state) {
  const places = state.places.filter((p) => p.approved)
  if (places.length === 0) return []
  const maxVotes = Math.max(...places.map((p) => p.votes))
  if (state.wheelMode === 'tied') {
    return places.filter((p) => p.votes === maxVotes).map((p) => ({ name: p.name, weight: 1 }))
  }
  const hasVotes = maxVotes > 0
  return places
    .filter((p) => (hasVotes ? p.votes > 0 : true))
    .map((p) => ({ name: p.name, weight: hasVotes ? p.votes : 1 }))
}

app.post('/api/forums', (req, res) => {
  const selectionMode = req.body?.selectionMode === 'multi' ? 'multi' : 'single'
  const wheelMode = req.body?.wheelMode === 'tied' ? 'tied' : 'weighted'
  const { id, adminToken } = createForum({ selectionMode, wheelMode })
  res.status(201).json({ id, adminToken })
})

app.get('/api/forums/:id', (req, res) => {
  const state = loadForum(req, res)
  if (state) res.json(state)
})

app.get('/api/forums/:id/events', (req, res) => {
  const { id } = req.params
  if (!forumExists(id)) return res.status(404).end()

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })
  res.write('retry: 3000\n\n')
  res.write(`data: ${JSON.stringify(getForumState(id))}\n\n`)

  let streams = forumSubscribers.get(id)
  if (!streams) {
    streams = new Set()
    forumSubscribers.set(id, streams)
  }
  streams.add(res)

  const ping = setInterval(() => res.write(': ping\n\n'), 25000)

  req.on('close', () => {
    clearInterval(ping)
    streams.delete(res)
    if (streams.size === 0) forumSubscribers.delete(id)
  })
})

app.post('/api/forums/:id/voters', (req, res) => {
  const state = loadForum(req, res)
  if (!state) return
  const name = normalizeName(req.body?.name)
  if (!name) return res.status(400).json({ error: 'Name is required' })
  if (name.length > MAX_NAME_LEN) return res.status(400).json({ error: 'Name is too long' })
  if (!state.voters.some((v) => v.name === name) && state.voters.length >= MAX_PLAYERS) {
    return res.status(409).json({ error: 'Forum is full' })
  }
  const voter = addVoter(req.params.id, name)
  broadcastForum(req.params.id)
  res.status(201).json({ voter, forum: getForumState(req.params.id) })
})

// Self-leave or admin kick (removed user can rejoin with the link).
app.delete('/api/forums/:id/voters/:voterId', (req, res) => {
  if (!forumExists(req.params.id)) return res.status(404).json({ error: 'Forum not found' })
  removeVoter(req.params.id, req.params.voterId)
  broadcastForum(req.params.id)
  res.json(getForumState(req.params.id))
})

app.post('/api/forums/:id/places', (req, res) => {
  const state = loadForum(req, res)
  if (!state) return
  // Admins can always add; others only when the admin has opened up suggestions.
  const admin = isForumAdmin(req.params.id, req)
  if (!admin && !state.allowSuggestions) {
    return res.status(403).json({ error: 'Suggestions are closed' })
  }
  const name = normalizeName(req.body?.name)
  if (!name) return res.status(400).json({ error: 'Name is required' })
  if (name.length > MAX_NAME_LEN) return res.status(400).json({ error: 'Name is too long' })
  // Admin adds go live immediately; suggestions wait for approval.
  addPlace(req.params.id, name, admin ? 1 : 0)
  broadcastForum(req.params.id)
  res.status(201).json(getForumState(req.params.id))
})

app.post('/api/forums/:id/places/:placeId/approve', (req, res) => {
  if (!forumExists(req.params.id)) return res.status(404).json({ error: 'Forum not found' })
  if (!requireForumAdmin(req, res)) return
  approvePlace(req.params.id, req.params.placeId)
  broadcastForum(req.params.id)
  res.json(getForumState(req.params.id))
})

app.delete('/api/forums/:id/places/:placeId', (req, res) => {
  if (!forumExists(req.params.id)) return res.status(404).json({ error: 'Forum not found' })
  if (!requireForumAdmin(req, res)) return
  removePlace(req.params.id, req.params.placeId)
  broadcastForum(req.params.id)
  res.json(getForumState(req.params.id))
})

app.put('/api/forums/:id/votes', (req, res) => {
  const state = loadForum(req, res)
  if (!state) return
  if (state.status !== 'open') return res.status(409).json({ error: 'Voting is closed' })
  const { voterId } = req.body || {}
  const placeIds = Array.isArray(req.body?.placeIds) ? req.body.placeIds : []
  try {
    if (!setVote(req.params.id, voterId, placeIds)) {
      return res.status(404).json({ error: 'Join the forum before voting' })
    }
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  broadcastForum(req.params.id)
  res.json(getForumState(req.params.id))
})

app.patch('/api/forums/:id/config', (req, res) => {
  if (!forumExists(req.params.id)) return res.status(404).json({ error: 'Forum not found' })
  if (!requireForumAdmin(req, res)) return
  const body = req.body || {}
  const selectionMode = body.selectionMode === 'multi' || body.selectionMode === 'single' ? body.selectionMode : undefined
  const wheelMode = body.wheelMode === 'weighted' || body.wheelMode === 'tied' ? body.wheelMode : undefined
  const dativa = typeof body.dativaColors === 'boolean' ? body.dativaColors : undefined
  const allowSuggestions = typeof body.allowSuggestions === 'boolean' ? body.allowSuggestions : undefined
  // deadlineMinutes: positive number sets a timer from now; 0/null clears it.
  let deadlineAt
  if ('deadlineMinutes' in body) {
    const mins = Number(body.deadlineMinutes)
    deadlineAt = Number.isFinite(mins) && mins > 0 ? Date.now() + mins * 60 * 1000 : null
  }
  updateForumConfig(req.params.id, { selectionMode, wheelMode, deadlineAt, dativa, allowSuggestions })
  broadcastForum(req.params.id)
  res.json(getForumState(req.params.id))
})

app.post('/api/forums/:id/messages', (req, res) => {
  const state = loadForum(req, res)
  if (!state) return
  // Only joined voters can chat (they entered a name to get in).
  const voter = state.voters.find((v) => v.id === req.body?.voterId)
  if (!voter) return res.status(403).json({ error: 'Join the forum before chatting' })
  const body = normalizeName(req.body?.body)
  if (!body) return res.status(400).json({ error: 'Message is empty' })
  addMessage(req.params.id, voter.name, body) // body is capped server-side
  broadcastForum(req.params.id)
  res.status(201).json(getForumState(req.params.id))
})

app.delete('/api/forums/:id/messages/:messageId', (req, res) => {
  if (!forumExists(req.params.id)) return res.status(404).json({ error: 'Forum not found' })
  if (!requireForumAdmin(req, res)) return
  removeMessage(req.params.id, req.params.messageId)
  broadcastForum(req.params.id)
  res.json(getForumState(req.params.id))
})

app.post('/api/forums/:id/lock', (req, res) => {
  if (!forumExists(req.params.id)) return res.status(404).json({ error: 'Forum not found' })
  if (!requireForumAdmin(req, res)) return
  lockForum(req.params.id)
  broadcastForum(req.params.id)
  res.json(getForumState(req.params.id))
})

// Spin the tie-breaker. The admin can spin any time; once the timer locks the
// forum, anyone can. The wheel slices are proportional to the live vote weights,
// computed identically here and on the client (votes are frozen during a spin,
// so both agree on the layout the pointer lands in — see forumWheelPool in
// src/pages/FoodForumSessionPage.vue).
app.post('/api/forums/:id/spin', (req, res) => {
  const state = loadForum(req, res)
  if (!state) return
  if (!isForumAdmin(req.params.id, req) && state.status !== 'locked') {
    return res.status(403).json({ error: 'Wait for the timer, or ask the admin to spin' })
  }
  if (state.status === 'spinning') return res.status(409).json({ error: 'Already spinning' })
  const pool = forumWheelPool(state)
  if (pool.length < 1) return res.status(400).json({ error: 'Add at least one place first' })

  const total = pool.reduce((sum, seg) => sum + seg.weight, 0)
  let roll = Math.random() * total
  let winnerIndex = pool.findIndex((seg) => (roll -= seg.weight) < 0)
  if (winnerIndex < 0) winnerIndex = pool.length - 1
  const winnerName = pool[winnerIndex].name

  // Land the chosen slice's centre under the pointer (90°, 3 o'clock). Slice
  // angles are proportional to weight, accumulated from 0°.
  let before = 0
  for (let i = 0; i < winnerIndex; i++) before += pool[i].weight
  const centerAngle = ((before + pool[winnerIndex].weight / 2) / total) * 360
  const pointerAngle = 90
  const targetWithinTurn = (((pointerAngle - centerAngle - state.rotation) % 360) + 360) % 360
  const rotation = state.rotation + 360 * 6 + targetWithinTurn
  const startedAt = Date.now()
  const spinId = `${req.params.id}-${startedAt}`
  const celebration = CELEBRATION_VARIANTS[Math.floor(Math.random() * CELEBRATION_VARIANTS.length)]

  setForumSpinning(req.params.id, { rotation, winnerName, winnerIndex, spinId, startedAt, celebration })
  broadcastForum(req.params.id)

  const existing = forumSpinTimers.get(req.params.id)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    forumSpinTimers.delete(req.params.id)
    finalizeForumSpin(req.params.id)
    broadcastForum(req.params.id)
  }, SPIN_DURATION_MS + SPIN_GRACE_MS)
  timer.unref?.()
  forumSpinTimers.set(req.params.id, timer)

  res.json(getForumState(req.params.id))
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// --- Game Results -------------------------------------------------------------
app.get('/api/results', (_req, res) => {
  const eloByResult = computeResultEloDeltas()
  res.json(getAllResults().map((r) => ({ ...r, teamElo: eloByResult.get(r.id) ?? null })))
})

app.post('/api/results', (req, res) => {
  const { teams, source } = req.body || {}
  if (!Array.isArray(teams) || teams.length < 2) {
    return res.status(400).json({ error: 'At least 2 teams required' })
  }
  for (const team of teams) {
    if (typeof team.score !== 'number' || team.score < 0) {
      return res.status(400).json({ error: 'Each team must have a valid score' })
    }
  }
  if (teams.every((t) => t.score === 0)) {
    return res.status(400).json({ error: 'All-zero scores are not a valid result' })
  }
  const maxScore = Math.max(...teams.map((t) => t.score))
  const topTeams = teams.filter((t) => t.score === maxScore)
  const winnerName = topTeams
    .map((t, i) => t.name || `Team ${teams.indexOf(t) + 1}`)
    .join(' & ')
  const entry = saveResult({ teams, winner: winnerName, source: source || 'custom' })

  // Update ELO ratings based on this result. Ratings are decayed up to the
  // moment of the game first, so the delta builds on the inactivity-adjusted base.
  try {
    const currentRatings = getPlayerRatingsMap(entry.createdAt)
    const changes = computeEloChanges(teams, currentRatings)
    if (changes.size > 0) applyEloChanges(changes, entry.createdAt)
  } catch (err) {
    console.error('ELO update failed:', err)
  }

  const { createdAt: _omit, ...response } = entry
  res.status(201).json(response)
})

app.delete('/api/results/:id', (req, res) => {
  const deleted = deleteResult(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'Result not found' })
  recalculateElo()
  res.json({ ok: true })
})

app.get('/api/elo', (_req, res) => {
  res.json(getLeaderboardWithDailyChange())
})

// --- Gambling -----------------------------------------------------------------
// ELO gambling is temporarily disabled. The feature and its stored history are
// kept intact, but the endpoints respond with a maintenance object and no longer
// touch ratings — gambling no longer folds into the leaderboard or daily change.
const GAMBLE_MAINTENANCE = {
  maintenance: true,
  message: 'ELO gambling is temporarily under maintenance.',
}

app.get('/api/gamble/history', (_req, res) => {
  res.status(503).json(GAMBLE_MAINTENANCE)
})

app.post('/api/gamble', (_req, res) => {
  res.status(503).json(GAMBLE_MAINTENANCE)
})

app.get('/api/funfacts', (req, res) => {
  try {
    // Optional game-format filter: only 2-team or 3-team games (default: all).
    // Facts are replayed over just the matching games, so each view is a
    // self-consistent "what if only this format existed" replay (peak ELO, biggest
    // gain, etc. are recomputed, not sliced from the real ratings). The decay-aware
    // reigning champion is a whole-system concept, so the filtered views pass an
    // empty leaderboard and simply omit it.
    const mode = req.query.mode === '2team' ? 2 : req.query.mode === '3team' ? 3 : 'all'
    const allResults = getResultsForRecalculation()
    const results =
      mode === 'all'
        ? allResults
        : allResults.filter((r) => Array.isArray(r.teams) && r.teams.length === mode)
    const leaderboard = mode === 'all' ? getLeaderboard() : []
    const facts = computeFunFacts(results, leaderboard)
    res.json(facts)
  } catch (err) {
    console.error('Fun facts computation failed:', err)
    res.status(500).json({ error: 'Could not compute fun facts' })
  }
})

// Epoch ms for the most recent local midnight (start of "today").
function startOfTodayMs() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Replay every result that happened strictly before `cutoff` into an in-memory
 * ratings map, mirroring applyEloChanges/getPlayerRatingsMap without touching
 * the DB. Used to reconstruct the leaderboard as it stood at a past instant.
 */
function ratingsAsOf(cutoff) {
  const state = new Map() // name -> { rating, gamesPlayed, wins, winStreak, lastPlayedAt }
  for (const { teams, playedAt } of getResultsForRecalculation()) {
    if (playedAt >= cutoff) break // results come back sorted ascending by time
    const current = new Map()
    for (const [name, r] of state) {
      current.set(name, {
        rating: decayedRating(r.rating, r.lastPlayedAt, playedAt, graceDaysFor(name)),
        gamesPlayed: r.gamesPlayed,
        winStreak: r.winStreak,
      })
    }
    const changes = computeEloChanges(teams, current)
    for (const [name, { delta, won }] of changes) {
      const prev = state.get(name)
      const base = prev
        ? decayedRating(prev.rating, prev.lastPlayedAt, playedAt, graceDaysFor(name))
        : initialRatingFor(name)
      state.set(name, {
        rating: Math.max(RATING_FLOOR, base + delta),
        gamesPlayed: (prev?.gamesPlayed ?? 0) + 1,
        wins: (prev?.wins ?? 0) + (won ? 1 : 0),
        // Mirror applyEloChanges: extend on a win, reset on any non-win.
        winStreak: won ? (prev?.winStreak ?? 0) + 1 : 0,
        lastPlayedAt: playedAt,
      })
    }
  }
  return state
}

/**
 * ELO each team banked per game: result id -> array aligned with that result's
 * teams (null for anonymous teams). Mean of the team's players, which only
 * differs per player when their K-factors or streaks do. Same replay as
 * recalculateElo, decay and floor included, so it agrees with the ladder.
 */
function computeResultEloDeltas() {
  const state = new Map() // name -> { rating, gamesPlayed, winStreak, lastPlayedAt }
  const byResult = new Map()
  for (const { id, teams, playedAt } of getResultsForRecalculation()) {
    const current = new Map()
    for (const [name, r] of state) {
      current.set(name, {
        rating: decayedRating(r.rating, r.lastPlayedAt, playedAt, graceDaysFor(name)),
        gamesPlayed: r.gamesPlayed,
        winStreak: r.winStreak,
      })
    }
    const changes = computeEloChanges(teams, current)
    if (changes.size === 0) continue

    const applied = new Map() // name -> rating actually gained/lost, floor included
    for (const [name, { delta, won }] of changes) {
      const prev = state.get(name)
      const base = prev
        ? decayedRating(prev.rating, prev.lastPlayedAt, playedAt, graceDaysFor(name))
        : initialRatingFor(name)
      const after = Math.max(RATING_FLOOR, base + delta)
      applied.set(name, after - base)
      state.set(name, {
        rating: after,
        gamesPlayed: (prev?.gamesPlayed ?? 0) + 1,
        winStreak: won ? (prev?.winStreak ?? 0) + 1 : 0,
        lastPlayedAt: playedAt,
      })
    }

    byResult.set(
      id,
      teams.map((team) => {
        const earned = resolvePlayers(team)
          .map((name) => applied.get(name))
          .filter((d) => d !== undefined)
        if (earned.length === 0) return null
        return Math.round(earned.reduce((s, d) => s + d, 0) / earned.length)
      }),
    )
  }
  return byResult
}

/**
 * Aggregate goals scored (for) and conceded (against) per named player across
 * all stored results. In multi-team games goals_against is the average of the
 * opposing teams' scores (enemy sum ÷ number of opposing teams), so a 3-team
 * game is comparable to head-to-head rather than double-counting concessions.
 */
function computeGoalStats() {
  const stats = new Map()
  for (const { teams } of getResultsForRecalculation()) {
    const totalScore = teams.reduce((sum, t) => sum + t.score, 0)
    const opponentCount = Math.max(1, teams.length - 1)
    for (const team of teams) {
      const players = resolvePlayers(team)
      if (players.length === 0) continue
      const goalsAgainst = (totalScore - team.score) / opponentCount
      for (const name of players) {
        const s = stats.get(name) ?? { goals_for: 0, goals_against: 0 }
        s.goals_for += team.score
        s.goals_against += goalsAgainst
        stats.set(name, s)
      }
    }
  }
  return stats
}

/**
 * Per-player games/wins split by game size (number of teams). Only 2-team and
 * 3-team games are tracked, since those are the formats the rankings break out.
 * Validity mirrors computeEloChanges/applyEloChanges so these counts reconcile
 * with each player's games_played: all-zero games are skipped, anonymous teams
 * (no resolved players) don't count, and a "win" is a strict unique top score.
 */
function computeWinSplitStats() {
  const stats = new Map() // name -> { games_2t, wins_2t, games_3t, wins_3t }
  for (const { teams } of getResultsForRecalculation()) {
    const teamCount = teams.length
    if (teamCount !== 2 && teamCount !== 3) continue
    if (teams.every((t) => t.score === 0)) continue

    const scores = teams.map((t) => t.score)
    const maxScore = Math.max(...scores)
    const maxCount = scores.filter((s) => s === maxScore).length

    for (const team of teams) {
      const players = resolvePlayers(team)
      if (players.length === 0) continue
      const won = team.score === maxScore && maxCount === 1
      for (const name of players) {
        const s = stats.get(name) ?? { games_2t: 0, wins_2t: 0, games_3t: 0, wins_3t: 0 }
        if (teamCount === 2) {
          s.games_2t += 1
          if (won) s.wins_2t += 1
        } else {
          s.games_3t += 1
          if (won) s.wins_3t += 1
        }
        stats.set(name, s)
      }
    }
  }
  return stats
}

/**
 * Current leaderboard plus each player's net rating change since local midnight.
 * The baseline is the player's rating as of the start of today (decay included);
 * players first seen today are compared against their initial rating.
 */
function getLeaderboardWithDailyChange() {
  const startOfToday = startOfTodayMs()
  const baseline = ratingsAsOf(startOfToday)
  const goalStats = computeGoalStats()
  const winSplits = computeWinSplitStats()
  const emptySplit = { games_2t: 0, wins_2t: 0, games_3t: 0, wins_3t: 0 }
  return getLeaderboard().map((player) => {
    const prev = baseline.get(player.name)
    const gs = goalStats.get(player.name) ?? { goals_for: 0, goals_against: 0 }
    const ws = winSplits.get(player.name) ?? emptySplit
    const baseMidnight = prev
      ? decayedRating(prev.rating, prev.lastPlayedAt, startOfToday, graceDaysFor(player.name))
      : initialRatingFor(player.name)
    const effectiveMidnight = Math.round(Math.max(RATING_FLOOR, baseMidnight))
    return { ...player, today_change: player.rating - effectiveMidnight, ...gs, ...ws }
  })
}

// --- Housekeeping -------------------------------------------------------------
setInterval(() => {
  const removed = pruneRooms(ROOM_TTL_MS)
  if (removed > 0) console.log(`Pruned ${removed} stale room(s)`)
  const removedWheels = pruneWheels(ROOM_TTL_MS)
  if (removedWheels > 0) console.log(`Pruned ${removedWheels} stale wheel(s)`)
  const removedForums = pruneForums(ROOM_TTL_MS)
  if (removedForums > 0) console.log(`Pruned ${removedForums} stale forum(s)`)
}, 60 * 60 * 1000).unref()

function recalculateElo() {
  resetElo()
  for (const { teams, playedAt } of getResultsForRecalculation()) {
    const changes = computeEloChanges(teams, getPlayerRatingsMap(playedAt))
    if (changes.size > 0) applyEloChanges(changes, playedAt)
  }
}

// Always recalculate ELO from scratch on startup so algorithm changes take effect.
function bootstrapElo() {
  const allTeams = getResultsForRecalculation()
  if (allTeams.length === 0) return
  console.log(`Recalculating ELO from ${allTeams.length} result(s)…`)
  recalculateElo()
  console.log(`ELO ready — ${getLeaderboard().length} ranked player(s).`)
}

app.listen(PORT, () => {
  console.log(`Bumbis matchmaking API listening on :${PORT}`)
  bootstrapElo()
})
