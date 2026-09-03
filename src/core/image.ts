import { builtinProviders } from "./providers.ts";
import {
  EmptyImageUrlError,
  ImageSearchNotSupportedError,
  InvalidImageUrlError,
} from "./errors.ts";
import { createImageSearchProvider, has, searchImageProviders } from "./registry.ts";
import type { ImageSearchOptions, ImageSearchResult } from "./types.ts";

/** Built-in providers that accept an image URL as a search input. */
export const imageSearchProviderNames = ["serpapi"] as const;

/** Name of a built-in reverse image search provider. */
export type ImageSearchProviderName = (typeof imageSearchProviderNames)[number];

/** Reverse image search options with an optional provider override. */
export interface ImageSearchByUrlOptions extends ImageSearchOptions {
  readonly provider?: string;
}

const DEFAULT_IMAGE_SEARCH_PROVIDER: ImageSearchProviderName = "serpapi";

/**
 * Finds public pages containing or resembling an image available by URL.
 * @param url - Public HTTP or HTTPS image URL.
 * @param options - Provider and result limit.
 * @returns {Promise<ImageSearchResult[]>} Normalized reverse image matches.
 */
export async function searchByImage(
  url: string,
  options?: Readonly<ImageSearchByUrlOptions>,
): Promise<ImageSearchResult[]> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) throw new EmptyImageUrlError();
  assertImageUrl(trimmedUrl);

  const { provider = DEFAULT_IMAGE_SEARCH_PROVIDER, ...searchOptions } = options ?? {};
  assertMaxResults(searchOptions.maxResults);
  const providerName = provider.trim();
  const registeredOrBuiltin =
    has(providerName) || (builtinProviders as readonly string[]).includes(providerName);
  if (registeredOrBuiltin && !searchImageProviders().includes(providerName)) {
    throw new ImageSearchNotSupportedError(providerName);
  }
  return createImageSearchProvider(providerName).searchByImage(trimmedUrl, searchOptions);
}

function assertMaxResults(maxResults: number | undefined): void {
  if (maxResults !== undefined && (!Number.isInteger(maxResults) || maxResults < 1)) {
    throw new TypeError("maxResults must be a positive integer");
  }
}

function assertImageUrl(url: string): void {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new InvalidImageUrlError();
  }
  if (protocol !== "http:" && protocol !== "https:") throw new InvalidImageUrlError();
}
