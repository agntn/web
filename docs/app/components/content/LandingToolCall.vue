<script setup lang="ts">
import type { SearchSample } from "../../utils/landing-fixtures";
import { clip, plainText } from "../../utils/format";

const props = defineProps<{ sample: SearchSample }>();

const rows = computed(() => props.sample.results.slice(0, 2));
</script>

<template>
  <div class="web-frame overflow-hidden rounded-xl">
    <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
      <p class="font-mono text-xs text-muted">
        <span class="text-dimmed">tool</span>
        <span class="ms-2 text-highlighted">web_search</span>
      </p>
      <p class="font-mono text-[11px] text-dimmed">@agntn/web/ai · MCP · Pi · OMP</p>
    </div>
    <div class="divide-y divide-muted">
      <div class="px-4 py-4">
        <p class="web-eyebrow mb-3">input</p>
        <pre class="web-tool"><code>{
  <span class="tok-key">"query"</span>: <span class="tok-str">"<Transition name="web-roll" mode="out-in"><span :key="sample.query" class="web-roll-slot">{{ sample.query }}</span></Transition>"</span>,
  <span class="tok-key">"provider"</span>: <span class="tok-str">"<Transition name="web-roll" mode="out-in"><span :key="sample.provider" class="web-roll-slot">{{ sample.provider }}</span></Transition>"</span>,
  <span class="tok-key">"maxResults"</span>: <span class="tok-kw">2</span>
}</code></pre>
      </div>
      <div class="px-4 py-4">
        <p class="web-eyebrow mb-3">output</p>
        <pre :key="sample.query" class="web-tool web-derive"><code>{
  <span class="tok-key">"provider"</span>: <span class="tok-str">"{{ sample.provider }}"</span>,
  <span class="tok-key">"results"</span>: [<template v-for="(result, i) in rows" :key="result.url">
    {
      <span class="tok-key">"url"</span>: <span class="tok-str">"{{ clip(result.url, 54) }}"</span>,
      <span class="tok-key">"title"</span>: <span class="tok-str">"{{ clip(plainText(result.title), 44) }}"</span>,
      <span class="tok-key">"snippet"</span>: <span class="tok-str">"{{ clip(plainText(result.snippet), 44) }}"</span>
    }{{ i < rows.length - 1 ? "," : "" }}</template>
  ],
  <span class="tok-key">"ignoredFilters"</span>: [],
  <span class="tok-key">"pagination"</span>: { <span class="tok-key">"status"</span>: <span class="tok-str">"{{ sample.pagination }}"</span> }
}</code></pre>
      </div>
    </div>
  </div>
</template>
