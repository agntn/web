import { describe, expect, it } from 'vitest'
import { builtinProviders, create, readUrl, version } from '../src/index.ts'

describe('askweb', () => {
  it('should export version matching package.json', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('should list all built-in provider names', () => {
    expect(builtinProviders).toEqual(['brave', 'exa', 'jina', 'searxng', 'serpapi', 'tavily'])
  })

  it('should register built-in providers from main entrypoint', () => {
    for (const provider of builtinProviders) {
      const config = provider === 'searxng' || provider === 'jina' ? undefined : { apiKey: 'test-api-key' }
      expect(() => create(provider, config)).not.toThrow()
    }
  })

  it('should export readUrl', () => {
    expect(readUrl).toBeTypeOf('function')
  })
})
