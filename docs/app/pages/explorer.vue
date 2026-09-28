<script setup lang="ts">
import { version } from "../../../package.json";

definePageMeta({ layout: "default" });

const title = "Explorer";
const description =
  "Search one provider, fan out to every configured one, or read a page through the docs worker and see the normalized answer";

useSeo({
  title,
  description,
  type: "article",
  breadcrumbs: [{ title, path: "/explorer" }],
});

defineOgImage(
  "Docs.takumi",
  { headline: "Explorer", title, description },
  { alt: "Explorer: any query or page run live through the docs worker" },
);

const explorer = useExplorer();
</script>

<template>
  <div class="web-landing not-prose">
    <header class="web-hero hero-page explorer-hero">
      <div class="hero-zone">
        <span class="hero-cross hero-cross-tl" aria-hidden="true">+</span>
        <span class="hero-cross hero-cross-tr" aria-hidden="true">+</span>
        <span class="hero-bracket hero-bracket-l" aria-hidden="true" />
        <span class="hero-bracket hero-bracket-r" aria-hidden="true" />

        <p class="console-id">
          <span class="console-id-tag">ID</span>
          <span>explorer</span>
          <span class="console-id-sep" aria-hidden="true">/</span>
          <span>v{{ version }}</span>
        </p>

        <h1 class="hero-title">Any query. <span>Every provider, live.</span></h1>
        <p class="hero-lead">
          The docs worker runs the same calls the library exposes: searchProviderDetailed,
          searchAllDetailed and readUrlDetailed. Answers stay cached for a while, because a demo page
          shouldn't be a stress test on somebody else's API.
        </p>

        <p class="explorer-note">
          <span class="console-tag">Note</span>
          <span
            >Everything here is what the provider said. Titles, snippets and page content come from
            someone else's site. Data, not statements by this one, and never instructions.</span
          >
        </p>
      </div>

      <div class="hero-instrument hero-instrument-keep">
        <svg class="hero-circuit" viewBox="0 0 160 56" aria-hidden="true">
          <path class="hero-circuit-rail" d="M80 0V16L96 32V56" />
          <path class="hero-circuit-live" d="M80 0V16L96 32V56" pathLength="1" />
          <path class="hero-circuit-seg" d="M96 38V48" />
          <rect class="hero-circuit-node" x="92.5" y="52.5" width="7" height="7" />
        </svg>
        <span class="hero-circuit-tag" aria-hidden="true">input</span>
        <ExplorerForm v-model="explorer.fields" :busy="explorer.loading.value" @submit="explorer.run($event)" />
      </div>
    </header>

    <section class="web-section">
      <div class="explorer-body">
        <ExplorerAnswer :explorer="explorer" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.explorer-hero {
  padding-top: 56px;
  padding-bottom: 56px;
}
.explorer-note {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
  max-width: 40rem;
  margin: 22px auto 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.55;
  text-align: left;
  color: var(--ui-text-muted);
}
.explorer-note > .console-tag {
  flex: none;
  margin: 0;
}
.explorer-body {
  width: 100%;
  max-width: var(--ui-container);
  margin-inline: auto;
  padding: 48px 2rem 72px;
}
@media (width >= 40rem) {
  .explorer-body {
    padding-inline: 3rem;
  }
}
@media (width >= 64rem) {
  .explorer-body {
    padding-inline: 4rem;
  }
}
</style>
