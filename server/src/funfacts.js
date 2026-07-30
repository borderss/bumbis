import {
  INITIAL_RATING,
  RATING_FLOOR,
  computeEloChanges,
  decayedRating,
  graceDaysFor,
  initialRatingFor,
  resolvePlayers,
} from './elo.js'

/**
 * Bumbis Fun Facts engine.
 *
 * Everything here is derived from the raw game-results log by replaying the
 * exact ELO algorithm (via `computeEloChanges`) game-by-game so the milestone
 * facts (peak rating, biggest gain/drop, upsets, daily champions, …) stay in
 * lock-step with the real ratings and can never silently drift from elo.js.
 *
 * The replay ignores inactivity decay for anything describing what happened in
 * a game (peak rating, gains, upsets): decay is a presentation concept applied
 * lazily to the live leaderboard, and a game's outcome does not change because
 * someone later stopped playing. The two "who is #1" facts are the exception —
 * "reigning champion" comes straight from the live (decayed) leaderboard, and
 * the daily champion applies the same decay rule during the replay. Without it
 * a player who won a few games and vanished keeps the crown for every later
 * session day, which is exactly what decay exists to prevent.
 *
 * Head-to-head and duo records both use elo.js's strict-winner rule: a win is a
 * unique top score. Merely outscoring another team in a 3-team game someone else
 * won is not a win over them, so such meetings are counted but stay undecided.
 * That keeps these records identical to the ones buildMatchupHistory derives for
 * the win prediction — the same pair must never show two different records.
 *
 * A handful of facts ask for information the log does not capture (we only
 * store final scores, never in-game progression). Those are mapped to the
 * closest faithful definition and that definition is surfaced in the UI:
 *   - "Comeback king" → most wins in the game immediately after a heavy loss.
 *   - "Trailing badly" is approximated by a heavy loss (lost by ≥ HEAVY_MARGIN).
 *
 * Every "worst X" fact needs at least two qualifying candidates. With a single
 * candidate the best and the worst are the same subject, which reads as a bug.
 */

// --- Tunable thresholds -------------------------------------------------------
const MIN_GAMES_WINRATE = 8 // highest win rate / most balanced
const MIN_GAMES_RIVALRY = 4 // decided meetings for "most lopsided rivalry"
const MIN_GAMES_NEMESIS = 3 // decided meetings for nemesis / pigeon
const MIN_GAMES_DUO = 4 // best / cursed / most-played duo
const MIN_GAMES_CLOSE = 4 // clutch / choker
const MIN_GAMES_TIER = 4 // giant killer / flat-track bully
const MIN_GAMES_BOUNCE = 4 // bounce-back / tilt
const MIN_GAMES_WEEKDAY = 3 // lucky / cursed weekday (per player, per weekday)
const MIN_GAMES_SCORING = 8 // sharpshooter / iron wall / goal-difference king
const PERFECT_MIN_GAMES = 3 // a "perfect session" needs at least this many games
const MVP_MIN_GAMES = 2 // games in a week to be eligible for weekly MVP
const MIN_WEEKS_MVP_RATE = 3 // eligible weeks for "highest MVP rate"
const WOWY_MIN = 3 // teammate games with AND without you (kingmaker/anchor)
const WOWY_MIN_PARTNERS = 2 // qualifying teammates needed for a kingmaker/anchor score
const JEKYLL_MIN_DAYS = 4 // qualifying play-days for Jekyll & Hyde variance
// A single-game day scores a win rate of exactly 0 or 1, which maximises the
// variance no matter how steady the player is. Only multi-game days can speak to
// day-to-day form, so days below this are left out of the Jekyll & Hyde spread.
const JEKYLL_MIN_GAMES_PER_DAY = 2
const HEAVY_MARGIN = 5 // a "heavy loss" / blow-out (2-team games)
const TIER_MARGIN = 25 // rating gap that makes an opponent "stronger" / "weaker"
// A "worst X" only means something when something else could have held it.
const MIN_CANDIDATES_FOR_WORST = 2

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// --- Date helpers (all UTC, so a replay is deterministic) ---------------------
function dayKeyOf(ts) {
  return new Date(ts).toISOString().slice(0, 10)
}
function monthKeyOf(ts) {
  return new Date(ts).toISOString().slice(0, 7)
}
function weekdayOf(ts) {
  return new Date(ts).getUTCDay() // 0 = Sunday
}
/** ISO-8601 week key, e.g. "2026-W24". */
function isoWeekOf(ts) {
  const d = new Date(ts)
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// --- Small utilities ----------------------------------------------------------
function pairKey(a, b) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}
/** Plain arithmetic mean; 0 for an empty list. */
function mean(nums) {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0
}
/**
 * Mean of a list of ratings. An empty lineup is anonymous, so it stands in at
 * INITIAL_RATING for opponent-strength purposes — never use this for anything
 * that is not a rating.
 */
function avgRating(nums) {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : INITIAL_RATING
}
function round(n) {
  return Math.round(n)
}
function round1(n) {
  return Math.round(n * 10) / 10
}
function winRate(wins, games) {
  return games > 0 ? wins / games : 0
}

/** Longest run of consecutive `true` in a boolean array. */
function longestRun(flags) {
  let best = 0
  let cur = 0
  for (const f of flags) {
    cur = f ? cur + 1 : 0
    if (cur > best) best = cur
  }
  return best
}
/** Trailing run of consecutive `true` at the end of a boolean array. */
function trailingRun(flags) {
  let cur = 0
  for (let i = flags.length - 1; i >= 0; i--) {
    if (flags[i]) cur++
    else break
  }
  return cur
}

// =============================================================================
// Main entry point
// =============================================================================
/**
 * @param {Array<{ teams: Array, playedAt: number }>} results chronological ASC
 * @param {Array<{ name, rating, games_played, wins }>} leaderboard live (decayed)
 */
export function computeFunFacts(results, leaderboard = []) {
  const now = Date.now()

  // Per-player ordered game log built during the replay.
  /** @type {Map<string, Array>} */
  const playerGames = new Map()
  const ensure = (name) => {
    let g = playerGames.get(name)
    if (!g) {
      g = []
      playerGames.set(name, g)
    }
    return g
  }

  // Head-to-head (opponents) and duo (teammates) tallies. `games` counts every
  // meeting; `aWins`/`bWins` only games one of them actually won, so in 3-team
  // games a meeting a third party won stays undecided and aWins + bWins < games.
  const h2h = new Map() // pairKey -> { a, b, games, aWins, bWins }
  const duos = new Map() // pairKey -> { a, b, games, wins }

  // ELO replay state (game-driven). Ratings carry no decay; lastPlayedAt is kept
  // so the daily champion can apply it, matching the live leaderboard's #1.
  const running = new Map() // name -> { rating, gamesPlayed, wins, winStreak, lastPlayedAt }

  // Milestone trackers.
  let peakElo = null // { player, rating, at }
  let biggestGain = null // { player, delta, rating, at }
  let hardestFall = null // { player, delta, rating, at }
  let biggestUpset = null // { winners, losers, gap, at, score }
  let biggestBlowout = null // { winners, losers, margin, score, at }
  const monthClimb = new Map() // `${name}|${month}` -> { name, month, first, last }

  // Global aggregate counters (summed across every counted game).
  let totalGoals = 0 // every team's score in every game
  let countedGames = 0 // games that contributed (valid teams + trackable players)

  // Daily champion ladder.
  const dayOrder = [] // unique day keys in chronological order
  const dayChampion = [] // champion name at the end of each day in dayOrder

  let currentDay = null
  let currentDayLastTs = null // last game of the day being closed, for decay

  /**
   * Crown the top-rated player as of the end of `currentDay`. Ratings are decayed
   * up to that day's last game with the same rule the live leaderboard uses, so a
   * player who stopped showing up loses the crown instead of holding it forever.
   */
  const recordDayChampion = () => {
    if (currentDay === null) return
    let champ = null
    let bestRating = -Infinity
    for (const [name, info] of running) {
      if (info.gamesPlayed === 0) continue
      const rating = decayedRating(
        info.rating,
        info.lastPlayedAt,
        currentDayLastTs,
        graceDaysFor(name),
      )
      if (rating > bestRating) {
        bestRating = rating
        champ = name
      }
    }
    dayChampion.push(champ)
  }

  for (const { teams, playedAt } of results) {
    if (!Array.isArray(teams) || teams.length < 2) continue

    // winStreak has to travel with the rating or computeEloChanges skips the
    // win-streak bonus and the replay drifts from the live ratings.
    const ratingsMap = new Map()
    for (const [name, info] of running) {
      ratingsMap.set(name, {
        rating: info.rating,
        gamesPlayed: info.gamesPlayed,
        winStreak: info.winStreak,
      })
    }
    const changes = computeEloChanges(teams, ratingsMap)
    if (changes.size === 0) continue // no trackable identities in this game

    const dKey = dayKeyOf(playedAt)
    if (dKey !== currentDay) {
      recordDayChampion()
      currentDay = dKey
      dayOrder.push(dKey)
    }

    const weekKey = isoWeekOf(playedAt)
    const monthKey = monthKeyOf(playedAt)
    const wday = weekdayOf(playedAt)
    const maxScore = Math.max(...teams.map((t) => t.score))
    // Strict-winner semantics, same as elo.js: a tied top score is a win for nobody.
    const maxCount = teams.filter((t) => t.score === maxScore).length
    // Total goals in the game; a team's goals-against is the average of the
    // opposing teams' scores ((total − own) ÷ opponents), matching computeGoalStats.
    const totalScore = teams.reduce((s, t) => s + t.score, 0)
    totalGoals += totalScore
    countedGames += 1

    // Resolve each team's named roster and pre-game average rating.
    const resolved = teams.map((t) => {
      const players = resolvePlayers(t)
      const ratings = players.map((n) => running.get(n)?.rating ?? initialRatingFor(n))
      return {
        players,
        score: t.score,
        won: t.score === maxScore && maxCount === 1,
        avgBefore: avgRating(ratings),
      }
    })
    const nTeams = resolved.length

    // ----- Head-to-head & duo tallies -----
    for (let i = 0; i < nTeams; i++) {
      // Duos: every unordered pair on the same team.
      const ps = resolved[i].players
      for (let a = 0; a < ps.length; a++) {
        for (let b = a + 1; b < ps.length; b++) {
          const key = pairKey(ps[a], ps[b])
          let d = duos.get(key)
          if (!d) {
            const [x, y] = key.split('\u0000')
            d = { a: x, b: y, games: 0, wins: 0 }
            duos.set(key, d)
          }
          d.games++
          if (resolved[i].won) d.wins++
        }
      }
      // Opponents: every cross-team pair. A win is credited only when that
      // player's team won the game outright — outscoring the other side in a game
      // a third team took is not a win over them, so the meeting stays undecided.
      for (let j = i + 1; j < nTeams; j++) {
        const iWon = resolved[i].won
        const jWon = resolved[j].won
        for (const p of resolved[i].players) {
          for (const q of resolved[j].players) {
            const key = pairKey(p, q)
            let h = h2h.get(key)
            if (!h) {
              const [x, y] = key.split('\u0000')
              h = { a: x, b: y, games: 0, aWins: 0, bWins: 0 }
              h2h.set(key, h)
            }
            h.games++
            if (iWon) h[p === h.a ? 'aWins' : 'bWins']++
            else if (jWon) h[q === h.a ? 'aWins' : 'bWins']++
          }
        }
      }
    }

    // ----- Per-player game records + ELO replay application -----
    for (let i = 0; i < nTeams; i++) {
      const team = resolved[i]
      if (team.players.length === 0) continue

      const oppPlayers = resolved.filter((_, j) => j !== i).flatMap((t) => t.players)
      const oppRatings = resolved
        .filter((_, j) => j !== i)
        .flatMap((t) => t.players.map((n) => running.get(n)?.rating ?? initialRatingFor(n)))
      const oppAvgBefore = avgRating(oppRatings)

      // The single opposing team, for facts that only make sense head-to-head.
      const oppTeam = nTeams === 2 ? resolved[1 - i] : null
      // Highest score among the other teams — lets us spot a one-goal win in any
      // format (2- or 3-team), where the winner edged the runner-up by a goal.
      const otherScores = resolved.filter((_, j) => j !== i).map((t) => t.score)
      const bestOtherScore = otherScores.length ? Math.max(...otherScores) : null

      for (const name of team.players) {
        const change = changes.get(name)
        if (!change) continue
        const before = change.oldRating
        const after = Math.max(RATING_FLOOR, before + change.delta)
        const won = change.won // from the ELO engine, so it can't disagree with the rankings
        const lost = team.score < maxScore

        ensure(name).push({
          ts: playedAt,
          dayKey: dKey,
          weekKey,
          monthKey,
          weekday: wday,
          won,
          lost,
          nTeams,
          myScore: team.score,
          oppScore: oppTeam ? oppTeam.score : null,
          // Average of the opposing teams' scores, so 3-team games (enemy sum ÷ 2)
          // are comparable to head-to-head rather than double-counting concessions.
          goalsAgainst: (totalScore - team.score) / Math.max(1, nTeams - 1),
          // Close / one-goal / heavy / shutout facts compare against the
          // best other team, so they hold for 2- and 3-team games alike.
          closeGame: bestOtherScore !== null && Math.abs(team.score - bestOtherScore) === 1,
          oneGoalWin: won && bestOtherScore !== null && team.score - bestOtherScore === 1,
          // A clean sheet = every opposing team scored zero (totalScore − own === 0).
          shutoutFor: won && totalScore - team.score === 0,
          shutoutAgainst: lost && team.score === 0,
          heavyLoss: lost && bestOtherScore !== null && bestOtherScore - team.score >= HEAVY_MARGIN,
          myAvgBefore: team.avgBefore,
          oppAvgBefore,
          ratingBefore: before,
          ratingAfter: after,
          delta: change.delta,
          teammates: team.players.filter((p) => p !== name),
          opponents: oppPlayers,
        })

        // Milestone trackers.
        if (!peakElo || after > peakElo.rating)
          peakElo = { player: name, rating: after, at: playedAt }
        if (!biggestGain || change.delta > biggestGain.delta)
          biggestGain = { player: name, delta: change.delta, rating: after, at: playedAt }
        if (!hardestFall || change.delta < hardestFall.delta)
          hardestFall = { player: name, delta: change.delta, rating: after, at: playedAt }

        const mKey = `${name}|${monthKey}`
        let mc = monthClimb.get(mKey)
        if (!mc) {
          mc = { name, month: monthKey, first: before, last: after }
          monthClimb.set(mKey, mc)
        } else {
          mc.last = after
        }
      }
    }

    // ----- Biggest upset (winner team much weaker than a losing team) -----
    // Both sides must be nameable: an anonymous team has no roster to show and
    // stands in at INITIAL_RATING, so it would render a blank opponent list and
    // invent a rating gap out of a placeholder.
    const winners = resolved.filter((t) => t.won && t.players.length > 0)
    const losers = resolved.filter((t) => !t.won && t.players.length > 0)
    if (winners.length && losers.length) {
      const strongestLoser = losers.reduce((m, t) => (t.avgBefore > m.avgBefore ? t : m))
      for (const w of winners) {
        const gap = strongestLoser.avgBefore - w.avgBefore
        if (gap > 0 && (!biggestUpset || gap > biggestUpset.gap)) {
          biggestUpset = {
            winners: w.players.slice(),
            losers: strongestLoser.players.slice(),
            gap,
            at: playedAt,
            score: `${w.score}–${strongestLoser.score}`,
          }
        }
      }
    }

    // ----- Biggest blowout (largest margin over the runner-up, any format) -----
    // Needs a single clear winner; the "losers" shown are the runner-up team.
    const blowoutWinners = resolved.filter((t) => t.won && t.players.length > 0)
    if (blowoutWinners.length === 1) {
      const winT = blowoutWinners[0]
      // Same rule as the upset: only a nameable runner-up can be displayed.
      const others = resolved.filter((t) => t !== winT && t.players.length > 0)
      const runnerUp = others.reduce((m, t) => (t.score > m.score ? t : m), others[0])
      const bMargin = runnerUp ? winT.score - runnerUp.score : 0
      if (bMargin > 0 && (!biggestBlowout || bMargin > biggestBlowout.margin)) {
        biggestBlowout = {
          winners: winT.players.slice(),
          losers: runnerUp.players.slice(),
          margin: bMargin,
          score: `${winT.score}–${runnerUp.score}`,
          at: playedAt,
        }
      }
    }

    // ----- Apply ELO changes to the running (no-decay) ratings -----
    for (const [name, change] of changes) {
      const info = running.get(name) ?? {
        rating: change.oldRating,
        gamesPlayed: 0,
        wins: 0,
        winStreak: 0,
        lastPlayedAt: playedAt,
      }
      info.rating = Math.max(RATING_FLOOR, change.oldRating + change.delta)
      info.gamesPlayed += 1
      info.lastPlayedAt = playedAt
      if (change.won) info.wins += 1
      // Mirror applyEloChanges: extend on a win, reset on any non-win (loss or tied top).
      info.winStreak = change.won ? info.winStreak + 1 : 0
      running.set(name, info)
    }

    currentDayLastTs = playedAt
  }
  recordDayChampion() // close out the final day

  // ===========================================================================
  // Derive facts from the collected structures
  // ===========================================================================
  const players = [...playerGames.keys()]

  // --- Streaks & volume per player ---
  const perPlayer = new Map()
  for (const name of players) {
    const games = playerGames.get(name)
    const wins = games.filter((g) => g.won).length
    const losses = games.filter((g) => g.lost).length
    const winFlags = games.map((g) => g.won)
    const lossFlags = games.map((g) => g.lost)

    // Average goals scored, conceded, and net gain per game (all games played).
    const goalsFor = games.reduce((s, g) => s + g.myScore, 0)
    const goalsAgainst = games.reduce((s, g) => s + g.goalsAgainst, 0)
    const avgGoalsFor = games.length ? goalsFor / games.length : 0
    const avgGoalsAgainst = games.length ? goalsAgainst / games.length : 0

    // Wins per day & perfect sessions.
    const byDay = new Map()
    for (const g of games) {
      let d = byDay.get(g.dayKey)
      if (!d) {
        d = { games: 0, wins: 0, losses: 0 }
        byDay.set(g.dayKey, d)
      }
      d.games++
      if (g.won) d.wins++
      if (g.lost) d.losses++
    }

    perPlayer.set(name, {
      games,
      total: games.length,
      wins,
      losses,
      winRate: winRate(wins, games.length),
      longestWinStreak: longestRun(winFlags),
      longestLossStreak: longestRun(lossFlags),
      currentWinStreak: trailingRun(winFlags),
      currentLossStreak: trailingRun(lossFlags),
      avgGoalsFor,
      avgGoalsAgainst,
      avgGoalGain: avgGoalsFor - avgGoalsAgainst,
      goalsForTotal: goalsFor,
      goalsAgainstTotal: goalsAgainst,
      byDay,
      // A rating is "reached" the moment you hold it, so the rating carried into
      // the first game counts too — otherwise a player who only ever lost peaks
      // below the rating they actually started from.
      peak: Math.max(games[0].ratingBefore, ...games.map((g) => g.ratingAfter)),
    })
  }

  // --- Global streak / session records ---
  const longestWinStreak = bestOf(players, (n) => perPlayer.get(n).longestWinStreak, 1)
  const longestLossStreak = bestOf(players, (n) => perPlayer.get(n).longestLossStreak, 1)
  const currentWinStreak = bestOf(players, (n) => perPlayer.get(n).currentWinStreak, 1)

  let mostWinsInDay = null
  let perfectSession = null
  for (const name of players) {
    for (const [day, d] of perPlayer.get(name).byDay) {
      if (d.wins > 0 && (!mostWinsInDay || d.wins > mostWinsInDay.value))
        mostWinsInDay = { player: name, value: d.wins, day, games: d.games }
      // "Won every game played" means exactly that — a tied-top game is not a
      // loss, but it is not a win either, so it disqualifies the session.
      if (d.wins === d.games && d.games >= PERFECT_MIN_GAMES) {
        if (!perfectSession || d.games > perfectSession.games)
          perfectSession = { player: name, day, games: d.games }
      }
    }
  }

  // Longest streak of consecutive sessions attended (over global session days).
  let longestAttendance = null
  for (const name of players) {
    const present = new Set(playerGames.get(name).map((g) => g.dayKey))
    const run = longestRun(dayOrder.map((d) => present.has(d)))
    if (!longestAttendance || run > longestAttendance.value)
      longestAttendance = { player: name, value: run }
  }

  // Daily champion reigns.
  const championDays = new Map()
  for (const c of dayChampion) if (c) championDays.set(c, (championDays.get(c) ?? 0) + 1)
  let mostDaysAsChampion = null
  for (const [name, days] of championDays)
    if (!mostDaysAsChampion || days > mostDaysAsChampion.value)
      mostDaysAsChampion = { player: name, value: days }
  let longestReign = null
  {
    let cur = null
    let curLen = 0
    for (const c of dayChampion) {
      if (c && c === cur) curLen++
      else {
        cur = c
        curLen = c ? 1 : 0
      }
      if (c && (!longestReign || curLen > longestReign.value))
        longestReign = { player: c, value: curLen }
    }
  }

  // --- Dominance & margins ---
  const mostShutoutsDelivered = bestOf(
    players,
    (n) => playerGames.get(n).filter((g) => g.shutoutFor).length,
    1,
  )
  const mostTimesShutout = bestOf(
    players,
    (n) => playerGames.get(n).filter((g) => g.shutoutAgainst).length,
    1,
  )
  const mostOneGoalWins = bestOf(
    players,
    (n) => playerGames.get(n).filter((g) => g.oneGoalWin).length,
    1,
  )

  // --- Volume & rates ---
  const mostGames = bestOf(players, (n) => perPlayer.get(n).total, 1)
  const eligibleWR = players.filter((n) => perPlayer.get(n).total >= MIN_GAMES_WINRATE)
  const highestWinRate = bestOfDetailed(eligibleWR, (n) => {
    const p = perPlayer.get(n)
    return { value: p.winRate, detail: { winRate: p.winRate, wins: p.wins, games: p.total } }
  })
  const mostBalanced = bestOfDetailed(eligibleWR, (n) => {
    const p = perPlayer.get(n)
    return { value: -Math.abs(p.winRate - 0.5), detail: { winRate: p.winRate, games: p.total } }
  })

  // --- Goals & scoring ---
  const eligibleScoring = players.filter((n) => perPlayer.get(n).total >= MIN_GAMES_SCORING)
  const sharpshooter = bestOfDetailed(eligibleScoring, (n) => {
    const p = perPlayer.get(n)
    return { value: p.avgGoalsFor, detail: { value: round1(p.avgGoalsFor), games: p.total } }
  })
  // Rank on the negated concession rate so the lowest average wins.
  const ironWall = bestOfDetailed(eligibleScoring, (n) => {
    const p = perPlayer.get(n)
    return { value: -p.avgGoalsAgainst, detail: { value: round1(p.avgGoalsAgainst), games: p.total } }
  })
  const goalDiffKing = bestOfDetailed(eligibleScoring, (n) => {
    const p = perPlayer.get(n)
    return { value: p.avgGoalGain, detail: { value: round1(p.avgGoalGain), games: p.total } }
  })
  const mostGoalsScored = bestOf(players, (n) => round(perPlayer.get(n).goalsForTotal), 1)

  // --- Rivalries & H2H ---
  // "Biggest" counts every meeting; "most lopsided" is a dominance ratio, so it
  // only looks at the meetings one of the two actually won — undecided games say
  // nothing about who is dominating whom, and leaving them in the denominator
  // would cap a perfect record below 100%.
  let biggestRivalry = null
  let mostLopsided = null
  for (const h of h2h.values()) {
    if (!biggestRivalry || h.games > biggestRivalry.games)
      // `games` is every meeting but the win columns only cover the decided ones,
      // so `undecided` is carried too — otherwise the three numbers shown on the
      // card do not add up and the record looks like it is missing games.
      biggestRivalry = {
        a: h.a,
        b: h.b,
        games: h.games,
        aWins: h.aWins,
        bWins: h.bWins,
        undecided: h.games - h.aWins - h.bWins,
      }
    const decided = h.aWins + h.bWins
    if (decided >= MIN_GAMES_RIVALRY) {
      const top = Math.max(h.aWins, h.bWins)
      const dominance = top / decided
      if (
        !mostLopsided ||
        dominance > mostLopsided.dominance ||
        (dominance === mostLopsided.dominance && decided > mostLopsided.games)
      ) {
        const winner = h.aWins >= h.bWins ? h.a : h.b
        const loser = h.aWins >= h.bWins ? h.b : h.a
        mostLopsided = {
          winner,
          loser,
          winnerWins: top,
          loserWins: Math.min(h.aWins, h.bWins),
          games: decided,
          dominance,
        }
      }
    }
  }

  // --- Duos ---
  let bestDuo = null
  let cursedDuo = null
  let mostPlayedDuo = null
  let qualifyingDuos = 0
  for (const d of duos.values()) {
    if (!mostPlayedDuo || d.games > mostPlayedDuo.games)
      mostPlayedDuo = { a: d.a, b: d.b, games: d.games, wins: d.wins }
    if (d.games >= MIN_GAMES_DUO) {
      qualifyingDuos++
      const wr = winRate(d.wins, d.games)
      if (!bestDuo || wr > bestDuo.winRate)
        bestDuo = { a: d.a, b: d.b, games: d.games, wins: d.wins, winRate: wr }
      if (!cursedDuo || wr < cursedDuo.winRate)
        cursedDuo = { a: d.a, b: d.b, games: d.games, wins: d.wins, winRate: wr }
    }
  }
  // With one qualifying duo it would be both the best and the "cursed" one.
  if (qualifyingDuos < MIN_CANDIDATES_FOR_WORST) cursedDuo = null

  // --- ELO milestones (continued) ---
  let mostImproved = null
  for (const mc of monthClimb.values()) {
    const climb = mc.last - mc.first
    if (!mostImproved || climb > mostImproved.value)
      mostImproved = { player: mc.name, value: climb, month: mc.month }
  }

  // Giant killer & flat-track bully (tier-relative records).
  let giantKiller = null
  let flatTrackBully = null
  for (const name of players) {
    const games = playerGames.get(name)
    let strongG = 0
    let strongW = 0
    let weakG = 0
    let weakW = 0
    for (const g of games) {
      const diff = g.oppAvgBefore - g.myAvgBefore
      if (diff > TIER_MARGIN) {
        strongG++
        if (g.won) strongW++
      } else if (diff < -TIER_MARGIN) {
        weakG++
        if (g.won) weakW++
      }
    }
    if (strongG >= MIN_GAMES_TIER) {
      const wr = winRate(strongW, strongG)
      if (!giantKiller || wr > giantKiller.winRate)
        giantKiller = { player: name, winRate: wr, wins: strongW, games: strongG }
    }
    if (strongG >= MIN_GAMES_TIER && weakG >= MIN_GAMES_TIER) {
      const gap = winRate(weakW, weakG) - winRate(strongW, strongG)
      if (!flatTrackBully || gap > flatTrackBully.gap)
        flatTrackBully = {
          player: name,
          gap,
          weakWinRate: winRate(weakW, weakG),
          strongWinRate: winRate(strongW, strongG),
          weakGames: weakG,
          strongGames: strongG,
        }
    }
  }

  const highestPeakElo = bestOf(players, (n) => round(perPlayer.get(n).peak), 1)

  // --- Quirky ---
  // Comeback king: wins in the game right after a heavy (≥HEAVY_MARGIN) loss.
  let comebackKing = null
  // Clutch / choker: record in 1-goal games.
  let clutch = null
  let choker = null
  // Bounce-back / tilt: outcome in the game right after any loss.
  let bounceBack = null
  let tilt = null
  let jekyllHyde = null
  let closeGameCandidates = 0
  let bounceCandidates = 0

  for (const name of players) {
    const games = playerGames.get(name)

    // Comeback king.
    let comebacks = 0
    for (let i = 1; i < games.length; i++) {
      if (games[i - 1].heavyLoss && games[i].won) comebacks++
    }
    if (!comebackKing || comebacks > comebackKing.value)
      comebackKing = { player: name, value: comebacks }

    // Close-game (1-goal) record.
    const close = games.filter((g) => g.closeGame)
    if (close.length >= MIN_GAMES_CLOSE) {
      closeGameCandidates++
      const cw = close.filter((g) => g.won).length
      const wr = winRate(cw, close.length)
      if (!clutch || wr > clutch.winRate)
        clutch = { player: name, winRate: wr, wins: cw, games: close.length }
      if (!choker || wr < choker.winRate)
        choker = { player: name, winRate: wr, wins: cw, games: close.length }
    }

    // After-a-loss record. Losses are counted directly rather than as "did not
    // win", so a tied-top game is not reported as a loss.
    let afterLossG = 0
    let afterLossW = 0
    let afterLossL = 0
    for (let i = 1; i < games.length; i++) {
      if (games[i - 1].lost) {
        afterLossG++
        if (games[i].won) afterLossW++
        if (games[i].lost) afterLossL++
      }
    }
    if (afterLossG >= MIN_GAMES_BOUNCE) {
      bounceCandidates++
      const wr = winRate(afterLossW, afterLossG)
      if (!bounceBack || wr > bounceBack.winRate)
        bounceBack = { player: name, winRate: wr, games: afterLossG }
      const lossRate = winRate(afterLossL, afterLossG)
      if (!tilt || lossRate > tilt.lossRate) tilt = { player: name, lossRate, games: afterLossG }
    }

    // Jekyll & Hyde: spread of per-day win rates. Single-game days are skipped —
    // their rate can only be 0 or 1, which would swamp the spread with noise.
    const multiGameDays = [...perPlayer.get(name).byDay.values()].filter(
      (d) => d.games >= JEKYLL_MIN_GAMES_PER_DAY,
    )
    if (multiGameDays.length >= JEKYLL_MIN_DAYS) {
      const rates = multiGameDays.map((d) => winRate(d.wins, d.games))
      const m = mean(rates)
      const variance = rates.reduce((s, r) => s + (r - m) ** 2, 0) / rates.length
      const std = Math.sqrt(variance)
      if (!jekyllHyde || std > jekyllHyde.value)
        jekyllHyde = { player: name, value: std, days: multiGameDays.length }
    }
  }
  // A lone qualifier would be both the clutch player and the choker.
  if (closeGameCandidates < MIN_CANDIDATES_FOR_WORST) choker = null
  if (bounceCandidates < MIN_CANDIDATES_FOR_WORST) tilt = null

  // Kingmaker / anchor (with-or-without-you lift on teammates).
  let kingmaker = null
  let anchor = null
  let wowyCandidates = 0
  for (const name of players) {
    const lifts = []
    // Build the set of teammates this player has ever had.
    const teammates = new Set()
    for (const g of playerGames.get(name)) for (const t of g.teammates) teammates.add(t)
    for (const mate of teammates) {
      const mateGames = playerGames.get(mate) ?? []
      let withG = 0
      let withW = 0
      let withoutG = 0
      let withoutW = 0
      for (const g of mateGames) {
        // "Without" has to mean absent, not on the other side. Counting games the
        // mate played AGAINST this player as "without" credits a strong player
        // twice: teammates win alongside them and lose facing them, and both
        // halves inflate the same lift.
        if (g.teammates.includes(name)) {
          withG++
          if (g.won) withW++
        } else if (!g.opponents.includes(name)) {
          withoutG++
          if (g.won) withoutW++
        }
      }
      if (withG >= WOWY_MIN && withoutG >= WOWY_MIN) {
        lifts.push(winRate(withW, withG) - winRate(withoutW, withoutG))
      }
    }
    if (lifts.length >= WOWY_MIN_PARTNERS) {
      wowyCandidates++
      const score = mean(lifts)
      if (!kingmaker || score > kingmaker.value)
        kingmaker = { player: name, value: score, partners: lifts.length }
      if (!anchor || score < anchor.value)
        anchor = { player: name, value: score, partners: lifts.length }
    }
  }
  // A lone qualifier would be both the kingmaker and the anchor.
  if (wowyCandidates < MIN_CANDIDATES_FOR_WORST) anchor = null

  // --- MVP & titles ---
  const mvp = computeMvp(playerGames, players, now)

  // --- Reigning champion (decay-aware, from the live leaderboard) ---
  const reigningChampion = leaderboard.length
    ? { player: leaderboard[0].name, rating: leaderboard[0].rating }
    : null

  // ===========================================================================
  // Per-player facts (drive the player selector: nemesis, pigeon, personal panel)
  // ===========================================================================
  const byPlayer = {}
  for (const name of players) {
    const p = perPlayer.get(name)

    // Nemesis (beats you most) & pigeon (you beat most) from H2H. Both are about
    // who beat whom, so undecided meetings are excluded from the count and the
    // rate — `games` here means "meetings one of us won".
    let nemesis = null
    let pigeon = null
    for (const h of h2h.values()) {
      if (h.a !== name && h.b !== name) continue
      const meIsA = h.a === name
      const myWins = meIsA ? h.aWins : h.bWins
      const theirWins = meIsA ? h.bWins : h.aWins
      const opp = meIsA ? h.b : h.a
      const decided = myWins + theirWins
      if (decided < MIN_GAMES_NEMESIS) continue
      if (
        theirWins > 0 &&
        (!nemesis ||
          theirWins > nemesis.theirWins ||
          (theirWins === nemesis.theirWins && theirWins / decided > nemesis.rate))
      )
        nemesis = {
          name: opp,
          theirWins,
          yourWins: myWins,
          games: decided,
          rate: theirWins / decided,
        }
      if (
        myWins > 0 &&
        (!pigeon ||
          myWins > pigeon.yourWins ||
          (myWins === pigeon.yourWins && myWins / decided > pigeon.rate))
      )
        pigeon = { name: opp, yourWins: myWins, theirWins, games: decided, rate: myWins / decided }
    }

    // Best teammate (highest win rate together, min games).
    let bestTeammate = null
    for (const d of duos.values()) {
      if (d.a !== name && d.b !== name) continue
      if (d.games < MIN_GAMES_DUO) continue
      const mate = d.a === name ? d.b : d.a
      const wr = winRate(d.wins, d.games)
      if (!bestTeammate || wr > bestTeammate.winRate)
        bestTeammate = { name: mate, winRate: wr, games: d.games, wins: d.wins }
    }

    // Lucky / cursed weekday.
    const wd = new Map()
    for (const g of p.games) {
      let e = wd.get(g.weekday)
      if (!e) {
        e = { games: 0, wins: 0 }
        wd.set(g.weekday, e)
      }
      e.games++
      if (g.won) e.wins++
    }
    let bestWeekday = null
    let worstWeekday = null
    let qualifyingWeekdays = 0
    for (const [day, e] of wd) {
      if (e.games < MIN_GAMES_WEEKDAY) continue
      qualifyingWeekdays++
      const wr = winRate(e.wins, e.games)
      if (!bestWeekday || wr > bestWeekday.winRate)
        bestWeekday = { weekday: WEEKDAY_NAMES[day], winRate: wr, games: e.games }
      if (!worstWeekday || wr < worstWeekday.winRate)
        worstWeekday = { weekday: WEEKDAY_NAMES[day], winRate: wr, games: e.games }
    }
    // One qualifying weekday would be both the lucky and the cursed one.
    if (qualifyingWeekdays < MIN_CANDIDATES_FOR_WORST) worstWeekday = null

    const cur =
      p.currentWinStreak > 0
        ? { type: 'win', length: p.currentWinStreak }
        : p.currentLossStreak > 0
          ? { type: 'loss', length: p.currentLossStreak }
          : { type: 'none', length: 0 }

    byPlayer[name] = {
      games: p.total,
      wins: p.wins,
      losses: p.losses,
      winRate: p.winRate,
      peakElo: round(p.peak),
      longestWinStreak: p.longestWinStreak,
      longestLossStreak: p.longestLossStreak,
      currentStreak: cur,
      mvpTitles: mvp.titlesByPlayer[name] ?? 0,
      nemesis,
      pigeon,
      bestTeammate,
      bestWeekday,
      worstWeekday,
      avgGoalGain: p.avgGoalGain,
      avgGoalsFor: p.avgGoalsFor,
      avgGoalsAgainst: p.avgGoalsAgainst,
    }
  }

  // Player list for the selector, most active first.
  const playerList = players
    .map((name) => ({ name, games: perPlayer.get(name).total }))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))

  const global = {
    // Streaks & runs
    longestWinStreak,
    currentWinStreak,
    longestLossStreak,
    mostWinsInDay,
    perfectSession,
    longestAttendance,
    longestReign,
    mostDaysAsChampion,
    // Dominance & margins
    mostShutoutsDelivered,
    mostTimesShutout,
    mostOneGoalWins,
    biggestBlowout: biggestBlowout
      ? {
          winners: biggestBlowout.winners,
          losers: biggestBlowout.losers,
          margin: biggestBlowout.margin,
          score: biggestBlowout.score,
        }
      : null,
    // MVP & titles
    weeklyMvp: mvp.latest,
    mostMvpTitles: mvp.mostTitles,
    longestMvpStreak: mvp.longestStreak,
    highestMvpRate: mvp.highestRate,
    reigningChampion,
    // Rivalries & head-to-head
    biggestRivalry,
    mostLopsided,
    bestDuo,
    cursedDuo,
    mostPlayedDuo,
    // ELO milestones
    highestPeakElo,
    biggestGain: biggestGain
      ? {
          player: biggestGain.player,
          value: round(biggestGain.delta),
          rating: round(biggestGain.rating),
        }
      : null,
    biggestUpset: biggestUpset
      ? {
          winners: biggestUpset.winners,
          losers: biggestUpset.losers,
          gap: round(biggestUpset.gap),
          score: biggestUpset.score,
        }
      : null,
    hardestFall: hardestFall
      ? {
          player: hardestFall.player,
          value: round(hardestFall.delta),
          rating: round(hardestFall.rating),
        }
      : null,
    mostImproved: mostImproved
      ? { player: mostImproved.player, value: round(mostImproved.value), month: mostImproved.month }
      : null,
    giantKiller,
    flatTrackBully,
    // Volume & rates
    mostGames,
    highestWinRate,
    mostBalanced,
    // Goals & scoring
    sharpshooter,
    ironWall,
    goalDiffKing,
    mostGoalsScored,
    // Quirky
    comebackKing: comebackKing && comebackKing.value > 0 ? comebackKing : null,
    clutch,
    choker,
    bounceBack,
    tilt,
    kingmaker,
    anchor,
    jekyllHyde,
  }

  // Headline aggregates across the whole dataset (shown above the records).
  const summary = {
    games: countedGames,
    players: players.length,
    sessions: dayOrder.length,
    totalGoals: round(totalGoals),
    avgGoalsPerGame: countedGames ? Math.round((totalGoals / countedGames) * 10) / 10 : 0,
  }

  const tags = computePlayerTags(global, byPlayer, players)

  return {
    generatedAt: now,
    totalGames: results.length,
    summary,
    players: playerList,
    global,
    byPlayer,
    tags,
  }
}

// --- Leaderboard tags ---------------------------------------------------------
// Give every player a single "signature" badge for the rankings list. Global
// titles are assigned to their holder in priority order and each title is
// claimed only once, so badges stay diverse; players who hold no record fall
// back to a personal signature derived from their own stats.
function computePlayerTags(g, byPlayer, players) {
  const tags = {}
  const pct = (n) => `${Math.round(n * 100)}%`
  // `key` ties the badge to its plain-language explanation (see funfactInfo.ts).
  const set = (name, key, emoji, label, tone = 'good') => {
    if (!name || tags[name]) return
    tags[name] = { emoji, label, tone, key }
  }

  // Prestigious global titles first.
  if (g.reigningChampion)
    set(g.reigningChampion.player, 'reigningChampion', '👑', 'Reigning Champion')
  if (g.weeklyMvp) set(g.weeklyMvp.player, 'weeklyMvp', '🏅', 'MVP of the Week')
  if (g.mostMvpTitles)
    set(g.mostMvpTitles.player, 'mostMvpTitles', '🏆', `${g.mostMvpTitles.value}× MVP`)
  if (g.highestPeakElo)
    set(g.highestPeakElo.player, 'highestPeakElo', '🚀', `Peak ${g.highestPeakElo.value}`)
  if (g.longestWinStreak)
    set(
      g.longestWinStreak.player,
      'longestWinStreak',
      '🔥',
      `${g.longestWinStreak.value}-win streak`,
    )
  if (g.highestWinRate)
    set(
      g.highestWinRate.player,
      'highestWinRate',
      '🎯',
      `${pct(g.highestWinRate.winRate)} win rate`,
    )
  if (g.mostImproved) set(g.mostImproved.player, 'mostImproved', '📈', 'Most Improved')
  if (g.giantKiller) set(g.giantKiller.player, 'giantKiller', '🥋', 'Giant Killer')
  if (g.biggestUpset)
    for (const n of g.biggestUpset.winners) set(n, 'biggestUpset', '😱', 'Giant Slayer')
  if (g.biggestGain)
    set(g.biggestGain.player, 'biggestGain', '📊', `+${g.biggestGain.value} single game`)
  if (g.comebackKing) set(g.comebackKing.player, 'comebackKing', '🔄', 'Comeback King')
  if (g.clutch) set(g.clutch.player, 'clutch', '🧊', 'Ice Cold')
  if (g.mostOneGoalWins) set(g.mostOneGoalWins.player, 'mostOneGoalWins', '⚡', 'Photo-Finisher')
  if (g.mostShutoutsDelivered)
    set(
      g.mostShutoutsDelivered.player,
      'mostShutoutsDelivered',
      '🧱',
      `${g.mostShutoutsDelivered.value} shutouts`,
    )
  if (g.sharpshooter) set(g.sharpshooter.player, 'sharpshooter', '⚽', 'Sharpshooter')
  if (g.ironWall) set(g.ironWall.player, 'ironWall', '🧤', 'Iron Wall')
  if (g.mostGoalsScored)
    set(g.mostGoalsScored.player, 'mostGoalsScored', '🥅', `${g.mostGoalsScored.value} goals`)
  if (g.biggestBlowout)
    for (const n of g.biggestBlowout.winners) set(n, 'biggestBlowout', '💥', 'Demolition')
  if (g.kingmaker) set(g.kingmaker.player, 'kingmaker', '✨', 'Kingmaker')
  if (g.currentWinStreak) set(g.currentWinStreak.player, 'currentWinStreak', '🌶️', 'On Fire')
  if (g.mostWinsInDay) set(g.mostWinsInDay.player, 'mostWinsInDay', '☀️', 'Session Hero')
  if (g.longestReign) set(g.longestReign.player, 'longestReign', '🏰', 'Longest Reign')
  if (g.mostDaysAsChampion)
    set(g.mostDaysAsChampion.player, 'mostDaysAsChampion', '📆', 'Most Days at #1')
  if (g.longestAttendance)
    set(g.longestAttendance.player, 'longestAttendance', '🎟️', 'Always Shows Up')
  if (g.perfectSession) set(g.perfectSession.player, 'perfectSession', '💎', 'Perfect Session')
  if (g.mostGames) set(g.mostGames.player, 'mostGames', '💪', 'The Grinder')
  if (g.bestDuo) {
    set(g.bestDuo.a, 'bestDuo', '🤝', 'Best Duo')
    set(g.bestDuo.b, 'bestDuo', '🤝', 'Best Duo')
  }
  if (g.mostPlayedDuo) {
    set(g.mostPlayedDuo.a, 'mostPlayedDuo', '🧪', 'Chemistry')
    set(g.mostPlayedDuo.b, 'mostPlayedDuo', '🧪', 'Chemistry')
  }
  if (g.mostLopsided) set(g.mostLopsided.winner, 'mostLopsided', '😈', 'Bully')
  if (g.mostBalanced)
    set(g.mostBalanced.player, 'mostBalanced', '⚖️', 'Perfectly Balanced', 'neutral')
  if (g.jekyllHyde) set(g.jekyllHyde.player, 'jekyllHyde', '🎭', 'Jekyll & Hyde', 'neutral')
  if (g.flatTrackBully)
    set(g.flatTrackBully.player, 'flatTrackBully', '🏋️', 'Flat-Track Bully', 'neutral')

  // Light-hearted "loser" titles (still claimed once each).
  if (g.longestLossStreak)
    set(g.longestLossStreak.player, 'longestLossStreak', '🥄', 'Wooden Spoon', 'bad')
  if (g.mostTimesShutout)
    set(g.mostTimesShutout.player, 'mostTimesShutout', '🥚', 'Bagel Collector', 'bad')
  if (g.anchor) set(g.anchor.player, 'anchor', '⚓', 'The Anchor', 'bad')
  if (g.choker) set(g.choker.player, 'choker', '😰', 'Choker', 'bad')
  if (g.tilt) set(g.tilt.player, 'tilt', '🌋', 'Tilt-Prone', 'bad')

  // Fallback: a personal signature for anyone still untagged.
  for (const name of players) {
    if (tags[name]) continue
    const p = byPlayer[name]
    if (!p) continue
    if (p.currentStreak.type === 'win' && p.currentStreak.length >= 3)
      set(name, 'personal', '🔥', `${p.currentStreak.length}-game heater`, 'good')
    else if (p.games >= 5 && p.winRate >= 0.6)
      set(name, 'personal', '💯', `${pct(p.winRate)} winner`, 'good')
    else if (p.longestWinStreak >= 3)
      set(name, 'personal', '🔥', `${p.longestWinStreak}-win best`, 'good')
    else if (p.pigeon) set(name, 'personal', '🎯', `Owns ${p.pigeon.name}`, 'good')
    else if (p.currentStreak.type === 'loss' && p.currentStreak.length >= 3)
      set(name, 'personal', '🧊', `${p.currentStreak.length}-game cold spell`, 'bad')
    else if (p.peakElo) set(name, 'personal', '📊', `Peak ${p.peakElo}`, 'neutral')
    else set(name, 'personal', '🎲', 'Baller', 'neutral')
  }

  return tags
}

// --- MVP computation ----------------------------------------------------------
// Weekly MVP = best net ELO gain that week (min games), tie-broken by wins then
// games. Titles, longest consecutive-week streak, and rate are derived from it.
function computeMvp(playerGames, players, now) {
  // week -> player -> { net, wins, games }
  const weeks = new Map()
  for (const name of players) {
    for (const g of playerGames.get(name)) {
      let w = weeks.get(g.weekKey)
      if (!w) {
        w = new Map()
        weeks.set(g.weekKey, w)
      }
      let s = w.get(name)
      if (!s) {
        s = { net: 0, wins: 0, games: 0 }
        w.set(name, s)
      }
      s.net += g.delta
      s.games++
      if (g.won) s.wins++
    }
  }

  const currentWeek = isoWeekOf(now)
  const orderedWeeks = [...weeks.keys()].sort()
  const mvpByWeek = [] // { week, player, net, wins, games } in chronological order
  const titlesByPlayer = {}
  const weeksEligible = {} // completed weeks the player was MVP-eligible in
  // Completed weeks each player appeared in at all — the streak walks these, so a
  // week you played but did not win breaks the run even if nobody won it.
  const weeksPlayed = new Map() // player -> Set of week keys

  for (const week of orderedWeeks) {
    const standings = weeks.get(week)
    // The MVP rate divides titles by the weeks you could actually have won one:
    // completed (a title can only be won in a completed week) and played often
    // enough to be eligible. Counting a one-game week would hold a rate down for
    // a week the player was never in the running.
    if (week !== currentWeek)
      for (const [name, s] of standings) {
        if (s.games >= MVP_MIN_GAMES) weeksEligible[name] = (weeksEligible[name] ?? 0) + 1
        let played = weeksPlayed.get(name)
        if (!played) {
          played = new Set()
          weeksPlayed.set(name, played)
        }
        played.add(week)
      }

    let best = null
    for (const [name, s] of standings) {
      if (s.games < MVP_MIN_GAMES) continue
      if (
        !best ||
        s.net > best.net ||
        (s.net === best.net && s.wins > best.wins) ||
        (s.net === best.net && s.wins === best.wins && s.games > best.games)
      )
        best = { player: name, net: s.net, wins: s.wins, games: s.games }
    }
    if (!best) continue
    const entry = {
      week,
      player: best.player,
      net: Math.round(best.net),
      wins: best.wins,
      games: best.games,
    }
    if (week !== currentWeek) {
      // Only completed weeks earn a title.
      titlesByPlayer[best.player] = (titlesByPlayer[best.player] ?? 0) + 1
    }
    mvpByWeek.push({ ...entry, completed: week !== currentWeek })
  }

  const completed = mvpByWeek.filter((m) => m.completed)
  const latest = completed.length ? completed[completed.length - 1] : null

  let mostTitles = null
  for (const [name, count] of Object.entries(titlesByPlayer))
    if (!mostTitles || count > mostTitles.value) mostTitles = { player: name, value: count }

  // Longest run of consecutive weeks the player took the MVP, counted across the
  // completed weeks they actually played. Walking only the weeks that produced an
  // MVP would step over a week the player played and lost, joining two separate
  // runs into one — so the player's own weeks are the sequence, not the awards.
  const mvpWeekOwner = new Map(completed.map((m) => [m.week, m.player]))
  let longestStreak = null
  for (const [name, played] of weeksPlayed) {
    const flags = [...played].sort().map((week) => mvpWeekOwner.get(week) === name)
    const run = longestRun(flags)
    if (run > 0 && (!longestStreak || run > longestStreak.value))
      longestStreak = { player: name, value: run }
  }

  let highestRate = null
  for (const [name, eligible] of Object.entries(weeksEligible)) {
    if (eligible < MIN_WEEKS_MVP_RATE) continue
    const titles = titlesByPlayer[name] ?? 0
    const rate = titles / eligible
    if (!highestRate || rate > highestRate.rate)
      highestRate = { player: name, rate, titles, weeks: eligible }
  }

  return { latest, mostTitles, longestStreak, highestRate, titlesByPlayer }
}

// --- Ranking helpers ----------------------------------------------------------
/** Highest `accessor(name)` across names; null unless it meets `minValue`. */
function bestOf(names, accessor, minValue = -Infinity) {
  let best = null
  for (const name of names) {
    const value = accessor(name)
    if (value >= minValue && (!best || value > best.value)) best = { player: name, value }
  }
  return best
}
/** Like bestOf but the accessor returns { value, detail } and detail is kept. */
function bestOfDetailed(names, accessor) {
  let best = null
  for (const name of names) {
    const { value, detail } = accessor(name)
    if (!best || value > best._value) best = { player: name, _value: value, ...detail }
  }
  if (best) delete best._value
  return best
}
