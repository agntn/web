import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  searchAllDetailed,
  searchProviderDetailed,
  searchWithFallback,
} from "../../src/core/all.ts";
import { searchBatch } from "../../src/core/batch.ts";
import { Provider } from "../../src/core/provider.ts";
import { register } from "../../src/core/registry.ts";
import type { ProviderConfig, SearchResult } from "../../src/core/types.ts";

const favicon = "https://icons.example.com/favicon.ico";
const providerEnvKeys = [
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "CONTEXT_DEV_API_KEY",
  "FIRECRAWL_API_KEY",
  "JINA_API_KEY",
  "MARGINALIA_API_KEY",
  "MOJEEK_API_KEY",
  "OPENAI_CODEX_ACCESS_TOKEN",
  "OPENAI_CODEX_ACCOUNT_ID",
  "TAVILY_API_KEY",
  "TINYFISH_API_KEY",
  "SERPAPI_API_KEY",
  "SERPBASE_API_KEY",
] as const;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  for (const key of providerEnvKeys) vi.stubEnv(key, "");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("SearXNG unavailable")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function registerIconProvider(): string {
  const providerName = `iconprovider${Math.random().toString(36).slice(2)}`;
  class IconProvider extends Provider {
    static readonly providerName = providerName;
    static readonly defaultBaseURL = "https://icons.example.com";
    static readonly apiKeyEnvVar = null;

    constructor(config: Readonly<ProviderConfig>) {
      super(config, IconProvider);
    }

    async search(): Promise<SearchResult[]> {
      return [
        {
          url: "https://example.com",
          title: "Icon",
          snippet: "Snippet",
          favicon,
          highlights: ["kept"],
          metadata: { rank: 1 },
        },
      ];
    }
  }
  cleanups.push(register(IconProvider));
  return providerName;
}

describe("search favicon option", () => {
  it("leaves results that carry no favicon alone", async () => {
    const providerName = `plainprovider${Math.random().toString(36).slice(2)}`;
    const plainResults = [{ url: "https://example.com", title: "Plain", snippet: "Snippet" }];
    class PlainProvider extends Provider {
      static readonly providerName = providerName;
      static readonly defaultBaseURL = "https://plain.example.com";
      static readonly apiKeyEnvVar = null;

      constructor(config: Readonly<ProviderConfig>) {
        super(config, PlainProvider);
      }

      async search(): Promise<SearchResult[]> {
        return plainResults;
      }
    }
    cleanups.push(register(PlainProvider));

    const answer = await searchProviderDetailed(providerName, "test", { favicon: false });

    expect(answer.results).toBe(plainResults);
  });

  it("keeps the favicon URL by default", async () => {
    const providerName = registerIconProvider();

    const explicit = await searchProviderDetailed(providerName, "test");
    const fanout = await searchAllDetailed("test", { providers: [providerName] });

    expect(explicit.results).toEqual([expect.objectContaining({ favicon })]);
    expect(fanout.results).toEqual([
      expect.objectContaining({ favicon, evidence: [expect.objectContaining({ favicon })] }),
    ]);
  });

  it("drops the favicon URL from every helper when favicon is false", async () => {
    const providerName = registerIconProvider();
    const lean = { url: "https://example.com", title: "Icon", snippet: "Snippet" };

    const explicit = await searchProviderDetailed(providerName, "test", { favicon: false });
    const automatic = await searchWithFallback("test", { favicon: false });
    const fanout = await searchAllDetailed("test", { providers: [providerName], favicon: false });
    const batch = await searchBatch(["test"], { provider: providerName, favicon: false });

    expect(explicit.results).toEqual([{ ...lean, highlights: ["kept"], metadata: { rank: 1 } }]);
    expect(automatic.results).toEqual(explicit.results);
    expect(fanout.results).toEqual([
      expect.objectContaining({
        ...lean,
        providers: [providerName],
        evidence: [expect.objectContaining({ ...lean, provider: providerName })],
      }),
    ]);
    expect(batch).toEqual([expect.objectContaining({ provider: providerName })]);
    for (const answer of [explicit.results, automatic.results, fanout.results, batch]) {
      expect(JSON.stringify(answer)).not.toContain("favicon");
    }
  });
});
