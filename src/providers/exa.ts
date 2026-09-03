import type {
  SearchFilterCapabilities,
  SearchResult,
  SearchRequestOptions,
  ProviderConfig,
} from "../core/types.ts";
import { Provider, type ProviderCapabilityDetails } from "../core/provider.ts";
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
  readonly contents?: { text: boolean; highlights: boolean; summary?: true };
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
  static readonly capabilityDetails = {
    search: {
      contentOptions: ["highlights", "summary", "fullText"],
      resultLimit: { default: 10, maximum: 100 },
      resultFields: [
        "score",
        "publishedDate",
        "author",
        "image",
        "favicon",
        "text",
        "highlights",
        "summary",
      ],
    },
  } as const satisfies ProviderCapabilityDetails;
  static readonly searchFilterCapabilities = {
    filters: [
      "includeDomains",
      "excludeDomains",
      "category",
      "startPublishedDate",
      "endPublishedDate",
    ],
  } as const satisfies SearchFilterCapabilities;

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, ExaProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Exa. Set EXA_API_KEY", "exa");
    }

    this.apiKey = config.apiKey;
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    const searchOptions = options ?? {};
    const body = {
      query,
      type: "auto",
      numResults: searchOptions.maxResults,
      category: searchOptions.category,
      includeDomains: searchOptions.includeDomains,
      excludeDomains: searchOptions.excludeDomains,
      startPublishedDate: searchOptions.startPublishedDate,
      endPublishedDate: searchOptions.endPublishedDate,
      contents: {
        text: searchOptions.fullText ?? false,
        highlights: includeHighlights(searchOptions),
        ...(searchOptions.summary ? { summary: true } : {}),
      },
    } satisfies ExaSearchRequest;

    try {
      const url = `${this.baseURL}/search`;
      const headers = { "x-api-key": this.apiKey };
      const response = await this.client.postJSON<ExaSearchResponse>(
        url,
        body,
        headers,
        searchOptions.signal,
      );
      return response.results.map(mapResult);
    } catch (error) {
      throw normalizeError(error, "exa");
    }
  }
}

function includeHighlights(options?: SearchRequestOptions): boolean {
  return options?.highlights ?? true;
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
