<template>
  <div class="min-h-screen flex flex-col bg-surface text-on-surface">
    <header class="flex items-center justify-center w-full px-8 py-6 top-0 z-50">
      <div
        class="font-black tracking-[-0.02em] uppercase text-4xl text-primary text-center"
        style="font-family: 'Plus Jakarta Sans', sans-serif"
      >
        BUMBIS
      </div>
    </header>

    <main
      class="flex-grow container mx-auto px-4 sm:px-6 py-4 max-w-5xl pb-28"
      @click="openInfo = null"
    >
      <!-- Page header -->
      <div class="flex flex-wrap items-center justify-between gap-4 mb-8 px-2">
        <div>
          <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm">
            Hall of Fame
          </p>
          <h1 class="text-4xl font-black tracking-tight">Fun Facts</h1>
        </div>
        <div class="flex gap-3">
          <RouterLink
            to="/results?tab=rankings"
            class="bg-surface-container-high px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest transition-colors"
          >
            Rankings
          </RouterLink>
          <RouterLink
            to="/"
            class="bg-surface-container-high px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest transition-colors"
          >
            Home
          </RouterLink>
        </div>
      </div>

      <!-- Loading / error / empty -->
      <div v-if="loading" class="text-on-surface-variant text-lg font-medium px-2">
        Crunching the numbers…
      </div>
      <div v-else-if="error" class="text-secondary text-lg font-bold px-2">{{ error }}</div>
      <div
        v-else-if="!facts || facts.totalGames === 0"
        class="bg-surface-container-low rounded-[2rem] p-10 text-center shadow-[0_20px_40px_rgba(0,0,0,0.2)]"
      >
        <span class="material-symbols-outlined text-6xl text-outline-variant">insights</span>
        <p class="text-on-surface-variant font-bold mt-4">
          No games logged yet — fun facts appear once you start playing.
        </p>
      </div>

      <template v-else>
        <!-- ── Weekly MVP hero ─────────────────────────────────────────── -->
        <div
          v-if="facts.global.weeklyMvp"
          class="relative overflow-hidden rounded-[2rem] p-8 mb-10 bg-gradient-to-br from-yellow-500/20 via-amber-400/10 to-surface-container-low ring-1 ring-yellow-500/30 shadow-[0_20px_40px_rgba(0,0,0,0.3)]"
        >
          <button
            type="button"
            class="group/info absolute top-5 right-5 z-30 text-yellow-300/70 hover:text-yellow-200 transition-colors"
            @click.stop="toggleInfo('weeklyMvp')"
          >
            <span class="material-symbols-outlined text-lg">info</span>
            <span
              :class="
                openInfo === 'weeklyMvp'
                  ? 'opacity-100 visible'
                  : 'opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible'
              "
              class="absolute right-0 top-full z-30 mt-2 w-60 rounded-2xl bg-surface-container-highest p-4 text-left text-xs font-medium leading-relaxed text-on-surface normal-case tracking-normal shadow-[0_20px_40px_rgba(0,0,0,0.5)] transition-opacity"
            >
              {{ FUNFACT_INFO.weeklyMvp }}
            </span>
          </button>
          <div class="flex items-center gap-5">
            <span
              class="material-symbols-outlined text-6xl text-yellow-400 shrink-0"
              style="font-variation-settings: 'FILL' 1"
              >military_tech</span
            >
            <div>
              <p class="uppercase font-black tracking-widest text-xs text-yellow-300/80">
                Player of the Week · {{ facts.global.weeklyMvp.week }}
              </p>
              <p
                class="text-4xl font-black tracking-tight bg-gradient-to-r from-yellow-200 via-amber-300 to-yellow-400 bg-clip-text text-transparent"
                style="font-family: 'Plus Jakarta Sans', sans-serif"
              >
                {{ facts.global.weeklyMvp.player }}
              </p>
              <p class="text-sm font-bold text-on-surface-variant mt-1">
                {{ signed(facts.global.weeklyMvp.net) }} ELO ·
                {{ facts.global.weeklyMvp.wins }} wins in {{ facts.global.weeklyMvp.games }} games
              </p>
            </div>
          </div>
        </div>

        <!-- ── Player spotlight ────────────────────────────────────────── -->
        <section class="mb-12">
          <div class="flex flex-wrap items-center justify-between gap-4 mb-5 px-2">
            <h2
              class="text-2xl font-black tracking-tight"
              style="font-family: 'Plus Jakarta Sans', sans-serif"
            >
              Player Spotlight
            </h2>
            <div class="relative">
              <select
                v-model="selectedPlayer"
                class="appearance-none bg-surface-container-high rounded-full py-3 pl-5 pr-12 text-sm font-extrabold uppercase tracking-wide text-on-surface outline-none focus:ring-2 focus:ring-primary transition-all cursor-pointer"
              >
                <option v-for="p in facts.players" :key="p.name" :value="p.name">
                  {{ p.name }} · {{ p.games }} games
                </option>
              </select>
              <span
                class="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant"
                >expand_more</span
              >
            </div>
          </div>

          <template v-if="spotlight">
            <!-- Nemesis & pigeon -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div
                class="relative bg-surface-container-low rounded-[2rem] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.2)]"
              >
                <button
                  type="button"
                  class="group/info absolute top-5 right-5 z-30 text-outline-variant hover:text-on-surface transition-colors"
                  @click.stop="toggleInfo('nemesis')"
                >
                  <span class="material-symbols-outlined text-lg">info</span>
                  <span
                    :class="
                      openInfo === 'nemesis'
                        ? 'opacity-100 visible'
                        : 'opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible'
                    "
                    class="absolute right-0 top-full z-30 mt-2 w-60 rounded-2xl bg-surface-container-highest p-4 text-left text-xs font-medium leading-relaxed text-on-surface normal-case tracking-normal shadow-[0_20px_40px_rgba(0,0,0,0.5)] transition-opacity"
                  >
                    {{ FUNFACT_INFO.nemesis }}
                  </span>
                </button>
                <div class="flex items-center gap-2 text-secondary mb-2">
                  <span class="material-symbols-outlined text-lg">skull</span>
                  <span class="uppercase font-black tracking-widest text-xs">Nemesis</span>
                </div>
                <p
                  v-if="spotlight.nemesis"
                  class="text-3xl font-black tracking-tight text-secondary"
                  style="font-family: 'Plus Jakarta Sans', sans-serif"
                >
                  {{ spotlight.nemesis.name }}
                </p>
                <p v-if="spotlight.nemesis" class="text-sm font-bold text-on-surface-variant mt-1">
                  beats {{ selectedPlayer }} {{ spotlight.nemesis.theirWins }}–{{
                    spotlight.nemesis.yourWins
                  }}
                  across {{ spotlight.nemesis.games }} meetings
                </p>
                <p v-else class="text-outline-variant font-bold text-lg">No nemesis yet</p>
              </div>

              <div
                class="relative bg-surface-container-low rounded-[2rem] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.2)]"
              >
                <button
                  type="button"
                  class="group/info absolute top-5 right-5 z-30 text-outline-variant hover:text-on-surface transition-colors"
                  @click.stop="toggleInfo('pigeon')"
                >
                  <span class="material-symbols-outlined text-lg">info</span>
                  <span
                    :class="
                      openInfo === 'pigeon'
                        ? 'opacity-100 visible'
                        : 'opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible'
                    "
                    class="absolute right-0 top-full z-30 mt-2 w-60 rounded-2xl bg-surface-container-highest p-4 text-left text-xs font-medium leading-relaxed text-on-surface normal-case tracking-normal shadow-[0_20px_40px_rgba(0,0,0,0.5)] transition-opacity"
                  >
                    {{ FUNFACT_INFO.pigeon }}
                  </span>
                </button>
                <div class="flex items-center gap-2 text-primary mb-2">
                  <span class="material-symbols-outlined text-lg">target</span>
                  <span class="uppercase font-black tracking-widest text-xs">Favourite Victim</span>
                </div>
                <p
                  v-if="spotlight.pigeon"
                  class="text-3xl font-black tracking-tight text-primary"
                  style="font-family: 'Plus Jakarta Sans', sans-serif"
                >
                  {{ spotlight.pigeon.name }}
                </p>
                <p v-if="spotlight.pigeon" class="text-sm font-bold text-on-surface-variant mt-1">
                  {{ selectedPlayer }} beats them {{ spotlight.pigeon.yourWins }}–{{
                    spotlight.pigeon.theirWins
                  }}
                  across {{ spotlight.pigeon.games }} meetings
                </p>
                <p v-else class="text-outline-variant font-bold text-lg">No pigeon yet</p>
              </div>
            </div>

            <!-- Personal stat tiles -->
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <div
                v-for="tile in spotlightTiles"
                :key="tile.label"
                class="bg-surface-container rounded-2xl px-5 py-4"
              >
                <p
                  class="uppercase font-black tracking-widest text-[0.65rem] text-on-surface-variant"
                >
                  {{ tile.label }}
                </p>
                <p
                  class="text-xl font-black tracking-tight mt-1"
                  :class="tile.tone === 'bad' ? 'text-secondary' : 'text-on-surface'"
                  style="font-family: 'Plus Jakarta Sans', sans-serif"
                >
                  {{ tile.value }}
                </p>
                <p v-if="tile.sub" class="text-xs font-bold text-on-surface-variant mt-0.5">
                  {{ tile.sub }}
                </p>
              </div>
            </div>
          </template>
        </section>

        <!-- ── Record sections ─────────────────────────────────────────── -->
        <section v-for="section in sections" :key="section.title" class="mb-12">
          <h2
            class="text-2xl font-black tracking-tight mb-5 px-2"
            style="font-family: 'Plus Jakarta Sans', sans-serif"
          >
            {{ section.title }}
          </h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
              v-for="card in section.cards"
              :key="card.key"
              class="relative bg-surface-container-low rounded-[2rem] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.2)] flex flex-col gap-2"
            >
              <!-- Explanation (hover to peek, tap to pin) -->
              <button
                v-if="card.info"
                type="button"
                class="group/info absolute top-5 right-5 text-outline-variant hover:text-on-surface transition-colors"
                @click.stop="toggleInfo(card.key)"
              >
                <span class="material-symbols-outlined text-lg">info</span>
                <span
                  :class="
                    openInfo === card.key
                      ? 'opacity-100 visible'
                      : 'opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible'
                  "
                  class="absolute right-0 top-full z-30 mt-2 w-60 rounded-2xl bg-surface-container-highest p-4 text-left text-xs font-medium leading-relaxed text-on-surface normal-case tracking-normal shadow-[0_20px_40px_rgba(0,0,0,0.5)] transition-opacity"
                >
                  {{ card.info }}
                </span>
              </button>
              <div class="flex items-center gap-2 text-on-surface-variant pr-7">
                <span class="material-symbols-outlined text-lg">{{ card.icon }}</span>
                <span class="uppercase font-black tracking-widest text-xs">{{ card.title }}</span>
              </div>
              <p
                class="text-2xl font-black tracking-tight"
                :class="toneClass(card.tone)"
                style="font-family: 'Plus Jakarta Sans', sans-serif"
              >
                {{ card.name }}
              </p>
              <p class="text-sm font-bold text-on-surface-variant">{{ card.detail }}</p>
            </div>
          </div>
        </section>

        <p class="text-xs text-on-surface-variant px-4 pt-2">
          Based on {{ facts.totalGames }} logged games. Records with a minimum-games threshold only
          appear once enough games are played.
        </p>
      </template>
    </main>

    <!-- Background Orbs -->
    <div
      class="fixed -top-24 -left-24 w-96 h-96 bg-primary opacity-5 blur-[120px] rounded-full pointer-events-none"
    />
    <div
      class="fixed top-1/2 -right-24 w-64 h-64 bg-secondary opacity-5 blur-[100px] rounded-full pointer-events-none"
    />
  </div>
</template>

<script setup lang="ts">
import { type FunFacts, type PlayerFacts, getFunFacts } from '@/utils/funfacts'
import { FUNFACT_INFO } from '@/utils/funfactInfo'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

const facts = ref<FunFacts | null>(null)
const loading = ref(true)
const error = ref('')
const selectedPlayer = ref<string>('')

// Which explanation popover is pinned open (by card/fact key). Hover always
// reveals the tooltip via CSS; clicking pins it so it works on touch too.
const openInfo = ref<string | null>(null)
function toggleInfo(key: string) {
  openInfo.value = openInfo.value === key ? null : key
}

onMounted(async () => {
  try {
    facts.value = await getFunFacts()
    if (facts.value.players.length > 0) selectedPlayer.value = facts.value.players[0].name
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : 'Could not load fun facts. Is the API running?'
  } finally {
    loading.value = false
  }
})

const spotlight = computed<PlayerFacts | null>(() =>
  facts.value && selectedPlayer.value ? facts.value.byPlayer[selectedPlayer.value] ?? null : null,
)

// --- Formatting helpers -------------------------------------------------------
function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}
function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`
}
function signedDec(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}`
}
function signedPts(n: number): string {
  const v = Math.round(n * 100)
  return `${v > 0 ? '+' : ''}${v} pts`
}

type Tone = 'good' | 'bad' | 'neutral' | 'empty'
interface Card {
  key: string
  title: string
  icon: string
  name: string
  detail: string
  tone: Tone
  info?: string
}

const TONE_CLASSES: Record<Tone, string> = {
  good: 'text-primary',
  bad: 'text-secondary',
  neutral: 'text-on-surface',
  empty: 'text-outline-variant',
}
function toneClass(tone: Tone): string {
  return TONE_CLASSES[tone]
}

/** Build a card from a (possibly null) fact, falling back to an empty state. */
function mk<T>(
  key: string,
  title: string,
  icon: string,
  fact: T | null | undefined,
  build: (f: T) => { name: string; detail: string },
  tone: Tone = 'good',
): Card {
  const info = FUNFACT_INFO[key]
  if (fact === null || fact === undefined)
    return { key, title, icon, name: '—', detail: 'Not enough games yet', tone: 'empty', info }
  const r = build(fact)
  return { key, title, icon, name: r.name, detail: r.detail, tone, info }
}

const sections = computed<{ title: string; cards: Card[] }[]>(() => {
  if (!facts.value) return []
  const g = facts.value.global

  return [
    {
      title: 'Streaks & Runs',
      cards: [
        mk(
          'longestWinStreak',
          'Longest Win Streak',
          'local_fire_department',
          g.longestWinStreak,
          (f) => ({
            name: f.player,
            detail: `${f.value} wins in a row`,
          }),
        ),
        mk('currentWinStreak', 'Hottest Active Streak', 'bolt', g.currentWinStreak, (f) => ({
          name: f.player,
          detail: `${f.value} wins and counting`,
        })),
        mk(
          'longestLossStreak',
          'Wooden Spoon',
          'ac_unit',
          g.longestLossStreak,
          (f) => ({
            name: f.player,
            detail: `${f.value} losses in a row`,
          }),
          'bad',
        ),
        mk('mostWinsInDay', 'Most Wins in a Day', 'today', g.mostWinsInDay, (f) => ({
          name: f.player,
          detail: `${f.value} wins on ${f.day} (${f.games} games)`,
        })),
        mk('perfectSession', 'Perfect Session', 'verified', g.perfectSession, (f) => ({
          name: f.player,
          detail: `${f.games}-0 on ${f.day}`,
        })),
        mk('longestAttendance', 'Iron Attendance', 'event_available', g.longestAttendance, (f) => ({
          name: f.player,
          detail: `${f.value} sessions in a row`,
        })),
        mk('longestReign', 'Longest Reign at #1', 'crown', g.longestReign, (f) => ({
          name: f.player,
          detail: `${f.value} days as champion`,
        })),
        mk(
          'mostDaysAsChampion',
          'Most Days as Champion',
          'workspace_premium',
          g.mostDaysAsChampion,
          (f) => ({
            name: f.player,
            detail: `${f.value} days at the top`,
          }),
        ),
      ],
    },
    {
      title: 'Dominance & Margins',
      cards: [
        mk(
          'mostShutoutsDelivered',
          'Most Shutouts Delivered',
          'block',
          g.mostShutoutsDelivered,
          (f) => ({
            name: f.player,
            detail: `${f.value} clean sheets (X–0)`,
          }),
        ),
        mk(
          'mostTimesShutout',
          'Most Times Bageled',
          'egg',
          g.mostTimesShutout,
          (f) => ({
            name: f.player,
            detail: `shut out ${f.value} times`,
          }),
          'bad',
        ),
        mk('mostOneGoalWins', 'Most Photo-Finishes', 'flash_on', g.mostOneGoalWins, (f) => ({
          name: f.player,
          detail: `${f.value} one-goal wins`,
        })),
      ],
    },
    {
      title: 'MVP & Titles',
      cards: [
        mk('mostMvpTitles', 'Most MVP Awards', 'military_tech', g.mostMvpTitles, (f) => ({
          name: f.player,
          detail: `${f.value} weekly titles`,
        })),
        mk('longestMvpStreak', 'Longest MVP Streak', 'auto_awesome', g.longestMvpStreak, (f) => ({
          name: f.player,
          detail: `${f.value} weeks in a row`,
        })),
        mk('highestMvpRate', 'Highest MVP Rate', 'percent', g.highestMvpRate, (f) => ({
          name: f.player,
          detail: `${pct(f.rate)} of weeks (${f.titles}/${f.weeks})`,
        })),
        mk('reigningChampion', 'Reigning Champion', 'emoji_events', g.reigningChampion, (f) => ({
          name: f.player,
          detail: `${f.rating} ELO — top of the ladder`,
        })),
      ],
    },
    {
      title: 'Rivalries & Head-to-Head',
      cards: [
        mk(
          'biggestRivalry',
          'Biggest Rivalry',
          'swords',
          g.biggestRivalry,
          (f) => ({
            name: `${f.a} vs ${f.b}`,
            detail: `${f.games} meetings (${f.aWins}–${f.bWins})`,
          }),
          'neutral',
        ),
        mk('mostLopsided', 'Most Lopsided Rivalry', 'trending_up', g.mostLopsided, (f) => ({
          name: `${f.winner} over ${f.loser}`,
          detail: `${f.winnerWins}–${f.loserWins} (${pct(f.dominance)} dominance)`,
        })),
        mk('bestDuo', 'Best Teammate Pairing', 'handshake', g.bestDuo, (f) => ({
          name: `${f.a} & ${f.b}`,
          detail: `${pct(f.winRate ?? 0)} win rate (${f.wins}/${f.games})`,
        })),
        mk(
          'cursedDuo',
          'Cursed Duo',
          'heart_broken',
          g.cursedDuo,
          (f) => ({
            name: `${f.a} & ${f.b}`,
            detail: `${pct(f.winRate ?? 0)} win rate (${f.wins}/${f.games})`,
          }),
          'bad',
        ),
        mk(
          'mostPlayedDuo',
          'Most-Played Duo',
          'diversity_3',
          g.mostPlayedDuo,
          (f) => ({
            name: `${f.a} & ${f.b}`,
            detail: `${f.games} games together`,
          }),
          'neutral',
        ),
      ],
    },
    {
      title: 'ELO Milestones',
      cards: [
        mk('highestPeakElo', 'Highest ELO Ever', 'rocket_launch', g.highestPeakElo, (f) => ({
          name: f.player,
          detail: `${f.value} peak rating`,
        })),
        mk('biggestGain', 'Biggest Single-Game Gain', 'north_east', g.biggestGain, (f) => ({
          name: f.player,
          detail: `${signed(f.value)} ELO in one game`,
        })),
        mk('biggestUpset', 'Biggest Upset', 'priority_high', g.biggestUpset, (f) => ({
          name: f.winners.join(' & '),
          detail: `beat ${f.losers.join(' & ')} — ${f.gap} ELO gap (${f.score})`,
        })),
        mk(
          'hardestFall',
          'Hardest Fall',
          'south_east',
          g.hardestFall,
          (f) => ({
            name: f.player,
            detail: `${signed(f.value)} ELO in one game`,
          }),
          'bad',
        ),
        mk('mostImproved', 'Most Improved', 'trending_up', g.mostImproved, (f) => ({
          name: f.player,
          detail: `${signed(f.value)} ELO in ${f.month}`,
        })),
        mk('giantKiller', 'Giant Killer', 'sports_martial_arts', g.giantKiller, (f) => ({
          name: f.player,
          detail: `${pct(f.winRate)} vs stronger foes (${f.wins}/${f.games})`,
        })),
        mk(
          'flatTrackBully',
          'Flat-Track Bully',
          'fitness_center',
          g.flatTrackBully,
          (f) => ({
            name: f.player,
            detail: `${pct(f.weakWinRate)} vs weak · ${pct(f.strongWinRate)} vs strong`,
          }),
          'neutral',
        ),
      ],
    },
    {
      title: 'Volume & Rates',
      cards: [
        mk('mostGames', 'The Grinder', 'fitness_center', g.mostGames, (f) => ({
          name: f.player,
          detail: `${f.value} games played`,
        })),
        mk('highestWinRate', 'Highest Win Rate', 'trophy', g.highestWinRate, (f) => ({
          name: f.player,
          detail: `${pct(f.winRate)} (${f.wins}/${f.games})`,
        })),
        mk(
          'mostBalanced',
          'Most Balanced',
          'balance',
          g.mostBalanced,
          (f) => ({
            name: f.player,
            detail: `${pct(f.winRate)} win rate over ${f.games} games`,
          }),
          'neutral',
        ),
      ],
    },
    {
      title: 'Quirky Facts',
      cards: [
        mk('comebackKing', 'Comeback King', 'replay', g.comebackKing, (f) => ({
          name: f.player,
          detail: `${f.value} wins right after a blow-out loss`,
        })),
        mk('clutch', 'Clutch Rating', 'sports_score', g.clutch, (f) => ({
          name: f.player,
          detail: `${pct(f.winRate)} in 1-goal games (${f.wins}/${f.games})`,
        })),
        mk(
          'choker',
          'Choker',
          'sentiment_stressed',
          g.choker,
          (f) => ({
            name: f.player,
            detail: `${pct(f.winRate)} in 1-goal games (${f.wins}/${f.games})`,
          }),
          'bad',
        ),
        mk('bounceBack', 'Bounce-Back Factor', 'undo', g.bounceBack, (f) => ({
          name: f.player,
          detail: `${pct(f.winRate)} win rate after a loss (${f.games} games)`,
        })),
        mk(
          'tilt',
          'Tilt Factor',
          'whatshot',
          g.tilt,
          (f) => ({
            name: f.player,
            detail: `${pct(f.lossRate)} loss rate after a loss (${f.games} games)`,
          }),
          'bad',
        ),
        mk('kingmaker', 'Kingmaker', 'auto_fix_high', g.kingmaker, (f) => ({
          name: f.player,
          detail: `${signedPts(f.value)} team lift over ${f.partners} teammates`,
        })),
        mk(
          'anchor',
          'The Anchor',
          'anchor',
          g.anchor,
          (f) => ({
            name: f.player,
            detail: `${signedPts(f.value)} team lift over ${f.partners} teammates`,
          }),
          'bad',
        ),
        mk(
          'jekyllHyde',
          'Jekyll & Hyde',
          'theater_comedy',
          g.jekyllHyde,
          (f) => ({
            name: f.player,
            detail: `${f.value.toFixed(2)} win-rate swing across ${f.days} days`,
          }),
          'neutral',
        ),
      ],
    },
  ]
})

interface Tile {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad'
}

const spotlightTiles = computed<Tile[]>(() => {
  const s = spotlight.value
  if (!s) return []
  const streak =
    s.currentStreak.type === 'win'
      ? { value: `${s.currentStreak.length}W`, tone: 'good' as const }
      : s.currentStreak.type === 'loss'
        ? { value: `${s.currentStreak.length}L`, tone: 'bad' as const }
        : { value: '—', tone: undefined }
  return [
    { label: 'Games', value: `${s.games}` },
    { label: 'Win Rate', value: pct(s.winRate), sub: `${s.wins}W · ${s.losses}L` },
    {
      label: 'Avg Goal Gain',
      value: signedDec(s.avgGoalGain),
      sub: `${s.avgGoalsFor.toFixed(1)} for · ${s.avgGoalsAgainst.toFixed(1)} against`,
      tone: s.avgGoalGain < 0 ? 'bad' : undefined,
    },
    { label: 'Peak ELO', value: `${s.peakElo}` },
    { label: 'Current Streak', value: streak.value, tone: streak.tone },
    { label: 'Best Win Streak', value: `${s.longestWinStreak}` },
    { label: 'Worst Skid', value: `${s.longestLossStreak}`, tone: 'bad' },
    { label: 'MVP Titles', value: `${s.mvpTitles}` },
    {
      label: 'Best Teammate',
      value: s.bestTeammate ? s.bestTeammate.name : '—',
      sub: s.bestTeammate ? `${pct(s.bestTeammate.winRate)} together` : undefined,
    },
    {
      label: 'Lucky Day',
      value: s.bestWeekday ? s.bestWeekday.weekday : '—',
      sub: s.bestWeekday ? `${pct(s.bestWeekday.winRate)} win rate` : undefined,
    },
    {
      label: 'Cursed Day',
      value: s.worstWeekday ? s.worstWeekday.weekday : '—',
      sub: s.worstWeekday ? `${pct(s.worstWeekday.winRate)} win rate` : undefined,
      tone: 'bad',
    },
  ]
})

watch(
  () => facts.value,
  (f) => {
    if (f && !selectedPlayer.value && f.players.length > 0) selectedPlayer.value = f.players[0].name
  },
)
</script>
