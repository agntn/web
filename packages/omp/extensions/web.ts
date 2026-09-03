import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { ReadOptions, SearchRequestOptions } from "../../../src/index.ts";

import {
  createViewportText,
  type RenderedToolResult,
  type RenderOptions,
  renderWebToolCall,
  renderWebToolResult,
  type StatusTheme,
  type WebToolName,
} from "../../../src/tui.ts";

type WebModule = typeof import("../../../src/index.ts");

const sourceModuleUrl = new URL("../../../src/index.ts", import.meta.url);
const distributionModuleUrl = new URL("../../../dist/index.mjs", import.meta.url);
let webModulePromise: Promise<WebModule> | undefined;

/** Load checkout source during development and the built package after publication.
 * @returns {Promise<WebModule>} Cached live web module.
 */
function loadWeb(): Promise<WebModule> {
  const moduleUrl = existsSync(fileURLToPath(sourceModuleUrl))
    ? sourceModuleUrl.href
    : distributionModuleUrl.href;
  webModulePromise ??= import(moduleUrl) as Promise<WebModule>;
  return webModulePromise;
}

const MAX_RESULTS = 20;
const MAX_BATCH_ITEMS = 10;

function toolResult<T>(details: T): AgentToolResult<T> {
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

export default function webOmpExtension(pi: ExtensionAPI): void {
  const { Type } = pi.typebox;
  const renderers = (name: WebToolName) => ({
    renderCall(args: unknown, options: Readonly<RenderOptions>, theme: Readonly<StatusTheme>) {
      return createViewportText((width) =>
        renderWebToolCall(name, args, { ...options, viewportWidth: width }, theme),
      );
    },
    renderResult(
      result: Readonly<RenderedToolResult>,
      options: Readonly<RenderOptions>,
      theme: Readonly<StatusTheme>,
    ) {
      return createViewportText((width) =>
        renderWebToolResult(
          name,
          result,
          result.isError === true,
          { ...options, viewportWidth: width },
          theme,
        ),
      );
    },
  });

  pi.setLabel("Web");

  const searchParameters = Type.Object({
    query: Type.Union(
      [Type.String(), Type.Array(Type.String(), { minItems: 1, maxItems: MAX_BATCH_ITEMS })],
      { description: "Search query, or a batch of search queries." },
    ),
    provider: Type.Optional(
      Type.String({
        description:
          'Provider to use. "auto" (or omit) tries configured providers in order after payment, rate limit, timeout, or server failures. Use "all" to query every configured provider in parallel. Registered custom providers are validated at execution time.',
      }),
    ),
    maxResults: Type.Optional(
      Type.Integer({
        description: "Maximum results to return. Defaults to 10.",
        minimum: 1,
        maximum: MAX_RESULTS,
      }),
    ),
    highlights: Type.Optional(
      Type.Boolean({
        description: "Return passages relevant to the query when supported. Defaults to true.",
      }),
    ),
    summary: Type.Optional(
      Type.Boolean({
        description: "Request generated summaries or answers when supported. Defaults to false.",
      }),
    ),
    fullText: Type.Optional(
      Type.Boolean({
        description: "Request full page text when supported. Defaults to false.",
      }),
    ),
    includeDomains: Type.Optional(
      Type.Array(Type.String(), { description: "Only return results from these domains." }),
    ),
    excludeDomains: Type.Optional(
      Type.Array(Type.String(), { description: "Exclude results from these domains." }),
    ),
    sources: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Source types when supported, such as "web", "news", or "images".',
      }),
    ),
    categories: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Category filters when supported, such as "research", "pdf", or "developer".',
      }),
    ),
    category: Type.Optional(
      Type.String({ description: 'Single search category, such as "news" or "general".' }),
    ),
    startPublishedDate: Type.Optional(
      Type.String({ description: "Only return results published after this ISO date." }),
    ),
    endPublishedDate: Type.Optional(
      Type.String({ description: "Only return results published before this ISO date." }),
    ),
  });

  const imageSearchParameters = Type.Object({
    url: Type.String({ description: "Public HTTP or HTTPS image URL." }),
    provider: Type.Optional(
      Type.String({
        description:
          "Reverse image search provider. Defaults to SerpAPI Google Lens. Registered providers are validated against web.searchImageProviders() at execution time.",
      }),
    ),
    maxResults: Type.Optional(
      Type.Integer({
        description: "Maximum matches to return. Defaults to 10.",
        minimum: 1,
        maximum: MAX_RESULTS,
      }),
    ),
  });

  const readParameters = Type.Object({
    url: Type.Union(
      [Type.String(), Type.Array(Type.String(), { minItems: 1, maxItems: MAX_BATCH_ITEMS })],
      { description: "URL to read, or a batch of URLs." },
    ),
    provider: Type.Optional(
      Type.String({
        description:
          'Read provider to use. "auto" (or omit) starts with Jina and falls back after eligible payment, conflict, rate limit, timeout, or server failures. Registered providers are validated against web.readProviders() at execution time.',
      }),
    ),
    format: Type.Optional(
      Type.String({ description: 'Preferred content format: "markdown", "text", or "html".' }),
    ),
    maxTokens: Type.Optional(
      Type.Integer({ description: "Maximum tokens to return when supported.", minimum: 1 }),
    ),
    targetSelector: Type.Optional(
      Type.String({ description: "CSS selector to target when supported." }),
    ),
    removeSelector: Type.Optional(
      Type.String({ description: "CSS selector to remove when supported." }),
    ),
    timeout: Type.Optional(
      Type.Integer({ description: "Provider timeout in seconds when supported.", minimum: 1 }),
    ),
    noCache: Type.Optional(Type.Boolean({ description: "Bypass provider cache when supported." })),
  });

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search one query or an independent batch through a selected provider, automatic fallback, or every configured provider.",
    parameters: searchParameters,
    approval: "read",
    ...renderers("web_search"),
    async execute(_toolCallId, params) {
      const web = await loadWeb();
      const provider = normalizeSearchProvider(params.provider, web.searchProviders());
      const options: SearchRequestOptions = {
        maxResults: params.maxResults,
        highlights: params.highlights,
        summary: params.summary,
        fullText: params.fullText,
        includeDomains: params.includeDomains,
        excludeDomains: params.excludeDomains,
        sources: params.sources,
        categories: params.categories,
        category: params.category,
        startPublishedDate: params.startPublishedDate,
        endPublishedDate: params.endPublishedDate,
      };

      if (Array.isArray(params.query)) {
        const outcomes = await web.searchBatch(params.query, { provider, ...options });
        return toolResult({ mode: "batch" as const, provider, outcomes });
      }
      const query = params.query.trim();
      if (!query) throw new web.EmptyQueryError();
      if (provider === "all") {
        const response = await web.searchAllDetailed(query, options);
        return toolResult({
          mode: "all" as const,
          count: response.results.length,
          ...response,
          errors: response.errors.map(({ provider: failedProvider, error }) => ({
            provider: failedProvider,
            error: error.message,
          })),
        });
      }
      if (provider !== undefined) {
        const response = await web.searchProviderDetailed(provider, query, options);
        return toolResult({
          ...response,
          mode: "single" as const,
          provider,
          count: response.results.length,
        });
      }
      const response = await web.searchWithFallback(query, options);
      return toolResult({
        ...response,
        mode: "single" as const,
        provider: response.provider,
        count: response.results.length,
      });
    },
  });

  pi.registerTool({
    name: "web_search_image",
    label: "Search by Image",
    description:
      "Find public pages containing or resembling an image URL, with page and image matches.",
    parameters: imageSearchParameters,
    approval: "read",
    ...renderers("web_search_image"),
    async execute(_toolCallId, params) {
      const web = await loadWeb();
      const provider = normalizeImageProvider(params.provider, web.searchImageProviders());
      const url = params.url.trim();
      if (!url) throw new web.EmptyImageUrlError();
      const results = await web.searchByImage(url, {
        provider,
        maxResults: params.maxResults,
      });
      return toolResult({ url, provider, maxResults: params.maxResults, results });
    },
  });

  pi.registerTool({
    name: "web_read",
    label: "Web Read",
    description:
      "Read one URL or an independent batch into normalized content, with automatic reader fallback.",
    parameters: readParameters,
    approval: "read",
    ...renderers("web_read"),
    async execute(_toolCallId, params) {
      const web = await loadWeb();
      const provider = normalizeReadProvider(params.provider, web.readProviders());
      const providerLabel = provider ?? "auto";
      const options = {
        provider,
        format: normalizeReadFormat(params.format),
        maxTokens: params.maxTokens,
        targetSelector: params.targetSelector,
        removeSelector: params.removeSelector,
        timeout: params.timeout,
        noCache: params.noCache,
      };
      if (Array.isArray(params.url)) {
        const outcomes = await web.readBatchDetailed(params.url, options);
        return toolResult({ mode: "batch" as const, provider: providerLabel, outcomes });
      }
      const url = params.url.trim();
      if (!url) throw new TypeError("URL cannot be empty");
      const response = await web.readUrlDetailed(url, options);
      return toolResult({
        mode: "read" as const,
        url,
        provider: providerLabel,
        effectiveProvider: response.provider,
        attempts: response.attempts,
        failures: response.failures,
        result: response.result,
      });
    },
  });

  pi.registerTool({
    name: "web_providers",
    label: "Web Providers",
    description:
      "Show the running web build and each provider's configuration, reachability, operations, read options, result limits, and rich search fields.",
    parameters: Type.Object({}),
    approval: "read",
    ...renderers("web_providers"),
    async execute() {
      const web = await loadWeb();
      return toolResult({ runtime: web.runtimeInfo, providers: await web.listProvidersAsync() });
    },
  });
}

function normalizeSearchProvider(
  value: string | undefined,
  providers: readonly string[],
): string | undefined {
  if (value === undefined || value === "auto") return undefined;
  if (value === "all") return value;
  const provider = providers.find((candidate) => candidate === value);
  if (!provider) throw new TypeError(`Unknown search provider: ${value}`);
  return provider;
}

function normalizeImageProvider(value: string | undefined, providers: readonly string[]): string {
  const selected = value ?? providers[0];
  const provider = providers.find((candidate) => candidate === selected);
  if (!provider) throw new TypeError(`Unknown image search provider: ${selected ?? "none"}`);
  return provider;
}

function normalizeReadFormat(value: string | undefined): ReadOptions["format"] {
  if (value === undefined || value === "") return undefined;
  if (value === "markdown" || value === "text" || value === "html") return value;
  throw new TypeError(`Unknown read format: ${value}`);
}

function normalizeReadProvider(
  value: string | undefined,
  providers: readonly string[],
): string | undefined {
  if (value === undefined || value === "auto") return undefined;
  const provider = providers.find((candidate) => candidate === value);
  if (!provider) throw new TypeError(`Unknown read provider: ${value}`);
  return provider;
}
