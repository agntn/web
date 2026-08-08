import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetJSON = vi.fn()

vi.mock('../../src/core/client.ts', () => ({
  Client: vi.fn(),
  defaultClient: vi.fn(() => ({
    getJSON: mockGetJSON,
    postJSON: vi.fn(),
    maxRetries: 5,
    baseDelay: 50,
    timeout: 30000,
    userAgent: 'askweb/0.0.1',
  })),
}))

import { createSearchProvider, has } from '../../src/core/registry.ts'
import { AuthError } from '../../src/core/errors.ts'
import type { SearchResult } from '../../src/core/types.ts'

// Triggers self-registration of brave provider
import '../../src/providers/index.ts'

const braveResponse = {
  web: {
    results: [{
      title: 'Test Result',
      url: 'https://example.com',
      description: 'A test description from Brave search',
      extra_snippets: ['Additional context snippet'],
      meta_url: {
        favicon: 'https://example.com/favicon.ico',
      },
    }],
  },
}

describe('brave provider', () => {
  beforeEach(() => {
    mockGetJSON.mockReset()
    mockGetJSON.mockResolvedValue(braveResponse)
    delete process.env.BRAVE_API_KEY
  })

  describe('self-registration', () => {
    it('registers itself on import', () => {
      expect(has('brave')).toBe(true)
    })
  })

  describe('create', () => {
    it('creates provider with apiKey', () => {
      expect(() => createSearchProvider('brave', { apiKey: 'test-key' })).not.toThrow()
    })

    it('throws AuthError without apiKey and without env var', () => {
      expect(() => createSearchProvider('brave', {})).toThrow(AuthError)
    })
  })

  describe('name', () => {
    it('returns brave', () => {
      const provider = createSearchProvider('brave', { apiKey: 'test-key' })
      expect(provider.name).toBe('brave')
    })
  })

  describe('search()', () => {
    it('calls getJSON with correct url and headers', async () => {
      const provider = createSearchProvider('brave', { apiKey: 'test-key' })
      await provider.search('test query')

      expect(mockGetJSON).toHaveBeenCalledOnce()
      const [url, headers] = mockGetJSON.mock.calls[0]

      expect(url).toContain('https://api.search.brave.com/res/v1/web/search')
      expect(url).toContain('q=test%20query')
      expect(headers).toEqual({ 'X-Subscription-Token': 'test-key' })
    })

    it('normalizes a trailing slash in custom baseURL', async () => {
      const provider = createSearchProvider('brave', {
        apiKey: 'test-key',
        baseURL: 'https://custom.example.com/',
      })
      await provider.search('test query')

      const [url] = mockGetJSON.mock.calls[0]
      expect(url).toContain('https://custom.example.com/res/v1/web/search')
    })

    it('maps result fields correctly', async () => {
      const provider = createSearchProvider('brave', { apiKey: 'test-key' })
      const results: SearchResult[] = await provider.search('test query')

      expect(results).toHaveLength(1)
      const result = results[0]
      expect(result.url).toBe('https://example.com')
      expect(result.title).toBe('Test Result')
      expect(result.snippet).toBe('A test description from Brave search')
      expect(result.text).toBe('Additional context snippet')
    })

    it('maps maxResults to count query param', async () => {
      const provider = createSearchProvider('brave', { apiKey: 'test-key' })
      await provider.search('test query', { maxResults: 5 })

      const [url] = mockGetJSON.mock.calls[0]
      expect(url).toContain('count=5')
    })

    it('returns empty array when web.results is undefined', async () => {
      mockGetJSON.mockResolvedValueOnce({
        web: undefined,
      })

      const provider = createSearchProvider('brave', { apiKey: 'test-key' })
      const results = await provider.search('query')

      expect(results).toEqual([])
    })

    it('joins extra_snippets with newline for text field', async () => {
      mockGetJSON.mockResolvedValueOnce({
        web: {
          results: [{
            title: 'Test',
            url: 'https://example.com',
            description: 'Description',
            extra_snippets: ['Snippet 1', 'Snippet 2', 'Snippet 3'],
            meta_url: {
              favicon: 'https://example.com/favicon.ico',
            },
          }],
        },
      })

      const provider = createSearchProvider('brave', { apiKey: 'test-key' })
      const results = await provider.search('query')

      expect(results[0].text).toBe('Snippet 1\nSnippet 2\nSnippet 3')
    })
  })
})
