import { stripVTControlCharacters } from "node:util";

const ERROR_MESSAGE_UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

/** Base error for all web operations. */
export class WebError extends Error {
  constructor(message: string, options?: Readonly<ErrorOptions>) {
    super(message, options);
    this.name = "WebError";
  }
}

/** Non-auth HTTP error with status code, URL, and response body. */
export class HTTPError extends WebError {
  readonly statusCode: number;
  readonly url: string;
  readonly body: string;

  constructor(statusCode: number, url: string, body: string) {
    super(formatHTTPErrorMessage(statusCode, url, body));
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

function formatHTTPErrorMessage(statusCode: number, url: string, body: string): string {
  const header = `HTTP ${statusCode}: ${url}`;
  const safeBody = stripVTControlCharacters(body)
    .replaceAll(ERROR_MESSAGE_UNSAFE, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return safeBody.length > 0 ? `${header}: ${safeBody}` : header;
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

/** Thrown on HTTP 429. Check {@link retryAfter} for seconds until retry. */
export class RateLimitError extends WebError {
  readonly retryAfter: number;

  constructor(retryAfter: number) {
    super(`Rate limited. Retry after ${retryAfter}s`);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
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
 * Maps HTTP status codes to specific error types: 401 to AuthError, 429 to RateLimitError.
 * @param {*} error - Caught value.
 * @param {string} provider - Provider that raised the error.
 * @returns {WebError} Normalized web error.
 */
export function normalizeError(error: unknown, provider?: string): WebError {
  if (error instanceof HTTPError && error.statusCode === 401) {
    return new AuthError(
      `Authentication failed: ${error.body || "Invalid or missing API key"}`,
      provider || "unknown",
    );
  }

  if (error instanceof WebError) {
    return error;
  }

  if (isFetchLikeError(error)) return normalizeFetchLikeError(error, provider);

  if (error instanceof Error) {
    return new WebError(error.message);
  }

  return new WebError(String(error));
}

type FetchLikeError = {
  readonly status: number;
  readonly message: string;
  readonly response?: { readonly headers?: { readonly get: (key: string) => string | null } };
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
  const message = error.message || `HTTP ${error.status}`;
  switch (error.status) {
    case 401:
      return new AuthError(`Authentication failed: ${message}`, provider || "unknown");
    case 404:
      return new HTTPError(404, "", message);
    case 429:
      return new RateLimitError(parseRetryAfter(error.response?.headers?.get("Retry-After")));
    default:
      return error.status >= 500 ? new HTTPError(error.status, "", message) : new WebError(message);
  }
}

export const DEFAULT_RETRY_AFTER = 60;

export function parseRetryAfter(header: string | null | undefined): number {
  if (header === null || header === undefined) {
    return DEFAULT_RETRY_AFTER;
  }

  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) {
    return DEFAULT_RETRY_AFTER;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RETRY_AFTER;
  }

  return parsed;
}
