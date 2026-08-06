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

### Playing a man down (2v2v1)

A **one-player team** is the exception. Rather than take the size handicap for the missing body, the empty slot is filled with a phantom teammate, so the team rates below the player themselves:

```
team_rating = player_rating × (1 − SOLO_HANDICAP)
```

`SOLO_HANDICAP = 0.35`, so the team rates at **65 %** of the lone player — the phantom is worth roughly 30 % of a real teammate. The phantom also brings the roster to two, so `SIZE_HANDICAP` no longer fires for the missing body and the two mechanisms cannot double-count. It is opponent-strength bookkeeping only: the phantom never gains or loses rating, and the real player still banks their team's whole delta.

The discount alone would make the solo slot the seat everyone wants — an expectation that low means defeat costs almost nothing. `SOLO_LOSS_MULTIPLIER = 2` pays that back: **a lone player's losses count double**. Only losses scale; a win is already priced by the discount.

| Scenario | Solo pairEff | Duo pairEff | Solo win probability |
|---|---|---|---|
| 2v2v1, equal ratings (1200) | 780 | 1200 | ≈ 8 % |
| 2v2, equal ratings | 1200 | 1200 | 50 % |
| 1v1, equal ratings | 1200 | 1200 | 50 % |

The rule fires only for a genuine one-player roster facing partnered opposition. A game where nobody has a partner (1v1, 1v1v1) leaves no one outnumbered, so ratings are untouched — otherwise every head-to-head gap would compress. An anonymous team is a placeholder for unknown opposition, already pinned at `INITIAL_RATING` and size 1, and is not discounted either.

At this group's rating spread the solo slot is still a long shot rather than a fair third of the game. In a 2v2v1 the format is a gamble by design: a win pays roughly double what the same result pays in 2v2v2, and second place still pays.

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

`STREAK_BONUS_PER_WIN = 0.05` (+5% per prior consecutive win) and `STREAK_BONUS_MAX = 0.25` (capped at +25%, reached at a 5-win streak).

| Prior streak | Multiplier |
|---|---|
| 0 (first win) | 1.00 |
| 1 | 1.05 |
| 2 | 1.10 |
| 5+ | 1.25 |

Only the **winner's** gain is amplified — the opponent's loss is unchanged, so streaks inject points. Any non-win — a loss *or* a tied-top result — resets the streak to zero, matching the `currentWinStreak` definition used by the fun facts. The streak is stored per player (`player_elo.win_streak`) and, like all ratings, recomputed from scratch when the server replays results on startup.

**This bonus is where the scale drifts.** Replaying a season at this group's format mix (87 two-team, 135 three-team games) injects roughly 1100 points at the old +10%/+50% setting and about 25 points with the bonus switched off — the rest of the model is very nearly zero-sum. The injection spreads evenly across players regardless of win rate, so it does not distort the order; it just walks the whole scale away from the 1200 everyone starts at. Halving the constants halves the drift to ~580 points and costs nothing visible: the average rating change per game moves from 32.9 to 32.5, because the swing comes from `K` and margin-of-victory, not from this.

Splitting the streak per format (a separate counter for 2-team and 3-team games) was measured and does **not** reduce the drift — it redistributes the same wins across two counters and injects the same total. It would be a fair change for its own sake, since a streak within one format is a more meaningful thing to report, but not as an inflation fix.

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

### Win prediction: matchup history

The win-chance bars (`GET /api/rooms/:id/prediction`, `POST /api/predict`) do **not** run on ratings alone. A rating is one number per player, so it can say Ann is stronger than Bob — never that Bob beats her anyway, or that two teammates are lethal specifically together. On top of the rating model the forecast therefore adds a **matchup term** learned from every stored result.

For each past game the server computes the **residual**: what actually happened minus what the ratings alone expected at the time.

```
residual_team = (team won ? 1 : 0) − elo_only_win_probability
head_to_head  = (residual_a − residual_b) / 2      per opposing pair
synergy       = residual_team                       per teammate pair
```

Working from the residual — rather than a raw head-to-head win rate — is what stops the same evidence counting twice: anything the ladder has already priced in produces a residual near zero and contributes nothing. A pair's edge is their residual **sum** over `games + 20`, so one meeting is worth ~5% of its face value and twenty ~50%. Each team averages the edges of all its pairs, the result is scaled (400 rating points per 1.0 of residual), centred across teams and capped at **±120** points.

In practice one prior meeting moves a 50/50 bar by ~3 points, while a settled nemesis relationship moves it by ~20 and can flip the favourite outright. Only games the ladder itself counts contribute — a strict unique winner, at least one named team, no all-zero scoreline.

This affects **predictions only**. `computeEloChanges` never sees the history index, so the ladder stays a pure margin-of-victory ELO. The response also carries an `insights` array, aligned to team order, naming the pair that weighed most — which is what the UI prints under each bar. Two players can meet without either beating the other (a three-team game the third side won), so that record is printed W–L–D when such games exist: `Ann is 8–0–3 vs Bob` means eleven meetings, eight of which Ann took. The note is hidden when the history moved the bar by less than 2 rating points, so it never implies a swing that isn't visible.

### Edge cases

| Situation | Behaviour |
|---|---|
| New default baller | Starts at 1200, K = 120 |
| New non-default player | Starts at 1000, K = 120 |
| Team with no named players | Skipped — no ELO update for that team |
| Fewer than 2 teams with players | Entire game skipped for ELO |
| Lone player vs partnered teams (2v2v1) | Team rates at 65 % of the player (phantom teammate); their losses count double |
| 1v1 / 1v1v1 (nobody has a partner) | No man-down discount — ratings used as-is |
| Other asymmetric sizes (2v3) | Size penalised via additive handicap (SIZE_HANDICAP = 150) |
| All scores are 0 | Rejected with 400 (API); silently skipped during legacy ELO replay |
| Tied winners (e.g. 7-7) | No win counted; S = 0.5 pairwise, plain Elo applies |
| Server restart with existing results | ELO is bootstrapped by replaying all results in chronological order |
| Inactive player | Loses 2 pts/day after 7-day grace, floored at 800; computed from `last_played_at`, not stored |
| Players who have never met | No matchup term — the prediction falls back to ratings alone |
