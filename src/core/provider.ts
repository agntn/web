import { defaultClient, type Client } from "./client.ts";
import type {
  ImageSearchRequestOptions,
  ImageSearchResult,
  ProviderConfig,
  ReadOptions,
  ReadResult,
  SearchFilterCapabilities,
  SearchFilterName,
  SearchRequestOptions,
  SearchResponse,
  SearchResult,
} from "./types.ts";
import { InvalidProviderUrlError } from "./errors.ts";

export type ProviderCapability = "search" | "searchImage" | "read";
export type SearchResultField = Exclude<keyof SearchResult, "url" | "title" | "snippet">;
export type SearchContentOptionName = "highlights" | "summary" | "fullText";
export type ReadOptionName = keyof ReadOptions;
export type ReadFormat = NonNullable<ReadOptions["format"]>;

/** Known result count behavior exposed by one provider adapter. */
export type ProviderResultLimit =
  | { readonly default: number; readonly maximum?: number }
  | { readonly default?: never; readonly maximum: number };

/** Static search metadata that cannot be inferred from method presence. */
export interface SearchCapabilityDetails {
  readonly contentOptions: readonly SearchContentOptionName[];
  readonly resultLimit?: ProviderResultLimit;
  readonly resultFields: readonly SearchResultField[];
}

/** Static reverse image search metadata that cannot be inferred from method presence. */
export interface ImageSearchCapabilityDetails {
  readonly resultLimit: ProviderResultLimit;
}

/** Static URL reader metadata that cannot be inferred from method presence. */
export interface ReadCapabilityDetails {
  readonly options: readonly ReadOptionName[];
  readonly formats: readonly ReadFormat[];
}

/** Optional details declared by a provider class for each implemented operation. */
export interface ProviderCapabilityDetails {
  readonly search?: SearchCapabilityDetails;
  readonly searchImage?: ImageSearchCapabilityDetails;
  readonly read?: ReadCapabilityDetails;
}

/** Machine-readable search capability reported by provider discovery. */
export interface ProviderSearchCapabilities {
  readonly supported: boolean;
  readonly filters?: readonly SearchFilterName[];
  readonly categories?: readonly string[];
  readonly contentOptions?: readonly SearchContentOptionName[];
  readonly pagination?: boolean;
  readonly resultLimit?: ProviderResultLimit;
  readonly resultFields?: readonly SearchResultField[];
}

/** Machine-readable reverse image search capability reported by provider discovery. */
export interface ProviderImageSearchCapabilities {
  readonly supported: boolean;
  readonly resultLimit?: ProviderResultLimit;
}

/** Machine-readable URL reader capability reported by provider discovery. */
export interface ProviderReadCapabilities {
  readonly supported: boolean;
  readonly options?: readonly ReadOptionName[];
  readonly formats?: readonly ReadFormat[];
}

/** Complete operation matrix for one registered provider. */
export interface ProviderCapabilities {
  readonly search: ProviderSearchCapabilities;
  readonly searchImage: ProviderImageSearchCapabilities;
  readonly read: ProviderReadCapabilities;
}

export interface ProviderConstructor {
  readonly providerName: string;
  readonly defaultBaseURL: string;
  readonly apiKeyEnvVar?: string | null;
  readonly capabilities?: readonly ProviderCapability[];
  readonly capabilityDetails?: ProviderCapabilityDetails;
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

/** One provider page with an opaque provider-native token for the next page. */
export interface ProviderSearchPage extends SearchResponse {
  continuation?: string;
  continuationStatus?: "next" | "unknown";
}

/** Optional paging contract implemented without exposing provider state to callers. */
export interface PaginatedSearchProvider {
  searchPage(
    query: string,
    options?: SearchRequestOptions,
    continuation?: string,
  ): Promise<ProviderSearchPage>;
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

export function isPaginatedSearchProvider(
  provider: object,
): provider is Provider & SearchProvider & PaginatedSearchProvider {
  return "searchPage" in provider && typeof provider.searchPage === "function";
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
