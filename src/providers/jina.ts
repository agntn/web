import type { SearchResult, SearchOptions, ReadResult, ReadOptions, SearchProvider, ProviderConfig, ProviderFactory } from '../core/types.ts'
import { defaultClient } from '../core/client.ts'
import type { Client } from '../core/client.ts'
import { AuthError, normalizeError } from '../core/errors.ts'
import { register } from '../core/registry.ts'

interface JinaResult {
  title?: string
  description?: string
  url: string
  content?: string
  text?: string
  html?: string
  publishedTime?: string
  links?: string[] | Record<string, string> | null
  images?: string[] | Record<string, string> | null
  metadata?: Record<string, unknown> | null
  warning?: string
  screenshotUrl?: string
  pageshotUrl?: string
}

interface JinaSearchResponse {
  code: number
  status: number
  data?: JinaResult[] | null
  meta?: Record<string, unknown>
}

interface JinaReadResponse {
  code: number
  status: number
  data?: JinaResult | null
  meta?: Record<string, unknown>
}

const JINA_MAX_RESULTS = 20

class JinaProvider implements SearchProvider {
  private readonly client: Client
  private readonly searchBaseURL: string
  private readonly readBaseURL: string
  private readonly apiKey?: string

  constructor(config: ProviderConfig) {
    this.client = defaultClient()
    this.searchBaseURL = (config.baseURL ?? 'https://s.jina.ai').replace(/\/+$/, '')
    this.readBaseURL = (config.readBaseURL ?? deriveReadBaseURL(this.searchBaseURL)).replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  name(): string {
    return 'jina'
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new AuthError('Missing API key for Jina. Set JINA_API_KEY', 'jina')
    }

    try {
      const params = new URLSearchParams({
        q: query,
        count: String(clampMaxResults(options?.maxResults ?? 10)),
      })

      if (isJinaSearchType(options?.category)) {
        params.set('type', options.category)
      }

      for (const domain of options?.includeDomains ?? []) {
        params.append('site', domain)
      }

      const url = `${this.searchBaseURL}/search?${params.toString()}`
      const headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
      }
      const response = await this.client.getJSON<JinaSearchResponse>(url, headers)
      return (response.data ?? []).map(mapSearchResult)
    }
    catch (error) {
      throw normalizeError(error, 'jina')
    }
  }

  async read(url: string, options?: ReadOptions): Promise<ReadResult> {
    try {
      const requestUrl = `${this.readBaseURL}/${encodeURIComponent(url)}`
      const response = await this.client.getJSON<JinaReadResponse>(requestUrl, readHeaders(this.apiKey, options))
      return mapReadResult(response.data ?? { url, content: '' })
    }
    catch (error) {
      throw normalizeError(error, 'jina')
    }
  }
}

function deriveReadBaseURL(searchBaseURL: string): string {
  return searchBaseURL === 'https://s.jina.ai' ? 'https://r.jina.ai' : searchBaseURL
}

function readHeaders(apiKey: string | undefined, options: ReadOptions | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (options?.format) headers['X-Respond-With'] = options.format
  if (options?.maxTokens !== undefined) headers['X-Max-Tokens'] = String(options.maxTokens)
  if (options?.targetSelector) headers['X-Target-Selector'] = options.targetSelector
  if (options?.removeSelector) headers['X-Remove-Selector'] = options.removeSelector
  if (options?.timeout !== undefined) headers['X-Timeout'] = String(options.timeout)
  if (options?.noCache) headers['X-No-Cache'] = 'true'

  return headers
}

function clampMaxResults(maxResults: number): number {
  return Math.min(Math.max(maxResults, 1), JINA_MAX_RESULTS)
}

function isJinaSearchType(category: string | undefined): category is 'web' | 'images' | 'news' {
  return category === 'web' || category === 'images' || category === 'news'
}

function mapSearchResult(result: JinaResult): SearchResult {
  return {
    url: result.url,
    title: result.title ?? '',
    snippet: result.description ?? snippetFrom(result.content) ?? snippetFrom(result.text) ?? '',
    publishedDate: result.publishedTime,
    text: result.content ?? result.text,
    image: firstImage(result.images),
    metadata: resultMetadata(result),
  }
}

function mapReadResult(result: JinaResult): ReadResult {
  return {
    url: result.url,
    title: result.title,
    description: result.description,
    content: result.content ?? result.text ?? result.html ?? '',
    text: result.text,
    html: result.html,
    publishedDate: result.publishedTime,
    image: firstImage(result.images),
    links: result.links ?? undefined,
    images: result.images ?? undefined,
    metadata: resultMetadata(result),
  }
}

function snippetFrom(text: string | undefined): string | undefined {
  return text ? text.slice(0, 200) : undefined
}

function firstImage(images: JinaResult['images']): string | undefined {
  if (Array.isArray(images)) {
    return images.find(isNonEmptyString)
  }
  if (images && typeof images === 'object') {
    return Object.values(images).find(isNonEmptyString)
  }
  return undefined
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function resultMetadata(result: JinaResult): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = result.metadata ? { ...result.metadata } : {}

  if (result.warning) metadata.warning = result.warning
  if (result.screenshotUrl) metadata.screenshotUrl = result.screenshotUrl
  if (result.pageshotUrl) metadata.pageshotUrl = result.pageshotUrl

  return Object.keys(metadata).length > 0 ? metadata : undefined
}

const factory: ProviderFactory = (config) => new JinaProvider(config)

register('jina', 'https://s.jina.ai', factory)
