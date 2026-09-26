import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { OUT_OF_CREDITS_COOLDOWN_MS } from "../../src/core/fallback.ts";
import {
  PaymentError,
  builtinProviders,
  createSearchProvider,
  getProviderApiKeyEnvVar,
  searchWithFallback,
} from "../../src/index.ts";

const usageLimitBody = {
  detail: { error: "This request exceeds your plan's set usage limit." },
};
const spentCreditsBody = {
  status: 1020,
  error: "insufficient credits",
  request_id: "req-credits",
  elapsed_ms: 0,
  credits_charged: 0,
};
const mojeekBody = {
  response: {
    status: "OK",
    head: { start: 1, return: 1, results: 1 },
    results: [
      {
        url: "https://example.com/search",
        title: "Independent search",
        desc: "A page about independent web search.",
      },
    ],
  },
};
const hosts = { tavily: "api.tavily.com", serpbase: "api.serpbase.dev" } as const;
let attempts: string[];

beforeEach(() => {
  attempts = [];
  for (const name of builtinProviders) {
    const envVar = getProviderApiKeyEnvVar(name);
    if (envVar !== null) vi.stubEnv(envVar, "");
  }
  vi.stubEnv("TAVILY_API_KEY", "test-key");
  vi.stubEnv("SERPBASE_API_KEY", "test-key");
  vi.stubEnv("MOJEEK_API_KEY", "test-key");
  vi.stubGlobal("fetch", async (input: unknown) => {
    if (typeof input !== "string") throw new Error("Expected a URL string from the HTTP client");
    const url = new URL(input);
    if (url.hostname === "localhost") throw new Error("SearXNG is not running");
    attempts.push(url.hostname);
    if (url.hostname === hosts.tavily) return Response.json(usageLimitBody, { status: 432 });
    if (url.hostname === hosts.serpbase) return Response.json(spentCreditsBody);
    if (url.hostname === "api.mojeek.com") return Response.json(mojeekBody);
    throw new Error(`Unexpected request: ${url.hostname}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("search usage limits", () => {
  it("continues from spent Tavily and SerpBase credits to Mojeek", async () => {
    const response = await searchWithFallback("independent search");

    expect(response).toMatchObject({
      provider: "mojeek",
      attempts: ["tavily", "serpbase", "mojeek"],
    });
    expect(response.results.map(({ url }) => url)).toEqual(["https://example.com/search"]);
    expect(response.failures.map(({ provider }) => provider)).toEqual(["tavily", "serpbase"]);
    expect(response.failures[0].error).toContain("HTTP 432");
    expect(response.failures[1].error).toContain("1020");
    expect(attempts).toEqual([hosts.tavily, hosts.serpbase, "api.mojeek.com"]);
  });

  it("goes straight to Mojeek while the spent credits stay spent", async () => {
    await searchWithFallback("independent search");
    attempts = [];

    const response = await searchWithFallback("independent search");

    expect(response).toMatchObject({
      provider: "mojeek",
      attempts: ["mojeek"],
      failures: [],
      skipped: ["tavily", "serpbase"],
    });
    expect(attempts).toEqual(["api.mojeek.com"]);
  });

  it("leaves out spent providers the order would not have reached", async () => {
    await searchWithFallback("independent search");
    vi.stubEnv("BRAVE_API_KEY", "test-key");
    vi.stubGlobal("fetch", async (input: unknown) => {
      if (typeof input !== "string") throw new Error("Expected a URL string from the HTTP client");
      const url = new URL(input);
      if (url.hostname === "localhost") throw new Error("SearXNG is not running");
      if (url.hostname === "api.search.brave.com") {
        return Response.json({ web: { results: [] } });
      }
      throw new Error(`Unexpected request: ${url.hostname}`);
    });

    const response = await searchWithFallback("independent search");

    expect(response.attempts).toEqual(["brave"]);
    expect(response).not.toHaveProperty("skipped");
  });

  it("asks the spent providers first again after the cooldown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await searchWithFallback("independent search");
    vi.setSystemTime(Date.now() + OUT_OF_CREDITS_COOLDOWN_MS);
    attempts = [];

    const response = await searchWithFallback("independent search");

    expect(response.attempts).toEqual(["tavily", "serpbase", "mojeek"]);
    expect(response).not.toHaveProperty("skipped");
    expect(attempts).toEqual([hosts.tavily, hosts.serpbase, "api.mojeek.com"]);
  });

  it("keeps an explicit provider on its own after its credits ran out", async () => {
    await searchWithFallback("independent search");
    attempts = [];

    const search = await createSearchProvider("tavily");
    await expect(search.search("independent search")).rejects.toBeInstanceOf(PaymentError);
    expect(attempts).toEqual([hosts.tavily]);
  });

  it.each(["tavily", "serpbase"] as const)(
    "keeps an explicit %s on its own provider",
    async (provider) => {
      const search = await createSearchProvider(provider);
      const error = await search.search("independent search").catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(PaymentError);
      expect(attempts).toEqual([hosts[provider]]);
    },
  );
});
