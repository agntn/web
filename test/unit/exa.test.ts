import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

const mockPostJSON =
  vi.fn<
    (
      url: string,
      body: Readonly<Record<string, unknown>>,
      headers?: Readonly<Record<string, string>>,
    ) => Promise<unknown>
  >();

const mockReadPostJSON =
  vi.fn<
    (
      url: string,
      body: Readonly<Record<string, unknown>>,
      headers?: Readonly<Record<string, string>>,
    ) => Promise<unknown>
  >();

const mockReadClient = {
  postJSON: mockReadPostJSON,
  getJSON: vi.fn(),
  maxRetries: 0,
  baseDelay: 50,
  timeout: 100000,
  userAgent: "agntn-web/0.0.1",
};

vi.mock("../../src/core/client.ts", () => ({
  Client: vi.fn(function ClientMock() {
    return mockReadClient;
  }),
  defaultClient: vi.fn(() => ({
    postJSON: mockPostJSON,
    getJSON: vi.fn(),
    maxRetries: 5,
    baseDelay: 50,
    timeout: 30000,
    userAgent: "agntn-web/0.0.1",
  })),
}));

import { Client } from "../../src/core/client.ts";
import {
  createReadProvider,
  createSearchProvider,
  has,
  readProviders,
} from "../../src/core/registry.ts";
import { AuthError, HTTPError, WebError } from "../../src/core/errors.ts";
import { isFallbackEligible } from "../../src/core/fallback.ts";
import type { SearchResult } from "../../src/core/types.ts";

const exaResponse = {
  requestId: "test-req",
  results: [
    {
      id: "abc123",
      url: "https://example.com",
      title: "Test Result",
      score: 0.95,
      publishedDate: "2024-01-01",
      author: "Test Author",
      image: "https://example.com/img.png",
      favicon: "https://example.com/favicon.ico",
      highlights: ["Key highlight from the page"],
    },
  ],
};

const richExaResponse = {
  ...exaResponse,
  results: [
    {
      ...exaResponse.results[0],
      text: "Full text content here for testing purposes",
      summary: "A brief summary",
    },
  ],
};

const exaContentsResponse = {
  requestId: "contents-req",
  results: [
    {
      id: "https://example.com/",
      url: "https://example.com/",
      title: "Example Domain",
      publishedDate: "2024-01-01T00:00:00.000Z",
      image: "https://example.com/og.png",
      text: "# Example Domain\n\nThis domain is for use in documentation examples.",
    },
  ],
  statuses: [{ id: "https://example.com", status: "success", source: "cached" }],
  costDollars: { total: 0.001 },
};

describe("exa provider", () => {
  beforeEach(() => {
    mockPostJSON.mockReset();
    mockPostJSON.mockResolvedValue(exaResponse);
    mockReadPostJSON.mockReset();
    mockReadPostJSON.mockResolvedValue(exaContentsResponse);
    vi.mocked(Client).mockClear();
    delete process.env.EXA_API_KEY;
  });

  describe("manifest", () => {
    it("is listed without loading the adapter", () => {
      expect(has("exa")).toBe(true);
    });
  });

  describe("create", () => {
    it("creates provider with apiKey", async () => {
      await expect(createSearchProvider("exa", { apiKey: "test-key" })).resolves.toBeDefined();
    });

    it("throws AuthError without apiKey and without env var", async () => {
      await expect(createSearchProvider("exa", {})).rejects.toThrow(AuthError);
    });
  });

  describe("name", () => {
    it("returns exa", async () => {
      const provider = await createSearchProvider("exa", { apiKey: "test-key" });
      expect(provider.name).toBe("exa");
    });
  });

  describe("search()", () => {
    it("calls postJSON with correct url, body, and headers", async () => {
      const provider = await createSearchProvider("exa", { apiKey: "test-key" });
      await provider.search("test query");

      expect(mockPostJSON).toHaveBeenCalledOnce();
      const [url, body, headers] = mockPostJSON.mock.calls[0];

      expect(url).toBe("https://api.exa.ai/search");
      expect(body).toMatchObject({
        query: "test query",
        type: "auto",
        contents: { text: false, highlights: true },
      });
      expect(headers).toEqual({ "x-api-key": "test-key" });
    });

    it("maps result fields correctly", async () => {
      mockPostJSON.mockResolvedValueOnce(richExaResponse);
      const provider = await createSearchProvider("exa", { apiKey: "test-key" });
      const results: SearchResult[] = await provider.search("test query", {
        summary: true,
        fullText: true,
      });

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.url).toBe("https://example.com");
      expect(result.title).toBe("Test Result");
      expect(result.snippet).toBe("Key highlight from the page");
      expect(result.score).toBe(0.95);
      expect(result.text).toBe("Full text content here for testing purposes");
      expect(result.highlights).toEqual(["Key highlight from the page"]);
      expect(result.summary).toBe("A brief summary");
    });

    it("maps maxResults option to numResults in body", async () => {
      const provider = await createSearchProvider("exa", { apiKey: "test-key" });
      await provider.search("test query", { maxResults: 5 });

      const [, body] = mockPostJSON.mock.calls[0];
      expect(body.numResults).toBe(5);
    });

    it("uses empty string for null title", async () => {
      mockPostJSON.mockResolvedValueOnce({
        requestId: "test-req",
        results: [{ ...exaResponse.results[0], title: null }],
      });

      const provider = await createSearchProvider("exa", { apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results[0].title).toBe("");
    });

    it("keeps expensive content disabled by default", async () => {
      const provider = await createSearchProvider("exa", { apiKey: "test-key" });
      await provider.search("test query");

      const [, body] = mockPostJSON.mock.calls[0];
      expect(body.contents).toEqual({ text: false, highlights: true });
    });

    it("passes explicit content preferences", async () => {
      const provider = await createSearchProvider("exa", { apiKey: "test-key" });
      await provider.search("test query", { highlights: false, summary: true, fullText: true });

      const [, body] = mockPostJSON.mock.calls[0];
      expect(body.contents).toEqual({ text: true, highlights: false, summary: true });
    });

    it("falls back to truncated text when no highlights", async () => {
      const longText = "A".repeat(300);
      mockPostJSON.mockResolvedValueOnce({
        requestId: "test-req",
        results: [
          {
            ...exaResponse.results[0],
            highlights: undefined,
            text: longText,
          },
        ],
      });

      const provider = await createSearchProvider("exa", { apiKey: "test-key" });
      const results = await provider.search("query", { fullText: true });

      expect(results[0].snippet).toBe(longText.slice(0, 200));
    });

    it("returns empty array for empty results", async () => {
      mockPostJSON.mockResolvedValueOnce({
        requestId: "test-req",
        results: [],
      });

      const provider = await createSearchProvider("exa", { apiKey: "test-key" });
      const results = await provider.search("query");

      expect(results).toEqual([]);
    });
  });

  describe("read()", () => {
    it("registers as a read provider", async () => {
      expect(readProviders()).toContain("exa");
      await expect(createReadProvider("exa", { apiKey: "test-key" })).resolves.toBeDefined();
    });

    it("reads through a client that outlasts Exa's longest crawl and never re-posts", async () => {
      await createReadProvider("exa", { apiKey: "test-key" });

      expect(Client).toHaveBeenCalledWith({ maxRetries: 0, timeout: 100_000 });
    });

    it("posts one URL to /contents asking for text", async () => {
      const provider = await createReadProvider("exa", { apiKey: "test-key" });
      await provider.read("https://example.com");

      expect(mockPostJSON).not.toHaveBeenCalled();
      expect(mockReadPostJSON).toHaveBeenCalledOnce();
      const [url, body, headers] = mockReadPostJSON.mock.calls[0];
      expect(url).toBe("https://api.exa.ai/contents");
      expect(body).toEqual({ urls: ["https://example.com"], text: true });
      expect(headers).toEqual({ "x-api-key": "test-key" });
    });

    it("maps the page Exa read", async () => {
      const provider = await createReadProvider("exa", { apiKey: "test-key" });
      const result = await provider.read("https://example.com");

      expect(result).toEqual({
        url: "https://example.com/",
        title: "Example Domain",
        content: "# Example Domain\n\nThis domain is for use in documentation examples.",
        publishedDate: "2024-01-01T00:00:00.000Z",
        image: "https://example.com/og.png",
        metadata: { requestId: "contents-req" },
      });
    });

    it("keeps the requested URL and leaves out what Exa did not send", async () => {
      mockReadPostJSON.mockResolvedValueOnce({
        results: [{ id: "https://example.com", url: "", title: null, text: "plain" }],
      });
      const provider = await createReadProvider("exa", { apiKey: "test-key" });

      await expect(provider.read("https://example.com")).resolves.toEqual({
        url: "https://example.com",
        content: "plain",
      });
    });

    it("asks for a fresh crawl when noCache is set", async () => {
      const provider = await createReadProvider("exa", { apiKey: "test-key" });
      await provider.read("https://example.com", { noCache: true });

      const [, body] = mockReadPostJSON.mock.calls[0];
      expect(body.maxAgeHours).toBe(0);
    });

    it.each([
      [0.0001, 1],
      [20, 20_000],
      [120, 90_000],
    ])("turns timeout %s s into livecrawlTimeout %s ms", async (timeout, expected) => {
      const provider = await createReadProvider("exa", { apiKey: "test-key" });
      await provider.read("https://example.com", { timeout });

      const [, body] = mockReadPostJSON.mock.calls[0];
      expect(body.livecrawlTimeout).toBe(expected);
    });

    it("throws Exa's tag when the page could not be fetched", async () => {
      mockReadPostJSON.mockResolvedValueOnce({
        requestId: "contents-req",
        results: [],
        statuses: [
          {
            id: "https://example.com/missing",
            status: "error",
            error: { tag: "CRAWL_NOT_FOUND", httpStatusCode: 404 },
          },
        ],
      });
      const provider = await createReadProvider("exa", { apiKey: "test-key" });
      const failure = await provider
        .read("https://example.com/missing")
        .catch((caught: unknown) => caught);

      expect(failure).toBeInstanceOf(WebError);
      expect(failure).not.toBeInstanceOf(HTTPError);
      expect(failure).toMatchObject({ message: "Exa contents failed: CRAWL_NOT_FOUND (HTTP 404)" });
      expect(isFallbackEligible(failure, "exa", "read")).toBe(false);
    });

    it("throws when the response carries neither a page nor a failure", async () => {
      mockReadPostJSON.mockResolvedValueOnce({ requestId: "contents-req", results: [] });
      const provider = await createReadProvider("exa", { apiKey: "test-key" });

      await expect(provider.read("https://example.com")).rejects.toThrow(
        "Exa contents failed: no result returned",
      );
    });

    it("lets automatic reads move on when the credits are spent", async () => {
      mockReadPostJSON.mockRejectedValueOnce(
        new HTTPError(402, "https://api.exa.ai/contents", '{"tag":"NO_MORE_CREDITS"}'),
      );
      const provider = await createReadProvider("exa", { apiKey: "test-key" });
      const failure = await provider.read("https://example.com").catch((caught: unknown) => caught);

      expect(failure).toBeInstanceOf(HTTPError);
      expect(isFallbackEligible(failure, "exa", "read")).toBe(true);
    });
  });
});
