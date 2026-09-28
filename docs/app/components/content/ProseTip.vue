<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <WebCallout kind="tip" :title="title"><slot mdc-unwrap="p" /></WebCallout>
</template>
