<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <WebCallout kind="note" :title="title"><slot mdc-unwrap="p" /></WebCallout>
</template>
