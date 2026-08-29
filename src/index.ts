import "./providers/index.ts";

export { version } from "./version.ts";

export { builtinProviders, type WebSearchProviderName } from "./core/providers.ts";

export type {
  SearchResult,
  SearchResponse,
  SearchOptions,
  SearchRequestOptions,
  ReadResult,
  ReadOptions,
  ProviderConfig,
  ClientOptions,
} from "./core/types.ts";
export {
  Provider,
  isSearchProvider,
  isDetailedSearchProvider,
  isReadProvider,
  isAvailabilityProvider,
} from "./core/provider.ts";
export type {
  ProviderConstructor,
  SearchProvider,
  DetailedSearchProvider,
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
  NoProviderConfiguredError,
  NoProviderAvailableError,
  EmptyQueryError,
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
  createReadProvider,
  providers,
  has,
} from "./core/registry.ts";

export { searchAll, searchAllDetailed, searchWithFallback } from "./core/all.ts";
export type {
  SearchAllOptions,
  SearchAllResult,
  SearchAllResponse,
  SearchWithFallbackResult,
  ProviderError,
} from "./core/all.ts";

export { readProviderNames, readUrl } from "./core/read.ts";
export type { ReadProviderName, ReadUrlOptions } from "./core/read.ts";

export { MAX_BATCH_ITEMS, searchBatch, readBatch } from "./core/batch.ts";
export type { SearchBatchOptions, SearchBatchItem, ReadBatchItem } from "./core/batch.ts";

export {
  resolveDefaultProvider,
  resolveDefaultProviderAsync,
  detectAvailableProviders,
  detectAvailableProvidersAsync,
  listProviders,
  listProvidersAsync,
} from "./core/resolve.ts";
export type { ProviderStatus } from "./core/resolve.ts";
