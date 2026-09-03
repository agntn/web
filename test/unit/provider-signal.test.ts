import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetJSON =
  vi.fn<(url: string, headers?: unknown, signal?: Readonly<AbortSignal>) => Promise<unknown>>();
const mockPostJSON =
  vi.fn<
    (
      url: string,
      body: unknown,
      headers?: unknown,
      signal?: Readonly<AbortSignal>,
    ) => Promise<unknown>
  >();

vi.mock("../../src/core/client.ts", () => ({
  Client: vi.fn(function ClientMock() {
    return { getJSON: mockGetJSON, postJSON: mockPostJSON };
  }),
  defaultClient: vi.fn(() => ({ getJSON: mockGetJSON, postJSON: mockPostJSON })),
}));

import {
  createImageSearchProvider,
  createReadProvider,
  createSearchProvider,
} from "../../src/core/registry.ts";
import "../../src/providers/index.ts";

const searchProviders = [
  "brave",
  "context",
  "exa",
  "firecrawl",
  "jina",
  "mojeek",
  "searxng",
  "serpapi",
  "serpbase",
  "tavily",
  "tinyfish",
] as const;

beforeEach(() => {
  mockGetJSON.mockReset();
  mockPostJSON.mockReset();
  mockGetJSON.mockImplementation(async (url) => getResponse(url));
  mockPostJSON.mockImplementation(async (url) => postResponse(url));
});

describe("provider cancellation", () => {
  it("forwards one caller signal through every built-in provider request", async () => {
    const signal = new AbortController().signal;

    for (const providerName of searchProviders) {
      const provider = createSearchProvider(providerName, { apiKey: "test-key" });
      await provider.search("test", { signal });
    }

    await createImageSearchProvider("serpapi", { apiKey: "test-key" }).searchByImage(
      "https://example.com/image.jpg",
      { signal },
    );

    for (const providerName of ["jina", "context", "firecrawl", "tinyfish"] as const) {
      const provider = createReadProvider(providerName, { apiKey: "test-key" });
      await provider.read("https://example.com", { signal });
    }

    const forwardedSignals = [
      ...mockGetJSON.mock.calls.map((call) => call[2]),
      ...mockPostJSON.mock.calls.map((call) => call[3]),
    ];
    expect(forwardedSignals).toHaveLength(searchProviders.length + 1 + 4);
    expect(forwardedSignals.every((forwarded) => forwarded === signal)).toBe(true);
  });
});

function getResponse(url: string): unknown {
  if (url.includes("api.search.brave.com")) return { web: { results: [] } };
  if (url.includes("api.context.dev")) {
    return {
      success: true,
      markdown: "page",
      url: "https://example.com",
      metadata: {
        sourceUrl: "https://example.com",
        finalUrl: "https://example.com",
      },
      cache_metadata: {},
    };
  }
  if (url.includes(".jina.ai")) return jinaResponse(url);
  if (url.includes("api.mojeek.com")) {
    return { response: { status: "OK", results: [] } };
  }
  if (url.includes("localhost:8080")) return { results: [] };
  if (url.includes("serpapi.com")) {
    return url.includes("google_lens") ? { visual_matches: [] } : { organic_results: [] };
  }
  if (url.includes("search.tinyfish.ai")) return { results: [] };
  throw new Error(`Unexpected GET request: ${url}`);
}

function jinaResponse(url: string): unknown {
  return url.includes("s.jina.ai")
    ? { code: 200, status: 20_000, data: [] }
    : {
        code: 200,
        status: 20_000,
        data: { url: "https://example.com", content: "page" },
      };
}

function postResponse(url: string): unknown {
  if (url.includes("api.context.dev")) return { results: [] };
  if (url.includes("api.exa.ai")) return { requestId: "request", results: [] };
  if (url.includes("api.firecrawl.dev/v2/search")) {
    return { success: true, data: { web: [] } };
  }
  if (url.includes("api.firecrawl.dev/v2/scrape")) {
    return { success: true, data: { markdown: "page" } };
  }
  if (url.includes("serpbase.dev")) return { status: 0, organic: [] };
  if (url.includes("api.tavily.com")) return { results: [] };
  if (url.includes("api.fetch.tinyfish.ai")) {
    return {
      results: [{ url: "https://example.com", text: "page", format: "markdown" }],
    };
  }
  throw new Error(`Unexpected POST request: ${url}`);
}
