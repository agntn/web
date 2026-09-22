import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

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

  describe("manifest", () => {
    it("is listed without loading the adapter", () => {
      expect(has("serpapi")).toBe(true);
    });
  });

  describe("create", () => {
    it("creates provider with apiKey", async () => {
      await expect(createSearchProvider("serpapi", { apiKey: "test-key" })).resolves.toBeDefined();
    });

    it("throws AuthError without apiKey and without env var", async () => {
      await expect(createSearchProvider("serpapi", {})).rejects.toThrow(AuthError);
    });
  });

  describe("name", () => {
    it("returns serpapi", async () => {
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      expect(provider.name).toBe("serpapi");
    });
  });

  describe("searchByImage()", () => {
    it("uses the Google Lens visual matches endpoint", async () => {
      mockGetJSON.mockResolvedValueOnce(imageSearchResponse);
      const provider = await createImageSearchProvider("serpapi", {
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
      mockGetJSON.mockResolvedValueOnce({
        search_metadata: { id: "lens-id", status: "Error" },
        error: "Google Lens could not fetch the image",
      });
      const provider = await createImageSearchProvider("serpapi", { apiKey: "test-key" });

      await expect(provider.searchByImage("https://images.example.com/input.jpg")).rejects.toThrow(
        "Google Lens could not fetch the image",
      );
    });

    it("returns no matches when Google Lens has nothing for the image", async () => {
      mockGetJSON.mockResolvedValueOnce({
        search_metadata: { id: "lens-id", status: "Success" },
        search_information: { images_results_state: "Fully empty" },
        error: "Google Lens hasn't returned any results for this query.",
      });
      const provider = await createImageSearchProvider("serpapi", { apiKey: "test-key" });

      await expect(provider.searchByImage("https://images.example.com/input.jpg")).resolves.toEqual(
        [],
      );
    });

    it("maps image matches and applies maxResults locally", async () => {
      mockGetJSON.mockResolvedValueOnce(imageSearchResponse);
      const provider = await createImageSearchProvider("serpapi", { apiKey: "test-key" });

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
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
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
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      if (!isPaginatedSearchProvider(provider)) throw new Error("SerpAPI must paginate");

      const first = await provider.searchPage("test query");
      const second = await provider.searchPage("test query", undefined, first.continuation);

      expect(first.continuation).toBe("10");
      expect(new URL(mockGetJSON.mock.calls[1][0]).searchParams.get("start")).toBe("10");
      expect(second.continuation).toBeUndefined();
    });

    it("rejects unsafe numeric offsets before the request", async () => {
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      if (!isPaginatedSearchProvider(provider)) throw new Error("SerpAPI must paginate");

      await expect(
        provider.searchPage("test query", undefined, "9007199254740992"),
      ).rejects.toThrow(InvalidSearchContinuationError);
      expect(mockGetJSON).not.toHaveBeenCalled();
    });

    it("maps result fields correctly", async () => {
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
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
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      const results: SearchResult[] = await provider.search("test query");

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.metadata?.position).toBe(1);
      expect(result.metadata?.source).toBe("Example");
      expect(result.metadata?.displayedLink).toBe("example.com");
    });

    it("maps maxResults option to num query parameter", async () => {
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      await provider.search("test query", { maxResults: 5 });

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toContain("num=5");
    });

    it("sends the date window as a Google custom date range", async () => {
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      await provider.search("test query", {
        startPublishedDate: "2021-01-01",
        endPublishedDate: "2021-12-31T12:00:00Z",
      });

      const [url] = mockGetJSON.mock.calls[0];
      expect(new URL(url).searchParams.get("tbs")).toBe("cdr:1,cd_min:1/1/2021,cd_max:12/31/2021");
    });

    it("takes the day of each bound in UTC", async () => {
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      await provider.search("test query", {
        startPublishedDate: "2026-06-02T01:00:00+05:00",
        endPublishedDate: "2026-06-30T23:00:00-02:00",
      });

      const [url] = mockGetJSON.mock.calls[0];
      expect(new URL(url).searchParams.get("tbs")).toBe("cdr:1,cd_min:6/1/2026,cd_max:7/1/2026");
    });

    it("sends a lone bound alone", async () => {
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      await provider.search("test query", { startPublishedDate: "2021-01-01" });
      await provider.search("test query", { endPublishedDate: "2019-12-31" });

      const [[start], [end]] = mockGetJSON.mock.calls;
      expect(new URL(start).searchParams.get("tbs")).toBe("cdr:1,cd_min:1/1/2021");
      expect(new URL(end).searchParams.get("tbs")).toBe("cdr:1,cd_max:12/31/2019");
    });

    it("sends no tbs without a date bound", async () => {
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      await provider.search("test query", { includeDomains: ["example.com"] });

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).not.toContain("tbs=");
    });

    it("keeps the date range on the next page", async () => {
      mockGetJSON.mockResolvedValueOnce({
        ...serpApiResponse,
        serpapi_pagination: { next: "https://serpapi.com/search?start=10" },
      });
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      if (!isPaginatedSearchProvider(provider)) throw new Error("SerpAPI must paginate");
      const options = { startPublishedDate: "2021-01-01", maxResults: 10 };
      const first = await provider.searchPage("test query", options);
      await provider.searchPage("test query", options, first.continuation);

      const [, [next]] = mockGetJSON.mock.calls;
      expect(new URL(next).searchParams.get("start")).toBe("10");
      expect(new URL(next).searchParams.get("tbs")).toBe("cdr:1,cd_min:1/1/2021");
    });

    it("walks a Google page in slices of maxResults", async () => {
      const organic = serpApiResponse.organic_results[0];
      mockGetJSON.mockResolvedValue({
        ...serpApiResponse,
        organic_results: [
          organic,
          { ...organic, position: 2, link: "https://example.com/second" },
          { ...organic, position: 3, link: "https://example.com/third" },
        ],
        serpapi_pagination: {
          next: "https://serpapi.com/search?engine=google&q=test&start=10",
        },
      });
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      if (!isPaginatedSearchProvider(provider)) throw new Error("SerpAPI must paginate");

      const first = await provider.searchPage("test query", { maxResults: 2 });
      const second = await provider.searchPage("test query", { maxResults: 2 }, first.continuation);

      expect(first.results.map((result) => result.url)).toEqual([
        "https://example.com",
        "https://example.com/second",
      ]);
      expect(first.continuation).toBe("0:2");
      expect(second.results.map((result) => result.url)).toEqual(["https://example.com/third"]);
      expect(second.continuation).toBe("10");
      expect(mockGetJSON.mock.calls[1][0]).toBe(mockGetJSON.mock.calls[0][0]);
    });

    it("never hands out an empty slice", async () => {
      const organic = serpApiResponse.organic_results[0];
      mockGetJSON.mockResolvedValue({
        ...serpApiResponse,
        organic_results: [
          organic,
          { ...organic, position: 2, link: "https://example.com/second" },
          { ...organic, position: 3, link: "https://example.com/third" },
        ],
      });
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      if (!isPaginatedSearchProvider(provider)) throw new Error("SerpAPI must paginate");

      const cases: readonly (readonly [number, number, string | undefined])[] = [
        [Number.NaN, 3, undefined],
        [Number.POSITIVE_INFINITY, 3, undefined],
        [0, 1, "0:1"],
        [-4, 1, "0:1"],
        [2.5, 2, "0:2"],
      ];
      for (const [maxResults, count, continuation] of cases) {
        const page = await provider.searchPage("test query", { maxResults });
        expect(page.results, `maxResults ${maxResults}`).toHaveLength(count);
        expect(page.continuation, `maxResults ${maxResults}`).toBe(continuation);
      }
    });

    it("rejects slice tokens that point nowhere", async () => {
      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      if (!isPaginatedSearchProvider(provider)) throw new Error("SerpAPI must paginate");

      for (const token of ["0", "3:0", "0:0", "1:2:3"]) {
        await expect(provider.searchPage("test query", undefined, token)).rejects.toThrow(
          InvalidSearchContinuationError,
        );
      }
      expect(mockGetJSON).not.toHaveBeenCalled();
    });

    it("returns empty array when organic_results is undefined", async () => {
      mockGetJSON.mockResolvedValueOnce({
        search_metadata: {
          id: "test-id",
          status: "Success",
        },
        organic_results: undefined,
      });

      const provider = await createSearchProvider("serpapi", { apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results).toEqual([]);
    });
  });
});
