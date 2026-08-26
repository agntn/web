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
import { AuthError } from "../../src/core/errors.ts";
import type { SearchResult } from "../../src/core/types.ts";

// Triggers self-registration of serpapi provider
import "../../src/providers/index.ts";

const serpApiResponse = {
  search_metadata: {
    id: "test-id",
    status: "Success",
  },
  organic_results: [
    {
      position: 1,
      title: "Test Result",
      link: "https://example.com",
      snippet: "A test snippet from SerpAPI",
      displayed_link: "example.com",
      favicon: "https://example.com/favicon.ico",
      date: "2 days ago",
      source: "Example",
      thumbnail: "https://example.com/thumb.png",
    },
  ],
};

describe("serpapi provider", () => {
  beforeEach(() => {
    mockGetJSON.mockReset();
    mockGetJSON.mockResolvedValue(serpApiResponse);
    delete process.env.SERPAPI_API_KEY;
  });

  describe("self-registration", () => {
    it("registers itself on import", () => {
      expect(has("serpapi")).toBe(true);
    });
  });

  describe("create", () => {
    it("creates provider with apiKey", () => {
      expect(() => createSearchProvider("serpapi", { apiKey: "test-key" })).not.toThrow();
    });

    it("throws AuthError without apiKey and without env var", () => {
      expect(() => createSearchProvider("serpapi", {})).toThrow(AuthError);
    });
  });

  describe("name", () => {
    it("returns serpapi", () => {
      const provider = createSearchProvider("serpapi", { apiKey: "test-key" });
      expect(provider.name).toBe("serpapi");
    });
  });

  describe("search()", () => {
    it("calls getJSON with URL containing engine, q, api_key, and num parameters", async () => {
      const provider = createSearchProvider("serpapi", { apiKey: "test-key" });
      await provider.search("test query");

      expect(mockGetJSON).toHaveBeenCalledOnce();
      const [url] = mockGetJSON.mock.calls[0];

      expect(url).toContain("engine=google");
      expect(url).toContain("q=test%20query");
      expect(url).toContain("api_key=test-key");
      expect(url).toContain("num=10");
    });

    it("maps result fields correctly", async () => {
      const provider = createSearchProvider("serpapi", { apiKey: "test-key" });
      const results: SearchResult[] = await provider.search("test query");

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.url).toBe("https://example.com");
      expect(result.title).toBe("Test Result");
      expect(result.snippet).toBe("A test snippet from SerpAPI");
      expect(result.favicon).toBe("https://example.com/favicon.ico");
      expect(result.publishedDate).toBe("2 days ago");
      expect(result.image).toBe("https://example.com/thumb.png");
    });

    it("maps metadata fields correctly", async () => {
      const provider = createSearchProvider("serpapi", { apiKey: "test-key" });
      const results: SearchResult[] = await provider.search("test query");

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.metadata?.position).toBe(1);
      expect(result.metadata?.source).toBe("Example");
      expect(result.metadata?.displayedLink).toBe("example.com");
    });

    it("maps maxResults option to num query parameter", async () => {
      const provider = createSearchProvider("serpapi", { apiKey: "test-key" });
      await provider.search("test query", { maxResults: 5 });

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toContain("num=5");
    });

    it("returns empty array when organic_results is undefined", async () => {
      mockGetJSON.mockResolvedValueOnce({
        search_metadata: {
          id: "test-id",
          status: "Success",
        },
        organic_results: undefined,
      });

      const provider = createSearchProvider("serpapi", { apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results).toEqual([]);
    });
  });
});
