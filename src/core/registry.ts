import type { ProviderConfig, SearchFilterCapabilities } from "./types.ts";
import { providerApiKeyEnvVar } from "./providers.ts";
import {
  isAvailabilityProvider,
  isImageSearchProvider,
  isPaginatedSearchProvider,
  isReadProvider,
  isSearchProvider,
  type ImageSearchProvider,
  type Provider,
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
  WebError,
} from "./errors.ts";
import { builtins } from "../providers/index.ts";

/**
 * One provider the registry knows: the metadata every listing and capability lookup answers from,
 * plus a loader for the class. A built-in entry's `load` is a literal `import()` of its module, so
 * the module runs on the first `create()` for that name and never on package import.
 */
export interface ProviderEntry {
  readonly name: string;
  /** API key variable; `null` when registering is enough to count as configured; absent derives `<NAME>_API_KEY`. */
  readonly apiKeyEnvVar?: string | null;
  /** Local configuration check for providers whose credentials are more than one variable. */
  readonly isConfigured?: () => boolean;
  /** Whether instances answer `isAvailable()`, so discovery can probe without loading the rest. */
  readonly availability?: boolean;
  /** Search capability as discovery reports it; absent when the provider does not search. */
  readonly search?: Omit<ProviderSearchCapabilities, "supported">;
  /** Reverse image search capability; absent when the provider does not implement it. */
  readonly searchImage?: Omit<ProviderImageSearchCapabilities, "supported">;
  /** URL reader capability; absent when the provider does not read. */
  readonly read?: Omit<ProviderReadCapabilities, "supported">;
  /** Resolves the provider class. */
  readonly load: () => Promise<ProviderConstructor>;
}

interface ProviderRegistration {
  readonly entry: ProviderEntry;
  /** Whether the entry came from the manifest, so its class still waits behind an `import()`. */
  readonly builtin: boolean;
  readonly previous?: ProviderRegistration;
}

let registrations: Map<string, ProviderRegistration> | undefined;
const removedRegistrations = new WeakSet<ProviderRegistration>();

/**
 * The registry table, seeded from the built-in manifest on first use rather than at module scope,
 * so a consumer bundle that never touches the registry drops the table with it.
 * @returns {Map<string, ProviderRegistration>} The seeded table.
 */
function table(): Map<string, ProviderRegistration> {
  registrations ??= new Map(
    builtins.map((entry): [string, ProviderRegistration] => [entry.name, { entry, builtin: true }]),
  );
  return registrations;
}

function entryFor(name: string): ProviderEntry | undefined {
  return table().get(name)?.entry;
}

/**
 * Register a provider class living outside the package.
 * The class's static metadata and its prototype decide what discovery reports; registering a name
 * again shadows the previous entry until the returned function removes the registration.
 * @param {ProviderConstructor} provider - Provider class to register.
 * @returns {() => void} A function that removes this registration when it is still current.
 */
export function register(provider: ProviderConstructor): () => void {
  assertProviderName(provider.providerName);
  const registration: ProviderRegistration = {
    entry: entryFromClass(provider),
    builtin: false,
    previous: table().get(provider.providerName),
  };
  table().set(provider.providerName, registration);
  return () => removeRegistration(provider.providerName, registration);
}

/**
 * Create a provider instance by name.
 * Imports a built-in provider's module on the first call for its name; parallel callers share that
 * one import. Resolves apiKey from config or the provider's env var.
 * @param {string} name - Registered provider name.
 * @param {ProviderConfig} config - Provider configuration.
 * @returns {Promise<Provider>} Configured provider instance.
 */
export async function create(name: string, config?: Readonly<ProviderConfig>): Promise<Provider> {
  const entry = entryFor(name);
  if (!entry) {
    throw new UnknownProviderError(name);
  }
  return instantiate(entry, config);
}

/**
 * Create a provider that implements text search.
 * @param name - Registered provider name.
 * @param config - Provider configuration.
 * @returns {Promise<Provider & SearchProvider>} A provider with search support.
 */
export async function createSearchProvider(
  name: string,
  config?: Readonly<ProviderConfig>,
): Promise<Provider & SearchProvider> {
  const entry = requireEntry(name);
  if (entry.search === undefined) throw new SearchNotSupportedError(name);
  const provider = await instantiate(entry, config);
  if (!isSearchProvider(provider)) throw new SearchNotSupportedError(name);
  return provider;
}

/**
 * Create a provider that implements reverse image search.
 * @param name - Registered provider name.
 * @param config - Provider configuration.
 * @returns {Promise<Provider & ImageSearchProvider>} A provider with reverse image search support.
 */
export async function createImageSearchProvider(
  name: string,
  config?: Readonly<ProviderConfig>,
): Promise<Provider & ImageSearchProvider> {
  const entry = requireEntry(name);
  if (entry.searchImage === undefined) throw new ImageSearchNotSupportedError(name);
  const provider = await instantiate(entry, config);
  if (!isImageSearchProvider(provider)) throw new ImageSearchNotSupportedError(name);
  return provider;
}

/**
 * Create a provider that implements URL reading.
 * @param name - Registered provider name.
 * @param config - Provider configuration.
 * @returns {Promise<Provider & ReadProvider>} A provider with read support.
 */
export async function createReadProvider(
  name: string,
  config?: Readonly<ProviderConfig>,
): Promise<Provider & ReadProvider> {
  const entry = requireEntry(name);
  if (entry.read === undefined) throw new ReadNotSupportedError(name);
  const provider = await instantiate(entry, config);
  if (!isReadProvider(provider)) throw new ReadNotSupportedError(name);
  return provider;
}

/**
 * Return every registered provider name, built-ins first in manifest order.
 * @returns {string[]} Registered provider names.
 */
export function providers(): string[] {
  return Array.from(table().keys());
}

/**
 * Return registered providers that implement text search.
 * @returns {string[]} Search provider names.
 */
export function searchProviders(): string[] {
  return providerNamesWithCapability("search");
}

/**
 * Return registered providers that implement reverse image search.
 * @returns {string[]} Image search provider names.
 */
export function searchImageProviders(): string[] {
  return providerNamesWithCapability("searchImage");
}

/**
 * Return registered providers that implement URL reading.
 * @returns {string[]} Read provider names.
 */
export function readProviders(): string[] {
  return providerNamesWithCapability("read");
}

/**
 * Return the API key variable declared by a provider or derived from its name.
 * @param {string} name - Registered or prospective provider name.
 * @returns {string | null} Environment variable name, or null for a keyless provider.
 */
export function getProviderApiKeyEnvVar(name: string): string | null {
  const entry = entryFor(name);
  return entry === undefined ? providerApiKeyEnvVar(name) : apiKeyEnvVarOf(entry);
}

/**
 * Check local credentials without a network request or token refresh.
 * @param name - Registered provider name.
 * @returns {boolean} Whether selection from the environment can use this provider.
 */
export function isProviderConfigured(name: string): boolean {
  const entry = entryFor(name);
  if (entry?.isConfigured) return entry.isConfigured();
  const envVar = getProviderApiKeyEnvVar(name);
  return envVar === null || Boolean(process.env[envVar]);
}

/**
 * Return whether discovery should instantiate a provider to look for its `isAvailable()` probe.
 * A built-in declares the probe in the manifest, so the others stay behind their `import()`; a
 * registered class is already loaded and may carry the probe as an instance field, so it is always
 * worth constructing.
 * @param name - Registered provider name.
 * @returns {boolean} Whether `create(name)` may yield an `AvailabilityProvider`.
 */
export function probesAvailability(name: string): boolean {
  const registration = table().get(name);
  if (registration === undefined) return false;
  return registration.entry.availability === true || !registration.builtin;
}

export function getSearchFilterCapabilities(name: string): SearchFilterCapabilities | undefined {
  const search = entryFor(name)?.search;
  if (search?.filters === undefined) return undefined;
  return {
    filters: search.filters,
    ...(search.categories === undefined ? {} : { categories: search.categories }),
  };
}

/**
 * Return the complete operation matrix a registered provider declares.
 * Optional details stay absent for custom providers that only implement methods.
 * @param name - Registered provider name.
 * @returns {ProviderCapabilities | undefined} Capability metadata, or undefined when the provider is not registered.
 */
export function getProviderCapabilities(name: string): ProviderCapabilities | undefined {
  const entry = entryFor(name);
  if (!entry) return undefined;

  return {
    search: entry.search ? { supported: true, ...entry.search } : { supported: false },
    searchImage: entry.searchImage
      ? { supported: true, ...entry.searchImage }
      : { supported: false },
    read: entry.read ? { supported: true, ...entry.read } : { supported: false },
  };
}

export function has(name: string): boolean {
  return table().has(name);
}

function requireEntry(name: string): ProviderEntry {
  const entry = entryFor(name);
  if (!entry) throw new UnknownProviderError(name);
  return entry;
}

function apiKeyEnvVarOf(entry: Readonly<ProviderEntry>): string | null {
  return entry.apiKeyEnvVar === undefined ? providerApiKeyEnvVar(entry.name) : entry.apiKeyEnvVar;
}

/**
 * Construct a provider from its entry, the key variable read from that same entry so a
 * registration that replaces the name during the import cannot hand the class another one.
 * @param entry - Registry entry the caller resolved.
 * @param config - Provider configuration.
 * @returns {Promise<Provider>} Configured provider instance.
 */
async function instantiate(
  entry: Readonly<ProviderEntry>,
  config?: Readonly<ProviderConfig>,
): Promise<Provider> {
  const envVar = apiKeyEnvVarOf(entry);
  const ProviderClass = await loadClass(entry);
  const apiKey = config?.apiKey || (envVar === null ? undefined : process.env[envVar]);

  return new ProviderClass({
    ...config,
    apiKey,
    baseURL: config?.baseURL || ProviderClass.defaultBaseURL,
  });
}

const loadedClasses = new WeakMap<ProviderEntry, Promise<ProviderConstructor>>();

/**
 * Resolve an entry's class through one `load()` shared by every caller.
 *
 * Sharing the import is on purpose. The jiti loader Pi runs extensions under has its module cache
 * off, so two overlapping `import()` calls of one adapter evaluate it twice, and the second caller
 * gets a namespace without the class yet: a `web_read` batch whose URLs all land on one reader
 * failed every URL after the first. A failed load is forgotten, so the next `create()` tries again.
 * @param entry - Registry entry the caller resolved.
 * @returns {Promise<ProviderConstructor>} The provider class.
 */
function loadClass(entry: Readonly<ProviderEntry>): Promise<ProviderConstructor> {
  let pending = loadedClasses.get(entry);
  if (pending === undefined) {
    pending = entry.load().then((ProviderClass: ProviderConstructor | undefined) => {
      if (typeof ProviderClass !== "function") {
        throw new WebError(`Provider "${entry.name}" did not load a provider class`);
      }
      return ProviderClass;
    });
    loadedClasses.set(entry, pending);
    pending.catch(() => loadedClasses.delete(entry));
  }
  return pending;
}

/**
 * Describe a class the way a manifest entry would: the static metadata it declares plus the
 * operations its prototype implements.
 * @param ProviderClass - Registered provider class.
 * @returns {ProviderEntry} Entry answering from the class without loading anything.
 */
function entryFromClass(ProviderClass: ProviderConstructor): ProviderEntry {
  return {
    name: ProviderClass.providerName,
    ...(ProviderClass.apiKeyEnvVar === undefined
      ? {}
      : { apiKeyEnvVar: ProviderClass.apiKeyEnvVar }),
    ...(ProviderClass.isConfigured
      ? { isConfigured: ProviderClass.isConfigured.bind(ProviderClass) }
      : {}),
    ...(isAvailabilityProvider(ProviderClass.prototype) ? { availability: true } : {}),
    ...(supportsCapability(ProviderClass, "search", isSearchProvider)
      ? { search: searchDetails(ProviderClass) }
      : {}),
    ...(supportsCapability(ProviderClass, "searchImage", isImageSearchProvider)
      ? { searchImage: { ...ProviderClass.capabilityDetails?.searchImage } }
      : {}),
    ...(supportsCapability(ProviderClass, "read", isReadProvider)
      ? { read: { ...ProviderClass.capabilityDetails?.read } }
      : {}),
    load: () => Promise.resolve(ProviderClass),
  };
}

function searchDetails(ProviderClass: ProviderConstructor): NonNullable<ProviderEntry["search"]> {
  const details = ProviderClass.capabilityDetails?.search;
  return {
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

function providerNamesWithCapability(capability: ProviderCapability): string[] {
  return Array.from(table().values())
    .filter(({ entry }) => entry[capability] !== undefined)
    .map(({ entry }) => entry.name);
}

function supportsCapability(
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
  if (table().get(name) !== registration) return;

  let previous = registration.previous;
  while (previous !== undefined && removedRegistrations.has(previous)) {
    previous = previous.previous;
  }
  if (previous === undefined) {
    table().delete(name);
    return;
  }
  table().set(name, previous);
}

function assertProviderName(name: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name === "auto" || name === "all") {
    throw new TypeError(
      'providerName must use lowercase ASCII letters, digits, and single internal hyphens, and cannot be "auto" or "all"',
    );
  }
}
