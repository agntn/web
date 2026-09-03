export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  score?: number;
  publishedDate?: string;
  author?: string;
  image?: string;
  favicon?: string;
  text?: string;
  highlights?: string[];
  summary?: string;
  metadata?: Record<string, unknown>;
}

export type ReadonlySearchResult = Readonly<Omit<SearchResult, "highlights" | "metadata">> & {
  readonly highlights?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export interface SearchResponse {
  results: SearchResult[];
  metadata?: Record<string, unknown>;
}

/** Normalized state of one provider's search sequence. */
export type SearchPagination =
  | { readonly status: "next"; readonly continuation: string }
  | { readonly status: "unknown"; readonly continuation: string }
  | { readonly status: "end" }
  | { readonly status: "unsupported" };

/** Controls shared by every network-backed operation. */
export interface ExecutionOptions {
  /** Cancels in-flight provider requests. */
  readonly signal?: Readonly<AbortSignal>;
  /** Absolute Unix timestamp in milliseconds at which the operation is cancelled. */
  readonly deadline?: number;
  /** Maximum requests started concurrently by fan-out and batch helpers. */
  readonly concurrency?: number;
}

export interface SearchOptions extends ExecutionOptions {
  maxResults?: number;
  highlights?: boolean;
  summary?: boolean;
  fullText?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  sources?: string[];
  categories?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  category?: string;
}

export type SearchRequestOptions = Readonly<
  Omit<SearchOptions, "includeDomains" | "excludeDomains" | "sources" | "categories">
> & {
  readonly includeDomains?: readonly string[];
  readonly excludeDomains?: readonly string[];
  readonly sources?: readonly string[];
  readonly categories?: readonly string[];
};

/** Detailed search options with an opaque token for one provider and query. */
export type SearchPageOptions = SearchRequestOptions & {
  readonly continuation?: string;
};

export const searchFilterNames = [
  "includeDomains",
  "excludeDomains",
  "sources",
  "categories",
  "category",
  "startPublishedDate",
  "endPublishedDate",
] as const;

export type SearchFilterName = (typeof searchFilterNames)[number];

/** Search filters a provider forwards, including any accepted singular category values. */
export interface SearchFilterCapabilities {
  readonly filters: readonly SearchFilterName[];
  readonly categories?: readonly string[];
}

/** One public page and image returned by reverse image search. */
export interface ImageSearchResult {
  pageUrl: string;
  imageUrl: string;
  title: string;
  provider: string;
  source?: string;
  thumbnailUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  position?: number;
  exactMatch?: boolean;
}

/** Options shared by reverse image search providers. */
export interface ImageSearchOptions extends ExecutionOptions {
  maxResults?: number;
}

/** Immutable reverse image search options accepted by providers. */
export type ImageSearchRequestOptions = Readonly<ImageSearchOptions>;

export interface ReadResult {
  url: string;
  title?: string;
  description?: string;
  content: string;
  text?: string;
  html?: string;
  publishedDate?: string;
  image?: string;
  links?: string[];
  images?: string[];
  metadata?: Record<string, unknown>;
  truncated?: boolean;
  continuation?: string;
}

export interface ReadOptions extends ExecutionOptions {
  format?: "markdown" | "text" | "html";
  maxTokens?: number;
  targetSelector?: string;
  removeSelector?: string;
  timeout?: number;
  noCache?: boolean;
}

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  readBaseURL?: string;
}

export interface ClientOptions {
  readonly maxRetries?: number;
  baseDelay?: number;
  timeout?: number;
  userAgent?: string;
}
