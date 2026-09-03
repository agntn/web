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
import { searchAllDetailed, searchProviderDetailed, searchWithFallback } from "./core/all.ts";
import {
  imageSearchProviderNames,
  searchByImage,
  type ImageSearchProviderName,
} from "./core/image.ts";
import { readProviderNames, readUrlDetailed, type ReadProviderName } from "./core/read.ts";
import { MAX_BATCH_ITEMS, readBatchDetailed, searchBatch } from "./core/batch.ts";
import { EmptyImageUrlError, EmptyQueryError } from "./core/errors.ts";
import { listProvidersAsync } from "./core/resolve.ts";
import { searchFilterNames, type SearchRequestOptions } from "./core/types.ts";
import "./providers/index.ts";
import { runtimeInfo, version } from "./version.ts";

const MAX_RESULTS_HARD_CAP = 20;

const providerNames = [...builtinProviders, "all"] as const;
const strictObject = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const unknownRecordSchema = Type.Record(Type.String(), Type.Unknown());
const searchFilterSchema = Type.Union(searchFilterNames.map((name) => Type.Literal(name)));
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
const searchAllResultSchema = strictObject({
  ...searchResultProperties,
  provider: Type.String(),
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
const searchProviderResultSchema = strictObject({
  provider: Type.String(),
  results: Type.Array(searchResultSchema),
  ignoredFilters: Type.Array(searchFilterSchema),
  undeclaredFilters: Type.Array(searchFilterSchema),
  metadata: Type.Optional(unknownRecordSchema),
  attempts: Type.Optional(Type.Array(Type.String())),
  failures: Type.Optional(Type.Array(providerFailureSchema)),
});
const searchAllResponseSchema = strictObject({
  results: Type.Array(searchAllResultSchema),
  successfulProviders: Type.Array(Type.String()),
  errors: Type.Array(strictObject({ provider: Type.String(), error: Type.String() })),
  filterReports: Type.Array(searchFilterReportSchema),
  providerMetadata: Type.Optional(Type.Array(searchProviderMetadataSchema)),
});
const searchBatchItemSchema = Type.Union([
  strictObject({
    query: Type.String(),
    provider: Type.Union(builtinProviders.map((name) => Type.Literal(name))),
    results: Type.Array(searchResultSchema),
    filterReports: Type.Array(searchFilterReportSchema),
    providerMetadata: Type.Optional(Type.Array(searchProviderMetadataSchema)),
    attempts: Type.Optional(Type.Array(Type.String())),
    failures: Type.Optional(Type.Array(providerFailureSchema)),
  }),
  strictObject({
    query: Type.String(),
    provider: Type.Literal("all"),
    results: Type.Array(searchAllResultSchema),
    filterReports: Type.Array(searchFilterReportSchema),
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
const providerStatusSchema = strictObject({
  name: Type.String(),
  configured: Type.Boolean(),
  envVar: Type.Union([Type.String(), Type.Null()]),
  reachable: Type.Optional(Type.Boolean()),
  searchFilters: Type.Optional(Type.Array(searchFilterSchema)),
  searchCategories: Type.Optional(Type.Array(Type.String())),
});
const providersOutputSchema = strictObject({
  result: strictObject({
    runtime: strictObject({
      version: Type.String(),
      buildId: Type.String(),
      processStartedAt: Type.String(),
    }),
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
  execute(args: Readonly<Record<string, unknown>>): unknown;
}

const toolsByName: Record<string, ToolDefinition> = Object.fromEntries(
  [
    {
      name: "web_search",
      title: webToolTitle("web_search"),
      description:
        'Search the web using multiple search engines (Brave, Context.dev, Exa, Firecrawl, Jina, Tavily, TinyFish, SerpAPI, SerpBase, SearXNG). Pass one query or a batch of queries; each batch item returns its own results or error. Use provider "all" to query all available providers in parallel and get deduplicated results. Responses report filters the selected provider ignored.',
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
          Type.Union(
            providerNames.map((name) => Type.Literal(name)),
            {
              description:
                'Provider to use. Automatic selection tries other configured providers after payment, rate-limit, timeout, or server failures. Use "all" for parallel search.',
            },
          ),
        ),
        maxResults: Type.Optional(
          Type.Integer({
            description: `Max results (default: 10, max: ${MAX_RESULTS_HARD_CAP})`,
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
          Type.Union(
            imageSearchProviderNames.map((name) => Type.Literal(name)),
            {
              description: "Reverse image search provider. Defaults to SerpAPI Google Lens.",
            },
          ),
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
          Type.Union(
            [Type.Literal("auto"), ...readProviderNames.map((name) => Type.Literal(name))],
            {
              description:
                'Read provider to use. "auto" starts with Jina and falls back after eligible payment, conflict, rate-limit, timeout, or server failures.',
            },
          ),
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
        "List available web search providers, their configuration and filter support, and the running build.",
      inputSchema: Type.Object({}),
      outputSchema: providersOutputSchema,
      annotations: {
        title: webToolTitle("web_providers"),
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: async () => ({ runtime: runtimeInfo, providers: await listProvidersAsync() }),
    },
  ].map((tool) => [tool.name, tool]),
);

/**
 * Resolves search arguments against the same contract the AI SDK tool enforces.
 *
 * A host may skip schema validation, so the executor re-checks the boundaries
 * that would otherwise reach a provider malformed.
 * @param {Readonly<Record<string, unknown>>} args - Untrusted tool arguments.
 * @returns {Promise<unknown>} Search result payload.
 */
export async function executeSearch(args: Readonly<Record<string, unknown>>): Promise<unknown> {
  const query = searchInputArg(args.query);
  const maxResults = intArg("maxResults", args.maxResults);
  if (maxResults !== undefined && maxResults > MAX_RESULTS_HARD_CAP) {
    throw new TypeError(`maxResults must be at most ${MAX_RESULTS_HARD_CAP}`);
  }

  const searchOptions = {
    maxResults,
    highlights: boolArg("highlights", args.highlights),
    includeDomains: stringArrayArg("includeDomains", args.includeDomains),
    excludeDomains: stringArrayArg("excludeDomains", args.excludeDomains),
    sources: stringArrayArg("sources", args.sources),
    categories: stringArrayArg("categories", args.categories),
    category: stringArg("category", args.category),
    startPublishedDate: stringArg("startPublishedDate", args.startPublishedDate),
    endPublishedDate: stringArg("endPublishedDate", args.endPublishedDate),
  };

  return runSearch(query, searchProviderArg(args.provider), searchOptions);
}

async function runSearch(
  query: string | readonly string[],
  requestedProvider: (typeof providerNames)[number] | undefined,
  searchOptions: SearchRequestOptions,
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
 * @returns {Promise<unknown>} Normalized reverse image matches.
 */
export async function executeImageSearch(
  args: Readonly<Record<string, unknown>>,
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
  });
}

/**
 * Mirrors {@link executeSearch}: guards the read contract when validation was skipped.
 * @param {Readonly<Record<string, unknown>>} args - Untrusted tool arguments.
 * @returns {Promise<unknown>} Read result payload.
 */
export async function executeRead(args: Readonly<Record<string, unknown>>): Promise<unknown> {
  const urlInput = args.url;
  const urls = Array.isArray(urlInput) ? stringListArg("url", urlInput) : undefined;
  const url = typeof urlInput === "string" ? urlInput : "";
  const format = stringArg("format", args.format);
  if (format !== undefined && format !== "markdown" && format !== "text" && format !== "html") {
    throw new TypeError("format must be one of: markdown, text, html");
  }

  const readOptions = {
    provider: readProviderArg(args.provider),
    format: format as "markdown" | "text" | "html" | undefined,
    maxTokens: intArg("maxTokens", args.maxTokens),
    targetSelector: stringArg("targetSelector", args.targetSelector),
    removeSelector: stringArg("removeSelector", args.removeSelector),
    timeout: intArg("timeout", args.timeout),
    noCache: boolArg("noCache", args.noCache),
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

function searchProviderArg(value: unknown): (typeof providerNames)[number] | undefined {
  if (value === undefined) return undefined;
  const provider = providerNames.find((name) => name === value);
  if (!provider) {
    throw new TypeError(`provider must be one of: ${providerNames.join(", ")}`);
  }
  return provider;
}

function imageSearchProviderArg(value: unknown): ImageSearchProviderName | undefined {
  if (value === undefined) return undefined;
  const provider = imageSearchProviderNames.find((name) => name === value);
  if (!provider) {
    throw new TypeError(`provider must be one of: ${imageSearchProviderNames.join(", ")}`);
  }
  return provider;
}

function readProviderArg(value: unknown): ReadProviderName | undefined {
  if (value === undefined || value === "auto") return undefined;
  const provider = readProviderNames.find((name) => name === value);
  if (!provider) {
    throw new TypeError(`provider must be one of: auto, ${readProviderNames.join(", ")}`);
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

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
      const result = await tool.execute(args);
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
