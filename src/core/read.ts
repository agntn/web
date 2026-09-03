import type { ReadOptions, ReadResult } from "./types.ts";
import { builtinProviders } from "./providers.ts";
import { EmptyUrlError, ReadNotSupportedError } from "./errors.ts";
import {
  isFallbackEligible,
  providerFailure,
  ProviderFallbackError,
  type ProviderFailure,
} from "./fallback.ts";
import { createReadProvider } from "./registry.ts";
import { detectAvailableProviders } from "./resolve.ts";

export const readProviderNames = ["jina", "context", "firecrawl", "tinyfish"] as const;
export type ReadProviderName = (typeof readProviderNames)[number];

export interface ReadUrlOptions extends ReadOptions {
  readonly provider?: string;
}

/** Read result with requested mode, effective provider, and provider-attempt diagnostics. */
export interface ReadUrlDetailedResult {
  readonly result: Readonly<ReadResult>;
  readonly requestedProvider: string;
  readonly provider: string;
  readonly attempts: readonly string[];
  readonly failures: readonly ProviderFailure[];
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
 * @returns {Promise<ReadUrlDetailedResult>} Result, provider, attempts, and failures.
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
  if (requestedProviderName) {
    const providerName = resolveReadProviderName(requestedProviderName);
    return {
      result: await readFromProvider(trimmedUrl, readOptions, providerName),
      requestedProvider: providerName,
      provider: providerName,
      attempts: [providerName],
      failures: [],
    };
  }

  return readAutomatically(trimmedUrl, readOptions);
}

function resolveReadProviderName(providerName: string): string {
  if (isBuiltinProvider(providerName) && !isReadProviderName(providerName)) {
    throw new ReadNotSupportedError(providerName);
  }
  return providerName;
}

async function readAutomatically(
  url: string,
  options: Readonly<ReadOptions>,
): Promise<ReadUrlDetailedResult> {
  const providerNames = [DEFAULT_READ_PROVIDER, ...configuredReadProviders(DEFAULT_READ_PROVIDER)];
  const attempts: string[] = [];
  const failures: ProviderFailure[] = [];
  let lastError: unknown;

  for (const providerName of providerNames) {
    attempts.push(providerName);
    try {
      return {
        result: await readFromProvider(url, options, providerName),
        requestedProvider: "auto",
        provider: providerName,
        attempts,
        failures,
      };
    } catch (error) {
      const failure = providerFailure(providerName, error);
      if (!isFallbackEligible(error, providerName, "read")) {
        if (failures.length === 0) throw error;
        failures.push(failure);
        throw new ProviderFallbackError("read", failures, error);
      }
      failures.push(failure);
      lastError = error;
    }
  }
  throw new ProviderFallbackError("read", failures, lastError);
}

function readFromProvider(
  url: string,
  options: Readonly<ReadOptions>,
  providerName: string,
): Promise<ReadResult> {
  return createReadProvider(providerName).read(url, options);
}

function configuredReadProviders(initialProvider: string): ReadProviderName[] {
  const configuredProviders = detectAvailableProviders();
  return readProviderNames.filter(
    (name) => name !== initialProvider && configuredProviders.includes(name),
  );
}

function isBuiltinProvider(name: string): boolean {
  return (builtinProviders as readonly string[]).includes(name);
}

function isReadProviderName(name: string): name is ReadProviderName {
  return (readProviderNames as readonly string[]).includes(name);
}
