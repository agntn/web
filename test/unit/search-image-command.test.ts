import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockSearchByImage } = vi.hoisted(() => ({ mockSearchByImage: vi.fn() }));

vi.mock("../../src/core/image.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/image.ts")>()),
  searchByImage: mockSearchByImage,
}));

import { InvalidImageUrlError } from "../../src/core/errors.ts";
import { runWeb } from "../fixtures/cli.ts";

describe("search-image command", () => {
  beforeEach(() => {
    mockSearchByImage.mockReset();
    mockSearchByImage.mockResolvedValue([
      {
        pageUrl: "https://example.com/page",
        imageUrl: "https://example.com/image.jpg",
        title: "Match",
        provider: "serpapi",
      },
    ]);
  });

  it("passes the URL and options to reverse image search", async () => {
    const { stdout } = await runWeb(
      "search-image",
      "https://example.com/input.jpg",
      "--provider",
      "serpapi",
      "--max-results",
      "5",
      "--json",
    );

    expect(mockSearchByImage).toHaveBeenCalledWith("https://example.com/input.jpg", {
      provider: "serpapi",
      maxResults: 5,
    });
    expect(stdout).toContain('"pageUrl"');
  });

  it("answers to image-search too", async () => {
    await runWeb("image-search", "https://example.com/input.jpg");

    expect(mockSearchByImage).toHaveBeenCalledWith("https://example.com/input.jpg", {});
  });

  it("removes terminal controls from human-readable matches", async () => {
    const escape = String.fromCodePoint(0x1b);
    const bell = String.fromCodePoint(0x07);
    const controlSequence = String.fromCodePoint(0x9b);
    const lineSeparator = String.fromCodePoint(0x2028);
    const rightToLeftOverride = String.fromCodePoint(0x202e);
    mockSearchByImage.mockResolvedValueOnce([
      {
        pageUrl: `https://example.com/page${lineSeparator}forged`,
        imageUrl: `https://example.com/image.jpg${controlSequence}31m${rightToLeftOverride}forged`,
        title: `Match${escape}]8;;https://evil.example${bell} link${escape}]8;;${bell}`,
        provider: "serpapi",
      },
    ]);

    const { stdout } = await runWeb("search-image", "https://example.com/input.jpg");

    expect(stdout).toBe(
      [
        "[provider=serpapi] 1 image match(es) for https://example.com/input.jpg",
        "",
        "1. Match link",
        "   https://example.com/page forged",
        "   https://example.com/image.jpg forged",
        "",
      ].join("\n"),
    );
  });

  it("reports invalid image URLs without a stack trace", async () => {
    mockSearchByImage.mockRejectedValueOnce(new InvalidImageUrlError());

    const { stderr, code } = await runWeb("search-image", "file:///tmp/image.jpg");

    expect(stderr).toBe("Image URL must be an absolute HTTP or HTTPS URL\n");
    expect(code).toBe(1);
  });

  it("rejects an invalid result limit before provider calls", async () => {
    const { stderr, code } = await runWeb(
      "search-image",
      "https://example.com/input.jpg",
      "--max-results",
      "0",
    );

    expect(mockSearchByImage).not.toHaveBeenCalled();
    expect(stderr).toBe("Invalid arguments at --max-results: must be >= 1\n");
    expect(code).toBe(1);
  });
});
