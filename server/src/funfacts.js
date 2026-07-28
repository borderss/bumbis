import {
  INITIAL_RATING,
  RATING_FLOOR,
  computeEloChanges,
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
 * The replay deliberately ignores inactivity decay: decay is a presentation
 * concept applied lazily to the live leaderboard, whereas these facts describe
 * what actually happened in games. "Reigning champion" is the one fact that is
 * decay-aware, so it is taken straight from the live leaderboard instead.
 *
 * A handful of facts ask for information the log does not capture (we only
 * store final scores, never in-game progression). Those are mapped to the
 * closest faithful definition and that definition is surfaced in the UI:
 *   - "Comeback king" → most wins in the game immediately after a heavy loss.
 *   - "Trailing badly" is approximated by a heavy loss (lost by ≥ HEAVY_MARGIN).
 */

// --- Tunable thresholds -------------------------------------------------------
const MIN_GAMES_WINRATE = 8 // highest win rate / most balanced
const MIN_GAMES_RIVALRY = 4 // biggest / most lopsided rivalry
const MIN_GAMES_NEMESIS = 3 // nemesis / pigeon
const MIN_GAMES_DUO = 4 // best / cursed / most-played duo
const MIN_GAMES_CLOSE = 4 // clutch / choker
const MIN_GAMES_TIER = 4 // giant killer / flat-track bully
const MIN_GAMES_BOUNCE = 4 // bounce-back / tilt
const MIN_GAMES_WEEKDAY = 3 // lucky / cursed weekday (per player, per weekday)
const MIN_GAMES_SCORING = 8 // sharpshooter / iron wall / goal-difference king
const PERFECT_MIN_GAMES = 3 // a "perfect session" needs at least this many wins
const MVP_MIN_GAMES = 2 // games in a week to be eligible for weekly MVP
const MIN_WEEKS_MVP_RATE = 3 // weeks participated for "highest MVP rate"
const WOWY_MIN = 3 // teammate games with AND without you (kingmaker/anchor)
const WOWY_MIN_PARTNERS = 2 // qualifying teammates needed for a kingmaker/anchor score
const JEKYLL_MIN_DAYS = 4 // distinct play-days for Jekyll & Hyde variance
const HEAVY_MARGIN = 5 // a "heavy loss" / blow-out (2-team games)
const TIER_MARGIN = 25 // rating gap that makes an opponent "stronger" / "weaker"

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
function avg(nums) {
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

  // Head-to-head (opponents) and duo (teammates) tallies.
  const h2h = new Map() // pairKey -> { a, b, games, aWins, bWins }
  const duos = new Map() // pairKey -> { a, b, games, wins }

  // ELO replay state (game-driven, no decay).
  const running = new Map() // name -> { rating, gamesPlayed, wins }

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

  const recordDayChampion = () => {
    if (currentDay === null) return
    let champ = null
    let bestRating = -Infinity
    for (const [name, info] of running) {
      if (info.gamesPlayed > 0 && info.rating > bestRating) {
        bestRating = info.rating
        champ = name
      }
    }
    dayChampion.push(champ)
  }

  for (const { teams, playedAt } of results) {
    if (!Array.isArray(teams) || teams.length < 2) continue

    // winStreak has to travel with the rating: computeEloChanges reads it to apply
    // the win-streak bonus, so leaving it out would under-credit every winner on a
    // streak and drift the replayed ratings away from the live ones.
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
        avgBefore: players.length ? avg(ratings) : INITIAL_RATING,
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
      // Opponents: every cross-team pair.
      for (let j = i + 1; j < nTeams; j++) {
        const si = resolved[i].score
        const sj = resolved[j].score
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
            if (si > sj) h[p === h.a ? 'aWins' : 'bWins']++
            else if (sj > si) h[q === h.a ? 'aWins' : 'bWins']++
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
      const oppAvgBefore = oppRatings.length ? avg(oppRatings) : INITIAL_RATING

      // Two-team margin context (margin facts only make sense head-to-head).
      const oppTeam = nTeams === 2 ? resolved[1 - i] : null
      const margin = oppTeam ? team.score - oppTeam.score : null
      // Highest score among the other teams — lets us spot a one-goal win in any
      // format (2- or 3-team), where the winner edged the runner-up by a goal.
      const otherScores = resolved.filter((_, j) => j !== i).map((t) => t.score)
      const bestOtherScore = otherScores.length ? Math.max(...otherScores) : null

      for (const name of team.players) {
        const change = changes.get(name)
        if (!change) continue
        const before = change.oldRating
        const after = Math.max(RATING_FLOOR, before + change.delta)
        // Straight from the ELO engine, so wins here can never disagree with the
        // rankings: a tied top score counts as neither a win nor a loss.
        const won = change.won
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
          margin,
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
    const winners = resolved.filter((t) => t.won && t.players.length > 0)
    const losers = resolved.filter((t) => !t.won)
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
      const others = resolved.filter((t) => t !== winT)
      const runnerUp = others.reduce((m, t) => (t.score > m.score ? t : m), others[0])
      const bMargin = winT.score - runnerUp.score
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
      }
      info.rating = Math.max(RATING_FLOOR, change.oldRating + change.delta)
      info.gamesPlayed += 1
      if (change.won) info.wins += 1
      // Mirror applyEloChanges: extend on a win, reset on any non-win (loss or tied top).
      info.winStreak = change.won ? info.winStreak + 1 : 0
      running.set(name, info)
    }
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
      peak: Math.max(...games.map((g) => g.ratingAfter)),
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
      if (d.losses === 0 && d.wins >= PERFECT_MIN_GAMES) {
        if (!perfectSession || d.wins > perfectSession.games)
          perfectSession = { player: name, day, games: d.wins }
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
  let biggestRivalry = null
  let mostLopsided = null
  for (const h of h2h.values()) {
    if (!biggestRivalry || h.games > biggestRivalry.games)
      biggestRivalry = { a: h.a, b: h.b, games: h.games, aWins: h.aWins, bWins: h.bWins }
    if (h.games >= MIN_GAMES_RIVALRY) {
      const top = Math.max(h.aWins, h.bWins)
      const dominance = top / h.games
      if (
        !mostLopsided ||
        dominance > mostLopsided.dominance ||
        (dominance === mostLopsided.dominance && h.games > mostLopsided.games)
      ) {
        const winner = h.aWins >= h.bWins ? h.a : h.b
        const loser = h.aWins >= h.bWins ? h.b : h.a
        mostLopsided = {
          winner,
          loser,
          winnerWins: top,
          loserWins: Math.min(h.aWins, h.bWins),
          games: h.games,
          dominance,
        }
      }
    }
  }

  // --- Duos ---
  let bestDuo = null
  let cursedDuo = null
  let mostPlayedDuo = null
  for (const d of duos.values()) {
    if (!mostPlayedDuo || d.games > mostPlayedDuo.games)
      mostPlayedDuo = { a: d.a, b: d.b, games: d.games, wins: d.wins }
    if (d.games >= MIN_GAMES_DUO) {
      const wr = winRate(d.wins, d.games)
      if (!bestDuo || wr > bestDuo.winRate)
        bestDuo = { a: d.a, b: d.b, games: d.games, wins: d.wins, winRate: wr }
      if (!cursedDuo || wr < cursedDuo.winRate)
        cursedDuo = { a: d.a, b: d.b, games: d.games, wins: d.wins, winRate: wr }
    }
  }

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
      const cw = close.filter((g) => g.won).length
      const wr = winRate(cw, close.length)
      if (!clutch || wr > clutch.winRate)
        clutch = { player: name, winRate: wr, wins: cw, games: close.length }
      if (!choker || wr < choker.winRate)
        choker = { player: name, winRate: wr, wins: cw, games: close.length }
    }

    // After-a-loss record.
    let afterLossG = 0
    let afterLossW = 0
    for (let i = 1; i < games.length; i++) {
      if (games[i - 1].lost) {
        afterLossG++
        if (games[i].won) afterLossW++
      }
    }
    if (afterLossG >= MIN_GAMES_BOUNCE) {
      const wr = winRate(afterLossW, afterLossG)
      if (!bounceBack || wr > bounceBack.winRate)
        bounceBack = { player: name, winRate: wr, games: afterLossG }
      const lossRate = 1 - wr
      if (!tilt || lossRate > tilt.lossRate) tilt = { player: name, lossRate, games: afterLossG }
    }

    // Jekyll & Hyde: variance of per-day win rates.
    const byDay = perPlayer.get(name).byDay
    if (byDay.size >= JEKYLL_MIN_DAYS) {
      const rates = [...byDay.values()].map((d) => winRate(d.wins, d.games))
      const m = avg(rates)
      const variance = rates.reduce((s, r) => s + (r - m) ** 2, 0) / rates.length
      const std = Math.sqrt(variance)
      if (!jekyllHyde || std > jekyllHyde.value)
        jekyllHyde = { player: name, value: std, days: byDay.size }
    }
  }

  // Kingmaker / anchor (with-or-without-you lift on teammates).
  let kingmaker = null
  let anchor = null
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
        const together = g.teammates.includes(name)
        if (together) {
          withG++
          if (g.won) withW++
        } else {
          withoutG++
          if (g.won) withoutW++
        }
      }
      if (withG >= WOWY_MIN && withoutG >= WOWY_MIN) {
        lifts.push(winRate(withW, withG) - winRate(withoutW, withoutG))
      }
    }
    if (lifts.length >= WOWY_MIN_PARTNERS) {
      const score = avg(lifts)
      if (!kingmaker || score > kingmaker.value)
        kingmaker = { player: name, value: score, partners: lifts.length }
      if (!anchor || score < anchor.value)
        anchor = { player: name, value: score, partners: lifts.length }
    }
  }

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

    // Nemesis (beats you most) & pigeon (you beat most) from H2H.
    let nemesis = null
    let pigeon = null
    for (const h of h2h.values()) {
      if (h.a !== name && h.b !== name) continue
      const meIsA = h.a === name
      const myWins = meIsA ? h.aWins : h.bWins
      const theirWins = meIsA ? h.bWins : h.aWins
      const opp = meIsA ? h.b : h.a
      if (h.games < MIN_GAMES_NEMESIS) continue
      if (
        theirWins > 0 &&
        (!nemesis ||
          theirWins > nemesis.theirWins ||
          (theirWins === nemesis.theirWins && theirWins / h.games > nemesis.rate))
      )
        nemesis = {
          name: opp,
          theirWins,
          yourWins: myWins,
          games: h.games,
          rate: theirWins / h.games,
        }
      if (
        myWins > 0 &&
        (!pigeon ||
          myWins > pigeon.yourWins ||
          (myWins === pigeon.yourWins && myWins / h.games > pigeon.rate))
      )
        pigeon = { name: opp, yourWins: myWins, theirWins, games: h.games, rate: myWins / h.games }
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
    for (const [day, e] of wd) {
      if (e.games < MIN_GAMES_WEEKDAY) continue
      const wr = winRate(e.wins, e.games)
      if (!bestWeekday || wr > bestWeekday.winRate)
        bestWeekday = { weekday: WEEKDAY_NAMES[day], winRate: wr, games: e.games }
      if (!worstWeekday || wr < worstWeekday.winRate)
        worstWeekday = { weekday: WEEKDAY_NAMES[day], winRate: wr, games: e.games }
    }

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
  const weeksParticipated = {}

  for (const week of orderedWeeks) {
    const standings = weeks.get(week)
    // Only completed weeks count toward the MVP rate — titles can only be won
    // in completed weeks, so counting the in-progress week would dilute rates.
    if (week !== currentWeek)
      for (const name of standings.keys())
        weeksParticipated[name] = (weeksParticipated[name] ?? 0) + 1

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

  // Longest streak of consecutive (completed) MVP weeks by the same player.
  let longestStreak = null
  {
    let cur = null
    let curLen = 0
    for (const m of completed) {
      if (m.player === cur) curLen++
      else {
        cur = m.player
        curLen = 1
      }
      if (!longestStreak || curLen > longestStreak.value)
        longestStreak = { player: cur, value: curLen }
    }
  }

  let highestRate = null
  for (const [name, parts] of Object.entries(weeksParticipated)) {
    if (parts < MIN_WEEKS_MVP_RATE) continue
    const titles = titlesByPlayer[name] ?? 0
    const rate = titles / parts
    if (!highestRate || rate > highestRate.rate)
      highestRate = { player: name, rate, titles, weeks: parts }
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
