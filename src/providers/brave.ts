import type { SearchResult, SearchOptions, ProviderConfig } from '../core/types.ts'
import { Provider } from '../core/provider.ts'
import { AuthError, normalizeError } from '../core/errors.ts'
import { register } from '../core/registry.ts'

interface BraveResult {
  title: string
  url: string
  description: string
  extra_snippets?: string[]
  age?: string
  language?: string
  family_friendly?: boolean
  meta_url?: {
    favicon?: string
  }
}

interface BraveSearchResponse {
  web?: {
    results: BraveResult[]
  }
}

class BraveProvider extends Provider {
  static readonly providerName = 'brave'
  static readonly defaultBaseURL = 'https://api.search.brave.com'

  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    super(config, BraveProvider)
    if (!config.apiKey) {
      throw new AuthError('Missing API key for Brave Search. Set BRAVE_API_KEY', 'brave')
    }

    this.apiKey = config.apiKey
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    try {
      const url = `${this.baseURL}/res/v1/web/search?q=${encodeURIComponent(query)}&count=${options?.maxResults ?? 10}`
      const headers = { 'X-Subscription-Token': this.apiKey }
      const response = await this.client.getJSON<BraveSearchResponse>(url, headers)
      return (response.web?.results ?? []).map(mapResult)
    }
    catch (error) {
      throw normalizeError(error, 'brave')
    }
  }
}

function mapResult(result: BraveResult): SearchResult {
  return {
    url: result.url,
    title: result.title,
    snippet: result.description,
    favicon: result.meta_url?.favicon,
    text: result.extra_snippets ? result.extra_snippets.join('\n') : undefined,
  }
}

register(BraveProvider)
