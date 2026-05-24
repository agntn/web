import { builtinProviders, type WebSearchProviderName } from './providers.ts'
import { create, has } from './registry.ts'
import { NoProviderAvailableError, NoProviderConfiguredError } from './errors.ts'

const envKeys: Record<string, WebSearchProviderName> = {
  EXA_API_KEY: 'exa',
  BRAVE_API_KEY: 'brave',
  FIRECRAWL_API_KEY: 'firecrawl',
  JINA_API_KEY: 'jina',
  TAVILY_API_KEY: 'tavily',
  SERPAPI_API_KEY: 'serpapi',
  SERPBASE_API_KEY: 'serpbase',
}

function envVarFor(name: WebSearchProviderName): string | null {
  return name === 'searxng' ? null : `${name.toUpperCase()}_API_KEY`
}

export function detectAvailableProviders(): WebSearchProviderName[] {
  const available: WebSearchProviderName[] = []

  for (const [envVar, name] of Object.entries(envKeys)) {
    if (process.env[envVar]) {
      available.push(name)
    }
  }

  if (has('searxng')) {
    available.push('searxng')
  }

  return available
}

export function resolveDefaultProvider(): WebSearchProviderName {
  for (const [envVar, name] of Object.entries(envKeys)) {
    if (process.env[envVar]) {
      return name
    }
  }

  if (has('searxng')) {
    return 'searxng'
  }

  throw new NoProviderConfiguredError()
}

export interface ProviderStatus {
  name: WebSearchProviderName
  configured: boolean
  envVar: string | null
  /**
   * Set by {@link listProvidersAsync} when the provider implements
   * {@link SearchProvider.isAvailable}. `true` = probe succeeded, `false` =
   * probe failed (host down / unreachable / timeout), `undefined` = no probe
   * was performed (sync caller) or provider has no probe (trust `configured`).
   */
  reachable?: boolean
}

export function listProviders(): ProviderStatus[] {
  const available = detectAvailableProviders()
  return builtinProviders.map(name => ({
    name,
    configured: available.includes(name),
    envVar: envVarFor(name),
  }))
}

/**
 * Async variant: returns only providers that are both declaratively configured
 * (env var present or registered) AND — if they implement `isAvailable()` —
 * pass the reachability probe. Use for fan-out flows (`searchAll`) where an
 * unreachable self-hosted endpoint should be skipped instead of producing a
 * connection-refused error. Sync {@link detectAvailableProviders} stays the
 * declarative source of truth for env-var inspection.
 */
export async function detectAvailableProvidersAsync(): Promise<WebSearchProviderName[]> {
  const candidates = detectAvailableProviders()
  const probes = await Promise.all(candidates.map(async name => {
    const reachable = await probeConfiguredProvider(name)
    return reachable === false ? null : name
  }))
  return probes.filter((n): n is WebSearchProviderName => n !== null)
}

/**
 * Async variant of {@link listProviders} that also runs the per-provider
 * reachability probe and surfaces it as `reachable` on each row. Providers
 * without an `isAvailable()` probe get `reachable: undefined` (trust
 * `configured`).
 */
export async function listProvidersAsync(): Promise<ProviderStatus[]> {
  const available = detectAvailableProviders()
  return Promise.all(builtinProviders.map(async name => {
    const configured = available.includes(name)
    const base: ProviderStatus = { name, configured, envVar: envVarFor(name) }
    if (!configured) return base
    const reachable = await probeConfiguredProvider(name)
    return reachable === undefined ? base : { ...base, reachable }
  }))
}

/**
 * Async variant of {@link resolveDefaultProvider}: returns the first provider
 * that is configured AND (if it has an `isAvailable()` probe) reachable. Use
 * in flows that should not crash when the env-preferred default is down
 * (e.g. SearXNG on `localhost:8080` without a running instance).
 */
export async function resolveDefaultProviderAsync(): Promise<WebSearchProviderName> {
  const candidates = detectAvailableProviders()
  for (const name of candidates) {
    const reachable = await probeConfiguredProvider(name)
    if (reachable !== false) {
      return name
    }
  }

  if (candidates.length === 0) {
    throw new NoProviderConfiguredError()
  }
  throw new NoProviderAvailableError(candidates)
}

async function probeConfiguredProvider(name: WebSearchProviderName): Promise<boolean | undefined> {
  try {
    const provider = create(name)
    if (typeof provider.isAvailable !== 'function') return undefined
    return await provider.isAvailable()
  }
  catch {
    return false
  }
}
