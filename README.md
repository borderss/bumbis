# Vue 3 template

## Local development

Run the backend API and frontend dev server in separate terminals.

Terminal 1:

```bash
cd server
yarn install
yarn dev
```

The API listens on `http://localhost:8787`.

Terminal 2:

```bash
yarn install
yarn dev
```

Open the Vite URL printed in the terminal, usually:

```text
http://localhost:5173
```

The frontend proxies `/api` to `http://localhost:8787`, so keep both processes
running for matchmaking features to work.

## Deploy

For the known live VPS layout, use:

```bash
bash scripts/deploy.sh
```

Optional overrides:
- `BUMBIS_REPO_DIR` to change the repo path (default `/var/www/bumbis`)
- `BUMBIS_BRANCH` to deploy a different branch (default `main`)
- `BUMBIS_NODE_BIN_DIR` to force a specific Node/Yarn bin path

Uses:
- Vue 3
- Vite
- vue-router
- Vitest
- TypeScript
- Eslint, Prettier, StyleLint
- Husky with commitlint and a pre-commit hook

---

## ELO Rating System

Player ratings are computed after every logged game and stored in SQLite.
Regular-roster players (default ballers) start at **1200**; everyone else starts at **1000**. Ratings floor at **800** (from losses or inactivity — never below).

### Core formula

For each game, every team's performance is evaluated against **every other team** in a pairwise fashion. Each player receives the average of those pairwise deltas scaled by their personal K-factor.

```
delta_player = K × average over opponents of (mov × acf × (S − E))
```

**Expected score E** (logistic curve, 400-point scale):

```
E_A = 1 / (1 + 10 ^ ((R_B_eff − R_A_eff) / 400))
```

**Actual score S** — binary, not score-share:

```
S = 1    strict win  (team's score > opponent's score in the pairwise)
S = 0.5  draw        (equal scores in the pairwise)
S = 0    loss
```

**Margin-of-victory multiplier** — scales the delta by how convincingly a team won:

```
mov = ln(|score_A − score_B| + 1) / ln(4)
```

Calibrated so a 3-goal margin produces mov = 1.0 (the neutral reference point).

| Score | Margin | mov |
|---|---|---|
| 10-9 | 1 | ≈ 0.50 |
| 10-7 | 3 | 1.00 |
| 10-0 | 10 | ≈ 1.73 |

**Autocorrelation damper** — prevents favourites from gaining outsized MoV bonuses:

```
eff_diff = clamp(winner_eff − loser_eff, −500, 500)
acf      = 2.2 / (eff_diff × 0.001 + 2.2)
```

A favourite winning (positive eff_diff) gets acf < 1; an underdog winning gets acf > 1. Draws use mov = acf = 1 (plain Elo).

### Strict-winner semantics

`won` is set to `true` only for the team whose score is the **unique** maximum. If two or more teams tie for the top score, no team gets a win counted in their stats — but pairwise ELO still adjusts (S = 0.5 between the tied teams). All-zero-score results are rejected as invalid (400 from the API; silently skipped during legacy ELO replay).

### Team size adjustment

Effective team rating uses an additive handicap computed per pairwise comparison:

```
R_eff = avg_rating + SIZE_HANDICAP × (team_size − opponent_size)
```

`SIZE_HANDICAP = 150`. Sizes are relative to the specific opponent, so the handicap updates for each pairing in a multi-team game.

| Scenario | Solo pairEff | Duo pairEff | Solo win probability |
|---|---|---|---|
| 1v2, equal ratings (1200) | 1050 | 1350 | ≈ 15 % |
| 1v2, solo is 200 pts stronger | 1250 | 1350 | ≈ 36 % |
| 2v2, equal ratings | 1200 | 1200 | 50 % |

A solo player who beats a duo earns a large rating gain (high MoV + underdog acf > 1). Losing costs very little (low expected E for the solo).

### K-factor progression

| Games played | K |
|---|---|
| < 10 (provisional) | 120 |
| 10 + | 90 |

New players have high K so initial placements settle quickly. No provisional rating penalty is applied — the K schedule alone handles new-player uncertainty.

### Win-streak bonus

A player on a hot streak earns **extra** rating on each further win. The bonus scales with the streak carried *into* the game, so the **second** consecutive win is the first to be boosted:

```
streak_mult = 1 + min(STREAK_BONUS_MAX, STREAK_BONUS_PER_WIN × prior_streak)
delta_winner = streak_mult × K × average over opponents of (mov × acf × (S − E))
```

`STREAK_BONUS_PER_WIN = 0.10` (+10% per prior consecutive win) and `STREAK_BONUS_MAX = 0.50` (capped at +50%, reached at a 5-win streak).

| Prior streak | Multiplier |
|---|---|
| 0 (first win) | 1.00 |
| 1 | 1.10 |
| 2 | 1.20 |
| 5+ | 1.50 |

Only the **winner's** gain is amplified — the opponent's loss is unchanged, so streaks inject points (the system is already non-zero-sum). Any non-win — a loss *or* a tied-top result — resets the streak to zero, matching the `currentWinStreak` definition used by the fun facts. The streak is stored per player (`player_elo.win_streak`) and, like all ratings, recomputed from scratch when the server replays results on startup.

### Handling the "best player with worst player" case

When a high-rated player (e.g. 1600) is paired with a low-rated player (e.g. 600), the team average drops to 1100, making them underdogs against a balanced pair. This is encoded directly in the expected value: a win from the underdog position yields **more** ELO; a loss costs **less**. No special carry penalty is applied — the math handles it structurally.

### Inactivity decay

Players lose rating for every day they don't play. After a grace period, each subsequent inactive day costs **2 points**, down to the **800** floor (never below). The grace is **7 days for all players** (default ballers and newcomers alike).

```
grace        = 7
decay        = max(0, days_since_last_game − grace) × 2
shown_rating = max(800, rating_after_last_game − decay)
```

Decay is **derived**, never stored: the database keeps each player's rating as of their last game plus a `last_played_at` timestamp, and the penalty is computed from the current date on every read. So the leaderboard drops a little each day on its own — no scheduled job — and a full ELO rebuild reproduces the exact same numbers. Decay also accrues during gaps *between* games and is banked into the rating, so returning after a long break does not refund the lost points; you simply resume from the decayed rating.

### Multi-team games (3 or 4 teams)

Each team is compared pairwise against every other team. The per-player delta is the **average** of all pairwise results, so the total movement is normalised regardless of how many teams played.

### Edge cases

| Situation | Behaviour |
|---|---|
| New default baller | Starts at 1200, K = 120 |
| New non-default player | Starts at 1000, K = 120 |
| Team with no named players | Skipped — no ELO update for that team |
| Fewer than 2 teams with players | Entire game skipped for ELO |
| 1v2 (asymmetric team size) | Size penalised via additive handicap (SIZE_HANDICAP = 150) |
| All scores are 0 | Rejected with 400 (API); silently skipped during legacy ELO replay |
| Tied winners (e.g. 7-7) | No win counted; S = 0.5 pairwise, plain Elo applies |
| Server restart with existing results | ELO is bootstrapped by replaying all results in chronological order |
| Inactive player | Loses 2 pts/day after 7-day grace, floored at 800; computed from `last_played_at`, not stored |
