<template>
  <div class="min-h-screen flex flex-col bg-surface text-on-surface">
    <!-- TopAppBar -->
    <header class="flex items-center justify-center w-full px-8 py-6 top-0 z-50">
      <div
        class="font-black tracking-[-0.02em] uppercase text-4xl text-primary text-center"
        style="font-family: 'Plus Jakarta Sans', sans-serif"
      >
        BUMBIS
      </div>
    </header>

    <main class="flex-grow container mx-auto px-6 py-12 max-w-4xl pb-40">
      <!-- Error Banner -->
      <transition name="fade">
        <div
          v-if="showError"
          class="mb-12 bg-secondary-container text-on-secondary-container p-8 rounded-xl flex items-center justify-between shadow-[0_20px_40px_rgba(0,0,0,0.4)]"
        >
          <div class="flex items-center gap-6">
            <span
              class="material-symbols-outlined text-5xl"
              style="font-variation-settings: 'FILL' 1"
              >error</span
            >
            <span
              class="text-3xl font-black tracking-tighter uppercase"
              style="font-family: 'Plus Jakarta Sans', sans-serif"
              >WHOOPS! WE NEED ANOTHER BALLER!</span
            >
          </div>
          <span
            class="material-symbols-outlined text-3xl cursor-pointer hover:text-on-secondary transition-colors"
            @click="showError = false"
            >close</span
          >
        </div>
      </transition>

      <section class="grid grid-cols-1 gap-16">
        <!-- Input and List Section -->
        <div class="space-y-12">
          <form class="relative" @submit.prevent="addPerson">
            <input
              v-model="newName"
              class="w-full bg-surface-container-high border-none rounded-full py-8 px-10 text-2xl font-bold focus:ring-2 focus:ring-primary-dim transition-all outline-none placeholder:text-outline-variant text-on-surface"
              placeholder="Add a baller"
              type="text"
            />
            <button
              type="submit"
              class="absolute right-4 top-1/2 -translate-y-1/2 bg-primary text-on-primary w-16 h-16 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
            >
              <span class="material-symbols-outlined text-3xl font-bold">add</span>
            </button>
          </form>

          <div class="space-y-4 px-2">
            <h2
              class="text-on-surface-variant uppercase font-black tracking-widest text-sm px-4"
              style="font-family: 'Plus Jakarta Sans', sans-serif"
            >
              Default Ballers
            </h2>
            <div class="flex flex-wrap gap-3 px-2">
              <button
                v-for="name in availableDefaultBallers"
                :key="name"
                type="button"
                class="bg-surface-container-low px-6 py-3 rounded-full text-xl font-extrabold tracking-tight hover:bg-surface-container-high transition-colors"
                @click="addDefaultPerson(name)"
              >
                {{ name }}
              </button>
            </div>
          </div>

          <div class="space-y-4">
            <h2
              :class="[
                roster.length > 0
                  ? 'bg-gradient-to-r from-yellow-300 via-amber-400 to-yellow-500 bg-clip-text text-transparent'
                  : 'text-on-surface-variant',
                'uppercase font-black tracking-widest text-sm px-4',
              ]"
              style="font-family: 'Plus Jakarta Sans', sans-serif"
            >
              Current Roster
            </h2>
            <div v-if="roster.length === 0" class="px-4 text-outline-variant text-lg font-medium">
              No players yet. Add some names above!
            </div>
            <div v-else class="flex flex-wrap gap-4">
              <div
                v-for="name in roster"
                :key="name"
                class="bg-surface-container-low px-8 py-4 rounded-full flex items-center gap-4 group hover:bg-surface-container-highest transition-colors"
              >
                <span class="text-xl font-extrabold tracking-tight">{{ name.toUpperCase() }}</span>
                <span
                  class="material-symbols-outlined text-on-surface-variant cursor-pointer hover:text-secondary transition-colors"
                  @click="removePerson(name)"
                  >cancel</span
                >
              </div>
            </div>
          </div>
        </div>

        <!-- Pairs Output Section -->
        <div v-if="pairs.length > 0 || soloPerson" class="space-y-8">
          <div class="flex items-center justify-between px-4">
            <h2
              class="text-3xl font-black tracking-tighter uppercase"
              style="font-family: 'Plus Jakarta Sans', sans-serif"
            >
              Generated Pairs
            </h2>
            <span class="text-primary font-bold">{{ groupCountLabel }}</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Pair Cards -->
            <div
              v-for="(pair, index) in pairs"
              :key="index"
              :class="[
                index === highlightedPairIndex ? 'bg-green-600' : 'bg-surface-container-low',
                'p-8 rounded-xl flex items-center justify-between hover:scale-[1.02] transition-transform shadow-lg',
              ]"
            >
              <div class="flex-1 text-center">
                <p
                  :class="[
                    index === highlightedPairIndex ? 'text-white' : 'text-primary',
                    'text-2xl font-black tracking-tight',
                  ]"
                  style="font-family: 'Plus Jakarta Sans', sans-serif"
                >
                  {{ pair[0].toUpperCase() }}
                </p>
              </div>
              <div class="px-6">
                <span
                  :class="[
                    index === highlightedPairIndex ? 'text-white' : 'text-outline-variant',
                    'material-symbols-outlined text-4xl',
                  ]"
                  >link</span
                >
              </div>
              <div class="flex-1 text-center">
                <p
                  :class="[
                    index === highlightedPairIndex ? 'text-white' : 'text-primary',
                    'text-2xl font-black tracking-tight',
                  ]"
                  style="font-family: 'Plus Jakarta Sans', sans-serif"
                >
                  {{ pair[1].toUpperCase() }}
                </p>
              </div>
            </div>
            <!-- Solo Card (Odd Number) -->
            <div
              v-if="soloPerson"
              class="bg-surface-container-highest p-8 rounded-xl flex items-center justify-between border-2 border-secondary border-dashed opacity-80 md:col-span-2"
            >
              <div class="flex-1 text-center">
                <p
                  class="text-2xl font-black text-secondary tracking-tight"
                  style="font-family: 'Plus Jakarta Sans', sans-serif"
                >
                  {{ soloPerson.toUpperCase() }}
                </p>
              </div>
              <div class="px-6">
                <span class="material-symbols-outlined text-secondary text-4xl">block</span>
              </div>
              <div class="flex-1 text-center">
                <p
                  class="text-lg font-bold text-on-surface-variant uppercase tracking-widest italic"
                  style="font-family: 'Plus Jakarta Sans', sans-serif"
                >
                  Waiting for Pair...
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Bottom Action Button -->
    <div class="fixed bottom-0 left-0 w-full z-50 flex justify-center pb-10 px-6">
      <div class="fixed bottom-8 px-6 w-full max-w-md">
        <button
          class="flex items-center justify-center pressurized-gradient-primary rounded-full py-5 w-full shadow-[0_20px_40px_rgba(0,0,0,0.4)] hover:brightness-110 hover:scale-[1.02] transition-all active:scale-95 duration-150"
          @click="generatePairs"
        >
          <span
            class="material-symbols-outlined mr-3 text-3xl text-white"
            style="font-variation-settings: 'FILL' 1"
            >groups</span
          >
          <span
            class="font-extrabold text-lg tracking-tight uppercase text-white"
            style="font-family: 'Plus Jakarta Sans', sans-serif"
            >Split into Pairs</span
          >
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

<script lang="ts">
import { defineComponent, ref, computed } from 'vue'

export default defineComponent({
  name: 'HomePage',
  setup() {
    const defaultBallers = ['Mārcis', 'Linda', 'Emīls', 'Dmitrijs', 'Jēkabs', 'Alberts', 'Eduards']
    const roster = ref<string[]>([])
    const newName = ref('')
    const pairs = ref<[string, string][]>([])
    const soloPerson = ref<string | null>(null)
    const highlightedPairIndex = ref<number | null>(null)
    const showError = ref(false)

    const availableDefaultBallers = computed(() =>
      defaultBallers.filter((name) => !roster.value.includes(name)),
    )

    const groupCountLabel = computed(() => {
      const total = pairs.value.length + (soloPerson.value ? 1 : 0)
      return `${total} Group${total !== 1 ? 's' : ''} Found`
    })

    function addPerson() {
      const trimmed = newName.value.trim()
      if (!trimmed) return
      if (roster.value.includes(trimmed)) return
      roster.value.push(trimmed)
      newName.value = ''
    }

    function addDefaultPerson(name: string) {
      if (roster.value.includes(name)) return
      roster.value.push(name)
    }

    function removePerson(name: string) {
      roster.value = roster.value.filter((n) => n !== name)
    }

    function shuffle<T>(arr: T[]): T[] {
      const copy = [...arr]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy
    }

    function generatePairs() {
      if (roster.value.length === 0) return
      const shuffled = shuffle(roster.value)
      const newPairs: [string, string][] = []
      let solo: string | null = null

      for (let i = 0; i + 1 < shuffled.length; i += 2) {
        newPairs.push([shuffled[i], shuffled[i + 1]])
      }
      if (shuffled.length % 2 !== 0) {
        solo = shuffled[shuffled.length - 1]
      }

      pairs.value = newPairs
      soloPerson.value = solo
      highlightedPairIndex.value =
        solo === null && newPairs.length > 0 ? Math.floor(Math.random() * newPairs.length) : null
      showError.value = solo !== null
    }

    return {
      roster,
      newName,
      pairs,
      soloPerson,
      highlightedPairIndex,
      showError,
      availableDefaultBallers,
      groupCountLabel,
      addPerson,
      addDefaultPerson,
      removePerson,
      generatePairs,
    }
  },
})
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
