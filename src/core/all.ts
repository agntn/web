import type { SearchResult, SearchOptions } from './types.ts'
import { UnknownProviderError, NoProviderConfiguredError, NoProviderAvailableError, EmptyQueryError, validateDateFilters } from './errors.ts'
import { createSearchProvider, has } from './registry.ts'
import { detectAvailableProviders, detectAvailableProvidersAsync } from './resolve.ts'

export interface SearchAllOptions extends SearchOptions {
  providers?: string[]
}

export interface SearchAllResult extends SearchResult {
  provider: string
}

export interface ProviderError {
  provider: string
  error: Error
}

export interface SearchAllResponse {
  results: SearchAllResult[]
  errors: ProviderError[]
}

/**
 * Query multiple providers in parallel and return deduplicated results.
 * Providers are auto-detected from env vars unless explicitly specified.
 * Individual provider failures don't affect other results.
 */
export async function searchAll(query: string, options?: SearchAllOptions): Promise<SearchAllResult[]> {
  const response = await searchAllDetailed(query, options)
  return response.results
}

/**
 * Like {@link searchAll}, but also returns per-provider errors so callers
 * can tell which providers failed and why.
 */
export async function searchAllDetailed(query: string, options?: SearchAllOptions): Promise<SearchAllResponse> {
  if (!query.trim()) {
    throw new EmptyQueryError()
  }

  validateDateFilters(options?.startPublishedDate, options?.endPublishedDate)

  const { providers: providerList, ...searchOptions } = options ?? {}

  if (providerList) {
    const unknown = providerList.find(name => !has(name))
    if (unknown) {
      throw new UnknownProviderError(unknown)
    }
  }

  const providerNames = providerList ?? await detectAvailableProvidersAsync()

  if (providerNames.length === 0) {
    if (providerList !== undefined) {
      throw new NoProviderConfiguredError()
    }

    const configuredProviders = detectAvailableProviders()
    if (configuredProviders.length === 0) {
      throw new NoProviderConfiguredError()
    }
    throw new NoProviderAvailableError(configuredProviders)
  }

  const settled = await Promise.allSettled(
    providerNames.map(async (name) => {
      const provider = createSearchProvider(name)
      const results = await provider.search(query, searchOptions)
      return results.map(result => ({ ...result, provider: name }))
    }),
  )

  const allResults: SearchAllResult[] = []
  const errors: ProviderError[] = []

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      allResults.push(...result.value)
    } else {
      errors.push({
        provider: providerNames[i],
        error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
      })
    }
  }

  return {
    results: deduplicateByUrl(allResults),
    errors,
  }
}




function deduplicateByUrl(results: SearchAllResult[]): SearchAllResult[] {
  const seen = new Map<string, SearchAllResult>()

  for (const result of results) {
    const normalized = normalizeUrl(result.url)
    const existing = seen.get(normalized)

    if (!existing) {
      seen.set(normalized, result)
    } else {
      if (result.score != null && (existing.score == null || result.score > existing.score)) {
        seen.set(normalized, result)
      }
    }
  }

  return Array.from(seen.values())
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    const search = canonicalizeSearchParams(parsed.searchParams)
    return `${parsed.protocol}//${parsed.host}${path}${search}`
  } catch {
    return url
  }
}

function canonicalizeSearchParams(searchParams: URLSearchParams): string {
  const filteredSortedEntries = Array.from(searchParams.entries())
    .filter(([key]) => !isTrackingParam(key))
    .map(([key, value], index) => ({ key, value, index }))
    .sort((a, b) => {
      const keyOrder = a.key.localeCompare(b.key, 'en')
      if (keyOrder !== 0) {
        return keyOrder
      }

      return a.index - b.index
    })
    .map(({ key, value }): [string, string] => [key, value])

  if (filteredSortedEntries.length === 0) {
    return ''
  }

  return `?${new URLSearchParams(filteredSortedEntries).toString()}`
}

function isTrackingParam(key: string): boolean {
  return key.toLowerCase().startsWith('utm_')
}
