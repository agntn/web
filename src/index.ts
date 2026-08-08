import './providers/index.ts'

export { version } from './version.ts'

export { builtinProviders, type WebSearchProviderName } from './core/providers.ts'

export type { SearchResult, SearchOptions, ReadResult, ReadOptions, ProviderConfig, ClientOptions } from './core/types.ts'
export { Provider, isSearchProvider, isReadProvider, isAvailabilityProvider } from './core/provider.ts'
export type { ProviderConstructor, SearchProvider, ReadProvider, AvailabilityProvider } from './core/provider.ts'

export { AskwebError, HTTPError, AuthError, RateLimitError, UnknownProviderError, InvalidProviderUrlError, SearchNotSupportedError, NoProviderConfiguredError, NoProviderAvailableError, EmptyQueryError, EmptyUrlError, ReadNotSupportedError, InvalidDateFilterError, normalizeError, validateDateFilters } from './core/errors.ts'

export { Client, defaultClient } from './core/client.ts'

export { register, create, createSearchProvider, createReadProvider, providers, has } from './core/registry.ts'

export { searchAll, searchAllDetailed } from './core/all.ts'
export type { SearchAllOptions, SearchAllResult, SearchAllResponse, ProviderError } from './core/all.ts'

export { readProviderNames, readUrl } from './core/read.ts'
export type { ReadProviderName, ReadUrlOptions } from './core/read.ts'

export {
  resolveDefaultProvider,
  resolveDefaultProviderAsync,
  detectAvailableProviders,
  detectAvailableProvidersAsync,
  listProviders,
  listProvidersAsync,
} from './core/resolve.ts'
export type { ProviderStatus } from './core/resolve.ts'
