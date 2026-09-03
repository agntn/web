import { createHash } from "node:crypto";
import type { ReadOptions, ReadResult } from "./types.ts";
import { builtinProviders } from "./providers.ts";
import {
  EmptyUrlError,
  InvalidReadContinuationError,
  ReadNotSupportedError,
  StaleReadContinuationError,
} from "./errors.ts";
import {
  isFallbackEligible,
  providerFailure,
  ProviderFallbackError,
  type ProviderFailure,
} from "./fallback.ts";
import { createReadProvider, has, readProviders } from "./registry.ts";
import { isProviderConfigured } from "./resolve.ts";
import {
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  providerRequestOptions,
  throwIfAborted,
  withExecutionBudget,
} from "./execution.ts";
import {
  MAX_PROVIDER_SEARCH_CONTINUATION_LENGTH,
  MAX_SEARCH_CONTINUATION_LENGTH,
} from "./search-continuation.ts";

export const readProviderNames = ["jina", "context", "firecrawl", "tinyfish"] as const;
export type ReadProviderName = (typeof readProviderNames)[number];

/** Default portable content limit used by agent surfaces. */
export const DEFAULT_AGENT_READ_MAX_CHARS = 20_000;

/** Largest portable content page accepted by agent surfaces. */
export const MAX_AGENT_READ_CHARS = 200_000;

/** Package guarantees that apply after every provider returns. */
export const packageCapabilities = {
  execution: {
    cancellation: { option: "signal" },
    deadline: { option: "deadline", unit: "unix-ms" },
    concurrency: {
      option: "concurrency",
      default: DEFAULT_CONCURRENCY,
      maximum: MAX_CONCURRENCY,
      scope: "batch-and-fanout",
    },
  },
  search: {
    continuation: {
      option: "continuation",
      opaque: true,
      maximum: MAX_SEARCH_CONTINUATION_LENGTH,
      providerStateMaximum: MAX_PROVIDER_SEARCH_CONTINUATION_LENGTH,
      scope: "single-provider-query",
    },
  },
  read: {
    outputLimit: {
      option: "maxChars",
      unit: "unicode-code-points",
      minimum: 1,
      agentDefault: DEFAULT_AGENT_READ_MAX_CHARS,
      agentMaximum: MAX_AGENT_READ_CHARS,
    },
    continuation: { option: "continuation", opaque: true },
  },
} as const;

export interface ReadUrlOptions extends ReadOptions {
  readonly provider?: string;
  readonly maxChars?: number;
  readonly continuation?: string;
}

/** Read result with requested mode, effective provider, and provider-attempt diagnostics. */
export interface ReadUrlDetailedResult {
  readonly result: Readonly<ReadResult>;
  readonly requestedProvider: string;
  readonly provider: string;
  readonly attempts: readonly string[];
  readonly failures: readonly ProviderFailure[];
}

interface ReadContinuationPayload {
  readonly version: 1;
  readonly provider: string;
  readonly requestedProvider: string;
  readonly requestFingerprint: string;
  readonly contentFingerprint: string;
  readonly offset: number;
}

interface ReadContinuationEnvelope {
  readonly payload: string;
  readonly checksum: string;
}

type ReadResultInput = Readonly<Omit<ReadResult, "links" | "images" | "metadata">> & {
  readonly links?: readonly string[];
  readonly images?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
};

const DEFAULT_READ_PROVIDER: ReadProviderName = "jina";
const MAX_CONTINUATION_LENGTH = 1_024;

/**
 * Reads a URL while preserving the original result contract.
 * @param url - URL to read.
 * @param options - Provider, native read options, and portable output options.
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
 * @param options - Provider, native read options, and portable output options.
 * @returns {Promise<ReadUrlDetailedResult>} Result, provider, attempts, and failures.
 */
export async function readUrlDetailed(
  url: string,
  options?: Readonly<ReadUrlOptions>,
): Promise<ReadUrlDetailedResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) throw new EmptyUrlError();

  const {
    provider: requestedProviderInput,
    maxChars: maxCharsInput,
    continuation,
    ...readOptions
  } = options ?? {};
  const maxChars = readMaxChars(maxCharsInput);
  const effectiveReadOptions = withExecutionBudget(readOptions);
  throwIfAborted(effectiveReadOptions.signal);
  const requestedProviderName = requestedProviderInput?.trim();
  const requestedProvider = requestedProviderName || "auto";

  if (continuation !== undefined) {
    return continueRead(
      trimmedUrl,
      requestedProvider,
      effectiveReadOptions,
      maxChars,
      continuation,
    );
  }

  const response = requestedProviderName
    ? await readExplicitly(trimmedUrl, effectiveReadOptions, requestedProviderName)
    : await readAutomatically(trimmedUrl, effectiveReadOptions);
  if (maxChars === undefined) return response;
  return {
    ...response,
    result: pageReadResult(response.result, {
      url: trimmedUrl,
      readOptions: effectiveReadOptions,
      maxChars,
      offset: 0,
      provider: response.provider,
      requestedProvider: response.requestedProvider,
    }),
  };
}

async function readExplicitly(
  url: string,
  options: Readonly<ReadOptions>,
  requestedProvider: string,
): Promise<ReadUrlDetailedResult> {
  const provider = resolveReadProviderName(requestedProvider);
  return {
    result: await readFromProvider(url, options, provider),
    requestedProvider: provider,
    provider,
    attempts: [provider],
    failures: [],
  };
}

async function continueRead(
  url: string,
  requestedProvider: string,
  readOptions: Readonly<ReadOptions>,
  maxChars: number | undefined,
  continuation: string,
): Promise<ReadUrlDetailedResult> {
  const payload = decodeContinuation(continuation);
  if (
    payload.requestFingerprint !== requestFingerprint(url, readOptions) ||
    (requestedProvider !== "auto" && requestedProvider !== payload.requestedProvider)
  ) {
    throw new InvalidReadContinuationError();
  }

  const provider = resolveReadProviderName(payload.provider);
  const result = await readFromProvider(url, readOptions, provider);
  if (contentFingerprint(result.content) !== payload.contentFingerprint) {
    throw new StaleReadContinuationError();
  }

  return {
    result: pageReadResult(result, {
      url,
      readOptions,
      maxChars,
      offset: payload.offset,
      provider,
      requestedProvider: payload.requestedProvider,
    }),
    requestedProvider: payload.requestedProvider,
    provider,
    attempts: [provider],
    failures: [],
  };
}

function resolveReadProviderName(providerName: string): string {
  const registeredOrBuiltin =
    has(providerName) || (builtinProviders as readonly string[]).includes(providerName);
  if (registeredOrBuiltin && !readProviders().includes(providerName)) {
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

async function readFromProvider(
  url: string,
  options: Readonly<ReadOptions>,
  providerName: string,
): Promise<ReadResult> {
  throwIfAborted(options.signal);
  let result: ReadResult;
  try {
    result = await createReadProvider(providerName).read(url, providerRequestOptions(options));
  } catch (error) {
    throwIfAborted(options.signal);
    throw error;
  }
  throwIfAborted(options.signal);
  return result;
}

function configuredReadProviders(initialProvider: string): string[] {
  const registeredReaders = readProviders();
  const builtins = readProviderNames.filter(
    (name) =>
      name !== initialProvider && registeredReaders.includes(name) && isProviderConfigured(name),
  );
  const custom = registeredReaders.filter(
    (name) =>
      name !== initialProvider &&
      !(readProviderNames as readonly string[]).includes(name) &&
      isProviderConfigured(name),
  );
  return [...builtins, ...custom];
}

function readMaxChars(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("maxChars must be a positive safe integer");
  }
  return value;
}

function pageReadResult(
  result: ReadResultInput,
  context: Readonly<{
    url: string;
    readOptions: Readonly<ReadOptions>;
    maxChars: number | undefined;
    offset: number;
    provider: string;
    requestedProvider: string;
  }>,
): ReadResult {
  const page = sliceContent(result.content, context.offset, context.maxChars);
  const {
    text: _text,
    html: _html,
    continuation: _continuation,
    truncated: _truncated,
    links,
    images,
    metadata,
    ...rest
  } = result;
  const continuation = page.truncated
    ? encodeContinuation({
        version: 1,
        provider: context.provider,
        requestedProvider: context.requestedProvider,
        requestFingerprint: requestFingerprint(context.url, context.readOptions),
        contentFingerprint: contentFingerprint(result.content),
        offset: page.nextOffset,
      })
    : undefined;
  return {
    ...rest,
    content: page.content,
    truncated: page.truncated,
    ...(continuation === undefined ? {} : { continuation }),
    ...(links === undefined ? {} : { links: [...links] }),
    ...(images === undefined ? {} : { images: [...images] }),
    ...(metadata === undefined ? {} : { metadata: { ...metadata } }),
  };
}

function sliceContent(
  content: string,
  offset: number,
  maxChars: number | undefined,
): { readonly content: string; readonly truncated: boolean; readonly nextOffset: number } {
  let characterOffset = 0;
  let codeUnitOffset = 0;
  let startCodeUnit = content.length;
  let endCodeUnit = content.length;
  const requestedEnd = maxChars === undefined ? Number.POSITIVE_INFINITY : offset + maxChars;

  for (const character of content) {
    if (characterOffset === offset) startCodeUnit = codeUnitOffset;
    if (characterOffset === requestedEnd) endCodeUnit = codeUnitOffset;
    codeUnitOffset += character.length;
    characterOffset += 1;
  }
  if (characterOffset === offset) startCodeUnit = codeUnitOffset;
  if (characterOffset === requestedEnd) endCodeUnit = codeUnitOffset;
  if (offset > characterOffset) throw new InvalidReadContinuationError();

  const nextOffset = Math.min(requestedEnd, characterOffset);
  return {
    content: content.slice(startCodeUnit, endCodeUnit),
    truncated: nextOffset < characterOffset,
    nextOffset,
  };
}

function requestFingerprint(url: string, options: Readonly<ReadOptions>): string {
  return fingerprint(
    JSON.stringify([
      url,
      options.format ?? null,
      options.maxTokens ?? null,
      options.targetSelector ?? null,
      options.removeSelector ?? null,
      options.timeout ?? null,
      options.noCache === true,
    ]),
  );
}

function contentFingerprint(content: string): string {
  return fingerprint(content);
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function encodeContinuation(payload: Readonly<ReadContinuationPayload>): string {
  const serializedPayload = JSON.stringify(payload);
  const envelope: ReadContinuationEnvelope = {
    payload: serializedPayload,
    checksum: continuationChecksum(serializedPayload),
  };
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

function decodeContinuation(token: string): ReadContinuationPayload {
  if (!token || token.length > MAX_CONTINUATION_LENGTH) throw new InvalidReadContinuationError();
  try {
    const envelope: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (!isReadContinuationEnvelope(envelope)) throw new InvalidReadContinuationError();
    if (envelope.checksum !== continuationChecksum(envelope.payload)) {
      throw new InvalidReadContinuationError();
    }
    const payload: unknown = JSON.parse(envelope.payload);
    if (!isReadContinuationPayload(payload)) throw new InvalidReadContinuationError();
    return payload;
  } catch (error) {
    if (error instanceof InvalidReadContinuationError) throw error;
    throw new InvalidReadContinuationError();
  }
}

function continuationChecksum(payload: string): string {
  return fingerprint(`@agntn/web/read-continuation/v1\0${payload}`);
}

function isReadContinuationEnvelope(value: unknown): value is ReadContinuationEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Readonly<Record<string, unknown>>;
  return typeof envelope.payload === "string" && typeof envelope.checksum === "string";
}

function isReadContinuationPayload(value: unknown): value is ReadContinuationPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Readonly<Record<string, unknown>>;
  const strings = [
    payload.provider,
    payload.requestedProvider,
    payload.requestFingerprint,
    payload.contentFingerprint,
  ];
  const hasRequiredStrings = strings.every((item) => typeof item === "string" && item.length > 0);
  return (
    payload.version === 1 &&
    hasRequiredStrings &&
    typeof payload.offset === "number" &&
    Number.isSafeInteger(payload.offset) &&
    payload.offset >= 0
  );
}
