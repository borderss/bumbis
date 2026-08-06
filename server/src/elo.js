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
 *    Computed per pairwise comparison. Anonymous teams use INITIAL_RATING and
 *    size 1.
 *
 *    A one-player team is handled separately: rather than take the handicap for
 *    a missing body, it is padded with a phantom teammate and rates at
 *    (1 − SOLO_HANDICAP) of the player. See "Playing a man down".
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
 *
 * 8. Matchup history (prediction only, never ratings)
 *    predictWinProbabilities can take a history index so the forecast knows who
 *    beats whom and which duos overperform — see "Matchup history" below. It
 *    shifts effective ratings for the forecast alone; computeEloChanges is
 *    untouched, so the ladder stays a pure margin-of-victory ELO.
 */

export const INITIAL_RATING = 1200 // starting rating for default ballers / unknown opponents
export const NON_BALLER_INITIAL_RATING = 1000 // newcomers outside the regular roster start lower
export const SIZE_HANDICAP = 150 // additive eff-rating bonus per extra teammate vs the specific opponent

// --- Playing a man down -------------------------------------------------------
// A lone player facing partnered opposition is short a teammate. The empty slot
// is filled with a phantom, so the team rates below the player themselves:
//
//   team_rating = player_rating × (1 − SOLO_HANDICAP)
//
// A phantom rated 0 would halve it, which reads as too harsh — being alone is a
// disadvantage, not a 50% one. At 0.35 the team rates at 65% of the player, i.e.
// the phantom is worth about 30% of a real teammate.
//
// The discount alone would make the solo slot the best seat in the game: an
// expectation that low means a defeat costs almost nothing, so simply being the
// odd one out would be worth playing for. SOLO_LOSS_MULTIPLIER pays that back —
// a lone player's losses count double, so the position stays a gamble rather than
// free money. Only their losses scale; a win is already priced by the discount.
export const SOLO_HANDICAP = 0.35
export const SOLO_LOSS_MULTIPLIER = 2

// --- Win-streak bonus ---------------------------------------------------------
// Players on a hot streak earn extra rating on each further win. The multiplier
// is keyed off the streak carried INTO the game, so the 2nd win in a row is the
// first to be boosted. Only the winner's positive delta is scaled.
//
// The bonus is the one part of the model that mints rating from nowhere, and it
// turns out to be nearly all of it: replaying a season at this group's format mix
// (87 two-team, 135 three-team games) injects ~1100 points with the bonus and ~25
// without — the rest of the model is very close to zero-sum. The injection spreads
// evenly across players regardless of win rate, so it does not distort the order,
// but it does drift the whole scale away from the 1200 everyone starts at.
//
// Halving it halves the drift, and costs nothing that shows: the average rating
// change per game moves from 32.9 to 32.5 points, because the swing comes from
// the K-factor and margin-of-victory, not from this.
// Three-team runs pay more than two-team ones, because the odds differ. Measured
// over 222 games in this group: a player wins 50.5% of the two-team games they
// play and 34.1% of the three-team ones — beating two sides is 1.48x rarer than
// beating one. The three-team rate is set 1.5x the two-team rate to match.
//
// Deliberately NOT scaled by run length. Rarity compounds — a 3-win three-team
// run is 3.2x rarer than the same run in 2v2, and a 5-win run 7.1x — so paying
// the true odds would make three-team games the only place rating is made. The
// flat 1.5x prices the harder win without swamping the ladder.
export const STREAK_BONUS_PER_WIN = 0.05 // +5% delta per prior consecutive win (2 teams)
export const STREAK_BONUS_MAX = 0.25 // capped at +25% (reached at a 5-win streak)
export const STREAK_BONUS_PER_WIN_MULTI = 0.075 // +7.5% per prior win (3+ teams)
export const STREAK_BONUS_MAX_MULTI = 0.375 // capped at +37.5%, also at 5 wins

/**
 * Which streak counter a game belongs to, keyed by how many teams played.
 *
 * Streaks are tracked per format because winning three-team games and winning
 * two-team games are not the same achievement — a third side to beat makes the
 * run rarer. Carrying one into the other let a 2v2 run pay out on a 2v2v2 win it
 * had not earned, and vice versa. Counters are independent: losing a two-team
 * game does not reset a three-team run, so a run can sit idle across a stretch
 * of the other format and still pay when that format comes back around.
 */
export function streakBucket(teamCount) {
  return teamCount >= 3 ? 'multi' : 'duel'
}

/**
 * The streak a player carries into a game of this format. Accepts either the
 * per-format record ({ duel, multi }) or a plain number, so a caller that has
 * not been migrated still reads as a single shared counter rather than throwing.
 */
export function streakFor(entry, teamCount) {
  const s = entry?.winStreak
  if (typeof s === 'number') return s
  return s?.[streakBucket(teamCount)] ?? 0
}

/**
 * Advance a per-format streak record after a game: the played format extends on
 * a win and resets on any non-win, the other format is left untouched.
 */
export function nextStreak(prevStreak, won, teamCount) {
  const prev = typeof prevStreak === 'number' ? { duel: prevStreak, multi: prevStreak } : prevStreak
  const bucket = streakBucket(teamCount)
  return {
    duel: bucket === 'duel' ? (won ? (prev?.duel ?? 0) + 1 : 0) : prev?.duel ?? 0,
    multi: bucket === 'multi' ? (won ? (prev?.multi ?? 0) + 1 : 0) : prev?.multi ?? 0,
  }
}

/**
 * Multiplier applied to a winner's delta given the streak they brought in and
 * the format they are playing. `teamCount` defaults to 2, so a caller that has
 * not been migrated gets the two-team rate rather than the larger one.
 */
export function streakBonusMultiplier(priorStreak, teamCount = 2) {
  if (!priorStreak || priorStreak < 1) return 1
  const multi = streakBucket(teamCount) === 'multi'
  const perWin = multi ? STREAK_BONUS_PER_WIN_MULTI : STREAK_BONUS_PER_WIN
  const max = multi ? STREAK_BONUS_MAX_MULTI : STREAK_BONUS_MAX
  return 1 + Math.min(max, perWin * priorStreak)
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
// Sitting out only costs you down to DECAY_FLOOR; losing games can take you to
// RATING_FLOOR. Anything below 800 is therefore earned on the pitch.
export const RATING_FLOOR = 500 // hard floor for game results
export const DECAY_FLOOR = 800 // inactivity decay stops here
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
 * out at DECAY_FLOOR and never raises a rating already below it — a player who
 * lost their way below that floor is simply left alone by decay.
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
 * How the model sees one team: its mean rating, the size used for the pairwise
 * handicap, and whether it is a lone player carrying a phantom teammate.
 *
 * The phantom brings the roster up to two, so SIZE_HANDICAP no longer fires for
 * the missing body — the discount is the whole of the adjustment and the two
 * mechanisms cannot double-count. It is opponent-strength bookkeeping only: it
 * is never in `players`, so it neither gains nor loses rating.
 *
 * It applies only to a genuine one-player roster. An anonymous team already
 * stands in at INITIAL_RATING as a placeholder for unknown opposition, and a
 * game where nobody has a partner (1v1, 1v1v1) leaves no one outnumbered.
 */
function effectiveTeam(players, currentRatings, largestTeamSize) {
  const avgRating = teamAvgRating(players, currentRatings)
  const size = players.length > 0 ? players.length : 1 // anonymous teams count as size 1
  if (players.length === 1 && largestTeamSize > 1) {
    return { size: 2, avgRating: avgRating * (1 - SOLO_HANDICAP), solo: true }
  }
  return { size, avgRating, solo: false }
}

/** Largest real roster in a game — what a lone player is measured as short of. */
function largestRoster(lineups) {
  return lineups.reduce((m, p) => Math.max(m, p.length), 0)
}

// --- Matchup history ----------------------------------------------------------
// Ratings already fold in every past game, but only as one number per player.
// They can say Roberts is the stronger player; they cannot say that Jānis beats
// him anyway, or that two particular teammates are lethal specifically together.
// The prediction therefore layers a matchup term on top, learned from each past
// game's RESIDUAL: what actually happened minus what the ratings alone expected.
// Working from the residual rather than the raw win rate is what keeps this from
// double-counting the rating gap the ratings already express.
export const HISTORY_ELO_PER_RESIDUAL = 400 // a +0.25 residual ≈ +100 effective rating
export const HISTORY_MAX_ELO = 120 // backstop cap on the shift a matchup may apply
// Shrinkage pseudo-games: a pair's edge is their residual SUM over (games + K),
// so one meeting is worth ~5% of its face value, ten ~33%, twenty ~50%. K is
// deliberately large because a single binary result is mostly noise: at even
// ratings a coin-flip win still scores a +0.5 residual. Tuned so one meeting
// moves a 50/50 bar by ~3 points while a settled nemesis moves it by ~20.
export const H2H_SHRINK_GAMES = 20
export const DUO_SHRINK_GAMES = 20

/**
 * Order-independent key for a player pair, used by both history maps. The NUL
 * separator cannot occur in a name, so "Jon Doe" + "Ann" and "Jon" + "Doe Ann"
 * cannot collide.
 */
export function pairKey(a, b) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

/**
 * Fold one settled game's residuals into the head-to-head and duo tallies.
 * `ratings` is the rating state as it stood before this game.
 */
function recordMatchup(h2h, duo, lineups, winnerIndex, ratings) {
  // Expectation from ratings alone — history must never feed back into itself.
  const expected = predictWinProbabilities(lineups, ratings)
  const residuals = lineups.map((_, i) => (i === winnerIndex ? 1 : 0) - expected[i])

  for (let i = 0; i < lineups.length; i++) {
    const players = lineups[i]
    const won = i === winnerIndex

    // Teammate pairs share their team's residual.
    for (let x = 0; x < players.length; x++) {
      for (let y = x + 1; y < players.length; y++) {
        const [a, b] =
          players[x] < players[y] ? [players[x], players[y]] : [players[y], players[x]]
        const key = pairKey(a, b)
        const rec = duo.get(key) ?? { a, b, games: 0, wins: 0, sum: 0 }
        rec.games += 1
        rec.wins += won ? 1 : 0
        rec.sum += residuals[i]
        duo.set(key, rec)
      }
    }

    // Opposing pairs record the gap between the two sides' residuals. Halving it
    // makes the two-team case land exactly on the winner's own residual (±1).
    for (let j = i + 1; j < lineups.length; j++) {
      for (const p of players) {
        for (const q of lineups[j]) {
          if (p === q) continue // same name on both sides: nothing to learn
          const [a, b] = p < q ? [p, q] : [q, p]
          const key = pairKey(a, b)
          const rec = h2h.get(key) ?? { a, b, games: 0, aWins: 0, bWins: 0, sum: 0 }
          const aSide = p === a ? i : j
          const bSide = p === a ? j : i
          rec.games += 1
          rec.sum += (residuals[aSide] - residuals[bSide]) / 2
          if (winnerIndex === aSide) rec.aWins += 1
          else if (winnerIndex === bSide) rec.bWins += 1
          h2h.set(key, rec)
        }
      }
    }
  }
}

/**
 * Distil a chronological list of results into per-pair matchup history.
 *
 * @param {Array<{ teams: Array<{ name?: string, players?: string[], score: number }>,
 *                 playedAt: number }>} results ascending by playedAt.
 * @returns {{ h2h: Map, duo: Map }}
 *   h2h: pairKey -> { a, b, games, aWins, bWins, sum }, `sum` accumulating a's
 *        edge over b in win-probability terms (±1 per two-team game).
 *   duo: pairKey -> { a, b, games, wins, sum }, `sum` accumulating the residual
 *        of the team the two shared.
 *
 * Only games the ELO model itself counts contribute — no all-zero scorelines, at
 * least one identifiable team, and a strict unique winner (a tied top teaches
 * nothing about who beats whom). Ratings are replayed forwards exactly as
 * recalculateElo does, so every game is judged against the expectation that
 * stood at the time rather than one computed with hindsight.
 */
export function buildMatchupHistory(results) {
  const h2h = new Map()
  const duo = new Map()
  if (!Array.isArray(results)) return { h2h, duo }

  const state = new Map() // name -> { rating, gamesPlayed, winStreak, lastPlayedAt }

  for (const { teams, playedAt } of results) {
    const current = new Map()
    for (const [name, r] of state) {
      current.set(name, {
        rating: decayedRating(r.rating, r.lastPlayedAt, playedAt, graceDaysFor(name)),
        gamesPlayed: r.gamesPlayed,
        winStreak: r.winStreak,
      })
    }

    // An empty change set means the game is invalid for ELO, so also for history.
    const changes = computeEloChanges(teams, current)
    if (changes.size > 0) {
      const scores = teams.map((t) => t.score)
      const maxScore = Math.max(...scores)
      if (scores.filter((s) => s === maxScore).length === 1) {
        recordMatchup(h2h, duo, teams.map(resolvePlayers), scores.indexOf(maxScore), current)
      }
    }

    for (const [name, { delta, won }] of changes) {
      const prev = state.get(name)
      const base = prev
        ? decayedRating(prev.rating, prev.lastPlayedAt, playedAt, graceDaysFor(name))
        : initialRatingFor(name)
      state.set(name, {
        rating: Math.max(RATING_FLOOR, base + delta),
        gamesPlayed: (prev?.gamesPlayed ?? 0) + 1,
        winStreak: nextStreak(prev?.winStreak, won, teams.length),
        lastPlayedAt: playedAt,
      })
    }
  }

  return { h2h, duo }
}

/**
 * The effective-rating shift each team earns from matchup history, plus the one
 * pair that contributed most (for display). Aligned to `lineups`.
 *
 * A reported pair carries `games`, `wins` and `losses`. For head-to-head those
 * need not add up: in a three-team game where a third side wins, the two met but
 * neither beat the other, so wins + losses < games. Callers rendering the record
 * have to account for that remainder.
 *
 * Per team we average the shrunk per-pair edges — head-to-head across every
 * cross-team pair, synergy across every teammate pair — so pairs who have never
 * met simply pull the average toward zero. A matchup edge is inherently relative,
 * so the result is centred across teams, then clamped to HISTORY_MAX_ELO.
 */
export function computeMatchupShifts(lineups, history) {
  const blank = () => ({ eloShift: 0, topPair: null })
  if (!Array.isArray(lineups) || lineups.length < 2) return (lineups ?? []).map(blank)
  const h2h = history?.h2h
  const duo = history?.duo
  if (!h2h && !duo) return lineups.map(blank)

  const n = lineups.length
  const drafts = lineups.map((players, i) => {
    let best = null
    const consider = (edge, pair) => {
      if (Math.abs(edge) > Math.abs(best?.edge ?? 0)) best = { edge, pair }
    }

    let h2hSum = 0
    let h2hPairs = 0
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      for (const p of players) {
        for (const q of lineups[j]) {
          if (p === q) continue
          h2hPairs += 1
          const rec = h2h?.get(pairKey(p, q))
          if (!rec) continue
          const mine = p === rec.a
          const edge = (mine ? rec.sum : -rec.sum) / (rec.games + H2H_SHRINK_GAMES)
          h2hSum += edge
          consider(edge, {
            kind: 'h2h',
            a: p,
            b: q,
            games: rec.games,
            wins: mine ? rec.aWins : rec.bWins,
            losses: mine ? rec.bWins : rec.aWins,
          })
        }
      }
    }

    let duoSum = 0
    let duoPairs = 0
    for (let x = 0; x < players.length; x++) {
      for (let y = x + 1; y < players.length; y++) {
        duoPairs += 1
        const rec = duo?.get(pairKey(players[x], players[y]))
        if (!rec) continue
        const edge = rec.sum / (rec.games + DUO_SHRINK_GAMES)
        duoSum += edge
        consider(edge, {
          kind: 'duo',
          a: players[x],
          b: players[y],
          games: rec.games,
          wins: rec.wins,
          // Only settled games are recorded, so every non-win is a loss here.
          losses: rec.games - rec.wins,
        })
      }
    }

    const residual = (h2hPairs > 0 ? h2hSum / h2hPairs : 0) + (duoPairs > 0 ? duoSum / duoPairs : 0)
    return { raw: HISTORY_ELO_PER_RESIDUAL * residual, best }
  })

  const mean = drafts.reduce((sum, d) => sum + d.raw, 0) / n
  return drafts.map((d) => ({
    eloShift: Math.max(-HISTORY_MAX_ELO, Math.min(HISTORY_MAX_ELO, d.raw - mean)),
    topPair: d.best?.pair ?? null,
  }))
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
 *
 * Pass a `history` index from buildMatchupHistory to add each team's matchup
 * shift to its effective rating. The shift is centred across teams, so the
 * two-team identity still holds — against expectedScore of the shifted ratings.
 * Omit it (the default) for a pure-rating prediction; buildMatchupHistory relies
 * on that path staying history-free.
 */
export function predictWinProbabilities(teams, currentRatings, history = null) {
  if (!Array.isArray(teams) || teams.length === 0) return []
  const lineups = teams.map((t) => (Array.isArray(t) ? t : resolvePlayers(t)))
  const n = lineups.length
  const biggest = largestRoster(lineups)
  const effective = lineups.map((players) => effectiveTeam(players, currentRatings, biggest))
  const sizes = effective.map((e) => e.size)
  const totalSize = sizes.reduce((a, b) => a + b, 0)
  const shifts = history ? computeMatchupShifts(lineups, history) : null

  const weights = effective.map(({ avgRating, size }, i) => {
    const meanOtherSize = (totalSize - size) / (n - 1)
    const eff = avgRating + SIZE_HANDICAP * (size - meanOtherSize) + (shifts?.[i].eloShift ?? 0)
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

  const lineups = teams.map(resolvePlayers)
  const biggest = largestRoster(lineups)
  const enriched = teams.map((team, i) => {
    const players = lineups[i]
    // A lone player against partnered opposition rates at half, on a roster of
    // two — see effectiveTeam.
    const { size, avgRating, solo } = effectiveTeam(players, currentRatings, biggest)
    return {
      players,
      score: team.score,
      size,
      avgRating,
      solo,
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

    // Playing a man down already prices a defeat as near-costless, which would
    // make the solo slot the seat everyone wants. Doubling the loss keeps it a
    // gamble. Losses only — a win is priced by the rating discount alone.
    const soloLossMult = teamA.solo && pairwiseDelta < 0 ? SOLO_LOSS_MULTIPLIER : 1

    for (const name of teamA.players) {
      const entry = currentRatings.get(name)
      const gp = entry?.gamesPlayed ?? 0
      // Only winners are boosted; the bonus uses the streak carried into the
      // game, counted within this format alone.
      const streakMult = teamA.won
        ? streakBonusMultiplier(streakFor(entry, teams.length), teams.length)
        : 1
      changes.set(name, {
        delta: kFactor(gp) * pairwiseDelta * streakMult * soloLossMult,
        oldRating: entry?.rating ?? initialRatingFor(name),
        won: teamA.won,
        gamesPlayed: gp,
      })
    }
  }

  return changes
}
