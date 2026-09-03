import type {
  ImageSearchRequestOptions,
  ImageSearchResult,
  ProviderConfig,
  SearchFilterCapabilities,
  SearchRequestOptions,
  SearchResult,
} from "../core/types.ts";
import {
  Provider,
  type ProviderCapabilityDetails,
  type ProviderSearchPage,
} from "../core/provider.ts";
import { AuthError, InvalidSearchContinuationError, normalizeError } from "../core/errors.ts";
import { register } from "../core/registry.ts";

interface SerpApiResult {
  readonly position: number;
  readonly title: string;
  readonly link: string;
  readonly snippet: string;
  readonly displayed_link?: string;
  readonly favicon?: string;
  readonly date?: string;
  readonly source?: string;
  readonly thumbnail?: string;
}

interface SerpApiSearchResponse {
  readonly search_metadata: {
    readonly id: string;
    readonly status: string;
  };
  readonly organic_results?: readonly SerpApiResult[];
  readonly serpapi_pagination?: {
    readonly next?: string;
  };
}

interface SerpApiVisualMatch {
  readonly position?: number;
  readonly title?: string;
  readonly link?: string;
  readonly source?: string;
  readonly thumbnail?: string;
  readonly thumbnail_width?: number;
  readonly thumbnail_height?: number;
  readonly image?: string;
  readonly image_width?: number;
  readonly image_height?: number;
  readonly exact_matches?: boolean;
}

interface SerpApiImageSearchResponse {
  readonly search_metadata?: {
    readonly id: string;
    readonly status: string;
  };
  readonly visual_matches?: readonly SerpApiVisualMatch[];
  readonly error?: string;
}

class SerpApiProvider extends Provider {
  static readonly providerName = "serpapi";
  static readonly defaultBaseURL = "https://serpapi.com";
  static readonly capabilityDetails = {
    search: {
      contentOptions: [],
      resultLimit: { default: 10 },
      resultFields: ["publishedDate", "image", "favicon", "metadata"],
    },
    searchImage: {
      resultLimit: { default: 10 },
    },
  } as const satisfies ProviderCapabilityDetails;
  static readonly searchFilterCapabilities = {
    filters: [],
  } as const satisfies SearchFilterCapabilities;

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, SerpApiProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for SerpAPI. Set SERPAPI_API_KEY", "serpapi");
    }

    this.apiKey = config.apiKey;
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    return (await this.searchPage(query, options)).results;
  }

  async searchPage(
    query: string,
    options?: SearchRequestOptions,
    continuation?: string,
  ): Promise<ProviderSearchPage> {
    try {
      const start = serpApiStart(continuation);
      const url = `${this.baseURL}/search?engine=google&q=${encodeURIComponent(query)}&api_key=${this.apiKey}&num=${options?.maxResults ?? 10}${start === undefined ? "" : `&start=${start}`}`;
      const response = await this.client.getJSON<SerpApiSearchResponse>(
        url,
        undefined,
        options?.signal,
      );
      return {
        results: (response.organic_results ?? []).map(mapResult),
        ...serpApiContinuation(response.serpapi_pagination?.next),
      };
    } catch (error) {
      throw normalizeError(error, "serpapi");
    }
  }

  async searchByImage(
    imageUrl: string,
    options?: ImageSearchRequestOptions,
  ): Promise<ImageSearchResult[]> {
    try {
      const url = new URL(`${this.baseURL}/search`);
      url.searchParams.set("engine", "google_lens");
      url.searchParams.set("type", "visual_matches");
      url.searchParams.set("url", imageUrl);
      url.searchParams.set("api_key", this.apiKey);
      const response = await this.client.getJSON<SerpApiImageSearchResponse>(
        url.href,
        undefined,
        options?.signal,
      );
      if (response.error) throw new Error(response.error);
      return (response.visual_matches ?? [])
        .flatMap(mapImageResult)
        .slice(0, options?.maxResults ?? 10);
    } catch (error) {
      throw normalizeError(error, "serpapi");
    }
  }
}

function serpApiStart(continuation?: string): number | undefined {
  if (continuation === undefined) return undefined;
  if (!/^[1-9]\d*$/u.test(continuation)) throw new InvalidSearchContinuationError();
  const start = Number(continuation);
  if (!Number.isSafeInteger(start)) throw new InvalidSearchContinuationError();
  return start;
}

function serpApiContinuation(next?: string): Record<string, string> {
  if (next === undefined) return {};
  try {
    const start = new URL(next).searchParams.get("start");
    return start === null ? {} : { continuation: String(serpApiStart(start)) };
  } catch {
    return {};
  }
}

function mapImageResult(result: SerpApiVisualMatch): ImageSearchResult[] {
  const imageUrl = result.image ?? result.thumbnail;
  if (!result.link || !imageUrl) return [];

  return [
    {
      pageUrl: result.link,
      imageUrl,
      title: result.title ?? result.source ?? "",
      provider: "serpapi",
      source: result.source,
      thumbnailUrl: result.thumbnail,
      imageWidth: result.image_width,
      imageHeight: result.image_height,
      thumbnailWidth: result.thumbnail_width,
      thumbnailHeight: result.thumbnail_height,
      position: result.position,
      exactMatch: result.exact_matches,
    },
  ];
}

function mapResult(result: SerpApiResult): SearchResult {
  return {
    url: result.link,
    title: result.title,
    snippet: result.snippet,
    favicon: result.favicon,
    publishedDate: result.date,
    image: result.thumbnail,
    metadata: {
      position: result.position,
      source: result.source,
      displayedLink: result.displayed_link,
    },
  };
}

register(SerpApiProvider);
