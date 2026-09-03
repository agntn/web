import { builtinProviders, providerDetectionOrder } from "./providers.ts";
import {
  create,
  getProviderApiKeyEnvVar,
  getProviderCapabilities,
  getSearchFilterCapabilities,
  providers,
  searchProviders,
} from "./registry.ts";
import { NoProviderAvailableError, NoProviderConfiguredError } from "./errors.ts";
import { isAvailabilityProvider, type ProviderCapabilities } from "./provider.ts";
import type { SearchFilterName } from "./types.ts";

/**
 * Return whether a registered provider has no key requirement or a configured API key.
 * @param {string} name - Provider name to inspect.
 * @returns {boolean} Whether automatic selection may use the provider.
 */
export function isProviderConfigured(name: string): boolean {
  const envVar = getProviderApiKeyEnvVar(name);
  return envVar === null || Boolean(process.env[envVar]);
}

export function detectAvailableProviders(): string[] {
  return orderedSearchProviders().filter(isProviderConfigured);
}

export function resolveDefaultProvider(): string {
  const provider = detectAvailableProviders()[0];
  if (provider !== undefined) return provider;
  throw new NoProviderConfiguredError();
}

export interface ProviderStatus {
  name: string;
  configured: boolean;
  envVar: string | null;
  /**
   * Set by {@link listProvidersAsync} when the provider implements
   * {@link AvailabilityProvider.isAvailable}. `true` = probe succeeded,
   * `false` = probe failed (host down / unreachable / timeout), `undefined` =
   * no reachability probe was performed (trust `configured`).
   */
  reachable?: boolean;
  readonly searchFilters?: readonly SearchFilterName[];
  readonly searchCategories?: readonly string[];
  readonly capabilities: ProviderCapabilities;
}

export function listProviders(): ProviderStatus[] {
  return orderedRegisteredProviders().map((name) =>
    providerStatus(name, isProviderConfigured(name)),
  );
}

/**
 * Async variant: returns only providers that are both declaratively configured
 * (env var present or registered) AND — if they implement `isAvailable()` —
 * pass the reachability probe. Use for fan-out flows (`searchAll`) where an
 * unreachable self-hosted endpoint should be skipped instead of producing a
 * connection-refused error. Sync {@link detectAvailableProviders} stays the
 * declarative source of truth for env-var inspection.
 * @returns {Promise<string[]>} Configured and reachable provider names.
 */
export async function detectAvailableProvidersAsync(): Promise<string[]> {
  const candidates = detectAvailableProviders();
  const probes = await Promise.all(
    candidates.map(async (name) => {
      const reachable = await probeConfiguredProvider(name);
      return reachable === false ? null : name;
    }),
  );
  return probes.filter((name): name is string => name !== null);
}

/**
 * Async variant of {@link listProviders} that also runs the per-provider
 * reachability probe and surfaces it as `reachable` on each row. Providers
 * without an `isAvailable()` probe get `reachable: undefined` (trust
 * `configured`).
 * @returns {Promise<ProviderStatus[]>} Provider status rows.
 */
export async function listProvidersAsync(): Promise<ProviderStatus[]> {
  return Promise.all(
    orderedRegisteredProviders().map(async (name) => {
      const configured = isProviderConfigured(name);
      const base = providerStatus(name, configured);
      if (!configured) return base;
      const reachable = await probeConfiguredProvider(name);
      return reachable === undefined ? base : { ...base, reachable };
    }),
  );
}

/**
 * Async variant of {@link resolveDefaultProvider}: returns the first provider
 * that is configured AND (if it has an `isAvailable()` probe) reachable. Use
 * in flows that should not crash when the env-preferred default is down
 * (e.g. SearXNG on `localhost:8080` without a running instance).
 * @returns {Promise<string>} First reachable configured provider.
 */
export async function resolveDefaultProviderAsync(): Promise<string> {
  const candidates = detectAvailableProviders();
  for (const name of candidates) {
    const reachable = await probeConfiguredProvider(name);
    if (reachable !== false) {
      return name;
    }
  }

  if (candidates.length === 0) {
    throw new NoProviderConfiguredError();
  }
  throw new NoProviderAvailableError(candidates);
}

function providerStatus(name: string, configured: boolean): ProviderStatus {
  const searchCapabilities = getSearchFilterCapabilities(name);
  const capabilities = getProviderCapabilities(name);
  if (capabilities === undefined) {
    throw new TypeError(`Registered provider ${name} has no capability metadata`);
  }
  return {
    name,
    configured,
    envVar: getProviderApiKeyEnvVar(name),
    ...(searchCapabilities === undefined ? {} : { searchFilters: searchCapabilities.filters }),
    ...(searchCapabilities?.categories === undefined
      ? {}
      : { searchCategories: searchCapabilities.categories }),
    capabilities,
  };
}

async function probeConfiguredProvider(name: string): Promise<boolean | undefined> {
  try {
    const provider = create(name);
    if (!isAvailabilityProvider(provider)) return undefined;
    return await provider.isAvailable();
  } catch {
    return false;
  }
}

function orderedRegisteredProviders(): string[] {
  const registered = providers();
  const builtins = builtinProviders.filter((name) => registered.includes(name));
  const custom = registered.filter(
    (name) => !(builtinProviders as readonly string[]).includes(name),
  );
  return [...builtins, ...custom];
}

function orderedSearchProviders(): string[] {
  const registered = searchProviders();
  const known = providerDetectionOrder.filter((name) => registered.includes(name));
  const knownNames = new Set<string>(known);
  const custom = registered.filter(
    (name) => !(builtinProviders as readonly string[]).includes(name),
  );
  const remainingBuiltins = builtinProviders.filter(
    (name) => registered.includes(name) && !knownNames.has(name),
  );
  return [...known, ...custom, ...remainingBuiltins];
}
