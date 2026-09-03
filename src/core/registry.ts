import type { ProviderConfig, SearchFilterCapabilities } from "./types.ts";
import { providerApiKeyEnvVar } from "./providers.ts";
import {
  Provider,
  isImageSearchProvider,
  isPaginatedSearchProvider,
  isReadProvider,
  isSearchProvider,
  type ImageSearchProvider,
  type ProviderCapabilities,
  type ProviderCapability,
  type ProviderConstructor,
  type ProviderImageSearchCapabilities,
  type ProviderReadCapabilities,
  type ProviderSearchCapabilities,
  type ReadProvider,
  type SearchProvider,
} from "./provider.ts";
import {
  ImageSearchNotSupportedError,
  ReadNotSupportedError,
  SearchNotSupportedError,
  UnknownProviderError,
} from "./errors.ts";

interface ProviderRegistration {
  readonly provider: ProviderConstructor;
  readonly previous?: ProviderRegistration;
}

const providerClasses = new Map<string, ProviderConstructor>();
const providerRegistrations = new Map<string, ProviderRegistration>();
const removedRegistrations = new WeakSet<ProviderRegistration>();

/**
 * Register a provider class.
 * Called by providers on import to self-register.
 * @param {ProviderConstructor} provider - Provider class to register.
 * @returns {() => void} A function that removes this registration when it is still current.
 */
export function register(provider: ProviderConstructor): () => void {
  assertProviderName(provider.providerName);
  const registration: ProviderRegistration = {
    provider,
    previous: providerRegistrations.get(provider.providerName),
  };
  providerRegistrations.set(provider.providerName, registration);
  providerClasses.set(provider.providerName, provider);
  return () => removeRegistration(provider.providerName, registration);
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

  const envVar = getProviderApiKeyEnvVar(name);
  const apiKey = config?.apiKey || (envVar === null ? undefined : process.env[envVar]);

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

/**
 * Create a provider that implements reverse image search.
 * @param name - Registered provider name.
 * @param config - Provider configuration.
 * @returns {Provider & ImageSearchProvider} A provider with reverse image search support.
 */
export function createImageSearchProvider(
  name: string,
  config?: Readonly<ProviderConfig>,
): Provider & ImageSearchProvider {
  const provider = create(name, config);
  if (!isImageSearchProvider(provider)) {
    throw new ImageSearchNotSupportedError(name);
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

/**
 * Return every registered provider name in registration order.
 * @returns {string[]} Registered provider names.
 */
export function providers(): string[] {
  return Array.from(providerClasses.keys());
}

/**
 * Return registered providers that implement text search.
 * @returns {string[]} Search provider names.
 */
export function searchProviders(): string[] {
  return providerNamesWithCapability("search", isSearchProvider);
}

/**
 * Return registered providers that implement reverse image search.
 * @returns {string[]} Image search provider names.
 */
export function searchImageProviders(): string[] {
  return providerNamesWithCapability("searchImage", isImageSearchProvider);
}

/**
 * Return registered providers that implement URL reading.
 * @returns {string[]} Read provider names.
 */
export function readProviders(): string[] {
  return providerNamesWithCapability("read", isReadProvider);
}

/**
 * Return the API key variable declared by a provider or derived from its name.
 * @param {string} name - Registered or prospective provider name.
 * @returns {string | null} Environment variable name, or null for a keyless provider.
 */
export function getProviderApiKeyEnvVar(name: string): string | null {
  const declaredEnvVar = providerClasses.get(name)?.apiKeyEnvVar;
  return declaredEnvVar === undefined ? providerApiKeyEnvVar(name) : declaredEnvVar;
}

export function getSearchFilterCapabilities(name: string): SearchFilterCapabilities | undefined {
  return providerClasses.get(name)?.searchFilterCapabilities;
}

/**
 * Return the complete operation matrix declared by and inferred from a registered provider.
 * Optional details stay absent for backward-compatible custom providers that only implement methods.
 * @param name - Registered provider name.
 * @returns {ProviderCapabilities | undefined} Capability metadata, or undefined when the provider is not registered.
 */
export function getProviderCapabilities(name: string): ProviderCapabilities | undefined {
  const ProviderClass = providerClasses.get(name);
  if (!ProviderClass) return undefined;

  return {
    search: searchCapabilityStatus(ProviderClass),
    searchImage: imageSearchCapabilityStatus(ProviderClass),
    read: readCapabilityStatus(ProviderClass),
  };
}

function searchCapabilityStatus(ProviderClass: ProviderConstructor): ProviderSearchCapabilities {
  if (!providerSupportsCapability(ProviderClass, "search", isSearchProvider)) {
    return { supported: false };
  }
  const details = ProviderClass.capabilityDetails?.search;
  return {
    supported: true,
    ...ProviderClass.searchFilterCapabilities,
    ...(details
      ? {
          contentOptions: details.contentOptions,
          ...(details.resultLimit ? { resultLimit: details.resultLimit } : {}),
          resultFields: details.resultFields,
        }
      : {}),
    ...(isPaginatedSearchProvider(ProviderClass.prototype) ? { pagination: true } : {}),
  };
}

function imageSearchCapabilityStatus(
  ProviderClass: ProviderConstructor,
): ProviderImageSearchCapabilities {
  if (!providerSupportsCapability(ProviderClass, "searchImage", isImageSearchProvider)) {
    return { supported: false };
  }
  return {
    supported: true,
    ...ProviderClass.capabilityDetails?.searchImage,
  };
}

function readCapabilityStatus(ProviderClass: ProviderConstructor): ProviderReadCapabilities {
  if (!providerSupportsCapability(ProviderClass, "read", isReadProvider)) {
    return { supported: false };
  }
  return {
    supported: true,
    ...ProviderClass.capabilityDetails?.read,
  };
}

function providerNamesWithCapability(
  capability: ProviderCapability,
  predicate: (provider: object) => boolean,
): string[] {
  return Array.from(providerClasses.entries())
    .filter(([, ProviderClass]) => providerSupportsCapability(ProviderClass, capability, predicate))
    .map(([name]) => name);
}

function providerSupportsCapability(
  ProviderClass: ProviderConstructor,
  capability: ProviderCapability,
  predicate: (provider: object) => boolean,
): boolean {
  return (
    ProviderClass.capabilities?.includes(capability) === true || predicate(ProviderClass.prototype)
  );
}

function removeRegistration(name: string, registration: Readonly<ProviderRegistration>): void {
  if (removedRegistrations.has(registration)) return;
  removedRegistrations.add(registration);
  if (providerRegistrations.get(name) !== registration) return;

  let previous = registration.previous;
  while (previous !== undefined && removedRegistrations.has(previous)) {
    previous = previous.previous;
  }
  if (previous === undefined) {
    providerRegistrations.delete(name);
    providerClasses.delete(name);
    return;
  }
  providerRegistrations.set(name, previous);
  providerClasses.set(name, previous.provider);
}

function assertProviderName(name: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name === "auto" || name === "all") {
    throw new TypeError(
      'providerName must use lowercase ASCII letters, digits, and single internal hyphens, and cannot be "auto" or "all"',
    );
  }
}

export function has(name: string): boolean {
  return providerClasses.has(name);
}
