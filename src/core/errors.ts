import { stripVTControlCharacters } from "node:util";
import { sanitizeUrl, sanitizeUrlsIn } from "./redaction.ts";
import { clip } from "./text.ts";

const ERROR_MESSAGE_UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;
const MESSAGE_BODY_MAX_CHARACTERS = 1000;

export function validateMaxResults(maxResults: number | undefined): void {
  if (maxResults !== undefined && (!Number.isInteger(maxResults) || maxResults < 1)) {
    throw new TypeError("maxResults must be a positive integer");
  }
}

/** Base error for all web operations. */
export class WebError extends Error {
  constructor(message: string, options?: Readonly<ErrorOptions>) {
    super(message, options);
    this.name = "WebError";
  }
}

/** HTTP failure with status code, URL, and response body. */
export class HTTPError extends WebError {
  readonly statusCode: number;
  readonly url: string;
  readonly body: string;

  constructor(statusCode: number, url: string, body: string, options?: Readonly<ErrorOptions>) {
    super(formatHTTPErrorMessage(statusCode, url, body), options);
    this.name = "HTTPError";
    this.statusCode = statusCode;
    this.url = url;
    this.body = body;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  isRateLimit(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500;
  }
}

/** Provider credit exhaustion, retaining the original HTTP status and response. */
export class PaymentError extends HTTPError {
  constructor(statusCode: number, url: string, body: string) {
    super(statusCode, url, body);
    this.name = "PaymentError";
  }
}

/**
 * A reader's own fetcher could not get the page: a bot check, a login wall, a timeout or a network failure on its side.
 * Another reader fetches the page its own way, so automatic reads move on to the next one.
 */
export class PageFetchError extends WebError {
  constructor(message: string) {
    super(message);
    this.name = "PageFetchError";
  }
}

function formatHTTPErrorMessage(statusCode: number, url: string, body: string): string {
  const shownUrl = messageExcerpt(url);
  const header = shownUrl ? `HTTP ${statusCode}: ${shownUrl}` : `HTTP ${statusCode}`;
  const excerpt = messageExcerpt(body);
  return excerpt.length > 0 ? `${header}: ${excerpt}` : header;
}

/**
 * Quote a response body or a URL in an error message, safe for terminals and bounded.
 * A proxy or bot check can answer with a whole HTML page, and the message travels into every failure an agent reads.
 * @param text - Raw body or URL, kept whole on {@link HTTPError.body} and {@link HTTPError.url}.
 * @returns {string} Single-line text, cut with an ellipsis past {@link MESSAGE_BODY_MAX_CHARACTERS}.
 */
function messageExcerpt(text: string): string {
  const safe = stripVTControlCharacters(text)
    .replaceAll(ERROR_MESSAGE_UNSAFE, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return clip(safe, MESSAGE_BODY_MAX_CHARACTERS);
}

/** Thrown when a provider rejects the API key (HTTP 401). */
export class AuthError extends WebError {
  readonly provider: string;

  constructor(message: string, provider: string) {
    super(message);
    this.name = "AuthError";
    this.provider = provider;
  }
}

/**
 * Build the error for a rejected credential, naming the provider in the message.
 * Agent surfaces show only the message, so with automatic selection it is the one place that says which key failed.
 * @param detail - What the provider said about the credential.
 * @param provider - Provider that rejected it, when known.
 * @returns {AuthError} Error whose message starts with `Authentication failed for <provider>`.
 */
export function authenticationFailed(detail: string, provider?: string): AuthError {
  const subject = provider ? `Authentication failed for ${provider}` : "Authentication failed";
  return new AuthError(`${subject}: ${detail}`, provider || "unknown");
}

/**
 * Thrown on HTTP 429. Check {@link retryAfter} for seconds until retry.
 * The message names {@link provider} when it is known, since agent surfaces show only the message.
 */
export class RateLimitError extends WebError {
  readonly retryAfter: number;
  readonly provider?: string;

  constructor(retryAfter: number, provider?: string) {
    const subject = provider ? `Rate limited by ${provider}` : "Rate limited";
    super(`${subject}. Retry after ${retryAfter}s`);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    if (provider) this.provider = provider;
  }
}

/** Thrown when {@link create} is called with an unregistered provider name. */
export class UnknownProviderError extends WebError {
  readonly provider: string;

  constructor(provider: string) {
    super(`Unknown provider: ${provider}`);
    this.name = "UnknownProviderError";
    this.provider = provider;
  }
}

/** Thrown when the search query is empty or whitespace-only. */
export class EmptyQueryError extends WebError {
  constructor() {
    super("Search query cannot be empty");
    this.name = "EmptyQueryError";
  }
}

/** Thrown when a search continuation is malformed or belongs to another request. */
export class InvalidSearchContinuationError extends WebError {
  constructor() {
    super("Invalid search continuation token");
    this.name = "InvalidSearchContinuationError";
  }
}

/** Thrown when the reverse image search URL is empty or whitespace-only. */
export class EmptyImageUrlError extends WebError {
  constructor() {
    super("Image URL cannot be empty");
    this.name = "EmptyImageUrlError";
  }
}

/** Thrown when reverse image search receives a non-HTTP URL. */
export class InvalidImageUrlError extends WebError {
  constructor() {
    super("Image URL must be an absolute HTTP or HTTPS URL");
    this.name = "InvalidImageUrlError";
  }
}

/** Thrown when the read URL is empty or whitespace-only. */
export class EmptyUrlError extends WebError {
  constructor() {
    super("Read URL cannot be empty");
    this.name = "EmptyUrlError";
  }
}

/** Thrown when a read continuation token is malformed or belongs to another request. */
export class InvalidReadContinuationError extends WebError {
  constructor() {
    super("Invalid read continuation token");
    this.name = "InvalidReadContinuationError";
  }
}

/** Thrown when the page changed before a continued read. */
export class StaleReadContinuationError extends WebError {
  constructor() {
    super("Read content changed since the continuation token was issued");
    this.name = "StaleReadContinuationError";
  }
}

export class InvalidProviderUrlError extends WebError {
  readonly provider: string;

  constructor(provider: string) {
    super(`Invalid base URL for provider "${provider}": expected an absolute http or https URL`);
    this.name = "InvalidProviderUrlError";
    this.provider = provider;
  }
}

/** Thrown when a provider does not implement the search capability. */
export class SearchNotSupportedError extends WebError {
  readonly provider: string;

  constructor(provider: string) {
    super(`Provider does not support search: ${provider}`);
    this.name = "SearchNotSupportedError";
    this.provider = provider;
  }
}

/** Thrown when a provider does not implement reverse image search. */
export class ImageSearchNotSupportedError extends WebError {
  readonly provider: string;

  constructor(provider: string) {
    super(`Provider does not support reverse image search: ${provider}`);
    this.name = "ImageSearchNotSupportedError";
    this.provider = provider;
  }
}

/** Thrown when a provider does not implement the read capability. */
export class ReadNotSupportedError extends WebError {
  readonly provider: string;

  constructor(provider: string) {
    super(`Provider does not support read: ${provider}`);
    this.name = "ReadNotSupportedError";
    this.provider = provider;
  }
}

/** Thrown when no provider can be selected from env or registry. */
export class NoProviderConfiguredError extends WebError {
  constructor() {
    super("No web search provider configured. Set an API key env var or register a provider.");
    this.name = "NoProviderConfiguredError";
  }
}

/** Thrown when providers are configured but none are currently reachable. */
export class NoProviderAvailableError extends WebError {
  readonly providers: readonly string[];

  constructor(providers: readonly string[]) {
    const providerList = providers.length > 0 ? providers.join(", ") : "unknown";
    super(`No configured web search provider is currently reachable: ${providerList}`);
    this.name = "NoProviderAvailableError";
    this.providers = providers;
  }
}

/** Thrown when a date filter string is not valid ISO 8601 or the range is reversed. */
export class InvalidDateFilterError extends WebError {
  readonly field: string;
  readonly value: string;
  readonly reason: string;

  constructor(field: string, value: string, reason: string) {
    super(`Invalid date filter ${field}="${value}": ${reason}`);
    this.name = "InvalidDateFilterError";
    this.field = field;
    this.value = value;
    this.reason = reason;
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;
const HAS_OFFSET_RE = /Z|[+-]\d{2}:\d{2}$/;

export function validateDateFilters(startPublishedDate?: string, endPublishedDate?: string): void {
  validateDateFilter("startPublishedDate", startPublishedDate);
  validateDateFilter("endPublishedDate", endPublishedDate);
  validateDateOrder(startPublishedDate, endPublishedDate);
}

function validateDateFilter(
  field: "startPublishedDate" | "endPublishedDate",
  value?: string,
): void {
  if (value === undefined) return;
  if (!ISO_DATE_RE.test(value)) {
    throw new InvalidDateFilterError(
      field,
      value,
      'must be ISO 8601 (e.g. "2024-01-01" or "2024-01-01T00:00:00Z")',
    );
  }
  if (value.includes("T") && !HAS_OFFSET_RE.test(value)) {
    throw new InvalidDateFilterError(field, value, "datetime must include Z or ±HH:mm offset");
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new InvalidDateFilterError(field, value, "not a valid date");
  }
  validateCalendarDate(field, value);
}

function validateCalendarDate(
  field: "startPublishedDate" | "endPublishedDate",
  value: string,
): void {
  const [year, month, day] = value.split("T")[0].split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new InvalidDateFilterError(field, value, "not a valid calendar date");
  }
}

function validateDateOrder(start?: string, end?: string): void {
  if (start === undefined || end === undefined || Date.parse(start) <= Date.parse(end)) return;
  throw new InvalidDateFilterError(
    "startPublishedDate",
    start,
    `start date is after end date "${end}"`,
  );
}

/**
 * Convert any caught error into a typed {@link WebError} subclass.
 * Preserves payment errors; otherwise maps 401 to AuthError and 429 to RateLimitError, naming the provider on both.
 * @param {*} error - Caught value.
 * @param {string} provider - Provider that raised the error.
 * @returns {WebError} Normalized web error.
 */
export function normalizeError(error: unknown, provider?: string): WebError {
  if (error instanceof PaymentError) return error;
  if (error instanceof HTTPError && error.statusCode === 401) {
    return authenticationFailed(
      messageExcerpt(error.body) || "Invalid or missing API key",
      provider,
    );
  }

  if (error instanceof WebError) {
    return rateLimitedBy(error, provider);
  }

  if (isFetchLikeError(error)) return normalizeFetchLikeError(error, provider);

  if (error instanceof Error) {
    return new WebError(error.message);
  }

  return new WebError(String(error));
}

/**
 * Name the provider on a rate limit the HTTP client raised before any adapter was known.
 * @param error - Typed error from the client or the adapter.
 * @param provider - Provider that raised it, when known.
 * @returns {WebError} The same error, or a {@link RateLimitError} naming `provider`.
 */
function rateLimitedBy(error: Readonly<WebError>, provider?: string): WebError {
  if (!(error instanceof RateLimitError) || error.provider !== undefined || !provider) return error;
  return new RateLimitError(error.retryAfter, provider);
}

type FetchLikeError = {
  readonly status: number;
  readonly message: string;
  readonly response?: {
    readonly url?: unknown;
    readonly headers?: { readonly get: (key: string) => string | null };
  };
};

function isFetchLikeError(error: unknown): error is FetchLikeError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

function normalizeFetchLikeError(error: FetchLikeError, provider?: string): WebError {
  const message = sanitizeUrlsIn(error.message) || `HTTP ${error.status}`;
  switch (error.status) {
    case 401:
      return authenticationFailed(message, provider);
    case 404:
      return new HTTPError(404, responseUrl(error), message);
    case 429:
      return rateLimitError(error.response?.headers, provider);
    default:
      return error.status >= 500
        ? new HTTPError(error.status, responseUrl(error), message)
        : new WebError(message);
  }
}

/**
 * Where a fetch-like error's response came from, the way ofetch's `FetchError` keeps it.
 * @param error - Fetch-like error from a custom provider.
 * @returns {string} The redacted response URL, or empty when the error doesn't carry one.
 */
function responseUrl(error: FetchLikeError): string {
  const url = error.response?.url;
  return typeof url === "string" ? sanitizeUrl(url) : "";
}

export const DEFAULT_RETRY_AFTER = 60;

/** A reset this large is a Unix timestamp, not seconds to wait. */
const EPOCH_SECONDS_FLOOR = 1_000_000_000;

type ResponseHeaders = Readonly<{ get: (name: string) => string | null }>;

/**
 * Build the error for a 429 response, waiting {@link DEFAULT_RETRY_AFTER} when its headers name no wait.
 * @param headers - Response headers of the rate limited request.
 * @param provider - Provider that answered, when known.
 * @returns {RateLimitError} Error carrying the wait in `retryAfter`.
 */
export function rateLimitError(headers?: ResponseHeaders, provider?: string): RateLimitError {
  return new RateLimitError(rateLimitWait(headers) ?? DEFAULT_RETRY_AFTER, provider);
}

/**
 * Seconds a rate limited response asks the caller to wait.
 * `Retry-After` comes first. Without it, `X-RateLimit-Reset` counts seconds per window, as Brave
 * sends it (`1, 56000` beside `X-RateLimit-Remaining: 0, 445`), and the longest reset among the
 * windows with nothing left is the wait.
 * @param headers - Response headers of the rate limited request.
 * @returns {number | undefined} Seconds to wait, or undefined when the response gives no usable hint.
 */
export function rateLimitWait(headers?: ResponseHeaders): number | undefined {
  return seconds(headers?.get("Retry-After") ?? undefined) ?? exhaustedWindowReset(headers);
}

function exhaustedWindowReset(headers?: ResponseHeaders): number | undefined {
  const resets = secondsList(headers?.get("X-RateLimit-Reset"));
  if (!resets || resets.some((reset) => reset >= EPOCH_SECONDS_FLOOR)) return undefined;
  const remaining = secondsList(headers?.get("X-RateLimit-Remaining"));
  if (remaining?.length !== resets.length) return resets.length === 1 ? resets[0] : undefined;

  const exhausted = resets.filter((_, index) => remaining[index] === 0);
  return exhausted.length > 0 ? Math.max(...exhausted) : undefined;
}

function secondsList(header: string | null | undefined): number[] | undefined {
  const values = header?.split(",").map(seconds);
  return values?.every((value): value is number => value !== undefined) ? values : undefined;
}

function seconds(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || !/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
