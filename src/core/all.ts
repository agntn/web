import type {
  ReadonlySearchResult,
  SearchFilterName,
  SearchRequestOptions,
  SearchResult,
} from "./types.ts";
import type { WebSearchProviderName } from "./providers.ts";
import {
  hasSearchFilterWarning,
  searchFilterReport,
  type SearchFilterReport,
} from "./search-filters.ts";
import {
  UnknownProviderError,
  NoProviderConfiguredError,
  NoProviderAvailableError,
  EmptyQueryError,
  HTTPError,
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
  filterReports: SearchFilterReport[];
}

/** Results from one named provider with effective filter diagnostics. */
export interface SearchProviderResult {
  readonly provider: string;
  readonly results: readonly SearchResult[];
  readonly ignoredFilters: readonly SearchFilterName[];
  readonly undeclaredFilters: readonly SearchFilterName[];
}

/** Result from automatic search after any payment fallback. */
export interface SearchWithFallbackResult extends SearchProviderResult {
  readonly provider: WebSearchProviderName;
}

/** Automatic search prepared with one snapshot of configured providers. */
export type PreparedSearchWithFallback = (query: string) => Promise<SearchWithFallbackResult>;

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
  validateSearchInput(query, options);

  const { providers: requestedProviders, ...searchOptions } = options ?? {};
  validateProviderNames(requestedProviders);
  const providerNames = await resolveProviderNames(requestedProviders);
  const settled = await searchProviders(providerNames, query, searchOptions);
  return collectProviderResults(providerNames, settled);
}

/**
 * Search through automatic providers in order after the first one requires payment.
 * @param query - Search query.
 * @param options - Search options forwarded to the selected provider.
 * @returns {Promise<SearchWithFallbackResult>} Results and the provider that answered.
 */
export async function searchWithFallback(
  query: string,
  options?: Readonly<SearchRequestOptions>,
): Promise<SearchWithFallbackResult> {
  validateSearchInput(query, options);

  const providerNames = await resolveAutomaticProviderNames();
  return searchProviderNamesWithFallback(providerNames, query, options);
}

/**
 * Search one named provider and report filters it could not apply.
 * @param providerName - Registered provider name.
 * @param query - Search query.
 * @param options - Search options forwarded to the provider.
 * @returns {Promise<SearchProviderResult>} Results and effective filter diagnostics.
 */
export async function searchProviderDetailed(
  providerName: string,
  query: string,
  options?: Readonly<SearchRequestOptions>,
): Promise<SearchProviderResult> {
  validateSearchInput(query, options);
  validateProviderNames([providerName]);
  return searchProvider(providerName, query, options);
}

/**
 * Resolve the automatic provider order once for a batch of searches.
 * @param options - Search options forwarded to every selected provider.
 * @returns {Promise<PreparedSearchWithFallback>} Search function using the resolved provider order.
 */
export async function prepareSearchWithFallback(
  options?: Readonly<SearchRequestOptions>,
): Promise<PreparedSearchWithFallback> {
  validateDateFilters(options?.startPublishedDate, options?.endPublishedDate);
  const providerNames = await resolveAutomaticProviderNames();
  return (query) => {
    if (!query.trim()) throw new EmptyQueryError();
    return searchProviderNamesWithFallback(providerNames, query, options);
  };
}

async function searchProviderNamesWithFallback(
  providerNames: readonly WebSearchProviderName[],
  query: string,
  options?: Readonly<SearchRequestOptions>,
): Promise<SearchWithFallbackResult> {
  let lastError: unknown;
  for (const [index, providerName] of providerNames.entries()) {
    try {
      return await searchProvider(providerName, query, options);
    } catch (error) {
      if (index === 0 && !isPaymentRequired(error)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new NoProviderAvailableError(providerNames);
}

function validateSearchInput(query: string, options?: Readonly<SearchRequestOptions>): void {
  if (!query.trim()) {
    throw new EmptyQueryError();
  }
  validateDateFilters(options?.startPublishedDate, options?.endPublishedDate);
}

function validateProviderNames(providerNames?: readonly string[]): void {
  const unknown = providerNames?.find((name) => !has(name));
  if (unknown) throw new UnknownProviderError(unknown);
}

async function resolveProviderNames(
  requestedProviders?: readonly string[],
): Promise<readonly string[]> {
  if (requestedProviders !== undefined) {
    if (requestedProviders.length > 0) return requestedProviders;
    throw new NoProviderConfiguredError();
  }
  return resolveAutomaticProviderNames();
}

async function resolveAutomaticProviderNames(): Promise<readonly WebSearchProviderName[]> {
  const providerNames = await detectAvailableProvidersAsync();
  if (providerNames.length > 0) return providerNames;

  const configuredProviders = detectAvailableProviders();
  if (configuredProviders.length === 0) throw new NoProviderConfiguredError();
  throw new NoProviderAvailableError(configuredProviders);
}

async function searchProvider<TProvider extends string>(
  providerName: TProvider,
  query: string,
  options?: Readonly<SearchRequestOptions>,
): Promise<SearchProviderResult & { readonly provider: TProvider }> {
  const results = await createSearchProvider(providerName).search(query, options);
  const report = searchFilterReport(providerName, options);
  return { ...report, provider: providerName, results };
}

function isPaymentRequired(error: unknown): error is HTTPError {
  return error instanceof HTTPError && error.statusCode === 402;
}

type ReadonlySearchProviderResult = Readonly<Omit<SearchProviderResult, "results">> & {
  readonly results: readonly ReadonlySearchResult[];
};

type ProviderSearchOutcome =
  | { readonly status: "fulfilled"; readonly value: ReadonlySearchProviderResult }
  | { readonly status: "rejected"; readonly reason: unknown };

function searchProviders(
  providerNames: readonly string[],
  query: string,
  options: Readonly<SearchRequestOptions>,
): Promise<readonly ProviderSearchOutcome[]> {
  return Promise.allSettled(providerNames.map((name) => searchProvider(name, query, options)));
}

function collectProviderResults(
  providerNames: readonly string[],
  settled: readonly ProviderSearchOutcome[],
): SearchAllResponse {
  const results: SearchAllResult[] = [];
  const errors: ProviderError[] = [];
  const filterReports: SearchFilterReport[] = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      results.push(
        ...outcome.value.results.map((result) =>
          mutableResultWithProvider(result, outcome.value.provider),
        ),
      );
      if (hasSearchFilterWarning(outcome.value)) {
        const { provider, ignoredFilters, undeclaredFilters } = outcome.value;
        filterReports.push({ provider, ignoredFilters, undeclaredFilters });
      }
    } else {
      errors.push({
        provider: providerNames[index],
        error: outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason)),
      });
    }
  }
  return { results: deduplicateByUrl(results), errors, filterReports };
}

function mutableResultWithProvider(
  result: ReadonlySearchResult,
  provider: string,
): SearchAllResult {
  const { highlights, metadata, ...rest } = result;
  return {
    ...rest,
    ...(highlights ? { highlights: [...highlights] } : {}),
    ...(metadata ? { metadata: { ...metadata } } : {}),
    provider,
  };
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
