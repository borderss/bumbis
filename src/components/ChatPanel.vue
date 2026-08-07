<template>
  <div>
    <div ref="chatScroll" class="space-y-3 max-h-72 overflow-y-auto mb-4 pr-1">
      <p v-if="messages.length === 0" class="text-outline-variant">No messages yet. Say hi 👋</p>
      <div
        v-for="m in messages"
        :key="m.id"
        class="bg-surface-container-high rounded-2xl px-4 py-3 flex items-start justify-between gap-2"
      >
        <div class="min-w-0">
          <p class="text-xs font-extrabold uppercase tracking-wide text-primary">
            {{ m.name }}
          </p>
          <img
            v-if="isGifMessage(m.body)"
            :src="m.body"
            alt="GIF"
            class="mt-1 max-h-48 rounded-xl"
            loading="lazy"
          />
          <p v-else class="text-on-surface break-words [overflow-wrap:anywhere]">
            {{ m.body }}
          </p>
        </div>
        <button
          v-if="canDelete"
          type="button"
          class="material-symbols-outlined text-base text-on-surface-variant hover:text-secondary transition-colors shrink-0"
          title="Delete message"
          :disabled="busy"
          @click="emit('delete', m.id)"
        >
          delete
        </button>
      </div>
    </div>
    <form class="relative" @submit.prevent="sendText">
      <!-- Discord-style GIF picker popover -->
      <div
        v-if="gifPickerOpen"
        class="absolute bottom-full left-0 right-0 mb-3 z-20 bg-surface-container-high rounded-2xl p-3 shadow-[0_20px_40px_rgba(0,0,0,0.45)] border border-white/10"
      >
        <div class="flex gap-2 mb-3">
          <button
            v-for="p in GIF_PROVIDERS"
            :key="p"
            type="button"
            class="flex-1 px-3 py-2 rounded-full text-xs font-extrabold uppercase tracking-wide transition-colors"
            :class="
              gifProvider === p
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'
            "
            @click="gifProvider = p"
          >
            {{ p }}
          </button>
        </div>
        <input
          v-model="gifQuery"
          class="w-full bg-surface-container-highest border-none rounded-full py-3 px-5 font-bold focus:ring-2 focus:ring-primary-dim outline-none placeholder:text-outline-variant text-on-surface mb-3"
          placeholder="Search GIFs"
          type="text"
          @keydown.enter.prevent
        />
        <p v-if="gifError" class="text-secondary text-sm font-bold px-2 py-4 text-center">
          {{ gifError }}
        </p>
        <p
          v-else-if="gifLoading"
          class="text-outline-variant text-sm font-bold px-2 py-4 text-center"
        >
          Loading…
        </p>
        <p
          v-else-if="gifResults.length === 0"
          class="text-outline-variant text-sm font-bold px-2 py-4 text-center"
        >
          No GIFs found
        </p>
        <div v-else class="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
          <button
            v-for="g in gifResults"
            :key="g.id"
            type="button"
            class="rounded-lg overflow-hidden hover:ring-2 hover:ring-primary transition-all"
            :disabled="busy"
            @click="sendGif(g.url)"
          >
            <img :src="g.preview" alt="" class="w-full h-24 object-cover" loading="lazy" />
          </button>
        </div>
      </div>
      <input
        v-model="chatInput"
        class="w-full bg-surface-container-high border-none rounded-full py-4 pl-6 pr-24 font-bold focus:ring-2 focus:ring-primary-dim outline-none placeholder:text-outline-variant text-on-surface disabled:opacity-50"
        :placeholder="canChat ? 'Message' : joinPlaceholder"
        type="text"
        :maxlength="MESSAGE_MAX_LEN"
        :disabled="!canChat"
      />
      <button
        type="button"
        class="absolute right-14 top-1/2 -translate-y-1/2 h-10 px-2 rounded-full flex items-center justify-center text-xs font-black tracking-wide transition-colors disabled:opacity-50"
        :class="gifPickerOpen ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'"
        title="Send a GIF"
        :disabled="!canChat"
        @click="toggleGifPicker"
      >
        GIF
      </button>
      <button
        type="submit"
        class="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-on-primary w-10 h-10 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
        :disabled="busy || !canChat || !chatInput.trim()"
      >
        <span class="material-symbols-outlined text-xl font-bold">send</span>
      </button>
    </form>
    <p class="text-right text-xs text-outline-variant mt-2">
      {{ chatInput.length }}/{{ MESSAGE_MAX_LEN }}
    </p>
  </div>
</template>

<script lang="ts">
export interface ChatMessage {
  id: string
  name: string
  body: string
}

// Must match the server-side body cap (FORUM_MESSAGE_MAX_LEN in server/src/db.js).
export const MESSAGE_MAX_LEN = 200

// A GIF message is just a bare URL from one of the providers' CDNs — pasted
// links render too, exactly like Discord.
const GIF_URL_RE =
  /^https:\/\/(media\.tenor\.com|media\d*\.giphy\.com|i\.giphy\.com|[\w.-]*klipy\.com)\/\S+$/i
export function isGifMessage(body: string): boolean {
  return GIF_URL_RE.test(body)
}
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[]
    canChat: boolean
    canDelete?: boolean
    busy?: boolean
    joinPlaceholder?: string
  }>(),
  { canDelete: false, busy: false, joinPlaceholder: 'Join to chat' },
)

const emit = defineEmits<{
  send: [body: string]
  delete: [messageId: string]
}>()

const chatInput = ref('')
const chatScroll = ref<HTMLElement | null>(null)

// Keep the chat pinned to the newest message.
watch(
  () => props.messages.length,
  () =>
    nextTick(() => {
      if (chatScroll.value) chatScroll.value.scrollTop = chatScroll.value.scrollHeight
    }),
)

function sendText() {
  const body = chatInput.value.trim()
  if (!body) return
  chatInput.value = ''
  emit('send', body)
}

// --- GIF picker (Discord-style) ------------------------------------------------
const GIF_PROVIDERS = ['giphy', 'klipy'] as const
const gifPickerOpen = ref(false)
const gifProvider = ref<(typeof GIF_PROVIDERS)[number]>('giphy')
const gifQuery = ref('')
const gifResults = ref<{ id: string; url: string; preview: string }[]>([])
const gifLoading = ref(false)
const gifError = ref('')
let gifDebounce: number | null = null

async function searchGifs() {
  gifLoading.value = true
  gifError.value = ''
  try {
    const res = await fetch(
      `/api/gifs?provider=${gifProvider.value}&q=${encodeURIComponent(gifQuery.value.trim())}`,
    )
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error || 'GIF search failed')
    gifResults.value = json.gifs
  } catch (err) {
    gifResults.value = []
    gifError.value = err instanceof Error ? err.message : 'GIF search failed'
  } finally {
    gifLoading.value = false
  }
}

function toggleGifPicker() {
  gifPickerOpen.value = !gifPickerOpen.value
  if (gifPickerOpen.value && gifResults.value.length === 0 && !gifError.value) searchGifs()
}

watch(gifQuery, () => {
  if (gifDebounce) window.clearTimeout(gifDebounce)
  gifDebounce = window.setTimeout(searchGifs, 350)
})
watch(gifProvider, searchGifs)

function sendGif(url: string) {
  gifPickerOpen.value = false
  emit('send', url)
}

onBeforeUnmount(() => {
  if (gifDebounce) window.clearTimeout(gifDebounce)
})
</script>
