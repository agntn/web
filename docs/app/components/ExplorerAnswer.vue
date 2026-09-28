<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import type { useExplorer } from "../composables/useExplorer";
import { OPERATIONS, cliLine, type ProviderRow, type WireResult } from "../utils/explorer";
import { bareUrl, clip, dateOnly, hostOf, plainText, pluralize, shortStamp, webHref } from "../utils/format";
import { providerIcon, providerInfo, providerLabel } from "../utils/providers";
import { ROSTER_TABLE_UI } from "../utils/roster";
import { STACK } from "../utils/table-stack";

/**
 * The answer to the last run: what it asked on the subject band, the answer as rows, the worker's
 * whole JSON in a dialog, and the same run as a CLI line.
 */
const props = defineProps<{ explorer: ReturnType<typeof useExplorer> }>();

const { asked, answers, loading, error } = props.explorer;

const { copied, copy } = useCopied();

const operation = computed(() => OPERATIONS.find((entry) => entry.key === asked.value.operation)!);
const search = computed(() => (asked.value.operation === "search" ? answers.search : undefined));
const fanout = computed(() => (asked.value.operation === "fanout" ? answers.fanout : undefined));
const read = computed(() => (asked.value.operation === "read" ? answers.read : undefined));
const listing = computed(() => (asked.value.operation === "providers" ? answers.providers : undefined));
const answer = computed(() => search.value ?? fanout.value ?? read.value ?? listing.value);

/** The provider that answered, or the one the run named while it waits. */
const provider = computed(() => {
  if (search.value) return search.value.provider;
  if (read.value) return read.value.provider;
  const { operation: op, provider: name, reader } = asked.value;
  if (op === "search" && name !== "auto") return name;
  if (op === "read" && reader !== "auto") return reader;
  return undefined;
});

const icon = computed(() => (provider.value ? providerIcon(provider.value) : operation.value.icon));

const call = computed(() => {
  const { operation: op, query, url, maxChars } = asked.value;
  if (op === "search" || op === "fanout") return `${operation.value.method}("${query}")`;
  if (op === "read") return `${operation.value.method}("${url}", { maxChars: ${maxChars} })`;
  return `${operation.value.method}()`;
});

const cli = computed(() => cliLine(asked.value));

const meta = computed(() => {
  if (loading.value) return "asking the docs worker";
  if (error.value) return "no answer";
  const current = answer.value;
  if (!current) return "";
  if ("fetchedAt" in current) return `fetched ${shortStamp(current.fetchedAt)}`;
  return `@agntn/web ${current.version}`;
});

/** The run's subject: the query, the page or the catalog. */
const subject = computed(() => {
  const { operation: op, query, url } = asked.value;
  if (op === "read") {
    return {
      label: provider.value ? `Page / ${providerLabel(provider.value)}` : "Page",
      name: read.value?.title || hostOf(url),
    };
  }
  if (op === "providers") return { label: "Catalog", name: "Providers" };
  return {
    label: op === "fanout" ? "Query / every provider" : provider.value ? `Query / ${providerLabel(provider.value)}` : "Query",
    name: query,
  };
});

const about = computed(() => {
  if (loading.value) return `Asking ${provider.value ? providerLabel(provider.value) : "the docs worker"}.`;
  if (error.value) return error.value;
  if (search.value) {
    return search.value.results.length
      ? `${pluralize(search.value.results.length, "result")}, the same { url, title, snippet } shape every provider answers in.`
      : "The provider returned no results for this query.";
  }
  if (fanout.value) {
    return `${pluralize(fanout.value.results.length, "unique URL")} from ${fanout.value.successfulProviders.length} of ${pluralize(fanout.value.providers.length, "provider")}, deduplicated by normalized URL.`;
  }
  if (read.value) return read.value.description ? plainText(read.value.description) : bareUrl(read.value.url);
  if (listing.value) return "What the library reports on the docs worker: the capability matrix, and whether the worker holds a key.";
  return "";
});

/** Fallback order of an automatic run, with why the earlier ones failed. */
const chain = computed(() => {
  const current = search.value ?? read.value;
  if (!current) return [];
  const names = current.attempts?.length ? current.attempts : [current.provider];
  return names.map((name) => ({
    name,
    ok: name === current.provider,
    message: current.failures?.find((failure) => failure.provider === name)?.message ?? "",
  }));
});

const shared = computed(() => fanout.value?.results.filter((result) => result.providers.length > 1).length ?? 0);

/** What the dialog holds: the worker's answer as it arrived. */
const raw = computed(() => (answer.value ? JSON.stringify(answer.value, null, 2) : ""));

function resultMeta(result: WireResult): string {
  return [
    result.publishedDate ? `published ${dateOnly(result.publishedDate)}` : "",
    typeof result.score === "number" ? `score ${result.score.toFixed(3)}` : "",
    result.author ? `by ${plainText(result.author)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const providerColumns: TableColumn<ProviderRow>[] = [
  { accessorKey: "name", header: "Provider" },
  { accessorKey: "configured", header: "Worker", meta: { class: { th: "w-[7rem]", td: STACK.end } } },
  { id: "search", header: "Search", meta: { class: { th: "w-[9.5rem]", td: STACK.lastStart } } },
  { id: "read", header: "Read", meta: { class: { th: "w-[10rem]", td: STACK.line } } },
  { id: "filters", header: "Filters", meta: { class: { th: "w-[16rem] text-end", td: `text-end ${STACK.lastEnd}` } } },
];

function searchCell(row: ProviderRow): string {
  const search = row.capabilities.search;
  if (!search.supported) return "no";
  const limit = search.resultLimit?.maximum ? `up to ${search.resultLimit.maximum}` : "yes";
  return search.pagination ? `${limit} · pages` : limit;
}
</script>

<template>
  <section class="tool-console console-wide answer not-prose" aria-label="Explorer answer">
    <span class="console-cross console-cross-tl" aria-hidden="true">+</span>
    <span class="console-cross console-cross-br" aria-hidden="true">+</span>

    <header class="console-bar">
      <UTooltip :text="call">
        <span class="console-title" tabindex="0"
          ><span class="console-tag">{{ operation.label }}</span>{{ call }}</span
        >
      </UTooltip>
      <span class="console-meta">{{ meta }}</span>
      <span class="console-mark" aria-hidden="true" />
    </header>
    <div class="console-ruler" aria-hidden="true">
      <span :key="call" class="console-cursor" :class="{ 'console-cursor-busy': loading }" />
    </div>

    <div class="console-band console-subject-band">
      <div :key="call" class="console-scan" aria-hidden="true" />
      <div class="console-identity-block">
        <ConsoleReticle :key="icon" :icon="icon" />
        <div class="console-name">
          <span class="console-label">{{ subject.label }}</span>
          <!-- Titles and descriptions come from somebody else's page: interpolated, never markup. -->
          <h3 class="answer-name">{{ subject.name }}</h3>
          <p class="console-about" :class="{ 'answer-error': error && !loading }">{{ about }}</p>
        </div>
      </div>

      <div class="console-readout">
        <svg class="console-link" viewBox="0 0 32 40" fill="none" aria-hidden="true">
          <circle cx="3" cy="12" r="2.5" />
          <path d="M5.5 12H14L22 20H32" />
        </svg>
        <dl v-if="search" class="console-readout-rows">
          <div>
            <dt>Provider</dt>
            <dd class="console-accent">{{ providerLabel(search.provider) }}</dd>
          </div>
          <div>
            <dt>Results</dt>
            <dd>{{ search.results.length }}</dd>
          </div>
          <div>
            <dt>Pagination</dt>
            <dd>{{ search.pagination }}</dd>
          </div>
          <div>
            <dt>Ignored</dt>
            <dd :class="{ 'answer-dim': !search.ignoredFilters.length }">
              {{ search.ignoredFilters.join(", ") || "no filter" }}
            </dd>
          </div>
        </dl>
        <dl v-else-if="fanout" class="console-readout-rows">
          <div>
            <dt>Unique URLs</dt>
            <dd class="console-accent">{{ fanout.results.length }}</dd>
          </div>
          <div>
            <dt>Shared</dt>
            <dd>{{ shared }} <span class="answer-dim">by more than one</span></dd>
          </div>
          <div>
            <dt>Answered</dt>
            <dd>{{ fanout.successfulProviders.length }} <span class="answer-dim">of {{ fanout.providers.length }}</span></dd>
          </div>
          <div>
            <dt>Errors</dt>
            <dd :class="{ 'answer-dim': !fanout.errors.length }">{{ fanout.errors.length }}</dd>
          </div>
        </dl>
        <dl v-else-if="read" class="console-readout-rows">
          <div>
            <dt>Reader</dt>
            <dd class="console-accent">{{ providerLabel(read.provider) }}</dd>
          </div>
          <div>
            <dt>Characters</dt>
            <dd>{{ read.chars.toLocaleString("en-US") }}</dd>
          </div>
          <div>
            <dt>Truncated</dt>
            <dd>{{ read.truncated ? "yes, a continuation carries the rest" : "no" }}</dd>
          </div>
          <div>
            <dt>Host</dt>
            <dd><span class="answer-line">{{ hostOf(read.url) }}</span></dd>
          </div>
        </dl>
        <dl v-else-if="listing" class="console-readout-rows">
          <div>
            <dt>Providers</dt>
            <dd>{{ listing.providers.length }}</dd>
          </div>
          <div>
            <dt>Ready</dt>
            <dd class="console-accent">{{ listing.providers.filter((row) => row.configured).length }}</dd>
          </div>
          <div>
            <dt>Readers</dt>
            <dd>{{ listing.providers.filter((row) => row.capabilities.read.supported).length }}</dd>
          </div>
        </dl>
        <dl v-else class="console-readout-rows">
          <div>
            <dt>Route</dt>
            <dd>{{ operation.route }}</dd>
          </div>
          <div>
            <dt>Calls</dt>
            <dd>{{ operation.method }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <div v-if="loading" class="web-band">
      <p class="web-note" role="status">
        <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" aria-hidden="true" />
        {{ asked.operation === "read" ? "Reading the page…" : asked.operation === "providers" ? "Listing providers…" : "Asking the provider…" }}
      </p>
    </div>
    <div v-else-if="error" class="web-band">
      <UAlert color="error" variant="outline" icon="i-lucide-circle-x" :title="error" role="alert" />
    </div>

    <template v-else>
      <div v-if="chain.length > 1" class="web-band">
        <p class="console-label console-rule-title">
          <span>Fallback <span aria-hidden="true">[ tried in order ]</span></span>
          <span class="console-mark" aria-hidden="true" />
        </p>
        <ol class="answer-chain">
          <li v-for="(step, index) in chain" :key="step.name" class="console-lead">
            <span class="console-tag">{{ String(index + 1).padStart(2, "0") }}</span>
            <span :class="step.ok ? 'answer-ok' : 'answer-failed'">{{ providerLabel(step.name) }}</span>
            <span class="console-leader" aria-hidden="true" />
            <span class="answer-dim">{{ step.ok ? "answered" : clip(step.message || "failed", 90) }}</span>
          </li>
        </ol>
      </div>

      <div v-if="fanout" class="web-band">
        <p class="console-label console-rule-title">
          <span>Providers <span aria-hidden="true">[ answered · failed · not asked ]</span></span>
          <span class="console-mark" aria-hidden="true" />
        </p>
        <ProviderCells :asked="fanout.providers" :successful="fanout.successfulProviders" :errors="fanout.errors" />
      </div>

      <ol v-if="search?.results.length || fanout?.results.length" class="answer-results">
        <li v-for="(result, index) in search?.results ?? fanout?.results ?? []" :key="result.url">
          <span class="answer-index">{{ String(index + 1).padStart(2, "0") }}</span>
          <div class="answer-result">
            <a v-if="webHref(result.url)" :href="webHref(result.url)" target="_blank" rel="noopener nofollow" class="answer-title">{{
              plainText(result.title) || result.url
            }}</a>
            <span v-else class="answer-title">{{ plainText(result.title) || result.url }}</span>
            <span class="answer-url">{{ result.url }}</span>
            <p class="answer-snippet">{{ plainText(result.snippet) }}</p>
            <p v-if="result.highlights?.length" class="answer-snippet answer-dim">{{ plainText(result.highlights[0]!) }}</p>
            <p v-if="resultMeta(result)" class="answer-meta">{{ resultMeta(result) }}</p>
            <p v-if="'providers' in result" class="answer-tags">
              <span v-for="name in (result as WireResult & { providers: string[] }).providers" :key="name" class="console-tag">{{
                providerLabel(name)
              }}</span>
            </p>
          </div>
        </li>
      </ol>

      <div v-if="search && (search.ignoredFilters.length || search.undeclaredFilters.length)" class="web-band">
        <p class="web-note">
          Ignored {{ search.ignoredFilters.join(", ") || "none" }}, undeclared
          {{ search.undeclaredFilters.join(", ") || "none" }}.
        </p>
      </div>

      <div v-if="read" class="web-band">
        <p class="console-label console-rule-title">
          <span>Page <span aria-hidden="true">[ {{ read.chars.toLocaleString("en-US") }} characters, Markdown ]</span></span>
          <span class="console-mark" aria-hidden="true" />
        </p>
        <!-- The page's own text: interpolated into a pre, never rendered as markup. -->
        <pre class="answer-page">{{ read.content }}</pre>
      </div>

      <UTable
        v-if="listing"
        :data="listing.providers"
        :columns="providerColumns"
        :get-row-id="(row) => row.name"
        :ui="ROSTER_TABLE_UI"
      >
        <template #name-cell="{ row }">
          <NuxtLink :to="providerInfo(row.original.name)?.to ?? '/providers'" class="answer-provider">
            <UIcon :name="providerIcon(row.original.name)" class="size-3.5 flex-none" aria-hidden="true" />
            <span>{{ providerLabel(row.original.name) }}</span>
          </NuxtLink>
        </template>
        <template #configured-cell="{ row }">
          <UBadge
            color="neutral"
            :variant="row.original.configured ? 'subtle' : 'outline'"
            :label="row.original.configured ? 'ready' : 'no key'"
          />
        </template>
        <template #search-cell="{ row }">
          <span class="list-sub">{{ searchCell(row.original) }}</span>
        </template>
        <template #read-cell="{ row }">
          <span class="list-sub">{{
            row.original.capabilities.read.supported ? (row.original.capabilities.read.formats ?? []).join(", ") || "yes" : "no"
          }}</span>
        </template>
        <template #filters-cell="{ row }">
          <span class="list-sub">{{ row.original.capabilities.search.filters?.join(", ") || "none" }}</span>
        </template>
      </UTable>
    </template>

    <ConsoleResponse
      v-if="raw && !loading"
      :title="call"
      :text="raw"
      label="Full answer"
      :source="operation.route"
      description="The whole answer the docs worker returned, as JSON."
    />

    <footer class="console-footer console-footer-plain">
      <span class="answer-cli"
        ><span class="answer-prompt">$ </span><span class="answer-cli-text">{{ cli }}</span>
        <UButton
          color="neutral"
          variant="subtle"
          :icon="copied === 'cli' ? 'i-lucide-check' : 'i-lucide-copy'"
          :aria-label="copied === 'cli' ? 'Copied' : 'Copy the CLI command'"
          @click="copy('cli', cli)"
      /></span>
      <span class="console-meta">every state is a link</span>
    </footer>
  </section>
</template>

<style scoped>
.answer-name {
  overflow-wrap: anywhere;
}
.answer-error {
  color: var(--web-del);
}
.answer-dim {
  color: var(--ui-text-dimmed);
}
.answer-ok {
  color: var(--ui-text-highlighted);
}
.answer-failed {
  color: var(--web-del);
}
.answer-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.answer-chain {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.answer-chain > .console-lead {
  margin: 0;
  min-width: 0;
}
.answer-chain > .console-lead > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.answer-results {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--console-line);
}
.answer-results > li {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
  gap: 12px;
  padding: 12px 20px;
}
.answer-results > li + li {
  box-shadow: inset 0 1px 0 var(--console-line);
}
.answer-index {
  padding-top: 2px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ui-text-dimmed);
}
.answer-result {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.answer-title {
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--ui-text-highlighted);
  overflow-wrap: anywhere;
}
a.answer-title:hover {
  color: var(--console-accent);
}
a.answer-title:focus-visible {
  outline: 1px solid var(--ui-primary);
  outline-offset: 2px;
}
.answer-url {
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-muted);
}
.answer-snippet {
  margin: 2px 0 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.55;
  color: var(--ui-text-muted);
  overflow-wrap: anywhere;
}
.answer-meta {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ui-text-dimmed);
}
.answer-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 4px 0 0;
}
.answer-tags > .console-tag {
  margin: 0;
}
.answer-page {
  max-height: 32rem;
  margin: 0;
  overflow: auto;
  overscroll-behavior: contain;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.85;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ui-text);
}
.answer-provider {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  color: var(--ui-text-highlighted);
}
.answer-provider:hover {
  color: var(--console-accent);
}
.answer-cli {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-family: var(--font-mono);
}
.answer-cli-text {
  overflow-wrap: anywhere;
}
.answer-prompt {
  color: var(--ui-text-dimmed);
}
@media (width < 640px) {
  .answer-results > li {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    padding-inline: 14px;
  }
}
</style>
