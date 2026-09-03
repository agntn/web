import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { HTTPError, SearchNotSupportedError, UnknownProviderError } from "../../src/core/errors.ts";

const mockLog = vi.fn<(message: unknown) => void>();
const mockInfo = vi.fn<(message: unknown) => void>();
const mockError = vi.fn<(message: unknown) => void>();

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

vi.mock("consola", () => ({
  consola: {
    log: (message: unknown) => mockLog(message),
    info: (message: unknown) => mockInfo(message),
    error: (message: unknown) => mockError(message),
  },
}));

vi.mock("../../src/core/registry.ts", () => ({
  createSearchProvider: (name: string, config: Readonly<Record<string, unknown>> = {}) =>
    mockCreate(name, config),
  getSearchFilterCapabilities: vi.fn(() => undefined),
  has: vi.fn(() => true),
  providers: vi.fn(() => ["brave", "exa"]),
}));

vi.mock("../../src/core/resolve.ts", () => ({
  detectAvailableProviders: () => mockDetectAvailableProviders(),
  detectAvailableProvidersAsync: () => mockDetectAvailableProvidersAsync(),
}));

vi.mock("../../src/providers/index.ts", () => ({}));

import searchCommand from "../../src/commands/search.ts";

type SearchRunInput = Parameters<NonNullable<typeof searchCommand.run>>[0];
type SearchRunArgs = {
  readonly _: readonly string[];
  readonly query: string;
  readonly provider?: string;
  readonly "max-results": string;
  readonly highlights: boolean;
  readonly summary: boolean;
  readonly "full-text": boolean;
  readonly json: boolean;
  [key: string]: string | number | boolean | readonly string[] | undefined;
};

const defaultArgs: SearchRunArgs = {
  _: [],
  query: "test query",
  "max-results": "10",
  highlights: true,
  summary: false,
  "full-text": false,
  json: false,
};

function makeArgs(overrides: Readonly<Partial<SearchRunArgs>> = {}): SearchRunArgs {
  return { ...defaultArgs, ...overrides };
}

function runSearch(overrides: Readonly<Partial<SearchRunArgs>> = {}) {
  const context = {
    args: makeArgs(overrides),
    rawArgs: [],
    cmd: searchCommand,
  } as SearchRunInput;
  return Promise.resolve(searchCommand.run!(context) as unknown);
}

describe("search command", () => {
  let exitSpy: MockInstance<typeof process.exit>;
  let stdoutSpy: MockInstance<typeof process.stdout.write> | undefined;

  beforeEach(() => {
    mockLog.mockReset();
    mockInfo.mockReset();
    mockError.mockReset();
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
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__EXIT__");
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy?.mockRestore();
    stdoutSpy = undefined;
  });

  it("falls through automatic providers after HTTP 402", async () => {
    const results = [{ url: "https://example.com", title: "Example", snippet: "Result" }];
    mockSearch
      .mockRejectedValueOnce(new HTTPError(402, "https://api.exa.ai/search", "Payment required"))
      .mockResolvedValueOnce(results);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSearch({ provider: undefined, json: true });

    expect(mockCreate.mock.calls.map(([name]) => name)).toEqual(["exa", "brave"]);
    expect(stdoutSpy).toHaveBeenCalledWith(
      `${JSON.stringify(
        {
          provider: "brave",
          ignoredFilters: [],
          undeclaredFilters: [],
          results,
          attempts: ["exa", "brave"],
          failures: [
            {
              provider: "exa",
              error: "HTTP 402: https://api.exa.ai/search: Payment required",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });

  it("keeps HTTP 402 visible for an explicit provider", async () => {
    const failure = new HTTPError(402, "https://api.exa.ai/search", "Payment required");
    mockSearch.mockRejectedValueOnce(failure);

    await expect(runSearch({ provider: "exa" })).rejects.toBe(failure);

    expect(mockCreate.mock.calls.map(([name]) => name)).toEqual(["exa"]);
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

    await runSearch({ provider: "exa" });

    expect(mockLog.mock.calls.map(([message]) => message)).toEqual([
      `${escape}[1m${escape}[36mResult link${escape}[0m`,
      "  https://example.com/ spoofed",
      `  ${escape}[90msafe text${escape}[0m`,
      "",
    ]);
  });

  it("prints detailed provider metadata in JSON output", async () => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSearch({ provider: "firecrawl", json: true });

    expect(mockSearchDetailed).toHaveBeenCalledWith("test query", {
      maxResults: 10,
      highlights: true,
    });
    expect(mockSearch).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(
      `${JSON.stringify(
        {
          provider: "firecrawl",
          ignoredFilters: [],
          undeclaredFilters: [],
          results: [],
          metadata: { id: "job-1", creditsUsed: 1 },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("prints the shared detailed envelope for providers without response metadata", async () => {
    const results = [{ url: "https://example.com", title: "Example", snippet: "Result" }];
    mockSearch.mockResolvedValueOnce(results);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSearch({ provider: "exa", json: true });

    expect(mockSearch).toHaveBeenCalledWith("test query", {
      maxResults: 10,
      highlights: true,
    });
    expect(mockSearchDetailed).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(
      `${JSON.stringify(
        {
          provider: "exa",
          ignoredFilters: [],
          undeclaredFilters: [],
          results,
        },
        null,
        2,
      )}\n`,
    );
  });

  it("fans out through every configured provider and keeps partial errors", async () => {
    const results = [{ url: "https://example.com", title: "Example", snippet: "Result" }];
    mockSearch.mockResolvedValueOnce(results).mockRejectedValueOnce(new Error("Brave unavailable"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSearch({ provider: "all", json: true });

    expect(mockCreate.mock.calls.map(([name]) => name)).toEqual(["exa", "brave"]);
    expect(stdoutSpy).toHaveBeenCalledWith(
      `${JSON.stringify(
        {
          results: [
            {
              ...results[0],
              provider: "exa",
              providers: ["exa"],
              evidence: [{ ...results[0], provider: "exa" }],
            },
          ],
          successfulProviders: ["exa"],
          errors: [{ provider: "brave", error: "Brave unavailable" }],
          filterReports: [],
        },
        null,
        2,
      )}\n`,
    );
  });

  it("runs extra positional queries as one ordered batch", async () => {
    mockSearch
      .mockResolvedValueOnce([{ url: "https://one.example", title: "One", snippet: "First" }])
      .mockResolvedValueOnce([{ url: "https://two.example", title: "Two", snippet: "Second" }]);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSearch({ _: ["first query", "second query"], provider: "exa", json: true });

    expect(mockSearch.mock.calls.map(([query]) => String(query))).toEqual([
      "first query",
      "second query",
    ]);
    expect(stdoutSpy).toHaveBeenCalledWith(
      `${JSON.stringify(
        [
          {
            query: "first query",
            provider: "exa",
            results: [{ url: "https://one.example", title: "One", snippet: "First" }],
            filterReports: [],
          },
          {
            query: "second query",
            provider: "exa",
            results: [{ url: "https://two.example", title: "Two", snippet: "Second" }],
            filterReports: [],
          },
        ],
        null,
        2,
      )}\n`,
    );
  });

  it("parses search filters into the shared option shape", async () => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSearch({
      provider: "firecrawl",
      json: true,
      "include-domains": "github.com, example.com",
      "exclude-domains": "spam.example",
      sources: "web,news",
      categories: "research,developer",
      category: "news",
      "start-published-date": "2024-01-01",
      "end-published-date": "2024-12-31",
    });

    expect(mockSearchDetailed).toHaveBeenCalledWith("test query", {
      maxResults: 10,
      highlights: true,
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
    await runSearch({
      provider: "firecrawl",
      highlights: false,
      summary: true,
      "full-text": true,
    });

    expect(mockSearchDetailed).toHaveBeenCalledWith("test query", {
      maxResults: 10,
      highlights: false,
      summary: true,
      fullText: true,
    });
  });

  it("treats empty string provider as omitted", async () => {
    await runSearch({ provider: "" });

    expect(mockCreate).toHaveBeenCalledWith("exa", {});
  });

  it("exits with a helpful message for non-numeric --max-results", async () => {
    await expect(runSearch({ "max-results": "abc" })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith(
      "Invalid --max-results value. Expected a positive integer.",
    );
    expect(mockSearch).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with a helpful message for zero --max-results", async () => {
    await expect(runSearch({ "max-results": "0" })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith(
      "Invalid --max-results value. Expected a positive integer.",
    );
    expect(mockSearch).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with a helpful message for negative --max-results", async () => {
    await expect(runSearch({ "max-results": "-1" })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith(
      "Invalid --max-results value. Expected a positive integer.",
    );
    expect(mockSearch).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("reports an unknown explicit provider by name", async () => {
    mockCreate.mockImplementationOnce(() => {
      throw new UnknownProviderError("brave");
    });

    await expect(runSearch({ provider: "brave" })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith("Unknown provider: brave");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("reports providers without search capability", async () => {
    mockCreate.mockImplementationOnce(() => {
      throw new SearchNotSupportedError("reader");
    });

    await expect(runSearch({ provider: "reader" })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith('Provider "reader" does not support web search.');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with error for empty query", async () => {
    await expect(runSearch({ query: "" })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith("Search query cannot be empty.");
    expect(mockSearch).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with error for whitespace-only query", async () => {
    await expect(runSearch({ query: "   " })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith("Search query cannot be empty.");
    expect(mockSearch).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("shows a helpful message when no provider is configured", async () => {
    mockDetectAvailableProvidersAsync.mockResolvedValueOnce([]);
    mockDetectAvailableProviders.mockReturnValueOnce([]);

    await expect(runSearch({ provider: undefined })).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith(
      "No web search provider configured. Set an API key env var or register a provider.",
    );
    expect(mockInfo).toHaveBeenCalledWith("Registered providers: brave, exa");
    expect(mockInfo).toHaveBeenCalledWith(
      "Set one provider API key env var or pass --provider explicitly.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
