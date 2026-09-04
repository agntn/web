import { detectAvailableProviders, searchAllDetailed, type SearchPagination } from "@agntn/web";

export interface FanoutResult extends WireResult {
  /** Every provider that returned this URL, the first one being the representative. */
  providers: string[];
}

/** The deduplicated answer of every configured provider for one query. */
export interface FanoutAnswer {
  query: string;
  results: FanoutResult[];
  /** Providers asked, in the order the library tried them. */
  providers: string[];
  successfulProviders: string[];
  errors: WireFailure[];
  providerPagination: { provider: string; status: SearchPagination["status"] }[];
  fetchedAt: string;
}

/** The providers the worker fans out to: everything configured except a self-hosted SearXNG the worker cannot reach. */
function fanoutProviders(): string[] {
  return detectAvailableProviders().filter((name) => name !== "searxng");
}

/** Fan-out through `searchAllDetailed` over every provider the worker has a key for. */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const q = requireString(query, "q", LIMITS.query);
  const maxResults = readInt(query, "maxResults", 1, LIMITS.maxResults) ?? 6;
  const providers = fanoutProviders();
  const params = { q, maxResults, providers };
  try {
    if (providers.length === 0) {
      throw createError({ statusCode: 503, statusMessage: "No search provider is configured on the docs worker" });
    }
    return await cachedAnswer<FanoutAnswer>(
      event,
      "fanout",
      params,
      TTL.fanout,
      async () => {
        const answer = await searchAllDetailed(q, { providers, maxResults, ...budget() });
        return {
          query: q,
          results: answer.results.map((result) => ({ ...slimResult(result), providers: result.providers })),
          providers,
          successfulProviders: answer.successfulProviders,
          errors: answer.errors.map((entry) => ({ provider: entry.provider, message: failureText(entry.error.message) })),
          providerPagination: answer.providerPagination.map((entry) => ({ provider: entry.provider, status: entry.pagination.status })),
          fetchedAt: new Date().toISOString(),
        };
      },
      (answer) => answer.errors.length > 0,
    );
  } catch (error) {
    return toHttpError(error);
  }
});
