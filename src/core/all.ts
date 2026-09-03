import type {
  ReadonlySearchResult,
  SearchFilterName,
  SearchPageOptions,
  SearchPagination,
  SearchRequestOptions,
  SearchResponse,
  SearchResult,
} from "./types.ts";
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
  InvalidSearchContinuationError,
  validateDateFilters,
} from "./errors.ts";
import {
  isFallbackEligible,
  providerFailure,
  ProviderFallbackError,
  type ProviderFailure,
} from "./fallback.ts";
import { createSearchProvider, has } from "./registry.ts";
import { isDetailedSearchProvider, isPaginatedSearchProvider } from "./provider.ts";
import { decodeSearchContinuation, encodeSearchContinuation } from "./search-continuation.ts";
import { detectAvailableProviders, detectAvailableProvidersAsync } from "./resolve.ts";

const DEFAULT_MAX_RESULTS = 10;

export type SearchAllOptions = SearchPageOptions & {
  readonly providers?: readonly string[];
};

/** One provider record retained as evidence for a deduplicated result. */
export interface SearchAllEvidence extends SearchResult {
  provider: string;
}

/** Stable representative plus every provider record for one normalized URL. */
export interface SearchAllResult extends SearchAllEvidence {
  providers: string[];
  evidence: SearchAllEvidence[];
}

export interface ProviderError {
  provider: string;
  error: Error;
}

export interface SearchProviderMetadata {
  readonly provider: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** One provider's independent continuation state in a fanout response. */
export interface SearchProviderPagination {
  readonly provider: string;
  readonly pagination: SearchPagination;
}

export interface SearchAllResponse {
  results: SearchAllResult[];
  successfulProviders: string[];
  errors: ProviderError[];
  filterReports: SearchFilterReport[];
  providerPagination: SearchProviderPagination[];
  providerMetadata?: SearchProviderMetadata[];
}

/** Results from one named provider with effective filter diagnostics. */
export interface SearchProviderResult {
  readonly provider: string;
  readonly results: readonly SearchResult[];
  readonly ignoredFilters: readonly SearchFilterName[];
  readonly undeclaredFilters: readonly SearchFilterName[];
  readonly pagination: SearchPagination;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Result from automatic search with ordered provider-attempt diagnostics. */
export interface SearchWithFallbackResult extends SearchProviderResult {
  readonly provider: string;
  readonly attempts: readonly string[];
  readonly failures: readonly ProviderFailure[];
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
 * Like {@link searchAll}, but also returns successful provider names,
 * filter diagnostics, and errors for each provider.
 * @param {string} query - Search query.
 * @param {SearchAllOptions} options - Provider and result options.
 * @returns {Promise<SearchAllResponse>} Results and provider failures.
 */
export async function searchAllDetailed(
  query: string,
  options?: SearchAllOptions,
): Promise<SearchAllResponse> {
  validateSearchInput(query, options);

  const { providers: requestedProviders, continuation, ...searchOptions } = options ?? {};
  if (continuation !== undefined) {
    throw new TypeError("continuation is not supported with provider=all");
  }
  validateProviderNames(requestedProviders);
  const providerNames = await resolveProviderNames(requestedProviders);
  const maxResults = searchOptions.maxResults ?? DEFAULT_MAX_RESULTS;
  const effectiveSearchOptions = { ...searchOptions, maxResults };
  const settled = await searchProviders(providerNames, query, effectiveSearchOptions);
  return collectProviderResults(providerNames, settled, maxResults);
}

/**
 * Search through automatic providers in order, continuing after eligible transient failures.
 * @param query - Search query.
 * @param options - Search options forwarded to the selected provider.
 * @returns {Promise<SearchWithFallbackResult>} Results, provider, and attempt diagnostics.
 */
export async function searchWithFallback(
  query: string,
  options?: Readonly<SearchPageOptions>,
): Promise<SearchWithFallbackResult> {
  validateSearchInput(query, options);

  if (options?.continuation !== undefined) {
    const { continuation, ...searchOptions } = options;
    const payload = decodeSearchContinuation(continuation, query, searchOptions);
    const response = await searchProvider(payload.provider, query, options);
    return { ...response, attempts: [payload.provider], failures: [] };
  }

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
  options?: Readonly<SearchPageOptions>,
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
  providerNames: readonly string[],
  query: string,
  options?: Readonly<SearchPageOptions>,
): Promise<SearchWithFallbackResult> {
  const attempts: string[] = [];
  const failures: ProviderFailure[] = [];
  let lastError: unknown;

  for (const providerName of providerNames) {
    attempts.push(providerName);
    try {
      const response = await searchProvider(providerName, query, options);
      return { ...response, attempts, failures };
    } catch (error) {
      const failure = providerFailure(providerName, error);
      if (!isFallbackEligible(error, providerName, "search")) {
        if (failures.length === 0) throw error;
        failures.push(failure);
        throw new ProviderFallbackError("search", failures, error);
      }
      failures.push(failure);
      lastError = error;
    }
  }
  if (lastError === undefined) throw new NoProviderAvailableError(providerNames);
  throw new ProviderFallbackError("search", failures, lastError);
}

function validateSearchInput(query: string, options?: Readonly<SearchPageOptions>): void {
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

async function resolveAutomaticProviderNames(): Promise<readonly string[]> {
  const providerNames = await detectAvailableProvidersAsync();
  if (providerNames.length > 0) return providerNames;

  const configuredProviders = detectAvailableProviders();
  if (configuredProviders.length === 0) throw new NoProviderConfiguredError();
  throw new NoProviderAvailableError(configuredProviders);
}

async function searchProvider<TProvider extends string>(
  providerName: TProvider,
  query: string,
  options?: Readonly<SearchPageOptions>,
): Promise<SearchProviderResult & { readonly provider: TProvider }> {
  const { continuation, ...searchOptions } = options ?? {};
  const payload =
    continuation === undefined
      ? undefined
      : decodeSearchContinuation(continuation, query, searchOptions);
  if (payload !== undefined && payload.provider !== providerName) {
    throw new InvalidSearchContinuationError();
  }

  const provider = createSearchProvider(providerName);
  const paginated = isPaginatedSearchProvider(provider);
  const response = await searchResponse(
    provider,
    paginated,
    query,
    searchOptions,
    payload?.providerContinuation,
  );
  const pagination = normalizedPagination(providerName, query, searchOptions, response, paginated);
  const report = searchFilterReport(providerName, searchOptions);
  return {
    ...report,
    provider: providerName,
    results: response.results,
    pagination,
    ...(response.metadata === undefined ? {} : { metadata: { ...response.metadata } }),
  };
}

type SearchResponseWithContinuation = SearchResponse & {
  readonly continuation?: string;
  readonly continuationStatus?: "next" | "unknown";
};

async function searchResponse(
  provider: Readonly<ReturnType<typeof createSearchProvider>>,
  paginated: boolean,
  query: string,
  options: Readonly<SearchRequestOptions>,
  providerContinuation?: string,
): Promise<SearchResponseWithContinuation> {
  if (paginated && isPaginatedSearchProvider(provider)) {
    return provider.searchPage(query, options, providerContinuation);
  }
  if (providerContinuation !== undefined) throw new InvalidSearchContinuationError();
  return isDetailedSearchProvider(provider)
    ? provider.searchDetailed(query, options)
    : { results: await provider.search(query, options) };
}

function normalizedPagination(
  providerName: string,
  query: string,
  options: Readonly<SearchRequestOptions>,
  response: Readonly<Pick<SearchResponseWithContinuation, "continuation" | "continuationStatus">>,
  paginated: boolean,
): SearchPagination {
  if (!paginated) return { status: "unsupported" };
  if (response.continuation === undefined) return { status: "end" };
  return {
    status: response.continuationStatus ?? "next",
    continuation: encodeSearchContinuation(providerName, query, options, response.continuation),
  };
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
  maxResults?: number,
): SearchAllResponse {
  const results: SearchAllEvidence[] = [];
  const successfulProviders = new Set<string>();
  const errors: ProviderError[] = [];
  const filterReports: SearchFilterReport[] = [];
  const providerMetadata: SearchProviderMetadata[] = [];
  const providerPagination: SearchProviderPagination[] = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      successfulProviders.add(outcome.value.provider);
      results.push(
        ...outcome.value.results.map((result) =>
          mutableResultWithProvider(result, outcome.value.provider),
        ),
      );
      if (hasSearchFilterWarning(outcome.value)) {
        const { provider, ignoredFilters, undeclaredFilters } = outcome.value;
        filterReports.push({ provider, ignoredFilters, undeclaredFilters });
      }
      providerPagination.push({
        provider: outcome.value.provider,
        pagination: outcome.value.pagination,
      });
      if (outcome.value.metadata !== undefined) {
        providerMetadata.push({
          provider: outcome.value.provider,
          metadata: { ...outcome.value.metadata },
        });
      }
    } else {
      errors.push({
        provider: providerNames[index],
        error: outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason)),
      });
    }
  }
  const deduplicatedResults = deduplicateByUrl(results);
  return {
    results:
      maxResults === undefined ? deduplicatedResults : deduplicatedResults.slice(0, maxResults),
    successfulProviders: [...successfulProviders],
    errors,
    filterReports,
    providerPagination,
    ...(providerMetadata.length === 0 ? {} : { providerMetadata }),
  };
}

function mutableResultWithProvider(
  result: ReadonlySearchResult,
  provider: string,
): SearchAllEvidence {
  const { highlights, metadata, ...rest } = result;
  return {
    ...rest,
    ...(highlights ? { highlights: [...highlights] } : {}),
    ...(metadata ? { metadata: { ...metadata } } : {}),
    provider,
  };
}

type ReadonlySearchAllEvidence = ReadonlySearchResult & { readonly provider: string };

function deduplicateByUrl(results: readonly ReadonlySearchAllEvidence[]): SearchAllResult[] {
  const seen = new Map<string, SearchAllResult>();

  for (const result of results) {
    const normalized = normalizeUrl(result.url);
    const existing = seen.get(normalized);

    if (!existing) {
      seen.set(normalized, {
        ...mutableResultWithProvider(result, result.provider),
        providers: [result.provider],
        evidence: [mutableResultWithProvider(result, result.provider)],
      });
      continue;
    }

    if (!existing.providers.includes(result.provider)) {
      existing.providers.push(result.provider);
    }
    existing.evidence.push(mutableResultWithProvider(result, result.provider));
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
