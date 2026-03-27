<template>
  <div class="container">
    <h1>
      <Icon name="cheveronLeft" color="var(--light-gray)" />
      Home Page
      <Icon name="cheveronRight" color="var(--light-gray)" />
    </h1>
    <p>This is the home page.</p>
    <Icon name="mdiHome" size="50px" color="red" />
  </div>
</template>

<script lang="ts">
import Icon from '@/components/icons/Icon.vue'

export default {
  name: 'HomeView',
  components: {
    Icon,
  },
}
</script>

<style scoped>
.container {
  width: 100%;
  padding-block: 60px;

  & > * {
    display: flex;
    align-items: center;
    justify-content: center;
  }
}
</style>
