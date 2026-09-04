<script setup lang="ts">
import type { SearchSample } from "../../utils/landing-fixtures";
import { clip, hostPath, plainText } from "../../utils/format";
import { providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: SearchSample }>();

const asked = computed(() => [
  ...props.sample.fanout.successfulProviders.map((provider) => ({ provider, ok: true, message: "" })),
  ...props.sample.fanout.errors.map((entry) => ({ provider: entry.provider, ok: false, message: entry.message })),
]);

const rows = computed(() => props.sample.fanout.results.slice(0, 5));
const shared = computed(() => props.sample.fanout.results.filter((result) => result.providers.length > 1).length);
</script>

<template>
  <div class="web-frame overflow-hidden rounded-xl">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="min-w-0 truncate font-mono text-xs text-muted">
        <span class="text-dimmed">await</span>
        <span class="ms-2 text-highlighted">searchAllDetailed(<span class="tok-str">"<Transition name="web-roll" mode="out-in"><span :key="sample.query" class="web-roll-slot">{{ sample.query }}</span></Transition>"</span>)</span>
      </p>
      <span class="web-state shrink-0" :class="sample.live ? 'web-state-ok' : ''">{{ sample.live ? "live" : "sample" }}</span>
    </div>
    <div class="flex flex-wrap items-center gap-1.5 border-b border-muted px-4 py-2.5">
      <span v-for="entry in asked" :key="entry.provider" class="web-chip" :class="entry.ok ? 'web-chip-ok' : 'web-chip-failed'" :title="entry.message">
        <span class="web-chip-dot" />
        {{ providerLabel(entry.provider) }}
      </span>
    </div>
    <ol :key="sample.query" class="web-derive divide-y divide-muted">
      <li v-for="result in rows" :key="result.url" class="px-4 py-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-highlighted">{{ plainText(result.title) }}</p>
            <p class="mt-0.5 truncate font-mono text-[11px] text-primary">{{ clip(hostPath(result.url), 60) }}</p>
          </div>
          <div class="flex shrink-0 flex-wrap justify-end gap-1">
            <span v-for="provider in result.providers" :key="provider" class="web-chip web-chip-small">{{ providerLabel(provider) }}</span>
          </div>
        </div>
      </li>
    </ol>
    <div class="border-t border-muted px-4 py-3">
      <p class="font-mono text-[11px] text-dimmed">
        <span class="text-highlighted">{{ sample.fanout.total }}</span> unique URLs
        <span class="mx-1">·</span>
        <span class="text-highlighted">{{ shared }}</span> returned by more than one provider
        <span class="mx-1">·</span>
        <span class="text-highlighted">{{ sample.fanout.errors.length }}</span> {{ sample.fanout.errors.length === 1 ? "failure" : "failures" }} kept in <span class="text-highlighted">errors</span>
      </p>
    </div>
  </div>
</template>
