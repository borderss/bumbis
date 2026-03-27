<template>
  <div class="container">
    <PageHeader />
    <router-view />
    <PageFooter />
  </div>
</template>

<script lang="ts">
import PageFooter from '@/components/PageFooter.vue'
import PageHeader from '@/components/PageHeader.vue'

export default {
  name: 'MainLayout',
  components: {
    PageHeader,
    PageFooter,
  },
}
</script>

<style scoped>
.container {
  position: relative;
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: flex-start;
  width: 100%;
  max-width: 1920px;
  margin: 0 auto;

  & > div {
    width: 100%;
    padding-inline: 120px;
  }
}

@media (width <= 1200px) {
  .container {
    & > div {
      padding-inline: 60px;
    }
  }
}

@media (width <= 576px) {
  .container {
    & > div {
      padding-inline: 20px;
    }
  }
}
</style>
