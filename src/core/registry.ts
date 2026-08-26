import type { ProviderConfig } from "./types.ts";
import {
  Provider,
  isReadProvider,
  isSearchProvider,
  type ProviderConstructor,
  type ReadProvider,
  type SearchProvider,
} from "./provider.ts";
import { ReadNotSupportedError, SearchNotSupportedError, UnknownProviderError } from "./errors.ts";

const providerClasses = new Map<string, ProviderConstructor>();

/**
 * Register a provider class.
 * Called by providers on import to self-register.
 * @param {ProviderConstructor} provider - Provider class to register.
 */
export function register(provider: ProviderConstructor): void {
  providerClasses.set(provider.providerName, provider);
}

/**
 * Create a provider instance by name.
 * Resolves apiKey from config or environment variable (PROVIDER_NAME_API_KEY).
 * @param {string} name - Registered provider name.
 * @param {ProviderConfig} config - Provider configuration.
 * @returns {Provider} Configured provider instance.
 */
export function create(name: string, config?: Readonly<ProviderConfig>): Provider {
  const ProviderClass = providerClasses.get(name);
  if (!ProviderClass) {
    throw new UnknownProviderError(name);
  }

  const apiKey = config?.apiKey || process.env[`${name.toUpperCase()}_API_KEY`];

  return new ProviderClass({
    ...config,
    apiKey,
    baseURL: config?.baseURL || ProviderClass.defaultBaseURL,
  });
}

export function createSearchProvider(
  name: string,
  config?: Readonly<ProviderConfig>,
): Provider & SearchProvider {
  const provider = create(name, config);
  if (!isSearchProvider(provider)) {
    throw new SearchNotSupportedError(name);
  }
  return provider;
}

export function createReadProvider(
  name: string,
  config?: Readonly<ProviderConfig>,
): Provider & ReadProvider {
  const provider = create(name, config);
  if (!isReadProvider(provider)) {
    throw new ReadNotSupportedError(name);
  }
  return provider;
}

export function providers(): string[] {
  return Array.from(providerClasses.keys());
}

export function has(name: string): boolean {
  return providerClasses.has(name);
}
