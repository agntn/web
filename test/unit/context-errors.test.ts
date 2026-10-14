import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AuthError,
  HTTPError,
  PageFetchError,
  PaymentError,
  ProviderFallbackError,
  createSearchProvider,
  normalizeError,
  readUrlDetailed,
} from "../../src/index.ts";
import { isFallbackEligible } from "../../src/core/fallback.ts";

const usageBody = JSON.stringify({
  message: "The key's credits have been completely depleted.",
  error_code: "USAGE_EXCEEDED",
  key_metadata: { credits_consumed: 0, credits_remaining: 0 },
});
const target = "https://example.com/article";
let contextBody: string;
let contextStatus: number;
let attempts: string[];

beforeEach(() => {
  contextBody = usageBody;
  contextStatus = 401;
  attempts = [];
  vi.stubEnv("JINA_API_KEY", "test-key");
  vi.stubEnv("CONTEXT_DEV_API_KEY", "test-key");
  vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
  vi.stubEnv("TINYFISH_API_KEY", "");
  vi.stubGlobal("fetch", async (input: unknown) => {
    if (typeof input !== "string") throw new Error("Expected a URL string from the HTTP client");
    const url = new URL(input);
    attempts.push(url.hostname);
    if (url.hostname === "r.jina.ai") {
      return Response.json({ message: "Payment required" }, { status: 402 });
    }
    if (url.hostname === "api.context.dev") {
      return new Response(contextBody, {
        status: contextStatus,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.hostname === "api.firecrawl.dev") {
      return Response.json({ success: true, data: { markdown: "Article content" } });
    }
    throw new Error(`Unexpected request: ${url.hostname}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Context credit exhaustion", () => {
  it("continues from Jina through spent Context credits to Firecrawl", async () => {
    const response = await readUrlDetailed(target);

    expect(response).toMatchObject({
      result: { content: "Article content" },
      requestedProvider: "auto",
      provider: "firecrawl",
      attempts: ["jina", "context", "firecrawl"],
    });
    expect(response.failures.map(({ provider }) => provider)).toEqual(["jina", "context"]);
    expect(response.failures[0].error).toContain("HTTP 402");
    expect(response.failures[1].error).toContain("HTTP 401");
    expect(response.failures[1].error).toContain("USAGE_EXCEEDED");
    expect(attempts).toEqual(["r.jina.ai", "api.context.dev", "api.firecrawl.dev"]);
  });

  it("leaves a Jina-only maxTokens out of the Firecrawl fallback and reports it", async () => {
    const response = await readUrlDetailed(target, { maxTokens: 500, maxChars: 7 });

    expect(response).toMatchObject({
      result: { content: "Article", truncated: true },
      provider: "firecrawl",
      attempts: ["jina", "context", "firecrawl"],
      ignoredOptions: ["maxTokens"],
    });
    expect(attempts).toEqual(["r.jina.ai", "api.context.dev", "api.firecrawl.dev"]);

    const next = await readUrlDetailed(target, {
      maxTokens: 500,
      maxChars: 8,
      continuation: response.result.continuation,
    });
    expect(next).toMatchObject({
      result: { content: " content", truncated: false },
      provider: "firecrawl",
      ignoredOptions: ["maxTokens"],
    });
  });

  it("keeps rejecting maxTokens on an explicit Firecrawl read", async () => {
    await expect(
      readUrlDetailed(target, { provider: "firecrawl", maxTokens: 500 }),
    ).rejects.toThrow("Firecrawl does not support the maxTokens read option");
    expect(attempts).toEqual([]);
  });

  it.each(["read", "search"] as const)(
    "classifies explicit %s without switching providers",
    async (operation) => {
      const pending =
        operation === "read"
          ? readUrlDetailed(target, { provider: "context" })
          : (await createSearchProvider("context")).search("article");
      const error = await pending.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HTTPError);
      expect(error).toBeInstanceOf(PaymentError);
      expect(error).not.toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ name: "PaymentError", statusCode: 401, body: usageBody });
      expect(normalizeError(error, "context")).toBe(error);
      expect(isFallbackEligible(error, "context", operation)).toBe(true);
      expect(attempts).toEqual(["api.context.dev"]);
    },
  );

  it.each([
    JSON.stringify({ error_code: "INVALID_API_KEY" }),
    JSON.stringify({ message: "USAGE_EXCEEDED" }),
    JSON.stringify({ error_code: "USAGE_EXCEEDED_OTHER" }),
    "USAGE_EXCEEDED",
    "null",
    "[]",
  ])("keeps other 401 responses strict: %s", async (body) => {
    contextBody = body;
    const error = await readUrlDetailed(target).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderFallbackError);
    if (!(error instanceof ProviderFallbackError)) throw new Error("Expected fallback diagnostics");
    expect(error.attempts).toEqual(["jina", "context"]);
    expect(error.cause).toBeInstanceOf(AuthError);
    expect(attempts).toEqual(["r.jina.ai", "api.context.dev"]);
  });

  it("does not reclassify an invalid request carrying the usage code", async () => {
    contextStatus = 400;
    const error = await readUrlDetailed(target, { provider: "context" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ name: "HTTPError", statusCode: 400, body: usageBody });
    expect(isFallbackEligible(error, "context", "read")).toBe(false);
  });

  it("does not apply Context's usage code to other providers", () => {
    const error = normalizeError(new HTTPError(401, "https://r.jina.ai", usageBody), "jina");

    expect(error).toBeInstanceOf(AuthError);
    expect(isFallbackEligible(error, "jina", "read")).toBe(false);
  });
});

describe("Context login redirects", () => {
  const thread = "https://old.reddit.com/r/bitcoinpuzzles/comments/7m3wbs/this_animation/";
  const login = `https://old.reddit.com/login/?reason=lor2&dest=${encodeURIComponent(thread)}`;

  /* A 200 scrape of the page Context ended on, the way the Reddit read in #299 came back. */
  function landedOn(requested: string, finalUrl: string): string {
    return JSON.stringify({
      success: true,
      markdown: "# Te damos la bienvenida a Reddit",
      url: requested,
      metadata: { sourceUrl: requested, finalUrl, title: "Te damos la bienvenida a Reddit" },
      cache_metadata: { status: "miss", age_ms: 0 },
    });
  }

  beforeEach(() => {
    contextStatus = 200;
    contextBody = landedOn(thread, login);
  });

  it("moves on to the next reader when Context lands on a login page", async () => {
    const response = await readUrlDetailed(thread);

    expect(response).toMatchObject({
      result: { content: "Article content" },
      provider: "firecrawl",
      attempts: ["jina", "context", "firecrawl"],
    });
    expect(response.failures[1]?.error).toBe(
      "Context.dev was sent to a login page on https://old.reddit.com",
    );
  });

  it.each([
    [
      "an article that mentions login",
      "https://example.com/blog/login",
      "https://example.com/sso/login",
    ],
    ["a WordPress login", thread, "https://example.com/wp-login.php?redirect_to=x"],
    ["a sign in page", thread, "https://example.com/account/signin.html"],
  ])("rejects %s redirected to a login page", async (_case, requested, finalUrl) => {
    contextBody = landedOn(requested, finalUrl);

    const error = await readUrlDetailed(requested, { provider: "context" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(PageFetchError);
  });

  it("keeps a token in the login path out of the message", async () => {
    contextBody = landedOn(thread, "https://sso.example.com/login/abc123?dest=x");

    const error = await readUrlDetailed(thread, { provider: "context" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(PageFetchError);
    expect(String(error)).not.toContain("abc123");
  });

  it("rejects an explicit read with PageFetchError", async () => {
    const error = await readUrlDetailed(thread, { provider: "context" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(PageFetchError);
    expect(isFallbackEligible(error, "context", "read")).toBe(true);
  });

  it.each([
    ["a login page the caller asked for", login, login],
    ["an ordinary redirect", thread, "https://www.reddit.com/r/bitcoinpuzzles/"],
    ["a path that only mentions logging in", thread, "https://example.com/blog/login-tips"],
  ])("keeps %s", async (_case, requested, finalUrl) => {
    contextBody = landedOn(requested, finalUrl);

    const response = await readUrlDetailed(requested, { provider: "context" });

    expect(response.result.url).toBe(finalUrl);
  });
});
