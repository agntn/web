<script setup lang="ts">
import { countWord } from "../../utils/format";
import { PROVIDERS } from "../../utils/providers";

const { samples, paused, current, step } = useLandingSearch();

const total = countWord(PROVIDERS.length);
const adaptersTitle = `${total[0]!.toUpperCase()}${total.slice(1)} adapters, one shape`;
</script>

<template>
  <div class="web-landing not-prose">
    <LandingHero />

    <LandingFeature
      title="Query in, results out"
      to="/guide/search"
      link="Searching"
      :checks="[
        'Every provider answers { url, title, snippet }. Score, dates, highlights and full text come along when the engine has them',
        'A filter the provider cannot do lands in ignoredFilters. Nothing gets dropped quietly',
        'Brave, Marginalia, Mojeek, SearXNG, SerpAPI, SerpBase and TinyFish page through an opaque continuation token',
      ]"
    >
      <code class="web-code">create("brave")</code> reads the key from env and gives you a provider
      with one <code class="web-code">search()</code>. Change the string, the rest of your code
      stays. This panel walks through {{ samples.length }} queries and replaces each recorded sample
      with the live answer from the docs worker.
      <template #visual>
        <LandingResults :sample="current" @step="step" @pause="paused = $event" />
      </template>
    </LandingFeature>

    <LandingFeature
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
      One query, every key you have. UTM junk is stripped before URLs are compared, the first
      provider in order gives the representative record, and one engine hitting a paywall, a rate
      limit or a timeout does not empty the list. That was the whole point.
      <template #visual>
        <LandingFanout :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      title="URL in, page out"
      to="/guide/read"
      link="Reading pages"
      :checks="[
        'readUrl starts with Jina Reader and moves to Context.dev, Firecrawl, TinyFish, Tavily or Exa when Jina fails in a way that makes sense to retry',
        'maxChars is an exact bound in code points, same on every reader, with a continuation for the rest',
        'readUrlDetailed tells you which reader answered and which ones it tried first',
      ]"
    >
      You have a URL, you want the page. <code class="web-code">readUrl</code> gives it back as
      Markdown, text or HTML. The bound is measured after the provider answers, so a page is never
      bigger than the agent asked for. A truncated page carries a token for the next slice.
      <template #visual>
        <LandingRead :sample="current" />
      </template>
    </LandingFeature>

    <section class="web-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 sm:px-12 lg:px-16">
        <div class="max-w-2xl">
          <h2 class="text-2xl font-medium tracking-tight text-highlighted sm:text-[1.75rem]">
            {{ adaptersTitle }}
          </h2>
          <p class="mt-4 text-sm leading-6 text-muted">
            Exa wants a POST with <code class="web-code">x-api-key</code>, Brave a GET with
            <code class="web-code">X-Subscription-Token</code>, Tavily puts the key in the body.
            Different APIs, different ideas about a request. Each adapter maps one of them onto the
            shared types and says what it can do, and the rest of the library just reads that. A
            custom provider is one class and one <code class="web-code">register()</code> call.
          </p>
          <p class="landing-entry">
            <span class="console-tag">Import</span>
            <code>@agntn/web/providers/&lt;name&gt;</code>
          </p>
        </div>
        <ProviderRoster class="mt-10" />
      </div>
    </section>

    <LandingFeature
      title="Four tools, every host"
      to="/guide/agents"
      link="AI SDK, MCP, Pi and OMP"
      :checks="[
        'web_search, web_search_image, web_read and web_providers, same schema on every surface',
        'Provider names are checked against the live registry, so a custom provider works in a tool call too',
        'The host abort signal cancels the provider request. Reads default to 20 000 characters',
      ]"
      reverse
    >
      <code class="web-code">searchTool</code> from the <code class="web-code">/ai</code> subpath is
      a Vercel AI SDK tool, <code class="web-code">web mcp</code> serves the same four over stdio.
      The model gets the normalized answer with the provider diagnostics attached, not prose.
      <template #visual>
        <LandingToolCall :sample="current" />
      </template>
    </LandingFeature>

    <LandingFeature
      title="Same calls, every adapter"
      to="/guide/custom"
      link="Custom providers"
      :checks="[
        'search(), searchByImage() and read() on the providers that have them',
        'AuthError, RateLimitError with retryAfter, HTTPError with the key already redacted from the URL',
        'Every network call takes a signal, a deadline and a concurrency bound',
      ]"
    >
      Type guards like <code class="web-code">isReadProvider</code> tell you what a provider can do,
      the registry tells you which ones exist. Upstream quirks, Brave's extra snippets, Exa's
      highlights, all of that stays inside the adapter. The public types never see it.
      <template #visual>
        <LandingRotatingCode :sample="current" />
      </template>
    </LandingFeature>

    <section class="web-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-20 sm:px-12 lg:px-16">
        <LandingStart />
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing-entry {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 20px 0 0;
  min-width: 0;
}
.landing-entry > .console-tag {
  flex: none;
  margin: 0;
}
.landing-entry > code {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-highlighted);
}
</style>
