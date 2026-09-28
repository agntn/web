import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
      signal?: Readonly<AbortSignal>,
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
import {
  AuthError,
  HTTPError,
  InvalidProviderUrlError,
  PageFetchError,
  WebError,
} from "../../src/core/errors.ts";
import { isFallbackEligible } from "../../src/core/fallback.ts";
import { isPaginatedSearchProvider, isReadProvider } from "../../src/core/provider.ts";
import { createSearchProvider, has } from "../../src/core/registry.ts";
import type { ProviderConfig } from "../../src/core/types.ts";

async function createTinyfishProvider(config: Readonly<ProviderConfig> = {}) {
  const provider = await createSearchProvider("tinyfish", config);
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

  it("is listed without loading the adapter", () => {
    expect(has("tinyfish")).toBe(true);
  });

  it("requires an API key", async () => {
    await expect(createTinyfishProvider()).rejects.toThrow(AuthError);
  });

  it("rejects non-HTTP fetch base URLs", async () => {
    await expect(
      createTinyfishProvider({ apiKey: "tf-test-key", readBaseURL: "file:///etc/passwd" }),
    ).rejects.toThrow(InvalidProviderUrlError);
  });

  it("uses the Fetch API client timeout without retrying POST requests", async () => {
    await createTinyfishProvider({ apiKey: "tf-test-key" });

    expect(Client).toHaveBeenCalledWith({ maxRetries: 0, timeout: 150000 });
  });

  it("searches with TinyFish filters and API key auth", async () => {
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

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

  it.each([
    [
      "news",
      "2026-06-02T01:00:00+05:00",
      "2026-06-01T23:00:00Z",
      "after_date",
      "before_date",
      "2026-06-01",
    ],
    [
      "research_paper",
      "2026-01-01T01:00:00+05:00",
      "2025-12-31T23:00:00Z",
      "pub_year_min",
      "pub_year_max",
      "2025",
    ],
  ])(
    "takes the %s bounds in UTC, so offsets cannot flip the window",
    async (category, startPublishedDate, endPublishedDate, startParam, endParam, expected) => {
      const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });
      await provider.search("web agents", { category, startPublishedDate, endPublishedDate });

      const params = new URL(mockGetJSON.mock.calls[0][0]).searchParams;
      expect(params.get(startParam)).toBe(expected);
      expect(params.get(endParam)).toBe(expected);
    },
  );

  it("continues with TinyFish page state and stops at its documented maximum", async () => {
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });
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
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

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
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

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
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

    const result = await provider.read("https://example.com", { format: "html", timeout: 200 });

    expect(mockPostJSON.mock.calls[0]?.[1]).toMatchObject({
      format: "html",
      per_url_timeout_ms: 110000,
    });
    expect(mockPostJSON.mock.calls[0]?.[1]).not.toHaveProperty("ttl");
    expect(result.html).toBe("<main>Example</main>");
  });

  it("skips link extraction when the caller turns the list off", async () => {
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

    await provider.read("https://example.com/article", { links: false });

    expect(mockPostJSON.mock.calls[0]?.[1]).toMatchObject({
      links: false,
      image_links: true,
    });
  });

  it("keeps direct library timeouts inside the Fetch API range", async () => {
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

    await provider.read("https://example.com", { timeout: 0 });

    expect(mockPostJSON.mock.calls[0]?.[1]).toMatchObject({ per_url_timeout_ms: 1 });
  });

  it("reads a plain-text file from the document tree", async () => {
    const source = "#include <pubkey.h>\n#include <script/script.h>\n\nint main() {}\n";
    mockPostJSON
      .mockResolvedValueOnce({
        results: [
          {
            url: "https://example.com/main.cpp",
            title: null,
            description: null,
            language: null,
            text: "#include \n#include",
            format: "markdown",
          },
        ],
        errors: [],
      })
      .mockResolvedValueOnce({
        results: [
          {
            url: "https://example.com/main.cpp",
            text: { type: "document", children: [{ type: "code", text: source }] },
            format: "json",
          },
        ],
        errors: [],
      });
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });
    const signal = new AbortController().signal;

    const result = await provider.read("https://example.com/main.cpp", { noCache: true, signal });

    expect(mockPostJSON.mock.calls[1]?.[3]).toBe(signal);
    expect(mockPostJSON.mock.calls[1]?.[1]).toEqual({
      urls: ["https://example.com/main.cpp"],
      format: "json",
      links: false,
      image_links: false,
      ttl: 0,
    });
    expect(result.content).toBe(source);
  });

  it("reads a plain-text file whole as escaped HTML", async () => {
    const source = '\n#include <script/sign.h>\n\nint f() { return a < b && c > "d"; }\n';
    mockPostJSON
      .mockResolvedValueOnce({
        results: [{ url: "https://example.com/sign.cpp", text: "#include", format: "html" }],
        errors: [],
      })
      .mockResolvedValueOnce({
        results: [
          {
            url: "https://example.com/sign.cpp",
            text: { type: "document", children: [{ type: "code", text: source }] },
            format: "json",
          },
        ],
        errors: [],
      });
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

    const result = await provider.read("https://example.com/sign.cpp", { format: "html" });

    expect(mockPostJSON.mock.calls[1]?.[1]).toMatchObject({ format: "json" });
    const html =
      '<pre>\n\n#include &lt;script/sign.h&gt;\n\nint f() { return a &lt; b &amp;&amp; c &gt; "d"; }\n</pre>';
    expect(result.html).toBe(html);
    expect(result.content).toBe(html);
  });

  it("keeps the Markdown of an untitled page that is not one code block", async () => {
    mockPostJSON
      .mockResolvedValueOnce({
        results: [{ url: "https://example.com", text: "Hello **world**", format: "markdown" }],
        errors: [],
      })
      .mockResolvedValueOnce({
        results: [
          {
            url: "https://example.com",
            text: { type: "document", children: [{ type: "paragraph", text: "Hello world" }] },
            format: "json",
          },
        ],
        errors: [],
      });
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

    const result = await provider.read("https://example.com");

    expect(result.content).toBe("Hello **world**");
  });

  it("keeps the Markdown when the document tree request fails", async () => {
    mockPostJSON
      .mockResolvedValueOnce({
        results: [{ url: "https://example.com", text: "Hello **world**", format: "markdown" }],
        errors: [],
      })
      .mockRejectedValueOnce(new HTTPError(503, "https://api.fetch.tinyfish.ai", "unavailable"));
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

    const result = await provider.read("https://example.com");

    expect(result.content).toBe("Hello **world**");
  });

  it("stops at the document tree once the caller aborts", async () => {
    const controller = new AbortController();
    mockPostJSON
      .mockResolvedValueOnce({
        results: [{ url: "https://example.com", text: "Hello **world**", format: "markdown" }],
        errors: [],
      })
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new DOMException("This operation was aborted", "AbortError");
      });
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

    await expect(
      provider.read("https://example.com", { signal: controller.signal }),
    ).rejects.toThrow();
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
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

    await expect(provider.read("https://example.com?token=secret-value")).rejects.toMatchObject({
      name: "WebError",
      message:
        'TinyFish fetch failed: selector_not_matched; candidate selectors: ["main","#content"]',
    } satisfies Partial<WebError>);
  });

  it.each([
    ["timeout", undefined],
    ["bot_blocked", undefined],
    ["login_required", undefined],
    ["target_http_error", 401],
    ["target_unreachable", undefined],
    ["empty_content", undefined],
    ["content_too_large", undefined],
    ["proxy_error", undefined],
  ])("lets an automatic read try the next reader after %s", async (code, status) => {
    mockPostJSON.mockResolvedValueOnce({
      results: [],
      errors: [{ url: "https://example.com", error: code, ...(status ? { status } : {}) }],
    });
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });
    const failure = await provider.read("https://example.com").catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(PageFetchError);
    expect(failure).toMatchObject({
      message: `TinyFish fetch failed: ${code}${status ? ` (HTTP ${status})` : ""}`,
    });
    expect(isFallbackEligible(failure, "tinyfish", "read")).toBe(true);
  });

  it.each([
    "invalid_url",
    "invalid_redirect_url",
    "selector_not_matched",
    "selector_unsupported",
    "conditional_unsupported",
    "an_unknown_code",
  ])("stops an automatic read on %s", async (code) => {
    mockPostJSON.mockResolvedValueOnce({
      results: [],
      errors: [{ url: "https://example.com", error: code }],
    });
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });
    const failure = await provider.read("https://example.com").catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(WebError);
    expect(failure).not.toBeInstanceOf(PageFetchError);
    expect(isFallbackEligible(failure, "tinyfish", "read")).toBe(false);
  });

  it("preserves page-not-found status", async () => {
    mockPostJSON.mockResolvedValueOnce({
      results: [],
      errors: [{ url: "https://example.com/missing", error: "page_not_found", status: 404 }],
    });
    const provider = await createTinyfishProvider({ apiKey: "tf-test-key" });

    await expect(provider.read("https://example.com/missing")).rejects.toMatchObject({
      name: "HTTPError",
      statusCode: 404,
    } satisfies Partial<HTTPError>);
  });
});
