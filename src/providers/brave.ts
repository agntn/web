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
  readonly description?: string | null;
  readonly extra_snippets?: readonly string[];
  readonly age?: string;
  readonly page_age?: string | null;
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
      resultFields: ["publishedDate", "favicon", "text"],
    },
  } as const satisfies ProviderCapabilityDetails;
  static readonly searchFilterCapabilities = {
    filters: ["startPublishedDate", "endPublishedDate"],
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
      const url = braveSearchUrl(this.baseURL, query, options ?? {}, offset);
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
  options: SearchRequestOptions,
  offset: number,
): string {
  const offsetParam = offset === 0 ? "" : `&offset=${offset}`;
  return `${baseURL}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${options.maxResults ?? 10}&extra_snippets=true&text_decorations=false${offsetParam}${freshnessParam(options)}`;
}

/**
 * `freshness=YYYY-MM-DDtoYYYY-MM-DD`, one side may be empty; any other spelling Brave ignores.
 * @param options - Search options requested by the caller.
 * @returns {string} The `freshness` query parameter, or nothing without a date bound.
 */
function freshnessParam(options: SearchRequestOptions): string {
  const start = options.startPublishedDate?.slice(0, 10) ?? "";
  const end = options.endPublishedDate?.slice(0, 10) ?? "";
  return start === "" && end === "" ? "" : `&freshness=${start}to${end}`;
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

/**
 * `page_age` is Brave's date for the page, published or last modified, `null` when it has none.
 * @param result - One Brave web result.
 * @returns {SearchResult} Normalized search result.
 */
function mapResult(result: BraveResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: decodeHtml(result.description ?? ""),
    ...(result.page_age ? { publishedDate: result.page_age } : {}),
    favicon: result.meta_url?.favicon,
    text: extraSnippetText(result.extra_snippets),
  };
}

const HTML_ENTITY = /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z]+));/giu;

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

/**
 * Brave escapes `description` like an HTML fragment, `title` and `extra_snippets` come as text.
 * @param text - Description as Brave sends it.
 * @returns {string} The description as text. An unknown entity stays as written.
 */
function decodeHtml(text: string): string {
  return text.replaceAll(
    HTML_ENTITY,
    (
      entity: string,
      hex: string | undefined,
      decimal: string | undefined,
      name: string | undefined,
    ) => {
      if (name !== undefined) return NAMED_ENTITIES.get(name.toLowerCase()) ?? entity;
      const codePoint = Number.parseInt(hex ?? decimal ?? "", hex === undefined ? 10 : 16);
      return isScalarValue(codePoint) ? String.fromCodePoint(codePoint) : entity;
    },
  );
}

/**
 * @param codePoint - Number parsed from a numeric character reference.
 * @returns {boolean} Whether `String.fromCodePoint` can encode it as one well formed character.
 */
function isScalarValue(codePoint: number): boolean {
  return codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
}

function extraSnippetText(snippets?: readonly string[]): string | undefined {
  const parts = snippets?.filter((snippet) => snippet.length > 0) ?? [];
  return parts.length > 0 ? parts.join("\n") : undefined;
}

register(BraveProvider);
