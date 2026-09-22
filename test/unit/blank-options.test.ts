import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  searchAllDetailed,
  searchProviderDetailed,
  searchWithFallback,
} from "../../src/core/all.ts";
import { readBatchDetailed, searchBatch } from "../../src/core/batch.ts";
import { readUrlDetailed } from "../../src/core/read.ts";
import { executeRead, executeSearch } from "../../src/mcp.ts";
import { InvalidDateFilterError, InvalidSearchContinuationError } from "../../src/core/errors.ts";
import { Provider } from "../../src/core/provider.ts";
import { register } from "../../src/core/registry.ts";
import type {
  ProviderConfig,
  ReadOptions,
  ReadResult,
  SearchRequestOptions,
  SearchResult,
} from "../../src/core/types.ts";

interface ProviderSearchPage {
  readonly results: SearchResult[];
  readonly continuation?: string;
  readonly continuationStatus?: "next" | "unknown";
}

const cleanups: Array<() => void> = [];
const searchCalls: Array<SearchRequestOptions | undefined> = [];
const readCalls: Array<ReadOptions | undefined> = [];
const pageCalls: Array<{ options?: SearchRequestOptions; continuation?: string }> = [];

const result: SearchResult = { url: "https://example.com", title: "Example", snippet: "Example" };

function registerSearchProvider(name: string): void {
  class BlankSearchProvider extends Provider {
    static readonly providerName = name;
    static readonly defaultBaseURL = "https://search.example.com";

    constructor(config: Readonly<ProviderConfig>) {
      super(config, BlankSearchProvider);
    }

    async search(_query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
      searchCalls.push(options);
      return [result];
    }
  }

  cleanups.push(register(BlankSearchProvider));
}

function registerPaginatedProvider(name: string): void {
  class BlankPageProvider extends Provider {
    static readonly providerName = name;
    static readonly defaultBaseURL = "https://page.example.com";

    constructor(config: Readonly<ProviderConfig>) {
      super(config, BlankPageProvider);
    }

    async search(_query: string, options?: SearchRequestOptions): Promise<SearchResult[]> {
      searchCalls.push(options);
      return [result];
    }

    async searchPage(
      _query: string,
      options?: SearchRequestOptions,
      continuation?: string,
    ): Promise<ProviderSearchPage> {
      pageCalls.push({ options, continuation });
      return { results: [result], continuation: "provider-page-2", continuationStatus: "next" };
    }
  }

  cleanups.push(register(BlankPageProvider));
}

function registerReadProvider(name: string): void {
  class BlankReadProvider extends Provider {
    static readonly providerName = name;
    static readonly defaultBaseURL = "https://reader.example.com";

    constructor(config: Readonly<ProviderConfig>) {
      super(config, BlankReadProvider);
    }

    async read(url: string, options?: Readonly<ReadOptions>): Promise<ReadResult> {
      readCalls.push(options);
      return { url, content: "page content" };
    }
  }

  cleanups.push(register(BlankReadProvider));
}

beforeEach(() => {
  searchCalls.length = 0;
  readCalls.length = 0;
  pageCalls.length = 0;
  vi.stubEnv("EXA_API_KEY", "test-key");
  registerSearchProvider("exa");
  registerReadProvider("jina");
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe("blank optional inputs", () => {
  it("searches a provider when optional filters arrive blank", async () => {
    const response = await searchProviderDetailed("exa", "test", {
      continuation: "",
      category: "",
      startPublishedDate: "",
      endPublishedDate: "   ",
    });

    expect(response.results).toHaveLength(1);
    expect(searchCalls[0]?.category).toBeUndefined();
    expect(searchCalls[0]?.startPublishedDate).toBeUndefined();
    expect(searchCalls[0]?.endPublishedDate).toBeUndefined();
  });

  it("falls back automatically when the continuation arrives blank", async () => {
    const response = await searchWithFallback("test", { continuation: "" });

    expect(response.provider).toBe("exa");
    expect(response.results).toHaveLength(1);
  });

  it("fans out when the continuation arrives blank", async () => {
    const response = await searchAllDetailed("test", { providers: ["exa"], continuation: "" });

    expect(response.results).toHaveLength(1);
  });

  it("batches queries when the continuation arrives blank", async () => {
    const outcomes = await searchBatch(["test"], { provider: "exa", continuation: "" });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).not.toHaveProperty("error");
  });

  it("keeps a continuation valid across blank and omitted filters", async () => {
    registerPaginatedProvider("mojeek");
    const first = await searchProviderDetailed("mojeek", "test", {
      category: "",
      startPublishedDate: "",
    });
    expect(first.pagination.status).toBe("next");
    const token = first.pagination.status === "next" ? first.pagination.continuation : "";

    const second = await searchProviderDetailed("mojeek", "test", { continuation: token });

    expect(second.results).toHaveLength(1);
    expect(pageCalls[1]?.continuation).toBe("provider-page-2");
  });

  it("still rejects a malformed continuation and a malformed date", async () => {
    await expect(searchProviderDetailed("exa", "test", { continuation: ">" })).rejects.toThrow(
      InvalidSearchContinuationError,
    );
    await expect(
      searchProviderDetailed("exa", "test", { startPublishedDate: "not-a-date" }),
    ).rejects.toThrow(InvalidDateFilterError);
  });

  it("reads a URL when optional read inputs arrive blank", async () => {
    const response = await readUrlDetailed("https://example.com", {
      provider: "jina",
      continuation: "",
      targetSelector: "",
      removeSelector: "  ",
    });

    expect(response.result.content).toBe("page content");
    expect(readCalls[0]?.targetSelector).toBeUndefined();
    expect(readCalls[0]?.removeSelector).toBeUndefined();
  });

  it("reads a batch when the continuation arrives blank", async () => {
    const outcomes = await readBatchDetailed(["https://example.com"], {
      provider: "jina",
      continuation: "",
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).not.toHaveProperty("error");
  });
});

describe("blank optional MCP arguments", () => {
  it("searches when the optional string arguments arrive blank", async () => {
    const response = await executeSearch({
      query: "test",
      provider: "",
      continuation: "",
      category: "",
      startPublishedDate: "",
      endPublishedDate: "",
    });

    expect(response).toMatchObject({ provider: "exa" });
  });

  it("reads when the optional string arguments arrive blank", async () => {
    const response = await executeRead({
      url: "https://example.com",
      provider: "",
      format: "",
      continuation: "",
      targetSelector: "",
      removeSelector: "",
    });

    expect(response).toMatchObject({ provider: "jina" });
  });

  it("still rejects an unknown provider and an unknown format", async () => {
    await expect(executeSearch({ query: "test", provider: "nope" })).rejects.toThrow(TypeError);
    await expect(executeRead({ url: "https://example.com", format: "pdf" })).rejects.toThrow(
      TypeError,
    );
  });
});
