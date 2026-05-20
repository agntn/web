import { defineCommand } from 'citty'
import { consola } from 'consola'

export default defineCommand({
  meta: {
    name: 'read',
    description: 'Read a URL using a provider',
  },
  args: {
    url: {
      type: 'positional',
      description: 'URL to read',
      required: true,
    },
    provider: {
      type: 'string',
      description: 'Read provider to use',
      default: 'jina',
    },
    format: {
      type: 'string',
      description: 'Response format: markdown, text, or html',
    },
    'max-tokens': {
      type: 'string',
      description: 'Maximum tokens to return',
    },
    json: {
      type: 'boolean',
      description: 'Output as JSON',
      default: false,
    },
  },
  async run({ args }) {
    const { readUrl } = await import('../core/read.ts')
    const { AuthError, UnknownProviderError, EmptyUrlError, ReadNotSupportedError } = await import('../core/errors.ts')
    let providerName = args.provider || 'jina'

    try {
      if (!args.url.trim()) {
        consola.error('Read URL cannot be empty.')
        process.exit(1)
      }

      const format = parseFormat(args.format)
      if (!format.ok) {
        consola.error(format.message)
        process.exit(1)
      }

      const maxTokens = parseOptionalPositiveInt(args['max-tokens'], '--max-tokens')
      if (!maxTokens.ok) {
        consola.error(maxTokens.message)
        process.exit(1)
      }

      await import('../providers/index.ts')
      providerName = args.provider || 'jina'
      const result = await readUrl(args.url, {
        provider: providerName,
        format: format.value,
        maxTokens: maxTokens.value,
      })

      if (args.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
        return
      }

      if (result.title) {
        consola.log(`\x1b[1m\x1b[36m${result.title}\x1b[0m`)
      }
      consola.log(`  ${result.url}`)
      if (result.description) {
        consola.log(`  \x1b[90m${truncateSingleLine(result.description, 160)}\x1b[0m`)
      }
      consola.log('')
      consola.log(result.content)
    }
    catch (error) {
      if (error instanceof EmptyUrlError) {
        consola.error('Read URL cannot be empty.')
        process.exit(1)
      }
      if (error instanceof AuthError) {
        const authProvider = providerName || error.provider
        consola.error(`Authentication failed for provider "${authProvider}".`)
        consola.info(`Set the ${authProvider.toUpperCase()}_API_KEY environment variable.`)
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
      if (error instanceof ReadNotSupportedError) {
        consola.error(error.message)
        process.exit(1)
      }
      throw error
    }
  },
})

type ParsedOptionalNumber =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string }

type ParsedFormat =
  | { ok: true; value: 'markdown' | 'text' | 'html' | undefined }
  | { ok: false; message: string }

function parseOptionalPositiveInt(input: string | undefined, flagName: string): ParsedOptionalNumber {
  if (input == null || input === '') {
    return { ok: true, value: undefined }
  }
  if (!/^\d+$/.test(input)) {
    return { ok: false, message: `Invalid ${flagName} value. Expected a positive integer.` }
  }
  const value = Number.parseInt(input, 10)
  if (value < 1) {
    return { ok: false, message: `Invalid ${flagName} value. Expected a positive integer.` }
  }
  return { ok: true, value }
}

function parseFormat(input: string | undefined): ParsedFormat {
  if (input == null || input === '') {
    return { ok: true, value: undefined }
  }
  if (input === 'markdown' || input === 'text' || input === 'html') {
    return { ok: true, value: input }
  }
  return { ok: false, message: 'Invalid --format value. Expected markdown, text, or html.' }
}

function truncateSingleLine(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, ' ').trim()
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`
}
