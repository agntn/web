import { EmptyQueryError, EmptyUrlError } from "./errors.ts";
import { searchAllDetailed } from "./all.ts";
import { createSearchProvider } from "./registry.ts";
import { readUrl, type ReadUrlOptions } from "./read.ts";
import { resolveDefaultProviderAsync } from "./resolve.ts";
import type { WebSearchProviderName } from "./providers.ts";
import type { ReadResult, SearchRequestOptions, SearchResult } from "./types.ts";

/** Maximum number of network operations accepted by one agent-tool batch. */
export const MAX_BATCH_ITEMS = 10;

/** Shared search options applied to every query in a batch. */
export type SearchBatchOptions = SearchRequestOptions & {
  readonly provider?: WebSearchProviderName | "all";
};

/** One successful or failed query outcome. */
export type SearchBatchItem =
  | { readonly query: string; readonly results: readonly SearchResult[] }
  | { readonly query: string; readonly error: string };

/** One successful or failed URL outcome. */
export type ReadBatchItem =
  | { readonly url: string; readonly result: ReadResult }
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

  try {
    const providerName = requestedProvider ?? (await resolveDefaultProviderAsync());
    const provider = createSearchProvider(providerName);
    return mapSearchOutcomes(
      await settleBatch(queries, (query) => provider.search(query, searchOptions)),
    );
  } catch (error) {
    return queries.map((query) => ({ query, error: errorMessage(error) }));
  }
}

/**
 * Reads independent URLs in parallel while preserving input order and failures.
 * @param urls - URLs to read.
 * @param options - Shared provider and read options.
 * @returns {Promise<readonly ReadBatchItem[]>} One result or error for every URL.
 */
export async function readBatch(
  urls: readonly string[],
  options?: Readonly<ReadUrlOptions>,
): Promise<readonly ReadBatchItem[]> {
  validateBatch(urls, "URL", EmptyUrlError);
  const outcomes = await settleBatch(urls, (url) => readUrl(url, options));
  return outcomes.map((outcome): ReadBatchItem =>
    outcome.ok
      ? { url: outcome.input, result: outcome.value }
      : { url: outcome.input, error: outcome.error },
  );
}

type BatchOutcome<TResult> =
  | { readonly ok: true; readonly input: string; readonly value: TResult }
  | { readonly ok: false; readonly input: string; readonly error: string };

async function searchAllForBatch(
  query: string,
  options: SearchRequestOptions,
): Promise<readonly SearchResult[]> {
  const response = await searchAllDetailed(query, options);
  if (response.results.length === 0 && response.errors.length > 0) {
    const errors = response.errors.map(({ provider, error }) => `${provider}: ${error.message}`);
    throw new Error(`Search providers failed: ${errors.join("; ")}`);
  }
  return response.results;
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

function mapSearchOutcomes<TResult extends readonly SearchResult[]>(
  outcomes: readonly BatchOutcome<TResult>[],
): readonly SearchBatchItem[] {
  return outcomes.map((outcome): SearchBatchItem =>
    outcome.ok
      ? { query: outcome.input, results: outcome.value }
      : { query: outcome.input, error: outcome.error },
  );
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
