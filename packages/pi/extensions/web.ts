import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  createViewportText,
  formatProviderCapabilities,
  type RenderedToolResult,
  type RenderOptions,
  renderWebToolCall,
  renderWebToolResult,
  sanitizeTerminalText,
  type StatusTheme,
  type WebToolName,
} from "../../../src/tui.ts";
import type {
  ImageSearchResult,
  ProviderFailure,
  ProviderStatus,
  ReadBatchDetailedItem,
  ReadOptions,
  ReadResult,
  ReadUrlOptions,
  RuntimeInfo,
  SearchAllResult,
  SearchBatchItem,
  SearchFilterName,
  SearchFilterReport,
  SearchPageOptions,
  SearchPagination,
  SearchProviderMetadata,
  SearchProviderPagination,
  SearchResult,
} from "../../../src/index.ts";

type SearchSingleDetails = {
  readonly mode: "single";
  readonly query: string;
  readonly provider: string;
  readonly options: SearchPageOptions;
  readonly count: number;
  readonly results: readonly SearchResult[];
  readonly ignoredFilters: readonly SearchFilterName[];
  readonly undeclaredFilters: readonly SearchFilterName[];
  readonly pagination: SearchPagination;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly attempts?: readonly string[];
  readonly failures?: readonly ProviderFailure[];
};

type SearchAllDetails = {
  readonly mode: "all";
  readonly query: string;
  readonly options: SearchPageOptions;
  readonly count: number;
  readonly results: readonly SearchAllResult[];
  readonly successfulProviders: readonly string[];
  readonly errors: { provider: string; error: string }[];
  readonly filterReports: readonly SearchFilterReport[];
  readonly providerPagination: readonly SearchProviderPagination[];
  readonly providerMetadata?: readonly SearchProviderMetadata[];
};

type SearchBatchDetails = {
  readonly mode: "batch";
  readonly queries: readonly string[];
  readonly provider?: string;
  readonly options: SearchPageOptions;
  readonly outcomes: readonly SearchBatchItem[];
};

type SearchDetails = SearchSingleDetails | SearchAllDetails | SearchBatchDetails;

type ImageSearchDetails = {
  readonly url: string;
  readonly provider: string;
  readonly maxResults?: number;
  readonly results: readonly ImageSearchResult[];
};

type ReadDetails =
  | {
      readonly mode: "read";
      readonly url: string;
      readonly provider: string;
      readonly effectiveProvider: string;
      readonly attempts: readonly string[];
      readonly failures: readonly ProviderFailure[];
      readonly options: ReadUrlOptions;
      readonly result: ReadResult;
    }
  | {
      readonly mode: "batch";
      readonly urls: readonly string[];
      readonly provider: string;
      readonly options: ReadUrlOptions;
      readonly outcomes: readonly ReadBatchDetailedItem[];
    };

type WebModule = typeof import("../../../src/index.ts");

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
const PROVIDER_HINT = `Provider to use. Built in providers: ${PROVIDERS.join(", ")}. "auto" (or omit) tries configured providers in order after payment, rate limit, timeout, or server failures. Use "all" to query every configured provider in parallel. Registered custom providers are validated at execution time.`;
const IMAGE_SEARCH_PROVIDER_HINT =
  "Reverse image search provider. Defaults to SerpAPI Google Lens. Registered providers are validated against web.searchImageProviders() at execution time.";
const READ_PROVIDER_HINT =
  'Read provider to use. "auto" (or omit) starts with Jina and falls back after eligible payment, conflict, rate limit, timeout, or server failures. Registered providers are validated against web.readProviders() at execution time.';

const MAX_RESULTS_HARD_CAP = 20;
const MAX_BATCH_ITEMS_HARD_CAP = 10;
const DEFAULT_MAX_RESULTS = 10;
const MAX_SEARCH_CONTINUATION_CHARACTERS = 4_096;
const DEFAULT_READ_MAX_CHARS = 20_000;
const MAX_READ_MAX_CHARS = 200_000;
const MODEL_RESULT_MAX_CHARACTERS = 4_000;
const MODEL_FIELD_MAX_CHARACTERS = 300;
const MODEL_TEXT_MAX_CHARACTERS = 900;

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
  continuation: Type.Optional(
    Type.String({
      description: "Opaque token returned by a previous single search.",
      maxLength: MAX_SEARCH_CONTINUATION_CHARACTERS,
    }),
  ),
  highlights: Type.Optional(
    Type.Boolean({
      description: "Return passages relevant to the query when supported. Defaults to true.",
    }),
  ),
  summary: Type.Optional(
    Type.Boolean({
      description: "Request generated summaries or answers when supported. Defaults to false.",
    }),
  ),
  fullText: Type.Optional(
    Type.Boolean({
      description: "Request full page text when supported. Defaults to false.",
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
  maxChars: Type.Optional(
    Type.Integer({
      description: `Maximum page content characters to return. Defaults to ${DEFAULT_READ_MAX_CHARS}.`,
      minimum: 1,
      maximum: MAX_READ_MAX_CHARS,
    }),
  ),
  continuation: Type.Optional(
    Type.String({ description: "Opaque token returned by a truncated read.", maxLength: 1024 }),
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
      "Read-only/open-world network search: query one configured provider (Brave, Context.dev, Exa, Firecrawl, Jina, Tavily, TinyFish, SerpAPI, SerpBase, SearXNG) or fan out to every available provider with provider=all. Accepts one query or a batch; each batch item has its own results or error. Responses report filters the selected provider ignored. Each result includes {url, title, snippet}; optional fields vary by provider. Use web_providers for the current machine-readable field, filter, and limit matrix.",
    promptSnippet:
      "Search the web with web_search. Pass a query array for independent batch results, or use provider=all to query every configured provider in parallel.",
    promptGuidelines: [
      "Use web_search when the user explicitly asks for fresh web information, news, references, or links.",
      "Prefer a single provider when the user names one; use provider=all when freshness or coverage matters and at least two providers are configured.",
      "Use web_providers when selecting a provider by rich result fields, filters, or result limits.",
      "Request summaries or full text deliberately because generated and extracted content can increase cost and context size.",
      "Pass maxResults conservatively (5-10) unless the user asks for more.",
      "Use a returned search continuation only with the same single query, provider, and options; an unknown state means the next page must be probed.",
      "Forward domain, source, category, and date filters when the user gives concrete values.",
    ],
    parameters: searchParameters,
    ...statusRenderers("web_search"),
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<SearchDetails>> {
      const web = await loadWeb();
      const providerName = normalizeSearchProviderInput(params.provider, web.searchProviders());
      const searchOptions: SearchPageOptions = stripUndefined({
        maxResults: params.maxResults,
        continuation: params.continuation,
        highlights: params.highlights,
        summary: params.summary,
        fullText: params.fullText,
        includeDomains: params.includeDomains,
        excludeDomains: params.excludeDomains,
        sources: params.sources,
        categories: params.categories,
        category: params.category,
        startPublishedDate: params.startPublishedDate,
        endPublishedDate: params.endPublishedDate,
      });
      const executionOptions = { ...searchOptions, signal };

      if (Array.isArray(params.query)) {
        const outcomes = await web.searchBatch(params.query, {
          provider: providerName,
          ...executionOptions,
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
        const response = await web.searchAllDetailed(query, executionOptions);
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
                formatAllResults(
                  results,
                  response.errors,
                  response.filterReports,
                  response.providerPagination,
                  response.providerMetadata ?? [],
                ),
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
            providerPagination: response.providerPagination,
            ...(response.providerMetadata === undefined
              ? {}
              : { providerMetadata: response.providerMetadata }),
          },
        };
        return result;
      }

      if (providerName !== undefined) {
        const response = await web.searchProviderDetailed(providerName, query, executionOptions);
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
          content: [
            {
              type: "text",
              text: withHeader(
                header,
                formatSingleResults(response.results, response.pagination, response.metadata),
              ),
            },
          ],
          details: {
            mode: "single",
            query,
            provider: providerName,
            options: searchOptions,
            count: response.results.length,
            results: response.results,
            ignoredFilters: response.ignoredFilters,
            undeclaredFilters: response.undeclaredFilters,
            pagination: response.pagination,
            ...(response.metadata === undefined ? {} : { metadata: response.metadata }),
          },
        };
      }

      const response = await web.searchWithFallback(query, executionOptions);
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
        content: [
          {
            type: "text",
            text: withHeader(
              header,
              formatSingleResults(response.results, response.pagination, response.metadata),
            ),
          },
        ],
        details: {
          mode: "single",
          query,
          provider: response.provider,
          options: searchOptions,
          count: response.results.length,
          results: response.results,
          ignoredFilters: response.ignoredFilters,
          undeclaredFilters: response.undeclaredFilters,
          pagination: response.pagination,
          attempts: response.attempts,
          failures: response.failures,
          ...(response.metadata === undefined ? {} : { metadata: response.metadata }),
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
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<ImageSearchDetails>> {
      const web = await loadWeb();
      const provider = normalizeImageSearchProviderInput(
        params.provider,
        web.searchImageProviders(),
      );
      const url = params.url.trim();
      if (!url) throw new web.EmptyImageUrlError();
      const results = await web.searchByImage(url, {
        provider,
        maxResults: params.maxResults,
        signal,
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
      "Read-only/open-world network fetch: read one URL or a batch of URLs into normalized content using a read-capable provider. Each batch item has its own result or error. Automatic reads start with Jina, fall back after eligible transient failures, and report every attempt and failure.",
    promptSnippet:
      "Read one URL with web_read, or pass a URL array when several pages are needed independently.",
    promptGuidelines: [
      "Use web_read after search when the user needs the contents of a specific URL.",
      "Use web_search for query-to-URL search; use web_read for URL-to-content reading.",
    ],
    parameters: readParameters,
    ...statusRenderers("web_read"),
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<ReadDetails>> {
      const web = await loadWeb();
      const readProvider = normalizeReadProviderInput(params.provider, web.readProviders());
      const readProviderLabel = readProvider ?? "auto";
      const format = normalizeReadFormat(params.format);
      const readOptions: ReadUrlOptions = stripUndefinedRead({
        format,
        maxTokens: params.maxTokens,
        maxChars: params.maxChars ?? DEFAULT_READ_MAX_CHARS,
        continuation: params.continuation,
        targetSelector: params.targetSelector,
        removeSelector: params.removeSelector,
        timeout: params.timeout,
        noCache: params.noCache,
      });

      if (Array.isArray(params.url) && params.continuation !== undefined) {
        throw new TypeError("continuation is only supported for a single URL");
      }
      if (Array.isArray(params.url)) {
        const outcomes = await web.readBatchDetailed(params.url, {
          provider: readProvider,
          ...readOptions,
          signal,
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
        signal,
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
          failures: response.failures,
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
      "Read only local and environment status: show the running web build and list registered providers with configuration, reachability, operations, read options, result limits, and rich search fields.",
    promptSnippet: "List configured web providers.",
    promptGuidelines: [
      "Use web_providers before web_search if provider availability, limits, fields, or option support is unclear.",
    ],
    parameters: emptyParameters,
    ...statusRenderers("web_providers"),
    async execute(
      _toolCallId: string,
      _params: EmptyParams,
      signal: Readonly<AbortSignal> | undefined,
    ): Promise<
      AgentToolResult<{
        readonly runtime: RuntimeInfo;
        readonly packageCapabilities: typeof import("../../../src/index.ts").packageCapabilities;
        readonly providers: readonly ProviderStatus[];
      }>
    > {
      const web = await loadWeb();
      const statuses = await web.listProvidersAsync({ signal });
      const lines = statuses.map((s) => formatProviderStatus(s));
      const runtimeLine = `web ${web.runtimeInfo.version} build ${web.runtimeInfo.buildId}, started ${web.runtimeInfo.processStartedAt}`;
      const readLimit = web.packageCapabilities.read.outputLimit;
      const searchContinuation = web.packageCapabilities.search.continuation;
      const packageLine = `search continuation=${searchContinuation.option} (${searchContinuation.scope}); portable read content: ${readLimit.option} defaults to ${readLimit.agentDefault}, max ${readLimit.agentMaximum}; continuation=${web.packageCapabilities.read.continuation.option}`;
      return {
        content: [
          {
            type: "text",
            text: [
              runtimeLine,
              packageLine,
              ...(lines.length > 0 ? lines : ["No providers registered."]),
            ].join("\n"),
          },
        ],
        details: {
          runtime: web.runtimeInfo,
          packageCapabilities: web.packageCapabilities,
          providers: statuses,
        },
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
  readonly provider: string;
  readonly results: readonly SearchResult[];
};

async function runWebCommand(args: string, ui: CommandUi): Promise<void> {
  const enteredQuery = args.trim() || (await ui.input("Search the web", "Enter a search query"));
  const query = enteredQuery?.trim();
  if (!query) return;

  const found = await searchForCommand(query, ui);
  if (!found || found.results.length === 0) return;
  const labels = found.results.map(formatCompactResult);
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

function isKnownProvider(name: string, providerNames: readonly string[]): boolean {
  return providerNames.some((provider) => provider === name);
}

function normalizeSearchProviderInput(
  provider: string | undefined,
  providerNames: readonly string[],
): string | undefined {
  const rawProvider = (provider ?? "").trim() || undefined;
  if (rawProvider === undefined || rawProvider === "auto") return undefined;
  if (rawProvider === "all") return "all";
  if (!isKnownProvider(rawProvider, providerNames)) {
    throw new Error(
      `Unknown provider "${rawProvider}". Available: auto, all, ${providerNames.join(", ")}.`,
    );
  }
  return rawProvider;
}

function normalizeImageSearchProviderInput(
  provider: string | undefined,
  providerNames: readonly string[],
): string {
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
  readProviderNames: readonly string[],
): string | undefined {
  const rawProvider = provider?.trim() || undefined;
  if (rawProvider === undefined || rawProvider === "auto") return undefined;
  if (!isKnownProvider(rawProvider, readProviderNames)) {
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
  readonly continuation?: string;
  readonly highlights?: boolean;
  readonly summary?: boolean;
  readonly fullText?: boolean;
  readonly includeDomains?: readonly string[];
  readonly excludeDomains?: readonly string[];
  readonly sources?: readonly string[];
  readonly categories?: readonly string[];
  readonly startPublishedDate?: string;
  readonly endPublishedDate?: string;
  readonly category?: string;
};

function stripUndefined(input: SearchOptionValues): SearchPageOptions {
  return {
    ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
    ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
    ...(input.highlights === undefined ? {} : { highlights: input.highlights }),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.fullText === undefined ? {} : { fullText: input.fullText }),
    ...searchArrayOptions(input),
    ...(input.startPublishedDate === undefined
      ? {}
      : { startPublishedDate: input.startPublishedDate }),
    ...(input.endPublishedDate === undefined ? {} : { endPublishedDate: input.endPublishedDate }),
    ...(input.category === undefined ? {} : { category: input.category }),
  };
}

function searchArrayOptions(input: SearchOptionValues): SearchPageOptions {
  return {
    ...(input.includeDomains === undefined ? {} : { includeDomains: input.includeDomains }),
    ...(input.excludeDomains === undefined ? {} : { excludeDomains: input.excludeDomains }),
    ...(input.sources === undefined ? {} : { sources: input.sources }),
    ...(input.categories === undefined ? {} : { categories: input.categories }),
  };
}

function stripUndefinedRead(input: Readonly<ReadUrlOptions>): ReadUrlOptions {
  return {
    ...(input.format === undefined ? {} : { format: input.format }),
    ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars }),
    ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
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
  return `${symbol} ${s.name}${envLabel}${reachabilityNote} ${formatProviderCapabilities(s)}`;
}

function providerStatusSymbol(status: Readonly<ProviderStatus>): string {
  if (!status.configured) return "·";
  return status.reachable === false ? "⚠" : "✓";
}

type SearchResultView = Readonly<Omit<SearchResult, "highlights" | "metadata">> & {
  readonly highlights?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
};
type SearchAllEvidenceView = SearchResultView & {
  readonly provider: SearchAllResult["provider"];
};
type SearchAllResultView = SearchAllEvidenceView & {
  readonly providers: readonly string[];
  readonly evidence: readonly SearchAllEvidenceView[];
};
type SearchBatchItemView =
  | { readonly query: string; readonly error: string }
  | {
      readonly query: string;
      readonly provider: string;
      readonly results: readonly SearchResultView[];
      readonly filterReports: readonly SearchFilterReport[];
      readonly pagination?: SearchPagination;
      readonly providerPagination?: readonly SearchProviderPagination[];
      readonly providerMetadata?: readonly SearchProviderMetadata[];
    };
type ReadBatchItemView =
  | { readonly url: string; readonly error: string }
  | {
      readonly url: string;
      readonly requestedProvider: string;
      readonly provider: string;
      readonly attempts: readonly string[];
      readonly result: Readonly<
        Pick<ReadResult, "title" | "url" | "description" | "content" | "truncated" | "continuation">
      >;
    };
type ProviderErrorView = { readonly provider: string; readonly error: Readonly<Error> };

function formatCompactResult(result: SearchResultView, index?: number): string {
  const head = index === undefined ? "" : `${index + 1}. `;
  const title = truncateSingleLine(result.title || "(no title)", 300);
  const url = truncateSingleLine(result.url, 500);
  const snippet = result.snippet ? ` - ${truncateSingleLine(result.snippet, 120)}` : "";
  return `${head}${title}\n   ${url}${snippet}`;
}

function formatModelResult(
  result: SearchResultView,
  index: number,
  providers?: string,
  maxCharacters = MODEL_RESULT_MAX_CHARACTERS,
): string {
  const title = truncateModelValue(result.title || "(no title)", 160);
  const url = truncateModelValue(result.url, 300);
  const lines = [
    `${index + 1}. ${title}`,
    `   ${url}`,
    formatModelField("Snippet", result.snippet),
    formatModelField("Providers", providers, 160),
    formatModelField("Score", result.score, 40),
    formatModelField("Published", result.publishedDate, 100),
    formatModelField("Author", result.author, 160),
    formatModelField("Image", result.image),
    formatModelField("Favicon", result.favicon),
    formatModelField("Summary", result.summary),
    formatModelField("Highlights", result.highlights?.join(" | "), 400),
    result.metadata === undefined
      ? ""
      : formatModelField("Metadata", formatMetadataValue(result.metadata), 400),
    formatModelField("Text", result.text, MODEL_TEXT_MAX_CHARACTERS),
  ].filter(Boolean);
  return truncateCharacters(lines.join("\n"), maxCharacters);
}

function formatModelField(
  label: string,
  value: string | number | undefined,
  maxCharacters = MODEL_FIELD_MAX_CHARACTERS,
): string {
  if (value === undefined || value === "") return "";
  return `   ${label}: ${truncateModelValue(String(value), maxCharacters)}`;
}

function truncateModelValue(value: string, maxCharacters: number): string {
  const safe = truncateSingleLine(value, MODEL_RESULT_MAX_CHARACTERS);
  return truncateCharacters(safe, maxCharacters);
}

function truncateModelResult(text: string): string {
  return truncateCharacters(text, MODEL_RESULT_MAX_CHARACTERS);
}

function truncateCharacters(text: string, maxCharacters: number): string {
  const characters = Array.from(text);
  if (characters.length <= maxCharacters) return text;
  return `${characters.slice(0, maxCharacters - 1).join("")}…`;
}

function formatResults(results: readonly SearchResultView[]): readonly string[] {
  return results.map((result, index) => formatModelResult(result, index));
}

function formatBatchResults(
  results: readonly SearchResultView[],
  provider: string,
): readonly string[] {
  if (provider !== "all") return formatResults(results);
  return results.map((result, index) =>
    hasResultProvenance(result)
      ? formatSearchAllModelResult(result, index)
      : formatModelResult(result, index),
  );
}

function hasResultProvenance(result: SearchResultView): result is SearchAllResultView {
  return (
    "provider" in result &&
    typeof result.provider === "string" &&
    "providers" in result &&
    Array.isArray(result.providers) &&
    "evidence" in result &&
    Array.isArray(result.evidence)
  );
}

function formatSingleResults(
  results: readonly SearchResultView[],
  pagination: SearchPagination,
  metadata: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  const lines = results.length === 0 ? ["No results."] : [...formatResults(results)];
  lines.push(...formatPagination(pagination));
  if (metadata !== undefined) {
    lines.push("", `Provider metadata: ${formatMetadataValue(metadata)}`);
  }
  return lines;
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

function formatSearchAllModelResult(result: SearchAllResultView, index: number): string {
  const header = formatModelResult(
    result,
    index,
    result.providers.join(", "),
    Math.floor(MODEL_RESULT_MAX_CHARACTERS / 3),
  );
  const heading = "\n   Evidence:\n";
  const separators = Math.max(0, result.evidence.length - 1);
  const remainingCharacters =
    MODEL_RESULT_MAX_CHARACTERS -
    Array.from(header).length -
    Array.from(heading).length -
    separators;
  const evidenceMaxCharacters = Math.max(
    2,
    Math.floor(remainingCharacters / Math.max(1, result.evidence.length)),
  );
  const evidence = result.evidence.map((record, evidenceIndex) =>
    formatModelResult(record, evidenceIndex, record.provider, evidenceMaxCharacters),
  );
  return truncateModelResult(`${header}${heading}${evidence.join("\n")}`);
}

function formatAllResults(
  results: readonly SearchAllResultView[],
  errors: readonly ProviderErrorView[],
  filterReports: readonly SearchFilterReport[],
  providerPagination: readonly SearchProviderPagination[],
  providerMetadata: readonly SearchProviderMetadata[],
): readonly string[] {
  const lines =
    results.length === 0
      ? ["No results."]
      : results.map((result, index) => formatSearchAllModelResult(result, index));
  lines.push(
    ...formatFilterReports(filterReports),
    ...formatProviderPaginations(providerPagination),
    ...formatProviderMetadata(providerMetadata),
  );
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
        ...(outcome.results.length === 0
          ? ["No results."]
          : formatBatchResults(outcome.results, outcome.provider)),
        ...formatFilterReports(outcome.filterReports),
        ...(outcome.pagination === undefined ? [] : formatPagination(outcome.pagination)),
        ...formatProviderPaginations(outcome.providerPagination ?? []),
        ...formatProviderMetadata(outcome.providerMetadata ?? []),
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

function formatPagination(pagination: SearchPagination): readonly string[] {
  return pagination.status === "next" || pagination.status === "unknown"
    ? [
        "",
        `Continuation (${pagination.status}): ${sanitizeTerminalText(pagination.continuation, MAX_SEARCH_CONTINUATION_CHARACTERS)}`,
      ]
    : [];
}

function formatProviderPaginations(
  records: readonly SearchProviderPagination[],
): readonly string[] {
  const continuing = records.filter(
    (
      record,
    ): record is SearchProviderPagination & {
      readonly pagination: Extract<SearchPagination, { readonly status: "next" | "unknown" }>;
    } => record.pagination.status === "next" || record.pagination.status === "unknown",
  );
  if (continuing.length === 0) return [];
  return [
    "",
    "Provider continuations:",
    ...continuing.map(
      ({ provider, pagination }) =>
        `  ${sanitizeTerminalText(provider, 80)}: ${sanitizeTerminalText(pagination.continuation, MAX_SEARCH_CONTINUATION_CHARACTERS)}`,
    ),
  ];
}

function formatProviderMetadata(records: readonly SearchProviderMetadata[]): readonly string[] {
  if (records.length === 0) return [];
  return [
    "",
    "Provider metadata:",
    ...records.map(
      ({ provider, metadata }) =>
        `  ${truncateSingleLine(provider, 80)}: ${formatMetadataValue(metadata)}`,
    ),
  ];
}

function formatMetadataValue(metadata: Readonly<Record<string, unknown>>): string {
  try {
    return truncateSingleLine(JSON.stringify(metadata), 500);
  } catch {
    return "[unserializable metadata]";
  }
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
  result: Readonly<
    Pick<ReadResult, "title" | "url" | "description" | "content" | "truncated" | "continuation">
  >,
): readonly string[] {
  const lines = [result.title || "(no title)", `   ${result.url}`];
  if (result.description) lines.push(`   ${truncateSingleLine(result.description, 160)}`);
  if (result.content) lines.push("", result.content);
  if (result.truncated) {
    const continuation = result.continuation
      ? `; continuation=${sanitizeTerminalText(result.continuation, 1024)}`
      : "";
    lines.push("", `[truncated${continuation}]`);
  }
  return lines;
}

function truncateSingleLine(text: string, maxLength: number): string {
  return sanitizeTerminalText(text, maxLength);
}
