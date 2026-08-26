import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetJSON =
  vi.fn<(url: string, headers?: Readonly<Record<string, string>>) => Promise<unknown>>();

vi.mock("../../src/core/client.ts", () => ({
  Client: vi.fn(),
  defaultClient: vi.fn(() => ({
    getJSON: mockGetJSON,
    postJSON: vi.fn(),
    maxRetries: 5,
    baseDelay: 50,
    timeout: 30000,
    userAgent: "agntn-web/0.0.1",
  })),
}));

import { createSearchProvider, has } from "../../src/core/registry.ts";
import { isReadProvider } from "../../src/core/provider.ts";
import { AuthError, HTTPError, InvalidProviderUrlError } from "../../src/core/errors.ts";
import type { ProviderConfig, SearchResult, ReadResult } from "../../src/core/types.ts";

// Triggers self-registration of jina provider
import "../../src/providers/index.ts";

function createJinaProvider(config: Readonly<ProviderConfig> = {}) {
  const provider = createSearchProvider("jina", config);
  if (!isReadProvider(provider)) {
    throw new Error("Jina provider must support URL reading");
  }
  return provider;
}

const jinaResponse = {
  code: 200,
  status: 20000,
  data: [
    {
      title: "Test Result",
      url: "https://example.com",
      description: "A test description from Jina search",
      content: "Full content from Jina search result",
      publishedTime: "2024-07-01T00:00:00Z",
      images: ["https://example.com/image.png"],
      metadata: { source: "jina" },
      warning: "partial result",
    },
  ],
};

describe("jina provider", () => {
  beforeEach(() => {
    mockGetJSON.mockReset();
    mockGetJSON.mockResolvedValue(jinaResponse);
    delete process.env.JINA_API_KEY;
  });

  describe("self-registration", () => {
    it("registers itself on import", () => {
      expect(has("jina")).toBe(true);
    });
  });

  describe("create", () => {
    it("creates provider with apiKey", () => {
      expect(() => createJinaProvider({ apiKey: "test-key" })).not.toThrow();
    });

    it("creates provider without apiKey for read-only use", () => {
      expect(() => createJinaProvider({})).not.toThrow();
    });

    it("rejects non-HTTP reader base URLs", () => {
      expect(() => createJinaProvider({ readBaseURL: "file:///etc/passwd" })).toThrow(
        InvalidProviderUrlError,
      );
    });
  });

  describe("name", () => {
    it("returns jina", () => {
      const provider = createJinaProvider({ apiKey: "test-key" });
      expect(provider.name).toBe("jina");
    });
  });

  describe("search()", () => {
    it("throws AuthError without apiKey and without env var", async () => {
      const provider = createJinaProvider({});
      await expect(provider.search("test query")).rejects.toThrow(AuthError);
      expect(mockGetJSON).not.toHaveBeenCalled();
    });

    it("calls getJSON with correct URL and bearer auth headers", async () => {
      const provider = createJinaProvider({ apiKey: "test-key" });
      await provider.search("test query");

      expect(mockGetJSON).toHaveBeenCalledOnce();
      const [url, headers] = mockGetJSON.mock.calls[0];

      expect(url).toContain("https://s.jina.ai/search?");
      expect(url).toContain("q=test+query");
      expect(url).toContain("count=10");
      expect(headers).toEqual({
        Authorization: "Bearer test-key",
        Accept: "application/json",
      });
    });

    it("maps result fields correctly", async () => {
      const provider = createJinaProvider({ apiKey: "test-key" });
      const results: SearchResult[] = await provider.search("test query");

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.url).toBe("https://example.com");
      expect(result.title).toBe("Test Result");
      expect(result.snippet).toBe("A test description from Jina search");
      expect(result.text).toBe("Full content from Jina search result");
      expect(result.publishedDate).toBe("2024-07-01T00:00:00Z");
      expect(result.image).toBe("https://example.com/image.png");
      expect(result.metadata).toEqual({ source: "jina", warning: "partial result" });
    });

    it("maps maxResults to count query param and clamps to Jina limit", async () => {
      const provider = createJinaProvider({ apiKey: "test-key" });
      await provider.search("test query", { maxResults: 25 });

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toContain("count=20");
    });

    it("maps includeDomains and news category to Jina query params", async () => {
      const provider = createJinaProvider({ apiKey: "test-key" });
      await provider.search("test query", { includeDomains: ["example.com"], category: "news" });

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toContain("site=example.com");
      expect(url).toContain("type=news");
    });

    it("falls back to content for snippet when description is missing", async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: [
          {
            url: "https://example.com",
            content: "A".repeat(300),
          },
        ],
      });

      const provider = createJinaProvider({ apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results[0].snippet).toBe("A".repeat(200));
      expect(results[0].title).toBe("");
    });

    it("returns empty array when data is undefined", async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: undefined,
      });

      const provider = createJinaProvider({ apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results).toEqual([]);
    });
  });

  describe("read()", () => {
    it("derives regional read hosts from regional search hosts", async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: { url: "https://example.com/", content: "Read content" },
      });

      const provider = createJinaProvider({ baseURL: "https://eu.s.jina.ai" });
      await provider.read("https://example.com");

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toBe("https://eu.r.jina.ai/https%3A%2F%2Fexample.com");
    });

    it("calls r.jina.ai with encoded URL and JSON accept header without requiring apiKey", async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: {
          title: "Read Result",
          description: "Read description",
          url: "https://example.com/",
          content: "Markdown content",
        },
      });

      const provider = createJinaProvider({});
      const result = await provider.read("https://example.com/?a=1&b=2");

      expect(mockGetJSON).toHaveBeenCalledOnce();
      const [url, headers] = mockGetJSON.mock.calls[0];
      expect(url).toBe("https://r.jina.ai/https%3A%2F%2Fexample.com%2F%3Fa%3D1%26b%3D2");
      expect(headers).toEqual({ Accept: "application/json" });
      expect(result.content).toBe("Markdown content");
    });

    it("passes read options as Jina Reader headers", async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: { url: "https://example.com/", content: "Text content" },
      });

      const provider = createJinaProvider({ apiKey: "test-key" });
      await provider.read("https://example.com", {
        format: "text",
        maxTokens: 500,
        targetSelector: "main",
        removeSelector: "nav",
        timeout: 30,
        noCache: true,
      });

      const [, headers] = mockGetJSON.mock.calls[0];
      expect(headers).toEqual({
        Accept: "application/json",
        Authorization: "Bearer test-key",
        "X-Return-Format": "text",
        "X-Token-Budget": "500",
        "X-Target-Selector": "main",
        "X-Remove-Selector": "nav",
        "X-Timeout": "30",
        "X-No-Cache": "true",
      });
    });

    it("maps read result fields correctly", async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 200,
        status: 20000,
        data: {
          title: "Read Result",
          description: "Read description",
          url: "https://example.com/",
          content: "Markdown content",
          text: "Plain content",
          html: "<main>HTML content</main>",
          publishedTime: "2024-08-01T00:00:00Z",
          links: ["https://example.com/a"],
          images: { hero: "https://example.com/hero.png" },
          metadata: { lang: "en" },
          warning: "cached",
        },
      });

      const provider = createJinaProvider({});
      const result: ReadResult = await provider.read("https://example.com");

      expect(result).toEqual({
        url: "https://example.com/",
        title: "Read Result",
        description: "Read description",
        content: "Markdown content",
        text: "Plain content",
        html: "<main>HTML content</main>",
        publishedDate: "2024-08-01T00:00:00Z",
        image: "https://example.com/hero.png",
        links: ["https://example.com/a"],
        images: ["https://example.com/hero.png"],
        metadata: { lang: "en", warning: "cached" },
      });
    });
    it("throws on Jina application-level errors for search responses", async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 401,
        status: 40100,
        message: "invalid token",
      });

      const provider = createJinaProvider({ apiKey: "bad-key" });

      await expect(provider.search("query")).rejects.toThrow(AuthError);
    });

    it("throws on Jina application-level errors for read responses", async () => {
      mockGetJSON.mockResolvedValueOnce({
        code: 422,
        status: 42200,
        message: "unsupported url",
      });

      const provider = createJinaProvider({});

      await expect(provider.read("ftp://example.com")).rejects.toMatchObject({
        statusCode: 422,
        body: "unsupported url",
      } satisfies Partial<HTTPError>);
    });
  });
});
