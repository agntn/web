import { searchProviderDetailed, searchWithFallback, type SearchPagination } from "@agntn/web";

/** One provider's answer for one query, with the diagnostics the library attaches. */
export interface SearchAnswer {
  query: string;
  /** What the caller asked for: a provider name, or `auto`. */
  requestedProvider: string;
  /** The provider that answered. */
  provider: string;
  results: WireResult[];
  /** The status of the page; the continuation itself stays on the worker. */
  pagination: SearchPagination["status"];
  ignoredFilters: readonly string[];
  undeclaredFilters: readonly string[];
  /** Automatic selection only: every provider tried, in order, and why the earlier ones failed. */
  attempts?: readonly string[];
  failures?: WireFailure[];
  fetchedAt: string;
}

/** Search through `searchProviderDetailed`, or `searchWithFallback` without a provider, exactly as a script would. */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const q = requireString(query, "q", LIMITS.query);
  const provider = readProvider(query);
  const maxResults = readInt(query, "maxResults", 1, LIMITS.maxResults) ?? 5;
  const params = { q, provider: provider ?? "auto", maxResults };
  try {
    return await cachedAnswer<SearchAnswer>(
      event,
      "search",
      params,
      TTL.search,
      async () => {
        const options = { maxResults, ...budget() };
        const fetchedAt = new Date().toISOString();
        if (provider) {
          const answer = await searchProviderDetailed(provider, q, options);
          return {
            query: q,
            requestedProvider: provider,
            provider: answer.provider,
            results: answer.results.map(slimResult),
            pagination: answer.pagination.status,
            ignoredFilters: answer.ignoredFilters,
            undeclaredFilters: answer.undeclaredFilters,
            fetchedAt,
          };
        }
        const answer = await searchWithFallback(q, options);
        return {
          query: q,
          requestedProvider: "auto",
          provider: answer.provider,
          results: answer.results.map(slimResult),
          pagination: answer.pagination.status,
          ignoredFilters: answer.ignoredFilters,
          undeclaredFilters: answer.undeclaredFilters,
          attempts: answer.attempts,
          failures: slimFailures(answer.failures),
          fetchedAt,
        };
      },
      (answer) => Boolean(answer.failures?.length),
    );
  } catch (error) {
    return toHttpError(error);
  }
});
