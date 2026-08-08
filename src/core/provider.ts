import { defaultClient, type Client } from './client.ts'
import type { ProviderConfig, ReadOptions, ReadResult, SearchOptions, SearchResult } from './types.ts'
import { InvalidProviderUrlError } from './errors.ts'

export interface ProviderConstructor {
  readonly providerName: string
  readonly defaultBaseURL: string
  new (config: ProviderConfig): Provider
}

export abstract class Provider {
  readonly #name: string
  protected readonly client: Client
  protected readonly baseURL: string

  get name(): string {
    return this.#name
  }

  protected constructor(config: ProviderConfig, provider: Pick<ProviderConstructor, 'providerName' | 'defaultBaseURL'>) {
    this.#name = provider.providerName
    const baseURL = config.baseURL ?? provider.defaultBaseURL
    assertProviderBaseURL(baseURL, this.name)
    this.baseURL = baseURL.replace(/\/+$/, '')
    this.client = defaultClient()
  }
}

export function assertProviderBaseURL(baseURL: string, providerName: string): void {
  let protocol: string
  try {
    protocol = new URL(baseURL).protocol
  }
  catch {
    throw new InvalidProviderUrlError(providerName)
  }

  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new InvalidProviderUrlError(providerName)
  }
}

export interface SearchProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>
}

export interface ReadProvider {
  read(url: string, options?: ReadOptions): Promise<ReadResult>
}

export interface AvailabilityProvider {
  isAvailable(): Promise<boolean>
}

export function isSearchProvider(provider: Provider): provider is Provider & SearchProvider {
  return 'search' in provider && typeof provider.search === 'function'
}

export function isReadProvider(provider: Provider): provider is Provider & ReadProvider {
  return 'read' in provider && typeof provider.read === 'function'
}

export function isAvailabilityProvider(provider: Provider): provider is Provider & AvailabilityProvider {
  return 'isAvailable' in provider && typeof provider.isAvailable === 'function'
}
