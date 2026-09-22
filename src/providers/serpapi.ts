import type {
  ImageSearchRequestOptions,
  ImageSearchResult,
  ProviderConfig,
  SearchRequestOptions,
  SearchResult,
} from "../core/types.ts";
import { Provider, type ProviderSearchPage } from "../core/provider.ts";
import {
  AuthError,
  InvalidSearchContinuationError,
  WebError,
  normalizeError,
} from "../core/errors.ts";
import { utcDay } from "../core/dates.ts";

interface SerpApiResult {
  readonly position: number;
  readonly title: string;
  readonly link: string;
  readonly snippet: string;
  readonly displayed_link?: string;
  readonly favicon?: string;
  readonly date?: string;
  readonly source?: string;
  readonly thumbnail?: string;
}

interface SerpApiSearchResponse {
  readonly search_metadata: {
    readonly id: string;
    readonly status: string;
  };
  readonly organic_results?: readonly SerpApiResult[];
  readonly serpapi_pagination?: {
    readonly next?: string;
  };
}

interface SerpApiVisualMatch {
  readonly position?: number;
  readonly title?: string;
  readonly link?: string;
  readonly source?: string;
  readonly thumbnail?: string;
  readonly thumbnail_width?: number;
  readonly thumbnail_height?: number;
  readonly image?: string;
  readonly image_width?: number;
  readonly image_height?: number;
  readonly exact_matches?: boolean;
}

interface SerpApiImageSearchResponse {
  readonly search_metadata?: {
    readonly id: string;
    readonly status: string;
  };
  readonly visual_matches?: readonly SerpApiVisualMatch[];
  readonly error?: string;
}

export class SerpApiProvider extends Provider {
  static readonly providerName = "serpapi";
  static readonly defaultBaseURL = "https://serpapi.com";

  private readonly apiKey: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, SerpApiProvider);
    if (!config.apiKey) {
      throw new AuthError("Missing API key for SerpAPI. Set SERPAPI_API_KEY", "serpapi");
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
      const page = serpApiPage(continuation);
      const limit = resultLimit(options?.maxResults);
      const url = `${this.baseURL}/search?engine=google&q=${encodeURIComponent(query)}&api_key=${this.apiKey}&num=${limit}${page.start === 0 ? "" : `&start=${page.start}`}${dateRangeParam(options)}`;
      const response = await this.client.getJSON<SerpApiSearchResponse>(
        url,
        undefined,
        options?.signal,
      );
      const organic = response.organic_results ?? [];
      const results = organic.slice(page.offset, page.offset + limit);
      return {
        results: results.map(mapResult),
        ...serpApiContinuation(
          page,
          page.offset + results.length,
          organic.length,
          response.serpapi_pagination?.next,
        ),
      };
    } catch (error) {
      throw normalizeError(error, "serpapi");
    }
  }

  async searchByImage(
    imageUrl: string,
    options?: ImageSearchRequestOptions,
  ): Promise<ImageSearchResult[]> {
    try {
      const url = new URL(`${this.baseURL}/search`);
      url.searchParams.set("engine", "google_lens");
      url.searchParams.set("type", "visual_matches");
      url.searchParams.set("url", imageUrl);
      url.searchParams.set("api_key", this.apiKey);
      const response = await this.client.getJSON<SerpApiImageSearchResponse>(
        url.href,
        undefined,
        options?.signal,
      );
      return visualMatches(response)
        .flatMap(mapImageResult)
        .slice(0, options?.maxResults ?? 10);
    } catch (error) {
      throw normalizeError(error, "serpapi");
    }
  }
}

/**
 * Slice size for one call: a positive integer, ten when the caller gave nothing usable.
 * @param maxResults - Requested result count.
 * @returns {number} The number of organic results to hand back.
 */
function resultLimit(maxResults?: number): number {
  if (maxResults === undefined || !Number.isFinite(maxResults)) return 10;
  return Math.max(Math.trunc(maxResults), 1);
}

/**
 * Google's custom date range, `tbs=cdr:1,cd_min:M/D/YYYY,cd_max:M/D/YYYY`. Either bound may be
 * left out and Google keeps the other one, so a lone bound goes out alone.
 * @param options - Search options requested by the caller.
 * @returns {string} The `tbs` query parameter, or nothing without a date bound.
 */
function dateRangeParam(options?: SearchRequestOptions): string {
  const start = options?.startPublishedDate;
  const end = options?.endPublishedDate;
  if (!start && !end) return "";
  const min = start ? `,cd_min:${googleDay(start)}` : "";
  const max = end ? `,cd_max:${googleDay(end)}` : "";
  return `&tbs=${encodeURIComponent(`cdr:1${min}${max}`)}`;
}

/**
 * Google reads the range month first, as `M/D/YYYY`.
 * @param value - ISO 8601 date or datetime.
 * @returns {string} The UTC day as `M/D/YYYY`.
 */
function googleDay(value: string): string {
  const [year, month, day] = utcDay(value).split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

/** Google `start` offset of the page plus the position inside it where the next slice begins. */
interface SerpApiPage {
  readonly start: number;
  readonly offset: number;
}

/**
 * Google pays little attention to `num` and hands a different page for an offset off the ten
 * grid, so a page is walked in slices of `maxResults` and `start` moves only once it is used up.
 * @param continuation - `start`, or `start:offset` for a slice inside the page.
 * @returns {SerpApiPage} The page to request and the slice to return from it.
 */
function serpApiPage(continuation?: string): SerpApiPage {
  if (continuation === undefined) return { start: 0, offset: 0 };
  const match = /^(?<start>0|[1-9]\d*)(?::(?<offset>[1-9]\d*))?$/u.exec(continuation);
  if (!match?.groups) throw new InvalidSearchContinuationError();
  const start = Number(match.groups.start);
  const offset = match.groups.offset === undefined ? 0 : Number(match.groups.offset);
  if (start + offset === 0 || !Number.isSafeInteger(start + offset)) {
    throw new InvalidSearchContinuationError();
  }
  return { start, offset };
}

function serpApiContinuation(
  page: SerpApiPage,
  nextOffset: number,
  pageLength: number,
  next?: string,
): Record<string, string> {
  if (nextOffset < pageLength) return { continuation: `${page.start}:${nextOffset}` };
  return nextPageContinuation(next);
}

function nextPageContinuation(next?: string): Record<string, string> {
  if (next === undefined) return {};
  try {
    const start = new URL(next).searchParams.get("start");
    return start === null ? {} : { continuation: String(serpApiPage(start).start) };
  } catch {
    return {};
  }
}

/**
 * Lens reports an empty page as `error` under a `Success` status, so only a failed search throws.
 * @param response - Google Lens response body.
 * @returns {readonly SerpApiVisualMatch[]} Visual matches, empty when Lens found none.
 */
function visualMatches(response: SerpApiImageSearchResponse): readonly SerpApiVisualMatch[] {
  if (response.error && response.search_metadata?.status !== "Success") {
    throw new WebError(response.error);
  }
  return response.visual_matches ?? [];
}

function mapImageResult(result: SerpApiVisualMatch): ImageSearchResult[] {
  const imageUrl = result.image ?? result.thumbnail;
  if (!result.link || !imageUrl) return [];

  return [
    {
      pageUrl: result.link,
      imageUrl,
      title: result.title ?? result.source ?? "",
      provider: "serpapi",
      source: result.source,
      thumbnailUrl: result.thumbnail,
      imageWidth: result.image_width,
      imageHeight: result.image_height,
      thumbnailWidth: result.thumbnail_width,
      thumbnailHeight: result.thumbnail_height,
      position: result.position,
      exactMatch: result.exact_matches,
    },
  ];
}

function mapResult(result: SerpApiResult): SearchResult {
  return {
    url: result.link,
    title: result.title,
    snippet: result.snippet,
    favicon: result.favicon,
    publishedDate: result.date,
    image: result.thumbnail,
    metadata: {
      position: result.position,
      source: result.source,
      displayedLink: result.displayed_link,
    },
  };
}
