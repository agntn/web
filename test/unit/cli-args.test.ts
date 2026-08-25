import { describe, expect, it } from 'vitest'
import { normalizeMainArgs } from '../../src/cli-args.ts'

describe('CLI main args', () => {
  it('keeps explicit subcommands unchanged', () => {
    expect(normalizeMainArgs(['search', 'query'])).toEqual(['search', 'query'])
    expect(normalizeMainArgs(['read', 'https://example.com'])).toEqual(['read', 'https://example.com'])
    expect(normalizeMainArgs(['providers'])).toEqual(['providers'])
    expect(normalizeMainArgs(['mcp'])).toEqual(['mcp'])
  })

  it('keeps help and version flags on the main command', () => {
    expect(normalizeMainArgs(['--help'])).toEqual(['--help'])
    expect(normalizeMainArgs(['-h'])).toEqual(['-h'])
    expect(normalizeMainArgs(['--version'])).toEqual(['--version'])
    expect(normalizeMainArgs(['-v'])).toEqual(['-v'])
  })

  it('treats a bare query as a search command', () => {
    expect(normalizeMainArgs(['whatever what that means'])).toEqual([
      'search',
      'whatever what that means',
    ])
    expect(normalizeMainArgs(['help'])).toEqual(['search', 'help'])
  })

  it('allows search flags before the bare query', () => {
    expect(normalizeMainArgs(['--provider', 'brave', 'whatever what that means'])).toEqual([
      'search',
      '--provider',
      'brave',
      'whatever what that means',
    ])
  })
})
