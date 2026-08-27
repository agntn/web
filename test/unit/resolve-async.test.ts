import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectAvailableProvidersAsync,
  listProvidersAsync,
  resolveDefaultProviderAsync,
} from "../../src/core/resolve.ts";
import { searchAllDetailed } from "../../src/core/all.ts";
import { NoProviderAvailableError } from "../../src/core/errors.ts";
import "../../src/providers/index.ts";

const envKeys = [
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "CONTEXT_DEV_API_KEY",
  "FIRECRAWL_API_KEY",
  "JINA_API_KEY",
  "TAVILY_API_KEY",
  "TINYFISH_API_KEY",
  "SERPAPI_API_KEY",
  "SERPBASE_API_KEY",
] as const;

describe("resolve async", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key];
      else delete process.env[key];
    }
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: (url: string) => Promise<Response> | Response) {
    const fetchMock = vi.fn((url: string) => Promise.resolve(impl(url)));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  describe("detectAvailableProvidersAsync", () => {
    it("drops searxng when its endpoint is unreachable", async () => {
      stubFetch(() => {
        throw new Error("ECONNREFUSED");
      });
      const available = await detectAvailableProvidersAsync();
      expect(available).not.toContain("searxng");
    });

    it("keeps searxng when its endpoint responds (any status)", async () => {
      stubFetch(() => new Response("ok", { status: 200 }));
      const available = await detectAvailableProvidersAsync();
      expect(available).toContain("searxng");
    });

    it("includes env-configured providers regardless of probe", async () => {
      process.env.EXA_API_KEY = "k";
      stubFetch(() => {
        throw new Error("down");
      });
      const available = await detectAvailableProvidersAsync();
      expect(available).toContain("exa");
      expect(available).not.toContain("searxng");
    });
  });

  describe("listProvidersAsync", () => {
    it("marks searxng reachable=false when probe fails", async () => {
      stubFetch(() => {
        throw new Error("down");
      });
      const list = await listProvidersAsync();
      const searxng = list.find((p) => p.name === "searxng");
      expect(searxng?.configured).toBe(true);
      expect(searxng?.reachable).toBe(false);
    });

    it("marks searxng reachable=true when probe succeeds", async () => {
      stubFetch(() => new Response("", { status: 200 }));
      const list = await listProvidersAsync();
      const searxng = list.find((p) => p.name === "searxng");
      expect(searxng?.reachable).toBe(true);
    });

    it("leaves reachable undefined for env-only providers (no probe)", async () => {
      process.env.EXA_API_KEY = "k";
      stubFetch(() => new Response("", { status: 200 }));
      const list = await listProvidersAsync();
      const exa = list.find((p) => p.name === "exa");
      expect(exa?.configured).toBe(true);
      expect(exa?.reachable).toBeUndefined();
    });
  });

  describe("resolveDefaultProviderAsync", () => {
    it("short-circuits before probing later providers when env default has no probe", async () => {
      process.env.EXA_API_KEY = "k";
      const fetchMock = stubFetch(() => {
        throw new Error("unexpected probe");
      });
      expect(await resolveDefaultProviderAsync()).toBe("exa");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws availability error when configured providers are unreachable", async () => {
      stubFetch(() => {
        throw new Error("down");
      });
      await expect(resolveDefaultProviderAsync()).rejects.toThrow(NoProviderAvailableError);
    });
  });

  describe("searchAllDetailed skips unreachable providers", () => {
    it("omits unreachable searxng from errors (no connection-refused noise)", async () => {
      process.env.EXA_API_KEY = "k";
      // Stub: SearXNG probe fails; Exa search call (different host) is not invoked
      // because Exa requires its own API call — we mock fetch to throw for all
      // hosts EXCEPT api.exa.ai where we return a minimal valid response.
      stubFetch((url) => {
        const u = String(url);
        if (u.includes("api.exa.ai")) {
          return new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error("ECONNREFUSED");
      });
      const response = await searchAllDetailed("test");
      const errProviders = response.errors.map((e) => e.provider);
      expect(errProviders).not.toContain("searxng");
    });

    it("throws availability error when auto-detected providers are all unreachable", async () => {
      stubFetch(() => {
        throw new Error("ECONNREFUSED");
      });
      await expect(searchAllDetailed("test")).rejects.toThrow(NoProviderAvailableError);
    });
  });
});
