<script setup lang="ts">
import type { SearchSample } from "../../utils/landing-fixtures";
import { clip, hostOf } from "../../utils/format";
import { providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: SearchSample }>();

const read = computed(() => props.sample.read);
const excerpt = computed(() => clip(read.value.content.replace(/\n{3,}/gu, "\n\n").trim(), 520));
const chain = computed(() => read.value.attempts.length ? read.value.attempts : [read.value.provider]);
</script>

<template>
  <div class="web-frame overflow-hidden rounded-xl">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="min-w-0 truncate font-mono text-xs text-muted">
        <span class="text-dimmed">await</span>
        <span class="ms-2 text-highlighted">readUrl(<span class="tok-str">"<Transition name="web-roll" mode="out-in"><span :key="read.url" class="web-roll-slot">{{ hostOf(read.url) }}…</span></Transition>"</span>, { maxChars: <span class="tok-kw">900</span> })</span>
      </p>
      <span class="web-state shrink-0" :class="sample.live ? 'web-state-ok' : ''">{{ sample.live ? "live" : "sample" }}</span>
    </div>
    <div class="flex flex-wrap items-center gap-2 border-b border-muted px-4 py-2.5 font-mono text-[11px] text-dimmed">
      <span>readers</span>
      <template v-for="(provider, i) in chain" :key="provider">
        <span v-if="i > 0" class="text-dimmed">→</span>
        <span class="web-chip" :class="provider === read.provider ? 'web-chip-ok' : 'web-chip-failed'">
          <span class="web-chip-dot" />
          {{ providerLabel(provider) }}
        </span>
      </template>
      <span class="ms-auto">requested · {{ read.requestedProvider }}</span>
    </div>
    <div :key="read.url" class="web-derive">
      <div class="px-4 pt-3">
        <p class="truncate text-sm font-medium text-highlighted">{{ read.title || hostOf(read.url) }}</p>
        <p class="mt-0.5 truncate font-mono text-[11px] text-primary">{{ read.url }}</p>
      </div>
      <pre class="web-body web-body-short">{{ excerpt }}</pre>
    </div>
    <div class="border-t border-muted px-4 py-3">
      <p class="font-mono text-[11px] text-dimmed">
        <span class="text-highlighted">{{ [...read.content].length }}</span> code points
        <span class="mx-1">·</span>
        truncated <span class="text-highlighted">{{ read.truncated }}</span>
        <span v-if="read.truncated" class="ms-1">, continuation token issued</span>
      </p>
    </div>
  </div>
</template>
