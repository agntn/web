import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

const { mockError, mockInfo, mockLog, mockSearchByImage } = vi.hoisted(() => ({
  mockError: vi.fn(),
  mockInfo: vi.fn(),
  mockLog: vi.fn(),
  mockSearchByImage: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: {
    log: mockLog,
    info: mockInfo,
    error: mockError,
  },
}));

vi.mock("../../src/core/image.ts", () => ({
  imageSearchProviderNames: ["serpapi"],
  searchByImage: mockSearchByImage,
}));

import searchImageCommand from "../../src/commands/search-image.ts";
import { InvalidImageUrlError } from "../../src/core/errors.ts";

type CommandRunInput = Parameters<NonNullable<typeof searchImageCommand.run>>[0];

describe("search-image command", () => {
  let exitSpy: MockInstance<typeof process.exit>;
  let stdoutSpy: MockInstance<typeof process.stdout.write>;

  beforeEach(() => {
    mockSearchByImage.mockReset();
    mockError.mockReset();
    mockInfo.mockReset();
    mockLog.mockReset();
    mockSearchByImage.mockResolvedValue([
      {
        pageUrl: "https://example.com/page",
        imageUrl: "https://example.com/image.jpg",
        title: "Match",
        provider: "serpapi",
      },
    ]);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__EXIT__");
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("passes the URL and options to reverse image search", async () => {
    await runCommand({
      url: "https://example.com/input.jpg",
      provider: "serpapi",
      "max-results": "5",
      json: true,
    });

    expect(mockSearchByImage).toHaveBeenCalledWith("https://example.com/input.jpg", {
      provider: "serpapi",
      maxResults: 5,
    });
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"pageUrl"'));
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

    await runCommand({
      url: "https://example.com/input.jpg",
      "max-results": "5",
      json: false,
    });

    expect(mockLog.mock.calls.map(([message]) => String(message))).toEqual([
      `${escape}[1m${escape}[36mMatch link${escape}[0m`,
      "  https://example.com/page forged",
      `  ${escape}[90mhttps://example.com/image.jpg forged${escape}[0m`,
      "",
    ]);
  });

  it("reports invalid image URLs without a stack trace", async () => {
    mockSearchByImage.mockRejectedValueOnce(new InvalidImageUrlError());

    await expect(
      runCommand({
        url: "file:///tmp/image.jpg",
        "max-results": "5",
        json: false,
      }),
    ).rejects.toThrow("__EXIT__");

    expect(mockError).toHaveBeenCalledWith("Image URL must be an absolute HTTP or HTTPS URL");
  });

  it("rejects an invalid result limit before provider calls", async () => {
    await expect(
      runCommand({
        url: "https://example.com/input.jpg",
        "max-results": "0",
        json: false,
      }),
    ).rejects.toThrow("__EXIT__");

    expect(mockSearchByImage).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith(
      "Invalid --max-results value. Expected a positive integer.",
    );
  });
});

function runCommand(args: {
  readonly url: string;
  readonly provider?: string;
  readonly "max-results": string;
  readonly json: boolean;
}): Promise<unknown> {
  const input = {
    args: { _: [], ...args },
    rawArgs: [],
    cmd: searchImageCommand,
  } as CommandRunInput;
  return Promise.resolve(searchImageCommand.run!(input) as unknown);
}
