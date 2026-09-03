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
import { settleWithConcurrency, throwIfAborted, withExecutionBudget } from "./execution.ts";
import type { ExecutionOptions, SearchFilterName } from "./types.ts";

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
 * @param options - Shared cancellation, deadline, and concurrency controls.
 * @returns {Promise<string[]>} Configured and reachable provider names.
 */
export async function detectAvailableProvidersAsync(
  options?: Readonly<ExecutionOptions>,
): Promise<string[]> {
  const candidates = detectAvailableProviders();
  const executionOptions = withExecutionBudget(options);
  const signal = executionOptions.signal;
  throwIfAborted(signal);
  const probes = await settleWithConcurrency(
    candidates,
    async (name, _index, workerSignal) => {
      const reachable = await probeConfiguredProvider(name, workerSignal);
      return reachable === false ? null : name;
    },
    executionOptions,
  );
  throwIfAborted(signal);
  return probes.flatMap((probe) =>
    probe.status === "fulfilled" && probe.value !== null ? [probe.value] : [],
  );
}

/**
 * Async variant of {@link listProviders} that also runs the per-provider
 * reachability probe and surfaces it as `reachable` on each row. Providers
 * without an `isAvailable()` probe get `reachable: undefined` (trust
 * `configured`).
 * @param options - Shared cancellation, deadline, and concurrency controls.
 * @returns {Promise<ProviderStatus[]>} Provider status rows.
 */
export async function listProvidersAsync(
  options?: Readonly<ExecutionOptions>,
): Promise<ProviderStatus[]> {
  const executionOptions = withExecutionBudget(options);
  const signal = executionOptions.signal;
  throwIfAborted(signal);
  const statuses = await settleWithConcurrency(
    orderedRegisteredProviders(),
    async (name, _index, workerSignal) => {
      const configured = isProviderConfigured(name);
      const base = providerStatus(name, configured);
      if (!configured) return base;
      const reachable = await probeConfiguredProvider(name, workerSignal);
      return reachable === undefined ? base : { ...base, reachable };
    },
    executionOptions,
  );
  throwIfAborted(signal);
  return statuses.flatMap((status) => (status.status === "fulfilled" ? [status.value] : []));
}

/**
 * Async variant of {@link resolveDefaultProvider}: returns the first provider
 * that is configured AND (if it has an `isAvailable()` probe) reachable. Use
 * in flows that should not crash when the env-preferred default is down
 * (e.g. SearXNG on `localhost:8080` without a running instance).
 * @param options - Shared cancellation and deadline controls.
 * @returns {Promise<string>} First reachable configured provider.
 */
export async function resolveDefaultProviderAsync(
  options?: Readonly<ExecutionOptions>,
): Promise<string> {
  const candidates = detectAvailableProviders();
  const signal = withExecutionBudget(options).signal;
  for (const name of candidates) {
    throwIfAborted(signal);
    const reachable = await probeConfiguredProvider(name, signal);
    throwIfAborted(signal);
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

async function probeConfiguredProvider(
  name: string,
  signal?: Readonly<AbortSignal>,
): Promise<boolean | undefined> {
  try {
    const provider = create(name);
    if (!isAvailabilityProvider(provider)) return undefined;
    return await provider.isAvailable(signal);
  } catch {
    throwIfAborted(signal);
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
