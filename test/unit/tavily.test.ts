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

import {
  createReadProvider,
  createSearchProvider,
  has,
  readProviders,
} from "../../src/core/registry.ts";
import {
  AuthError,
  HTTPError,
  PaymentError,
  WebError,
  normalizeError,
} from "../../src/core/errors.ts";
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

const tavilyExtractResponse = {
  results: [
    {
      url: "https://example.com",
      title: "Example Domain",
      raw_content: "# Example Domain\n\nThis domain is for use in documentation examples.",
      images: [],
    },
  ],
  failed_results: [],
  response_time: 0.01,
  request_id: "02ffbfad-0ff5-4f97-8b2d-d19cb78aa235",
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

    it("leaves text out when raw_content is null", async () => {
      mockPostJSON.mockResolvedValueOnce({
        ...tavilyResponse,
        results: [{ ...tavilyResponse.results[0], raw_content: null }],
      });
      const provider = createSearchProvider("tavily", { apiKey: "test-key" });
      const results = await provider.search("test query");

      expect(results).toHaveLength(1);
      expect(results[0]).not.toHaveProperty("text");
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

  describe("read()", () => {
    beforeEach(() => {
      mockPostJSON.mockResolvedValue(tavilyExtractResponse);
    });

    it("registers as a read provider", () => {
      expect(readProviders()).toContain("tavily");
      expect(() => createReadProvider("tavily", { apiKey: "test-key" })).not.toThrow();
    });

    it("posts one URL to /extract with a bearer header", async () => {
      const provider = createReadProvider("tavily", { apiKey: "test-key" });
      await provider.read("https://example.com");

      expect(mockPostJSON).toHaveBeenCalledOnce();
      const [url, body, headers] = mockPostJSON.mock.calls[0];
      expect(url).toBe("https://api.tavily.com/extract");
      expect(body).toEqual({
        urls: ["https://example.com"],
        extract_depth: "basic",
        format: "markdown",
      });
      expect(headers).toEqual({ Authorization: "Bearer test-key" });
    });

    it("maps the extracted page", async () => {
      const provider = createReadProvider("tavily", { apiKey: "test-key" });
      const result = await provider.read("https://example.com");

      expect(result).toEqual({
        url: "https://example.com",
        title: "Example Domain",
        content: "# Example Domain\n\nThis domain is for use in documentation examples.",
        metadata: { requestId: "02ffbfad-0ff5-4f97-8b2d-d19cb78aa235" },
      });
    });

    it("requests plain text and mirrors it in text", async () => {
      mockPostJSON.mockResolvedValueOnce({
        ...tavilyExtractResponse,
        results: [{ url: "https://example.com", raw_content: "Example Domain\nplain" }],
        request_id: undefined,
      });
      const provider = createReadProvider("tavily", { apiKey: "test-key" });
      const result = await provider.read("https://example.com", { format: "text" });

      const [, body] = mockPostJSON.mock.calls[0];
      expect(body.format).toBe("text");
      expect(result).toEqual({
        url: "https://example.com",
        content: "Example Domain\nplain",
        text: "Example Domain\nplain",
      });
    });

    it("falls back to markdown for html", async () => {
      const provider = createReadProvider("tavily", { apiKey: "test-key" });
      await provider.read("https://example.com", { format: "html" });

      const [, body] = mockPostJSON.mock.calls[0];
      expect(body.format).toBe("markdown");
    });

    it.each([
      [0.5, 1],
      [20, 20],
      [120, 60],
    ])("clamps timeout %s s to Tavily's range as %s", async (timeout, expected) => {
      const provider = createReadProvider("tavily", { apiKey: "test-key" });
      await provider.read("https://example.com", { timeout });

      const [, body] = mockPostJSON.mock.calls[0];
      expect(body.timeout).toBe(expected);
    });

    it("throws Tavily's reason when the page could not be fetched", async () => {
      mockPostJSON.mockResolvedValueOnce({
        results: [],
        failed_results: [{ url: "https://example.com/missing", error: "404 page not found" }],
        response_time: 0.33,
        request_id: "98024ac2-b144-4917-aeb0-1b8c243f4226",
      });
      const provider = createReadProvider("tavily", { apiKey: "test-key" });
      const failure = await provider
        .read("https://example.com/missing")
        .catch((caught: unknown) => caught);

      expect(failure).toBeInstanceOf(WebError);
      expect(failure).not.toBeInstanceOf(HTTPError);
      expect(failure).toMatchObject({ message: "Tavily extract failed: 404 page not found" });
      expect(isFallbackEligible(failure, "tavily", "read")).toBe(false);
    });

    it("throws when the response carries neither a page nor a failure", async () => {
      mockPostJSON.mockResolvedValueOnce({ results: [], failed_results: [] });
      const provider = createReadProvider("tavily", { apiKey: "test-key" });

      await expect(provider.read("https://example.com")).rejects.toThrow(
        "Tavily extract failed: no result returned",
      );
    });

    it.each([432, 433])("classifies HTTP %i on extract as PaymentError", async (statusCode) => {
      mockPostJSON.mockRejectedValueOnce(
        new HTTPError(statusCode, "https://api.tavily.com/extract", "usage limit"),
      );
      const provider = createReadProvider("tavily", { apiKey: "test-key" });
      const failure = await provider.read("https://example.com").catch((caught: unknown) => caught);

      expect(failure).toBeInstanceOf(PaymentError);
      expect(isFallbackEligible(failure, "tavily", "read")).toBe(true);
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
