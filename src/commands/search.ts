import { defineCommand } from 'citty'
import { consola } from 'consola'

export default defineCommand({
  meta: {
    name: 'search',
    description: 'Search the web using a provider',
  },
  args: {
    query: {
      type: 'positional',
      description: 'Search query',
      required: true,
    },
    provider: {
      type: 'string',
      description: 'Search provider to use',
    },
    'max-results': {
      type: 'string',
      description: 'Maximum number of results',
      default: '10',
    },
    json: {
      type: 'boolean',
      description: 'Output as JSON',
      default: false,
    },
  },
  async run({ args }) {
    const { createSearchProvider } = await import('../core/registry.ts')
    const { isDetailedSearchProvider } = await import('../core/provider.ts')
    const { resolveDefaultProvider } = await import('../core/resolve.ts')
    const { AuthError, SearchNotSupportedError, UnknownProviderError, NoProviderConfiguredError } = await import('../core/errors.ts')
    let providerName = args.provider

    try {
      if (!args.query.trim()) {
        consola.error('Search query cannot be empty.')
        process.exit(1)
      }

      const maxResults = parseMaxResults(args['max-results'])
      if (!maxResults.ok) {
        consola.error(maxResults.message)
        process.exit(1)
      }

      providerName = args.provider || resolveDefaultProvider()
      await import('../providers/index.ts')
      const provider = createSearchProvider(providerName, {})
      const options = { maxResults: maxResults.value }

      if (args.json && isDetailedSearchProvider(provider)) {
        const response = await provider.searchDetailed(args.query, options)
        process.stdout.write(`${JSON.stringify(response, null, 2)}\n`)
        return
      }

      const results = await provider.search(args.query, options)
      if (args.json) {
        process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
        return
      }

      if (results.length === 0) {
        consola.info('No results found.')
        return
      }

      for (const result of results) {
        consola.log(`\x1b[1m\x1b[36m${result.title}\x1b[0m`)
        consola.log(`  ${result.url}`)
        if (result.snippet) {
          const truncated = result.snippet.length > 120
            ? result.snippet.slice(0, 120) + '...'
            : result.snippet
          consola.log(`  \x1b[90m${truncated}\x1b[0m`)
        }
        consola.log('')
      }
    }
    catch (error) {
      if (error instanceof AuthError) {
        const authProvider = providerName || error.provider
        consola.error(`Authentication failed for provider "${authProvider}".`)
        consola.info(`Set the ${authProvider.toUpperCase()}_API_KEY environment variable.`)
        process.exit(1)
      }
      if (error instanceof SearchNotSupportedError) {
        consola.error(`Provider "${error.provider}" does not support web search.`)
        process.exit(1)
      }
      if (error instanceof UnknownProviderError) {
        const { providers } = await import('../core/registry.ts')
        consola.error(`Unknown provider: ${providerName}`)
        const available = providers()
        if (available.length > 0) {
          consola.info(`Available providers: ${available.join(', ')}`)
        } else {
          consola.info('No providers registered. Import a provider first.')
        }
        process.exit(1)
      }
      if (error instanceof NoProviderConfiguredError) {
        await import('../providers/index.ts')
        const { providers } = await import('../core/registry.ts')
        const available = providers()
        consola.error(error.message)
        if (available.length > 0) {
          consola.info(`Registered providers: ${available.join(', ')}`)
          consola.info('Set one provider API key env var or pass --provider explicitly.')
        }
        process.exit(1)
      }
      throw error
    }
  },
})

type ParsedMaxResults =
  | { ok: true; value: number }
  | { ok: false; message: string }

function parseMaxResults(input: string): ParsedMaxResults {
  if (!/^\d+$/.test(input)) {
    return {
      ok: false,
      message: 'Invalid --max-results value. Expected a positive integer.',
    }
  }

  const value = Number.parseInt(input, 10)
  if (value < 1) {
    return {
      ok: false,
      message: 'Invalid --max-results value. Expected a positive integer.',
    }
  }

  return { ok: true, value }
}
