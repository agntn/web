import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetJSON = vi.fn()

vi.mock('../../src/core/client.ts', () => ({
  Client: vi.fn(),
  defaultClient: vi.fn(() => ({
    getJSON: mockGetJSON,
    postJSON: vi.fn(),
    maxRetries: 5,
    baseDelay: 50,
    timeout: 30000,
    userAgent: 'agntn-web/0.0.1',
  })),
}))

import { createSearchProvider, has } from '../../src/core/registry.ts'
import type { SearchResult } from '../../src/core/types.ts'

// Triggers self-registration of searxng provider
import '../../src/providers/index.ts'

const searxngResponse = {
  results: [{
    title: 'Test Result',
    url: 'https://example.com',
    content: 'SearXNG search result content',
    engine: 'google',
    engines: ['google', 'duckduckgo'],
    score: 8.5,
    category: 'general',
    publishedDate: '2024-03-01',
    img_src: 'https://example.com/image.png',
    thumbnail: 'https://example.com/thumb.png',
  }],
  number_of_results: 100,
  query: 'test query',
}

describe('searxng provider', () => {
  beforeEach(() => {
    mockGetJSON.mockReset()
    mockGetJSON.mockResolvedValue(searxngResponse)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('self-registration', () => {
    it('registers itself on import', () => {
      expect(has('searxng')).toBe(true)
    })
  })

  describe('create', () => {
    it('creates provider without apiKey', () => {
      expect(() => createSearchProvider('searxng', {})).not.toThrow()
    })

    it('creates provider with apiKey (ignores it)', () => {
      expect(() => createSearchProvider('searxng', { apiKey: 'test-key' })).not.toThrow()
    })
  })

  describe('name', () => {
    it('returns searxng', () => {
      const provider = createSearchProvider('searxng', {})
      expect(provider.name).toBe('searxng')
    })
  })

  describe('isAvailable()', () => {
    it('aborts the reachability probe within the provider contract', async () => {
      vi.useFakeTimers()
      const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      const provider = createSearchProvider('searxng', {})
      const availability = provider.isAvailable?.()

      await vi.advanceTimersByTimeAsync(1999)
      expect(fetchMock).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      await expect(availability).resolves.toBe(false)
    })
  })

  describe('search()', () => {
    it('calls getJSON with correct URL containing q, format, and pageno', async () => {
      const provider = createSearchProvider('searxng', {})
      await provider.search('test query')

      expect(mockGetJSON).toHaveBeenCalledOnce()
      const [url] = mockGetJSON.mock.calls[0]

      expect(url).toContain('http://localhost:8080/search?')
      expect(url).toContain('q=test+query')
      expect(url).toContain('format=json')
      expect(url).toContain('pageno=1')
    })

    it('maps result fields correctly', async () => {
      const provider = createSearchProvider('searxng', {})
      const results: SearchResult[] = await provider.search('test query')

      expect(results).toHaveLength(1)
      const result = results[0]
      expect(result.url).toBe('https://example.com')
      expect(result.title).toBe('Test Result')
      expect(result.snippet).toBe('SearXNG search result content')
      expect(result.score).toBe(8.5)
      expect(result.publishedDate).toBe('2024-03-01')
      expect(result.image).toBe('https://example.com/image.png')
    })

    it('maps metadata correctly', async () => {
      const provider = createSearchProvider('searxng', {})
      const results: SearchResult[] = await provider.search('test query')

      expect(results).toHaveLength(1)
      const result = results[0]
      expect(result.metadata?.engine).toBe('google')
      expect(result.metadata?.engines).toEqual(['google', 'duckduckgo'])
      expect(result.metadata?.category).toBe('general')
    })

    it('slices results to maxResults when specified', async () => {
      mockGetJSON.mockResolvedValueOnce({
        results: [
          { ...searxngResponse.results[0], title: 'Result 1' },
          { ...searxngResponse.results[0], title: 'Result 2' },
          { ...searxngResponse.results[0], title: 'Result 3' },
        ],
        number_of_results: 3,
        query: 'test query',
      })

      const provider = createSearchProvider('searxng', {})
      const results = await provider.search('test query', { maxResults: 2 })

      expect(results).toHaveLength(2)
    })

    it('adds categories param when category option is provided', async () => {
      const provider = createSearchProvider('searxng', {})
      await provider.search('test query', { category: 'news' })

      const [url] = mockGetJSON.mock.calls[0]
      expect(url).toContain('categories=news')
    })

    it('returns empty array for empty results', async () => {
      mockGetJSON.mockResolvedValueOnce({
        results: [],
        number_of_results: 0,
        query: 'test query',
      })

      const provider = createSearchProvider('searxng', {})
      const results = await provider.search('query')

      expect(results).toEqual([])
    })

    it('uses thumbnail as fallback when img_src is missing', async () => {
      mockGetJSON.mockResolvedValueOnce({
        results: [{
          ...searxngResponse.results[0],
          img_src: undefined,
          thumbnail: 'https://example.com/thumb.png',
        }],
        number_of_results: 1,
        query: 'test query',
      })

      const provider = createSearchProvider('searxng', {})
      const results = await provider.search('query')

      expect(results[0].image).toBe('https://example.com/thumb.png')
    })
  })
})
