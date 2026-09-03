import { defaultClient, type Client } from "./client.ts";
import type {
  ImageSearchRequestOptions,
  ImageSearchResult,
  ProviderConfig,
  ReadOptions,
  ReadResult,
  SearchFilterCapabilities,
  SearchRequestOptions,
  SearchResponse,
  SearchResult,
} from "./types.ts";
import { InvalidProviderUrlError } from "./errors.ts";

export type ProviderCapability = "search" | "searchImage" | "read";

export interface ProviderConstructor {
  readonly providerName: string;
  readonly defaultBaseURL: string;
  readonly apiKeyEnvVar?: string | null;
  readonly capabilities?: readonly ProviderCapability[];
  readonly searchFilterCapabilities?: SearchFilterCapabilities;
  readonly prototype: Readonly<Provider>;
  new (config: Readonly<ProviderConfig>): Provider;
}

export abstract class Provider {
  readonly #name: string;
  protected readonly client: Client;
  protected readonly baseURL: string;

  get name(): string {
    return this.#name;
  }

  protected constructor(
    config: Readonly<ProviderConfig>,
    provider: Pick<ProviderConstructor, "providerName" | "defaultBaseURL">,
  ) {
    this.#name = provider.providerName;
    const baseURL = config.baseURL ?? provider.defaultBaseURL;
    assertProviderBaseURL(baseURL, this.name);
    this.baseURL = baseURL.replace(/\/+$/, "");
    this.client = defaultClient();
  }
}

export function assertProviderBaseURL(baseURL: string, providerName: string): void {
  let protocol: string;
  try {
    protocol = new URL(baseURL).protocol;
  } catch {
    throw new InvalidProviderUrlError(providerName);
  }

  if (protocol !== "http:" && protocol !== "https:") {
    throw new InvalidProviderUrlError(providerName);
  }
}

export interface SearchProvider {
  search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]>;
}

export interface DetailedSearchProvider {
  searchDetailed(query: string, options?: SearchRequestOptions): Promise<SearchResponse>;
}

/** Provider capability for finding public pages from an image URL. */
export interface ImageSearchProvider {
  searchByImage(url: string, options?: ImageSearchRequestOptions): Promise<ImageSearchResult[]>;
}

export interface ReadProvider {
  read(url: string, options?: Readonly<ReadOptions>): Promise<ReadResult>;
}

export interface AvailabilityProvider {
  isAvailable(): Promise<boolean>;
}

export function isSearchProvider(provider: object): provider is Provider & SearchProvider {
  return "search" in provider && typeof provider.search === "function";
}

export function isDetailedSearchProvider(
  provider: object,
): provider is Provider & DetailedSearchProvider {
  return "searchDetailed" in provider && typeof provider.searchDetailed === "function";
}

/**
 * Return whether a provider implements reverse image search.
 * @param provider - Provider instance to inspect.
 * @returns {boolean} Whether the capability is present.
 */
export function isImageSearchProvider(
  provider: object,
): provider is Provider & ImageSearchProvider {
  return "searchByImage" in provider && typeof provider.searchByImage === "function";
}

export function isReadProvider(provider: object): provider is Provider & ReadProvider {
  return "read" in provider && typeof provider.read === "function";
}

export function isAvailabilityProvider(
  provider: object,
): provider is Provider & AvailabilityProvider {
  return "isAvailable" in provider && typeof provider.isAvailable === "function";
}
