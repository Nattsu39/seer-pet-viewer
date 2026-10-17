<script setup lang="ts">
defineProps<{ reason: string }>();
</script>

<template>
  <p v-if="reason" role="status">{{ reason }}</p>
</template>
