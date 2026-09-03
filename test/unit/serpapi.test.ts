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

import { createImageSearchProvider, createSearchProvider, has } from "../../src/core/registry.ts";
import { AuthError, InvalidSearchContinuationError } from "../../src/core/errors.ts";
import { isPaginatedSearchProvider } from "../../src/core/provider.ts";
import type { SearchResult } from "../../src/core/types.ts";

// Triggers self-registration of serpapi provider
import "../../src/providers/index.ts";

const imageSearchResponse = {
  search_metadata: {
    id: "lens-id",
    status: "Success",
  },
  visual_matches: [
    {
      position: 1,
      title: "Matching page",
      link: "https://example.com/page",
      source: "Example",
      source_icon: "https://example.com/favicon.png",
      thumbnail: "https://example.com/thumb.jpg",
      thumbnail_width: 240,
      thumbnail_height: 180,
      image: "https://example.com/full.jpg",
      image_width: 1200,
      image_height: 900,
      exact_matches: true,
    },
    {
      position: 2,
      title: "Second page",
      link: "https://example.org/page",
      source: "Example Org",
      thumbnail: "https://example.org/thumb.jpg",
    },
  ],
};

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

  describe("searchByImage()", () => {
    it("uses the Google Lens visual matches endpoint", async () => {
      mockGetJSON.mockResolvedValueOnce(imageSearchResponse);
      const provider = createImageSearchProvider("serpapi", {
        apiKey: "test-key",
        baseURL: "https://proxy.example.com/serpapi",
      });

      await provider.searchByImage("https://images.example.com/input photo.jpg", { maxResults: 1 });

      const [requestUrl] = mockGetJSON.mock.calls[0];
      const url = new URL(requestUrl);
      expect(url.origin).toBe("https://proxy.example.com");
      expect(url.pathname).toBe("/serpapi/search");
      expect(url.searchParams.get("engine")).toBe("google_lens");
      expect(url.searchParams.get("type")).toBe("visual_matches");
      expect(url.searchParams.get("url")).toBe("https://images.example.com/input photo.jpg");
      expect(url.searchParams.get("api_key")).toBe("test-key");
    });

    it("surfaces API errors instead of returning an empty match list", async () => {
      mockGetJSON.mockResolvedValueOnce({ error: "Google Lens could not fetch the image" });
      const provider = createImageSearchProvider("serpapi", { apiKey: "test-key" });

      await expect(provider.searchByImage("https://images.example.com/input.jpg")).rejects.toThrow(
        "Google Lens could not fetch the image",
      );
    });

    it("maps image matches and applies maxResults locally", async () => {
      mockGetJSON.mockResolvedValueOnce(imageSearchResponse);
      const provider = createImageSearchProvider("serpapi", { apiKey: "test-key" });

      const results = await provider.searchByImage("https://images.example.com/input.jpg", {
        maxResults: 1,
      });

      expect(results).toEqual([
        {
          pageUrl: "https://example.com/page",
          imageUrl: "https://example.com/full.jpg",
          title: "Matching page",
          provider: "serpapi",
          source: "Example",
          thumbnailUrl: "https://example.com/thumb.jpg",
          imageWidth: 1200,
          imageHeight: 900,
          thumbnailWidth: 240,
          thumbnailHeight: 180,
          position: 1,
          exactMatch: true,
        },
      ]);
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

    it("preserves the next Google result offset as provider continuation", async () => {
      mockGetJSON
        .mockResolvedValueOnce({
          ...serpApiResponse,
          serpapi_pagination: {
            next: "https://serpapi.com/search?engine=google&q=test&start=10",
          },
        })
        .mockResolvedValueOnce(serpApiResponse);
      const provider = createSearchProvider("serpapi", { apiKey: "test-key" });
      if (!isPaginatedSearchProvider(provider)) throw new Error("SerpAPI must paginate");

      const first = await provider.searchPage("test query");
      const second = await provider.searchPage("test query", undefined, first.continuation);

      expect(first.continuation).toBe("10");
      expect(new URL(mockGetJSON.mock.calls[1][0]).searchParams.get("start")).toBe("10");
      expect(second.continuation).toBeUndefined();
    });

    it("rejects unsafe numeric offsets before the request", async () => {
      const provider = createSearchProvider("serpapi", { apiKey: "test-key" });
      if (!isPaginatedSearchProvider(provider)) throw new Error("SerpAPI must paginate");

      await expect(
        provider.searchPage("test query", undefined, "9007199254740992"),
      ).rejects.toThrow(InvalidSearchContinuationError);
      expect(mockGetJSON).not.toHaveBeenCalled();
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
