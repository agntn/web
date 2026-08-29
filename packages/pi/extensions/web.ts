import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AgentToolResult, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import type {
  ProviderStatus,
  ReadBatchItem,
  ReadOptions,
  ReadProviderName,
  ReadResult,
  SearchAllResult,
  SearchBatchItem,
  SearchRequestOptions,
  SearchResult,
  WebSearchProviderName,
} from "@agntn/web";

type SearchSingleDetails = {
  readonly mode: "single";
  readonly query: string;
  readonly provider: WebSearchProviderName;
  readonly options: SearchRequestOptions;
  readonly count: number;
  readonly results: readonly SearchResult[];
};

type SearchAllDetails = {
  readonly mode: "all";
  readonly query: string;
  readonly options: SearchRequestOptions;
  readonly count: number;
  readonly results: readonly SearchAllResult[];
  readonly errors: { provider: string; error: string }[];
};

type SearchBatchDetails = {
  readonly mode: "batch";
  readonly queries: readonly string[];
  readonly provider?: "all" | WebSearchProviderName;
  readonly options: SearchRequestOptions;
  readonly outcomes: readonly SearchBatchItem[];
};

type SearchDetails = SearchSingleDetails | SearchAllDetails | SearchBatchDetails;

type ReadDetails =
  | {
      readonly mode: "read";
      readonly url: string;
      readonly provider: "auto" | ReadProviderName;
      readonly options: ReadOptions;
      readonly result: ReadResult;
    }
  | {
      readonly mode: "batch";
      readonly urls: readonly string[];
      readonly provider: "auto" | ReadProviderName;
      readonly options: ReadOptions;
      readonly outcomes: readonly ReadBatchItem[];
    };

type WebModule = typeof import("@agntn/web");

const sourceModuleUrl = new URL("../../../src/index.ts", import.meta.url);
const distributionModuleUrl = new URL("../../../dist/index.mjs", import.meta.url);
let webModulePromise: Promise<WebModule> | undefined;

/** @returns {string} Live source in a checkout, otherwise the built distribution module. */
export function resolveWebModuleUrl(): string {
  return existsSync(fileURLToPath(sourceModuleUrl))
    ? sourceModuleUrl.href
    : distributionModuleUrl.href;
}

/** @returns {Promise<WebModule>} The cached module from the resolved live runtime. */
function loadWeb(): Promise<WebModule> {
  webModulePromise ??= import(resolveWebModuleUrl()) as Promise<WebModule>;
  return webModulePromise;
}

const PROVIDERS = [
  "auto",
  "all",
  "brave",
  "context",
  "exa",
  "firecrawl",
  "jina",
  "searxng",
  "serpapi",
  "serpbase",
  "tavily",
  "tinyfish",
] as const;
const PROVIDER_HINT = `Provider to use. One of: ${PROVIDERS.join(", ")}. "auto" (or omit) tries configured providers in order after HTTP 402. Use "all" to query every configured provider in parallel.`;
const READ_PROVIDER_HINT =
  "Read provider to use. Defaults to Jina and is validated against web.readProviderNames at execution time.";

const MAX_RESULTS_HARD_CAP = 20;
const MAX_BATCH_ITEMS_HARD_CAP = 10;
const DEFAULT_MAX_RESULTS = 10;

const searchParameters = Type.Object({
  query: Type.Union(
    [Type.String(), Type.Array(Type.String(), { minItems: 1, maxItems: MAX_BATCH_ITEMS_HARD_CAP })],
    {
      description: "Search query, or a batch of search queries.",
    },
  ),
  provider: Type.Optional(Type.String({ description: PROVIDER_HINT })),
  maxResults: Type.Optional(
    Type.Number({
      description: `Maximum results to return. Defaults to ${DEFAULT_MAX_RESULTS}.`,
      minimum: 1,
      maximum: MAX_RESULTS_HARD_CAP,
    }),
  ),
  includeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Only return results from these domains (e.g. ["github.com", "stackoverflow.com"]).',
    }),
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude results from these domains.",
    }),
  ),
  category: Type.Optional(
    Type.String({
      description: 'Search category (e.g. "news", "general"). Provider support varies.',
    }),
  ),
  startPublishedDate: Type.Optional(
    Type.String({
      description: 'ISO date filter: only results published after this date (e.g. "2024-01-01").',
    }),
  ),
  endPublishedDate: Type.Optional(
    Type.String({
      description: "ISO date filter: only results published before this date.",
    }),
  ),
});

const readParameters = Type.Object({
  url: Type.Union(
    [Type.String(), Type.Array(Type.String(), { minItems: 1, maxItems: MAX_BATCH_ITEMS_HARD_CAP })],
    {
      description: "URL to read, or a batch of URLs.",
    },
  ),
  provider: Type.Optional(Type.String({ description: READ_PROVIDER_HINT })),
  format: Type.Optional(
    Type.String({ description: 'Preferred content format: "markdown", "text", or "html".' }),
  ),
  maxTokens: Type.Optional(
    Type.Number({ description: "Maximum tokens to return when supported.", minimum: 1 }),
  ),
  targetSelector: Type.Optional(
    Type.String({ description: "CSS selector to target when supported." }),
  ),
  removeSelector: Type.Optional(
    Type.String({ description: "CSS selector to remove when supported." }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Provider timeout in seconds when supported.", minimum: 1 }),
  ),
  noCache: Type.Optional(Type.Boolean({ description: "Bypass provider cache when supported." })),
});

const emptyParameters = Type.Object({});

type SearchParams = Static<typeof searchParameters>;
type ReadParams = Static<typeof readParameters>;
type SearchRenderParams = SearchOptionValues & {
  readonly query: string | readonly string[];
  readonly provider?: string;
};
type ReadRenderParams = Readonly<Omit<ReadParams, "url">> & {
  readonly url: string | readonly string[];
};
type EmptyParams = Static<typeof emptyParameters>;
type ReadProviderInput = ReadProviderName;

export default function webExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Read-only/open-world network search: query one configured provider (Brave, Context.dev, Exa, Firecrawl, Jina, Tavily, TinyFish, SerpAPI, SerpBase, SearXNG) or fan out to every available provider with provider=all. Accepts one query or a batch; each batch item has its own results or error. Always returns {url, title, snippet}; optional fields vary by provider: Exa adds summary/highlights/full text + score/author/image, Context.dev adds relevance metadata, Firecrawl adds markdown content from scraped pages, Jina adds content/text + published date/image/metadata, Tavily adds full raw_content + score, TinyFish adds publisher and research metadata, Brave adds extra_snippets, SerpAPI adds thumbnail + position metadata, SerpBase adds Google SERP rank/request metadata, SearXNG adds engine metadata.",
    promptSnippet:
      "Search the web with web_search. Pass a query array for independent batch results, or use provider=all to query every configured provider in parallel.",
    promptGuidelines: [
      "Use web_search when the user explicitly asks for fresh web information, news, references, or links.",
      "Prefer a single provider when the user names one; use provider=all when freshness or coverage matters and at least two providers are configured.",
      "For AI-style summaries/highlights/full page text prefer Exa; for Jina Search Foundation results use Jina; for TinyFish news or research metadata use TinyFish; for raw full page content prefer Tavily; for classic SERP metadata Brave/SerpAPI/SerpBase/SearXNG are fine.",
      "Pass maxResults conservatively (5-10) unless the user asks for more.",
      "Forward includeDomains/excludeDomains/startPublishedDate/endPublishedDate when the user gives concrete filters.",
    ],
    parameters: searchParameters,
    renderCall(args, theme) {
      return new Text(renderSearchCall(args, theme), 0, 0);
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<SearchDetails>> {
      const web = await loadWeb();
      const providerName = normalizeSearchProviderInput(params.provider, web.builtinProviders);
      const searchOptions: SearchRequestOptions = stripUndefined({
        maxResults: params.maxResults,
        includeDomains: params.includeDomains,
        excludeDomains: params.excludeDomains,
        category: params.category,
        startPublishedDate: params.startPublishedDate,
        endPublishedDate: params.endPublishedDate,
      });

      if (Array.isArray(params.query)) {
        const outcomes = await web.searchBatch(params.query, {
          provider: providerName,
          ...searchOptions,
        });
        return {
          content: [{ type: "text", text: formatSearchBatch(outcomes) }],
          details: {
            mode: "batch",
            queries: params.query,
            provider: providerName,
            options: searchOptions,
            outcomes,
          },
        };
      }

      const query = params.query.trim();
      if (!query) {
        throw new Error("Query cannot be empty");
      }
      if (providerName === "all") {
        const response = await web.searchAllDetailed(query, searchOptions);
        const results = response.results;
        const okProviders = Array.from(new Set(results.map((r) => r.provider))).sort();
        const header = buildHeader({
          mode: "all",
          query,
          count: results.length,
          okProviders,
          errCount: response.errors.length,
        });
        const result: AgentToolResult<SearchDetails> = {
          content: [
            { type: "text", text: withHeader(header, formatAllResults(results, response.errors)) },
          ],
          details: {
            mode: "all",
            query,
            options: searchOptions,
            count: results.length,
            results,
            errors: response.errors.map((e) => ({
              provider: e.provider,
              error: e.error.message,
            })),
          },
        };
        return result;
      }

      if (providerName !== undefined) {
        const results = await web.createSearchProvider(providerName).search(query, searchOptions);
        const header = buildHeader({
          mode: "single",
          provider: providerName,
          query,
          count: results.length,
          autoSelected: false,
        });
        return {
          content: [{ type: "text", text: withHeader(header, formatResults(results)) }],
          details: {
            mode: "single",
            query,
            provider: providerName,
            options: searchOptions,
            count: results.length,
            results,
          },
        };
      }

      const response = await web.searchWithFallback(query, searchOptions);
      const header = buildHeader({
        mode: "single",
        provider: response.provider,
        query,
        count: response.results.length,
        autoSelected: true,
      });
      return {
        content: [{ type: "text", text: withHeader(header, formatResults(response.results)) }],
        details: {
          mode: "single",
          query,
          provider: response.provider,
          options: searchOptions,
          count: response.results.length,
          results: response.results,
        },
      };
    },
  });

  pi.registerTool({
    name: "web_read",
    label: "Web Read",
    description:
      "Read-only/open-world network fetch: read one URL or a batch of URLs into normalized content using a read-capable provider. Each batch item has its own result or error. Defaults to Jina Reader (r.jina.ai); Context.dev, Firecrawl, and TinyFish are also available for rendered pages and PDFs.",
    promptSnippet:
      "Read one URL with web_read, or pass a URL array when several pages are needed independently.",
    promptGuidelines: [
      "Use web_read after search when the user needs the contents of a specific URL.",
      "Use web_search for query-to-URL search; use web_read for URL-to-content reading.",
    ],
    parameters: readParameters,
    renderCall(args, theme) {
      return new Text(renderReadCall(args, theme), 0, 0);
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<ReadDetails>> {
      const web = await loadWeb();
      const readProvider = normalizeReadProviderInput(params.provider, web.readProviderNames);
      const readProviderLabel = readProvider ?? "auto";
      const format = normalizeReadFormat(params.format);
      const readOptions: ReadOptions = stripUndefinedRead({
        format,
        maxTokens: params.maxTokens,
        targetSelector: params.targetSelector,
        removeSelector: params.removeSelector,
        timeout: params.timeout,
        noCache: params.noCache,
      });

      if (Array.isArray(params.url)) {
        const outcomes = await web.readBatch(params.url, {
          provider: readProvider,
          ...readOptions,
        });
        return {
          content: [{ type: "text", text: formatReadBatch(outcomes) }],
          details: {
            mode: "batch",
            urls: params.url,
            provider: readProviderLabel,
            options: readOptions,
            outcomes,
          },
        };
      }

      const url = params.url.trim();
      if (!url) {
        throw new Error("URL cannot be empty");
      }
      const result = await web.readUrl(url, { provider: readProvider, ...readOptions });
      const header = `[provider=${readProviderLabel}] read ${result.url}`;
      return {
        content: [{ type: "text", text: withHeader(header, formatReadResult(result)) }],
        details: {
          mode: "read",
          url,
          provider: readProviderLabel,
          options: readOptions,
          result,
        },
      };
    },
  });

  pi.registerTool({
    name: "web_providers",
    label: "Web Providers",
    description:
      "Read-only/idempotent local/env status: list built-in web search providers and which ones are currently configured via environment variables.",
    promptSnippet: "List configured web providers.",
    promptGuidelines: [
      "Use web_providers before web_search if it is unclear which providers are available.",
    ],
    parameters: emptyParameters,
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("web_providers")), 0, 0);
    },
    async execute(
      _toolCallId: string,
      _params: EmptyParams,
    ): Promise<AgentToolResult<{ readonly providers: readonly ProviderStatus[] }>> {
      const web = await loadWeb();
      const statuses = await web.listProvidersAsync();
      const lines = statuses.map((s) => formatProviderStatus(s));
      return {
        content: [
          {
            type: "text",
            text: lines.length > 0 ? lines.join("\n") : "No providers registered.",
          },
        ],
        details: { providers: statuses },
      };
    },
  });

  pi.registerCommand("web", {
    description: "Search the web: /web [query]",
    handler: async (args, ctx) => {
      if (ctx.hasUI) await runWebCommand(args, ctx.ui);
    },
  });

  pi.registerCommand("web-providers", {
    description: "List configured web providers",
    handler: async (_args, ctx) => {
      const web = await loadWeb();
      const statuses = await web.listProvidersAsync();
      if (!ctx.hasUI) return;
      ctx.ui.notify(statuses.map(formatProviderStatus).join("\n"), "info");
    },
  });
}

type CommandHandler = NonNullable<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>;
type CommandUi = Readonly<
  Pick<Parameters<CommandHandler>[1]["ui"], "input" | "select" | "notify" | "pasteToEditor">
>;

type CommandSearchResult = {
  readonly provider: WebSearchProviderName;
  readonly results: readonly SearchResult[];
};

async function runWebCommand(args: string, ui: CommandUi): Promise<void> {
  const enteredQuery = args.trim() || (await ui.input("Search the web", "Enter a search query"));
  const query = enteredQuery?.trim();
  if (!query) return;

  const found = await searchForCommand(query, ui);
  if (!found || found.results.length === 0) return;
  const labels = found.results.map(formatResult);
  const selected = await ui.select(`web (${found.provider}) - ${query}`, labels);
  if (!selected) return;
  const picked = found.results[labels.indexOf(selected)];
  if (!picked) return;
  ui.pasteToEditor(picked.url);
  ui.notify(`Pasted ${picked.url}`, "info");
}

async function searchForCommand(
  query: string,
  ui: CommandUi,
): Promise<CommandSearchResult | undefined> {
  const web = await loadWeb();
  try {
    const response = await web.searchWithFallback(query, { maxResults: DEFAULT_MAX_RESULTS });
    if (response.results.length === 0) {
      ui.notify(`No results for "${query}" via ${response.provider}.`, "warning");
    }
    return response;
  } catch (error) {
    if (
      error instanceof web.NoProviderConfiguredError ||
      error instanceof web.NoProviderAvailableError
    ) {
      ui.notify(`No reachable web providers. ${errorMessage(error)}`, "warning");
      return undefined;
    }
    ui.notify(`web search failed: ${errorMessage(error)}`, "error");
    return undefined;
  }
}

function isKnownSearchProvider(
  name: string,
  providerNames: readonly WebSearchProviderName[],
): name is WebSearchProviderName {
  return providerNames.some((provider) => provider === name);
}

function isKnownReadProvider(
  name: string,
  readProviderNames: readonly string[],
): name is ReadProviderInput {
  return readProviderNames.some((provider) => provider === name);
}

function normalizeSearchProviderInput(
  provider: string | undefined,
  providerNames: readonly WebSearchProviderName[],
): "all" | WebSearchProviderName | undefined {
  const rawProvider = (provider ?? "").trim() || undefined;
  if (rawProvider === undefined || rawProvider === "auto") return undefined;
  if (rawProvider === "all") return "all";
  if (!isKnownSearchProvider(rawProvider, providerNames)) {
    throw new Error(
      `Unknown provider "${rawProvider}". Available: auto, all, ${providerNames.join(", ")}.`,
    );
  }
  return rawProvider;
}

function normalizeReadProviderInput(
  provider: string | undefined,
  readProviderNames: readonly ReadProviderName[],
): ReadProviderName | undefined {
  const rawProvider = provider?.trim() || undefined;
  if (rawProvider === undefined) return undefined;
  if (!isKnownReadProvider(rawProvider, readProviderNames)) {
    throw new Error(
      `Unknown read provider "${rawProvider}". Available: ${readProviderNames.join(", ")}.`,
    );
  }
  return rawProvider;
}

function normalizeReadFormat(format: string | undefined): ReadOptions["format"] {
  if (format === undefined || format === "") return undefined;
  if (format === "markdown" || format === "text" || format === "html") return format;
  throw new Error('Invalid read format. Expected "markdown", "text", or "html".');
}

type SearchOptionValues = {
  readonly maxResults?: number;
  readonly includeDomains?: readonly string[];
  readonly excludeDomains?: readonly string[];
  readonly startPublishedDate?: string;
  readonly endPublishedDate?: string;
  readonly category?: string;
};

function stripUndefined(input: SearchOptionValues): SearchRequestOptions {
  return {
    ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
    ...(input.includeDomains === undefined ? {} : { includeDomains: input.includeDomains }),
    ...(input.excludeDomains === undefined ? {} : { excludeDomains: input.excludeDomains }),
    ...(input.startPublishedDate === undefined
      ? {}
      : { startPublishedDate: input.startPublishedDate }),
    ...(input.endPublishedDate === undefined ? {} : { endPublishedDate: input.endPublishedDate }),
    ...(input.category === undefined ? {} : { category: input.category }),
  };
}

function stripUndefinedRead(input: Readonly<ReadOptions>): ReadOptions {
  return {
    ...(input.format === undefined ? {} : { format: input.format }),
    ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    ...(input.targetSelector === undefined ? {} : { targetSelector: input.targetSelector }),
    ...(input.removeSelector === undefined ? {} : { removeSelector: input.removeSelector }),
    ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
    ...(input.noCache === undefined ? {} : { noCache: input.noCache }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type HeaderOpts =
  | {
      readonly mode: "single";
      readonly provider: string;
      readonly query: string;
      readonly count: number;
      readonly autoSelected: boolean;
    }
  | {
      readonly mode: "all";
      readonly query: string;
      readonly count: number;
      readonly okProviders: readonly string[];
      readonly errCount: number;
    };

function buildHeader(o: HeaderOpts): string {
  if (o.mode === "single") {
    const tag = o.autoSelected ? " (auto-selected default)" : "";
    return `[provider=${o.provider}] ${o.count} result(s) for "${o.query}"${tag}`;
  }
  const list = o.okProviders.length > 0 ? ` [${o.okProviders.join(", ")}]` : "";
  const errs = o.errCount > 0 ? ` (+${o.errCount} provider error(s))` : "";
  return `[provider=all] ${o.count} result(s) for "${o.query}" via ${o.okProviders.length} provider(s)${list}${errs}`;
}

function withHeader(header: string, body: readonly string[]): string {
  const joined = body.join("\n");
  return joined ? `${header}\n\n${joined}` : `${header}\nNo results.`;
}

function formatProviderStatus(s: Readonly<ProviderStatus>): string {
  // Symbol legend:
  //   ✓  configured AND reachable (or no probe = trust env)
  //   ⚠  configured BUT probe returned false (e.g. SearXNG endpoint down)
  //   ·  not configured (no env var / not registered)
  let symbol = "·";
  if (s.configured) {
    symbol = s.reachable === false ? "⚠" : "✓";
  }
  const envLabel = s.envVar ? ` (${s.envVar})` : "";
  const reachabilityNote = s.configured && s.reachable === false ? " - unreachable" : "";
  return `${symbol} ${s.name}${envLabel}${reachabilityNote}`;
}

type SearchResultView = Readonly<Pick<SearchResult, "url" | "title" | "snippet">>;
type SearchAllResultView = SearchResultView & Readonly<Pick<SearchAllResult, "provider">>;
type SearchBatchItemView =
  | { readonly query: string; readonly error: string }
  | { readonly query: string; readonly results: readonly SearchResultView[] };
type ReadBatchItemView =
  | { readonly url: string; readonly error: string }
  | {
      readonly url: string;
      readonly result: Readonly<Pick<ReadResult, "title" | "url" | "description" | "content">>;
    };
type ProviderErrorView = { readonly provider: string; readonly error: Readonly<Error> };

function formatResult(result: SearchResultView, index?: number): string {
  const head = index === undefined ? "" : `${index + 1}. `;
  const title = result.title || "(no title)";
  const snippet = result.snippet ? ` - ${truncateSingleLine(result.snippet, 120)}` : "";
  return `${head}${title}\n   ${result.url}${snippet}`;
}

function formatResults(results: readonly SearchResultView[]): readonly string[] {
  return results.map((r, i) => formatResult(r, i));
}

function formatAllResults(
  results: readonly SearchAllResultView[],
  errors: readonly ProviderErrorView[],
): readonly string[] {
  const lines = results.map((r, i) => `${formatResult(r, i)}\n   [${r.provider}]`);
  if (errors.length > 0) {
    lines.push("", "Provider errors:");
    for (const e of errors) {
      lines.push(`  ${e.provider}: ${e.error.message}`);
    }
  }
  return lines;
}

function formatSearchBatch(outcomes: readonly SearchBatchItemView[]): string {
  return outcomes
    .map((outcome, index) => {
      const header = `[${index + 1}] ${outcome.query}`;
      return "error" in outcome
        ? `${header}\nError: ${outcome.error}`
        : withHeader(header, formatResults(outcome.results));
    })
    .join("\n\n");
}

function formatReadBatch(outcomes: readonly ReadBatchItemView[]): string {
  return outcomes
    .map((outcome, index) => {
      const header = `[${index + 1}] ${outcome.url}`;
      return "error" in outcome
        ? `${header}\nError: ${outcome.error}`
        : withHeader(header, formatReadResult(outcome.result));
    })
    .join("\n\n");
}

function formatReadResult(
  result: Readonly<Pick<ReadResult, "title" | "url" | "description" | "content">>,
): readonly string[] {
  const lines = [result.title || "(no title)", `   ${result.url}`];
  if (result.description) lines.push(`   ${truncateSingleLine(result.description, 160)}`);
  if (result.content) lines.push("", result.content);
  return lines;
}

function renderSearchCall(
  params: SearchRenderParams,
  theme: Readonly<Pick<Theme, "bold" | "fg">>,
): string {
  const queryLabel =
    typeof params.query !== "string"
      ? `${params.query.length} queries`
      : `"${truncateSingleLine(params.query, 120)}"`;
  return [
    theme.fg("toolTitle", theme.bold("web_search")),
    theme.fg("dim", queryLabel),
    ...searchCallOptions(params).map((option) => theme.fg("muted", option)),
  ].join(" ");
}

function searchCallOptions(
  params: SearchOptionValues & Readonly<Pick<SearchParams, "provider">>,
): readonly string[] {
  return [...searchCallBasics(params), ...searchCallFilters(params)];
}

function searchCallBasics(
  params: SearchOptionValues & Readonly<Pick<SearchParams, "provider">>,
): readonly string[] {
  return [
    params.provider ? `provider=${params.provider}` : undefined,
    params.maxResults === undefined ? undefined : `max=${params.maxResults}`,
    params.category ? `cat=${params.category}` : undefined,
  ].filter(isDefined);
}

function searchCallFilters(params: SearchOptionValues): readonly string[] {
  return [
    params.includeDomains?.length ? `include=${params.includeDomains.join(",")}` : undefined,
    params.excludeDomains?.length ? `exclude=${params.excludeDomains.join(",")}` : undefined,
    params.startPublishedDate ? `from=${params.startPublishedDate}` : undefined,
    params.endPublishedDate ? `to=${params.endPublishedDate}` : undefined,
  ].filter(isDefined);
}

function isDefined(value: string | undefined): value is string {
  return value !== undefined;
}

function renderReadCall(
  params: ReadRenderParams,
  theme: Readonly<Pick<Theme, "bold" | "fg">>,
): string {
  const urlLabel =
    typeof params.url !== "string"
      ? `${params.url.length} URLs`
      : truncateSingleLine(params.url, 120);
  const parts = [theme.fg("toolTitle", theme.bold("web_read")), theme.fg("dim", urlLabel)];
  if (params.provider) parts.push(theme.fg("muted", `provider=${params.provider}`));
  if (params.format) parts.push(theme.fg("muted", `format=${params.format}`));
  if (params.maxTokens !== undefined)
    parts.push(theme.fg("muted", `maxTokens=${params.maxTokens}`));
  return parts.join(" ");
}

function truncateSingleLine(text: string, maxLength: number): string {
  const singleLine = text.replaceAll(/\s+/g, " ").trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}
