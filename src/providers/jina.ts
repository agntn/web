import type {
  SearchResult,
  SearchRequestOptions,
  ReadResult,
  ReadOptions,
  ProviderConfig,
} from "../core/types.ts";
import { Provider, assertProviderBaseURL } from "../core/provider.ts";
import { AuthError, HTTPError, normalizeError } from "../core/errors.ts";
import { register } from "../core/registry.ts";

interface JinaResult {
  readonly title?: string;
  readonly description?: string;
  readonly url: string;
  readonly content?: string;
  readonly text?: string;
  readonly html?: string;
  readonly publishedTime?: string;
  readonly links?: readonly string[] | Readonly<Record<string, string>> | null;
  readonly images?: readonly string[] | Readonly<Record<string, string>> | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  readonly warning?: string;
  readonly screenshotUrl?: string;
  readonly pageshotUrl?: string;
}

interface JinaEnvelope {
  readonly code?: number;
  readonly status?: number;
  readonly message?: string;
  readonly error?: string;
  readonly detail?: unknown;
  readonly meta?: Readonly<Record<string, unknown>>;
}

interface JinaSearchResponse extends JinaEnvelope {
  readonly data?: readonly JinaResult[] | null;
}

interface JinaReadResponse extends JinaEnvelope {
  readonly data?: JinaResult | null;
}

const JINA_MAX_RESULTS = 20;

class JinaProvider extends Provider {
  static readonly providerName = "jina";
  static readonly defaultBaseURL = "https://s.jina.ai";

  private readonly searchBaseURL: string;
  private readonly readBaseURL: string;
  private readonly apiKey?: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config, JinaProvider);
    this.searchBaseURL = this.baseURL;
    this.readBaseURL = (config.readBaseURL ?? deriveReadBaseURL(this.searchBaseURL)).replace(
      /\/+$/,
      "",
    );
    assertProviderBaseURL(this.readBaseURL, JinaProvider.providerName);
    this.apiKey = config.apiKey;
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    const apiKey = requireApiKey(this.apiKey);
    try {
      const url = `${this.searchBaseURL}/search?${searchParams(query, options)}`;
      const response = await this.client.getJSON<JinaSearchResponse>(url, {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      });
      assertJinaSuccess(response, url);
      return (response.data ?? []).map(mapSearchResult);
    } catch (error) {
      throw normalizeError(error, "jina");
    }
  }

  async read(url: string, options?: Readonly<ReadOptions>): Promise<ReadResult> {
    try {
      const requestUrl = `${this.readBaseURL}/${encodeURIComponent(url)}`;
      const response = await this.client.getJSON<JinaReadResponse>(
        requestUrl,
        readHeaders(this.apiKey, options),
      );
      assertJinaSuccess(response, requestUrl);
      return mapReadResult(response.data ?? { url, content: "" });
    } catch (error) {
      throw normalizeError(error, "jina");
    }
  }
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey) return apiKey;
  throw new AuthError("Missing API key for Jina. Set JINA_API_KEY", "jina");
}

function searchParams(query: string, options?: SearchRequestOptions): string {
  const params = new URLSearchParams({
    q: query,
    count: String(clampMaxResults(options?.maxResults ?? 10)),
  });
  if (isJinaSearchType(options?.category)) params.set("type", options.category);
  for (const domain of options?.includeDomains ?? []) params.append("site", domain);
  return params.toString();
}

function deriveReadBaseURL(searchBaseURL: string): string {
  const match = searchBaseURL.match(/^(https?:\/\/)(.+\.)?s\.jina\.ai$/);
  if (!match) return searchBaseURL;
  return `${match[1]}${match[2] ?? ""}r.jina.ai`;
}

function readHeaders(
  apiKey: string | undefined,
  options: Readonly<ReadOptions> | undefined,
): Record<string, string> {
  return {
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...readOptionHeaders(options),
  };
}

function readOptionHeaders(options: Readonly<ReadOptions> | undefined): Record<string, string> {
  if (!options) return {};
  return { ...readContentHeaders(options), ...readControlHeaders(options) };
}

function readContentHeaders(options: Readonly<ReadOptions>): Record<string, string> {
  return {
    ...(options.format ? { "X-Return-Format": options.format } : {}),
    ...(options.maxTokens === undefined ? {} : { "X-Token-Budget": String(options.maxTokens) }),
    ...(options.targetSelector ? { "X-Target-Selector": options.targetSelector } : {}),
  };
}

function readControlHeaders(options: Readonly<ReadOptions>): Record<string, string> {
  return {
    ...(options.removeSelector ? { "X-Remove-Selector": options.removeSelector } : {}),
    ...(options.timeout === undefined ? {} : { "X-Timeout": String(options.timeout) }),
    ...(options.noCache ? { "X-No-Cache": "true" } : {}),
  };
}

function clampMaxResults(maxResults: number): number {
  return Math.min(Math.max(maxResults, 1), JINA_MAX_RESULTS);
}

function isJinaSearchType(category: string | undefined): category is "web" | "images" | "news" {
  return category === "web" || category === "images" || category === "news";
}

function mapSearchResult(result: Readonly<JinaResult>): SearchResult {
  return {
    url: result.url,
    title: result.title ?? "",
    snippet: result.description ?? snippetFrom(result.content) ?? snippetFrom(result.text) ?? "",
    publishedDate: result.publishedTime,
    text: result.content ?? result.text,
    image: firstImage(result.images),
    metadata: resultMetadata(result),
  };
}

function mapReadResult(result: Readonly<JinaResult>): ReadResult {
  return {
    url: result.url,
    title: result.title,
    description: result.description,
    content: result.content ?? result.text ?? result.html ?? "",
    text: result.text,
    html: result.html,
    publishedDate: result.publishedTime,
    image: firstImage(result.images),
    links: stringValues(result.links),
    images: stringValues(result.images),
    metadata: resultMetadata(result),
  };
}

function snippetFrom(text: string | undefined): string | undefined {
  return text ? text.slice(0, 200) : undefined;
}

function firstImage(
  images: readonly string[] | Readonly<Record<string, string>> | null | undefined,
): string | undefined {
  return stringValues(images)?.[0];
}

function stringValues(
  value: readonly string[] | Readonly<Record<string, string>> | null | undefined,
): string[] | undefined {
  const values = Array.isArray(value) ? value : value ? Object.values(value) : [];
  const strings = values.filter(isNonEmptyString);
  return strings.length > 0 ? strings : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function assertJinaSuccess(response: Readonly<JinaEnvelope>, url: string): void {
  const code = response.code;
  const status = response.status;
  if ((code !== undefined && code >= 400) || (status !== undefined && status >= 40000)) {
    const statusCode =
      code !== undefined && code >= 400 ? code : Math.floor((status ?? 50000) / 100);
    throw new HTTPError(statusCode, url, jinaErrorMessage(response));
  }
}

function jinaErrorMessage(response: Readonly<JinaEnvelope>): string {
  if (response.message) return response.message;
  if (response.error) return response.error;
  if (response.detail !== undefined) return JSON.stringify(response.detail);
  return `Jina API error: code=${response.code ?? "unknown"} status=${response.status ?? "unknown"}`;
}

function resultMetadata(result: Readonly<JinaResult>): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = result.metadata ? { ...result.metadata } : {};

  if (result.warning) metadata.warning = result.warning;
  if (result.screenshotUrl) metadata.screenshotUrl = result.screenshotUrl;
  if (result.pageshotUrl) metadata.pageshotUrl = result.pageshotUrl;

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

register(JinaProvider);
