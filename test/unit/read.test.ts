import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { readUrl, readUrlDetailed } from "../../src/core/read.ts";
import { readBatch, readBatchDetailed } from "../../src/core/batch.ts";
import { register } from "../../src/core/registry.ts";
import {
  AuthError,
  EmptyUrlError,
  HTTPError,
  InvalidReadContinuationError,
  RateLimitError,
  ReadNotSupportedError,
  StaleReadContinuationError,
} from "../../src/core/errors.ts";
import { ProviderFallbackError } from "../../src/core/fallback.ts";
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConfig, ReadOptions, ReadResult } from "../../src/core/types.ts";

const readerCleanups: Array<() => void> = [];

function registerReader(
  name: string,
  read: (url: string, options?: Readonly<ReadOptions>) => Promise<ReadResult>,
): void {
  class ReaderProvider extends Provider {
    static readonly providerName = name;
    static readonly defaultBaseURL = "https://reader.example.com";

    constructor(config: Readonly<ProviderConfig>) {
      super(config, ReaderProvider);
    }

    async read(url: string, options?: Readonly<ReadOptions>): Promise<ReadResult> {
      return read(url, options);
    }
  }

  readerCleanups.push(register(ReaderProvider));
}

const paymentRequired = async (): Promise<ReadResult> => {
  throw new HTTPError(402, "https://r.jina.ai/https%3A%2F%2Fexample.com", "Payment required");
};

const jinaConflictFailure = new HTTPError(
  409,
  "https://r.jina.ai/https%3A%2F%2Fexample.com",
  "Conflict",
);
const jinaConflict = async (): Promise<ReadResult> => {
  throw jinaConflictFailure;
};

describe("readUrl", () => {
  const fallbackEnvKeys = ["CONTEXT_DEV_API_KEY", "FIRECRAWL_API_KEY", "TINYFISH_API_KEY"] as const;
  const savedEnv = Object.fromEntries(fallbackEnvKeys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    for (const key of fallbackEnvKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const unregister of readerCleanups.splice(0).reverse()) unregister();
    for (const key of fallbackEnvKeys) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("falls back to configured readers when default Jina requires payment", async () => {
    const readFromContext = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com", content: "ok" });
    registerReader("jina", paymentRequired);
    registerReader("context", readFromContext);
    process.env.CONTEXT_DEV_API_KEY = "test-key";

    await expect(readUrl("https://example.com", { format: "text" })).resolves.toEqual({
      url: "https://example.com",
      content: "ok",
    });
    expect(readFromContext).toHaveBeenCalledWith("https://example.com", { format: "text" });
  });

  it("reports the effective reader, ordered attempts, and failures after fallback", async () => {
    const readFromContext = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com", content: "ok" });
    const failure = new HTTPError(
      402,
      "https://r.jina.ai/https%3A%2F%2Fexample.com",
      "Payment required",
    );
    registerReader("jina", async () => {
      throw failure;
    });
    registerReader("context", readFromContext);
    process.env.CONTEXT_DEV_API_KEY = "test-key";

    await expect(readUrlDetailed("https://example.com", { format: "text" })).resolves.toEqual({
      result: { url: "https://example.com", content: "ok" },
      requestedProvider: "auto",
      provider: "context",
      attempts: ["jina", "context"],
      failures: [{ provider: "jina", error: failure.message }],
    });
  });

  it("reports an explicit reader selection", async () => {
    registerReader("jina", async () => ({ url: "https://example.com", content: "ok" }));

    await expect(
      readUrlDetailed("https://example.com", { provider: "jina" }),
    ).resolves.toMatchObject({ requestedProvider: "jina", provider: "jina", attempts: ["jina"] });
  });

  it("falls back to configured readers when automatic Jina returns 409", async () => {
    const readFromContext = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com", content: "ok" });
    registerReader("jina", jinaConflict);
    registerReader("context", readFromContext);
    process.env.CONTEXT_DEV_API_KEY = "test-key";

    await expect(readUrl("https://example.com")).resolves.toEqual({
      url: "https://example.com",
      content: "ok",
    });
  });

  it("retains every failure when automatic reads exhaust configured readers", async () => {
    const contextFailure = new HTTPError(503, "https://context.example.com", "Unavailable");
    registerReader("jina", jinaConflict);
    registerReader("context", async () => {
      throw contextFailure;
    });
    process.env.CONTEXT_DEV_API_KEY = "test-key";

    const failure = await readUrlDetailed("https://example.com").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderFallbackError);
    expect(failure).toMatchObject({
      attempts: ["jina", "context"],
      failures: [
        { provider: "jina", error: jinaConflictFailure.message },
        { provider: "context", error: contextFailure.message },
      ],
      cause: contextFailure,
    });
    await expect(readBatchDetailed(["https://example.com"])).resolves.toEqual([
      {
        url: "https://example.com",
        error: (failure as Error).message,
        attempts: ["jina", "context"],
        failures: [
          { provider: "jina", error: jinaConflictFailure.message },
          { provider: "context", error: contextFailure.message },
        ],
      },
    ]);
  });

  it("preserves built in fallback order independently of registration order", async () => {
    const attempts: string[] = [];
    registerReader("jina", paymentRequired);
    registerReader("tinyfish", async () => {
      attempts.push("tinyfish");
      return { url: "https://example.com", content: "ok" };
    });
    registerReader("firecrawl", async () => {
      attempts.push("firecrawl");
      throw new HTTPError(504, "https://firecrawl.example.com", "Firecrawl unavailable");
    });
    registerReader("context", async () => {
      attempts.push("context");
      throw new HTTPError(503, "https://context.example.com", "Context unavailable");
    });
    process.env.CONTEXT_DEV_API_KEY = "test-key";
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.TINYFISH_API_KEY = "test-key";

    await expect(readUrl("https://example.com")).resolves.toMatchObject({ content: "ok" });
    expect(attempts).toEqual(["context", "firecrawl", "tinyfish"]);
  });

  it("treats a whitespace provider as the default and falls back", async () => {
    const readFromFirecrawl = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com", content: "ok" });
    registerReader("jina", paymentRequired);
    registerReader("firecrawl", readFromFirecrawl);
    process.env.FIRECRAWL_API_KEY = "test-key";

    await expect(readUrl("https://example.com", { provider: "   " })).resolves.toMatchObject({
      content: "ok",
    });
  });

  it("falls back after timeout and rate-limit failures", async () => {
    const timeoutFailure = new HTTPError(408, "https://r.jina.ai", "Request timeout");
    const rateLimitFailure = new RateLimitError(30);
    registerReader("jina", async () => {
      throw timeoutFailure;
    });
    registerReader("context", async () => {
      throw rateLimitFailure;
    });
    registerReader("firecrawl", async () => ({
      url: "https://example.com",
      content: "ok",
    }));
    process.env.CONTEXT_DEV_API_KEY = "test-key";
    process.env.FIRECRAWL_API_KEY = "test-key";

    await expect(readUrlDetailed("https://example.com")).resolves.toMatchObject({
      provider: "firecrawl",
      attempts: ["jina", "context", "firecrawl"],
      failures: [
        { provider: "jina", error: timeoutFailure.message },
        { provider: "context", error: rateLimitFailure.message },
      ],
    });
  });

  it("keeps authentication failures strict in automatic mode", async () => {
    const readFromContext = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com", content: "ok" });
    const failure = new AuthError("Invalid API key", "jina");
    registerReader("jina", async () => {
      throw failure;
    });
    registerReader("context", readFromContext);
    process.env.CONTEXT_DEV_API_KEY = "test-key";

    await expect(readUrl("https://example.com")).rejects.toBe(failure);
    expect(readFromContext).not.toHaveBeenCalled();
  });

  it("keeps a later invalid request strict and retains earlier diagnostics", async () => {
    const readFromFirecrawl = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com", content: "ok" });
    const transientFailure = new HTTPError(402, "https://r.jina.ai", "Payment required");
    const strictFailure = new HTTPError(400, "https://context.example.com", "Invalid request");
    registerReader("jina", async () => {
      throw transientFailure;
    });
    registerReader("context", async () => {
      throw strictFailure;
    });
    registerReader("firecrawl", readFromFirecrawl);
    process.env.CONTEXT_DEV_API_KEY = "test-key";
    process.env.FIRECRAWL_API_KEY = "test-key";

    const failure = await readUrl("https://example.com").catch((error: unknown) => error);

    expect(failure).toMatchObject({
      attempts: ["jina", "context"],
      failures: [
        { provider: "jina", error: transientFailure.message },
        { provider: "context", error: strictFailure.message },
      ],
      cause: strictFailure,
    });
    expect(readFromFirecrawl).not.toHaveBeenCalled();
    await expect(readBatchDetailed(["https://example.com"])).resolves.toEqual([
      {
        url: "https://example.com",
        error: (failure as Error).message,
        attempts: ["jina", "context"],
        failures: [
          { provider: "jina", error: transientFailure.message },
          { provider: "context", error: strictFailure.message },
        ],
      },
    ]);
    expect(readFromFirecrawl).not.toHaveBeenCalled();
  });

  it("does not fall back when Jina is explicitly requested", async () => {
    const readFromContext = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com", content: "ok" });
    registerReader("jina", paymentRequired);
    registerReader("context", readFromContext);
    process.env.CONTEXT_DEV_API_KEY = "test-key";

    await expect(readUrl("https://example.com", { provider: "jina" })).rejects.toMatchObject({
      statusCode: 402,
    });
    expect(readFromContext).not.toHaveBeenCalled();
  });

  it("does not fall back when Jina 409 is explicit", async () => {
    const readFromContext = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com", content: "ok" });
    registerReader("jina", jinaConflict);
    registerReader("context", readFromContext);
    process.env.CONTEXT_DEV_API_KEY = "test-key";

    await expect(readUrl("https://example.com", { provider: "jina" })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(readFromContext).not.toHaveBeenCalled();
  });

  it("passes explicit provider and read options through", async () => {
    const providerName = `reader-${Math.random().toString(36).slice(2)}`;
    const read = vi
      .fn<(url: string, options?: Readonly<ReadOptions>) => Promise<ReadResult>>()
      .mockResolvedValue({ url: "https://example.com", content: "ok" });
    class ReaderProvider extends Provider {
      static readonly providerName = providerName;
      static readonly defaultBaseURL = "https://reader.example.com";

      constructor(config: Readonly<ProviderConfig>) {
        super(config, ReaderProvider);
      }

      async read(url: string, options?: Readonly<ReadOptions>): Promise<ReadResult> {
        return read(url, options);
      }
    }
    readerCleanups.push(register(ReaderProvider));

    await readUrl(" https://example.com ", {
      provider: providerName,
      format: "text",
      maxTokens: 500,
    });

    expect(read).toHaveBeenCalledWith("https://example.com", { format: "text", maxTokens: 500 });
  });

  it("bounds normalized content after a provider ignores maxChars", async () => {
    const providerName = `unbounded-reader-${Math.random().toString(36).slice(2)}`;
    const read = vi.fn().mockResolvedValue({
      url: "https://example.com",
      content: "abcdefgh",
      text: "abcdefgh",
      html: "<p>abcdefgh</p>",
    });
    registerReader(providerName, read);

    const result = await readUrl("https://example.com", { provider: providerName, maxChars: 5 });

    expect(read).toHaveBeenCalledWith("https://example.com", {});
    expect(result).toMatchObject({ content: "abcde", truncated: true });
    expect(result.continuation).toBeTypeOf("string");
    expect(result).not.toHaveProperty("text");
    expect(result).not.toHaveProperty("html");
  });

  it("continues on Unicode boundaries and detects changed content", async () => {
    const providerName = `continuable-reader-${Math.random().toString(36).slice(2)}`;
    let content = "ab😀cdef";
    const read = vi.fn(async () => ({ url: "https://example.com", content }));
    registerReader(providerName, read);

    const first = await readUrl("https://example.com", {
      provider: providerName,
      maxTokens: 50,
      maxChars: 3,
    });
    expect(first).toMatchObject({ content: "ab😀", truncated: true });
    expect(first.continuation).toBeTypeOf("string");

    const second = await readUrl("https://example.com", {
      provider: providerName,
      maxTokens: 50,
      maxChars: 2,
      continuation: first.continuation,
    });
    expect(second).toMatchObject({ content: "cd", truncated: true });
    expect(read).toHaveBeenLastCalledWith("https://example.com", { maxTokens: 50 });

    content = "ab😀changed";
    await expect(
      readUrl("https://example.com", {
        provider: providerName,
        maxTokens: 50,
        maxChars: 2,
        continuation: second.continuation,
      }),
    ).rejects.toThrow(StaleReadContinuationError);
  });

  it("pins automatic continuations to the effective reader", async () => {
    const readFromContext = vi.fn().mockResolvedValue({
      url: "https://example.com",
      content: "abcdef",
    });
    registerReader("jina", paymentRequired);
    registerReader("context", readFromContext);
    process.env.CONTEXT_DEV_API_KEY = "test-key";

    const first = await readUrlDetailed("https://example.com", { maxChars: 3 });
    const second = await readUrlDetailed("https://example.com", {
      maxChars: 3,
      continuation: first.result.continuation,
    });

    expect(second).toMatchObject({
      result: { content: "def", truncated: false },
      requestedProvider: "auto",
      provider: "context",
      attempts: ["context"],
    });
    expect(readFromContext).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed, modified, and mismatched continuation tokens", async () => {
    const providerName = `token-reader-${Math.random().toString(36).slice(2)}`;
    registerReader(providerName, async (url) => ({ url, content: "abcdef" }));

    await expect(
      readUrl("https://example.com", { maxChars: 3, continuation: "not-a-token" }),
    ).rejects.toThrow(InvalidReadContinuationError);

    const first = await readUrl("https://example.com", { provider: providerName, maxChars: 3 });
    if (!first.continuation) throw new Error("Missing continuation token");
    const envelope = JSON.parse(Buffer.from(first.continuation, "base64url").toString("utf8")) as {
      payload: string;
      checksum: string;
    };
    const payload = JSON.parse(envelope.payload) as { offset: number };
    payload.offset += 1;
    envelope.payload = JSON.stringify(payload);
    const modified = Buffer.from(JSON.stringify(envelope)).toString("base64url");
    await expect(
      readUrl("https://example.com", {
        provider: providerName,
        maxChars: 3,
        continuation: modified,
      }),
    ).rejects.toThrow(InvalidReadContinuationError);

    await expect(
      readUrl("https://example.com", {
        provider: providerName,
        format: "html",
        maxChars: 3,
        continuation: first.continuation,
      }),
    ).rejects.toThrow(InvalidReadContinuationError);
  });

  it("rejects continuation tokens at both core batch boundaries", async () => {
    const providerName = `batch-token-reader-${Math.random().toString(36).slice(2)}`;
    const read = vi.fn(async (url: string) => ({ url, content: "abcdef" }));
    registerReader(providerName, read);

    for (const batchRead of [readBatch, readBatchDetailed]) {
      await expect(
        batchRead(["https://example.com"], {
          provider: providerName,
          continuation: "single-page-token",
        }),
      ).rejects.toThrow("continuation is only supported for a single URL");
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects invalid portable output limits before reading", async () => {
    const providerName = `limited-reader-${Math.random().toString(36).slice(2)}`;
    const read = vi.fn(async (url: string) => ({ url, content: "page" }));
    registerReader(providerName, read);

    for (const maxChars of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        readUrl("https://example.com", { provider: providerName, maxChars }),
      ).rejects.toBeInstanceOf(RangeError);
    }
    expect(read).not.toHaveBeenCalled();
    await expect(
      readUrl("https://example.com", { provider: providerName, maxChars: 200_001 }),
    ).resolves.toMatchObject({ content: "page", truncated: false });
  });

  it("throws EmptyUrlError for whitespace-only URLs", async () => {
    await expect(readUrl("   ")).rejects.toThrow(EmptyUrlError);
  });

  it("throws ReadNotSupportedError for search-only built-in providers before constructing them", async () => {
    delete process.env.EXA_API_KEY;

    await expect(readUrl("https://example.com", { provider: "exa" })).rejects.toThrow(
      ReadNotSupportedError,
    );
  });

  it("throws ReadNotSupportedError when a custom provider has no read capability", async () => {
    const providerName = `search-only-${Math.random().toString(36).slice(2)}`;
    class SearchOnlyProvider extends Provider {
      static readonly providerName = providerName;
      static readonly defaultBaseURL = "https://search.example.com";

      constructor(config: Readonly<ProviderConfig>) {
        super(config, SearchOnlyProvider);
      }
    }
    readerCleanups.push(register(SearchOnlyProvider));

    await expect(readUrl("https://example.com", { provider: providerName })).rejects.toThrow(
      ReadNotSupportedError,
    );
  });

  it("includes a keyless custom reader in automatic fallback", async () => {
    const providerName = `automatic-reader-${Math.random().toString(36).slice(2)}`;
    class AutomaticReader extends Provider {
      static readonly providerName = providerName;
      static readonly defaultBaseURL = "https://automatic-reader.example.com";
      static readonly apiKeyEnvVar = null;

      constructor(config: Readonly<ProviderConfig>) {
        super(config, AutomaticReader);
      }

      async read(url: string): Promise<ReadResult> {
        return { url, content: "Custom fallback" };
      }
    }
    registerReader("jina", paymentRequired);
    readerCleanups.push(register(AutomaticReader));

    await expect(readUrlDetailed("https://example.com")).resolves.toMatchObject({
      provider: providerName,
      attempts: ["jina", providerName],
      result: { content: "Custom fallback" },
    });
  });
});
