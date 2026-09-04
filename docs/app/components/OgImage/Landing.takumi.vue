<script lang="ts" setup>
/** Overrides the Docus landing template; Takumi has no CSS variables, so theme tokens are literals. */
/** The props are what Docus passes; the tagline is fixed because Docus strips commas from the description. */
defineProps<{ title?: string; description?: string }>();

const TAGLINE = "Search, reverse image search and page reading from eleven providers, in one shape.";

const { name: siteName } = useSiteConfig();

const PROVIDERS = ["Brave", "Exa", "Tavily", "Firecrawl", "Jina", "SearXNG", "+5"];
</script>

<template>
  <div
    class="w-full h-full flex flex-col justify-between px-[72px] py-[56px]"
    style="background-color: #0b0d10; font-family: 'Space Grotesk'; color: #d5e4ee"
  >
    <div
      class="absolute top-0 left-[150px] w-[900px] h-[560px]"
      style="background-image: radial-gradient(ellipse at top, rgba(94, 234, 212, 0.18) 0%, rgba(94, 234, 212, 0.05) 45%, transparent 70%)"
    />

    <div class="flex items-center justify-between w-full">
      <p class="m-0 text-[22px]" style="font-family: 'Space Mono'; color: #f0f4f8">{{ siteName }}</p>
      <div
        class="flex items-center px-[16px] h-[38px] rounded-[8px] text-[18px] leading-none"
        style="font-family: 'Space Mono'; color: #a5b0bc; background-color: #11141a; border: 1px solid #262c35; line-height: 38px"
      >
        $ pnpm add @agntn/web
      </div>
    </div>

    <div class="flex-1 flex flex-col justify-center items-center w-full">
      <div class="flex items-baseline">
        <h1 class="m-0 text-[76px] font-medium leading-[1.05] tracking-[-0.03em]" style="color: #f0f4f8">One query.</h1>
        <h1 class="m-0 ml-[22px] text-[76px] font-medium leading-[1.05] tracking-[-0.03em]" style="color: #5eead4">Every engine.</h1>
      </div>
      <p class="m-0 mt-[24px] text-[26px] leading-[1.4] text-center max-w-[880px]" style="color: #8a97a5">
        {{ TAGLINE }}
      </p>
    </div>

    <div class="flex items-center justify-between w-full">
      <div class="flex items-center">
        <div
          v-for="(provider, index) in PROVIDERS"
          :key="provider"
          class="flex items-center mr-[10px] px-[12px] h-[36px] rounded-[8px] text-[16px] leading-none"
          :style="{
            fontFamily: 'Space Mono',
            color: index === 0 ? '#5eead4' : '#a5b0bc',
            backgroundColor: '#11141a',
            border: index === 0 ? '1px solid rgba(94, 234, 212, 0.5)' : '1px solid #262c35',
            lineHeight: '36px',
          }"
        >
          {{ provider }}
        </div>
      </div>
      <p class="m-0 ml-[24px] text-[16px]" style="font-family: 'Space Mono'; color: #6d7884">web.agntn.dev</p>
    </div>
  </div>
</template>
