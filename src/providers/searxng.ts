import type {
  SearchFilterCapabilities,
  SearchResult,
  SearchRequestOptions,
  ProviderConfig,
} from "../core/types.ts";
import { Provider, type ProviderCapabilityDetails } from "../core/provider.ts";
import { normalizeError } from "../core/errors.ts";
import { register } from "../core/registry.ts";

interface SearXNGResult {
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly engine: string;
  readonly engines: readonly string[];
  readonly score: number;
  readonly category: string;
  readonly publishedDate?: string;
  readonly img_src?: string;
  readonly thumbnail?: string;
}

interface SearXNGSearchResponse {
  readonly results: readonly SearXNGResult[];
  readonly number_of_results?: number;
  readonly query: string;
}

const SEARXNG_PROBE_TIMEOUT_MS = 2000;

class SearXNGProvider extends Provider {
  static readonly providerName = "searxng";
  static readonly defaultBaseURL = "http://localhost:8080";
  static readonly capabilityDetails = {
    search: {
      contentOptions: [],
      resultFields: ["score", "publishedDate", "image", "metadata"],
    },
  } as const satisfies ProviderCapabilityDetails;
  static readonly searchFilterCapabilities = {
    filters: ["category"],
  } as const satisfies SearchFilterCapabilities;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, SearXNGProvider);
  }

  /**
   * Quick reachability probe for self-hosted instances. Returns false instead
   * of throwing so {@link searchAll} can skip an unreachable instance silently.
   * Treats any HTTP response (even 4xx) as reachable — the host is up.
   * Uses a <=2s timeout so a dead endpoint does not stall fan-out.
   * @returns {Promise<boolean>} Whether the endpoint responds.
   */
  async isAvailable(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARXNG_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(this.baseURL, {
        method: "GET",
        signal: controller.signal,
      });
      // Any HTTP status means the host responded; treat as reachable.
      return typeof response.status === "number";
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    try {
      const params = new URLSearchParams({
        q: query,
        format: "json",
        pageno: "1",
      });

      if (options?.category) {
        params.append("categories", options.category);
      }

      const url = `${this.baseURL}/search?${params.toString()}`;
      const response = await this.client.getJSON<SearXNGSearchResponse>(url);

      let results = response.results.map(mapResult);

      if (options?.maxResults) {
        results = results.slice(0, options.maxResults);
      }

      return results;
    } catch (error) {
      throw normalizeError(error, "searxng");
    }
  }
}

function mapResult(result: SearXNGResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.content,
    score: result.score,
    publishedDate: result.publishedDate,
    image: result.img_src ?? result.thumbnail,
    metadata: {
      engine: result.engine,
      engines: result.engines,
      category: result.category,
    },
  };
}

register(SearXNGProvider);
