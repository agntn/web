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
  links?: string[]
  images?: string[]
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

export interface ProviderConfig {
  apiKey?: string
  baseURL?: string
  readBaseURL?: string
}

export interface ClientOptions {
  maxRetries?: number
  baseDelay?: number
  timeout?: number
  userAgent?: string
}
