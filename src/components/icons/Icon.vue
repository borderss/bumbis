<template>
  <svg xmlns="http://www.w3.org/2000/svg" :width="size" :height="size" viewBox="0 0 24 24">
    <path :fill="fill" :d="icons[name as keyof typeof icons] || 'M0 0h24v24H0z'" />
  </svg>
</template>

<script lang="ts">
import { mdiClock, mdiHome } from '@mdi/js'
import type { PropType } from 'vue'

const icons = {
  cheveronLeft: 'M15.41 16.58L10.83 12l4.58-4.59L14 6l-6 6l6 6z',
  cheveronRight: 'M8.59 16.58L13.17 12L8.59 7.41L10 6l6 6l-6 6z',
  mdiHome,
  mdiClock,
}

export default {
  name: 'Icon',
  props: {
    name: {
      type: String as PropType<keyof typeof icons>,
      required: true,
    },
    size: {
      type: String,
      default: '1em',
    },
    fill: {
      type: String,
      default: 'currentColor',
    },
  },
  setup() {
    return {
      icons,
    }
  },
}
</script>
