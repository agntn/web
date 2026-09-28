<script setup lang="ts">
import { version } from "../../../../package.json";
import { DEFAULT_FIELDS, explorerQuery, type ExplorerFields, type Operation } from "../../utils/explorer";
import { HEADLINE_PROVIDERS, IMAGE_PROVIDERS, PROVIDERS, READ_PROVIDERS, SEARCH_PROVIDERS } from "../../utils/providers";

const INSTALL = "pnpm add @agntn/web";

/** The lead names the best known providers and leaves the count to the readouts under it. */
const headline = HEADLINE_PROVIDERS.join(", ");

const router = useRouter();
const fields = ref<ExplorerFields>({ ...DEFAULT_FIELDS });

function run(operation: Operation) {
  void router.push({ path: "/explorer", query: explorerQuery({ ...fields.value, operation }) });
}

const { copied, copy } = useCopied();
</script>

<template>
  <header class="web-hero hero-page">
    <div class="hero-zone">
      <span class="hero-cross hero-cross-tl" aria-hidden="true">+</span>
      <span class="hero-cross hero-cross-tr" aria-hidden="true">+</span>
      <span class="hero-bracket hero-bracket-l" aria-hidden="true" />
      <span class="hero-bracket hero-bracket-r" aria-hidden="true" />

      <p class="console-id">
        <span class="console-id-tag">ID</span>
        <span>@agntn/web</span>
        <span class="console-id-sep" aria-hidden="true">/</span>
        <span>v{{ version }}</span>
      </p>

      <h1 class="hero-title">One query. <span>Every engine.</span></h1>
      <p class="hero-lead">
        One TypeScript interface over {{ headline }} and the rest of the catalog. Search, reverse image
        search and page reading come back in the same shape, from a library, a CLI, an AI SDK tool
        or an MCP server, your pick.
      </p>

      <dl class="hero-metrics">
        <div>
          <dt>Providers</dt>
          <dd>{{ PROVIDERS.length }}</dd>
          <dd class="hero-metric-sub">one class shape</dd>
        </div>
        <div>
          <dt>Capabilities</dt>
          <dd>3</dd>
          <dd class="hero-metric-sub">{{ SEARCH_PROVIDERS.length }} search · {{ IMAGE_PROVIDERS.length }} image</dd>
        </div>
        <div>
          <dt>Read</dt>
          <dd class="hero-metric-accent">{{ READ_PROVIDERS.length }} <span>readers</span></dd>
          <dd class="hero-metric-sub">fallback from Jina</dd>
        </div>
      </dl>

      <div class="console-actions">
        <UButton
          to="/guide"
          color="primary"
          variant="solid"
          trailing-icon="i-lucide-arrow-right"
          label="Get started"
        />
        <UButton
          to="https://github.com/agntn/web"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-simple-icons-github"
          label="Star on GitHub"
        />
      </div>
      <div class="console-install">
        <span class="console-install-tag">Install</span>
        <code><span class="console-install-prompt">$</span> {{ INSTALL }}</code>
        <UButton
          color="neutral"
          variant="subtle"
          :icon="copied === 'install' ? 'i-lucide-check' : 'i-lucide-copy'"
          :aria-label="copied === 'install' ? 'Copied' : 'Copy install command'"
          @click="copy('install', INSTALL)"
        />
      </div>
    </div>

    <!-- The form is the real explorer, not a picture of one: a run opens its answer. -->
    <div class="hero-instrument hero-instrument-keep">
      <svg class="hero-circuit" viewBox="0 0 160 56" aria-hidden="true">
        <path class="hero-circuit-rail" d="M80 0V16L96 32V56" />
        <path class="hero-circuit-live" d="M80 0V16L96 32V56" pathLength="1" />
        <path class="hero-circuit-seg" d="M96 38V48" />
        <rect class="hero-circuit-node" x="92.5" y="52.5" width="7" height="7" />
      </svg>
      <span class="hero-circuit-tag" aria-hidden="true">ask</span>
      <ExplorerForm v-model="fields" @submit="run" />
    </div>
  </header>
</template>
