import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AuthError,
  InvalidSearchContinuationError,
  RateLimitError,
} from "../../src/core/errors.ts";
import { isPaginatedSearchProvider } from "../../src/core/provider.ts";
import { createSearchProvider, has } from "../../src/core/registry.ts";

/** Trimmed from a live `GET /search?query=rust%20async&count=2` answer, 2026-09-23. */
const marginaliaBody = {
  license: "CC-BY-NC-SA 4.0",
  page: 1,
  pages: 11,
  query: "rust async",
  results: [
    {
      url: "https://fasterthanli.me/articles/surviving-rust-async-interfaces",
      title: "Surviving Rust async interfaces",
      description: "Surviving Rust async interfaces. Aug 09, 2020 28 min",
      quality: 3.0928307348480084,
      format: "html",
      resultsFromDomain: 76,
      details: [[]],
    },
    {
      url: "https://morestina.net/1686/rust-async-is-colored",
      title: "Rust async is colored, and that’s not a big deal | More Stina Blog!",
      description: "Function colors in Rust async.",
      quality: 3.1293012633807606,
      format: "html",
      resultsFromDomain: 5,
      details: [[]],
    },
  ],
};

interface Sent {
  readonly url: URL;
  readonly apiKey: string | null;
}

let sent: Sent[];
let reply: () => Response;

beforeEach(() => {
  sent = [];
  reply = () => Response.json(marginaliaBody);
  vi.stubEnv("MARGINALIA_API_KEY", "");
  vi.stubGlobal(
    "fetch",
    async (input: unknown, init?: { readonly headers?: Readonly<Headers> }) => {
      if (typeof input !== "string") throw new Error("Expected a URL string from the HTTP client");
      sent.push({ url: new URL(input), apiKey: init?.headers?.get("API-Key") ?? null });
      return reply();
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("marginalia provider", () => {
  it("is listed without loading the adapter", () => {
    expect(has("marginalia")).toBe(true);
  });

  it("sends the query, the count and the key header", async () => {
    const provider = await createSearchProvider("marginalia", {
      apiKey: "own-key",
      baseURL: "https://proxy.example.com/marginalia/",
    });

    await provider.search("rust async", { maxResults: 7 });

    expect(sent).toHaveLength(1);
    const [{ url, apiKey }] = sent;
    expect(`${url.origin}${url.pathname}`).toBe("https://proxy.example.com/marginalia/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: "rust async", count: "7" });
    expect(apiKey).toBe("own-key");
  });

  it("reads the key from MARGINALIA_API_KEY", async () => {
    vi.stubEnv("MARGINALIA_API_KEY", "env-key");
    const provider = await createSearchProvider("marginalia");

    await provider.search("rust async");

    expect(sent[0].apiKey).toBe("env-key");
  });

  it("falls back to the shared public key when none is set", async () => {
    const provider = await createSearchProvider("marginalia");

    await provider.search("rust async");

    expect(sent[0].apiKey).toBe("public");
    expect(sent[0].url.searchParams.get("count")).toBe("10");
  });

  it("keeps the count inside the 1 to 100 Marginalia serves", async () => {
    const provider = await createSearchProvider("marginalia");

    await provider.search("rust async", { maxResults: 500 });
    await provider.search("rust async", { maxResults: 0 });

    expect(sent.map(({ url }) => url.searchParams.get("count"))).toEqual(["100", "1"]);
  });

  it("maps results to url, title and snippet only", async () => {
    const provider = await createSearchProvider("marginalia");

    await expect(provider.search("rust async")).resolves.toEqual([
      {
        url: "https://fasterthanli.me/articles/surviving-rust-async-interfaces",
        title: "Surviving Rust async interfaces",
        snippet: "Surviving Rust async interfaces. Aug 09, 2020 28 min",
      },
      {
        url: "https://morestina.net/1686/rust-async-is-colored",
        title: "Rust async is colored, and that’s not a big deal | More Stina Blog!",
        snippet: "Function colors in Rust async.",
      },
    ]);
  });

  it("continues with the page after the one Marginalia answered", async () => {
    reply = () => Response.json({ ...marginaliaBody, page: 3 });
    const provider = await createSearchProvider("marginalia");
    if (!isPaginatedSearchProvider(provider)) throw new Error("Marginalia must support pagination");

    const first = await provider.searchPage("rust async");
    const third = await provider.searchPage("rust async", undefined, "3");

    expect(sent[0].url.searchParams.has("page")).toBe(false);
    expect(sent[1].url.searchParams.get("page")).toBe("3");
    expect(first.continuation).toBe("4");
    expect(third.continuation).toBe("4");
  });

  it("stops on the last page and on an empty one", async () => {
    const provider = await createSearchProvider("marginalia");
    if (!isPaginatedSearchProvider(provider)) throw new Error("Marginalia must support pagination");

    reply = () => Response.json({ ...marginaliaBody, page: 11 });
    const last = await provider.searchPage("rust async", undefined, "11");
    reply = () => Response.json({ ...marginaliaBody, page: 12, pages: 11, results: [] });
    const past = await provider.searchPage("rust async", undefined, "12");
    reply = () => Response.json({ ...marginaliaBody, pages: 0, results: [] });
    const none = await provider.searchPage("zxqvbnmqwerty");

    expect(last.continuation).toBeUndefined();
    expect(past).toEqual({ results: [] });
    expect(none).toEqual({ results: [] });
  });

  it("rejects a continuation that is not a page number before the request", async () => {
    const provider = await createSearchProvider("marginalia");
    if (!isPaginatedSearchProvider(provider)) throw new Error("Marginalia must support pagination");

    for (const continuation of ["0", "-1", "2.5", "two", "99999999999999999999"]) {
      await expect(provider.searchPage("rust async", undefined, continuation)).rejects.toThrow(
        InvalidSearchContinuationError,
      );
    }
    expect(sent).toHaveLength(0);
  });

  it("names Marginalia when it refuses the key", async () => {
    reply = () => new Response("", { status: 401 });
    const provider = await createSearchProvider("marginalia", { apiKey: "revoked" });

    const failure = provider.search("rust async");

    await expect(failure).rejects.toThrow(AuthError);
    await expect(failure).rejects.toThrow("Authentication failed for marginalia");
  });

  it("maps the per-minute limit to RateLimitError", async () => {
    reply = () =>
      new Response("QPM Limit Exceeded", {
        status: 429,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
      });
    const provider = await createSearchProvider("marginalia");

    await expect(provider.search("rust async")).rejects.toThrow(RateLimitError);
  });

  it("names itself and keeps Retry-After on a 429", async () => {
    reply = () =>
      new Response("QPM Limit Exceeded", {
        status: 429,
        headers: { "Content-Type": "text/plain;charset=utf-8", "Retry-After": "17" },
      });
    const provider = await createSearchProvider("marginalia");

    const error = await provider.search("rust async").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ provider: "marginalia", retryAfter: 17 });
    expect((error as Error).message).toBe("Rate limited by marginalia. Retry after 17s");
  });
});
