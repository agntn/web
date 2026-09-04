<script setup lang="ts">
import type { SearchSample } from "../../utils/landing-fixtures";
import { clip, dateOnly, hostOf, plainText } from "../../utils/format";
import { providerIcon, providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: SearchSample; tick: number }>();

defineEmits<{ step: [delta: number]; pause: [paused: boolean] }>();

const rows = computed(() => props.sample.results.slice(0, 4));
</script>

<template>
  <div class="web-frame overflow-hidden rounded-xl" @mouseenter="$emit('pause', true)" @mouseleave="$emit('pause', false)">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="min-w-0 truncate font-mono text-xs text-muted">
        <span class="text-dimmed">await</span>
        <span class="ms-2 text-highlighted">search(<span class="tok-str">"<Transition name="web-roll" mode="out-in"><span :key="sample.query" class="web-roll-slot">{{ sample.query }}</span></Transition>"</span>)</span>
      </p>
      <div class="flex shrink-0 items-center gap-1">
        <span class="web-state" :class="sample.live ? 'web-state-ok' : ''">{{ sample.live ? "live" : "sample" }}</span>
        <button type="button" class="web-copy" aria-label="Previous query" @click="$emit('step', -1)">
          <UIcon name="i-lucide-chevron-left" class="size-3.5" />
        </button>
        <button type="button" class="web-copy" aria-label="Next query" @click="$emit('step', 1)">
          <UIcon name="i-lucide-chevron-right" class="size-3.5" />
        </button>
      </div>
    </div>
    <div class="flex items-center gap-2 border-b border-muted px-4 py-2.5">
      <UIcon :name="providerIcon(sample.provider)" class="size-4 text-primary" />
      <span class="text-sm font-medium text-highlighted">{{ providerLabel(sample.provider) }}</span>
      <span class="font-mono text-[11px] text-dimmed">create("{{ sample.provider }}")</span>
      <span class="ms-auto font-mono text-[11px] text-dimmed">pagination · {{ sample.pagination }}</span>
    </div>
    <ol :key="sample.query" class="web-derive divide-y divide-muted">
      <li v-for="(result, i) in rows" :key="result.url" class="flex gap-3 px-4 py-3">
        <span class="mt-0.5 w-4 shrink-0 font-mono text-[11px] text-dimmed">{{ i + 1 }}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-highlighted">{{ plainText(result.title) }}</p>
          <p class="mt-0.5 truncate font-mono text-[11px] text-primary">{{ hostOf(result.url) }}</p>
          <p class="mt-1 text-[13px] leading-5 text-muted">{{ clip(plainText(result.snippet), 150) }}</p>
          <p v-if="result.publishedDate || typeof result.score === 'number'" class="mt-1 font-mono text-[11px] text-dimmed">
            <span v-if="result.publishedDate">published {{ dateOnly(result.publishedDate) }}</span>
            <span v-if="result.publishedDate && typeof result.score === 'number'" class="mx-1">·</span>
            <span v-if="typeof result.score === 'number'">score {{ result.score.toFixed(3) }}</span>
          </p>
        </div>
      </li>
    </ol>
    <div class="border-t border-muted px-4 py-3">
      <p class="font-mono text-[11px] text-dimmed">
        <span class="text-highlighted">{{ sample.results.length }}</span> results, same <span class="text-highlighted">{ url, title, snippet }</span> from every provider
      </p>
    </div>
  </div>
</template>
