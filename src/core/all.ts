import type { SearchResult, SearchRequestOptions } from "./types.ts";
import {
  UnknownProviderError,
  NoProviderConfiguredError,
  NoProviderAvailableError,
  EmptyQueryError,
  validateDateFilters,
} from "./errors.ts";
import { createSearchProvider, has } from "./registry.ts";
import { detectAvailableProviders, detectAvailableProvidersAsync } from "./resolve.ts";

export type SearchAllOptions = SearchRequestOptions & {
  readonly providers?: readonly string[];
};

export interface SearchAllResult extends SearchResult {
  provider: string;
}

export interface ProviderError {
  provider: string;
  error: Error;
}

export interface SearchAllResponse {
  results: SearchAllResult[];
  errors: ProviderError[];
}

/**
 * Query multiple providers in parallel and return deduplicated results.
 * Providers are auto-detected from env vars unless explicitly specified.
 * Individual provider failures don't affect other results.
 * @param {string} query - Search query.
 * @param {SearchAllOptions} options - Provider and result options.
 * @returns {Promise<SearchAllResult[]>} Deduplicated provider results.
 */
export async function searchAll(
  query: string,
  options?: SearchAllOptions,
): Promise<SearchAllResult[]> {
  const response = await searchAllDetailed(query, options);
  return response.results;
}

/**
 * Like {@link searchAll}, but also returns per-provider errors so callers
 * can tell which providers failed and why.
 * @param {string} query - Search query.
 * @param {SearchAllOptions} options - Provider and result options.
 * @returns {Promise<SearchAllResponse>} Results and provider failures.
 */
export async function searchAllDetailed(
  query: string,
  options?: SearchAllOptions,
): Promise<SearchAllResponse> {
  if (!query.trim()) {
    throw new EmptyQueryError();
  }

  validateDateFilters(options?.startPublishedDate, options?.endPublishedDate);

  const { providers: requestedProviders, ...searchOptions } = options ?? {};
  validateProviderNames(requestedProviders);
  const providerNames = await resolveProviderNames(requestedProviders);
  const settled = await searchProviders(providerNames, query, searchOptions);
  return collectProviderResults(providerNames, settled);
}

function validateProviderNames(providerNames?: readonly string[]): void {
  const unknown = providerNames?.find((name) => !has(name));
  if (unknown) throw new UnknownProviderError(unknown);
}

async function resolveProviderNames(
  requestedProviders?: readonly string[],
): Promise<readonly string[]> {
  const providerNames = requestedProviders ?? (await detectAvailableProvidersAsync());
  if (providerNames.length > 0) return providerNames;
  if (requestedProviders !== undefined) throw new NoProviderConfiguredError();

  const configuredProviders = detectAvailableProviders();
  if (configuredProviders.length === 0) throw new NoProviderConfiguredError();
  throw new NoProviderAvailableError(configuredProviders);
}

function searchProviders(
  providerNames: readonly string[],
  query: string,
  options: SearchRequestOptions,
): Promise<readonly PromiseSettledResult<readonly SearchAllResult[]>[]> {
  return Promise.allSettled(
    providerNames.map(async (name) => {
      const results = await createSearchProvider(name).search(query, options);
      return results.map((result) => ({ ...result, provider: name }));
    }),
  );
}

function collectProviderResults<T extends SearchAllResult>(
  providerNames: readonly string[],
  settled: readonly Readonly<PromiseSettledResult<readonly T[]>>[],
): SearchAllResponse {
  const results: SearchAllResult[] = [];
  const errors: ProviderError[] = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      results.push(...outcome.value);
    } else {
      errors.push({
        provider: providerNames[index],
        error: outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason)),
      });
    }
  }
  return { results: deduplicateByUrl(results), errors };
}

function deduplicateByUrl<T extends { readonly url: string; readonly score?: number }>(
  results: readonly T[],
): T[] {
  const seen = new Map<string, T>();

  for (const result of results) {
    const normalized = normalizeUrl(result.url);
    const existing = seen.get(normalized);

    if (!existing) {
      seen.set(normalized, result);
    } else {
      if (
        result.score !== null &&
        result.score !== undefined &&
        (existing.score === null || existing.score === undefined || result.score > existing.score)
      ) {
        seen.set(normalized, result);
      }
    }
  }

  return Array.from(seen.values());
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const search = canonicalizeSearchParams(parsed.search);
    return `${parsed.protocol}//${parsed.host}${path}${search}`;
  } catch {
    return url;
  }
}

function canonicalizeSearchParams(serializedSearchParams: string): string {
  const searchParams = new URLSearchParams(serializedSearchParams);
  const filteredSortedEntries = Array.from(searchParams.entries())
    .filter(([key]) => !isTrackingParam(key))
    .map(([key, value], index) => ({ key, value, index }))
    .sort((a, b) => {
      const keyOrder = a.key.localeCompare(b.key, "en");
      if (keyOrder !== 0) {
        return keyOrder;
      }

      return a.index - b.index;
    })
    .map(({ key, value }): [string, string] => [key, value]);

  if (filteredSortedEntries.length === 0) {
    return "";
  }

  return `?${new URLSearchParams(filteredSortedEntries).toString()}`;
}

function isTrackingParam(key: string): boolean {
  return key.toLowerCase().startsWith("utm_");
}
