<script setup lang="ts">
import type { SearchSample } from "../../utils/landing-fixtures";
import { hostOf } from "../../utils/format";
import { providerInfo } from "../../utils/providers";

const props = defineProps<{ sample: SearchSample }>();

const info = computed(() => providerInfo(props.sample.provider));
const fileName = computed(() => `${props.sample.provider}.ts`);
const envVar = computed(() => info.value?.envVar ?? "no key");
const first = computed(() => props.sample.results[0]);
</script>

<template>
  <div class="web-frame overflow-hidden rounded-xl">
    <div class="flex items-center gap-2 border-b border-muted px-4 py-3">
      <span class="font-mono text-[10px] font-bold text-primary">TS</span>
      <span class="text-sm text-default">
        <Transition name="web-roll" mode="out-in">
          <span :key="fileName">{{ fileName }}</span>
        </Transition>
      </span>
    </div>
    <pre class="web-rotating"><code><span class="tok-kw">import</span> { create } <span class="tok-kw">from</span> <span class="tok-str">"@agntn/web"</span>;

<span class="tok-cm">// reads <Transition name="web-roll" mode="out-in"><span :key="envVar" class="web-roll-slot">{{ envVar }}</span></Transition> from process.env</span>
<span class="tok-kw">const</span> provider = <span class="tok-fn">create</span>(<span class="tok-str">"<Transition name="web-roll" mode="out-in"><span :key="sample.provider" class="web-roll-slot">{{ sample.provider }}</span></Transition>"</span>);

<span class="tok-kw">const</span> query = <span class="tok-str">"<Transition name="web-roll" mode="out-in"><span :key="sample.query" class="web-roll-slot">{{ sample.query }}</span></Transition>"</span>;
<span class="tok-kw">const</span> results = <span class="tok-kw">await</span> provider.<span class="tok-fn">search</span>(query, { maxResults: <span class="tok-kw">5</span> });

results[0].url;   <span class="tok-cm">// "<Transition name="web-roll" mode="out-in"><span :key="first?.url" class="web-roll-slot">{{ first ? hostOf(first.url) : "" }}…</span></Transition>"</span>
results[0].title; <span class="tok-cm">// same shape from <Transition name="web-roll" mode="out-in"><span :key="sample.provider" class="web-roll-slot">{{ info?.label ?? sample.provider }}</span></Transition> as from every other provider</span></code></pre>
  </div>
</template>
