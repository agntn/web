import type { ReadOptions, ReadResult } from "./types.ts";
import { builtinProviders } from "./providers.ts";
import { EmptyUrlError, HTTPError, ReadNotSupportedError } from "./errors.ts";
import { createReadProvider } from "./registry.ts";

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
    if (!shouldFallbackToFirecrawl(requestedProviderName, error)) throw error;
    return createReadProvider("firecrawl").read(trimmedUrl, readOptions);
  }
}

function resolveReadProviderName(requestedProvider?: string): string {
  const providerName = requestedProvider || DEFAULT_READ_PROVIDER;
  if (isBuiltinProvider(providerName) && !isReadProviderName(providerName)) {
    throw new ReadNotSupportedError(providerName);
  }
  return providerName;
}

function shouldFallbackToFirecrawl(requestedProvider: string | undefined, error: unknown): boolean {
  return (
    !requestedProvider && isPaymentRequired(error) && process.env.FIRECRAWL_API_KEY !== undefined
  );
}

function isPaymentRequired(error: unknown): error is HTTPError {
  return error instanceof HTTPError && error.statusCode === 402;
}

function isBuiltinProvider(name: string): boolean {
  return (builtinProviders as readonly string[]).includes(name);
}

function isReadProviderName(name: string): name is ReadProviderName {
  return (readProviderNames as readonly string[]).includes(name);
}
