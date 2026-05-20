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

import { create, has } from '../../src/core/registry.ts'
import { AuthError } from '../../src/core/errors.ts'
import type { SearchResult, ReadResult } from '../../src/core/types.ts'

// Triggers self-registration of jina provider
import '../../src/providers/index.ts'

const jinaResponse = {
  code: 200,
  status: 20000,
  data: [{
    title: 'Test Result',
    url: 'https://example.com',
    description: 'A test description from Jina search',
    content: 'Full content from Jina search result',
    publishedTime: '2024-07-01T00:00:00Z',
    images: ['https://example.com/image.png'],
    metadata: { source: 'jina' },
    warning: 'partial result',
  }],
}

describe('jina provider', () => {
  beforeEach(() => {
    mockGetJSON.mockReset()
    mockGetJSON.mockResolvedValue(jinaResponse)
    delete process.env.JINA_API_KEY
  })

  describe('self-registration', () => {
    it('registers itself on import', () => {
      expect(has('jina')).toBe(true)
    })
  })

  describe('create', () => {
    it('creates provider with apiKey', () => {
      expect(() => create('jina', { apiKey: 'test-key' })).not.toThrow()
    })

    it('creates provider without apiKey for read-only use', () => {
      expect(() => create('jina', {})).not.toThrow()
    })
  })

  describe('name()', () => {
    it('returns jina', () => {
      const provider = create('jina', { apiKey: 'test-key' })
      expect(provider.name()).toBe('jina')
    })
  })

  describe('search()', () => {
    it('throws AuthError without apiKey and without env var', async () => {
      const provider = create('jina', {})
      await expect(provider.search('test query')).rejects.toThrow(AuthError)
      expect(mockGetJSON).not.toHaveBeenCalled()
    })

    it('calls getJSON with correct URL and bearer auth headers', async () => {
      const provider = create('jina', { apiKey: 'test-key' })
      await provider.search('test query')

      expect(mockGetJSON).toHaveBeenCalledOnce()
      const [url, headers] = mockGetJSON.mock.calls[0]

      expect(url).toContain('https://s.jina.ai/search?')
      expect(url).toContain('q=test+query')
      expect(url).toContain('count=10')
      expect(headers).toEqual({
        Authorization: 'Bearer test-key',
        Accept: 'application/json',
      })
    })

    it('maps result fields correctly', async () => {
      const provider = create('jina', { apiKey: 'test-key' })
      const results: SearchResult[] = await provider.search('test query')

      expect(results).toHaveLength(1)
      const result = results[0]
      expect(result.url).toBe('https://example.com')
      expect(result.title).toBe('Test Result')
      expect(result.snippet).toBe('A test description from Jina search')
      expect(result.text).toBe('Full content from Jina search result')
      expect(result.publishedDate).toBe('2024-07-01T00:00:00Z')
      expect(result.image).toBe('https://example.com/image.png')
      expect(result.metadata).toEqual({ source: 'jina', warning: 'partial result' })
    })

    it('maps maxResults to count query param and clamps to Jina limit', async () => {
      const provider = create('jina', { apiKey: 'test-key' })
      await provider.search('test query', { maxResults: 25 })

      const [url] = mockGetJSON.mock.calls[0]
      expect(url).toContain('count=20')
    })

    it('maps includeDomains and news category to Jina query params', async () => {
      const provider = create('jina', { apiKey: 'test-key' })
      await provider.search('test query', { includeDomains: ['example.com'], category: 'news' })

      const [url] = mockGetJSON.mock.calls[0]
      expect(url).toContain('site=example.com')
      expect(url).toContain('type=news')
    })

    it('falls back to content for snippet when description is missing', async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: [{
          url: 'https://example.com',
          content: 'A'.repeat(300),
        }],
      })

      const provider = create('jina', { apiKey: 'test-key' })
      const results = await provider.search('query')

      expect(results[0].snippet).toBe('A'.repeat(200))
      expect(results[0].title).toBe('')
    })

    it('returns empty array when data is undefined', async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: undefined,
      })

      const provider = create('jina', { apiKey: 'test-key' })
      const results = await provider.search('query')

      expect(results).toEqual([])
    })
  })

  describe('read()', () => {
    it('calls r.jina.ai with encoded URL and JSON accept header without requiring apiKey', async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: {
          title: 'Read Result',
          description: 'Read description',
          url: 'https://example.com/',
          content: 'Markdown content',
        },
      })

      const provider = create('jina', {})
      const result = await provider.read!('https://example.com/?a=1&b=2')

      expect(mockGetJSON).toHaveBeenCalledOnce()
      const [url, headers] = mockGetJSON.mock.calls[0]
      expect(url).toBe('https://r.jina.ai/https%3A%2F%2Fexample.com%2F%3Fa%3D1%26b%3D2')
      expect(headers).toEqual({ Accept: 'application/json' })
      expect(result.content).toBe('Markdown content')
    })

    it('passes read options as Jina Reader headers', async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: { url: 'https://example.com/', content: 'Text content' },
      })

      const provider = create('jina', { apiKey: 'test-key' })
      await provider.read!('https://example.com', {
        format: 'text',
        maxTokens: 500,
        targetSelector: 'main',
        removeSelector: 'nav',
        timeout: 30,
        noCache: true,
      })

      const [, headers] = mockGetJSON.mock.calls[0]
      expect(headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer test-key',
        'X-Respond-With': 'text',
        'X-Max-Tokens': '500',
        'X-Target-Selector': 'main',
        'X-Remove-Selector': 'nav',
        'X-Timeout': '30',
        'X-No-Cache': 'true',
      })
    })

    it('maps read result fields correctly', async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: {
          title: 'Read Result',
          description: 'Read description',
          url: 'https://example.com/',
          content: 'Markdown content',
          text: 'Plain content',
          html: '<main>HTML content</main>',
          publishedTime: '2024-08-01T00:00:00Z',
          links: ['https://example.com/a'],
          images: { hero: 'https://example.com/hero.png' },
          metadata: { lang: 'en' },
          warning: 'cached',
        },
      })

      const provider = create('jina', {})
      const result: ReadResult = await provider.read!('https://example.com')

      expect(result).toEqual({
        url: 'https://example.com/',
        title: 'Read Result',
        description: 'Read description',
        content: 'Markdown content',
        text: 'Plain content',
        html: '<main>HTML content</main>',
        publishedDate: '2024-08-01T00:00:00Z',
        image: 'https://example.com/hero.png',
        links: ['https://example.com/a'],
        images: { hero: 'https://example.com/hero.png' },
        metadata: { lang: 'en', warning: 'cached' },
      })
    })
  })
})
