import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPostJSON =
  vi.fn<
    (
      url: string,
      body: Readonly<Record<string, unknown>>,
      headers?: Readonly<Record<string, string>>,
    ) => Promise<unknown>
  >();

vi.mock("../../src/core/client.ts", () => ({
  Client: vi.fn(),
  defaultClient: vi.fn(() => ({
    postJSON: mockPostJSON,
    getJSON: vi.fn(),
    maxRetries: 5,
    baseDelay: 50,
    timeout: 30000,
    userAgent: "agntn-web/0.0.1",
  })),
}));

import { createSearchProvider, has } from "../../src/core/registry.ts";
import { AuthError, HTTPError, PaymentError, normalizeError } from "../../src/core/errors.ts";
import { isFallbackEligible } from "../../src/core/fallback.ts";
import { isDetailedSearchProvider } from "../../src/core/provider.ts";
import type { SearchResult } from "../../src/core/types.ts";

// Triggers self-registration of tavily provider
import "../../src/providers/index.ts";

const tavilyResponse = {
  results: [
    {
      title: "Test Result",
      url: "https://example.com",
      content: "Tavily search result content",
      score: 0.92,
      published_date: "2024-06-15",
    },
  ],
  query: "test query",
};

const richTavilyResponse = {
  ...tavilyResponse,
  results: [
    {
      ...tavilyResponse.results[0],
      raw_content: "Full raw content from the page",
    },
  ],
  answer: "A direct answer from Tavily",
};

describe("tavily provider", () => {
  beforeEach(() => {
    mockPostJSON.mockReset();
    mockPostJSON.mockResolvedValue(tavilyResponse);
    delete process.env.TAVILY_API_KEY;
  });

  describe("self-registration", () => {
    it("registers itself on import", () => {
      expect(has("tavily")).toBe(true);
    });
  });

  describe("create", () => {
    it("creates provider with apiKey", () => {
      expect(() => createSearchProvider("tavily", { apiKey: "test-key" })).not.toThrow();
    });

    it("throws AuthError without apiKey and without env var", () => {
      expect(() => createSearchProvider("tavily", {})).toThrow(AuthError);
    });
  });

  describe("name", () => {
    it("returns tavily", () => {
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });
      expect(provider.name).toBe("tavily");
    });
  });

  describe("search()", () => {
    it("calls postJSON with correct url and body containing api_key", async () => {
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });
      await provider.search("test query");

      expect(mockPostJSON).toHaveBeenCalledOnce();
      const [url, body] = mockPostJSON.mock.calls[0];

      expect(url).toBe("https://api.tavily.com/search");
      expect(body).toMatchObject({
        api_key: "test-key",
        query: "test query",
        max_results: 10,
        search_depth: "basic",
      });
    });

    it("maps result fields correctly", async () => {
      mockPostJSON.mockResolvedValueOnce(richTavilyResponse);
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });
      const results: SearchResult[] = await provider.search("test query", { fullText: true });

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.url).toBe("https://example.com");
      expect(result.title).toBe("Test Result");
      expect(result.snippet).toBe("Tavily search result content");
      expect(result.score).toBe(0.92);
      expect(result.publishedDate).toBe("2024-06-15");
      expect(result.text).toBe("Full raw content from the page");
    });

    it("keeps the generated answer in response metadata", async () => {
      mockPostJSON.mockResolvedValueOnce(richTavilyResponse);
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });
      expect(isDetailedSearchProvider(provider)).toBe(true);
      if (!isDetailedSearchProvider(provider)) {
        throw new Error("Tavily provider must support detailed search responses");
      }

      const response = await provider.searchDetailed("test query", { summary: true });

      expect(response.metadata).toEqual({ answer: "A direct answer from Tavily" });
      expect(response.results[0].summary).toBeUndefined();
    });

    it("maps maxResults to max_results in body", async () => {
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });
      await provider.search("test query", { maxResults: 5 });

      const [, body] = mockPostJSON.mock.calls[0];
      expect(body.max_results).toBe(5);
    });

    it("passes explicit content preferences", async () => {
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });
      await provider.search("test query", { summary: true, fullText: true });

      const [, body] = mockPostJSON.mock.calls[0];
      expect(body.include_answer).toBe(true);
      expect(body.include_raw_content).toBe(true);
    });

    it("passes includeDomains to include_domains in body", async () => {
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });
      await provider.search("test query", { includeDomains: ["github.com", "stackoverflow.com"] });

      const [, body] = mockPostJSON.mock.calls[0];
      expect(body.include_domains).toEqual(["github.com", "stackoverflow.com"]);
    });

    it("passes excludeDomains to exclude_domains in body", async () => {
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });
      await provider.search("test query", { excludeDomains: ["reddit.com"] });

      const [, body] = mockPostJSON.mock.calls[0];
      expect(body.exclude_domains).toEqual(["reddit.com"]);
    });

    it("returns empty array for empty results", async () => {
      mockPostJSON.mockResolvedValueOnce({
        results: [],
        query: "test query",
      });

      const provider = createSearchProvider("tavily", { apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results).toEqual([]);
    });
  });

  describe("usage limits", () => {
    const url = "https://api.tavily.com/search";
    const body = JSON.stringify({
      detail: { error: "This request exceeds your plan's set usage limit." },
    });

    it.each([432, 433])("classifies HTTP %i as PaymentError", async (statusCode) => {
      mockPostJSON.mockRejectedValueOnce(new HTTPError(statusCode, url, body));
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });

      const error = await provider.search("test query").catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(PaymentError);
      expect(error).toMatchObject({ name: "PaymentError", statusCode, url, body });
      expect(normalizeError(error, "tavily")).toBe(error);
      expect(isFallbackEligible(error, "tavily", "search")).toBe(true);
    });

    it.each([
      [400, HTTPError],
      [401, AuthError],
    ])("keeps HTTP %i strict", async (statusCode, expected) => {
      mockPostJSON.mockRejectedValueOnce(new HTTPError(statusCode, url, body));
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });

      const error = await provider.search("test query").catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(expected);
      expect(error).not.toBeInstanceOf(PaymentError);
      expect(isFallbackEligible(error, "tavily", "search")).toBe(false);
    });
  });
});
