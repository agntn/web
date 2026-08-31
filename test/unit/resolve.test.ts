import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  detectAvailableProviders,
  resolveDefaultProvider,
  listProviders,
} from "../../src/core/resolve.ts";
import "../../src/providers/index.ts";

const envKeys = [
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "CONTEXT_DEV_API_KEY",
  "FIRECRAWL_API_KEY",
  "JINA_API_KEY",
  "MOJEEK_API_KEY",
  "TAVILY_API_KEY",
  "TINYFISH_API_KEY",
  "SERPAPI_API_KEY",
  "SERPBASE_API_KEY",
] as const;

describe("resolve", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  describe("detectAvailableProviders", () => {
    it("should detect provider when its env var is set", () => {
      process.env.EXA_API_KEY = "test-key";
      const available = detectAvailableProviders();
      expect(available).toContain("exa");
    });

    it("should detect multiple providers", () => {
      process.env.EXA_API_KEY = "test-key";
      process.env.BRAVE_API_KEY = "test-key";
      process.env.CONTEXT_DEV_API_KEY = "test-key";
      process.env.JINA_API_KEY = "test-key";
      process.env.MOJEEK_API_KEY = "test-key";
      process.env.TINYFISH_API_KEY = "test-key";
      const available = detectAvailableProviders();
      expect(available).toContain("exa");
      expect(available).toContain("brave");
      expect(available).toContain("context");
      expect(available).toContain("jina");
      expect(available).toContain("mojeek");
      expect(available).toContain("tinyfish");
    });

    it("should always include searxng when registered", () => {
      const available = detectAvailableProviders();
      expect(available).toContain("searxng");
    });

    it("should not include providers without env vars set", () => {
      const available = detectAvailableProviders();
      expect(available).not.toContain("exa");
      expect(available).not.toContain("brave");
      expect(available).not.toContain("context");
      expect(available).not.toContain("jina");
      expect(available).not.toContain("tavily");
      expect(available).not.toContain("tinyfish");
      expect(available).not.toContain("serpapi");
      expect(available).not.toContain("serpbase");
    });
  });

  describe("resolveDefaultProvider", () => {
    it("should return brave when only BRAVE_API_KEY is set", () => {
      process.env.BRAVE_API_KEY = "test-key";
      expect(resolveDefaultProvider()).toBe("brave");
    });

    it("should prefer exa when multiple are set", () => {
      process.env.EXA_API_KEY = "test-key";
      process.env.BRAVE_API_KEY = "test-key";
      expect(resolveDefaultProvider()).toBe("exa");
    });

    it("should fall back to searxng when no API keys set", () => {
      expect(resolveDefaultProvider()).toBe("searxng");
    });
  });

  describe("listProviders", () => {
    it("should return all builtin providers", () => {
      const list = listProviders();
      const names = list.map((p) => p.name);
      expect(names).toContain("brave");
      expect(names).toContain("context");
      expect(names).toContain("exa");
      expect(names).toContain("jina");
      expect(names).toContain("searxng");
      expect(names).toContain("serpapi");
      expect(names).toContain("serpbase");
      expect(names).toContain("tavily");
      expect(names).toContain("tinyfish");
    });

    it("should mark configured providers correctly", () => {
      process.env.EXA_API_KEY = "test-key";
      const list = listProviders();
      const exa = list.find((p) => p.name === "exa");
      const brave = list.find((p) => p.name === "brave");
      expect(exa?.configured).toBe(true);
      expect(brave?.configured).toBe(false);
    });

    it("should set envVar to null for searxng", () => {
      const list = listProviders();
      const searxng = list.find((p) => p.name === "searxng");
      expect(searxng?.envVar).toBeNull();
    });

    it("should set correct envVar for api-key providers", () => {
      const list = listProviders();
      const brave = list.find((p) => p.name === "brave");
      const context = list.find((p) => p.name === "context");
      const tinyfish = list.find((p) => p.name === "tinyfish");
      expect(brave?.envVar).toBe("BRAVE_API_KEY");
      expect(context?.envVar).toBe("CONTEXT_DEV_API_KEY");
      expect(tinyfish?.envVar).toBe("TINYFISH_API_KEY");
    });

    it("should expose the effective search filter matrix", () => {
      const matrix = Object.fromEntries(
        listProviders().map(({ name, searchFilters, searchCategories }) => [
          name,
          {
            filters: searchFilters,
            ...(searchCategories === undefined ? {} : { categories: searchCategories }),
          },
        ]),
      );

      expect(matrix).toEqual({
        brave: { filters: [] },
        context: { filters: ["includeDomains", "excludeDomains"] },
        exa: {
          filters: [
            "includeDomains",
            "excludeDomains",
            "category",
            "startPublishedDate",
            "endPublishedDate",
          ],
        },
        firecrawl: {
          filters: ["includeDomains", "excludeDomains", "category"],
          categories: ["news"],
        },
        jina: {
          filters: ["includeDomains", "category"],
          categories: ["web", "images", "news"],
        },
        mojeek: {
          filters: ["includeDomains", "excludeDomains", "startPublishedDate", "endPublishedDate"],
        },
        tavily: { filters: ["includeDomains", "excludeDomains"] },
        tinyfish: {
          filters: [
            "includeDomains",
            "excludeDomains",
            "category",
            "startPublishedDate",
            "endPublishedDate",
          ],
          categories: ["news", "research_paper"],
        },
        serpapi: { filters: [] },
        serpbase: {
          filters: ["category"],
          categories: ["images", "image", "news", "videos", "video"],
        },
        searxng: { filters: ["category"] },
      });
    });
  });
});
