import { describe, it, expect, vi } from 'vitest'
import { readUrl } from '../../src/core/read.ts'
import { register } from '../../src/core/registry.ts'
import { EmptyUrlError, ReadNotSupportedError } from '../../src/core/errors.ts'

describe('readUrl', () => {
  it('passes explicit provider and read options through', async () => {
    const providerName = `reader-${Math.random().toString(36).slice(2)}`
    const read = vi.fn().mockResolvedValue({ url: 'https://example.com', content: 'ok' })
    register(providerName, 'https://reader.example.com', () => ({
      name: () => providerName,
      search: vi.fn().mockResolvedValue([]),
      read,
    }))

    await readUrl(' https://example.com ', { provider: providerName, format: 'text', maxTokens: 500 })

    expect(read).toHaveBeenCalledWith('https://example.com', { format: 'text', maxTokens: 500 })
  })

  it('throws EmptyUrlError for whitespace-only URLs', async () => {
    await expect(readUrl('   ')).rejects.toThrow(EmptyUrlError)
  })

  it('throws ReadNotSupportedError for search-only built-in providers before constructing them', async () => {
    delete process.env.EXA_API_KEY

    await expect(readUrl('https://example.com', { provider: 'exa' })).rejects.toThrow(ReadNotSupportedError)
  })

  it('throws ReadNotSupportedError when a custom provider has no read capability', async () => {
    const providerName = `search-only-${Math.random().toString(36).slice(2)}`
    register(providerName, 'https://search.example.com', () => ({
      name: () => providerName,
      search: vi.fn().mockResolvedValue([]),
    }))

    await expect(readUrl('https://example.com', { provider: providerName })).rejects.toThrow(ReadNotSupportedError)
  })
})
