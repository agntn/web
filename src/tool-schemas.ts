import { Type, type TProperties } from "@agntn/tools";

import {
  DEFAULT_AGENT_READ_MAX_CHARS,
  MAX_AGENT_READ_CHARS,
  MAX_AGENT_RESULTS,
  MAX_AGENT_TIMEOUT_SECONDS,
  MAX_BATCH_ITEMS,
  MAX_READ_CONTINUATION_LENGTH,
  MAX_SEARCH_CONTINUATION_LENGTH,
} from "./core/limits.ts";
import { hiddenKinds } from "./core/hidden-kinds.ts";
import { builtinProviders, imageSearchProviderNames, readProviderNames } from "./core/providers.ts";
import { searchFilterNames } from "./core/types.ts";

const strictObject = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });

/**
 * The search arguments past `query`, shared by the tool and the command that batches its words.
 * @returns {TProperties} Optional search properties.
 */
function searchOptionProperties() {
  return {
    provider: Type.Optional(
      Type.String({
        description: `Provider to use. Built in providers: ${[...builtinProviders, "all"].join(", ")}. Automatic selection tries other configured providers after payment, rate limit, timeout, or server failures. Use "all" for parallel search.`,
      }),
    ),
    maxResults: Type.Optional(
      Type.Integer({
        description: `Max results (default: 10, max: ${MAX_AGENT_RESULTS})`,
        minimum: 1,
        maximum: MAX_AGENT_RESULTS,
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
        description: "Request generated summaries or answers when supported. Defaults to false.",
      }),
    ),
    fullText: Type.Optional(
      Type.Boolean({ description: "Request full page text when supported. Defaults to false." }),
    ),
    favicon: Type.Optional(
      Type.Boolean({ description: "Include favicon URLs on results. Defaults to false." }),
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
        description: 'Category filters when supported (Firecrawl: "research", "pdf", "developer")',
      }),
    ),
    category: Type.Optional(
      Type.String({
        description: 'Single search category (e.g. "news", "general"). Provider support varies.',
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
    timeoutSeconds: Type.Optional(
      Type.Integer({
        description:
          "Give up after this many seconds. Fan-out and batch return what finished by then and report the rest as errors.",
        minimum: 1,
        maximum: MAX_AGENT_TIMEOUT_SECONDS,
      }),
    ),
  };
}

/**
 * The read arguments past `url`, shared by the tool and the command that batches its words.
 * @returns {TProperties} Optional read properties, `noCache` left to each caller.
 */
function readOptionProperties() {
  return {
    provider: Type.Optional(
      Type.String({
        description: `Read provider to use. Built in providers: ${readProviderNames.join(", ")}. "auto" starts with Jina and falls back after eligible payment, conflict, rate limit, timeout, or server failures.`,
      }),
    ),
    format: Type.Optional(
      Type.Union([Type.Enum(["markdown", "text", "html"]), Type.String({ pattern: "^\\s*$" })], {
        description: "Preferred content format. A blank string means the provider default.",
      }),
    ),
    maxTokens: Type.Optional(
      Type.Integer({
        description:
          "Jina token budget: fail instead of returning a page over this many tokens. Automatic reads leave it out on other readers. Use maxChars to cut a page.",
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
        maxLength: MAX_READ_CONTINUATION_LENGTH,
      }),
    ),
    links: Type.Optional(
      Type.Boolean({ description: "Include the links found on the page. Defaults to false." }),
    ),
    images: Type.Optional(
      Type.Boolean({ description: "Include the image URLs found on the page. Defaults to false." }),
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
    timeoutSeconds: Type.Optional(
      Type.Integer({
        description:
          "Give up after this many seconds. A batch returns the URLs that finished by then and reports the rest as errors.",
        minimum: 1,
        maximum: MAX_AGENT_TIMEOUT_SECONDS,
      }),
    ),
  };
}

/**
 * A query or URL alone, or a batch of them.
 * @param description - What the model reads about the property.
 * @returns {TUnion} One non-empty string, or a bounded array of them.
 */
function oneOrBatch(description: string) {
  return Type.Union(
    [
      Type.String({ minLength: 1 }),
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: MAX_BATCH_ITEMS }),
    ],
    { description },
  );
}

/**
 * Words of a command line, each one query or URL of a batch.
 * @param description - What `--help` says about the words.
 * @returns {TArray} A bounded array of non-empty strings.
 */
function batchWords(description: string) {
  return Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    maxItems: MAX_BATCH_ITEMS,
    description,
  });
}

/**
 * Input schemas of the tools and of the two commands that take a batch as words.
 * @returns {object} Closed object schemas by tool.
 */
export function webInputSchemas() {
  const search = searchOptionProperties();
  const read = readOptionProperties();
  const noCache = Type.Optional(
    Type.Boolean({ description: "Bypass provider cache when supported." }),
  );
  return {
    search: strictObject({
      query: oneOrBatch("Search query, or a batch of search queries"),
      ...search,
    }),
    searchCommand: strictObject({
      queries: batchWords("Search query; pass more than one quoted query for a batch"),
      ...search,
    }),
    searchImage: strictObject({
      url: Type.String({ description: "Public HTTP or HTTPS image URL", minLength: 1 }),
      provider: Type.Optional(
        Type.String({
          description: `Reverse image search provider. Built in providers: ${imageSearchProviderNames.join(", ")}. Defaults to SerpAPI Google Lens.`,
        }),
      ),
      maxResults: Type.Optional(
        Type.Integer({
          description: `Maximum matches to return (default: 10, max: ${MAX_AGENT_RESULTS})`,
          minimum: 1,
          maximum: MAX_AGENT_RESULTS,
        }),
      ),
    }),
    read: strictObject({ url: oneOrBatch("URL to read, or a batch of URLs"), ...read, noCache }),
    readCommand: strictObject({
      urls: batchWords("URL to read; pass more URLs for a batch"),
      ...read,
      cache: Type.Optional(
        Type.Boolean({
          description:
            "Let the provider answer from its cache; --no-cache asks for a fresh copy when it supports that.",
        }),
      ),
    }),
    reveal: strictObject({
      url: Type.String({
        description:
          "Public HTTP or HTTPS page URL. A Wayback Machine capture is read as archived, without the toolbar.",
        minLength: 1,
      }),
      maxChars: Type.Optional(
        Type.Integer({
          description: `Maximum characters of findings to return. Defaults to ${DEFAULT_AGENT_READ_MAX_CHARS}.`,
          minimum: 1,
          maximum: MAX_AGENT_READ_CHARS,
        }),
      ),
      timeoutSeconds: Type.Optional(
        Type.Integer({
          description: "Give up after this many seconds.",
          minimum: 1,
          maximum: MAX_AGENT_TIMEOUT_SECONDS,
        }),
      ),
    }),
    providers: Type.Object({}),
  };
}

/**
 * Schemas of the details each tool answers with, which MCP also sends as `structuredContent`.
 * @returns {object} Object schemas with the data under `result`, by tool.
 */
export function webOutputSchemas() {
  const unknownRecord = Type.Record(Type.String(), Type.Unknown());
  const filter = Type.Enum(searchFilterNames);
  const namedSearchProvider = Type.String({ pattern: "^(?!all$).+" });
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
    metadata: Type.Optional(unknownRecord),
  };
  const searchResult = strictObject(searchResultProperties);
  const searchAllEvidence = strictObject({ ...searchResultProperties, provider: Type.String() });
  const searchAllResult = strictObject({
    ...searchResultProperties,
    provider: Type.String(),
    providers: Type.Array(Type.String()),
    evidence: Type.Optional(Type.Array(searchAllEvidence)),
  });
  const filterReport = strictObject({
    provider: Type.String(),
    ignoredFilters: Type.Array(filter),
    undeclaredFilters: Type.Array(filter),
  });
  const providerMetadata = strictObject({ provider: Type.String(), metadata: unknownRecord });
  const providerFailure = strictObject({ provider: Type.String(), error: Type.String() });
  const pagination = Type.Union([
    strictObject({ status: Type.Literal("next"), continuation: Type.String() }),
    strictObject({ status: Type.Literal("unknown"), continuation: Type.String() }),
    strictObject({ status: Type.Literal("end") }),
    strictObject({ status: Type.Literal("unsupported") }),
  ]);
  const providerPagination = strictObject({ provider: Type.String(), pagination });
  const searchProviderResult = strictObject({
    provider: Type.String(),
    results: Type.Array(searchResult),
    ignoredFilters: Type.Array(filter),
    undeclaredFilters: Type.Array(filter),
    pagination,
    metadata: Type.Optional(unknownRecord),
    attempts: Type.Optional(Type.Array(Type.String())),
    failures: Type.Optional(Type.Array(providerFailure)),
    skipped: Type.Optional(Type.Array(Type.String())),
  });
  const searchAllResponse = strictObject({
    results: Type.Array(searchAllResult),
    successfulProviders: Type.Array(Type.String()),
    errors: Type.Array(providerFailure),
    filterReports: Type.Array(filterReport),
    providerPagination: Type.Array(providerPagination),
    providerMetadata: Type.Optional(Type.Array(providerMetadata)),
  });
  const searchBatchItem = Type.Union([
    strictObject({
      query: Type.String(),
      provider: namedSearchProvider,
      results: Type.Array(searchResult),
      filterReports: Type.Array(filterReport),
      pagination,
      providerMetadata: Type.Optional(Type.Array(providerMetadata)),
      attempts: Type.Optional(Type.Array(Type.String())),
      failures: Type.Optional(Type.Array(providerFailure)),
      skipped: Type.Optional(Type.Array(Type.String())),
    }),
    strictObject({
      query: Type.String(),
      provider: Type.Literal("all"),
      results: Type.Array(searchAllResult),
      filterReports: Type.Array(filterReport),
      providerPagination: Type.Array(providerPagination),
      providerMetadata: Type.Optional(Type.Array(providerMetadata)),
      errors: Type.Optional(Type.Array(providerFailure)),
    }),
    strictObject({
      query: Type.String(),
      error: Type.String(),
      attempts: Type.Optional(Type.Array(Type.String())),
      failures: Type.Optional(Type.Array(providerFailure)),
    }),
  ]);
  const imageSearchResult = strictObject({
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
  const readResult = strictObject({
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
    metadata: Type.Optional(unknownRecord),
    truncated: Type.Optional(Type.Boolean()),
    continuation: Type.Optional(Type.String()),
  });
  const readProvenance = {
    requestedProvider: Type.String(),
    provider: Type.String(),
    attempts: Type.Array(Type.String()),
    failures: Type.Array(providerFailure),
    skipped: Type.Optional(Type.Array(Type.String())),
    ignoredOptions: Type.Optional(Type.Array(Type.String())),
  };
  const readBatchItem = Type.Union([
    strictObject({ url: Type.String(), result: readResult, ...readProvenance }),
    strictObject({
      url: Type.String(),
      error: Type.String(),
      attempts: Type.Optional(Type.Array(Type.String())),
      failures: Type.Optional(Type.Array(providerFailure)),
    }),
  ]);
  return {
    search: strictObject({
      result: Type.Union([searchProviderResult, searchAllResponse, Type.Array(searchBatchItem)]),
    }),
    searchImage: strictObject({ result: Type.Array(imageSearchResult) }),
    read: strictObject({
      result: Type.Union([
        strictObject({ result: readResult, ...readProvenance }),
        Type.Array(readBatchItem),
      ]),
    }),
    reveal: strictObject({ result: revealResult() }),
    providers: strictObject({ result: providersResult() }),
  };
}

/**
 * What `web_reveal` reports: the page it read and the findings that fit the character budget.
 * @returns {TObject} The schema of its `result`.
 */
function revealResult() {
  const optionalText = Type.Optional(Type.String());
  const finding = strictObject({
    kind: Type.Enum(hiddenKinds),
    line: Type.Integer({ minimum: 1 }),
    element: optionalText,
    reason: optionalText,
    name: optionalText,
    value: optionalText,
    size: Type.Optional(Type.Integer({ minimum: 0 })),
    codePoints: Type.Optional(Type.Array(Type.String())),
    count: Type.Optional(Type.Integer({ minimum: 2 })),
  });
  const counts = strictObject(
    Object.fromEntries(
      hiddenKinds.map((kind) => [kind, Type.Optional(Type.Integer({ minimum: 1 }))]),
    ),
  );
  return strictObject({
    url: Type.String(),
    source: Type.String(),
    archive: Type.Optional(Type.Literal("wayback")),
    contentType: optionalText,
    stylesheets: Type.Optional(Type.Array(Type.String())),
    bytes: Type.Integer({ minimum: 0 }),
    partial: Type.Optional(Type.Boolean()),
    counts,
    findings: Type.Array(finding),
    truncated: Type.Optional(Type.Boolean()),
    omitted: Type.Optional(Type.Integer({ minimum: 1 })),
  });
}

/**
 * What `web_providers` reports: the running build, package guarantees and every provider.
 * @returns {TObject} The schema of its `result`.
 */
function providersResult() {
  const filter = Type.Enum(searchFilterNames);
  const resultLimit = Type.Union([
    strictObject({ default: Type.Number(), maximum: Type.Optional(Type.Number()) }),
    strictObject({ maximum: Type.Number() }),
  ]);
  const capabilities = strictObject({
    search: strictObject({
      supported: Type.Boolean(),
      filters: Type.Optional(Type.Array(filter)),
      categories: Type.Optional(Type.Array(Type.String())),
      contentOptions: Type.Optional(Type.Array(Type.String())),
      pagination: Type.Optional(Type.Boolean()),
      resultLimit: Type.Optional(resultLimit),
      resultFields: Type.Optional(Type.Array(Type.String())),
    }),
    searchImage: strictObject({
      supported: Type.Boolean(),
      resultLimit: Type.Optional(resultLimit),
    }),
    read: strictObject({
      supported: Type.Boolean(),
      options: Type.Optional(Type.Array(Type.String())),
      formats: Type.Optional(Type.Array(Type.String())),
    }),
  });
  const provider = strictObject({
    name: Type.String(),
    configured: Type.Boolean(),
    envVar: Type.Union([Type.String(), Type.Null()]),
    reachable: Type.Optional(Type.Boolean()),
    searchFilters: Type.Optional(Type.Array(filter)),
    searchCategories: Type.Optional(Type.Array(Type.String())),
    capabilities,
  });
  const packageCapabilities = strictObject({
    execution: strictObject({
      cancellation: strictObject({ option: Type.Literal("signal") }),
      deadline: strictObject({
        option: Type.Literal("deadline"),
        unit: Type.Literal("unix-ms"),
        agentOption: Type.Literal("timeoutSeconds"),
        agentUnit: Type.Literal("seconds"),
        agentMaximum: Type.Integer({ minimum: 1 }),
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
      continuation: strictObject({ option: Type.Literal("continuation"), opaque: Type.Boolean() }),
    }),
  });
  return strictObject({
    runtime: strictObject({
      version: Type.String(),
      buildId: Type.String(),
      processStartedAt: Type.String(),
    }),
    packageCapabilities,
    providers: Type.Array(provider),
  });
}
