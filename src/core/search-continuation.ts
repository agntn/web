import { openContinuation, sealContinuation } from "./continuation.ts";
import { InvalidSearchContinuationError } from "./errors.ts";
import type { SearchRequestOptions } from "./types.ts";

interface SearchContinuationPayload {
  readonly provider: string;
  readonly providerContinuation: string;
}

const SEARCH_CONTINUATION = "@agntn/web/search-continuation/v2";

export const MAX_SEARCH_CONTINUATION_LENGTH = 4_096;
export const MAX_PROVIDER_SEARCH_CONTINUATION_LENGTH = 2_048;

export function encodeSearchContinuation(
  provider: string,
  query: string,
  options: Readonly<SearchRequestOptions>,
  providerContinuation: string,
): string {
  if (
    !providerContinuation ||
    providerContinuation.length > MAX_PROVIDER_SEARCH_CONTINUATION_LENGTH
  ) {
    throw new InvalidSearchContinuationError();
  }
  const token = sealContinuation(
    SEARCH_CONTINUATION,
    [provider, providerContinuation],
    searchRequest(query, options),
  );
  if (token.length > MAX_SEARCH_CONTINUATION_LENGTH) {
    throw new InvalidSearchContinuationError();
  }
  return token;
}

export function decodeSearchContinuation(
  token: string,
  query: string,
  options: Readonly<SearchRequestOptions>,
): SearchContinuationPayload {
  if (!token || token.length > MAX_SEARCH_CONTINUATION_LENGTH) {
    throw new InvalidSearchContinuationError();
  }
  const fields = openContinuation(SEARCH_CONTINUATION, token, 2, searchRequest(query, options));
  if (!fields) throw new InvalidSearchContinuationError();
  const [provider = "", providerContinuation = ""] = fields;
  if (!isContinuationProvider(provider) || !isProviderContinuation(providerContinuation)) {
    throw new InvalidSearchContinuationError();
  }
  return { provider, providerContinuation };
}

function searchRequest(query: string, options: Readonly<SearchRequestOptions>): string {
  return JSON.stringify([
    query,
    valueOr(options.maxResults, 10),
    valueOr(options.highlights, null),
    valueOr(options.summary, null),
    valueOr(options.fullText, null),
    valueOr(options.includeDomains, null),
    valueOr(options.excludeDomains, null),
    valueOr(options.sources, null),
    valueOr(options.categories, null),
    valueOr(options.startPublishedDate, null),
    valueOr(options.endPublishedDate, null),
    valueOr(options.category, null),
  ]);
}

function valueOr<TValue, TFallback>(
  value: TValue | undefined,
  fallback: TFallback,
): TValue | TFallback {
  return value ?? fallback;
}

function isContinuationProvider(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function isProviderContinuation(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PROVIDER_SEARCH_CONTINUATION_LENGTH;
}
