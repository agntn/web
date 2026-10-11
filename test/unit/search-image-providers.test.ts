import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ProviderEntry } from "../../src/core/registry.ts";
import type { ImageSearchResult, ProviderConfig } from "../../src/core/types.ts";

const { mockSearchByImage } = vi.hoisted(() => ({ mockSearchByImage: vi.fn() }));

vi.mock("../../src/providers/index.ts", async () => {
  const { Provider } = await import("../../src/core/provider.ts");

  class FakeSerpApiProvider extends Provider {
    static readonly providerName = "serpapi";
    static readonly defaultBaseURL = "https://serpapi.example.com";

    constructor(config: Readonly<ProviderConfig>) {
      super(config, FakeSerpApiProvider);
    }

    searchByImage(url: string): Promise<ImageSearchResult[]> {
      return mockSearchByImage(url) as Promise<ImageSearchResult[]>;
    }
  }

  /** The manifest the registry seeds from: one built in, loaded the way a real entry is. */
  const builtins: ProviderEntry[] = [
    {
      name: "serpapi",
      apiKeyEnvVar: null,
      searchImage: { resultLimit: { default: 10 } },
      load: () => Promise.resolve(FakeSerpApiProvider),
    },
  ];
  return { builtins };
});

import { runWeb } from "../fixtures/cli.ts";

describe("search-image command providers", () => {
  beforeEach(() => {
    mockSearchByImage.mockReset();
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

    const { stdout, stderr, code } = await runWeb(
      "search-image",
      "https://example.com/input.jpg",
      "--max-results",
      "5",
      "--json",
    );

    expect(mockSearchByImage).toHaveBeenCalledWith("https://example.com/input.jpg");
    expect(stdout).toContain('"pageUrl": "https://example.com/page"');
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });
});
