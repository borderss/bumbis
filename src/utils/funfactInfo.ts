// Plain-language explanations for the fun facts, keyed by a stable id shared by
// the Fun Facts cards and the leaderboard badges. The server stamps each badge
// with its `key`; the Fun Facts page keys each card directly. A missing key
// simply means "no explanation needed" (the info affordance is hidden).

export const FUNFACT_INFO: Record<string, string> = {
  // Streaks & runs
  longestWinStreak: 'The most consecutive games won, all-time.',
  currentWinStreak:
    'The longest win streak that is still active — wins in a row up to the player’s most recent game.',
  longestLossStreak: 'The most consecutive games lost, all-time — the “wooden spoon”.',
  mostWinsInDay: 'The most wins recorded by one player in a single day’s session.',
  perfectSession: 'Won every game played on a single day, with at least 3 games and zero losses.',
  longestAttendance:
    'The longest run of consecutive session-days attended without missing one. A “session” is any day games were logged.',
  longestReign:
    'The longest unbroken run of days as the #1-rated player. The champion is recomputed at the end of each play-day from game-driven ELO.',
  mostDaysAsChampion: 'The most days ever finishing a play-day as the top-rated player.',

  // Dominance & margins
  mostShutoutsDelivered:
    'The most wins keeping every opponent scoreless (a clean sheet) — in 2- and 3-team games.',
  mostTimesShutout: 'The most games scoring zero in a loss (got bageled) — in 2- and 3-team games.',
  mostOneGoalWins:
    'The most wins by exactly one goal over the next-best team — the photo-finishes — in 2- or 3-team games.',
  biggestBlowout: 'The largest margin of victory over the runner-up in a single game — any format.',

  // Goals & scoring
  sharpshooter: 'The highest average goals scored per game (min 8 games).',
  ironWall: 'The fewest average goals conceded per game (min 8 games).',
  goalDiffKing:
    'The best average goal difference per game — goals scored minus conceded (min 8 games).',
  mostGoalsScored: 'The most goals scored in total across all games.',

  // MVP & titles
  weeklyMvp:
    'MVP of the most recently completed week: the player with the biggest net ELO gain that week (min 2 games), tie-broken by wins.',
  mostMvpTitles: 'The most weekly MVP awards won all-time.',
  longestMvpStreak: 'The most consecutive weeks (in which they played) won as MVP.',
  highestMvpRate: 'The highest share of played weeks won as MVP (min 3 weeks played).',
  reigningChampion: 'The current #1 on the live leaderboard by ELO (after inactivity decay).',

  // Rivalries & head-to-head
  biggestRivalry: 'The two players who have faced each other on opposing teams the most times.',
  mostLopsided:
    'The most one-sided rivalry — the biggest head-to-head domination (min 4 meetings).',
  bestDuo: 'The teammates with the highest win rate when on the same team (min 4 games together).',
  cursedDuo: 'The teammates with the lowest win rate together (min 4 games together).',
  mostPlayedDuo: 'The pair who have teamed up the most — the chemistry award.',
  nemesis: 'The opponent who has beaten this player the most (min 3 meetings).',
  pigeon: 'The opponent this player beats the most — their favourite victim (min 3 meetings).',

  // ELO milestones
  highestPeakElo: 'The highest ELO rating ever reached at any point in history.',
  biggestGain: 'The largest ELO gain from a single game.',
  biggestUpset:
    'The biggest upset: a team beating a much higher-rated team, measured by the pre-game ELO gap between the sides.',
  hardestFall: 'The largest ELO drop from a single game.',
  mostImproved: 'The biggest net ELO climb within a single calendar month.',
  giantKiller:
    'Best win rate in games where the opponents averaged a higher rating (by 25+ ELO), min 4 such games.',
  flatTrackBully:
    'The biggest gap between win rate vs weaker opponents and vs stronger ones — great against weak, struggles against strong (min 4 games each side).',

  // Volume & rates
  mostGames: 'The most games played all-time — the grinder.',
  highestWinRate: 'The highest win rate among players with at least 8 games.',
  mostBalanced: 'The win rate closest to exactly 50% (min 8 games).',

  // Quirky
  comebackKing:
    'The most wins in the game immediately after a heavy loss (lost by 5+ to the leaders). Only final scores are stored, so a blow-out stands in for “trailing badly”.',
  clutch: 'The best win rate in nail-biters decided by a single goal (min 4 such games).',
  choker: 'The worst win rate in those same one-goal games (min 4).',
  bounceBack: 'Win rate in the very next game after a loss — how well they recover.',
  tilt: 'Loss rate in the game right after a loss — how prone they are to spiralling.',
  kingmaker:
    'Teammates win more when this player is on their team. Measured as the average win-rate lift across teammates who have played both with and without them.',
  anchor: 'Teammates win less when this player is on their team — the opposite of a kingmaker.',
  jekyllHyde:
    'The biggest swing in day-to-day form, measured as the standard deviation of their daily win rates.',

  // Personal fallback badge (player holds no league-wide title)
  personal: 'A personal highlight from this player’s own record.',
}
