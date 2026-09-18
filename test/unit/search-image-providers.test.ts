import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { ImageSearchResult, ProviderConfig } from "../../src/core/types.ts";

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

vi.mock("../../src/providers/index.ts", async () => {
  const { Provider } = await import("../../src/core/provider.ts");
  const { register } = await import("../../src/core/registry.ts");

  class FakeSerpApiProvider extends Provider {
    static readonly providerName = "serpapi";
    static readonly defaultBaseURL = "https://serpapi.example.com";
    static readonly apiKeyEnvVar = null;

    constructor(config: Readonly<ProviderConfig>) {
      super(config, FakeSerpApiProvider);
    }

    searchByImage(url: string): Promise<ImageSearchResult[]> {
      return mockSearchByImage(url) as Promise<ImageSearchResult[]>;
    }
  }

  register(FakeSerpApiProvider);
  return {};
});

import searchImageCommand from "../../src/commands/search-image.ts";

type CommandRunInput = Parameters<NonNullable<typeof searchImageCommand.run>>[0];

describe("search-image command providers", () => {
  let exitSpy: MockInstance<typeof process.exit>;
  let stdoutSpy: MockInstance<typeof process.stdout.write>;

  beforeEach(() => {
    mockSearchByImage.mockReset();
    mockError.mockReset();
    mockInfo.mockReset();
    mockLog.mockReset();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__EXIT__");
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("reaches the built in provider without a provider flag", async () => {
    mockSearchByImage.mockResolvedValueOnce([
      {
        pageUrl: "https://example.com/page",
        imageUrl: "https://example.com/image.jpg",
        title: "Match",
        provider: "serpapi",
      },
    ]);

    await runCommand({
      url: "https://example.com/input.jpg",
      "max-results": "5",
      json: true,
    });

    expect(mockSearchByImage).toHaveBeenCalledWith("https://example.com/input.jpg");
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining('"pageUrl": "https://example.com/page"'),
    );
    expect(mockError).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
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
