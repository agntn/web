<script setup lang="ts">
import { SEARCH_PROVIDERS } from "../utils/providers";

/**
 * Every search provider as a cell whose node carries what it did in one fan-out: answered, failed
 * or not asked. A failure's message sits in the cell's tooltip, never in the page as a row.
 */
const props = defineProps<{
  /** Providers the fan-out asked, in order. */
  asked: readonly string[];
  successful: readonly string[];
  errors: readonly { readonly provider: string; readonly message: string }[];
}>();

type State = "ok" | "failed" | "idle";

const cells = computed(() =>
  SEARCH_PROVIDERS.map((provider) => {
    const failure = props.errors.find((entry) => entry.provider === provider.key);
    const state: State = props.successful.includes(provider.key)
      ? "ok"
      : failure || props.asked.includes(provider.key)
        ? "failed"
        : "idle";
    const note =
      state === "ok"
        ? "answered"
        : state === "failed"
          ? (failure?.message ?? "failed")
          : "not asked: no key on the docs worker";
    return { ...provider, state, note };
  }),
);
</script>

<template>
  <div class="cells-frame">
    <ul class="cells" aria-label="Providers in this fan-out">
      <li v-for="cell in cells" :key="cell.key" :data-state="cell.state">
        <UTooltip :text="`${cell.label}: ${cell.note}`">
          <NuxtLink :to="cell.to" class="cell">
            <UIcon :name="cell.icon" class="cell-glyph" aria-hidden="true" />
            <span class="cell-name">{{ cell.label }}</span>
            <span class="cell-node" aria-hidden="true" />
            <span class="sr-only">{{ cell.note }}</span>
          </NuxtLink>
        </UTooltip>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.cells-frame {
  container-type: inline-size;
}
.cells {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 8.5rem), 1fr));
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cell {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr) 7px;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ui-text-dimmed);
  box-shadow: inset 0 0 0 1px var(--console-line);
}
.cell-glyph {
  width: 14px;
  height: 14px;
}
.cell-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-node {
  width: 7px;
  height: 7px;
  box-shadow: inset 0 0 0 1px var(--console-corner);
}
[data-state="ok"] .cell {
  color: var(--ui-text-highlighted);
}
[data-state="ok"] .cell-glyph {
  color: var(--ui-text-muted);
}
[data-state="ok"] .cell-node {
  background: var(--ui-text-highlighted);
  box-shadow: none;
}
[data-state="failed"] .cell {
  color: var(--ui-text-muted);
}
[data-state="failed"] .cell-node {
  background: var(--web-del);
  box-shadow: none;
}
.cell:hover {
  color: var(--console-accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--console-accent) 55%, transparent);
}
/* Beside the text at 1024px the instrument is about 24rem wide: the glyph goes, three columns stay. */
@container (width < 27rem) {
  .cells {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .cell {
    grid-template-columns: minmax(0, 1fr) 7px;
  }
  .cell-glyph {
    display: none;
  }
}
.cell:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 2px;
}
</style>
