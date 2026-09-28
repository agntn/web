<script setup lang="ts">
import type { SearchSample } from "../../utils/landing-fixtures";

const props = defineProps<{ sample: SearchSample }>();

const fanout = computed(() => props.sample.fanout);
const asked = computed(() => [...fanout.value.successfulProviders, ...fanout.value.errors.map((entry) => entry.provider)]);
const shared = computed(() => fanout.value.results.filter((result) => result.providers.length > 1).length);
</script>

<template>
  <section class="tool-console landing-fanout" aria-label="One fan-out">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="`searchAllDetailed(&quot;${sample.query}&quot;)`">
        <span class="console-title" tabindex="0"
          ><span class="console-tag">Call</span>searchAll(<span class="tok-str">"{{ sample.query }}"</span>)</span
        >
      </UTooltip>
      <span class="console-meta">{{ sample.live ? "live" : "recorded" }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.query" class="console-cursor" />
    </div>

    <div class="web-band">
      <p class="console-label console-rule-title">
        <span>Asked <span aria-hidden="true">[ answered · failed · not asked ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <ProviderCells :asked="asked" :successful="fanout.successfulProviders" :errors="fanout.errors" />
    </div>

    <footer class="console-footer console-footer-plain">
      <span class="fanout-foot"
        ><span class="console-accent">{{ fanout.total }}</span> unique URLs, {{ shared }} returned by more
        than one</span
      >
      <span class="console-meta">{{ fanout.successfulProviders.length }} of {{ asked.length }} answered</span>
    </footer>
  </section>
</template>

<style scoped>
.landing-fanout > .console-footer {
  flex-wrap: nowrap;
}
.landing-fanout > .console-footer > .console-meta {
  flex: none;
}
.fanout-foot {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
