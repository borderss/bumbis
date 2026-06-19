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

/**
 * Predicted win probabilities for a split room's teams, aligned to team order
 * and summing to 1 (empty until the room is split). Based on player ELO ratings.
 */
export function getRoomPrediction(id: string): Promise<{ probabilities: number[] }> {
  return request(`/rooms/${id}/prediction`)
}

/**
 * Predicted win probabilities for an ad-hoc set of team lineups (e.g. the
 * home-page pair split, which has no room), aligned to input order and summing
 * to 1. Based on player ELO ratings.
 */
export function getPrediction(teams: string[][]): Promise<{ probabilities: number[] }> {
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
