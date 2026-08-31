import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetJSON = vi.fn();
const mockPostJSON = vi.fn();
const providerEnvKeys = [
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "CONTEXT_DEV_API_KEY",
  "FIRECRAWL_API_KEY",
  "JINA_API_KEY",
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

import { createMcpServer, executeRead, executeSearch } from "../src/mcp.ts";
import { version } from "../src/version.ts";
import {
  EmptyQueryError,
  EmptyUrlError,
  HTTPError,
  NoProviderAvailableError,
} from "../src/core/errors.ts";
import "../src/providers/index.ts";

const openConnections: Array<{ close(): Promise<void> }> = [];

async function connectTestClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "web-test", version: "1.0.0" });
  openConnections.push(client, server);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeEach(() => {
  for (const key of providerEnvKeys) vi.stubEnv(key, "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()));
});

describe("web MCP server", () => {
  it("advertises the three capability tools as read-only", async () => {
    const client = await connectTestClient();

    const response = await client.listTools();

    expect(response.tools.map((tool) => tool.name)).toEqual([
      "web_search",
      "web_read",
      "web_providers",
    ]);
    for (const tool of response.tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
    expect(response.tools[2]?.annotations).toMatchObject({ openWorldHint: false });
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
    });
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
      },
      { query: "second query", error: "second query failed" },
    ]);
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
        result: { url: "https://example.com/one", content: "one" },
        requestedProvider: "auto",
        provider: "jina",
        attempts: ["jina"],
      },
      { url: "https://example.com/two", error: "second read failed" },
    ]);
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
      readonly providers: readonly unknown[];
    };
    expect(payload.runtime).toMatchObject({
      version,
      processStartedAt: new Date(performance.timeOrigin).toISOString(),
    });
    expect(payload.runtime.buildId).toMatch(/^[a-f0-9]{12}$/);
    expect(payload.providers).toContainEqual({
      name: "searxng",
      configured: true,
      envVar: null,
      reachable: false,
      searchFilters: ["category"],
    });
  });

  it("rejects arguments that miss the schema", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "web_read",
      arguments: { url: "https://example.com", format: "pdf" },
    });

    expect(response.isError).toBe(true);
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

  it("guards the empty-query contract when a host skips validation", async () => {
    await expect(executeSearch({})).rejects.toBeInstanceOf(EmptyQueryError);
    await expect(executeSearch({ query: "   " })).rejects.toBeInstanceOf(EmptyQueryError);
  });

  it("distinguishes automatic and explicit reader provenance", async () => {
    mockGetJSON.mockResolvedValue({
      code: 200,
      status: 20000,
      data: { url: "https://example.com", content: "page" },
    });

    await expect(executeRead({ url: "https://example.com" })).resolves.toEqual({
      result: { url: "https://example.com", content: "page" },
      requestedProvider: "auto",
      provider: "jina",
      attempts: ["jina"],
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

  it("rejects fractional maxTokens and a non-boolean noCache at the boundary", async () => {
    await expect(
      executeRead({ url: "https://example.com", maxTokens: 10.5 }),
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
