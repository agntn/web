<script setup lang="ts">
import { providerInfo } from "../../utils/providers";

const props = defineProps<{ provider: string }>();

const info = computed(() => providerInfo(props.provider));

const facts = computed(() => {
  const provider = info.value;
  if (!provider) {
    return [];
  }
  const operations = [provider.search ? "search" : "", provider.searchImage ? "image" : "", provider.read ? "read" : ""]
    .filter(Boolean)
    .join(" · ");
  return [
    { label: "env var", value: provider.envVar ?? "none", mono: true },
    { label: "auth", value: provider.auth, mono: false },
    { label: "operations", value: operations, mono: true },
    { label: "results", value: provider.resultLimit, mono: false },
  ];
});
</script>

<template>
  <dl class="web-frame not-prose my-6 grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-4">
    <div
      v-for="(fact, index) in facts"
      :key="fact.label"
      class="border-muted px-4 py-3.5"
      :class="{ 'border-t sm:border-t-0': index >= 2, 'border-l': index % 2 === 1, 'sm:border-l': index > 0 }"
    >
      <dt class="font-mono text-[10px] tracking-[0.12em] text-dimmed uppercase">{{ fact.label }}</dt>
      <dd class="mt-1 text-sm text-highlighted" :class="{ 'font-mono text-[13px]': fact.mono }">{{ fact.value }}</dd>
    </div>
  </dl>
</template>
