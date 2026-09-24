import { z } from "zod";
import { Client } from "../core/client.ts";
import {
  AuthError,
  EmptyQueryError,
  HTTPError,
  RateLimitError,
  normalizeError,
} from "../core/errors.ts";
import { operationSignal } from "../core/execution.ts";
import {
  codexAuthSource,
  environmentCodexCredentials,
  hasEnvironmentCodexCredentials,
  nativeCodexCredentials,
  resolveCodexCredentials,
  type ResolvedCodexCredentials,
} from "../core/codex-auth.ts";
import { Provider } from "../core/provider.ts";
import { OPENAI_CODEX_MAX_RESULTS } from "../core/providers.ts";
import type {
  CodexCredentials,
  CodexCredentialProvider,
  ProviderConfig,
  SearchRequestOptions,
  SearchResponse,
  SearchResult,
} from "../core/types.ts";

const BASE_URL = "https://chatgpt.com/backend-api";
const ENDPOINT = `${BASE_URL}/codex/responses`;
const DEFAULT_MODEL = "gpt-5.5";
const TIMEOUT_MS = 90_000;
const INSTRUCTIONS =
  "Search the web to answer the user's query. Cite your sources and keep the answer concise.";

const sourceSchema = z
  .object({
    url: z.string().nullish(),
    source_website_url: z.string().nullish(),
    title: z.string().nullish(),
    caption: z.string().nullish(),
  })
  .readonly();
const annotationSchema = z
  .object({ type: z.string(), url: z.string().nullish(), title: z.string().nullish() })
  .readonly();
const itemSchema = z
  .object({
    type: z.string(),
    status: z.string().optional(),
    action: z
      .object({ sources: z.array(sourceSchema).readonly().optional() })
      .readonly()
      .optional(),
    sources: z.array(sourceSchema).readonly().optional(),
    results: z.array(sourceSchema).readonly().optional(),
    content: z
      .array(
        z
          .object({
            type: z.string(),
            text: z.string().optional(),
            annotations: z.array(annotationSchema).readonly().optional(),
          })
          .readonly(),
      )
      .readonly()
      .optional(),
  })
  .readonly();
const eventSchema = z
  .object({
    type: z.string(),
    item: itemSchema.optional(),
    response: z
      .object({
        id: z.string().optional(),
        model: z.string().optional(),
        status: z.string().optional(),
        output: z.array(itemSchema).readonly().optional(),
        error: z.unknown().optional(),
        usage: z
          .object({
            input_tokens: z.number().nonnegative().optional(),
            output_tokens: z.number().nonnegative().optional(),
            total_tokens: z.number().nonnegative().optional(),
          })
          .readonly()
          .nullish(),
      })
      .readonly()
      .optional(),
    code: z.string().optional(),
    message: z.string().optional(),
    error: z.unknown().optional(),
  })
  .readonly();

type CodexItem = z.infer<typeof itemSchema>;
type CodexEvent = z.infer<typeof eventSchema>;

export class OpenAICodexProvider extends Provider {
  static readonly providerName = "openai-codex";
  static readonly defaultBaseURL = BASE_URL;

  readonly #credentials: CodexCredentials | CodexCredentialProvider;
  readonly #model: string;
  readonly #streamClient = new Client({ maxRetries: 0, timeout: TIMEOUT_MS });

  constructor(config: Readonly<ProviderConfig>) {
    super(config, OpenAICodexProvider);
    if (this.baseURL !== BASE_URL) {
      throw new AuthError(
        "Codex OAuth credentials may only use the official ChatGPT endpoint",
        "openai-codex",
      );
    }
    const credentials = configuredCredentials(config);
    this.#credentials =
      typeof credentials === "function" ? credentials : resolveCodexCredentials(credentials);
    this.#model = configuredModel(config);
    if (!this.#model.trim()) throw new TypeError("Codex model must not be empty");
  }

  async search(query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
    return (await this.searchDetailed(query, options)).results;
  }

  async searchDetailed(query: string, options?: SearchRequestOptions): Promise<SearchResponse> {
    const callerSignal = operationSignal(options);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException("Codex search timed out", "TimeoutError")),
      TIMEOUT_MS,
    );
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, controller.signal])
      : controller.signal;
    try {
      signal.throwIfAborted();
      if (!query.trim()) throw new EmptyQueryError();
      const maxResults = resultLimit(options);
      const summary = options?.summary === true;
      const credentials = await this.resolveCredentials(false, signal);
      try {
        return await this.runSearch(query, credentials, maxResults, summary, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (!this.canRefresh(error)) throw error;
        const refreshed = await this.resolveCredentials(true, signal);
        if (
          refreshed.accessToken === credentials.accessToken &&
          refreshed.accountId === credentials.accountId
        ) {
          throw new AuthError(
            "Codex login was rejected and the credential resolver returned the same bearer and account. Sign in again with the owning client.",
            "openai-codex",
          );
        }
        return await this.runSearch(query, refreshed, maxResults, summary, signal);
      }
    } catch (error) {
      signal.throwIfAborted();
      throw normalizeError(error, "openai-codex");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private canRefresh(error: unknown): boolean {
    return typeof this.#credentials === "function" && error instanceof AuthError;
  }

  private async resolveCredentials(
    refresh: boolean,
    signal: Readonly<AbortSignal>,
  ): Promise<ResolvedCodexCredentials> {
    signal.throwIfAborted();
    if (typeof this.#credentials !== "function") return resolveCodexCredentials(this.#credentials);
    try {
      return resolveCodexCredentials(await awaitCredentials(this.#credentials, refresh, signal));
    } catch {
      signal.throwIfAborted();
      throw new AuthError(
        "Codex credential provider failed; check your login or refresh handler",
        "openai-codex",
      );
    }
  }

  private async runSearch(
    query: string,
    credentials: ResolvedCodexCredentials,
    maxResults: number,
    summary: boolean,
    signal: Readonly<AbortSignal>,
  ): Promise<SearchResponse> {
    const events = this.#streamClient.postSSE(
      ENDPOINT,
      {
        model: this.#model,
        stream: true,
        store: false,
        include: ["web_search_call.action.sources"],
        instructions: INSTRUCTIONS,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: query }] }],
        tools: [{ type: "web_search", search_context_size: "high" }],
        tool_choice: { type: "web_search" },
      },
      {
        Authorization: `Bearer ${credentials.accessToken}`,
        "chatgpt-account-id": credentials.accountId,
        "OpenAI-Beta": "responses=experimental",
        originator: "agntn-web",
      },
      signal,
    );
    try {
      return await collectSearch(events, this.#model, maxResults, summary);
    } catch (error) {
      signal.throwIfAborted();
      throw normalizeError(error, "openai-codex");
    }
  }
}

function configuredCredentials(
  config: Readonly<ProviderConfig>,
): CodexCredentials | CodexCredentialProvider {
  if (config.codex?.credentials !== undefined) return config.codex.credentials;
  if (config.apiKey || hasEnvironmentCodexCredentials())
    return environmentCodexCredentials(config.apiKey);
  return nativeCodexCredentials(codexAuthSource(config.codex?.authSource));
}

/**
 * Stop waiting even if the caller's credential callback ignores cancellation.
 * @param provider - Credential owner.
 * @param refresh - Whether to replace rejected credentials.
 * @param signal - Search cancellation.
 * @returns {Promise<CodexCredentials>} Credentials for this attempt.
 */
function awaitCredentials(
  provider: CodexCredentialProvider,
  refresh: boolean,
  signal: Readonly<AbortSignal>,
): Promise<CodexCredentials> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return provider({ refresh, signal });
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function configuredModel(config: Readonly<ProviderConfig>): string {
  return config.codex?.model ?? (process.env.OPENAI_CODEX_MODEL?.trim() || DEFAULT_MODEL);
}

function resultLimit(options?: SearchRequestOptions): number {
  const limit = options?.maxResults ?? 10;
  if (!Number.isInteger(limit) || limit < 1)
    throw new TypeError("maxResults must be a positive integer");
  return Math.min(limit, OPENAI_CODEX_MAX_RESULTS);
}

async function collectSearch(
  events: Readonly<AsyncIterable<unknown>>,
  requestedModel: string,
  maxResults: number,
  summary: boolean,
): Promise<SearchResponse> {
  const collector = new SearchCollector(summary);
  for await (const rawEvent of events) {
    const parsed = eventSchema.safeParse(rawEvent);
    if (!parsed.success) throw protocolError("Malformed Codex event");
    if (collector.consume(parsed.data)) {
      return collector.result(parsed.data.response, requestedModel, maxResults);
    }
  }
  throw protocolError("Codex stream ended before completion");
}

class SearchCollector {
  readonly #results = new Map<string, SearchResult>();
  readonly #answer = new Set<string>();
  readonly #summary: boolean;
  #searched = false;

  constructor(summary: boolean) {
    this.#summary = summary;
  }

  consume(event: CodexEvent): boolean {
    if (event.type === "error" || event.type === "response.failed") throw eventError(event);
    if (event.type === "response.incomplete") throw protocolError("Codex response incomplete");
    if (event.type === "response.web_search_call.completed") this.#searched = true;
    if (event.type === "response.output_item.done" && event.item) this.collectItem(event.item);
    return event.type === "response.completed" || event.type === "response.done";
  }

  result(
    response: CodexEvent["response"],
    requestedModel: string,
    maxResults: number,
  ): SearchResponse {
    if (!response || incompleteStatus(response.status) || response.error) {
      throw protocolError("Codex response did not complete");
    }
    for (const item of response.output ?? []) this.collectItem(item);
    if (!this.#searched) throw protocolError("Codex answered without running web search");
    const metadata = responseMetadata(response, requestedModel);
    if (this.#summary && this.#answer.size > 0) metadata.answer = [...this.#answer].join("\n\n");
    return { results: [...this.#results.values()].slice(0, maxResults), metadata };
  }

  private collectItem(item: CodexItem): void {
    if (item.type === "web_search_call") this.collectSources(item);
    if (item.type === "message") this.collectMessage(item);
  }

  private collectSources(item: CodexItem): void {
    if (incompleteStatus(item.status)) throw protocolError("Codex web search did not complete");
    this.#searched = true;
    for (const source of [
      ...(item.action?.sources ?? []),
      ...(item.sources ?? []),
      ...(item.results ?? []),
    ]) {
      this.addSource(source.url ?? source.source_website_url, source.title ?? source.caption);
    }
  }

  private collectMessage(item: CodexItem): void {
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      if (this.#summary && part.text) this.#answer.add(part.text);
      for (const annotation of part.annotations ?? []) {
        if (annotation.type === "url_citation") this.addSource(annotation.url, annotation.title);
      }
    }
  }

  /**
   * Only structured sources count, not URLs invented in prose.
   * @param sourceUrl - URL supplied by the hosted search tool or citation annotation.
   * @param title - Source title when provided.
   */
  private addSource(sourceUrl?: string | null, title?: string | null): void {
    const url = publicSourceUrl(sourceUrl);
    if (!url) return;
    const existing = this.#results.get(url);
    if (!existing || (existing.title === url && title)) {
      this.#results.set(url, { url, title: title || url, snippet: "" });
    }
  }
}

function incompleteStatus(status?: string): boolean {
  return status !== undefined && status !== "completed";
}

function publicSourceUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function responseMetadata(
  response: NonNullable<CodexEvent["response"]>,
  requestedModel: string,
): Record<string, unknown> {
  return {
    model: response.model || requestedModel,
    ...(response.id ? { requestId: response.id } : {}),
    ...(response.usage ? { usage: usageMetadata(response.usage) } : {}),
  };
}

function usageMetadata(
  usage: NonNullable<NonNullable<CodexEvent["response"]>["usage"]>,
): Record<string, number> {
  return {
    ...(usage.input_tokens === undefined ? {} : { inputTokens: usage.input_tokens }),
    ...(usage.output_tokens === undefined ? {} : { outputTokens: usage.output_tokens }),
    ...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }),
  };
}

function eventError(event: Readonly<CodexEvent>): Error {
  const errorSchema = z.object({ code: z.string().optional(), message: z.string().optional() });
  const parts = [event, event.error, event.response?.error].flatMap((value) => {
    const parsed = errorSchema.safeParse(value);
    return parsed.success ? [parsed.data.code ?? "", parsed.data.message ?? ""] : [];
  });
  const detail = parts.join(" ");
  if (/rate[-_ ]?limit|quota|too many requests|\b429\b/iu.test(detail))
    return new RateLimitError(60, "openai-codex");
  if (
    /unauthori[sz]ed|authentication[_ ]error|invalid[_ ](?:access[_ ])?(?:token|api[_ ]key)|(?:token[_ ]expired|expired[_ ]token)|\b401\b/iu.test(
      detail,
    )
  ) {
    return new AuthError("Codex authentication expired or was rejected", "openai-codex");
  }
  if (/forbidden|\b403\b/iu.test(detail))
    return new HTTPError(403, ENDPOINT, "Codex access denied");
  return protocolError("Codex request failed");
}

function protocolError(message: string): HTTPError {
  return new HTTPError(502, ENDPOINT, message);
}
