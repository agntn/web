import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@opencode-ai/plugin";

const { mockGetJSON, mockPostJSON } = vi.hoisted(() => ({
  mockGetJSON: vi.fn(),
  mockPostJSON: vi.fn(),
}));

vi.mock("../../src/core/client.ts", () => ({
  defaultClient: () => ({ getJSON: mockGetJSON, postJSON: mockPostJSON }),
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

describe("OpenCode web tools", () => {
  const previousSerpApiKey = process.env.SERPAPI_API_KEY;
  const previousExaKey = process.env.EXA_API_KEY;

  beforeEach(() => {
    process.env.SERPAPI_API_KEY = "test-key";
    mockGetJSON.mockReset();
    mockPostJSON.mockReset();
  });

  afterEach(() => {
    if (previousSerpApiKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = previousSerpApiKey;
    if (previousExaKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previousExaKey;
  });

  it("passes the highlights preference through web_search", async () => {
    process.env.EXA_API_KEY = "test-key";
    mockPostJSON.mockResolvedValueOnce({ requestId: "request", results: [] });
    const hooks = await WebPlugin({} as Parameters<typeof WebPlugin>[0]);
    const search = hooks.tool?.web_search;
    if (!search) throw new Error("web_search was not registered");

    await search.execute({ query: "test", provider: "exa", highlights: false }, toolContext());

    expect(mockPostJSON.mock.calls[0]?.[1]).toMatchObject({
      contents: { text: true, highlights: false },
    });
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
