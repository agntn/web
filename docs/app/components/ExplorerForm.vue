<script setup lang="ts">
import { EXAMPLE_QUERIES, EXAMPLE_URLS, OPERATIONS, READ_BOUNDS, type ExplorerFields, type Operation } from "../utils/explorer";
import { hostOf, hostPath } from "../utils/format";
import { PROVIDERS, READ_PROVIDERS, SEARCH_PROVIDERS, providerIcon, providerInfo } from "../utils/providers";

/**
 * The explorer's form: the operation as tabs, its inputs in a readout, an action and examples. The
 * landing sends a run to /explorer, the explorer runs it in place.
 */
const props = withDefaults(
  defineProps<{
    /** A run is in flight, so the ruler keeps moving. */
    busy?: boolean;
  }>(),
  { busy: false },
);

const emit = defineEmits<{ submit: [operation: Operation] }>();

const fields = defineModel<ExplorerFields>({ required: true });
const problem = ref("");

const tabItems = OPERATIONS.map((operation) => ({ label: operation.label, icon: operation.icon, value: operation.key }));

const searchItems = [
  { label: "auto · first configured", value: "auto", icon: "i-lucide-shuffle" },
  ...SEARCH_PROVIDERS.map((provider) => ({ label: provider.label, value: provider.key, icon: provider.icon })),
];
const readerItems = [
  { label: "auto · Jina first", value: "auto", icon: "i-lucide-shuffle" },
  ...READ_PROVIDERS.map((provider) => ({ label: provider.label, value: provider.key, icon: provider.icon })),
];
const boundItems = READ_BOUNDS.map((bound): { label: string; value: number } => ({
  label: `${bound.toLocaleString("en-US")} characters`,
  value: bound,
}));

/** The provider the run names, when it names one. */
const named = computed(() => {
  const { operation, provider, reader } = fields.value;
  if (operation === "search" && provider !== "auto") return providerInfo(provider);
  if (operation === "read" && reader !== "auto") return providerInfo(reader);
  return undefined;
});

const icon = computed(
  () => named.value?.icon ?? OPERATIONS.find((entry) => entry.key === fields.value.operation)!.icon,
);

/** The call the bar prints: the library function in its short form. */
const call = computed(() => {
  const { operation, query, url, maxChars } = fields.value;
  switch (operation) {
    case "search":
      return { name: "search", arg: `"${query}"` };
    case "fanout":
      return { name: "searchAll", arg: `"${query}"` };
    case "read":
      return { name: "readUrl", arg: `"${hostOf(url)}…", { maxChars: ${maxChars} }` };
    default:
      return { name: "listProviders", arg: "" };
  }
});

const ACTIONS: Record<Operation, { label: string; icon: string }> = {
  search: { label: "Search", icon: "i-lucide-arrow-right" },
  fanout: { label: "Ask every provider", icon: "i-lucide-arrow-right" },
  read: { label: "Read", icon: "i-lucide-arrow-right" },
  providers: { label: "List providers", icon: "i-lucide-arrow-right" },
};

function pick(value: string | number) {
  fields.value.operation = value as Operation;
  problem.value = "";
}

function submit() {
  const { operation, query, url } = fields.value;
  if ((operation === "search" || operation === "fanout") && !query.trim()) {
    problem.value = "Type a query first, like TypeScript 7 native compiler.";
    return;
  }
  if (operation === "read" && !url.trim()) {
    problem.value = "Type a URL first, like nitro.build/deploy. The scheme is optional.";
    return;
  }
  problem.value = "";
  emit("submit", operation);
}

function pickQuery(example: string) {
  fields.value.query = example;
  submit();
}

function pickUrl(example: string) {
  fields.value.url = example;
  submit();
}
</script>

<template>
  <form class="tool-console console-wide form not-prose" role="search" @submit.prevent="submit">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="`${call.name}(${call.arg})`">
        <span class="console-title" tabindex="0"
          ><span class="console-tag">Call</span>{{ call.name }}(<span class="tok-str">{{ call.arg }}</span
          >)</span
        >
      </UTooltip>
      <span class="console-meta">{{ PROVIDERS.length }} providers</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :class="props.busy ? 'console-cursor console-cursor-busy' : 'console-cursor'" />
    </div>

    <UTabs
      :model-value="fields.operation"
      :items="tabItems"
      :content="false"
      variant="link"
      class="form-tabs"
      aria-label="Operation"
      @update:model-value="pick"
    />

    <div class="web-band form-band">
      <div class="form-glyph" aria-hidden="true">
        <ConsoleReticle :key="icon" :icon="icon" />
      </div>
      <div class="form-fields">
        <div class="console-readout">
          <dl v-if="fields.operation === 'search' || fields.operation === 'fanout'" class="console-readout-rows">
            <div>
              <dt><label for="explorer-query">Query</label></dt>
              <dd>
                <UInput
                  id="explorer-query"
                  v-model="fields.query"
                  variant="none"
                  placeholder="What to search for"
                  spellcheck="false"
                  autocomplete="off"
                  :maxlength="256"
                  class="w-full"
                />
              </dd>
            </div>
            <div v-if="fields.operation === 'search'">
              <dt>Provider</dt>
              <dd>
                <USelectMenu
                  v-model="fields.provider"
                  :items="searchItems"
                  value-key="value"
                  :icon="named?.icon ?? 'i-lucide-shuffle'"
                  variant="none"
                  :search-input="{ placeholder: 'Filter providers' }"
                  aria-label="Provider"
                  class="w-full"
                />
              </dd>
            </div>
            <div v-else>
              <dt>Asks</dt>
              <dd class="console-accent">every configured provider at once</dd>
            </div>
            <div>
              <dt>Answer</dt>
              <dd class="form-quiet">
                <template v-if="fields.operation === 'fanout'">deduplicated by URL, failures kept in errors</template>
                <template v-else-if="named">create("{{ named.key }}") · {{ named.host }}</template>
                <template v-else>first configured provider, the next one on failure</template>
              </dd>
            </div>
          </dl>

          <dl v-else-if="fields.operation === 'read'" class="console-readout-rows">
            <div>
              <dt><label for="explorer-url">URL</label></dt>
              <dd>
                <UInput
                  id="explorer-url"
                  v-model="fields.url"
                  variant="none"
                  placeholder="https://example.com/article"
                  spellcheck="false"
                  autocomplete="off"
                  :maxlength="2048"
                  class="w-full"
                />
              </dd>
            </div>
            <div>
              <dt>Reader</dt>
              <dd>
                <USelectMenu
                  v-model="fields.reader"
                  :items="readerItems"
                  value-key="value"
                  :icon="named?.icon ?? 'i-lucide-shuffle'"
                  variant="none"
                  :search-input="false"
                  aria-label="Reader"
                  class="w-full"
                />
              </dd>
            </div>
            <div>
              <dt>Bound</dt>
              <dd>
                <USelectMenu
                  v-model="fields.maxChars"
                  :items="boundItems"
                  value-key="value"
                  variant="none"
                  :search-input="false"
                  aria-label="Maximum characters"
                  class="w-full"
                />
              </dd>
            </div>
          </dl>

          <dl v-else class="console-readout-rows">
            <div>
              <dt>Source</dt>
              <dd>listProviders() on the docs worker</dd>
            </div>
            <div>
              <dt>Shows</dt>
              <dd class="console-accent">which providers the worker holds a key for</dd>
            </div>
            <div>
              <dt>Keys</dt>
              <dd class="form-quiet">never sent to the page</dd>
            </div>
          </dl>
        </div>
        <p v-if="problem" class="web-error form-problem" role="alert">
          <span class="console-tag">Input</span>{{ problem }}
        </p>
        <div class="form-actions">
          <UButton
            type="submit"
            color="primary"
            variant="solid"
            :trailing-icon="ACTIONS[fields.operation].icon"
            :label="ACTIONS[fields.operation].label"
          />
          <div v-if="fields.operation === 'search' || fields.operation === 'fanout'" class="form-examples" aria-label="Example queries">
            <UButton
              v-for="example in EXAMPLE_QUERIES"
              :key="example"
              :color="fields.query === example ? 'primary' : 'neutral'"
              variant="chip"
              :label="example"
              @click="pickQuery(example)"
            />
          </div>
          <div v-else-if="fields.operation === 'read'" class="form-examples" aria-label="Example pages">
            <UButton
              v-for="example in EXAMPLE_URLS"
              :key="example"
              :color="fields.url === example ? 'primary' : 'neutral'"
              variant="chip"
              :label="hostPath(example)"
              @click="pickUrl(example)"
            />
          </div>
        </div>
      </div>
    </div>

    <footer class="console-footer console-footer-plain">
      <ul class="console-links">
        <li>
          <NuxtLink to="/providers"><span aria-hidden="true">→ </span>Providers</NuxtLink>
        </li>
        <li>
          <NuxtLink to="/guide/explorer"><span aria-hidden="true">→ </span>How it works</NuxtLink>
        </li>
      </ul>
      <span class="console-meta">answered by the docs worker</span>
    </footer>
  </form>
</template>

<style scoped>
.form-tabs {
  padding: 0 20px;
}
.form-band {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.form-glyph {
  width: 84px;
}
.form-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  min-width: 0;
}
.form-fields .console-readout-rows > div {
  grid-template-columns: 6.5rem minmax(0, 1fr);
}
.form-quiet {
  color: var(--ui-text-muted);
}
.form-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
}
.form-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.form-examples > * {
  max-width: 100%;
}
@media (width < 640px) {
  .form-tabs {
    padding: 0 14px;
    overflow-x: auto;
  }
  .form-tabs :deep([data-slot="leadingIcon"]) {
    display: none;
  }
  .form-band {
    grid-template-columns: minmax(0, 1fr);
  }
  .form-glyph {
    display: none;
  }
  .form-fields .console-readout-rows > div {
    grid-template-columns: 5rem minmax(0, 1fr);
  }
}
</style>
