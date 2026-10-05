import type { ClientOptions } from "./types.ts";
import { HTTPError, RateLimitError, rateLimitError, rateLimitWait } from "./errors.ts";
import { version } from "../version.ts";
import { readSseJson } from "./sse.ts";
import { sanitizeUrl } from "./redaction.ts";

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY = 50;
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_USER_AGENT = `agntn-web/${version}`;
const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
/** Longest reset a rate limited request waits for before it retries instead of failing. */
const MAX_RATE_LIMIT_WAIT_SECONDS = 5;
const MAX_CAUSE_DEPTH = 8;
/** JSON media types, `+json` suffixes included; an answer without a Content-Type counts too. */
const JSON_MEDIA_TYPE = /^application\/(?:[\w!#$%&*.^`~-]*\+)?json$/iu;

type ResponseHeaders = Readonly<{ get: (name: string) => string | null }>;

/** One attempt that got no usable answer: status 0 means no response arrived at all. */
class FailedAttempt extends Error {
  readonly status: number;
  readonly body: string;
  readonly headers: ResponseHeaders | undefined;
  /** False once the server has answered, so a metered request is never paid for twice. */
  readonly retryable: boolean;

  constructor(
    status: number,
    body: string,
    options: Readonly<{ headers?: ResponseHeaders; cause?: unknown; retryable?: boolean }> = {},
  ) {
    super(`HTTP ${status}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FailedAttempt";
    this.status = status;
    this.body = body;
    this.headers = options.headers;
    this.retryable = options.retryable ?? true;
  }
}

/** HTTP client with exponential backoff retry and error mapping to web error types. */
export class Client {
  readonly maxRetries: number;
  readonly baseDelay: number;
  readonly timeout: number;
  readonly userAgent: string;

  constructor(options: Readonly<ClientOptions> = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelay = options.baseDelay ?? DEFAULT_BASE_DELAY;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
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
    return this.send<T>(url, () => ({ headers: this.headers(headers) }), signal);
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
    return this.send<T>(
      url,
      () => ({ method: "POST", body: JSON.stringify(body), headers: this.headers(headers, true) }),
      signal,
    );
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
    const requestHeaders = this.headers(headers, true);
    requestHeaders.set("Accept", "text/event-stream");
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: requestHeaders,
      redirect: "error",
      signal,
    });
    signal.throwIfAborted();
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 429) throw rateLimitError(response.headers);
      throw new HTTPError(response.status, safeUrl, "Streaming request rejected");
    }
    const contentType = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    if (!response.body || (contentType !== undefined && contentType !== "text/event-stream")) {
      await response.body?.cancel().catch(() => {});
      throw new HTTPError(502, safeUrl, "Expected an SSE response body");
    }
    return response.body;
  }

  /**
   * Set one by one, so a lowercase `accept` replaces `Accept` instead of joining it.
   * @param headers - Caller headers.
   * @param json - Whether the request carries a JSON body.
   * @returns {Headers} Headers for one request.
   */
  private headers(headers?: Readonly<Record<string, string>>, json = false): Headers {
    const merged = new Headers({ Accept: "application/json", "User-Agent": this.userAgent });
    for (const [name, value] of Object.entries(headers ?? {})) merged.set(name, value);
    if (json && !merged.has("Content-Type")) merged.set("Content-Type", "application/json");
    return merged;
  }

  /**
   * Built inside the error boundary, so a body JSON can't encode fails as the caller's.
   * @param url - Request URL.
   * @param init - Builds the request options once.
   * @param signal - Caller cancellation.
   * @returns {Promise<T>} Parsed response body.
   */
  private async send<T>(
    url: string,
    init: () => RequestInit,
    signal?: Readonly<AbortSignal>,
  ): Promise<T> {
    try {
      const request = init();
      return await this.fetchWithRetry(
        (attemptSignal) =>
          attempt<T>(() => fetch(url, { ...request, signal: attemptSignal ?? null })),
        signal,
      );
    } catch (error) {
      throw this.mapError(error, url);
    }
  }

  private async fetchWithRetry<T>(
    request: (signal?: Readonly<AbortSignal>) => Promise<T>,
    signal?: Readonly<AbortSignal>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted();
      try {
        return await this.requestWithTimeout(request, signal);
      } catch (error) {
        signal?.throwIfAborted();
        const delay = error instanceof FailedAttempt ? this.retryDelay(error, attempt) : undefined;
        if (attempt >= this.maxRetries || delay === undefined) throw error;
        await abortableDelay(delay, signal);
      }
    }
  }

  /**
   * Each attempt gets a fresh deadline that covers the headers and the body.
   * @param request - Function that performs one attempt with the effective signal.
   * @param signal - Caller cancellation signal.
   * @returns {Promise<T>} Parsed response body.
   */
  private async requestWithTimeout<T>(
    request: (signal?: Readonly<AbortSignal>) => Promise<T>,
    signal?: Readonly<AbortSignal>,
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
      return await request(
        signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A rate limited request waits for the reset the provider names: a backoff of milliseconds
   * lands every retry in the same window, as with Brave's one request per second.
   * @param error - Failed attempt.
   * @param attempt - Zero-based attempt number.
   * @returns {number | undefined} Milliseconds before the next attempt, or undefined when it should not retry.
   */
  private retryDelay(error: Readonly<FailedAttempt>, attempt: number): number | undefined {
    if (!error.retryable || !isRetryableStatus(error.status)) return undefined;
    const delay = this.baseDelay * Math.pow(2, attempt - 1);
    const backoff = delay + delay * Math.random() * 0.1;
    if (error.status !== 429) return backoff;

    const wait = rateLimitWait(error.headers);
    if (wait === undefined) return backoff;
    return wait > MAX_RATE_LIMIT_WAIT_SECONDS ? undefined : Math.max(wait * 1000, backoff);
  }

  private mapError(error: unknown, url: string): Error {
    if (!(error instanceof FailedAttempt)) {
      return error instanceof Error ? error : new Error(String(error));
    }
    if (error.status === 429) return rateLimitError(error.headers);

    const body = error.body || transportFailure(error.cause);
    const options = error.cause === undefined ? undefined : { cause: error.cause };
    return new HTTPError(error.status, sanitizeUrl(url), body, options);
  }
}

/**
 * A dead connection is status 0 and retried; a body cut off after the status isn't, it's paid for.
 * @param request - Sends the request.
 * @returns {Promise<T>} Parsed response body.
 */
async function attempt<T>(request: () => Promise<Response>): Promise<T> {
  const { response, text } = await receive(request);
  if (!response.ok) {
    throw new FailedAttempt(response.status, text ?? "", { headers: response.headers });
  }
  return parseBody(response.headers.get("Content-Type"), text) as T;
}

async function receive(
  request: () => Promise<Response>,
): Promise<{ response: Response; text: string | undefined }> {
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    throw new FailedAttempt(0, "", { cause: error });
  }
  try {
    return { response, text: response.body === null ? undefined : await response.text() };
  } catch (error) {
    throw new FailedAttempt(0, "", { cause: error, retryable: false });
  }
}

/**
 * JSON and untyped answers parse as JSON or stay text, other types stay text, no body is undefined.
 * @param contentType - Content-Type of the answer.
 * @param text - Body text, undefined when the answer had none.
 * @returns {unknown} The decoded body.
 */
function parseBody(contentType: string | null, text: string | undefined): unknown {
  if (text === undefined) return undefined;
  const mediaType = contentType?.split(";")[0].trim() ?? "";
  return mediaType === "" || JSON_MEDIA_TYPE.test(mediaType) ? parseJson(text) : text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text, dropPrototypeKeys);
  } catch {
    return text;
  }
}

/**
 * Plain `JSON.parse` keeps `__proto__` as an own key, and `Object.assign` then swaps prototypes.
 * @param key - Property name.
 * @param value - Parsed value.
 * @returns {unknown} The value, or undefined to drop the key.
 */
function dropPrototypeKeys(key: string, value: unknown): unknown {
  if (key === "__proto__") return undefined;
  if (key === "constructor" && typeof value === "object" && value !== null && "prototype" in value)
    return undefined;
  return value;
}

/**
 * Name the failure behind a request that produced no usable response.
 * Reads the chain under the failed request, never a message that repeats the unredacted URL.
 * @param cause - What the failed request threw.
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

function abortableDelay(milliseconds: number, signal?: Readonly<AbortSignal>): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
