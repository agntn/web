import type {
  ProviderConfig,
  ReadOptions,
  ReadResult,
  SearchRequestOptions,
  SearchResult,
} from "../core/types.ts";
import { Client } from "../core/client.ts";
import { Provider } from "../core/provider.ts";
import { AuthError, WebError, normalizeError } from "../core/errors.ts";

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

interface ExaContentsRequest {
  readonly urls: readonly string[];
  readonly text: true;
  readonly maxAgeHours?: 0;
  readonly livecrawlTimeout?: number;
}

/** One entry per requested URL; a page Exa could not fetch is reported here, inside HTTP 200. */
interface ExaContentsStatus {
  readonly id: string;
  readonly status: string;
  readonly error?: { readonly tag?: string; readonly httpStatusCode?: number };
}

interface ExaContentsResponse {
  readonly requestId?: string;
  readonly results?: readonly ExaResult[];
  readonly statuses?: readonly ExaContentsStatus[];
}

/** `livecrawlTimeout` is capped at 90 s, so the read client waits a little longer than that. */
const EXA_MAX_LIVECRAWL_TIMEOUT_MS = 90_000;
const EXA_CONTENTS_CLIENT_TIMEOUT_MS = 100_000;

export class ExaProvider extends Provider {
  static readonly providerName = "exa";
  static readonly defaultBaseURL = "https://api.exa.ai";

  private readonly apiKey: string;
  /** Contents bills every page it fetches and may crawl for up to 90 s, so no retries and a longer window. */
  private readonly readClient: Client;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, ExaProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Exa. Set EXA_API_KEY", "exa");
    }

    this.apiKey = config.apiKey;
    this.readClient = new Client({ maxRetries: 0, timeout: EXA_CONTENTS_CLIENT_TIMEOUT_MS });
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

  async read(url: string, options?: Readonly<ReadOptions>): Promise<ReadResult> {
    try {
      const response = await this.readClient.postJSON<ExaContentsResponse>(
        `${this.baseURL}/contents`,
        contentsBody(url, options),
        { "x-api-key": this.apiKey },
        options?.signal,
      );
      const result = response.results?.[0];
      if (result) return mapContentsResult(result, url, response.requestId);
      throw contentsFailure(response.statuses?.find((status) => status.status !== "success"));
    } catch (error) {
      throw normalizeError(error, "exa");
    }
  }
}

/**
 * Text comes back as markdown. `noCache` asks for a fresh crawl with `maxAgeHours: 0`, and
 * `timeout` in seconds becomes `livecrawlTimeout` in milliseconds, capped at Exa's 90 s.
 * @param url - Page to read.
 * @param options - Read options requested by the caller.
 * @returns {Record<string, unknown>} Request body for `POST /contents`.
 */
function contentsBody(url: string, options?: Readonly<ReadOptions>): Record<string, unknown> {
  return {
    urls: [url],
    text: true,
    ...(options?.noCache ? { maxAgeHours: 0 } : {}),
    ...(options?.timeout === undefined
      ? {}
      : {
          livecrawlTimeout: Math.min(
            Math.max(Math.round(options.timeout * 1000), 1),
            EXA_MAX_LIVECRAWL_TIMEOUT_MS,
          ),
        }),
  } satisfies ExaContentsRequest;
}

/**
 * `url` is the address Exa read, which can differ from the one asked for after a redirect.
 * @param result - The page Exa returned.
 * @param requestedUrl - URL the caller asked for, used when Exa sends none.
 * @param requestId - Exa request id for support.
 * @returns {ReadResult} Normalized page result.
 */
function mapContentsResult(
  result: Readonly<ExaResult>,
  requestedUrl: string,
  requestId?: string,
): ReadResult {
  return {
    url: result.url || requestedUrl,
    ...(result.title ? { title: result.title } : {}),
    content: result.text ?? "",
    ...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
    ...(result.image ? { image: result.image } : {}),
    ...(requestId === undefined ? {} : { metadata: { requestId } }),
  };
}

/**
 * A page Contents cannot fetch is not an HTTP error: the request succeeds with an empty
 * `results` and the reason as a tag such as `CRAWL_NOT_FOUND` in `statuses`.
 * @param status - Failed status for the requested URL, when Exa sent one.
 * @returns {WebError} Provider error carrying Exa's tag and the page's HTTP status.
 */
function contentsFailure(status?: Readonly<ExaContentsStatus>): WebError {
  const tag = status?.error?.tag ?? status?.status ?? "no result returned";
  const httpStatus = status?.error?.httpStatusCode;
  return new WebError(
    `Exa contents failed: ${tag}${httpStatus === undefined ? "" : ` (HTTP ${httpStatus})`}`,
  );
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
