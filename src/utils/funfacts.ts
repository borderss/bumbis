// Client + types for the Fun Facts endpoint (server/src/funfacts.js).
// In dev Vite proxies `/api` to the Node service; in prod nginx reverse-proxies.

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  if (!res.ok) {
    const message = await res
      .json()
      .then((b) => b?.error)
      .catch(() => null)
    throw new Error(message || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

// --- Shared fact shapes -------------------------------------------------------
export interface PlayerValue {
  player: string
  value: number
}
export interface WinStreakDay {
  player: string
  value: number
  day: string
  games: number
}
export interface PerfectSession {
  player: string
  day: string
  games: number
}
export interface WeeklyMvp {
  week: string
  player: string
  net: number
  wins: number
  games: number
  completed: boolean
}
export interface MvpRate {
  player: string
  rate: number
  titles: number
  weeks: number
}
export interface Champion {
  player: string
  rating: number
}
export interface Rivalry {
  a: string
  b: string
  games: number
  aWins: number
  bWins: number
}
export interface LopsidedRivalry {
  winner: string
  loser: string
  winnerWins: number
  loserWins: number
  games: number
  dominance: number
}
export interface Duo {
  a: string
  b: string
  games: number
  wins: number
  winRate?: number
}
export interface EloDelta {
  player: string
  value: number
  rating: number
}
export interface Upset {
  winners: string[]
  losers: string[]
  gap: number
  score: string
}
export interface MostImproved {
  player: string
  value: number
  month: string
}
export interface TierRecord {
  player: string
  winRate: number
  wins: number
  games: number
}
export interface FlatTrackBully {
  player: string
  gap: number
  weakWinRate: number
  strongWinRate: number
  weakGames: number
  strongGames: number
}
export interface WinRateRecord {
  player: string
  winRate: number
  wins?: number
  games: number
}
export interface RecordWithGames {
  player: string
  winRate: number
  wins: number
  games: number
}
export interface LossRateRecord {
  player: string
  lossRate: number
  games: number
}
export interface LiftRecord {
  player: string
  value: number
  partners: number
}
export interface VarianceRecord {
  player: string
  value: number
  days: number
}
export interface ScoringRecord {
  player: string
  value: number
  games: number
}
export interface Blowout {
  winners: string[]
  losers: string[]
  margin: number
  score: string
}

export interface GlobalFacts {
  // Streaks & runs
  longestWinStreak: PlayerValue | null
  currentWinStreak: PlayerValue | null
  longestLossStreak: PlayerValue | null
  mostWinsInDay: WinStreakDay | null
  perfectSession: PerfectSession | null
  longestAttendance: PlayerValue | null
  longestReign: PlayerValue | null
  mostDaysAsChampion: PlayerValue | null
  // Dominance & margins
  mostShutoutsDelivered: PlayerValue | null
  mostTimesShutout: PlayerValue | null
  mostOneGoalWins: PlayerValue | null
  biggestBlowout: Blowout | null
  // MVP & titles
  weeklyMvp: WeeklyMvp | null
  mostMvpTitles: PlayerValue | null
  longestMvpStreak: PlayerValue | null
  highestMvpRate: MvpRate | null
  reigningChampion: Champion | null
  // Rivalries & head-to-head
  biggestRivalry: Rivalry | null
  mostLopsided: LopsidedRivalry | null
  bestDuo: Duo | null
  cursedDuo: Duo | null
  mostPlayedDuo: Duo | null
  // ELO milestones
  highestPeakElo: PlayerValue | null
  biggestGain: EloDelta | null
  biggestUpset: Upset | null
  hardestFall: EloDelta | null
  mostImproved: MostImproved | null
  giantKiller: TierRecord | null
  flatTrackBully: FlatTrackBully | null
  // Volume & rates
  mostGames: PlayerValue | null
  highestWinRate: WinRateRecord | null
  mostBalanced: WinRateRecord | null
  // Goals & scoring
  sharpshooter: ScoringRecord | null
  ironWall: ScoringRecord | null
  goalDiffKing: ScoringRecord | null
  mostGoalsScored: PlayerValue | null
  // Quirky
  comebackKing: PlayerValue | null
  clutch: RecordWithGames | null
  choker: RecordWithGames | null
  bounceBack: WinRateRecord | null
  tilt: LossRateRecord | null
  kingmaker: LiftRecord | null
  anchor: LiftRecord | null
  jekyllHyde: VarianceRecord | null
}

export interface H2HRecord {
  name: string
  theirWins: number
  yourWins: number
  games: number
  rate: number
}
export interface TeammateRecord {
  name: string
  winRate: number
  games: number
  wins: number
}
export interface WeekdayRecord {
  weekday: string
  winRate: number
  games: number
}
export interface CurrentStreak {
  type: 'win' | 'loss' | 'none'
  length: number
}

export interface PlayerFacts {
  games: number
  wins: number
  losses: number
  winRate: number
  peakElo: number
  longestWinStreak: number
  longestLossStreak: number
  currentStreak: CurrentStreak
  mvpTitles: number
  nemesis: H2HRecord | null
  pigeon: H2HRecord | null
  bestTeammate: TeammateRecord | null
  bestWeekday: WeekdayRecord | null
  worstWeekday: WeekdayRecord | null
  avgGoalGain: number
  avgGoalsFor: number
  avgGoalsAgainst: number
}

export interface PlayerTag {
  emoji: string
  label: string
  tone: 'good' | 'bad' | 'neutral'
  key: string
}

export interface GlobalSummary {
  games: number
  players: number
  sessions: number
  totalGoals: number
  avgGoalsPerGame: number
}

export interface FunFacts {
  generatedAt: number
  totalGames: number
  summary: GlobalSummary
  players: { name: string; games: number }[]
  global: GlobalFacts
  byPlayer: Record<string, PlayerFacts>
  tags: Record<string, PlayerTag>
}

export function getFunFacts(): Promise<FunFacts> {
  return request('/funfacts')
}
