import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmptyUrlError, ReadNotSupportedError } from '../../src/core/errors.ts'

const mockLog = vi.fn()
const mockInfo = vi.fn()
const mockError = vi.fn()
const mockReadUrl = vi.fn()

vi.mock('consola', () => ({
  consola: {
    log: (...args: unknown[]) => mockLog(...args),
    info: (...args: unknown[]) => mockInfo(...args),
    error: (...args: unknown[]) => mockError(...args),
  },
}))

vi.mock('../../src/core/read.ts', () => ({
  readUrl: (...args: unknown[]) => mockReadUrl(...args),
}))

vi.mock('../../src/core/registry.ts', () => ({
  providers: vi.fn(() => ['jina']),
}))

vi.mock('../../src/providers/index.ts', () => ({}))

import readCommand from '../../src/commands/read.ts'

type ReadRunInput = Parameters<NonNullable<typeof readCommand.run>>[0]
type ReadRunArgs = {
  _: string[]
  url: string
  provider?: string
  format?: string
  'max-tokens'?: string
  json: boolean
  [key: string]: string | number | boolean | string[] | undefined
}

const defaultArgs: ReadRunArgs = {
  _: [],
  url: 'https://example.com',
  provider: 'jina',
  json: false,
}

function makeArgs(overrides: Partial<ReadRunArgs> = {}): ReadRunArgs {
  return { ...defaultArgs, ...overrides }
}

function runRead(overrides: Partial<ReadRunArgs> = {}) {
  const context = {
    args: makeArgs(overrides),
    rawArgs: [],
    cmd: readCommand,
  } as ReadRunInput
  return readCommand.run!(context)
}

describe('read command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockLog.mockReset()
    mockInfo.mockReset()
    mockError.mockReset()
    mockReadUrl.mockReset()
    mockReadUrl.mockResolvedValue({
      url: 'https://example.com',
      title: 'Example',
      description: 'Example description',
      content: 'Example content',
    })
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__EXIT__')
    }) as never)
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    writeSpy.mockRestore()
  })

  it('uses jina provider by default', async () => {
    await runRead({ provider: undefined })

    expect(mockReadUrl).toHaveBeenCalledWith('https://example.com', {
      provider: 'jina',
      format: undefined,
      maxTokens: undefined,
    })
  })

  it('passes format and max tokens', async () => {
    await runRead({ format: 'text', 'max-tokens': '500' })

    expect(mockReadUrl).toHaveBeenCalledWith('https://example.com', {
      provider: 'jina',
      format: 'text',
      maxTokens: 500,
    })
  })

  it('outputs JSON when --json is set', async () => {
    await runRead({ json: true })

    expect(writeSpy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(String(writeSpy.mock.calls[0][0]))
    expect(parsed.content).toBe('Example content')
  })

  it('exits with a helpful message for empty URL', async () => {
    await expect(runRead({ url: '   ' })).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Read URL cannot be empty.')
    expect(mockReadUrl).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits with a helpful message for invalid format', async () => {
    await expect(runRead({ format: 'pdf' })).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Invalid --format value. Expected markdown, text, or html.')
    expect(mockReadUrl).not.toHaveBeenCalled()
  })

  it('exits with a helpful message for invalid max tokens', async () => {
    await expect(runRead({ 'max-tokens': '0' })).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Invalid --max-tokens value. Expected a positive integer.')
    expect(mockReadUrl).not.toHaveBeenCalled()
  })

  it('handles EmptyUrlError from core', async () => {
    mockReadUrl.mockRejectedValueOnce(new EmptyUrlError())

    await expect(runRead()).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Read URL cannot be empty.')
  })

  it('handles ReadNotSupportedError from core', async () => {
    mockReadUrl.mockRejectedValueOnce(new ReadNotSupportedError('brave'))

    await expect(runRead({ provider: 'brave' })).rejects.toThrow('__EXIT__')

    expect(mockError).toHaveBeenCalledWith('Provider does not support read: brave')
  })
})
