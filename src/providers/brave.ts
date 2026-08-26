import type { SearchResult, SearchRequestOptions, ProviderConfig } from "../core/types.ts";
import { Provider } from "../core/provider.ts";
import { AuthError, normalizeError } from "../core/errors.ts";
import { register } from "../core/registry.ts";

interface BraveResult {
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly extra_snippets?: readonly string[];
  readonly age?: string;
  readonly language?: string;
  readonly family_friendly?: boolean;
  readonly meta_url?: {
    readonly favicon?: string;
  };
}

interface BraveSearchResponse {
  readonly web?: {
    readonly results: readonly BraveResult[];
  };
}

class BraveProvider extends Provider {
  static readonly providerName = "brave";
  static readonly defaultBaseURL = "https://api.search.brave.com";

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, BraveProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Brave Search. Set BRAVE_API_KEY", "brave");
    }

    this.apiKey = config.apiKey;
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    try {
      const url = `${this.baseURL}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${options?.maxResults ?? 10}`;
      const headers = { "X-Subscription-Token": this.apiKey };
      const response = await this.client.getJSON<BraveSearchResponse>(url, headers);
      return (response.web?.results ?? []).map(mapResult);
    } catch (error) {
      throw normalizeError(error, "brave");
    }
  }
}

function mapResult(result: BraveResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.description,
    favicon: result.meta_url?.favicon,
    text: result.extra_snippets ? result.extra_snippets.join("\n") : undefined,
  };
}

register(BraveProvider);
