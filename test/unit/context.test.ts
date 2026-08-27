import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetJSON =
  vi.fn<(url: string, headers?: Readonly<Record<string, string>>) => Promise<unknown>>();
const mockPostJSON =
  vi.fn<
    (
      url: string,
      body: Readonly<Record<string, unknown>>,
      headers?: Readonly<Record<string, string>>,
    ) => Promise<unknown>
  >();

const mockClient = {
  getJSON: mockGetJSON,
  postJSON: mockPostJSON,
  maxRetries: 5,
  baseDelay: 50,
  timeout: 30000,
  userAgent: "agntn-web/0.0.1",
};

vi.mock("../../src/core/client.ts", () => ({
  Client: vi.fn(function ClientMock() {
    return mockClient;
  }),
  defaultClient: vi.fn(() => mockClient),
}));

import { Client } from "../../src/core/client.ts";
import { AuthError } from "../../src/core/errors.ts";
import { isReadProvider } from "../../src/core/provider.ts";
import { createSearchProvider, has } from "../../src/core/registry.ts";
import type { ProviderConfig } from "../../src/core/types.ts";
import "../../src/providers/context.ts";

function createContextProvider(config: Readonly<ProviderConfig> = {}) {
  const provider = createSearchProvider("context", config);
  if (!isReadProvider(provider)) {
    throw new Error("Context.dev provider must support URL reading");
  }
  return provider;
}

const searchResponse = {
  query: "web agents",
  results: [
    {
      url: "https://example.com/agents",
      title: "Web agents",
      description: "A result about web agents.",
      relevance: "high",
      markdown: {
        markdown: "# Web agents\n\nPage content.",
        code: "SUCCESS",
      },
    },
    {
      url: "https://example.com/other",
      title: "Another result",
      description: "Another page.",
      relevance: "medium",
      markdown: { markdown: null, code: "NOT_REQUESTED" },
    },
  ],
  cache_metadata: { status: "miss", age_ms: 0 },
};

const readResponse = {
  success: true,
  markdown: "# Example article\n\nPage content.",
  html: "<main><h1>Example article</h1><p>Page content.</p></main>",
  contentLength: 32,
  url: "https://example.com/article",
  metadata: {
    sourceUrl: "https://example.com/article",
    finalUrl: "https://www.example.com/article",
    title: "Example article",
    description: "An example page.",
    language: "en",
    image: "https://www.example.com/hero.png",
    publishedTime: "2026-08-02",
  },
  cache_metadata: { status: "hit", age_ms: 42 },
  key_metadata: { credits_consumed: 1, credits_remaining: 99 },
};

describe("context provider", () => {
  beforeEach(() => {
    mockGetJSON.mockReset();
    mockPostJSON.mockReset();
    mockGetJSON.mockResolvedValue(readResponse);
    mockPostJSON.mockResolvedValue(searchResponse);
    vi.mocked(Client).mockClear();
    delete process.env.CONTEXT_DEV_API_KEY;
  });

  it("registers itself on import", () => {
    expect(has("context")).toBe(true);
  });

  it("requires an API key", () => {
    expect(() => createContextProvider()).toThrow(AuthError);
  });

  it("reads the official Context.dev environment variable", () => {
    process.env.CONTEXT_DEV_API_KEY = "ctxt_secret_env";

    expect(() => createContextProvider()).not.toThrow();
  });

  it("uses a read client that can honor the provider timeout", () => {
    createContextProvider({ apiKey: "ctxt_secret_test" });

    expect(Client).toHaveBeenCalledWith({ maxRetries: 1, timeout: 310000 });
  });

  it("searches with domain filters and Bearer auth", async () => {
    const provider = createContextProvider({ apiKey: "ctxt_secret_test" });

    const results = await provider.search("web agents", {
      maxResults: 1,
      includeDomains: ["example.com"],
      excludeDomains: ["social.example"],
    });

    expect(mockPostJSON).toHaveBeenCalledWith(
      "https://api.context.dev/v1/web/search",
      {
        query: "web agents",
        numResults: 10,
        includeDomains: ["example.com"],
        excludeDomains: ["social.example"],
      },
      { Authorization: "Bearer ctxt_secret_test" },
    );
    expect(results).toEqual([
      {
        url: "https://example.com/agents",
        title: "Web agents",
        snippet: "A result about web agents.",
        text: "# Web agents\n\nPage content.",
        metadata: { relevance: "high", markdownCode: "SUCCESS" },
      },
    ]);
  });

  it("bounds the number of requested search results", async () => {
    const provider = createContextProvider({ apiKey: "ctxt_secret_test" });

    await provider.search("web agents", { maxResults: 200 });

    expect(mockPostJSON.mock.calls[0]?.[1]).toMatchObject({ numResults: 100 });
  });

  it("scrapes page content with normalized read options", async () => {
    const provider = createContextProvider({ apiKey: "ctxt_secret_test" });

    const result = await provider.read("https://example.com/article", {
      format: "html",
      targetSelector: "main",
      removeSelector: "nav",
      timeout: 30,
      noCache: true,
    });

    expect(mockGetJSON).toHaveBeenCalledOnce();
    const [url, headers] = mockGetJSON.mock.calls[0];
    const requestUrl = new URL(url);
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(
      "https://api.context.dev/v1/web/scrape/markdown",
    );
    expect(requestUrl.searchParams.get("url")).toBe("https://example.com/article");
    expect(requestUrl.searchParams.get("includeHTML")).toBe("true");
    expect(requestUrl.searchParams.get("includeSelectors")).toBe("main");
    expect(requestUrl.searchParams.get("excludeSelectors")).toBe("nav");
    expect(requestUrl.searchParams.get("timeoutMS")).toBe("30000");
    expect(requestUrl.searchParams.get("maxAgeMs")).toBe("0");
    expect(headers).toEqual({ Authorization: "Bearer ctxt_secret_test" });
    expect(result).toEqual({
      url: "https://www.example.com/article",
      title: "Example article",
      description: "An example page.",
      content: "<main><h1>Example article</h1><p>Page content.</p></main>",
      html: "<main><h1>Example article</h1><p>Page content.</p></main>",
      publishedDate: "2026-08-02",
      image: "https://www.example.com/hero.png",
      metadata: {
        sourceUrl: "https://example.com/article",
        finalUrl: "https://www.example.com/article",
        title: "Example article",
        description: "An example page.",
        language: "en",
        image: "https://www.example.com/hero.png",
        publishedTime: "2026-08-02",
        cacheMetadata: { status: "hit", age_ms: 42 },
        keyMetadata: { credits_consumed: 1, credits_remaining: 99 },
      },
    });
  });
});
