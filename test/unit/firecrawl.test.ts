import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPostJSON = vi.fn()

vi.mock('../../src/core/client.ts', () => ({
  Client: vi.fn(),
  defaultClient: vi.fn(() => ({
    postJSON: mockPostJSON,
    getJSON: vi.fn(),
    maxRetries: 5,
    baseDelay: 50,
    timeout: 30000,
    userAgent: 'askweb/0.0.1',
  })),
}))

import { create, has } from '../../src/core/registry.ts'
import { AuthError } from '../../src/core/errors.ts'
import type { SearchResult } from '../../src/core/types.ts'

// Triggers self-registration of firecrawl provider
import '../../src/providers/index.ts'

const firecrawlSearchResponse = {
  success: true,
  data: {
    web: [
      {
        title: 'Firecrawl - Web Scraping API',
        description: 'Turn websites into LLM-ready data.',
        url: 'https://www.firecrawl.dev/',
        position: 1,
      },
      {
        title: 'GitHub - firecrawl/firecrawl',
        description: 'Open source web scraping API.',
        url: 'https://github.com/firecrawl/firecrawl',
        position: 2,
        markdown: '# Firecrawl\n\nOpen source web scraper.',
      },
    ],
  },
}

const firecrawlScrapeResponse = {
  success: true,
  data: {
    markdown: '# Firecrawl\n\nThe web scraping API for AI.',
    html: '<html><body><h1>Firecrawl</h1></body></html>',
    metadata: {
      title: 'Firecrawl',
      description: 'The web scraping API for AI.',
      sourceURL: 'https://www.firecrawl.dev/',
      language: 'en',
      ogImage: 'https://www.firecrawl.dev/og.png',
    },
    links: ['https://www.firecrawl.dev/pricing', 'https://docs.firecrawl.dev'],
  },
}

describe('firecrawl provider', () => {
  beforeEach(() => {
    mockPostJSON.mockReset()
    mockPostJSON.mockResolvedValue(firecrawlSearchResponse)
    delete process.env.FIRECRAWL_API_KEY
  })

  describe('self-registration', () => {
    it('registers itself on import', () => {
      expect(has('firecrawl')).toBe(true)
    })
  })

  describe('create', () => {
    it('creates provider with apiKey', () => {
      expect(() => create('firecrawl', { apiKey: 'test-key' })).not.toThrow()
    })

    it('throws AuthError without apiKey and without env var', () => {
      expect(() => create('firecrawl', {})).toThrow(AuthError)
    })
  })

  describe('name()', () => {
    it('returns firecrawl', () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      expect(provider.name()).toBe('firecrawl')
    })
  })

  describe('search()', () => {
    it('calls postJSON with correct url and Authorization header', async () => {
      const provider = create('firecrawl', { apiKey: 'fc-test-key' })
      await provider.search('test query')

      expect(mockPostJSON).toHaveBeenCalledOnce()
      const [url, body, headers] = mockPostJSON.mock.calls[0]

      expect(url).toBe('https://api.firecrawl.dev/v2/search')
      expect(body).toMatchObject({
        query: 'test query',
        limit: 10,
      })
      expect(headers).toMatchObject({
        'Authorization': 'Bearer fc-test-key',
      })
    })

    it('maps result fields correctly', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      const results: SearchResult[] = await provider.search('test query')

      expect(results).toHaveLength(2)
      expect(results[0].url).toBe('https://www.firecrawl.dev/')
      expect(results[0].title).toBe('Firecrawl - Web Scraping API')
      expect(results[0].snippet).toBe('Turn websites into LLM-ready data.')
    })

    it('maps markdown content to text field', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      const results: SearchResult[] = await provider.search('test query')

      expect(results[1].text).toBe('# Firecrawl\n\nOpen source web scraper.')
      expect(results[0].text).toBeUndefined()
    })

    it('maps maxResults to limit in body', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      await provider.search('test query', { maxResults: 5 })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.limit).toBe(5)
    })

    it('passes includeDomains in body', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      await provider.search('test query', { includeDomains: ['github.com'] })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.includeDomains).toEqual(['github.com'])
    })

    it('passes excludeDomains in body', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      await provider.search('test query', { excludeDomains: ['reddit.com'] })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.excludeDomains).toEqual(['reddit.com'])
    })

    it('sets sources to news when category is news', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      await provider.search('test query', { category: 'news' })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.sources).toEqual(['news'])
    })

    it('combines web and news results when news data is present', async () => {
      mockPostJSON.mockResolvedValueOnce({
        success: true,
        data: {
          web: [{ title: 'Web Result', description: 'web desc', url: 'https://example.com/web' }],
          news: [{ title: 'News Result', description: 'news desc', url: 'https://example.com/news' }],
        },
      })

      const provider = create('firecrawl', { apiKey: 'test-key' })
      const results = await provider.search('test query', { category: 'news' })

      expect(results).toHaveLength(2)
      expect(results[0].title).toBe('Web Result')
      expect(results[1].title).toBe('News Result')
    })

    it('does not set sources when category is not news', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      await provider.search('test query', { category: 'general' })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.sources).toBeUndefined()
    })

    it('returns empty array when web results are missing', async () => {
      mockPostJSON.mockResolvedValueOnce({ success: true, data: {} })

      const provider = create('firecrawl', { apiKey: 'test-key' })
      const results = await provider.search('query')

      expect(results).toEqual([])
    })

    it('throws when success is false', async () => {
      mockPostJSON.mockResolvedValueOnce({ success: false })

      const provider = create('firecrawl', { apiKey: 'test-key' })
      await expect(provider.search('query')).rejects.toThrow()
    })

    it('clamps maxResults to 100', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      await provider.search('test query', { maxResults: 500 })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.limit).toBe(100)
    })
  })

  describe('read()', () => {
    beforeEach(() => {
      mockPostJSON.mockReset()
      mockPostJSON.mockResolvedValue(firecrawlScrapeResponse)
    })

    it('calls postJSON with scrape endpoint and url in body', async () => {
      const provider = create('firecrawl', { apiKey: 'fc-test-key' })
      await provider.read('https://example.com')

      expect(mockPostJSON).toHaveBeenCalledOnce()
      const [url, body, headers] = mockPostJSON.mock.calls[0]

      expect(url).toBe('https://api.firecrawl.dev/v2/scrape')
      expect(body).toMatchObject({
        url: 'https://example.com',
        formats: ['markdown'],
        onlyMainContent: true,
      })
      expect(headers).toMatchObject({
        'Authorization': 'Bearer fc-test-key',
      })
    })

    it('returns read result with content from markdown', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      const result = await provider.read('https://example.com')

      expect(result.url).toBe('https://example.com')
      expect(result.title).toBe('Firecrawl')
      expect(result.description).toBe('The web scraping API for AI.')
      expect(result.content).toBe('# Firecrawl\n\nThe web scraping API for AI.')
      expect(result.html).toBe('<html><body><h1>Firecrawl</h1></body></html>')
      expect(result.links).toEqual(['https://www.firecrawl.dev/pricing', 'https://docs.firecrawl.dev'])
      expect(result.image).toBe('https://www.firecrawl.dev/og.png')
    })

    it('passes format option to formats array', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      await provider.read('https://example.com', { format: 'html' })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.formats).toEqual(['html'])
    })

    it('maps text format to markdown', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      await provider.read('https://example.com', { format: 'text' })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.formats).toEqual(['markdown'])
    })

    it('falls back to html content when markdown is missing', async () => {
      mockPostJSON.mockResolvedValueOnce({
        success: true,
        data: {
          html: '<p>Only HTML</p>',
          metadata: { title: 'Test' },
        },
      })

      const provider = create('firecrawl', { apiKey: 'test-key' })
      const result = await provider.read('https://example.com', { format: 'html' })

      expect(result.content).toBe('<p>Only HTML</p>')
    })

    it('converts timeout from seconds to milliseconds', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      await provider.read('https://example.com', { timeout: 30 })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.timeout).toBe(30000)
    })

    it('sets onlyMainContent to true by default', async () => {
      const provider = create('firecrawl', { apiKey: 'test-key' })
      await provider.read('https://example.com')

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.onlyMainContent).toBe(true)
    })

    it('throws when success is false', async () => {
      mockPostJSON.mockResolvedValueOnce({ success: false })

      const provider = create('firecrawl', { apiKey: 'test-key' })
      await expect(provider.read('https://example.com')).rejects.toThrow()
    })

    it('handles missing data gracefully', async () => {
      mockPostJSON.mockResolvedValueOnce({ success: true, data: {} })

      const provider = create('firecrawl', { apiKey: 'test-key' })
      const result = await provider.read('https://example.com')

      expect(result.content).toBe('')
      expect(result.title).toBeUndefined()
      expect(result.links).toBeUndefined()
    })
  })
})
