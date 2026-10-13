import type { IncomingMessage } from "node:http";
import type { BlockList, LookupFunction } from "node:net";

import {
  HTTPError,
  InvalidPageUrlError,
  PrivateAddressError,
  UnreadablePageError,
  WebError,
} from "./errors.ts";
import { operationSignal, settleWithConcurrency } from "./execution.ts";
import {
  invisibleCharacters,
  linkedStylesheets,
  revealHtml,
  type HiddenFinding,
  type Stylesheet,
} from "./hidden.ts";
import { sanitizeUrl } from "./redaction.ts";
import { clip } from "./text.ts";
import type { ExecutionOptions } from "./types.ts";
import { version } from "../version.ts";

export {
  hiddenKinds,
  linkedStylesheets,
  revealHtml,
  type HiddenFinding,
  type HiddenKind,
  type RevealHtmlOptions,
  type Stylesheet,
} from "./hidden.ts";

/** Largest page a reveal reads by default, 4 MiB: past nearly any HTML document. */
export const DEFAULT_REVEAL_MAX_BYTES = 4 * 1024 * 1024;

/** The Wayback Machine takes over 20 seconds to load some captures. */
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
/** Waits before the second and third try when the server says it is briefly down. */
const RETRY_DELAYS_MS = [500, 1_500];
const RETRY_STATUSES = new Set([502, 503, 504]);
/** Connection errors worth one more try; a refused or unknown host is not one of them. */
const RETRY_CODES = new Set(["ECONNRESET", "EPIPE", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_SOCKET"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ERROR_BODY_BYTES = 16_384;
const SNIFF_BYTES = 1_024;
const WAYBACK_HOSTS = new Set(["web.archive.org", "wayback.archive.org"]);
const WAYBACK_CAPTURE = /^\/web\/(?<stamp>\d{1,14})(?:[a-z]{2}_)?\/(?<target>.+)$/u;
/** HTML is parsed; XHTML, XML, SVG and feeds follow XML tree rules, so they are read as text. */
const MARKUP_TYPE = /^text\/html$/u;
const TEXT_TYPE =
  /^(?:text\/[\w.+-]+|application\/(?:json|javascript|ecmascript|xml|[\w.+-]+\+json)|[\w.+-]+\/[\w.+-]+\+xml)$/u;
const CHARSET = /charset\s*=\s*["']?(?<label>[\w.:-]+)/iu;
/** An untyped body is HTML when it opens like markup: a doctype, a comment or an element. */
const MARKUP_START = /^\s*<(?:!doctype\s+html|!--|[a-z][\w-]*[\s/>])/iu;
const TITLE = /<title[^>]*>(?<title>[^<]*)</iu;
const ACCEPT = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8";
const STYLESHEET_ACCEPT = "text/css,*/*;q=0.1";
/** Stylesheets one reveal reads, linked and imported together; a theme rarely needs more. */
const MAX_STYLESHEETS = 10;
/** One deadline for all the sheets, so a stalling `site.css` can't hold up a page already read. */
const STYLESHEETS_TIMEOUT_MS = 30_000;

/** Address ranges a page to reveal may not sit on, unless the caller allows private networks. */
const PRIVATE_RANGES: readonly (readonly [string, number, "ipv4" | "ipv6"])[] = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["64:ff9b::", 96, "ipv6"],
  ["64:ff9b:1::", 48, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
];

/** Options for {@link revealUrl}. */
export interface RevealOptions extends ExecutionOptions {
  /** Most bytes read from the page; a longer one is scanned from its start. Defaults to 4 MiB. */
  readonly maxBytes?: number;
  /** Let the page or a redirect sit on a private network. Defaults to false; keep it for models. */
  readonly allowPrivateNetwork?: boolean;
}

/** What a page keeps from its reader, and which bytes that comes from. */
export interface RevealResult {
  /** The URL as given. */
  readonly url: string;
  /** The URL read, after the Wayback rewrite and any redirects. */
  readonly source: string;
  /** Set when the Wayback Machine served the capture as archived, without its toolbar. */
  readonly archive?: "wayback";
  readonly contentType?: string;
  /** Linked and imported stylesheets whose rules the reveal applied, by URL. */
  readonly stylesheets?: readonly string[];
  /** Bytes scanned. */
  readonly bytes: number;
  /** True when the page ran past `maxBytes` and only its start was scanned. */
  readonly partial?: boolean;
  readonly findings: readonly HiddenFinding[];
}

/** The URL a reveal fetches, and the address the page itself names. */
interface PageTarget {
  readonly fetch: string;
  readonly original?: string;
  /** The capture's `id_` prefix, which fetches what the archived page links as archived too. */
  readonly archived?: string;
}

/** One request's settings, the same for every try and redirect. */
interface PageRequest {
  readonly signal: Readonly<AbortSignal> | undefined;
  readonly maxBytes: number;
  readonly allowPrivateNetwork: boolean;
  readonly accept: string;
  /** How many stylesheets load at once. */
  readonly concurrency: number | undefined;
}

/** A response, through the parts reading it needs. */
interface Received {
  readonly status: number;
  readonly url: string;
  readonly contentType: string;
  readonly read: () => Promise<Chunk>;
  readonly cancel: () => Promise<void>;
}

/** What one request answers, before the redirect decision. */
interface Answer extends Omit<Received, "url"> {
  readonly location: string | undefined;
}

/** One read from a body stream. */
type Chunk =
  | { readonly done: true; readonly value?: unknown }
  | { readonly done: false; readonly value: Uint8Array };

/** A page body, decoded. */
interface Page {
  readonly url: string;
  readonly contentType: string;
  readonly text: string;
  readonly bytes: number;
  readonly partial: boolean;
  readonly markup: boolean;
}

let privateNetworks: BlockList | undefined;

/**
 * Fetch a page's own HTML and its stylesheets, no provider in between, and list what it hides.
 * @param url - Public HTTP or HTTPS page URL.
 * @param options - Cancellation, deadline, byte limit, and whether private networks are allowed.
 * @returns {Promise<RevealResult>} Findings in the order of {@link hiddenKinds}, then by line.
 * @throws {InvalidPageUrlError} When the URL is not absolute HTTP or HTTPS.
 * @throws {PrivateAddressError} When the page or a redirect resolves to a private network.
 * @throws {UnreadablePageError} When the page is neither markup nor text, or redirects too often.
 * @throws {HTTPError} When the server answers with an error or cannot be reached.
 */
export async function revealUrl(
  url: string,
  options?: Readonly<RevealOptions>,
): Promise<RevealResult> {
  const target = pageTarget(url);
  const request = {
    signal: operationSignal(options),
    maxBytes: byteLimit(options?.maxBytes),
    allowPrivateNetwork: options?.allowPrivateNetwork === true,
    accept: ACCEPT,
    concurrency: options?.concurrency,
  };
  const page = await fetchPage(target.fetch, request);
  const { findings, stylesheets } = await scan(page, target, request);
  return {
    url,
    source: page.url,
    ...(target.original === undefined ? {} : { archive: "wayback" as const }),
    ...(page.contentType === "" ? {} : { contentType: page.contentType }),
    ...(stylesheets.length === 0 ? {} : { stylesheets }),
    bytes: page.bytes,
    ...(page.partial ? { partial: true } : {}),
    findings,
  };
}

/**
 * Check the URL and point a Wayback capture at `id_`, the archived bytes without the toolbar.
 * @param url - The URL as given.
 * @returns {PageTarget} What to fetch, and the archived page's own address.
 */
function pageTarget(url: string): PageTarget {
  const trimmed = url.trim();
  if (!URL.canParse(trimmed)) throw new InvalidPageUrlError();
  const page = new URL(trimmed);
  if (page.protocol !== "http:" && page.protocol !== "https:") throw new InvalidPageUrlError();
  const capture = WAYBACK_HOSTS.has(page.hostname)
    ? WAYBACK_CAPTURE.exec(page.pathname)?.groups
    : undefined;
  if (capture?.stamp === undefined || capture.target === undefined) return { fetch: page.href };
  const archived = `${capture.target}${page.search}`;
  const prefix = `${page.origin}/web/${capture.stamp}id_/`;
  return { fetch: `${prefix}${archived}`, original: originalAddress(archived), archived: prefix };
}

/**
 * The page a capture names, which may lack a scheme or come folded to `https:/`.
 * @param target - The path after the timestamp.
 * @returns {string | undefined} An absolute URL, or undefined when the path names none.
 */
function originalAddress(target: string): string | undefined {
  const absolute = /^https?:\/\/?/iu.test(target)
    ? target.replace(/^(https?:)\/*/iu, "$1//")
    : `http://${target}`;
  return URL.canParse(absolute) ? new URL(absolute).href : undefined;
}

/**
 * Scan markup with the stylesheets it applies, or text for invisible characters alone.
 * @param page - The decoded page.
 * @param target - Where it came from.
 * @param request - The page's request settings, which its stylesheets reuse.
 * @returns {Promise<{ findings: HiddenFinding[]; stylesheets: string[] }>} The findings and the
 * sheets whose rules they saw.
 */
async function scan(
  page: Readonly<Page>,
  target: Readonly<PageTarget>,
  request: Readonly<PageRequest>,
): Promise<{ findings: HiddenFinding[]; stylesheets: string[] }> {
  if (!page.markup) return { findings: invisibleCharacters(page.text), stylesheets: [] };
  const url =
    target.original === undefined ? page.url : (pageTarget(page.url).original ?? target.original);
  const stylesheets = await readStylesheets(page.text, url, request, target);
  const findings = revealHtml(page.text, { url, stylesheets });
  return { findings, stylesheets: Object.keys(stylesheets) };
}

/**
 * The page's sheets and their imports, vetted and capped like the page; a failed one is skipped.
 * @param html - The page source.
 * @param url - The page address its links resolve against.
 * @param request - Signal, byte limit and network policy.
 * @param target - Where the page came from, so a capture's sheets come from the same archive.
 * @returns {Promise<Record<string, string>>} Each sheet read, by absolute URL.
 */
async function readStylesheets(
  html: string,
  url: string,
  request: Readonly<PageRequest>,
  target: Readonly<PageTarget>,
): Promise<Record<string, Stylesheet>> {
  const sheets: Record<string, Stylesheet> = {};
  const tried = new Set<string>();
  const budget = AbortSignal.timeout(STYLESHEETS_TIMEOUT_MS);
  const signal = request.signal === undefined ? budget : AbortSignal.any([request.signal, budget]);
  const sheetRequest = { ...request, signal, accept: STYLESHEET_ACCEPT };
  for (;;) {
    const next = linkedStylesheets(html, { url, stylesheets: sheets })
      .filter((sheet) => !tried.has(sheet) && /^https?:/iu.test(sheet))
      .slice(0, MAX_STYLESHEETS - tried.size);
    if (next.length === 0) return sheets;
    for (const sheet of next) tried.add(sheet);
    const read = await settleWithConcurrency(
      next,
      async (sheet) => readStylesheet(sheet, sheetRequest, target),
      { signal, concurrency: request.concurrency },
    );
    request.signal?.throwIfAborted();
    for (const [index, outcome] of read.entries()) {
      if (outcome.status === "fulfilled" && outcome.value !== undefined) {
        sheets[next[index]!] = outcome.value;
      }
    }
  }
}

/**
 * One stylesheet, or nothing when it fails, isn't CSS or slips out of the capture to a live site.
 * @param url - The sheet's address as the page links it.
 * @param request - The page's request settings, under the stylesheets' own deadline.
 * @param target - Where the page came from, so a capture's sheet comes from the same archive.
 * @returns {Promise<Stylesheet | undefined>} The text and the address it came from in the end.
 */
async function readStylesheet(
  url: string,
  request: Readonly<PageRequest>,
  target: Readonly<PageTarget>,
): Promise<Stylesheet | undefined> {
  try {
    const sheet = await fetchPage(`${target.archived ?? ""}${url}`, request);
    if (sheet.contentType.split(";")[0]?.trim().toLowerCase() !== "text/css") return undefined;
    const final = target.archived === undefined ? sheet.url : pageTarget(sheet.url).original;
    return final === undefined ? undefined : { text: sheet.text, url: final };
  } catch {
    return undefined;
  }
}

function byteLimit(maxBytes: number | undefined): number {
  if (maxBytes === undefined) return DEFAULT_REVEAL_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive integer");
  }
  return maxBytes;
}

/**
 * Fetch a page, trying twice more after a 502, 503, 504 or a dropped connection.
 * @param url - What to fetch.
 * @param request - Signal, byte limit and network policy.
 * @returns {Promise<Page>} The decoded page.
 */
async function fetchPage(url: string, request: PageRequest): Promise<Page> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchOnce(url, request);
    } catch (error) {
      request.signal?.throwIfAborted();
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !retryable(error)) throw transportError(error, url);
      await abortableDelay(delay, request.signal);
    }
  }
}

/**
 * Follow redirects by hand, so every address on the way passes the network policy.
 * @param url - What to fetch.
 * @param request - Signal, byte limit and network policy.
 * @returns {Promise<Page>} The decoded page.
 */
async function fetchOnce(url: string, request: PageRequest): Promise<Page> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const answer = await send(current, request);
    const location = REDIRECT_STATUSES.has(answer.status) ? answer.location : undefined;
    if (location === undefined) return readPage({ ...answer, url: current }, request);
    await answer.cancel();
    current = nextHop(location, current);
  }
  throw new UnreadablePageError(`${sanitizeUrl(url)} redirects more than ${MAX_REDIRECTS} times`);
}

/**
 * One GET whose connection only opens to an address the policy allows, checked when it connects.
 * @param url - What to fetch.
 * @param request - Signal and network policy.
 * @returns {Promise<Answer>} Status, headers and the body as chunks, decompressed.
 */
async function send(url: string, request: PageRequest): Promise<Answer> {
  const { hostname, protocol } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") throw new InvalidPageUrlError();
  const lookup = await lookupFor(hostname, request.allowPrivateNetwork);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal =
    request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);
  const { response, chunks } = await connect(url, { lookup, signal, accept: request.accept });
  return {
    status: response.statusCode ?? 0,
    location: response.headers.location,
    contentType: response.headers["content-type"]?.trim() ?? "",
    read: async () => {
      const next = await chunks.next();
      if (next.done === true) return { done: true };
      const value: unknown = next.value;
      if (value instanceof Uint8Array) return { done: false, value };
      return { done: false, value: new TextEncoder().encode(String(value)) };
    },
    cancel: async () => {
      response.destroy();
    },
  };
}

/**
 * Open the request on a fresh connection, never a pooled one the lookup would not vet, and the
 * body stream, decompressed when the server compressed it.
 * @param url - What to fetch.
 * @param how - The lookup that vets each address, cancellation with the timeout, and the
 * media types to ask for.
 * @returns {Promise<{ response: IncomingMessage; chunks: AsyncIterator<unknown> }>} The response
 * and its decoded body.
 */
async function connect(
  url: string,
  how: Readonly<{ lookup: LookupFunction; signal: Readonly<AbortSignal>; accept: string }>,
): Promise<{ response: IncomingMessage; chunks: AsyncIterator<unknown> }> {
  const { lookup, signal } = how;
  const [http, https, { pipeline }, zlib] = await Promise.all([
    import("node:http"),
    import("node:https"),
    import("node:stream"),
    import("node:zlib"),
  ]);
  const get = url.startsWith("https:") ? https.request : http.request;
  const headers = {
    Accept: how.accept,
    "Accept-Encoding": "gzip, deflate, br",
    "User-Agent": `agntn-web/${version}`,
  };
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = get(url, { headers, lookup, signal, agent: false }, resolve);
    outgoing.once("error", reject);
    outgoing.end();
  });
  const decoders: Readonly<Record<string, () => NodeJS.ReadWriteStream>> = {
    gzip: () => zlib.createGunzip(),
    "x-gzip": () => zlib.createGunzip(),
    deflate: () => zlib.createInflate(),
    br: () => zlib.createBrotliDecompress(),
  };
  const encoding = response.headers["content-encoding"]?.trim().toLowerCase() ?? "";
  const decoder = Object.hasOwn(decoders, encoding) ? decoders[encoding] : undefined;
  const body = decoder === undefined ? response : pipeline(response, decoder(), () => {});
  return { response, chunks: body[Symbol.asyncIterator]() };
}

function nextHop(location: string, current: string): string {
  if (!URL.canParse(location, current)) {
    throw new UnreadablePageError(`${sanitizeUrl(current)} redirects to an invalid URL`);
  }
  return new URL(location, current).href;
}

/**
 * Read the body of a final response, or turn an error status into an {@link HTTPError}.
 * @param response - The response.
 * @param request - The byte limit.
 * @returns {Promise<Page>} The decoded page.
 */
async function readPage(response: Received, request: PageRequest): Promise<Page> {
  if (response.status < 200 || response.status > 299) {
    const body = await readText(response, ERROR_BODY_BYTES);
    throw new HTTPError(response.status, sanitizeUrl(response.url), errorSummary(body.text));
  }
  const kind = pageKind(response.contentType);
  if (kind === undefined) {
    await response.cancel();
    throw new UnreadablePageError(
      `${sanitizeUrl(response.url)} is ${clip(response.contentType, 100)}, not a page reveal can read: it reads HTML and text`,
    );
  }
  const body = await readText(response, request.maxBytes);
  const markup = kind === "markup" || (kind === "sniff" && MARKUP_START.test(body.text));
  if (kind === "sniff" && !markup && body.text.includes("\u0000")) {
    throw new UnreadablePageError(`${sanitizeUrl(response.url)} sends binary data, not a page`);
  }
  return { url: response.url, contentType: response.contentType, ...body, markup };
}

/**
 * Read at most `maxBytes` and decode them with the charset the header or the page names.
 * @param response - The response.
 * @param maxBytes - Most bytes to read.
 * @returns {Promise<{ text: string; bytes: number; partial: boolean }>} The text, how many bytes
 * it came from, and whether the body went on past them.
 */
async function readText(
  response: Received,
  maxBytes: number,
): Promise<{ text: string; bytes: number; partial: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let partial = false;
  for (;;) {
    const chunk = await response.read();
    if (chunk.done) break;
    const room = maxBytes - total;
    chunks.push(chunk.value.subarray(0, room));
    total += Math.min(chunk.value.length, room);
    if (chunk.value.length > room) {
      partial = true;
      break;
    }
  }
  if (partial) await response.cancel();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, SNIFF_BYTES));
  return {
    text: decoder(charsetOf(response.contentType, head)).decode(bytes),
    bytes: total,
    partial,
  };
}

/**
 * The charset from the header, then a `<meta>` in the first kilobyte, else UTF-8.
 * @param contentType - The Content-Type header.
 * @param head - The start of the body, read as single bytes.
 * @returns {string} A charset label.
 */
function charsetOf(contentType: string, head: string): string {
  const declared = CHARSET.exec(contentType)?.groups?.label;
  if (declared !== undefined) return declared;
  const meta = /<meta[^>]+charset\s*=\s*["']?(?<label>[\w.:-]+)/iu.exec(head)?.groups?.label;
  return meta ?? "utf-8";
}

function decoder(label: string): TextDecoder {
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder("utf-8");
  }
}

/**
 * How to read a page by its media type: as markup, as text, or by looking at its first bytes.
 * @param contentType - The Content-Type header.
 * @returns {"markup" | "text" | "sniff" | undefined} The way, or undefined for an image, audio,
 * video, archive or other binary type.
 */
function pageKind(contentType: string): "markup" | "text" | "sniff" | undefined {
  const media = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (media === "" || media === "application/octet-stream") return "sniff";
  if (MARKUP_TYPE.test(media)) return "markup";
  return TEXT_TYPE.test(media) ? "text" : undefined;
}

/**
 * What an error page says, in one line: its title, or the start of its text.
 * @param body - The error body.
 * @returns {string} A short summary, empty when the body says nothing.
 */
function errorSummary(body: string): string {
  const title = TITLE.exec(body)?.groups?.title?.trim();
  return clip(title !== undefined && title !== "" ? title : body.trim(), 200);
}

/**
 * A lookup that refuses private addresses as the request connects, so DNS rebinding gets nowhere.
 * Node never looks up an IP literal, so that one is checked here.
 * @param hostname - The URL's host, IPv6 in brackets.
 * @param allowPrivateNetwork - Skip the address check.
 * @returns {Promise<LookupFunction>} The lookup to pass to the request.
 */
async function lookupFor(hostname: string, allowPrivateNetwork: boolean): Promise<LookupFunction> {
  const [{ isIP }, { lookup }, ranges] = await Promise.all([
    import("node:net"),
    import("node:dns/promises"),
    privateRanges(),
  ]);
  const literal = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  const isPrivate = (address: string) =>
    !allowPrivateNetwork && ranges.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
  if (isIP(literal) !== 0 && isPrivate(literal)) throw new PrivateAddressError(hostname, literal);
  return (name, options, callback) => {
    lookup(name, { family: options.family, hints: options.hints, all: true, verbatim: true }).then(
      (addresses) => {
        const refused = addresses.find(({ address }) => isPrivate(address));
        if (refused !== undefined) {
          callback(new PrivateAddressError(name, refused.address), "", 0);
        } else if (options.all === true) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0]?.address ?? "", addresses[0]?.family ?? 4);
        }
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), "", 0);
      },
    );
  };
}

/**
 * The private ranges, built on first use; `::ffff:127.0.0.1` matches the IPv4 ones.
 * @returns {Promise<BlockList>} The shared list.
 */
async function privateRanges(): Promise<BlockList> {
  if (privateNetworks !== undefined) return privateNetworks;
  const { BlockList: Ranges } = await import("node:net");
  const ranges = new Ranges();
  for (const [network, prefix, family] of PRIVATE_RANGES) ranges.addSubnet(network, prefix, family);
  privateNetworks = ranges;
  return ranges;
}

/**
 * A web error stays; anything else is a transport failure, status 0 like the HTTP client.
 * @param error - What the request threw.
 * @param url - The URL it went to.
 * @returns {Error} The error to retry or throw.
 */
function transportError(error: unknown, url: string): Error {
  if (error instanceof WebError) return error;
  const cause =
    error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
  const message = error instanceof Error ? `${error.message}${cause}` : String(error);
  return new HTTPError(0, sanitizeUrl(url), message, { cause: error });
}

/**
 * A gateway error or a dropped connection may pass; a timeout already spent the wait.
 * @param error - What the try threw.
 * @returns {boolean} Whether one more try makes sense.
 */
function retryable(error: unknown): boolean {
  if (error instanceof HTTPError) return RETRY_STATUSES.has(error.statusCode);
  return error instanceof Error && "code" in error && RETRY_CODES.has(String(error.code));
}

function abortableDelay(
  milliseconds: number,
  signal: Readonly<AbortSignal> | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    function done(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort(): void {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
    }
  });
}
