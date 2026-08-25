/** Base error for all web operations. */
export class WebError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WebError'
  }
}

/** Non-auth HTTP error with status code, URL, and response body. */
export class HTTPError extends WebError {
  readonly statusCode: number
  readonly url: string
  readonly body: string

  constructor(statusCode: number, url: string, body: string) {
    super(`HTTP ${statusCode}: ${url}`)
    this.name = 'HTTPError'
    this.statusCode = statusCode
    this.url = url
    this.body = body
  }

  isNotFound(): boolean {
    return this.statusCode === 404
  }

  isRateLimit(): boolean {
    return this.statusCode === 429
  }

  isServerError(): boolean {
    return this.statusCode >= 500
  }
}

/** Thrown when a provider rejects the API key (HTTP 401). */
export class AuthError extends WebError {
  readonly provider: string

  constructor(message: string, provider: string) {
    super(message)
    this.name = 'AuthError'
    this.provider = provider
  }
}

/** Thrown on HTTP 429. Check {@link retryAfter} for seconds until retry. */
export class RateLimitError extends WebError {
  readonly retryAfter: number

  constructor(retryAfter: number) {
    super(`Rate limited. Retry after ${retryAfter}s`)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

/** Thrown when {@link create} is called with an unregistered provider name. */
export class UnknownProviderError extends WebError {
  readonly provider: string

  constructor(provider: string) {
    super(`Unknown provider: ${provider}`)
    this.name = 'UnknownProviderError'
    this.provider = provider
  }
}

/** Thrown when the search query is empty or whitespace-only. */
export class EmptyQueryError extends WebError {
  constructor() {
    super('Search query cannot be empty')
    this.name = 'EmptyQueryError'
  }
}

/** Thrown when the read URL is empty or whitespace-only. */
export class EmptyUrlError extends WebError {
  constructor() {
    super('Read URL cannot be empty')
    this.name = 'EmptyUrlError'
  }
}

export class InvalidProviderUrlError extends WebError {
  readonly provider: string

  constructor(provider: string) {
    super(`Invalid base URL for provider "${provider}": expected an absolute http or https URL`)
    this.name = 'InvalidProviderUrlError'
    this.provider = provider
  }
}

/** Thrown when a provider does not implement the search capability. */
export class SearchNotSupportedError extends WebError {
  readonly provider: string

  constructor(provider: string) {
    super(`Provider does not support search: ${provider}`)
    this.name = 'SearchNotSupportedError'
    this.provider = provider
  }
}

/** Thrown when a provider does not implement the read capability. */
export class ReadNotSupportedError extends WebError {
  readonly provider: string

  constructor(provider: string) {
    super(`Provider does not support read: ${provider}`)
    this.name = 'ReadNotSupportedError'
    this.provider = provider
  }
}

/** Thrown when no provider can be selected from env or registry. */
export class NoProviderConfiguredError extends WebError {
  constructor() {
    super('No web search provider configured. Set an API key env var or register a provider.')
    this.name = 'NoProviderConfiguredError'
  }
}

/** Thrown when providers are configured but none are currently reachable. */
export class NoProviderAvailableError extends WebError {
  readonly providers: readonly string[]

  constructor(providers: readonly string[]) {
    const providerList = providers.length > 0 ? providers.join(', ') : 'unknown'
    super(`No configured web search provider is currently reachable: ${providerList}`)
    this.name = 'NoProviderAvailableError'
    this.providers = providers
  }
}

/** Thrown when a date filter string is not valid ISO 8601 or the range is reversed. */
export class InvalidDateFilterError extends WebError {
  readonly field: string
  readonly value: string
  readonly reason: string

  constructor(field: string, value: string, reason: string) {
    super(`Invalid date filter ${field}="${value}": ${reason}`)
    this.name = 'InvalidDateFilterError'
    this.field = field
    this.value = value
    this.reason = reason
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/
const HAS_OFFSET_RE = /Z|[+-]\d{2}:\d{2}$/

export function validateDateFilters(startPublishedDate?: string, endPublishedDate?: string): void {
  for (const [field, value] of [['startPublishedDate', startPublishedDate], ['endPublishedDate', endPublishedDate]] as const) {
    if (value == null) continue
    if (!ISO_DATE_RE.test(value)) {
      throw new InvalidDateFilterError(field, value, 'must be ISO 8601 (e.g. "2024-01-01" or "2024-01-01T00:00:00Z")')
    }
    const hasTime = value.includes('T')
    if (hasTime && !HAS_OFFSET_RE.test(value)) {
      throw new InvalidDateFilterError(field, value, 'datetime must include Z or ±HH:mm offset')
    }
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      throw new InvalidDateFilterError(field, value, 'not a valid date')
    }
    const dateOnly = value.split('T')[0]
    const [y, m, d] = dateOnly.split('-').map(Number)
    const probe = new Date(Date.UTC(y, m - 1, d))
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== m || probe.getUTCDate() !== d) {
      throw new InvalidDateFilterError(field, value, 'not a valid calendar date')
    }
  }

  if (startPublishedDate != null && endPublishedDate != null) {
    if (Date.parse(startPublishedDate) > Date.parse(endPublishedDate)) {
      throw new InvalidDateFilterError('startPublishedDate', startPublishedDate, `start date is after end date "${endPublishedDate}"`)
    }
  }
}

/**
 * Convert any caught error into a typed {@link WebError} subclass.
 * Maps HTTP status codes to specific error types (401 → AuthError, 429 → RateLimitError).
 */
export function normalizeError(error: unknown, provider?: string): WebError {
  if (error instanceof HTTPError && error.statusCode === 401) {
    return new AuthError(
      `Authentication failed: ${error.body || 'Invalid or missing API key'}`,
      provider || 'unknown'
    )
  }

  if (error instanceof WebError) {
    return error
  }

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    'message' in error
  ) {
    const fetchError = error as { status: number; message: string; response?: { headers?: { get: (key: string) => string | null } } }
    const status = fetchError.status
    const message = fetchError.message || `HTTP ${status}`

    switch (status) {
      case 401:
        return new AuthError(
          `Authentication failed: ${message}`,
          provider || 'unknown'
        )
      case 404:
        return new HTTPError(404, '', message)
      case 429: {
        const retryAfter = parseRetryAfter(fetchError.response?.headers?.get('Retry-After'))
        return new RateLimitError(retryAfter)
      }
      default:
        if (status >= 500) {
          return new HTTPError(status, '', message)
        }
        return new WebError(message)
    }
  }

  if (error instanceof Error) {
    return new WebError(error.message)
  }

  return new WebError(String(error))
}

export const DEFAULT_RETRY_AFTER = 60

export function parseRetryAfter(header: string | null | undefined): number {
  if (header == null) {
    return DEFAULT_RETRY_AFTER
  }

  const trimmed = header.trim()
  if (!/^\d+$/.test(trimmed)) {
    return DEFAULT_RETRY_AFTER
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RETRY_AFTER
  }

  return parsed
}
