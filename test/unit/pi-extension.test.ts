import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import stringWidth from "string-width";
import { afterEach, describe, expect, it, vi } from "vitest";
import webExtension, { resolveWebModuleUrl } from "../../packages/pi/extensions/web.ts";
import {
  builtinProviders,
  Provider,
  register,
  type ProviderConfig,
  type SearchResult,
} from "../../src/index.ts";
import { resetDefaultClientForTests } from "../../src/core/client.ts";
import { providerApiKeyEnvVar } from "../../src/core/providers.ts";

const customProviderCleanups: Array<() => void> = [];
afterEach(() => {
  for (const unregister of customProviderCleanups.splice(0).reverse()) unregister();
});

type CapturedTool = Readonly<
  Pick<ToolDefinition, "name" | "label" | "parameters" | "execute" | "renderCall" | "renderResult">
>;
type CapturedCommand = Parameters<ExtensionAPI["registerCommand"]>[1];

describe("Pi extension", () => {
  it("loads and types against current source instead of a stale build", () => {
    expect(fileURLToPath(resolveWebModuleUrl())).toBe(
      fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
    );
    expect(
      readFileSync(new URL("../../packages/pi/extensions/web.ts", import.meta.url), "utf8"),
    ).not.toMatch(/(?:from|import\()\s*["']@agntn\/web["']/u);
  });

  it("registers reverse image search as a separate tool", () => {
    expect(captureTools().has("web_search_image")).toBe(true);
  });

  it("gives every tool a compact call and result renderer", () => {
    const tools = captureTools();

    for (const tool of tools.values()) {
      expect(tool.renderCall).toBeTypeOf("function");
      expect(tool.renderResult).toBeTypeOf("function");
    }

    const search = tools.get("web_search");
    if (!search?.renderCall || !search.renderResult) throw new Error("Missing search renderers");
    const theme = {};
    const call: unknown = Reflect.apply(search.renderCall, search, [
      {
        query: "terminal-safe search",
        provider: "exa",
        maxResults: 5,
        startPublishedDate: "2026-01-01",
      },
      theme,
      { executionStarted: true, isPartial: true },
    ]);
    const result: unknown = Reflect.apply(search.renderResult, search, [
      {
        content: [{ type: "text", text: "[provider=exa] 2 results" }],
        details: { mode: "single", provider: "exa", count: 2, results: [] },
      },
      { expanded: false, isPartial: false },
      theme,
      { isError: false },
    ]);

    expect(renderedText(call)).toBe("◌ ⌕ Web Search terminal-safe search exa · top 5 · 1 filter");
    expect(renderedText(result)).toBe("✓ found 2 results · exa");
  });

  it("renders Pi failures from the render context and strips terminal controls", () => {
    const read = captureTools().get("web_read");
    if (!read?.renderCall || !read.renderResult) throw new Error("Missing read renderers");
    const theme = {};
    const call: unknown = Reflect.apply(read.renderCall, read, [
      { url: `https://example.com/${"a".repeat(160)}\u001B]0;bad\u0007page`, provider: "auto" },
      theme,
      { executionStarted: false, isPartial: true },
    ]);
    const result: unknown = Reflect.apply(read.renderResult, read, [
      { content: [{ type: "text", text: "Provider failed\nforged line" }] },
      { expanded: false, isPartial: false },
      theme,
      { isError: true },
    ]);

    expect(renderedText(call)).not.toMatch(/\p{Cc}/u);
    expect(renderedText(call)).not.toContain("bad");
    expect(renderedText(call, 80).split("\n")).toHaveLength(1);
    expect(stringWidth(renderedText(call, 80))).toBeLessThanOrEqual(80);
    expect(renderedText(result)).toBe("✗ Provider failed");
  });

  it("advertises every built-in text search provider", () => {
    const searchTool = captureTools().get("web_search");
    if (!searchTool) throw new Error("web_search was not registered");

    const parameters = JSON.stringify(searchTool.parameters);
    for (const provider of builtinProviders) {
      expect(parameters).toContain(`, ${provider}`);
    }
  });

  it("executes reverse image search through the live SerpAPI provider", async () => {
    const previousKey = process.env.SERPAPI_API_KEY;
    process.env.SERPAPI_API_KEY = "test-key";
    const fetchMock = vi.fn(async (input: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : "";
      const requestUrl = new URL(url);
      expect(requestUrl.searchParams.get("engine")).toBe("google_lens");
      return new Response(
        JSON.stringify({
          search_metadata: { id: "lens-id", status: "Success" },
          visual_matches: [
            {
              position: 1,
              title: "Matching page",
              link: "https://example.com/page",
              image: "https://example.com/full.jpg",
              image_width: 1200,
              image_height: 900,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    resetDefaultClientForTests();

    try {
      const searchImageTool = captureTools().get("web_search_image");
      if (!searchImageTool) throw new Error("web_search_image was not registered");
      const execution: unknown = Reflect.apply(
        searchImageTool.execute.bind(searchImageTool),
        undefined,
        [
          "test-call",
          { url: "https://example.com/input.jpg", maxResults: 5 },
          undefined,
          undefined,
          undefined,
        ],
      );

      await expect(execution).resolves.toHaveProperty("details.provider", "serpapi");
      await expect(execution).resolves.toHaveProperty(
        "details.results.0.pageUrl",
        "https://example.com/page",
      );
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringContaining("[provider=serpapi]"),
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      if (previousKey === undefined) delete process.env.SERPAPI_API_KEY;
      else process.env.SERPAPI_API_KEY = previousKey;
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });

  it("passes Firecrawl search options through web_search", async () => {
    const previousKey = process.env.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_API_KEY = "test-key";
    const requestBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: unknown, init?: { readonly body?: string }) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== "https://api.firecrawl.dev/v2/search") {
        throw new Error(`Unexpected request: ${url}`);
      }
      const bodyText =
        input instanceof Request
          ? await input.clone().text()
          : typeof init?.body === "string"
            ? init.body
            : "";
      requestBodies.push(JSON.parse(bodyText) as unknown);
      return new Response(
        JSON.stringify({
          success: true,
          id: "pi-request",
          warning: "Partial\u202Ecoverage",
          creditsUsed: 2,
          data: { web: [] },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    resetDefaultClientForTests();

    try {
      const searchTool = captureTools().get("web_search");
      if (!searchTool) throw new Error("web_search was not registered");
      const execution: unknown = Reflect.apply(searchTool.execute.bind(searchTool), undefined, [
        "test-call",
        {
          query: "test query",
          provider: "firecrawl",
          highlights: false,
          sources: ["web", "news"],
          categories: ["developer"],
        },
        undefined,
        undefined,
        undefined,
      ]);

      await expect(execution).resolves.toHaveProperty("details.options.highlights", false);
      await expect(execution).resolves.toHaveProperty("details.metadata", {
        id: "pi-request",
        warning: "Partial\u202Ecoverage",
        creditsUsed: 2,
      });
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringContaining('Provider metadata: {"id":"pi-request"'),
      );
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.not.stringContaining("\u202E"),
      );
      expect(requestBodies).toEqual([
        expect.objectContaining({
          query: "test query",
          highlights: false,
          sources: ["web", "news"],
          categories: ["developer"],
        }),
      ]);
    } finally {
      if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = previousKey;
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });

  it("keeps rich search fields visible to the model without bloating the command selector", async () => {
    const previousKey = process.env.EXA_API_KEY;
    process.env.EXA_API_KEY = "test-key";
    const providerName = `richfixture${Math.random().toString(36).slice(2)}`;
    const longText = `Full page text ${"x".repeat(6_000)}`;
    const richResult = {
      url: "https://example.com/rich",
      title: "Rich\u001B]0;bad\u0007 result",
      snippet: `Long snippet ${"s".repeat(6_000)}`,
      score: 0.93,
      publishedDate: "2026-09-02T12:00:00Z",
      author: `Ada Example ${"a".repeat(6_000)}`,
      image: `https://example.com/image.png?${"i".repeat(6_000)}`,
      favicon: `https://example.com/favicon.ico?${"f".repeat(6_000)}`,
      text: longText,
      highlights: ["First highlight", `Second highlight ${"h".repeat(6_000)}`],
      summary: `Short provider summary ${"y".repeat(6_000)}`,
      metadata: { relevance: "high", payload: "m".repeat(6_000) },
    } satisfies SearchResult;
    class RichFixtureProvider extends Provider {
      static readonly providerName = providerName;
      static readonly defaultBaseURL = "https://fixture.example.com";

      constructor(config: Readonly<ProviderConfig>) {
        super(config, RichFixtureProvider);
      }

      async search(): Promise<SearchResult[]> {
        return [richResult];
      }
    }
    customProviderCleanups.push(register(RichFixtureProvider));

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== "https://api.exa.ai/search") throw new Error(`Unexpected request: ${url}`);
      return new Response(
        JSON.stringify({
          requestId: "rich-search",
          results: [{ id: "rich-result", ...richResult }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    resetDefaultClientForTests();

    try {
      const extension = captureExtension();
      const searchTool = extension.tools.get("web_search");
      const command = extension.commands.get("web");
      if (!searchTool || !command) throw new Error("Missing Pi search entrypoints");

      const execution: unknown = Reflect.apply(searchTool.execute.bind(searchTool), undefined, [
        "test-call",
        { query: "rich query", provider: providerName },
        undefined,
        undefined,
        undefined,
      ]);

      for (const field of [
        "Score: 0.93",
        "Published: 2026-09-02T12:00:00Z",
        "Author: Ada Example",
        "Image: https://example.com/image.png?",
        "Favicon: https://example.com/favicon.ico?",
        "Summary: Short provider summary",
        "Highlights: First highlight | Second highlight",
        'Metadata: {"relevance":"high","payload":"mmm',
        "Text: Full page text",
      ]) {
        await expect(execution).resolves.toHaveProperty(
          "content.0.text",
          expect.stringContaining(field),
        );
      }
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringMatching(
          new RegExp(`^\\[provider=${providerName}\\][^\\n]*\\n\\n[\\s\\S]{1,4000}$`),
        ),
      );
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.not.stringContaining("bad"),
      );
      await expect(execution).resolves.toHaveProperty("details.results.0.text", longText);

      const select = vi.fn(async () => undefined);
      await Reflect.apply(command.handler, undefined, [
        "rich query",
        {
          hasUI: true,
          ui: {
            input: vi.fn(),
            notify: vi.fn(),
            pasteToEditor: vi.fn(),
            select,
          },
        },
      ]);
      expect(select).toHaveBeenCalledWith("web (exa) - rich query", [
        expect.stringContaining("1. Rich result\n   https://example.com/rich - First highlight"),
      ]);
      expect(select).toHaveBeenCalledWith("web (exa) - rich query", [
        expect.not.stringContaining("Short provider summary"),
      ]);
      expect(select).toHaveBeenCalledWith("web (exa) - rich query", [
        expect.not.stringContaining("bad"),
      ]);
    } finally {
      if (previousKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previousKey;
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });

  it("accepts registered custom providers for each implemented capability", async () => {
    const providerName = `liveprovider${Math.random().toString(36).slice(2)}`;
    class LiveProvider extends Provider {
      static readonly providerName = providerName;
      static readonly defaultBaseURL = "https://live.example.com";

      constructor(config: Readonly<ProviderConfig>) {
        super(config, LiveProvider);
      }

      async search(): Promise<SearchResult[]> {
        return [{ url: "https://example.com", title: "Custom", snippet: "Search result" }];
      }

      async searchByImage() {
        return [
          {
            pageUrl: "https://example.com/page",
            imageUrl: "https://example.com/image.jpg",
            title: "Custom image",
            provider: providerName,
          },
        ];
      }

      async read(url: string) {
        return { url, content: "Custom page" };
      }
    }
    customProviderCleanups.push(register(LiveProvider));
    const tools = captureTools();
    const searchTool = tools.get("web_search");
    const imageTool = tools.get("web_search_image");
    const readTool = tools.get("web_read");
    if (!searchTool || !imageTool || !readTool) throw new Error("Missing web tools");

    const searchResult: unknown = Reflect.apply(searchTool.execute.bind(searchTool), undefined, [
      "search-call",
      { query: "custom query", provider: providerName },
      undefined,
      undefined,
      undefined,
    ]);
    const imageResult: unknown = Reflect.apply(imageTool.execute.bind(imageTool), undefined, [
      "image-call",
      { url: "https://example.com/input.jpg", provider: providerName },
      undefined,
      undefined,
      undefined,
    ]);
    const readResult: unknown = Reflect.apply(readTool.execute.bind(readTool), undefined, [
      "read-call",
      { url: "https://example.com", provider: providerName },
      undefined,
      undefined,
      undefined,
    ]);

    await expect(searchResult).resolves.toMatchObject({
      details: { provider: providerName, results: [{ title: "Custom" }] },
    });
    await expect(imageResult).resolves.toMatchObject({
      details: { provider: providerName, results: [{ title: "Custom image" }] },
    });
    await expect(readResult).resolves.toMatchObject({
      details: { provider: providerName, result: { content: "Custom page" } },
    });
  });

  it("counts providers whose results were deduplicated from an all search", async () => {
    const previousExaKey = process.env.EXA_API_KEY;
    const previousBraveKey = process.env.BRAVE_API_KEY;
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    const fetchMock = vi.fn(async (input: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : "";
      if (url === "https://api.exa.ai/search") {
        return new Response(
          JSON.stringify({
            requestId: "request",
            results: [{ id: "exa-result", title: "Exa result", url: "https://example.com/same" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("https://api.search.brave.com/res/v1/web/search")) {
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "Brave result",
                  url: "https://example.com/same",
                  description: "duplicate",
                  extra_snippets: [],
                  meta_url: { favicon: "" },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    resetDefaultClientForTests();

    try {
      const searchTool = captureTools().get("web_search");
      if (!searchTool) throw new Error("web_search was not registered");
      const execution: unknown = Reflect.apply(searchTool.execute.bind(searchTool), undefined, [
        "test-call",
        { query: "test query", provider: "all" },
        undefined,
        undefined,
        undefined,
      ]);

      await expect(execution).resolves.toHaveProperty("details.successfulProviders", [
        "exa",
        "brave",
      ]);
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringContaining("via 2 provider(s) [exa, brave]"),
      );
      await expect(execution).resolves.toHaveProperty("details.results.0.providers", [
        "exa",
        "brave",
      ]);
      await expect(execution).resolves.toHaveProperty("details.results.0.evidence", [
        expect.objectContaining({ provider: "exa", title: "Exa result" }),
        expect.objectContaining({
          provider: "brave",
          title: "Brave result",
          snippet: "duplicate",
        }),
      ]);
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringMatching(
          /Providers: exa, brave[\s\S]*Evidence:[\s\S]*2\. Brave result[\s\S]*Snippet: duplicate[\s\S]*Providers: brave/,
        ),
      );

      const batchExecution: unknown = Reflect.apply(
        searchTool.execute.bind(searchTool),
        undefined,
        [
          "test-batch-call",
          { query: ["first query", "second query"], provider: "all" },
          undefined,
          undefined,
          undefined,
        ],
      );
      await expect(batchExecution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringMatching(
          /\[1\] first query \[provider=all\]\n\n1\. Exa result[\s\S]*Providers: exa, brave[\s\S]*\[2\] second query \[provider=all\]\n\n1\. Exa result[\s\S]*Providers: exa, brave/,
        ),
      );
    } finally {
      if (previousExaKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previousExaKey;
      if (previousBraveKey === undefined) delete process.env.BRAVE_API_KEY;
      else process.env.BRAVE_API_KEY = previousBraveKey;
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });

  it("falls past 402 when the search provider is automatic", async () => {
    const previousExaKey = process.env.EXA_API_KEY;
    const previousBraveKey = process.env.BRAVE_API_KEY;
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : "";
      requestedUrls.push(url);
      if (url === "https://api.exa.ai/search") {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("https://api.search.brave.com/res/v1/web/search")) {
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "Brave Result",
                  url: "https://brave.example.com",
                  description: "Fallback result",
                  extra_snippets: [],
                  meta_url: { favicon: "" },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    resetDefaultClientForTests();

    try {
      const searchTool = captureTools().get("web_search");
      if (!searchTool) throw new Error("web_search was not registered");
      const execution: unknown = Reflect.apply(searchTool.execute.bind(searchTool), undefined, [
        "test-call",
        { query: "test query", startPublishedDate: "2024-01-01" },
        undefined,
        undefined,
        undefined,
      ]);

      await expect(execution).resolves.toHaveProperty("details.provider", "brave");
      await expect(execution).resolves.toHaveProperty(
        "details.results.0.url",
        "https://brave.example.com",
      );
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringContaining("[provider=brave]"),
      );
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringContaining("[ignored=startPublishedDate]"),
      );
      await expect(execution).resolves.toHaveProperty("details.ignoredFilters", [
        "startPublishedDate",
      ]);
      await expect(execution).resolves.toHaveProperty("details.attempts", ["exa", "brave"]);
      await expect(execution).resolves.toHaveProperty("details.failures.0", {
        provider: "exa",
        error: 'HTTP 402: https://api.exa.ai/search: {"error":"Payment required"}',
      });
      const searchUrls = requestedUrls.filter((url) => !url.startsWith("http://localhost:8080"));
      expect(searchUrls).toHaveLength(2);
      expect(searchUrls[0]).toBe("https://api.exa.ai/search");
      expect(searchUrls[1]).toContain("https://api.search.brave.com/res/v1/web/search");
    } finally {
      if (previousExaKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previousExaKey;
      if (previousBraveKey === undefined) delete process.env.BRAVE_API_KEY;
      else process.env.BRAVE_API_KEY = previousBraveKey;
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });

  it("reports the loaded build and process start through web_providers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unreachable")));

    try {
      const providersTool = captureTools().get("web_providers");
      if (!providersTool) throw new Error("web_providers was not registered");
      const execution: unknown = Reflect.apply(
        providersTool.execute.bind(providersTool),
        undefined,
        ["test-call", {}, undefined, undefined, undefined],
      );

      await expect(execution).resolves.toHaveProperty(
        "details.runtime.buildId",
        expect.stringMatching(/^[a-f0-9]{12}$/),
      );
      await expect(execution).resolves.toHaveProperty(
        "details.runtime.processStartedAt",
        new Date(performance.timeOrigin).toISOString(),
      );
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringMatching(/^web \S+ build [a-f0-9]{12}, started /),
      );
      await expect(execution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringContaining("jina (JINA_API_KEY) filters=includeDomains,category"),
      );
      await expect(execution).resolves.toHaveProperty(
        "details.providers",
        expect.arrayContaining([
          expect.objectContaining({
            name: "jina",
            searchFilters: ["includeDomains", "category"],
            searchCategories: ["web", "images", "news"],
          }),
        ]),
      );
    } finally {
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });

  it("keeps the no-provider command failure at warning severity", async () => {
    const previousEnv = new Map<string, string | undefined>();
    for (const provider of builtinProviders) {
      const envVar = providerApiKeyEnvVar(provider);
      if (!envVar) continue;
      previousEnv.set(envVar, process.env[envVar]);
      delete process.env[envVar];
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unreachable")));

    try {
      const command = captureExtension().commands.get("web");
      if (!command) throw new Error("web command was not registered");
      const notify = vi.fn();
      const execution: unknown = Reflect.apply(command.handler, undefined, [
        "test query",
        {
          hasUI: true,
          ui: {
            input: vi.fn(),
            notify,
            pasteToEditor: vi.fn(),
            select: vi.fn(),
          },
        },
      ]);

      await expect(execution).resolves.toBeUndefined();
      expect(notify).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("No reachable web providers."),
        "warning",
      );
    } finally {
      for (const [envVar, value] of previousEnv) {
        if (value === undefined) delete process.env[envVar];
        else process.env[envVar] = value;
      }
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });

  it("reports the effective reader after automatic fallback", async () => {
    const previousContextKey = process.env.CONTEXT_DEV_API_KEY;
    process.env.CONTEXT_DEV_API_KEY = "test-key";
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url.startsWith("https://r.jina.ai/")) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("https://api.context.dev/")) {
        return new Response(
          JSON.stringify({
            success: true,
            markdown: "Fallback content",
            url: "https://example.com",
            metadata: {
              sourceUrl: "https://example.com",
              finalUrl: "https://example.com",
              title: "Fallback result",
            },
            cache_metadata: {},
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    resetDefaultClientForTests();

    try {
      const readTool = captureTools().get("web_read");
      if (!readTool) throw new Error("web_read was not registered");
      const execution: unknown = Reflect.apply(readTool.execute.bind(readTool), undefined, [
        "test-call",
        { url: "https://example.com", provider: "auto" },
        undefined,
        undefined,
        undefined,
      ]);

      await expect(execution).resolves.toMatchObject({
        content: [
          {
            text: "[provider=context requested=auto] read https://example.com\n\nFallback result\n   https://example.com\n\nFallback content",
          },
        ],
        details: {
          provider: "auto",
          effectiveProvider: "context",
          attempts: ["jina", "context"],
          failures: [
            {
              provider: "jina",
              error:
                'HTTP 402: https://r.jina.ai/https%3A%2F%2Fexample.com: {"error":"Payment required"}',
            },
          ],
          result: { content: "Fallback content" },
        },
      });

      const batchExecution: unknown = Reflect.apply(readTool.execute.bind(readTool), undefined, [
        "test-batch-call",
        { url: ["https://example.com"] },
        undefined,
        undefined,
        undefined,
      ]);
      await expect(batchExecution).resolves.toHaveProperty(
        "content.0.text",
        expect.stringContaining("[1] https://example.com [provider=context requested=auto]"),
      );
      expect(requestedUrls).toEqual([
        "https://r.jina.ai/https%3A%2F%2Fexample.com",
        "https://api.context.dev/v1/web/scrape/markdown?url=https%3A%2F%2Fexample.com",
        "https://r.jina.ai/https%3A%2F%2Fexample.com",
        "https://api.context.dev/v1/web/scrape/markdown?url=https%3A%2F%2Fexample.com",
      ]);
    } finally {
      if (previousContextKey === undefined) delete process.env.CONTEXT_DEV_API_KEY;
      else process.env.CONTEXT_DEV_API_KEY = previousContextKey;
      vi.unstubAllGlobals();
      resetDefaultClientForTests();
    }
  });
});

function captureExtension(): {
  readonly tools: Map<string, CapturedTool>;
  readonly commands: Map<string, CapturedCommand>;
} {
  const tools = new Map<string, CapturedTool>();
  const commands = new Map<string, CapturedCommand>();
  Reflect.apply(webExtension, undefined, [
    {
      registerTool(tool: CapturedTool) {
        tools.set(tool.name, tool);
      },
      registerCommand(name: string, command: CapturedCommand) {
        commands.set(name, command);
      },
    },
  ]);
  return { tools, commands };
}

function captureTools(): Map<string, CapturedTool> {
  return captureExtension().tools;
}

function renderedText(component: unknown, width = 240): string {
  return (component as { render(viewportWidth: number): readonly string[] })
    .render(width)
    .join("\n");
}
