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

const DEFAULT_READ_PROVIDER: ReadProviderName = "jina";

export async function readUrl(
  url: string,
  options?: Readonly<ReadUrlOptions>,
): Promise<ReadResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new EmptyUrlError();
  }

  const { provider: requestedProvider, ...readOptions } = options ?? {};
  const requestedProviderName = requestedProvider?.trim();
  const providerName = resolveReadProviderName(requestedProviderName);
  try {
    return await createReadProvider(providerName).read(trimmedUrl, readOptions);
  } catch (error) {
    if (!shouldFallback(requestedProviderName, providerName, error)) throw error;
    return readFromConfiguredFallbacks(trimmedUrl, readOptions, providerName, error);
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
  initialProvider: string,
  initialError: unknown,
): Promise<ReadResult> {
  let lastError = initialError;
  for (const providerName of configuredReadProviders(initialProvider)) {
    try {
      return await createReadProvider(providerName).read(url, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
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
