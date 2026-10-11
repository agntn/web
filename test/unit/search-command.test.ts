import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { HTTPError } from "../../src/core/errors.ts";
import { runWeb } from "../fixtures/cli.ts";

const mockSearch = vi.fn();
const mockSearchDetailed = vi.fn();
const mockCreate = vi.fn((name: string, config: Readonly<Record<string, unknown>>) => {
  void config;
  return name === "firecrawl"
    ? { search: mockSearch, searchDetailed: mockSearchDetailed }
    : { search: mockSearch };
});
const mockDetectAvailableProviders = vi.fn(() => ["exa", "brave"]);
const mockDetectAvailableProvidersAsync = vi.fn(async () => ["exa", "brave"]);

vi.mock("../../src/core/registry.ts", () => ({
  createSearchProvider: (name: string, config: Readonly<Record<string, unknown>> = {}) =>
    mockCreate(name, config),
  getSearchFilterCapabilities: vi.fn(() => undefined),
  has: vi.fn(() => true),
  providers: vi.fn(() => ["brave", "exa", "firecrawl"]),
  searchProviders: vi.fn(() => ["brave", "exa", "firecrawl"]),
}));

vi.mock("../../src/core/resolve.ts", () => ({
  detectAvailableProviders: () => mockDetectAvailableProviders(),
  detectAvailableProvidersAsync: () => mockDetectAvailableProvidersAsync(),
  probeConfiguredProvider: async () => undefined,
}));

vi.mock("../../src/providers/index.ts", () => ({}));

/**
 * The details `web search --json` printed.
 * @param stdout - Everything the command wrote to stdout.
 * @returns {unknown} The data under `result`.
 */
function jsonResult(stdout: string): unknown {
  return (JSON.parse(stdout) as { readonly result: unknown }).result;
}

describe("search command", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearchDetailed.mockReset();
    mockCreate.mockClear();
    mockDetectAvailableProviders.mockClear();
    mockDetectAvailableProvidersAsync.mockClear();
    mockSearch.mockResolvedValue([]);
    mockSearchDetailed.mockResolvedValue({
      results: [],
      metadata: { id: "job-1", creditsUsed: 1 },
    });
  });

  it("exposes an opaque continuation argument", async () => {
    const { stdout } = await runWeb("search", "--help");

    expect(stdout).toContain("--continuation=<continuation>");
  });

  it("selects providers automatically when the provider argument is blank", async () => {
    await runWeb("search", "test query", "--provider", "   ");

    expect(mockDetectAvailableProvidersAsync).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith("exa", expect.anything());
  });

  it("searches when the first word names no command", async () => {
    await runWeb("test query", "--provider", "exa");

    expect(mockSearch).toHaveBeenCalledWith("test query", expect.anything());
  });

  it("searches when the line opens with a search flag", async () => {
    await runWeb("--provider", "exa", "test query");

    expect(mockSearch).toHaveBeenCalledWith("test query", expect.anything());
  });

  it("falls through automatic providers after HTTP 402", async () => {
    const results = [{ url: "https://example.com", title: "Example", snippet: "Result" }];
    mockSearch
      .mockRejectedValueOnce(new HTTPError(402, "https://api.exa.ai/search", "Payment required"))
      .mockResolvedValueOnce(results);

    const { stdout } = await runWeb("search", "test query", "--json");

    expect(mockCreate.mock.calls.map(([name]) => name)).toEqual(["exa", "brave"]);
    expect(jsonResult(stdout)).toEqual({
      provider: "brave",
      ignoredFilters: [],
      undeclaredFilters: [],
      results,
      pagination: { status: "unsupported" },
      attempts: ["exa", "brave"],
      failures: [
        { provider: "exa", error: "HTTP 402: https://api.exa.ai/search: Payment required" },
      ],
    });
  });

  it("keeps HTTP 402 visible for an explicit provider", async () => {
    mockSearch.mockRejectedValueOnce(
      new HTTPError(402, "https://api.exa.ai/search", "Payment required"),
    );

    const { stderr, code } = await runWeb("search", "test query", "--provider", "exa");

    expect(mockCreate.mock.calls.map(([name]) => name)).toEqual(["exa"]);
    expect(stderr).toBe("HTTP 402: https://api.exa.ai/search: Payment required\n");
    expect(code).toBe(1);
  });

  it("removes terminal controls from human-readable results", async () => {
    const escape = String.fromCodePoint(0x1b);
    const bell = String.fromCodePoint(0x07);
    const controlSequence = String.fromCodePoint(0x9b);
    const lineSeparator = String.fromCodePoint(0x2028);
    const rightToLeftOverride = String.fromCodePoint(0x202e);
    mockSearch.mockResolvedValueOnce([
      {
        title: `Result${escape}]8;;https://evil.example${bell} link${escape}]8;;${bell}`,
        url: `https://example.com/${lineSeparator}spoofed`,
        snippet: `safe${controlSequence}31m${rightToLeftOverride}text`,
      },
    ]);

    const { stdout } = await runWeb("search", "test query", "--provider", "exa");

    expect(stdout).toBe(
      [
        '[provider=exa] 1 result(s) for "test query"',
        "",
        "1. Result link",
        "   https://example.com/ spoofed",
        "   Snippet: safe text",
        "",
      ].join("\n"),
    );
  });

  it("prints detailed provider metadata in JSON output", async () => {
    const { stdout } = await runWeb("search", "test query", "--provider", "firecrawl", "--json");

    expect(mockSearchDetailed).toHaveBeenCalledWith("test query", {});
    expect(mockSearch).not.toHaveBeenCalled();
    expect(jsonResult(stdout)).toEqual({
      provider: "firecrawl",
      ignoredFilters: [],
      undeclaredFilters: [],
      results: [],
      pagination: { status: "unsupported" },
      metadata: { id: "job-1", creditsUsed: 1 },
    });
  });

  it("prints the shared detailed envelope for providers without response metadata", async () => {
    const results = [{ url: "https://example.com", title: "Example", snippet: "Result" }];
    mockSearch.mockResolvedValueOnce(results);

    const { stdout } = await runWeb("search", "test query", "--provider", "exa", "--json");

    expect(mockSearch).toHaveBeenCalledWith("test query", {});
    expect(mockSearchDetailed).not.toHaveBeenCalled();
    expect(jsonResult(stdout)).toEqual({
      provider: "exa",
      ignoredFilters: [],
      undeclaredFilters: [],
      results,
      pagination: { status: "unsupported" },
    });
  });

  it("fans out through every configured provider and keeps partial errors", async () => {
    const results = [{ url: "https://example.com", title: "Example", snippet: "Result" }];
    mockSearch.mockResolvedValueOnce(results).mockRejectedValueOnce(new Error("Brave unavailable"));

    const { stdout } = await runWeb("search", "test query", "--provider", "all", "--json");

    expect(mockCreate.mock.calls.map(([name]) => name)).toEqual(["exa", "brave"]);
    expect(jsonResult(stdout)).toEqual({
      results: [{ ...results[0], provider: "exa", providers: ["exa"] }],
      successfulProviders: ["exa"],
      errors: [{ provider: "brave", error: "Brave unavailable" }],
      filterReports: [],
      providerPagination: [{ provider: "exa", pagination: { status: "unsupported" } }],
    });
  });

  it("runs extra positional queries as one ordered batch", async () => {
    mockSearch
      .mockResolvedValueOnce([{ url: "https://one.example", title: "One", snippet: "First" }])
      .mockResolvedValueOnce([{ url: "https://two.example", title: "Two", snippet: "Second" }]);

    const { stdout } = await runWeb(
      "search",
      "first query",
      "second query",
      "--provider",
      "exa",
      "--json",
    );

    expect(mockSearch.mock.calls.map(([query]) => String(query))).toEqual([
      "first query",
      "second query",
    ]);
    expect(jsonResult(stdout)).toEqual([
      {
        query: "first query",
        provider: "exa",
        results: [{ url: "https://one.example", title: "One", snippet: "First" }],
        filterReports: [],
        pagination: { status: "unsupported" },
      },
      {
        query: "second query",
        provider: "exa",
        results: [{ url: "https://two.example", title: "Two", snippet: "Second" }],
        filterReports: [],
        pagination: { status: "unsupported" },
      },
    ]);
  });

  it("passes search filters through in the shared option shape", async () => {
    await runWeb(
      "search",
      "test query",
      "--provider",
      "firecrawl",
      "--include-domains",
      '["github.com", "example.com"]',
      "--exclude-domains",
      '["spam.example"]',
      "--sources",
      '["web", "news"]',
      "--categories",
      '["research", "developer"]',
      "--category",
      "news",
      "--start-published-date",
      "2024-01-01",
      "--end-published-date",
      "2024-12-31",
    );

    expect(mockSearchDetailed).toHaveBeenCalledWith("test query", {
      includeDomains: ["github.com", "example.com"],
      excludeDomains: ["spam.example"],
      sources: ["web", "news"],
      categories: ["research", "developer"],
      category: "news",
      startPublishedDate: "2024-01-01",
      endPublishedDate: "2024-12-31",
    });
  });

  it("passes explicit content preferences to the provider", async () => {
    await runWeb(
      "search",
      "test query",
      "--provider",
      "firecrawl",
      "--max-results",
      "5",
      "--no-highlights",
      "--summary",
      "--full-text",
    );

    expect(mockSearchDetailed).toHaveBeenCalledWith("test query", {
      maxResults: 5,
      highlights: false,
      summary: true,
      fullText: true,
    });
  });

  it("treats empty string provider as omitted", async () => {
    await runWeb("search", "test query", "--provider", "");

    expect(mockCreate).toHaveBeenCalledWith("exa", {});
  });

  it.each([
    ["abc", "must be integer"],
    ["0", "must be >= 1"],
    ["-1", "must be >= 1"],
  ])("refuses --max-results %s before searching", async (value, problem) => {
    const { stderr, code } = await runWeb("search", "test query", "--max-results", value);

    expect(stderr).toBe(`Invalid arguments at --max-results: ${problem}\n`);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(code).toBe(1);
  });

  it("names the providers a search can use when the one asked for is unknown", async () => {
    const { stderr, code } = await runWeb("search", "test query", "--provider", "reader");

    expect(stderr).toBe("provider must be one of: auto, all, brave, exa, firecrawl\n");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(code).toBe(1);
  });

  it("exits with error for empty query", async () => {
    const { stderr, code } = await runWeb("search", "");

    expect(stderr).toBe(
      "Invalid arguments at word 1 of <QUERIES...>: must not have fewer than 1 characters\n",
    );
    expect(mockSearch).not.toHaveBeenCalled();
    expect(code).toBe(1);
  });

  it("exits with error for whitespace-only query", async () => {
    const { stderr, code } = await runWeb("search", "   ");

    expect(stderr).toBe("Search query cannot be empty\n");
    expect(mockSearch).not.toHaveBeenCalled();
    expect(code).toBe(1);
  });

  it("says so in one line when no provider is configured", async () => {
    mockDetectAvailableProvidersAsync.mockResolvedValueOnce([]);
    mockDetectAvailableProviders.mockReturnValueOnce([]);

    const { stderr, code } = await runWeb("search", "test query");

    expect(stderr).toBe(
      "No web search provider configured. Set an API key env var or register a provider.\n",
    );
    expect(code).toBe(1);
  });
});
