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
  InvalidSearchContinuationError,
  RateLimitError,
} from "../../src/core/errors.ts";
import { ProviderFallbackError } from "../../src/core/fallback.ts";
import { searchBatch } from "../../src/core/batch.ts";
import {
  encodeSearchContinuation,
  MAX_PROVIDER_SEARCH_CONTINUATION_LENGTH,
  MAX_SEARCH_CONTINUATION_LENGTH,
} from "../../src/core/search-continuation.ts";

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

const firecrawlResponse = {
  success: true,
  id: "firecrawl-request",
  warning: "Partial coverage",
  creditsUsed: 2,
  data: {
    web: [
      {
        url: "https://firecrawl.example.com",
        title: "Firecrawl Result",
        description: "Firecrawl description",
      },
    ],
  },
};

const firecrawlMetadata = {
  id: "firecrawl-request",
  warning: "Partial coverage",
  creditsUsed: 2,
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
    expect(results).toEqual([
      expect.objectContaining({
        provider: "exa",
        providers: ["exa"],
        evidence: [expect.objectContaining({ provider: "exa", url: "https://a.com" })],
      }),
      expect.objectContaining({
        provider: "brave",
        providers: ["brave"],
        evidence: [expect.objectContaining({ provider: "brave", url: "https://b.com" })],
      }),
    ]);
  });

  it("caps deduplicated fanout results globally", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    mockPostJSON.mockResolvedValue({
      requestId: "test-req",
      results: [{ id: "1", url: "https://shared.com", title: "Shared result" }],
    });
    mockGetJSON.mockResolvedValue({
      web: {
        results: [
          {
            url: "https://shared.com",
            title: "Shared duplicate",
            description: "duplicate",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
          {
            url: "https://b.com",
            title: "Brave B",
            description: "result B",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
          {
            url: "https://c.com",
            title: "Brave C",
            description: "result C",
            extra_snippets: [],
            meta_url: { favicon: "" },
          },
        ],
      },
    });

    const results = await searchAll("test", {
      providers: ["exa", "brave"],
      maxResults: 2,
    });

    expect(results.map(({ url }) => url)).toEqual(["https://shared.com", "https://b.com"]);
  });

  it("keeps the first provider as representative and retains every duplicate", async () => {
    process.env.BRAVE_API_KEY = "test-brave";
    process.env.MOJEEK_API_KEY = "test-mojeek";

    mockGetJSON.mockImplementation(async (url) =>
      url.includes("api.search.brave.com")
        ? {
            web: {
              results: [
                {
                  url: "https://example.com",
                  title: "From Brave",
                  description: "Brave snippet",
                  extra_snippets: [],
                  meta_url: { favicon: "" },
                },
              ],
            },
          }
        : {
            response: {
              status: "OK",
              results: [
                {
                  url: "https://example.com",
                  title: "From Mojeek",
                  desc: "Mojeek snippet",
                  score: 20.36,
                  cfs: 47,
                },
              ],
            },
          },
    );

    const results = await searchAll("test", { providers: ["brave", "mojeek"] });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      provider: "brave",
      providers: ["brave", "mojeek"],
      title: "From Brave",
      evidence: [
        { provider: "brave", title: "From Brave", snippet: "Brave snippet" },
        {
          provider: "mojeek",
          title: "From Mojeek",
          score: 20.36,
          snippet: "Mojeek snippet",
          metadata: { confidence: 47 },
        },
      ],
    });
    expect(results[0].score).toBeUndefined();
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

  it("retains evidence when normalized query order collapses URLs", async () => {
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
    expect(results[0]).toMatchObject({
      provider: "exa",
      providers: ["exa", "brave"],
      score: 0.7,
      evidence: [
        { provider: "exa", title: "Exa result", score: 0.7 },
        { provider: "brave", title: "Brave result", snippet: "desc" },
      ],
    });
    expect(results[0].highlights).not.toBe(results[0].evidence[0].highlights);
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
    expect(response.providerPagination).toEqual([
      { provider: "exa", pagination: { status: "unsupported" } },
    ]);
  });

  it("keeps response metadata with provider provenance in fanout", async () => {
    process.env.FIRECRAWL_API_KEY = "test-firecrawl";
    mockPostJSON.mockResolvedValue(firecrawlResponse);

    const response = await searchAllDetailed("test", { providers: ["firecrawl"] });

    expect(response.providerMetadata).toEqual([
      { provider: "firecrawl", metadata: firecrawlMetadata },
    ]);
  });

  it("keeps response metadata beside explicit provider diagnostics", async () => {
    process.env.FIRECRAWL_API_KEY = "test-firecrawl";
    mockPostJSON.mockResolvedValue(firecrawlResponse);

    await expect(searchProviderDetailed("firecrawl", "test")).resolves.toMatchObject({
      provider: "firecrawl",
      metadata: firecrawlMetadata,
      ignoredFilters: [],
      undeclaredFilters: [],
    });
  });

  it("publishes bounds that accommodate provider-native continuation state", () => {
    const continuation = encodeSearchContinuation(
      "custom",
      "test",
      {},
      "x".repeat(MAX_PROVIDER_SEARCH_CONTINUATION_LENGTH),
    );

    expect(continuation.length).toBeLessThanOrEqual(MAX_SEARCH_CONTINUATION_LENGTH);
    expect(() =>
      encodeSearchContinuation(
        "custom",
        "test",
        {},
        "x".repeat(MAX_PROVIDER_SEARCH_CONTINUATION_LENGTH + 1),
      ),
    ).toThrow(InvalidSearchContinuationError);
  });

  it("returns and consumes an opaque continuation for one provider", async () => {
    process.env.BRAVE_API_KEY = "test-brave";
    mockGetJSON
      .mockResolvedValueOnce({
        query: { more_results_available: true },
        web: {
          results: [
            {
              url: "https://page-one.example",
              title: "Page one",
              description: "First page",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        query: { more_results_available: false },
        web: {
          results: [
            {
              url: "https://page-two.example",
              title: "Page two",
              description: "Second page",
            },
          ],
        },
      });

    const first = await searchProviderDetailed("brave", "test", { maxResults: 1 });

    expect(first.pagination.status).toBe("next");
    if (first.pagination.status !== "next") throw new Error("expected another page");
    expect(first.pagination.continuation).toBeTypeOf("string");

    const second = await searchProviderDetailed("brave", "test", {
      maxResults: 1,
      continuation: first.pagination.continuation,
    });

    expect(new URL(mockGetJSON.mock.calls[1][0]).searchParams.get("offset")).toBe("1");
    expect(second.results[0]?.url).toBe("https://page-two.example");
    expect(second.pagination).toEqual({ status: "end" });
  });

  it("continues one provider from a fanout token with the same default page size", async () => {
    process.env.BRAVE_API_KEY = "test-brave";
    mockGetJSON
      .mockResolvedValueOnce({
        query: { more_results_available: true },
        web: { results: [] },
      })
      .mockResolvedValueOnce({
        query: { more_results_available: false },
        web: { results: [] },
      });
    const fanout = await searchAllDetailed("test", { providers: ["brave"] });
    const page = fanout.providerPagination[0]?.pagination;
    if (page?.status !== "next") throw new Error("expected another page");

    const continued = await searchProviderDetailed("brave", "test", {
      continuation: page.continuation,
    });

    expect(new URL(mockGetJSON.mock.calls[1][0]).searchParams.get("offset")).toBe("1");
    expect(continued.pagination).toEqual({ status: "end" });
  });

  it("keeps uncertain provider paging distinct from an authoritative next page", async () => {
    mockGetJSON.mockResolvedValueOnce({
      results: [
        {
          title: "Result",
          url: "https://example.com",
          content: "Snippet",
          engine: "google",
          engines: ["google"],
          score: 1,
          category: "general",
        },
      ],
      query: "test",
    });

    const response = await searchProviderDetailed("searxng", "test");

    expect(response.pagination.status).toBe("unknown");
    if (response.pagination.status !== "unknown") throw new Error("expected uncertain paging");
    expect(response.pagination.continuation).toBeTypeOf("string");
  });

  it("rejects a continuation after the query changes without calling a provider", async () => {
    process.env.BRAVE_API_KEY = "test-brave";
    mockGetJSON.mockResolvedValueOnce({
      query: { more_results_available: true },
      web: { results: [] },
    });
    const first = await searchProviderDetailed("brave", "original", { maxResults: 1 });
    if (first.pagination.status !== "next") throw new Error("expected another page");

    await expect(
      searchProviderDetailed("brave", "changed", {
        maxResults: 1,
        continuation: first.pagination.continuation,
      }),
    ).rejects.toThrow(InvalidSearchContinuationError);
    expect(mockGetJSON).toHaveBeenCalledOnce();
  });

  it("rejects a recomputed token with provider state outside the accepted range before the request", async () => {
    process.env.MOJEEK_API_KEY = "test-mojeek";
    const continuation = encodeSearchContinuation("mojeek", "test", {}, "1001");

    await expect(searchProviderDetailed("mojeek", "test", { continuation })).rejects.toThrow(
      InvalidSearchContinuationError,
    );
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("rejects a corrupted continuation before calling a provider", async () => {
    process.env.BRAVE_API_KEY = "test-brave";
    mockGetJSON.mockResolvedValueOnce({
      query: { more_results_available: true },
      web: { results: [] },
    });
    const first = await searchProviderDetailed("brave", "test", { maxResults: 1 });
    if (first.pagination.status !== "next") throw new Error("expected another page");
    const index = Math.floor(first.pagination.continuation.length / 2);
    const current = first.pagination.continuation[index];
    const corrupted = `${first.pagination.continuation.slice(0, index)}${current === "A" ? "B" : "A"}${first.pagination.continuation.slice(index + 1)}`;

    await expect(
      searchProviderDetailed("brave", "test", { maxResults: 1, continuation: corrupted }),
    ).rejects.toThrow(InvalidSearchContinuationError);
    expect(mockGetJSON).toHaveBeenCalledOnce();
  });

  it("rejects one continuation for fanout and batch searches", async () => {
    process.env.BRAVE_API_KEY = "test-brave";
    mockGetJSON.mockResolvedValueOnce({
      query: { more_results_available: true },
      web: { results: [] },
    });
    const first = await searchProviderDetailed("brave", "test", { maxResults: 1 });
    if (first.pagination.status !== "next") throw new Error("expected another page");
    const continuation = first.pagination.continuation;

    await expect(
      searchAllDetailed("test", { providers: ["brave"], maxResults: 1, continuation }),
    ).rejects.toThrow("continuation is not supported with provider=all");
    await expect(
      searchBatch(["test"], { provider: "brave", maxResults: 1, continuation }),
    ).rejects.toThrow("continuation is only supported for a single query");
    expect(mockGetJSON).toHaveBeenCalledOnce();
  });

  it("defaults the global result cap to ten", async () => {
    process.env.EXA_API_KEY = "test-exa";
    mockPostJSON.mockResolvedValue({
      requestId: "test-req",
      results: Array.from({ length: 11 }, (_, index) => ({
        id: String(index),
        url: `https://${index}.com`,
        title: `Result ${index}`,
      })),
    });

    const response = await searchAllDetailed("test", { providers: ["exa"] });

    expect(response.results).toHaveLength(10);
  });

  it("reports providers that succeed without retained results", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    mockPostJSON.mockResolvedValue({
      requestId: "test-req",
      results: [{ id: "1", url: "https://example.com/same", title: "Exa result" }],
    });
    mockGetJSON.mockImplementation(async (url) =>
      url.includes("api.search.brave.com")
        ? {
            web: {
              results: [
                {
                  url: "https://example.com/same",
                  title: "Brave result",
                  description: "duplicate",
                  extra_snippets: [],
                  meta_url: { favicon: "" },
                },
              ],
            },
          }
        : { results: [] },
    );

    const response = await searchAllDetailed("test", {
      providers: ["exa", "brave", "searxng"],
    });

    expect(response.results).toHaveLength(1);
    expect(response.errors).toEqual([]);
    expect(response.successfulProviders).toEqual(["exa", "brave", "searxng"]);
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
  const savedFirecrawlApiKey = process.env.FIRECRAWL_API_KEY;

  beforeEach(() => {
    mockPostJSON.mockReset();
    mockGetJSON.mockReset();
    delete process.env.EXA_API_KEY;
    delete process.env.BRAVE_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
  });

  afterEach(() => {
    if (savedExaApiKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = savedExaApiKey;
    if (savedBraveApiKey === undefined) delete process.env.BRAVE_API_KEY;
    else process.env.BRAVE_API_KEY = savedBraveApiKey;
    if (savedFirecrawlApiKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = savedFirecrawlApiKey;
  });

  it("pins an automatic continuation to the provider that issued it", async () => {
    process.env.BRAVE_API_KEY = "test-brave";
    mockGetJSON.mockResolvedValueOnce({
      query: { more_results_available: true },
      web: { results: [] },
    });
    const first = await searchWithFallback("test", { maxResults: 1 });
    if (first.pagination.status !== "next") throw new Error("expected another page");

    process.env.EXA_API_KEY = "test-exa";
    mockGetJSON.mockResolvedValueOnce({
      query: { more_results_available: false },
      web: { results: [] },
    });
    const second = await searchWithFallback("test", {
      maxResults: 1,
      continuation: first.pagination.continuation,
    });

    expect(second).toMatchObject({
      provider: "brave",
      attempts: ["brave"],
      failures: [],
      pagination: { status: "end" },
    });
    expect(mockPostJSON).not.toHaveBeenCalled();
  });

  it("returns the provider and diagnostics after an automatic 402", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    const failure = new HTTPError(402, "https://api.exa.ai/search", "Payment required");
    mockPostJSON.mockRejectedValue(failure);
    mockGetJSON.mockResolvedValue(braveResponse);

    await expect(
      searchWithFallback("test", { startPublishedDate: "2024-01-01" }),
    ).resolves.toMatchObject({
      provider: "brave",
      results: [expect.objectContaining({ url: "https://b.com" })],
      ignoredFilters: ["startPublishedDate"],
      undeclaredFilters: [],
      attempts: ["exa", "brave"],
      failures: [{ provider: "exa", error: failure.message }],
    });
  });

  it("keeps response metadata from the provider selected after fallback", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.FIRECRAWL_API_KEY = "test-firecrawl";
    mockPostJSON.mockImplementation(async (url) => {
      if (url.includes("api.exa.ai")) {
        throw new HTTPError(402, url, "Payment required");
      }
      return firecrawlResponse;
    });

    await expect(searchWithFallback("test")).resolves.toMatchObject({
      provider: "firecrawl",
      metadata: firecrawlMetadata,
      results: [expect.objectContaining({ url: "https://firecrawl.example.com" })],
    });
  });

  it("falls back after network and rate-limit failures", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.FIRECRAWL_API_KEY = "test-firecrawl";
    process.env.BRAVE_API_KEY = "test-brave";
    const networkFailure = new HTTPError(0, "https://api.exa.ai/search", "Network error");
    const rateLimitFailure = new RateLimitError(30);
    mockPostJSON.mockRejectedValueOnce(networkFailure).mockResolvedValueOnce(firecrawlResponse);
    mockGetJSON.mockRejectedValueOnce(rateLimitFailure);

    await expect(searchWithFallback("test")).resolves.toMatchObject({
      provider: "firecrawl",
      attempts: ["exa", "brave", "firecrawl"],
      failures: [
        { provider: "exa", error: networkFailure.message },
        { provider: "brave", error: rateLimitFailure.message },
      ],
    });
  });

  it("retains every failure when automatic search exhausts its providers", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    const serverFailure = new HTTPError(503, "https://api.exa.ai/search", "Unavailable");
    const rateLimitFailure = new RateLimitError(30);
    mockPostJSON.mockRejectedValue(serverFailure);
    mockGetJSON.mockRejectedValue(rateLimitFailure);

    const failure = await searchWithFallback("test").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderFallbackError);
    expect(failure).toMatchObject({
      attempts: ["exa", "brave"],
      failures: [
        { provider: "exa", error: serverFailure.message },
        { provider: "brave", error: rateLimitFailure.message },
      ],
      cause: rateLimitFailure,
    });
    await expect(searchBatch(["test"])).resolves.toEqual([
      {
        query: "test",
        error: (failure as Error).message,
        attempts: ["exa", "brave"],
        failures: [
          { provider: "exa", error: serverFailure.message },
          { provider: "brave", error: rateLimitFailure.message },
        ],
      },
    ]);
  });

  it("keeps invalid requests strict in automatic mode", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    const failure = new HTTPError(400, "https://api.exa.ai/search", "Invalid request");
    mockPostJSON.mockRejectedValue(failure);
    mockGetJSON.mockResolvedValue(braveResponse);

    await expect(searchWithFallback("test")).rejects.toBe(failure);
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("retains earlier diagnostics when a later invalid request stops fallback", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    const transientFailure = new HTTPError(503, "https://api.exa.ai/search", "Unavailable");
    const strictFailure = new HTTPError(400, "https://api.search.brave.com", "Invalid request");
    mockPostJSON.mockRejectedValue(transientFailure);
    mockGetJSON.mockRejectedValue(strictFailure);

    const failure = await searchWithFallback("test").catch((error: unknown) => error);

    expect(failure).toMatchObject({
      attempts: ["exa", "brave"],
      failures: [
        { provider: "exa", error: transientFailure.message },
        { provider: "brave", error: strictFailure.message },
      ],
      cause: strictFailure,
    });
    await expect(searchBatch(["test"])).resolves.toEqual([
      {
        query: "test",
        error: (failure as Error).message,
        attempts: ["exa", "brave"],
        failures: [
          { provider: "exa", error: transientFailure.message },
          { provider: "brave", error: strictFailure.message },
        ],
      },
    ]);
  });

  it("keeps transient failures strict for explicit providers", async () => {
    process.env.EXA_API_KEY = "test-exa";
    process.env.BRAVE_API_KEY = "test-brave";
    const failure = new HTTPError(503, "https://api.exa.ai/search", "Unavailable");
    mockPostJSON.mockRejectedValue(failure);
    mockGetJSON.mockResolvedValue(braveResponse);

    await expect(searchProviderDetailed("exa", "test")).rejects.toBe(failure);
    expect(mockGetJSON).not.toHaveBeenCalled();
  });
});
