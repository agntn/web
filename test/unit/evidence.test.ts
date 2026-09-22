import { afterEach, describe, expect, it } from "vite-plus/test";
import { searchAllDetailed } from "../../src/core/all.ts";
import type { SearchBatchItem } from "../../src/core/batch.ts";
import { batchWithoutRepeatedEvidence, withoutRepeatedEvidence } from "../../src/core/evidence.ts";
import { Provider } from "../../src/core/provider.ts";
import { register } from "../../src/core/registry.ts";
import type { ProviderConfig, SearchResult } from "../../src/core/types.ts";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function registerProvider(
  results: readonly Readonly<Pick<SearchResult, "url" | "title" | "snippet" | "score">>[],
): string {
  const providerName = `evidence${Math.random().toString(36).slice(2)}`;
  class EvidenceProvider extends Provider {
    static readonly providerName = providerName;
    static readonly defaultBaseURL = "https://evidence.example.com";
    static readonly apiKeyEnvVar = null;

    constructor(config: Readonly<ProviderConfig>) {
      super(config, EvidenceProvider);
    }

    async search(): Promise<SearchResult[]> {
      return results.map((result) => ({ ...result }));
    }
  }
  cleanups.push(register(EvidenceProvider));
  return providerName;
}

describe("withoutRepeatedEvidence", () => {
  it("sends each provider record once and loses none of them", async () => {
    const first = registerProvider([
      { url: "https://example.com/same", title: "First", snippet: "first says", score: 0.9 },
      { url: "https://example.com/only", title: "Only", snippet: "alone" },
    ]);
    const second = registerProvider([
      { url: "https://example.com/same/", title: "Second", snippet: "second says" },
    ]);

    const response = await searchAllDetailed("test", { providers: [first, second] });
    const results = withoutRepeatedEvidence(response.results);

    expect(results).toEqual([
      {
        url: "https://example.com/same",
        title: "First",
        snippet: "first says",
        score: 0.9,
        provider: first,
        providers: [first, second],
        evidence: [
          {
            url: "https://example.com/same/",
            title: "Second",
            snippet: "second says",
            provider: second,
          },
        ],
      },
      {
        url: "https://example.com/only",
        title: "Only",
        snippet: "alone",
        provider: first,
        providers: [first],
      },
    ]);
    for (const [index, result] of response.results.entries()) {
      const { providers: _providers, evidence: _evidence, ...record } = result;
      const agentResult = results[index];
      const others = agentResult && "evidence" in agentResult ? (agentResult.evidence ?? []) : [];
      expect([record, ...others]).toEqual(result.evidence);
    }
    expect(JSON.stringify(results).length).toBeLessThan(JSON.stringify(response.results).length);
  });

  it("leaves results without evidence and failed batch items alone", () => {
    const plain = { url: "https://example.com", title: "Plain", snippet: "Snippet" };
    const items: SearchBatchItem[] = [
      { query: "one", provider: "brave", results: [plain], filterReports: [] },
      { query: "two", error: "failed" },
      {
        query: "three",
        provider: "all",
        results: [
          {
            ...plain,
            provider: "exa",
            providers: ["exa"],
            evidence: [{ ...plain, provider: "exa" }],
          },
        ],
        filterReports: [],
      },
    ];

    expect(withoutRepeatedEvidence([plain])).toEqual([plain]);
    expect(batchWithoutRepeatedEvidence(items)).toEqual([
      items[0],
      items[1],
      {
        query: "three",
        provider: "all",
        results: [{ ...plain, provider: "exa", providers: ["exa"] }],
        filterReports: [],
      },
    ]);
  });
});
