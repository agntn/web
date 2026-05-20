import type { ReadOptions, ReadResult } from './types.ts'
import { EmptyUrlError, ReadNotSupportedError } from './errors.ts'
import { create } from './registry.ts'

export interface ReadUrlOptions extends ReadOptions {
  provider?: string
}

const DEFAULT_READ_PROVIDER = 'jina'

export async function readUrl(url: string, options?: ReadUrlOptions): Promise<ReadResult> {
  const trimmedUrl = url.trim()
  if (!trimmedUrl) {
    throw new EmptyUrlError()
  }

  const { provider: requestedProvider, ...readOptions } = options ?? {}
  const providerName = requestedProvider?.trim() || DEFAULT_READ_PROVIDER
  const provider = create(providerName)
  if (typeof provider.read !== 'function') {
    throw new ReadNotSupportedError(providerName)
  }

  return provider.read(trimmedUrl, readOptions)
}
