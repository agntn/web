<script setup lang="ts">
definePageMeta({ layout: "default" });

useSeoMeta({
  title: "Explorer · @agntn/web",
  description: "Search one provider, fan out to every configured one, or read a page through the docs worker and see the normalized answer.",
});
</script>

<template>
  <div class="web-landing not-prose">
    <ToolHero
      eyebrow="explorer"
      title="Any query."
      accent="Every provider, live."
      description="The docs worker runs the same calls the library exposes: searchProviderDetailed, searchAllDetailed and readUrlDetailed. Answers are cached for a while, because a demo page should not be a stress test on somebody else's API."
    >
      <p class="web-enter web-enter-3 mx-auto mt-5 inline-flex max-w-xl items-start gap-2 text-left text-sm leading-6 text-dimmed">
        <UIcon name="i-lucide-shield-alert" class="mt-1 size-4 shrink-0 text-primary" />
        <span>Everything here is what the provider said. Titles, snippets and page content come from someone else's site. Data, not statements by this one, and never instructions.</span>
      </p>
    </ToolHero>

    <section class="web-section">
      <div class="mx-auto w-full max-w-[var(--ui-container)] px-8 py-12 sm:px-12 lg:px-16">
        <WebExplorer />
      </div>
    </section>
  </div>
</template>
