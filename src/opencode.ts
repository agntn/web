import type { Plugin } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import { encode } from '@toon-format/toon'
import { builtinProviders } from './core/providers.ts'
import { createSearchProvider } from './core/registry.ts'
import { searchAll } from './core/all.ts'
import { readProviderNames, readUrl } from './core/read.ts'
import { resolveDefaultProvider, listProviders } from './core/resolve.ts'
import './providers/index.ts'

const z = tool.schema
const providerNames = [...builtinProviders, 'all'] as const

const AskwebPlugin: Plugin = async () => ({
  tool: {
    askweb: tool({
      description: 'Search the web using multiple search engines (Brave, Exa, Jina, Tavily, SerpAPI, SerpBase, SearXNG). Returns relevant web pages with titles, URLs, snippets, and optional metadata. Use provider "all" to query all available providers in parallel and get deduplicated results.',
      args: {
        query: z.string().describe('Search query'),
        provider: z.enum(providerNames).optional().describe('Provider to use. Defaults to first available from env. Use "all" for parallel search.'),
        maxResults: z.number().min(1).max(20).optional().describe('Max results (default: 10)'),
      },
      async execute(args) {
        const { query, provider: providerName, maxResults } = args

        if (providerName === 'all') {
          return encode(await searchAll(query, { maxResults }))
        }

        const name = providerName ?? resolveDefaultProvider()
        return encode(await createSearchProvider(name).search(query, { maxResults }))
      },
    }),
    askweb_read: tool({
      description: 'Read a URL into normalized content using a read-capable provider. Defaults to Jina Reader (r.jina.ai).',
      args: {
        url: z.string().describe('URL to read'),
        provider: z.enum(readProviderNames).optional().describe('Read provider to use. Defaults to Jina.'),
        format: z.enum(['markdown', 'text', 'html']).optional().describe('Preferred content format.'),
        maxTokens: z.number().min(1).optional().describe('Maximum tokens to return when supported by the provider.'),
      },
      async execute(args) {
        const { url, provider, format, maxTokens } = args
        return encode(await readUrl(url, { provider, format, maxTokens }))
      },
    }),
    askweb_providers: tool({
      description: 'List available web search providers and their configuration status.',
      args: {},
      async execute() {
        return encode(listProviders())
      },
    }),
  },
})

export { AskwebPlugin }
export default AskwebPlugin
