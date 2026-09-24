import type {
  SearchResult,
  SearchRequestOptions,
  SearchResponse,
  ReadResult,
  ReadOptions,
  ProviderConfig,
} from "../core/types.ts";
import { Provider } from "../core/provider.ts";
import { FIRECRAWL_MAX_RESULTS } from "../core/providers.ts";
import { AuthError, WebError, normalizeError } from "../core/errors.ts";
import { snippet } from "../core/text.ts";

interface FirecrawlSearchResult {
  readonly title: string;
  readonly url: string;
  readonly markdown?: string;
}

interface FirecrawlWebResult extends FirecrawlSearchResult {
  readonly description: string;
}

interface FirecrawlNewsResult extends FirecrawlSearchResult {
  readonly snippet: string;
  readonly date?: string;
  readonly imageUrl?: string;
}

interface FirecrawlImageResult {
  readonly title: string;
  readonly url: string;
  readonly imageUrl: string;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
}

interface FirecrawlSearchResponse {
  readonly success: boolean;
  readonly data?: {
    readonly web?: readonly FirecrawlWebResult[];
    readonly news?: readonly FirecrawlNewsResult[];
    readonly images?: readonly FirecrawlImageResult[];
  };
  readonly id?: string;
  readonly warning?: string | null;
  readonly creditsUsed?: number;
}

/** Page meta tags plus Firecrawl's own fields about the fetch, in one flat object. */
interface FirecrawlPageMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly url?: string;
  readonly ogImage?: string;
  readonly "og:image"?: string;
  readonly [key: string]: unknown;
}

interface FirecrawlScrapeResponse {
  readonly success: boolean;
  readonly data?: {
    readonly markdown?: string;
    readonly html?: string;
    readonly metadata?: FirecrawlPageMetadata;
    readonly links?: readonly string[];
    readonly warning?: string | null;
  };
}

function clampMaxResults(max?: number): number {
  return Math.min(Math.max(max ?? 10, 1), FIRECRAWL_MAX_RESULTS);
}

export class FirecrawlProvider extends Provider {
  static readonly providerName = "firecrawl";
  static readonly defaultBaseURL = "https://api.firecrawl.dev";

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, FirecrawlProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Firecrawl. Set FIRECRAWL_API_KEY", "firecrawl");
    }

    this.apiKey = config.apiKey;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    const response = await this.searchDetailed(query, options);
    return response.results;
  }

  async searchDetailed(query: string, options?: SearchRequestOptions): Promise<SearchResponse> {
    try {
      const response = await this.client.postJSON<FirecrawlSearchResponse>(
        `${this.baseURL}/v2/search`,
        searchBody(query, options),
        this.authHeaders(),
        options?.signal,
      );
      return mapSearchResponse(response, options?.maxResults);
    } catch (error) {
      throw normalizeError(error, "firecrawl");
    }
  }

  async read(url: string, options?: Readonly<ReadOptions>): Promise<ReadResult> {
    if (options?.maxTokens !== undefined) {
      throw new WebError("Firecrawl does not support the maxTokens read option");
    }

    try {
      const response = await this.client.postJSON<FirecrawlScrapeResponse>(
        `${this.baseURL}/v2/scrape`,
        scrapeBody(url, options),
        this.authHeaders(),
        options?.signal,
      );
      return mapScrapeResponse(url, response);
    } catch (error) {
      throw normalizeError(error, "firecrawl");
    }
  }
}

function searchBody(query: string, options?: SearchRequestOptions): Record<string, unknown> {
  validateCategoryCombination(options?.categories);
  return {
    query,
    limit: clampMaxResults(options?.maxResults),
    highlights: options?.highlights ?? true,
    ...domainFilters(options),
    ...sourceAndCategoryFilters(options),
  };
}

function domainFilters(options?: SearchRequestOptions): Record<string, unknown> {
  return {
    ...(options?.includeDomains?.length ? { includeDomains: options.includeDomains } : {}),
    ...(options?.excludeDomains?.length ? { excludeDomains: options.excludeDomains } : {}),
  };
}

function sourceAndCategoryFilters(options?: SearchRequestOptions): Record<string, unknown> {
  return {
    ...(options?.sources?.length ? { sources: options.sources } : {}),
    ...(options?.categories?.length ? { categories: options.categories } : {}),
  };
}

function validateCategoryCombination(categories?: readonly string[]): void {
  if (
    categories?.includes("developer") &&
    categories.some((category) => category !== "developer")
  ) {
    throw new WebError('Firecrawl category "developer" cannot be combined with other categories');
  }
}

function mapSearchResponse(
  response: Readonly<FirecrawlSearchResponse>,
  maxResults?: number,
): SearchResponse {
  if (!response.success) throw new Error("Firecrawl search failed");

  const web = response.data?.web ?? [];
  const news = response.data?.news ?? [];
  const images = response.data?.images ?? [];
  const metadata = searchMetadata(response);
  return {
    results: [
      ...web.map(mapWebResult),
      ...news.map(mapNewsResult),
      ...images.map(mapImageResult),
    ].slice(0, clampMaxResults(maxResults)),
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

function searchMetadata(response: Readonly<FirecrawlSearchResponse>): Record<string, unknown> {
  return {
    ...(response.id === undefined ? {} : { id: response.id }),
    ...(response.warning === undefined || response.warning === null
      ? {}
      : { warning: response.warning }),
    ...(response.creditsUsed === undefined ? {} : { creditsUsed: response.creditsUsed }),
  };
}

function scrapeBody(url: string, options?: Readonly<ReadOptions>): Record<string, unknown> {
  return {
    url,
    formats: [normalizeFormat(options?.format)],
    onlyMainContent: true,
    ...selectorFilters(options),
    ...(options?.timeout ? { timeout: options.timeout * 1000 } : {}),
    ...(options?.noCache ? { maxAge: 0 } : {}),
  };
}

function selectorFilters(options?: Readonly<ReadOptions>): Record<string, unknown> {
  return {
    ...(options?.targetSelector ? { includeTags: [options.targetSelector] } : {}),
    ...(options?.removeSelector ? { excludeTags: [options.removeSelector] } : {}),
  };
}

function mapScrapeResponse(url: string, response: Readonly<FirecrawlScrapeResponse>): ReadResult {
  if (!response.success) throw new Error("Firecrawl scrape failed");

  const data = response.data ?? {};
  const page = data.metadata ?? {};
  return {
    url: page.url || url,
    title: page.title,
    description: page.description,
    content: data.markdown ?? data.html ?? "",
    html: data.html,
    links: data.links ? [...data.links] : undefined,
    image: page.ogImage ?? page["og:image"],
    metadata: fetchMetadata(url, page, data.warning),
  };
}

/** Firecrawl's own fields about the fetch, the part of its metadata an agent can act on. */
const FETCH_METADATA_KEYS = [
  "statusCode",
  "error",
  "contentType",
  "language",
  "cachedAt",
  "creditsUsed",
] as const;

/**
 * Firecrawl returns every meta tag of the page next to its own fields, dozens of keys that
 * repeat the title and description or only matter to a browser. Keep what describes the fetch.
 * @param url - URL the caller asked for.
 * @param page - Metadata object of the scrape.
 * @param warning - Warning Firecrawl attached to the scrape.
 * @returns {Record<string, unknown>} Fields an agent can act on.
 */
function fetchMetadata(
  url: string,
  page: Readonly<FirecrawlPageMetadata>,
  warning: string | null | undefined,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { originalUrl: url };
  for (const key of FETCH_METADATA_KEYS) {
    const value = page[key];
    if (typeof value === "string" || typeof value === "number") metadata[key] = value;
  }
  if (typeof warning === "string") metadata.warning = warning;
  return metadata;
}

function normalizeFormat(format?: string): "markdown" | "html" {
  if (format === "html") return "html";
  return "markdown";
}

/**
 * The query passage in `description` can be the whole page Markdown, so the snippet keeps only its start.
 * @param result - One Firecrawl web hit.
 * @returns {SearchResult} Normalized search result.
 */
function mapWebResult(result: FirecrawlWebResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: snippet(result.description),
    text: result.markdown,
  };
}

function mapNewsResult(result: FirecrawlNewsResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: snippet(result.snippet),
    publishedDate: result.date,
    image: result.imageUrl,
    text: result.markdown,
  };
}

function mapImageResult(result: FirecrawlImageResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: "",
    image: result.imageUrl,
    metadata: { imageWidth: result.imageWidth, imageHeight: result.imageHeight },
  };
}
