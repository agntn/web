import { HTTPError, PaymentError, RateLimitError, WebError } from "./errors.ts";

/** Operation whose automatic provider selection may continue after a failure. */
export type FallbackOperation = "search" | "read";

const FALLBACK_HTTP_STATUS_CODES = new Set([0, 402, 408, 429]);

/** How long automatic selection keeps a provider that ran out of credits behind the others. */
export const OUT_OF_CREDITS_COOLDOWN_MS = 30 * 60 * 1000;

const outOfCreditsUntil = new Map<string, number>();

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
  if (error instanceof PaymentError || error instanceof RateLimitError) return true;
  if (!(error instanceof HTTPError)) return false;

  const isJinaReadConflict =
    operation === "read" && provider === "jina" && error.statusCode === 409;
  return (
    FALLBACK_HTTP_STATUS_CODES.has(error.statusCode) || error.isServerError() || isJinaReadConflict
  );
}

/** Automatic provider order with the providers that recently ran out of credits moved last. */
export interface AutomaticOrder {
  readonly providerNames: readonly string[];
  readonly outOfCredits: readonly string[];
  readonly original: readonly string[];
}

/**
 * Move providers that reported spent credits in the last
 * {@link OUT_OF_CREDITS_COOLDOWN_MS} behind the others. They stay in the chain,
 * so a topped up account still answers when every other provider fails.
 * @param providerNames - Automatic provider order.
 * @returns {AutomaticOrder} Order to walk and the providers moved last.
 */
export function automaticOrder(providerNames: readonly string[]): AutomaticOrder {
  const now = Date.now();
  const outOfCredits = providerNames.filter((name) => {
    const until = outOfCreditsUntil.get(name);
    if (until === undefined) return false;
    if (until > now) return true;
    outOfCreditsUntil.delete(name);
    return false;
  });
  if (outOfCredits.length === 0) return { providerNames, outOfCredits, original: providerNames };
  return {
    providerNames: [
      ...providerNames.filter((name) => !outOfCredits.includes(name)),
      ...outOfCredits,
    ],
    outOfCredits,
    original: providerNames,
  };
}

/**
 * Remember spent credits for automatic selection, or forget them after an answer.
 * A plain HTTP 402 counts too, since Jina and Exa report spent credits that way.
 * @param provider - Provider that was asked.
 * @param error - Rejection, or undefined when the provider answered.
 */
export function recordProviderOutcome(provider: string, error?: unknown): void {
  if (error === undefined) outOfCreditsUntil.delete(provider);
  else if (
    error instanceof PaymentError ||
    (error instanceof HTTPError && error.statusCode === 402)
  ) {
    outOfCreditsUntil.set(provider, Date.now() + OUT_OF_CREDITS_COOLDOWN_MS);
  }
}

/**
 * Providers with spent credits that the original order would have asked
 * before the one that answered, and that the walk left out.
 * @param order - Order the walk used.
 * @param attempts - Providers the walk asked, the answering one last.
 * @returns {object} `skipped` when a provider was left out, otherwise nothing.
 */
export function skippedField(
  order: AutomaticOrder,
  attempts: readonly string[],
): { readonly skipped?: readonly string[] } {
  const answered = order.original.indexOf(attempts.at(-1) ?? "");
  const skipped = order.outOfCredits.filter(
    (name) => !attempts.includes(name) && order.original.indexOf(name) < answered,
  );
  return skipped.length === 0 ? {} : { skipped };
}

/** Forget every remembered payment error. Tests call this between cases. */
export function resetOutOfCredits(): void {
  outOfCreditsUntil.clear();
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
