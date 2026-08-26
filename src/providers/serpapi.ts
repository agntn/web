import type { SearchResult, SearchRequestOptions, ProviderConfig } from "../core/types.ts";
import { Provider } from "../core/provider.ts";
import { AuthError, normalizeError } from "../core/errors.ts";
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
}

class SerpApiProvider extends Provider {
  static readonly providerName = "serpapi";
  static readonly defaultBaseURL = "https://serpapi.com";

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, SerpApiProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for SerpAPI. Set SERPAPI_API_KEY", "serpapi");
    }

    this.apiKey = config.apiKey;
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    try {
      const url = `${this.baseURL}/search?engine=google&q=${encodeURIComponent(query)}&api_key=${this.apiKey}&num=${options?.maxResults ?? 10}`;
      const response = await this.client.getJSON<SerpApiSearchResponse>(url);
      return (response.organic_results ?? []).map(mapResult);
    } catch (error) {
      throw normalizeError(error, "serpapi");
    }
  }
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
