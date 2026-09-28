<script setup lang="ts">
import { DEFAULT_FIELDS, explorerQuery } from "../../utils/explorer";
import { PROVIDERS, providerInfo } from "../../utils/providers";

const props = defineProps<{ provider: string }>();

const info = computed(() => providerInfo(props.provider));
const position = computed(() => PROVIDERS.findIndex((entry) => entry.key === props.provider) + 1);

/** The three capabilities in their fixed order, each a link into the explorer when the provider has it. */
const capabilities = computed(() => {
  const provider = info.value;
  if (!provider) return [];
  return [
    {
      label: "Search",
      method: "search()",
      on: provider.search,
      to: { path: "/explorer", query: explorerQuery({ ...DEFAULT_FIELDS, operation: "search", provider: provider.key }) },
    },
    { label: "Image", method: "searchByImage()", on: provider.searchImage, to: "/guide/image" },
    {
      label: "Read",
      method: "read()",
      on: provider.read,
      to: { path: "/explorer", query: explorerQuery({ ...DEFAULT_FIELDS, operation: "read", reader: provider.key }) },
    },
  ];
});

/** What the provider honours and fills, one lead each; empty lists read as `none`. */
const leads = computed(() => {
  const provider = info.value;
  if (!provider) return [];
  return [
    { tag: "Filters", text: provider.filters.join(", ") || "none" },
    { tag: "Fields", text: provider.resultFields.join(", ") || "url, title, snippet only" },
    ...(provider.categories.length ? [{ tag: "Category", text: provider.categories.join(", ") }] : []),
    ...(provider.read ? [{ tag: "Read", text: `${provider.readFormats.join(", ")} · ${provider.readOptions.join(", ")}` }] : []),
  ];
});
</script>

<template>
  <section v-if="info" class="tool-console console-wide not-prose my-6" aria-label="Provider record">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <span class="console-title"
        ><span class="console-tag">ID</span>{{ info.key
        }}<span v-if="position > 0" class="console-file"
          >{{ String(position).padStart(2, "0") }} / {{ PROVIDERS.length }}</span
        ></span
      >
      <span class="console-meta">{{ info.host }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true"><span class="console-cursor" /></div>

    <div class="console-band console-subject-band">
      <div class="console-scan" aria-hidden="true" />
      <div class="console-identity-block">
        <ConsoleReticle :key="info.key" :icon="info.icon" />
        <div class="console-name">
          <span class="console-label">Provider</span>
          <h3>{{ info.label }}</h3>
          <ul class="facts-aliases" aria-label="Identifiers">
            <li><span class="facts-alias">create("{{ info.key }}")</span></li>
            <li><span class="facts-alias">{{ info.envVar ?? "no env var" }}</span></li>
          </ul>
        </div>
      </div>

      <div class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl class="console-readout-rows">
          <div>
            <dt>Auth</dt>
            <dd>{{ info.auth }}</dd>
          </div>
          <div>
            <dt>Results</dt>
            <dd>
              <span class="console-accent">{{ info.resultLimit }}</span>
              <span class="facts-none"> · {{ info.pagination ? "paged" : "one page" }}</span>
            </dd>
          </div>
          <div>
            <dt>Free tier</dt>
            <dd>{{ info.freeTier }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <div class="console-band">
      <p class="console-label console-rule-title">
        <span>Capabilities <span aria-hidden="true">[ search · image · read ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <ul class="facts-ops">
        <li v-for="capability in capabilities" :key="capability.label" :data-on="capability.on">
          <span class="facts-op-label">{{ capability.label }}</span>
          <NuxtLink v-if="capability.on" :to="capability.to" class="facts-op-method">{{ capability.method }}</NuxtLink>
          <span v-else class="facts-op-method facts-none">not supported</span>
          <span class="facts-op-node" aria-hidden="true" />
        </li>
      </ul>
    </div>

    <div class="console-band">
      <p class="console-label console-rule-title">
        <span>Options <span aria-hidden="true">[ what it honours · what it fills ]</span></span>
        <span class="console-mark" aria-hidden="true" />
      </p>
      <dl class="facts-leads">
        <dd v-for="lead in leads" :key="lead.tag" class="console-lead">
          <span class="console-tag">{{ lead.tag }}</span>
          <UTooltip :text="lead.text">
            <code class="facts-code" tabindex="0">{{ lead.text }}</code>
          </UTooltip>
          <span class="console-leader" aria-hidden="true" />
        </dd>
      </dl>
    </div>

    <footer class="console-footer console-footer-plain">
      <ul class="console-links">
        <li>
          <NuxtLink to="/providers"><span aria-hidden="true">→ </span>All providers</NuxtLink>
        </li>
      </ul>
      <span class="console-meta">@agntn/web/providers/{{ info.key }}</span>
    </footer>
  </section>
</template>

<style scoped>
.facts-aliases {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}
.facts-alias {
  display: inline-flex;
  padding: 1px 7px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--ui-text-highlighted);
  box-shadow: inset 0 0 0 1px var(--console-line);
}
.facts-none {
  color: var(--ui-text-dimmed);
}
.facts-ops {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 11rem), 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.facts-ops > li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 10px;
  align-items: center;
  padding: 7px 10px;
  box-shadow: inset 0 0 0 1px var(--console-line);
}
.facts-op-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ui-text-muted);
}
.facts-op-method {
  grid-column: 1;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
a.facts-op-method:hover {
  color: var(--console-accent);
}
a.facts-op-method:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 2px;
}
.facts-op-node {
  grid-column: 2;
  grid-row: 1 / span 2;
  width: 7px;
  height: 7px;
  box-shadow: inset 0 0 0 1px var(--console-corner);
}
[data-on="true"] > .facts-op-node {
  background: var(--console-accent);
  box-shadow: none;
}
.facts-leads {
  display: grid;
  gap: 0;
  margin: 0;
}
.facts-leads > .console-lead {
  margin: 0 0 8px;
  flex-wrap: nowrap;
  min-width: 0;
}
.facts-code {
  min-width: 0;
  overflow: hidden;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
@media (width < 640px) {
  .facts-leads .console-leader {
    display: none;
  }
}
</style>
