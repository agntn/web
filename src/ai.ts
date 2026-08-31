import { tool } from "ai";
import { z } from "zod";
import { builtinProviders } from "./core/providers.ts";
import { createSearchProvider } from "./core/registry.ts";
import { searchAll, searchWithFallback } from "./core/all.ts";
import { readProviderNames, readUrl } from "./core/read.ts";
import { MAX_BATCH_ITEMS, readBatch, searchBatch } from "./core/batch.ts";
import { EmptyQueryError, EmptyUrlError } from "./core/errors.ts";
import { listProviders } from "./core/resolve.ts";
import { runtimeInfo } from "./version.ts";
import "./providers/index.ts";

const providerNames = [...builtinProviders, "all"] as const;

export const searchTool = tool({
  description:
    'Search the web using multiple search engines (Brave, Context.dev, Exa, Firecrawl, Jina, Tavily, TinyFish, SerpAPI, SerpBase, SearXNG). Pass one query or a batch of queries; each batch item returns its own results or error. Use provider "all" to query all available providers in parallel and get deduplicated results.',
  inputSchema: z.object({
    query: z
      .union([z.string(), z.array(z.string()).min(1).max(MAX_BATCH_ITEMS)])
      .describe("Search query, or a batch of search queries"),
    provider: z
      .enum(providerNames)
      .optional()
      .describe(
        'Provider to use. Automatic selection tries other configured providers after HTTP 402. Use "all" for parallel search.',
      ),
    maxResults: z.number().min(1).max(20).optional().describe("Max results (default: 10)"),
    includeDomains: z
      .array(z.string())
      .optional()
      .describe(
        'Only return results from these domains (e.g. ["github.com", "stackoverflow.com"])',
      ),
    excludeDomains: z.array(z.string()).optional().describe("Exclude results from these domains"),
    category: z
      .string()
      .optional()
      .describe('Search category (e.g. "news", "general"). Provider support varies.'),
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
    includeDomains,
    excludeDomains,
    category,
    startPublishedDate,
    endPublishedDate,
  }) => {
    const searchOptions = {
      maxResults,
      includeDomains,
      excludeDomains,
      category,
      startPublishedDate,
      endPublishedDate,
    };

    if (Array.isArray(query)) {
      return searchBatch(query, { provider: providerName, ...searchOptions });
    }
    if (!query.trim()) {
      throw new EmptyQueryError();
    }
    if (providerName === "all") {
      return searchAll(query, searchOptions);
    }

    if (providerName !== undefined) {
      return createSearchProvider(providerName).search(query, searchOptions);
    }
    const response = await searchWithFallback(query, searchOptions);
    return response.results;
  },
});

export const readTool = tool({
  description:
    "Read one URL or a batch of URLs into normalized content using Jina, Context.dev, Firecrawl, or TinyFish. Each batch item returns its own result or error. Defaults to Jina Reader (r.jina.ai).",
  inputSchema: z.object({
    url: z
      .union([z.string(), z.array(z.string()).min(1).max(MAX_BATCH_ITEMS)])
      .describe("URL to read, or a batch of URLs"),
    provider: z
      .enum(readProviderNames)
      .optional()
      .describe("Read provider to use. Defaults to Jina."),
    format: z.enum(["markdown", "text", "html"]).optional().describe("Preferred content format."),
    maxTokens: z
      .number()
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
    timeout: z.number().min(1).optional().describe("Provider timeout in seconds when supported."),
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
    const readOptions = {
      provider,
      format,
      maxTokens,
      targetSelector,
      removeSelector,
      timeout,
      noCache,
    };
    if (Array.isArray(url)) {
      return readBatch(url, readOptions);
    }
    if (!url.trim()) {
      throw new EmptyUrlError();
    }

    return readUrl(url, readOptions);
  },
});

export const providersTool = tool({
  description:
    "List available web search providers, their configuration status, and the running build.",
  inputSchema: z.object({}),
  execute: async () => ({ runtime: runtimeInfo, providers: listProviders() }),
});
