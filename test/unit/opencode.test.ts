import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@opencode-ai/plugin";

const { mockGetJSON } = vi.hoisted(() => ({ mockGetJSON: vi.fn() }));

vi.mock("../../src/core/client.ts", () => ({
  defaultClient: () => ({ getJSON: mockGetJSON }),
}));

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  return {
    tool: Object.assign(<Definition>(definition: Definition): Definition => definition, {
      schema: z,
    }),
  };
});

import WebPlugin from "../../src/opencode.ts";

describe("OpenCode reverse image search tool", () => {
  const previousKey = process.env.SERPAPI_API_KEY;

  beforeEach(() => {
    process.env.SERPAPI_API_KEY = "test-key";
    mockGetJSON.mockReset();
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = previousKey;
  });

  it("registers web_search_image and returns serialized normalized matches", async () => {
    mockGetJSON.mockResolvedValueOnce({
      search_metadata: { id: "lens-id", status: "Success" },
      visual_matches: [
        {
          position: 1,
          title: "Matching page",
          link: "https://example.com/page",
          image: "https://example.com/full.jpg",
        },
      ],
    });
    const hooks = await WebPlugin({} as Parameters<typeof WebPlugin>[0]);
    const searchImage = hooks.tool?.web_search_image;
    if (!searchImage) throw new Error("web_search_image was not registered");

    const output = await searchImage.execute(
      { url: "https://example.com/input.jpg", provider: "serpapi", maxResults: 5 },
      toolContext(),
    );

    expect(output).toContain("pageUrl");
    expect(output).toContain("https://example.com/page");
    expect(output).toContain("https://example.com/full.jpg");
    const requestUrl = new URL(String(mockGetJSON.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("engine")).toBe("google_lens");
    expect(requestUrl.searchParams.get("url")).toBe("https://example.com/input.jpg");
  });
});

function toolContext(): ToolContext {
  return {
    sessionID: "session",
    messageID: "message",
    agent: "agent",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: vi.fn(),
    ask: vi.fn(),
  };
}
