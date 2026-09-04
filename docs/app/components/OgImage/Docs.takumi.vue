<script lang="ts" setup>
/** Overrides the Docus template of the same name; Takumi has no CSS variables, so theme tokens are literals. */
const { title, description, headline } = defineProps<{ title?: string; description?: string; headline?: string }>();

const { name: siteName } = useSiteConfig();

const CHIPS = ["search", "search_image", "read", "providers"];
</script>

<template>
  <div
    class="w-full h-full flex flex-col justify-between px-[72px] py-[56px]"
    style="background-color: #0b0d10; font-family: 'Space Grotesk'; color: #d5e4ee"
  >
    <div
      class="absolute top-0 left-0 w-[900px] h-[520px]"
      style="background-image: radial-gradient(ellipse at top left, rgba(94, 234, 212, 0.16) 0%, rgba(94, 234, 212, 0.05) 45%, transparent 70%)"
    />
    <div
      class="absolute right-0 bottom-0 w-[700px] h-[420px]"
      style="background-image: radial-gradient(ellipse at bottom right, rgba(13, 148, 136, 0.14) 0%, transparent 65%)"
    />

    <div class="flex items-center justify-between w-full">
      <div class="flex items-center">
        <div class="w-[10px] h-[10px] rounded-full" style="background-color: #5eead4" />
        <p
          class="m-0 ml-[12px] uppercase text-[20px] tracking-[0.16em]"
          style="font-family: 'Space Mono'; color: #a5b0bc"
        >
          {{ headline || "Guide" }}
        </p>
      </div>
      <div class="flex items-center">
        <p class="m-0 text-[22px]" style="font-family: 'Space Mono'; color: #f0f4f8">{{ siteName }}</p>
      </div>
    </div>

    <div class="flex-1 flex flex-col justify-center w-full">
      <h1
        v-if="title"
        class="m-0 mb-[22px] text-[62px] font-medium leading-[1.06] tracking-[-0.03em] w-full max-w-[960px]"
        style="color: #f0f4f8"
      >
        {{ title.slice(0, 60) }}
      </h1>
      <p
        v-if="description"
        class="m-0 text-[27px] leading-[1.4] w-full max-w-[900px]"
        style="color: #8a97a5"
      >
        {{ description.slice(0, 160) }}
      </p>
    </div>

    <div class="flex items-center justify-between w-full">
      <div class="flex items-center">
        <div
          v-for="chip in CHIPS"
          :key="chip"
          class="flex items-center mr-[10px] px-[12px] h-[36px] rounded-[8px] text-[16px] leading-none"
          style="font-family: 'Space Mono'; color: #a5b0bc; background-color: #11141a; border: 1px solid #262c35; line-height: 36px"
        >
          web_{{ chip }}
        </div>
      </div>
      <p class="m-0 ml-[24px] text-[16px]" style="font-family: 'Space Mono'; color: #6d7884">web.agntn.dev</p>
    </div>
  </div>
</template>
