import { describe, it, expect, vi } from 'vitest'
import { readUrl } from '../../src/core/read.ts'
import { register } from '../../src/core/registry.ts'
import { EmptyUrlError, ReadNotSupportedError } from '../../src/core/errors.ts'
import { Provider } from '../../src/core/provider.ts'
import type { ProviderConfig, ReadOptions, ReadResult } from '../../src/core/types.ts'

describe('readUrl', () => {
  it('passes explicit provider and read options through', async () => {
    const providerName = `reader-${Math.random().toString(36).slice(2)}`
    const read = vi.fn().mockResolvedValue({ url: 'https://example.com', content: 'ok' })
    class ReaderProvider extends Provider {
      static readonly providerName = providerName
      static readonly defaultBaseURL = 'https://reader.example.com'

      constructor(config: ProviderConfig) {
        super(config, ReaderProvider)
      }

      async read(url: string, options?: ReadOptions): Promise<ReadResult> {
        return read(url, options)
      }
    }
    register(ReaderProvider)

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
    class SearchOnlyProvider extends Provider {
      static readonly providerName = providerName
      static readonly defaultBaseURL = 'https://search.example.com'

      constructor(config: ProviderConfig) {
        super(config, SearchOnlyProvider)
      }
    }
    register(SearchOnlyProvider)

    await expect(readUrl('https://example.com', { provider: providerName })).rejects.toThrow(ReadNotSupportedError)
  })
})
