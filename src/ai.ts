import { tool } from 'ai'
import { z } from 'zod'
import { builtinProviders } from './core/providers.ts'
import { create } from './core/registry.ts'
import { searchAll } from './core/all.ts'
import { readProviderNames, readUrl } from './core/read.ts'
import { EmptyQueryError, EmptyUrlError } from './core/errors.ts'
import { resolveDefaultProvider, listProviders } from './core/resolve.ts'
import './providers/index.ts'

const providerNames = [...builtinProviders, 'all'] as const

export const searchTool = tool({
  description: 'Search the web using multiple search engines (Brave, Exa, Jina, Tavily, SerpAPI, SerpBase, SearXNG). Returns relevant web pages with titles, URLs, snippets, and optional metadata. Use provider "all" to query all available providers in parallel and get deduplicated results.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    provider: z.enum(providerNames).optional().describe('Provider to use. Defaults to first available from env. Use "all" for parallel search.'),
    maxResults: z.number().min(1).max(20).optional().describe('Max results (default: 10)'),
    includeDomains: z.array(z.string()).optional().describe('Only return results from these domains (e.g. ["github.com", "stackoverflow.com"])'),
    excludeDomains: z.array(z.string()).optional().describe('Exclude results from these domains'),
    category: z.string().optional().describe('Search category (e.g. "news", "general"). Provider support varies.'),
    startPublishedDate: z.string().optional().describe('Filter results published after this date (ISO 8601, e.g. "2024-01-01")'),
    endPublishedDate: z.string().optional().describe('Filter results published before this date (ISO 8601)'),
  }),
  execute: async ({ query, provider: providerName, maxResults, includeDomains, excludeDomains, category, startPublishedDate, endPublishedDate }) => {
    if (!query.trim()) {
      throw new EmptyQueryError()
    }

    const searchOptions = { maxResults, includeDomains, excludeDomains, category, startPublishedDate, endPublishedDate }

    if (providerName === 'all') {
      return searchAll(query, searchOptions)
    }

    const name = providerName ?? resolveDefaultProvider()
    return create(name).search(query, searchOptions)
  },
})

export const readTool = tool({
  description: 'Read a URL into normalized content using a read-capable provider. Defaults to Jina Reader (r.jina.ai). Returns URL, title/description when available, canonical content, and optional text/html/images/metadata.',
  inputSchema: z.object({
    url: z.string().describe('URL to read'),
    provider: z.enum(readProviderNames).optional().describe('Read provider to use. Defaults to Jina.'),
    format: z.enum(['markdown', 'text', 'html']).optional().describe('Preferred content format.'),
    maxTokens: z.number().min(1).optional().describe('Maximum tokens to return when supported by the provider.'),
    targetSelector: z.string().optional().describe('CSS selector to target when supported by the provider.'),
    removeSelector: z.string().optional().describe('CSS selector to remove when supported by the provider.'),
    timeout: z.number().min(1).optional().describe('Provider timeout in seconds when supported.'),
    noCache: z.boolean().optional().describe('Bypass provider cache when supported.'),
  }),
  execute: async ({ url, provider, format, maxTokens, targetSelector, removeSelector, timeout, noCache }) => {
    if (!url.trim()) {
      throw new EmptyUrlError()
    }

    return readUrl(url, { provider, format, maxTokens, targetSelector, removeSelector, timeout, noCache })
  },
})

export const providersTool = tool({
  description: 'List available web search providers and their configuration status.',
  inputSchema: z.object({}),
  execute: async () => listProviders(),
})
