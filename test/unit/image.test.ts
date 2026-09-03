import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateImageSearchProvider, mockSearchByImage } = vi.hoisted(() => {
  const searchByImage = vi.fn();
  return {
    mockSearchByImage: searchByImage,
    mockCreateImageSearchProvider: vi.fn(() => ({ searchByImage })),
  };
});

vi.mock("../../src/core/registry.ts", () => ({
  createImageSearchProvider: mockCreateImageSearchProvider,
  has: (name: string) => name === "brave" || name === "serpapi",
  searchImageProviders: () => ["serpapi"],
}));

import { searchByImage } from "../../src/core/image.ts";
import {
  EmptyImageUrlError,
  ImageSearchNotSupportedError,
  InvalidImageUrlError,
} from "../../src/core/errors.ts";

beforeEach(() => {
  mockSearchByImage.mockReset();
  mockCreateImageSearchProvider.mockClear();
  mockSearchByImage.mockResolvedValue([]);
});

describe("searchByImage", () => {
  it("uses SerpAPI by default and trims the image URL", async () => {
    await searchByImage("  https://example.com/image.jpg  ", { maxResults: 4 });

    expect(mockCreateImageSearchProvider).toHaveBeenCalledWith("serpapi");
    expect(mockSearchByImage).toHaveBeenCalledWith("https://example.com/image.jpg", {
      maxResults: 4,
    });
  });

  it("rejects empty and non-HTTP image URLs before provider creation", async () => {
    await expect(searchByImage("   ")).rejects.toBeInstanceOf(EmptyImageUrlError);
    await expect(searchByImage("file:///tmp/image.jpg")).rejects.toBeInstanceOf(
      InvalidImageUrlError,
    );
    await expect(searchByImage("not a URL")).rejects.toBeInstanceOf(InvalidImageUrlError);
    await expect(
      searchByImage("https://example.com/image.jpg", { maxResults: 0 }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      searchByImage("https://example.com/image.jpg", { maxResults: 1.5 }),
    ).rejects.toBeInstanceOf(TypeError);

    expect(mockCreateImageSearchProvider).not.toHaveBeenCalled();
  });

  it("rejects a built-in provider without reverse image search", async () => {
    await expect(
      searchByImage("https://example.com/image.jpg", { provider: "brave" }),
    ).rejects.toBeInstanceOf(ImageSearchNotSupportedError);

    expect(mockCreateImageSearchProvider).not.toHaveBeenCalled();
  });
});
