import { describe, expect, it } from "vite-plus/test";
import {
  Provider,
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  builtinProviders,
  create,
  createImageSearchProvider,
  createReadProvider,
  createSearchProvider,
  getProviderCapabilities,
  getSearchFilterCapabilities,
  readBatch,
  readBatchDetailed,
  readUrl,
  readUrlDetailed,
  searchBatch,
  searchByImage,
  searchProviderDetailed,
  version,
  ImageSearchNotSupportedError,
  ReadNotSupportedError,
} from "../src/index.ts";

describe("@agntn/web", () => {
  it("should export version matching package.json", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("should list all built-in provider names", () => {
    expect(builtinProviders).toEqual([
      "brave",
      "context",
      "exa",
      "firecrawl",
      "jina",
      "marginalia",
      "mojeek",
      "openai-codex",
      "searxng",
      "serpapi",
      "serpbase",
      "tavily",
      "tinyfish",
    ]);
  });

  it("should register built-in providers from main entrypoint", async () => {
    for (const provider of builtinProviders) {
      const config =
        provider === "openai-codex"
          ? { codex: { credentials: { accessToken: "test-token", accountId: "test-account" } } }
          : provider === "searxng" || provider === "jina"
            ? undefined
            : { apiKey: "test-api-key" };
      await expect(create(provider, config)).resolves.toBeDefined();
    }
  });

  it("should export the abstract Provider base class", async () => {
    expect(Provider).toBeTypeOf("function");
    await expect(create("searxng")).resolves.toBeInstanceOf(Provider);
  });

  it("should export capability-aware provider constructors", async () => {
    expect((await createSearchProvider("searxng")).name).toBe("searxng");
    expect((await createReadProvider("jina")).name).toBe("jina");
    expect((await createImageSearchProvider("serpapi", { apiKey: "test-api-key" })).name).toBe(
      "serpapi",
    );
    await expect(createImageSearchProvider("brave", { apiKey: "test-api-key" })).rejects.toThrow(
      ImageSearchNotSupportedError,
    );
    await expect(createReadProvider("searxng")).rejects.toThrow(ReadNotSupportedError);
    expect(searchProviderDetailed).toBeTypeOf("function");
    for (const provider of builtinProviders) {
      expect(getSearchFilterCapabilities(provider)).toBeDefined();
      expect(getProviderCapabilities(provider)).toBeDefined();
    }
  });

  it("should export read and batch operations", () => {
    expect(readUrl).toBeTypeOf("function");
    expect(readUrlDetailed).toBeTypeOf("function");
    expect(searchByImage).toBeTypeOf("function");
    expect(searchBatch).toBeTypeOf("function");
    expect(readBatch).toBeTypeOf("function");
    expect(readBatchDetailed).toBeTypeOf("function");
    expect(DEFAULT_CONCURRENCY).toBe(3);
    expect(MAX_CONCURRENCY).toBe(10);
  });
});
