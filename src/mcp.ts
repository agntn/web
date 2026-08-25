import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { Type, type TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { builtinProviders } from './core/providers.ts'
import { createSearchProvider } from './core/registry.ts'
import { searchAll } from './core/all.ts'
import { readProviderNames, readUrl } from './core/read.ts'
import { EmptyQueryError } from './core/errors.ts'
import { resolveDefaultProvider, listProviders } from './core/resolve.ts'
import './providers/index.ts'
import { version } from './version.ts'

const MAX_RESULTS_HARD_CAP = 20

const providerNames = [...builtinProviders, 'all'] as const

interface ToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: TSchema
  annotations: Tool['annotations']
  execute(args: Record<string, unknown>): unknown | Promise<unknown>
}

const toolsByName: Record<string, ToolDefinition> = Object.fromEntries(
  [
    {
      name: 'web_search',
      title: 'Web Search',
      description:
        'Search the web using multiple search engines (Brave, Exa, Jina, Tavily, SerpAPI, SerpBase, SearXNG). Returns relevant web pages with titles, URLs, snippets, and optional metadata. Use provider "all" to query all available providers in parallel and get deduplicated results.',
      inputSchema: Type.Object({
        query: Type.String({ description: 'Search query', minLength: 1 }),
        provider: Type.Optional(
          Type.Union(providerNames.map(name => Type.Literal(name)), {
            description:
              'Provider to use. Defaults to first available from env. Use "all" for parallel search.',
          }),
        ),
        maxResults: Type.Optional(
          Type.Integer({
            description: `Max results (default: 10, max: ${MAX_RESULTS_HARD_CAP})`,
            minimum: 1,
            maximum: MAX_RESULTS_HARD_CAP,
          }),
        ),
        includeDomains: Type.Optional(
          Type.Array(Type.String(), {
            description:
              'Only return results from these domains (e.g. ["github.com", "stackoverflow.com"])',
          }),
        ),
        excludeDomains: Type.Optional(
          Type.Array(Type.String(), { description: 'Exclude results from these domains' }),
        ),
        category: Type.Optional(
          Type.String({
            description: 'Search category (e.g. "news", "general"). Provider support varies.',
          }),
        ),
        startPublishedDate: Type.Optional(
          Type.String({
            description: 'Filter results published after this date (ISO 8601, e.g. "2024-01-01")',
          }),
        ),
        endPublishedDate: Type.Optional(
          Type.String({ description: 'Filter results published before this date (ISO 8601)' }),
        ),
      }),
      annotations: {
        title: 'Web Search',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      execute: executeSearch,
    },
    {
      name: 'web_read',
      title: 'Web Read',
      description:
        'Read a URL into normalized content using a read-capable provider. Defaults to Jina Reader (r.jina.ai). Returns URL, title/description when available, canonical content, and optional text/html/images/metadata.',
      inputSchema: Type.Object({
        url: Type.String({ description: 'URL to read', minLength: 1 }),
        provider: Type.Optional(
          Type.Union(readProviderNames.map(name => Type.Literal(name)), {
            description: 'Read provider to use. Defaults to Jina.',
          }),
        ),
        format: Type.Optional(
          Type.Union([Type.Literal('markdown'), Type.Literal('text'), Type.Literal('html')], {
            description: 'Preferred content format.',
          }),
        ),
        maxTokens: Type.Optional(
          Type.Integer({
            description: 'Maximum tokens to return when supported by the provider.',
            minimum: 1,
          }),
        ),
        targetSelector: Type.Optional(
          Type.String({ description: 'CSS selector to target when supported by the provider.' }),
        ),
        removeSelector: Type.Optional(
          Type.String({ description: 'CSS selector to remove when supported by the provider.' }),
        ),
        timeout: Type.Optional(
          Type.Integer({ description: 'Provider timeout in seconds when supported.', minimum: 1 }),
        ),
        noCache: Type.Optional(Type.Boolean({ description: 'Bypass provider cache when supported.' })),
      }),
      annotations: {
        title: 'Web Read',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      execute: executeRead,
    },
    {
      name: 'web_providers',
      title: 'Web Providers',
      description: 'List available web search providers and their configuration status.',
      inputSchema: Type.Object({}),
      annotations: {
        title: 'Web Providers',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execute: () => listProviders(),
    },
  ].map(tool => [tool.name, tool]),
)

/**
 * Resolves search arguments against the same contract the AI SDK tool enforces.
 *
 * A host may skip schema validation, so the executor re-checks the boundaries
 * that would otherwise reach a provider malformed.
 */
export async function executeSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === 'string' ? args.query : ''
  if (!query.trim()) {
    throw new EmptyQueryError()
  }

  let maxResults: number | undefined
  if (typeof args.maxResults === 'number' && Number.isFinite(args.maxResults)) {
    maxResults = Math.min(Math.max(1, Math.trunc(args.maxResults)), MAX_RESULTS_HARD_CAP)
  }

  const searchOptions = {
    maxResults,
    includeDomains: args.includeDomains as string[] | undefined,
    excludeDomains: args.excludeDomains as string[] | undefined,
    category: args.category as string | undefined,
    startPublishedDate: args.startPublishedDate as string | undefined,
    endPublishedDate: args.endPublishedDate as string | undefined,
  }

  if (args.provider === 'all') {
    return searchAll(query, searchOptions)
  }

  const name = (args.provider as string | undefined) ?? resolveDefaultProvider()
  return createSearchProvider(name).search(query, searchOptions)
}

/** Mirrors {@link executeSearch}: guards the read contract when validation was skipped. */
export async function executeRead(args: Record<string, unknown>): Promise<unknown> {
  const url = typeof args.url === 'string' ? args.url : ''
  return readUrl(url, {
    provider: args.provider as string | undefined,
    format: args.format as 'markdown' | 'text' | 'html' | undefined,
    maxTokens: typeof args.maxTokens === 'number' ? args.maxTokens : undefined,
    targetSelector: args.targetSelector as string | undefined,
    removeSelector: args.removeSelector as string | undefined,
    timeout: typeof args.timeout === 'number' ? args.timeout : undefined,
    noCache: typeof args.noCache === 'boolean' ? args.noCache : undefined,
  })
}

/** Formats the first TypeBox validation failure for an MCP client. */
function validationError(schema: TSchema, value: unknown): string {
  const first = Value.Errors(schema, value)[0]
  if (!first) return 'Invalid arguments'
  return `Invalid arguments at ${first.instancePath || '/'}: ${first.message}`
}

/**
 * Wraps error text for the MCP client, replacing control bytes with spaces.
 *
 * Every error branch goes through here because parts of these messages echo
 * client-controlled values (a tool name, an argument) or downstream error
 * messages: one raw newline or escape byte would forge extra lines that read
 * as the server's own answer.
 */
function errorResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text: text.replace(/\p{Cc}/gu, ' ') }],
    isError: true,
  }
}

/**
 * Creates an unconnected MCP server exposing the web tools.
 *
 * Built on the low-level `Server` even though the SDK marks it `@deprecated`,
 * because `McpServer.registerTool` accepts Standard Schema (Zod) only. TypeBox 1.x
 * does not implement Standard Schema, and this package's Pi extension schemas are
 * TypeBox. The high-level API would force a second definition of every parameter.
 */
export function createMcpServer(): Server {
  const server = new Server({ name: 'web', version }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Object.values(toolsByName).map((tool): Tool => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as Tool['inputSchema'],
      annotations: tool.annotations,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
    if (!Object.hasOwn(toolsByName, name)) {
      return errorResult(`Unknown web tool: ${JSON.stringify(name)}`)
    }
    const tool = toolsByName[name]

    const args = request.params.arguments ?? {}
    if (!Value.Check(tool.inputSchema, args)) {
      return errorResult(validationError(tool.inputSchema, args))
    }

    try {
      const result = await tool.execute(args)
      // Text-result contract: the payload is JSON-encoded text and
      // structuredContent stays unset, because clients that see structured
      // output prefer it over content and would hide the readable answer.
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (error) {
      return errorResult(
        `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })

  return server
}
