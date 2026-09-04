import { ofetch, FetchError } from "ofetch";
import type { $Fetch } from "ofetch";
import type { ClientOptions } from "./types.ts";
import { HTTPError, RateLimitError, parseRetryAfter } from "./errors.ts";
import { version } from "../version.ts";

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY = 50;
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_USER_AGENT = `agntn-web/${version}`;
const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/** HTTP client with exponential backoff retry and error mapping to web error types. */
export class Client {
  readonly maxRetries: number;
  readonly baseDelay: number;
  readonly timeout: number;
  readonly userAgent: string;
  private readonly fetch: $Fetch;

  constructor(options: Readonly<ClientOptions> = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelay = options.baseDelay ?? DEFAULT_BASE_DELAY;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

    const maxRetries = this.maxRetries;
    const baseDelay = this.baseDelay;

    this.fetch = ofetch.create({
      retry: this.maxRetries,
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
    });
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
      return signal
        ? await this.fetchWithCancellation(
            () => this.fetch<T>(url, { headers, signal, retry: false }),
            signal,
          )
        : await this.fetch<T>(url, { headers, signal });
    } catch (error) {
      throw this.mapError(error, url);
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
      return signal
        ? await this.fetchWithCancellation(
            () =>
              this.fetch<T>(url, {
                method: "POST",
                body,
                headers,
                signal,
                retry: false,
              }),
            signal,
          )
        : await this.fetch<T>(url, {
            method: "POST",
            body,
            headers,
            signal,
          });
    } catch (error) {
      throw this.mapError(error, url);
    }
  }

  private async fetchWithCancellation<T>(
    request: () => Promise<T>,
    signal: Readonly<AbortSignal>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      signal.throwIfAborted();
      try {
        return await request();
      } catch (error) {
        signal.throwIfAborted();
        if (attempt >= this.maxRetries || !isRetryable(error)) throw error;
        await abortableDelay(this.retryDelay(attempt), signal);
      }
    }
  }

  private retryDelay(attempt: number): number {
    const delay = this.baseDelay * Math.pow(2, attempt - 1);
    return delay + delay * Math.random() * 0.1;
  }

  private mapError(error: unknown, url: string): Error {
    if (error instanceof FetchError) {
      if (error.statusCode === 429) {
        const retryAfter = parseRetryAfter(error.response?.headers.get("Retry-After"));
        return new RateLimitError(retryAfter);
      }

      const body = typeof error.data === "string" ? error.data : JSON.stringify(error.data ?? "");

      return new HTTPError(error.statusCode ?? 0, sanitizeUrl(url), body);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof FetchError)) return false;
  const statusCode = error.statusCode ?? 0;
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
