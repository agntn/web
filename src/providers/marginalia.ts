import type { ProviderConfig, SearchRequestOptions, SearchResult } from "../core/types.ts";
import { Provider, type ProviderSearchPage } from "../core/provider.ts";
import { InvalidSearchContinuationError, normalizeError } from "../core/errors.ts";
import { MARGINALIA_MAX_RESULTS } from "../core/providers.ts";

interface MarginaliaSearchResponse {
  readonly page?: number;
  readonly pages?: number;
  readonly results?: readonly MarginaliaResult[];
}

interface MarginaliaResult {
  readonly url: string;
  readonly title: string;
  readonly description?: string;
}

/**
 * The key Marginalia hands out for trying the API. Every caller shares its rate limit, so it
 * stands in only when the provider is picked by name and no key is set.
 */
const MARGINALIA_PUBLIC_KEY = "public";

export class MarginaliaProvider extends Provider {
  static readonly providerName = "marginalia";
  static readonly defaultBaseURL = "https://api2.marginalia-search.com";

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, MarginaliaProvider);
    this.apiKey = config.apiKey || MARGINALIA_PUBLIC_KEY;
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
      const page = marginaliaPage(continuation);
      const params = new URLSearchParams({
        query,
        count: String(marginaliaCount(options?.maxResults)),
        ...(page === 1 ? {} : { page: String(page) }),
      });
      const response = await this.client.getJSON<MarginaliaSearchResponse>(
        `${this.baseURL}/search?${params.toString()}`,
        { "API-Key": this.apiKey },
        options?.signal,
      );
      const results = response.results?.map(mapResult) ?? [];
      return { results, ...marginaliaContinuation(response, results.length) };
    } catch (error) {
      throw normalizeError(error, "marginalia");
    }
  }
}

function marginaliaCount(maxResults = 10): number {
  return Math.min(Math.max(maxResults, 1), MARGINALIA_MAX_RESULTS);
}

function marginaliaPage(continuation?: string): number {
  if (continuation === undefined) return 1;
  if (!/^[1-9]\d*$/u.test(continuation)) throw new InvalidSearchContinuationError();
  const page = Number(continuation);
  if (!Number.isSafeInteger(page)) throw new InvalidSearchContinuationError();
  return page;
}

/**
 * `page` and `pages` come back with every answer, and the page after the last one is empty, so
 * the next page is offered only while the answer says there is one.
 * @param response - Marginalia search response.
 * @param returned - Number of results on this page.
 * @returns {Record<string, string>} The continuation, or nothing on the last page.
 */
function marginaliaContinuation(
  response: Readonly<MarginaliaSearchResponse>,
  returned: number,
): Record<string, string> {
  const { page, pages } = response;
  if (returned === 0 || !isPositiveSafeInteger(page) || !isPositiveSafeInteger(pages)) return {};
  return page < pages ? { continuation: String(page + 1) } : {};
}

function isPositiveSafeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 1;
}

function mapResult(result: Readonly<MarginaliaResult>): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.description ?? "",
  };
}
