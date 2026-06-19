import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { decayedRating, graceDaysFor, RATING_FLOOR } from './elo.js'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = fileURLToPath(new URL('..', import.meta.url))
const DB_PATH = process.env.BUMBIS_DB || join(serverRoot, 'data', 'bumbis.db')

mkdirSync(dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'open',
    team_count  INTEGER NOT NULL DEFAULT 2,
    teams_json  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS players (
    id         TEXT PRIMARY KEY,
    room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (room_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id, created_at);

  CREATE TABLE IF NOT EXISTS game_results (
    id         TEXT PRIMARY KEY,
    date       TEXT NOT NULL,
    teams_json TEXT NOT NULL,
    winner     TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'custom',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS player_elo (
    name         TEXT PRIMARY KEY,
    rating       REAL NOT NULL DEFAULT 1200,
    games_played INTEGER NOT NULL DEFAULT 0,
    wins         INTEGER NOT NULL DEFAULT 0,
    updated_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wheels (
    id              TEXT PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'idle',   -- 'idle' | 'spinning'
    rotation        REAL NOT NULL DEFAULT 0,         -- resting absolute rotation (deg)
    winner_name     TEXT,                            -- last chosen name (for modal/state)
    winner_index    INTEGER,
    spin_id         TEXT,                            -- identifies the current spin event
    spin_started_at INTEGER,                         -- ms; for recovery guard
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wheel_players (
    id         TEXT PRIMARY KEY,
    wheel_id   TEXT NOT NULL REFERENCES wheels(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (wheel_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_wheel_players_wheel ON wheel_players(wheel_id, created_at);

  CREATE TABLE IF NOT EXISTS gambles (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    wager         INTEGER NOT NULL,
    outcome       TEXT NOT NULL,            -- 'win' | 'lose'
    delta         INTEGER NOT NULL,         -- signed net ELO change (+wager win, -wager loss)
    rating_before INTEGER NOT NULL,
    rating_after  INTEGER NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_gambles_created ON gambles(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_gambles_name ON gambles(name);

  -- Friday Food Forum: shareable vote on where to eat, decided by a wheel spin.
  CREATE TABLE IF NOT EXISTS forums (
    id              TEXT PRIMARY KEY,
    admin_token     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',     -- 'open' | 'locked' | 'spinning' | 'decided'
    selection_mode  TEXT NOT NULL DEFAULT 'single',   -- 'single' | 'multi'
    wheel_mode      TEXT NOT NULL DEFAULT 'weighted',  -- 'weighted' | 'tied'
    deadline_at     INTEGER,                           -- ms epoch; null = no timer
    dativa          INTEGER NOT NULL DEFAULT 0,        -- shared Dativa colour palette
    allow_suggestions INTEGER NOT NULL DEFAULT 0,      -- non-admins may add places
    winner_name     TEXT,
    -- spin animation fields (mirrors the wheels table) so every client lands together
    rotation        REAL NOT NULL DEFAULT 0,
    winner_index    INTEGER,
    spin_id         TEXT,
    spin_started_at INTEGER,
    celebration     TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS forum_places (
    id         TEXT PRIMARY KEY,
    forum_id   TEXT NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    approved   INTEGER NOT NULL DEFAULT 1,  -- suggestions start at 0 until an admin approves
    created_at INTEGER NOT NULL,
    UNIQUE (forum_id, name)
  );

  CREATE TABLE IF NOT EXISTS forum_voters (
    id         TEXT PRIMARY KEY,
    forum_id   TEXT NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (forum_id, name)
  );

  CREATE TABLE IF NOT EXISTS forum_votes (
    forum_id TEXT NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    voter_id TEXT NOT NULL REFERENCES forum_voters(id) ON DELETE CASCADE,
    place_id TEXT NOT NULL REFERENCES forum_places(id) ON DELETE CASCADE,
    PRIMARY KEY (voter_id, place_id)
  );

  CREATE TABLE IF NOT EXISTS forum_messages (
    id         TEXT PRIMARY KEY,
    forum_id   TEXT NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_forum_places_forum ON forum_places(forum_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_forum_votes_place ON forum_votes(place_id);
  CREATE INDEX IF NOT EXISTS idx_forum_messages_forum ON forum_messages(forum_id, created_at);
`)

// Migration: add the shared palette flag to wheels created before it existed.
try {
  db.exec(`ALTER TABLE wheels ADD COLUMN use_dativa INTEGER NOT NULL DEFAULT 0`)
} catch {
  // Column already exists.
}

// Migration: remember which celebration animation a spin should play, so every
// client renders the same one when the winner is revealed.
try {
  db.exec(`ALTER TABLE wheels ADD COLUMN celebration TEXT`)
} catch {
  // Column already exists.
}

// Migration: track when each player last played, for inactivity decay.
try {
  db.exec(`ALTER TABLE player_elo ADD COLUMN last_played_at INTEGER`)
} catch {
  // Column already exists.
}
// Backfill: seed last_played_at from updated_at so existing players are
// immediately subject to decay rather than being exempt until their next game.
db.exec(`UPDATE player_elo SET last_played_at = updated_at WHERE last_played_at IS NULL`)

// Migration: track each player's current consecutive-win streak, used to boost
// the rating gained on a further win. Recomputed from scratch on every startup
// rebuild, so the default 0 is only a transient seed.
try {
  db.exec(`ALTER TABLE player_elo ADD COLUMN win_streak INTEGER NOT NULL DEFAULT 0`)
} catch {
  // Column already exists.
}

// Migration: forum options added after the table first shipped.
for (const col of ['dativa INTEGER NOT NULL DEFAULT 0', 'allow_suggestions INTEGER NOT NULL DEFAULT 0']) {
  try {
    db.exec(`ALTER TABLE forums ADD COLUMN ${col}`)
  } catch {
    // Column already exists.
  }
}
try {
  db.exec(`ALTER TABLE forum_places ADD COLUMN approved INTEGER NOT NULL DEFAULT 1`)
} catch {
  // Column already exists.
}

// URL-safe id from a restricted alphabet (no ambiguous chars like 0/O/1/l/I).
const ID_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz'

function genId(length = 7) {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
  }
  return out
}

const insertRoomStmt = db.prepare(
  `INSERT INTO rooms (id, status, team_count, teams_json, created_at, updated_at)
   VALUES (?, 'open', 2, NULL, ?, ?)`,
)
const getRoomStmt = db.prepare(`SELECT * FROM rooms WHERE id = ?`)
const getPlayersStmt = db.prepare(
  `SELECT id, name FROM players WHERE room_id = ? ORDER BY created_at ASC`,
)
const touchRoomStmt = db.prepare(`UPDATE rooms SET updated_at = ? WHERE id = ?`)
const insertPlayerStmt = db.prepare(
  `INSERT OR IGNORE INTO players (id, room_id, name, created_at) VALUES (?, ?, ?, ?)`,
)
const getPlayerByNameStmt = db.prepare(
  `SELECT id, name FROM players WHERE room_id = ? AND name = ?`,
)
const deletePlayerStmt = db.prepare(`DELETE FROM players WHERE room_id = ? AND id = ?`)
const setSplitStmt = db.prepare(
  `UPDATE rooms SET status = 'split', team_count = ?, teams_json = ?, updated_at = ? WHERE id = ?`,
)
const resetRoomStmt = db.prepare(
  `UPDATE rooms SET status = 'open', teams_json = NULL, updated_at = ? WHERE id = ?`,
)
const pruneStmt = db.prepare(`DELETE FROM rooms WHERE updated_at < ?`)

const getPlayerEloStmt = db.prepare(
  `SELECT name, rating, games_played, wins, win_streak, last_played_at FROM player_elo WHERE name = ?`,
)
const getAllPlayerEloStmt = db.prepare(
  `SELECT name, rating, games_played, wins, win_streak, last_played_at FROM player_elo ORDER BY rating DESC`,
)
const upsertPlayerEloStmt = db.prepare(`
  INSERT INTO player_elo (name, rating, games_played, wins, win_streak, last_played_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    rating         = excluded.rating,
    games_played   = excluded.games_played,
    wins           = excluded.wins,
    win_streak     = excluded.win_streak,
    last_played_at = excluded.last_played_at,
    updated_at     = excluded.updated_at
`)
const resetAllEloStmt = db.prepare(`DELETE FROM player_elo`)

// --- Gambling statements ------------------------------------------------------
const insertGambleStmt = db.prepare(
  `INSERT INTO gambles (id, name, wager, outcome, delta, rating_before, rating_after, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
)
const getGambleHistoryStmt = db.prepare(
  `SELECT id, name, wager, outcome, delta, rating_before, rating_after, created_at
   FROM gambles ORDER BY created_at DESC LIMIT ?`,
)
// Net (signed) gamble delta per player since a given instant. Used to fold
// gambling winnings/losses into the displayed ELO without disturbing the
// game-result ELO maths (which is rebuilt from scratch on startup).
const getGambleNetStmt = db.prepare(
  `SELECT name, COALESCE(SUM(delta), 0) AS net FROM gambles WHERE created_at >= ? GROUP BY name`,
)

const insertResultStmt = db.prepare(
  `INSERT INTO game_results (id, date, teams_json, winner, source, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
)
const getAllResultsStmt = db.prepare(
  `SELECT id, date, teams_json, winner, source FROM game_results ORDER BY created_at DESC`,
)
const deleteResultStmt = db.prepare(`DELETE FROM game_results WHERE id = ?`)

// --- Wheel statements ---------------------------------------------------------
const insertWheelStmt = db.prepare(
  `INSERT INTO wheels (id, status, rotation, created_at, updated_at)
   VALUES (?, 'idle', 0, ?, ?)`,
)
const getWheelStmt = db.prepare(`SELECT * FROM wheels WHERE id = ?`)
const getWheelPlayersStmt = db.prepare(
  `SELECT id, name FROM wheel_players WHERE wheel_id = ? ORDER BY created_at ASC`,
)
const touchWheelStmt = db.prepare(`UPDATE wheels SET updated_at = ? WHERE id = ?`)
const insertWheelPlayerStmt = db.prepare(
  `INSERT OR IGNORE INTO wheel_players (id, wheel_id, name, created_at) VALUES (?, ?, ?, ?)`,
)
const getWheelPlayerByNameStmt = db.prepare(
  `SELECT id, name FROM wheel_players WHERE wheel_id = ? AND name = ?`,
)
const deleteWheelPlayerStmt = db.prepare(`DELETE FROM wheel_players WHERE wheel_id = ? AND id = ?`)
const deleteWheelPlayerByNameStmt = db.prepare(
  `DELETE FROM wheel_players WHERE wheel_id = ? AND name = ?`,
)
const setWheelSpinningStmt = db.prepare(
  `UPDATE wheels SET status = 'spinning', rotation = ?, winner_name = ?, winner_index = ?,
   spin_id = ?, spin_started_at = ?, celebration = ?, updated_at = ? WHERE id = ?`,
)
const setWheelIdleStmt = db.prepare(
  `UPDATE wheels SET status = 'idle', spin_id = NULL, spin_started_at = NULL, updated_at = ?
   WHERE id = ?`,
)
const setWheelPaletteStmt = db.prepare(
  `UPDATE wheels SET use_dativa = ?, updated_at = ? WHERE id = ?`,
)
const pruneWheelsStmt = db.prepare(`DELETE FROM wheels WHERE updated_at < ?`)

export function createRoom() {
  const now = Date.now()
  // Retry on the astronomically unlikely id collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = genId()
    if (getRoomStmt.get(id)) continue
    insertRoomStmt.run(id, now, now)
    return id
  }
  throw new Error('Could not allocate a unique room id')
}

export function roomExists(roomId) {
  return Boolean(getRoomStmt.get(roomId))
}

/** Assemble the full client-facing state for a room, or null if it is gone. */
export function getRoomState(roomId) {
  const room = getRoomStmt.get(roomId)
  if (!room) return null
  return {
    id: room.id,
    status: room.status,
    teamCount: room.team_count,
    teams: room.teams_json ? JSON.parse(room.teams_json) : null,
    players: getPlayersStmt.all(roomId),
  }
}

/** Idempotent check-in: returns the player row (existing or freshly inserted). */
export function addPlayer(roomId, name) {
  const now = Date.now()
  const id = genId(10)
  insertPlayerStmt.run(id, roomId, name, now)
  touchRoomStmt.run(now, roomId)
  return getPlayerByNameStmt.get(roomId, name)
}

export function removePlayer(roomId, playerId) {
  const info = deletePlayerStmt.run(roomId, playerId)
  if (info.changes > 0) touchRoomStmt.run(Date.now(), roomId)
  return info.changes > 0
}

export function setSplit(roomId, teamCount, teams) {
  setSplitStmt.run(teamCount, JSON.stringify(teams), Date.now(), roomId)
}

export function resetRoom(roomId) {
  resetRoomStmt.run(Date.now(), roomId)
}

/** Delete rooms untouched for longer than maxAgeMs. Returns rows removed. */
export function pruneRooms(maxAgeMs) {
  return pruneStmt.run(Date.now() - maxAgeMs).changes
}

export function getPlayerRatingsMap(asOf = Date.now()) {
  const rows = getAllPlayerEloStmt.all()
  const map = new Map()
  for (const row of rows) {
    map.set(row.name, {
      rating: decayedRating(row.rating, row.last_played_at, asOf, graceDaysFor(row.name)),
      gamesPlayed: row.games_played,
      winStreak: row.win_streak,
    })
  }
  return map
}

export function getLeaderboard(asOf = Date.now()) {
  return (
    getAllPlayerEloStmt
      .all()
      .map((r) => {
        const rating = Math.max(
          RATING_FLOOR,
          decayedRating(r.rating, r.last_played_at, asOf, graceDaysFor(r.name)),
        )
        return {
          name: r.name,
          rating: Math.round(rating),
          games_played: r.games_played,
          wins: r.wins,
        }
      })
      // Decay can reorder players relative to the stored ordering.
      .sort((a, b) => b.rating - a.rating)
  )
}

/** Signed net gamble delta per player since `since` (epoch ms; default all-time). */
export function getGambleNetMap(since = 0) {
  const map = new Map()
  for (const row of getGambleNetStmt.all(since)) map.set(row.name, row.net)
  return map
}

/**
 * The player's current gambling state: their game-result rating (decayed to now)
 * plus all-time gamble net, floored. Returns null if the player has no ranked
 * row yet (they must have played a game before they can gamble).
 */
export function getPlayerGambleRating(name, asOf = Date.now()) {
  const row = getPlayerEloStmt.get(name)
  if (!row) return null
  const base = decayedRating(row.rating, row.last_played_at, asOf, graceDaysFor(name))
  const net = getGambleNetMap().get(name) ?? 0
  return Math.round(Math.max(RATING_FLOOR, base + net))
}

/** Persist a single gamble. Returns the stored row with a generated id. */
export function recordGamble({ name, wager, outcome, delta, ratingBefore, ratingAfter }) {
  const now = Date.now()
  const id = genId(10)
  insertGambleStmt.run(id, name, wager, outcome, delta, ratingBefore, ratingAfter, now)
  return { id, name, wager, outcome, delta, ratingBefore, ratingAfter, createdAt: now }
}

/** Most recent gambles, newest first. */
export function getGambleHistory(limit = 100) {
  return getGambleHistoryStmt.all(limit).map((row) => ({
    id: row.id,
    name: row.name,
    wager: row.wager,
    outcome: row.outcome,
    delta: row.delta,
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
    createdAt: row.created_at,
  }))
}

/**
 * Apply a game's ELO deltas. `playedAt` (epoch ms) is when the game happened —
 * it becomes each participant's new last-played time, and any inactivity decay
 * accrued up to that moment is banked into the base rating before the delta is
 * added (so returning after a long break does not refund the decayed points).
 */
export function applyEloChanges(changes, playedAt = Date.now()) {
  const apply = db.transaction(() => {
    const now = Date.now()
    for (const [name, { delta, oldRating, won, gamesPlayed }] of changes) {
      const currentRow = getPlayerEloStmt.get(name)
      const baseRating = currentRow
        ? decayedRating(currentRow.rating, currentRow.last_played_at, playedAt, graceDaysFor(name))
        : oldRating
      const currentGames = currentRow?.games_played ?? gamesPlayed
      const currentWins = currentRow?.wins ?? 0
      // Extend the streak on a win, reset it on any non-win (loss or tied-top).
      const newStreak = won ? (currentRow?.win_streak ?? 0) + 1 : 0
      upsertPlayerEloStmt.run(
        name,
        Math.max(RATING_FLOOR, baseRating + delta),
        currentGames + 1,
        currentWins + (won ? 1 : 0),
        newStreak,
        playedAt,
        now,
      )
    }
  })
  apply()
}

export function deleteResult(id) {
  return deleteResultStmt.run(id).changes > 0
}

export function getResultsForRecalculation() {
  return db
    .prepare(`SELECT teams_json, created_at FROM game_results ORDER BY created_at ASC`)
    .all()
    .map((r) => ({ teams: JSON.parse(r.teams_json), playedAt: r.created_at }))
}

export function resetElo() {
  resetAllEloStmt.run()
}

export function getAllResults() {
  return getAllResultsStmt.all().map((row) => ({
    id: row.id,
    date: row.date,
    teams: JSON.parse(row.teams_json),
    winner: row.winner,
    source: row.source,
  }))
}

export function saveResult({ teams, winner, source }) {
  const now = Date.now()
  const id = genId(10)
  const date = new Date(now).toISOString()
  insertResultStmt.run(id, date, JSON.stringify(teams), winner, source || 'custom', now)
  return { id, date, teams, winner, source: source || 'custom', createdAt: now }
}

// --- Wheel helpers ------------------------------------------------------------
// A spin animates for ~3s on every client; after that the winner is removed and
// the wheel returns to idle. The grace guards against the finalize timer being
// lost (e.g. server restart) — getWheelState then finalizes lazily.
const SPIN_DURATION_MS = 3000
const SPIN_GRACE_MS = 1500

export function createWheel() {
  const now = Date.now()
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = genId()
    if (getWheelStmt.get(id)) continue
    insertWheelStmt.run(id, now, now)
    return id
  }
  throw new Error('Could not allocate a unique wheel id')
}

export function wheelExists(wheelId) {
  return Boolean(getWheelStmt.get(wheelId))
}

/** Assemble the full client-facing wheel state, or null if it is gone. */
export function getWheelState(wheelId) {
  const wheel = getWheelStmt.get(wheelId)
  if (!wheel) return null
  // Recovery guard: if a spin's finalize timer was lost, settle it lazily so the
  // wheel never stays stuck in 'spinning'.
  if (
    wheel.status === 'spinning' &&
    wheel.spin_started_at &&
    Date.now() - wheel.spin_started_at > SPIN_DURATION_MS + SPIN_GRACE_MS
  ) {
    finalizeWheelSpin(wheelId)
    return getWheelState(wheelId)
  }
  return {
    id: wheel.id,
    status: wheel.status,
    rotation: wheel.rotation,
    dativaColors: Boolean(wheel.use_dativa),
    spin:
      wheel.status === 'spinning' && wheel.spin_id
        ? {
            id: wheel.spin_id,
            winnerName: wheel.winner_name,
            winnerIndex: wheel.winner_index,
            startedAt: wheel.spin_started_at,
            celebration: wheel.celebration,
          }
        : null,
    players: getWheelPlayersStmt.all(wheelId),
  }
}

/** Idempotent check-in: returns the player row (existing or freshly inserted). */
export function addWheelPlayer(wheelId, name) {
  const now = Date.now()
  const id = genId(10)
  insertWheelPlayerStmt.run(id, wheelId, name, now)
  touchWheelStmt.run(now, wheelId)
  return getWheelPlayerByNameStmt.get(wheelId, name)
}

export function removeWheelPlayer(wheelId, playerId) {
  const info = deleteWheelPlayerStmt.run(wheelId, playerId)
  if (info.changes > 0) touchWheelStmt.run(Date.now(), wheelId)
  return info.changes > 0
}

export function setWheelSpinning(
  wheelId,
  { rotation, winnerName, winnerIndex, spinId, startedAt, celebration },
) {
  setWheelSpinningStmt.run(
    rotation,
    winnerName,
    winnerIndex,
    spinId,
    startedAt,
    celebration,
    startedAt,
    wheelId,
  )
}

/** Remove the chosen player and return the wheel to idle. */
export function finalizeWheelSpin(wheelId) {
  const wheel = getWheelStmt.get(wheelId)
  if (!wheel || wheel.status !== 'spinning') return
  if (wheel.winner_name) deleteWheelPlayerByNameStmt.run(wheelId, wheel.winner_name)
  setWheelIdleStmt.run(Date.now(), wheelId)
}

/** Toggle the shared colour palette (Dativa brand colours vs. default). */
export function setWheelPalette(wheelId, useDativa) {
  setWheelPaletteStmt.run(useDativa ? 1 : 0, Date.now(), wheelId)
}

/** Delete wheels untouched for longer than maxAgeMs. Returns rows removed. */
export function pruneWheels(maxAgeMs) {
  return pruneWheelsStmt.run(Date.now() - maxAgeMs).changes
}

// --- Friday Food Forum --------------------------------------------------------
export const FORUM_DEFAULT_PLACES = [
  'Food Box',
  'Delicio',
  'Crispy Chicken',
  'Lido',
  'Kebab City',
  'Cafe 22',
  'Pho Plus',
]

const insertForumStmt = db.prepare(
  `INSERT INTO forums (id, admin_token, selection_mode, wheel_mode, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
)
const getForumStmt = db.prepare(`SELECT * FROM forums WHERE id = ?`)
const touchForumStmt = db.prepare(`UPDATE forums SET updated_at = ? WHERE id = ?`)
const setForumStatusStmt = db.prepare(`UPDATE forums SET status = ?, updated_at = ? WHERE id = ?`)
const setForumConfigStmt = db.prepare(
  `UPDATE forums SET selection_mode = ?, wheel_mode = ?, deadline_at = ?, dativa = ?,
   allow_suggestions = ?, updated_at = ? WHERE id = ?`,
)
// Drop all but each voter's earliest vote — used when switching multi -> single.
const trimVotesToSingleStmt = db.prepare(
  `DELETE FROM forum_votes WHERE forum_id = ? AND rowid NOT IN (
     SELECT MIN(rowid) FROM forum_votes WHERE forum_id = ? GROUP BY voter_id
   )`,
)
const setForumSpinningStmt = db.prepare(
  `UPDATE forums SET status = 'spinning', rotation = ?, winner_name = ?, winner_index = ?,
   spin_id = ?, spin_started_at = ?, celebration = ?, updated_at = ? WHERE id = ?`,
)
const setForumDecidedStmt = db.prepare(
  `UPDATE forums SET status = 'decided', spin_id = NULL, spin_started_at = NULL, updated_at = ?
   WHERE id = ?`,
)
const getForumPlacesStmt = db.prepare(
  `SELECT p.id, p.name, p.approved, COUNT(v.voter_id) AS votes
   FROM forum_places p LEFT JOIN forum_votes v ON v.place_id = p.id
   WHERE p.forum_id = ? GROUP BY p.id, p.name, p.approved ORDER BY p.created_at ASC`,
)
const insertForumPlaceStmt = db.prepare(
  `INSERT OR IGNORE INTO forum_places (id, forum_id, name, approved, created_at) VALUES (?, ?, ?, ?, ?)`,
)
const getForumPlaceByNameStmt = db.prepare(
  `SELECT id, name FROM forum_places WHERE forum_id = ? AND name = ?`,
)
// Only approved places are votable — pending suggestions can't be voted for.
const getForumPlaceStmt = db.prepare(
  `SELECT id FROM forum_places WHERE forum_id = ? AND id = ? AND approved = 1`,
)
const approveForumPlaceStmt = db.prepare(
  `UPDATE forum_places SET approved = 1 WHERE forum_id = ? AND id = ?`,
)
const deleteForumPlaceStmt = db.prepare(`DELETE FROM forum_places WHERE forum_id = ? AND id = ?`)
const getForumVotersStmt = db.prepare(
  `SELECT id, name FROM forum_voters WHERE forum_id = ? ORDER BY created_at ASC`,
)
const insertForumVoterStmt = db.prepare(
  `INSERT OR IGNORE INTO forum_voters (id, forum_id, name, created_at) VALUES (?, ?, ?, ?)`,
)
const getForumVoterByNameStmt = db.prepare(
  `SELECT id, name FROM forum_voters WHERE forum_id = ? AND name = ?`,
)
const getForumVoterStmt = db.prepare(`SELECT id FROM forum_voters WHERE forum_id = ? AND id = ?`)
const deleteForumVoterStmt = db.prepare(`DELETE FROM forum_voters WHERE forum_id = ? AND id = ?`)
const deleteVoterVotesStmt = db.prepare(`DELETE FROM forum_votes WHERE forum_id = ? AND voter_id = ?`)
const insertVoteStmt = db.prepare(
  `INSERT OR IGNORE INTO forum_votes (forum_id, voter_id, place_id) VALUES (?, ?, ?)`,
)
const pruneForumsStmt = db.prepare(`DELETE FROM forums WHERE updated_at < ?`)
const insertForumMessageStmt = db.prepare(
  `INSERT INTO forum_messages (id, forum_id, name, body, created_at) VALUES (?, ?, ?, ?, ?)`,
)
// Most recent messages, oldest-first for display (the subquery grabs the newest).
const getForumMessagesStmt = db.prepare(
  `SELECT id, name, body, created_at FROM (
     SELECT * FROM forum_messages WHERE forum_id = ? ORDER BY created_at DESC LIMIT 100
   ) ORDER BY created_at ASC`,
)

const deleteForumMessageStmt = db.prepare(
  `DELETE FROM forum_messages WHERE forum_id = ? AND id = ?`,
)

export const FORUM_MESSAGE_MAX_LEN = 200

export function createForum({ selectionMode = 'single', wheelMode = 'weighted' } = {}) {
  const now = Date.now()
  const adminToken = genId(20)
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = genId()
    if (getForumStmt.get(id)) continue
    insertForumStmt.run(id, adminToken, selectionMode, wheelMode, now, now)
    // Stagger created_at so the default places keep their listed order (ORDER BY
    // created_at would otherwise tie and sort arbitrarily).
    FORUM_DEFAULT_PLACES.forEach((name, i) => insertForumPlaceStmt.run(genId(10), id, name, 1, now + i))
    return { id, adminToken }
  }
  throw new Error('Could not allocate a unique forum id')
}

export function forumExists(forumId) {
  return Boolean(getForumStmt.get(forumId))
}

/** The admin token for server-side auth only — never sent to clients. */
export function getForumAdminToken(forumId) {
  return getForumStmt.get(forumId)?.admin_token ?? null
}

/**
 * Full client-facing forum state, or null if gone. Side effects on read keep the
 * forum honest without a background job: a passed deadline flips open -> locked,
 * and a spin whose finalize timer was lost settles to 'decided'.
 */
export function getForumState(forumId) {
  const forum = getForumStmt.get(forumId)
  if (!forum) return null

  if (forum.status === 'open' && forum.deadline_at && Date.now() >= forum.deadline_at) {
    setForumStatusStmt.run('locked', Date.now(), forumId)
    return getForumState(forumId)
  }
  if (
    forum.status === 'spinning' &&
    forum.spin_started_at &&
    Date.now() - forum.spin_started_at > SPIN_DURATION_MS + SPIN_GRACE_MS
  ) {
    finalizeForumSpin(forumId)
    return getForumState(forumId)
  }

  return {
    id: forum.id,
    status: forum.status,
    selectionMode: forum.selection_mode,
    wheelMode: forum.wheel_mode,
    dativaColors: Boolean(forum.dativa),
    allowSuggestions: Boolean(forum.allow_suggestions),
    deadlineAt: forum.deadline_at ?? null,
    winnerName: forum.winner_name ?? null,
    rotation: forum.rotation,
    spin:
      forum.status === 'spinning' && forum.spin_id
        ? {
            id: forum.spin_id,
            winnerName: forum.winner_name,
            winnerIndex: forum.winner_index,
            startedAt: forum.spin_started_at,
            celebration: forum.celebration,
          }
        : null,
    places: getForumPlacesStmt.all(forumId).map((p) => ({ ...p, approved: Boolean(p.approved) })),
    voters: getForumVotersStmt.all(forumId),
    messages: getForumMessagesStmt.all(forumId),
  }
}

/** Idempotent join: returns the voter row (existing or freshly inserted). */
export function addVoter(forumId, name) {
  const now = Date.now()
  insertForumVoterStmt.run(genId(10), forumId, name, now)
  touchForumStmt.run(now, forumId)
  return getForumVoterByNameStmt.get(forumId, name)
}

/** Remove a voter; their votes cascade away via the foreign key. */
export function removeVoter(forumId, voterId) {
  const info = deleteForumVoterStmt.run(forumId, voterId)
  if (info.changes > 0) touchForumStmt.run(Date.now(), forumId)
  return info.changes > 0
}

// approved defaults to 1 (admin adds); pass 0 for a suggestion awaiting approval.
export function addPlace(forumId, name, approved = 1) {
  const now = Date.now()
  insertForumPlaceStmt.run(genId(10), forumId, name, approved ? 1 : 0, now)
  touchForumStmt.run(now, forumId)
  return getForumPlaceByNameStmt.get(forumId, name)
}

export function approvePlace(forumId, placeId) {
  const info = approveForumPlaceStmt.run(forumId, placeId)
  if (info.changes > 0) touchForumStmt.run(Date.now(), forumId)
  return info.changes > 0
}

export function removePlace(forumId, placeId) {
  const info = deleteForumPlaceStmt.run(forumId, placeId)
  if (info.changes > 0) touchForumStmt.run(Date.now(), forumId)
  return info.changes > 0
}

/**
 * Replace a voter's votes. Enforces single-select and that the voter and every
 * place belong to this forum. Returns false if the voter is unknown.
 */
export function setVote(forumId, voterId, placeIds) {
  if (!getForumVoterStmt.get(forumId, voterId)) return false
  const forum = getForumStmt.get(forumId)
  const unique = [...new Set(placeIds)]
  if (forum.selection_mode === 'single' && unique.length > 1) {
    throw new Error('Only one place may be selected')
  }
  const apply = db.transaction(() => {
    deleteVoterVotesStmt.run(forumId, voterId)
    for (const placeId of unique) {
      if (getForumPlaceStmt.get(forumId, placeId)) insertVoteStmt.run(forumId, voterId, placeId)
    }
    touchForumStmt.run(Date.now(), forumId)
  })
  apply()
  return true
}

export function updateForumConfig(forumId, { selectionMode, wheelMode, deadlineAt, dativa, allowSuggestions }) {
  const forum = getForumStmt.get(forumId)
  if (!forum) return
  const nextSelection = selectionMode ?? forum.selection_mode
  setForumConfigStmt.run(
    nextSelection,
    wheelMode ?? forum.wheel_mode,
    deadlineAt === undefined ? forum.deadline_at : deadlineAt,
    dativa === undefined ? forum.dativa : dativa ? 1 : 0,
    allowSuggestions === undefined ? forum.allow_suggestions : allowSuggestions ? 1 : 0,
    Date.now(),
    forumId,
  )
  // Tightening multi -> single must collapse anyone's extra votes, not just block new ones.
  if (nextSelection === 'single' && forum.selection_mode === 'multi') {
    trimVotesToSingleStmt.run(forumId, forumId)
  }
}

export function lockForum(forumId) {
  setForumStatusStmt.run('locked', Date.now(), forumId)
}

export function setForumSpinning(forumId, { rotation, winnerName, winnerIndex, spinId, startedAt, celebration }) {
  setForumSpinningStmt.run(rotation, winnerName, winnerIndex, spinId, startedAt, celebration, startedAt, forumId)
}

/** Settle a spin: keep the chosen winner and move to 'decided'. */
export function finalizeForumSpin(forumId) {
  const forum = getForumStmt.get(forumId)
  if (!forum || forum.status !== 'spinning') return
  setForumDecidedStmt.run(Date.now(), forumId)
}

/** Append a chat message (body is capped at FORUM_MESSAGE_MAX_LEN). */
export function addMessage(forumId, name, body) {
  const now = Date.now()
  const id = genId(10)
  insertForumMessageStmt.run(id, forumId, name, body.slice(0, FORUM_MESSAGE_MAX_LEN), now)
  touchForumStmt.run(now, forumId)
  return { id, name, body, created_at: now }
}

export function removeMessage(forumId, messageId) {
  const info = deleteForumMessageStmt.run(forumId, messageId)
  if (info.changes > 0) touchForumStmt.run(Date.now(), forumId)
  return info.changes > 0
}

/** Delete forums untouched for longer than maxAgeMs. Returns rows removed. */
export function pruneForums(maxAgeMs) {
  return pruneForumsStmt.run(Date.now() - maxAgeMs).changes
}

export default db
