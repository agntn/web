import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  prepareSearchWithFallback,
  searchAll,
  searchAllDetailed,
  searchProviderDetailed,
  searchWithFallback,
} from "../../src/core/all.ts";
import { searchBatch } from "../../src/core/batch.ts";

const { search, detect } = vi.hoisted(() => ({
  search: vi.fn(async () => [
    { url: "https://example.com/1", title: "One", snippet: "First" },
    { url: "https://example.com/2", title: "Two", snippet: "Second" },
  ]),
  detect: vi.fn(async () => ["brave"]),
}));

vi.mock("../../src/core/registry.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/registry.ts")>()),
  createSearchProvider: vi.fn(async () => ({ search })),
}));
vi.mock("../../src/core/resolve.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/resolve.ts")>()),
  detectAvailableProviders: () => ["brave"],
  detectAvailableProvidersAsync: detect,
}));

beforeEach(() => vi.clearAllMocks());

const searches = [
  [
    "single provider",
    (maxResults: number) => searchProviderDetailed("brave", "test", { maxResults }),
  ],
  ["automatic", (maxResults: number) => searchWithFallback("test", { maxResults })],
  ["prepared automatic", (maxResults: number) => prepareSearchWithFallback({ maxResults })],
  ["fanout", (maxResults: number) => searchAll("test", { providers: ["brave"], maxResults })],
  [
    "detailed fanout",
    (maxResults: number) => searchAllDetailed("test", { providers: ["brave"], maxResults }),
  ],
  [
    "named batch",
    (maxResults: number) => searchBatch(["one", "two"], { provider: "brave", maxResults }),
  ],
  ["automatic batch", (maxResults: number) => searchBatch(["one", "two"], { maxResults })],
  [
    "fanout batch",
    (maxResults: number) => searchBatch(["one", "two"], { provider: "all", maxResults }),
  ],
] as const;

describe.each(searches)("%s result limit", (_name, execute) => {
  it.each([0, -1, 1.5, NaN, Infinity, -Infinity])(
    "rejects %s before provider work",
    async (maxResults) => {
      await expect(execute(maxResults)).rejects.toThrow("maxResults must be a positive integer");
      expect(search).not.toHaveBeenCalled();
      expect(detect).not.toHaveBeenCalled();
    },
  );

  it("accepts a positive integer", async () => {
    await expect(execute(1)).resolves.toBeDefined();
  });
});

it("accepts omitted maxResults", async () => {
  await expect(searchAll("test", { providers: ["brave"] })).resolves.toHaveLength(2);
});
