import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPostJSON = vi.fn()

vi.mock('../../src/core/client.ts', () => ({
  Client: vi.fn(),
  defaultClient: vi.fn(() => ({
    getJSON: vi.fn(),
    postJSON: mockPostJSON,
    maxRetries: 5,
    baseDelay: 50,
    timeout: 30000,
    userAgent: 'askweb/0.0.1',
  })),
}))

import { create, has } from '../../src/core/registry.ts'
import { AskwebError, AuthError, RateLimitError } from '../../src/core/errors.ts'
import type { SearchResult } from '../../src/core/types.ts'

// Triggers self-registration of serpbase provider
import '../../src/providers/index.ts'

const serpBaseResponse = {
  status: 0,
  request_id: 'req-123',
  elapsed_ms: 1071,
  credits_charged: 1,
  search_type: 'search',
  query: 'test query',
  organic: [{
    rank: 1,
    position: 1,
    title: 'Test Result',
    link: 'https://example.com',
    url: 'https://example.com',
    display_url: 'example.com',
    display_link: 'example.com',
    source_url: 'https://www.google.com/url?q=https://example.com',
    snippet: 'A test snippet from SerpBase',
    date: '2 days ago',
    icon: 'https://example.com/favicon.ico',
  }],
}

describe('serpbase provider', () => {
  beforeEach(() => {
    mockPostJSON.mockReset()
    mockPostJSON.mockResolvedValue(serpBaseResponse)
    delete process.env.SERPBASE_API_KEY
  })

  describe('self-registration', () => {
    it('registers itself on import', () => {
      expect(has('serpbase')).toBe(true)
    })
  })

  describe('create', () => {
    it('creates provider with apiKey', () => {
      expect(() => create('serpbase', { apiKey: 'test-key' })).not.toThrow()
    })

    it('creates provider with env api key', () => {
      process.env.SERPBASE_API_KEY = 'env-key'
      expect(() => create('serpbase')).not.toThrow()
    })

    it('throws AuthError without apiKey and without env var', () => {
      expect(() => create('serpbase', {})).toThrow(AuthError)
    })
  })

  describe('name()', () => {
    it('returns serpbase', () => {
      const provider = create('serpbase', { apiKey: 'test-key' })
      expect(provider.name()).toBe('serpbase')
    })
  })

  describe('search()', () => {
    it('calls postJSON with Google search endpoint, body, and X-API-Key header', async () => {
      const provider = create('serpbase', { apiKey: 'test-key' })
      await provider.search('test query')

      expect(mockPostJSON).toHaveBeenCalledOnce()
      const [url, body, headers] = mockPostJSON.mock.calls[0]

      expect(url).toBe('https://api.serpbase.dev/google/search')
      expect(body).toEqual({ q: 'test query', hl: 'en', gl: 'us', page: 1 })
      expect(headers).toEqual({ 'X-API-Key': 'test-key' })
    })

    it('maps organic result fields correctly', async () => {
      const provider = create('serpbase', { apiKey: 'test-key' })
      const results: SearchResult[] = await provider.search('test query')

      expect(results).toHaveLength(1)
      const result = results[0]
      expect(result.url).toBe('https://example.com')
      expect(result.title).toBe('Test Result')
      expect(result.snippet).toBe('A test snippet from SerpBase')
      expect(result.favicon).toBe('https://example.com/favicon.ico')
      expect(result.publishedDate).toBe('2 days ago')
      expect(result.metadata?.position).toBe(1)
      expect(result.metadata?.requestId).toBe('req-123')
      expect(result.metadata?.creditsCharged).toBe(1)
    })

    it('maps maxResults option by slicing returned results', async () => {
      mockPostJSON.mockResolvedValueOnce({
        ...serpBaseResponse,
        organic: [
          serpBaseResponse.organic[0],
          { ...serpBaseResponse.organic[0], rank: 2, position: 2, title: 'Second Result', link: 'https://second.example.com' },
        ],
      })

      const provider = create('serpbase', { apiKey: 'test-key' })
      const results = await provider.search('test query', { maxResults: 1 })

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Test Result')
    })

    it('uses images endpoint and maps image fields for images category', async () => {
      mockPostJSON.mockResolvedValueOnce({
        status: 0,
        request_id: 'req-img',
        elapsed_ms: 1200,
        credits_charged: 2,
        search_type: 'images',
        images: [{
          rank: 1,
          title: 'Image Result',
          link: 'https://example.com/page',
          image_url: 'https://example.com/image.png',
          thumbnail_url: 'https://example.com/thumb.png',
          source: 'Example',
          domain: 'example.com',
        }],
      })

      const provider = create('serpbase', { apiKey: 'test-key' })
      const results = await provider.search('image query', { category: 'images' })

      const [url] = mockPostJSON.mock.calls[0]
      expect(url).toBe('https://api.serpbase.dev/google/images')
      expect(results).toHaveLength(1)
      expect(results[0].url).toBe('https://example.com/page')
      expect(results[0].image).toBe('https://example.com/image.png')
      expect(results[0].metadata?.searchType).toBe('images')
    })

    it('throws AuthError for SerpBase unauthorized business status', async () => {
      mockPostJSON.mockResolvedValueOnce({
        status: 1001,
        error: 'unauthorized',
        request_id: 'req-auth',
        elapsed_ms: 0,
        credits_charged: 0,
        search_type: 'search',
      })

      const provider = create('serpbase', { apiKey: 'bad-key' })

      await expect(provider.search('test query')).rejects.toThrow(AuthError)
    })

    it('throws RateLimitError for SerpBase rate limit business status', async () => {
      mockPostJSON.mockResolvedValueOnce({
        status: 1029,
        error: 'rate limited',
        request_id: 'req-rate',
        elapsed_ms: 0,
        credits_charged: 0,
        search_type: 'search',
      })

      const provider = create('serpbase', { apiKey: 'test-key' })

      await expect(provider.search('test query')).rejects.toThrow(RateLimitError)
    })

    it('throws AskwebError for insufficient credits business status', async () => {
      mockPostJSON.mockResolvedValueOnce({
        status: 1020,
        error: 'insufficient credits',
        request_id: 'req-credits',
        elapsed_ms: 0,
        credits_charged: 0,
        search_type: 'search',
      })

      const provider = create('serpbase', { apiKey: 'test-key' })

      await expect(provider.search('test query')).rejects.toThrow(AskwebError)
    })
  })
})
