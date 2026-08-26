import type { AgentToolResult, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import type {
  ProviderStatus,
  ReadOptions,
  ReadProviderName,
  ReadResult,
  SearchAllResult,
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

type SearchDetails = SearchSingleDetails | SearchAllDetails;

type ReadDetails = {
  readonly mode: "read";
  readonly url: string;
  readonly provider: ReadProviderName;
  readonly options: ReadOptions;
  readonly result: ReadResult;
};

type WebModule = typeof import("@agntn/web");

let webModulePromise: Promise<WebModule> | undefined;

function loadWeb(): Promise<WebModule> {
  webModulePromise ??= import("@agntn/web").catch(() => import("../../../src/index.ts"));
  return webModulePromise;
}

const PROVIDERS = [
  "auto",
  "all",
  "brave",
  "exa",
  "firecrawl",
  "jina",
  "searxng",
  "serpapi",
  "serpbase",
  "tavily",
] as const;
const PROVIDER_HINT = `Provider to use. One of: ${PROVIDERS.join(", ")}. "auto" (or omit) picks the first available provider from env. Use "all" to query every configured provider in parallel.`;
const READ_PROVIDER_HINT =
  "Read provider to use. Defaults to Jina and is validated against web.readProviderNames at execution time.";

const MAX_RESULTS_HARD_CAP = 20;
const DEFAULT_MAX_RESULTS = 10;

const searchParameters = Type.Object({
  query: Type.String({ description: "Search query." }),
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
  url: Type.String({ description: "URL to read." }),
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
type EmptyParams = Static<typeof emptyParameters>;
type ProviderInput = (typeof PROVIDERS)[number];
type ReadProviderInput = ReadProviderName;

export default function webExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Read-only/open-world network search: query one configured provider (Brave, Exa, Firecrawl, Jina, Tavily, SerpAPI, SerpBase, SearXNG) or fan out to every available provider with provider=all. Always returns {url, title, snippet}; optional fields vary by provider: Exa adds summary/highlights/full text + score/author/image, Firecrawl adds markdown content from scraped pages, Jina adds content/text + published date/image/metadata, Tavily adds full raw_content + score, Brave adds extra_snippets, SerpAPI adds thumbnail + position metadata, SerpBase adds Google SERP rank/request metadata, SearXNG adds engine metadata. Pick provider for the shape you need.",
    promptSnippet:
      "Search the web with web_search. Use provider=all to query every configured provider in parallel.",
    promptGuidelines: [
      "Use web_search when the user explicitly asks for fresh web information, news, references, or links.",
      "Prefer a single provider when the user names one; use provider=all when freshness or coverage matters and at least two providers are configured.",
      "For AI-style summaries/highlights/full page text prefer Exa; for Jina Search Foundation results use Jina; for raw full page content prefer Tavily; for classic SERP metadata Brave/SerpAPI/SerpBase/SearXNG are fine.",
      "Pass maxResults conservatively (5-10) unless the user asks for more.",
      "Forward includeDomains/excludeDomains/startPublishedDate/endPublishedDate when the user gives concrete filters.",
    ],
    parameters: searchParameters,
    renderCall(args, theme) {
      return new Text(renderSearchCall(args, theme), 0, 0);
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<SearchDetails>> {
      const query = params.query.trim();
      if (!query) {
        throw new Error("Query cannot be empty");
      }

      const rawProvider = (params.provider ?? "").trim() || undefined;
      let providerName: "all" | WebSearchProviderName | undefined;
      if (rawProvider === undefined) {
        providerName = undefined;
      } else {
        if (!isKnownProvider(rawProvider)) {
          throw new Error(`Unknown provider "${rawProvider}". Available: ${PROVIDERS.join(", ")}.`);
        }
        providerName = normalizeProvider(rawProvider);
      }

      const searchOptions: SearchRequestOptions = stripUndefined({
        maxResults: params.maxResults,
        includeDomains: params.includeDomains,
        excludeDomains: params.excludeDomains,
        category: params.category,
        startPublishedDate: params.startPublishedDate,
        endPublishedDate: params.endPublishedDate,
      });

      const web = await loadWeb();

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

      const resolvedProvider = providerName ?? (await web.resolveDefaultProviderAsync());
      const provider = web.createSearchProvider(resolvedProvider);
      const results = await provider.search(query, searchOptions);
      const header = buildHeader({
        mode: "single",
        provider: resolvedProvider,
        query,
        count: results.length,
        autoSelected: providerName === undefined,
      });
      const result: AgentToolResult<SearchDetails> = {
        content: [{ type: "text", text: withHeader(header, formatResults(results)) }],
        details: {
          mode: "single",
          query,
          provider: resolvedProvider,
          options: searchOptions,
          count: results.length,
          results,
        },
      };
      return result;
    },
  });

  pi.registerTool({
    name: "web_read",
    label: "Web Read",
    description:
      "Read-only/open-world network fetch: read a URL into normalized content using a read-capable provider. Defaults to Jina Reader (r.jina.ai); Firecrawl is also available for JS-rendered pages, PDFs, and structured extraction. Returns URL, title/description when available, canonical content, and optional text/html/images/metadata.",
    promptSnippet: "Read a URL with web_read when page content is needed, not just search results.",
    promptGuidelines: [
      "Use web_read after search when the user needs the contents of a specific URL.",
      "Use web_search for query-to-URL search; use web_read for URL-to-content reading.",
    ],
    parameters: readParameters,
    renderCall(args, theme) {
      return new Text(renderReadCall(args, theme), 0, 0);
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<ReadDetails>> {
      const url = params.url.trim();
      if (!url) {
        throw new Error("URL cannot be empty");
      }

      const web = await loadWeb();
      const defaultReadProvider: ReadProviderName = web.readProviderNames[0] ?? "jina";
      const rawProvider = (params.provider ?? defaultReadProvider).trim() || defaultReadProvider;
      if (!isKnownReadProvider(rawProvider, web.readProviderNames)) {
        throw new Error(
          `Unknown read provider "${rawProvider}". Available: ${web.readProviderNames.join(", ")}.`,
        );
      }

      const format = normalizeReadFormat(params.format);
      const readOptions: ReadOptions = stripUndefinedRead({
        format,
        maxTokens: params.maxTokens,
        targetSelector: params.targetSelector,
        removeSelector: params.removeSelector,
        timeout: params.timeout,
        noCache: params.noCache,
      });

      const result = await web.readUrl(url, { provider: rawProvider, ...readOptions });
      const header = `[provider=${rawProvider}] read ${result.url}`;
      return {
        content: [{ type: "text", text: withHeader(header, formatReadResult(result)) }],
        details: {
          mode: "read",
          url,
          provider: rawProvider,
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
  let provider: WebSearchProviderName;
  try {
    provider = await web.resolveDefaultProviderAsync();
  } catch (error) {
    ui.notify(`No reachable web providers. ${errorMessage(error)}`, "warning");
    return undefined;
  }

  try {
    const results = await web
      .createSearchProvider(provider)
      .search(query, { maxResults: DEFAULT_MAX_RESULTS });
    if (results.length === 0) ui.notify(`No results for "${query}" via ${provider}.`, "warning");
    return { provider, results };
  } catch (error) {
    ui.notify(`web ${provider} failed: ${errorMessage(error)}`, "error");
    return undefined;
  }
}

function isKnownProvider(name: string): name is ProviderInput {
  return PROVIDERS.some((provider) => provider === name);
}

function isKnownReadProvider(
  name: string,
  readProviderNames: readonly string[],
): name is ReadProviderInput {
  return readProviderNames.some((provider) => provider === name);
}

function normalizeReadFormat(format: string | undefined): ReadOptions["format"] {
  if (format === undefined || format === "") return undefined;
  if (format === "markdown" || format === "text" || format === "html") return format;
  throw new Error('Invalid read format. Expected "markdown", "text", or "html".');
}

function normalizeProvider(
  provider: ProviderInput | undefined,
): "all" | WebSearchProviderName | undefined {
  if (provider === "auto") {
    return undefined;
  }
  return provider;
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

function formatReadResult(
  result: Readonly<Pick<ReadResult, "title" | "url" | "description" | "content">>,
): readonly string[] {
  const lines = [result.title || "(no title)", `   ${result.url}`];
  if (result.description) lines.push(`   ${truncateSingleLine(result.description, 160)}`);
  if (result.content) lines.push("", result.content);
  return lines;
}

function renderSearchCall(
  params: SearchOptionValues & Readonly<Pick<SearchParams, "query" | "provider">>,
  theme: Readonly<Pick<Theme, "bold" | "fg">>,
): string {
  return [
    theme.fg("toolTitle", theme.bold("web_search")),
    theme.fg("dim", `"${truncateSingleLine(params.query, 120)}"`),
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
  params: Readonly<ReadParams>,
  theme: Readonly<Pick<Theme, "bold" | "fg">>,
): string {
  const parts = [
    theme.fg("toolTitle", theme.bold("web_read")),
    theme.fg("dim", truncateSingleLine(params.url, 120)),
  ];
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
