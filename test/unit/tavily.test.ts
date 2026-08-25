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
    userAgent: 'agntn-web/0.0.1',
  })),
}))

import { createSearchProvider, has } from '../../src/core/registry.ts'
import { AuthError } from '../../src/core/errors.ts'
import type { SearchResult } from '../../src/core/types.ts'

// Triggers self-registration of tavily provider
import '../../src/providers/index.ts'

const tavilyResponse = {
  results: [{
    title: 'Test Result',
    url: 'https://example.com',
    content: 'Tavily search result content',
    score: 0.92,
    published_date: '2024-06-15',
    raw_content: 'Full raw content from the page',
  }],
  answer: 'A direct answer from Tavily',
  query: 'test query',
}

describe('tavily provider', () => {
  beforeEach(() => {
    mockPostJSON.mockReset()
    mockPostJSON.mockResolvedValue(tavilyResponse)
    delete process.env.TAVILY_API_KEY
  })

  describe('self-registration', () => {
    it('registers itself on import', () => {
      expect(has('tavily')).toBe(true)
    })
  })

  describe('create', () => {
    it('creates provider with apiKey', () => {
      expect(() => createSearchProvider('tavily', { apiKey: 'test-key' })).not.toThrow()
    })

    it('throws AuthError without apiKey and without env var', () => {
      expect(() => createSearchProvider('tavily', {})).toThrow(AuthError)
    })
  })

  describe('name', () => {
    it('returns tavily', () => {
      const provider = createSearchProvider('tavily', { apiKey: 'test-key' })
      expect(provider.name).toBe('tavily')
    })
  })

  describe('search()', () => {
    it('calls postJSON with correct url and body containing api_key', async () => {
      const provider = createSearchProvider('tavily', { apiKey: 'test-key' })
      await provider.search('test query')

      expect(mockPostJSON).toHaveBeenCalledOnce()
      const [url, body] = mockPostJSON.mock.calls[0]

      expect(url).toBe('https://api.tavily.com/search')
      expect(body).toMatchObject({
        api_key: 'test-key',
        query: 'test query',
        max_results: 10,
        search_depth: 'basic',
      })
    })

    it('maps result fields correctly', async () => {
      const provider = createSearchProvider('tavily', { apiKey: 'test-key' })
      const results: SearchResult[] = await provider.search('test query')

      expect(results).toHaveLength(1)
      const result = results[0]
      expect(result.url).toBe('https://example.com')
      expect(result.title).toBe('Test Result')
      expect(result.snippet).toBe('Tavily search result content')
      expect(result.score).toBe(0.92)
      expect(result.publishedDate).toBe('2024-06-15')
      expect(result.text).toBe('Full raw content from the page')
    })

    it('puts response.answer into first result summary field', async () => {
      const provider = createSearchProvider('tavily', { apiKey: 'test-key' })
      const results: SearchResult[] = await provider.search('test query')

      expect(results[0].summary).toBe('A direct answer from Tavily')
    })

    it('does NOT put answer into non-first results summary', async () => {
      mockPostJSON.mockResolvedValueOnce({
        results: [
          {
            title: 'First Result',
            url: 'https://example.com/1',
            content: 'First content',
            score: 0.95,
          },
          {
            title: 'Second Result',
            url: 'https://example.com/2',
            content: 'Second content',
            score: 0.85,
          },
        ],
        answer: 'A direct answer from Tavily',
        query: 'test query',
      })

      const provider = createSearchProvider('tavily', { apiKey: 'test-key' })
      const results: SearchResult[] = await provider.search('test query')

      expect(results[0].summary).toBe('A direct answer from Tavily')
      expect(results[1].summary).toBeUndefined()
    })

    it('maps maxResults to max_results in body', async () => {
      const provider = createSearchProvider('tavily', { apiKey: 'test-key' })
      await provider.search('test query', { maxResults: 5 })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.max_results).toBe(5)
    })

    it('passes includeDomains to include_domains in body', async () => {
      const provider = createSearchProvider('tavily', { apiKey: 'test-key' })
      await provider.search('test query', { includeDomains: ['github.com', 'stackoverflow.com'] })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.include_domains).toEqual(['github.com', 'stackoverflow.com'])
    })

    it('passes excludeDomains to exclude_domains in body', async () => {
      const provider = createSearchProvider('tavily', { apiKey: 'test-key' })
      await provider.search('test query', { excludeDomains: ['reddit.com'] })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.exclude_domains).toEqual(['reddit.com'])
    })

    it('returns empty array for empty results', async () => {
      mockPostJSON.mockResolvedValueOnce({
        results: [],
        query: 'test query',
      })

      const provider = createSearchProvider('tavily', { apiKey: 'test-key' })
      const results = await provider.search('query')

      expect(results).toEqual([])
    })
  })
})
