import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  searchAll,
  searchAllDetailed,
  searchProviderDetailed,
  searchWithFallback,
} from "../../src/core/all.ts";
import {
  UnknownProviderError,
  NoProviderConfiguredError,
  EmptyQueryError,
  HTTPError,
  InvalidDateFilterError,
} from "../../src/core/errors.ts";

import "../../src/providers/index.ts";

const exaResponse = {
  requestId: "test-req",
  results: [
    {
      id: "1",
      url: "https://a.com",
      title: "Exa Result",
      score: 0.9,
      text: "Exa text",
      highlights: ["Exa highlight"],
    },
  ],
};

const braveResponse = {
  web: {
    results: [
      {
        url: "https://b.com",
        title: "Brave Result",
        description: "Brave description",
        extra_snippets: [],
        meta_url: { favicon: "https://b.com/favicon.ico" },
      },
    ],
  },
};

describe("searchAll", () => {
  beforeEach(() => {
    mockPostJSON.mockReset();
    mockGetJSON.mockReset();
    delete process.env.EXA_API_KEY;
    delete process.env.BRAVE_API_KEY;
    delete process.env.CONTEXT_DEV_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.JINA_API_KEY;
    delete process.env.MOJEEK_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.TINYFISH_API_KEY;
    delete process.env.SERPAPI_API_KEY;
    delete process.env.SERPBASE_API_KEY;
  });

  it("queries multiple providers and merges results", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    mockPostJSON.mockResolvedValue(exaResponse);
    mockGetJSON.mockResolvedValue(braveResponse);

    const results = await searchAll("test", { providers: ["exa", "brave"] });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.provider)).toContain("exa");
    expect(results.map((r) => r.provider)).toContain("brave");
  });

  it("deduplicates by URL keeping higher score", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";

    mockPostJSON.mockResolvedValue({
      requestId: "test-req",
      results: [
        {
          id: "1",
          url: "https://example.com",
          title: "From Exa",
          score: 0.9,
          text: "text",
          highlights: ["highlight"],
        },
      ],
    });

    mockGetJSON.mockResolvedValue({
      web: {
        results: [
          {
            url: "https://example.com",
            title: "From Brave",
            description: "desc",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
        ],
      },
    });

    const results = await searchAll("test", { providers: ["exa", "brave"] });

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("exa");
    expect(results[0].score).toBe(0.9);
  });

  it("handles provider failures gracefully", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";

    mockPostJSON.mockRejectedValue(new Error("exa down"));
    mockGetJSON.mockResolvedValue(braveResponse);

    const results = await searchAll("test", { providers: ["exa", "brave"] });

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("brave");
  });

  it("detects available providers from env", async () => {
    process.env.BRAVE_API_KEY = "test-brave";
    mockGetJSON.mockResolvedValue(braveResponse);

    const results = await searchAll("test");

    expect(results.length).toBeGreaterThanOrEqual(1);
    const providers = results.map((r) => r.provider);
    expect(providers).toContain("brave");
  });

  it("normalizes URLs for dedup (trailing slash)", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";

    mockPostJSON.mockResolvedValue({
      requestId: "test-req",
      results: [
        {
          id: "1",
          url: "https://example.com/page/",
          title: "With slash",
          score: 0.5,
          text: "text",
          highlights: ["hl"],
        },
      ],
    });

    mockGetJSON.mockResolvedValue({
      web: {
        results: [
          {
            url: "https://example.com/page",
            title: "Without slash",
            description: "desc",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
        ],
      },
    });

    const results = await searchAll("test", { providers: ["exa", "brave"] });

    expect(results).toHaveLength(1);
  });

  it("deduplicates URLs when query parameter order differs", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";

    mockPostJSON.mockResolvedValue({
      requestId: "test-req",
      results: [
        {
          id: "1",
          url: "https://example.com/page?a=1&b=2",
          title: "Ordered A then B",
          score: 0.8,
          text: "text",
          highlights: ["hl"],
        },
      ],
    });

    mockGetJSON.mockResolvedValue({
      web: {
        results: [
          {
            url: "https://example.com/page?b=2&a=1",
            title: "Ordered B then A",
            description: "desc",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
        ],
      },
    });

    const results = await searchAll("test", { providers: ["exa", "brave"] });

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("exa");
  });

  it("ignores all utm_* params regardless of suffix or case", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";

    mockPostJSON.mockResolvedValue({
      requestId: "test-req",
      results: [
        {
          id: "1",
          url: "https://example.com/page?a=1&utm_id=xyz&utm_source=newsletter",
          title: "Exa with tracking params",
          score: 0.9,
          text: "text",
          highlights: ["hl"],
        },
      ],
    });

    mockGetJSON.mockResolvedValue({
      web: {
        results: [
          {
            url: "https://example.com/page?a=1&UTM_MEDIUM=email",
            title: "Brave with tracking params",
            description: "desc",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
        ],
      },
    });

    const results = await searchAll("test", { providers: ["exa", "brave"] });

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("exa");
  });

  it("does not deduplicate URLs when duplicate-key value order differs", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";

    mockPostJSON.mockResolvedValue({
      requestId: "test-req",
      results: [
        {
          id: "1",
          url: "https://example.com/page?tag=a&tag=b",
          title: "Ordered tags A then B",
          score: 0.8,
          text: "text",
          highlights: ["hl"],
        },
      ],
    });

    mockGetJSON.mockResolvedValue({
      web: {
        results: [
          {
            url: "https://example.com/page?tag=b&tag=a",
            title: "Ordered tags B then A",
            description: "desc",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
        ],
      },
    });

    const results = await searchAll("test", { providers: ["exa", "brave"] });

    expect(results).toHaveLength(2);
  });

  it("keeps scored result over unscored duplicate", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";

    mockPostJSON.mockResolvedValue({
      requestId: "test-req",
      results: [
        {
          id: "1",
          url: "https://example.com/page?b=2&a=1",
          title: "Exa result",
          score: 0.7,
          text: "text",
          highlights: ["hl"],
        },
      ],
    });

    mockGetJSON.mockResolvedValue({
      web: {
        results: [
          {
            url: "https://example.com/page?a=1&b=2",
            title: "Brave result",
            description: "desc",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
        ],
      },
    });

    const results = await searchAll("test", { providers: ["exa", "brave"] });

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("exa");
    expect(results[0].score).toBe(0.7);
  });

  it("keeps first provider result when duplicate URLs have no scores", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";

    mockPostJSON.mockResolvedValue({
      requestId: "test-req",
      results: [
        {
          id: "1",
          url: "https://example.com/page?b=2&a=1",
          title: "Exa no score",
          text: "text",
          highlights: ["hl"],
        },
      ],
    });

    mockGetJSON.mockResolvedValue({
      web: {
        results: [
          {
            url: "https://example.com/page?a=1&b=2",
            title: "Brave no score",
            description: "desc",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
        ],
      },
    });

    const results = await searchAll("test", { providers: ["exa", "brave"] });

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe("exa");
  });

  it("returns empty array when all providers fail", async () => {
    mockGetJSON.mockRejectedValue(new Error("searxng down"));

    const results = await searchAll("test", { providers: ["searxng"] });

    expect(results).toEqual([]);
  });

  it("throws UnknownProviderError for explicit unknown providers", async () => {
    await expect(searchAll("test", { providers: ["not-real-provider"] })).rejects.toThrow(
      UnknownProviderError,
    );
  });

  it("throws NoProviderConfiguredError when explicit providers list is empty", async () => {
    await expect(searchAll("test", { providers: [] })).rejects.toThrow(NoProviderConfiguredError);
  });

  it("throws EmptyQueryError for empty string query", async () => {
    await expect(searchAll("", { providers: ["exa"] })).rejects.toThrow(EmptyQueryError);

    expect(mockPostJSON).not.toHaveBeenCalled();
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("throws EmptyQueryError for whitespace-only query", async () => {
    await expect(searchAll("   ", { providers: ["exa"] })).rejects.toThrow(EmptyQueryError);

    expect(mockPostJSON).not.toHaveBeenCalled();
    expect(mockGetJSON).not.toHaveBeenCalled();
  });
});

describe("searchAllDetailed", () => {
  beforeEach(() => {
    mockPostJSON.mockReset();
    mockGetJSON.mockReset();
    delete process.env.EXA_API_KEY;
    delete process.env.BRAVE_API_KEY;
    delete process.env.CONTEXT_DEV_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.JINA_API_KEY;
    delete process.env.MOJEEK_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.TINYFISH_API_KEY;
    delete process.env.SERPAPI_API_KEY;
    delete process.env.SERPBASE_API_KEY;
  });

  it("returns results and empty errors when all providers succeed", async () => {
    process.env.EXA_API_KEY = "test-exa";
    mockPostJSON.mockResolvedValue(exaResponse);

    const response = await searchAllDetailed("test", { providers: ["exa"] });

    expect(response.results).toHaveLength(1);
    expect(response.errors).toHaveLength(0);
    expect(response.filterReports).toEqual([]);
  });

  it("reports ignored filters per successful provider", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    mockPostJSON.mockResolvedValue(exaResponse);
    mockGetJSON.mockResolvedValue(braveResponse);

    const response = await searchAllDetailed("test", {
      providers: ["exa", "brave"],
      startPublishedDate: "2024-01-01",
    });

    expect(response.filterReports).toEqual([
      {
        provider: "brave",
        ignoredFilters: ["startPublishedDate"],
        undeclaredFilters: [],
      },
    ]);
  });

  it("reports Firecrawl source and category filters separately", async () => {
    process.env.FIRECRAWL_API_KEY = "test-firecrawl";
    mockPostJSON.mockResolvedValue({ success: true, data: { web: [] } });

    await expect(
      searchProviderDetailed("firecrawl", "test", {
        sources: ["news"],
        categories: ["developer"],
      }),
    ).resolves.toMatchObject({ ignoredFilters: [], undeclaredFilters: [] });
    await expect(
      searchProviderDetailed("firecrawl", "test", { category: "developer" }),
    ).resolves.toMatchObject({ ignoredFilters: ["category"], undeclaredFilters: [] });
  });

  it("reports value-limited category support", async () => {
    process.env.JINA_API_KEY = "test-jina";
    mockGetJSON.mockResolvedValue({ code: 200, status: 20000, data: [] });

    await expect(
      searchProviderDetailed("jina", "test", { category: "general" }),
    ).resolves.toMatchObject({
      provider: "jina",
      ignoredFilters: ["category"],
      undeclaredFilters: [],
    });
    await expect(
      searchProviderDetailed("jina", "test", { category: "news" }),
    ).resolves.toMatchObject({ ignoredFilters: [], undeclaredFilters: [] });
  });

  it("reports failed providers in errors array", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";

    mockPostJSON.mockRejectedValue(new Error("exa auth failed"));
    mockGetJSON.mockResolvedValue(braveResponse);

    const response = await searchAllDetailed("test", { providers: ["exa", "brave"] });

    expect(response.results).toHaveLength(1);
    expect(response.results[0].provider).toBe("brave");
    expect(response.errors).toHaveLength(1);
    expect(response.errors[0].provider).toBe("exa");
    expect(response.errors[0].error.message).toBe("exa auth failed");
  });

  it("reports all providers as errors when all fail", async () => {
    mockGetJSON.mockRejectedValue(new Error("searxng down"));

    const response = await searchAllDetailed("test", { providers: ["searxng"] });

    expect(response.results).toHaveLength(0);
    expect(response.errors).toHaveLength(1);
    expect(response.errors[0].provider).toBe("searxng");
  });

  it("wraps non-Error rejections in Error objects", async () => {
    mockGetJSON.mockRejectedValue("string rejection");

    const response = await searchAllDetailed("test", { providers: ["searxng"] });

    expect(response.errors).toHaveLength(1);
    expect(response.errors[0].error).toBeInstanceOf(Error);
    expect(response.errors[0].error.message).toBe("string rejection");
  });

  it("throws InvalidDateFilterError for malformed startPublishedDate", async () => {
    await expect(
      searchAllDetailed("test", { providers: ["searxng"], startPublishedDate: "not-a-date" }),
    ).rejects.toThrow(InvalidDateFilterError);

    expect(mockPostJSON).not.toHaveBeenCalled();
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("throws InvalidDateFilterError for malformed endPublishedDate", async () => {
    await expect(
      searchAllDetailed("test", { providers: ["searxng"], endPublishedDate: "13/01/2024" }),
    ).rejects.toThrow(InvalidDateFilterError);
  });

  it("throws InvalidDateFilterError when start is after end", async () => {
    await expect(
      searchAllDetailed("test", {
        providers: ["searxng"],
        startPublishedDate: "2025-06-01",
        endPublishedDate: "2025-01-01",
      }),
    ).rejects.toThrow(InvalidDateFilterError);
  });

  it("accepts valid ISO 8601 date strings", async () => {
    mockGetJSON.mockResolvedValue({ results: [] });

    await expect(
      searchAllDetailed("test", {
        providers: ["searxng"],
        startPublishedDate: "2024-01-01",
        endPublishedDate: "2024-12-31",
      }),
    ).resolves.toBeDefined();
  });

  it("accepts ISO 8601 datetime with timezone", async () => {
    mockGetJSON.mockResolvedValue({ results: [] });

    await expect(
      searchAllDetailed("test", {
        providers: ["searxng"],
        startPublishedDate: "2024-01-01T00:00:00Z",
        endPublishedDate: "2024-12-31T23:59:59+02:00",
      }),
    ).resolves.toBeDefined();
  });
});

describe("searchWithFallback", () => {
  const savedExaApiKey = process.env.EXA_API_KEY;
  const savedBraveApiKey = process.env.BRAVE_API_KEY;

  beforeEach(() => {
    mockPostJSON.mockReset();
    mockGetJSON.mockReset();
    delete process.env.EXA_API_KEY;
    delete process.env.BRAVE_API_KEY;
  });

  afterEach(() => {
    if (savedExaApiKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = savedExaApiKey;
    if (savedBraveApiKey === undefined) delete process.env.BRAVE_API_KEY;
    else process.env.BRAVE_API_KEY = savedBraveApiKey;
  });

  it("returns the provider that succeeds after an automatic 402", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    mockPostJSON.mockRejectedValue(
      new HTTPError(402, "https://api.exa.ai/search", "Payment required"),
    );
    mockGetJSON.mockResolvedValue(braveResponse);

    await expect(
      searchWithFallback("test", { startPublishedDate: "2024-01-01" }),
    ).resolves.toMatchObject({
      provider: "brave",
      results: [expect.objectContaining({ url: "https://b.com" })],
      ignoredFilters: ["startPublishedDate"],
      undeclaredFilters: [],
    });
  });

  it("does not hide a non-payment failure from the first provider", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    const failure = new HTTPError(500, "https://api.exa.ai/search", "Server error");
    mockPostJSON.mockRejectedValue(failure);
    mockGetJSON.mockResolvedValue(braveResponse);

    await expect(searchWithFallback("test")).rejects.toBe(failure);
    expect(mockGetJSON).not.toHaveBeenCalled();
  });
});
