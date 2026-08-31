import { describe, expect, it } from "vitest";
import {
  Provider,
  builtinProviders,
  create,
  createImageSearchProvider,
  createReadProvider,
  createSearchProvider,
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
      "mojeek",
      "searxng",
      "serpapi",
      "serpbase",
      "tavily",
      "tinyfish",
    ]);
  });

  it("should register built-in providers from main entrypoint", () => {
    for (const provider of builtinProviders) {
      const config =
        provider === "searxng" || provider === "jina" ? undefined : { apiKey: "test-api-key" };
      expect(() => create(provider, config)).not.toThrow();
    }
  });

  it("should export the abstract Provider base class", () => {
    expect(Provider).toBeTypeOf("function");
    expect(create("searxng")).toBeInstanceOf(Provider);
  });

  it("should export capability-aware provider constructors", () => {
    expect(createSearchProvider("searxng").name).toBe("searxng");
    expect(createReadProvider("jina").name).toBe("jina");
    expect(createImageSearchProvider("serpapi", { apiKey: "test-api-key" }).name).toBe("serpapi");
    expect(() => createImageSearchProvider("brave", { apiKey: "test-api-key" })).toThrow(
      ImageSearchNotSupportedError,
    );
    expect(() => createReadProvider("searxng")).toThrow(ReadNotSupportedError);
    expect(searchProviderDetailed).toBeTypeOf("function");
    for (const provider of builtinProviders) {
      expect(getSearchFilterCapabilities(provider)).toBeDefined();
    }
  });

  it("should export read and batch operations", () => {
    expect(readUrl).toBeTypeOf("function");
    expect(readUrlDetailed).toBeTypeOf("function");
    expect(searchByImage).toBeTypeOf("function");
    expect(searchBatch).toBeTypeOf("function");
    expect(readBatch).toBeTypeOf("function");
    expect(readBatchDetailed).toBeTypeOf("function");
  });
});
