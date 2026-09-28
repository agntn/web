<script setup lang="ts">
import type { SearchSample } from "../../utils/landing-fixtures";
import { providerIcon, providerLabel } from "../../utils/providers";

const props = defineProps<{ sample: SearchSample }>();

/**
 * The recorded answer in the shape `web_search` puts in `content[0].text`, minus what the docs
 * worker never keeps: the continuation token and `undeclaredFilters`.
 */
const response = computed(() =>
  JSON.stringify({
    provider: props.sample.provider,
    results: props.sample.results,
    ignoredFilters: props.sample.ignoredFilters,
    pagination: { status: props.sample.pagination },
  }),
);
</script>

<template>
  <section class="tool-console landing-call" aria-label="One tool call">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="`web_search({ query: &quot;${sample.query}&quot;, provider: &quot;${sample.provider}&quot; })`">
        <span class="console-title" tabindex="0"
          ><span class="console-tag">Call</span>web_search(<span class="tok-str">"{{ sample.query }}"</span>)</span
        >
      </UTooltip>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="sample.query" class="console-cursor" />
    </div>

    <!-- The provider it asked on the crosses grid; the answer in the readout. -->
    <div class="call-subject">
      <div :key="sample.query" class="console-scan" aria-hidden="true" />
      <div class="call-identity">
        <ConsoleReticle :key="sample.query" :icon="providerIcon(sample.provider)" />
        <div class="call-name">
          <span class="console-label">Tool / read-only</span>
          <h3>{{ providerLabel(sample.provider) }}</h3>
          <p class="call-note">
            The model gets the normalized answer as JSON, with the provider diagnostics attached. No
            prose to parse.
          </p>
        </div>
      </div>
      <div class="console-readout">
        <dl :key="sample.query" class="console-readout-rows console-animate">
          <div>
            <dt>provider</dt>
            <dd><span class="call-line">"{{ sample.provider }}"</span></dd>
          </div>
          <div>
            <dt>results.length</dt>
            <dd class="console-accent">{{ sample.results.length }}</dd>
          </div>
          <div>
            <dt>pagination</dt>
            <dd><span class="call-line">{ status: "{{ sample.pagination }}" }</span></dd>
          </div>
        </dl>
      </div>
    </div>

    <ConsoleResponse
      :title="`web_search(&quot;${sample.query}&quot;)`"
      :text="response"
      source="recorded sample"
      description="The recorded answer as JSON, in the shape of content[0].text, without the continuation token."
    />

    <footer class="console-footer console-footer-plain">
      <span aria-label="Supported hosts: AI SDK, MCP, Pi and OMP">AI SDK · MCP · Pi · OMP</span>
      <span class="console-meta">web mcp · stdio</span>
    </footer>
  </section>
</template>

<style scoped>
.call-subject {
  position: relative;
  display: grid;
  gap: 16px;
  padding: 18px 20px 20px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Cpath d='M16 18h4m-2-2v4' fill='none' stroke='%23818a94' stroke-opacity='.1'/%3E%3C/svg%3E");
  background-size: 36px 36px;
  background-position: 24px 20px;
}
.call-subject > :not(.console-scan) {
  position: relative;
}
.call-identity {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
}
.call-name {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.call-name h3 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 22px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--ui-text-highlighted);
}
.call-note {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ui-text-muted);
}
.landing-call .console-readout-rows > div {
  grid-template-columns: 8.5rem minmax(0, 1fr);
}
.landing-call .console-readout-rows dt {
  text-transform: none;
  letter-spacing: 0.02em;
}
.call-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (width < 400px) {
  .call-subject {
    padding-inline: 14px;
  }
  .call-identity {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
  }
}
</style>
