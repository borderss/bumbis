// Run: node --test src/funfacts.test.js
// Pins the definitions the Fun Facts UI promises. Each test states the promise it
// guards, because most of these facts have a plausible-looking wrong answer that
// only differs from the right one in a 3-team game, on a one-game day, or when a
// single candidate qualifies for a "worst X".
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeFunFacts } from './funfacts.js'

const DAY = 24 * 60 * 60 * 1000
const BASE = Date.UTC(2026, 0, 5) // a Monday, so weekday maths is predictable

/** One game: sides are [players, score] pairs, `d` is a day offset from BASE. */
function game(d, ...sides) {
  return {
    teams: sides.map(([players, score], i) => ({ name: `Team ${i + 1}`, players, score })),
    playedAt: BASE + d * DAY,
  }
}
const repeat = (n, fn) => Array.from({ length: n }, (_, i) => fn(i))

test('a win is a unique top score, so outscoring a side in a game a third team won is not a win over them', () => {
  // Mid finishes above Low every time but never wins a game; Top always does.
  const ff = computeFunFacts(repeat(4, (i) => game(i, [['Top'], 10], [['Mid'], 8], [['Low'], 1])), [])

  assert.equal(ff.byPlayer['Mid'].wins, 0, 'Mid won nothing')
  assert.equal(ff.byPlayer['Mid'].pigeon, null, 'so Mid cannot "own" anybody')
  assert.equal(ff.byPlayer['Low'].nemesis.name, 'Top', 'Top is the only side that beat Low')
  assert.equal(ff.byPlayer['Low'].nemesis.theirWins, 4)
})

test('the biggest rivalry accounts for every meeting it reports', () => {
  // Three decided A-vs-B meetings plus two a third team won. The card prints all
  // three numbers, so wins + undecided has to equal the meeting total.
  const ff = computeFunFacts(
    [
      game(0, [['A'], 10], [['B'], 4]),
      game(1, [['B'], 10], [['A'], 4]),
      game(2, [['A'], 10], [['B'], 4]),
      game(3, [['C'], 10], [['A'], 5], [['B'], 4]),
      game(4, [['C'], 10], [['A'], 5], [['B'], 4]),
    ],
    [],
  )
  const r = ff.global.biggestRivalry
  assert.equal(r.games, 5)
  assert.equal(r.undecided, 2)
  assert.equal(r.aWins + r.bWins + r.undecided, r.games)
})

test('head-to-head rates ignore undecided meetings so a clean sweep reads as 100%', () => {
  // Two decided meetings (A beats B) plus two a third team took.
  const ff = computeFunFacts(
    [
      game(0, [['A'], 10], [['B'], 4]),
      game(1, [['A'], 10], [['B'], 4]),
      game(2, [['A'], 10], [['B'], 4]),
      game(3, [['C'], 10], [['A'], 5], [['B'], 4]),
      game(4, [['C'], 10], [['A'], 5], [['B'], 4]),
    ],
    [],
  )
  const pigeon = ff.byPlayer['A'].pigeon
  assert.equal(pigeon.name, 'B')
  assert.equal(pigeon.yourWins, 3)
  assert.equal(pigeon.games, 3, 'the two games C won are not part of the A-vs-B record')
  assert.equal(pigeon.rate, 1)
})

test('peak ELO counts the rating a player started from', () => {
  // A newcomer outside the default roster starts at 1000 and only ever loses.
  const ff = computeFunFacts(
    [game(0, [['Rookie'], 2], [['Boss'], 10]), game(1, [['Rookie'], 3], [['Boss'], 10])],
    [],
  )
  assert.equal(ff.byPlayer['Rookie'].peakElo, 1000)
  assert.ok(
    ff.byPlayer['Rookie'].peakElo > ff.byPlayer['Rookie'].games,
    'sanity: peak is a rating, not a game count',
  )
})

test('the daily champion decays, so sitting out eventually costs the crown', () => {
  // Ghost edges Pat 10-9 on day 0 and never plays again, ending ~30 points up.
  // Pat and Sam then alternate wins for weeks, so neither rating runs away and
  // the only thing that can move the crown is Ghost's inactivity decay.
  // Note this is a slow rule: at DECAY_PER_DAY = 2 a large lead survives a long
  // absence. The point is that the daily crown uses the ladder's decay at all,
  // not that an absence is punished quickly.
  const games = [game(0, [['Ghost'], 10], [['Pat'], 9])]
  for (let d = 1; d < 45; d++) {
    const patWins = d % 2 === 1
    games.push(game(d, [['Pat'], patWins ? 10 : 8], [['Sam'], patWins ? 8 : 10]))
  }

  const ff = computeFunFacts(games, [])
  assert.equal(ff.summary.sessions, 45)
  assert.ok(
    ff.global.mostDaysAsChampion.value < 45,
    `Ghost must not hold all 45 sessions, got ${JSON.stringify(ff.global.mostDaysAsChampion)}`,
  )
  assert.ok(
    ff.global.longestReign.value < 45,
    `the reign should end once decay erases the lead, got ${ff.global.longestReign.value}`,
  )
})

test('"without you" means absent, not on the other side', () => {
  // A is never absent: 3 games with B, 3 games against B. A must not score a lift.
  const games = [
    ...repeat(3, (i) => game(i, [['A', 'B'], 10], [['C', 'D'], 3])),
    ...repeat(3, (i) => game(3 + i, [['A', 'C'], 10], [['B', 'D'], 3])),
  ]
  const ff = computeFunFacts(games, [])
  assert.equal(ff.global.kingmaker, null, 'no teammate has games with AND without A')
  assert.equal(ff.global.anchor, null)
})

test('Jekyll & Hyde ignores single-game days, whose win rate can only be 0 or 1', () => {
  // Steady plays four games a day at a real 50%; Flip plays one a day, alternating.
  const games = []
  for (let d = 0; d < 6; d++) {
    games.push(game(d, [['Flip'], d % 2 ? 2 : 10], [['Foe'], d % 2 ? 10 : 2]))
    games.push(game(d, [['Steady'], 10], [['Rival'], 2]))
    games.push(game(d, [['Steady'], 2], [['Rival'], 10]))
    games.push(game(d, [['Steady'], 10], [['Rival'], 3]))
    games.push(game(d, [['Steady'], 3], [['Rival'], 10]))
  }
  const ff = computeFunFacts(games, [])
  assert.notEqual(
    ff.global.jekyllHyde?.player,
    'Flip',
    'a one-game-a-day player is not the most volatile, just the least sampled',
  )
})

test('a "worst X" needs a second candidate to be meaningful', () => {
  // Exactly one duo reaches the four-game duo threshold, with a perfect record.
  const ff = computeFunFacts(repeat(5, (i) => game(i, [['A', 'B'], 10], [['C'], 4])), [])
  assert.ok(ff.global.bestDuo, 'the one qualifying duo is still the best duo')
  assert.equal(ff.global.bestDuo.winRate, 1)
  assert.equal(ff.global.cursedDuo, null, 'a 100% duo must not also be the cursed duo')
})

test('a lucky weekday needs a second weekday to be luckier than', () => {
  const ff = computeFunFacts(repeat(4, (i) => game(i * 7, [['A'], i < 2 ? 10 : 3], [['B'], i < 2 ? 3 : 10])), [])
  assert.equal(ff.byPlayer['A'].bestWeekday.weekday, 'Monday')
  assert.equal(ff.byPlayer['A'].worstWeekday, null, 'Monday cannot be both lucky and cursed')
})

test('an anonymous team is never reported as the beaten side', () => {
  const ff = computeFunFacts(
    [
      {
        teams: [
          { name: 'Team 1', players: ['Solo'], score: 10 },
          { name: 'Team 2', players: [], score: 2 }, // no roster to show
        ],
        playedAt: BASE,
      },
    ],
    [],
  )
  assert.equal(ff.global.biggestUpset, null)
  assert.equal(ff.global.biggestBlowout, null)
})

test('a perfect session means every game won, not merely none lost', () => {
  // Three wins and one tied-top game on the same day: not a clean sweep.
  const games = [
    game(0, [['A'], 10], [['B'], 4]),
    game(0, [['A'], 10], [['B'], 5]),
    game(0, [['A'], 10], [['B'], 6]),
    game(0, [['A'], 7], [['B'], 7]), // tied top: a win for nobody
  ]
  const ff = computeFunFacts(games, [])
  assert.equal(ff.global.perfectSession, null)

  const clean = computeFunFacts(games.slice(0, 3), [])
  assert.equal(clean.global.perfectSession.games, 3)
})

test('MVP streaks break on a week the player played but did not win', () => {
  // X takes weeks 1 and 3. In week 2 X plays a single game, so nobody is eligible
  // and the week produces no MVP — but X played, so the run must not carry over.
  const ff = computeFunFacts(
    [
      game(0, [['X', 'Y'], 10], [['Z', 'W'], 2]),
      game(1, [['X', 'Y'], 10], [['Z', 'W'], 3]),
      game(7, [['X'], 10], [['Z'], 4]),
      game(14, [['X', 'Y'], 10], [['Z', 'W'], 2]),
      game(15, [['X', 'Y'], 10], [['Z', 'W'], 3]),
    ],
    [],
  )
  assert.equal(ff.global.mostMvpTitles.player, 'X')
  assert.equal(ff.global.mostMvpTitles.value, 2)
  assert.equal(ff.global.longestMvpStreak.value, 1, 'the two titles are not consecutive')
})

test('the MVP rate divides by weeks the player could have won, not every week played', () => {
  // X is eligible in three weeks and wins all three; a fourth week is a single
  // game, where no title was reachable.
  const ff = computeFunFacts(
    [
      game(0, [['X', 'Y'], 10], [['Z', 'W'], 2]),
      game(1, [['X', 'Y'], 10], [['Z', 'W'], 3]),
      game(7, [['X', 'Y'], 10], [['Z', 'W'], 2]),
      game(8, [['X', 'Y'], 10], [['Z', 'W'], 3]),
      game(14, [['X', 'Y'], 10], [['Z', 'W'], 2]),
      game(15, [['X', 'Y'], 10], [['Z', 'W'], 3]),
      game(21, [['X'], 10], [['Z'], 4]),
    ],
    [],
  )
  const rate = ff.global.highestMvpRate
  assert.equal(rate.player, 'X')
  assert.equal(rate.weeks, 3, 'the one-game week is not a week X could have won')
  assert.equal(rate.rate, 1)
})

test('duo records keep using the strict winner, unchanged', () => {
  // Guards the half of the pair logic that was already correct.
  const ff = computeFunFacts(
    repeat(4, (i) => game(i, [['A', 'B'], 8], [['C', 'D'], 10])),
    [],
  )
  assert.equal(ff.global.bestDuo.a, 'C')
  assert.equal(ff.global.bestDuo.winRate, 1)
  assert.equal(ff.global.cursedDuo.winRate, 0, 'A+B lost all four')
})

test('summary counts only games the ELO engine accepted', () => {
  const ff = computeFunFacts(
    [
      game(0, [['A'], 10], [['B'], 4]),
      game(1, [['A'], 0], [['B'], 0]), // all-zero: rejected
      game(2, [[], 9], [[], 3]), // no identifiable player
    ],
    [],
  )
  assert.equal(ff.summary.games, 1)
  assert.equal(ff.totalGames, 3, 'the raw log length is reported separately')
})
