<script setup lang="ts">
import { clip, dateOnly, hostOf, hostPath, plainText, pluralize, withScheme } from "../../utils/format";
import { PROVIDERS, READ_PROVIDERS, SEARCH_PROVIDERS, providerIcon, providerLabel } from "../../utils/providers";

interface WireResult {
  url: string;
  title: string;
  snippet: string;
  score?: number;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
  summary?: string;
}

interface WireFailure {
  provider: string;
  message: string;
}

interface SearchAnswer {
  query: string;
  requestedProvider: string;
  provider: string;
  results: WireResult[];
  pagination: string;
  ignoredFilters: string[];
  undeclaredFilters: string[];
  attempts?: string[];
  failures?: WireFailure[];
  fetchedAt: string;
}

interface FanoutAnswer {
  query: string;
  results: (WireResult & { providers: string[] })[];
  providers: string[];
  successfulProviders: string[];
  errors: WireFailure[];
  providerPagination: { provider: string; status: string }[];
  fetchedAt: string;
}

interface ReadAnswer {
  url: string;
  title: string;
  description: string;
  content: string;
  chars: number;
  truncated: boolean;
  requestedProvider: string;
  provider: string;
  attempts: string[];
  failures: WireFailure[];
  fetchedAt: string;
}

interface ProviderRow {
  name: string;
  configured: boolean;
  envVar: string | null;
  capabilities: {
    search: { supported: boolean; filters?: string[]; contentOptions?: string[]; pagination?: boolean; resultLimit?: { default?: number; maximum?: number }; resultFields?: string[] };
    searchImage: { supported: boolean };
    read: { supported: boolean; formats?: string[] };
  };
}

interface ProvidersAnswer {
  version: string;
  providers: ProviderRow[];
}

type Operation = "search" | "fanout" | "read" | "providers";

const OPERATIONS: ReadonlyArray<{ key: Operation; label: string; icon: string }> = [
  { key: "search", label: "Search", icon: "i-lucide-search" },
  { key: "fanout", label: "Fan-out", icon: "i-lucide-git-fork" },
  { key: "read", label: "Read", icon: "i-lucide-file-text" },
  { key: "providers", label: "Providers", icon: "i-lucide-layers" },
];

const EXAMPLE_QUERIES = ["TypeScript 7 native compiler", "Model Context Protocol tool result schema", "Nitro cloudflare workers preset"] as const;
const EXAMPLE_URLS = ["https://nitro.build/deploy/providers/cloudflare", "https://modelcontextprotocol.io/specification/draft/server/tools"] as const;

const router = useRouter();
const route = useRoute();

const operation = ref<Operation>("search");
const query = ref("TypeScript 7 native compiler");
const url = ref("https://nitro.build/deploy/providers/cloudflare");
const provider = ref("auto");
const reader = ref("auto");
const maxChars = ref(2000);

const state = reactive<{
  loading: boolean;
  error?: string;
  search?: SearchAnswer;
  fanout?: FanoutAnswer;
  read?: ReadAnswer;
  providers?: ProvidersAnswer;
}>({ loading: false });

const cliLine = computed(() => {
  switch (operation.value) {
    case "search":
      return `web search "${query.value}"${provider.value === "auto" ? "" : ` --provider ${provider.value}`} --json`;
    case "fanout":
      return `web search "${query.value}" --provider all --json`;
    case "read":
      return `web read ${withScheme(url.value)}${reader.value === "auto" ? "" : ` --provider ${reader.value}`} --max-chars ${maxChars.value} --json`;
    default:
      return "web providers";
  }
});

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const data = error as { statusCode?: number; statusMessage?: string; data?: { statusMessage?: string }; message?: string };
    const message = data.data?.statusMessage ?? data.statusMessage ?? data.message;
    if (message) {
      return data.statusCode ? `${data.statusCode}: ${message}` : message;
    }
  }
  return String(error);
}

function currentQuery(): Record<string, string> {
  switch (operation.value) {
    case "search":
      return { op: "search", q: query.value.trim(), provider: provider.value };
    case "fanout":
      return { op: "fanout", q: query.value.trim() };
    case "read":
      return { op: "read", url: withScheme(url.value), provider: reader.value, maxChars: String(maxChars.value) };
    default:
      return { op: "providers" };
  }
}

async function run(op: Operation = operation.value) {
  operation.value = op;
  state.loading = true;
  state.error = undefined;
  await router.replace({ query: currentQuery() });
  /** The stripped prerender address is not rewritten by a replace to an identical route. */
  if (import.meta.client && window.location.pathname + window.location.search !== route.fullPath) {
    window.history.replaceState(window.history.state, "", route.fullPath);
  }
  try {
    if (op === "search") {
      state.search = await $fetch<SearchAnswer>("/api/search", {
        query: { q: query.value.trim(), provider: provider.value, maxResults: 10 },
        retry: 0,
      });
    } else if (op === "fanout") {
      state.fanout = await $fetch<FanoutAnswer>("/api/all", { query: { q: query.value.trim(), maxResults: 10 }, retry: 0 });
    } else if (op === "read") {
      state.read = await $fetch<ReadAnswer>("/api/read", {
        query: { url: withScheme(url.value), provider: reader.value, maxChars: maxChars.value },
        retry: 0,
      });
    } else if (!state.providers) {
      state.providers = await $fetch<ProvidersAnswer>("/api/providers", { retry: 0 });
    }
  } catch (error) {
    state.error = errorText(error);
  } finally {
    state.loading = false;
  }
}

function pickQuery(example: string) {
  query.value = example;
  void run(operation.value === "fanout" ? "fanout" : "search");
}

function pickUrl(example: string) {
  url.value = example;
  void run("read");
}

const copied = ref(false);

async function copyCli() {
  try {
    await navigator.clipboard.writeText(cliLine.value);
  } catch {
    return;
  }
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1200);
}

function chainOf(answer: { attempts?: string[]; provider: string }): string[] {
  return answer.attempts?.length ? answer.attempts : [answer.provider];
}

/** Deep link and first run happen after mount, once the router has restored the address a prerendered page lost. */
const applied = ref(false);

function apply(params: Readonly<Record<string, unknown>>) {
  applied.value = true;
  const op = typeof params.op === "string" && OPERATIONS.some((row) => row.key === params.op) ? (params.op as Operation) : "search";
  if (typeof params.q === "string" && params.q) {
    query.value = params.q;
  }
  if (typeof params.url === "string" && params.url) {
    url.value = params.url;
  }
  if (typeof params.provider === "string" && params.provider) {
    if (op === "read") {
      reader.value = params.provider;
    } else {
      provider.value = params.provider;
    }
  }
  if (typeof params.maxChars === "string" && Number.isInteger(Number(params.maxChars))) {
    maxChars.value = Math.min(8000, Math.max(200, Number(params.maxChars)));
  }
  void run(op);
}

onMounted(() => {
  if (!applied.value) {
    apply(route.query);
  }
});
</script>

<template>
  <div class="space-y-5">
    <nav aria-label="Operation" class="web-explorer-nav !mt-0 !justify-start">
      <button
        v-for="op in OPERATIONS"
        :key="op.key"
        type="button"
        class="web-explorer-link"
        :class="{ 'web-explorer-link-active': operation === op.key }"
        @click="run(op.key)"
      >
        <UIcon :name="op.icon" class="size-3.5" />
        {{ op.label }}
      </button>
      <button type="button" class="web-copy ms-auto" :aria-label="copied ? 'Copied' : 'Copy CLI command'" @click="copyCli">
        <span class="text-dimmed">$</span> {{ clip(cliLine, 72) }}
        <UIcon :name="copied ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3.5" />
      </button>
    </nav>

    <form v-if="operation === 'search' || operation === 'fanout'" class="web-frame overflow-hidden rounded-xl" @submit.prevent="run()">
      <div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <label class="sr-only" for="explorer-query">Query</label>
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <UIcon name="i-lucide-search" class="size-4 shrink-0 text-primary" />
          <input id="explorer-query" v-model="query" class="web-field" placeholder="What to search for" spellcheck="false" autocomplete="off" maxlength="256" />
        </div>
        <select v-if="operation === 'search'" v-model="provider" class="web-field sm:w-44" aria-label="Provider">
          <option value="auto">auto · first configured</option>
          <option v-for="row in SEARCH_PROVIDERS" :key="row.key" :value="row.key">{{ row.label }}</option>
        </select>
        <button type="submit" class="web-btn web-primary-fill" :disabled="state.loading">
          <UIcon v-if="state.loading" name="i-lucide-loader-circle" class="size-4 animate-spin" />
          <UIcon v-else :name="operation === 'fanout' ? 'i-lucide-git-fork' : 'i-lucide-search'" class="size-4" />
          {{ operation === "fanout" ? "Ask every provider" : "Search" }}
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 border-t border-muted px-4 py-3">
        <span class="me-1 font-mono text-[11px] text-dimmed">try</span>
        <button v-for="example in EXAMPLE_QUERIES" :key="example" type="button" class="web-copy" @click="pickQuery(example)">
          {{ example }}
        </button>
      </div>
    </form>

    <form v-else-if="operation === 'read'" class="web-frame overflow-hidden rounded-xl" @submit.prevent="run()">
      <div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <label class="sr-only" for="explorer-url">URL</label>
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <UIcon name="i-lucide-link" class="size-4 shrink-0 text-primary" />
          <input id="explorer-url" v-model="url" class="web-field font-mono" placeholder="https://example.com/article" spellcheck="false" autocomplete="off" maxlength="2048" />
        </div>
        <select v-model="reader" class="web-field sm:w-40" aria-label="Reader">
          <option value="auto">auto · Jina first</option>
          <option v-for="row in READ_PROVIDERS" :key="row.key" :value="row.key">{{ row.label }}</option>
        </select>
        <select v-model.number="maxChars" class="web-field sm:w-32" aria-label="Maximum characters">
          <option :value="500">500 chars</option>
          <option :value="2000">2 000 chars</option>
          <option :value="8000">8 000 chars</option>
        </select>
        <button type="submit" class="web-btn web-primary-fill" :disabled="state.loading">
          <UIcon v-if="state.loading" name="i-lucide-loader-circle" class="size-4 animate-spin" />
          <UIcon v-else name="i-lucide-file-text" class="size-4" />
          Read
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 border-t border-muted px-4 py-3">
        <span class="me-1 font-mono text-[11px] text-dimmed">try</span>
        <button v-for="example in EXAMPLE_URLS" :key="example" type="button" class="web-copy" @click="pickUrl(example)">
          {{ hostPath(example) }}
        </button>
      </div>
    </form>

    <p v-if="state.loading" class="web-frame flex items-center gap-2 rounded-xl px-5 py-4 text-sm text-muted">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
      {{ operation === "read" ? "Reading the page…" : operation === "providers" ? "Listing providers…" : "Asking the provider…" }}
    </p>
    <pre v-else-if="state.error" class="web-body web-frame rounded-xl" :style="{ color: 'var(--web-del)' }">{{ state.error }}</pre>

    <div v-else-if="operation === 'search' && state.search" class="web-frame overflow-hidden rounded-xl">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
        <UIcon :name="providerIcon(state.search.provider)" class="size-4 text-primary" />
        <span class="text-sm font-medium text-highlighted">{{ providerLabel(state.search.provider) }}</span>
        <span class="font-mono text-[11px] text-dimmed">{{ pluralize(state.search.results.length, "result") }} · pagination {{ state.search.pagination }}</span>
        <span class="ms-auto font-mono text-[11px] text-dimmed">fetched {{ dateOnly(state.search.fetchedAt) }}</span>
      </div>
      <div v-if="state.search.attempts && state.search.attempts.length > 1" class="flex flex-wrap items-center gap-2 border-b border-muted px-4 py-2.5 font-mono text-[11px] text-dimmed">
        <span>fallback</span>
        <template v-for="(name, i) in chainOf(state.search)" :key="name">
          <span v-if="i > 0">→</span>
          <span class="web-chip" :class="name === state.search.provider ? 'web-chip-ok' : 'web-chip-failed'" :title="state.search.failures?.find((f) => f.provider === name)?.message">
            <span class="web-chip-dot" />{{ providerLabel(name) }}
          </span>
        </template>
      </div>
      <p v-if="!state.search.results.length" class="px-4 py-4 text-sm text-muted">The provider returned no results for this query.</p>
      <ol class="divide-y divide-muted">
        <li v-for="(result, i) in state.search.results" :key="result.url" class="flex gap-3 px-4 py-3">
          <span class="mt-0.5 w-5 shrink-0 font-mono text-[11px] text-dimmed">{{ i + 1 }}</span>
          <div class="min-w-0 flex-1">
            <a :href="result.url" target="_blank" rel="noopener nofollow" class="block truncate text-sm font-medium text-highlighted hover:text-primary">{{ plainText(result.title) || result.url }}</a>
            <p class="mt-0.5 truncate font-mono text-[11px] text-primary">{{ result.url }}</p>
            <p class="mt-1 text-[13px] leading-5 text-muted">{{ plainText(result.snippet) }}</p>
            <p v-if="result.highlights?.length" class="mt-1 text-[13px] leading-5 text-dimmed italic">{{ plainText(result.highlights[0]!) }}</p>
            <p v-if="result.publishedDate || typeof result.score === 'number' || result.author" class="mt-1 font-mono text-[11px] text-dimmed">
              <span v-if="result.publishedDate">published {{ dateOnly(result.publishedDate) }}</span>
              <span v-if="typeof result.score === 'number'" class="ms-2">score {{ result.score.toFixed(3) }}</span>
              <span v-if="result.author" class="ms-2">by {{ plainText(result.author) }}</span>
            </p>
          </div>
        </li>
      </ol>
      <div v-if="state.search.ignoredFilters.length || state.search.undeclaredFilters.length" class="border-t border-muted px-4 py-3 font-mono text-[11px] text-dimmed">
        ignored {{ state.search.ignoredFilters.join(", ") || "none" }} · undeclared {{ state.search.undeclaredFilters.join(", ") || "none" }}
      </div>
    </div>

    <div v-else-if="operation === 'fanout' && state.fanout" class="web-frame overflow-hidden rounded-xl">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
        <span class="text-sm font-medium text-highlighted">{{ pluralize(state.fanout.results.length, "unique URL") }}</span>
        <span class="font-mono text-[11px] text-dimmed">{{ state.fanout.successfulProviders.length }} of {{ state.fanout.providers.length }} providers answered</span>
        <span class="ms-auto font-mono text-[11px] text-dimmed">fetched {{ dateOnly(state.fanout.fetchedAt) }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 border-b border-muted px-4 py-2.5">
        <span v-for="name in state.fanout.providers" :key="name" class="web-chip" :class="state.fanout.successfulProviders.includes(name) ? 'web-chip-ok' : 'web-chip-failed'" :title="state.fanout.errors.find((e) => e.provider === name)?.message">
          <span class="web-chip-dot" />{{ providerLabel(name) }}
        </span>
      </div>
      <ol class="divide-y divide-muted">
        <li v-for="result in state.fanout.results" :key="result.url" class="px-4 py-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <a :href="result.url" target="_blank" rel="noopener nofollow" class="block truncate text-sm font-medium text-highlighted hover:text-primary">{{ plainText(result.title) || result.url }}</a>
              <p class="mt-0.5 truncate font-mono text-[11px] text-primary">{{ result.url }}</p>
              <p class="mt-1 text-[13px] leading-5 text-muted">{{ clip(plainText(result.snippet), 220) }}</p>
            </div>
            <div class="flex shrink-0 flex-wrap justify-end gap-1">
              <span v-for="name in result.providers" :key="name" class="web-chip web-chip-small">{{ providerLabel(name) }}</span>
            </div>
          </div>
        </li>
      </ol>
      <div v-if="state.fanout.errors.length" class="border-t border-muted px-4 py-3">
        <p v-for="entry in state.fanout.errors" :key="entry.provider" class="font-mono text-[11px] text-dimmed">
          <span :style="{ color: 'var(--web-del)' }">{{ entry.provider }}</span> · {{ entry.message }}
        </p>
      </div>
    </div>

    <div v-else-if="operation === 'read' && state.read" class="web-frame overflow-hidden rounded-xl">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted px-4 py-3">
        <span class="min-w-0 truncate text-sm font-medium text-highlighted">{{ state.read.title || hostOf(state.read.url) }}</span>
        <span class="ms-auto font-mono text-[11px] text-dimmed">{{ state.read.chars }} chars · truncated {{ state.read.truncated }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2 border-b border-muted px-4 py-2.5 font-mono text-[11px] text-dimmed">
        <span>readers</span>
        <template v-for="(name, i) in chainOf(state.read)" :key="name">
          <span v-if="i > 0">→</span>
          <span class="web-chip" :class="name === state.read.provider ? 'web-chip-ok' : 'web-chip-failed'" :title="state.read.failures.find((f) => f.provider === name)?.message">
            <span class="web-chip-dot" />{{ providerLabel(name) }}
          </span>
        </template>
        <a :href="state.read.url" target="_blank" rel="noopener nofollow" class="ms-auto truncate hover:text-primary">{{ state.read.url }}</a>
      </div>
      <p v-if="state.read.description" class="border-b border-muted px-4 py-3 text-sm text-muted">{{ plainText(state.read.description) }}</p>
      <pre class="web-body">{{ state.read.content }}</pre>
    </div>

    <div v-else-if="operation === 'providers' && state.providers" class="web-frame overflow-hidden rounded-xl">
      <div class="flex items-center justify-between gap-3 border-b border-muted px-4 py-3">
        <p class="font-mono text-xs text-muted">listProviders() on the docs worker · @agntn/web {{ state.providers.version }}</p>
        <p class="font-mono text-[11px] text-dimmed">configured means the worker holds a key</p>
      </div>
      <div class="web-table-wrap">
        <table class="web-table">
          <thead>
            <tr><th>provider</th><th>configured</th><th>search</th><th>image</th><th>read</th><th>pagination</th><th>filters</th><th>result fields</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in state.providers.providers" :key="row.name">
              <td>
                <NuxtLink :to="PROVIDERS.find((p) => p.key === row.name)?.to ?? '/providers'" class="inline-flex items-center gap-2 text-sm text-highlighted hover:text-primary">
                  <UIcon :name="providerIcon(row.name)" class="size-4 text-muted" />
                  {{ providerLabel(row.name) }}
                </NuxtLink>
              </td>
              <td><span class="web-state" :class="row.configured ? 'web-state-ok' : ''">{{ row.configured ? "yes" : row.envVar ? "no key" : "n/a" }}</span></td>
              <td class="font-mono text-xs text-muted">{{ row.capabilities.search.supported ? (row.capabilities.search.resultLimit?.maximum ? `≤ ${row.capabilities.search.resultLimit.maximum}` : "yes") : "no" }}</td>
              <td class="font-mono text-xs text-muted">{{ row.capabilities.searchImage.supported ? "yes" : "no" }}</td>
              <td class="font-mono text-xs text-muted">{{ row.capabilities.read.supported ? (row.capabilities.read.formats ?? []).join(", ") : "no" }}</td>
              <td class="font-mono text-xs text-muted">{{ row.capabilities.search.pagination ? "yes" : "no" }}</td>
              <td class="font-mono text-xs text-muted">{{ row.capabilities.search.filters?.length ? row.capabilities.search.filters.join(", ") : "none" }}</td>
              <td class="font-mono text-xs text-muted">{{ row.capabilities.search.resultFields?.length ? row.capabilities.search.resultFields.join(", ") : "none" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
