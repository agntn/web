import './providers/index.ts'

export { version } from './version.ts'

export { builtinProviders, type WebSearchProviderName } from './core/providers.ts'

export type { SearchResult, SearchOptions, ReadResult, ReadOptions, SearchProvider, ProviderConfig, ProviderFactory, ClientOptions } from './core/types.ts'

export { AskwebError, HTTPError, AuthError, RateLimitError, UnknownProviderError, NoProviderConfiguredError, NoProviderAvailableError, EmptyQueryError, EmptyUrlError, ReadNotSupportedError, InvalidDateFilterError, normalizeError, validateDateFilters } from './core/errors.ts'

export { Client, defaultClient } from './core/client.ts'

export { register, create, providers, has } from './core/registry.ts'

export { searchAll, searchAllDetailed } from './core/all.ts'
export type { SearchAllOptions, SearchAllResult, SearchAllResponse, ProviderError } from './core/all.ts'

export { readUrl } from './core/read.ts'
export type { ReadUrlOptions } from './core/read.ts'

export {
  resolveDefaultProvider,
  resolveDefaultProviderAsync,
  detectAvailableProviders,
  detectAvailableProvidersAsync,
  listProviders,
  listProvidersAsync,
} from './core/resolve.ts'
export type { ProviderStatus } from './core/resolve.ts'
