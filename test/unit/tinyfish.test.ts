import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetJSON =
  vi.fn<(url: string, headers?: Readonly<Record<string, string>>) => Promise<unknown>>();
const mockDefaultPostJSON =
  vi.fn<
    (
      url: string,
      body: Readonly<Record<string, unknown>>,
      headers?: Readonly<Record<string, string>>,
    ) => Promise<unknown>
  >();
const mockPostJSON =
  vi.fn<
    (
      url: string,
      body: Readonly<Record<string, unknown>>,
      headers?: Readonly<Record<string, string>>,
    ) => Promise<unknown>
  >();

const mockDefaultClient = {
  getJSON: mockGetJSON,
  postJSON: mockDefaultPostJSON,
  maxRetries: 5,
  baseDelay: 50,
  timeout: 30000,
  userAgent: "agntn-web/0.0.1",
};
const mockReadClient = {
  getJSON: vi.fn(),
  postJSON: mockPostJSON,
  maxRetries: 0,
  baseDelay: 50,
  timeout: 150000,
  userAgent: "agntn-web/0.0.1",
};

vi.mock("../../src/core/client.ts", () => ({
  Client: vi.fn(function ClientMock() {
    return mockReadClient;
  }),
  defaultClient: vi.fn(() => mockDefaultClient),
}));

import { Client } from "../../src/core/client.ts";
import { AuthError, HTTPError, InvalidProviderUrlError, WebError } from "../../src/core/errors.ts";
import { isPaginatedSearchProvider, isReadProvider } from "../../src/core/provider.ts";
import { createSearchProvider, has } from "../../src/core/registry.ts";
import type { ProviderConfig } from "../../src/core/types.ts";
import "../../src/providers/index.ts";

function createTinyfishProvider(config: Readonly<ProviderConfig> = {}) {
  const provider = createSearchProvider("tinyfish", config);
  if (!isReadProvider(provider)) {
    throw new Error("TinyFish provider must support URL reading");
  }
  return provider;
}

const searchResponse = {
  query: "web agents",
  total_results: 2,
  page: 0,
  results: [
    {
      position: 1,
      site_name: "example.com",
      title: "Web agents",
      snippet: "A result about web agents.",
      url: "https://example.com/agents",
      date: "2026-08-01",
      publisher: "Example",
    },
    {
      position: 2,
      site_name: "papers.example",
      title: "Agent research",
      snippet: "A research result.",
      url: "https://papers.example/agent",
      authors: ["Ada Example", "Lin Example"],
      venue: "AgentConf",
      year: 2026,
      cited_by_count: 12,
      pdf_url: "https://papers.example/agent.pdf",
    },
  ],
};

const fetchResponse = {
  results: [
    {
      url: "https://example.com/article",
      final_url: "https://www.example.com/article",
      title: "Example article",
      description: "An example page.",
      language: "en",
      author: "Ada Example",
      published_date: "2026-08-02",
      text: "# Example article\n\nPage content.",
      links: ["https://www.example.com/about"],
      image_links: ["https://www.example.com/hero.png"],
      unmatched_selectors: ["aside"],
      latency_ms: 42,
      format: "markdown",
    },
  ],
  errors: [],
};

describe("tinyfish provider", () => {
  beforeEach(() => {
    mockGetJSON.mockReset();
    mockDefaultPostJSON.mockReset();
    mockPostJSON.mockReset();
    mockGetJSON.mockResolvedValue(searchResponse);
    mockDefaultPostJSON.mockResolvedValue(fetchResponse);
    mockPostJSON.mockResolvedValue(fetchResponse);
    vi.mocked(Client).mockClear();
    delete process.env.TINYFISH_API_KEY;
  });

  it("registers itself on import", () => {
    expect(has("tinyfish")).toBe(true);
  });

  it("requires an API key", () => {
    expect(() => createTinyfishProvider()).toThrow(AuthError);
  });

  it("rejects non-HTTP fetch base URLs", () => {
    expect(() =>
      createTinyfishProvider({ apiKey: "tf-test-key", readBaseURL: "file:///etc/passwd" }),
    ).toThrow(InvalidProviderUrlError);
  });

  it("uses the Fetch API client timeout without retrying POST requests", () => {
    createTinyfishProvider({ apiKey: "tf-test-key" });

    expect(Client).toHaveBeenCalledWith({ maxRetries: 0, timeout: 150000 });
  });

  it("searches with TinyFish filters and API key auth", async () => {
    const provider = createTinyfishProvider({ apiKey: "tf-test-key" });

    const results = await provider.search("web agents", {
      maxResults: 1,
      includeDomains: ["example.com", "papers.example"],
      excludeDomains: ["social.example"],
      category: "news",
      startPublishedDate: "2026-08-01",
      endPublishedDate: "2026-08-31",
    });

    expect(mockGetJSON).toHaveBeenCalledOnce();
    const [url, headers] = mockGetJSON.mock.calls[0];
    const requestUrl = new URL(url);
    expect(requestUrl.origin).toBe("https://api.search.tinyfish.ai");
    expect(requestUrl.searchParams.get("query")).toBe("web agents");
    expect(requestUrl.searchParams.get("include_domains")).toBe("example.com,papers.example");
    expect(requestUrl.searchParams.get("exclude_domains")).toBe("social.example");
    expect(requestUrl.searchParams.get("domain_type")).toBe("news");
    expect(requestUrl.searchParams.get("after_date")).toBe("2026-08-01");
    expect(requestUrl.searchParams.get("before_date")).toBe("2026-08-31");
    expect(headers).toEqual({ "X-API-Key": "tf-test-key" });
    expect(results).toEqual([
      {
        url: "https://example.com/agents",
        title: "Web agents",
        snippet: "A result about web agents.",
        publishedDate: "2026-08-01",
        metadata: { position: 1, siteName: "example.com", publisher: "Example" },
      },
    ]);
  });

  it("continues with TinyFish page state and stops at its documented maximum", async () => {
    const provider = createTinyfishProvider({ apiKey: "tf-test-key" });
    if (!isPaginatedSearchProvider(provider)) throw new Error("TinyFish must paginate");

    const first = await provider.searchPage("web agents");
    mockGetJSON.mockResolvedValueOnce({ ...searchResponse, page: 10 });
    const last = await provider.searchPage("web agents", undefined, "10");

    expect(first.continuation).toBe("1");
    expect(first.continuationStatus).toBe("unknown");
    expect(new URL(mockGetJSON.mock.calls[1][0]).searchParams.get("page")).toBe("10");
    expect(last.continuation).toBeUndefined();
  });

  it("preserves research metadata", async () => {
    const provider = createTinyfishProvider({ apiKey: "tf-test-key" });

    const results = await provider.search("agent research", {
      category: "research_paper",
      startPublishedDate: "2020-01-01",
      endPublishedDate: "2026-12-31",
    });

    const [url] = mockGetJSON.mock.calls[0];
    const params = new URL(url).searchParams;
    expect(params.get("pub_year_min")).toBe("2020");
    expect(params.get("pub_year_max")).toBe("2026");
    expect(params.has("after_date")).toBe(false);
    expect(params.has("before_date")).toBe(false);
    expect(results[1]).toEqual({
      url: "https://papers.example/agent",
      title: "Agent research",
      snippet: "A research result.",
      author: "Ada Example, Lin Example",
      metadata: {
        position: 2,
        siteName: "papers.example",
        authors: ["Ada Example", "Lin Example"],
        venue: "AgentConf",
        year: 2026,
        citedByCount: 12,
        pdfUrl: "https://papers.example/agent.pdf",
      },
    });
  });

  it("fetches page content with normalized read options", async () => {
    const provider = createTinyfishProvider({ apiKey: "tf-test-key" });

    const result = await provider.read("https://example.com/article", {
      format: "text",
      targetSelector: "main",
      removeSelector: "nav",
      timeout: 30,
      noCache: true,
    });

    expect(mockDefaultPostJSON).not.toHaveBeenCalled();
    expect(mockPostJSON).toHaveBeenCalledOnce();
    const [url, body, headers] = mockPostJSON.mock.calls[0];
    expect(url).toBe("https://api.fetch.tinyfish.ai");
    expect(body).toEqual({
      urls: ["https://example.com/article"],
      format: "markdown",
      links: true,
      image_links: true,
      ttl: 0,
      per_url_timeout_ms: 30000,
      include_selectors: ["main"],
      exclude_selectors: ["nav"],
    });
    expect(headers).toEqual({ "X-API-Key": "tf-test-key" });
    expect(result).toEqual({
      url: "https://www.example.com/article",
      title: "Example article",
      description: "An example page.",
      content: "# Example article\n\nPage content.",
      publishedDate: "2026-08-02",
      image: "https://www.example.com/hero.png",
      links: ["https://www.example.com/about"],
      images: ["https://www.example.com/hero.png"],
      metadata: {
        originalUrl: "https://example.com/article",
        language: "en",
        author: "Ada Example",
        format: "markdown",
        latencyMs: 42,
        unmatchedSelectors: ["aside"],
      },
    });
  });

  it("maps HTML and bounds TinyFish fetch controls", async () => {
    mockPostJSON.mockResolvedValueOnce({
      results: [
        {
          url: "https://example.com",
          final_url: "https://example.com",
          text: "<main>Example</main>",
          format: "html",
        },
      ],
      errors: [],
    });
    const provider = createTinyfishProvider({ apiKey: "tf-test-key" });

    const result = await provider.read("https://example.com", { format: "html", timeout: 200 });

    expect(mockPostJSON.mock.calls[0]?.[1]).toMatchObject({
      format: "html",
      per_url_timeout_ms: 110000,
    });
    expect(mockPostJSON.mock.calls[0]?.[1]).not.toHaveProperty("ttl");
    expect(result.html).toBe("<main>Example</main>");
  });

  it("keeps direct library timeouts inside the Fetch API range", async () => {
    const provider = createTinyfishProvider({ apiKey: "tf-test-key" });

    await provider.read("https://example.com", { timeout: 0 });

    expect(mockPostJSON.mock.calls[0]?.[1]).toMatchObject({ per_url_timeout_ms: 1 });
  });

  it("surfaces a per-URL fetch failure", async () => {
    mockPostJSON.mockResolvedValueOnce({
      results: [],
      errors: [
        {
          url: "https://example.com",
          error: "selector_not_matched",
          candidate_selectors: ["main", "#content"],
        },
      ],
    });
    const provider = createTinyfishProvider({ apiKey: "tf-test-key" });

    await expect(provider.read("https://example.com?token=secret-value")).rejects.toMatchObject({
      name: "WebError",
      message:
        'TinyFish fetch failed: selector_not_matched; candidate selectors: ["main","#content"]',
    } satisfies Partial<WebError>);
  });

  it("preserves page-not-found status", async () => {
    mockPostJSON.mockResolvedValueOnce({
      results: [],
      errors: [{ url: "https://example.com/missing", error: "page_not_found", status: 404 }],
    });
    const provider = createTinyfishProvider({ apiKey: "tf-test-key" });

    await expect(provider.read("https://example.com/missing")).rejects.toMatchObject({
      name: "HTTPError",
      statusCode: 404,
    } satisfies Partial<HTTPError>);
  });
});
