import type { SearchResult, SearchRequestOptions, ProviderConfig } from "../core/types.ts";
import { Provider } from "../core/provider.ts";
import { AuthError, normalizeError } from "../core/errors.ts";
import { register } from "../core/registry.ts";

interface ExaSearchRequest {
  readonly query: string;
  readonly type?: string;
  readonly numResults?: number;
  readonly category?: string;
  readonly includeDomains?: readonly string[];
  readonly excludeDomains?: readonly string[];
  readonly startPublishedDate?: string;
  readonly endPublishedDate?: string;
  readonly contents?: { text: boolean; highlights: boolean };
}

interface ExaResult {
  readonly id: string;
  readonly url: string;
  readonly title: string | null;
  readonly score?: number;
  readonly publishedDate?: string;
  readonly author?: string;
  readonly image?: string;
  readonly favicon?: string;
  readonly text?: string;
  readonly highlights?: readonly string[];
  readonly highlightScores?: readonly number[];
  readonly summary?: string;
}

interface ExaSearchResponse {
  readonly requestId: string;
  readonly results: readonly ExaResult[];
}

class ExaProvider extends Provider {
  static readonly providerName = "exa";
  static readonly defaultBaseURL = "https://api.exa.ai";

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, ExaProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Exa. Set EXA_API_KEY", "exa");
    }

    this.apiKey = config.apiKey;
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    const body = {
      query,
      type: "auto",
      numResults: options?.maxResults,
      category: options?.category,
      includeDomains: options?.includeDomains,
      excludeDomains: options?.excludeDomains,
      startPublishedDate: options?.startPublishedDate,
      endPublishedDate: options?.endPublishedDate,
      contents: { text: true, highlights: true },
    } satisfies ExaSearchRequest;

    try {
      const url = `${this.baseURL}/search`;
      const headers = { "x-api-key": this.apiKey };
      const response = await this.client.postJSON<ExaSearchResponse>(url, body, headers);
      return response.results.map(mapResult);
    } catch (error) {
      throw normalizeError(error, "exa");
    }
  }
}

function mapResult(result: ExaResult): SearchResult {
  return {
    url: result.url,
    title: result.title ?? "",
    snippet: result.highlights?.[0] ?? (result.text ? result.text.slice(0, 200) : ""),
    score: result.score,
    publishedDate: result.publishedDate,
    author: result.author,
    image: result.image,
    favicon: result.favicon,
    text: result.text,
    highlights: result.highlights ? [...result.highlights] : undefined,
    summary: result.summary,
  };
}

register(ExaProvider);
