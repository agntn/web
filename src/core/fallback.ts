import { HTTPError, RateLimitError, WebError } from "./errors.ts";

/** Operation whose automatic provider selection may continue after a failure. */
export type FallbackOperation = "search" | "read";

const FALLBACK_HTTP_STATUS_CODES = new Set([0, 402, 408, 429]);

/** Serializable failure retained by detailed automatic-provider responses. */
export interface ProviderFailure {
  readonly provider: string;
  readonly error: string;
}

/** Raised when automatic selection cannot return after one or more eligible provider failures. */
export class ProviderFallbackError extends WebError {
  readonly operation: FallbackOperation;
  readonly attempts: readonly string[];
  readonly failures: readonly ProviderFailure[];

  constructor(operation: FallbackOperation, failures: readonly ProviderFailure[], cause?: unknown) {
    super(
      fallbackErrorMessage(operation, failures),
      cause instanceof Error ? { cause } : undefined,
    );
    this.name = "ProviderFallbackError";
    this.operation = operation;
    this.failures = failures.map((failure) => ({ ...failure }));
    this.attempts = this.failures.map(({ provider }) => provider);
  }
}

/**
 * Returns whether automatic provider selection may safely try the next provider.
 * Authentication failures, invalid requests, and unknown failures stay strict.
 * @param error - Provider rejection to classify.
 * @param provider - Provider that failed.
 * @param operation - Capability being attempted.
 * @returns {boolean} Whether automatic selection may continue.
 */
export function isFallbackEligible(
  error: unknown,
  provider: string,
  operation: FallbackOperation,
): boolean {
  if (error instanceof RateLimitError) return true;
  if (!(error instanceof HTTPError)) return false;

  const isJinaReadConflict =
    operation === "read" && provider === "jina" && error.statusCode === 409;
  return (
    FALLBACK_HTTP_STATUS_CODES.has(error.statusCode) || error.isServerError() || isJinaReadConflict
  );
}

/**
 * Convert an arbitrary provider rejection into stable response diagnostics.
 * @param provider - Provider that failed.
 * @param error - Provider rejection to describe.
 * @returns {ProviderFailure} Serializable provider failure.
 */
export function providerFailure(provider: string, error: unknown): ProviderFailure {
  return {
    provider,
    error: error instanceof Error ? error.message : String(error),
  };
}

function fallbackErrorMessage(
  operation: FallbackOperation,
  failures: readonly ProviderFailure[],
): string {
  const details = failures.map(({ provider, error }) => `${provider}: ${error}`).join("; ");
  return `Automatic ${operation} failed after ${failures.length} provider attempt(s): ${details}`;
}
