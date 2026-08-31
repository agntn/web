import type { ReadOptions, ReadResult } from "./types.ts";
import { builtinProviders } from "./providers.ts";
import { EmptyUrlError, HTTPError, ReadNotSupportedError } from "./errors.ts";
import { createReadProvider } from "./registry.ts";
import { detectAvailableProviders } from "./resolve.ts";

export const readProviderNames = ["jina", "context", "firecrawl", "tinyfish"] as const;
export type ReadProviderName = (typeof readProviderNames)[number];

export interface ReadUrlOptions extends ReadOptions {
  readonly provider?: string;
}

/** Read result with requested mode, effective provider, and every provider tried. */
export interface ReadUrlDetailedResult {
  readonly result: Readonly<ReadResult>;
  readonly requestedProvider: string;
  readonly provider: string;
  readonly attempts: readonly string[];
}

const DEFAULT_READ_PROVIDER: ReadProviderName = "jina";

/**
 * Reads a URL while preserving the original result contract.
 * @param url - URL to read.
 * @param options - Provider and read options.
 * @returns {Promise<ReadResult>} The normalized page result.
 */
export async function readUrl(
  url: string,
  options?: Readonly<ReadUrlOptions>,
): Promise<ReadResult> {
  return (await readUrlDetailed(url, options)).result;
}

/**
 * Reads a URL and reports the effective provider after automatic fallback.
 * @param url - URL to read.
 * @param options - Provider and read options.
 * @returns {Promise<ReadUrlDetailedResult>} Result, selection, provider, and attempts.
 */
export async function readUrlDetailed(
  url: string,
  options?: Readonly<ReadUrlOptions>,
): Promise<ReadUrlDetailedResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new EmptyUrlError();
  }

  const { provider: requestedProvider, ...readOptions } = options ?? {};
  const requestedProviderName = requestedProvider?.trim();
  const requestedProviderLabel = requestedProviderName || "auto";
  const providerName = resolveReadProviderName(requestedProviderName);
  const attempts = [providerName];
  try {
    return await readFromProvider(
      trimmedUrl,
      readOptions,
      requestedProviderLabel,
      providerName,
      attempts,
    );
  } catch (error) {
    if (!shouldFallback(requestedProviderName, providerName, error)) throw error;
    return readFromConfiguredFallbacks(
      trimmedUrl,
      readOptions,
      requestedProviderLabel,
      providerName,
      error,
      attempts,
    );
  }
}

function resolveReadProviderName(requestedProvider?: string): string {
  const providerName = requestedProvider || DEFAULT_READ_PROVIDER;
  if (isBuiltinProvider(providerName) && !isReadProviderName(providerName)) {
    throw new ReadNotSupportedError(providerName);
  }
  return providerName;
}

async function readFromConfiguredFallbacks(
  url: string,
  options: Readonly<ReadOptions>,
  requestedProvider: string,
  initialProvider: string,
  initialError: unknown,
  initialAttempts: readonly string[],
): Promise<ReadUrlDetailedResult> {
  let lastError = initialError;
  let attempts = initialAttempts;
  for (const providerName of configuredReadProviders(initialProvider)) {
    attempts = [...attempts, providerName];
    try {
      return await readFromProvider(url, options, requestedProvider, providerName, attempts);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function readFromProvider(
  url: string,
  options: Readonly<ReadOptions>,
  requestedProvider: string,
  providerName: string,
  attempts: readonly string[],
): Promise<ReadUrlDetailedResult> {
  const result = await createReadProvider(providerName).read(url, options);
  return { result, requestedProvider, provider: providerName, attempts };
}

function configuredReadProviders(initialProvider: string): ReadProviderName[] {
  const configuredProviders = detectAvailableProviders();
  return readProviderNames.filter(
    (name) => name !== initialProvider && configuredProviders.includes(name),
  );
}

function shouldFallback(
  requestedProvider: string | undefined,
  initialProvider: string,
  error: unknown,
): boolean {
  return !requestedProvider && (isPaymentRequired(error) || isJinaConflict(initialProvider, error));
}

function isPaymentRequired(error: unknown): error is HTTPError {
  return error instanceof HTTPError && error.statusCode === 402;
}

function isJinaConflict(provider: string, error: unknown): error is HTTPError {
  return provider === "jina" && error instanceof HTTPError && error.statusCode === 409;
}

function isBuiltinProvider(name: string): boolean {
  return (builtinProviders as readonly string[]).includes(name);
}

function isReadProviderName(name: string): name is ReadProviderName {
  return (readProviderNames as readonly string[]).includes(name);
}
