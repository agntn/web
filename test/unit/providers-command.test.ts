import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockLog = vi.fn()

vi.mock('consola', () => ({
  consola: {
    log: (...args: unknown[]) => mockLog(...args),
  },
}))

import providersCommand from '../../src/commands/providers.ts'
import { builtinProviders } from '../../src/index.ts'

const envKeys = ['EXA_API_KEY', 'BRAVE_API_KEY', 'JINA_API_KEY', 'TAVILY_API_KEY', 'SERPAPI_API_KEY']

describe('providers command', () => {
  const savedEnv: Record<string, string | undefined> = {}
  let writeSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockLog.mockClear()
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
    writeSpy.mockRestore()
  })

  describe('human output', () => {
    it('lists all built-in providers', async () => {
      await providersCommand.run!({ args: { json: false } } as never)

      const output = mockLog.mock.calls.map(c => String(c[0])).join('\n')
      for (const name of builtinProviders) {
        expect(output).toContain(name)
      }
    })

    it('shows configured provider with checkmark when env var is set', async () => {
      process.env.EXA_API_KEY = 'test-key'

      await providersCommand.run!({ args: { json: false } } as never)

      const output = mockLog.mock.calls.map(c => String(c[0])).join('\n')
      expect(output).toContain('\u2713')
      expect(output).toContain('exa')
    })

    it('shows unconfigured provider with cross and env var hint', async () => {
      await providersCommand.run!({ args: { json: false } } as never)

      const output = mockLog.mock.calls.map(c => String(c[0])).join('\n')
      expect(output).toContain('\u2717')
      expect(output).toContain('EXA_API_KEY not set')
    })

    it('shows searxng as configured without any env var', async () => {
      await providersCommand.run!({ args: { json: false } } as never)

      const lines = mockLog.mock.calls.map(c => String(c[0]))
      const searxngLine = lines.find(l => l.includes('searxng'))
      expect(searxngLine).toBeDefined()
      expect(searxngLine).toContain('\u2713')
    })
  })

  describe('JSON output', () => {
    it('outputs array of provider status objects', async () => {
      await providersCommand.run!({ args: { json: true } } as never)

      expect(writeSpy).toHaveBeenCalledOnce()
      const raw = String(writeSpy.mock.calls[0][0])
      const parsed = JSON.parse(raw)

      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toHaveLength(builtinProviders.length)
    })

    it('includes name, envVar, and configured fields', async () => {
      process.env.BRAVE_API_KEY = 'test-key'

      await providersCommand.run!({ args: { json: true } } as never)

      const parsed = JSON.parse(String(writeSpy.mock.calls[0][0]))
      const brave = parsed.find((p: { name: string }) => p.name === 'brave')

      expect(brave).toEqual({
        name: 'brave',
        envVar: 'BRAVE_API_KEY',
        configured: true,
      })
    })

    it('marks unconfigured providers correctly', async () => {
      await providersCommand.run!({ args: { json: true } } as never)

      const parsed = JSON.parse(String(writeSpy.mock.calls[0][0]))
      const exa = parsed.find((p: { name: string }) => p.name === 'exa')

      expect(exa).toEqual({
        name: 'exa',
        envVar: 'EXA_API_KEY',
        configured: false,
      })
    })

    it('marks searxng as configured with null envVar', async () => {
      await providersCommand.run!({ args: { json: true } } as never)

      const parsed = JSON.parse(String(writeSpy.mock.calls[0][0]))
      const searxng = parsed.find((p: { name: string }) => p.name === 'searxng')

      expect(searxng).toEqual({
        name: 'searxng',
        envVar: null,
        configured: true,
      })
    })

    it('reflects env var changes between calls', async () => {
      await providersCommand.run!({ args: { json: true } } as never)
      const before = JSON.parse(String(writeSpy.mock.calls[0][0]))
      const tavBefore = before.find((p: { name: string }) => p.name === 'tavily')
      expect(tavBefore.configured).toBe(false)

      writeSpy.mockClear()
      process.env.TAVILY_API_KEY = 'test-key'

      await providersCommand.run!({ args: { json: true } } as never)
      const after = JSON.parse(String(writeSpy.mock.calls[0][0]))
      const tavAfter = after.find((p: { name: string }) => p.name === 'tavily')
      expect(tavAfter.configured).toBe(true)
    })
  })
})
