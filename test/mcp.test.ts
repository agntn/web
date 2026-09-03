import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type TSchema } from "typebox";
import { Value } from "typebox/value";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetJSON = vi.fn();
const mockPostJSON = vi.fn();
const providerEnvKeys = [
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "CONTEXT_DEV_API_KEY",
  "FIRECRAWL_API_KEY",
  "JINA_API_KEY",
  "MOJEEK_API_KEY",
  "TAVILY_API_KEY",
  "TINYFISH_API_KEY",
  "SERPAPI_API_KEY",
  "SERPBASE_API_KEY",
] as const;

vi.mock("../src/core/client.ts", () => ({
  Client: vi.fn(),
  defaultClient: vi.fn(() => ({
    getJSON: mockGetJSON,
    postJSON: mockPostJSON,
  })),
}));

import { createMcpServer, executeImageSearch, executeRead, executeSearch } from "../src/mcp.ts";
import { version } from "../src/version.ts";
import {
  EmptyImageUrlError,
  EmptyQueryError,
  EmptyUrlError,
  HTTPError,
  NoProviderAvailableError,
} from "../src/core/errors.ts";
import { Provider } from "../src/core/provider.ts";
import { register } from "../src/core/registry.ts";
import type { ProviderConfig, SearchResult } from "../src/core/types.ts";
import "../src/providers/index.ts";

const openConnections: Array<{ close(): Promise<void> }> = [];
const customProviderCleanups: Array<() => void> = [];

async function connectTestClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "web-test", version: "1.0.0" });
  openConnections.push(client, server);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await client.listTools();
  return client;
}

beforeEach(() => {
  for (const key of providerEnvKeys) vi.stubEnv(key, "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const unregister of customProviderCleanups.splice(0).reverse()) unregister();
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()));
});

describe("web MCP server", () => {
  it("forwards request cancellation through the MCP server handler", async () => {
    const providerName = `mcp-signal-${Math.random().toString(36).slice(2)}`;
    let providerSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    class SignalProvider extends Provider {
      static readonly providerName = providerName;
      static readonly defaultBaseURL = "https://signal.example.com";

      constructor(config: Readonly<ProviderConfig>) {
        super(config, SignalProvider);
      }

      async search(
        _query: string,
        options?: Readonly<{ signal?: Readonly<AbortSignal> }>,
      ): Promise<SearchResult[]> {
        providerSignal = options?.signal;
        markStarted?.();
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        });
      }
    }
    customProviderCleanups.push(register(SignalProvider));
    const client = await connectTestClient();
    const controller = new AbortController();

    const pending = client.callTool(
      { name: "web_search", arguments: { query: "test", provider: providerName } },
      undefined,
      { signal: controller.signal },
    );
    await started;
    controller.abort();

    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(providerSignal?.aborted).toBe(true));
  });

  it("advertises the four capability tools as read-only", async () => {
    const client = await connectTestClient();

    const response = await client.listTools();

    expect(response.tools.map((tool) => tool.name)).toEqual([
      "web_search",
      "web_search_image",
      "web_read",
      "web_providers",
    ]);
    expect(response.tools.map((tool) => tool.title)).toEqual([
      "⌕ Web Search",
      "▧ Search by Image",
      "↗ Web Read",
      "◫ Web Providers",
    ]);
    for (const tool of response.tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
    expect(response.tools[3]?.annotations).toMatchObject({ openWorldHint: false });
    const searchInput = response.tools[0]?.inputSchema as {
      readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    };
    expect(searchInput.properties.continuation).toMatchObject({
      type: "string",
      maxLength: 4096,
    });
    const readInput = response.tools[2]?.inputSchema as {
      readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    };
    expect(readInput.properties.maxChars).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 200_000,
    });
    expect(readInput.properties.continuation).toMatchObject({ type: "string", maxLength: 1024 });
  });

  it("advertises output schemas that reject malformed tool results", async () => {
    const client = await connectTestClient();
    const { tools } = await client.listTools();
    const invalidResults: Readonly<Record<string, unknown>> = {
      web_search: {
        result: { provider: 42, results: [], ignoredFilters: [], undeclaredFilters: [] },
      },
      web_search_image: { result: [{ pageUrl: 42 }] },
      web_read: {
        result: {
          result: { url: "https://example.com", content: "page" },
          requestedProvider: "auto",
          provider: "jina",
          attempts: "jina",
        },
      },
      web_providers: { result: { runtime: {}, providers: [{ configured: "yes" }] } },
    };

    for (const tool of tools) {
      expect(tool.outputSchema).toMatchObject({
        type: "object",
        required: ["result"],
        additionalProperties: false,
      });
      expect(Value.Check(tool.outputSchema as TSchema, invalidResults[tool.name]), tool.name).toBe(
        false,
      );
    }

    const searchTool = tools.find((tool) => tool.name === "web_search");
    if (!searchTool?.outputSchema) throw new TypeError("Missing web_search output schema");
    expect(
      Value.Check(searchTool.outputSchema as TSchema, {
        result: [
          {
            query: "fanout query",
            provider: "all",
            results: [{ url: "https://example.com", title: "Example", snippet: "Result" }],
            filterReports: [],
          },
        ],
      }),
    ).toBe(false);
    expect(
      Value.Check(searchTool.outputSchema as TSchema, {
        result: {
          provider: "jina",
          results: [
            {
              url: "https://example.com",
              title: "Example",
              snippet: "Result",
              undocumentedField: true,
            },
          ],
          ignoredFilters: [],
          undeclaredFilters: [],
        },
      }),
    ).toBe(false);
  });

  it("returns provider results as JSON text for web_search", async () => {
    vi.stubEnv("JINA_API_KEY", "test-key");
    mockGetJSON.mockReset();
    mockGetJSON.mockResolvedValue({
      code: 200,
      status: 20000,
      data: [
        { title: "Test Result", url: "https://example.com", description: "A test description" },
      ],
    });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_search",
      arguments: {
        query: "test query",
        provider: "jina",
        maxResults: 5,
        startPublishedDate: "2024-01-01",
      },
    });

    expect(response.isError).toBeUndefined();
    const payload = JSON.parse(
      (response.content as Array<{ type: string; text: string }>)[0]?.text ?? "",
    ) as Readonly<Record<string, unknown>>;
    expect(payload).toEqual({
      provider: "jina",
      ignoredFilters: ["startPublishedDate"],
      undeclaredFilters: [],
      results: [
        { title: "Test Result", url: "https://example.com", snippet: "A test description" },
      ],
      pagination: { status: "unsupported" },
    });
    expect(response.structuredContent).toEqual({ result: payload });
    expect((response.content as Array<{ type: string; text: string }>)[0]?.text).toBe(
      JSON.stringify(payload),
    );
  });

  it("continues one provider search with the returned opaque token", async () => {
    vi.stubEnv("BRAVE_API_KEY", "test-key");
    mockGetJSON.mockReset();
    mockGetJSON
      .mockResolvedValueOnce({
        query: { more_results_available: true },
        web: { results: [] },
      })
      .mockResolvedValueOnce({
        query: { more_results_available: false },
        web: { results: [] },
      });
    const client = await connectTestClient();

    const firstResponse = await client.callTool({
      name: "web_search",
      arguments: { query: "test query", provider: "brave", maxResults: 1 },
    });
    const first = firstResponse.structuredContent?.result as {
      readonly pagination: { readonly status: string; readonly continuation?: string };
    };
    if (first.pagination.continuation === undefined) throw new Error("missing continuation");
    const secondResponse = await client.callTool({
      name: "web_search",
      arguments: {
        query: "test query",
        provider: "brave",
        maxResults: 1,
        continuation: first.pagination.continuation,
      },
    });

    expect(firstResponse.isError).toBeUndefined();
    expect(first.pagination.status).toBe("next");
    expect(new URL(String(mockGetJSON.mock.calls[1][0])).searchParams.get("offset")).toBe("1");
    expect(secondResponse.structuredContent).toMatchObject({
      result: { pagination: { status: "end" } },
    });
  });

  it("accepts registered custom providers for each implemented capability", async () => {
    const providerName = `mcpprovider${Math.random().toString(36).slice(2)}`;
    class McpProvider extends Provider {
      static readonly providerName = providerName;
      static readonly defaultBaseURL = "https://mcp.example.com";

      constructor(config: Readonly<ProviderConfig>) {
        super(config, McpProvider);
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
    customProviderCleanups.push(register(McpProvider));
    const client = await connectTestClient();

    const searchResult = await client.callTool({
      name: "web_search",
      arguments: { query: "custom query", provider: providerName },
    });
    const imageResult = await client.callTool({
      name: "web_search_image",
      arguments: { url: "https://example.com/input.jpg", provider: providerName },
    });
    const readResult = await client.callTool({
      name: "web_read",
      arguments: { url: "https://example.com", provider: providerName },
    });

    expect(searchResult.isError).toBeUndefined();
    expect(searchResult.structuredContent).toMatchObject({
      result: { provider: providerName, results: [{ title: "Custom" }] },
    });
    expect(imageResult.isError).toBeUndefined();
    expect(imageResult.structuredContent).toMatchObject({
      result: [{ provider: providerName, title: "Custom image" }],
    });
    expect(readResult.isError).toBeUndefined();
    expect(readResult.structuredContent).toMatchObject({
      result: { provider: providerName, result: { content: "Custom page" } },
    });
  });

  it("returns detailed search metadata as JSON text", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    mockPostJSON.mockReset();
    mockPostJSON.mockResolvedValue({
      success: true,
      id: "mcp-request",
      warning: "Partial coverage",
      creditsUsed: 2,
      data: { web: [] },
    });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_search",
      arguments: { query: "test query", provider: "firecrawl" },
    });

    expect(response.isError).toBeUndefined();
    const payload = JSON.parse(
      (response.content as Array<{ type: string; text: string }>)[0]?.text ?? "",
    ) as Readonly<Record<string, unknown>>;
    expect(payload).toMatchObject({
      provider: "firecrawl",
      metadata: { id: "mcp-request", warning: "Partial coverage", creditsUsed: 2 },
    });
  });

  it("returns structured fanout search results", async () => {
    vi.stubEnv("EXA_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("SearXNG unavailable")));
    mockPostJSON.mockReset();
    mockPostJSON.mockResolvedValue({
      requestId: "fanout-request",
      results: [{ title: "Fanout Result", url: "https://example.com", text: "page" }],
    });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_search",
      arguments: { query: "test query", provider: "all" },
    });

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toMatchObject({
      result: {
        results: [
          expect.objectContaining({
            provider: "exa",
            providers: ["exa"],
            evidence: [expect.objectContaining({ provider: "exa", url: "https://example.com" })],
            url: "https://example.com",
          }),
        ],
        successfulProviders: ["exa"],
        errors: [],
      },
    });
  });

  it("returns provider provenance in structured fanout batches", async () => {
    vi.stubEnv("EXA_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("SearXNG unavailable")));
    mockPostJSON.mockReset();
    mockPostJSON.mockResolvedValue({
      requestId: "fanout-batch-request",
      results: [{ title: "Fanout Result", url: "https://example.com", text: "page" }],
    });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_search",
      arguments: { query: ["test query"], provider: "all" },
    });

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toMatchObject({
      result: [
        {
          query: "test query",
          provider: "all",
          results: [
            expect.objectContaining({
              provider: "exa",
              providers: ["exa"],
              evidence: [expect.objectContaining({ provider: "exa", url: "https://example.com" })],
              url: "https://example.com",
            }),
          ],
        },
      ],
    });
  });

  it("returns reverse image matches as JSON text", async () => {
    vi.stubEnv("SERPAPI_API_KEY", "test-key");
    mockGetJSON.mockReset();
    mockGetJSON.mockResolvedValue({
      search_metadata: { id: "lens-id", status: "Success" },
      visual_matches: [
        {
          position: 1,
          title: "Matching page",
          link: "https://example.com/page",
          image: "https://example.com/full.jpg",
        },
      ],
    });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_search_image",
      arguments: { url: "https://example.com/input.jpg", maxResults: 5 },
    });

    expect(response.isError).toBeUndefined();
    const payload = JSON.parse(
      (response.content as Array<{ type: string; text: string }>)[0]?.text ?? "",
    ) as readonly unknown[];
    expect(payload).toEqual([
      expect.objectContaining({
        pageUrl: "https://example.com/page",
        imageUrl: "https://example.com/full.jpg",
        provider: "serpapi",
      }),
    ]);
    expect(response.structuredContent).toEqual({ result: payload });
  });

  it("keeps separate ordered results for batched searches", async () => {
    vi.stubEnv("JINA_API_KEY", "test-key");
    mockGetJSON.mockReset();
    mockGetJSON
      .mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: [{ title: "First", url: "https://example.com/one", description: "one" }],
      })
      .mockRejectedValueOnce(new Error("second query failed"));
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_search",
      arguments: { query: ["first query", "second query"], provider: "jina" },
    });

    expect(response.isError).toBeUndefined();
    const payload = JSON.parse(
      (response.content as Array<{ type: string; text: string }>)[0]?.text ?? "",
    ) as readonly unknown[];
    expect(payload).toEqual([
      {
        query: "first query",
        provider: "jina",
        results: [{ title: "First", url: "https://example.com/one", snippet: "one" }],
        filterReports: [],
        pagination: { status: "unsupported" },
      },
      { query: "second query", error: "second query failed" },
    ]);
    expect(response.structuredContent).toEqual({ result: payload });
  });

  it("returns structured scalar read results", async () => {
    mockGetJSON.mockReset();
    mockGetJSON.mockResolvedValue({
      code: 200,
      status: 20000,
      data: { url: "https://example.com", content: "page" },
    });
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_read",
      arguments: { url: "https://example.com", provider: "auto" },
    });

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual({
      result: {
        result: { url: "https://example.com", content: "page", truncated: false },
        requestedProvider: "auto",
        provider: "jina",
        attempts: ["jina"],
        failures: [],
      },
    });
  });

  it("keeps separate ordered results for batched reads", async () => {
    mockGetJSON.mockReset();
    mockGetJSON
      .mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: { url: "https://example.com/one", content: "one" },
      })
      .mockRejectedValueOnce(new Error("second read failed"));
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_read",
      arguments: {
        url: ["https://example.com/one", "https://example.com/two"],
        provider: "auto",
      },
    });

    expect(response.isError).toBeUndefined();
    const payload = JSON.parse(
      (response.content as Array<{ type: string; text: string }>)[0]?.text ?? "",
    ) as readonly unknown[];
    expect(payload).toEqual([
      {
        url: "https://example.com/one",
        result: { url: "https://example.com/one", content: "one", truncated: false },
        requestedProvider: "auto",
        provider: "jina",
        attempts: ["jina"],
        failures: [],
      },
      { url: "https://example.com/two", error: "second read failed" },
    ]);
    expect(response.structuredContent).toEqual({ result: payload });
  });

  it("reports an unreachable local SearXNG instance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const client = await connectTestClient();

    const response = await client.callTool({ name: "web_providers", arguments: {} });

    expect(response.isError).toBeUndefined();
    const payload = JSON.parse(
      (response.content as Array<{ type: string; text: string }>)[0]?.text ?? "",
    ) as {
      readonly runtime: {
        readonly version: string;
        readonly buildId: string;
        readonly processStartedAt: string;
      };
      readonly packageCapabilities: Readonly<Record<string, unknown>>;
      readonly providers: readonly unknown[];
    };
    expect(payload.runtime).toMatchObject({
      version,
      processStartedAt: new Date(performance.timeOrigin).toISOString(),
    });
    expect(payload.runtime.buildId).toMatch(/^[a-f0-9]{12}$/);
    expect(payload.packageCapabilities).toMatchObject({
      search: {
        continuation: {
          option: "continuation",
          opaque: true,
          maximum: 4_096,
          providerStateMaximum: 2_048,
          scope: "single-provider-query",
        },
      },
      read: {
        outputLimit: { option: "maxChars", agentDefault: 20_000, agentMaximum: 200_000 },
        continuation: { option: "continuation", opaque: true },
      },
    });
    expect(payload.providers).toContainEqual({
      name: "searxng",
      configured: true,
      envVar: null,
      reachable: false,
      searchFilters: ["category"],
      capabilities: {
        search: {
          supported: true,
          filters: ["category"],
          contentOptions: [],
          pagination: true,
          resultFields: ["score", "publishedDate", "image", "metadata"],
        },
        searchImage: { supported: false },
        read: { supported: false },
      },
    });
    expect(response.structuredContent).toEqual({ result: payload });
  });

  it("rejects one continuation for a search batch", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_search",
      arguments: { query: ["first", "second"], continuation: "opaque-token" },
    });

    expect(response.isError).toBe(true);
    expect((response.content as Array<{ type: string; text: string }>)[0]?.text).toContain(
      "continuation is only supported for a single query",
    );
  });

  it("rejects arguments that miss the schema", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_read",
      arguments: { url: "https://example.com", format: "pdf" },
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toBeUndefined();
    expect((response.content as Array<{ type: string; text: string }>)[0]).toMatchObject({
      type: "text",
    });
  });

  it("rejects prototype property names as unknown tools", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({ name: "toString", arguments: {} });

    expect(response.isError).toBe(true);
    expect((response.content as Array<{ type: string; text: string }>)[0]?.text).not.toContain(
      "\n",
    );
  });

  it("escapes control bytes in an unknown tool name instead of echoing them", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({ name: "bad\nname", arguments: {} });

    expect(response.isError).toBe(true);
    expect((response.content as Array<{ type: string; text: string }>)[0]?.text).not.toContain(
      "\n",
    );
  });
});

describe("web MCP executors", () => {
  beforeEach(() => {
    mockGetJSON.mockReset();
    mockPostJSON.mockReset();
    mockGetJSON.mockResolvedValue({ code: 200, status: 20000, data: [] });
  });

  it("does not select an unreachable local SearXNG instance by default", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(executeSearch({ query: "test" })).rejects.toBeInstanceOf(NoProviderAvailableError);
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("falls past 402 when the provider was selected automatically", async () => {
    vi.stubEnv("EXA_API_KEY", "test-exa");
    vi.stubEnv("BRAVE_API_KEY", "test-brave");
    mockPostJSON.mockRejectedValue(
      new HTTPError(402, "https://api.exa.ai/search", "Payment required"),
    );
    mockGetJSON.mockResolvedValue({
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
    });

    await expect(executeSearch({ query: "test" })).resolves.toMatchObject({
      provider: "brave",
      results: [expect.objectContaining({ url: "https://brave.example.com" })],
      attempts: ["exa", "brave"],
      failures: [
        {
          provider: "exa",
          error: "HTTP 402: https://api.exa.ai/search: Payment required",
        },
      ],
    });
  });

  it('serializes provider errors from an "all" search', async () => {
    vi.stubEnv("EXA_API_KEY", "test-exa");
    vi.stubEnv("BRAVE_API_KEY", "test-brave");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("SearXNG unavailable")));
    mockPostJSON.mockRejectedValue(new Error("Exa unavailable"));
    mockGetJSON.mockResolvedValue({
      web: {
        results: [
          {
            title: "Brave Result",
            url: "https://brave.example.com",
            description: "Partial result",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
        ],
      },
    });

    await expect(executeSearch({ query: "test", provider: "all" })).resolves.toMatchObject({
      results: [expect.objectContaining({ provider: "brave" })],
      errors: [{ provider: "exa", error: "Exa unavailable" }],
    });
  });

  it("passes content preferences through and validates booleans at the boundary", async () => {
    vi.stubEnv("EXA_API_KEY", "test-exa");
    mockPostJSON.mockResolvedValue({ requestId: "request", results: [] });

    await executeSearch({
      query: "test",
      provider: "exa",
      highlights: false,
      summary: true,
      fullText: true,
    });

    expect(mockPostJSON.mock.calls[0]?.[1]).toMatchObject({
      contents: { text: true, highlights: false, summary: true },
    });
    await expect(
      executeSearch({ query: "test", provider: "exa", summary: "true" }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("forwards MCP cancellation through every executor", async () => {
    vi.stubEnv("EXA_API_KEY", "test-exa");
    vi.stubEnv("SERPAPI_API_KEY", "test-serpapi");
    mockPostJSON.mockResolvedValue({ requestId: "request", results: [] });
    mockGetJSON.mockResolvedValueOnce({ visual_matches: [] }).mockResolvedValueOnce({
      code: 200,
      status: 20_000,
      data: { url: "https://example.com", content: "page" },
    });
    const signal = new AbortController().signal;

    await executeSearch({ query: "test", provider: "exa" }, signal);
    await executeImageSearch({ url: "https://example.com/image.jpg", provider: "serpapi" }, signal);
    await executeRead({ url: "https://example.com", provider: "jina" }, signal);

    expect(mockPostJSON.mock.calls[0]?.[3]).toBe(signal);
    expect(mockGetJSON.mock.calls[0]?.[2]).toBe(signal);
    expect(mockGetJSON.mock.calls[1]?.[2]).toBe(signal);
  });

  it("guards the empty-query contract when a host skips validation", async () => {
    await expect(executeSearch({})).rejects.toBeInstanceOf(EmptyQueryError);
    await expect(executeSearch({ query: "   " })).rejects.toBeInstanceOf(EmptyQueryError);
  });

  it("guards reverse image search when schema validation is skipped", async () => {
    await expect(executeImageSearch({ url: "" })).rejects.toBeInstanceOf(EmptyImageUrlError);
    await expect(
      executeImageSearch({ url: "https://example.com/input.jpg", provider: "brave" }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      executeImageSearch({ url: "https://example.com/input.jpg", maxResults: 21 }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("distinguishes automatic and explicit reader provenance", async () => {
    mockGetJSON.mockResolvedValue({
      code: 200,
      status: 20000,
      data: { url: "https://example.com", content: "page" },
    });

    await expect(executeRead({ url: "https://example.com" })).resolves.toEqual({
      result: { url: "https://example.com", content: "page", truncated: false },
      requestedProvider: "auto",
      provider: "jina",
      attempts: ["jina"],
      failures: [],
    });
    await expect(
      executeRead({ url: "https://example.com", provider: "auto" }),
    ).resolves.toMatchObject({ requestedProvider: "auto", provider: "jina" });
    await expect(
      executeRead({ url: "https://example.com", provider: "jina" }),
    ).resolves.toMatchObject({ requestedProvider: "jina", provider: "jina" });
  });

  it("guards the empty-url contract when a host skips validation", async () => {
    await expect(executeRead({ url: "" })).rejects.toBeInstanceOf(EmptyUrlError);
  });

  it("accepts maxResults at the declared hard cap", async () => {
    vi.stubEnv("JINA_API_KEY", "test-key");
    await executeSearch({ query: "test", provider: "jina", maxResults: 20 });

    const requestUrl = String(mockGetJSON.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("count=20");
  });

  it("rejects a string includeDomains before it iterates per character", async () => {
    vi.stubEnv("JINA_API_KEY", "test-key");
    await expect(
      executeSearch({ query: "test", provider: "jina", includeDomains: "github.com" }),
    ).rejects.toBeInstanceOf(TypeError);

    await executeSearch({
      query: "test",
      provider: "jina",
      includeDomains: ["github.com"],
    });
    const requestUrl = String(mockGetJSON.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("site=github.com");
  });

  it("passes Firecrawl source and category arrays through the executor", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    mockPostJSON.mockResolvedValue({ success: true, data: { web: [] } });

    await executeSearch({
      query: "test",
      provider: "firecrawl",
      sources: ["web", "news"],
      categories: ["developer"],
    });

    expect(mockPostJSON.mock.calls[0]?.[1]).toMatchObject({
      sources: ["web", "news"],
      categories: ["developer"],
    });
    await expect(
      executeSearch({ query: "test", provider: "firecrawl", sources: "news" }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects fractional maxTokens and a non-boolean noCache at the boundary", async () => {
    await expect(
      executeRead({ url: "https://example.com", maxTokens: 10.5 }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      executeRead({ url: "https://example.com", maxChars: 200_001 }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      executeRead({ url: "https://example.com", noCache: "yes" }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects malformed maxResults instead of silently changing the request", async () => {
    for (const maxResults of ["5", Number.NaN, 10.9, 21]) {
      await expect(
        executeSearch({ query: "test", provider: "jina", maxResults }),
      ).rejects.toBeInstanceOf(TypeError);
    }
  });

  it("rejects blank read providers before the default-provider fallback", async () => {
    await expect(executeRead({ url: "https://example.com", provider: "" })).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(
      executeRead({ url: "https://example.com", provider: "   " }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("passes schema-valid empty optional values through untouched", async () => {
    vi.stubEnv("JINA_API_KEY", "test-key");
    await executeSearch({ query: "test", provider: "jina", category: "", includeDomains: [] });

    expect(mockGetJSON.mock.calls[0]?.[0]).toBeDefined();
  });
});
