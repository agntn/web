import type { SearchResult, SearchOptions, ProviderConfig } from '../core/types.ts'
import { Provider } from '../core/provider.ts'
import { AuthError, normalizeError } from '../core/errors.ts'
import { register } from '../core/registry.ts'

interface ExaSearchRequest {
  query: string
  type?: string
  numResults?: number
  category?: string
  includeDomains?: string[]
  excludeDomains?: string[]
  startPublishedDate?: string
  endPublishedDate?: string
  contents?: { text: boolean; highlights: boolean }
}

interface ExaResult {
  id: string
  url: string
  title: string | null
  score?: number
  publishedDate?: string
  author?: string
  image?: string
  favicon?: string
  text?: string
  highlights?: string[]
  highlightScores?: number[]
  summary?: string
}

interface ExaSearchResponse {
  requestId: string
  results: ExaResult[]
}

class ExaProvider extends Provider {
  static readonly providerName = 'exa'
  static readonly defaultBaseURL = 'https://api.exa.ai'

  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    super(config, ExaProvider)
    if (!config.apiKey) {
      throw new AuthError('Missing API key for Exa. Set EXA_API_KEY', 'exa')
    }

    this.apiKey = config.apiKey
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const body = {
      query,
      type: 'auto',
      numResults: options?.maxResults,
      category: options?.category,
      includeDomains: options?.includeDomains,
      excludeDomains: options?.excludeDomains,
      startPublishedDate: options?.startPublishedDate,
      endPublishedDate: options?.endPublishedDate,
      contents: { text: true, highlights: true },
    } satisfies ExaSearchRequest

    try {
      const url = `${this.baseURL}/search`
      const headers = { 'x-api-key': this.apiKey }
      const response = await this.client.postJSON<ExaSearchResponse>(url, body, headers)
      return response.results.map(mapResult)
    }
    catch (error) {
      throw normalizeError(error, 'exa')
    }
  }
}

function mapResult(result: ExaResult): SearchResult {
  return {
    url: result.url,
    title: result.title ?? '',
    snippet: result.highlights?.[0]
      ?? (result.text ? result.text.slice(0, 200) : ''),
    score: result.score,
    publishedDate: result.publishedDate,
    author: result.author,
    image: result.image,
    favicon: result.favicon,
    text: result.text,
    highlights: result.highlights,
    summary: result.summary,
  }
}

register(ExaProvider)
