import { createHash } from "node:crypto";
import { InvalidSearchContinuationError } from "./errors.ts";
import type { SearchRequestOptions } from "./types.ts";

interface SearchContinuationPayload {
  readonly version: 1;
  readonly provider: string;
  readonly requestFingerprint: string;
  readonly providerContinuation: string;
}

interface SearchContinuationEnvelope {
  readonly payload: string;
  readonly checksum: string;
}

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
  const payload: SearchContinuationPayload = {
    version: 1,
    provider,
    requestFingerprint: requestFingerprint(query, options),
    providerContinuation,
  };
  const serializedPayload = JSON.stringify(payload);
  const envelope: SearchContinuationEnvelope = {
    payload: serializedPayload,
    checksum: continuationChecksum(serializedPayload),
  };
  const token = Buffer.from(JSON.stringify(envelope)).toString("base64url");
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
  const payload = decodePayload(token);
  if (payload.requestFingerprint !== requestFingerprint(query, options)) {
    throw new InvalidSearchContinuationError();
  }
  return payload;
}

function decodePayload(token: string): SearchContinuationPayload {
  if (!token || token.length > MAX_SEARCH_CONTINUATION_LENGTH) {
    throw new InvalidSearchContinuationError();
  }
  try {
    const envelope: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (!isSearchContinuationEnvelope(envelope)) throw new InvalidSearchContinuationError();
    if (envelope.checksum !== continuationChecksum(envelope.payload)) {
      throw new InvalidSearchContinuationError();
    }
    const payload: unknown = JSON.parse(envelope.payload);
    if (!isSearchContinuationPayload(payload)) throw new InvalidSearchContinuationError();
    return payload;
  } catch (error) {
    if (error instanceof InvalidSearchContinuationError) throw error;
    throw new InvalidSearchContinuationError();
  }
}

function requestFingerprint(query: string, options: Readonly<SearchRequestOptions>): string {
  return fingerprint(
    JSON.stringify([
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
    ]),
  );
}

function valueOr<TValue, TFallback>(
  value: TValue | undefined,
  fallback: TFallback,
): TValue | TFallback {
  return value ?? fallback;
}

/**
 * Calculate the envelope's corruption checksum; this is not an authorization signature.
 * @param payload - Serialized continuation payload.
 * @returns {string} Base64url-encoded SHA-256 digest.
 */
function continuationChecksum(payload: string): string {
  return fingerprint(`@agntn/web/search-continuation/v1\0${payload}`);
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function isSearchContinuationEnvelope(value: unknown): value is SearchContinuationEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Readonly<Record<string, unknown>>;
  return typeof envelope.payload === "string" && typeof envelope.checksum === "string";
}

function isSearchContinuationPayload(value: unknown): value is SearchContinuationPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Readonly<Record<string, unknown>>;
  return (
    payload.version === 1 &&
    isContinuationProvider(payload.provider) &&
    isNonemptyString(payload.requestFingerprint) &&
    isProviderContinuation(payload.providerContinuation)
  );
}

function isContinuationProvider(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isProviderContinuation(value: unknown): value is string {
  return isNonemptyString(value) && value.length <= MAX_PROVIDER_SEARCH_CONTINUATION_LENGTH;
}
