import type {
  ProviderConfig,
  SearchFilterCapabilities,
  SearchRequestOptions,
  SearchResult,
} from "../core/types.ts";
import {
  Provider,
  type ProviderCapabilityDetails,
  type ProviderSearchPage,
} from "../core/provider.ts";
import {
  AuthError,
  InvalidSearchContinuationError,
  DEFAULT_RETRY_AFTER,
  RateLimitError,
  WebError,
  normalizeError,
} from "../core/errors.ts";
import { register } from "../core/registry.ts";

interface MojeekSearchEnvelope {
  readonly response?: MojeekSearchResponse;
}

interface MojeekSearchResponse {
  readonly status: string;
  readonly head?: {
    readonly start: number;
    readonly return: number;
    readonly results: number;
  };
  readonly results?: readonly MojeekResult[];
}

const MOJEEK_MAX_RESULT_START = 1_000;

interface MojeekResult {
  readonly url: string;
  readonly title: string;
  readonly desc: string;
  readonly score?: number;
  readonly pdate?: number;
  readonly timestamp?: number;
  readonly cdatetimestamp?: number;
  readonly size?: string;
  readonly cfs?: number;
  readonly mres?: number;
  readonly image?: {
    readonly url?: string;
    readonly width?: number;
    readonly height?: number;
  };
}

class MojeekProvider extends Provider {
  static readonly providerName = "mojeek";
  static readonly defaultBaseURL = "https://api.mojeek.com";
  static readonly capabilityDetails = {
    search: {
      contentOptions: [],
      resultLimit: { default: 10 },
      resultFields: ["score", "publishedDate", "image", "metadata"],
    },
  } as const satisfies ProviderCapabilityDetails;
  static readonly searchFilterCapabilities = {
    filters: ["includeDomains", "excludeDomains", "startPublishedDate", "endPublishedDate"],
  } as const satisfies SearchFilterCapabilities;

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, MojeekProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Mojeek. Set MOJEEK_API_KEY", "mojeek");
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
      const start = mojeekStart(continuation);
      const envelope = await this.client.getJSON<MojeekSearchEnvelope>(
        `${this.baseURL}/search?${searchParams(query, this.apiKey, options, start)}`,
        undefined,
        options?.signal,
      );
      const response = successfulResponse(envelope);
      return {
        results: response.results?.map(mapResult) ?? [],
        ...mojeekContinuation(response.head),
      };
    } catch (error) {
      throw normalizeError(error, "mojeek");
    }
  }
}

function searchParams(
  query: string,
  apiKey: string,
  options: SearchRequestOptions | undefined,
  start: number,
): string {
  return new URLSearchParams({
    q: query,
    api_key: apiKey,
    fmt: "json",
    t: String(options?.maxResults ?? 10),
    date: "1",
    cdate: "1",
    size: "1",
    ...(start === 1 ? {} : { s: String(start) }),
    ...domainParams(options),
    ...dateParams(options),
  }).toString();
}

function mojeekStart(continuation?: string): number {
  if (continuation === undefined) return 1;
  if (!/^[1-9]\d*$/u.test(continuation)) throw new InvalidSearchContinuationError();
  const start = Number(continuation);
  if (!Number.isSafeInteger(start) || start > MOJEEK_MAX_RESULT_START) {
    throw new InvalidSearchContinuationError();
  }
  return start;
}

function mojeekContinuation(
  head: Readonly<{ start: number; return: number; results: number }> | undefined,
): Record<string, string> {
  if (!head || !isPositiveSafeInteger(head.start)) return {};
  if (!isPositiveSafeInteger(head.return) || !isNonnegativeSafeInteger(head.results)) return {};
  const nextStart = head.start + head.return;
  return nextStart <= head.results && nextStart <= MOJEEK_MAX_RESULT_START
    ? { continuation: String(nextStart) }
    : {};
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

function isNonnegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function domainParams(options?: SearchRequestOptions): Record<string, string> {
  return {
    ...(options?.includeDomains?.length ? { fi: options.includeDomains.join(",") } : {}),
    ...(options?.excludeDomains?.length ? { fe: options.excludeDomains.join(",") } : {}),
  };
}

function dateParams(options?: SearchRequestOptions): Record<string, string> {
  return {
    ...(options?.startPublishedDate ? { since: mojeekDate(options.startPublishedDate) } : {}),
    ...(options?.endPublishedDate ? { before: mojeekDate(options.endPublishedDate) } : {}),
  };
}

function mojeekDate(value: string): string {
  return value.slice(0, 10).replaceAll("-", "");
}

function successfulResponse(envelope: Readonly<MojeekSearchEnvelope>): MojeekSearchResponse {
  const response = envelope.response;
  if (!response) {
    throw new WebError("Mojeek returned an invalid search response");
  }
  if (response.status === "OK") {
    return response;
  }
  if (/^Access Denied(?::|$)/i.test(response.status)) {
    throw new AuthError(`Authentication failed: ${response.status}`, "mojeek");
  }
  if (/daily limit reached/i.test(response.status)) {
    throw new RateLimitError(DEFAULT_RETRY_AFTER);
  }
  throw new WebError(`Mojeek search failed: ${response.status}`);
}

function mapResult(result: Readonly<MojeekResult>): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.desc,
    score: result.score,
    publishedDate: unixSecondsToISOString(result.pdate),
    image: result.image?.url,
    metadata: resultMetadata(result),
  };
}

function resultMetadata(result: Readonly<MojeekResult>): Record<string, unknown> | undefined {
  const metadata = {
    ...(result.cfs === undefined ? {} : { confidence: result.cfs }),
    ...(result.size === undefined ? {} : { documentSize: result.size }),
    ...optionalDate("lastModifiedDate", result.timestamp),
    ...optionalDate("crawledDate", result.cdatetimestamp),
    ...(result.mres === undefined ? {} : { moreResultsFromDomain: result.mres === 1 }),
    ...(result.image?.width === undefined ? {} : { imageWidth: result.image.width }),
    ...(result.image?.height === undefined ? {} : { imageHeight: result.image.height }),
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function optionalDate(name: string, value?: number): Record<string, string> {
  const date = unixSecondsToISOString(value);
  return date === undefined ? {} : { [name]: date };
}

function unixSecondsToISOString(value?: number): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

register(MojeekProvider);
