import type { SearchResult, SearchOptions, ReadResult, ReadOptions, SearchProvider, ProviderConfig, ProviderFactory } from '../core/types.ts'
import { defaultClient } from '../core/client.ts'
import type { Client } from '../core/client.ts'
import { AuthError, normalizeError } from '../core/errors.ts'
import { register } from '../core/registry.ts'

interface FirecrawlWebResult {
  title: string
  description: string
  url: string
  markdown?: string
  html?: string
  links?: string[]
  position?: number
  metadata?: {
    title?: string
    description?: string
    sourceURL?: string
    statusCode?: number
    error?: string
  }
}

interface FirecrawlSearchResponse {
  success: boolean
  data?: {
    web?: FirecrawlWebResult[]
    news?: FirecrawlWebResult[]
    warning?: string
  }
}

interface FirecrawlScrapeResponse {
  success: boolean
  data?: {
    markdown?: string
    html?: string
    metadata?: {
      title?: string
      description?: string
      sourceURL?: string
      language?: string
      keywords?: string
      ogImage?: string
      [key: string]: unknown
    }
    links?: string[]
    warning?: string
  }
}

const FIRECRAWL_MAX_RESULTS = 100

function clampMaxResults(max?: number): number {
  return Math.min(Math.max(max ?? 10, 1), FIRECRAWL_MAX_RESULTS)
}

class FirecrawlProvider implements SearchProvider {
  private readonly client: Client
  private readonly baseURL: string
  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError('Missing API key for Firecrawl. Set FIRECRAWL_API_KEY', 'firecrawl')
    }

    this.client = defaultClient()
    this.baseURL = (config.baseURL ?? 'https://api.firecrawl.dev').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  name(): string {
    return 'firecrawl'
  }

  private authHeaders(): Record<string, string> {
    return { 'Authorization': `Bearer ${this.apiKey}` }
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      limit: clampMaxResults(options?.maxResults),
    }

    if (options?.includeDomains?.length) {
      body.includeDomains = options.includeDomains
    }
    if (options?.excludeDomains?.length) {
      body.excludeDomains = options.excludeDomains
    }
    if (options?.category === 'news') {
      body.sources = ['news']
    }

    try {
      const url = `${this.baseURL}/v2/search`
      const response = await this.client.postJSON<FirecrawlSearchResponse>(url, body, this.authHeaders())

      if (!response.success) {
        throw new Error('Firecrawl search failed')
      }

      const web = response.data?.web ?? []
      const news = response.data?.news ?? []
      const allResults = news.length > 0 ? [...web, ...news] : web
      return allResults.slice(0, clampMaxResults(options?.maxResults)).map(mapSearchResult)
    }
    catch (error) {
      throw normalizeError(error, 'firecrawl')
    }
  }

  async read(url: string, options?: ReadOptions): Promise<ReadResult> {
    const body: Record<string, unknown> = {
      url,
      formats: [normalizeFormat(options?.format)],
      onlyMainContent: true,
    }

    if (options?.timeout) {
      body.timeout = options.timeout * 1000
    }

    try {
      const endpoint = `${this.baseURL}/v2/scrape`
      const response = await this.client.postJSON<FirecrawlScrapeResponse>(endpoint, body, this.authHeaders())

      if (!response.success) {
        throw new Error('Firecrawl scrape failed')
      }

      const data = response.data ?? {}
      return {
        url,
        title: data.metadata?.title,
        description: data.metadata?.description,
        content: data.markdown ?? data.html ?? '',
        html: data.html,
        links: data.links,
        image: data.metadata?.ogImage,
        metadata: data.metadata,
      }
    }
    catch (error) {
      throw normalizeError(error, 'firecrawl')
    }
  }
}

function normalizeFormat(format?: string): 'markdown' | 'html' {
  if (format === 'html') return 'html'
  return 'markdown'
}

function mapSearchResult(result: FirecrawlWebResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.description,
    text: result.markdown,
  }
}

const factory: ProviderFactory = (config) => new FirecrawlProvider(config)

register('firecrawl', 'https://api.firecrawl.dev', factory)
