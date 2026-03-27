<template>
  <div class="navbar">Navbar</div>
</template>

<script lang="ts">
export default {
  name: 'PageHeader',
}
</script>

<style scoped>
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 50px;
  background-color: var(--light-gray);
}
</style>
