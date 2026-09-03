import "./providers/index.ts";

export { version, runtimeInfo } from "./version.ts";
export type { RuntimeInfo } from "./version.ts";

export { builtinProviders, type WebSearchProviderName } from "./core/providers.ts";

export type {
  SearchResult,
  SearchResponse,
  SearchOptions,
  SearchRequestOptions,
  SearchFilterName,
  SearchFilterCapabilities,
  ImageSearchResult,
  ImageSearchOptions,
  ImageSearchRequestOptions,
  ReadResult,
  ReadOptions,
  ProviderConfig,
  ClientOptions,
} from "./core/types.ts";
export {
  Provider,
  isSearchProvider,
  isDetailedSearchProvider,
  isImageSearchProvider,
  isReadProvider,
  isAvailabilityProvider,
} from "./core/provider.ts";
export type {
  ProviderConstructor,
  SearchProvider,
  DetailedSearchProvider,
  ImageSearchProvider,
  ReadProvider,
  AvailabilityProvider,
} from "./core/provider.ts";

export {
  WebError,
  HTTPError,
  AuthError,
  RateLimitError,
  UnknownProviderError,
  InvalidProviderUrlError,
  SearchNotSupportedError,
  ImageSearchNotSupportedError,
  NoProviderConfiguredError,
  NoProviderAvailableError,
  EmptyQueryError,
  EmptyImageUrlError,
  InvalidImageUrlError,
  EmptyUrlError,
  ReadNotSupportedError,
  InvalidDateFilterError,
  normalizeError,
  validateDateFilters,
} from "./core/errors.ts";

export { Client, defaultClient } from "./core/client.ts";

export {
  register,
  create,
  createSearchProvider,
  createImageSearchProvider,
  createReadProvider,
  providers,
  has,
  getSearchFilterCapabilities,
} from "./core/registry.ts";

export {
  searchAll,
  searchAllDetailed,
  searchProviderDetailed,
  searchWithFallback,
} from "./core/all.ts";
export type {
  SearchAllOptions,
  SearchAllEvidence,
  SearchAllResult,
  SearchAllResponse,
  SearchProviderMetadata,
  SearchProviderResult,
  SearchWithFallbackResult,
  ProviderError,
} from "./core/all.ts";
export type { SearchFilterReport } from "./core/search-filters.ts";
export { ProviderFallbackError } from "./core/fallback.ts";
export type { FallbackOperation, ProviderFailure } from "./core/fallback.ts";

export { imageSearchProviderNames, searchByImage } from "./core/image.ts";
export type { ImageSearchProviderName, ImageSearchByUrlOptions } from "./core/image.ts";

export { readProviderNames, readUrl, readUrlDetailed } from "./core/read.ts";
export type { ReadProviderName, ReadUrlOptions, ReadUrlDetailedResult } from "./core/read.ts";

export { MAX_BATCH_ITEMS, searchBatch, readBatch, readBatchDetailed } from "./core/batch.ts";
export type {
  SearchBatchOptions,
  SearchBatchItem,
  ReadBatchItem,
  ReadBatchDetailedItem,
} from "./core/batch.ts";

export {
  resolveDefaultProvider,
  resolveDefaultProviderAsync,
  detectAvailableProviders,
  detectAvailableProvidersAsync,
  listProviders,
  listProvidersAsync,
} from "./core/resolve.ts";
export type { ProviderStatus } from "./core/resolve.ts";
