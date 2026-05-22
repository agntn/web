import type { SearchResult, SearchOptions, SearchProvider, ProviderConfig, ProviderFactory } from '../core/types.ts'
import { defaultClient } from '../core/client.ts'
import type { Client } from '../core/client.ts'
import { AskwebError, AuthError, RateLimitError, normalizeError } from '../core/errors.ts'
import { register } from '../core/registry.ts'

interface SerpBaseSearchRequest {
  q: string
  hl?: string
  gl?: string
  page?: number
}

interface SerpBaseResult {
  rank?: number
  position?: number
  title?: string
  link?: string
  url?: string
  source_url?: string
  display_url?: string
  display_link?: string
  snippet?: string
  date?: string
  published_at?: string
  icon?: string
  image_url?: string
  thumbnail_url?: string
  thumbnail?: string
  source?: string
  domain?: string
  time?: string
  duration?: string
}

interface SerpBaseSearchResponse {
  status: number
  error?: string
  request_id: string
  elapsed_ms: number
  credits_charged: number
  search_type: string
  query?: string
  organic?: SerpBaseResult[]
  images?: SerpBaseResult[]
  news?: SerpBaseResult[]
  videos?: SerpBaseResult[]
}

const SERPBASE_MAX_RESULTS = 20

class SerpBaseProvider implements SearchProvider {
  private readonly client: Client
  private readonly baseURL: string
  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError('Missing API key for SerpBase. Set SERPBASE_API_KEY', 'serpbase')
    }

    this.client = defaultClient()
    this.baseURL = config.baseURL ?? 'https://api.serpbase.dev'
    this.apiKey = config.apiKey
  }

  name(): string {
    return 'serpbase'
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const endpoint = endpointForCategory(options?.category)
    const body = {
      q: query,
      hl: 'en',
      gl: 'us',
      page: 1,
    } satisfies SerpBaseSearchRequest

    try {
      const url = `${this.baseURL}${endpoint}`
      const headers = { 'X-API-Key': this.apiKey }
      const response = await this.client.postJSON<SerpBaseSearchResponse>(url, body, headers)
      assertSerpBaseSuccess(response)
      return resultsForResponse(response)
        .slice(0, clampMaxResults(options?.maxResults ?? 10))
        .map(result => mapResult(result, response))
    }
    catch (error) {
      throw normalizeError(error, 'serpbase')
    }
  }
}

function endpointForCategory(category: string | undefined): '/google/search' | '/google/images' | '/google/news' | '/google/videos' {
  switch (category) {
    case 'images':
    case 'image':
      return '/google/images'
    case 'news':
      return '/google/news'
    case 'videos':
    case 'video':
      return '/google/videos'
    default:
      return '/google/search'
  }
}

function clampMaxResults(maxResults: number): number {
  return Math.min(Math.max(maxResults, 1), SERPBASE_MAX_RESULTS)
}

function assertSerpBaseSuccess(response: SerpBaseSearchResponse): void {
  if (response.status === 0) return

  const message = response.error ?? `SerpBase API error: status=${response.status}`
  switch (response.status) {
    case 1001:
      throw new AuthError(`Authentication failed: ${message}`, 'serpbase')
    case 1029:
      throw new RateLimitError(60)
    case 1020:
      throw new AskwebError(`SerpBase insufficient credits: ${message}`)
    default:
      throw new AskwebError(`SerpBase API error ${response.status}: ${message}`)
  }
}

function resultsForResponse(response: SerpBaseSearchResponse): SerpBaseResult[] {
  switch (response.search_type) {
    case 'images':
      return response.images ?? []
    case 'news':
      return response.news ?? []
    case 'videos':
      return response.videos ?? []
    default:
      return response.organic ?? []
  }
}

function mapResult(result: SerpBaseResult, response: SerpBaseSearchResponse): SearchResult {
  const url = result.url ?? result.link ?? result.source_url ?? result.image_url ?? ''
  return {
    url,
    title: result.title ?? result.source ?? result.domain ?? '',
    snippet: result.snippet ?? '',
    publishedDate: result.published_at ?? result.date ?? result.time,
    image: result.image_url ?? result.thumbnail_url ?? result.thumbnail,
    favicon: result.icon,
    metadata: {
      position: result.position ?? result.rank,
      rank: result.rank,
      displayUrl: result.display_url,
      displayLink: result.display_link,
      sourceUrl: result.source_url,
      source: result.source,
      domain: result.domain,
      duration: result.duration,
      searchType: response.search_type,
      requestId: response.request_id,
      elapsedMs: response.elapsed_ms,
      creditsCharged: response.credits_charged,
    },
  }
}

const factory: ProviderFactory = (config) => new SerpBaseProvider(config)

register('serpbase', 'https://api.serpbase.dev', factory)
