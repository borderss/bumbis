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

    <main class="flex-grow container mx-auto px-4 sm:px-6 py-8 max-w-3xl pb-28">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-8 px-2">
        <div>
          <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm">
            Live lobby
          </p>
          <h1 class="text-4xl font-black tracking-tight">Matchmaking</h1>
        </div>
        <div class="flex gap-3">
          <RouterLink
            to="/results"
            class="bg-surface-container-high px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest transition-colors"
          >
            Results
          </RouterLink>
          <RouterLink
            to="/"
            class="bg-surface-container-high px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest transition-colors"
          >
            Home
          </RouterLink>
        </div>
      </div>

      <!-- Room missing / expired -->
      <div
        v-if="notFound"
        class="bg-surface-container-low rounded-[2rem] p-10 text-center shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
      >
        <span class="material-symbols-outlined text-6xl text-secondary">link_off</span>
        <h2 class="text-2xl font-black tracking-tight mt-4">This lobby is gone</h2>
        <p class="text-on-surface-variant mt-2">
          The link is invalid or the lobby expired. Start a fresh one.
        </p>
        <button
          type="button"
          class="pressurized-gradient-primary rounded-full px-8 py-4 mt-6 text-white font-extrabold uppercase tracking-wide hover:brightness-110 transition-all"
          @click="startNew"
        >
          Start matchmaking
        </button>
      </div>

      <template v-else>
        <!-- Share -->
        <div
          class="bg-surface-container-low rounded-[2rem] p-6 mb-6 shadow-[0_20px_40px_rgba(0,0,0,0.35)] flex flex-wrap items-center justify-between gap-4"
        >
          <div class="min-w-0">
            <p class="text-on-surface-variant uppercase font-black tracking-widest text-xs">
              Share this link
            </p>
            <p class="font-bold truncate text-on-surface">{{ shareUrl }}</p>
          </div>
          <button
            type="button"
            class="bg-primary/15 px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-primary hover:bg-primary/25 transition-colors shrink-0"
            @click="copyLink"
          >
            {{ copied ? 'Copied!' : 'Copy link' }}
          </button>
        </div>

        <!-- Live connection hint -->
        <p
          v-if="connectionLost"
          class="text-secondary text-sm font-bold mb-4 px-2 flex items-center gap-2"
        >
          <span class="material-symbols-outlined text-base">sync_problem</span>
          Reconnecting to live updates…
        </p>

        <!-- Check-in -->
        <div
          class="bg-surface-container-low rounded-[2rem] p-8 mb-6 shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
        >
          <template v-if="isCheckedIn">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="flex items-center gap-3">
                <span
                  class="material-symbols-outlined text-3xl text-primary"
                  style="font-variation-settings: 'FILL' 1"
                  >check_circle</span
                >
                <div>
                  <p class="text-on-surface-variant uppercase font-black tracking-widest text-xs">
                    You're in as
                  </p>
                  <p class="text-2xl font-black tracking-tight">{{ myName }}</p>
                </div>
              </div>
              <button
                type="button"
                class="bg-secondary/15 px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-secondary hover:bg-secondary/25 transition-colors disabled:opacity-50"
                :disabled="busy"
                @click="leave"
              >
                Leave
              </button>
            </div>
          </template>
          <template v-else>
            <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm mb-3">
              Check in to play
            </p>
            <form class="relative" @submit.prevent="checkIn">
              <input
                v-model="nameInput"
                class="w-full bg-surface-container-high border-none rounded-full py-6 px-8 text-xl font-bold focus:ring-2 focus:ring-primary-dim transition-all outline-none placeholder:text-outline-variant text-on-surface"
                placeholder="Your name"
                type="text"
                maxlength="40"
              />
              <button
                type="submit"
                class="absolute right-3 top-1/2 -translate-y-1/2 pressurized-gradient-primary text-white px-6 h-12 rounded-full flex items-center justify-center font-extrabold uppercase tracking-wide hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
                :disabled="busy || !nameInput.trim()"
              >
                I'm in
              </button>
            </form>
            <div v-if="availableBallers.length > 0" class="flex flex-wrap gap-2 mt-4">
              <button
                v-for="name in availableBallers"
                :key="name"
                type="button"
                class="bg-surface-container-high px-4 py-2 rounded-full text-sm font-extrabold tracking-tight hover:bg-surface-container-highest transition-colors disabled:opacity-50"
                :disabled="busy"
                @click="quickCheckIn(name)"
              >
                {{ name }}
              </button>
            </div>
          </template>
          <p v-if="errorMsg" class="text-secondary text-sm font-bold mt-3 px-2">{{ errorMsg }}</p>
        </div>

        <!-- Roster -->
        <div
          class="bg-surface-container-low rounded-[2rem] p-8 mb-6 shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
        >
          <div class="flex items-center justify-between gap-4 mb-5">
            <div>
              <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm">
                Checked in
              </p>
              <h2 class="text-2xl font-black tracking-tight">Players</h2>
            </div>
            <p class="text-3xl font-black text-primary">{{ players.length }}</p>
          </div>

          <div v-if="players.length === 0" class="text-outline-variant text-lg font-medium">
            Nobody yet. Share the link and check in.
          </div>
          <div v-else class="flex flex-wrap gap-3">
            <div
              v-for="player in players"
              :key="player.id"
              :class="[
                player.id === myPlayerId
                  ? 'bg-primary/20 text-primary'
                  : 'bg-surface-container-high text-on-surface',
                'px-5 py-3 rounded-full text-base font-extrabold tracking-tight',
              ]"
            >
              {{ player.name }}
            </div>
          </div>
        </div>

        <!-- Teams result -->
        <div v-if="room && room.status === 'split' && room.teams" class="space-y-6">
          <div class="flex items-center justify-between px-2">
            <h2
              class="text-3xl font-black tracking-tighter uppercase"
              style="font-family: 'Plus Jakarta Sans', sans-serif"
            >
              Teams
            </h2>
            <div class="flex flex-wrap gap-3">
              <button
                type="button"
                class="bg-surface-container-high px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest transition-colors disabled:opacity-50"
                :disabled="busy"
                @click="backToLobby"
              >
                Back to lobby
              </button>
              <button
                type="button"
                class="bg-primary/15 px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
                :disabled="busy"
                @click="reroll"
              >
                Re-roll
              </button>
              <button
                type="button"
                class="pressurized-gradient-primary px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-white hover:brightness-110 transition-all"
                @click="goLogResult"
              >
                Log Result
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div
              v-for="(team, index) in room.teams"
              :key="index"
              :class="[
                index === favoredTeam
                  ? 'ring-2 ring-primary bg-primary/5'
                  : 'bg-surface-container-low',
                'rounded-[2rem] p-6 shadow-lg transition-all',
              ]"
            >
              <div class="flex items-center gap-3 mb-4">
                <span class="w-4 h-4 rounded-full" :style="{ backgroundColor: teamColor(index) }" />
                <h3 class="text-xl font-black tracking-tight uppercase">Team {{ index + 1 }}</h3>
                <span
                  v-if="index === favoredTeam"
                  class="ml-auto flex items-center gap-1 bg-primary/15 text-primary px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wide"
                >
                  <span
                    class="material-symbols-outlined text-sm"
                    style="font-variation-settings: 'FILL' 1"
                    >trending_up</span
                  >
                  Favored
                </span>
              </div>

              <!-- ELO win prediction -->
              <div v-if="winPct(index) !== null" class="mb-4">
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-xs uppercase font-black tracking-widest text-on-surface-variant"
                    >Win chance</span
                  >
                  <span
                    :class="[
                      index === favoredTeam ? 'text-primary' : 'text-on-surface-variant',
                      'text-sm font-black',
                    ]"
                    >{{ winPct(index) }}%</span
                  >
                </div>
                <div class="h-2 rounded-full bg-surface-container-high overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all duration-500"
                    :style="{ width: `${winPct(index)}%`, backgroundColor: teamColor(index) }"
                  />
                </div>
                <p
                  v-if="matchupNote(index)"
                  class="mt-1.5 text-xs font-bold text-on-surface-variant"
                >
                  {{ matchupNote(index) }}
                </p>
              </div>

              <ul class="space-y-2">
                <li
                  v-for="name in team"
                  :key="name"
                  class="bg-surface-container-high px-5 py-3 rounded-full text-lg font-extrabold tracking-tight"
                >
                  {{ name }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </template>
    </main>

    <!-- Bottom action: split into teams (lobby only) -->
    <div
      v-if="!notFound && room && room.status === 'open'"
      class="fixed bottom-0 left-0 w-full z-50 flex flex-col items-center gap-4 pb-8 px-6"
    >
      <div class="flex items-center gap-2 bg-surface-container rounded-full px-2 py-2 shadow-lg">
        <span class="text-on-surface-variant uppercase font-black tracking-widest text-xs px-3">
          Teams
        </span>
        <button
          v-for="count in teamCountOptions"
          :key="count"
          type="button"
          :class="[
            teamCount === count
              ? 'bg-primary text-on-primary'
              : 'text-on-surface hover:bg-surface-container-high',
            'w-10 h-10 rounded-full font-extrabold transition-colors',
          ]"
          @click="teamCount = count"
        >
          {{ count }}
        </button>
      </div>
      <div class="w-full max-w-md">
        <button
          class="flex items-center justify-center pressurized-gradient-primary rounded-full py-5 w-full shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:brightness-110 hover:scale-[1.02] transition-all active:scale-95 duration-150 disabled:opacity-50 disabled:hover:scale-100"
          :disabled="!canSplit || busy"
          @click="doSplit"
        >
          <span
            class="material-symbols-outlined mr-3 text-3xl text-white"
            style="font-variation-settings: 'FILL' 1"
            >groups</span
          >
          <span
            class="font-extrabold text-lg tracking-tight uppercase text-white"
            style="font-family: 'Plus Jakarta Sans', sans-serif"
          >
            {{ canSplit ? 'Split into teams' : 'Need 2+ players' }}
          </span>
        </button>
      </div>
    </div>

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
  createRoom,
  describeMatchup,
  getRoom,
  getRoomPrediction,
  joinRoom,
  leaveRoom,
  resetRoom,
  splitTeams,
  subscribeRoom,
  type Insight,
  type Room,
} from '@/utils/matchmaking'
import { pairDefaultBallers } from '@/utils/defaultBallers'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const NAME_KEY = 'bumbis:matchName'
const playerKey = (roomId: string) => `bumbis:player:${roomId}`
const teamPalette = ['#97a9ff', '#ff7162', '#9BDA62', '#5F5FED', '#ffb347', '#2ec4b6']

const roomId = computed(() => String(route.params.roomId ?? ''))
const room = ref<Room | null>(null)
const notFound = ref(false)
const connectionLost = ref(false)
const nameInput = ref('')
const myPlayerId = ref<string | null>(null)
const teamCount = ref(2)
const teamCountOptions = [2, 3, 4]
const busy = ref(false)
const copied = ref(false)
const errorMsg = ref('')

let unsubscribe: (() => void) | null = null
let copyTimer: number | null = null

const players = computed(() => room.value?.players ?? [])
const isCheckedIn = computed(
  () => myPlayerId.value !== null && players.value.some((p) => p.id === myPlayerId.value),
)
const availableBallers = computed(() =>
  pairDefaultBallers.filter((name) => !players.value.some((p) => p.name === name)),
)
const myName = computed(() => players.value.find((p) => p.id === myPlayerId.value)?.name ?? '')
const canSplit = computed(() => players.value.length >= 2)
const shareUrl = computed(() => `${window.location.origin}/match/${roomId.value}`)

// ELO-based win prediction for the current split, aligned to team order.
const prediction = ref<number[]>([])
const insights = ref<Insight[]>([])
const favoredTeam = computed(() => {
  if (prediction.value.length === 0) return null
  return prediction.value.reduce((best, p, i) => (p > prediction.value[best] ? i : best), 0)
})

function winPct(index: number): number | null {
  const p = prediction.value[index]
  return p === undefined ? null : Math.round(p * 100)
}

function matchupNote(index: number): string | null {
  return describeMatchup(insights.value[index])
}

async function loadPrediction() {
  if (!room.value || room.value.status !== 'split' || !room.value.teams) {
    prediction.value = []
    insights.value = []
    return
  }
  try {
    const { probabilities, insights: pairs } = await getRoomPrediction(roomId.value)
    prediction.value = probabilities
    insights.value = pairs ?? []
  } catch {
    prediction.value = []
    insights.value = []
  }
}

// Refetch whenever the teams change (split, re-roll) and clear when not split.
watch(
  () => (room.value?.status === 'split' ? JSON.stringify(room.value.teams) : ''),
  loadPrediction,
)

function teamColor(index: number) {
  return teamPalette[index % teamPalette.length]
}

function applyRoom(next: Room) {
  room.value = next
  connectionLost.value = false
  // Drop a stale identity if the server no longer lists us (e.g. removed/expired).
  if (myPlayerId.value && !next.players.some((p) => p.id === myPlayerId.value)) {
    myPlayerId.value = null
    localStorage.removeItem(playerKey(roomId.value))
  }
}

async function quickCheckIn(name: string) {
  nameInput.value = name
  await checkIn()
}

async function checkIn() {
  const name = nameInput.value.trim()
  if (!name || busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    const { player } = await joinRoom(roomId.value, name)
    myPlayerId.value = player.id
    localStorage.setItem(playerKey(roomId.value), player.id)
    localStorage.setItem(NAME_KEY, player.name)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not check in'
  } finally {
    busy.value = false
  }
}

async function leave() {
  if (!myPlayerId.value || busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    await leaveRoom(roomId.value, myPlayerId.value)
    myPlayerId.value = null
    localStorage.removeItem(playerKey(roomId.value))
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not leave'
  } finally {
    busy.value = false
  }
}

async function doSplit() {
  if (!canSplit.value || busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    await splitTeams(roomId.value, teamCount.value)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Could not split teams'
  } finally {
    busy.value = false
  }
}

const reroll = doSplit

async function backToLobby() {
  if (busy.value) return
  busy.value = true
  try {
    await resetRoom(roomId.value)
  } finally {
    busy.value = false
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    copied.value = true
    if (copyTimer) window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => (copied.value = false), 2000)
  } catch {
    errorMsg.value = 'Copy failed — select the link manually'
  }
}

async function startNew() {
  const { id } = await createRoom()
  router.push(`/match/${id}`)
}

function goLogResult() {
  if (!room.value?.teams) return
  sessionStorage.setItem('bumbis:log-teams', JSON.stringify(room.value.teams))
  sessionStorage.setItem('bumbis:log-teams:source', 'lobby')
  router.push('/results')
}

async function load() {
  unsubscribe?.()
  unsubscribe = null
  notFound.value = false
  room.value = null

  const id = roomId.value
  if (!id) {
    notFound.value = true
    return
  }

  // Restore prior identity for this room and the last name typed anywhere.
  myPlayerId.value = localStorage.getItem(playerKey(id))
  nameInput.value = localStorage.getItem(NAME_KEY) ?? ''

  try {
    applyRoom(await getRoom(id))
  } catch {
    notFound.value = true
    return
  }

  unsubscribe = subscribeRoom(id, applyRoom, () => {
    connectionLost.value = true
  })
}

watch(roomId, load)
onMounted(load)
onBeforeUnmount(() => {
  unsubscribe?.()
  if (copyTimer) window.clearTimeout(copyTimer)
})
</script>
