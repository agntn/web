import type { SearchResult, SearchOptions, ProviderConfig } from '../core/types.ts'
import { Provider } from '../core/provider.ts'
import { AuthError, normalizeError } from '../core/errors.ts'
import { register } from '../core/registry.ts'

interface SerpApiResult {
  position: number
  title: string
  link: string
  snippet: string
  displayed_link?: string
  favicon?: string
  date?: string
  source?: string
  thumbnail?: string
}

interface SerpApiSearchResponse {
  search_metadata: {
    id: string
    status: string
  }
  organic_results?: SerpApiResult[]
}

class SerpApiProvider extends Provider {
  static readonly providerName = 'serpapi'
  static readonly defaultBaseURL = 'https://serpapi.com'

  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    super(config, SerpApiProvider)
    if (!config.apiKey) {
      throw new AuthError('Missing API key for SerpAPI. Set SERPAPI_API_KEY', 'serpapi')
    }

    this.apiKey = config.apiKey
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    try {
      const url = `${this.baseURL}/search?engine=google&q=${encodeURIComponent(query)}&api_key=${this.apiKey}&num=${options?.maxResults ?? 10}`
      const response = await this.client.getJSON<SerpApiSearchResponse>(url)
      return (response.organic_results ?? []).map(mapResult)
    }
    catch (error) {
      throw normalizeError(error, 'serpapi')
    }
  }
}

function mapResult(result: SerpApiResult): SearchResult {
  return {
    url: result.link,
    title: result.title,
    snippet: result.snippet,
    favicon: result.favicon,
    publishedDate: result.date,
    image: result.thumbnail,
    metadata: {
      position: result.position,
      source: result.source,
      displayedLink: result.displayed_link,
    },
  }
}

register(SerpApiProvider)
