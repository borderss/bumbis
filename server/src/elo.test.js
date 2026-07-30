// Run: node --test src/elo.test.js
// Covers the matchup-history layer on top of the rating model: that a
// history-free prediction is untouched, that a real head-to-head or duo record
// moves the forecast, and that a single game barely does.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HISTORY_MAX_ELO,
  buildMatchupHistory,
  computeMatchupShifts,
  pairKey,
  predictWinProbabilities,
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
