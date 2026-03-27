<template>
  <main :style="backgroundColor">
    <component :is="layout">
      <router-view />
    </component>
  </main>
</template>

<script lang="ts">
import BlankLayout from '@/layouts/BlankLayout.vue'
import MainLayout from '@/layouts/MainLayout.vue'
import type { CSSProperties } from 'vue'

export default {
  name: 'App',
  components: {
    MainLayout,
    BlankLayout,
  },
  computed: {
    layout(): string {
      return (this.$route.meta.layout as string) || 'MainLayout'
    },
    backgroundColor(): CSSProperties {
      return {
        backgroundColor: (this.$route.meta.backgroundColor as string) ?? '#0e0e0e',
      }
    },
  },
}
</script>
