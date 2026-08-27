import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPostJSON =
  vi.fn<
    (
      url: string,
      body: Readonly<Record<string, unknown>>,
      headers?: Readonly<Record<string, string>>,
    ) => Promise<unknown>
  >();
const mockGetJSON =
  vi.fn<(url: string, headers?: Readonly<Record<string, string>>) => Promise<unknown>>();

vi.mock("../../src/core/client.ts", () => ({
  Client: vi.fn(),
  defaultClient: vi.fn(() => ({
    postJSON: mockPostJSON,
    getJSON: mockGetJSON,
    maxRetries: 5,
    baseDelay: 50,
    timeout: 30000,
    userAgent: "agntn-web/0.0.1",
  })),
}));

import { readTool, searchTool } from "../../src/ai.ts";
import { EmptyQueryError, EmptyUrlError } from "../../src/core/errors.ts";

const exaResponse = {
  requestId: "test-req",
  results: [
    {
      id: "abc123",
      url: "https://example.com",
      title: "Test Result",
      score: 0.95,
      publishedDate: "2024-01-01",
      author: "Test Author",
      image: "https://example.com/img.png",
      favicon: "https://example.com/favicon.ico",
      text: "Full text content",
      highlights: ["Key highlight"],
      summary: "A brief summary",
    },
  ],
};

const braveResponse = {
  web: {
    results: [
      {
        title: "Brave Result",
        url: "https://brave.example.com",
        description: "Brave search result",
        extra_snippets: ["Extra snippet"],
        meta_url: { favicon: "https://brave.example.com/favicon.ico" },
      },
    ],
  },
};

const searxngResponse = {
  results: [
    {
      title: "SearXNG Result",
      url: "https://searxng.example.com",
      content: "SearXNG content",
      engine: "google",
      engines: ["google"],
      score: 5.0,
      category: "general",
    },
  ],
  number_of_results: 1,
  query: "test",
};

const savedEnv: Record<string, string | undefined> = {};
const envKeys = [
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "FIRECRAWL_API_KEY",
  "JINA_API_KEY",
  "TAVILY_API_KEY",
  "TINYFISH_API_KEY",
  "SERPAPI_API_KEY",
  "SERPBASE_API_KEY",
];

describe("searchTool", () => {
  beforeEach(() => {
    mockPostJSON.mockReset();
    mockGetJSON.mockReset();
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    vi.unstubAllGlobals();
  });

  it("has correct description", () => {
    expect(searchTool.description).toBeTypeOf("string");
    expect(searchTool.description!.length).toBeGreaterThan(0);
  });

  it("has correct inputSchema", () => {
    expect(searchTool.inputSchema).toBeDefined();
  });

  it("has execute function", () => {
    expect(searchTool.execute).toBeTypeOf("function");
  });

  it("execute with explicit provider", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    mockPostJSON.mockResolvedValue(exaResponse);

    const results = (await searchTool.execute!(
      { query: "test query", provider: "exa" },
      { toolCallId: "call-1", messages: [] },
    )) as readonly { readonly url: string; readonly title: string }[];

    expect(mockPostJSON).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com");
    expect(results[0].title).toBe("Test Result");
  });

  it("returns one ordered outcome per query in a batch", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    mockPostJSON
      .mockResolvedValueOnce(exaResponse)
      .mockRejectedValueOnce(new Error("second query failed"));

    const outcomes = await searchTool.execute!(
      { query: ["first query", "second query"], provider: "exa" },
      { toolCallId: "call-batch", messages: [] },
    );

    expect(outcomes).toEqual([
      { query: "first query", results: [expect.objectContaining({ title: "Test Result" })] },
      { query: "second query", error: "second query failed" },
    ]);
  });

  it("rejects oversized batches before starting requests", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    const queries = Array.from({ length: 11 }, (_, index) => `query ${index}`);

    await expect(
      searchTool.execute!(
        { query: queries, provider: "exa" },
        { toolCallId: "call-large-batch", messages: [] },
      ),
    ).rejects.toThrow("Batch cannot contain more than 10 items");
    expect(mockPostJSON).not.toHaveBeenCalled();
  });

  it("execute resolves default provider from env", async () => {
    process.env.BRAVE_API_KEY = "test-brave-key";
    mockGetJSON.mockResolvedValue(braveResponse);

    const results = (await searchTool.execute!(
      { query: "test query" },
      { toolCallId: "call-2", messages: [] },
    )) as readonly { readonly url: string }[];

    expect(mockGetJSON).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://brave.example.com");
  });

  it("execute falls back to searxng when no API keys set", async () => {
    mockGetJSON.mockResolvedValue(searxngResponse);

    const results = (await searchTool.execute!(
      { query: "test query" },
      { toolCallId: "call-3", messages: [] },
    )) as readonly { readonly url: string }[];

    expect(mockGetJSON).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://searxng.example.com");
  });

  it("passes maxResults to provider", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    mockPostJSON.mockResolvedValue(exaResponse);

    await searchTool.execute!(
      { query: "test query", provider: "exa", maxResults: 5 },
      { toolCallId: "call-4", messages: [] },
    );

    const [, body] = mockPostJSON.mock.calls[0];
    expect(body.numResults).toBe(5);
  });

  it("passes includeDomains to provider", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    mockPostJSON.mockResolvedValue(exaResponse);

    await searchTool.execute!(
      { query: "test", provider: "exa", includeDomains: ["github.com"] },
      { toolCallId: "call-domains", messages: [] },
    );

    const [, body] = mockPostJSON.mock.calls[0];
    expect(body.includeDomains).toEqual(["github.com"]);
  });

  it("passes excludeDomains to provider", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    mockPostJSON.mockResolvedValue(exaResponse);

    await searchTool.execute!(
      { query: "test", provider: "exa", excludeDomains: ["reddit.com"] },
      { toolCallId: "call-exclude", messages: [] },
    );

    const [, body] = mockPostJSON.mock.calls[0];
    expect(body.excludeDomains).toEqual(["reddit.com"]);
  });

  it("passes date filters to provider", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    mockPostJSON.mockResolvedValue(exaResponse);

    await searchTool.execute!(
      {
        query: "test",
        provider: "exa",
        startPublishedDate: "2024-01-01",
        endPublishedDate: "2024-12-31",
      },
      { toolCallId: "call-dates", messages: [] },
    );

    const [, body] = mockPostJSON.mock.calls[0];
    expect(body.startPublishedDate).toBe("2024-01-01");
    expect(body.endPublishedDate).toBe("2024-12-31");
  });

  it('passes filters through to searchAll with "all" provider', async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    mockPostJSON.mockResolvedValue(exaResponse);

    const results = await searchTool.execute!(
      { query: "test", provider: "all", includeDomains: ["github.com"], maxResults: 5 },
      { toolCallId: "call-all-filters", messages: [] },
    );

    expect(Array.isArray(results)).toBe(true);
    const [, body] = mockPostJSON.mock.calls[0];
    expect(body.includeDomains).toEqual(["github.com"]);
    expect(body.numResults).toBe(5);
  });

  it("rejects empty query", async () => {
    await expect(
      searchTool.execute!(
        { query: "", provider: "exa" },
        { toolCallId: "call-empty", messages: [] },
      ),
    ).rejects.toThrow(EmptyQueryError);

    expect(mockPostJSON).not.toHaveBeenCalled();
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only query", async () => {
    await expect(
      searchTool.execute!(
        { query: "   ", provider: "exa" },
        { toolCallId: "call-ws", messages: [] },
      ),
    ).rejects.toThrow(EmptyQueryError);

    expect(mockPostJSON).not.toHaveBeenCalled();
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("execute with all provider queries all available providers", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    process.env.BRAVE_API_KEY = "test-brave-key";

    mockPostJSON.mockResolvedValue(exaResponse);
    mockGetJSON.mockResolvedValue(braveResponse);

    const results = await searchTool.execute!(
      { query: "test", provider: "all" },
      { toolCallId: "call-5", messages: [] },
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(results)).toBe(true);
    expect(results[0]).toHaveProperty("url");
    expect(results[0]).toHaveProperty("title");
  });

  it("returns a query error when all batch providers fail", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("SearXNG unavailable")));
    mockPostJSON.mockRejectedValue(new Error("Exa unavailable"));

    const outcomes = await searchTool.execute!(
      { query: ["test"], provider: "all" },
      { toolCallId: "call-all-batch-failure", messages: [] },
    );

    expect(outcomes).toEqual([
      { query: "test", error: "Search providers failed: exa: Exa unavailable" },
    ]);
  });
});

describe("readTool", () => {
  beforeEach(() => {
    mockGetJSON.mockReset();
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("reads a URL with Jina by default", async () => {
    mockGetJSON.mockResolvedValueOnce({
      code: 200,
      status: 20000,
      data: {
        title: "Read Result",
        url: "https://example.com/",
        content: "Read content",
      },
    });

    const result = await readTool.execute!(
      { url: "https://example.com", format: "markdown" },
      { toolCallId: "read-call-1", messages: [] },
    );

    expect(result.content).toBe("Read content");
    const [url, headers] = mockGetJSON.mock.calls[0];
    expect(url).toBe("https://r.jina.ai/https%3A%2F%2Fexample.com");
    expect(headers).toEqual({ Accept: "application/json", "X-Return-Format": "markdown" });
  });

  it("returns one ordered outcome per URL in a batch", async () => {
    mockGetJSON
      .mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: {
          url: "https://example.com/one",
          content: "First page",
        },
      })
      .mockRejectedValueOnce(new Error("second read failed"));

    const outcomes = await readTool.execute!(
      { url: ["https://example.com/one", "https://example.com/two"] },
      { toolCallId: "read-batch", messages: [] },
    );

    expect(outcomes).toEqual([
      {
        url: "https://example.com/one",
        result: { url: "https://example.com/one", content: "First page" },
      },
      { url: "https://example.com/two", error: "second read failed" },
    ]);
  });

  it("rejects oversized read batches before starting requests", async () => {
    const urls = Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`);

    await expect(
      readTool.execute!({ url: urls }, { toolCallId: "read-large-batch", messages: [] }),
    ).rejects.toThrow("Batch cannot contain more than 10 items");
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("rejects empty URL", async () => {
    await expect(
      readTool.execute!({ url: "   " }, { toolCallId: "read-empty", messages: [] }),
    ).rejects.toThrow(EmptyUrlError);

    expect(mockGetJSON).not.toHaveBeenCalled();
  });
});
