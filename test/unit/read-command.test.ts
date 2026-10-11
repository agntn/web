import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AuthError, EmptyUrlError } from "../../src/core/errors.ts";
import { runWeb } from "../fixtures/cli.ts";

const mockReadUrlDetailed =
  vi.fn<(url: string, options: Readonly<Record<string, unknown>>) => Promise<unknown>>();
const mockReadBatchDetailed =
  vi.fn<
    (
      urls: readonly string[],
      options: Readonly<Record<string, unknown>>,
    ) => Promise<readonly unknown[]>
  >();

vi.mock("../../src/core/read.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/read.ts")>()),
  readUrlDetailed: (url: string, options: Readonly<Record<string, unknown>>) =>
    mockReadUrlDetailed(url, options),
}));

vi.mock("../../src/core/batch.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/batch.ts")>()),
  readBatchDetailed: (urls: readonly string[], options: Readonly<Record<string, unknown>>) =>
    mockReadBatchDetailed(urls, options),
}));

vi.mock("../../src/core/registry.ts", () => ({
  providers: vi.fn(() => ["jina"]),
  readProviders: vi.fn(() => ["jina"]),
}));

vi.mock("../../src/providers/index.ts", () => ({}));

/**
 * The details `web read --json` printed.
 * @param stdout - Everything the command wrote to stdout.
 * @returns {unknown} The data under `result`.
 */
function jsonResult(stdout: string): unknown {
  return (JSON.parse(stdout) as { readonly result: unknown }).result;
}

describe("read command", () => {
  beforeEach(() => {
    mockReadUrlDetailed.mockReset();
    mockReadBatchDetailed.mockReset();
    mockReadUrlDetailed.mockResolvedValue({
      result: {
        url: "https://example.com",
        title: "Example",
        description: "Example description",
        content: "Example content",
      },
      requestedProvider: "auto",
      provider: "jina",
      attempts: ["jina"],
      failures: [],
    });
  });

  it("leaves an omitted provider in automatic mode and the page whole", async () => {
    await runWeb("read", "https://example.com");

    expect(mockReadUrlDetailed).toHaveBeenCalledWith("https://example.com", {});
  });

  it("passes native and portable read limits", async () => {
    await runWeb(
      "read",
      "https://example.com",
      "--format",
      "text",
      "--max-tokens",
      "500",
      "--max-chars",
      "2000",
      "--continuation",
      "next-page",
    );

    expect(mockReadUrlDetailed).toHaveBeenCalledWith("https://example.com", {
      format: "text",
      maxTokens: 500,
      maxChars: 2000,
      continuation: "next-page",
    });
  });

  it("passes the link and image opt-ins", async () => {
    await runWeb("read", "https://example.com", "--max-chars", "2000", "--links", "--images");

    expect(mockReadUrlDetailed).toHaveBeenCalledWith("https://example.com", {
      maxChars: 2000,
      links: true,
      images: true,
    });
  });

  it("asks for a fresh copy with --no-cache", async () => {
    await runWeb("read", "https://example.com", "--no-cache");

    expect(mockReadUrlDetailed).toHaveBeenCalledWith("https://example.com", { noCache: true });
  });

  it("passes --no-cache to every URL of a batch", async () => {
    const urls = ["https://example.com/one", "https://example.com/two"];
    mockReadBatchDetailed.mockResolvedValueOnce([]);

    await runWeb("read", ...urls, "--no-cache");

    expect(mockReadBatchDetailed).toHaveBeenCalledWith(urls, { noCache: true });
  });

  it("leaves the provider cache alone without --no-cache", async () => {
    await runWeb("read", "https://example.com", "--cache");

    expect(mockReadUrlDetailed.mock.calls[0]?.[1]).toHaveProperty("noCache", undefined);
  });

  it("prints requested links and images in human output", async () => {
    mockReadUrlDetailed.mockResolvedValueOnce({
      result: {
        url: "https://example.com",
        content: "page",
        links: ["https://example.com/a", "https://example.com/\x1B[31mb"],
        images: ["https://example.com/hero.png"],
      },
      requestedProvider: "auto",
      provider: "jina",
      attempts: ["jina"],
      failures: [],
    });

    const { stdout } = await runWeb("read", "https://example.com", "--links", "--images");

    expect(stdout).toBe(
      [
        "[provider=jina requested=auto] read https://example.com",
        "",
        "(no title)",
        "   https://example.com",
        "",
        "page",
        "",
        "Links (2):",
        "  https://example.com/a",
        "  https://example.com/b",
        "",
        "Images (1):",
        "  https://example.com/hero.png",
        "",
      ].join("\n"),
    );
  });

  it("outputs effective provider provenance in JSON", async () => {
    const { stdout } = await runWeb("read", "https://example.com", "--json");

    expect(jsonResult(stdout)).toMatchObject({
      result: { content: "Example content" },
      requestedProvider: "auto",
      provider: "jina",
      attempts: ["jina"],
    });
  });

  it("names the readers an automatic read went through", async () => {
    mockReadUrlDetailed.mockResolvedValueOnce({
      result: { url: "https://example.com", content: "page" },
      requestedProvider: "auto",
      provider: "context",
      attempts: ["jina", "context"],
      failures: [{ provider: "jina", error: "HTTP 402: out of credits" }],
    });

    const { stdout } = await runWeb("read", "https://example.com");

    expect(stdout).toMatch(
      /^\[provider=context requested=auto\] read https:\/\/example\.com\nTried: jina, context\n {2}jina failed: HTTP 402: out of credits\n\n/u,
    );
  });

  it("keeps provider provenance on one terminal safe header line", async () => {
    mockReadUrlDetailed.mockResolvedValueOnce({
      result: { url: "https://example.com/\nforged", content: "page" },
      requestedProvider: "custom\nprovider",
      provider: "reader\x1B[31mname",
      attempts: ["reader"],
      failures: [],
    });

    const { stdout } = await runWeb("read", "https://example.com");

    expect(stdout.split("\n")[0]).toBe(
      "[provider=readername requested=custom provider] read https://example.com/ forged",
    );
  });

  it("keeps ordered batch JSON and exits non-zero after a partial failure", async () => {
    const urls = ["https://example.com/one", "https://example.com/two"];
    const outcomes = [
      {
        url: urls[0],
        result: { url: urls[0], content: "First page" },
        requestedProvider: "auto",
        provider: "context",
        attempts: ["jina", "context"],
        failures: [],
      },
      { url: urls[1], error: "second read failed" },
    ];
    mockReadBatchDetailed.mockResolvedValueOnce(outcomes);

    const { stdout, code } = await runWeb("read", ...urls, "--json");

    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
    expect(mockReadBatchDetailed).toHaveBeenCalledWith(urls, {});
    expect(jsonResult(stdout)).toEqual(outcomes);
    expect(code).toBe(1);
  });

  it("keeps a successful batch at exit zero", async () => {
    const urls = ["https://example.com/one", "https://example.com/two"];
    mockReadBatchDetailed.mockResolvedValueOnce(
      urls.map((url) => ({
        url,
        result: { url, content: "Page" },
        requestedProvider: "auto",
        provider: "jina",
        attempts: ["jina"],
        failures: [],
      })),
    );

    const { code } = await runWeb("read", ...urls);

    expect(mockReadBatchDetailed).toHaveBeenCalledOnce();
    expect(code).toBe(0);
  });

  it("rejects more than ten URLs before reading any of them", async () => {
    const urls = Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`);

    const { stderr, code } = await runWeb("read", ...urls);

    expect(stderr).toBe("Invalid arguments at <URLS...>: must not have more than 10 items\n");
    expect(code).toBe(1);
    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
    expect(mockReadBatchDetailed).not.toHaveBeenCalled();
  });

  it("removes terminal controls from human output without flattening page content", async () => {
    const escape = String.fromCodePoint(0x1b);
    const bell = String.fromCodePoint(0x07);
    const controlSequence = String.fromCodePoint(0x9b);
    const lineSeparator = String.fromCodePoint(0x2028);
    const rightToLeftOverride = String.fromCodePoint(0x202e);
    const zeroWidthNonJoiner = String.fromCodePoint(0x200c);
    const zeroWidthJoiner = String.fromCodePoint(0x200d);
    const joinedEmoji = `👩${zeroWidthJoiner}💻`;
    const persian = `می${zeroWidthNonJoiner}روم`;
    mockReadUrlDetailed.mockResolvedValueOnce({
      result: {
        url: `https://example.com/${lineSeparator}page`,
        title: `Example \x1B[31mTitle\x1B[0m${rightToLeftOverride}`,
        description: `Description${controlSequence}31m${rightToLeftOverride}safe`,
        content: `Zażółć \x1B[31mred\x1B[0m \x01world\r    ${joinedEmoji} ${persian}\t${escape}]8;;https://evil.example${bell}link${escape}]8;;${bell}gap\nnext${lineSeparator}line ${controlSequence}31m${rightToLeftOverride}safe`,
      },
      requestedProvider: "auto",
      provider: "jina",
      attempts: ["jina"],
      failures: [],
    });

    const { stdout } = await runWeb("read", "https://example.com");

    expect(stdout).toBe(
      [
        "[provider=jina requested=auto] read https://example.com/ page",
        "",
        "Example Title",
        "   https://example.com/ page",
        "   Description safe",
        "",
        `Zażółć red world\n    ${joinedEmoji} ${persian}\tlinkgap\nnext line safe`,
        "",
      ].join("\n"),
    );
  });

  it("reports an empty URL from the core in one line", async () => {
    mockReadUrlDetailed.mockRejectedValueOnce(new EmptyUrlError());

    const { stderr, code } = await runWeb("read", "   ");

    expect(stderr).toBe(`${new EmptyUrlError().message}\n`);
    expect(code).toBe(1);
  });

  it("exits with a helpful message for invalid format", async () => {
    const { stderr, code } = await runWeb("read", "https://example.com", "--format", "pdf");

    expect(stderr).toMatch(/^Invalid arguments at --format: /u);
    expect(code).toBe(1);
    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
  });

  it("exits with a helpful message for invalid max tokens", async () => {
    const { stderr, code } = await runWeb("read", "https://example.com", "--max-tokens", "0");

    expect(stderr).toBe("Invalid arguments at --max-tokens: must be >= 1\n");
    expect(code).toBe(1);
    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
  });

  it("rejects an unsafe portable limit", async () => {
    const { stderr, code } = await runWeb(
      "read",
      "https://example.com",
      "--max-chars",
      "9007199254740992",
    );

    expect(stderr).toBe("Invalid arguments at --max-chars: must be <= 200000\n");
    expect(code).toBe(1);
    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
  });

  it("reports an authentication failure from the reader in one line", async () => {
    mockReadUrlDetailed.mockRejectedValueOnce(
      new AuthError("Authentication failed for jina: unauthorized", "jina"),
    );

    const { stderr, code } = await runWeb("read", "https://example.com");

    expect(stderr).toBe("Authentication failed for jina: unauthorized\n");
    expect(code).toBe(1);
  });

  it("names the readers it can use when the one asked for is unknown", async () => {
    const { stderr, code } = await runWeb("read", "https://example.com", "--provider", "missing");

    expect(stderr).toBe("provider must be one of: auto, jina\n");
    expect(code).toBe(1);
    expect(mockReadUrlDetailed).not.toHaveBeenCalled();
  });
});
