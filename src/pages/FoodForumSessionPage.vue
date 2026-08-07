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

    <main class="flex-grow container mx-auto px-4 sm:px-6 py-12 max-w-6xl pb-28">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-10 px-2">
        <div>
          <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm">
            Friday Food Forum
          </p>
          <h1 class="text-4xl font-black tracking-tight">Where are we eating?</h1>
        </div>
        <RouterLink
          to="/"
          class="bg-surface-container-high px-5 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest transition-colors"
        >
          Home
        </RouterLink>
      </div>

      <!-- Forum missing / expired -->
      <div
        v-if="notFound"
        class="bg-surface-container-low rounded-[2rem] p-10 text-center shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
      >
        <span class="material-symbols-outlined text-6xl text-secondary">link_off</span>
        <h2 class="text-2xl font-black tracking-tight mt-4">This forum is gone</h2>
        <p class="text-on-surface-variant mt-2">The link is invalid or the forum expired.</p>
        <RouterLink
          to="/food-forum"
          class="inline-block pressurized-gradient-primary rounded-full px-8 py-4 mt-6 text-white font-extrabold uppercase tracking-wide hover:brightness-110 transition-all"
        >
          Start a new forum
        </RouterLink>
      </div>

      <template v-else-if="state">
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

        <p
          v-if="connectionLost"
          class="text-secondary text-sm font-bold mb-4 px-2 flex items-center gap-2"
        >
          <span class="material-symbols-outlined text-base">sync_problem</span>
          Reconnecting to live updates…
        </p>

        <!-- Status / countdown banner -->
        <div
          class="bg-surface-container-low rounded-[2rem] p-6 mb-6 shadow-[0_20px_40px_rgba(0,0,0,0.35)] flex flex-wrap items-center justify-between gap-4"
        >
          <div>
            <p class="text-on-surface-variant uppercase font-black tracking-widest text-xs">
              Status
            </p>
            <p class="text-xl font-black tracking-tight">{{ statusLabel }}</p>
          </div>
          <div v-if="state.status === 'open' && remainingMs !== null" class="text-right">
            <p class="text-on-surface-variant uppercase tracking-widest text-xs">Time left</p>
            <p class="text-3xl font-black text-secondary tabular-nums">{{ countdown }}</p>
          </div>
          <div v-else-if="state.status === 'decided' && state.winnerName" class="text-right">
            <p class="text-on-surface-variant uppercase tracking-widest text-xs">We're eating at</p>
            <p class="text-2xl font-black text-primary">{{ state.winnerName }}</p>
          </div>
        </div>

        <section class="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-10">
          <!-- Left column: wheel + chat -->
          <div class="space-y-8 min-w-0">
            <!-- Wheel -->
            <div
              class="bg-surface-container-low rounded-[2rem] p-8 shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
            >
              <div class="flex items-center justify-between gap-4 mb-6">
                <div>
                  <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm">
                    Tie-breaker
                  </p>
                  <h2 class="text-2xl font-black tracking-tight">Spin the wheel</h2>
                </div>
                <div class="text-right">
                  <p class="text-on-surface-variant uppercase tracking-widest text-xs">Places</p>
                  <p class="text-3xl font-black text-primary">{{ approvedPlaces.length }}</p>
                </div>
              </div>

              <div class="relative flex items-center justify-center py-8">
                <div class="relative w-[22rem] h-[22rem] max-w-full max-h-full">
                  <div class="absolute top-1/2 -right-8 -translate-y-1/2 z-20">
                    <div
                      class="w-0 h-0 border-t-[18px] border-b-[18px] border-r-[32px] border-t-transparent border-b-transparent border-r-secondary drop-shadow-[0_6px_12px_rgba(0,0,0,0.35)]"
                    />
                  </div>
                  <div
                    class="relative w-full h-full rounded-full border-[10px] border-surface-container-highest bg-surface shadow-[0_30px_60px_rgba(0,0,0,0.35)] overflow-hidden"
                  >
                    <div
                      class="absolute inset-0 rounded-full transition-transform ease-out"
                      :style="wheelStyle"
                    >
                      <div
                        v-for="(segment, index) in wheelSegments"
                        :key="`${segment.name}-${index}`"
                        class="absolute inset-0"
                        :style="segmentStyle(index)"
                      />
                      <svg
                        class="absolute inset-0 h-full w-full pointer-events-none"
                        viewBox="0 0 352 352"
                      >
                        <text
                          v-for="label in wheelLabels"
                          :key="`${label.name}-${label.index}`"
                          :x="label.x"
                          :y="label.y"
                          :transform="`rotate(${label.rotation} ${label.x} ${label.y})`"
                          class="fill-white select-none"
                          dominant-baseline="middle"
                          text-anchor="start"
                        >
                          {{ label.name }}
                        </text>
                      </svg>
                    </div>
                    <div
                      class="absolute inset-[6.25rem] rounded-full bg-surface flex items-center justify-center border border-white/10"
                    >
                      <div class="text-center px-6">
                        <p class="text-on-surface-variant uppercase tracking-[0.3em] text-xs">
                          Result
                        </p>
                        <p class="text-2xl font-black tracking-tight mt-2 break-words">
                          {{ selectedName || state.winnerName || 'Spin me' }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="mt-4 flex flex-wrap items-center gap-4 justify-between">
                <p class="text-on-surface-variant text-sm max-w-xs">
                  {{ spinHint }}
                </p>
                <button
                  type="button"
                  class="pressurized-gradient-primary rounded-full px-8 py-4 text-white font-extrabold uppercase tracking-wide shadow-[0_20px_40px_rgba(0,0,0,0.35)] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="!canSpin || busy"
                  @click="spin"
                >
                  {{ spinning ? 'Spinning…' : 'Spin the wheel' }}
                </button>
              </div>
            </div>

            <!-- Chat (beneath the wheel) -->
            <div
              class="bg-surface-container-low rounded-[2rem] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
            >
              <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm mb-4">
                Chat
              </p>
              <ChatPanel
                :messages="messages"
                :can-chat="hasJoined"
                :can-delete="isAdmin"
                :busy="busy"
                @send="sendChat"
                @delete="deleteChat"
              />
            </div>
          </div>
          <!-- End left column -->

          <div class="space-y-8 min-w-0">
            <!-- Identity (joining is handled by the name-gate modal) -->
            <div
              v-if="hasJoined"
              class="bg-surface-container-low rounded-[2rem] p-8 shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
            >
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-on-surface-variant uppercase font-black tracking-widest text-xs">
                    Voting as
                  </p>
                  <p class="text-xl font-black tracking-tight">{{ voterName }}</p>
                </div>
                <button
                  type="button"
                  class="bg-surface-container-high px-4 py-2 rounded-full text-sm font-extrabold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest transition-colors disabled:opacity-50"
                  :disabled="busy"
                  @click="leave"
                >
                  Leave
                </button>
              </div>
            </div>

            <!-- Places / voting -->
            <div
              class="bg-surface-container-low rounded-[2rem] p-8 shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
            >
              <div class="flex items-center justify-between gap-4 mb-5">
                <div>
                  <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm">
                    {{ state.selectionMode === 'multi' ? 'Pick any you like' : 'Pick one' }}
                  </p>
                  <h2 class="text-2xl font-black tracking-tight">The places</h2>
                </div>
              </div>

              <p v-if="!hasJoined" class="text-outline-variant mb-4">
                Enter your name to cast a vote.
              </p>
              <p v-else-if="state.status !== 'open'" class="text-outline-variant mb-4">
                Voting is closed.
              </p>

              <div class="space-y-3">
                <button
                  v-for="place in approvedPlaces"
                  :key="place.id"
                  type="button"
                  class="w-full text-left rounded-2xl px-5 py-4 transition-colors relative overflow-hidden disabled:cursor-not-allowed"
                  :class="
                    isSelected(place.id)
                      ? 'bg-primary/20 ring-2 ring-primary'
                      : 'bg-surface-container-high hover:bg-surface-container-highest disabled:hover:bg-surface-container-high'
                  "
                  :disabled="!canVote"
                  @click="toggleVote(place.id)"
                >
                  <span
                    class="absolute inset-y-0 left-0 bg-primary/10"
                    :style="{ width: barWidth(place.votes) }"
                  />
                  <span class="relative flex items-center justify-between gap-3">
                    <span class="flex items-center gap-3 font-extrabold tracking-tight">
                      <span
                        class="material-symbols-outlined text-xl"
                        :class="isSelected(place.id) ? 'text-primary' : 'text-on-surface-variant'"
                      >
                        {{
                          isSelected(place.id)
                            ? 'check_circle'
                            : state.selectionMode === 'multi'
                              ? 'check_box_outline_blank'
                              : 'radio_button_unchecked'
                        }}
                      </span>
                      {{ place.name }}
                    </span>
                    <span class="flex items-center gap-3 shrink-0">
                      <span class="text-lg font-black text-primary tabular-nums">{{
                        place.votes
                      }}</span>
                      <span
                        v-if="isAdmin"
                        class="material-symbols-outlined text-on-surface-variant hover:text-secondary transition-colors"
                        title="Remove place"
                        @click.stop="removePlaceFn(place.id)"
                      >
                        delete
                      </span>
                    </span>
                  </span>
                </button>
              </div>

              <!-- Pending suggestions awaiting admin approval -->
              <div v-if="pendingPlaces.length > 0" class="mt-5">
                <p
                  class="text-xs font-extrabold uppercase tracking-wide text-on-surface-variant mb-2"
                >
                  {{ isAdmin ? 'Awaiting your approval' : 'Suggested — awaiting approval' }}
                </p>
                <div class="space-y-2">
                  <div
                    v-for="place in pendingPlaces"
                    :key="place.id"
                    class="flex items-center justify-between gap-3 rounded-2xl bg-surface-container-high/60 border border-dashed border-outline-variant px-5 py-3"
                  >
                    <span class="font-extrabold tracking-tight text-on-surface-variant truncate">
                      {{ place.name }}
                    </span>
                    <span v-if="isAdmin" class="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        class="bg-primary/15 text-primary px-3 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wide hover:bg-primary/25 transition-colors disabled:opacity-50"
                        :disabled="busy"
                        @click="approvePlaceFn(place.id)"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        class="material-symbols-outlined text-on-surface-variant hover:text-secondary transition-colors disabled:opacity-50"
                        title="Reject"
                        :disabled="busy"
                        @click="removePlaceFn(place.id)"
                      >
                        close
                      </button>
                    </span>
                    <span
                      v-else
                      class="material-symbols-outlined text-base text-outline-variant shrink-0"
                      title="Awaiting approval"
                    >
                      hourglass_empty
                    </span>
                  </div>
                </div>
              </div>

              <!-- Add a place: admins always, others when suggestions are open -->
              <form
                v-if="isAdmin || state.allowSuggestions"
                class="relative mt-4"
                @submit.prevent="addPlaceFn"
              >
                <input
                  v-model="newPlaceInput"
                  class="w-full bg-surface-container-high border-none rounded-full py-4 px-6 font-bold focus:ring-2 focus:ring-primary-dim transition-all outline-none placeholder:text-outline-variant text-on-surface"
                  :placeholder="isAdmin ? 'Add a place' : 'Suggest a place'"
                  type="text"
                  maxlength="40"
                />
                <button
                  type="submit"
                  class="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-on-primary w-10 h-10 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                  :disabled="busy || !newPlaceInput.trim()"
                >
                  <span class="material-symbols-outlined text-xl font-bold">add</span>
                </button>
              </form>
              <p v-if="errorMsg" class="text-secondary text-sm font-bold mt-3 px-2">
                {{ errorMsg }}
              </p>
            </div>

            <!-- Voters -->
            <div
              class="bg-surface-container-low rounded-[2rem] p-8 shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
            >
              <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm mb-4">
                In the forum ({{ voters.length }})
              </p>
              <div v-if="voters.length === 0" class="text-outline-variant">Nobody yet.</div>
              <div v-else class="flex flex-wrap gap-3">
                <div
                  v-for="voter in voters"
                  :key="voter.id"
                  class="bg-surface-container-high text-on-surface px-5 py-3 rounded-full flex items-center gap-3 font-extrabold tracking-tight"
                >
                  <span>{{ voter.name }}</span>
                  <button
                    v-if="isAdmin"
                    type="button"
                    class="material-symbols-outlined text-on-surface-variant hover:text-secondary transition-colors disabled:opacity-50"
                    title="Kick"
                    :disabled="busy"
                    @click="kick(voter.id)"
                  >
                    close
                  </button>
                </div>
              </div>
            </div>

            <!-- Admin panel -->
            <div
              v-if="isAdmin"
              class="bg-surface-container-low rounded-[2rem] p-8 shadow-[0_20px_40px_rgba(0,0,0,0.35)] space-y-6"
            >
              <p class="text-on-surface-variant uppercase font-black tracking-widest text-sm">
                Admin controls
              </p>

              <div>
                <p
                  class="text-xs font-extrabold uppercase tracking-wide text-on-surface-variant mb-2"
                >
                  Selection
                </p>
                <div class="flex gap-2">
                  <button
                    v-for="mode in ['single', 'multi'] as const"
                    :key="mode"
                    type="button"
                    class="flex-1 px-4 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide transition-colors"
                    :class="
                      state.selectionMode === mode
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
                    "
                    @click="setConfig({ selectionMode: mode })"
                  >
                    {{ mode === 'single' ? 'One each' : 'Multiple' }}
                  </button>
                </div>
              </div>

              <div>
                <p
                  class="text-xs font-extrabold uppercase tracking-wide text-on-surface-variant mb-2"
                >
                  Wheel weighting
                </p>
                <div class="flex gap-2">
                  <button
                    v-for="mode in ['weighted', 'tied'] as const"
                    :key="mode"
                    type="button"
                    class="flex-1 px-4 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide transition-colors"
                    :class="
                      state.wheelMode === mode
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
                    "
                    @click="setConfig({ wheelMode: mode })"
                  >
                    {{ mode === 'weighted' ? 'By votes' : 'Tied only' }}
                  </button>
                </div>
              </div>

              <label class="flex items-center justify-between gap-3 cursor-pointer select-none">
                <span
                  class="text-xs font-extrabold uppercase tracking-wide text-on-surface-variant"
                >
                  Let anyone suggest places
                </span>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="state.allowSuggestions"
                  class="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200"
                  :class="state.allowSuggestions ? 'bg-primary' : 'bg-surface-container-highest'"
                  @click="setConfig({ allowSuggestions: !state.allowSuggestions })"
                >
                  <span
                    class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200"
                    :class="state.allowSuggestions ? 'translate-x-6' : 'translate-x-1'"
                  />
                </button>
              </label>

              <label class="flex items-center justify-between gap-3 cursor-pointer select-none">
                <span
                  class="text-xs font-extrabold uppercase tracking-wide text-on-surface-variant"
                >
                  Dativa krāsas
                </span>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="state.dativaColors"
                  class="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200"
                  :class="state.dativaColors ? 'bg-primary' : 'bg-surface-container-highest'"
                  @click="setConfig({ dativaColors: !state.dativaColors })"
                >
                  <span
                    class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200"
                    :class="state.dativaColors ? 'translate-x-6' : 'translate-x-1'"
                  />
                </button>
              </label>

              <div>
                <p
                  class="text-xs font-extrabold uppercase tracking-wide text-on-surface-variant mb-2"
                >
                  Timer (minutes)
                </p>
                <div class="flex gap-2">
                  <input
                    v-model="timerInput"
                    type="number"
                    min="1"
                    class="w-28 bg-surface-container-high border-none rounded-full py-3 px-5 font-bold focus:ring-2 focus:ring-primary-dim outline-none text-on-surface"
                    placeholder="10"
                  />
                  <button
                    type="button"
                    class="flex-1 bg-primary text-on-primary px-4 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide hover:brightness-110 transition-all disabled:opacity-50"
                    :disabled="busy || !timerInput"
                    @click="startTimer"
                  >
                    Start timer
                  </button>
                  <button
                    type="button"
                    class="bg-surface-container-high px-4 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest transition-colors disabled:opacity-50"
                    :disabled="busy"
                    @click="clearTimer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <button
                v-if="state.status === 'open'"
                type="button"
                class="w-full bg-secondary/20 text-secondary px-4 py-3 rounded-full text-sm font-extrabold uppercase tracking-wide hover:bg-secondary/30 transition-colors disabled:opacity-50"
                :disabled="busy"
                @click="lock"
              >
                Lock voting now
              </button>
            </div>
          </div>
        </section>
      </template>
    </main>

    <!-- Name gate: you must enter a name before voting or chatting -->
    <teleport to="body">
      <transition name="modal-fade">
        <div
          v-if="state && !notFound && !hasJoined"
          class="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 px-6"
        >
          <div
            class="winner-card w-full max-w-md rounded-[2rem] bg-surface-container p-8 text-center shadow-[0_30px_80px_rgba(0,0,0,0.55)] border border-white/10"
            role="dialog"
            aria-modal="true"
          >
            <span class="material-symbols-outlined text-5xl text-primary">restaurant</span>
            <h3 class="text-2xl font-black tracking-tight mt-3 mb-2">Enter your name</h3>
            <p class="text-on-surface-variant mb-6">Pick a name to join the vote and chat.</p>
            <form @submit.prevent="join">
              <input
                v-model="joinNameInput"
                class="w-full bg-surface-container-high border-none rounded-full py-5 px-7 text-lg font-bold text-center focus:ring-2 focus:ring-primary-dim transition-all outline-none placeholder:text-outline-variant text-on-surface"
                placeholder="Your name"
                type="text"
                maxlength="40"
              />
              <button
                type="submit"
                class="w-full pressurized-gradient-primary rounded-full px-8 py-4 mt-4 text-white font-extrabold uppercase tracking-wide hover:brightness-110 transition-all disabled:opacity-50"
                :disabled="busy || !joinNameInput.trim()"
              >
                Join
              </button>
            </form>
            <p v-if="errorMsg" class="text-secondary text-sm font-bold mt-3">{{ errorMsg }}</p>
          </div>
        </div>
      </transition>
    </teleport>

    <teleport to="body">
      <WinnerCelebration v-if="showWinnerModal" :variant="celebrationVariant" />
      <transition name="modal-fade">
        <div
          v-if="showWinnerModal"
          class="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-6"
          @click.self="closeWinnerModal"
        >
          <div
            class="winner-card w-full max-w-md rounded-[2rem] bg-surface-container p-8 text-center shadow-[0_30px_80px_rgba(0,0,0,0.55)] border border-white/10"
            role="dialog"
            aria-modal="true"
          >
            <p class="text-on-surface-variant uppercase font-black tracking-[0.3em] text-xs mb-3">
              We're eating at
            </p>
            <h3
              class="winner-name text-4xl font-black tracking-tight text-primary mb-6 break-words"
            >
              {{ selectedName }}
            </h3>
            <button
              type="button"
              class="pressurized-gradient-primary rounded-full px-8 py-4 text-white font-extrabold uppercase tracking-wide hover:brightness-110 transition-all"
              @click="closeWinnerModal"
            >
              Let's go
            </button>
          </div>
        </div>
      </transition>
    </teleport>

    <div
      class="fixed -top-24 -left-24 w-96 h-96 bg-primary opacity-5 blur-[120px] rounded-full pointer-events-none"
    />
    <div
      class="fixed top-1/2 -right-24 w-64 h-64 bg-secondary opacity-5 blur-[100px] rounded-full pointer-events-none"
    />
  </div>
</template>

<script setup lang="ts">
import ChatPanel, { isGifMessage } from '@/components/ChatPanel.vue'
import WinnerCelebration, { type CelebrationVariant } from '@/components/WinnerCelebration.vue'
import {
  addPlace,
  approvePlace,
  castVotes,
  deleteMessage,
  getForum,
  joinForum,
  kickVoter,
  leaveForum,
  lockForum,
  removePlace,
  sendMessage,
  spinForum,
  subscribeForum,
  updateConfig,
  type ForumConfig,
  type ForumState,
} from '@/utils/foodForum'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()

// Must match SPIN_DURATION_MS on the server (and the wheel's CSS transition).
const SPIN_DURATION_MS = 3000

const forumId = computed(() => String(route.params.forumId ?? ''))
const state = ref<ForumState | null>(null)
const notFound = ref(false)
const connectionLost = ref(false)
const busy = ref(false)
const copied = ref(false)
const errorMsg = ref('')
const now = ref(Date.now())

const adminToken = ref<string | null>(null)
const voterId = ref<string | null>(null)
const voterName = ref('')
const joinNameInput = ref('')
const newPlaceInput = ref('')
const timerInput = ref<number | null>(10)
const selectedPlaceIds = ref<Set<string>>(new Set())

// Wheel animation state (mirrors WheelPage).
const selectedName = ref('')
const showWinnerModal = ref(false)
const celebrationVariant = ref<CelebrationVariant>('confetti')
const rotation = ref(0)
const spinDuration = ref(0)
const lastSpinId = ref<string | null>(null)

let unsubscribe: (() => void) | null = null
let revealTimeoutId: number | null = null
let copyTimer: number | null = null
let tick: number | null = null
let bootstrapping = false
// Newest message we've already accounted for, so we only notify on genuinely new ones.
let lastNotifiedMessageId: string | null = null

const defaultPalette = [
  '#3e65ff',
  '#6d7eff',
  '#7d4dff',
  '#ff7f50',
  '#ffb347',
  '#00a896',
  '#2ec4b6',
  '#e71d36',
]
// Dativa brand colours (same set the shared wheel page offers).
const dativaPalette = ['#214E24', '#9BDA62', '#5F5FED', '#CCC5B9', '#14080E', '#F6F7EB']
const palette = computed(() => (state.value?.dativaColors ? dativaPalette : defaultPalette))

const places = computed(() => state.value?.places ?? [])
// Only approved places are votable / on the wheel; suggestions wait in pending.
const approvedPlaces = computed(() => places.value.filter((p) => p.approved))
const pendingPlaces = computed(() => places.value.filter((p) => !p.approved))
const voters = computed(() => state.value?.voters ?? [])
const messages = computed(() => state.value?.messages ?? [])
const isAdmin = computed(() => Boolean(adminToken.value))
const spinning = computed(() => state.value?.status === 'spinning')
const shareUrl = computed(() => `${window.location.origin}/food-forum/${forumId.value}`)

const hasJoined = computed(
  () => Boolean(voterId.value) && voters.value.some((v) => v.id === voterId.value),
)
const canVote = computed(() => hasJoined.value && state.value?.status === 'open')
const canSpin = computed(
  () =>
    approvedPlaces.value.length > 0 &&
    !spinning.value &&
    (isAdmin.value || state.value?.status === 'locked'),
)

const STATUS_LABELS: Record<string, string> = {
  open: 'Voting open',
  locked: 'Voting closed — spin to decide',
  spinning: 'Spinning…',
  decided: 'Decided',
}
const statusLabel = computed(() => STATUS_LABELS[state.value?.status ?? ''] ?? '')

const spinHint = computed(() => {
  if (state.value?.status === 'locked') return 'Time is up — anyone can spin now.'
  if (isAdmin.value) return 'You can spin any time to break a tie.'
  return 'The wheel unlocks for everyone when the timer ends.'
})

const remainingMs = computed(() =>
  state.value?.deadlineAt ? Math.max(0, state.value.deadlineAt - now.value) : null,
)
const countdown = computed(() => {
  const ms = remainingMs.value
  if (ms === null) return ''
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

function barWidth(votes: number): string {
  const max = Math.max(1, ...approvedPlaces.value.map((p) => p.votes))
  return `${(votes / max) * 100}%`
}

function isSelected(placeId: string): boolean {
  return selectedPlaceIds.value.has(placeId)
}

// --- Wheel rendering ---------------------------------------------------------
// The slices on the wheel reflect the live vote weights and must match what the
// server lands on. This mirrors forumWheelPool() in server/src/index.js exactly:
// 'weighted' = a slice per voted place sized by its votes (even split before any
// votes); 'tied' = only the top-voted places at equal size. Votes are frozen
// during a spin, so the layout the pointer lands in is stable.
function forumWheelPool(): { name: string; weight: number }[] {
  const ps = approvedPlaces.value
  if (ps.length === 0) return [{ name: 'Add places', weight: 1 }]
  const max = Math.max(...ps.map((p) => p.votes))
  if (state.value?.wheelMode === 'tied') {
    return ps.filter((p) => p.votes === max).map((p) => ({ name: p.name, weight: 1 }))
  }
  const hasVotes = max > 0
  return ps
    .filter((p) => (hasVotes ? p.votes > 0 : true))
    .map((p) => ({ name: p.name, weight: hasVotes ? p.votes : 1 }))
}

// Segments with cumulative start/end/mid angles (proportional to weight) and a
// colour. Reactive, so adding votes resizes the slices in real time.
const wheelSegments = computed(() => {
  const pool = forumWheelPool()
  const total = pool.reduce((sum, seg) => sum + seg.weight, 0) || 1
  const colors: string[] = []
  pool.forEach((_, index) => {
    const prev = colors[index - 1]
    const isLast = index === pool.length - 1
    let color = palette.value[index % palette.value.length]
    if (color === prev || (isLast && color === colors[0])) {
      color = palette.value.find((c) => c !== prev && (!isLast || c !== colors[0])) ?? color
    }
    colors.push(color)
  })
  let acc = 0
  return pool.map((seg, index) => {
    const start = (acc / total) * 360
    acc += seg.weight
    const end = (acc / total) * 360
    return { name: seg.name, color: colors[index], start, end, mid: (start + end) / 2 }
  })
})

const wheelStyle = computed(() => ({
  transform: `rotate(${rotation.value}deg)`,
  transitionDuration: `${spinDuration.value}ms`,
}))

const wheelLabels = computed(() => {
  const center = 176
  const innerRadius = 80
  return wheelSegments.value.map((segment, index) => {
    const radians = (segment.mid * Math.PI) / 180
    return {
      index,
      name: segment.name,
      rotation: segment.mid - 90,
      x: center + Math.sin(radians) * innerRadius,
      y: center - Math.cos(radians) * innerRadius,
    }
  })
})

function segmentStyle(index: number) {
  const { start, end, color } = wheelSegments.value[index]
  return {
    background: `conic-gradient(from 0deg, transparent ${start}deg, ${color} ${start}deg ${end}deg, transparent ${end}deg 360deg)`,
  }
}

function cancelPendingReveal() {
  if (revealTimeoutId !== null) {
    window.clearTimeout(revealTimeoutId)
    revealTimeoutId = null
  }
}

function scheduleWinnerReveal(name: string) {
  cancelPendingReveal()
  showWinnerModal.value = false
  selectedName.value = ''
  revealTimeoutId = window.setTimeout(() => {
    selectedName.value = name
    showWinnerModal.value = true
    revealTimeoutId = null
  }, SPIN_DURATION_MS)
}

function handleSpinState(next: ForumState) {
  if (next.status === 'spinning' && next.spin) {
    if (next.spin.id === lastSpinId.value) return
    lastSpinId.value = next.spin.id
    if (bootstrapping) {
      spinDuration.value = 0
      rotation.value = next.rotation
    } else {
      celebrationVariant.value = next.spin.celebration ?? 'confetti'
      spinDuration.value = SPIN_DURATION_MS
      rotation.value = next.rotation
      scheduleWinnerReveal(next.spin.winnerName)
    }
  } else {
    spinDuration.value = 0
    rotation.value = next.rotation
  }
}

function ensureNotifyPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {})
  }
}

// Pop a browser notification for messages from others that arrived while this
// tab was in the background. The first state after a (re)load just sets the
// baseline so we never replay the existing backlog.
function notifyNewMessages(next: ForumState) {
  const msgs = next.messages
  const latestId = msgs.length ? msgs[msgs.length - 1].id : null
  if (bootstrapping || lastNotifiedMessageId === null) {
    lastNotifiedMessageId = latestId
    return
  }
  if (latestId === lastNotifiedMessageId) return
  const idx = msgs.findIndex((m) => m.id === lastNotifiedMessageId)
  const fresh = idx === -1 ? msgs : msgs.slice(idx + 1)
  lastNotifiedMessageId = latestId
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (!document.hidden) return // they're looking — no need to nag
  for (const m of fresh) {
    if (m.name === voterName.value) continue // skip our own
    new Notification(`${m.name} · Friday Food Forum`, {
      body: isGifMessage(m.body) ? 'GIF' : m.body,
      tag: m.id,
    })
  }
}

function applyState(next: ForumState) {
  state.value = next
  connectionLost.value = false
  handleSpinState(next)
  notifyNewMessages(next)
}

// --- Actions -----------------------------------------------------------------
async function run(fn: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    await fn()
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Something went wrong'
  } finally {
    busy.value = false
  }
}

async function join() {
  const name = joinNameInput.value.trim()
  if (!name) return
  await run(async () => {
    const { voter } = await joinForum(forumId.value, name)
    voterId.value = voter.id
    voterName.value = voter.name
    localStorage.setItem(`forumVoter:${forumId.value}`, JSON.stringify(voter))
    joinNameInput.value = ''
    ensureNotifyPermission() // ask now, while we have the click gesture
  })
}

async function leave() {
  if (!voterId.value) return
  const id = voterId.value
  await run(async () => {
    await leaveForum(forumId.value, id)
    clearLocalVoter()
  })
}

function clearLocalVoter() {
  voterId.value = null
  voterName.value = ''
  selectedPlaceIds.value = new Set()
  localStorage.removeItem(`forumVoter:${forumId.value}`)
}

async function toggleVote(placeId: string) {
  if (!canVote.value || !voterId.value) return
  const next = new Set(selectedPlaceIds.value)
  if (state.value?.selectionMode === 'multi') {
    next.has(placeId) ? next.delete(placeId) : next.add(placeId)
  } else {
    next.clear()
    next.add(placeId)
  }
  selectedPlaceIds.value = next
  await run(() => castVotes(forumId.value, voterId.value!, [...next]))
}

async function spin() {
  if (!canSpin.value) return
  await run(() => spinForum(forumId.value, adminToken.value ?? undefined))
}

async function sendChat(body: string) {
  if (!voterId.value) return
  await run(() => sendMessage(forumId.value, voterId.value!, body))
}

async function deleteChat(messageId: string) {
  if (!adminToken.value) return
  await run(() => deleteMessage(forumId.value, messageId, adminToken.value!))
}

async function addPlaceFn() {
  const name = newPlaceInput.value.trim()
  if (!name) return
  // Sends the admin token if we have one; the server allows others when
  // suggestions are open.
  await run(async () => {
    await addPlace(forumId.value, name, adminToken.value ?? undefined)
    newPlaceInput.value = ''
  })
}

async function removePlaceFn(placeId: string) {
  if (!adminToken.value) return
  await run(() => removePlace(forumId.value, placeId, adminToken.value!))
}

async function approvePlaceFn(placeId: string) {
  if (!adminToken.value) return
  await run(() => approvePlace(forumId.value, placeId, adminToken.value!))
}

async function kick(id: string) {
  if (!adminToken.value) return
  await run(() => kickVoter(forumId.value, id, adminToken.value!))
}

async function setConfig(config: ForumConfig) {
  if (!adminToken.value) return
  await run(() => updateConfig(forumId.value, config, adminToken.value!))
}

async function startTimer() {
  const mins = Number(timerInput.value)
  if (!Number.isFinite(mins) || mins <= 0) return
  await setConfig({ deadlineMinutes: mins })
}

async function clearTimer() {
  await setConfig({ deadlineMinutes: null })
}

async function lock() {
  if (!adminToken.value) return
  await run(() => lockForum(forumId.value, adminToken.value!))
}

function closeWinnerModal() {
  showWinnerModal.value = false
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

async function load() {
  unsubscribe?.()
  unsubscribe = null
  cancelPendingReveal()
  notFound.value = false
  state.value = null
  lastSpinId.value = null
  selectedName.value = ''
  showWinnerModal.value = false

  const id = forumId.value
  if (!id) {
    notFound.value = true
    return
  }

  adminToken.value = localStorage.getItem(`forumAdmin:${id}`)
  const savedVoter = localStorage.getItem(`forumVoter:${id}`)
  if (savedVoter) {
    try {
      const v = JSON.parse(savedVoter) as { id: string; name: string }
      voterId.value = v.id
      voterName.value = v.name
    } catch {
      /* ignore corrupt entry */
    }
  }

  bootstrapping = true
  try {
    applyState(await getForum(id))
  } catch {
    notFound.value = true
    bootstrapping = false
    return
  }
  bootstrapping = false

  unsubscribe = subscribeForum(id, applyState, () => {
    connectionLost.value = true
  })
}

watch(forumId, load)
// When the admin tightens to single-select, the server collapses everyone's
// votes — mirror that locally so the highlight doesn't keep several lit up.
watch(
  () => state.value?.selectionMode,
  (mode) => {
    if (mode === 'single' && selectedPlaceIds.value.size > 1) {
      selectedPlaceIds.value = new Set([[...selectedPlaceIds.value][0]])
    }
  },
)
onMounted(() => {
  load()
  ensureNotifyPermission() // returning voters may already have granted it
  tick = window.setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  unsubscribe?.()
  cancelPendingReveal()
  if (copyTimer) window.clearTimeout(copyTimer)
  if (tick) window.clearInterval(tick)
})
</script>

<style scoped>
svg text {
  font-size: 1.1rem;
  font-weight: 900;
  letter-spacing: -0.01em;
  paint-order: stroke;
  stroke: rgb(0 0 0 / 45%);
  stroke-linejoin: round;
  stroke-width: 3px;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.25s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.winner-card {
  animation: winner-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes winner-pop {
  0% {
    opacity: 0;
    transform: scale(0.6);
  }

  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.winner-name {
  animation: winner-bounce 1.4s ease-in-out infinite;
}

@keyframes winner-bounce {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.08);
  }
}
</style>
