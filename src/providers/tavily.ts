import type {
  SearchFilterCapabilities,
  SearchResult,
  SearchRequestOptions,
  SearchResponse,
  ProviderConfig,
} from "../core/types.ts";
import { Provider, type ProviderCapabilityDetails } from "../core/provider.ts";
import {
  AuthError,
  HTTPError,
  PaymentError,
  normalizeError,
  type WebError,
} from "../core/errors.ts";
import { register } from "../core/registry.ts";

interface TavilySearchRequest {
  readonly api_key: string;
  readonly query: string;
  readonly max_results?: number;
  readonly search_depth?: "basic" | "advanced";
  readonly include_answer?: boolean;
  readonly include_raw_content?: boolean;
  readonly include_domains?: readonly string[];
  readonly exclude_domains?: readonly string[];
}

interface TavilyResult {
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly score: number;
  readonly published_date?: string;
  readonly raw_content?: string | null;
}

interface TavilySearchResponse {
  readonly results: readonly TavilyResult[];
  readonly answer?: string;
  readonly query: string;
}

const TAVILY_USAGE_LIMIT_STATUS_CODES = new Set([432, 433]);

class TavilyProvider extends Provider {
  static readonly providerName = "tavily";
  static readonly defaultBaseURL = "https://api.tavily.com";
  static readonly capabilityDetails = {
    search: {
      contentOptions: ["summary", "fullText"],
      resultLimit: { default: 10, maximum: 20 },
      resultFields: ["score", "publishedDate", "text"],
    },
  } as const satisfies ProviderCapabilityDetails;
  static readonly searchFilterCapabilities = {
    filters: ["includeDomains", "excludeDomains"],
  } as const satisfies SearchFilterCapabilities;

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, TavilyProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Tavily. Set TAVILY_API_KEY", "tavily");
    }

    this.apiKey = config.apiKey;
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    const response = await this.searchDetailed(query, options);
    return response.results;
  }

  async searchDetailed(query: string, options?: SearchRequestOptions): Promise<SearchResponse> {
    const searchOptions = options ?? {};
    const body = {
      api_key: this.apiKey,
      query,
      max_results: searchOptions.maxResults ?? 10,
      search_depth: "basic",
      include_answer: searchOptions.summary ?? false,
      include_raw_content: searchOptions.fullText ?? false,
      include_domains: searchOptions.includeDomains,
      exclude_domains: searchOptions.excludeDomains,
    } satisfies TavilySearchRequest;

    try {
      const url = `${this.baseURL}/search`;
      const response = await this.client.postJSON<TavilySearchResponse>(
        url,
        body,
        undefined,
        options?.signal,
      );
      return {
        results: response.results.map(mapResult),
        ...(response.answer === undefined ? {} : { metadata: { answer: response.answer } }),
      };
    } catch (error) {
      throw normalizeTavilyError(error);
    }
  }
}

/**
 * Tavily answers a spent plan or pay-as-you-go cap with HTTP 432 or 433, never 402.
 * @param error - Rejected request.
 * @returns {WebError} Payment or normalized provider error.
 */
function normalizeTavilyError(error: unknown): WebError {
  if (error instanceof HTTPError && TAVILY_USAGE_LIMIT_STATUS_CODES.has(error.statusCode)) {
    return new PaymentError(error.statusCode, error.url, error.body);
  }
  return normalizeError(error, "tavily");
}

/**
 * Tavily sends `raw_content: null` unless `include_raw_content` is on, so `text` is left out.
 * @param result - One Tavily search hit.
 * @returns {SearchResult} Normalized search result.
 */
function mapResult(result: TavilyResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.content,
    score: result.score,
    publishedDate: result.published_date,
    ...(typeof result.raw_content === "string" ? { text: result.raw_content } : {}),
  };
}

register(TavilyProvider);
