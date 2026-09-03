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
import { InvalidSearchContinuationError, normalizeError } from "../core/errors.ts";
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
   * @param signal - Caller cancellation shared with provider discovery.
   * @returns {Promise<boolean>} Whether the endpoint responds.
   */
  async isAvailable(signal?: Readonly<AbortSignal>): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException("SearXNG probe timed out", "TimeoutError")),
      SEARXNG_PROBE_TIMEOUT_MS,
    );
    const probeSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const response = await fetch(this.baseURL, {
        method: "GET",
        signal: probeSignal,
      });
      // Any HTTP status means the host responded; treat as reachable.
      return typeof response.status === "number";
    } catch {
      signal?.throwIfAborted();
      return false;
    } finally {
      clearTimeout(timer);
    }
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
      const page = searxngPage(continuation);
      const params = new URLSearchParams({
        q: query,
        format: "json",
        pageno: String(page),
      });

      if (options?.category) {
        params.append("categories", options.category);
      }

      const url = `${this.baseURL}/search?${params.toString()}`;
      const response = await this.client.getJSON<SearXNGSearchResponse>(
        url,
        undefined,
        options?.signal,
      );
      const results = response.results.map(mapResult);

      return {
        results: options?.maxResults ? results.slice(0, options.maxResults) : results,
        ...(response.results.length > 0
          ? { continuation: String(page + 1), continuationStatus: "unknown" as const }
          : {}),
      };
    } catch (error) {
      throw normalizeError(error, "searxng");
    }
  }
}

function searxngPage(continuation?: string): number {
  if (continuation === undefined) return 1;
  if (!/^[1-9]\d*$/u.test(continuation)) throw new InvalidSearchContinuationError();
  const page = Number(continuation);
  if (!Number.isSafeInteger(page)) throw new InvalidSearchContinuationError();
  return page;
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
