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

    <main class="flex-grow container mx-auto px-4 sm:px-6 py-4 max-w-3xl pb-28">
      <!-- Page header -->
      <div class="flex flex-wrap items-center justify-between gap-4 mb-8 px-2">
        <div>
          <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm">
            Game Tracking
          </p>
          <h1 class="text-4xl font-black tracking-tight">Results</h1>
        </div>
        <div class="flex gap-3">
          <RouterLink
            to="/facts"
            class="bg-surface-container-high px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest transition-colors"
          >
            Fun Facts
          </RouterLink>
          <RouterLink
            to="/"
            class="bg-surface-container-high px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest transition-colors"
          >
            Home
          </RouterLink>
        </div>
      </div>

      <!-- Tab bar -->
      <div class="flex gap-2 bg-surface-container rounded-full p-1.5 mb-8">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :class="[
            activeTab === tab.id
              ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container-high',
            'flex-1 py-3 rounded-full font-extrabold uppercase tracking-wide text-sm transition-colors',
          ]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- ── LOG GAME TAB ─────────────────────────────────────────────── -->
      <div v-if="activeTab === 'log'" class="space-y-6">
        <!-- Team count -->
        <div
          class="bg-surface-container-low rounded-[2rem] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.35)] flex flex-wrap items-center gap-4"
        >
          <span
            class="text-on-surface-variant uppercase font-black tracking-widest text-sm flex-1"
            style="font-family: 'Plus Jakarta Sans', sans-serif"
            >Number of Teams</span
          >
          <div class="flex items-center gap-2 bg-surface-container rounded-full px-2 py-2">
            <button
              v-for="n in [2, 3, 4]"
              :key="n"
              type="button"
              :class="[
                logTeams.length === n
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface hover:bg-surface-container-high',
                'w-10 h-10 rounded-full font-extrabold transition-colors',
              ]"
              @click="setTeamCount(n)"
            >
              {{ n }}
            </button>
          </div>
        </div>

        <!-- Winner announcement -->
        <transition name="fade">
          <div
            v-if="detectedWinner !== null"
            class="bg-primary/15 border border-primary/30 rounded-[2rem] p-6 flex items-center gap-4"
          >
            <span
              class="material-symbols-outlined text-4xl text-primary"
              style="font-variation-settings: 'FILL' 1"
              >emoji_events</span
            >
            <div>
              <p
                class="text-on-surface-variant uppercase font-black tracking-widest text-xs mb-0.5"
              >
                Winner detected
              </p>
              <p
                class="text-2xl font-black tracking-tight text-primary"
                style="font-family: 'Plus Jakarta Sans', sans-serif"
              >
                {{ detectedWinner }}
              </p>
            </div>
          </div>
        </transition>

        <!-- Team cards -->
        <div class="grid grid-cols-1 gap-4">
          <div
            v-for="(team, i) in logTeams"
            :key="i"
            :class="[
              team.score === 10 ? 'ring-2 ring-primary bg-primary/5' : 'bg-surface-container-low',
              'rounded-[2rem] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.2)] transition-all',
            ]"
          >
            <!-- Team name -->
            <div class="flex items-center gap-3 mb-4">
              <span class="w-3 h-3 rounded-full" :style="{ backgroundColor: teamColor(i) }" />
              <input
                v-model="team.name"
                class="flex-1 bg-transparent text-xl font-black tracking-tight outline-none border-b-2 border-transparent focus:border-primary transition-colors pb-0.5"
                :placeholder="`Team ${i + 1}`"
                style="font-family: 'Plus Jakarta Sans', sans-serif"
              />
            </div>

            <!-- Players -->
            <div class="mb-5">
              <p class="text-on-surface-variant uppercase font-black tracking-widest text-xs mb-2">
                Players
              </p>
              <div class="flex flex-wrap gap-2 mb-2">
                <div
                  v-for="(player, pi) in team.players"
                  :key="pi"
                  class="bg-surface-container-high px-4 py-2 rounded-full flex items-center gap-2 text-sm font-extrabold"
                >
                  {{ player }}
                  <span
                    class="material-symbols-outlined text-base text-on-surface-variant cursor-pointer hover:text-secondary transition-colors"
                    @click="removePlayer(i, pi)"
                    >close</span
                  >
                </div>
              </div>
              <div class="relative">
                <input
                  v-model="playerInputs[i]"
                  class="w-full bg-surface-container-high border-none rounded-full py-3 px-5 text-sm font-bold focus:ring-2 focus:ring-primary-dim transition-all outline-none placeholder:text-outline-variant"
                  placeholder="Add player…"
                  @focus="focusedTeam = i"
                  @blur="focusedTeam = null"
                  @keydown.enter.prevent="addPlayer(i)"
                />
                <button
                  v-if="playerInputs[i]?.trim()"
                  type="button"
                  class="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-on-primary w-8 h-8 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
                  @click="addPlayer(i)"
                >
                  <span class="material-symbols-outlined text-lg">add</span>
                </button>
                <!-- Autocomplete dropdown -->
                <div
                  v-if="focusedTeam === i && autocomplete(i).length > 0"
                  class="absolute top-full left-0 right-0 mt-1 bg-surface-container-highest rounded-2xl shadow-xl z-20 overflow-hidden py-1"
                >
                  <button
                    v-for="name in autocomplete(i)"
                    :key="name"
                    type="button"
                    class="w-full px-5 py-2.5 text-left text-sm font-extrabold hover:bg-primary/10 transition-colors"
                    @mousedown.prevent="selectSuggestion(i, name)"
                  >
                    {{ name }}
                  </button>
                </div>
              </div>
              <!-- Default baller quick-add chips -->
              <div
                v-if="!playerInputs[i]?.trim() && availableDefaultBallers(i).length > 0"
                class="flex flex-wrap gap-2 mt-3"
              >
                <button
                  v-for="name in availableDefaultBallers(i)"
                  :key="name"
                  type="button"
                  class="bg-surface-container px-3 py-1.5 rounded-full text-xs font-extrabold tracking-tight hover:bg-surface-container-high transition-colors"
                  @click="selectSuggestion(i, name)"
                >
                  {{ name }}
                </button>
              </div>
            </div>

            <!-- Score -->
            <div>
              <p class="text-on-surface-variant uppercase font-black tracking-widest text-xs mb-3">
                Score
              </p>
              <div class="flex items-center gap-4">
                <button
                  type="button"
                  class="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-2xl font-black hover:bg-surface-container-highest active:scale-95 transition-all disabled:opacity-30"
                  :disabled="team.score <= 0"
                  @click="team.score = Math.max(0, team.score - 1)"
                >
                  −
                </button>
                <input
                  :value="team.score"
                  type="number"
                  min="0"
                  max="10"
                  :class="[
                    team.score === 10 ? 'text-primary' : 'text-on-surface',
                    'text-4xl font-black w-16 text-center bg-transparent outline-none border-b-2 border-transparent focus:border-primary transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                  ]"
                  style="font-family: 'Plus Jakarta Sans', sans-serif"
                  @input="
                    team.score = Math.min(
                      10,
                      Math.max(0, Number(($event.target as HTMLInputElement).value) || 0),
                    )
                  "
                />
                <button
                  type="button"
                  class="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-2xl font-black hover:bg-surface-container-highest active:scale-95 transition-all disabled:opacity-30"
                  :disabled="team.score >= 10"
                  @click="team.score = Math.min(10, team.score + 1)"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        <p v-if="logError" class="text-secondary text-sm font-bold px-2">{{ logError }}</p>
        <p v-if="logSuccess" class="text-primary text-sm font-bold px-2">{{ logSuccess }}</p>
      </div>

      <!-- ── HISTORY TAB ──────────────────────────────────────────────── -->
      <div v-if="activeTab === 'history'" class="space-y-4">
        <div v-if="loadingHistory" class="text-on-surface-variant text-lg font-medium px-2">
          Loading results…
        </div>
        <div
          v-else-if="history.length === 0"
          class="bg-surface-container-low rounded-[2rem] p-10 text-center shadow-[0_20px_40px_rgba(0,0,0,0.2)]"
        >
          <span class="material-symbols-outlined text-6xl text-outline-variant">sports_score</span>
          <p class="text-on-surface-variant font-bold mt-4">No games logged yet.</p>
          <button
            type="button"
            class="mt-4 bg-primary/15 px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-primary hover:bg-primary/25 transition-colors"
            @click="activeTab = 'log'"
          >
            Log a game
          </button>
        </div>
        <div
          v-for="result in history"
          :key="result.id"
          class="bg-surface-container-low rounded-[2rem] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.2)]"
        >
          <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p class="text-on-surface-variant uppercase font-black tracking-widest text-xs">
                {{ result.source === 'lobby' ? 'Lobby match' : 'Custom game' }}
              </p>
              <p class="text-sm font-bold text-on-surface-variant mt-0.5">
                {{ formatDate(result.date) }}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2 bg-primary/10 px-4 py-2 rounded-full">
                <span
                  class="material-symbols-outlined text-lg text-primary"
                  style="font-variation-settings: 'FILL' 1"
                  >emoji_events</span
                >
                <span class="text-sm font-extrabold text-primary">{{ result.winner }}</span>
              </div>
              <button
                type="button"
                class="w-9 h-9 rounded-full bg-secondary/10 flex items-center justify-center hover:bg-secondary/20 active:scale-95 transition-all disabled:opacity-40"
                :disabled="deletingId === result.id"
                @click="promptDelete(result.id)"
              >
                <span class="material-symbols-outlined text-base text-secondary">delete</span>
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3">
            <div
              v-for="(team, ti) in result.teams"
              :key="ti"
              :class="[
                team.name === result.winner || `Team ${ti + 1}` === result.winner
                  ? 'bg-primary/10 ring-1 ring-primary/30'
                  : 'bg-surface-container-high',
                'rounded-2xl px-5 py-3 flex items-center justify-between',
              ]"
            >
              <div>
                <div class="flex items-center gap-2">
                  <span
                    class="w-2.5 h-2.5 rounded-full"
                    :style="{ backgroundColor: teamColor(ti) }"
                  />
                  <span class="font-extrabold text-base tracking-tight">{{
                    team.name || `Team ${ti + 1}`
                  }}</span>
                </div>
                <div v-if="team.players?.length" class="flex flex-wrap gap-1.5 mt-2">
                  <span
                    v-for="p in team.players"
                    :key="p"
                    class="bg-surface-container px-3 py-1 rounded-full text-xs font-bold text-on-surface-variant"
                    >{{ p }}</span
                  >
                </div>
              </div>
              <span
                :class="[
                  team.score === 10 ? 'text-primary' : 'text-on-surface',
                  'text-3xl font-black',
                ]"
                style="font-family: 'Plus Jakarta Sans', sans-serif"
                >{{ team.score }}</span
              >
            </div>
          </div>
        </div>
      </div>
      <!-- ── RANKINGS TAB ─────────────────────────────────────────────── -->
      <div v-if="activeTab === 'rankings'" class="space-y-3" @click="openTag = null">
        <div v-if="loadingRankings" class="text-on-surface-variant text-lg font-medium px-2">
          Loading rankings…
        </div>
        <div
          v-else-if="rankings.length === 0"
          class="bg-surface-container-low rounded-[2rem] p-10 text-center shadow-[0_20px_40px_rgba(0,0,0,0.2)]"
        >
          <span class="material-symbols-outlined text-6xl text-outline-variant">leaderboard</span>
          <p class="text-on-surface-variant font-bold mt-4">No ranked players yet.</p>
          <button
            type="button"
            class="mt-4 bg-primary/15 px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-primary hover:bg-primary/25 transition-colors"
            @click="activeTab = 'log'"
          >
            Log a game
          </button>
        </div>
        <template v-else>
          <!-- Header row -->
          <div class="flex items-center gap-2 sm:gap-4 px-2 sm:px-4 pb-1">
            <span
              class="w-6 sm:w-8 text-center text-on-surface-variant uppercase font-black tracking-widest text-xs"
              >#</span
            >
            <span
              class="flex-1 text-on-surface-variant uppercase font-black tracking-widest text-xs"
              >Player</span
            >
            <span
              class="w-12 sm:w-14 text-right text-on-surface-variant uppercase font-black tracking-widest text-xs"
              >ELO</span
            >
            <span
              class="hidden sm:block w-10 text-right text-on-surface-variant uppercase font-black tracking-widest text-xs"
              >GP</span
            >
            <span
              class="w-10 sm:w-12 text-right text-on-surface-variant uppercase font-black tracking-widest text-xs"
              >W%</span
            >
            <span
              class="hidden sm:block w-20 text-right text-on-surface-variant uppercase font-black tracking-widest text-xs"
              >GF:GA</span
            >
            <span
              class="hidden sm:block w-14 text-right text-on-surface-variant uppercase font-black tracking-widest text-xs"
              >AGG</span
            >
            <span
              class="w-12 sm:w-14 text-right text-on-surface-variant uppercase font-black tracking-widest text-xs"
              >Today</span
            >
          </div>

          <div
            v-for="(player, idx) in rankings"
            :key="player.name"
            :class="[
              idx === 0
                ? 'bg-yellow-500/10 ring-1 ring-yellow-500/30'
                : idx === 1
                  ? 'bg-slate-400/10 ring-1 ring-slate-400/20'
                  : idx === 2
                    ? 'bg-amber-700/10 ring-1 ring-amber-700/20'
                    : 'bg-surface-container-low',
              'rounded-2xl px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-4 shadow-sm transition-all',
            ]"
          >
            <!-- Rank -->
            <div class="w-6 sm:w-8 text-center">
              <span
                v-if="idx === 0"
                class="material-symbols-outlined text-yellow-400 text-xl"
                style="font-variation-settings: 'FILL' 1"
                >workspace_premium</span
              >
              <span
                v-else-if="idx === 1"
                class="material-symbols-outlined text-slate-400 text-xl"
                style="font-variation-settings: 'FILL' 1"
                >workspace_premium</span
              >
              <span
                v-else-if="idx === 2"
                class="material-symbols-outlined text-amber-700 text-xl"
                style="font-variation-settings: 'FILL' 1"
                >workspace_premium</span
              >
              <span v-else class="text-on-surface-variant font-extrabold text-sm">{{
                idx + 1
              }}</span>
            </div>
            <!-- Name + fun-fact badge -->
            <div class="flex-1 min-w-0">
              <span class="block font-extrabold tracking-tight truncate">{{ player.name }}</span>
              <button
                v-if="funTags[player.name]"
                type="button"
                :class="tagToneClass(funTags[player.name].tone)"
                class="group/tag relative mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-bold tracking-tight max-w-full"
                @click.stop="toggleTag(player.name)"
              >
                <span class="shrink-0">{{ funTags[player.name].emoji }}</span>
                <span class="truncate">{{ funTags[player.name].label }}</span>
                <span
                  v-if="tagInfo(funTags[player.name])"
                  :class="
                    openTag === player.name
                      ? 'opacity-100 visible'
                      : 'opacity-0 invisible group-hover/tag:opacity-100 group-hover/tag:visible'
                  "
                  class="absolute left-0 top-full z-30 mt-2 w-56 rounded-2xl bg-surface-container-highest p-3 text-left text-xs font-medium leading-relaxed text-on-surface shadow-[0_20px_40px_rgba(0,0,0,0.5)] transition-opacity"
                >
                  {{ tagInfo(funTags[player.name]) }}
                </span>
              </button>
            </div>
            <!-- ELO -->
            <span
              :class="[
                player.rating > 1200
                  ? 'text-primary'
                  : player.rating < 1200
                    ? 'text-secondary'
                    : 'text-on-surface',
                'w-12 sm:w-14 text-right font-black text-lg',
              ]"
              style="font-family: 'Plus Jakarta Sans', sans-serif"
              >{{ player.rating }}</span
            >
            <!-- Games played -->
            <span
              class="hidden sm:block w-10 text-right text-on-surface-variant font-bold text-sm"
              >{{ player.games_played }}</span
            >
            <!-- Win % -->
            <span class="w-10 sm:w-12 text-right font-extrabold text-sm">
              {{
                player.games_played > 0 ? Math.round((player.wins / player.games_played) * 100) : 0
              }}%
            </span>
            <!-- Goals for : Goals against -->
            <span
              class="hidden sm:block w-20 text-right text-on-surface-variant font-bold text-xs tabular-nums"
            >
              {{ player.goals_for }}:{{ Math.round(player.goals_against) }}
            </span>
            <!-- Avg goal gain per game -->
            <span
              class="hidden sm:block w-14 text-right font-bold text-xs tabular-nums"
              :class="gainClass(player)"
            >
              {{ signedGain(avgGoalGain(player)) }}
            </span>
            <!-- Today's gain/loss -->
            <span class="w-12 sm:w-14 text-right">
              <span
                v-if="player.today_change !== 0"
                class="inline-flex items-center justify-end gap-0.5 font-extrabold text-sm"
                :class="player.today_change > 0 ? 'text-green-500' : 'text-red-500'"
              >
                <span
                  class="material-symbols-outlined text-base"
                  style="font-variation-settings: 'FILL' 1"
                  >{{ player.today_change > 0 ? 'arrow_upward' : 'arrow_downward' }}</span
                >{{ Math.abs(player.today_change) }}
              </span>
              <span v-else class="text-on-surface-variant font-bold text-sm">–</span>
            </span>
          </div>

          <p class="text-xs text-on-surface-variant px-4 pt-2">
            Starting ELO: 1200 · GP = games played · W% = win rate · GF:GA = goals scored:conceded ·
            AGG = avg goal gain per game · Today = ELO gained/lost today
          </p>
        </template>
      </div>
    </main>

    <!-- Bottom action: submit game -->
    <div
      v-if="activeTab === 'log'"
      class="fixed bottom-0 left-0 w-full z-50 flex justify-center pb-10 px-6"
    >
      <div class="fixed bottom-8 px-6 w-full max-w-md">
        <button
          :disabled="!canSubmit || submitting"
          class="flex items-center justify-center pressurized-gradient-primary rounded-full py-5 w-full shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:brightness-110 hover:scale-[1.02] transition-all active:scale-95 duration-150 disabled:opacity-50 disabled:hover:scale-100"
          @click="requireAuth(submitResult)"
        >
          <span
            class="material-symbols-outlined mr-3 text-3xl text-white"
            style="font-variation-settings: 'FILL' 1"
            >sports_score</span
          >
          <span
            class="font-extrabold text-lg tracking-tight uppercase text-white"
            style="font-family: 'Plus Jakarta Sans', sans-serif"
          >
            {{ submitting ? 'Saving…' : canSubmit ? 'Save Result' : 'Set scores first' }}
          </span>
        </button>
      </div>
    </div>

    <!-- Auth modal -->
    <transition name="fade">
      <div v-if="authModalOpen" class="fixed inset-0 z-50 flex items-center justify-center px-6">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="cancelAuth" />
        <div
          class="relative bg-surface-container-low rounded-[2rem] p-8 w-full max-w-sm shadow-[0_40px_80px_rgba(0,0,0,0.6)]"
        >
          <h2
            class="text-xl font-black tracking-tight mb-1"
            style="font-family: 'Plus Jakarta Sans', sans-serif"
          >
            Password required
          </h2>
          <p class="text-on-surface-variant text-sm mb-6">Enter the password to continue.</p>
          <form @submit.prevent="submitAuth">
            <input
              v-model="authPassword"
              type="password"
              placeholder="Password"
              class="w-full bg-surface-container-high border-none rounded-full py-4 px-6 font-bold focus:ring-2 focus:ring-primary transition-all outline-none placeholder:text-outline-variant mb-2"
              autofocus
            />
            <p v-if="authError" class="text-secondary text-sm font-bold px-2 mb-3">
              {{ authError }}
            </p>
            <div class="flex gap-3 mt-4">
              <button
                type="button"
                class="flex-1 py-3 rounded-full bg-surface-container-high font-extrabold uppercase tracking-wide text-sm hover:bg-surface-container-highest transition-colors"
                @click="cancelAuth"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="flex-1 py-3 rounded-full pressurized-gradient-primary text-white font-extrabold uppercase tracking-wide text-sm hover:brightness-110 transition-all"
              >
                Confirm
              </button>
            </div>
          </form>
        </div>
      </div>
    </transition>

    <!-- Delete confirmation modal -->
    <transition name="fade">
      <div v-if="confirmDeleteId" class="fixed inset-0 z-50 flex items-center justify-center px-6">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="cancelDelete" />
        <div
          class="relative bg-surface-container-low rounded-[2rem] p-8 w-full max-w-sm shadow-[0_40px_80px_rgba(0,0,0,0.6)]"
        >
          <h2
            class="text-xl font-black tracking-tight mb-1"
            style="font-family: 'Plus Jakarta Sans', sans-serif"
          >
            Delete match?
          </h2>
          <p class="text-on-surface-variant text-sm mb-6">
            This will remove the result and recalculate all ELO ratings.
          </p>
          <div class="flex gap-3">
            <button
              type="button"
              class="flex-1 py-3 rounded-full bg-surface-container-high font-extrabold uppercase tracking-wide text-sm hover:bg-surface-container-highest transition-colors"
              @click="cancelDelete"
            >
              Cancel
            </button>
            <button
              type="button"
              class="flex-1 py-3 rounded-full bg-secondary text-on-secondary font-extrabold uppercase tracking-wide text-sm hover:brightness-110 transition-all"
              @click="doDelete"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </transition>

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
import {
  type GameResult,
  type PlayerRanking,
  type TeamResult,
  deleteGameResult,
  getLeaderboard,
  getResults,
  saveGameResult,
} from '@/utils/matchmaking'
import { type PlayerTag, getFunFacts } from '@/utils/funfacts'
import { FUNFACT_INFO } from '@/utils/funfactInfo'
import { pairDefaultBallers } from '@/utils/defaultBallers'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()
const teamPalette = ['#97a9ff', '#ff7162', '#9BDA62', '#5F5FED', '#ffb347', '#2ec4b6']

type Tab = 'log' | 'history' | 'rankings'
const tabs: { id: Tab; label: string }[] = [
  { id: 'log', label: 'Log Game' },
  { id: 'history', label: 'History' },
  { id: 'rankings', label: 'Rankings' },
]
const validTabs: Tab[] = ['log', 'history', 'rankings']
const queryTab = route.query.tab
const initialTab: Tab =
  typeof queryTab === 'string' && (validTabs as readonly string[]).includes(queryTab)
    ? (queryTab as Tab)
    : 'log'
const activeTab = ref<Tab>(initialTab)

// ── Log Game ─────────────────────────────────────────────────────────────────
const TEAMS_KEY = 'bumbis:log-teams'
const SOURCE_KEY = 'bumbis:log-teams:source'

function makeTeam(index: number, players: string[] = []): TeamResult & { name: string } {
  return { name: `Team ${index + 1}`, players, score: 0 }
}

const logTeams = ref<Array<TeamResult & { name: string }>>(
  Array.from({ length: 2 }, (_, i) => makeTeam(i)),
)
const playerInputs = ref<string[]>(['', ''])
const focusedTeam = ref<number | null>(null)
const logError = ref('')
const logSuccess = ref('')
const submitting = ref(false)
const gameSource = ref<'lobby' | 'custom'>('custom')

onMounted(() => {
  if (initialTab === 'rankings') loadRankings()
  else if (initialTab === 'history') loadHistory()

  getLeaderboard()
    .then((lb) => {
      knownPlayers.value = lb.map((p) => p.name)
    })
    .catch(() => {})

  const stored = sessionStorage.getItem(TEAMS_KEY)
  const src = sessionStorage.getItem(SOURCE_KEY)
  sessionStorage.removeItem(TEAMS_KEY)
  sessionStorage.removeItem(SOURCE_KEY)
  if (src === 'lobby') gameSource.value = 'lobby'
  if (stored) {
    try {
      const raw: string[][] = JSON.parse(stored)
      if (Array.isArray(raw) && raw.length >= 2) {
        logTeams.value = raw.map((players, i) => makeTeam(i, players))
        playerInputs.value = raw.map(() => '')
      }
    } catch {
      // ignore malformed data
    }
  }
})

function setTeamCount(n: number) {
  const current = logTeams.value
  if (n === current.length) return
  if (n > current.length) {
    for (let i = current.length; i < n; i++) {
      logTeams.value.push(makeTeam(i))
      playerInputs.value.push('')
    }
  } else {
    logTeams.value = logTeams.value.slice(0, n)
    playerInputs.value = playerInputs.value.slice(0, n)
  }
}

const knownPlayers = ref<string[]>([])
const allKnownPlayers = computed(() => [...new Set([...pairDefaultBallers, ...knownPlayers.value])])

const allAddedPlayers = computed(() => new Set(logTeams.value.flatMap((t) => t.players)))

function availableDefaultBallers(teamIndex: number) {
  return allKnownPlayers.value.filter(
    (name) => !allAddedPlayers.value.has(name) && !logTeams.value[teamIndex].players.includes(name),
  )
}

function autocomplete(teamIndex: number) {
  const input = playerInputs.value[teamIndex]?.trim().toLowerCase()
  if (!input) return []
  return allKnownPlayers.value.filter(
    (name) =>
      name.toLowerCase().includes(input) && !logTeams.value[teamIndex].players.includes(name),
  )
}

function selectSuggestion(teamIndex: number, name: string) {
  if (!logTeams.value[teamIndex].players.includes(name)) {
    logTeams.value[teamIndex].players.push(name)
  }
  playerInputs.value[teamIndex] = ''
}

function addPlayer(teamIndex: number) {
  const name = playerInputs.value[teamIndex]?.trim()
  if (!name) return
  if (!logTeams.value[teamIndex].players.includes(name)) {
    logTeams.value[teamIndex].players.push(name)
  }
  playerInputs.value[teamIndex] = ''
}

function removePlayer(teamIndex: number, playerIndex: number) {
  logTeams.value[teamIndex].players.splice(playerIndex, 1)
}

const detectedWinner = computed<string | null>(() => {
  const maxScore = Math.max(...logTeams.value.map((t) => t.score))
  if (maxScore === 0) return null
  const topTeams = logTeams.value.filter((t) => t.score === maxScore)
  return topTeams.map((t, i) => t.name || `Team ${logTeams.value.indexOf(t) + 1}`).join(' & ')
})

const canSubmit = computed(() => detectedWinner.value !== null)

async function submitResult() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  logError.value = ''
  logSuccess.value = ''
  try {
    await saveGameResult(
      logTeams.value.map((t, i) => ({
        name: t.name || `Team ${i + 1}`,
        players: t.players,
        score: t.score,
      })),
      gameSource.value,
    )
    logSuccess.value = 'Result saved!'
    const count = logTeams.value.length
    logTeams.value = Array.from({ length: count }, (_, i) => makeTeam(i))
    playerInputs.value = Array.from({ length: count }, () => '')
    gameSource.value = 'custom'
    history.value = []
    rankings.value = []
  } catch (err) {
    logError.value = err instanceof Error ? err.message : 'Could not save result'
  } finally {
    submitting.value = false
  }
}

// ── History ───────────────────────────────────────────────────────────────────
const history = ref<GameResult[]>([])
const loadingHistory = ref(false)

async function loadHistory() {
  loadingHistory.value = true
  try {
    history.value = await getResults()
  } finally {
    loadingHistory.value = false
  }
}

const APP_PASSWORD = '123niga123'
const AUTH_KEY = 'bumbis:auth'

const isAuthenticated = ref(localStorage.getItem(AUTH_KEY) === APP_PASSWORD)

// Generic auth modal
const authModalOpen = ref(false)
const authPassword = ref('')
const authError = ref('')
const pendingAction = ref<(() => void) | null>(null)

function requireAuth(action: () => void) {
  if (isAuthenticated.value) {
    action()
  } else {
    pendingAction.value = action
    authModalOpen.value = true
    authPassword.value = ''
    authError.value = ''
  }
}

function submitAuth() {
  if (authPassword.value !== APP_PASSWORD) {
    authError.value = 'Wrong password.'
    return
  }
  localStorage.setItem(AUTH_KEY, APP_PASSWORD)
  isAuthenticated.value = true
  authModalOpen.value = false
  const action = pendingAction.value
  pendingAction.value = null
  action?.()
}

function cancelAuth() {
  authModalOpen.value = false
  pendingAction.value = null
  authPassword.value = ''
  authError.value = ''
}

// Delete confirm modal (shown after auth)
const deletingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)

function promptDelete(id: string) {
  requireAuth(() => {
    confirmDeleteId.value = id
  })
}

function cancelDelete() {
  confirmDeleteId.value = null
}

async function doDelete() {
  const id = confirmDeleteId.value
  if (!id) return
  confirmDeleteId.value = null
  deletingId.value = id
  try {
    await deleteGameResult(id)
    history.value = history.value.filter((r) => r.id !== id)
    rankings.value = []
  } finally {
    deletingId.value = null
  }
}

// ── Rankings ──────────────────────────────────────────────────────────────────
const rankings = ref<PlayerRanking[]>([])
const loadingRankings = ref(false)

// Fun-fact badges keyed by player name (best-effort; rankings work without them).
const funTags = ref<Record<string, PlayerTag>>({})

async function loadRankings() {
  loadingRankings.value = true
  try {
    rankings.value = await getLeaderboard()
  } finally {
    loadingRankings.value = false
  }
  getFunFacts()
    .then((facts) => {
      funTags.value = facts.tags
    })
    .catch(() => {})
}

const TAG_TONE_CLASSES: Record<PlayerTag['tone'], string> = {
  good: 'bg-primary/15 text-primary',
  bad: 'bg-secondary/15 text-secondary',
  neutral: 'bg-surface-container-high text-on-surface-variant',
}
function tagToneClass(tone: PlayerTag['tone']) {
  return TAG_TONE_CLASSES[tone]
}

// Badge explanation popover: hover reveals it, tap pins it (by player name).
const openTag = ref<string | null>(null)
function toggleTag(name: string) {
  openTag.value = openTag.value === name ? null : name
}
function tagInfo(tag: PlayerTag) {
  return FUNFACT_INFO[tag.key]
}

watch(activeTab, (tab) => {
  if (tab === 'history') loadHistory()
  if (tab === 'rankings') loadRankings()
})

// Average goal differential per game, derived from the leaderboard's goal totals.
function avgGoalGain(p: PlayerRanking): number {
  return p.games_played > 0 ? (p.goals_for - p.goals_against) / p.games_played : 0
}
function signedGain(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}`
}
function gainClass(p: PlayerRanking): string {
  const g = avgGoalGain(p)
  return g > 0 ? 'text-green-500' : g < 0 ? 'text-red-500' : 'text-on-surface-variant'
}

function teamColor(index: number) {
  return teamPalette[index % teamPalette.length]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
