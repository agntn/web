import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Type, type TProperties, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { webToolTitle } from "./tui.ts";
import { builtinProviders } from "./core/providers.ts";
import { searchProviders, searchImageProviders, readProviders } from "./core/registry.ts";
import { searchAllDetailed, searchProviderDetailed, searchWithFallback } from "./core/all.ts";
import { imageSearchProviderNames, searchByImage } from "./core/image.ts";
import {
  DEFAULT_AGENT_READ_MAX_CHARS,
  MAX_AGENT_READ_CHARS,
  packageCapabilities,
  readProviderNames,
  readUrlDetailed,
} from "./core/read.ts";
import { MAX_BATCH_ITEMS, readBatchDetailed, searchBatch } from "./core/batch.ts";
import { EmptyImageUrlError, EmptyQueryError } from "./core/errors.ts";
import { listProvidersAsync } from "./core/resolve.ts";
import { MAX_SEARCH_CONTINUATION_LENGTH } from "./core/search-continuation.ts";
import { searchFilterNames, type SearchPageOptions } from "./core/types.ts";
import "./providers/index.ts";
import { runtimeInfo, version } from "./version.ts";

const MAX_RESULTS_HARD_CAP = 20;

const advertisedSearchProviderNames = [...builtinProviders, "all"] as const;
const strictObject = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const unknownRecordSchema = Type.Record(Type.String(), Type.Unknown());
const searchFilterSchema = Type.Union(searchFilterNames.map((name) => Type.Literal(name)));
const namedSearchProviderSchema = Type.String({ pattern: "^(?!all$).+" });
const searchResultProperties = {
  url: Type.String(),
  title: Type.String(),
  snippet: Type.String(),
  score: Type.Optional(Type.Number()),
  publishedDate: Type.Optional(Type.String()),
  author: Type.Optional(Type.String()),
  image: Type.Optional(Type.String()),
  favicon: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  highlights: Type.Optional(Type.Array(Type.String())),
  summary: Type.Optional(Type.String()),
  metadata: Type.Optional(unknownRecordSchema),
};
const searchResultSchema = strictObject(searchResultProperties);
const searchAllEvidenceSchema = strictObject({
  ...searchResultProperties,
  provider: Type.String(),
});
const searchAllResultSchema = strictObject({
  ...searchResultProperties,
  provider: Type.String(),
  providers: Type.Array(Type.String()),
  evidence: Type.Array(searchAllEvidenceSchema),
});
const searchFilterReportSchema = strictObject({
  provider: Type.String(),
  ignoredFilters: Type.Array(searchFilterSchema),
  undeclaredFilters: Type.Array(searchFilterSchema),
});
const searchProviderMetadataSchema = strictObject({
  provider: Type.String(),
  metadata: unknownRecordSchema,
});
const providerFailureSchema = strictObject({
  provider: Type.String(),
  error: Type.String(),
});
const searchPaginationSchema = Type.Union([
  strictObject({ status: Type.Literal("next"), continuation: Type.String() }),
  strictObject({ status: Type.Literal("unknown"), continuation: Type.String() }),
  strictObject({ status: Type.Literal("end") }),
  strictObject({ status: Type.Literal("unsupported") }),
]);
const searchProviderPaginationSchema = strictObject({
  provider: Type.String(),
  pagination: searchPaginationSchema,
});
const searchProviderResultSchema = strictObject({
  provider: Type.String(),
  results: Type.Array(searchResultSchema),
  ignoredFilters: Type.Array(searchFilterSchema),
  undeclaredFilters: Type.Array(searchFilterSchema),
  pagination: searchPaginationSchema,
  metadata: Type.Optional(unknownRecordSchema),
  attempts: Type.Optional(Type.Array(Type.String())),
  failures: Type.Optional(Type.Array(providerFailureSchema)),
});
const searchAllResponseSchema = strictObject({
  results: Type.Array(searchAllResultSchema),
  successfulProviders: Type.Array(Type.String()),
  errors: Type.Array(strictObject({ provider: Type.String(), error: Type.String() })),
  filterReports: Type.Array(searchFilterReportSchema),
  providerPagination: Type.Array(searchProviderPaginationSchema),
  providerMetadata: Type.Optional(Type.Array(searchProviderMetadataSchema)),
});
const searchBatchItemSchema = Type.Union([
  strictObject({
    query: Type.String(),
    provider: namedSearchProviderSchema,
    results: Type.Array(searchResultSchema),
    filterReports: Type.Array(searchFilterReportSchema),
    pagination: searchPaginationSchema,
    providerMetadata: Type.Optional(Type.Array(searchProviderMetadataSchema)),
    attempts: Type.Optional(Type.Array(Type.String())),
    failures: Type.Optional(Type.Array(providerFailureSchema)),
  }),
  strictObject({
    query: Type.String(),
    provider: Type.Literal("all"),
    results: Type.Array(searchAllResultSchema),
    filterReports: Type.Array(searchFilterReportSchema),
    providerPagination: Type.Array(searchProviderPaginationSchema),
    providerMetadata: Type.Optional(Type.Array(searchProviderMetadataSchema)),
  }),
  strictObject({
    query: Type.String(),
    error: Type.String(),
    attempts: Type.Optional(Type.Array(Type.String())),
    failures: Type.Optional(Type.Array(providerFailureSchema)),
  }),
]);
const searchOutputSchema = strictObject({
  result: Type.Union([
    searchProviderResultSchema,
    searchAllResponseSchema,
    Type.Array(searchBatchItemSchema),
  ]),
});
const imageSearchResultSchema = strictObject({
  pageUrl: Type.String(),
  imageUrl: Type.String(),
  title: Type.String(),
  provider: Type.String(),
  source: Type.Optional(Type.String()),
  thumbnailUrl: Type.Optional(Type.String()),
  imageWidth: Type.Optional(Type.Number()),
  imageHeight: Type.Optional(Type.Number()),
  thumbnailWidth: Type.Optional(Type.Number()),
  thumbnailHeight: Type.Optional(Type.Number()),
  position: Type.Optional(Type.Number()),
  exactMatch: Type.Optional(Type.Boolean()),
});
const imageSearchOutputSchema = strictObject({ result: Type.Array(imageSearchResultSchema) });
const readResultSchema = strictObject({
  url: Type.String(),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  content: Type.String(),
  text: Type.Optional(Type.String()),
  html: Type.Optional(Type.String()),
  publishedDate: Type.Optional(Type.String()),
  image: Type.Optional(Type.String()),
  links: Type.Optional(Type.Array(Type.String())),
  images: Type.Optional(Type.Array(Type.String())),
  metadata: Type.Optional(unknownRecordSchema),
  truncated: Type.Optional(Type.Boolean()),
  continuation: Type.Optional(Type.String()),
});
const readDetailedResultSchema = strictObject({
  result: readResultSchema,
  requestedProvider: Type.String(),
  provider: Type.String(),
  attempts: Type.Array(Type.String()),
  failures: Type.Array(providerFailureSchema),
});
const readBatchItemSchema = Type.Union([
  strictObject({
    url: Type.String(),
    result: readResultSchema,
    requestedProvider: Type.String(),
    provider: Type.String(),
    attempts: Type.Array(Type.String()),
    failures: Type.Array(providerFailureSchema),
  }),
  strictObject({
    url: Type.String(),
    error: Type.String(),
    attempts: Type.Optional(Type.Array(Type.String())),
    failures: Type.Optional(Type.Array(providerFailureSchema)),
  }),
]);
const readOutputSchema = strictObject({
  result: Type.Union([readDetailedResultSchema, Type.Array(readBatchItemSchema)]),
});
const providerResultLimitSchema = Type.Union([
  strictObject({
    default: Type.Number(),
    maximum: Type.Optional(Type.Number()),
  }),
  strictObject({ maximum: Type.Number() }),
]);
const providerCapabilitiesSchema = strictObject({
  search: strictObject({
    supported: Type.Boolean(),
    filters: Type.Optional(Type.Array(searchFilterSchema)),
    categories: Type.Optional(Type.Array(Type.String())),
    contentOptions: Type.Optional(Type.Array(Type.String())),
    pagination: Type.Optional(Type.Boolean()),
    resultLimit: Type.Optional(providerResultLimitSchema),
    resultFields: Type.Optional(Type.Array(Type.String())),
  }),
  searchImage: strictObject({
    supported: Type.Boolean(),
    resultLimit: Type.Optional(providerResultLimitSchema),
  }),
  read: strictObject({
    supported: Type.Boolean(),
    options: Type.Optional(Type.Array(Type.String())),
    formats: Type.Optional(Type.Array(Type.String())),
  }),
});
const providerStatusSchema = strictObject({
  name: Type.String(),
  configured: Type.Boolean(),
  envVar: Type.Union([Type.String(), Type.Null()]),
  reachable: Type.Optional(Type.Boolean()),
  searchFilters: Type.Optional(Type.Array(searchFilterSchema)),
  searchCategories: Type.Optional(Type.Array(Type.String())),
  capabilities: providerCapabilitiesSchema,
});
const packageCapabilitiesSchema = strictObject({
  execution: strictObject({
    cancellation: strictObject({ option: Type.Literal("signal") }),
    deadline: strictObject({
      option: Type.Literal("deadline"),
      unit: Type.Literal("unix-ms"),
    }),
    concurrency: strictObject({
      option: Type.Literal("concurrency"),
      default: Type.Integer({ minimum: 1 }),
      maximum: Type.Integer({ minimum: 1 }),
      scope: Type.Literal("batch-and-fanout"),
    }),
  }),
  search: strictObject({
    continuation: strictObject({
      option: Type.Literal("continuation"),
      opaque: Type.Boolean(),
      maximum: Type.Integer({ minimum: 1 }),
      providerStateMaximum: Type.Integer({ minimum: 1 }),
      scope: Type.Literal("single-provider-query"),
    }),
  }),
  read: strictObject({
    outputLimit: strictObject({
      option: Type.Literal("maxChars"),
      unit: Type.Literal("unicode-code-points"),
      minimum: Type.Number(),
      agentDefault: Type.Number(),
      agentMaximum: Type.Number(),
    }),
    continuation: strictObject({
      option: Type.Literal("continuation"),
      opaque: Type.Boolean(),
    }),
  }),
});
const providersOutputSchema = strictObject({
  result: strictObject({
    runtime: strictObject({
      version: Type.String(),
      buildId: Type.String(),
      processStartedAt: Type.String(),
    }),
    packageCapabilities: packageCapabilitiesSchema,
    providers: Type.Array(providerStatusSchema),
  }),
});

interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: TSchema;
  readonly outputSchema: TSchema;
  readonly annotations: Tool["annotations"];
  execute(args: Readonly<Record<string, unknown>>, signal?: Readonly<AbortSignal>): unknown;
}

const toolsByName: Record<string, ToolDefinition> = Object.fromEntries(
  [
    {
      name: "web_search",
      title: webToolTitle("web_search"),
      description:
        'Search the web using multiple search engines (Brave, Context.dev, Exa, Firecrawl, Jina, Tavily, TinyFish, SerpAPI, SerpBase, SearXNG). Pass one query or a batch of queries; each batch item returns its own results or error. Use provider "all" to query all available providers in parallel and get deduplicated results. Responses report filters the selected provider ignored. Single searches may continue with an opaque token bound to its provider.',
      inputSchema: Type.Object({
        query: Type.Union(
          [
            Type.String({ minLength: 1 }),
            Type.Array(Type.String({ minLength: 1 }), {
              minItems: 1,
              maxItems: MAX_BATCH_ITEMS,
            }),
          ],
          { description: "Search query, or a batch of search queries" },
        ),
        provider: Type.Optional(
          Type.String({
            description: `Provider to use. Built in providers: ${advertisedSearchProviderNames.join(", ")}. Automatic selection tries other configured providers after payment, rate limit, timeout, or server failures. Use "all" for parallel search.`,
          }),
        ),
        maxResults: Type.Optional(
          Type.Integer({
            description: `Max results (default: 10, max: ${MAX_RESULTS_HARD_CAP})`,
            minimum: 1,
            maximum: MAX_RESULTS_HARD_CAP,
          }),
        ),
        continuation: Type.Optional(
          Type.String({
            description: "Opaque token returned by a previous single search.",
            maxLength: MAX_SEARCH_CONTINUATION_LENGTH,
          }),
        ),
        highlights: Type.Optional(
          Type.Boolean({
            description: "Return passages relevant to the query when supported. Defaults to true.",
          }),
        ),
        summary: Type.Optional(
          Type.Boolean({
            description:
              "Request generated summaries or answers when supported. Defaults to false.",
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
              'Only return results from these domains (e.g. ["github.com", "stackoverflow.com"])',
          }),
        ),
        excludeDomains: Type.Optional(
          Type.Array(Type.String(), { description: "Exclude results from these domains" }),
        ),
        sources: Type.Optional(
          Type.Array(Type.String(), {
            description: 'Source types when supported (Firecrawl: "web", "news", "images")',
          }),
        ),
        categories: Type.Optional(
          Type.Array(Type.String(), {
            description:
              'Category filters when supported (Firecrawl: "research", "pdf", "developer")',
          }),
        ),
        category: Type.Optional(
          Type.String({
            description:
              'Single search category (e.g. "news", "general"). Provider support varies.',
          }),
        ),
        startPublishedDate: Type.Optional(
          Type.String({
            description: 'Filter results published after this date (ISO 8601, e.g. "2024-01-01")',
          }),
        ),
        endPublishedDate: Type.Optional(
          Type.String({ description: "Filter results published before this date (ISO 8601)" }),
        ),
      }),
      outputSchema: searchOutputSchema,
      annotations: {
        title: webToolTitle("web_search"),
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      execute: executeSearch,
    },
    {
      name: "web_search_image",
      title: webToolTitle("web_search_image"),
      description:
        "Find public pages containing or resembling an image available by URL. Returns matched page and image URLs with dimensions and rank metadata.",
      inputSchema: Type.Object({
        url: Type.String({
          description: "Public HTTP or HTTPS image URL",
          minLength: 1,
        }),
        provider: Type.Optional(
          Type.String({
            description: `Reverse image search provider. Built in providers: ${imageSearchProviderNames.join(", ")}. Defaults to SerpAPI Google Lens.`,
          }),
        ),
        maxResults: Type.Optional(
          Type.Integer({
            description: `Maximum matches to return (default: 10, max: ${MAX_RESULTS_HARD_CAP})`,
            minimum: 1,
            maximum: MAX_RESULTS_HARD_CAP,
          }),
        ),
      }),
      outputSchema: imageSearchOutputSchema,
      annotations: {
        title: webToolTitle("web_search_image"),
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      execute: executeImageSearch,
    },
    {
      name: "web_read",
      title: webToolTitle("web_read"),
      description:
        "Read one URL or a batch of URLs into normalized content using Jina, Context.dev, Firecrawl, or TinyFish. Automatic reads report every provider attempt and failure after fallback.",
      inputSchema: Type.Object({
        url: Type.Union(
          [
            Type.String({ minLength: 1 }),
            Type.Array(Type.String({ minLength: 1 }), {
              minItems: 1,
              maxItems: MAX_BATCH_ITEMS,
            }),
          ],
          { description: "URL to read, or a batch of URLs" },
        ),
        provider: Type.Optional(
          Type.String({
            description: `Read provider to use. Built in providers: ${readProviderNames.join(", ")}. "auto" starts with Jina and falls back after eligible payment, conflict, rate limit, timeout, or server failures.`,
          }),
        ),
        format: Type.Optional(
          Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")], {
            description: "Preferred content format.",
          }),
        ),
        maxTokens: Type.Optional(
          Type.Integer({
            description: "Maximum tokens to return when supported by the provider.",
            minimum: 1,
          }),
        ),
        maxChars: Type.Optional(
          Type.Integer({
            description: `Maximum page content characters to return. Defaults to ${DEFAULT_AGENT_READ_MAX_CHARS}.`,
            minimum: 1,
            maximum: MAX_AGENT_READ_CHARS,
          }),
        ),
        continuation: Type.Optional(
          Type.String({
            description: "Opaque token returned by a truncated read.",
            maxLength: 1024,
          }),
        ),
        targetSelector: Type.Optional(
          Type.String({ description: "CSS selector to target when supported by the provider." }),
        ),
        removeSelector: Type.Optional(
          Type.String({ description: "CSS selector to remove when supported by the provider." }),
        ),
        timeout: Type.Optional(
          Type.Integer({ description: "Provider timeout in seconds when supported.", minimum: 1 }),
        ),
        noCache: Type.Optional(
          Type.Boolean({ description: "Bypass provider cache when supported." }),
        ),
      }),
      outputSchema: readOutputSchema,
      annotations: {
        title: webToolTitle("web_read"),
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      execute: executeRead,
    },
    {
      name: "web_providers",
      title: webToolTitle("web_providers"),
      description:
        "List registered web providers, their complete operation capabilities, configuration and reachability, and the running build.",
      inputSchema: Type.Object({}),
      outputSchema: providersOutputSchema,
      annotations: {
        title: webToolTitle("web_providers"),
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: async (
        _args: Readonly<Record<string, unknown>>,
        signal?: Readonly<AbortSignal>,
      ) => ({
        runtime: runtimeInfo,
        packageCapabilities,
        providers: await listProvidersAsync({ signal }),
      }),
    },
  ].map((tool) => [tool.name, tool]),
);

/**
 * Resolves search arguments against the same contract the AI SDK tool enforces.
 *
 * A host may skip schema validation, so the executor re-checks the boundaries
 * that would otherwise reach a provider malformed.
 * @param {Readonly<Record<string, unknown>>} args - Untrusted tool arguments.
 * @param signal - MCP request cancellation signal.
 * @returns {Promise<unknown>} Search result payload.
 */
export async function executeSearch(
  args: Readonly<Record<string, unknown>>,
  signal?: Readonly<AbortSignal>,
): Promise<unknown> {
  const query = searchInputArg(args.query);
  const maxResults = intArg("maxResults", args.maxResults);
  if (maxResults !== undefined && maxResults > MAX_RESULTS_HARD_CAP) {
    throw new TypeError(`maxResults must be at most ${MAX_RESULTS_HARD_CAP}`);
  }

  const continuation = stringArg("continuation", args.continuation);
  if (continuation !== undefined && continuation.length > MAX_SEARCH_CONTINUATION_LENGTH) {
    throw new TypeError(
      `continuation must be at most ${MAX_SEARCH_CONTINUATION_LENGTH} characters`,
    );
  }
  if (Array.isArray(query) && continuation !== undefined) {
    throw new TypeError("continuation is only supported for a single query");
  }
  const searchOptions = {
    maxResults,
    continuation,
    highlights: boolArg("highlights", args.highlights),
    summary: boolArg("summary", args.summary),
    fullText: boolArg("fullText", args.fullText),
    includeDomains: stringArrayArg("includeDomains", args.includeDomains),
    excludeDomains: stringArrayArg("excludeDomains", args.excludeDomains),
    sources: stringArrayArg("sources", args.sources),
    categories: stringArrayArg("categories", args.categories),
    category: stringArg("category", args.category),
    startPublishedDate: stringArg("startPublishedDate", args.startPublishedDate),
    endPublishedDate: stringArg("endPublishedDate", args.endPublishedDate),
    signal,
  };

  return runSearch(query, searchProviderArg(args.provider), searchOptions);
}

async function runSearch(
  query: string | readonly string[],
  requestedProvider: string | undefined,
  searchOptions: Readonly<SearchPageOptions>,
): Promise<unknown> {
  if (typeof query !== "string") {
    return searchBatch(query, { provider: requestedProvider, ...searchOptions });
  }
  if (requestedProvider === "all") {
    const response = await searchAllDetailed(query, searchOptions);
    return {
      ...response,
      errors: response.errors.map(({ provider, error }) => ({ provider, error: error.message })),
    };
  }

  if (requestedProvider !== undefined) {
    return searchProviderDetailed(requestedProvider, query, searchOptions);
  }
  return searchWithFallback(query, searchOptions);
}

/**
 * Guards reverse image search when a host skips schema validation.
 * @param args - Untrusted tool arguments.
 * @param signal - MCP request cancellation signal.
 * @returns {Promise<unknown>} Normalized reverse image matches.
 */
export async function executeImageSearch(
  args: Readonly<Record<string, unknown>>,
  signal?: Readonly<AbortSignal>,
): Promise<unknown> {
  const url = stringArg("url", args.url);
  if (!url?.trim()) throw new EmptyImageUrlError();
  const maxResults = intArg("maxResults", args.maxResults);
  if (maxResults !== undefined && maxResults > MAX_RESULTS_HARD_CAP) {
    throw new TypeError(`maxResults must be at most ${MAX_RESULTS_HARD_CAP}`);
  }
  return searchByImage(url, {
    provider: imageSearchProviderArg(args.provider),
    maxResults,
    signal,
  });
}

/**
 * Mirrors {@link executeSearch}: guards the read contract when validation was skipped.
 * @param {Readonly<Record<string, unknown>>} args - Untrusted tool arguments.
 * @param signal - MCP request cancellation signal.
 * @returns {Promise<unknown>} Read result payload.
 */
export async function executeRead(
  args: Readonly<Record<string, unknown>>,
  signal?: Readonly<AbortSignal>,
): Promise<unknown> {
  const urlInput = args.url;
  const urls = Array.isArray(urlInput) ? stringListArg("url", urlInput) : undefined;
  const url = typeof urlInput === "string" ? urlInput : "";
  const format = stringArg("format", args.format);
  if (format !== undefined && format !== "markdown" && format !== "text" && format !== "html") {
    throw new TypeError("format must be one of: markdown, text, html");
  }

  const continuation = stringArg("continuation", args.continuation);
  rejectBatchContinuation(urls, continuation);
  const readOptions = {
    provider: readProviderArg(args.provider),
    format: format as "markdown" | "text" | "html" | undefined,
    maxTokens: intArg("maxTokens", args.maxTokens),
    maxChars: readMaxCharsArg(args.maxChars),
    continuation,
    targetSelector: stringArg("targetSelector", args.targetSelector),
    removeSelector: stringArg("removeSelector", args.removeSelector),
    timeout: intArg("timeout", args.timeout),
    noCache: boolArg("noCache", args.noCache),
    signal,
  };
  return urls === undefined
    ? readUrlDetailed(url, readOptions)
    : readBatchDetailed(urls, readOptions);
}

/**
 * Boundary guards for typed options when a host skips schema validation.
 *
 * They enforce exactly the declared schema contract and throw instead of
 * silently dropping or coercing: jina iterates includeDomains with for...of,
 * so a bare string would reach the API as one `site=` param per character,
 * and fractional maxTokens would become an X-Token-Budget header. The MCP
 * handler wraps these in errorResult.
 * @param {string} name - Argument name used in errors.
 * @param {*} value - Untrusted argument value.
 * @returns {string | undefined} Parsed optional string.
 */
function stringArg(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
  return value;
}

function searchInputArg(value: unknown): string | readonly string[] {
  if (Array.isArray(value)) return stringListArg("query", value);
  if (typeof value !== "string" || !value.trim()) {
    throw new EmptyQueryError();
  }
  return value;
}

function searchProviderArg(value: unknown): string | undefined {
  if (value === undefined || value === "auto") return undefined;
  if (value === "all") return value;
  const provider = searchProviders().find((name) => name === value);
  if (!provider) {
    throw new TypeError(`provider must be one of: auto, all, ${searchProviders().join(", ")}`);
  }
  return provider;
}

function imageSearchProviderArg(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const provider = searchImageProviders().find((name) => name === value);
  if (!provider) {
    throw new TypeError(`provider must be one of: ${searchImageProviders().join(", ")}`);
  }
  return provider;
}

function readProviderArg(value: unknown): string | undefined {
  if (value === undefined || value === "auto") return undefined;
  const provider = readProviders().find((name) => name === value);
  if (!provider) {
    throw new TypeError(`provider must be one of: auto, ${readProviders().join(", ")}`);
  }
  return provider;
}

function intArg(name: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be an integer >= 1`);
  }
  return value;
}

function rejectBatchContinuation(
  urls: readonly string[] | undefined,
  continuation: string | undefined,
): void {
  if (urls !== undefined && continuation !== undefined) {
    throw new TypeError("continuation is only supported for a single URL");
  }
}

function readMaxCharsArg(value: unknown): number {
  const maxChars = intArg("maxChars", value) ?? DEFAULT_AGENT_READ_MAX_CHARS;
  if (maxChars > MAX_AGENT_READ_CHARS) {
    throw new TypeError(`maxChars must be at most ${MAX_AGENT_READ_CHARS}`);
  }
  return maxChars;
}

function boolArg(name: string, value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean`);
  }
  return value;
}

function stringArrayArg(name: string, value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array of strings`);
  return value.map((item) => {
    if (typeof item !== "string") throw new TypeError(`${name} must be an array of strings`);
    return item;
  });
}

function stringListArg(name: string, value: readonly unknown[]): readonly string[] {
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new TypeError(`${name} must be a string or an array of strings`);
    }
    return item;
  });
}

/**
 * Formats the first TypeBox validation failure for an MCP client.
 * @param {TSchema} schema - Tool input schema.
 * @param {*} value - Value rejected by the schema.
 * @returns {string} Client-facing validation message.
 */
function validationError(schema: TSchema, value: unknown): string {
  const first = Value.Errors(schema, value)[0];
  if (!first) return "Invalid arguments";
  return `Invalid arguments at ${first.instancePath || "/"}: ${first.message}`;
}

/**
 * Wraps error text for the MCP client, replacing control bytes with spaces.
 *
 * Every error branch goes through here because parts of these messages echo
 * client-controlled values (a tool name, an argument) or downstream error
 * messages: one raw newline or escape byte would forge extra lines that read
 * as the server's own answer.
 * @param {string} text - Error text to sanitize.
 * @returns {CallToolResult} MCP error envelope.
 */
function errorResult(text: string): CallToolResult {
  return {
    content: [{ type: "text", text: text.replaceAll(/\p{Cc}/gu, " ") }],
    isError: true,
  };
}

/**
 * Creates the low level MCP server so Pi and MCP can share TypeBox schemas without a parallel Zod definition.
 * Successful calls return schema checked data and compact JSON text for older clients.
 * @returns {Server} Unconnected MCP server.
 */
export function createMcpServer(): Server {
  const server = new Server({ name: "web", version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Object.values(toolsByName).map((tool): Tool => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as Tool["inputSchema"],
      outputSchema: tool.outputSchema as Tool["outputSchema"],
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    if (!Object.hasOwn(toolsByName, name)) {
      return errorResult(`Unknown web tool: ${JSON.stringify(name)}`);
    }
    const tool = toolsByName[name];

    const args = request.params.arguments ?? {};
    if (!Value.Check(tool.inputSchema, args)) {
      return errorResult(validationError(tool.inputSchema, args));
    }

    try {
      const result = await tool.execute(args, extra.signal);
      const structuredContent = { result };
      if (!Value.Check(tool.outputSchema, structuredContent)) {
        return errorResult(`${tool.name} returned a result that does not match its output schema`);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent,
      };
    } catch (error) {
      return errorResult(
        `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  return server;
}
