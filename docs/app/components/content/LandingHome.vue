<script setup lang="ts">
import { PROVIDERS } from "../../utils/providers";

const { samples, tick, index, paused, current, step } = useLandingSearch();

const stats = [
  { value: "11", label: "providers" },
  { value: "3", label: "capabilities" },
  { value: "4", label: "readers" },
  { value: "4", label: "agent tools" },
] as const;

const copied = ref(false);

async function copyInstall() {
  try {
    await navigator.clipboard.writeText("pnpm add @agntn/web");
  } catch {
    return;
  }
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1200);
}

/** The provider grid highlights whichever provider the search panel is showing. */
const activeProvider = computed(() => current.value.provider);
</script>

<template>
  <div class="web-landing not-prose">
    <header class="web-hero mx-auto w-full max-w-[var(--ui-container)] px-8 pt-24 pb-20 text-center sm:px-12 lg:px-16">
      <h1 class="web-enter mx-auto max-w-3xl text-4xl leading-[1.08] font-medium tracking-tight text-highlighted sm:text-5xl lg:text-[3.75rem]">
        One query. <span class="text-primary">Every engine.</span>
      </h1>
      <p class="web-enter web-enter-2 mx-auto mt-6 max-w-xl text-base leading-7 text-muted">
        One interface over Brave, Exa, Tavily, Firecrawl, Jina, SearXNG and five more. Search,
        reverse image search and page reading, all in the same shape. Works as a library, a CLI,
        an AI SDK tool or an MCP server, your pick.
      </p>
      <div class="web-enter web-enter-3 mt-8 flex flex-wrap items-center justify-center gap-2">
        <UButton to="/guide" color="primary" trailing-icon="i-lucide-arrow-right">
          Get started
        </UButton>
        <UButton to="https://github.com/agntn/web" target="_blank" color="neutral" variant="outline" icon="i-simple-icons-github">
          Star on GitHub
        </UButton>
      </div>
      <button
        type="button"
        class="web-enter web-enter-4 web-install mt-5"
        :aria-label="copied ? 'Copied' : 'Copy install command'"
        @click="copyInstall"
      >
        <span class="text-dimmed">$</span>
        <span>pnpm add @agntn/web</span>
        <UIcon :name="copied ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3.5 text-dimmed" />
      </button>

      <div
        class="web-enter web-enter-4 mx-auto mt-16 hidden max-w-6xl md:block"
        @mouseenter="paused = true"
        @mouseleave="paused = false"
      >
        <LandingFlow :sample="current" :tick="tick" />
      </div>
    </header>

    <dl class="web-section grid grid-cols-2 sm:grid-cols-4">
      <div
        v-for="(stat, i) in stats"
        :key="stat.label"
        class="border-default px-6 py-7 text-center"
        :class="{ 'border-t sm:border-t-0': i >= 2, 'border-l': i % 2 === 1, 'sm:border-l': i > 0 }"
      >
        <dd class="font-mono text-2xl text-highlighted">{{ stat.value }}</dd>
        <dt class="mt-1 font-mono text-[11px] tracking-[0.12em] text-dimmed uppercase">{{ stat.label }}</dt>
      </div>
    </dl>

    <LandingFeature
      eyebrow="Search"
      title="Query in, results out"
      to="/explorer"
      link="Open the explorer"
      :checks="[
        'Every provider answers { url, title, snippet }. Score, dates, highlights and full text come along when the engine has them',
        'A filter the provider cannot do lands in ignoredFilters. Nothing gets dropped quietly',
        'Brave, Mojeek, SearXNG, SerpAPI, SerpBase and TinyFish page through an opaque continuation token',
      ]"
    >
      <code class="font-mono text-[13px] text-highlighted">create("brave")</code> reads the key from env
      and gives you a provider with one <code class="font-mono text-[13px] text-highlighted">search()</code>.
      Change the string, the rest of your code stays. This panel walks through {{ samples.length }} queries and
      replaces each recorded sample with the live answer from the docs worker.
      <template #visual>
        <LandingResults :sample="current" :tick="tick" @step="step" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Fan-out"
      title="Ask them all, keep the evidence"
      to="/guide/fanout"
      link="Fan-out, fallback and pagination"
      :checks="[
        'searchAll asks every configured provider at once and deduplicates by normalized URL',
        'Each result remembers which providers returned it and keeps every record as evidence',
        'A provider that fails goes to errors. The rest still answer',
      ]"
      reverse
    >
      One query, every key you have. UTM junk is stripped before URLs are compared, the first provider
      in order gives the representative record, and one engine hitting a paywall, a rate limit or a
      timeout does not empty the list. That was the whole point.
      <template #visual>
        <LandingFanout :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Read"
      title="URL in, page out"
      to="/guide/read"
      link="Reading pages"
      :checks="[
        'readUrl starts with Jina Reader and moves to Context.dev, Firecrawl or TinyFish when Jina fails in a way that makes sense to retry',
        'maxChars is an exact bound in code points, same on every reader, with a continuation for the rest',
        'readUrlDetailed tells you which reader answered and which ones it tried first',
      ]"
    >
      You have a URL, you want the page. <code class="font-mono text-[13px] text-highlighted">readUrl</code> gives
      it back as Markdown, text or HTML. The bound is measured after the provider answers, so a page is never
      bigger than the agent asked for. Truncated page carries a token for the next slice.
      <template #visual>
        <LandingRead :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Providers"
      title="Eleven adapters, one shape"
      to="/providers"
      link="All providers"
      :checks="[
        'Auth, endpoints and response shapes stay inside the adapter where they belong',
        'searchProviders(), searchImageProviders() and readProviders() come from the classes, not from a list someone forgets to update',
        'A custom provider is one class and one register() call',
      ]"
      reverse
    >
      Exa wants a POST with <code class="font-mono text-[13px] text-highlighted">x-api-key</code>, Brave a GET with
      <code class="font-mono text-[13px] text-highlighted">X-Subscription-Token</code>, Tavily puts the key in the body.
      Eleven APIs, eleven ideas about a request. Each adapter maps one of them onto the shared types and says what it can do. The rest of the library just reads that.
      <template #visual>
        <div class="web-frame grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-3 lg:grid-cols-4">
          <NuxtLink
            v-for="(provider, i) in PROVIDERS"
            :key="provider.to"
            :to="provider.to"
            class="group flex flex-col gap-3 border-muted px-4 py-4 transition-colors duration-500 hover:bg-muted"
            :class="{
              'border-t': i >= 2,
              'sm:border-t-0': i < 3,
              'lg:border-t-0': i < 4,
              'border-l': i % 2 === 1,
              'sm:border-l': i % 3 !== 0,
              'lg:border-l': i % 4 !== 0,
              'sm:border-l-0': i % 3 === 0,
              'lg:border-l-0!': i % 4 === 0,
              'web-cell-active': provider.key === activeProvider,
            }"
          >
            <UIcon
              :name="provider.icon"
              class="size-5 text-muted transition-colors duration-500 group-hover:text-primary"
              :class="{ 'text-primary': provider.key === activeProvider }"
            />
            <span>
              <span class="block text-sm font-medium text-highlighted">{{ provider.label }}</span>
              <span class="mt-0.5 block font-mono text-[11px] text-dimmed">
                {{ [provider.search ? "search" : "", provider.searchImage ? "image" : "", provider.read ? "read" : ""].filter(Boolean).join(" · ") }}
              </span>
            </span>
          </NuxtLink>
          <NuxtLink
            to="/guide/custom"
            class="group flex flex-col gap-3 border-t border-l border-muted px-4 py-4 transition-colors duration-500 hover:bg-muted lg:border-t-0"
          >
            <UIcon name="i-lucide-plus" class="size-5 text-muted transition-colors duration-500 group-hover:text-primary" />
            <span>
              <span class="block text-sm font-medium text-highlighted">Yours</span>
              <span class="mt-0.5 block font-mono text-[11px] text-dimmed">register(Provider)</span>
            </span>
          </NuxtLink>
        </div>
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="Agents"
      title="Four tools, every host"
      to="/guide/agents"
      link="AI SDK, MCP, Pi and OMP"
      :checks="[
        'web_search, web_search_image, web_read and web_providers, same schema on every surface',
        'Provider names are checked against the live registry, so a custom provider works in a tool call too',
        'The host abort signal cancels the provider request. Reads default to 20 000 characters',
      ]"
    >
      <code class="font-mono text-[13px] text-highlighted">searchTool</code> from the
      <code class="font-mono text-[13px] text-highlighted">/ai</code> subpath is a Vercel AI SDK tool,
      <code class="font-mono text-[13px] text-highlighted">web mcp</code> serves the same four over stdio.
      The model gets the normalized answer with the provider diagnostics attached, not prose.
      <template #visual>
        <LandingToolCall :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      eyebrow="One interface"
      title="Same calls, every adapter"
      to="/guide/search"
      link="Searching"
      :checks="[
        'search(), searchByImage() and read() on the providers that have them',
        'AuthError, RateLimitError with retryAfter, HTTPError with the key already redacted from the URL',
        'Every network call takes a signal, a deadline and a concurrency bound',
      ]"
      reverse
    >
      Type guards like <code class="font-mono text-[13px] text-highlighted">isReadProvider</code> tell you what
      a provider can do, the registry tells you which ones exist. Upstream quirks, Brave's extra snippets,
      Exa's highlights, all of that stays inside the adapter. The public types never see it.
      <template #visual>
        <LandingRotatingCode :sample="current" />
      </template>
    </LandingFeature>

    <section class="web-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 text-center sm:px-12 lg:px-16">
        <h2 class="text-2xl font-medium tracking-tight text-highlighted sm:text-3xl">
          Start with one command
        </h2>
        <p class="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
          Pre-1.0, so pin exact versions. And treat search results and page content as data you did not write, because you did not.
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-2">
          <UButton to="/guide" color="primary" trailing-icon="i-lucide-arrow-right">
            Read the guide
          </UButton>
          <UButton to="/explorer" color="neutral" variant="outline">
            Open the explorer
          </UButton>
        </div>
      </div>
    </section>
  </div>
</template>
