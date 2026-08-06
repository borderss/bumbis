// Run: node --test src/elo.test.js
// Covers the matchup-history layer on top of the rating model — a history-free
// prediction is untouched, a real head-to-head or duo record moves the forecast,
// a single game barely does — plus the rules for a lone player facing partnered
// opposition and the win-streak bonus.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HISTORY_MAX_ELO,
  SOLO_HANDICAP,
  SOLO_LOSS_MULTIPLIER,
  STREAK_BONUS_MAX,
  STREAK_BONUS_MAX_MULTI,
  STREAK_BONUS_PER_WIN,
  STREAK_BONUS_PER_WIN_MULTI,
  buildMatchupHistory,
  computeEloChanges,
  computeMatchupShifts,
  nextStreak,
  pairKey,
  predictWinProbabilities,
  streakBonusMultiplier,
  streakFor,
} from './elo.js'

const DAY = 24 * 60 * 60 * 1000
// Play in the future so inactivity decay never bites during a replay.
const START = Date.now() + 365 * DAY

/** A 2-team result in the shape getResultsForRecalculation returns. */
function game(index, [homeNames, homeScore], [awayNames, awayScore]) {
  return {
    teams: [
      { players: homeNames, score: homeScore },
      { players: awayNames, score: awayScore },
    ],
    playedAt: START + index * DAY,
  }
}

/** Ratings map with everyone pinned equal, so only history can move a forecast. */
function flatRatings(names, rating = 1200) {
  return new Map(names.map((n) => [n, { rating, gamesPlayed: 20, winStreak: 0 }]))
}

test('pair keys are order-independent and cannot collide on names with spaces', () => {
  assert.equal(pairKey('Ann', 'Bob'), pairKey('Bob', 'Ann'))
  assert.notEqual(pairKey('Jon Doe', 'Ann'), pairKey('Jon', 'Doe Ann'))
})

test('no history leaves the prediction exactly as it was', () => {
  const lineups = [['Ann'], ['Bob']]
  const ratings = new Map([
    ['Ann', { rating: 1300, gamesPlayed: 20, winStreak: 0 }],
    ['Bob', { rating: 1100, gamesPlayed: 20, winStreak: 0 }],
  ])
  const plain = predictWinProbabilities(lineups, ratings)
  const empty = predictWinProbabilities(lineups, ratings, buildMatchupHistory([]))
  assert.deepEqual(empty, plain)
  assert.deepEqual(predictWinProbabilities(lineups, ratings, { h2h: new Map(), duo: new Map() }), plain)
})

test('a nemesis beats the ratings: the underdog is favoured anyway', () => {
  // The case ratings alone cannot express. Ann keeps losing to Cal and Bob keeps
  // beating Cal, so the ladder puts them level — but Ann owns Bob every time.
  const results = []
  let i = 0
  for (let round = 0; round < 8; round++) {
    results.push(game(i++, [['Cal'], 10], [['Ann'], 4]))
    results.push(game(i++, [['Bob'], 10], [['Cal'], 6]))
    results.push(game(i++, [['Ann'], 10], [['Bob'], 7]))
  }
  const history = buildMatchupHistory(results)

  const lineups = [['Ann'], ['Bob']]
  const ratings = flatRatings(['Ann', 'Bob'])
  const [annPlain] = predictWinProbabilities(lineups, ratings)
  const [annWithHistory] = predictWinProbabilities(lineups, ratings, history)

  assert.equal(annPlain, 0.5, 'level ratings should be a coin flip without history')
  assert.ok(annWithHistory > 0.65, `history should make Ann a clear favourite, got ${annWithHistory}`)

  const [ann, bob] = computeMatchupShifts(lineups, history)
  assert.ok(ann.eloShift > 0 && bob.eloShift < 0)
  assert.ok(Math.abs(ann.eloShift) < HISTORY_MAX_ELO, 'a realistic nemesis should not pin the cap')
  assert.deepEqual(ann.topPair, { kind: 'h2h', a: 'Ann', b: 'Bob', games: 8, wins: 8, losses: 0 })
  assert.deepEqual(bob.topPair, { kind: 'h2h', a: 'Bob', b: 'Ann', games: 8, wins: 0, losses: 8 })
})

test('a head-to-head record counts meetings neither player won', () => {
  // Ann beats Bob four times, then they meet three more times in a three-team
  // game Cal wins. They have played seven times and Ann leads 4–0, so wins and
  // losses deliberately do not add up to games — callers must show the
  // remainder rather than report "4–0" over seven meetings.
  const results = Array.from({ length: 4 }, (_, i) => game(i, [['Ann'], 10], [['Bob'], 6]))
  for (let i = 0; i < 3; i++) {
    results.push({
      teams: [
        { players: ['Ann'], score: 4 },
        { players: ['Bob'], score: 3 },
        { players: ['Cal'], score: 10 },
      ],
      playedAt: START + (4 + i) * DAY,
    })
  }
  const history = buildMatchupHistory(results)
  const rec = history.h2h.get(pairKey('Ann', 'Bob'))
  assert.equal(rec.games, 7)
  assert.equal(rec.aWins, 4)
  assert.equal(rec.bWins, 0)

  const [ann] = computeMatchupShifts([['Ann'], ['Bob']], history)
  assert.equal(ann.topPair.games, 7)
  assert.equal(ann.topPair.wins, 4)
  assert.equal(ann.topPair.losses, 0)
  assert.ok(ann.topPair.games > ann.topPair.wins + ann.topPair.losses)
})

test('a team of newcomers gets no matchup term against a team that has history', () => {
  // The common re-roll case: regulars with a long record drawn against guests.
  const results = Array.from({ length: 6 }, (_, i) => game(i, [['Ann'], 10], [['Cal'], 5]))
  const history = buildMatchupHistory(results)

  const lineups = [['Ann'], ['Guest']]
  const ratings = flatRatings(['Ann', 'Guest'])
  assert.deepEqual(
    predictWinProbabilities(lineups, ratings, history),
    predictWinProbabilities(lineups, ratings),
    'a pair that has never met must not move the bar',
  )
  const shifts = computeMatchupShifts(lineups, history)
  assert.deepEqual(shifts, [
    { eloShift: 0, topPair: null },
    { eloShift: 0, topPair: null },
  ])
})

test('a single meeting barely moves the forecast', () => {
  const one = buildMatchupHistory([game(0, [['Ann'], 10], [['Bob'], 6])])
  const many = buildMatchupHistory(
    Array.from({ length: 10 }, (_, i) => game(i, [['Ann'], 10], [['Bob'], 6])),
  )
  const lineups = [['Ann'], ['Bob']]
  const ratings = flatRatings(['Ann', 'Bob'])

  const [afterOne] = predictWinProbabilities(lineups, ratings, one)
  const [afterMany] = predictWinProbabilities(lineups, ratings, many)

  assert.ok(afterOne > 0.5 && afterOne < 0.54, `one game should nudge only, got ${afterOne}`)
  assert.ok(afterMany > afterOne + 0.02, `ten games should say more, got ${afterMany}`)
})

test('the matchup term self-limits as the ratings absorb the pattern', () => {
  // Residuals are measured against the ratings of the day, so a streak the
  // ladder has already priced in stops feeding the matchup layer. Without this
  // the two would compound and the same evidence would count twice.
  const edge = (n) => {
    const history = buildMatchupHistory(
      Array.from({ length: n }, (_, i) => game(i, [['Ann'], 10], [['Bob'], 6])),
    )
    const rec = history.h2h.get(pairKey('Ann', 'Bob'))
    return rec.sum / rec.games
  }
  assert.ok(edge(20) < edge(5), `mean edge should fade: ${edge(5)} -> ${edge(20)}`)
  assert.ok(edge(20) > 0, 'but the direction must survive')
})

test('a duo that overperforms together lifts the team it shares', () => {
  // Ann+Bob keep beating Cal+Dee; every rating is pinned equal in the forecast,
  // so any shift has to come from the pair records.
  const results = Array.from({ length: 8 }, (_, i) =>
    game(i, [['Ann', 'Bob'], 10], [['Cal', 'Dee'], 4]),
  )
  const history = buildMatchupHistory(results)

  const duo = history.duo.get(pairKey('Ann', 'Bob'))
  assert.equal(duo.games, 8)
  assert.equal(duo.wins, 8)

  const lineups = [
    ['Ann', 'Bob'],
    ['Cal', 'Dee'],
  ]
  const [withAnn] = predictWinProbabilities(lineups, flatRatings(['Ann', 'Bob', 'Cal', 'Dee']), history)
  assert.ok(withAnn > 0.6, `the winning duo should be clear favourites, got ${withAnn}`)

  const [shift] = computeMatchupShifts(lineups, history)
  assert.ok(shift.topPair !== null)
  // Every recorded game was settled, so a duo's record always adds up.
  assert.equal(shift.topPair.wins + shift.topPair.losses, shift.topPair.games)
})

test('probabilities still sum to 1 and shifts stay inside the cap', () => {
  // A wildly one-sided history: one side wins 30 straight.
  const results = Array.from({ length: 30 }, (_, i) => game(i, [['Ann'], 10], [['Bob'], 0]))
  const history = buildMatchupHistory(results)
  const lineups = [['Ann'], ['Bob'], ['Cal']]
  const probs = predictWinProbabilities(lineups, flatRatings(['Ann', 'Bob', 'Cal']), history)

  assert.ok(Math.abs(probs.reduce((a, b) => a + b, 0) - 1) < 1e-9)
  for (const { eloShift } of computeMatchupShifts(lineups, history)) {
    assert.ok(Math.abs(eloShift) <= HISTORY_MAX_ELO + 1e-9, `shift ${eloShift} broke the cap`)
  }
})

test('games the ladder ignores teach the matchup nothing', () => {
  const ignored = [
    game(0, [['Ann'], 0], [['Bob'], 0]), // all-zero: rejected outright
    game(1, [['Ann'], 7], [['Bob'], 7]), // tied at the top: no winner to learn from
    game(2, [[], 9], [[], 3]), // both sides anonymous
  ]
  const history = buildMatchupHistory(ignored)
  assert.equal(history.h2h.size, 0)
  assert.equal(history.duo.size, 0)
})

test('history is built from the ratings that stood at the time, not from itself', () => {
  // Two identical fixtures a day apart must produce the same per-game edge only
  // if the second is judged against post-game-one ratings. Ann's rating rises
  // after the first win, so her second win is worth a smaller residual.
  const history = buildMatchupHistory([
    game(0, [['Ann'], 10], [['Bob'], 5]),
    game(1, [['Ann'], 10], [['Bob'], 5]),
  ])
  const rec = history.h2h.get(pairKey('Ann', 'Bob'))
  assert.equal(rec.games, 2)
  assert.equal(rec.aWins, 2)
  // First residual is 0.5 (dead-even ratings); the second must be smaller.
  assert.ok(rec.sum > 0 && rec.sum < 1, `expected diminishing residuals, got ${rec.sum}`)
})

// --- Playing a man down -------------------------------------------------------

/** A finished game in the shape computeEloChanges takes. */
function played(lineups, scores) {
  return lineups.map((players, i) => ({ name: `T${i + 1}`, players, score: scores[i] }))
}
/** Everyone equal, past the K=120 window, no streaks — only size can differ. */
function evenRatings(names, rating = 1200) {
  return new Map(names.map((n) => [n, { rating, gamesPlayed: 30, winStreak: 0 }]))
}

test('a lone player against partnered opposition rates below themselves', () => {
  const names = ['A1', 'A2', 'B1', 'B2', 'S']
  const ratings = evenRatings(names)
  const [, , solo] = predictWinProbabilities([['A1', 'A2'], ['B1', 'B2'], ['S']], ratings)

  // The team rates at (1 - SOLO_HANDICAP) of the player, and the phantom fills
  // the roster to two so the size handicap no longer fires on top of it.
  const expected = 1 / (1 + 2 * Math.pow(10, (1200 - 1200 * (1 - SOLO_HANDICAP)) / 400))
  assert.ok(
    Math.abs(solo - expected) < 0.005,
    `solo should sit at the discount alone, got ${solo} vs ${expected}`,
  )
  assert.ok(solo < 1 / 3, 'being a man down has to be a disadvantage')
})

test('nobody is a man down when no team has a partner', () => {
  // 1v1 and 1v1v1: everyone is alone, so nobody is short a teammate and the
  // discount must not fire — otherwise every head-to-head gap would compress.
  const ratings = new Map([
    ['A', { rating: 1400, gamesPlayed: 30, winStreak: 0 }],
    ['B', { rating: 1000, gamesPlayed: 30, winStreak: 0 }],
  ])
  const [a] = predictWinProbabilities([['A'], ['B']], ratings)
  const undiscounted = 1 / (1 + Math.pow(10, (1000 - 1400) / 400))
  assert.ok(Math.abs(a - undiscounted) < 1e-9, `1v1 must be untouched, got ${a}`)
})

test("a lone player's losses count double, their wins do not", () => {
  const names = ['A1', 'A2', 'B1', 'B2', 'S']
  const lineups = [['A1', 'A2'], ['B1', 'B2'], ['S']]

  const lost = computeEloChanges(played(lineups, [10, 6, 4]), evenRatings(names)).get('S').delta
  const won = computeEloChanges(played(lineups, [6, 4, 10]), evenRatings(names)).get('S').delta
  assert.ok(lost < 0 && won > 0)

  // Same game with the solo slot filled: the discount and the multiplier both go
  // away, so this is the undiscounted comparison point.
  const full = [['A1', 'A2'], ['B1', 'B2'], ['S', 'S2']]
  const names2 = [...names, 'S2']
  const fullLoss = computeEloChanges(played(full, [10, 6, 4]), evenRatings(names2)).get('S').delta
  assert.ok(
    Math.abs(lost) < Math.abs(fullLoss),
    'even doubled, a man-down loss should cost less than a full-team one',
  )

  // The multiplier is the only thing separating the raw loss from the booked one.
  const soloOnly = computeEloChanges(played(lineups, [10, 6, 4]), evenRatings(names))
  assert.equal(soloOnly.get('S').won, false)
  assert.ok(
    SOLO_LOSS_MULTIPLIER > 1,
    'the discount alone would make the solo slot free money; the multiplier is the counterweight',
  )
})

test('an anonymous team is not given the man-down discount', () => {
  // An anonymous side is a placeholder for unknown opposition, already pinned at
  // INITIAL_RATING and size 1. Discounting it as if it were a lone player would
  // quietly rewrite what beating an unknown opponent is worth.
  const ratings = evenRatings(['A1', 'A2', 'S'])
  const [vsAnon] = predictWinProbabilities([['A1', 'A2'], []], ratings)
  const [vsNamedSolo] = predictWinProbabilities([['A1', 'A2'], ['S']], ratings)

  assert.ok(
    vsNamedSolo > vsAnon,
    `a named lone player takes the discount and an anonymous stand-in does not, ` +
      `so the pair should be the bigger favourite against the named solo ` +
      `(${vsNamedSolo} vs ${vsAnon})`,
  )
  // The anonymous side keeps the plain size handicap: 1200+150 against 1200-150.
  const plainHandicap = 1 / (1 + Math.pow(10, (1200 - 150 - (1200 + 150)) / 400))
  assert.ok(Math.abs(vsAnon - plainHandicap) < 1e-9, `got ${vsAnon}`)
})

// --- Win-streak bonus ---------------------------------------------------------

test('the streak bonus starts on the second consecutive win and caps out', () => {
  assert.equal(streakBonusMultiplier(0), 1, 'a first win is not boosted')
  assert.equal(streakBonusMultiplier(1), 1 + STREAK_BONUS_PER_WIN)
  assert.equal(streakBonusMultiplier(99), 1 + STREAK_BONUS_MAX, 'the cap holds')
  assert.ok(
    STREAK_BONUS_MAX / STREAK_BONUS_PER_WIN === 5,
    'the cap should still be reached at a 5-win streak',
  )
})

test('a three-team streak pays more than the same run in two-team games', () => {
  // Beating two sides is measurably rarer — 33.3% in 2v2v2 against 50.0% in 2v2
  // across this group's 222 games — so the same run length is worth more.
  assert.ok(streakBonusMultiplier(3, 3) > streakBonusMultiplier(3, 2), 'the harder run pays more')
  assert.equal(streakBonusMultiplier(1, 3), 1 + STREAK_BONUS_PER_WIN_MULTI)
  assert.equal(streakBonusMultiplier(99, 3), 1 + STREAK_BONUS_MAX_MULTI, 'the multi cap holds')

  const ratio = STREAK_BONUS_PER_WIN_MULTI / STREAK_BONUS_PER_WIN
  assert.ok(Math.abs(ratio - 1.5) < 1e-9, 'the rate is 1.5x, matching the measured odds ratio')
  assert.ok(
    Math.abs(STREAK_BONUS_MAX_MULTI / STREAK_BONUS_MAX - ratio) < 1e-9,
    'the cap scales by the same factor, so both formats cap at a 5-win run',
  )

  // Four teams is still the "multi" bucket — the rule is 3-or-more, not exactly 3.
  assert.equal(streakBonusMultiplier(2, 4), streakBonusMultiplier(2, 3))
  // An unmigrated caller passing no format must get the smaller two-team rate.
  assert.equal(streakBonusMultiplier(2), streakBonusMultiplier(2, 2))
})

test('the bigger three-team bonus reaches the actual rating delta', () => {
  const names = ['W1', 'W2', 'A1', 'A2', 'B1', 'B2']
  const lineups = [
    ['W1', 'W2'],
    ['A1', 'A2'],
    ['B1', 'B2'],
  ]
  const run = (winStreak) =>
    new Map(names.map((n) => [n, { rating: 1200, gamesPlayed: 30, winStreak }]))

  const idle = computeEloChanges(played(lineups, [10, 6, 4]), run({ duel: 0, multi: 0 }))
  const hot = computeEloChanges(played(lineups, [10, 6, 4]), run({ duel: 0, multi: 3 }))

  const ratio = hot.get('W1').delta / idle.get('W1').delta
  assert.ok(
    Math.abs(ratio - (1 + STREAK_BONUS_PER_WIN_MULTI * 3)) < 1e-9,
    `a 3-win three-team run should apply the multi rate, got ${ratio}`,
  )
})

test('the streak bonus only lifts the winner, and only their gain', () => {
  const names = ['W1', 'W2', 'L1', 'L2']
  const cold = new Map(names.map((n) => [n, { rating: 1200, gamesPlayed: 30, winStreak: 0 }]))
  const hot = new Map(names.map((n) => [n, { rating: 1200, gamesPlayed: 30, winStreak: 5 }]))
  const lineups = [['W1', 'W2'], ['L1', 'L2']]

  const a = computeEloChanges(played(lineups, [10, 6]), cold)
  const b = computeEloChanges(played(lineups, [10, 6]), hot)

  assert.ok(b.get('W1').delta > a.get('W1').delta, 'a hot winner gains more')
  assert.equal(
    b.get('L1').delta,
    a.get('L1').delta,
    'the loser pays the same either way — the bonus is minted, not transferred',
  )
  assert.ok(
    Math.abs(b.get('W1').delta / a.get('W1').delta - (1 + STREAK_BONUS_MAX)) < 1e-9,
    'a 5-win streak should apply exactly the capped multiplier',
  )
})

test('a two-team streak pays nothing in a three-team game', () => {
  const names = ['W1', 'W2', 'A1', 'A2', 'B1', 'B2']
  const lineups = [
    ['W1', 'W2'],
    ['A1', 'A2'],
    ['B1', 'B2'],
  ]
  const scores = [10, 6, 4]

  const idle = new Map(names.map((n) => [n, { rating: 1200, gamesPlayed: 30, winStreak: { duel: 0, multi: 0 } }]))
  // A long run built in two-team games, with nothing yet in three-team ones.
  const duelRun = new Map(
    names.map((n) => [n, { rating: 1200, gamesPlayed: 30, winStreak: { duel: 5, multi: 0 } }]),
  )
  const multiRun = new Map(
    names.map((n) => [n, { rating: 1200, gamesPlayed: 30, winStreak: { duel: 0, multi: 5 } }]),
  )

  const base = computeEloChanges(played(lineups, scores), idle).get('W1').delta
  const carried = computeEloChanges(played(lineups, scores), duelRun).get('W1').delta
  const earned = computeEloChanges(played(lineups, scores), multiRun).get('W1').delta

  assert.equal(carried, base, 'a run built in 2v2 must not boost a three-team win')
  assert.ok(earned > base, 'a run built in three-team games still pays there')
})

test('a streak in one format survives a loss in the other', () => {
  const prior = { duel: 0, multi: 4 }

  // Losing a two-team game clears the duel counter and leaves multi standing.
  const afterDuelLoss = nextStreak(prior, false, 2)
  assert.equal(afterDuelLoss.multi, 4, 'the three-team run is independent of a two-team loss')
  assert.equal(afterDuelLoss.duel, 0)

  // Losing a three-team game is what actually ends that run.
  assert.equal(nextStreak(prior, false, 3).multi, 0, 'a three-team loss ends the three-team run')

  assert.equal(nextStreak(prior, true, 3).multi, 5, 'a three-team win extends it')
  assert.equal(nextStreak(prior, true, 2).duel, 1, 'a two-team win starts the two-team run')
})

test('streakFor reads a plain number as a single shared counter', () => {
  // Callers that still hand over one number must not silently lose their bonus.
  assert.equal(streakFor({ winStreak: 3 }, 2), 3)
  assert.equal(streakFor({ winStreak: 3 }, 3), 3)
  assert.equal(streakFor({ winStreak: { duel: 1, multi: 7 } }, 2), 1)
  assert.equal(streakFor({ winStreak: { duel: 1, multi: 7 } }, 3), 7)
  assert.equal(streakFor(undefined, 3), 0)
})
