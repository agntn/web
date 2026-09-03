import type {
  ProviderConfig,
  SearchFilterCapabilities,
  ReadOptions,
  ReadResult,
  SearchRequestOptions,
  SearchResult,
} from "../core/types.ts";
import { Client } from "../core/client.ts";
import { Provider, type ProviderCapabilityDetails } from "../core/provider.ts";
import { AuthError, normalizeError } from "../core/errors.ts";
import { register } from "../core/registry.ts";

interface ContextSearchResult {
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly relevance: "high" | "medium" | "low";
  readonly markdown: {
    readonly markdown: string | null;
    readonly code: string;
  };
}

interface ContextSearchResponse {
  readonly results: readonly ContextSearchResult[];
}

interface ContextPageMetadata {
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly title?: string;
  readonly description?: string;
  readonly image?: string;
  readonly publishedTime?: string;
  readonly [key: string]: unknown;
}

interface ContextScrapeResponse {
  readonly success: true;
  readonly markdown: string;
  readonly html?: string;
  readonly url: string;
  readonly metadata: ContextPageMetadata;
  readonly cache_metadata: Readonly<Record<string, unknown>>;
  readonly key_metadata?: Readonly<Record<string, unknown>>;
}

const CONTEXT_MIN_SEARCH_RESULTS = 10;
const CONTEXT_MAX_SEARCH_RESULTS = 100;
const CONTEXT_MAX_TIMEOUT_MS = 300_000;
const CONTEXT_READ_CLIENT_TIMEOUT_MS = 310_000;

class ContextProvider extends Provider {
  static readonly providerName = "context";
  static readonly defaultBaseURL = "https://api.context.dev/v1";
  static readonly capabilityDetails = {
    search: {
      contentOptions: [],
      resultLimit: { default: 10, maximum: 100 },
      resultFields: ["text", "metadata"],
    },
    read: {
      options: ["format", "targetSelector", "removeSelector", "timeout", "noCache"],
      formats: ["markdown", "html"],
    },
  } as const satisfies ProviderCapabilityDetails;
  static readonly searchFilterCapabilities = {
    filters: ["includeDomains", "excludeDomains"],
  } as const satisfies SearchFilterCapabilities;

  private readonly apiKey: string;
  private readonly readClient: Client;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, ContextProvider);
    if (!config.apiKey) {
      throw new AuthError(
        "Missing API key for Context.dev. Set CONTEXT_DEV_API_KEY",
        ContextProvider.providerName,
      );
    }

    this.apiKey = config.apiKey;
    this.readClient = new Client({ maxRetries: 1, timeout: CONTEXT_READ_CLIENT_TIMEOUT_MS });
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    try {
      const response = await this.client.postJSON<ContextSearchResponse>(
        `${this.baseURL}/web/search`,
        searchBody(query, options),
        this.authHeaders(),
        options?.signal,
      );
      return response.results.slice(0, resultLimit(options?.maxResults)).map(mapSearchResult);
    } catch (error) {
      throw normalizeError(error, ContextProvider.providerName);
    }
  }

  async read(url: string, options?: Readonly<ReadOptions>): Promise<ReadResult> {
    try {
      const response = await this.readClient.getJSON<ContextScrapeResponse>(
        `${this.baseURL}/web/scrape/markdown?${scrapeParams(url, options)}`,
        this.authHeaders(),
        options?.signal,
      );
      return mapReadResult(response, options?.format);
    } catch (error) {
      throw normalizeError(error, ContextProvider.providerName);
    }
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }
}

function searchBody(query: string, options?: SearchRequestOptions): Record<string, unknown> {
  return {
    query,
    numResults: requestedResultCount(options?.maxResults),
    ...(options?.includeDomains?.length ? { includeDomains: options.includeDomains } : {}),
    ...(options?.excludeDomains?.length ? { excludeDomains: options.excludeDomains } : {}),
  };
}

function requestedResultCount(maxResults?: number): number {
  return Math.min(
    Math.max(resultLimit(maxResults), CONTEXT_MIN_SEARCH_RESULTS),
    CONTEXT_MAX_SEARCH_RESULTS,
  );
}

function resultLimit(maxResults?: number): number {
  return Math.max(Math.trunc(maxResults ?? CONTEXT_MIN_SEARCH_RESULTS), 1);
}

function mapSearchResult(result: Readonly<ContextSearchResult>): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.description,
    ...(result.markdown.markdown === null ? {} : { text: result.markdown.markdown }),
    metadata: {
      relevance: result.relevance,
      markdownCode: result.markdown.code,
    },
  };
}

function scrapeParams(url: string, options?: Readonly<ReadOptions>): string {
  return new URLSearchParams({
    url,
    ...formatParams(options?.format),
    ...selectorParams(options),
    ...cacheParams(options?.noCache),
    ...timeoutParams(options?.timeout),
  }).toString();
}

function formatParams(format?: ReadOptions["format"]): Record<string, string> {
  return format === "html" ? { includeHTML: "true" } : {};
}

function selectorParams(options?: Readonly<ReadOptions>): Record<string, string> {
  return {
    ...(options?.targetSelector ? { includeSelectors: options.targetSelector } : {}),
    ...(options?.removeSelector ? { excludeSelectors: options.removeSelector } : {}),
  };
}

function cacheParams(noCache?: boolean): Record<string, string> {
  return noCache ? { maxAgeMs: "0" } : {};
}

function timeoutParams(timeout?: number): Record<string, string> {
  if (timeout === undefined) return {};
  const timeoutMs = Math.min(Math.max(Math.round(timeout * 1000), 1), CONTEXT_MAX_TIMEOUT_MS);
  return { timeoutMS: String(timeoutMs) };
}

function mapReadResult(
  response: Readonly<ContextScrapeResponse>,
  format?: ReadOptions["format"],
): ReadResult {
  const html = response.html;
  return {
    url: response.metadata.finalUrl || response.url,
    title: response.metadata.title,
    description: response.metadata.description,
    content: format === "html" && html !== undefined ? html : response.markdown,
    ...(html === undefined ? {} : { html }),
    publishedDate: response.metadata.publishedTime,
    image: response.metadata.image,
    metadata: {
      ...response.metadata,
      cacheMetadata: response.cache_metadata,
      ...(response.key_metadata === undefined ? {} : { keyMetadata: response.key_metadata }),
    },
  };
}

register(ContextProvider);
