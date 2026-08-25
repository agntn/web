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

// Triggers self-registration of exa provider
import '../../src/providers/index.ts'

const exaResponse = {
  requestId: 'test-req',
  results: [{
    id: 'abc123',
    url: 'https://example.com',
    title: 'Test Result',
    score: 0.95,
    publishedDate: '2024-01-01',
    author: 'Test Author',
    image: 'https://example.com/img.png',
    favicon: 'https://example.com/favicon.ico',
    text: 'Full text content here for testing purposes',
    highlights: ['Key highlight from the page'],
    summary: 'A brief summary',
  }],
}

describe('exa provider', () => {
  beforeEach(() => {
    mockPostJSON.mockReset()
    mockPostJSON.mockResolvedValue(exaResponse)
    delete process.env.EXA_API_KEY
  })

  describe('self-registration', () => {
    it('registers itself on import', () => {
      expect(has('exa')).toBe(true)
    })
  })

  describe('create', () => {
    it('creates provider with apiKey', () => {
      expect(() => createSearchProvider('exa', { apiKey: 'test-key' })).not.toThrow()
    })

    it('throws AuthError without apiKey and without env var', () => {
      expect(() => createSearchProvider('exa', {})).toThrow(AuthError)
    })
  })

  describe('name', () => {
    it('returns exa', () => {
      const provider = createSearchProvider('exa', { apiKey: 'test-key' })
      expect(provider.name).toBe('exa')
    })
  })

  describe('search()', () => {
    it('calls postJSON with correct url, body, and headers', async () => {
      const provider = createSearchProvider('exa', { apiKey: 'test-key' })
      await provider.search('test query')

      expect(mockPostJSON).toHaveBeenCalledOnce()
      const [url, body, headers] = mockPostJSON.mock.calls[0]

      expect(url).toBe('https://api.exa.ai/search')
      expect(body).toMatchObject({
        query: 'test query',
        type: 'auto',
        contents: { text: true, highlights: true },
      })
      expect(headers).toEqual({ 'x-api-key': 'test-key' })
    })

    it('maps result fields correctly', async () => {
      const provider = createSearchProvider('exa', { apiKey: 'test-key' })
      const results: SearchResult[] = await provider.search('test query')

      expect(results).toHaveLength(1)
      const result = results[0]
      expect(result.url).toBe('https://example.com')
      expect(result.title).toBe('Test Result')
      expect(result.snippet).toBe('Key highlight from the page')
      expect(result.score).toBe(0.95)
      expect(result.text).toBe('Full text content here for testing purposes')
      expect(result.highlights).toEqual(['Key highlight from the page'])
    })

    it('maps maxResults option to numResults in body', async () => {
      const provider = createSearchProvider('exa', { apiKey: 'test-key' })
      await provider.search('test query', { maxResults: 5 })

      const [, body] = mockPostJSON.mock.calls[0]
      expect(body.numResults).toBe(5)
    })

    it('uses empty string for null title', async () => {
      mockPostJSON.mockResolvedValueOnce({
        requestId: 'test-req',
        results: [{ ...exaResponse.results[0], title: null }],
      })

      const provider = createSearchProvider('exa', { apiKey: 'test-key' })
      const results = await provider.search('query')

      expect(results[0].title).toBe('')
    })

    it('falls back to truncated text when no highlights', async () => {
      const longText = 'A'.repeat(300)
      mockPostJSON.mockResolvedValueOnce({
        requestId: 'test-req',
        results: [{
          ...exaResponse.results[0],
          highlights: undefined,
          text: longText,
        }],
      })

      const provider = createSearchProvider('exa', { apiKey: 'test-key' })
      const results = await provider.search('query')

      expect(results[0].snippet).toBe(longText.slice(0, 200))
    })

    it('returns empty array for empty results', async () => {
      mockPostJSON.mockResolvedValueOnce({
        requestId: 'test-req',
        results: [],
      })

      const provider = createSearchProvider('exa', { apiKey: 'test-key' })
      const results = await provider.search('query')

      expect(results).toEqual([])
    })
  })
})
