import { tool } from "ai";
import { z } from "zod";
import { builtinProviders } from "./core/providers.ts";
import { searchAllDetailed, searchProviderDetailed, searchWithFallback } from "./core/all.ts";
import { imageSearchProviderNames, searchByImage } from "./core/image.ts";
import { readProviderNames, readUrlDetailed } from "./core/read.ts";
import { MAX_BATCH_ITEMS, readBatchDetailed, searchBatch } from "./core/batch.ts";
import { EmptyQueryError, EmptyUrlError } from "./core/errors.ts";
import { listProviders } from "./core/resolve.ts";
import { runtimeInfo } from "./version.ts";
import "./providers/index.ts";

const advertisedSearchProviderNames = [...builtinProviders, "all"].join(", ");

export const searchTool = tool({
  description:
    'Search the web using multiple search engines (Brave, Context.dev, Exa, Firecrawl, Jina, Tavily, TinyFish, SerpAPI, SerpBase, SearXNG). Pass one query or a batch of queries; each batch item returns its own results or error. Use provider "all" to query all available providers in parallel and get deduplicated results. Responses report filters the selected provider ignored.',
  inputSchema: z.object({
    query: z
      .union([z.string(), z.array(z.string()).min(1).max(MAX_BATCH_ITEMS)])
      .describe("Search query, or a batch of search queries"),
    provider: z
      .string()
      .optional()
      .describe(
        `Provider to use. Built in providers: ${advertisedSearchProviderNames}. Automatic selection tries other configured providers after payment, rate limit, timeout, or server failures. Use "all" for parallel search. Registered custom providers are validated at execution time.`,
      ),
    maxResults: z.number().int().min(1).max(20).optional().describe("Max results (default: 10)"),
    highlights: z
      .boolean()
      .optional()
      .describe("Return passages relevant to the query when supported. Defaults to true."),
    summary: z
      .boolean()
      .optional()
      .describe("Request generated summaries or answers when supported. Defaults to false."),
    fullText: z
      .boolean()
      .optional()
      .describe("Request full page text when supported. Defaults to false."),
    includeDomains: z
      .array(z.string())
      .optional()
      .describe(
        'Only return results from these domains (e.g. ["github.com", "stackoverflow.com"])',
      ),
    excludeDomains: z.array(z.string()).optional().describe("Exclude results from these domains"),
    sources: z
      .array(z.string())
      .optional()
      .describe('Source types when supported (Firecrawl: "web", "news", "images")'),
    categories: z
      .array(z.string())
      .optional()
      .describe('Category filters when supported (Firecrawl: "research", "pdf", "developer")'),
    category: z
      .string()
      .optional()
      .describe('Single search category (e.g. "news", "general"). Provider support varies.'),
    startPublishedDate: z
      .string()
      .optional()
      .describe('Filter results published after this date (ISO 8601, e.g. "2024-01-01")'),
    endPublishedDate: z
      .string()
      .optional()
      .describe("Filter results published before this date (ISO 8601)"),
  }),
  execute: async ({
    query,
    provider: providerName,
    maxResults,
    highlights,
    summary,
    fullText,
    includeDomains,
    excludeDomains,
    sources,
    categories,
    category,
    startPublishedDate,
    endPublishedDate,
  }) => {
    const normalizedProvider = providerName === "auto" ? undefined : providerName;
    const searchOptions = {
      maxResults,
      highlights,
      summary,
      fullText,
      includeDomains,
      excludeDomains,
      sources,
      categories,
      category,
      startPublishedDate,
      endPublishedDate,
    };

    if (Array.isArray(query)) {
      return searchBatch(query, { provider: normalizedProvider, ...searchOptions });
    }
    if (!query.trim()) {
      throw new EmptyQueryError();
    }
    if (normalizedProvider === "all") {
      const response = await searchAllDetailed(query, searchOptions);
      return {
        ...response,
        errors: response.errors.map(({ provider, error }) => ({ provider, error: error.message })),
      };
    }

    if (normalizedProvider !== undefined) {
      return searchProviderDetailed(normalizedProvider, query, searchOptions);
    }
    return searchWithFallback(query, searchOptions);
  },
});

export const searchImageTool = tool({
  description:
    "Find public pages containing or resembling an image available by URL. Uses a provider with reverse image search support and returns page URLs, matched images, dimensions, and rank metadata.",
  inputSchema: z.object({
    url: z.url().describe("Public HTTP or HTTPS image URL"),
    provider: z
      .string()
      .optional()
      .describe(
        `Reverse image search provider. Built in providers: ${imageSearchProviderNames.join(", ")}. Defaults to SerpAPI Google Lens. Registered custom providers are validated at execution time.`,
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Maximum matches to return. Defaults to 10."),
  }),
  execute: async ({ url, provider, maxResults }) => searchByImage(url, { provider, maxResults }),
});

export const readTool = tool({
  description:
    "Read one URL or a batch of URLs into normalized content using Jina, Context.dev, Firecrawl, or TinyFish. Automatic reads report the effective provider and every reader tried after fallback. Each batch item returns its own result or error.",
  inputSchema: z.object({
    url: z
      .union([z.string(), z.array(z.string()).min(1).max(MAX_BATCH_ITEMS)])
      .describe("URL to read, or a batch of URLs"),
    provider: z
      .string()
      .optional()
      .describe(
        `Read provider to use. Built in providers: ${readProviderNames.join(", ")}. Automatic selection starts with Jina and falls back after eligible payment, conflict, rate limit, timeout, or server failures. Registered custom providers are validated at execution time.`,
      ),
    format: z.enum(["markdown", "text", "html"]).optional().describe("Preferred content format."),
    maxTokens: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum tokens to return when supported by the provider."),
    targetSelector: z
      .string()
      .optional()
      .describe("CSS selector to target when supported by the provider."),
    removeSelector: z
      .string()
      .optional()
      .describe("CSS selector to remove when supported by the provider."),
    timeout: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Provider timeout in seconds when supported."),
    noCache: z.boolean().optional().describe("Bypass provider cache when supported."),
  }),
  execute: async ({
    url,
    provider,
    format,
    maxTokens,
    targetSelector,
    removeSelector,
    timeout,
    noCache,
  }) => {
    const normalizedProvider = provider === "auto" ? undefined : provider;
    const readOptions = {
      provider: normalizedProvider,
      format,
      maxTokens,
      targetSelector,
      removeSelector,
      timeout,
      noCache,
    };
    if (Array.isArray(url)) {
      return readBatchDetailed(url, readOptions);
    }
    if (!url.trim()) {
      throw new EmptyUrlError();
    }

    return readUrlDetailed(url, readOptions);
  },
});

export const providersTool = tool({
  description:
    "List available web search providers, their configuration and filter support, and the running build.",
  inputSchema: z.object({}),
  execute: async () => ({ runtime: runtimeInfo, providers: listProviders() }),
});
