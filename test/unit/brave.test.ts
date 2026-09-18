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

// Triggers self-registration of brave provider
import "../../src/providers/index.ts";

const braveResponse = {
  web: {
    results: [
      {
        title: "Test Result",
        url: "https://example.com",
        description: "A test description from Brave search",
        extra_snippets: ["Additional context snippet"],
        page_age: "2026-08-23T17:30:05",
        meta_url: {
          favicon: "https://example.com/favicon.ico",
        },
      },
    ],
  },
};

describe("brave provider", () => {
  beforeEach(() => {
    mockGetJSON.mockReset();
    mockGetJSON.mockResolvedValue(braveResponse);
    delete process.env.BRAVE_API_KEY;
  });

  describe("self-registration", () => {
    it("registers itself on import", () => {
      expect(has("brave")).toBe(true);
    });
  });

  describe("create", () => {
    it("creates provider with apiKey", () => {
      expect(() => createSearchProvider("brave", { apiKey: "test-key" })).not.toThrow();
    });

    it("throws AuthError without apiKey and without env var", () => {
      expect(() => createSearchProvider("brave", {})).toThrow(AuthError);
    });
  });

  describe("name", () => {
    it("returns brave", () => {
      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      expect(provider.name).toBe("brave");
    });
  });

  describe("search()", () => {
    it("calls getJSON with correct url and headers", async () => {
      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      await provider.search("test query");

      expect(mockGetJSON).toHaveBeenCalledOnce();
      const [url, headers] = mockGetJSON.mock.calls[0];

      expect(url).toContain("https://api.search.brave.com/res/v1/web/search");
      expect(url).toContain("q=test%20query");
      expect(headers).toEqual({ "X-Subscription-Token": "test-key" });
    });

    it("normalizes a trailing slash in custom baseURL", async () => {
      const provider = createSearchProvider("brave", {
        apiKey: "test-key",
        baseURL: "https://custom.example.com/",
      });
      await provider.search("test query");

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toContain("https://custom.example.com/res/v1/web/search");
    });

    it("maps result fields correctly", async () => {
      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      const results: SearchResult[] = await provider.search("test query");

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.url).toBe("https://example.com");
      expect(result.title).toBe("Test Result");
      expect(result.snippet).toBe("A test description from Brave search");
      expect(result.publishedDate).toBe("2026-08-23T17:30:05");
      expect(result.text).toBe("Additional context snippet");
    });

    it("leaves publishedDate out when Brave has no date for the page", async () => {
      mockGetJSON.mockResolvedValueOnce({
        web: { results: [{ ...braveResponse.web.results[0], page_age: null }] },
      });
      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      const results = await provider.search("test query");

      expect(results[0]).not.toHaveProperty("publishedDate");
    });

    it("sends the date window as freshness, cut to the day", async () => {
      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      await provider.search("test query", {
        startPublishedDate: "2026-06-01T00:00:00Z",
        endPublishedDate: "2026-09-01",
      });

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toContain("&freshness=2026-06-01to2026-09-01");
    });

    it.each([
      ["startPublishedDate", "2026-06-01to"],
      ["endPublishedDate", "to2026-06-01"],
    ])("leaves the other side of freshness empty with only %s", async (option, expected) => {
      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      await provider.search("test query", { [option]: "2026-06-01" });

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toContain(`&freshness=${expected}`);
    });

    it("sends no freshness without a date bound", async () => {
      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      await provider.search("test query", { includeDomains: ["example.com"] });

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).not.toContain("freshness");
    });

    it("maps maxResults to count query param", async () => {
      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      await provider.search("test query", { maxResults: 5 });

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toContain("count=5");
    });

    it("requests extra snippets so Brave can populate text", async () => {
      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      await provider.search("test query");

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toContain("extra_snippets=true");
    });

    it("asks Brave to leave query term highlighting out of descriptions", async () => {
      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      await provider.search("test query");

      const [url] = mockGetJSON.mock.calls[0];
      expect(url).toContain("text_decorations=false");
    });

    it("decodes the HTML escapes Brave writes into descriptions", async () => {
      mockGetJSON.mockResolvedValueOnce({
        web: {
          results: [
            {
              title: "AT&T vs T-Mobile: Which is better?",
              url: "https://example.com",
              description:
                "AT&amp;T doesn&#x27;t map &quot;5G&quot; the same way; see &lt;Option&gt; and &#8212; or &#x1F600; but keep &unknown; &constructor; and &#xD800;",
              extra_snippets: ["Plain text & unescaped 'quotes' stay as they are"],
            },
          ],
        },
      });

      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results[0].title).toBe("AT&T vs T-Mobile: Which is better?");
      expect(results[0].snippet).toBe(
        'AT&T doesn\'t map "5G" the same way; see <Option> and \u2014 or \u{1F600} but keep &unknown; &constructor; and &#xD800;',
      );
      expect(results[0].text).toBe("Plain text & unescaped 'quotes' stay as they are");
    });

    it("maps a missing description to an empty snippet", async () => {
      mockGetJSON.mockResolvedValueOnce({
        web: {
          results: [{ title: "No description", url: "https://example.com", description: null }],
        },
      });

      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results[0].snippet).toBe("");
    });

    it("returns empty array when web.results is undefined", async () => {
      mockGetJSON.mockResolvedValueOnce({
        web: undefined,
      });

      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results).toEqual([]);
    });

    it("joins extra_snippets with newline for text field", async () => {
      mockGetJSON.mockResolvedValueOnce({
        web: {
          results: [
            {
              title: "Test",
              url: "https://example.com",
              description: "Description",
              extra_snippets: ["Snippet 1", "Snippet 2", "Snippet 3"],
              meta_url: {
                favicon: "https://example.com/favicon.ico",
              },
            },
          ],
        },
      });

      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results[0].text).toBe("Snippet 1\nSnippet 2\nSnippet 3");
    });

    it("omits text when extra_snippets is missing or empty", async () => {
      mockGetJSON.mockResolvedValueOnce({
        web: {
          results: [
            {
              title: "Test",
              url: "https://example.com",
              description: "Description",
              extra_snippets: [],
            },
          ],
        },
      });

      const provider = createSearchProvider("brave", { apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results[0].text).toBeUndefined();
    });
  });
});
