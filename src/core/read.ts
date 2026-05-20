import type { ReadOptions, ReadResult } from './types.ts'
import { builtinProviders } from './providers.ts'
import { EmptyUrlError, ReadNotSupportedError } from './errors.ts'
import { create } from './registry.ts'

export const readProviderNames = ['jina'] as const
export type ReadProviderName = typeof readProviderNames[number]

export interface ReadUrlOptions extends ReadOptions {
  provider?: ReadProviderName | (string & {})
}

const DEFAULT_READ_PROVIDER: ReadProviderName = 'jina'

export async function readUrl(url: string, options?: ReadUrlOptions): Promise<ReadResult> {
  const trimmedUrl = url.trim()
  if (!trimmedUrl) {
    throw new EmptyUrlError()
  }

  const { provider: requestedProvider, ...readOptions } = options ?? {}
  const providerName = requestedProvider?.trim() || DEFAULT_READ_PROVIDER
  if (isBuiltinProvider(providerName) && !isReadProviderName(providerName)) {
    throw new ReadNotSupportedError(providerName)
  }

  const provider = create(providerName)
  if (typeof provider.read !== 'function') {
    throw new ReadNotSupportedError(providerName)
  }

  return provider.read(trimmedUrl, readOptions)
}

function isBuiltinProvider(name: string): boolean {
  return (builtinProviders as readonly string[]).includes(name)
}

function isReadProviderName(name: string): name is ReadProviderName {
  return (readProviderNames as readonly string[]).includes(name)
}
