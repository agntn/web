import type {
  ReadonlySearchAllEvidence,
  ReadonlySearchAllResult,
  SearchBatchItem,
} from "./batch.ts";
import type { ReadonlySearchResult } from "./types.ts";

/** A fan-out result whose `evidence` lists only the records beyond its own. */
export type SearchAllAgentResult = Omit<ReadonlySearchAllResult, "evidence"> & {
  readonly evidence?: readonly ReadonlySearchAllEvidence[];
};

/** Search results as agent surfaces send them to the model. */
export type SearchAgentResults = readonly (ReadonlySearchResult | SearchAllAgentResult)[];

type SearchBatchSuccess = Extract<SearchBatchItem, { readonly results: unknown }>;
type SearchBatchFailure = Exclude<SearchBatchItem, { readonly results: unknown }>;
type ReadonlySearchBatchItem =
  | (Omit<SearchBatchSuccess, "results"> & {
      readonly results: readonly (ReadonlySearchResult | ReadonlySearchAllResult)[];
    })
  | SearchBatchFailure;

/** A batch item as agent surfaces send it to the model. */
export type SearchBatchAgentItem =
  | (Omit<SearchBatchSuccess, "results"> & { readonly results: SearchAgentResults })
  | SearchBatchFailure;

/**
 * Drop the evidence record each fan-out result already is.
 *
 * `searchAllDetailed()` builds a result as a copy of its first provider record and keeps that
 * record as `evidence[0]`, so the full shape carries it twice. Agent surfaces send each record
 * once: the result is the first provider's record and `evidence`, present only when another
 * provider returned the page, holds the rest. Results without evidence pass through unchanged.
 * @param results - Results of one search, fan-out or not.
 * @returns {SearchAgentResults} The same results without the repeated record.
 */
export function withoutRepeatedEvidence(
  results: readonly (ReadonlySearchResult | ReadonlySearchAllResult)[],
): SearchAgentResults {
  return results.map((result) => {
    if (!("evidence" in result)) return result;
    const { evidence, ...record } = result;
    const others = evidence.slice(1);
    return others.length === 0 ? record : { ...record, evidence: others };
  });
}

/**
 * Apply {@link withoutRepeatedEvidence} to every successful batch item.
 * @param items - Batch outcomes from `searchBatch()`.
 * @returns {SearchBatchAgentItem[]} The same outcomes without repeated evidence records.
 */
export function batchWithoutRepeatedEvidence(
  items: readonly ReadonlySearchBatchItem[],
): SearchBatchAgentItem[] {
  return items.map((item) =>
    "results" in item ? { ...item, results: withoutRepeatedEvidence(item.results) } : item,
  );
}
