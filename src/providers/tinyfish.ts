import type {
  ProviderConfig,
  SearchFilterCapabilities,
  ReadOptions,
  ReadResult,
  SearchRequestOptions,
  SearchResult,
} from "../core/types.ts";
import { Client } from "../core/client.ts";
import { Provider, assertProviderBaseURL } from "../core/provider.ts";
import { AuthError, HTTPError, WebError, normalizeError } from "../core/errors.ts";
import { register } from "../core/registry.ts";

interface TinyfishSearchResult {
  readonly position?: number;
  readonly site_name?: string;
  readonly title: string;
  readonly snippet: string;
  readonly url: string;
  readonly date?: string;
  readonly publisher?: string;
  readonly authors?: readonly string[];
  readonly venue?: string;
  readonly year?: number;
  readonly cited_by_count?: number;
  readonly pdf_url?: string;
}

interface TinyfishSearchResponse {
  readonly query?: string;
  readonly results?: readonly TinyfishSearchResult[];
  readonly total_results?: number;
  readonly page?: number;
}

interface TinyfishFetchResult {
  readonly url: string;
  readonly final_url?: string;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly language?: string | null;
  readonly author?: string | null;
  readonly published_date?: string | null;
  readonly text: string | Readonly<Record<string, unknown>>;
  readonly links?: readonly string[];
  readonly image_links?: readonly string[];
  readonly unmatched_selectors?: readonly string[];
  readonly latency_ms?: number | null;
  readonly format: string;
}

interface TinyfishFetchError {
  readonly url: string;
  readonly error: string;
  readonly status?: number;
  readonly unmatched_selectors?: readonly string[];
  readonly candidate_selectors?: readonly string[];
}

interface TinyfishFetchResponse {
  readonly results?: readonly TinyfishFetchResult[];
  readonly errors?: readonly TinyfishFetchError[];
}

const TINYFISH_MAX_FETCH_TIMEOUT_MS = 110_000;
const TINYFISH_CLIENT_TIMEOUT_MS = 150_000;
const TINYFISH_SEARCH_CATEGORIES = ["news", "research_paper"] as const;

class TinyfishProvider extends Provider {
  static readonly providerName = "tinyfish";
  static readonly defaultBaseURL = "https://api.search.tinyfish.ai";
  static readonly searchFilterCapabilities = {
    filters: [
      "includeDomains",
      "excludeDomains",
      "category",
      "startPublishedDate",
      "endPublishedDate",
    ],
    categories: TINYFISH_SEARCH_CATEGORIES,
  } as const satisfies SearchFilterCapabilities;

  private readonly apiKey: string;
  private readonly readBaseURL: string;
  private readonly readClient: Client;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, TinyfishProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for TinyFish. Set TINYFISH_API_KEY", "tinyfish");
    }

    this.apiKey = config.apiKey;
    this.readBaseURL = (config.readBaseURL ?? "https://api.fetch.tinyfish.ai").replace(/\/+$/, "");
    assertProviderBaseURL(this.readBaseURL, TinyfishProvider.providerName);
    this.readClient = new Client({ maxRetries: 0, timeout: TINYFISH_CLIENT_TIMEOUT_MS });
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    try {
      const response = await this.client.getJSON<TinyfishSearchResponse>(
        `${this.baseURL}?${searchParams(query, options)}`,
        this.authHeaders(),
      );
      return (response.results ?? [])
        .slice(0, clampMaxResults(options?.maxResults))
        .map(mapSearchResult);
    } catch (error) {
      throw normalizeError(error, "tinyfish");
    }
  }

  async read(url: string, options?: Readonly<ReadOptions>): Promise<ReadResult> {
    try {
      const response = await this.readClient.postJSON<TinyfishFetchResponse>(
        this.readBaseURL,
        fetchBody(url, options),
        this.authHeaders(),
      );
      const result = response.results?.[0];
      if (result) return mapReadResult(result);
      throw fetchFailure(response.errors?.[0]);
    } catch (error) {
      throw normalizeError(error, "tinyfish");
    }
  }

  private authHeaders(): Record<string, string> {
    return { "X-API-Key": this.apiKey };
  }
}

function searchParams(query: string, options?: SearchRequestOptions): string {
  return new URLSearchParams({
    query,
    ...domainSearchParams(options),
    ...categorySearchParams(options?.category),
    ...dateSearchParams(options),
  }).toString();
}

function domainSearchParams(options?: SearchRequestOptions): Record<string, string> {
  return {
    ...(options?.includeDomains?.length
      ? { include_domains: options.includeDomains.join(",") }
      : {}),
    ...(options?.excludeDomains?.length
      ? { exclude_domains: options.excludeDomains.join(",") }
      : {}),
  };
}

function categorySearchParams(category?: string): Record<string, string> {
  if (!isTinyfishSearchCategory(category)) return {};
  return { domain_type: category };
}

function isTinyfishSearchCategory(
  category: string | undefined,
): category is (typeof TINYFISH_SEARCH_CATEGORIES)[number] {
  return TINYFISH_SEARCH_CATEGORIES.some((supported) => supported === category);
}

function dateSearchParams(options?: SearchRequestOptions): Record<string, string> {
  if (!options) return {};
  return options.category === "research_paper"
    ? publicationYearParams(options)
    : calendarDateParams(options);
}

function publicationYearParams(options: SearchRequestOptions): Record<string, string> {
  return {
    ...(options.startPublishedDate ? { pub_year_min: options.startPublishedDate.slice(0, 4) } : {}),
    ...(options.endPublishedDate ? { pub_year_max: options.endPublishedDate.slice(0, 4) } : {}),
  };
}

function calendarDateParams(options: SearchRequestOptions): Record<string, string> {
  return {
    ...(options.startPublishedDate ? { after_date: options.startPublishedDate.slice(0, 10) } : {}),
    ...(options.endPublishedDate ? { before_date: options.endPublishedDate.slice(0, 10) } : {}),
  };
}

function clampMaxResults(maxResults?: number): number {
  return Math.max(maxResults ?? 10, 1);
}

function mapSearchResult(result: Readonly<TinyfishSearchResult>): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.snippet,
    publishedDate: result.date,
    author: result.authors?.join(", "),
    metadata: searchResultMetadata(result),
  };
}

function searchResultMetadata(
  result: Readonly<TinyfishSearchResult>,
): Record<string, unknown> | undefined {
  const metadata = {
    ...(result.position === undefined ? {} : { position: result.position }),
    ...(result.site_name === undefined ? {} : { siteName: result.site_name }),
    ...(result.publisher === undefined ? {} : { publisher: result.publisher }),
    ...researchResultMetadata(result),
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function researchResultMetadata(result: Readonly<TinyfishSearchResult>): Record<string, unknown> {
  return {
    ...(result.authors === undefined ? {} : { authors: [...result.authors] }),
    ...(result.venue === undefined ? {} : { venue: result.venue }),
    ...(result.year === undefined ? {} : { year: result.year }),
    ...(result.cited_by_count === undefined ? {} : { citedByCount: result.cited_by_count }),
    ...(result.pdf_url === undefined ? {} : { pdfUrl: result.pdf_url }),
  };
}

function fetchBody(url: string, options?: Readonly<ReadOptions>): Record<string, unknown> {
  return {
    urls: [url],
    format: normalizeReadFormat(options?.format),
    links: true,
    image_links: true,
    ...cacheParams(options?.noCache),
    ...timeoutParams(options?.timeout),
    ...selectorParams(options),
  };
}

function cacheParams(noCache?: boolean): Record<string, number> {
  return noCache ? { ttl: 0 } : {};
}

function timeoutParams(timeout?: number): Record<string, number> {
  if (timeout === undefined) return {};
  const timeoutMs = Math.round(timeout * 1000);
  return {
    per_url_timeout_ms: Math.min(Math.max(timeoutMs, 1), TINYFISH_MAX_FETCH_TIMEOUT_MS),
  };
}

function selectorParams(options?: Readonly<ReadOptions>): Record<string, readonly string[]> {
  return {
    ...(options?.targetSelector ? { include_selectors: [options.targetSelector] } : {}),
    ...(options?.removeSelector ? { exclude_selectors: [options.removeSelector] } : {}),
  };
}

function normalizeReadFormat(format?: ReadOptions["format"]): "markdown" | "html" {
  return format === "html" ? "html" : "markdown";
}

function mapReadResult(result: Readonly<TinyfishFetchResult>): ReadResult {
  const content = readContent(result.text);
  const images = copyStrings(result.image_links);
  return {
    url: result.final_url ?? result.url,
    title: optionalString(result.title),
    description: optionalString(result.description),
    content,
    ...htmlContent(result.format, content),
    publishedDate: optionalString(result.published_date),
    image: images?.[0],
    links: copyStrings(result.links),
    images,
    metadata: readResultMetadata(result),
  };
}

function readContent(text: TinyfishFetchResult["text"]): string {
  return typeof text === "string" ? text : JSON.stringify(text);
}

function htmlContent(format: string, content: string): Record<string, string> {
  return format === "html" ? { html: content } : {};
}

function optionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function copyStrings(value?: readonly string[]): string[] | undefined {
  return value ? [...value] : undefined;
}

function readResultMetadata(result: Readonly<TinyfishFetchResult>): Record<string, unknown> {
  return {
    originalUrl: result.url,
    ...(result.language === undefined || result.language === null
      ? {}
      : { language: result.language }),
    ...(result.author === undefined || result.author === null ? {} : { author: result.author }),
    format: result.format,
    ...(result.latency_ms === undefined || result.latency_ms === null
      ? {}
      : { latencyMs: result.latency_ms }),
    ...(result.unmatched_selectors === undefined
      ? {}
      : { unmatchedSelectors: [...result.unmatched_selectors] }),
  };
}

function fetchFailure(error?: Readonly<TinyfishFetchError>): WebError {
  const reason = error?.error ?? "no result returned";
  if (error?.error === "page_not_found" && error.status !== undefined) {
    return new HTTPError(error.status, "", reason);
  }

  return new WebError(
    `TinyFish fetch failed: ${reason}${statusSuffix(error)}${selectorHint(error)}`,
  );
}

function statusSuffix(error?: Readonly<TinyfishFetchError>): string {
  return error?.status === undefined ? "" : ` (HTTP ${error.status})`;
}

function selectorHint(error?: Readonly<TinyfishFetchError>): string {
  const selectors = error?.candidate_selectors;
  if (!selectors?.length) return "";
  return `; candidate selectors: ${JSON.stringify(selectors)}`;
}

register(TinyfishProvider);
