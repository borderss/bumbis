<template>
  <div class="container">
    <slot />
  </div>
</template>

<script lang="ts">
export default {
  name: 'BlankLayout',
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
  min-height: 100vh;
  margin: 0 auto;
}
</style>
