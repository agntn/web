import type { H3Event } from "h3";
import { hash } from "ohash";
import {
  AuthError,
  EmptyQueryError,
  EmptyUrlError,
  HTTPError,
  InvalidDateFilterError,
  InvalidImageUrlError,
  NoProviderAvailableError,
  NoProviderConfiguredError,
  ProviderFallbackError,
  RateLimitError,
  ReadNotSupportedError,
  SearchNotSupportedError,
  UnknownProviderError,
  type ProviderFailure,
  type SearchResult,
} from "@agntn/web";

type Query = Record<string, unknown>;

/** Caps every public parameter well below anything a provider would mind. */
export const LIMITS = {
  query: 256,
  url: 2048,
  maxResults: 10,
  /** Portable read bound in code points; the library's agent default is 20 000. */
  maxChars: 8000,
  /** One execution budget for the whole operation, fallback and fan-out included. */
  deadline: 25_000,
  concurrency: 3,
} as const;

/** Seconds an answer stays cached, per operation. */
export const TTL = {
  search: 15 * 60,
  fanout: 15 * 60,
  read: 60 * 60,
  providers: 5 * 60,
} as const;

/** An answer that carries a provider failure is kept this long, so an outage is retried soon. */
export const DEGRADED_TTL = 5 * 60;

function raw(query: Query, key: string): string | undefined {
  const value = query[key];
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

export function readString(query: Query, key: string, max: number): string | undefined {
  const value = raw(query, key)?.trim();
  if (!value) {
    return undefined;
  }
  if (value.length > max) {
    throw createError({ statusCode: 400, statusMessage: `${key} must be at most ${max} characters` });
  }
  return value;
}

export function requireString(query: Query, key: string, max: number): string {
  const value = readString(query, key, max);
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: `${key} is required` });
  }
  return value;
}

export function readInt(query: Query, key: string, min: number, max: number): number | undefined {
  const value = raw(query, key);
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw createError({ statusCode: 400, statusMessage: `${key} must be an integer between ${min} and ${max}` });
  }
  return parsed;
}

/** A provider name as the library validates it; `auto` and `all` are the docs' own words for no provider. */
export function readProvider(query: Query): string | undefined {
  const value = readString(query, "provider", 64);
  if (!value || value === "auto" || value === "all") {
    return undefined;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw createError({ statusCode: 400, statusMessage: "provider must be lowercase letters, digits and single hyphens" });
  }
  return value;
}

/** The URL the read route accepts: http or https, nothing else. */
export function readUrlParam(query: Query): string {
  const value = requireString(query, "url", LIMITS.url);
  const withScheme = /^https?:\/\//iu.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "url must be an absolute http or https URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createError({ statusCode: 400, statusMessage: "url must be an absolute http or https URL" });
  }
  if (parsed.username || parsed.password) {
    throw createError({ statusCode: 400, statusMessage: "url must not carry credentials" });
  }
  return parsed.toString();
}

/** Execution controls every route passes to the library: one deadline for the whole operation. */
export function budget() {
  return { deadline: Date.now() + LIMITS.deadline, concurrency: LIMITS.concurrency } as const;
}

/** A search result as it crosses the wire, with long text cut so a page of results stays small. */
export type WireResult = Pick<
  SearchResult,
  "url" | "title" | "snippet" | "score" | "publishedDate" | "author" | "favicon" | "image" | "text" | "highlights" | "summary"
>;

function cut(value: string, max: number): string {
  const points = [...value];
  return points.length > max ? `${points.slice(0, max - 1).join("").trimEnd()}…` : value;
}

export function slimResult(result: Readonly<SearchResult>): WireResult {
  const out: WireResult = { url: result.url, title: cut(result.title, 200), snippet: cut(result.snippet, 400) };
  if (typeof result.score === "number") out.score = result.score;
  if (result.publishedDate) out.publishedDate = result.publishedDate;
  if (result.author) out.author = cut(result.author, 80);
  if (result.favicon) out.favicon = result.favicon;
  if (result.image) out.image = result.image;
  if (result.text) out.text = cut(result.text, 600);
  if (result.highlights?.length) out.highlights = result.highlights.slice(0, 3).map((line) => cut(line, 300));
  if (result.summary) out.summary = cut(result.summary, 600);
  return out;
}

/** A failure message the browser can show: short, and never a response body with account details. */
export function failureText(message: string): string {
  const head = message.split(/[:{]/u, 2)[0]?.trim() || message;
  return cut(head, 160);
}

export interface WireFailure {
  provider: string;
  message: string;
}

export function slimFailures(failures: readonly ProviderFailure[]): WireFailure[] {
  return failures.map((failure) => ({ provider: failure.provider, message: failureText(failure.error) }));
}

/** Stable cache key from the parameters that reach the library, so two spellings of one query share an entry. */
export function cacheKey(prefix: string, params: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `${prefix}:${JSON.stringify(entries)}`;
}

/** Turns a library error into the status the browser can show; the typed hierarchy decides the code. */
export function toHttpError(error: unknown): never {
  if (error && typeof error === "object" && "statusCode" in error && !(error instanceof HTTPError)) {
    throw error;
  }
  if (
    error instanceof EmptyQueryError ||
    error instanceof EmptyUrlError ||
    error instanceof InvalidImageUrlError ||
    error instanceof InvalidDateFilterError ||
    error instanceof UnknownProviderError ||
    error instanceof SearchNotSupportedError ||
    error instanceof ReadNotSupportedError
  ) {
    throw createError({ statusCode: 400, statusMessage: failureText(error.message) });
  }
  if (error instanceof NoProviderConfiguredError || error instanceof NoProviderAvailableError) {
    throw createError({ statusCode: 503, statusMessage: "No search provider is configured on the docs worker" });
  }
  if (error instanceof AuthError) {
    throw createError({ statusCode: 503, statusMessage: `${error.provider} rejected the docs worker's key` });
  }
  if (error instanceof RateLimitError) {
    throw createError({ statusCode: 429, statusMessage: `The provider is rate limiting the docs worker; retry after ${error.retryAfter}s` });
  }
  if (error instanceof ProviderFallbackError) {
    const chain = error.failures.map((failure) => `${failure.provider}: ${failureText(failure.error)}`).join("; ");
    throw createError({ statusCode: 502, statusMessage: `Every provider tried failed. ${chain}` });
  }
  if (error instanceof HTTPError) {
    throw createError({ statusCode: 502, statusMessage: `The provider answered HTTP ${error.statusCode}` });
  }
  const message = error instanceof Error ? error.message : String(error);
  throw createError({ statusCode: 502, statusMessage: failureText(message) });
}

export function markPublic(event: H3Event, seconds: number): void {
  setResponseHeader(event, "Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`);
}

/** Uncached provider queries one client may start per minute; `ratelimits` in wrangler.jsonc carries the same number. */
export const RATE_LIMIT = 20;

/** The Workers Rate Limiting binding: Cloudflare keeps the count, so concurrent misses can't race it. */
interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Fallback for `nuxt dev` without the binding: one counter per isolate, incremented synchronously. */
const localCounts = new Map<string, number>();

/**
 * The address a request came from, as Cloudflare saw it. `X-Forwarded-For` is left out: its first
 * entry is whatever the caller sent, so it would let one client rotate its own key.
 */
function clientAddress(event: H3Event): string {
  return getRequestHeader(event, "cf-connecting-ip") ?? getRequestIP(event) ?? "unknown";
}

/**
 * Refuses a provider query past the per-minute limit for its address.
 *
 * Only a cache miss counts, so a warm demo never trips it, and the metered engines behind
 * the worker see at most this many new questions from one address.
 */
export async function assertRateLimit(event: H3Event): Promise<void> {
  const key = hash(clientAddress(event));
  const limiter = (event.context.cloudflare?.env as { QUERY_LIMIT?: RateLimiter } | undefined)?.QUERY_LIMIT;
  let allowed: boolean;
  if (limiter) {
    allowed = (await limiter.limit({ key })).success;
  } else {
    const minute = Math.floor(Date.now() / 60_000);
    const slot = `${key}:${minute}`;
    if (!localCounts.has(slot)) {
      for (const stale of localCounts.keys()) if (!stale.endsWith(`:${minute}`)) localCounts.delete(stale);
    }
    const count = (localCounts.get(slot) ?? 0) + 1;
    localCounts.set(slot, count);
    allowed = count <= RATE_LIMIT;
  }
  if (!allowed) {
    setResponseHeader(event, "Retry-After", 60);
    throw createError({
      statusCode: 429,
      statusMessage: `More than ${RATE_LIMIT} new provider queries in a minute from one address; cached answers are not counted. Wait a moment.`,
    });
  }
}

interface CachedEntry<T> {
  value: T;
  expires: number;
}

/** Serves from the cache or produces and stores; a thrown failure is never stored, a degraded answer only briefly. */
export async function cachedAnswer<T>(
  event: H3Event,
  prefix: string,
  params: Readonly<Record<string, unknown>>,
  ttl: number,
  produce: () => Promise<T>,
  degraded: (value: T) => boolean = () => false,
): Promise<T> {
  const storage = useStorage("cache");
  const key = `docs:${prefix}:${hash(cacheKey(prefix, params))}`;
  const hit = await storage.getItem<CachedEntry<T>>(key).catch(() => null);
  if (hit && typeof hit.expires === "number" && hit.expires > Date.now()) {
    markPublic(event, Math.max(1, Math.floor((hit.expires - Date.now()) / 1000)));
    return hit.value;
  }
  await assertRateLimit(event);
  const value = await produce();
  const seconds = degraded(value) ? DEGRADED_TTL : ttl;
  await storage.setItem(key, { value, expires: Date.now() + seconds * 1000 }, { ttl: seconds }).catch(() => undefined);
  markPublic(event, seconds);
  return value;
}
