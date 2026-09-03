import type {
  SearchFilterCapabilities,
  SearchResult,
  SearchRequestOptions,
  ProviderConfig,
} from "../core/types.ts";
import {
  Provider,
  type ProviderCapabilityDetails,
  type ProviderSearchPage,
} from "../core/provider.ts";
import { AuthError, InvalidSearchContinuationError, normalizeError } from "../core/errors.ts";
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
  readonly query?: {
    readonly more_results_available?: boolean;
  };
  readonly web?: {
    readonly results: readonly BraveResult[];
  };
}

class BraveProvider extends Provider {
  static readonly providerName = "brave";
  static readonly defaultBaseURL = "https://api.search.brave.com";
  static readonly capabilityDetails = {
    search: {
      contentOptions: [],
      resultLimit: { default: 10, maximum: 20 },
      resultFields: ["favicon", "text"],
    },
  } as const satisfies ProviderCapabilityDetails;
  static readonly searchFilterCapabilities = {
    filters: [],
  } as const satisfies SearchFilterCapabilities;

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, BraveProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Brave Search. Set BRAVE_API_KEY", "brave");
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
      const offset = braveOffset(continuation);
      const url = braveSearchUrl(this.baseURL, query, options?.maxResults, offset);
      const headers = { "X-Subscription-Token": this.apiKey };
      const response = await this.client.getJSON<BraveSearchResponse>(
        url,
        headers,
        options?.signal,
      );
      return {
        results: (response.web?.results ?? []).map(mapResult),
        ...braveContinuation(response, offset),
      };
    } catch (error) {
      throw normalizeError(error, "brave");
    }
  }
}

function braveSearchUrl(
  baseURL: string,
  query: string,
  maxResults: number | undefined,
  offset: number,
): string {
  const offsetParam = offset === 0 ? "" : `&offset=${offset}`;
  return `${baseURL}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults ?? 10}${offsetParam}`;
}

function braveContinuation(
  response: Readonly<BraveSearchResponse>,
  offset: number,
): Record<string, string> {
  if (response.query?.more_results_available !== true || offset >= 9) return {};
  return { continuation: String(offset + 1) };
}

function braveOffset(continuation?: string): number {
  if (continuation === undefined) return 0;
  if (!/^[1-9]$/u.test(continuation)) throw new InvalidSearchContinuationError();
  return Number(continuation);
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
