import type { $Fetch } from "ofetch";
import type { ClientOptions } from "./types.ts";
import { HTTPError, RateLimitError, parseRetryAfter } from "./errors.ts";
import { version } from "../version.ts";
import { readSseJson } from "./sse.ts";

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY = 50;
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_USER_AGENT = `agntn-web/${version}`;
const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_CAUSE_DEPTH = 8;

type Ofetch = typeof import("ofetch");
let ofetchModule: Promise<Ofetch> | undefined;

/**
 * Loads ofetch with the first request. Its Node entry imports `node:http` and `node:https`, so a
 * static import made every MCP server start and every provider listing pay for an HTTP stack
 * they never used.
 * @returns {Promise<Ofetch>} The cached ofetch module.
 */
function loadOfetch(): Promise<Ofetch> {
  ofetchModule ??= import("ofetch");
  return ofetchModule;
}

/** HTTP client with exponential backoff retry and error mapping to web error types. */
export class Client {
  readonly maxRetries: number;
  readonly baseDelay: number;
  readonly timeout: number;
  readonly userAgent: string;
  private fetch: Promise<$Fetch> | undefined;

  constructor(options: Readonly<ClientOptions> = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelay = options.baseDelay ?? DEFAULT_BASE_DELAY;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  /** @returns {Promise<$Fetch>} The ofetch instance, created with the first request. */
  private fetcher(): Promise<$Fetch> {
    const maxRetries = this.maxRetries;
    const baseDelay = this.baseDelay;

    this.fetch ??= loadOfetch().then(({ ofetch }) =>
      ofetch.create({
        retry: maxRetries,
        retryDelay(context) {
          const remaining = typeof context.options.retry === "number" ? context.options.retry : 0;
          const attempt = maxRetries - remaining;
          const delay = baseDelay * Math.pow(2, attempt - 1);
          const jitter = delay * Math.random() * 0.1;
          return delay + jitter;
        },
        retryStatusCodes: [408, 429, 500, 502, 503, 504],
        timeout: this.timeout,
        headers: {
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
      }),
    );
    return this.fetch;
  }

  /**
   * Send a GET request and parse the JSON response.
   * @param {string} url - Request URL.
   * @param {Readonly<Record<string, string>>} headers - Additional headers.
   * @param {Readonly<AbortSignal>} signal - Cancellation signal.
   * @returns {Promise<T>} Parsed response body.
   */
  async getJSON<T>(
    url: string,
    headers?: Readonly<Record<string, string>>,
    signal?: Readonly<AbortSignal>,
  ): Promise<T> {
    try {
      const fetch = await this.fetcher();
      return signal
        ? await this.fetchWithCancellation(
            (attemptSignal) => fetch<T>(url, { headers, signal: attemptSignal, retry: false }),
            signal,
          )
        : await fetch<T>(url, { headers, signal });
    } catch (error) {
      throw await this.mapError(error, url);
    }
  }

  /**
   * Send a POST request with a JSON body and parse the JSON response.
   * @param {string} url - Request URL.
   * @param {Readonly<Record<string, unknown>>} body - JSON request body.
   * @param {Readonly<Record<string, string>>} headers - Additional headers.
   * @param {Readonly<AbortSignal>} signal - Cancellation signal.
   * @returns {Promise<T>} Parsed response body.
   */
  async postJSON<T>(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers?: Readonly<Record<string, string>>,
    signal?: Readonly<AbortSignal>,
  ): Promise<T> {
    try {
      const fetch = await this.fetcher();
      return signal
        ? await this.fetchWithCancellation(
            (attemptSignal) =>
              fetch<T>(url, {
                method: "POST",
                body,
                headers,
                signal: attemptSignal,
                retry: false,
              }),
            signal,
          )
        : await fetch<T>(url, {
            method: "POST",
            body,
            headers,
            signal,
          });
    } catch (error) {
      throw await this.mapError(error, url);
    }
  }

  /**
   * Stream a metered POST without retries, redirects, or upstream error bodies.
   * @param url - Request URL.
   * @param body - JSON request body.
   * @param headers - Authentication and protocol headers.
   * @param signal - Caller cancellation.
   * @yields {unknown} Parsed JSON data events.
   * @returns {AsyncGenerator<unknown>} Bounded JSON SSE events.
   */
  async *postSSE(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers?: Readonly<Record<string, string>>,
    signal?: Readonly<AbortSignal>,
  ): AsyncGenerator<unknown> {
    const controller = new AbortController();
    const timer =
      this.timeout > 0
        ? setTimeout(
            () => controller.abort(new DOMException("Stream timed out", "TimeoutError")),
            this.timeout,
          )
        : undefined;
    const effectiveSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const safeUrl = sanitizeUrl(url);
    try {
      effectiveSignal.throwIfAborted();
      const stream = await this.openSSE(url, body, headers, effectiveSignal);
      yield* readSseJson(stream, safeUrl, effectiveSignal);
    } catch (error) {
      effectiveSignal.throwIfAborted();
      if (error instanceof HTTPError || error instanceof RateLimitError) throw error;
      throw new HTTPError(502, safeUrl, "Event stream transport failed");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async openSSE(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string>> | undefined,
    signal: Readonly<AbortSignal>,
  ): Promise<Readonly<ReadableStream<Uint8Array>>> {
    const safeUrl = sanitizeUrl(url);
    const fetch = await this.fetcher();
    const response = await fetch.raw<unknown, "stream">(url, {
      method: "POST",
      body,
      headers: { ...headers, Accept: "text/event-stream" },
      responseType: "stream",
      redirect: "error",
      retry: false,
      timeout: 0,
      ignoreResponseError: true,
      signal,
    });
    signal.throwIfAborted();
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 429)
        throw new RateLimitError(parseRetryAfter(response.headers.get("Retry-After")));
      throw new HTTPError(response.status, safeUrl, "Streaming request rejected");
    }
    const contentType = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    if (!response._data || (contentType !== undefined && contentType !== "text/event-stream")) {
      await response.body?.cancel().catch(() => {});
      throw new HTTPError(502, safeUrl, "Expected an SSE response body");
    }
    return response._data;
  }

  private async fetchWithCancellation<T>(
    request: (signal: Readonly<AbortSignal>) => Promise<T>,
    signal: Readonly<AbortSignal>,
  ): Promise<T> {
    const { FetchError } = await loadOfetch();
    for (let attempt = 0; ; attempt += 1) {
      signal.throwIfAborted();
      try {
        return await this.requestWithTimeout(request, signal);
      } catch (error) {
        signal.throwIfAborted();
        const retryable = error instanceof FetchError && isRetryableStatus(error.statusCode);
        if (attempt >= this.maxRetries || !retryable) throw error;
        await abortableDelay(this.retryDelay(attempt), signal);
      }
    }
  }

  /**
   * ofetch skips its own timeout once a signal is supplied, so each attempt gets one here.
   * @param request - Function that performs one attempt with the effective signal.
   * @param signal - Caller cancellation signal.
   * @returns {Promise<T>} Parsed response body.
   */
  private async requestWithTimeout<T>(
    request: (signal: Readonly<AbortSignal>) => Promise<T>,
    signal: Readonly<AbortSignal>,
  ): Promise<T> {
    if (!this.timeout) return request(signal);

    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException("The operation was aborted due to timeout", "TimeoutError"),
        ),
      this.timeout,
    );
    try {
      return await request(AbortSignal.any([signal, controller.signal]));
    } finally {
      clearTimeout(timer);
    }
  }

  private retryDelay(attempt: number): number {
    const delay = this.baseDelay * Math.pow(2, attempt - 1);
    return delay + delay * Math.random() * 0.1;
  }

  private async mapError(error: unknown, url: string): Promise<Error> {
    const { FetchError } = await loadOfetch();
    if (error instanceof FetchError) {
      if (error.statusCode === 429) {
        const retryAfter = parseRetryAfter(error.response?.headers.get("Retry-After"));
        return new RateLimitError(retryAfter);
      }

      const body = responseBody(error.data) || transportFailure(error.cause);
      const options = error.cause === undefined ? undefined : { cause: error.cause };

      return new HTTPError(error.statusCode ?? 0, sanitizeUrl(url), body, options);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

function responseBody(data: unknown): string {
  if (typeof data === "string") return data;
  return data === undefined || data === null ? "" : JSON.stringify(data);
}

/**
 * Name the failure behind a request that produced no usable response.
 * Reads the chain under the ofetch error, never its own message, which repeats the unredacted URL.
 * @param cause - Cause attached to the ofetch error.
 * @returns {string} Distinct cause messages from the outside in, or an empty string.
 */
function transportFailure(cause: unknown): string {
  const parts: string[] = [];
  const seen = new Set<Error>();
  let current: unknown = cause;

  while (current instanceof Error && !seen.has(current) && seen.size < MAX_CAUSE_DEPTH) {
    seen.add(current);
    const part = errorSummary(current);
    if (part.length > 0 && parts.at(-1) !== part) parts.push(part);
    current = current.cause;
  }

  return parts.join(": ");
}

function errorSummary(error: Readonly<Error>): string {
  if (error.message.length > 0) return error.message;
  if (error instanceof AggregateError) {
    return error.errors
      .map((inner: unknown) => (inner instanceof Error ? inner.message : String(inner)))
      .filter((message) => message.length > 0)
      .join(", ");
  }
  return "code" in error && typeof error.code === "string" ? error.code : error.name;
}

function isRetryableStatus(statusCode = 0): boolean {
  return statusCode === 0 || RETRY_STATUS_CODES.has(statusCode);
}

function abortableDelay(milliseconds: number, signal: Readonly<AbortSignal>): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const SENSITIVE_PARAMS = ["api_key", "key", "token", "secret", "password", "apikey", "url"];
const SENSITIVE_PARAM_SET = new Set(SENSITIVE_PARAMS.map((param) => param.toLowerCase()));

function sanitizeUrl(url: string): string {
  try {
    const directRedaction = redactUrlComponents(url);
    return redactEncodedPathUrls(directRedaction.url).url;
  } catch {
    return url;
  }
}

function redactUrlComponents(url: string): { url: string; changed: boolean } {
  const parsed = new URL(url);
  const userInfoRedacted = redactUserInfo(
    url,
    parsed.username.length > 0 || parsed.password.length > 0,
    parsed.password.length > 0,
  );
  const queryRedacted = redactSensitiveQueryParams(userInfoRedacted.url);

  return {
    url: queryRedacted.url,
    changed: userInfoRedacted.changed || queryRedacted.changed,
  };
}

function redactEncodedPathUrls(url: string): { url: string; changed: boolean } {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) {
    return { url, changed: false };
  }

  const pathStart = url.indexOf("/", schemeEnd + 3);
  if (pathStart === -1) {
    return { url, changed: false };
  }

  const queryStart = url.indexOf("?", pathStart);
  const fragmentStart = url.indexOf("#", pathStart);
  const pathEndCandidates = [queryStart, fragmentStart].filter((index) => index !== -1);
  const pathEnd = pathEndCandidates.length > 0 ? Math.min(...pathEndCandidates) : url.length;
  const path = url.slice(pathStart, pathEnd);
  let changed = false;

  const redactedPath = path
    .split("/")
    .map((segment) => {
      if (!segment.includes("%")) {
        return segment;
      }

      try {
        const decoded = decodeURIComponent(segment);
        const redacted = redactUrlComponents(decoded);
        if (!redacted.changed) {
          return segment;
        }

        changed = true;
        return encodeURIComponent(redacted.url);
      } catch {
        return segment;
      }
    })
    .join("/");

  if (!changed) {
    return { url, changed: false };
  }

  return {
    url: `${url.slice(0, pathStart)}${redactedPath}${url.slice(pathEnd)}`,
    changed: true,
  };
}

function redactUserInfo(
  url: string,
  hasUserInfo: boolean,
  hasPassword: boolean,
): { url: string; changed: boolean } {
  if (!hasUserInfo) {
    return { url, changed: false };
  }

  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) {
    return { url, changed: false };
  }

  const authorityStart = schemeEnd + 3;
  const pathIndex = url.indexOf("/", authorityStart);
  const queryIndex = url.indexOf("?", authorityStart);
  const fragmentIndex = url.indexOf("#", authorityStart);

  const authorityEndCandidates = [pathIndex, queryIndex, fragmentIndex].filter(
    (index) => index !== -1,
  );
  const authorityEnd =
    authorityEndCandidates.length > 0 ? Math.min(...authorityEndCandidates) : url.length;

  const authority = url.slice(authorityStart, authorityEnd);
  const atIndex = authority.lastIndexOf("@");
  if (atIndex === -1) {
    return { url, changed: false };
  }

  const redactedUserInfo = hasPassword ? "[REDACTED]:[REDACTED]" : "[REDACTED]";
  const redactedAuthority = `${redactedUserInfo}@${authority.slice(atIndex + 1)}`;

  return {
    url: `${url.slice(0, authorityStart)}${redactedAuthority}${url.slice(authorityEnd)}`,
    changed: true,
  };
}

function redactSensitiveQueryParams(url: string): { url: string; changed: boolean } {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) {
    return { url, changed: false };
  }

  const fragmentStart = url.indexOf("#", queryStart);
  const queryEnd = fragmentStart === -1 ? url.length : fragmentStart;
  const prefix = url.slice(0, queryStart + 1);
  const query = url.slice(queryStart + 1, queryEnd);
  const suffix = fragmentStart === -1 ? "" : url.slice(fragmentStart);

  let changed = false;
  let redactedQuery = "";
  let segmentStart = 0;

  for (let index = 0; index <= query.length; index += 1) {
    const isEnd = index === query.length;
    const char = query[index];
    if (!isEnd && char !== "&") {
      continue;
    }

    const segment = query.slice(segmentStart, index);
    redactedQuery += redactSegment(segment);
    if (!isEnd) {
      redactedQuery += char;
    }
    segmentStart = index + 1;
  }

  if (!changed) {
    return { url, changed: false };
  }

  return { url: `${prefix}${redactedQuery}${suffix}`, changed: true };

  function redactSegment(segment: string): string {
    if (!segment) {
      return segment;
    }

    const separatorIndex = segment.indexOf("=");
    const rawKey = separatorIndex === -1 ? segment : segment.slice(0, separatorIndex);

    let decodedKey = rawKey;
    try {
      decodedKey = decodeURIComponent(rawKey);
    } catch {
      decodedKey = rawKey;
    }

    if (!SENSITIVE_PARAM_SET.has(decodedKey.toLowerCase())) {
      return segment;
    }

    if (separatorIndex === -1) {
      return segment;
    }

    changed = true;
    return `${rawKey}=${encodeURIComponent("[REDACTED]")}`;
  }
}

let _defaultClient: Client | undefined;

/**
 * Lazily-initialized singleton {@link Client} used by all providers.
 * @returns {Client} Shared client instance.
 */
export function defaultClient(): Client {
  _defaultClient ??= new Client();
  return _defaultClient;
}

export function resetDefaultClientForTests(): void {
  _defaultClient = undefined;
}
