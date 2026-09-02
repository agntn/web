import { EmptyQueryError, EmptyUrlError } from "./errors.ts";
import {
  prepareSearchWithFallback,
  searchAllDetailed,
  searchProviderDetailed,
  type SearchProviderMetadata,
  type SearchProviderResult,
} from "./all.ts";
import { readUrlDetailed, type ReadUrlOptions } from "./read.ts";
import { hasSearchFilterWarning, type SearchFilterReport } from "./search-filters.ts";
import type {
  ReadonlySearchResult,
  ReadResult,
  SearchRequestOptions,
  SearchResult,
} from "./types.ts";

/** Maximum number of network operations accepted by one agent-tool batch. */
export const MAX_BATCH_ITEMS = 10;

/** Shared search options applied to every query in a batch. */
export type SearchBatchOptions = SearchRequestOptions & {
  readonly provider?: string;
};

/** One successful or failed query outcome. */
export type SearchBatchItem =
  | {
      readonly query: string;
      readonly provider: string;
      readonly results: readonly SearchResult[];
      readonly filterReports: readonly SearchFilterReport[];
      readonly providerMetadata?: readonly SearchProviderMetadata[];
    }
  | { readonly query: string; readonly error: string };

/** One successful or failed URL outcome. */
export type ReadBatchItem =
  | { readonly url: string; readonly result: ReadResult }
  | { readonly url: string; readonly error: string };

/** One detailed URL outcome with effective provider provenance. */
export type ReadBatchDetailedItem =
  | {
      readonly url: string;
      readonly result: Readonly<ReadResult>;
      readonly requestedProvider: string;
      readonly provider: string;
      readonly attempts: readonly string[];
    }
  | { readonly url: string; readonly error: string };

/**
 * Searches independent queries in parallel while preserving input order and failures.
 * @param queries - Search queries to execute.
 * @param options - Shared provider and search options.
 * @returns {Promise<readonly SearchBatchItem[]>} One result or error for every query.
 */
export async function searchBatch(
  queries: readonly string[],
  options?: Readonly<SearchBatchOptions>,
): Promise<readonly SearchBatchItem[]> {
  validateBatch(queries, "query", EmptyQueryError);

  const { provider: requestedProvider, ...searchOptions } = options ?? {};
  if (requestedProvider === "all") {
    return mapSearchOutcomes(
      await settleBatch(queries, (query) => searchAllForBatch(query, searchOptions)),
    );
  }

  if (requestedProvider === undefined) {
    try {
      const search = await prepareSearchWithFallback(searchOptions);
      return mapSearchOutcomes(
        await settleBatch(queries, async (query) => singleBatchResult(await search(query))),
      );
    } catch (error) {
      return queries.map((query) => ({ query, error: errorMessage(error) }));
    }
  }

  try {
    return mapSearchOutcomes(
      await settleBatch(queries, async (query) =>
        singleBatchResult(await searchProviderDetailed(requestedProvider, query, searchOptions)),
      ),
    );
  } catch (error) {
    return queries.map((query) => ({ query, error: errorMessage(error) }));
  }
}

/**
 * Reads independent URLs while preserving the original batch contract.
 * @param urls - URLs to read.
 * @param options - Shared provider and read options.
 * @returns {Promise<readonly ReadBatchItem[]>} One result or error for every URL.
 */
export async function readBatch(
  urls: readonly string[],
  options?: Readonly<ReadUrlOptions>,
): Promise<readonly ReadBatchItem[]> {
  const outcomes = await readBatchDetailed(urls, options);
  return outcomes.map((outcome): ReadBatchItem =>
    "error" in outcome
      ? { url: outcome.url, error: outcome.error }
      : { url: outcome.url, result: outcome.result },
  );
}

/**
 * Reads independent URLs and reports effective provider provenance per item.
 * @param urls - URLs to read.
 * @param options - Shared provider and read options.
 * @returns {Promise<readonly ReadBatchDetailedItem[]>} Detailed outcomes for every URL.
 */
export async function readBatchDetailed(
  urls: readonly string[],
  options?: Readonly<ReadUrlOptions>,
): Promise<readonly ReadBatchDetailedItem[]> {
  validateBatch(urls, "URL", EmptyUrlError);
  const outcomes = await settleBatch(urls, (url) => readUrlDetailed(url, options));
  return outcomes.map((outcome): ReadBatchDetailedItem =>
    outcome.ok
      ? { url: outcome.input, ...outcome.value }
      : { url: outcome.input, error: outcome.error },
  );
}

type BatchOutcome<TResult> =
  | { readonly ok: true; readonly input: string; readonly value: TResult }
  | { readonly ok: false; readonly input: string; readonly error: string };

interface BatchSearchResult {
  readonly provider: string;
  readonly results: readonly ReadonlySearchResult[];
  readonly filterReports: readonly SearchFilterReport[];
  readonly providerMetadata?: readonly SearchProviderMetadata[];
}

type ReadonlySearchProviderResult = Readonly<Omit<SearchProviderResult, "results">> & {
  readonly results: readonly ReadonlySearchResult[];
};

async function searchAllForBatch(
  query: string,
  options: Readonly<SearchRequestOptions>,
): Promise<BatchSearchResult> {
  const response = await searchAllDetailed(query, options);
  if (response.results.length === 0 && response.errors.length > 0) {
    const errors = response.errors.map(({ provider, error }) => `${provider}: ${error.message}`);
    throw new Error(`Search providers failed: ${errors.join("; ")}`);
  }
  return {
    provider: "all",
    results: response.results,
    filterReports: response.filterReports,
    ...(response.providerMetadata === undefined
      ? {}
      : { providerMetadata: response.providerMetadata }),
  };
}

function singleBatchResult(response: ReadonlySearchProviderResult): BatchSearchResult {
  const { provider, ignoredFilters, undeclaredFilters } = response;
  const filterReports = hasSearchFilterWarning(response)
    ? [{ provider, ignoredFilters, undeclaredFilters }]
    : [];
  return {
    provider,
    results: response.results,
    filterReports,
    ...(response.metadata === undefined
      ? {}
      : { providerMetadata: [{ provider, metadata: response.metadata }] }),
  };
}

async function settleBatch<TResult>(
  inputs: readonly string[],
  execute: (input: string) => Promise<TResult>,
): Promise<readonly BatchOutcome<TResult>[]> {
  return Promise.all(
    inputs.map(async (input): Promise<BatchOutcome<TResult>> => {
      try {
        return { ok: true, input, value: await execute(input) };
      } catch (error) {
        return { ok: false, input, error: errorMessage(error) };
      }
    }),
  );
}

function mapSearchOutcomes(
  outcomes: readonly BatchOutcome<BatchSearchResult>[],
): readonly SearchBatchItem[] {
  return outcomes.map((outcome): SearchBatchItem =>
    outcome.ok
      ? {
          query: outcome.input,
          provider: outcome.value.provider,
          results: outcome.value.results.map(mutableSearchResult),
          filterReports: outcome.value.filterReports,
          ...(outcome.value.providerMetadata === undefined
            ? {}
            : { providerMetadata: outcome.value.providerMetadata }),
        }
      : { query: outcome.input, error: outcome.error },
  );
}

function mutableSearchResult(result: ReadonlySearchResult): SearchResult {
  const { highlights, metadata, ...rest } = result;
  return {
    ...rest,
    ...(highlights ? { highlights: [...highlights] } : {}),
    ...(metadata ? { metadata: { ...metadata } } : {}),
  };
}

function validateBatch(
  inputs: readonly string[],
  label: "query" | "URL",
  EmptyInputError: new () => Error,
): void {
  if (inputs.length === 0) {
    throw new TypeError(`Batch must contain at least one ${label}`);
  }
  if (inputs.length > MAX_BATCH_ITEMS) {
    throw new RangeError(`Batch cannot contain more than ${MAX_BATCH_ITEMS} items`);
  }
  if (inputs.some((input) => !input.trim())) {
    throw new EmptyInputError();
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\p{Cc}/gu, " ");
}
