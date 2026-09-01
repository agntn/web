import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  createViewportText,
  type RenderedToolResult,
  type RenderOptions,
  renderWebToolCall,
  renderWebToolResult,
  type StatusTheme,
  type WebToolName,
} from "../../../src/tui.ts";
import type {
  ImageSearchProviderName,
  ImageSearchResult,
  ProviderStatus,
  ReadBatchDetailedItem,
  ReadOptions,
  ReadProviderName,
  ReadResult,
  RuntimeInfo,
  SearchAllResult,
  SearchBatchItem,
  SearchFilterName,
  SearchFilterReport,
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
  readonly ignoredFilters: readonly SearchFilterName[];
  readonly undeclaredFilters: readonly SearchFilterName[];
};

type SearchAllDetails = {
  readonly mode: "all";
  readonly query: string;
  readonly options: SearchRequestOptions;
  readonly count: number;
  readonly results: readonly SearchAllResult[];
  readonly successfulProviders: readonly string[];
  readonly errors: { provider: string; error: string }[];
  readonly filterReports: readonly SearchFilterReport[];
};

type SearchBatchDetails = {
  readonly mode: "batch";
  readonly queries: readonly string[];
  readonly provider?: "all" | WebSearchProviderName;
  readonly options: SearchRequestOptions;
  readonly outcomes: readonly SearchBatchItem[];
};

type SearchDetails = SearchSingleDetails | SearchAllDetails | SearchBatchDetails;

type ImageSearchDetails = {
  readonly url: string;
  readonly provider: ImageSearchProviderName;
  readonly maxResults?: number;
  readonly results: readonly ImageSearchResult[];
};

type ReadDetails =
  | {
      readonly mode: "read";
      readonly url: string;
      readonly provider: "auto" | ReadProviderName;
      readonly effectiveProvider: string;
      readonly attempts: readonly string[];
      readonly options: ReadOptions;
      readonly result: ReadResult;
    }
  | {
      readonly mode: "batch";
      readonly urls: readonly string[];
      readonly provider: "auto" | ReadProviderName;
      readonly options: ReadOptions;
      readonly outcomes: readonly ReadBatchDetailedItem[];
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
  "mojeek",
  "searxng",
  "serpapi",
  "serpbase",
  "tavily",
  "tinyfish",
] as const;
const PROVIDER_HINT = `Provider to use. One of: ${PROVIDERS.join(", ")}. "auto" (or omit) tries configured providers in order after HTTP 402. Use "all" to query every configured provider in parallel.`;
const IMAGE_SEARCH_PROVIDER_HINT =
  "Reverse image search provider. Defaults to SerpAPI Google Lens and is validated against web.imageSearchProviderNames at execution time.";
const READ_PROVIDER_HINT =
  'Read provider to use. "auto" (or omit) starts with Jina and falls back to other configured readers after HTTP 402 or 409. Validated against web.readProviderNames at execution time.';

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
    Type.Integer({
      description: `Maximum results to return. Defaults to ${DEFAULT_MAX_RESULTS}.`,
      minimum: 1,
      maximum: MAX_RESULTS_HARD_CAP,
    }),
  ),
  highlights: Type.Optional(
    Type.Boolean({
      description: "Return passages relevant to the query when supported. Defaults to true.",
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
  sources: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Source types when supported (Firecrawl: "web", "news", "images").',
    }),
  ),
  categories: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Category filters when supported (Firecrawl: "research", "pdf", "developer").',
    }),
  ),
  category: Type.Optional(
    Type.String({
      description: 'Single search category (e.g. "news", "general"). Provider support varies.',
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

const imageSearchParameters = Type.Object({
  url: Type.String({ description: "Public HTTP or HTTPS image URL." }),
  provider: Type.Optional(Type.String({ description: IMAGE_SEARCH_PROVIDER_HINT })),
  maxResults: Type.Optional(
    Type.Integer({
      description: `Maximum matches to return. Defaults to ${DEFAULT_MAX_RESULTS}.`,
      minimum: 1,
      maximum: MAX_RESULTS_HARD_CAP,
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
    Type.Integer({ description: "Maximum tokens to return when supported.", minimum: 1 }),
  ),
  targetSelector: Type.Optional(
    Type.String({ description: "CSS selector to target when supported." }),
  ),
  removeSelector: Type.Optional(
    Type.String({ description: "CSS selector to remove when supported." }),
  ),
  timeout: Type.Optional(
    Type.Integer({ description: "Provider timeout in seconds when supported.", minimum: 1 }),
  ),
  noCache: Type.Optional(Type.Boolean({ description: "Bypass provider cache when supported." })),
});

const emptyParameters = Type.Object({});

type EmptyParams = Static<typeof emptyParameters>;
type ReadProviderInput = ReadProviderName;

function statusRenderers(name: WebToolName) {
  return {
    renderCall(args: unknown, theme: Readonly<StatusTheme>, context: Readonly<RenderOptions>) {
      return createViewportText((width) =>
        renderWebToolCall(name, args, { ...context, viewportWidth: width }, theme),
      );
    },
    renderResult(
      result: Readonly<RenderedToolResult>,
      options: Readonly<RenderOptions>,
      theme: Readonly<StatusTheme>,
      context?: Readonly<{ isError?: boolean }>,
    ) {
      return createViewportText((width) =>
        renderWebToolResult(
          name,
          result,
          context?.isError === true,
          { ...options, viewportWidth: width },
          theme,
        ),
      );
    },
  };
}

export default function webExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Read-only/open-world network search: query one configured provider (Brave, Context.dev, Exa, Firecrawl, Jina, Tavily, TinyFish, SerpAPI, SerpBase, SearXNG) or fan out to every available provider with provider=all. Accepts one query or a batch; each batch item has its own results or error. Responses report filters the selected provider ignored. Each result includes {url, title, snippet}; optional fields vary by provider: Exa adds summary/highlights/full text + score/author/image, Context.dev adds relevance metadata, Firecrawl returns passages relevant to the query in snippet and markdown content from scraped pages, Jina adds content/text + published date/image/metadata, Tavily adds full raw_content + score, TinyFish adds publisher and research metadata, Brave adds extra_snippets, SerpAPI adds thumbnail + position metadata, SerpBase adds Google SERP rank/request metadata, SearXNG adds engine metadata.",
    promptSnippet:
      "Search the web with web_search. Pass a query array for independent batch results, or use provider=all to query every configured provider in parallel.",
    promptGuidelines: [
      "Use web_search when the user explicitly asks for fresh web information, news, references, or links.",
      "Prefer a single provider when the user names one; use provider=all when freshness or coverage matters and at least two providers are configured.",
      "For separate AI summaries/highlights/full page text prefer Exa; for result passages relevant to the query use Firecrawl; for Jina Search Foundation results use Jina; for TinyFish news or research metadata use TinyFish; for raw full page content prefer Tavily; for classic SERP metadata Brave/SerpAPI/SerpBase/SearXNG are fine.",
      "Pass maxResults conservatively (5-10) unless the user asks for more.",
      "Forward domain, source, category, and date filters when the user gives concrete values.",
    ],
    parameters: searchParameters,
    ...statusRenderers("web_search"),
    async execute(_toolCallId, params): Promise<AgentToolResult<SearchDetails>> {
      const web = await loadWeb();
      const providerName = normalizeSearchProviderInput(params.provider, web.builtinProviders);
      const searchOptions: SearchRequestOptions = stripUndefined({
        maxResults: params.maxResults,
        highlights: params.highlights,
        includeDomains: params.includeDomains,
        excludeDomains: params.excludeDomains,
        sources: params.sources,
        categories: params.categories,
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
        const header = buildHeader({
          mode: "all",
          query,
          count: results.length,
          successfulProviders: response.successfulProviders,
          errCount: response.errors.length,
        });
        const result: AgentToolResult<SearchDetails> = {
          content: [
            {
              type: "text",
              text: withHeader(
                header,
                formatAllResults(results, response.errors, response.filterReports),
              ),
            },
          ],
          details: {
            mode: "all",
            query,
            options: searchOptions,
            count: results.length,
            results,
            successfulProviders: response.successfulProviders,
            errors: response.errors.map((e) => ({
              provider: e.provider,
              error: e.error.message,
            })),
            filterReports: response.filterReports,
          },
        };
        return result;
      }

      if (providerName !== undefined) {
        const response = await web.searchProviderDetailed(providerName, query, searchOptions);
        const header = buildHeader({
          mode: "single",
          provider: providerName,
          query,
          count: response.results.length,
          autoSelected: false,
          ignoredFilters: response.ignoredFilters,
          undeclaredFilters: response.undeclaredFilters,
        });
        return {
          content: [{ type: "text", text: withHeader(header, formatResults(response.results)) }],
          details: {
            mode: "single",
            query,
            provider: providerName,
            options: searchOptions,
            count: response.results.length,
            results: response.results,
            ignoredFilters: response.ignoredFilters,
            undeclaredFilters: response.undeclaredFilters,
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
        ignoredFilters: response.ignoredFilters,
        undeclaredFilters: response.undeclaredFilters,
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
          ignoredFilters: response.ignoredFilters,
          undeclaredFilters: response.undeclaredFilters,
        },
      };
    },
  });

  pi.registerTool({
    name: "web_search_image",
    label: "Search by Image",
    description:
      "Read-only/open-world reverse image search: find public pages containing or resembling an image available by URL. Returns matched page and image URLs with dimensions and rank metadata.",
    promptSnippet: "Find pages containing or resembling a public image URL with web_search_image.",
    promptGuidelines: [
      "Use web_search_image for reverse image lookup. Use web_search for text queries and web_read for page content.",
    ],
    parameters: imageSearchParameters,
    ...statusRenderers("web_search_image"),
    async execute(_toolCallId, params): Promise<AgentToolResult<ImageSearchDetails>> {
      const web = await loadWeb();
      const provider = normalizeImageSearchProviderInput(
        params.provider,
        web.imageSearchProviderNames,
      );
      const url = params.url.trim();
      if (!url) throw new web.EmptyImageUrlError();
      const results = await web.searchByImage(url, {
        provider,
        maxResults: params.maxResults,
      });
      const header = `[provider=${provider}] ${results.length} image match(es) for ${truncateSingleLine(url, 200)}`;
      return {
        content: [{ type: "text", text: withHeader(header, formatImageSearchResults(results)) }],
        details: { url, provider, maxResults: params.maxResults, results },
      };
    },
  });

  pi.registerTool({
    name: "web_read",
    label: "Web Read",
    description:
      "Read-only/open-world network fetch: read one URL or a batch of URLs into normalized content using a read-capable provider. Each batch item has its own result or error. Automatic reads start with Jina, try configured readers after HTTP 402 or 409, and report the effective provider.",
    promptSnippet:
      "Read one URL with web_read, or pass a URL array when several pages are needed independently.",
    promptGuidelines: [
      "Use web_read after search when the user needs the contents of a specific URL.",
      "Use web_search for query-to-URL search; use web_read for URL-to-content reading.",
    ],
    parameters: readParameters,
    ...statusRenderers("web_read"),
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
        const outcomes = await web.readBatchDetailed(params.url, {
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
      const response = await web.readUrlDetailed(url, {
        provider: readProvider,
        ...readOptions,
      });
      const header = `[provider=${response.provider} requested=${response.requestedProvider}] read ${truncateSingleLine(response.result.url, 200)}`;
      return {
        content: [{ type: "text", text: withHeader(header, formatReadResult(response.result)) }],
        details: {
          mode: "read",
          url,
          provider: readProviderLabel,
          effectiveProvider: response.provider,
          attempts: response.attempts,
          options: readOptions,
          result: response.result,
        },
      };
    },
  });

  pi.registerTool({
    name: "web_providers",
    label: "Web Providers",
    description:
      "Read-only/idempotent local/env status: show the running web build and list built-in providers with configuration and search filter support.",
    promptSnippet: "List configured web providers.",
    promptGuidelines: [
      "Use web_providers before web_search if provider availability or filter support is unclear.",
    ],
    parameters: emptyParameters,
    ...statusRenderers("web_providers"),
    async execute(
      _toolCallId: string,
      _params: EmptyParams,
    ): Promise<
      AgentToolResult<{
        readonly runtime: RuntimeInfo;
        readonly providers: readonly ProviderStatus[];
      }>
    > {
      const web = await loadWeb();
      const statuses = await web.listProvidersAsync();
      const lines = statuses.map((s) => formatProviderStatus(s));
      const runtimeLine = `web ${web.runtimeInfo.version} build ${web.runtimeInfo.buildId}, started ${web.runtimeInfo.processStartedAt}`;
      return {
        content: [
          {
            type: "text",
            text: [runtimeLine, ...(lines.length > 0 ? lines : ["No providers registered."])].join(
              "\n",
            ),
          },
        ],
        details: { runtime: web.runtimeInfo, providers: statuses },
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

function normalizeImageSearchProviderInput(
  provider: string | undefined,
  providerNames: readonly ImageSearchProviderName[],
): ImageSearchProviderName {
  const rawProvider = provider?.trim() || providerNames[0];
  const matched = providerNames.find((name) => name === rawProvider);
  if (!matched) {
    throw new Error(
      `Unknown reverse image search provider "${rawProvider}". Available: ${providerNames.join(", ")}.`,
    );
  }
  return matched;
}

function normalizeReadProviderInput(
  provider: string | undefined,
  readProviderNames: readonly ReadProviderName[],
): ReadProviderName | undefined {
  const rawProvider = provider?.trim() || undefined;
  if (rawProvider === undefined || rawProvider === "auto") return undefined;
  if (!isKnownReadProvider(rawProvider, readProviderNames)) {
    throw new Error(
      `Unknown read provider "${rawProvider}". Available: auto, ${readProviderNames.join(", ")}.`,
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
  readonly highlights?: boolean;
  readonly includeDomains?: readonly string[];
  readonly excludeDomains?: readonly string[];
  readonly sources?: readonly string[];
  readonly categories?: readonly string[];
  readonly startPublishedDate?: string;
  readonly endPublishedDate?: string;
  readonly category?: string;
};

function stripUndefined(input: SearchOptionValues): SearchRequestOptions {
  return {
    ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
    ...(input.highlights === undefined ? {} : { highlights: input.highlights }),
    ...searchArrayOptions(input),
    ...(input.startPublishedDate === undefined
      ? {}
      : { startPublishedDate: input.startPublishedDate }),
    ...(input.endPublishedDate === undefined ? {} : { endPublishedDate: input.endPublishedDate }),
    ...(input.category === undefined ? {} : { category: input.category }),
  };
}

function searchArrayOptions(input: SearchOptionValues): SearchRequestOptions {
  return {
    ...(input.includeDomains === undefined ? {} : { includeDomains: input.includeDomains }),
    ...(input.excludeDomains === undefined ? {} : { excludeDomains: input.excludeDomains }),
    ...(input.sources === undefined ? {} : { sources: input.sources }),
    ...(input.categories === undefined ? {} : { categories: input.categories }),
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
      readonly ignoredFilters: readonly SearchFilterName[];
      readonly undeclaredFilters: readonly SearchFilterName[];
    }
  | {
      readonly mode: "all";
      readonly query: string;
      readonly count: number;
      readonly successfulProviders: readonly string[];
      readonly errCount: number;
    };

function buildHeader(o: HeaderOpts): string {
  if (o.mode === "single") {
    const tag = o.autoSelected ? " (auto-selected default)" : "";
    const ignored = o.ignoredFilters.length === 0 ? "" : ` [ignored=${o.ignoredFilters.join(",")}]`;
    const undeclared =
      o.undeclaredFilters.length === 0
        ? ""
        : ` [filter support undeclared=${o.undeclaredFilters.join(",")}]`;
    return `[provider=${o.provider}] ${o.count} result(s) for "${o.query}"${tag}${ignored}${undeclared}`;
  }
  const list = o.successfulProviders.length > 0 ? ` [${o.successfulProviders.join(", ")}]` : "";
  const errs = o.errCount > 0 ? ` (+${o.errCount} provider error(s))` : "";
  return `[provider=all] ${o.count} result(s) for "${o.query}" via ${o.successfulProviders.length} provider(s)${list}${errs}`;
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
  const symbol = providerStatusSymbol(s);
  const envLabel = s.envVar ? ` (${s.envVar})` : "";
  const reachabilityNote = s.configured && s.reachable === false ? " - unreachable" : "";
  const filters = s.searchFilters?.join(",") || "none";
  const categories = s.searchCategories?.length
    ? ` categories=${s.searchCategories.join(",")}`
    : "";
  return `${symbol} ${s.name}${envLabel}${reachabilityNote} filters=${filters}${categories}`;
}

function providerStatusSymbol(status: Readonly<ProviderStatus>): string {
  if (!status.configured) return "·";
  return status.reachable === false ? "⚠" : "✓";
}

type SearchResultView = Readonly<Pick<SearchResult, "url" | "title" | "snippet">>;
type SearchAllResultView = SearchResultView & Readonly<Pick<SearchAllResult, "provider">>;
type SearchBatchItemView =
  | { readonly query: string; readonly error: string }
  | {
      readonly query: string;
      readonly provider: string;
      readonly results: readonly SearchResultView[];
      readonly filterReports: readonly SearchFilterReport[];
    };
type ReadBatchItemView =
  | { readonly url: string; readonly error: string }
  | {
      readonly url: string;
      readonly requestedProvider: string;
      readonly provider: string;
      readonly attempts: readonly string[];
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

function formatImageSearchResults(
  results: readonly Readonly<ImageSearchResult>[],
): readonly string[] {
  return results.map((result, index) => {
    const title = truncateSingleLine(result.title || "(no title)", 200);
    const dimensions =
      result.imageWidth === undefined || result.imageHeight === undefined
        ? ""
        : ` ${result.imageWidth}x${result.imageHeight}`;
    const pageUrl = truncateSingleLine(result.pageUrl, 500);
    const imageUrl = truncateSingleLine(result.imageUrl, 500);
    return `${index + 1}. ${title}\n   ${pageUrl}\n   ${imageUrl}${dimensions}`;
  });
}

function formatAllResults(
  results: readonly SearchAllResultView[],
  errors: readonly ProviderErrorView[],
  filterReports: readonly SearchFilterReport[],
): readonly string[] {
  const lines =
    results.length === 0
      ? ["No results."]
      : results.map((r, i) => `${formatResult(r, i)}\n   [${r.provider}]`);
  lines.push(...formatFilterReports(filterReports));
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
      if ("error" in outcome) return `${header}\nError: ${outcome.error}`;
      const lines = [
        ...(outcome.results.length === 0 ? ["No results."] : formatResults(outcome.results)),
        ...formatFilterReports(outcome.filterReports),
      ];
      return withHeader(`${header} [provider=${outcome.provider}]`, lines);
    })
    .join("\n\n");
}

function formatFilterReports(reports: readonly SearchFilterReport[]): readonly string[] {
  if (reports.length === 0) return [];
  const lines = ["", "Filter warnings:"];
  for (const report of reports) {
    if (report.ignoredFilters.length > 0) {
      lines.push(`  ${report.provider}: ignored ${report.ignoredFilters.join(", ")}`);
    }
    if (report.undeclaredFilters.length > 0) {
      lines.push(
        `  ${report.provider}: support undeclared for ${report.undeclaredFilters.join(", ")}`,
      );
    }
  }
  return lines;
}

function formatReadBatch(outcomes: readonly ReadBatchItemView[]): string {
  return outcomes
    .map((outcome, index) => {
      const header = `[${index + 1}] ${truncateSingleLine(outcome.url, 200)}`;
      return "error" in outcome
        ? `${header}\nError: ${outcome.error}`
        : withHeader(
            `${header} [provider=${truncateSingleLine(outcome.provider, 80)} requested=${truncateSingleLine(outcome.requestedProvider, 80)}]`,
            formatReadResult(outcome.result),
          );
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

function truncateSingleLine(text: string, maxLength: number): string {
  const singleLine = text
    .replaceAll(/\p{Cc}/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}
