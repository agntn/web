import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { readUrl } from "../../src/core/read.ts";
import { register } from "../../src/core/registry.ts";
import { EmptyUrlError, HTTPError, ReadNotSupportedError } from "../../src/core/errors.ts";
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConfig, ReadOptions, ReadResult } from "../../src/core/types.ts";

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

  register(ReaderProvider);
}

const paymentRequired = async (): Promise<ReadResult> => {
  throw new HTTPError(402, "https://r.jina.ai/https%3A%2F%2Fexample.com", "Payment required");
};

const jinaConflict = async (): Promise<ReadResult> => {
  throw new HTTPError(409, "https://r.jina.ai/https%3A%2F%2Fexample.com", "Conflict");
};

describe("readUrl", () => {
  const fallbackEnvKeys = ["CONTEXT_DEV_API_KEY", "FIRECRAWL_API_KEY", "TINYFISH_API_KEY"] as const;
  const savedEnv = Object.fromEntries(fallbackEnvKeys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    for (const key of fallbackEnvKeys) delete process.env[key];
  });

  afterEach(() => {
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

  it("returns the last configured reader error after Jina 409", async () => {
    registerReader("jina", jinaConflict);
    registerReader("context", async () => {
      throw new HTTPError(503, "https://context.example.com", "Unavailable");
    });
    process.env.CONTEXT_DEV_API_KEY = "test-key";

    await expect(readUrl("https://example.com")).rejects.toMatchObject({
      statusCode: 503,
      url: "https://context.example.com",
    });
  });

  it("keeps trying configured readers until one succeeds", async () => {
    const attempts: string[] = [];
    registerReader("jina", paymentRequired);
    registerReader("context", async () => {
      attempts.push("context");
      throw new Error("Context unavailable");
    });
    registerReader("firecrawl", async () => {
      attempts.push("firecrawl");
      throw new Error("Firecrawl unavailable");
    });
    registerReader("tinyfish", async () => {
      attempts.push("tinyfish");
      return { url: "https://example.com", content: "ok" };
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
    register(ReaderProvider);

    await readUrl(" https://example.com ", {
      provider: providerName,
      format: "text",
      maxTokens: 500,
    });

    expect(read).toHaveBeenCalledWith("https://example.com", { format: "text", maxTokens: 500 });
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
    register(SearchOnlyProvider);

    await expect(readUrl("https://example.com", { provider: providerName })).rejects.toThrow(
      ReadNotSupportedError,
    );
  });
});
