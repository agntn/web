<script setup lang="ts">
import type { SearchSample } from "../../utils/landing-fixtures";
import { clip, hostPath, plainText } from "../../utils/format";
import { PROVIDERS } from "../../utils/providers";

const props = defineProps<{ sample: SearchSample; tick: number }>();

const W = 1200;
const H = 470;
const QUERY = { x: 24, y: 165, w: 330, h: 140 };
const NODE = { x: 500, w: 220, h: 30, gap: 10 };
const RESULT = { x: 870, y: 40, w: 306, h: 390 };

const providers = computed(() => {
  const asked = new Set([...props.sample.fanout.successfulProviders, ...props.sample.fanout.errors.map((entry) => entry.provider)]);
  const ok = new Set(props.sample.fanout.successfulProviders);
  return PROVIDERS.map((provider, index) => ({
    ...provider,
    y: 15 + index * (NODE.h + NODE.gap),
    asked: asked.has(provider.key),
    active: ok.has(provider.key),
    failed: asked.has(provider.key) && !ok.has(provider.key),
  }));
});

function curvePath(x1: number, y1: number, x2: number, y2: number) {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

const trunkPaths = computed(() =>
  providers.value.map((provider) => ({
    d: curvePath(QUERY.x + QUERY.w, QUERY.y + QUERY.h / 2, NODE.x, provider.y + NODE.h / 2),
    active: provider.active,
    asked: provider.asked,
  })),
);

const branchPaths = computed(() =>
  providers.value.map((provider) => ({
    d: curvePath(NODE.x + NODE.w, provider.y + NODE.h / 2, RESULT.x, RESULT.y + RESULT.h / 2),
    active: provider.active,
  })),
);

const top = computed(() => props.sample.fanout.results[0]);

const fields = computed(() => {
  const result = top.value;
  if (!result) {
    return [];
  }
  return [
    { label: "url", value: clip(hostPath(result.url), 30) },
    { label: "title", value: clip(plainText(result.title), 30) },
    { label: "snippet", value: clip(plainText(result.snippet), 30) },
    { label: "providers", value: result.providers.join(", ") },
    { label: "publishedDate", value: result.publishedDate ? result.publishedDate.slice(0, 10) : "none" },
    { label: "evidence", value: `${result.providers.length} provider ${result.providers.length === 1 ? "record" : "records"}` },
  ];
});

/** Space Mono is about 0.62 em wide per glyph; shrink the query until it fits the box. */
const queryFontSize = computed(() => Math.min(18, Math.floor((QUERY.w - 36) / (props.sample.query.length * 0.62))));
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="web-flow" role="img" aria-label="One query fans out to every configured provider and comes back as one deduplicated result list">
    <g class="web-flow-wires">
      <path v-for="(path, index) in trunkPaths" :key="`t${index}`" :d="path.d" :class="{ 'web-flow-wire-dim': !path.active }" />
      <path v-for="(path, index) in branchPaths" :key="`b${index}`" :d="path.d" :class="{ 'web-flow-wire-dim': !path.active }" />
    </g>
    <g :key="tick" class="web-flow-pulses">
      <template v-for="(path, index) in trunkPaths" :key="`pt${index}`">
        <path v-if="path.active" :d="path.d" class="web-flow-pulse" :style="{ animationDelay: `${index * 0.05}s` }" />
      </template>
      <template v-for="(path, index) in branchPaths" :key="`pb${index}`">
        <path v-if="path.active" :d="path.d" class="web-flow-pulse web-flow-pulse-late" :style="{ animationDelay: `${0.45 + index * 0.05}s` }" />
      </template>
    </g>

    <g class="web-flow-node">
      <rect :x="QUERY.x" :y="QUERY.y" :width="QUERY.w" :height="QUERY.h" rx="10" />
      <text :x="QUERY.x + 18" :y="QUERY.y + 30" class="web-flow-label">query</text>
      <text :x="QUERY.x + 18" :y="QUERY.y + 68" class="web-flow-domain web-flow-accent" :style="{ fontSize: `${queryFontSize}px` }">
        <tspan :key="sample.query" class="web-derive">"{{ sample.query }}"</tspan>
      </text>
      <text :x="QUERY.x + 18" :y="QUERY.y + 98" class="web-flow-mono">searchAll(query)</text>
      <text :x="QUERY.x + 18" :y="QUERY.y + 118" class="web-flow-label">{{ sample.fanout.successfulProviders.length }} of {{ sample.fanout.successfulProviders.length + sample.fanout.errors.length }} providers answered</text>
    </g>

    <g v-for="provider in providers" :key="provider.key" class="web-flow-node" :class="{ 'web-flow-dim': !provider.active, 'web-flow-failed': provider.failed }">
      <rect :x="NODE.x" :y="provider.y" :width="NODE.w" :height="NODE.h" rx="7" />
      <text :x="NODE.x + 12" :y="provider.y + 19" class="web-flow-small">{{ provider.label }}</text>
      <text :x="NODE.x + NODE.w - 12" :y="provider.y + 19" text-anchor="end" class="web-flow-label">
        {{ provider.failed ? "failed" : provider.active ? "ok" : provider.asked ? "…" : "no key" }}
      </text>
    </g>

    <g class="web-flow-node">
      <rect :x="RESULT.x" :y="RESULT.y" :width="RESULT.w" :height="RESULT.h" rx="10" />
      <text :x="RESULT.x + 18" :y="RESULT.y + 28" class="web-flow-label">SearchAllResult</text>
      <text :x="RESULT.x + RESULT.w - 18" :y="RESULT.y + 28" text-anchor="end" class="web-flow-mono">
        {{ sample.live ? "live" : "sample" }}
      </text>
      <line :x1="RESULT.x + 1" :x2="RESULT.x + RESULT.w - 1" :y1="RESULT.y + 44" :y2="RESULT.y + 44" class="web-flow-rule" />
      <g v-for="(field, index) in fields" :key="`${sample.query}-${field.label}`" class="web-derive">
        <text :x="RESULT.x + 18" :y="RESULT.y + 72 + index * 54" class="web-flow-label">{{ field.label }}</text>
        <text :x="RESULT.x + 18" :y="RESULT.y + 92 + index * 54" class="web-flow-title">{{ field.value }}</text>
      </g>
    </g>
  </svg>
</template>
