import type {
  SearchFilterCapabilities,
  SearchResult,
  SearchRequestOptions,
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
    const body = {
      api_key: this.apiKey,
      query,
      max_results: options?.maxResults ?? 10,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      include_domains: options?.includeDomains,
      exclude_domains: options?.excludeDomains,
    } satisfies TavilySearchRequest;

    try {
      const url = `${this.baseURL}/search`;
      const response = await this.client.postJSON<TavilySearchResponse>(url, body);
      return response.results.map((result, index) =>
        mapResult(result, response.answer, index === 0),
      );
    } catch (error) {
      throw normalizeError(error, "tavily");
    }
  }
}

function mapResult(
  result: TavilyResult,
  answer: string | undefined,
  isFirst: boolean,
): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.content,
    score: result.score,
    publishedDate: result.published_date,
    text: result.raw_content,
    summary: isFirst && answer ? answer : undefined,
  };
}

register(TavilyProvider);
