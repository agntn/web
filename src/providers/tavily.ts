import type {
  SearchFilterCapabilities,
  SearchResult,
  SearchRequestOptions,
  SearchResponse,
  ReadOptions,
  ReadResult,
  ProviderConfig,
} from "../core/types.ts";
import { Client } from "../core/client.ts";
import { Provider, type ProviderCapabilityDetails } from "../core/provider.ts";
import { AuthError, HTTPError, PaymentError, WebError, normalizeError } from "../core/errors.ts";
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
  readonly raw_content?: string | null;
}

interface TavilySearchResponse {
  readonly results: readonly TavilyResult[];
  readonly answer?: string;
  readonly query: string;
}

type TavilyExtractFormat = "markdown" | "text";

interface TavilyExtractRequest {
  readonly urls: readonly string[];
  readonly extract_depth: "basic" | "advanced";
  readonly format: TavilyExtractFormat;
  readonly timeout?: number;
}

interface TavilyExtractResult {
  readonly url: string;
  readonly title?: string | null;
  readonly raw_content?: string | null;
}

interface TavilyExtractFailure {
  readonly url: string;
  readonly error: string;
}

interface TavilyExtractResponse {
  readonly results?: readonly TavilyExtractResult[];
  readonly failed_results?: readonly TavilyExtractFailure[];
  readonly request_id?: string;
}

const TAVILY_USAGE_LIMIT_STATUS_CODES = new Set([432, 433]);
const TAVILY_MIN_EXTRACT_TIMEOUT_SECONDS = 1;
const TAVILY_MAX_EXTRACT_TIMEOUT_SECONDS = 60;
const TAVILY_EXTRACT_CLIENT_TIMEOUT_MS = 70_000;

class TavilyProvider extends Provider {
  static readonly providerName = "tavily";
  static readonly defaultBaseURL = "https://api.tavily.com";
  static readonly capabilityDetails = {
    search: {
      contentOptions: ["summary", "fullText"],
      resultLimit: { default: 10, maximum: 20 },
      resultFields: ["score", "publishedDate", "text"],
    },
    read: {
      options: ["format", "timeout"],
      formats: ["markdown", "text"],
    },
  } as const satisfies ProviderCapabilityDetails;
  static readonly searchFilterCapabilities = {
    filters: ["includeDomains", "excludeDomains"],
  } as const satisfies SearchFilterCapabilities;

  private readonly apiKey: string;
  /** Extract waits up to 60 s on request and bills every attempt, so no retries and a longer window. */
  private readonly readClient: Client;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, TavilyProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Tavily. Set TAVILY_API_KEY", "tavily");
    }

    this.apiKey = config.apiKey;
    this.readClient = new Client({ maxRetries: 0, timeout: TAVILY_EXTRACT_CLIENT_TIMEOUT_MS });
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    const response = await this.searchDetailed(query, options);
    return response.results;
  }

  async searchDetailed(query: string, options?: SearchRequestOptions): Promise<SearchResponse> {
    const searchOptions = options ?? {};
    const body = {
      api_key: this.apiKey,
      query,
      max_results: searchOptions.maxResults ?? 10,
      search_depth: "basic",
      include_answer: searchOptions.summary ?? false,
      include_raw_content: searchOptions.fullText ?? false,
      include_domains: searchOptions.includeDomains,
      exclude_domains: searchOptions.excludeDomains,
    } satisfies TavilySearchRequest;

    try {
      const url = `${this.baseURL}/search`;
      const response = await this.client.postJSON<TavilySearchResponse>(
        url,
        body,
        undefined,
        options?.signal,
      );
      return {
        results: response.results.map(mapResult),
        ...(response.answer === undefined ? {} : { metadata: { answer: response.answer } }),
      };
    } catch (error) {
      throw normalizeTavilyError(error);
    }
  }

  async read(url: string, options?: Readonly<ReadOptions>): Promise<ReadResult> {
    const format = normalizeReadFormat(options?.format);
    try {
      const response = await this.readClient.postJSON<TavilyExtractResponse>(
        `${this.baseURL}/extract`,
        extractBody(url, format, options?.timeout),
        { Authorization: `Bearer ${this.apiKey}` },
        options?.signal,
      );
      const result = response.results?.[0];
      if (result) return mapExtractResult(result, format, response.request_id);
      throw extractFailure(response.failed_results?.[0]);
    } catch (error) {
      throw normalizeTavilyError(error);
    }
  }
}

/**
 * Tavily answers a spent plan or pay-as-you-go cap with HTTP 432 or 433, never 402.
 * @param error - Rejected request.
 * @returns {WebError} Payment or normalized provider error.
 */
function normalizeTavilyError(error: unknown): WebError {
  if (error instanceof HTTPError && TAVILY_USAGE_LIMIT_STATUS_CODES.has(error.statusCode)) {
    return new PaymentError(error.statusCode, error.url, error.body);
  }
  return normalizeError(error, "tavily");
}

/**
 * Tavily sends `raw_content: null` unless `include_raw_content` is on, so `text` is left out.
 * @param result - One Tavily search hit.
 * @returns {SearchResult} Normalized search result.
 */
function mapResult(result: TavilyResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.content,
    score: result.score,
    publishedDate: result.published_date,
    ...(typeof result.raw_content === "string" ? { text: result.raw_content } : {}),
  };
}

function extractBody(
  url: string,
  format: TavilyExtractFormat,
  timeout?: number,
): Record<string, unknown> {
  return {
    urls: [url],
    extract_depth: "basic",
    format,
    ...(timeout === undefined ? {} : { timeout: clampExtractTimeout(timeout) }),
  } satisfies TavilyExtractRequest;
}

function clampExtractTimeout(timeout: number): number {
  return Math.min(
    Math.max(timeout, TAVILY_MIN_EXTRACT_TIMEOUT_SECONDS),
    TAVILY_MAX_EXTRACT_TIMEOUT_SECONDS,
  );
}

function normalizeReadFormat(format?: ReadOptions["format"]): TavilyExtractFormat {
  return format === "text" ? "text" : "markdown";
}

/**
 * Extract echoes the requested URL, so `url` stays the one asked for even after a redirect.
 * @param result - One extracted page.
 * @param format - Format the page was requested in.
 * @param requestId - Tavily request id for support.
 * @returns {ReadResult} Normalized page result.
 */
function mapExtractResult(
  result: Readonly<TavilyExtractResult>,
  format: TavilyExtractFormat,
  requestId?: string,
): ReadResult {
  const content = result.raw_content ?? "";
  return {
    url: result.url,
    ...(result.title ? { title: result.title } : {}),
    content,
    ...(format === "text" ? { text: content } : {}),
    ...(requestId === undefined ? {} : { metadata: { requestId } }),
  };
}

/**
 * A page Extract could not fetch comes back inside HTTP 200 as a `failed_results` row with the reason.
 * @param failure - Failed row for the requested URL, when Tavily sent one.
 * @returns {WebError} Provider error carrying Tavily's reason.
 */
function extractFailure(failure?: Readonly<TavilyExtractFailure>): WebError {
  return new WebError(`Tavily extract failed: ${failure?.error ?? "no result returned"}`);
}

register(TavilyProvider);
