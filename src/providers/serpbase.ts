import type {
  SearchFilterCapabilities,
  SearchResult,
  SearchRequestOptions,
  ProviderConfig,
} from "../core/types.ts";
import { Provider } from "../core/provider.ts";
import { WebError, AuthError, RateLimitError, normalizeError } from "../core/errors.ts";
import { register } from "../core/registry.ts";

interface SerpBaseSearchRequest {
  readonly q: string;
  readonly hl?: string;
  readonly gl?: string;
  readonly page?: number;
}

interface SerpBaseResult {
  readonly rank?: number;
  readonly position?: number;
  readonly title?: string;
  readonly link?: string;
  readonly url?: string;
  readonly source_url?: string;
  readonly display_url?: string;
  readonly display_link?: string;
  readonly snippet?: string;
  readonly date?: string;
  readonly published_at?: string;
  readonly icon?: string;
  readonly image_url?: string;
  readonly thumbnail_url?: string;
  readonly thumbnail?: string;
  readonly source?: string;
  readonly domain?: string;
  readonly time?: string;
  readonly duration?: string;
}

interface SerpBaseSearchResponse {
  readonly status: number;
  readonly error?: string;
  readonly request_id: string;
  readonly elapsed_ms: number;
  readonly credits_charged: number;
  readonly search_type: string;
  readonly query?: string;
  readonly organic?: readonly SerpBaseResult[];
  readonly images?: readonly SerpBaseResult[];
  readonly news?: readonly SerpBaseResult[];
  readonly videos?: readonly SerpBaseResult[];
}

const SERPBASE_MAX_RESULTS = 20;
const SERPBASE_SEARCH_CATEGORIES = ["images", "image", "news", "videos", "video"] as const;

class SerpBaseProvider extends Provider {
  static readonly providerName = "serpbase";
  static readonly defaultBaseURL = "https://api.serpbase.dev";
  static readonly searchFilterCapabilities = {
    filters: ["category"],
    categories: SERPBASE_SEARCH_CATEGORIES,
  } as const satisfies SearchFilterCapabilities;

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, SerpBaseProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for SerpBase. Set SERPBASE_API_KEY", "serpbase");
    }

    this.apiKey = config.apiKey;
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    const endpoint = endpointForCategory(options?.category);
    const body = {
      q: query,
      hl: "en",
      gl: "us",
      page: 1,
    } satisfies SerpBaseSearchRequest;

    try {
      const url = `${this.baseURL}${endpoint}`;
      const headers = { "X-API-Key": this.apiKey };
      const response = await this.client.postJSON<SerpBaseSearchResponse>(url, body, headers);
      assertSerpBaseSuccess(response);
      return resultsForResponse(response)
        .slice(0, clampMaxResults(options?.maxResults ?? 10))
        .map((result) => mapResult(result, response));
    } catch (error) {
      throw normalizeError(error, "serpbase");
    }
  }
}

function endpointForCategory(
  category: string | undefined,
): "/google/search" | "/google/images" | "/google/news" | "/google/videos" {
  if (!isSerpBaseSearchCategory(category)) return "/google/search";
  switch (category) {
    case "images":
    case "image":
      return "/google/images";
    case "news":
      return "/google/news";
    case "videos":
    case "video":
      return "/google/videos";
    default:
      return "/google/search";
  }
}

function isSerpBaseSearchCategory(
  category: string | undefined,
): category is (typeof SERPBASE_SEARCH_CATEGORIES)[number] {
  return SERPBASE_SEARCH_CATEGORIES.some((supported) => supported === category);
}

function clampMaxResults(maxResults: number): number {
  return Math.min(Math.max(maxResults, 1), SERPBASE_MAX_RESULTS);
}

function assertSerpBaseSuccess(response: SerpBaseSearchResponse): void {
  if (response.status === 0) return;

  const message = response.error ?? `SerpBase API error: status=${response.status}`;
  switch (response.status) {
    case 1001:
      throw new AuthError(`Authentication failed: ${message}`, "serpbase");
    case 1029:
      throw new RateLimitError(60);
    case 1020:
      throw new WebError(`SerpBase insufficient credits: ${message}`);
    default:
      throw new WebError(`SerpBase API error ${response.status}: ${message}`);
  }
}

function resultsForResponse(response: SerpBaseSearchResponse): readonly SerpBaseResult[] {
  switch (response.search_type) {
    case "images":
      return response.images ?? [];
    case "news":
      return response.news ?? [];
    case "videos":
      return response.videos ?? [];
    default:
      return response.organic ?? [];
  }
}

function mapResult(result: SerpBaseResult, response: SerpBaseSearchResponse): SearchResult {
  return {
    url: firstDefined(result.url, result.link, result.source_url, result.image_url) ?? "",
    title: firstDefined(result.title, result.source, result.domain) ?? "",
    snippet: result.snippet ?? "",
    publishedDate: firstDefined(result.published_at, result.date, result.time),
    image: firstDefined(result.image_url, result.thumbnail_url, result.thumbnail),
    favicon: result.icon,
    metadata: {
      position: result.position ?? result.rank,
      rank: result.rank,
      displayUrl: result.display_url,
      displayLink: result.display_link,
      sourceUrl: result.source_url,
      source: result.source,
      domain: result.domain,
      duration: result.duration,
      searchType: response.search_type,
      requestId: response.request_id,
      elapsedMs: response.elapsed_ms,
      creditsCharged: response.credits_charged,
    },
  };
}

function firstDefined<T>(...values: readonly (T | undefined)[]): T | undefined {
  return values.find((value) => value !== undefined);
}

register(SerpBaseProvider);
