import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoProviderConfiguredError, SearchNotSupportedError, UnknownProviderError } from '../../src/core/errors.ts'

const mockLog = vi.fn()
const mockInfo = vi.fn()
const mockError = vi.fn()

const mockSearch = vi.fn()
const mockSearchDetailed = vi.fn()
const mockCreate = vi.fn((name: string, config: Record<string, unknown>) => {
  void config
  return name === 'firecrawl'
    ? { search: mockSearch, searchDetailed: mockSearchDetailed }
    : { search: mockSearch }
})
const mockResolveDefaultProvider = vi.fn(() => 'brave')

vi.mock('consola', () => ({
  consola: {
    log: (...args: unknown[]) => mockLog(...args),
    info: (...args: unknown[]) => mockInfo(...args),
    error: (...args: unknown[]) => mockError(...args),
  },
}))

vi.mock('../../src/core/registry.ts', () => ({
  createSearchProvider: (name: string, config: Record<string, unknown>) => mockCreate(name, config),
  providers: vi.fn(() => ['brave', 'exa']),
}))

vi.mock('../../src/core/resolve.ts', () => ({
  resolveDefaultProvider: () => mockResolveDefaultProvider(),
}))

vi.mock('../../src/providers/index.ts', () => ({}))

import searchCommand from '../../src/commands/search.ts'

type SearchRunInput = Parameters<NonNullable<typeof searchCommand.run>>[0]
type SearchRunArgs = {
  _: string[]
  query: string
  provider?: string
  'max-results': string
  json: boolean
  [key: string]: string | number | boolean | string[] | undefined
}

const defaultArgs: SearchRunArgs = {
  _: [],
  query: 'test query',
  'max-results': '10',
  json: false,
}

function makeArgs(overrides: Partial<SearchRunArgs> = {}): SearchRunArgs {
  return { ...defaultArgs, ...overrides }
}

function runSearch(overrides: Partial<SearchRunArgs> = {}) {
  const context = {
    args: makeArgs(overrides),
    rawArgs: [],
    cmd: searchCommand,
  } as SearchRunInput
  return searchCommand.run!(context)
}

describe('search command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let stdoutSpy: ReturnType<typeof vi.spyOn> | undefined

  beforeEach(() => {
    mockLog.mockReset()
    mockInfo.mockReset()
    mockError.mockReset()
    mockSearch.mockReset()
    mockSearchDetailed.mockReset()
    mockCreate.mockClear()
    mockResolveDefaultProvider.mockClear()
    mockSearch.mockResolvedValue([])
    mockSearchDetailed.mockResolvedValue({ results: [], metadata: { id: 'job-1', creditsUsed: 1 } })
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__EXIT__')
    }) as never)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    stdoutSpy?.mockRestore()
    stdoutSpy = undefined
  })

  it('uses resolved default provider when provider arg is omitted', async () => {
    await runSearch({ provider: undefined })

    expect(mockResolveDefaultProvider).toHaveBeenCalledOnce()
    expect(mockCreate).toHaveBeenCalledWith('brave', {})
  })

  it('uses explicit provider when provider arg is set', async () => {
    await runSearch({ provider: 'exa' })

    expect(mockResolveDefaultProvider).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledWith('exa', {})
  })

  it('prints detailed provider metadata in JSON output', async () => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runSearch({ provider: 'firecrawl', json: true })

    expect(mockSearchDetailed).toHaveBeenCalledWith('test query', { maxResults: 10 })
    expect(mockSearch).not.toHaveBeenCalled()
    expect(stdoutSpy).toHaveBeenCalledWith(`${JSON.stringify({
      results: [],
      metadata: { id: 'job-1', creditsUsed: 1 },
    }, null, 2)}\n`)
  })

  it('keeps list JSON for providers without detailed search', async () => {
    const results = [{ url: 'https://example.com', title: 'Example', snippet: 'Result' }]
    mockSearch.mockResolvedValueOnce(results)
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await runSearch({ provider: 'exa', json: true })

    expect(mockSearch).toHaveBeenCalledWith('test query', { maxResults: 10 })
    expect(mockSearchDetailed).not.toHaveBeenCalled()
    expect(stdoutSpy).toHaveBeenCalledWith(`${JSON.stringify(results, null, 2)}\n`)
  })

  it('treats empty string provider as omitted', async () => {
    await runSearch({ provider: '' })

    expect(mockResolveDefaultProvider).toHaveBeenCalledOnce()
    expect(mockCreate).toHaveBeenCalledWith('brave', {})
  })

  it('exits with a helpful message for non-numeric --max-results', async () => {
    await expect(
      runSearch({ 'max-results': 'abc' }),
    ).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Invalid --max-results value. Expected a positive integer.')
    expect(mockSearch).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with a helpful message for zero --max-results', async () => {
    await expect(
      runSearch({ 'max-results': '0' }),
    ).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Invalid --max-results value. Expected a positive integer.')
    expect(mockSearch).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with a helpful message for negative --max-results', async () => {
    await expect(
      runSearch({ 'max-results': '-1' }),
    ).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Invalid --max-results value. Expected a positive integer.')
    expect(mockSearch).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('reports unknown provider using resolved provider name', async () => {
    mockCreate.mockImplementationOnce(() => {
      throw new UnknownProviderError('brave')
    })

    await expect(
      runSearch({ provider: undefined }),
    ).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Unknown provider: brave')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('reports providers without search capability', async () => {
    mockCreate.mockImplementationOnce(() => {
      throw new SearchNotSupportedError('reader')
    })

    await expect(
      runSearch({ provider: 'reader' }),
    ).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Provider "reader" does not support web search.')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with error for empty query', async () => {
    await expect(
      runSearch({ query: '' }),
    ).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Search query cannot be empty.')
    expect(mockSearch).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with error for whitespace-only query', async () => {
    await expect(
      runSearch({ query: '   ' }),
    ).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Search query cannot be empty.')
    expect(mockSearch).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('shows a helpful message when no provider is configured', async () => {
    mockResolveDefaultProvider.mockImplementationOnce(() => {
      throw new NoProviderConfiguredError()
    })

    await expect(
      runSearch({ provider: undefined }),
    ).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith(
      'No web search provider configured. Set an API key env var or register a provider.',
    )
    expect(mockInfo).toHaveBeenCalledWith('Registered providers: brave, exa')
    expect(mockInfo).toHaveBeenCalledWith('Set one provider API key env var or pass --provider explicitly.')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
