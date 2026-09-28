<script setup lang="ts">
import type { SearchSample } from "../../utils/landing-fixtures";
import { hostOf, plainText } from "../../utils/format";
import { providerIcon, providerInfo, providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: SearchSample }>();

const emit = defineEmits<{ step: [delta: number]; pause: [paused: boolean] }>();

/** Always four rows: a provider that answers with fewer must not shrink the panel. */
const slots = computed(() => {
  const rows = props.sample.results.slice(0, 4);
  return [...rows, ...Array.from({ length: 4 - rows.length }, () => null)];
});

const PAGINATION: Record<string, string> = {
  next: "next page through a continuation token",
  end: "the provider has nothing further",
  unknown: "a continuation, whether more exists is unknown",
  unsupported: "one page, the provider has no paging",
};
</script>

<template>
  <section
    class="tool-console landing-results"
    aria-label="One search"
    @mouseenter="emit('pause', true)"
    @mouseleave="emit('pause', false)"
    @focusin="emit('pause', true)"
    @focusout="emit('pause', false)"
  >
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="`search(&quot;${sample.query}&quot;, { maxResults: 5 })`">
        <span class="console-title" tabindex="0"
          ><span class="console-tag">Call</span>search(<span class="tok-str">"{{ sample.query }}"</span>)</span
        >
      </UTooltip>
      <span class="console-meta">{{ sample.live ? "live" : "recorded" }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.query" class="console-cursor" />
    </div>

    <div class="results-subject">
      <div :key="sample.query" class="console-scan" aria-hidden="true" />
      <ConsoleReticle :key="sample.query" :icon="providerIcon(sample.provider)" />
      <div class="results-name">
        <span class="console-label"
          >Provider / <span class="console-label-key">create("{{ sample.provider }}")</span></span
        >
        <h3>{{ providerLabel(sample.provider) }}</h3>
        <p class="results-about">
          {{ sample.results.length }} results,
          {{ PAGINATION[sample.pagination] ?? sample.pagination }}.
        </p>
      </div>
    </div>

    <!-- Four rows whatever the sample, so the panel keeps one height. -->
    <ol :key="sample.query" class="web-rows results-rows console-animate">
      <li
        v-for="(result, index) in slots"
        :key="result?.url ?? `empty-${index}`"
        :style="{ animationDelay: `${index * 45}ms` }"
      >
        <template v-if="result">
          <span class="web-dim">{{ String(index + 1).padStart(2, "0") }}</span>
          <UTooltip :text="plainText(result.title) || result.url">
            <span class="results-title" tabindex="0">{{ plainText(result.title) || result.url }}</span>
          </UTooltip>
          <span class="results-host">{{ hostOf(result.url) }}</span>
        </template>
        <span v-else class="results-empty" aria-hidden="true">&#160;</span>
      </li>
    </ol>

    <footer class="console-footer console-footer-plain">
      <span class="results-foot"
        >{ url, title, snippet } from {{ providerInfo(sample.provider)?.host ?? sample.provider }}</span
      >
      <div class="console-controls" aria-label="Sample queries">
        <UButton
          color="neutral"
          variant="subtle"
          square
          icon="i-lucide-chevron-left"
          aria-label="Previous query"
          @click="emit('step', -1)"
        />
        <span>Query</span>
        <UButton
          color="neutral"
          variant="subtle"
          square
          icon="i-lucide-chevron-right"
          aria-label="Next query"
          @click="emit('step', 1)"
        />
      </div>
    </footer>
  </section>
</template>

<style scoped>
.results-subject {
  position: relative;
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
  padding: 18px 20px 20px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Cpath d='M16 18h4m-2-2v4' fill='none' stroke='%23818a94' stroke-opacity='.1'/%3E%3C/svg%3E");
  background-size: 36px 36px;
  background-position: 24px 20px;
}
.results-subject > :not(.console-scan) {
  position: relative;
}
.results-name {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.results-name h3 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 22px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--ui-text-highlighted);
}
.results-about {
  margin: 0;
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-muted);
}
.results-rows {
  border-top: 1px solid var(--console-line);
}
.results-rows > li {
  grid-template-columns: 1.5rem minmax(0, 1fr) auto;
}
.results-title {
  display: block;
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.results-host {
  max-width: 11rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-dimmed);
}
.results-empty {
  grid-column: 1 / -1;
  font-size: 14px;
}
.landing-results > .console-footer {
  flex-wrap: nowrap;
}
.results-foot {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (width < 400px) {
  .results-subject {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
    padding-inline: 14px;
  }
  .results-host {
    display: none;
  }
  .results-rows > li {
    grid-template-columns: 1.5rem minmax(0, 1fr);
  }
}
</style>
