// Client for the self-hosted matchmaking API (server/). In dev, Vite proxies
// `/api` to the Node service; in production nginx reverse-proxies it.

export interface Player {
  id: string
  name: string
}

export type RoomStatus = 'open' | 'split'

export interface Room {
  id: string
  status: RoomStatus
  teamCount: number
  teams: string[][] | null
  players: Player[]
}

export interface JoinResult {
  player: Player
  room: Room
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const message = await res
      .json()
      .then((body) => body?.error)
      .catch(() => null)
    throw new Error(message || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export function createRoom(): Promise<{ id: string }> {
  return request('/rooms', { method: 'POST' })
}

export function getRoom(id: string): Promise<Room> {
  return request(`/rooms/${id}`)
}

export function joinRoom(id: string, name: string): Promise<JoinResult> {
  return request(`/rooms/${id}/players`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function leaveRoom(id: string, playerId: string): Promise<Room> {
  return request(`/rooms/${id}/players/${playerId}`, { method: 'DELETE' })
}

export function splitTeams(id: string, teamCount: number): Promise<Room> {
  return request(`/rooms/${id}/split`, {
    method: 'POST',
    body: JSON.stringify({ teamCount }),
  })
}

export function resetRoom(id: string): Promise<Room> {
  return request(`/rooms/${id}/reset`, { method: 'POST' })
}

/** The pair of players whose shared history weighed most on a team's forecast. */
export interface MatchupPair {
  /** 'h2h' = a has faced b; 'duo' = a and b played together. */
  kind: 'h2h' | 'duo'
  a: string
  b: string
  games: number
  /** Games a won (h2h) or the duo won together (duo). */
  wins: number
  losses: number
}

/** What past meetings contributed to one team's predicted win chance. */
export interface Insight {
  /** Signed rating points the matchup history added to this team's forecast. */
  eloShift: number
  topPair: MatchupPair | null
}

export interface Prediction {
  probabilities: number[]
  insights: Insight[]
}

/**
 * Rating points below which the history did not visibly move the bar. The note
 * explains the bar, so there is nothing to say under that: one strong pair among
 * the twenty-five in a 5v5 averages down to noise, and announcing it would imply
 * a swing the user cannot see.
 */
const NOTE_MIN_SHIFT = 2

/**
 * One-line rendering of the history behind a team's win chance, or null when no
 * pair on that team has met before (or the meeting barely mattered). Both
 * prediction views share it so the phrasing cannot drift.
 *
 * Two players can meet without either beating the other — a three-team game the
 * third side won — so the record is printed W–L–D whenever such games exist,
 * rather than silently understating how often the two have actually played.
 */
export function describeMatchup(insight: Insight | undefined): string | null {
  const pair = insight?.topPair
  if (!pair || Math.abs(insight.eloShift) < NOTE_MIN_SHIFT) return null
  const drawn = pair.games - pair.wins - pair.losses
  const record = drawn > 0 ? `${pair.wins}–${pair.losses}–${drawn}` : `${pair.wins}–${pair.losses}`
  return pair.kind === 'duo'
    ? `${pair.a} + ${pair.b} are ${record} together`
    : `${pair.a} is ${record} vs ${pair.b}`
}

/**
 * Predicted win probabilities for a split room's teams, aligned to team order
 * and summing to 1 (empty until the room is split). Based on player ELO ratings
 * plus how the exact players involved have fared against and alongside each
 * other before; `insights` explains that second part.
 */
export function getRoomPrediction(id: string): Promise<Prediction> {
  return request(`/rooms/${id}/prediction`)
}

/**
 * Predicted win probabilities for an ad-hoc set of team lineups (e.g. the
 * home-page pair split, which has no room), aligned to input order and summing
 * to 1. Same model as getRoomPrediction.
 */
export function getPrediction(teams: string[][]): Promise<Prediction> {
  return request('/predict', { method: 'POST', body: JSON.stringify({ teams }) })
}

export interface TeamResult {
  name: string
  players: string[]
  score: number
}

export interface GameResult {
  id: string
  date: string
  teams: TeamResult[]
  winner: string
  source: 'lobby' | 'custom'
  /** ELO each team banked, aligned with `teams`; null for anonymous teams. */
  teamElo?: (number | null)[] | null
}

export function getResults(): Promise<GameResult[]> {
  return request('/results')
}

export function saveGameResult(
  teams: TeamResult[],
  source: 'lobby' | 'custom',
): Promise<GameResult> {
  return request('/results', {
    method: 'POST',
    body: JSON.stringify({ teams, source }),
  })
}

export interface PlayerRanking {
  name: string
  rating: number
  games_played: number
  wins: number
  /** Net rating change since the start of today (can be negative). */
  today_change: number
  goals_for: number
  goals_against: number
  /** Games played / strictly won in 2-team games (for the split win-rate column). */
  games_2t: number
  wins_2t: number
  /** Games played / strictly won in 3-team games. */
  games_3t: number
  wins_3t: number
}

export function getLeaderboard(): Promise<PlayerRanking[]> {
  return request('/elo')
}

export function deleteGameResult(id: string): Promise<{ ok: boolean }> {
  return request(`/results/${id}`, { method: 'DELETE' })
}

/**
 * Subscribe to live room updates via Server-Sent Events. `onUpdate` fires on
 * connect and on every change (check-in, leave, split, reset); `onError` fires
 * when the stream drops (EventSource then auto-reconnects). Returns a teardown
 * function that closes the stream.
 */
export function subscribeRoom(
  id: string,
  onUpdate: (room: Room) => void,
  onError?: () => void,
): () => void {
  const source = new EventSource(`/api/rooms/${id}/events`)
  source.onmessage = (event) => {
    try {
      onUpdate(JSON.parse(event.data) as Room)
    } catch {
      // Ignore malformed frames (e.g. comment pings never reach onmessage).
    }
  }
  if (onError) source.onerror = () => onError()
  return () => source.close()
}
