import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetJSON = vi.fn<(url: string) => Promise<unknown>>();

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

import {
  AuthError,
  InvalidSearchContinuationError,
  RateLimitError,
  WebError,
} from "../../src/core/errors.ts";
import { isPaginatedSearchProvider } from "../../src/core/provider.ts";
import { createSearchProvider, has } from "../../src/core/registry.ts";
import "../../src/providers/mojeek.ts";

const mojeekResponse = {
  response: {
    status: "OK",
    head: {
      query: "independent search",
      start: 1,
      return: 1,
      results: 42,
    },
    results: [
      {
        url: "https://example.com/search",
        title: "Independent search",
        desc: "A page about independent web search.",
        score: 20.36,
        pdate: 1_720_512_000,
        timestamp: 1_720_598_400,
        cdatetimestamp: 1_720_684_800,
        size: "12kb",
        cfs: 4,
        mres: 1,
        image: {
          url: "https://example.com/search.png",
          width: 640,
          height: 360,
        },
      },
    ],
  },
};

describe("mojeek provider", () => {
  beforeEach(() => {
    mockGetJSON.mockReset();
    mockGetJSON.mockResolvedValue(mojeekResponse);
    delete process.env.MOJEEK_API_KEY;
  });

  it("registers itself on import", () => {
    expect(has("mojeek")).toBe(true);
  });

  it("requires an API key", () => {
    expect(() => createSearchProvider("mojeek")).toThrow(AuthError);
  });

  it("searches with result, domain, and date parameters", async () => {
    const provider = createSearchProvider("mojeek", {
      apiKey: "test-key",
      baseURL: "https://proxy.example.com/mojeek/",
    });

    await provider.search("independent search", {
      maxResults: 7,
      includeDomains: ["example.com", ".example.org"],
      excludeDomains: ["spam.example"],
      startPublishedDate: "2024-01-02T03:04:05Z",
      endPublishedDate: "2024-02-03",
    });

    expect(mockGetJSON).toHaveBeenCalledOnce();
    const [url] = mockGetJSON.mock.calls[0];
    const request = new URL(url);
    expect(`${request.origin}${request.pathname}`).toBe("https://proxy.example.com/mojeek/search");
    expect(Object.fromEntries(request.searchParams)).toEqual({
      q: "independent search",
      api_key: "test-key",
      fmt: "json",
      t: "7",
      date: "1",
      cdate: "1",
      size: "1",
      fi: "example.com,.example.org",
      fe: "spam.example",
      since: "20240102",
      before: "20240203",
    });
  });

  it("derives continuation from the response offset when Mojeek normalizes the request", async () => {
    mockGetJSON.mockResolvedValueOnce({
      response: {
        status: "OK",
        head: { query: "independent search", start: 10, return: 5, results: 100 },
        results: [mojeekResponse.response.results[0]],
      },
    });
    const provider = createSearchProvider("mojeek", { apiKey: "test-key" });
    if (!isPaginatedSearchProvider(provider)) throw new Error("Mojeek must support pagination");

    const page = await provider.searchPage("independent search", { maxResults: 5 }, "8");

    expect(new URL(mockGetJSON.mock.calls[0][0]).searchParams.get("s")).toBe("8");
    expect(page.continuation).toBe("15");
  });

  it("continues from the returned result offset and reports the terminal page", async () => {
    mockGetJSON.mockResolvedValueOnce({
      response: {
        status: "OK",
        head: { query: "independent search", start: 8, return: 1, results: 8 },
        results: [mojeekResponse.response.results[0]],
      },
    });
    const provider = createSearchProvider("mojeek", { apiKey: "test-key" });
    if (!isPaginatedSearchProvider(provider)) throw new Error("Mojeek must support pagination");

    const page = await provider.searchPage("independent search", { maxResults: 1 }, "8");

    expect(new URL(mockGetJSON.mock.calls[0][0]).searchParams.get("s")).toBe("8");
    expect(page.continuation).toBeUndefined();
  });

  it("rejects result offsets beyond Mojeek's result window before the request", async () => {
    const provider = createSearchProvider("mojeek", { apiKey: "test-key" });
    if (!isPaginatedSearchProvider(provider)) throw new Error("Mojeek must support pagination");

    await provider.searchPage("independent search", undefined, "1000");
    expect(new URL(mockGetJSON.mock.calls[0][0]).searchParams.get("s")).toBe("1000");

    mockGetJSON.mockClear();
    await expect(provider.searchPage("independent search", undefined, "1001")).rejects.toThrow(
      InvalidSearchContinuationError,
    );
    expect(mockGetJSON).not.toHaveBeenCalled();
  });

  it("maps search results and native metadata", async () => {
    const provider = createSearchProvider("mojeek", { apiKey: "test-key" });

    await expect(provider.search("independent search")).resolves.toEqual([
      {
        url: "https://example.com/search",
        title: "Independent search",
        snippet: "A page about independent web search.",
        score: 20.36,
        publishedDate: "2024-07-09T08:00:00.000Z",
        image: "https://example.com/search.png",
        metadata: {
          confidence: 4,
          documentSize: "12kb",
          lastModifiedDate: "2024-07-10T08:00:00.000Z",
          crawledDate: "2024-07-11T08:00:00.000Z",
          moreResultsFromDomain: true,
          imageWidth: 640,
          imageHeight: 360,
        },
      },
    ]);
  });

  it("returns an empty list for a valid response without results", async () => {
    mockGetJSON.mockResolvedValueOnce({
      response: {
        status: "OK",
        head: { query: "nothing", start: 1, return: 0, results: 0 },
        results: [],
      },
    });
    const provider = createSearchProvider("mojeek", { apiKey: "test-key" });

    await expect(provider.search("nothing")).resolves.toEqual([]);
  });

  it("maps an access-denied payload to AuthError", async () => {
    mockGetJSON.mockResolvedValueOnce({
      response: {
        status: "Access Denied: invalid key/password",
        head: { query: "test", start: 1, return: 0, results: 0 },
        results: [],
      },
    });
    const provider = createSearchProvider("mojeek", { apiKey: "invalid-key" });

    await expect(provider.search("test")).rejects.toThrow(AuthError);
  });

  it("maps a daily-limit payload to RateLimitError", async () => {
    mockGetJSON.mockResolvedValueOnce({
      response: {
        status: "ERROR: Daily Limit Reached",
        head: { query: "test", start: 1, return: 0, results: 0 },
        results: [],
      },
    });
    const provider = createSearchProvider("mojeek", { apiKey: "test-key" });

    await expect(provider.search("test")).rejects.toThrow(RateLimitError);
  });

  it("rejects other unsuccessful payloads", async () => {
    mockGetJSON.mockResolvedValueOnce({
      response: {
        status: "ERROR: Search unavailable",
        head: { query: "test", start: 1, return: 0, results: 0 },
        results: [],
      },
    });
    const provider = createSearchProvider("mojeek", { apiKey: "test-key" });

    await expect(provider.search("test")).rejects.toThrow(WebError);
  });
});
