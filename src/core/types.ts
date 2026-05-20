export interface SearchResult {
  url: string
  title: string
  snippet: string
  score?: number
  publishedDate?: string
  author?: string
  image?: string
  favicon?: string
  text?: string
  highlights?: string[]
  summary?: string
  metadata?: Record<string, unknown>
}

export interface SearchOptions {
  maxResults?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  startPublishedDate?: string
  endPublishedDate?: string
  category?: string
}

export interface ReadResult {
  url: string
  title?: string
  description?: string
  content: string
  text?: string
  html?: string
  publishedDate?: string
  image?: string
  links?: string[] | Record<string, string>
  images?: string[] | Record<string, string>
  metadata?: Record<string, unknown>
}

export interface ReadOptions {
  format?: 'markdown' | 'text' | 'html'
  maxTokens?: number
  targetSelector?: string
  removeSelector?: string
  timeout?: number
  noCache?: boolean
}

export interface SearchProvider {
  name(): string
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>
  read?(url: string, options?: ReadOptions): Promise<ReadResult>
  /**
   * Optional reachability probe. Used by {@link searchAll} and async detection
   * helpers to skip self-hosted / optional providers whose endpoint is not
   * responding, without failing the fan-out. Providers backed by paid APIs
   * usually omit this and rely on env-var presence as the configured signal.
   * Should resolve quickly (<= ~2s) and never throw.
   */
  isAvailable?(): Promise<boolean>
}

export interface ProviderConfig {
  apiKey?: string
  baseURL?: string
  readBaseURL?: string
}

export type ProviderFactory = (config: ProviderConfig) => SearchProvider

export interface ClientOptions {
  maxRetries?: number
  baseDelay?: number
  timeout?: number
  userAgent?: string
}
