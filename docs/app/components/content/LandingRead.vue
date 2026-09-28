<script setup lang="ts">
import type { SearchSample } from "../../utils/landing-fixtures";
import { hostOf, hostPath } from "../../utils/format";
import { providerIcon, providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: SearchSample }>();

const read = computed(() => props.sample.read);
const chain = computed(() => (read.value.attempts.length ? read.value.attempts : [read.value.provider]));

/** Five lines of the page, each cut to one line, so the panel keeps its height; the dialog has the rest. */
const excerpt = computed(() => {
  const lines = read.value.content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  return [...lines.slice(0, 5), ...Array.from({ length: Math.max(0, 5 - lines.length) }, () => "")];
});
</script>

<template>
  <section class="tool-console landing-read" aria-label="One page read">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="`readUrl(&quot;${read.url}&quot;, { maxChars: 900 })`">
        <span class="console-title" tabindex="0"
          ><span class="console-tag">Call</span>readUrl(<span class="tok-str">"{{ hostOf(read.url) }}…"</span>)</span
        >
      </UTooltip>
      <span class="console-meta">{{ sample.live ? "live" : "recorded" }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="read.url" class="console-cursor" />
    </div>

    <div class="read-subject">
      <div :key="read.url" class="console-scan" aria-hidden="true" />
      <ConsoleReticle :key="read.url" :icon="providerIcon(read.provider)" />
      <div class="read-name">
        <span class="console-label"
          >Page / <span class="console-label-key">{{ providerLabel(read.provider) }}</span></span
        >
        <!-- The page's own title: interpolated, never markup. -->
        <UTooltip :text="read.title || read.url">
          <h3 tabindex="0">{{ read.title || hostOf(read.url) }}</h3>
        </UTooltip>
        <p class="read-about">{{ hostPath(read.url) }}</p>
      </div>
    </div>

    <div class="web-band read-band">
      <!-- Page text: interpolated into a pre, one line each, never rendered as markup. -->
      <pre class="console-snippet read-lines"><code><span v-for="(line, index) in excerpt" :key="index">{{ line || "&#160;" }}</span></code></pre>
    </div>

    <ConsoleResponse
      :title="`readUrl(&quot;${read.url}&quot;)`"
      :text="read.content"
      label="Full page"
      source="content"
      description="The page as the reader returned it, cut at the bound."
    />

    <footer class="console-footer console-footer-plain">
      <span class="read-foot"
        >{{ [...read.content].length }} of 900 code points{{ read.truncated ? ", continuation issued" : "" }}</span
      >
      <UTooltip :text="chain.map(providerLabel).join(' → ')">
        <span class="console-meta read-chain" tabindex="0"
          ><template v-for="(name, index) in chain" :key="name"
            ><template v-if="index > 0"> → </template
            ><span :class="{ 'read-failed': name !== read.provider }">{{ name }}</span></template
          ></span
        >
      </UTooltip>
    </footer>
  </section>
</template>

<style scoped>
.read-subject {
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
.read-subject > :not(.console-scan) {
  position: relative;
}
.read-name {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.read-name h3 {
  margin: 0;
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 20px;
  font-weight: 500;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
.read-about {
  margin: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-muted);
}
.read-band {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  border-top: 1px solid var(--console-line);
}
.landing-read > .console-footer {
  flex-wrap: nowrap;
}
.read-foot,
.read-chain {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.read-failed {
  color: var(--web-del);
}
.read-lines > code > span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  color: var(--ui-text-muted);
}
@media (width < 400px) {
  .read-subject {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
    padding-inline: 14px;
  }
}
</style>
