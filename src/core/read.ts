import type { ReadOptions, ReadResult } from "./types.ts";
import { builtinProviders } from "./providers.ts";
import { fingerprint, openContinuation, sealContinuation } from "./continuation.ts";
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
import { normalizeReadOptions } from "./options.ts";
import type { ReadOptionName } from "./provider.ts";
import { createReadProvider, getProviderCapabilities, has, readProviders } from "./registry.ts";
import { isProviderConfigured } from "./resolve.ts";
import {
  DEFAULT_CONCURRENCY,
  MAX_AGENT_TIMEOUT_SECONDS,
  MAX_CONCURRENCY,
  providerRequestOptions,
  throwIfAborted,
  withExecutionBudget,
} from "./execution.ts";
import {
  MAX_PROVIDER_SEARCH_CONTINUATION_LENGTH,
  MAX_SEARCH_CONTINUATION_LENGTH,
} from "./search-continuation.ts";

export const readProviderNames = [
  "jina",
  "context",
  "firecrawl",
  "tinyfish",
  "tavily",
  "exa",
] as const;
export type ReadProviderName = (typeof readProviderNames)[number];

/** Default portable content limit used by agent surfaces. */
export const DEFAULT_AGENT_READ_MAX_CHARS = 20_000;

/** Largest portable content page accepted by agent surfaces. */
export const MAX_AGENT_READ_CHARS = 200_000;

/** Package guarantees that apply after every provider returns. */
export const packageCapabilities = {
  execution: {
    cancellation: { option: "signal" },
    deadline: {
      option: "deadline",
      unit: "unix-ms",
      agentOption: "timeoutSeconds",
      agentUnit: "seconds",
      agentMaximum: MAX_AGENT_TIMEOUT_SECONDS,
    },
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
  /** Keeps the page's links in a bounded read. Defaults to false. */
  readonly links?: boolean;
  /** Keeps the page's image URLs in a bounded read. Defaults to false. */
  readonly images?: boolean;
}

/** Read result with requested mode, effective provider, and provider-attempt diagnostics. */
export interface ReadUrlDetailedResult {
  readonly result: Readonly<ReadResult>;
  readonly requestedProvider: string;
  readonly provider: string;
  readonly attempts: readonly string[];
  readonly failures: readonly ProviderFailure[];
  /** Options an automatic read left out because the reader doesn't declare them. */
  readonly ignoredOptions?: readonly ReadOptionName[];
}

interface ReadContinuationPayload {
  readonly provider: string;
  readonly requestedProvider: string;
  readonly contentFingerprint: string;
  readonly offset: number;
}

type ReadResultInput = Readonly<Omit<ReadResult, "links" | "images" | "metadata">> & {
  readonly links?: readonly string[];
  readonly images?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
};

/** Optional page fields a bounded read keeps only on request. */
interface PageFields {
  readonly links: boolean;
  readonly images: boolean;
}

const DEFAULT_READ_PROVIDER: ReadProviderName = "jina";
const MAX_CONTINUATION_LENGTH = 1_024;
const READ_CONTINUATION = "@agntn/web/read-continuation/v2";

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
 * @param requestedOptions - Provider, native read options, and portable output options.
 * @returns {Promise<ReadUrlDetailedResult>} Result, provider, attempts, and failures.
 */
export async function readUrlDetailed(
  url: string,
  requestedOptions?: Readonly<ReadUrlOptions>,
): Promise<ReadUrlDetailedResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) throw new EmptyUrlError();

  const options = normalizeReadOptions(requestedOptions);
  const {
    provider: requestedProviderInput,
    maxChars: maxCharsInput,
    continuation,
    links,
    images,
    ...readOptions
  } = options ?? {};
  const maxChars = readMaxChars(maxCharsInput);
  const effectiveReadOptions = withExecutionBudget(readOptions);
  throwIfAborted(effectiveReadOptions.signal);
  const requestedProviderName = requestedProviderInput?.trim();
  const requestedProvider = requestedProviderName || "auto";
  const pageFields = { links: links === true, images: images === true };

  if (continuation !== undefined) {
    return continueRead(
      trimmedUrl,
      requestedProvider,
      effectiveReadOptions,
      maxChars,
      continuation,
      pageFields,
    );
  }

  const response = requestedProviderName
    ? await readExplicitly(
        trimmedUrl,
        effectiveReadOptions,
        requestedProviderName,
        maxChars,
        pageFields,
      )
    : await readAutomatically(trimmedUrl, effectiveReadOptions, maxChars, pageFields);
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
      ...pageFields,
    }),
  };
}

async function readExplicitly(
  url: string,
  options: Readonly<ReadOptions>,
  requestedProvider: string,
  maxChars: number | undefined,
  pageFields: Readonly<PageFields>,
): Promise<ReadUrlDetailedResult> {
  const provider = resolveReadProviderName(requestedProvider);
  return {
    result: await readFromProvider(url, options, provider, maxChars, pageFields),
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
  pageFields: Readonly<PageFields>,
): Promise<ReadUrlDetailedResult> {
  const payload = decodeContinuation(continuation, readRequest(url, readOptions));
  if (requestedProvider !== "auto" && requestedProvider !== payload.requestedProvider) {
    throw new InvalidReadContinuationError();
  }

  const provider = resolveReadProviderName(payload.provider);
  const ignoredOptions =
    payload.requestedProvider === "auto" ? ignoredReadOptions(provider, readOptions) : [];
  const result = await readFromProvider(
    url,
    withoutReadOptions(readOptions, ignoredOptions),
    provider,
    maxChars,
    pageFields,
  );
  if (fingerprint(result.content) !== payload.contentFingerprint) {
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
      ...pageFields,
    }),
    requestedProvider: payload.requestedProvider,
    provider,
    attempts: [provider],
    failures: [],
    ...ignoredOptionsField(ignoredOptions),
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
  maxChars: number | undefined,
  pageFields: Readonly<PageFields>,
): Promise<ReadUrlDetailedResult> {
  const providerNames = [DEFAULT_READ_PROVIDER, ...configuredReadProviders(DEFAULT_READ_PROVIDER)];
  const attempts: string[] = [];
  const failures: ProviderFailure[] = [];
  let lastError: unknown;

  for (const providerName of providerNames) {
    attempts.push(providerName);
    const ignoredOptions = ignoredReadOptions(providerName, options);
    try {
      return {
        result: await readFromProvider(
          url,
          withoutReadOptions(options, ignoredOptions),
          providerName,
          maxChars,
          pageFields,
        ),
        requestedProvider: "auto",
        provider: providerName,
        attempts,
        failures,
        ...ignoredOptionsField(ignoredOptions),
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
  maxChars: number | undefined,
  pageFields: Readonly<PageFields>,
): Promise<ReadResult> {
  throwIfAborted(options.signal);
  let result: ReadResult;
  try {
    const provider = await createReadProvider(providerName);
    throwIfAborted(options.signal);
    result = await provider.read(
      url,
      providerRequestOptions(boundedReadRequest(options, maxChars, pageFields)),
    );
  } catch (error) {
    throwIfAborted(options.signal);
    throw error;
  }
  throwIfAborted(options.signal);
  return result;
}

/**
 * Jina's `maxTokens` budget stays off a reader whose declared options lack it.
 * @param providerName - Reader about to be tried.
 * @param options - Native read options for this call.
 * @returns {ReadOptionName[]} Options to leave out of this reader's request.
 */
function ignoredReadOptions(
  providerName: string,
  options: Readonly<ReadOptions>,
): ReadOptionName[] {
  if (options.maxTokens === undefined) return [];
  const declared = getProviderCapabilities(providerName)?.read.options;
  return declared === undefined || declared.includes("maxTokens") ? [] : ["maxTokens"];
}

function withoutReadOptions(
  options: Readonly<ReadOptions>,
  ignored: readonly ReadOptionName[],
): Readonly<ReadOptions> {
  if (!ignored.includes("maxTokens")) return options;
  const { maxTokens: _maxTokens, ...rest } = options;
  return rest;
}

function ignoredOptionsField(
  ignored: readonly ReadOptionName[],
): Pick<ReadUrlDetailedResult, "ignoredOptions"> {
  return ignored.length === 0 ? {} : { ignoredOptions: ignored };
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

/**
 * An unbounded read still returns links, so only a bound decides extraction.
 * @param options - Native read options for this call.
 * @param maxChars - Output bound. Absent when the whole page comes back.
 * @param fields - Whether the bounded read keeps links.
 * @returns {ReadOptions} Options the reader should see.
 */
function boundedReadRequest(
  options: Readonly<ReadOptions>,
  maxChars: number | undefined,
  fields: Readonly<PageFields>,
): ReadOptions {
  if (maxChars === undefined) return options;
  return { ...options, links: fields.links };
}

function readMaxChars(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("maxChars must be a positive safe integer");
  }
  return value;
}

/**
 * Slices one page to the bound and drops what would smuggle the page past it: the
 * `text` and `html` duplicates always, `links` and `images` unless asked for, since a
 * long page carries thousands of links for a few thousand words.
 * @param result - Page as the reader returned it.
 * @param context - Bound, offset, reader provenance, and the optional fields to keep.
 * @returns {ReadResult} Bounded page with a continuation when more remained.
 */
function pageReadResult(
  result: ReadResultInput,
  context: Readonly<
    PageFields & {
      url: string;
      readOptions: Readonly<ReadOptions>;
      maxChars: number | undefined;
      offset: number;
      provider: string;
      requestedProvider: string;
    }
  >,
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
    ? encodeContinuation(
        {
          provider: context.provider,
          requestedProvider: context.requestedProvider,
          contentFingerprint: fingerprint(result.content),
          offset: page.nextOffset,
        },
        readRequest(context.url, context.readOptions),
      )
    : undefined;
  return {
    ...rest,
    content: page.content,
    truncated: page.truncated,
    ...(continuation === undefined ? {} : { continuation }),
    ...(context.links && links !== undefined ? { links: [...links] } : {}),
    ...(context.images && images !== undefined ? { images: [...images] } : {}),
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
  const requestedEnd = maxChars === undefined ? Number.POSITIVE_INFINITY : offset + maxChars;

  for (const character of content) {
    if (characterOffset === offset) startCodeUnit = codeUnitOffset;
    if (characterOffset === requestedEnd) {
      return {
        content: content.slice(startCodeUnit, codeUnitOffset),
        truncated: true,
        nextOffset: characterOffset,
      };
    }
    codeUnitOffset += character.length;
    characterOffset += 1;
  }
  if (characterOffset === offset) startCodeUnit = codeUnitOffset;
  if (offset > characterOffset) throw new InvalidReadContinuationError();

  return {
    content: content.slice(startCodeUnit),
    truncated: false,
    nextOffset: characterOffset,
  };
}

function readRequest(url: string, options: Readonly<ReadOptions>): string {
  return JSON.stringify([
    url,
    options.format ?? null,
    options.maxTokens ?? null,
    options.targetSelector ?? null,
    options.removeSelector ?? null,
    options.timeout ?? null,
    options.noCache === true,
  ]);
}

function encodeContinuation(payload: Readonly<ReadContinuationPayload>, request: string): string {
  return sealContinuation(
    READ_CONTINUATION,
    [
      payload.provider,
      payload.requestedProvider,
      String(payload.offset),
      payload.contentFingerprint,
    ],
    request,
  );
}

function decodeContinuation(token: string, request: string): ReadContinuationPayload {
  const fields =
    token.length <= MAX_CONTINUATION_LENGTH
      ? openContinuation(READ_CONTINUATION, token, 4, request)
      : undefined;
  const [provider, requestedProvider, offset, contentFingerprint] = fields ?? [];
  if (!provider || !requestedProvider || !offset || !contentFingerprint) {
    throw new InvalidReadContinuationError();
  }
  return { provider, requestedProvider, contentFingerprint, offset: continuationOffset(offset) };
}

function continuationOffset(value: string): number {
  const offset = Number(value);
  if (!/^(?:0|[1-9]\d*)$/u.test(value) || !Number.isSafeInteger(offset)) {
    throw new InvalidReadContinuationError();
  }
  return offset;
}
