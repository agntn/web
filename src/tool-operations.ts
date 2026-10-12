import { ToolInputError, type ToolResult } from "@agntn/tools";

import { searchAllDetailed, searchProviderDetailed, searchWithFallback } from "./core/all.ts";
import { readBatchDetailed, searchBatch, serializedBatch } from "./core/batch.ts";
import { type CodexHostAuth, withCodexHostAuth } from "./core/codex-auth.ts";
import { EmptyImageUrlError, EmptyQueryError } from "./core/errors.ts";
import { batchWithoutRepeatedEvidence, withoutRepeatedEvidence } from "./core/evidence.ts";
import { deadlineAfterSeconds } from "./core/execution.ts";
import { searchByImage } from "./core/image.ts";
import {
  DEFAULT_AGENT_READ_MAX_CHARS,
  MAX_AGENT_READ_CHARS,
  MAX_AGENT_RESULTS,
  MAX_SEARCH_CONTINUATION_LENGTH,
} from "./core/limits.ts";
import { optionalText } from "./core/options.ts";
import { imageSearchProviderNames } from "./core/providers.ts";
import { packageCapabilities, readUrlDetailed } from "./core/read.ts";
import { revealUrl } from "./core/reveal.ts";
import { readProviders, searchImageProviders, searchProviders } from "./core/registry.ts";
import { listProvidersAsync } from "./core/resolve.ts";
import type { ReadOptions, SearchPageOptions } from "./core/types.ts";
import {
  imageSearchText,
  providersText,
  readBatchText,
  readText,
  revealAnswer,
  searchAllText,
  searchBatchText,
  searchProviderText,
} from "./tool-text.ts";
import { runtimeInfo } from "./version.ts";

/** Untrusted arguments: `definition.execute` runs without the core's validation. */
type Args = Readonly<Record<string, unknown>>;

/** What every tool answers with: the text the model reads and the data as `result`. */
export type WebToolResult = ToolResult<{ readonly result: unknown }>;

/**
 * Searches one provider, the automatic order, every provider, or a batch of queries.
 *
 * A Pi or OMP host lends its own OpenAI Codex login for the call.
 * @param {Args} args - Tool arguments.
 * @param signal - Cancellation from the host.
 * @param host - Pi's or OMP's `ctx`, anything else on other surfaces.
 * @returns {Promise<WebToolResult>} Model text and the search payload.
 */
export async function search(
  args: Args,
  signal?: Readonly<AbortSignal>,
  host?: unknown,
): Promise<WebToolResult> {
  const query = searchInputArg(args.query);
  const provider = searchProviderArg(args.provider);
  const options: SearchPageOptions = {
    maxResults: cappedResults(args.maxResults),
    continuation: searchContinuationArg(args.continuation, query, provider),
    ...searchContentOptions(args),
    ...searchFilterOptions(args),
    deadline: deadlineAfterSeconds(intArg("timeoutSeconds", args.timeoutSeconds)),
    signal,
  };
  const { auth, sessionId } = codexHost(host);
  return withCodexHostAuth(auth, () => runSearch(query, provider, options), sessionId);
}

async function runSearch(
  query: string | readonly string[],
  provider: string | undefined,
  options: Readonly<SearchPageOptions>,
): Promise<WebToolResult> {
  if (typeof query !== "string") {
    const outcomes = batchWithoutRepeatedEvidence(
      await searchBatch(query, { provider, ...options }),
    );
    return answer(searchBatchText(outcomes), outcomes);
  }
  if (provider === "all") {
    const response = await searchAllDetailed(query, options);
    const result = {
      ...response,
      results: withoutRepeatedEvidence(response.results),
      errors: response.errors.map(({ provider: failed, error }) => ({
        provider: failed,
        error: error.message,
      })),
    };
    return answer(searchAllText(query, result), result);
  }
  const result =
    provider === undefined
      ? await searchWithFallback(query, options)
      : await searchProviderDetailed(provider, query, options);
  return answer(searchProviderText(query, result, provider === undefined), result);
}

/**
 * Finds public pages containing or resembling an image available by URL.
 * @param {Args} args - Tool arguments.
 * @param signal - Cancellation from the host.
 * @returns {Promise<WebToolResult>} Model text and the matches.
 */
export async function searchImage(
  args: Args,
  signal?: Readonly<AbortSignal>,
): Promise<WebToolResult> {
  const url = stringArg("url", args.url);
  if (!url?.trim()) throw new EmptyImageUrlError();
  const maxResults = cappedResults(args.maxResults);
  const provider = imageSearchProviderArg(args.provider);
  const matches = await searchByImage(url, { provider, maxResults, signal });
  return answer(
    imageSearchText(url.trim(), provider ?? imageSearchProviderNames[0], matches),
    matches,
  );
}

/**
 * Reads one URL or a batch, with automatic fallback when no reader is named.
 * @param {Args} args - Tool arguments.
 * @param signal - Cancellation from the host.
 * @param bounded - Cut at the agent default without `maxChars`; the CLI prints pages whole.
 * @returns {Promise<WebToolResult>} Model text and the read payload.
 */
export async function read(
  args: Args,
  signal?: Readonly<AbortSignal>,
  bounded = true,
): Promise<WebToolResult> {
  const urlInput = typeof args.url === "string" ? serializedBatch(args.url) : args.url;
  const urls = Array.isArray(urlInput) ? stringListArg("url", urlInput) : undefined;
  const continuation = stringArg("continuation", args.continuation);
  if (urls !== undefined && continuation !== undefined) {
    throw new ToolInputError(["continuation is only supported for a single URL"]);
  }
  const options = {
    provider: readProviderArg(args.provider),
    format: readFormatArg(args.format),
    maxTokens: intArg("maxTokens", args.maxTokens),
    maxChars: readMaxCharsArg(args.maxChars, bounded),
    continuation,
    links: boolArg("links", args.links),
    images: boolArg("images", args.images),
    targetSelector: stringArg("targetSelector", args.targetSelector),
    removeSelector: stringArg("removeSelector", args.removeSelector),
    timeout: intArg("timeout", args.timeout),
    noCache: boolArg("noCache", args.noCache),
    deadline: deadlineAfterSeconds(intArg("timeoutSeconds", args.timeoutSeconds)),
    signal,
  };
  if (urls !== undefined) {
    const outcomes = await readBatchDetailed(urls, options);
    return answer(readBatchText(outcomes), outcomes);
  }
  const result = await readUrlDetailed(typeof urlInput === "string" ? urlInput : "", options);
  return answer(readText(result), result);
}

/**
 * Reports the running build, the package guarantees and every registered provider.
 * @param signal - Cancellation from the host.
 * @param host - Pi's or OMP's `ctx`, whose Codex login counts as configured.
 * @returns {Promise<WebToolResult>} Model text and the provider statuses.
 */
export async function providers(
  signal?: Readonly<AbortSignal>,
  host?: unknown,
): Promise<WebToolResult> {
  const { auth, sessionId } = codexHost(host);
  const statuses = await withCodexHostAuth(auth, () => listProvidersAsync({ signal }), sessionId);
  const result = { runtime: runtimeInfo, packageCapabilities, providers: statuses };
  return answer(providersText(result), result);
}

/**
 * Lists what a page keeps from its reader, as much as the answer's character budget shows.
 * @param {Args} args - Tool arguments.
 * @param signal - Cancellation from the host.
 * @returns {Promise<WebToolResult>} Model text and the findings that fit.
 */
export async function reveal(args: Args, signal?: Readonly<AbortSignal>): Promise<WebToolResult> {
  const url = stringArg("url", args.url) ?? "";
  const maxChars = readMaxCharsArg(args.maxChars, true) ?? DEFAULT_AGENT_READ_MAX_CHARS;
  const deadline = deadlineAfterSeconds(intArg("timeoutSeconds", args.timeoutSeconds));
  const { text, result } = revealAnswer(await revealUrl(url, { signal, deadline }), maxChars);
  return answer(text, result);
}

function answer(text: string, result: unknown): WebToolResult {
  return { content: [{ type: "text", text }], details: { result } };
}

/**
 * The login a Pi or OMP host lends for one call: Pi's model registry, or the auth storage OMP
 * keeps on its own, with the session OMP pins an account to.
 * @param host - The host context the adapter passed, if any.
 * @returns {{ auth?: CodexHostAuth; sessionId?: string }} Nothing off Pi and OMP.
 */
function codexHost(host: unknown): { auth?: CodexHostAuth; sessionId?: string } {
  if (!isRecord(host)) return {};
  const registry = isRecord(host.modelRegistry) ? host.modelRegistry : undefined;
  const auth =
    registry === undefined || typeof registry.getProviderAuth === "function"
      ? registry
      : isRecord(registry.authStorage)
        ? registry.authStorage
        : registry;
  return { auth: auth as CodexHostAuth | undefined, sessionId: hostSessionId(host) };
}

/**
 * @param host - Pi's or OMP's `ctx`.
 * @returns {string | undefined} The session OMP pins a Codex account to, when the host has one.
 */
function hostSessionId(host: Readonly<Record<string, unknown>>): string | undefined {
  const sessionManager = isRecord(host.sessionManager) ? host.sessionManager : undefined;
  if (typeof sessionManager?.getSessionId !== "function") return undefined;
  const sessionId = (sessionManager.getSessionId as () => unknown)();
  return typeof sessionId === "string" ? sessionId : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function searchContentOptions(args: Args): SearchPageOptions {
  return {
    highlights: boolArg("highlights", args.highlights),
    summary: boolArg("summary", args.summary),
    fullText: boolArg("fullText", args.fullText),
    favicon: boolArg("favicon", args.favicon) === true,
  };
}

function searchFilterOptions(args: Args): SearchPageOptions {
  return {
    includeDomains: stringArrayArg("includeDomains", args.includeDomains),
    excludeDomains: stringArrayArg("excludeDomains", args.excludeDomains),
    sources: stringArrayArg("sources", args.sources),
    categories: stringArrayArg("categories", args.categories),
    category: stringArg("category", args.category),
    startPublishedDate: stringArg("startPublishedDate", args.startPublishedDate),
    endPublishedDate: stringArg("endPublishedDate", args.endPublishedDate),
  };
}

/**
 * Boundary guards for typed options when `definition.execute` runs without the schema.
 *
 * They enforce exactly the declared schema contract and throw instead of silently dropping or
 * coercing: jina iterates includeDomains with for...of, so a bare string would reach the API as
 * one `site=` param per character, and fractional maxTokens would become an X-Token-Budget header.
 * @param {string} name - Argument name used in errors.
 * @param {*} value - Untrusted argument value.
 * @returns {string | undefined} Parsed optional string, blank as unset.
 */
function stringArg(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ToolInputError([`${name} must be a string`]);
  return optionalText(value);
}

function searchInputArg(value: unknown): string | readonly string[] {
  if (Array.isArray(value)) return stringListArg("query", value);
  if (typeof value !== "string" || !value.trim()) throw new EmptyQueryError();
  return serializedBatch(value);
}

/**
 * A continuation names one page of one provider, so a batch or a fan-out cannot take it.
 * @param value - Untrusted token.
 * @param query - The query or batch it would continue.
 * @param provider - The provider asked for, `all` for a fan-out.
 * @returns {string | undefined} The token, or undefined when none was given.
 */
function searchContinuationArg(
  value: unknown,
  query: string | readonly string[],
  provider: string | undefined,
): string | undefined {
  const continuation = stringArg("continuation", value);
  if (continuation === undefined) return undefined;
  if (continuation.length > MAX_SEARCH_CONTINUATION_LENGTH) {
    throw new ToolInputError([
      `continuation must be at most ${MAX_SEARCH_CONTINUATION_LENGTH} characters`,
    ]);
  }
  if (typeof query !== "string") {
    throw new ToolInputError(["continuation is only supported for a single query"]);
  }
  if (provider === "all") {
    throw new ToolInputError(["continuation is not supported with provider=all"]);
  }
  return continuation;
}

function searchProviderArg(value: unknown): string | undefined {
  const requested = stringArg("provider", value);
  if (requested === undefined || requested === "auto") return undefined;
  if (requested === "all") return requested;
  const provider = searchProviders().find((name) => name === requested);
  if (!provider) {
    throw new ToolInputError([
      `provider must be one of: auto, all, ${searchProviders().join(", ")}`,
    ]);
  }
  return provider;
}

function imageSearchProviderArg(value: unknown): string | undefined {
  const requested = stringArg("provider", value);
  if (requested === undefined) return undefined;
  const provider = searchImageProviders().find((name) => name === requested);
  if (!provider) {
    throw new ToolInputError([`provider must be one of: ${searchImageProviders().join(", ")}`]);
  }
  return provider;
}

function readProviderArg(value: unknown): string | undefined {
  const requested = stringArg("provider", value);
  if (requested === undefined || requested === "auto") return undefined;
  const provider = readProviders().find((name) => name === requested);
  if (!provider) {
    throw new ToolInputError([`provider must be one of: auto, ${readProviders().join(", ")}`]);
  }
  return provider;
}

function readFormatArg(value: unknown): ReadOptions["format"] {
  const format = stringArg("format", value);
  if (format === undefined || format === "markdown" || format === "text" || format === "html") {
    return format;
  }
  throw new ToolInputError(["format must be one of: markdown, text, html"]);
}

function intArg(name: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ToolInputError([`${name} must be an integer >= 1`]);
  }
  return value;
}

function cappedResults(value: unknown): number | undefined {
  const maxResults = intArg("maxResults", value);
  if (maxResults !== undefined && maxResults > MAX_AGENT_RESULTS) {
    throw new ToolInputError([`maxResults must be at most ${MAX_AGENT_RESULTS}`]);
  }
  return maxResults;
}

function readMaxCharsArg(value: unknown, bounded: boolean): number | undefined {
  const maxChars =
    intArg("maxChars", value) ?? (bounded ? DEFAULT_AGENT_READ_MAX_CHARS : undefined);
  if (maxChars !== undefined && maxChars > MAX_AGENT_READ_CHARS) {
    throw new ToolInputError([`maxChars must be at most ${MAX_AGENT_READ_CHARS}`]);
  }
  return maxChars;
}

function boolArg(name: string, value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ToolInputError([`${name} must be a boolean`]);
  return value;
}

function stringArrayArg(name: string, value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ToolInputError([`${name} must be an array of strings`]);
  return stringListArg(name, value, `${name} must be an array of strings`);
}

function stringListArg(
  name: string,
  value: readonly unknown[],
  message = `${name} must be a string or an array of strings`,
): readonly string[] {
  return value.map((item) => {
    if (typeof item !== "string") throw new ToolInputError([message]);
    return item;
  });
}
