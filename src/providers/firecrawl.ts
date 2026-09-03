import type {
  SearchFilterCapabilities,
  SearchResult,
  SearchRequestOptions,
  SearchResponse,
  ReadResult,
  ReadOptions,
  ProviderConfig,
} from "../core/types.ts";
import { Provider, type ProviderCapabilityDetails } from "../core/provider.ts";
import { AuthError, WebError, normalizeError } from "../core/errors.ts";
import { register } from "../core/registry.ts";

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

interface FirecrawlScrapeResponse {
  readonly success: boolean;
  readonly data?: {
    readonly markdown?: string;
    readonly html?: string;
    readonly metadata?: {
      readonly title?: string;
      readonly description?: string;
      readonly sourceURL?: string;
      readonly language?: string;
      readonly keywords?: string;
      readonly ogImage?: string;
      readonly [key: string]: unknown;
    };
    readonly links?: readonly string[];
    readonly warning?: string;
  };
}

const FIRECRAWL_MAX_RESULTS = 100;

function clampMaxResults(max?: number): number {
  return Math.min(Math.max(max ?? 10, 1), FIRECRAWL_MAX_RESULTS);
}

class FirecrawlProvider extends Provider {
  static readonly providerName = "firecrawl";
  static readonly defaultBaseURL = "https://api.firecrawl.dev";
  static readonly capabilityDetails = {
    search: {
      contentOptions: ["highlights"],
      resultLimit: { default: 10, maximum: FIRECRAWL_MAX_RESULTS },
      resultFields: ["image", "text", "metadata"],
    },
    read: {
      options: ["format", "targetSelector", "removeSelector", "timeout", "noCache"],
      formats: ["markdown", "html"],
    },
  } as const satisfies ProviderCapabilityDetails;
  static readonly searchFilterCapabilities = {
    filters: ["includeDomains", "excludeDomains", "sources", "categories"],
  } as const satisfies SearchFilterCapabilities;

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
    results: [...web, ...news, ...images]
      .slice(0, clampMaxResults(maxResults))
      .map(mapSearchResult),
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
  return {
    url,
    title: data.metadata?.title,
    description: data.metadata?.description,
    content: data.markdown ?? data.html ?? "",
    html: data.html,
    links: data.links ? [...data.links] : undefined,
    image: data.metadata?.ogImage,
    metadata: data.metadata,
  };
}

function normalizeFormat(format?: string): "markdown" | "html" {
  if (format === "html") return "html";
  return "markdown";
}

function mapSearchResult(
  result: FirecrawlWebResult | FirecrawlNewsResult | FirecrawlImageResult,
): SearchResult {
  if ("imageUrl" in result) {
    return {
      url: result.url,
      title: result.title,
      snippet: "",
      image: result.imageUrl,
      metadata: { imageWidth: result.imageWidth, imageHeight: result.imageHeight },
    };
  }
  return {
    url: result.url,
    title: result.title,
    snippet: "description" in result ? result.description : result.snippet,
    text: result.markdown,
  };
}

register(FirecrawlProvider);
