import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

/**
 * Bumbis Margin-of-Victory Team ELO (FiveThirtyEight-style)
 *
 * Key design decisions:
 *
 * 1. Binary result with margin-of-victory multiplier (MoV)
 *    S = 1 (strict win), 0.5 (pairwise draw), or 0 (loss) per pairwise comparison.
 *    Score gap feeds a MoV multiplier rather than the outcome S, keeping the
 *    logistic expected-value formula clean.
 *
 *    mov = ln(|score_A − score_B| + 1) / ln(4)
 *    Worked examples at equal ratings:
 *      10-9  → mov ≈ 0.50   (narrow win)
 *      10-7  → mov ≈ 1.00   (typical win, calibration point)
 *      10-0  → mov ≈ 1.73   (blowout)
 *
 *    Autocorrelation damper prevents over-rewarding favourites:
 *      acf = 2.2 / ((winner_eff − loser_eff) × 0.001 + 2.2)
 *    eff diff clamped to [−500, 500]; draws use mov = acf = 1 (plain Elo).
 *
 * 2. Additive size handicap (replaces old √(team_size) model)
 *    R_eff = avg_rating + SIZE_HANDICAP × (team_size − opponent_size)
 *    Computed per pairwise comparison; equal-skill 1v2 yields E_solo ≈ 0.15.
 *    Anonymous teams use INITIAL_RATING and size 1.
 *
 * 3. Multi-team games handled via pairwise averaging
 *    Each team compared against every other; per-player delta is the average of
 *    K × mov × acf × (S − E) over all opponents.
 *
 * 4. Individual K-factor progression
 *    K=120 (< 10 games) → K=90 (10+)
 *
 * 5. Starting ratings
 *    Default ballers: INITIAL_RATING = 1200.  Everyone else: NON_BALLER_INITIAL_RATING = 1000.
 *    No provisional penalty — new-player uncertainty is handled by the K schedule alone.
 *
 * 6. Strict-winner semantics
 *    `won = true` only when one team's score is the unique maximum.
 *    Tied-at-top results record no win for any team; all-zero-score games are
 *    rejected (400 from the API; empty Map from computeEloChanges for legacy replay).
 *
 * 7. Win-streak bonus
 *    A player riding a win streak gains extra rating on their next win. The
 *    bonus scales with the streak they carried INTO the game, so the second
 *    consecutive win is the first to be boosted: delta ×= 1 + min(MAX,
 *    PER_WIN × priorStreak). Only the winner's gain is amplified (the system is
 *    already non-zero-sum), and any non-win — loss or tied-top — resets the
 *    streak to zero, matching the funfacts `currentWinStreak` definition.
 */

export const INITIAL_RATING = 1200 // starting rating for default ballers / unknown opponents
export const NON_BALLER_INITIAL_RATING = 1000 // newcomers outside the regular roster start lower
export const SIZE_HANDICAP = 150 // additive eff-rating bonus per extra teammate vs the specific opponent

// --- Win-streak bonus ---------------------------------------------------------
// Players on a hot streak earn extra rating on each further win. The multiplier
// is keyed off the streak carried INTO the game, so the 2nd win in a row is the
// first to be boosted. Only the winner's positive delta is scaled.
export const STREAK_BONUS_PER_WIN = 0.1 // +10% delta per prior consecutive win
export const STREAK_BONUS_MAX = 0.5 // capped at +50% (reached at a 5-win streak)

/** Multiplier applied to a winner's delta given the streak they brought in. */
export function streakBonusMultiplier(priorStreak) {
  if (!priorStreak || priorStreak < 1) return 1
  return 1 + Math.min(STREAK_BONUS_MAX, STREAK_BONUS_PER_WIN * priorStreak)
}

// --- Inactivity decay ---------------------------------------------------------
// Players lose rating for every full day they don't play, once a grace period
// passes. Decay is DERIVED from a player's last-played timestamp and the current
// time — it is never baked into the stored "rating after last game". That keeps
// it deterministic: a full ELO rebuild (which replays only game results) and the
// daily-changing leaderboard both reproduce the same decayed value from the
// stored rating + last-played date, with no separate scheduled job to drift.
export const DECAY_PER_DAY = 2 // rating points lost per inactive day
export const DECAY_GRACE_DAYS = 7 // free inactive days before decay starts
export const DEFAULT_BALLER_GRACE_DAYS = 7 // grace for the regulars (currently same as everyone)
export const RATING_FLOOR = 800 // no rating ever drops below this (losses or decay)
export const DECAY_FLOOR = RATING_FLOOR // decay bottoms out at the same floor
const DAY_MS = 24 * 60 * 60 * 1000

// The regular roster ("default ballers") — defined once in shared/defaultBallers.json
// and imported by both the server and the frontend so the two lists cannot drift.
const DEFAULT_BALLERS = new Set(_require('../../shared/defaultBallers.json'))

/** Inactivity grace period (days) for a given player. */
export function graceDaysFor(name) {
  return DEFAULT_BALLERS.has(name) ? DEFAULT_BALLER_GRACE_DAYS : DECAY_GRACE_DAYS
}

/** Starting rating for a never-before-seen player. */
export function initialRatingFor(name) {
  return DEFAULT_BALLERS.has(name) ? INITIAL_RATING : NON_BALLER_INITIAL_RATING
}

/**
 * Rating after inactivity decay between `lastPlayedAt` and `asOf` (epoch ms).
 * Counts whole elapsed days only; the first `graceDays` are free. Decay bottoms
 * out at DECAY_FLOOR and never raises a rating already below it.
 */
export function decayedRating(rating, lastPlayedAt, asOf, graceDays = DECAY_GRACE_DAYS) {
  if (!lastPlayedAt || !asOf || rating <= DECAY_FLOOR) return rating
  const elapsedDays = Math.floor((asOf - lastPlayedAt) / DAY_MS)
  const decayDays = Math.max(0, elapsedDays - graceDays)
  if (decayDays === 0) return rating
  return Math.max(DECAY_FLOOR, rating - decayDays * DECAY_PER_DAY)
}

export function kFactor(gamesPlayed) {
  if (gamesPlayed < 10) return 120
  return 90
}

/**
 * Expected score for team A vs team B using their effective ratings.
 * Standard logistic formula on a 400-point scale.
 */
function expectedScore(effA, effB) {
  return 1 / (1 + Math.pow(10, (effB - effA) / 400))
}

/**
 * Resolve the effective player list for a team.
 *
 * Priority:
 *   1. Explicit players array (if non-empty)
 *   2. Team name as a single player — only when the name is not the default
 *      "Team N" pattern, so auto-names don't pollute the rankings.
 *   3. Empty → anonymous (used for opponent strength only, no ELO update)
 */
export function resolvePlayers(team) {
  if (Array.isArray(team.players) && team.players.length > 0) return team.players
  if (team.name && !/^Team \d+$/i.test(team.name.trim())) return [team.name.trim()]
  return []
}

/**
 * Average rating of a resolved lineup. Anonymous teams (empty players) return
 * INITIAL_RATING as a placeholder for opponent strength.
 */
function teamAvgRating(players, currentRatings) {
  if (players.length === 0) return INITIAL_RATING
  const ratings = players.map((name) => currentRatings.get(name)?.rating ?? initialRatingFor(name))
  return ratings.reduce((a, b) => a + b, 0) / ratings.length
}

/**
 * Predicted win probability per team for an upcoming game, using the same
 * effective-rating model as computeEloChanges. Generalises the pairwise Elo
 * expected score to N teams via Bradley–Terry (softmax over rating/400 in base
 * 10), so the two-team case matches expectedScore exactly. `teams` may be plain
 * lineups (string[][]) or team objects; returns probabilities aligned to the
 * input order, summing to 1.
 *
 * For each team i: eff_i = avg_rating_i + SIZE_HANDICAP × (size_i − mean_other_size_i)
 * This reduces to the pairwise formula for 2 teams, satisfying the two-team identity.
 */
export function predictWinProbabilities(teams, currentRatings) {
  if (!Array.isArray(teams) || teams.length === 0) return []
  const lineups = teams.map((t) => (Array.isArray(t) ? t : resolvePlayers(t)))
  const sizes = lineups.map((p) => Math.max(1, p.length)) // anonymous teams count as size 1
  const n = lineups.length
  const totalSize = sizes.reduce((a, b) => a + b, 0)

  const weights = lineups.map((players, i) => {
    const avgRating = teamAvgRating(players, currentRatings)
    const size = sizes[i]
    const meanOtherSize = (totalSize - size) / (n - 1)
    const eff = avgRating + SIZE_HANDICAP * (size - meanOtherSize)
    return Math.pow(10, eff / 400)
  })

  const total = weights.reduce((a, b) => a + b, 0)
  if (total === 0) return weights.map(() => 1 / weights.length)
  return weights.map((w) => w / total)
}

/**
 * Compute ELO deltas for a single game.
 *
 * @param {Array<{ name?: string, players: string[], score: number }>} teams
 * @param {Map<string, { rating: number, gamesPlayed: number }>} currentRatings
 * @returns {Map<string, { delta: number, oldRating: number, won: boolean, gamesPlayed: number }>}
 */
export function computeEloChanges(teams, currentRatings) {
  if (!Array.isArray(teams) || teams.length < 2) return new Map()
  // All-zero results are not valid — skip silently during legacy replay.
  if (teams.every((t) => t.score === 0)) return new Map()

  const scores = teams.map((t) => t.score)
  const maxScore = Math.max(...scores)
  const maxCount = scores.filter((s) => s === maxScore).length

  const enriched = teams.map((team) => {
    const players = resolvePlayers(team)
    return {
      players,
      score: team.score,
      // Anonymous teams are treated as size 1 for handicap purposes.
      size: players.length > 0 ? players.length : 1,
      avgRating: teamAvgRating(players, currentRatings),
      // won is true only for the unique top scorer.
      won: team.score === maxScore && maxCount === 1,
      anonymous: players.length === 0,
    }
  })

  // Need at least one team with a trackable identity.
  if (enriched.every((t) => t.anonymous)) return new Map()

  const n = enriched.length
  const changes = new Map()

  for (let i = 0; i < n; i++) {
    const teamA = enriched[i]
    if (teamA.anonymous) continue

    let pairwiseSum = 0
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const teamB = enriched[j]

      // Pairwise effective ratings — handicap is relative to this specific opponent.
      const pairEffA = teamA.avgRating + SIZE_HANDICAP * (teamA.size - teamB.size)
      const pairEffB = teamB.avgRating + SIZE_HANDICAP * (teamB.size - teamA.size)

      const E = expectedScore(pairEffA, pairEffB)

      // Binary S: strict win = 1, pairwise draw = 0.5, loss = 0.
      const S = teamA.score > teamB.score ? 1 : teamA.score === teamB.score ? 0.5 : 0

      let mov, acf
      if (S === 0.5) {
        // Draws use plain Elo — no MoV or autocorrelation adjustment.
        mov = 1
        acf = 1
      } else {
        const margin = Math.abs(teamA.score - teamB.score)
        mov = Math.log(margin + 1) / Math.log(4)

        const winnerEff = teamA.score > teamB.score ? pairEffA : pairEffB
        const loserEff = teamA.score > teamB.score ? pairEffB : pairEffA
        // Positive eff_diff → favourite won → acf < 1; negative → underdog won → acf > 1.
        const effDiff = Math.max(-500, Math.min(500, winnerEff - loserEff))
        acf = 2.2 / (effDiff * 0.001 + 2.2)
      }

      pairwiseSum += mov * acf * (S - E)
    }

    const pairwiseDelta = pairwiseSum / (n - 1)

    for (const name of teamA.players) {
      const entry = currentRatings.get(name)
      const gp = entry?.gamesPlayed ?? 0
      // Only winners are boosted; the bonus uses the streak carried into the game.
      const streakMult = teamA.won ? streakBonusMultiplier(entry?.winStreak ?? 0) : 1
      changes.set(name, {
        delta: kFactor(gp) * pairwiseDelta * streakMult,
        oldRating: entry?.rating ?? initialRatingFor(name),
        won: teamA.won,
        gamesPlayed: gp,
      })
    }
  }

  return changes
}
