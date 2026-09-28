<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <WebCallout kind="warning" :title="title"><slot mdc-unwrap="p" /></WebCallout>
</template>
