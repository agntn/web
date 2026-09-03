import type {
  SearchFilterCapabilities,
  SearchResult,
  SearchRequestOptions,
  SearchResponse,
  ProviderConfig,
} from "../core/types.ts";
import { Provider } from "../core/provider.ts";
import { AuthError, normalizeError } from "../core/errors.ts";
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
  readonly raw_content?: string;
}

interface TavilySearchResponse {
  readonly results: readonly TavilyResult[];
  readonly answer?: string;
  readonly query: string;
}

class TavilyProvider extends Provider {
  static readonly providerName = "tavily";
  static readonly defaultBaseURL = "https://api.tavily.com";
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
      const response = await this.client.postJSON<TavilySearchResponse>(url, body);
      return {
        results: response.results.map(mapResult),
        ...(response.answer === undefined ? {} : { metadata: { answer: response.answer } }),
      };
    } catch (error) {
      throw normalizeError(error, "tavily");
    }
  }
}

function mapResult(result: TavilyResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.content,
    score: result.score,
    publishedDate: result.published_date,
    text: result.raw_content,
  };
}

register(TavilyProvider);
