import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { asSchema } from "ai";

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

import { providersTool, readTool, searchImageTool, searchTool } from "../../src/ai.ts";
import { EmptyQueryError, EmptyUrlError, HTTPError } from "../../src/core/errors.ts";
import { runtimeInfo } from "../../src/version.ts";

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
  "CONTEXT_DEV_API_KEY",
  "FIRECRAWL_API_KEY",
  "JINA_API_KEY",
  "MOJEEK_API_KEY",
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

  it("rejects fractional result limits at the schema boundary", async () => {
    const validate = asSchema(searchTool.inputSchema).validate;
    if (!validate) throw new TypeError("Search schema has no validator");

    await expect(validate({ query: "test", maxResults: 5 })).resolves.toMatchObject({
      success: true,
    });
    await expect(validate({ query: "test", maxResults: 5.5 })).resolves.toMatchObject({
      success: false,
    });
  });

  it("execute with explicit provider", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    mockPostJSON.mockResolvedValue(exaResponse);

    const response = await searchTool.execute!(
      { query: "test query", provider: "exa" },
      { toolCallId: "call-1", messages: [] },
    );

    expect(mockPostJSON).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      provider: "exa",
      ignoredFilters: [],
      undeclaredFilters: [],
      results: [expect.objectContaining({ url: "https://example.com", title: "Test Result" })],
    });
  });

  it("passes the highlights preference to providers", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    mockPostJSON.mockResolvedValue(exaResponse);

    await searchTool.execute!(
      { query: "test query", provider: "exa", highlights: false },
      { toolCallId: "call-highlights", messages: [] },
    );

    const [, body] = mockPostJSON.mock.calls[0];
    expect(body.contents).toEqual({ text: true, highlights: false });
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
      {
        query: "first query",
        provider: "exa",
        results: [expect.objectContaining({ title: "Test Result" })],
        filterReports: [],
      },
      { query: "second query", error: "second query failed" },
    ]);
  });

  it("uses payment fallback independently for automatic batch items", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    process.env.BRAVE_API_KEY = "test-brave-key";
    const availabilityProbe = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", availabilityProbe);
    mockPostJSON.mockRejectedValue(
      new HTTPError(402, "https://api.exa.ai/search", "Payment required"),
    );
    mockGetJSON.mockResolvedValue(braveResponse);

    const outcomes = await searchTool.execute!(
      { query: ["first query", "second query"], startPublishedDate: "2024-01-01" },
      { toolCallId: "call-batch-fallback", messages: [] },
    );

    expect(outcomes).toEqual([
      {
        query: "first query",
        provider: "brave",
        results: [expect.objectContaining({ url: "https://brave.example.com" })],
        filterReports: [
          {
            provider: "brave",
            ignoredFilters: ["startPublishedDate"],
            undeclaredFilters: [],
          },
        ],
      },
      {
        query: "second query",
        provider: "brave",
        results: [expect.objectContaining({ url: "https://brave.example.com" })],
        filterReports: [
          {
            provider: "brave",
            ignoredFilters: ["startPublishedDate"],
            undeclaredFilters: [],
          },
        ],
      },
    ]);
    expect(availabilityProbe).toHaveBeenCalledOnce();
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

    const response = await searchTool.execute!(
      { query: "test query" },
      { toolCallId: "call-2", messages: [] },
    );

    expect(mockGetJSON).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      provider: "brave",
      results: [expect.objectContaining({ url: "https://brave.example.com" })],
    });
  });

  it("tries the next configured provider when automatic search gets 402", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    process.env.BRAVE_API_KEY = "test-brave-key";
    mockPostJSON.mockRejectedValue(
      new HTTPError(402, "https://api.exa.ai/search", "Payment required"),
    );
    mockGetJSON.mockResolvedValue(braveResponse);

    const response = await searchTool.execute!(
      { query: "test query" },
      { toolCallId: "call-fallback", messages: [] },
    );

    expect(response).toMatchObject({
      provider: "brave",
      results: [expect.objectContaining({ url: "https://brave.example.com" })],
    });
  });

  it("keeps 402 visible when Exa was requested explicitly", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    process.env.BRAVE_API_KEY = "test-brave-key";
    const failure = new HTTPError(402, "https://api.exa.ai/search", "Payment required");
    mockPostJSON.mockRejectedValue(failure);
    mockGetJSON.mockResolvedValue(braveResponse);

    await expect(
      searchTool.execute!(
        { query: "test query", provider: "exa" },
        { toolCallId: "call-explicit-402", messages: [] },
      ),
    ).rejects.toBe(failure);
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("execute falls back to searxng when no API keys set", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    mockGetJSON.mockResolvedValue(searxngResponse);

    const response = await searchTool.execute!(
      { query: "test query" },
      { toolCallId: "call-3", messages: [] },
    );

    expect(mockGetJSON).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      provider: "searxng",
      results: [expect.objectContaining({ url: "https://searxng.example.com" })],
    });
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

  it("passes Firecrawl sources and categories separately", async () => {
    process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";
    mockPostJSON.mockResolvedValue({ success: true, data: { web: [] } });

    await searchTool.execute!(
      {
        query: "test",
        provider: "firecrawl",
        sources: ["web", "news"],
        categories: ["developer"],
      },
      { toolCallId: "call-firecrawl-filters", messages: [] },
    );

    const [, body] = mockPostJSON.mock.calls[0];
    expect(body).toMatchObject({
      sources: ["web", "news"],
      categories: ["developer"],
    });
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

  it("reports a date filter ignored by an explicit provider", async () => {
    process.env.BRAVE_API_KEY = "test-brave-key";
    mockGetJSON.mockResolvedValue(braveResponse);

    const response = await searchTool.execute!(
      { query: "test", provider: "brave", startPublishedDate: "2024-01-01" },
      { toolCallId: "call-ignored-date", messages: [] },
    );

    expect(response).toMatchObject({
      provider: "brave",
      ignoredFilters: ["startPublishedDate"],
      undeclaredFilters: [],
      results: [expect.objectContaining({ url: "https://brave.example.com" })],
    });
  });

  it('passes filters through to searchAll with "all" provider', async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    process.env.BRAVE_API_KEY = "test-brave-key";
    mockPostJSON.mockResolvedValue(exaResponse);
    mockGetJSON.mockResolvedValue(braveResponse);

    const response = await searchTool.execute!(
      {
        query: "test",
        provider: "all",
        includeDomains: ["github.com"],
        startPublishedDate: "2024-01-01",
        maxResults: 5,
      },
      { toolCallId: "call-all-filters", messages: [] },
    );

    expect(response).toMatchObject({
      results: [
        expect.objectContaining({ provider: "exa" }),
        expect.objectContaining({ provider: "brave" }),
      ],
      filterReports: [
        {
          provider: "brave",
          ignoredFilters: ["includeDomains", "startPublishedDate"],
          undeclaredFilters: [],
        },
      ],
    });
    const [, body] = mockPostJSON.mock.calls[0];
    expect(body.includeDomains).toEqual(["github.com"]);
    expect(body.startPublishedDate).toBe("2024-01-01");
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

    const response = await searchTool.execute!(
      { query: "test", provider: "all" },
      { toolCallId: "call-5", messages: [] },
    );

    expect(response).toMatchObject({
      results: [
        expect.objectContaining({ url: "https://example.com", title: "Test Result" }),
        expect.objectContaining({ url: "https://brave.example.com", title: "Brave Result" }),
      ],
      filterReports: [],
    });
  });

  it('serializes provider errors from an "all" search', async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    process.env.BRAVE_API_KEY = "test-brave-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("SearXNG unavailable")));
    mockPostJSON.mockRejectedValue(new Error("Exa unavailable"));
    mockGetJSON.mockResolvedValue(braveResponse);

    const response = await searchTool.execute!(
      { query: "test", provider: "all" },
      { toolCallId: "call-all-partial", messages: [] },
    );

    expect(response).toMatchObject({
      results: [expect.objectContaining({ provider: "brave" })],
      errors: [{ provider: "exa", error: "Exa unavailable" }],
    });
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

describe("searchImageTool", () => {
  beforeEach(() => {
    mockGetJSON.mockReset();
    savedEnv.SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
    process.env.SERPAPI_API_KEY = "test-key";
  });

  afterEach(() => {
    if (savedEnv.SERPAPI_API_KEY === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = savedEnv.SERPAPI_API_KEY;
  });

  it("returns normalized Google Lens visual matches", async () => {
    mockGetJSON.mockResolvedValueOnce({
      search_metadata: { id: "lens-id", status: "Success" },
      visual_matches: [
        {
          position: 1,
          title: "Matching page",
          link: "https://example.com/page",
          source: "Example",
          image: "https://example.com/full.jpg",
          image_width: 1200,
          image_height: 900,
        },
      ],
    });

    const result = await searchImageTool.execute!(
      { url: "https://example.com/input.jpg", maxResults: 5 },
      { toolCallId: "search-image-call", messages: [] },
    );

    expect(result).toEqual([
      expect.objectContaining({
        pageUrl: "https://example.com/page",
        imageUrl: "https://example.com/full.jpg",
        provider: "serpapi",
        position: 1,
      }),
    ]);
    const requestUrl = new URL(String(mockGetJSON.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("engine")).toBe("google_lens");
    expect(requestUrl.searchParams.get("type")).toBe("visual_matches");
  });
});

describe("providersTool", () => {
  it("returns the loaded runtime identity with provider status", async () => {
    const result = await providersTool.execute!({}, { toolCallId: "providers-call", messages: [] });

    expect(result).toMatchObject({ runtime: runtimeInfo });
    expect(result.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "exa",
          searchFilters: [
            "includeDomains",
            "excludeDomains",
            "category",
            "startPublishedDate",
            "endPublishedDate",
          ],
        }),
      ]),
    );
  });
});

describe("readTool", () => {
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
  });

  it("rejects fractional read budgets at the schema boundary", async () => {
    const validate = asSchema(readTool.inputSchema).validate;
    if (!validate) throw new TypeError("Read schema has no validator");

    await expect(validate({ url: "https://example.com", maxTokens: 500 })).resolves.toMatchObject({
      success: true,
    });
    await expect(validate({ url: "https://example.com", maxTokens: 500.5 })).resolves.toMatchObject(
      { success: false },
    );
    await expect(validate({ url: "https://example.com", timeout: 30 })).resolves.toMatchObject({
      success: true,
    });
    await expect(validate({ url: "https://example.com", timeout: 30.5 })).resolves.toMatchObject({
      success: false,
    });
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

    const response = await readTool.execute!(
      { url: "https://example.com", format: "markdown" },
      { toolCallId: "read-call-1", messages: [] },
    );

    expect(response).toMatchObject({
      result: {
        title: "Read Result",
        url: "https://example.com/",
        content: "Read content",
      },
      requestedProvider: "auto",
      provider: "jina",
      attempts: ["jina"],
    });
    const [url, headers] = mockGetJSON.mock.calls[0];
    expect(url).toBe("https://r.jina.ai/https%3A%2F%2Fexample.com");
    expect(headers).toEqual({ Accept: "application/json", "X-Return-Format": "markdown" });
  });

  it("keeps requested and effective readers after automatic fallback", async () => {
    process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";
    mockGetJSON.mockRejectedValueOnce(
      new HTTPError(402, "https://r.jina.ai/https%3A%2F%2Fexample.com", "Payment required"),
    );
    mockPostJSON.mockResolvedValueOnce({
      success: true,
      data: {
        markdown: "Fallback content",
        metadata: { sourceURL: "https://example.com/" },
      },
    });

    const response = await readTool.execute!(
      { url: "https://example.com" },
      { toolCallId: "read-fallback", messages: [] },
    );

    expect(response).toMatchObject({
      result: { url: "https://example.com", content: "Fallback content" },
      requestedProvider: "auto",
      provider: "firecrawl",
      attempts: ["jina", "firecrawl"],
    });
  });

  it("returns provenance for every successful URL in a batch", async () => {
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

    expect(outcomes).toMatchObject([
      {
        url: "https://example.com/one",
        result: { url: "https://example.com/one", content: "First page" },
        requestedProvider: "auto",
        provider: "jina",
        attempts: ["jina"],
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
