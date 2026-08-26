import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetJSON = vi.fn()

vi.mock('../src/core/client.ts', () => ({
  Client: vi.fn(),
  defaultClient: vi.fn(() => ({
    getJSON: mockGetJSON,
    postJSON: vi.fn(),
  })),
}))

import { createMcpServer, executeRead, executeSearch } from '../src/mcp.ts'
import { EmptyQueryError, EmptyUrlError } from '../src/core/errors.ts'
import '../src/providers/index.ts'

const openConnections: Array<{ close(): Promise<void> }> = []

async function connectTestClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createMcpServer()
  const client = new Client({ name: 'web-test', version: '1.0.0' })
  openConnections.push(client, server)
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

afterEach(async () => {
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()))
})

describe('web MCP server', () => {
  it('advertises the three capability tools as read-only', async () => {
    const client = await connectTestClient()

    const response = await client.listTools()

    expect(response.tools.map((tool) => tool.name)).toEqual([
      'web_search',
      'web_read',
      'web_providers',
    ])
    for (const tool of response.tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    }
    expect(response.tools[2]?.annotations).toMatchObject({ openWorldHint: false })
  })

  it('returns provider results as JSON text for web_search', async () => {
    process.env.JINA_API_KEY = 'test-key'
    mockGetJSON.mockReset()
    mockGetJSON.mockResolvedValue({
      code: 200,
      status: 20000,
      data: [{ title: 'Test Result', url: 'https://example.com', description: 'A test description' }],
    })
    const client = await connectTestClient()

    const response = await client.callTool({
      name: 'web_search',
      arguments: { query: 'test query', provider: 'jina', maxResults: 5 },
    })

    expect(response.isError).toBeUndefined()
    const payload = JSON.parse((response.content as Array<{ type: string; text: string }>)[0]?.text ?? '')
    expect(payload).toEqual([
      { title: 'Test Result', url: 'https://example.com', snippet: 'A test description' },
    ])
  })

  it('rejects arguments that miss the schema', async () => {
    const client = await connectTestClient()

    const response = await client.callTool({
      name: 'web_read',
      arguments: { url: 'https://example.com', format: 'pdf' },
    })

    expect(response.isError).toBe(true)
    expect((response.content as Array<{ type: string; text: string }>)[0]).toMatchObject({ type: 'text' })
  })

  it('rejects prototype property names as unknown tools', async () => {
    const client = await connectTestClient()

    const response = await client.callTool({ name: 'toString', arguments: {} })

    expect(response.isError).toBe(true)
    expect((response.content as Array<{ type: string; text: string }>)[0]?.text).not.toContain('\n')
  })

  it('escapes control bytes in an unknown tool name instead of echoing them', async () => {
    const client = await connectTestClient()

    const response = await client.callTool({ name: 'bad\nname', arguments: {} })

    expect(response.isError).toBe(true)
    expect((response.content as Array<{ type: string; text: string }>)[0]?.text).not.toContain('\n')
  })
})

describe('web MCP executors', () => {
  beforeEach(() => {
    mockGetJSON.mockReset()
    mockGetJSON.mockResolvedValue({ code: 200, status: 20000, data: [] })
  })

  it('guards the empty-query contract when a host skips validation', async () => {
    await expect(executeSearch({})).rejects.toBeInstanceOf(EmptyQueryError)
    await expect(executeSearch({ query: '   ' })).rejects.toBeInstanceOf(EmptyQueryError)
  })

  it('guards the empty-url contract when a host skips validation', async () => {
    await expect(executeRead({ url: '' })).rejects.toBeInstanceOf(EmptyUrlError)
  })

  it('clamps maxResults to the hard cap even without schema validation', async () => {
    process.env.JINA_API_KEY = 'test-key'
    await executeSearch({ query: 'test', provider: 'jina', maxResults: 10.9 })

    const requestUrl = String(mockGetJSON.mock.calls[0]?.[0])
    expect(requestUrl).toContain('count=10')
  })

  it('rejects a string includeDomains before it iterates per character', async () => {
    process.env.JINA_API_KEY = 'test-key'
    await expect(
      executeSearch({ query: 'test', provider: 'jina', includeDomains: 'github.com' }),
    ).rejects.toBeInstanceOf(TypeError)

    await executeSearch({
      query: 'test',
      provider: 'jina',
      includeDomains: ['github.com'],
    })
    const requestUrl = String(mockGetJSON.mock.calls[0]?.[0])
    expect(requestUrl).toContain('site=github.com')
  })

  it('rejects fractional maxTokens and a non-boolean noCache at the boundary', async () => {
    await expect(executeRead({ url: 'https://example.com', maxTokens: 10.5 })).rejects.toBeInstanceOf(
      TypeError,
    )
    await expect(executeRead({ url: 'https://example.com', noCache: 'yes' })).rejects.toBeInstanceOf(
      TypeError,
    )
  })
})
